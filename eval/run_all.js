#!/usr/bin/env node

/**
 * Unified Benchmark Runner for Sweet Search
 *
 * Orchestrates running any/all registered benchmarks through a single entry point.
 * Uses shared modules from eval/lib/ and benchmark adapters from eval/benchmarks/.
 *
 * Usage:
 *   node eval/run_all.js                          # Run all available benchmarks
 *   node eval/run_all.js --benchmarks=codesearchnet,cosqa
 *   node eval/run_all.js --list                   # List registered benchmarks
 *   node eval/run_all.js --max-queries=100 -v     # Limit queries, verbose
 */

import path from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { prepareCorpus } from './lib/corpus.js';
import { indexCorpus, initSearch } from './lib/indexer.js';
import { runQuery, evaluateQuery } from './lib/evaluator.js';
import { computeMetrics, computePerLanguageMetrics } from './lib/metrics.js';
import { printReport, printCombinedReport } from './lib/reporter.js';
import { saveResults, saveBaseline, buildReport } from './lib/results.js';
import { RetrievalHarness } from './retrieval-harness.js';
import { BenchmarkRegistry } from './benchmarks/registry.js';

// Import all benchmarks to trigger registration
import './benchmarks/codesearchnet.js';
import './benchmarks/cosqa.js';
import './benchmarks/advtest.js';
import './benchmarks/coir.js';
import './benchmarks/coquir.js';
import './benchmarks/gencodesearchnet.js';
import './benchmarks/crosscodeeval.js';
import './benchmarks/clarc.js';
import './benchmarks/m2crb.js';
import './benchmarks/cosqaplus.js';
import './benchmarks/coreb.js';
import './benchmarks/bright-code.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const EVAL_DIR = __dirname;

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    benchmarks: 'available', maxQueries: 0, mode: 'auto', skipIndex: false,
    verbose: false, concurrency: 5, k: 20, list: false, help: false,
    profile: 'balanced',
    useLateInteraction: null,      // null = use profile default
    buildLateInteraction: null,    // null = use profile default
    lateInteractionModel: null,    // null = use config.js default (lateon-code)
    requireNativeAnn: false,
    indexMode: 'single',
    sqliteFast: false,
    sqliteSafe: false,
    regressionCheck: false,
    saveBaseline: false,
    regressionThreshold: -0.02,
    expand: true,
  };
  for (const arg of args) {
    if (arg.startsWith('--benchmarks=')) opts.benchmarks = arg.split('=')[1];
    else if (arg.startsWith('--max-queries=')) opts.maxQueries = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--mode=')) opts.mode = arg.split('=')[1];
    else if (arg === '--skip-index') opts.skipIndex = true;
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg.startsWith('--concurrency=')) opts.concurrency = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--k=')) opts.k = parseInt(arg.split('=')[1], 10);
    else if (arg === '--list') opts.list = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--profile=')) opts.profile = arg.split('=')[1];
    else if (arg.startsWith('--use-late-interaction=')) opts.useLateInteraction = arg.split('=')[1] === 'true';
    else if (arg.startsWith('--build-late-interaction=')) opts.buildLateInteraction = arg.split('=')[1] === 'true';
    else if (arg.startsWith('--late-interaction-model=')) opts.lateInteractionModel = arg.split('=')[1];
    else if (arg === '--require-native-ann') opts.requireNativeAnn = true;
    else if (arg.startsWith('--index-mode=')) opts.indexMode = arg.split('=')[1];
    else if (arg === '--sqlite-fast') opts.sqliteFast = true;
    else if (arg === '--sqlite-safe') opts.sqliteSafe = true;
    else if (arg === '--regression-check') opts.regressionCheck = true;
    else if (arg === '--save-baseline') opts.saveBaseline = true;
    else if (arg.startsWith('--regression-threshold=')) opts.regressionThreshold = parseFloat(arg.split('=')[1]);
    else if (arg === '--no-expand') opts.expand = false;
  }
  return opts;
}

/**
 * Resolve profile defaults with CLI overrides.
 */
