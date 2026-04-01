#!/usr/bin/env node
/**
 * Multi-repo parameter sweep for ColGrep pattern search.
 * Sweeps: query enhancement × grep density alpha × test demotion
 * Uses DEV split only across all 5 repos.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

import SweetSearch from '../../core/search/sweet-search.js';
import { encodeQuery } from '../../core/ranking/late-interaction-model.js';
import { computeMetrics } from '../lib/metrics.js';
import { evaluatePatternQuery, getRelevantChunkIds } from '../lib/pattern-evaluator.js';

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

// Load all dev queries with their search instances
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

// Sweep parameters
const enhanceModes = [false, true];
const alphas = [0, 0.05, 0.1, 0.15];
const demotions = [0, 0.02, 0.05, 0.1];

async function runConfig(enhance, alpha, demotion) {
  const allResults = [];
  for (const { search, queries } of repoData) {
    for (const q of queries) {
      try {
        const { results: sr } = await search.search(q.semantic_query, {
          k: 10, mode: 'pattern', regex: q.regex, rerank: true, expand: false,
          enhanceQuery: enhance, grepDensityAlpha: alpha, testDemotion: demotion,
        });
        const e = evaluatePatternQuery(q, sr.map(r => ({
          id: r.id || '', file: r.file || '', name: r.name || '',
          score: r.score || 0, type: r.type || '',
          startLine: r.startLine, endLine: r.endLine,
        })));
        allResults.push(e);
      } catch {}
    }
  }
  return computeMetrics(allResults);
}

// Header
console.log('enhance'.padEnd(9) + 'alpha'.padStart(7) + 'demote'.padStart(8) + 'MRR@10'.padStart(10) + 'R@5'.padStart(8) + 'R@10'.padStart(8) + 'S@1'.padStart(8));
console.log('-'.repeat(58));

// Run sweep
const results = [];
for (const enhance of enhanceModes) {
  for (const alpha of alphas) {
    for (const demotion of demotions) {
      const m = await runConfig(enhance, alpha, demotion);
      const row = {
        enhance, alpha, demotion,
        mrr: m.mrr_at_10, r5: m.recall_at_5, r10: m.recall_at_10, s1: m.success_at_1,
      };
      results.push(row);
      console.log(
        String(enhance).padEnd(9) +
        String(alpha).padStart(7) +
        String(demotion).padStart(8) +
        ((m.mrr_at_10 * 100).toFixed(1) + '%').padStart(10) +
        ((m.recall_at_5 * 100).toFixed(1) + '%').padStart(8) +
        ((m.recall_at_10 * 100).toFixed(1) + '%').padStart(8) +
        ((m.success_at_1 * 100).toFixed(1) + '%').padStart(8)
      );
    }
  }
}

// Find best
results.sort((a, b) => b.mrr - a.mrr);
const best = results[0];
console.log('\n' + '-'.repeat(58));
console.log(`BEST: enhance=${best.enhance} alpha=${best.alpha} demote=${best.demotion}`);
console.log(`  MRR@10=${(best.mrr*100).toFixed(1)}% R@5=${(best.r5*100).toFixed(1)}% R@10=${(best.r10*100).toFixed(1)}% S@1=${(best.s1*100).toFixed(1)}%`);

// Cleanup
for (const { search } of repoData) search.close?.();
