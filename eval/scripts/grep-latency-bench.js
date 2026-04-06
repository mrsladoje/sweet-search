#!/usr/bin/env node
/**
 * Grep-only latency benchmark: Sweet Search indexed grep vs raw ripgrep.
 *
 * Runs every query regex across all benchmark repos and compares wall-clock
 * latency for: (a) raw `rg --json` and (b) our `bareGrep` (gram index +
 * native grep + verification pipeline).
 *
 * No MaxSim, no encoding, no reranking — pure grep replacement comparison.
 *
 * Usage:
 *   node eval/scripts/grep-latency-bench.js
 *   node eval/scripts/grep-latency-bench.js --repos=gin,flask
 *   node eval/scripts/grep-latency-bench.js --verbose
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// Avoid model loading — we only need grep infrastructure
import SweetSearch from '../../core/search/index.js';
import { runRipgrep } from '../../core/search/search-pattern.js';

const QUERY_SETS = {
  realistic: [
    { name: 'sweet-search', queryFile: 'eval/data/grep-bench/sweet-search.jsonl', projectRoot: '.' },
    { name: 'ripgrep',      queryFile: 'eval/data/grep-bench/ripgrep.jsonl', projectRoot: 'eval/repos/ripgrep' },
    { name: 'gin',          queryFile: 'eval/data/grep-bench/gin.jsonl', projectRoot: 'eval/repos/gin' },
    { name: 'flask',        queryFile: 'eval/data/grep-bench/flask.jsonl', projectRoot: 'eval/repos/flask' },
    { name: 'fastify',      queryFile: 'eval/data/grep-bench/fastify.jsonl', projectRoot: 'eval/repos/fastify' },
  ],
  legacy: [
    { name: 'sweet-search', queryFile: 'eval/data/pattern-benchmark/queries.jsonl', projectRoot: '.' },
    { name: 'ripgrep',      queryFile: 'eval/data/pattern-benchmark-ripgrep/queries.jsonl', projectRoot: 'eval/repos/ripgrep' },
    { name: 'gin',          queryFile: 'eval/data/pattern-benchmark-gin/queries.jsonl', projectRoot: 'eval/repos/gin' },
    { name: 'flask',        queryFile: 'eval/data/pattern-benchmark-flask/queries.jsonl', projectRoot: 'eval/repos/flask' },
    { name: 'fastify',      queryFile: 'eval/data/pattern-benchmark-fastify/queries.jsonl', projectRoot: 'eval/repos/fastify' },
  ],
};

// ── CLI ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const reposArg = args.find(a => a.startsWith('--repos='));
const repoFilter = reposArg ? reposArg.split('=')[1].split(',') : null;
const querySetArg = args.find(a => a.startsWith('--queries='));
const querySetName = querySetArg ? querySetArg.split('=')[1] : 'realistic';
const validate = args.includes('--validate');
const REPOS = QUERY_SETS[querySetName] || QUERY_SETS.realistic;
const warmupRuns = 2;

// ── Helpers ──────────────────────────────────────────────────────
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    avg: times.reduce((s, t) => s + t, 0) / times.length,
    min: sorted[0] || 0,
    max: sorted[sorted.length - 1] || 0,
    n: times.length,
  };
}

// ── Main ─────────────────────────────────────────────────────────
console.log('═'.repeat(78));
console.log('  GREP LATENCY BENCHMARK: Sweet Search indexed grep vs raw ripgrep');
console.log('═'.repeat(78));

const allRepoResults = [];

for (const repo of REPOS) {
  if (repoFilter && !repoFilter.includes(repo.name)) continue;

  const projectRoot = path.resolve(ROOT, repo.projectRoot);
  const queryFile = path.resolve(ROOT, repo.queryFile);

  if (!fs.existsSync(queryFile)) {
    console.log(`\n  ${repo.name}: SKIPPED (no query file)`);
    continue;
  }

  const ssDir = path.join(projectRoot, '.sweet-search');
  const search = new SweetSearch({
    projectRoot,
    graphDbPath: path.join(ssDir, 'code-graph.db'),
    hnswPath: path.join(ssDir, 'codebase-hnsw.idx'),
    binaryHnswPath: path.join(ssDir, 'codebase-binary-hnsw.idx'),
    codebaseDbPath: path.join(ssDir, 'codebase.db'),
    sparseGramIndexPath: path.join(ssDir, 'codebase-sparse-grams.idx'),
    chunkGramIndexPath: path.join(ssDir, 'codebase-chunk-grams.idx'),
    lateInteractionOptions: { indexPath: path.join(ssDir, 'codebase-late-interaction.db') },
  });
  await search.init();

  const queries = fs.readFileSync(queryFile, 'utf8').trim().split('\n').map(l => JSON.parse(l));

  // Warmup: run a couple queries through both paths to prime caches / JIT
  for (let w = 0; w < warmupRuns && w < queries.length; w++) {
    try {
      await search.bareGrep(queries[w].regex, {}, { regex: queries[w].regex });
    } catch { /* ignore warmup errors */ }
  }

  const rgTimes = [];
  const ssGrepTimes = [];
  const perQuery = [];

  // Count source files in repo (quick estimate)
  let fileCount = 0;
  try {
    const { execSync } = await import('child_process');
    const out = execSync(`rg --files ${projectRoot} | wc -l`, { encoding: 'utf8', timeout: 5000 });
    fileCount = parseInt(out.trim()) || 0;
  } catch { /* noop */ }

  for (const q of queries) {
    const regex = q.regex;
    const family = q.regex_family || 'unknown';

    // --- Raw ripgrep ---
    let rgMs, rgMatches, rgResultFull;
    try {
      const rgStart = performance.now();
      rgResultFull = await runRipgrep(regex, projectRoot, { maxMatches: 0 });
      rgMs = performance.now() - rgStart;
      rgMatches = rgResultFull.length;
    } catch {
      rgMs = null;
      rgMatches = 0;
      rgResultFull = [];
    }

    // --- Sweet Search bareGrep (indexed) ---
    let ssMs, ssMatches, ssStats, ssResultFull;
    try {
      const ssResult = await search.bareGrep(regex, {}, { regex });
      ssMs = ssResult.stats?.total_ms;
      ssMatches = ssResult.stats?.totalMatches ?? ssResult.results?.length ?? 0;
      ssStats = ssResult.stats;
      ssResultFull = ssResult.results || [];
    } catch {
      ssMs = null;
      ssMatches = 0;
      ssStats = {};
      ssResultFull = [];
    }

    if (rgMs !== null) rgTimes.push(rgMs);
    if (ssMs !== null) ssGrepTimes.push(ssMs);

    const speedup = (rgMs && ssMs && ssMs > 0) ? (rgMs / ssMs) : null;
    const route = ssStats?.grepStrategy || ssStats?.plannerRoute || '?';

    perQuery.push({ regex, family, rgMs, ssMs, rgMatches, ssMatches, speedup, ssStats, route });

    if (verbose) {
      const sp = speedup ? `${speedup.toFixed(1)}x` : 'N/A';
      const native = ssStats?.nativeGrepUsed ? 'N' : 'rg';
      console.log(`    ${regex.substring(0, 40).padEnd(40)} rg=${(rgMs||0).toFixed(0).padStart(5)}ms  ss=${(ssMs||0).toFixed(0).padStart(5)}ms  ${sp.padStart(6)}  [${route}] ${native}`);
    }

    // --- Field-level parity validation ---
    if (validate && rgResultFull.length > 0 && ssResultFull.length > 0) {
      // Sort both by file, line for stable comparison
      const sortFn = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
      const rgSorted = [...rgResultFull].sort(sortFn);
      const ssSorted = [...ssResultFull].sort(sortFn);

      // Build rg lookup: file:line → {column, matchText, content}
      const rgMap = new Map();
      for (const m of rgSorted) rgMap.set(`${m.file}:${m.line}`, m);

      let fileMismatch = 0, lineMismatch = 0, colMismatch = 0, textMismatch = 0, contentMismatch = 0;
      let checked = 0;
      const cap = Math.min(ssSorted.length, 200); // cap comparison to avoid noise
      for (let i = 0; i < cap; i++) {
        const ss = ssSorted[i];
        const rg = rgMap.get(`${ss.file}:${ss.line}`);
        if (!rg) { lineMismatch++; continue; }
        checked++;
        if (ss.column && rg.column && ss.column !== rg.column) colMismatch++;
        if (ss.matchText && rg.matchText && ss.matchText !== rg.matchText) textMismatch++;
        if (ss.content && rg.content && ss.content.trimEnd() !== rg.content.trimEnd()) contentMismatch++;
      }

      if (lineMismatch || colMismatch || textMismatch || contentMismatch) {
        const countDiff = Math.abs(rgMatches - ssMatches);
        console.log(`    VALIDATE ${regex.substring(0, 35).padEnd(35)} count: rg=${rgMatches} ss=${ssMatches}${countDiff ? ` (Δ${countDiff})` : ''}  file:line miss=${lineMismatch}  col=${colMismatch}  matchText=${textMismatch}  content=${contentMismatch}  (checked ${checked})`);
      }
    }
  }

  const rgS = stats(rgTimes);
  const ssS = stats(ssGrepTimes);

  console.log(`\n  ── ${repo.name} (${queries.length} queries, ${fileCount} indexed files) ──`);
  console.log(`  ${''.padEnd(18)} ${'p50'.padStart(8)} ${'p95'.padStart(8)} ${'avg'.padStart(8)} ${'min'.padStart(8)} ${'max'.padStart(8)}`);
  console.log(`  ${'ripgrep (raw)'.padEnd(18)} ${rgS.p50.toFixed(1).padStart(7)}ms ${rgS.p95.toFixed(1).padStart(7)}ms ${rgS.avg.toFixed(1).padStart(7)}ms ${rgS.min.toFixed(1).padStart(7)}ms ${rgS.max.toFixed(1).padStart(7)}ms`);
  console.log(`  ${'sweet-search grep'.padEnd(18)} ${ssS.p50.toFixed(1).padStart(7)}ms ${ssS.p95.toFixed(1).padStart(7)}ms ${ssS.avg.toFixed(1).padStart(7)}ms ${ssS.min.toFixed(1).padStart(7)}ms ${ssS.max.toFixed(1).padStart(7)}ms`);

  const speedupP50 = rgS.p50 / ssS.p50;
  const speedupAvg = rgS.avg / ssS.avg;
  console.log(`  Speedup:           p50 ${speedupP50.toFixed(2)}x    avg ${speedupAvg.toFixed(2)}x`);

  // Per-family breakdown
  const families = {};
  for (const pq of perQuery) {
    if (!families[pq.family]) families[pq.family] = { rg: [], ss: [] };
    if (pq.rgMs !== null) families[pq.family].rg.push(pq.rgMs);
    if (pq.ssMs !== null) families[pq.family].ss.push(pq.ssMs);
  }
  console.log(`\n  Per-family:`);
  console.log(`  ${'family'.padEnd(16)} ${'N'.padStart(4)} ${'rg p50'.padStart(9)} ${'ss p50'.padStart(9)} ${'speedup'.padStart(9)}`);
  console.log(`  ${'-'.repeat(50)}`);
  for (const [fam, data] of Object.entries(families).sort((a, b) => a[0].localeCompare(b[0]))) {
    const rgF = stats(data.rg);
    const ssF = stats(data.ss);
    const sp = ssF.p50 > 0 ? (rgF.p50 / ssF.p50).toFixed(2) + 'x' : 'N/A';
    console.log(`  ${fam.padEnd(16)} ${String(data.rg.length).padStart(4)} ${(rgF.p50.toFixed(1) + 'ms').padStart(9)} ${(ssF.p50.toFixed(1) + 'ms').padStart(9)} ${sp.padStart(9)}`);
  }

  // Planner route distribution
  const routes = {};
  for (const pq of perQuery) {
    const route = pq.route || 'unknown';
    const key = route.replace(/:.*/, '');
    routes[key] = (routes[key] || 0) + 1;
  }
  console.log(`\n  Planner routes:`);
  for (const [route, count] of Object.entries(routes).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${route.padEnd(35)} ${count}`);
  }

  allRepoResults.push({ name: repo.name, queries: queries.length, files: fileCount, rgStats: rgS, ssStats: ssS, perQuery, routes });
  search.close?.();
}

// ── Summary ──────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(78));
console.log('  SUMMARY');
console.log('  ' + '-'.repeat(74));
console.log('  ' + 'Repo'.padEnd(16) + 'N'.padStart(5) + 'Files'.padStart(7) +
  'rg p50'.padStart(9) + 'ss p50'.padStart(9) + 'speedup'.padStart(9) +
  'rg avg'.padStart(9) + 'ss avg'.padStart(9) + 'speedup'.padStart(9));
console.log('  ' + '-'.repeat(74));

let totalRg = [], totalSs = [];
for (const r of allRepoResults) {
  const spP50 = (r.rgStats.p50 / r.ssStats.p50).toFixed(2) + 'x';
  const spAvg = (r.rgStats.avg / r.ssStats.avg).toFixed(2) + 'x';
  console.log('  ' +
    r.name.padEnd(16) + String(r.queries).padStart(5) + String(r.files).padStart(7) +
    (r.rgStats.p50.toFixed(0) + 'ms').padStart(9) +
    (r.ssStats.p50.toFixed(0) + 'ms').padStart(9) +
    spP50.padStart(9) +
    (r.rgStats.avg.toFixed(0) + 'ms').padStart(9) +
    (r.ssStats.avg.toFixed(0) + 'ms').padStart(9) +
    spAvg.padStart(9));
  totalRg.push(...r.perQuery.filter(p => p.rgMs !== null).map(p => p.rgMs));
  totalSs.push(...r.perQuery.filter(p => p.ssMs !== null).map(p => p.ssMs));
}

const allRg = stats(totalRg);
const allSs = stats(totalSs);
console.log('  ' + '-'.repeat(74));
console.log('  ' +
  'ALL'.padEnd(16) + String(totalRg.length).padStart(5) + ''.padStart(7) +
  (allRg.p50.toFixed(0) + 'ms').padStart(9) +
  (allSs.p50.toFixed(0) + 'ms').padStart(9) +
  ((allRg.p50 / allSs.p50).toFixed(2) + 'x').padStart(9) +
  (allRg.avg.toFixed(0) + 'ms').padStart(9) +
  (allSs.avg.toFixed(0) + 'ms').padStart(9) +
  ((allRg.avg / allSs.avg).toFixed(2) + 'x').padStart(9));
console.log('═'.repeat(78));

// Win/loss count
let wins = 0, losses = 0, ties = 0;
for (const r of allRepoResults) {
  for (const pq of r.perQuery) {
    if (pq.rgMs == null || pq.ssMs == null) continue;
    if (pq.ssMs < pq.rgMs * 0.95) wins++;
    else if (pq.ssMs > pq.rgMs * 1.05) losses++;
    else ties++;
  }
}
console.log(`\n  Win/Loss (>5% margin): ${wins} wins, ${losses} losses, ${ties} ties out of ${wins + losses + ties}`);
