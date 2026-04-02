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
 *   node eval/run_pattern_benchmark.js --split=dev
 *   node eval/run_pattern_benchmark.js --split=test
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
  classifyFailure,
  computePerSliceMetrics,
  computeDiagnostics,
  printDiagnostics,
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
    split: 'all',
    compareBaseline: false,
    noLiteralFilter: false,
    noGramIndex: false,
    deprecatedNoIndexedScope: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--max-queries=')) opts.maxQueries = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--k=')) opts.k = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--concurrency=')) opts.concurrency = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--baselines=')) opts.baselines = arg.split('=')[1].split(',');
    else if (arg.startsWith('--split=')) opts.split = arg.split('=')[1];
    else if (arg === '--skip-baselines') opts.skipBaselines = true;
    else if (arg === '--save-baseline') opts.saveBaselineFlag = true;
    else if (arg === '--compare-baseline') opts.compareBaseline = true;
    else if (arg === '--no-indexed-scope') opts.deprecatedNoIndexedScope = true;
    else if (arg === '--no-literal-filter') opts.noLiteralFilter = true;
    else if (arg === '--no-gram-index') opts.noGramIndex = true;
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
  --split=SPLIT         Query split to use: all|dev|test [default: all]
  --skip-baselines      Only run pattern-maxsim (treatment), skip comparison baselines
  --save-baseline       Save results as new baseline for regression checks
  --compare-baseline    Run current pattern pipeline and a full-scan baseline side-by-side
  --no-indexed-scope    Deprecated no-op; scoped file search was removed
  --no-literal-filter   Disable literal prefilter for pattern-maxsim
  --no-gram-index       Disable Phase 4 gram index hook (placeholder until Phase 4 lands)
  --verbose, -v         Show per-query details
  --help, -h            Show this help

Baselines:
  rg-only           Pure ripgrep (recall ceiling, no ranking)
  hybrid-no-regex   Sweet Search hybrid mode (BM25 + semantic, no regex)
  pattern-maxsim    ColGrep pattern mode (regex candidates + MaxSim ranking)

Splits:
  all   All 60 queries (default, backward compatible)
  dev   40 dev queries — for parameter tuning
  test  20 test queries — for reporting only, do not tune on these
