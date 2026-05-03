#!/usr/bin/env node

/**
 * Sweet Search Benchmark Runner
 *
 * Evaluates Sweet Search against standard code retrieval benchmarks:
 * - CodeSearchNet (Python, JavaScript, Go) - NL docstring → code function retrieval
 * - CosQA (optional) - Web queries → Python code retrieval
 *
 * Flow:
 * 1. Read JSONL data from eval/data/{dataset}/
 * 2. Write code functions as files in eval/corpus/{dataset}/
 * 3. Index the corpus with Sweet Search
 * 4. Query with Sweet Search, collect ranked results
 * 5. Compute IR metrics (Recall@5, Recall@20, MRR@10, NDCG@10)
 * 6. Save results to eval/results/
 *
 * Usage:
 *   node eval/run_benchmark.js                        # Run all datasets
 *   node eval/run_benchmark.js --dataset codesearchnet # Specific dataset
 *   node eval/run_benchmark.js --max-queries 100       # Limit queries
 *   node eval/run_benchmark.js --mode semantic         # Force search mode
 *   node eval/run_benchmark.js --skip-index            # Skip indexing (reuse existing)
 */

import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { loadJsonl } from './lib/data-loader.js';
import { computeMetrics, computePerLanguageMetrics } from './lib/metrics.js';
import { prepareCorpus } from './lib/corpus.js';
import { indexCorpus, initSearch } from './lib/indexer.js';
import { runQuery, evaluateQuery, cleanQueryText } from './lib/evaluator.js';
import { printReport } from './lib/reporter.js';
import { saveResults, buildReport } from './lib/results.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dataset: 'codesearchnet',
    maxQueries: 0,          // 0 = all
    mode: 'auto',           // auto, lexical, semantic, hybrid
    skipIndex: false,
    k: 20,                  // top-k results to retrieve
    verbose: false,
    concurrency: 5,
    profile: 'full',
    useLateInteraction: null,      // null = use profile default
    buildLateInteraction: null,    // null = use profile default
    lateInteractionModel: null,    // null = use config.js default (lateon-code)
    requireNativeAnn: false,
    indexMode: 'single',
    sqliteFast: false,
    sqliteSafe: false,
    // Graph expansion default OFF for this harness. Most retrieval benchmarks
    // (CodeSearchNet, CosQA, AdvTest, GenCodeSearchNet) are single-function /
    // single-file lookups that do not exercise cross-file graph structure;
    // letting expansion fire on them obscures the dense/LI signal we are
    // trying to measure. Production sweet-search keeps graphExpand auto-
    // promotion ON for real searches — only this benchmark wrapper opts out.
    // Pass --graph-expand=auto to restore auto-promotion ('2hop'), or
    // --graph-expand=1hop / --graph-expand=2hop to force a specific mode.
    graphExpand: 'none',
    // Stage 3 (CE rerank + legacy LI rerank) candidate window. Production
    // default in core/infrastructure/config/vector-store.js is 30, calibrated
    // on the real-codebase graph benchmark. For dense single-function
    // retrieval (GCSN, AdvTest, CodeSearchNet, CosQA) this harness defaults
    // to 15 — that is the headline-MRR sweet spot on the 2026-05-03
    // GCSN dense sweep (MRR@10 85.61 % vs 85.35 % at s3=30, p50 244 vs 252 ms).
    // Pass --stage3-candidates=N to override.
    stage3Candidates: 15,
  };

  for (const arg of args) {
    if (arg.startsWith('--dataset=')) opts.dataset = arg.split('=')[1];
    else if (arg.startsWith('--max-queries=')) opts.maxQueries = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--mode=')) opts.mode = arg.split('=')[1];
    else if (arg === '--skip-index') opts.skipIndex = true;
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg.startsWith('--concurrency=')) opts.concurrency = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--profile=')) opts.profile = arg.split('=')[1];
    else if (arg.startsWith('--use-late-interaction=')) opts.useLateInteraction = arg.split('=')[1] === 'true';
    else if (arg.startsWith('--build-late-interaction=')) opts.buildLateInteraction = arg.split('=')[1] === 'true';
    else if (arg.startsWith('--late-interaction-model=')) opts.lateInteractionModel = arg.split('=')[1];
    else if (arg === '--require-native-ann') opts.requireNativeAnn = true;
    else if (arg.startsWith('--index-mode=')) opts.indexMode = arg.split('=')[1];
    else if (arg === '--sqlite-fast') opts.sqliteFast = true;
    else if (arg === '--sqlite-safe') opts.sqliteSafe = true;
    else if (arg.startsWith('--graph-expand=')) opts.graphExpand = arg.split('=')[1];
    else if (arg.startsWith('--stage3-candidates=')) opts.stage3Candidates = parseInt(arg.split('=')[1]);
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Sweet Search Benchmark Runner

