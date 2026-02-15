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

import fs from 'fs/promises';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

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
  };

  for (const arg of args) {
    if (arg.startsWith('--dataset=')) opts.dataset = arg.split('=')[1];
    else if (arg.startsWith('--max-queries=')) opts.maxQueries = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--mode=')) opts.mode = arg.split('=')[1];
    else if (arg === '--skip-index') opts.skipIndex = true;
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg.startsWith('--concurrency=')) opts.concurrency = parseInt(arg.split('=')[1]);
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
  --help, -h           Show this help
`);
      process.exit(0);
    }
  }

  return opts;
}

// ─── Data Loading ────────────────────────────────────────────────────────────

function loadJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// ─── Corpus Preparation ──────────────────────────────────────────────────────

const LANG_EXTENSIONS = {
  python: '.py',
  javascript: '.js',
  go: '.go',
  java: '.java',
  ruby: '.rb',
  php: '.php',
  typescript: '.ts',
  rust: '.rs',
  cpp: '.cpp',
  c: '.c',
};

/**
 * Write corpus documents as real files for Sweet Search to index.
 * Creates one file per code function.
 * If skipClean is true, preserves existing directory (keeps .sweet-search index).
 */
function prepareCorpus(corpus, corpusDir, { skipClean = false } = {}) {
  if (!skipClean) {
    console.log(`  Writing ${corpus.length} files to ${corpusDir}`);

    // Clean existing corpus
    if (existsSync(corpusDir)) {
      rmSync(corpusDir, { recursive: true, force: true });
    }
  } else {
    console.log(`  Building file mapping for ${corpus.length} documents`);
  }

  let written = 0;
  const docIdToFile = new Map();

  for (const doc of corpus) {
    const ext = LANG_EXTENSIONS[doc.language] || '.txt';
    const safeRepo = (doc.repo || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 50);
    const safeName = (doc.func_name || 'func').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80);
    const dirPath = path.join(corpusDir, doc.language || 'unknown', safeRepo);

    const hash = simpleHash(doc.doc_id).toString(16).slice(0, 6);
    const fileName = `${safeName}_${hash}${ext}`;
    const filePath = path.join(dirPath, fileName);

    if (!skipClean) {
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }
      writeFileSync(filePath, doc.code, 'utf-8');
      written++;
    }

    docIdToFile.set(doc.doc_id, filePath);
  }

  console.log(`  ${skipClean ? 'Mapped' : 'Written'}: ${skipClean ? corpus.length : written} files`);
  return docIdToFile;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

// ─── Indexing ────────────────────────────────────────────────────────────────

/**
 * Run Sweet Search indexer on the corpus directory.
 * Sets SWEET_SEARCH_PROJECT_ROOT to the corpus dir.
 */
async function indexCorpus(corpusDir) {
  console.log(`\n  Indexing corpus at ${corpusDir}...`);
  const start = Date.now();

  const indexer = path.join(PROJECT_ROOT, 'core', 'index-codebase-v21.js');
  const indexEnv = {
    ...process.env,
    SWEET_SEARCH_PROJECT_ROOT: corpusDir,
    // Use local embeddings to avoid API costs during benchmarking
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || 'local',
    VOYAGEAI_API_KEY: '',  // Prevent Voyage retries
  };

  // Run in two phases to avoid concurrent ONNX model loading crash
  // (HCGS tries to load a local LLM in parallel with embedding model → ONNX device crash):
  // Phase 1: Code graph only (no HCGS, no vectors)
  // Phase 2: Vectors + HNSW + ColBERT only (no HCGS)
  await runIndexerPhase(indexer, ['--graph-only', '--quiet'], corpusDir, indexEnv, 'graph');

  // Delete merkle state so vectors phase sees all files as new
  const merkleState = path.join(corpusDir, '.sweet-search', 'merkle-state.json');
  try { await fs.unlink(merkleState); } catch {}

  await runIndexerPhase(indexer, ['--vectors-only', '--quiet'], corpusDir, indexEnv, 'vectors');

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Indexing completed in ${elapsed}s`);
}

function runIndexerPhase(indexer, args, corpusDir, env, phaseName) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [indexer, ...args], {
      cwd: corpusDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        console.error(`  Indexer ${phaseName} failed (exit code ${code})`);
        console.error(`  stdout: ${stdout.slice(-500)}`);
        console.error(`  stderr: ${stderr.slice(-500)}`);
        reject(new Error(`Indexer ${phaseName} exited with code ${code}: ${stderr.slice(-200)}`));
      }
    });
  });
}

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * Initialize Sweet Search pointed at the corpus index.
 */