`);
      process.exit(0);
    }
  }

  if (!['all', 'dev', 'test'].includes(opts.split)) {
    console.error(`  Invalid --split value: "${opts.split}". Must be all|dev|test.`);
    process.exit(1);
  }
  if (opts.skipBaselines) opts.baselines = ['pattern-maxsim'];
  if (opts.compareBaseline && opts.baselines.includes('pattern-maxsim') && !opts.baselines.includes('pattern-maxsim-baseline')) {
    opts.baselines.push('pattern-maxsim-baseline');
  }
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
  console.log(`  Split:       ${opts.split}`);
  console.log(`  Max queries: ${opts.maxQueries || 'all'}`);
  console.log(`  Top-k:       ${opts.k}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  console.log('  Scoped file search: removed');
  console.log(`  Literal prefilter: ${opts.noLiteralFilter ? 'disabled' : 'enabled'}`);
  if (opts.deprecatedNoIndexedScope) {
    console.log('  Note:        --no-indexed-scope is deprecated and now ignored');
  }

  // 1. Load benchmark queries
  const queriesFile = path.join(__dirname, 'data', 'pattern-benchmark', 'queries.jsonl');
  if (!existsSync(queriesFile)) {
    console.error(`\n  Benchmark queries not found: ${queriesFile}`);
    process.exit(2);
  }

  let queries = loadJsonl(queriesFile);
  if (opts.split !== 'all') {
    queries = queries.filter(q => q.split === opts.split);
  }
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
    console.error('    node core/indexing/index-codebase-v21.js');
    process.exit(2);
  }

  // 3. Initialize Sweet Search
  console.log('\n[1/3] Initializing Sweet Search...');

  // Set project root so search operates on the correct codebase
  process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

  const { default: SweetSearch } = await import(path.join(PROJECT_ROOT, 'core', 'search', 'sweet-search.js'));
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
          result = await runPatternQuery(search, queryObj, {
            k: opts.k,
            searchOptions: {
              literalFilter: !opts.noLiteralFilter,
              gramIndex: !opts.noGramIndex,
            },
          });
        } else if (baseline === 'pattern-maxsim-baseline') {
          result = await runPatternQuery(search, queryObj, {
            k: opts.k,
            searchOptions: {
              literalFilter: false,
              gramIndex: false,
            },
          });
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
            candidateGenTime_ms: result.stats.candidateGenTime_ms,
            grepTime_ms: result.stats.grepTime_ms,
            literalFilterTime_ms: result.stats.literalFilterTime_ms,
            gramLookupTime_ms: result.stats.gramLookupTime_ms,
            encodeTime_ms: result.stats.encodeTime_ms,
            maxSimCandidates: result.stats.maxSimCandidates,
            filesConsidered: result.stats.filesConsidered,
            filesScanned: result.stats.filesScanned,
            filesSkipped: result.stats.filesSkipped,
            dirtyOverlayFiles: result.stats.dirtyOverlayFiles,
            candidateFilesBeforeFilter: result.stats.candidateFilesBeforeFilter,
            candidateFilesAfterFilter: result.stats.candidateFilesAfterFilter,
            candidateReductionRatio: result.stats.candidateReductionRatio,
            literalExtractionHit: result.stats.literalExtractionHit,
            literalExtractionSource: result.stats.literalExtractionSource,
            gramLookupReason: result.stats.gramLookupReason,
            denseGramsTouched: result.stats.denseGramsTouched,
            sparseGramsTouched: result.stats.sparseGramsTouched,
            gramFalsePositiveRatio: result.stats.gramFalsePositiveRatio,
            prefilterDiscarded: result.stats.prefilterDiscarded,
            prefilterDiscardedCount: result.stats.prefilterDiscardedCount,
            grepStrategy: result.stats.grepStrategy,
            mapTime_ms: result.stats.mapTime_ms,
            parallelTime_ms: result.stats.parallelTime_ms,
            rerankTime_ms: result.stats.rerankTime_ms,
          };
        }

        // Classify failure mode for pattern-maxsim pipeline diagnostics
        if (baseline === 'pattern-maxsim' || baseline === 'pattern-maxsim-baseline') {
          const goldIds = new Set(getRelevantChunkIds(queryObj));
          evaluated._failureMode = classifyFailure(evaluated, result.stats, goldIds);
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
    if (baseline === 'pattern-maxsim' || baseline === 'pattern-maxsim-baseline') {
      const diagForMetric = computeDiagnostics(data.evaluatedQueries);
      const candRecall = diagForMetric.total > 0
        ? ((diagForMetric.hit + diagForMetric.rerank_miss) / diagForMetric.total * 100).toFixed(2)
        : '0.00';
      console.log(`  Candidate recall: ${candRecall}%`);
    }
    console.log('  ' + '-'.repeat(50));
    console.log(`  Latency p50: ${m.latency_p50_ms.toFixed(1)}ms`);
    console.log(`  Latency p95: ${m.latency_p95_ms.toFixed(1)}ms`);
    console.log(`  Latency avg: ${m.latency_mean_ms.toFixed(1)}ms`);

    // Per-slice breakdown for pattern mode
    if (baseline === 'pattern-maxsim' || baseline === 'pattern-maxsim-baseline') {
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
        const ratio = (arr, key) => arr.reduce((s, q) => s + (q.patternStats[key] ? 1 : 0), 0) / arr.length;
        console.log(`  Candidate generation: ${avg(withStats, 'candidateGenTime_ms').toFixed(1)}ms avg`);
        console.log(`  Regex verify:         ${avg(withStats, 'grepTime_ms').toFixed(1)}ms avg`);
        console.log(`  Literal prefilter:    ${avg(withStats, 'literalFilterTime_ms').toFixed(1)}ms avg`);
        console.log(`  Gram lookup:          ${avg(withStats, 'gramLookupTime_ms').toFixed(1)}ms avg`);
        console.log(`  Query encode:         ${avg(withStats, 'encodeTime_ms').toFixed(1)}ms avg`);
        console.log(`  Chunk location map:  ${avg(withStats, 'mapTime_ms').toFixed(1)}ms avg`);
        console.log(`  Parallel (grep+enc): ${avg(withStats, 'parallelTime_ms').toFixed(1)}ms avg`);
        console.log(`  MaxSim rerank:       ${avg(withStats, 'rerankTime_ms').toFixed(1)}ms avg`);
        console.log(`  Files considered:    ${avg(withStats, 'filesConsidered').toFixed(0)} avg`);
        console.log(`  Files scanned:       ${avg(withStats, 'filesScanned').toFixed(0)} avg`);
        console.log(`  Files skipped:       ${avg(withStats, 'filesSkipped').toFixed(0)} avg`);
        console.log(`  Dirty overlay files: ${avg(withStats, 'dirtyOverlayFiles').toFixed(0)} avg`);
        console.log(`  Cand files pre/post: ${avg(withStats, 'candidateFilesBeforeFilter').toFixed(0)}/${avg(withStats, 'candidateFilesAfterFilter').toFixed(0)} avg`);
        console.log(`  Candidate reduction: ${(avg(withStats, 'candidateReductionRatio') * 100).toFixed(1)}% avg`);
        console.log(`  Literal hit rate:    ${(ratio(withStats, 'literalExtractionHit') * 100).toFixed(1)}%`);
        console.log(`  Grep matches:        ${avg(withStats, 'grepMatches').toFixed(0)} avg`);
        console.log(`  Indexed chunks:      ${avg(withStats, 'indexedChunks').toFixed(0)} avg`);
        console.log(`  MaxSim candidates:   ${avg(withStats, 'maxSimCandidates').toFixed(0)} avg`);
      }

      // Pipeline diagnostics: where do failures happen?
      printDiagnostics(computeDiagnostics(data.evaluatedQueries));

      // Per-family failure mode breakdown
      console.log('\n  ── Per-Family Failure Modes ──');
      console.log('  ' + '-'.repeat(62));
      console.log('  ' + 'Family'.padEnd(14) + 'Hit'.padStart(6) + 'Rerank'.padStart(8) + 'Map'.padStart(6) + 'Regex'.padStart(7) + '  CandRecall');
      console.log('  ' + '-'.repeat(62));
      const byFamily = {};
      for (const eq of data.evaluatedQueries) {
        const fam = eq.regexFamily || 'unknown';
        if (!byFamily[fam]) byFamily[fam] = { hit: 0, rerank_miss: 0, mapping_miss: 0, regex_miss: 0, total: 0 };
        byFamily[fam][eq._failureMode || 'hit']++;
        byFamily[fam].total++;
      }
      for (const [fam, c] of Object.entries(byFamily)) {
        const cr = ((c.hit + c.rerank_miss) / c.total * 100).toFixed(0);
        console.log('  ' +
          fam.padEnd(14) +
          String(c.hit).padStart(6) +
          String(c.rerank_miss).padStart(8) +
          String(c.mapping_miss).padStart(6) +
          String(c.regex_miss).padStart(7) +
          `  ${cr}%`.padStart(12)
        );
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
  if (allBaselineResults['pattern-maxsim'] && allBaselineResults['pattern-maxsim-baseline']) {
    const winRate = computeWinRate(
      allBaselineResults['pattern-maxsim'].evaluatedQueries,
      allBaselineResults['pattern-maxsim-baseline'].evaluatedQueries,
    );
    printWinRate('Pattern current vs full-scan baseline', winRate);
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

    // Diagnostic fields for post-hoc analysis
    report.diagnostics = computeDiagnostics(patternResults.evaluatedQueries);
    report.perQueryDiagnostics = patternResults.evaluatedQueries.map(eq => ({
      queryId: eq.queryId,
      failureMode: eq._failureMode || 'unknown',
      reciprocalRank: eq.rankedRelevance.indexOf(1) >= 0 ? 1 / (eq.rankedRelevance.indexOf(1) + 1) : 0,
    }));

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
