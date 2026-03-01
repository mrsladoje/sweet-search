#!/usr/bin/env node

/**
 * A/B Benchmark: Adaptive 2-hop Graph Expansion
 *
 * Compares search quality WITH and WITHOUT adaptive 2-hop graph expansion
 * across three benchmarks (CodeSearchNet, CosQA, AdvTest).
 *
 * Reuses existing indices — search-only, no re-indexing.
 *
 * Usage:
 *   node eval/ab-adaptive-2hop.js
 *   node eval/ab-adaptive-2hop.js --max-queries=100   # Limit per benchmark
 *   node eval/ab-adaptive-2hop.js --datasets=cosqa     # Single benchmark
 */

import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

import { loadJsonl } from './lib/data-loader.js';
import { computeMetrics } from './lib/metrics.js';
import { prepareCorpus } from './lib/corpus.js';
import { initSearch } from './lib/indexer.js';
import { evaluateQuery, cleanQueryText } from './lib/evaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    datasets: ['codesearchnet', 'cosqa', 'advtest'],
    maxQueries: 0,
    concurrency: 5,
  };
  for (const arg of args) {
    if (arg.startsWith('--max-queries=')) opts.maxQueries = parseInt(arg.split('=')[1]);
    else if (arg.startsWith('--datasets=')) opts.datasets = arg.split('=')[1].split(',');
    else if (arg.startsWith('--concurrency=')) opts.concurrency = parseInt(arg.split('=')[1]);
  }
  return opts;
}

// ─── Query runner with configurable search options ──────────────────────────

async function runQueryWithOpts(search, query, searchOpts) {
  const start = performance.now();
  const { results, stats } = await search.search(query, searchOpts);
  const latencyMs = performance.now() - start;
  return {
    results: results.map(r => ({
      file: r.file || r.metadata?.file || r.filePath || r.path || '',
      name: r.name || r.metadata?.name || r.entityName || '',
      score: r.score || 0,
      type: r.type || r.metadata?.type || '',
    })),
    latencyMs,
    stats,
  };
}

// ─── Run one condition on one dataset ───────────────────────────────────────