async function initSearch(corpusDir) {
  // Force local embedding provider for benchmarks — avoids Voyage API retries/timeouts
  // when key is missing or invalid. Must match the provider used during indexing.
  process.env.SWEET_SEARCH_PROJECT_ROOT = corpusDir;
  process.env.EMBEDDING_PROVIDER = 'local';

  // We need to clear the module cache for config.js to pick up the new PROJECT_ROOT
  // Since ESM doesn't support cache clearing, we'll use the constructor options directly
  const dataDir = path.join(corpusDir, '.sweet-search');

  const { SweetSearch } = await import(path.join(PROJECT_ROOT, 'core', 'sweet-search.js'));

  const search = new SweetSearch({
    graphDbPath: path.join(dataDir, 'code-graph.db'),
    hnswPath: path.join(dataDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(dataDir, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(dataDir, 'codebase.db'),
    useColBERT: true,
    verbose: false,
    timing: false,
  });

  await search.init();
  return search;
}

/**
 * Run a single query against Sweet Search, return ranked file paths.
 */
async function runQuery(search, query, options = {}) {
  const { k = 20, mode = 'auto' } = options;

  const start = performance.now();
  const { results, stats } = await search.search(query, { k, mode, rerank: true });
  const latencyMs = performance.now() - start;

  return {
    results: results.map(r => ({
      file: r.file || r.metadata?.file || r.filePath || r.path || '',
      name: r.name || r.metadata?.name || r.entityName || '',
      score: r.score || 0,
      type: r.type || r.metadata?.type || '',
    })),
    latencyMs,
    mode: stats?.routing?.mode || mode,
  };
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Compute standard IR metrics from query results.
 *
 * For each query:
 * - relevant = 1 if the result file matches any ground truth file path
 *
 * Metrics: Recall@5, Recall@20, MRR@10, NDCG@10, MAP@10
 */
function computeMetrics(evaluatedQueries) {
  const metrics = {};

  // MRR@10
  metrics.mrr_at_10 = meanMetric(evaluatedQueries, (q) => {
    const topK = q.rankedRelevance.slice(0, 10);
    const firstIdx = topK.indexOf(1);
    return firstIdx >= 0 ? 1 / (firstIdx + 1) : 0;
  });

  // NDCG@10
  metrics.ndcg_at_10 = meanMetric(evaluatedQueries, (q) => {
    const topK = q.rankedRelevance.slice(0, 10);
    const dcg = topK.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
    // Ideal DCG: all relevant docs at the top
    const idealRels = [...topK].sort((a, b) => b - a);
    // But we should use the total relevant count for ideal
    const totalRel = q.totalRelevant;
    const idealTopK = Array(Math.min(totalRel, 10)).fill(1);
    const idcg = idealTopK.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
    return idcg > 0 ? dcg / idcg : 0;
  });

  // MAP@10
  metrics.map_at_10 = meanMetric(evaluatedQueries, (q) => {
    const topK = q.rankedRelevance.slice(0, 10);
    let relSoFar = 0;
    let precSum = 0;
    for (let i = 0; i < topK.length; i++) {
      if (topK[i] === 1) {
        relSoFar++;
        precSum += relSoFar / (i + 1);
      }
    }
    return q.totalRelevant > 0 ? precSum / q.totalRelevant : 0;
  });

  // Recall@5
  metrics.recall_at_5 = meanMetric(evaluatedQueries, (q) => {
    const topK = q.rankedRelevance.slice(0, 5);
    const found = topK.filter(r => r === 1).length;
    return q.totalRelevant > 0 ? found / q.totalRelevant : 0;
  });

  // Recall@10
  metrics.recall_at_10 = meanMetric(evaluatedQueries, (q) => {
    const topK = q.rankedRelevance.slice(0, 10);
    const found = topK.filter(r => r === 1).length;
    return q.totalRelevant > 0 ? found / q.totalRelevant : 0;
  });

  // Recall@20
  metrics.recall_at_20 = meanMetric(evaluatedQueries, (q) => {
    const topK = q.rankedRelevance.slice(0, 20);
    const found = topK.filter(r => r === 1).length;
    return q.totalRelevant > 0 ? found / q.totalRelevant : 0;
  });

  // Success@1 (at least one relevant in top-1)
  metrics.success_at_1 = meanMetric(evaluatedQueries, (q) => {
    return q.rankedRelevance[0] === 1 ? 1 : 0;
  });

  // Success@5
  metrics.success_at_5 = meanMetric(evaluatedQueries, (q) => {
    return q.rankedRelevance.slice(0, 5).includes(1) ? 1 : 0;
  });

  // Latency
  const latencies = evaluatedQueries.map(q => q.latencyMs).sort((a, b) => a - b);
  const n = latencies.length;
  metrics.latency_p50_ms = latencies[Math.floor(n * 0.5)] || 0;
  metrics.latency_p95_ms = latencies[Math.floor(n * 0.95)] || 0;
  metrics.latency_mean_ms = latencies.reduce((a, b) => a + b, 0) / n || 0;

  // Round all values
  for (const key in metrics) {
    metrics[key] = Math.round(metrics[key] * 10000) / 10000;
  }

  return metrics;
}

function meanMetric(queries, fn) {
  if (queries.length === 0) return 0;
  return queries.reduce((sum, q) => sum + fn(q), 0) / queries.length;
}

/**
 * Evaluate a single query: check which returned results match ground truth.
 */
function evaluateQuery(queryObj, searchResults, docIdToFile) {
  const relevantFiles = new Set();

  // Build set of relevant file paths from ground truth doc IDs
  for (const docId of queryObj.relevant_doc_ids) {
    const filePath = docIdToFile.get(docId);
    if (filePath) {
      relevantFiles.add(filePath);
      // Also add just the filename for fuzzy matching
      relevantFiles.add(path.basename(filePath));
    }
  }

  // Score each returned result: 1 if relevant, 0 if not
  // Only count the FIRST match per relevant document (deduplicate by file)
  const matchedFiles = new Set();
  const rankedRelevance = searchResults.map(r => {
    const resultFile = r.file || '';
    if (!resultFile) return 0; // Skip results without file paths

    const resultBasename = path.basename(resultFile);

    // Skip if we already matched this file
    if (matchedFiles.has(resultBasename)) return 0;

    // Check exact path match or basename match
    let isMatch = relevantFiles.has(resultFile) || relevantFiles.has(resultBasename);

    // Also try matching by suffix (Sweet Search may return relative paths)
    if (!isMatch) {
      for (const relFile of relevantFiles) {
        if (relFile && resultFile.endsWith(relFile) || resultFile && relFile.endsWith(resultFile)) {
          isMatch = true;
          break;
        }
      }
    }

    if (isMatch) {
      matchedFiles.add(resultBasename);
      return 1;
    }
    return 0;
  });

  return {
    queryId: queryObj.query_id,
    query: queryObj.query,
    language: queryObj.language,
    rankedRelevance,
    totalRelevant: queryObj.relevant_doc_ids.length,
    latencyMs: 0, // filled by caller
  };
}

// ─── Per-Language Breakdown ──────────────────────────────────────────────────

function computePerLanguageMetrics(evaluatedQueries) {
  const byLang = {};

  for (const q of evaluatedQueries) {
    const lang = q.language || 'unknown';
    if (!byLang[lang]) byLang[lang] = [];
    byLang[lang].push(q);
  }

  const result = {};
  for (const [lang, queries] of Object.entries(byLang)) {
    result[lang] = {
      count: queries.length,
      ...computeMetrics(queries),
    };
  }

  return result;
}

// ─── Report ──────────────────────────────────────────────────────────────────

function printReport(dataset, metrics, perLanguage, totalTime, queryCount) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  SWEET SEARCH BENCHMARK RESULTS`);
  console.log(`  Dataset: ${dataset}`);
  console.log(`  Queries: ${queryCount}`);
  console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log('═'.repeat(70));

  console.log('\n  Aggregate Metrics:');
  console.log('  ' + '─'.repeat(50));
  console.log(`  MRR@10:      ${(metrics.mrr_at_10 * 100).toFixed(2)}%`);
  console.log(`  NDCG@10:     ${(metrics.ndcg_at_10 * 100).toFixed(2)}%`);
  console.log(`  MAP@10:      ${(metrics.map_at_10 * 100).toFixed(2)}%`);
  console.log(`  Recall@5:    ${(metrics.recall_at_5 * 100).toFixed(2)}%`);
  console.log(`  Recall@10:   ${(metrics.recall_at_10 * 100).toFixed(2)}%`);
  console.log(`  Recall@20:   ${(metrics.recall_at_20 * 100).toFixed(2)}%`);
  console.log(`  Success@1:   ${(metrics.success_at_1 * 100).toFixed(2)}%`);
  console.log(`  Success@5:   ${(metrics.success_at_5 * 100).toFixed(2)}%`);
  console.log('  ' + '─'.repeat(50));
  console.log(`  Latency p50: ${metrics.latency_p50_ms.toFixed(1)}ms`);
  console.log(`  Latency p95: ${metrics.latency_p95_ms.toFixed(1)}ms`);
  console.log(`  Latency avg: ${metrics.latency_mean_ms.toFixed(1)}ms`);

  if (Object.keys(perLanguage).length > 1) {
    console.log('\n  Per-Language Breakdown:');
    console.log('  ' + '─'.repeat(50));
    console.log('  Language    | Queries | MRR@10  | Recall@5 | Recall@20');
    console.log('  ' + '─'.repeat(50));
    for (const [lang, lm] of Object.entries(perLanguage)) {
      console.log(`  ${lang.padEnd(12)}| ${String(lm.count).padEnd(8)}| ${(lm.mrr_at_10 * 100).toFixed(1).padStart(6)}% | ${(lm.recall_at_5 * 100).toFixed(1).padStart(7)}% | ${(lm.recall_at_20 * 100).toFixed(1).padStart(7)}%`);
    }
  }

  console.log('\n' + '═'.repeat(70));
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
    // Rebuild the docIdToFile mapping without rewriting files
    docIdToFile = prepareCorpus(corpus, corpusDir, { skipClean: true });
  } else {
    console.log('\n[2/5] Preparing corpus files...');
    docIdToFile = prepareCorpus(corpus, corpusDir);
  }

  // 3. Index corpus with Sweet Search
  if (!opts.skipIndex) {
    console.log('\n[3/5] Indexing corpus with Sweet Search...');
    try {
      await indexCorpus(corpusDir);
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
    search = await initSearch(corpusDir);
  } catch (err) {
    console.error(`  Failed to initialize search: ${err.message}`);
    process.exit(3);
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
        // Strip leading comment markers from queries (Go queries have // prefix,
        // PHP/JS may have /* or * prefix, which confuses the query router)
        const cleanQuery = queryObj.query
          .replace(/^\/\/\s*/, '')    // Go: // comment
          .replace(/^\/\*+\s*/, '')   // /* or /*** block comments
          .replace(/^\*+\s*/, '')     // * continuation lines
          .replace(/^#\s*/, '')       // Python/Ruby: # comment
          .trim();

        const { results, latencyMs, mode } = await runQuery(search, cleanQuery || queryObj.query, {
          k: opts.k,
          mode: opts.mode,
        });

        const evaluated = evaluateQuery(queryObj, results, docIdToFile);
        evaluated.latencyMs = latencyMs;
        evaluated.searchMode = mode;
        evaluatedQueries.push(evaluated);

        completed++;
        if (completed % 50 === 0 || completed === queries.length) {
          process.stdout.write(`\r  Progress: ${completed}/${queries.length} queries`);
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
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsFile = path.join(resultsDir, `${opts.dataset}_${timestamp}.json`);

  const report = {
    timestamp: new Date().toISOString(),
    dataset: opts.dataset,
    queryCount: queries.length,
    corpusSize: corpus.length,
    searchMode: opts.mode,
    totalTimeMs: totalTime,
    errors: errors.length,
    aggregate: metrics,
    perLanguage,
    // Include failed queries for debugging
    failedQueries: evaluatedQueries
      .filter(q => q.rankedRelevance[0] !== 1)
      .slice(0, 20)
      .map(q => ({
        queryId: q.queryId,
        query: q.query.slice(0, 100),
        language: q.language,
        topRelevance: q.rankedRelevance.slice(0, 5),
      })),
  };

  writeFileSync(resultsFile, JSON.stringify(report, null, 2));
  console.log(`\n  Results saved to: ${resultsFile}`);

  // Also save as latest baseline
  const baselineFile = path.join(resultsDir, `${opts.dataset}_baseline.json`);
  writeFileSync(baselineFile, JSON.stringify(report, null, 2));
  console.log(`  Baseline saved to: ${baselineFile}`);

  // Cleanup
  try {
    await search.close?.();
  } catch {}

  process.exit(0);
}

main().catch(err => {
  console.error(`\nFatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
