#!/usr/bin/env node
/**
 * Latency stress benchmark for ColGrep pattern search.
 *
 * Tests three candidate-count regimes independently of relevance:
 *   - low-candidate:    <20 chunks  (narrow, specific regexes)
 *   - medium-candidate: 50-200 chunks
 *   - worst-case:       500+ chunks (broad regexes)
 *
 * Reports only timing metrics — no gold labels, no relevance scoring.
 * Run independently with: node eval/scripts/latency-stress.js
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
process.env.SWEET_SEARCH_PROJECT_ROOT = PROJECT_ROOT;

import SweetSearch from '../../core/search/sweet-search.js';
import { encodeQuery } from '../../core/ranking/late-interaction-model.js';

// ── Fixed query sets ─────────────────────────────────────────────────────────
// semantic_query is generic — latency testing only, content irrelevant
const QUERY_SETS = {
  'low-candidate': [
    { regex: 'function maxSimScore', label: 'maxSimScore fn' },
    { regex: 'class SweetSearch', label: 'SweetSearch class' },
    { regex: 'buildChunkLocationMap', label: 'buildChunkLocationMap fn' },
  ],
  'medium-candidate': [
    { regex: 'export async function\\s+\\w+', label: 'export async function' },
    { regex: 'class\\s+\\w+', label: 'class declaration' },
    { regex: 'export const\\s+\\w+', label: 'export const' },
  ],
  'worst-case': [
    { regex: 'function\\s+\\w+', label: 'function declaration' },
    { regex: 'import.*from', label: 'import statement' },
    { regex: 'const\\s+\\w+\\s*=', label: 'const assignment' },
  ],
};

const SEMANTIC_QUERY = 'code implementation';
const RUNS_PER_QUERY = 3;
const K = 10;

// ── Warmup ───────────────────────────────────────────────────────────────────
console.log('Warming all models...');
const search = new SweetSearch();
await search.init();
await encodeQuery('warmup query one');
await encodeQuery('warmup query two');
console.log('All models warm.\n');

// ── Percentile helpers ───────────────────────────────────────────────────────
function p(arr, pct) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * pct / 100) - 1);
  return sorted[idx];
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function fmtMs(v) {
  return v.toFixed(1).padStart(7);
}

// ── Run one query, returning timing from stats ───────────────────────────────
async function runQuery(regex) {
  const { stats } = await search.search(SEMANTIC_QUERY, {
    k: K,
    mode: 'pattern',
    regex,
    rerank: true,
    expand: false,
  });
  return stats || {};
}

// ── Per-query run loop ────────────────────────────────────────────────────────
async function benchQuery(label, regex) {
  const samples = [];
  for (let i = 0; i < RUNS_PER_QUERY; i++) {
    const s = await runQuery(regex);
    samples.push(s);
  }

  const totals      = samples.map(s => s.total_ms          || 0);
  const parallels   = samples.map(s => s.parallelTime_ms   || 0);
  const reranks     = samples.map(s => s.rerankTime_ms      || 0);
  const maps        = samples.map(s => s.mapTime_ms         || 0);
  const candidates  = samples.map(s => s.maxSimCandidates   || 0);
  const greps       = samples.map(s => s.grepMatches        || 0);

  return {
    label,
    regex,
    runs: RUNS_PER_QUERY,
    total:    { p50: p(totals, 50),    p95: p(totals, 95),    avg: avg(totals)    },
    parallel: { p50: p(parallels, 50), p95: p(parallels, 95), avg: avg(parallels) },
    rerank:   { p50: p(reranks, 50),   p95: p(reranks, 95),   avg: avg(reranks)   },
    map:      { p50: p(maps, 50),      p95: p(maps, 95),      avg: avg(maps)      },
    candidates: Math.round(avg(candidates)),
    grepMatches: Math.round(avg(greps)),
  };
}

// ── Print query result row ────────────────────────────────────────────────────
function printQueryRow(r) {
  console.log(`    ${r.label.padEnd(28)}  total p50:${fmtMs(r.total.p50)}ms  p95:${fmtMs(r.total.p95)}ms  avg:${fmtMs(r.total.avg)}ms`);
  console.log(`    ${''.padEnd(28)}  rg+enc p50:${fmtMs(r.parallel.p50)}ms  rerank p50:${fmtMs(r.rerank.p50)}ms  map:${fmtMs(r.map.p50)}ms`);
  console.log(`    ${''.padEnd(28)}  candidates: ${String(r.candidates).padStart(5)}  grep matches: ${String(r.grepMatches).padStart(6)}`);
}

// ── Collect all results ───────────────────────────────────────────────────────
const allSetResults = {};

for (const [setName, queries] of Object.entries(QUERY_SETS)) {
  console.log(`\nRunning set: ${setName} (${queries.length} queries × ${RUNS_PER_QUERY} runs each)`);
  const results = [];
  for (const { regex, label } of queries) {
    process.stdout.write(`  ${label}... `);
    const r = await benchQuery(label, regex);
    results.push(r);
    process.stdout.write(`done (avg total: ${r.total.avg.toFixed(0)}ms, candidates: ${r.candidates})\n`);
  }
  allSetResults[setName] = results;
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
console.log('  LATENCY STRESS BENCHMARK RESULTS');
console.log('  ' + `${RUNS_PER_QUERY} warm runs per query · k=${K} · semantic query: "${SEMANTIC_QUERY}"`);
console.log('═'.repeat(72));

const summaryRows = [];

for (const [setName, results] of Object.entries(allSetResults)) {
  console.log(`\n  ── ${setName} ──`);

  for (const r of results) {
    printQueryRow(r);
  }

  // Per-set aggregate (median of per-query averages)
  const setTotals   = results.map(r => r.total.avg);
  const setParallel = results.map(r => r.parallel.avg);
  const setRerank   = results.map(r => r.rerank.avg);
  const setCands    = results.map(r => r.candidates);

  const setAvgTotal    = avg(setTotals);
  const setP50Total    = p(setTotals, 50);
  const setP95Total    = p(setTotals, 95);
  const setAvgParallel = avg(setParallel);
  const setAvgRerank   = avg(setRerank);
  const setAvgCands    = Math.round(avg(setCands));

  console.log(`\n    ${'SET AGGREGATE'.padEnd(28)}  total p50:${fmtMs(setP50Total)}ms  p95:${fmtMs(setP95Total)}ms  avg:${fmtMs(setAvgTotal)}ms`);
  console.log(`    ${''.padEnd(28)}  rg+enc avg:${fmtMs(setAvgParallel)}ms  rerank avg:${fmtMs(setAvgRerank)}ms`);
  console.log(`    ${''.padEnd(28)}  avg candidates: ${setAvgCands}`);

  summaryRows.push({ setName, setP50Total, setP95Total, setAvgTotal, setAvgParallel, setAvgRerank, setAvgCands });
}

// ── Summary table ─────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(72));
console.log('  SUMMARY TABLE (avg over queries in each set)');
console.log('  ' + '-'.repeat(68));
console.log(
  '  ' +
  'Set'.padEnd(22) +
  'p50 total'.padStart(12) +
  'p95 total'.padStart(12) +
  'avg total'.padStart(12) +
  'avg rg+enc'.padStart(12) +
  'avg rerank'.padStart(12) +
  'avg cands'.padStart(11)
);
console.log('  ' + '-'.repeat(68));
for (const r of summaryRows) {
  console.log(
    '  ' +
    r.setName.padEnd(22) +
    `${r.setP50Total.toFixed(1)}ms`.padStart(12) +
    `${r.setP95Total.toFixed(1)}ms`.padStart(12) +
    `${r.setAvgTotal.toFixed(1)}ms`.padStart(12) +
    `${r.setAvgParallel.toFixed(1)}ms`.padStart(12) +
    `${r.setAvgRerank.toFixed(1)}ms`.padStart(12) +
    String(r.setAvgCands).padStart(11)
  );
}
console.log('  ' + '-'.repeat(68));
console.log('');

search.close?.();