function resolveProfile(opts) {
  const profiles = {
    fast: { buildLateInteraction: false, useLateInteraction: false, lateInteractionModel: null, sqliteFast: true, indexMode: 'single' },
    balanced: { buildLateInteraction: false, useLateInteraction: false, lateInteractionModel: null, sqliteFast: true, indexMode: 'single' },
    full: { buildLateInteraction: true, useLateInteraction: true, lateInteractionModel: null, sqliteFast: true, indexMode: 'single' },
  };

  const profile = profiles[opts.profile] || profiles.balanced;

  return {
    buildLateInteraction: opts.buildLateInteraction ?? profile.buildLateInteraction,
    useLateInteraction: opts.useLateInteraction ?? profile.useLateInteraction,
    lateInteractionModel: opts.lateInteractionModel || profile.lateInteractionModel,
    sqliteFast: opts.sqliteSafe ? false : (opts.sqliteFast || profile.sqliteFast),
    indexMode: opts.indexMode || profile.indexMode,
    requireNativeAnn: opts.requireNativeAnn,
  };
}

function printHelp() {
  console.log(`
Sweet Search - Unified Benchmark Runner

Usage: node eval/run_all.js [options]

Options:
  --benchmarks=LIST   Comma-separated names, "all", or "available" [default: available]
  --max-queries=N     Limit queries per benchmark (0 = all) [default: 0]
  --mode=MODE         Force search mode (auto|lexical|semantic|hybrid) [default: auto]
  --skip-index        Skip corpus indexing (reuse existing index)
  --verbose, -v       Show per-query details
  --concurrency=N     Parallel query execution [default: 5]
  --k=N               Top-k results [default: 20]
  --list              List all registered benchmarks and exit
  --profile=PROFILE   Benchmark profile (fast|balanced|full) [default: balanced]
  --use-late-interaction=BOOL  Override late-interaction usage for queries [default: profile]
  --build-late-interaction=BOOL Override late-interaction index building [default: profile]
  --late-interaction-model=ID  Late-interaction model variant (lateon-code, lateon-code-edge) [default: config]
  --require-native-ann  Fail if native ANN backend (usearch) is unavailable
  --index-mode=MODE   Indexing mode (single|two-phase) [default: single]
  --sqlite-fast       Enable fast SQLite pragmas for benchmarking
  --sqlite-safe       Force durable SQLite mode (disables fast pragmas)
  --regression-check  Compare results against baseline after each benchmark (exit 1 if regression)
  --save-baseline     Save current run as the new baseline for future comparisons
  --regression-threshold=N  Max allowed regression (default: -0.02 = 2%)
  --no-expand         Disable graph expansion during search
  --help, -h          Show help`);
}

function printBenchmarkList() {
  const all = BenchmarkRegistry.getAll();
  console.log(`\nRegistered benchmarks (${all.length}):\n`);
  for (const b of all) {
    const tag = b.hasData(EVAL_DIR) ? '[DATA OK]' : '[NO DATA]';
    console.log(`  ${tag} ${b.name.padEnd(20)} ${b.description}`);
    console.log(`${''.padEnd(30)} Languages: ${b.languages.join(', ')}`);
    if (!b.hasData(EVAL_DIR) && b.downloadCmd) {
      console.log(`${''.padEnd(30)} Download:  ${b.downloadCmd}`);
    }
  }
}

// ─── Benchmark Resolution ────────────────────────────────────────────────────

function resolveBenchmarks(selection) {
  if (selection === 'all') return BenchmarkRegistry.getAll();
  if (selection === 'available') return BenchmarkRegistry.getAvailable(EVAL_DIR);

  const names = selection.split(',').map(s => s.trim()).filter(Boolean);
  const resolved = [];
  for (const name of names) {
    const b = BenchmarkRegistry.get(name);
    if (!b) {
      console.error(`  Unknown benchmark: "${name}". Use --list to see available benchmarks.`);
      process.exit(1);
    }
    resolved.push(b);
  }
  return resolved;
}

// ─── Run a Single Benchmark ──────────────────────────────────────────────────