Usage: node eval/run_benchmark.js [options]

Options:
  --dataset=NAME       Dataset to evaluate (codesearchnet, cosqa) [default: codesearchnet]
  --max-queries=N      Limit number of queries (0 = all) [default: 0]
  --mode=MODE          Force search mode (auto, lexical, semantic, hybrid) [default: auto]
  --skip-index         Skip corpus indexing (reuse existing index)
  --verbose, -v        Show per-query details
  --concurrency=N      Parallel query execution [default: 5]
  --profile=PROFILE    Benchmark profile (fast|balanced|full) [default: full]
  --use-late-interaction=BOOL   Override late interaction usage for queries [default: profile]
  --build-late-interaction=BOOL Override late interaction index building [default: profile]
  --late-interaction-model=ID   Late interaction model variant (lateon-code, lateon-code-edge) [default: config]
  --require-native-ann Fail if native ANN backend (usearch) is unavailable
  --index-mode=MODE    Indexing mode (single|two-phase) [default: single]
  --sqlite-fast        Enable fast SQLite pragmas for benchmarking
  --sqlite-safe        Force durable SQLite mode (disables fast pragmas)
  --graph-expand=MODE  Graph expansion: none|auto|1hop|2hop [default: none]
                       (CodeSearchNet-style benchmarks default off because
                       single-function gold answers do not exercise graph
                       structure; pass --graph-expand=auto to match
                       production sweet-search behaviour.)
  --stage3-candidates=N  CE rerank + LI rerank window [default: 15]
                       (15 is the headline-MRR sweet spot for dense GCSN-style
                       single-function retrieval; production sweet-search
                       default is 30, calibrated on the real-codebase
                       graph benchmark. Set --stage3-candidates=30 to match
                       production exactly.)
  --help, -h           Show this help
