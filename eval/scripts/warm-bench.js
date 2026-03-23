#!/usr/bin/env node
/**
 * Warm-latency pattern benchmark.
 * Loads all models first, then runs queries sequentially to measure true hot-path latency.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

import SweetSearch from '../../core/sweet-search.js';
import { encodeQuery } from '../../core/late-interaction-model.js';
import { loadJsonl } from '../lib/data-loader.js';
import { computeMetrics } from '../lib/metrics.js';
import {
  runPatternQuery, runRgOnlyQuery, evaluatePatternQuery,
  getRelevantChunkIds, computePerSliceMetrics, computeWinRate,
  printSliceReport, printWinRate,
} from '../lib/pattern-evaluator.js';

// ── Warmup ──────────────────────────────────────────────────────
console.log('Warming all models...');
const search = new SweetSearch();
await search.init();
await encodeQuery('warmup query one');
await encodeQuery('warmup query two');
console.log('All models warm.\n');

// ── Load queries ────────────────────────────────────────────────
const queries = loadJsonl(path.join(PROJECT_ROOT, 'eval/data/pattern-benchmark/queries.jsonl'));
for (const q of queries) getRelevantChunkIds(q);
console.log(`Queries: ${queries.length}`);

// ── rg-only ─────────────────────────────────────────────────────
console.log('\nRunning rg-only...');
const rgResults = [];
for (const q of queries) {
  const r = await runRgOnlyQuery(search, q, { k: 10 });
  const e = evaluatePatternQuery(q, r.results);
  e.latencyMs = r.latencyMs;
  rgResults.push(e);
}

// ── pattern-maxsim (warm) ───────────────────────────────────────
console.log('Running pattern-maxsim (warm)...');
const patResults = [];
for (const q of queries) {
  const r = await runPatternQuery(search, q, { k: 10 });
  const e = evaluatePatternQuery(q, r.results);
  e.latencyMs = r.latencyMs;
  e.patternStats = r.stats;
  e.regexFamily = q.regex_family || 'unknown';
  e.difficulty = q.difficulty || 'unknown';
  e.namingQuality = q.naming_quality || 'unknown';
  patResults.push(e);
}

// ── Report ──────────────────────────────────────────────────────
const rgM = computeMetrics(rgResults);
const patM = computeMetrics(patResults);

const fmt = (m, label) => {
  console.log(`\n  ── ${label} ──`);
  console.log(`  MRR@10:    ${(m.mrr_at_10*100).toFixed(1)}%`);
  console.log(`  Recall@5:  ${(m.recall_at_5*100).toFixed(1)}%`);
  console.log(`  Recall@10: ${(m.recall_at_10*100).toFixed(1)}%`);
  console.log(`  Success@1: ${(m.success_at_1*100).toFixed(1)}%`);
  console.log(`  Latency p50: ${m.latency_p50_ms.toFixed(1)}ms`);
  console.log(`  Latency p95: ${m.latency_p95_ms.toFixed(1)}ms`);
  console.log(`  Latency avg: ${m.latency_mean_ms.toFixed(1)}ms`);
};

console.log('\n══════════════════════════════════════');
console.log('  WARM LATENCY BENCHMARK RESULTS');
console.log('══════════════════════════════════════');
fmt(rgM, 'rg-only');
fmt(patM, 'pattern-maxsim (warm)');

printWinRate('Pattern vs rg-only', computeWinRate(patResults, rgResults));

const ws = patResults.filter(q => q.patternStats);
const avg = (k) => ws.reduce((s, q) => s + (q.patternStats[k] || 0), 0) / ws.length;
console.log('\n  ── Track C: Component Latency (warm) ──');
console.log(`  Chunk map:        ${avg('mapTime_ms').toFixed(1)}ms`);
console.log(`  Parallel (rg+enc): ${avg('parallelTime_ms').toFixed(1)}ms`);
console.log(`  MaxSim rerank:    ${avg('rerankTime_ms').toFixed(1)}ms`);
console.log(`  Grep matches:     ${avg('grepMatches').toFixed(0)}`);
console.log(`  MaxSim candidates: ${avg('maxSimCandidates').toFixed(0)}`);

const slices = computePerSliceMetrics(patResults, computeMetrics);
printSliceReport('regexFamily', slices.regexFamily);

search.close?.();