async function runBenchmark(benchmark, opts, profileOpts) {
  const benchStart = Date.now();
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Benchmark: ${benchmark.name} - ${benchmark.description}`);
  console.log(`  Languages: ${benchmark.languages.join(', ')}`);
  console.log('='.repeat(70));

  // 1. Check data availability
  if (!benchmark.hasData(EVAL_DIR)) {
    console.log(`\n  Data not found for "${benchmark.name}".`);
    if (benchmark.downloadCmd) console.log(`  Download with: ${benchmark.downloadCmd}`);
    return null;
  }

  // 2. Load data
  console.log('\n  [1/5] Loading data...');
  const { corpus, queries: allQueries } = benchmark.loadData(EVAL_DIR);
  const queries = opts.maxQueries > 0 ? allQueries.slice(0, opts.maxQueries) : allQueries;
  console.log(`  Corpus: ${corpus.length} docs, Queries: ${queries.length}` +
    (opts.maxQueries > 0 ? ` (limited from ${allQueries.length})` : ''));

  // 3. Prepare corpus files
  const corpusDir = path.join(EVAL_DIR, 'corpus', benchmark.name);
  const hasIndex = existsSync(path.join(corpusDir, '.sweet-search'));
  let docIdToFile;
  if (opts.skipIndex && hasIndex) {
    console.log('\n  [2/5] Reusing existing corpus files (--skip-index)');
    docIdToFile = prepareCorpus(corpus, corpusDir, { skipClean: true });
  } else {
    console.log('\n  [2/5] Preparing corpus files...');
    docIdToFile = prepareCorpus(corpus, corpusDir);
  }

  // 4. Index if needed
  let indexResult;
  if (!opts.skipIndex) {
    console.log('\n  [3/5] Indexing corpus...');
    try {
      indexResult = await indexCorpus(corpusDir, PROJECT_ROOT, {
        indexMode: profileOpts.indexMode,
        buildLateInteraction: profileOpts.buildLateInteraction,
        lateInteractionModel: profileOpts.lateInteractionModel,
        sqliteFastMode: profileOpts.sqliteFast,
        requireNativeAnn: profileOpts.requireNativeAnn,
        verbose: opts.verbose,
      });
    } catch (err) {
      console.error(`  Indexing failed: ${err.message}`);
      return null;
    }
  } else {
    console.log('\n  [3/5] Skipping indexing (--skip-index)');
  }

  // 5. Initialize search and run queries
  console.log('\n  [4/5] Running queries...');
  let search;
  try {
    search = await initSearch(corpusDir, PROJECT_ROOT, { useLateInteraction: profileOpts.useLateInteraction, lateInteractionModel: profileOpts.lateInteractionModel });
  } catch (err) {
    console.error(`  Failed to initialize search: ${err.message}`);
    return null;
  }

  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(opts.concurrency);
  const evaluatedQueries = [];
  let completed = 0;
  const errors = [];
  const total = queries.length;

  const tasks = queries.map((queryObj) =>
    limit(async () => {
      try {
        const cleaned = benchmark.cleanQuery(queryObj.query) || queryObj.query;
        const { results, latencyMs, mode } = await runQuery(search, cleaned, {
          k: opts.k, mode: opts.mode, expand: opts.expand,
        });
        const evaluated = evaluateQuery(queryObj, results, docIdToFile);
        evaluated.latencyMs = latencyMs;
        evaluated.searchMode = mode;
        evaluatedQueries.push(evaluated);
        completed++;
        if (completed % 50 === 0 || completed === total) {
          process.stdout.write(`\r  Progress: ${completed}/${total} queries`);
        }
        if (opts.verbose && evaluated.rankedRelevance[0] !== 1) {
          console.log(`\n    MISS: "${queryObj.query.slice(0, 60)}..." -> top: ${results[0]?.name || results[0]?.file || 'none'}`);
        }
      } catch (err) {
        errors.push({ queryId: queryObj.query_id, error: err.message });
        completed++;
      }
    })
  );

  await Promise.all(tasks);
  console.log(); // newline after progress

  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length} queries failed`);
    if (opts.verbose) {
      for (const err of errors.slice(0, 5)) console.log(`    ${err.queryId}: ${err.error}`);
    }
  }

  // 6. Compute metrics, report, and save
  console.log('\n  [5/5] Computing metrics...');
  const metrics = computeMetrics(evaluatedQueries);
  const perLanguage = computePerLanguageMetrics(evaluatedQueries);
  const totalTime = Date.now() - benchStart;

  printReport(benchmark.name, metrics, perLanguage, totalTime, queries.length);

  const report = buildReport({
    dataset: benchmark.name, queryCount: queries.length, corpusSize: corpus.length,
    searchMode: opts.mode, totalTimeMs: totalTime, errorCount: errors.length,
    indexTimings: indexResult?.timings || null,
    metrics, perLanguage, evaluatedQueries,
  });
  const resultsDir = path.join(EVAL_DIR, 'results');
  const { timestampedFile } = saveResults(benchmark.name, report, resultsDir);
  console.log(`  Results saved to: ${timestampedFile}`);

  // Save as baseline if requested
  if (opts.saveBaseline) {
    const baselinePath = saveBaseline(benchmark.name, report, resultsDir);
    console.log(`  Baseline saved to: ${baselinePath}`);
  }

  // Regression check against existing baseline
  let regressionPassed = true;
  if (opts.regressionCheck) {
    const threshold = opts.regressionThreshold ?? -0.02;
    const harness = new RetrievalHarness({
      resultsDir,
      baselineFile: path.join(resultsDir, `${benchmark.name}_baseline.json`),
      deltaThresholds: {
        'recall@5': threshold,
        'recall@10': threshold,
        'recall@20': threshold,
        'mrr': threshold,
      },
    });
    const normalized = await harness.importBenchmarkResult(timestampedFile);
    const comparison = await harness.compareToBaseline(normalized);
    const regressionReport = harness.formatReport(normalized, comparison);
    console.log('\n' + regressionReport);

    if (comparison.hasBaseline && !comparison.passed) {
      regressionPassed = false;
      console.log('\n  ⚠ REGRESSION DETECTED — results are worse than baseline');
    } else if (!comparison.hasBaseline) {
      console.log('\n  No baseline found. Use --save-baseline to create one.');
    } else {
      console.log('\n  ✓ No regression — results meet baseline thresholds');
    }
  }

  try { await search.close?.(); } catch {}
  return {
    dataset: benchmark.name, metrics, perLanguage, totalTime,
    queryCount: queries.length, indexTimings: indexResult?.timings || null,
    regressionPassed,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.help) { printHelp(); process.exit(0); }
  if (opts.list) { printBenchmarkList(); process.exit(0); }

  const benchmarks = resolveBenchmarks(opts.benchmarks);
  if (benchmarks.length === 0) {
    console.error('\n  No benchmarks to run. Use --list to see registered benchmarks.');
    console.error('  Download data first, or use --benchmarks=all to see download instructions.');
    process.exit(2);
  }

  const runStart = Date.now();
  console.log('='.repeat(70));
  console.log('  Sweet Search - Unified Benchmark Runner');
  console.log('='.repeat(70));
  console.log(`  Benchmarks:  ${benchmarks.map(b => b.name).join(', ')}`);
  console.log(`  Max queries: ${opts.maxQueries || 'all'}`);
  console.log(`  Search mode: ${opts.mode}  |  Concurrency: ${opts.concurrency}  |  Top-k: ${opts.k}`);
  console.log(`  Skip index:  ${opts.skipIndex}`);
  const profileOpts = resolveProfile(opts);
  console.log(`  Profile:     ${opts.profile} (late-interaction build: ${profileOpts.buildLateInteraction}, query: ${profileOpts.useLateInteraction}, model: ${profileOpts.lateInteractionModel || 'default'})`);
  console.log(`  Index mode:  ${profileOpts.indexMode}  |  SQLite fast: ${profileOpts.sqliteFast}  |  Expand: ${opts.expand}`);
  if (opts.regressionCheck) console.log(`  Regression:  check enabled (threshold: ${opts.regressionThreshold})`);
  if (opts.saveBaseline) console.log(`  Baseline:    will save after each benchmark`);

  // Run each benchmark sequentially (each needs its own index/search instance)
  const allResults = [];
  for (const benchmark of benchmarks) {
    const result = await runBenchmark(benchmark, opts, profileOpts);
    if (result) allResults.push(result);
  }

  // Combined report across all benchmarks
  if (allResults.length > 1) printCombinedReport(allResults);

  if (allResults.length > 0) {
    const resultsDir = path.join(EVAL_DIR, 'results');
    if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const combinedFile = path.join(resultsDir, `all_benchmarks_${timestamp}.json`);
    writeFileSync(combinedFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      totalTimeMs: Date.now() - runStart,
      benchmarkCount: allResults.length,
      profile: opts.profile, profileOpts,
      benchmarks: allResults.map(r => ({
        dataset: r.dataset, queryCount: r.queryCount,
        totalTimeMs: r.totalTime,
        indexTimings: r.indexTimings || null,
        metrics: r.metrics,
        perLanguage: r.perLanguage,
      })),
    }, null, 2));
    console.log(`\n  Combined results saved to: ${combinedFile}`);
  }

  const totalElapsed = ((Date.now() - runStart) / 1000).toFixed(1);
  console.log(`\n  Total elapsed: ${totalElapsed}s  |  Benchmarks run: ${allResults.length}/${benchmarks.length}`);

  // Exit 1 if any benchmark failed regression check
  if (opts.regressionCheck && allResults.some(r => r.regressionPassed === false)) {
    console.log('\n  EXIT 1: One or more benchmarks regressed beyond threshold.');
    process.exit(1);
  }
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(`\nFatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

export { resolveProfile };