`);
      process.exit(0);
    }
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

  const profile = profiles[opts.profile] || profiles.full;

  return {
    buildLateInteraction: opts.buildLateInteraction ?? profile.buildLateInteraction,
    useLateInteraction: opts.useLateInteraction ?? profile.useLateInteraction,
    lateInteractionModel: opts.lateInteractionModel || profile.lateInteractionModel,
    sqliteFast: opts.sqliteSafe ? false : (opts.sqliteFast || profile.sqliteFast),
    indexMode: opts.indexMode || profile.indexMode,
    requireNativeAnn: opts.requireNativeAnn,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log('═'.repeat(70));
  console.log('  Sweet Search Benchmark Runner');
  console.log('═'.repeat(70));
  console.log(`  Dataset:     ${opts.dataset}`);
  console.log(`  Max queries: ${opts.maxQueries || 'all'}`);
  console.log(`  Search mode: ${opts.mode}`);
  console.log(`  Skip index:  ${opts.skipIndex}`);
  const profileOpts = resolveProfile(opts);
  console.log(`  Profile:     ${opts.profile}`);
  console.log(`  Index mode:  ${profileOpts.indexMode}  |  SQLite fast: ${profileOpts.sqliteFast}`);
  console.log(`  Graph expand: ${opts.graphExpand}  (production default is auto; this harness defaults off)`);
  console.log(`  Stage3 cand:  ${opts.stage3Candidates}  (production default is 30; this harness defaults to 15 for dense MRR)`);

  // 1. Load data
  const dataDir = path.join(__dirname, 'data', opts.dataset);
  const corpusFile = path.join(dataDir, 'corpus.jsonl');
  const queriesFile = path.join(dataDir, 'queries.jsonl');

  if (!existsSync(corpusFile) || !existsSync(queriesFile)) {
    console.error(`\n  Data not found at ${dataDir}`);
    console.error('  Run first: cd eval && uv run python download_data.py');
    process.exit(2);
  }

  console.log('\n[1/5] Loading benchmark data...');
  const corpus = loadJsonl(corpusFile);
  let queries = loadJsonl(queriesFile);

  if (opts.maxQueries > 0) {
    queries = queries.slice(0, opts.maxQueries);
  }

  console.log(`  Corpus:  ${corpus.length} documents`);
  console.log(`  Queries: ${queries.length}`);

  // 2. Prepare corpus as files
  const corpusDir = path.join(__dirname, 'corpus', opts.dataset);
  let docIdToFile;
  if (opts.skipIndex && existsSync(path.join(corpusDir, '.sweet-search'))) {
    console.log('\n[2/5] Reusing existing corpus files (--skip-index)');
    docIdToFile = prepareCorpus(corpus, corpusDir, { skipClean: true });
  } else {
    console.log('\n[2/5] Preparing corpus files...');
    docIdToFile = prepareCorpus(corpus, corpusDir);
  }

  // 3. Index corpus with Sweet Search
  let indexResult;
  if (!opts.skipIndex) {
    console.log('\n[3/5] Indexing corpus with Sweet Search...');
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
      console.error('  Try running with EMBEDDING_PROVIDER=local or ensure API keys are set');
      process.exit(3);
    }
  } else {
    console.log('\n[3/5] Skipping indexing (--skip-index)');
  }

  // 4. Run queries
  console.log('\n[4/5] Running queries...');
  let search;
  try {
    search = await initSearch(corpusDir, PROJECT_ROOT, {
      useLateInteraction: profileOpts.useLateInteraction,
      lateInteractionModel: profileOpts.lateInteractionModel,
      stage3Candidates: opts.stage3Candidates,
    });
  } catch (err) {
    console.error(`  Failed to initialize search: ${err.message}`);
    process.exit(3);
  }

  // Warm up local reranker ONLY when it's actually enabled. The reranker is
  // OFF by default (proven MRR-neutral + 3× latency on gencodesearchnet);
  // flip LOCAL_RERANKER_CONFIG.useLocalReranker = true or set
  // SWEET_SEARCH_ENABLE_LOCAL_RERANKER=1 to opt in.
  try {
    const { shouldUseLocalReranker } = await import(path.join(PROJECT_ROOT, 'core', 'infrastructure', 'config', 'ranking.js'));
    if (shouldUseLocalReranker()) {
      const { getGlobalLocalReranker } = await import(path.join(PROJECT_ROOT, 'core', 'ranking', 'local-reranker.js'));
      const reranker = getGlobalLocalReranker();
      if (reranker.isAvailable()) {
        console.log('  Warming up local reranker (gte-reranker-modernbert-base INT8)...');
        const warmStart = Date.now();
        await reranker.init();
        await reranker.rerank('warmup query', ['warmup document content for benchmarking'], 1);
        console.log(`  Local reranker warm in ${Date.now() - warmStart}ms`);
      }
    } else {
      console.log('  Local reranker disabled — skipping warmup');
    }
  } catch (err) {
    console.log(`  Local reranker warmup skipped: ${err.message}`);
  }

  const evaluatedQueries = [];
  let completed = 0;
  const errors = [];

  // Run queries with concurrency control
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(opts.concurrency);

  const tasks = queries.map((queryObj) =>
    limit(async () => {
      try {
        const cleanQuery = cleanQueryText(queryObj.query);

        // Map --graph-expand=MODE to (expand, graphExpand) options:
        //   'none'   → expand:false  (suppresses auto-promotion in sweet-search.js)
        //   'auto'   → expand:true   (let sweet-search auto-promote → '2hop')
        //   '1hop'   → expand:true, graphExpand:'1hop'
        //   '2hop'   → expand:true, graphExpand:'2hop'
        const { expand, graphExpand } = (() => {
          switch (opts.graphExpand) {
            case 'auto': return { expand: true };
            case '1hop': return { expand: true, graphExpand: '1hop' };
            case '2hop': return { expand: true, graphExpand: '2hop' };
            case 'none':
            default:     return { expand: false, graphExpand: 'none' };
          }
        })();
        const { results, latencyMs, mode } = await runQuery(search, cleanQuery || queryObj.query, {
          k: opts.k,
          mode: opts.mode,
          expand,
          graphExpand,
        });

        const evaluated = evaluateQuery(queryObj, results, docIdToFile);
        evaluated.latencyMs = latencyMs;
        evaluated.searchMode = mode;
        evaluatedQueries.push(evaluated);

        completed++;
        if (completed % 50 === 0 || completed === queries.length) {
          console.log(`  Progress: ${completed}/${queries.length} queries`);
        }

        if (opts.verbose && evaluated.rankedRelevance[0] !== 1) {
          console.log(`\n    MISS: "${queryObj.query.slice(0, 60)}..." → top: ${results[0]?.name || results[0]?.file || 'none'}`);
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
      for (const err of errors.slice(0, 5)) {
        console.log(`    ${err.queryId}: ${err.error}`);
      }
    }
  }

  // 5. Compute metrics and report
  console.log('\n[5/5] Computing metrics...');
  const metrics = computeMetrics(evaluatedQueries);
  const perLanguage = computePerLanguageMetrics(evaluatedQueries);

  const totalTime = Date.now() - startTime;
  printReport(opts.dataset, metrics, perLanguage, totalTime, queries.length);

  // Save results
  const resultsDir = path.join(__dirname, 'results');
  // Run config snapshot for cross-run comparability — see buildReport docs.
  const { BINARY_HNSW_CONFIG, CASCADE_CONFIG } = await import(path.join(PROJECT_ROOT, 'core', 'infrastructure', 'config', 'index.js'));
  const config = {
    profile: opts.profile,
    k: opts.k,
    useLateInteraction: profileOpts.useLateInteraction,
    buildLateInteraction: profileOpts.buildLateInteraction,
    lateInteractionModel: profileOpts.lateInteractionModel,
    graphExpand: opts.graphExpand,
    stage3Candidates: opts.stage3Candidates,
    stage3CandidatesProductionDefault: BINARY_HNSW_CONFIG.retrieval.stage3Candidates,
    cascadeEnabled: CASCADE_CONFIG.enabled,
    embedTextVariant: process.env.SWEET_SEARCH_EMBED_TEXT_VARIANT || 'current',
    vocabAutoExpand: process.env.SWEET_SEARCH_VOCAB_AUTO_EXPAND !== '0',
    concurrency: opts.concurrency,
    maxQueries: opts.maxQueries || queries.length,
    skipIndex: opts.skipIndex,
  };

  const report = buildReport({
    dataset: opts.dataset,
    queryCount: queries.length,
    corpusSize: corpus.length,
    searchMode: opts.mode,
    totalTimeMs: totalTime,
    errorCount: errors.length,
    indexTimings: indexResult?.timings || null,
    metrics,
    perLanguage,
    evaluatedQueries,
    config,
  });

  const { timestampedFile, baselineFile } = saveResults(opts.dataset, report, resultsDir);
  console.log(`\n  Results saved to: ${timestampedFile}`);
  console.log(`  Baseline saved to: ${baselineFile}`);

  // Cleanup
  try {
    await search.close?.();
  } catch {}

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
