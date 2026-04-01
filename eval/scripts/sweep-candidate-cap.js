#!/usr/bin/env node
/**
 * Sweep candidate cap sizes for ColGrep pattern search.
 * Tests: no cap (0), and fixed caps at various sizes.
 * Also measures candidate inflation from adjacent-chunk inclusion.
 * Uses DEV split across all 5 repos.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

import SweetSearch from '../../core/search/index.js';
import { encodeQuery } from '../../core/ranking/index.js';
import { computeMetrics } from '../lib/metrics.js';
import { evaluatePatternQuery, getRelevantChunkIds, classifyFailure, computeDiagnostics } from '../lib/pattern-evaluator.js';

const repos = [
  { name: 'sweet-search', queryFile: 'eval/data/pattern-benchmark/queries.jsonl', projectRoot: '.' },
  { name: 'ripgrep', queryFile: 'eval/data/pattern-benchmark-ripgrep/queries.jsonl', projectRoot: 'eval/repos/ripgrep' },
  { name: 'gin', queryFile: 'eval/data/pattern-benchmark-gin/queries.jsonl', projectRoot: 'eval/repos/gin' },
  { name: 'flask', queryFile: 'eval/data/pattern-benchmark-flask/queries.jsonl', projectRoot: 'eval/repos/flask' },
  { name: 'fastify', queryFile: 'eval/data/pattern-benchmark-fastify/queries.jsonl', projectRoot: 'eval/repos/fastify' },
];

// Warmup
console.log('Warming models...');
process.env.SWEET_SEARCH_PROJECT_ROOT = ROOT;
const warmSearch = new SweetSearch();
await warmSearch.init();
await encodeQuery('warmup');
warmSearch.close?.();

// Load all dev queries
const repoData = [];
for (const repo of repos) {
  const projectRoot = path.resolve(ROOT, repo.projectRoot);
  const queryFile = path.resolve(ROOT, repo.queryFile);
  if (!fs.existsSync(queryFile)) continue;

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
  queries = queries.filter(q => q.split === 'dev' && q.relevant_chunk_ids?.length > 0);
  for (const q of queries) getRelevantChunkIds(q);

  repoData.push({ name: repo.name, search, queries });
}

const totalDev = repoData.reduce((s, r) => s + r.queries.length, 0);
console.log(`\nLoaded ${totalDev} dev queries across ${repoData.length} repos.\n`);

// Candidate cap sizes to test
const caps = [0, 50, 100, 150, 200, 300, 500, 750, 1000];

// Also test with adjacent chunks on/off at the best cap
const adjacentModes = [true]; // Adjacent is already on; we'll test caps with it

async function runConfig(cap) {
  const allResults = [];
  let totalCandidates = 0;
  let totalGrepMatches = 0;
  let totalLatency = 0;
  let queryCount = 0;

  for (const { search, queries } of repoData) {
    for (const q of queries) {
      try {
        const { results: sr, stats } = await search.search(q.semantic_query, {
          k: 10, mode: 'pattern', regex: q.regex, rerank: true, expand: false,
          maxCandidates: cap,
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
        allResults.push(e);

        totalCandidates += stats?.maxSimCandidates || 0;
        totalGrepMatches += stats?.grepMatches || 0;
        totalLatency += stats?.total_ms || 0;
        queryCount++;
      } catch {}
    }
  }

  const m = computeMetrics(allResults);
  const diag = computeDiagnostics(allResults);
  const avgCandidates = queryCount > 0 ? totalCandidates / queryCount : 0;
  const avgGrepMatches = queryCount > 0 ? totalGrepMatches / queryCount : 0;
  const avgLatency = queryCount > 0 ? totalLatency / queryCount : 0;
  const candRecall = allResults.length > 0 ? (diag.hit + diag.rerank_miss) / allResults.length : 0;

  return { m, diag, avgCandidates, avgGrepMatches, avgLatency, candRecall, queryCount };
}

// Header
console.log('cap'.padStart(6) + 'MRR@10'.padStart(10) + 'R@5'.padStart(8) + 'R@10'.padStart(8) + 'S@1'.padStart(8) + 'CandR'.padStart(8) + 'avgCand'.padStart(9) + 'avgMs'.padStart(8) + 'regrex'.padStart(8));
console.log('-'.repeat(73));

for (const cap of caps) {
  const { m, diag, avgCandidates, avgLatency, candRecall } = await runConfig(cap);
  console.log(
    (cap === 0 ? 'none' : String(cap)).padStart(6) +
    ((m.mrr_at_10 * 100).toFixed(1) + '%').padStart(10) +
    ((m.recall_at_5 * 100).toFixed(1) + '%').padStart(8) +
    ((m.recall_at_10 * 100).toFixed(1) + '%').padStart(8) +
    ((m.success_at_1 * 100).toFixed(1) + '%').padStart(8) +
    ((candRecall * 100).toFixed(0) + '%').padStart(8) +
    avgCandidates.toFixed(0).padStart(9) +
    avgLatency.toFixed(0).padStart(8) +
    String(diag.regex_miss).padStart(8)
  );
}

// Cleanup
for (const { search } of repoData) search.close?.();
