#!/usr/bin/env node
/**
 * Multi-repo ColGrep benchmark.
 * Runs pattern search on all benchmark repos and reports per-repo + aggregate metrics.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

import SweetSearch from '../../core/search/index.js';
import { encodeQuery } from '../../core/ranking/index.js';
import { computeMetrics } from '../lib/metrics.js';
import {
  evaluatePatternQuery, getRelevantChunkIds,
  classifyFailure, computeDiagnostics,
} from '../lib/pattern-evaluator.js';
import { applySplit, normalizeSplit, warnIfFullSplit } from '../lib/splits.js';

const repos = [
  { name: 'sweet-search', queryFile: 'eval/data/pattern-benchmark/queries.jsonl', projectRoot: '.' },
  { name: 'ripgrep', queryFile: 'eval/data/pattern-benchmark-ripgrep/queries.jsonl', projectRoot: 'eval/repos/ripgrep' },
  { name: 'gin', queryFile: 'eval/data/pattern-benchmark-gin/queries.jsonl', projectRoot: 'eval/repos/gin' },
  { name: 'flask', queryFile: 'eval/data/pattern-benchmark-flask/queries.jsonl', projectRoot: 'eval/repos/flask' },
  { name: 'fastify', queryFile: 'eval/data/pattern-benchmark-fastify/queries.jsonl', projectRoot: 'eval/repos/fastify' },
];

// CLI args
//
// --split=dev|heldout|all (default: all)
//
//   Reads canonical split membership from eval/splits/multirepo/{dev,heldout}.json
//   (regenerate with `node eval/scripts/generate-splits.js`).
//
//   The legacy `q.split` field embedded in queries.jsonl ("dev" / "test") was
//   hand-curated and predates the canonical methodology — it is informational
//   only now. The new flag uses the external split files exclusively.
const splitArg = process.argv.find(a => a.startsWith('--split='));
const split = normalizeSplit(splitArg ? splitArg.split('=')[1] : 'all');

// Warmup
console.log('Warming models...');
process.env.SWEET_SEARCH_PROJECT_ROOT = ROOT;
const warmSearch = new SweetSearch();
await warmSearch.init();
await encodeQuery('warmup one');
await encodeQuery('warmup two');
warmSearch.close?.();
console.log(`Ready. (split: ${split})\n`);
warnIfFullSplit(split, 'multirepo');

console.log('═'.repeat(70));
console.log('  MULTI-REPO COLGREP BENCHMARK (warm, pattern-maxsim)');
console.log('═'.repeat(70));

const allResults = [];

for (const repo of repos) {
  const projectRoot = path.resolve(ROOT, repo.projectRoot);
  const queryFile = path.resolve(ROOT, repo.queryFile);

  if (!fs.existsSync(queryFile)) { console.log('\n  ' + repo.name + ': SKIPPED (no query file)'); continue; }

  const ssDir = path.join(projectRoot, '.sweet-search');
  const search = new SweetSearch({
    projectRoot,
    graphDbPath: path.join(ssDir, 'code-graph.db'),
    hnswPath: path.join(ssDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(ssDir, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(ssDir, 'codebase.db'),
    lateInteractionOptions: { indexPath: path.join(ssDir, 'codebase-late-interaction.db') },
  });
  await search.init();

  let queries = fs.readFileSync(queryFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const beforeSplit = queries.length;
  if (split !== 'all') {
    const filtered = applySplit(queries, split, 'multirepo', q => q.query_id);
    queries = filtered.items;
  }
  const valid = queries.filter(q => q.relevant_chunk_ids?.length > 0);
  if (split !== 'all') {
    console.log(`  ${repo.name}: ${queries.length}/${beforeSplit} queries after --split=${split}`);
  }

  const results = [];
  let errors = 0;
  for (const q of valid) {
    try {
      const { results: sr, stats } = await search.search(q.semantic_query, {
        k: 10, mode: 'pattern', regex: q.regex, rerank: true, expand: false,
      });
      const mapped = sr.map(r => ({
        id: r.id || '', file: r.file || '', name: r.name || '',
        score: r.score || 0, type: r.type || '',
        startLine: r.startLine, endLine: r.endLine,
      }));
      const e = evaluatePatternQuery(q, mapped);
      e.latencyMs = stats?.total_ms || 0;
      const goldIds = new Set(getRelevantChunkIds(q));
      e._failureMode = classifyFailure(e, stats, goldIds);
      e.regexFamily = q.regex_family || 'unknown';
      results.push(e);
    } catch {
      errors++;
    }
  }

  const m = computeMetrics(results);
  const diag = computeDiagnostics(results);
  const cr = results.length > 0 ? ((diag.hit + diag.rerank_miss) / results.length * 100).toFixed(1) : '0';

  console.log(`\n  ── ${repo.name} (${results.length}/${valid.length} queries, ${errors} errors) ──`);
  console.log(`  MRR@10:    ${(m.mrr_at_10 * 100).toFixed(1)}%`);
  console.log(`  Recall@5:  ${(m.recall_at_5 * 100).toFixed(1)}%`);
  console.log(`  Recall@10: ${(m.recall_at_10 * 100).toFixed(1)}%`);
  console.log(`  Success@1: ${(m.success_at_1 * 100).toFixed(1)}%`);
  console.log(`  Latency p50: ${m.latency_p50_ms.toFixed(0)}ms`);
  console.log(`  Cand recall: ${cr}%`);
  console.log(`  Pipeline: hit=${diag.hit} rerank=${diag.rerank_miss} map=${diag.mapping_miss} regex=${diag.regex_miss}`);

  allResults.push({ name: repo.name, count: results.length, metrics: m, diag });
  search.close?.();
}

// Summary
console.log('\n' + '═'.repeat(70));
console.log('  SUMMARY');
console.log('  ' + '-'.repeat(66));
console.log('  ' + 'Repo'.padEnd(14) + 'N'.padStart(5) + 'MRR@10'.padStart(10) + 'R@5'.padStart(8) + 'R@10'.padStart(8) + 'S@1'.padStart(8) + 'p50ms'.padStart(8) + 'CandR'.padStart(8));
console.log('  ' + '-'.repeat(66));

let totalN = 0;
for (const r of allResults) {
  const cr = ((r.diag.hit + r.diag.rerank_miss) / r.count * 100).toFixed(0);
  console.log('  ' +
    r.name.padEnd(14) + String(r.count).padStart(5) +
    ((r.metrics.mrr_at_10 * 100).toFixed(1) + '%').padStart(10) +
    ((r.metrics.recall_at_5 * 100).toFixed(1) + '%').padStart(8) +
    ((r.metrics.recall_at_10 * 100).toFixed(1) + '%').padStart(8) +
    ((r.metrics.success_at_1 * 100).toFixed(1) + '%').padStart(8) +
    r.metrics.latency_p50_ms.toFixed(0).padStart(8) +
    (cr + '%').padStart(8));
  totalN += r.count;
}

const wavg = (key) => allResults.reduce((s, r) => s + r.metrics[key] * r.count, 0) / totalN;
console.log('  ' + '-'.repeat(66));
console.log('  ' + 'WEIGHTED AVG'.padEnd(14) + String(totalN).padStart(5) +
  ((wavg('mrr_at_10') * 100).toFixed(1) + '%').padStart(10) +
  ((wavg('recall_at_5') * 100).toFixed(1) + '%').padStart(8) +
  ((wavg('recall_at_10') * 100).toFixed(1) + '%').padStart(8) +
  ((wavg('success_at_1') * 100).toFixed(1) + '%').padStart(8) +
  wavg('latency_p50_ms').toFixed(0).padStart(8));
console.log('═'.repeat(70));