async function runCondition(search, queries, docIdToFile, searchOpts, label, concurrency) {
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(concurrency);

  const evaluated = [];
  let completed = 0;
  let errors = 0;

  const tasks = queries.map(queryObj =>
    limit(async () => {
      try {
        const cleanQuery = cleanQueryText(queryObj.query);
        const { results, latencyMs } = await runQueryWithOpts(
          search, cleanQuery || queryObj.query, searchOpts,
        );
        const ev = evaluateQuery(queryObj, results, docIdToFile);
        ev.latencyMs = latencyMs;
        evaluated.push(ev);
      } catch {
        errors++;
      }
      completed++;
      if (completed % 100 === 0 || completed === queries.length) {
        process.stdout.write(`\r  [${label}] ${completed}/${queries.length}`);
      }
    })
  );

  await Promise.all(tasks);
  process.stdout.write('\n');

  return { metrics: computeMetrics(evaluated), errors, count: evaluated.length };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log('═'.repeat(70));
  console.log('  A/B Benchmark: Adaptive 2-hop Graph Expansion');
  console.log('═'.repeat(70));
  console.log(`  Datasets:    ${opts.datasets.join(', ')}`);
  console.log(`  Max queries: ${opts.maxQueries || 'all'}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  console.log();

  const conditions = [
    { label: 'no-expand', searchOpts: { k: 20, mode: 'auto', rerank: true, graphExpand: 'none' } },
    { label: '1hop', searchOpts: { k: 20, mode: 'auto', rerank: true, graphExpand: '1hop' } },
    { label: '2hop-adaptive', searchOpts: { k: 20, mode: 'auto', rerank: true, graphExpand: '2hop', adaptiveHop2: true } },
  ];

  const allResults = {};

  for (const dataset of opts.datasets) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  Dataset: ${dataset}`);
    console.log(`${'─'.repeat(70)}`);

    const dataDir = path.join(__dirname, 'data', dataset);
    const corpusDir = path.join(__dirname, 'corpus', dataset);
    const corpusFile = path.join(dataDir, 'corpus.jsonl');
    const queriesFile = path.join(dataDir, 'queries.jsonl');

    if (!existsSync(corpusFile) || !existsSync(queriesFile)) {
      console.log(`  SKIP: data not found at ${dataDir}`);
      continue;
    }

    if (!existsSync(path.join(corpusDir, '.sweet-search', 'code-graph.db'))) {
      console.log(`  SKIP: no index found at ${corpusDir}`);
      continue;
    }

    const corpus = loadJsonl(corpusFile);
    let queries = loadJsonl(queriesFile);
    if (opts.maxQueries > 0) queries = queries.slice(0, opts.maxQueries);

    const docIdToFile = prepareCorpus(corpus, corpusDir, { skipClean: true });

    console.log(`  Corpus: ${corpus.length} docs | Queries: ${queries.length}`);

    // Initialize search once per dataset (shared across conditions)
    let search;
    try {
      search = await initSearch(corpusDir, PROJECT_ROOT, { useLateInteraction: false });
    } catch (err) {
      console.log(`  SKIP: init failed — ${err.message}`);
      continue;
    }

    allResults[dataset] = {};

    for (const { label, searchOpts } of conditions) {
      console.log(`\n  Condition: ${label}`);
      const result = await runCondition(search, queries, docIdToFile, searchOpts, label, opts.concurrency);
      allResults[dataset][label] = result;
    }

    try { await search.close?.(); } catch {}
  }

  // ─── Summary Table ──────────────────────────────────────────────────────

  console.log('\n\n' + '═'.repeat(70));
  console.log('  RESULTS SUMMARY');
  console.log('═'.repeat(70));

  const metricKeys = ['mrr_at_10', 'ndcg_at_10', 'recall_at_5', 'recall_at_10', 'recall_at_20', 'success_at_1', 'latency_p50_ms'];
  const metricLabels = ['MRR@10', 'NDCG@10', 'R@5', 'R@10', 'R@20', 'S@1', 'P50(ms)'];

  for (const dataset of Object.keys(allResults)) {
    const dr = allResults[dataset];
    const conds = Object.keys(dr);
    if (conds.length < 2) continue;

    console.log(`\n  ${dataset.toUpperCase()}`);
    console.log(`  ${'─'.repeat(66)}`);

    // Header
    const hdr = '  ' + 'Metric'.padEnd(12) + conds.map(c => c.padStart(16)).join('') + '     Delta'.padStart(12);
    console.log(hdr);
    console.log(`  ${'─'.repeat(66)}`);

    for (let i = 0; i < metricKeys.length; i++) {
      const key = metricKeys[i];
      const label = metricLabels[i];
      const vals = conds.map(c => dr[c].metrics[key] || 0);
      const delta = vals[1] - vals[0];
      const pct = vals[0] !== 0 ? ((delta / vals[0]) * 100).toFixed(1) : 'N/A';

      const isLatency = key.includes('latency');
      const arrow = delta === 0 ? '  ' : isLatency ? (delta < 0 ? ' ▼' : ' ▲') : (delta > 0 ? ' ▲' : ' ▼');

      let row = '  ' + label.padEnd(12);
      for (const v of vals) {
        row += isLatency ? `${v.toFixed(1)}`.padStart(16) : `${(v * 100).toFixed(2)}%`.padStart(16);
      }
      row += `${arrow} ${isLatency ? delta.toFixed(1) + 'ms' : (delta >= 0 ? '+' : '') + (delta * 100).toFixed(2) + 'pp'}`.padStart(14);
      if (!isLatency) row += ` (${pct}%)`;

      console.log(row);
    }

    console.log(`  ${'─'.repeat(66)}`);
    console.log(`  Queries:   ${conds.map(c => String(dr[c].count).padStart(16)).join('')}`);
    console.log(`  Errors:    ${conds.map(c => String(dr[c].errors).padStart(16)).join('')}`);
  }

  console.log('\n' + '═'.repeat(70));
  console.log('  Legend: pp = percentage points, ▲ = improvement (higher quality / lower latency)');
  console.log('═'.repeat(70));
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
