#!/usr/bin/env node

/**
 * ColGrep Pattern Benchmark Runner
 *
 * Evaluates pattern search (regex + MaxSim) against baselines.
 * Uses the project's own codebase as corpus — requires an existing index.
 *
 * Tracks:
 *   B1: Synthetic pattern benchmark (MRR, Recall@5/10, latency)
 *   C:  Latency profiling per component (grep, encode, MaxSim)
 *
 * Baselines:
 *   1. hybrid-no-regex: Sweet Search hybrid mode (BM25 + semantic)
 *   2. pattern-maxsim:  ColGrep pattern mode (regex + MaxSim ranking)
 *
 * Usage:
 *   node eval/run_pattern_benchmark.js
 *   node eval/run_pattern_benchmark.js --max-queries=20
 *   node eval/run_pattern_benchmark.js --baselines=pattern-maxsim
 *   node eval/run_pattern_benchmark.js --skip-baselines
 *   node eval/run_pattern_benchmark.js --save-baseline
 *   node eval/run_pattern_benchmark.js --concurrency=8
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadJsonl } from './lib/data-loader.js';
import { computeMetrics } from './lib/metrics.js';
import {
  runPatternQuery,
  runBaselineQuery,
  runRgOnlyQuery,
  evaluatePatternQuery,
  getRelevantChunkIds,
  computePerSliceMetrics,
  computeWinRate,
  printSliceReport,
  printWinRate,
} from './lib/pattern-evaluator.js';
import { saveResults, saveBaseline, buildReport } from './lib/results.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    maxQueries: 0,
    k: 10,
    concurrency: 5,
    baselines: ['rg-only', 'hybrid-no-regex', 'pattern-maxsim'],
    skipBaselines: false,
    saveBaselineFlag: false,
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--max-queries=')) opts.maxQueries = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--k=')) opts.k = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--concurrency=')) opts.concurrency = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--baselines=')) opts.baselines = arg.split('=')[1].split(',');
    else if (arg === '--skip-baselines') opts.skipBaselines = true;
    else if (arg === '--save-baseline') opts.saveBaselineFlag = true;
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
ColGrep Pattern Benchmark Runner

Usage: node eval/run_pattern_benchmark.js [options]

Options:
  --max-queries=N       Limit number of queries (0 = all) [default: 0]
  --k=N                 Top-k results to retrieve [default: 10]
  --concurrency=N       Parallel query execution [default: 5]
  --baselines=LIST      Comma-separated baselines to run [default: rg-only,hybrid-no-regex,pattern-maxsim]
  --skip-baselines      Only run pattern-maxsim (treatment), skip comparison baselines
  --save-baseline       Save results as new baseline for regression checks
  --verbose, -v         Show per-query details
  --help, -h            Show this help

Baselines:
  rg-only           Pure ripgrep (recall ceiling, no ranking)
  hybrid-no-regex   Sweet Search hybrid mode (BM25 + semantic, no regex)
  pattern-maxsim    ColGrep pattern mode (regex candidates + MaxSim ranking)
`);
      process.exit(0);
    }
  }

  if (opts.skipBaselines) opts.baselines = ['pattern-maxsim'];
  return opts;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log('═'.repeat(70));
  console.log('  ColGrep Pattern Benchmark Runner');
  console.log('═'.repeat(70));
  console.log(`  Baselines:   ${opts.baselines.join(', ')}`);
  console.log(`  Max queries: ${opts.maxQueries || 'all'}`);
  console.log(`  Top-k:       ${opts.k}`);
  console.log(`  Concurrency: ${opts.concurrency}`);

  // 1. Load benchmark queries
  const queriesFile = path.join(__dirname, 'data', 'pattern-benchmark', 'queries.jsonl');
  if (!existsSync(queriesFile)) {
    console.error(`\n  Benchmark queries not found: ${queriesFile}`);
    process.exit(2);
  }

  let queries = loadJsonl(queriesFile);
  if (opts.maxQueries > 0) {
    queries = queries.slice(0, opts.maxQueries);
  }
  for (const queryObj of queries) {
    getRelevantChunkIds(queryObj);
  }
  console.log(`  Queries:     ${queries.length}`);

  // 2. Check that the project index exists
  const indexPath = path.join(PROJECT_ROOT, '.sweet-search');
  if (!existsSync(indexPath)) {
    console.error('\n  No .sweet-search/ index found. Run indexing first:');
    console.error('    node core/index-codebase-v21.js');
    process.exit(2);
  }

  // 3. Initialize Sweet Search
  console.log('\n[1/3] Initializing Sweet Search...');

  // Set project root so search operates on the correct codebase
  process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

  const { default: SweetSearch } = await import(path.join(PROJECT_ROOT, 'core', 'sweet-search.js'));
  const search = new SweetSearch({ verbose: opts.verbose });
  await search.init();

  console.log('  Search initialized');

  // 4. Run each baseline
  const allBaselineResults = {};
  const { default: pLimit } = await import('p-limit');

  for (const baseline of opts.baselines) {
    console.log(`\n[2/3] Running baseline: ${baseline} (${queries.length} queries)...`);

    const limit = pLimit(opts.concurrency);
    const evaluatedQueries = [];
    const errors = [];
    let completed = 0;

    const tasks = queries.map(queryObj => limit(async () => {
      try {
        let result;
        if (baseline === 'pattern-maxsim') {
          result = await runPatternQuery(search, queryObj, { k: opts.k });
        } else if (baseline === 'rg-only') {
          result = await runRgOnlyQuery(search, queryObj, { k: opts.k });
        } else if (baseline === 'hybrid-no-regex') {
          result = await runBaselineQuery(search, queryObj, 'hybrid', { k: opts.k });
        } else {
          result = await runBaselineQuery(search, queryObj, baseline, { k: opts.k });
        }

        const evaluated = evaluatePatternQuery(queryObj, result.results);
        evaluated.latencyMs = result.latencyMs;

        // Attach per-query stats for Track C latency profiling
        if (result.stats) {
          evaluated.patternStats = {
            grepMatches: result.stats.grepMatches,
            indexedChunks: result.stats.indexedChunks,
            unindexedMatches: result.stats.unindexedMatches,
            maxSimCandidates: result.stats.maxSimCandidates,
            mapTime_ms: result.stats.mapTime_ms,
            parallelTime_ms: result.stats.parallelTime_ms,
            rerankTime_ms: result.stats.rerankTime_ms,
          };
        }

        evaluatedQueries.push(evaluated);

        completed++;
        if (completed % 20 === 0 || completed === queries.length) {
          process.stderr.write(`  Progress: ${completed}/${queries.length}\n`);
        }

        if (opts.verbose && evaluated.rankedRelevance[0] !== 1) {
          const top = result.results[0];
          console.log(`    MISS: [${queryObj.regex}] "${queryObj.semantic_query.slice(0, 40)}..." → ${top?.file || 'none'}`);
        }
      } catch (err) {
        errors.push({ queryId: queryObj.query_id, error: err.message });
        completed++;
      }
    }));

    await Promise.all(tasks);

    if (errors.length > 0) {
      console.log(`  Errors: ${errors.length} queries failed`);
      if (opts.verbose) {
        for (const err of errors.slice(0, 5)) {
          console.log(`    ${err.queryId}: ${err.error}`);
        }
      }
    }

    allBaselineResults[baseline] = {
      evaluatedQueries,
      metrics: computeMetrics(evaluatedQueries),
      errors,
    };
  }

  // 5. Report
  console.log('\n[3/3] Computing metrics...');
  console.log('\n' + '═'.repeat(70));
  console.log('  COLGREP PATTERN BENCHMARK RESULTS');
  console.log('═'.repeat(70));

  for (const [baseline, data] of Object.entries(allBaselineResults)) {
    const m = data.metrics;
    console.log(`\n  ── ${baseline} ──`);
    console.log(`  Queries: ${data.evaluatedQueries.length} (${data.errors.length} errors)`);
    console.log('  ' + '-'.repeat(50));
    console.log(`  MRR@10:      ${(m.mrr_at_10 * 100).toFixed(2)}%`);
    console.log(`  Recall@5:    ${(m.recall_at_5 * 100).toFixed(2)}%`);
    console.log(`  Recall@10:   ${(m.recall_at_10 * 100).toFixed(2)}%`);
    console.log(`  NDCG@10:     ${(m.ndcg_at_10 * 100).toFixed(2)}%`);
    console.log(`  Success@1:   ${(m.success_at_1 * 100).toFixed(2)}%`);
    console.log('  ' + '-'.repeat(50));
    console.log(`  Latency p50: ${m.latency_p50_ms.toFixed(1)}ms`);
    console.log(`  Latency p95: ${m.latency_p95_ms.toFixed(1)}ms`);
    console.log(`  Latency avg: ${m.latency_mean_ms.toFixed(1)}ms`);

    // Per-slice breakdown for pattern mode
    if (baseline === 'pattern-maxsim') {
      const slices = computePerSliceMetrics(data.evaluatedQueries, computeMetrics);
      printSliceReport('regexFamily', slices.regexFamily);
      printSliceReport('difficulty', slices.difficulty);
      printSliceReport('namingQuality', slices.namingQuality);

      // Track C: Component latency profiling
      const withStats = data.evaluatedQueries.filter(q => q.patternStats);
      if (withStats.length > 0) {
        console.log('\n  ── Track C: Component Latency Profiling ──');
        console.log('  ' + '-'.repeat(50));
        const avg = (arr, key) => arr.reduce((s, q) => s + (q.patternStats[key] || 0), 0) / arr.length;
        console.log(`  Chunk location map:  ${avg(withStats, 'mapTime_ms').toFixed(1)}ms avg`);
        console.log(`  Parallel (grep+enc): ${avg(withStats, 'parallelTime_ms').toFixed(1)}ms avg`);
        console.log(`  MaxSim rerank:       ${avg(withStats, 'rerankTime_ms').toFixed(1)}ms avg`);
        console.log(`  Grep matches:        ${avg(withStats, 'grepMatches').toFixed(0)} avg`);
        console.log(`  Indexed chunks:      ${avg(withStats, 'indexedChunks').toFixed(0)} avg`);
        console.log(`  MaxSim candidates:   ${avg(withStats, 'maxSimCandidates').toFixed(0)} avg`);
      }
    }
  }

  // Win rate comparisons
  if (allBaselineResults['pattern-maxsim'] && allBaselineResults['rg-only']) {
    const winRate = computeWinRate(
      allBaselineResults['pattern-maxsim'].evaluatedQueries,
      allBaselineResults['rg-only'].evaluatedQueries,
    );
    printWinRate('Pattern vs rg-only (win rate)', winRate);
  }
  if (allBaselineResults['pattern-maxsim'] && allBaselineResults['hybrid-no-regex']) {
    const winRate = computeWinRate(
      allBaselineResults['pattern-maxsim'].evaluatedQueries,
      allBaselineResults['hybrid-no-regex'].evaluatedQueries,
    );
    printWinRate('Pattern vs Hybrid (win rate)', winRate);
  }

  // Summary comparison table
  const baselines = Object.keys(allBaselineResults);
  if (baselines.length > 1) {
    console.log('\n  ── Comparison Summary ──');
    console.log('  ' + '-'.repeat(62));
    console.log('  ' + 'Baseline'.padEnd(20) + 'MRR@10'.padStart(10) + 'R@5'.padStart(8) + 'R@10'.padStart(8) + 'S@1'.padStart(8) + 'p50ms'.padStart(8));
    console.log('  ' + '-'.repeat(62));
    for (const bl of baselines) {
      const m = allBaselineResults[bl].metrics;
      console.log('  ' +
        bl.padEnd(20) +
        `${(m.mrr_at_10 * 100).toFixed(1)}%`.padStart(10) +
        `${(m.recall_at_5 * 100).toFixed(1)}%`.padStart(8) +
        `${(m.recall_at_10 * 100).toFixed(1)}%`.padStart(8) +
        `${(m.success_at_1 * 100).toFixed(1)}%`.padStart(8) +
        `${m.latency_p50_ms.toFixed(0)}`.padStart(8)
      );
    }
    console.log('  ' + '-'.repeat(62));
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log('═'.repeat(70));

  // Save results
  const resultsDir = path.join(__dirname, 'results');
  const patternResults = allBaselineResults['pattern-maxsim'];
  if (patternResults) {
    const report = buildReport({
      dataset: 'pattern-benchmark',
      queryCount: queries.length,
      corpusSize: 0,
      searchMode: 'pattern',
      totalTimeMs: totalTime,
      errorCount: patternResults.errors.length,
      metrics: patternResults.metrics,
      perLanguage: {},
      evaluatedQueries: patternResults.evaluatedQueries,
    });

    // Extend report with pattern-specific data
    report.baselines = {};
    for (const [bl, data] of Object.entries(allBaselineResults)) {
      report.baselines[bl] = data.metrics;
    }

    const { timestampedFile, baselineFile } = saveResults('pattern-benchmark', report, resultsDir);
    console.log(`\n  Results saved to: ${timestampedFile}`);

    if (opts.saveBaselineFlag) {
      const blFile = saveBaseline('pattern-benchmark', report, resultsDir);
      console.log(`  Baseline updated: ${blFile}`);
    }
  }

  // Cleanup
  try { search.close?.(); } catch {}
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(`\nFatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
