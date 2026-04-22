#!/usr/bin/env node
/**
 * Benchmark: does the SessionStart prewarm hook measurably speed up the
 * first post-SessionStart query?
 *
 * Realistic scenario:
 *   1. SessionStart fires (daemon not running yet)
 *   2. (Optionally) preheat hook runs
 *   3. User issues first sweet-search query → daemon spins up → responds
 *   4. Subsequent queries hit the warm daemon
 *
 * We care about the wall time between (3) invocation and first usable result.
 *
 * Confounds (documented, not eliminated):
 *   - No sudo, so we can't `purge` between trials. OS page cache pollution
 *     between conditions is handled by interleaving and multiple trials.
 *   - The preheat ran on THIS host means the HNSW mmap pages were already
 *     warm from prior work. Each "baseline" trial still benefits from
 *     whatever happened before it.
 */

import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const QUERIES = [
  'late interaction reranking',
  'HNSW index mmap loading',
  'vocabulary prewarming',
  'embedding cache lookup',
  'session preheat hook',
  'search server startup',
  'dedup fingerprint matching',
  'CoreML cascade variant',
];

const TRIALS = parseInt(process.env.BENCH_TRIALS ?? '5', 10);
const RETRY_SLEEP_MS = 100;
const MAX_WAIT_MS = 30_000;

// -----------------------------------------------------------------------
// Subprocess helpers
// -----------------------------------------------------------------------

function runTimed(cmd, args, { timeout = 60_000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const p = spawn(cmd, args, { cwd: REPO_ROOT, stdio: 'pipe' });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const to = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('exit', (code) => {
      clearTimeout(to);
      resolve({ wallMs: performance.now() - t0, code, stdout, stderr });
    });
  });
}

async function stopServer() {
  // Graceful stop first.
  spawnSync('node', ['core/cli.js', '--stop'], { cwd: REPO_ROOT, stdio: 'pipe' });
  await new Promise((r) => setTimeout(r, 300));
  // Paranoid: the daemon sometimes fails to exit (busy loading a model).
  // Find any lingering start-server.js process and SIGKILL it, clear socket/pid.
  try {
    const psResult = spawnSync('pgrep', ['-f', 'core/start-server.js'], { stdio: 'pipe' });
    const pids = psResult.stdout.toString().trim().split('\n').filter(Boolean);
    for (const pid of pids) {
      try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
    }
  } catch { /* pgrep unavailable, skip */ }
  spawnSync('rm', ['-f', '/tmp/sweet-search-server.pid', '/tmp/sweet-search.sock'], { stdio: 'pipe' });
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * Measure time from invocation until the first successful query response.
 * Retries on "starting" responses since the native CLI returns immediately
 * while the daemon spins up.
 */
async function measureColdQuery(query) {
  const t0 = performance.now();
  const deadline = t0 + MAX_WAIT_MS;
  let attempts = 0;
  while (performance.now() < deadline) {
    attempts++;
    const r = await runTimed('node', ['core/cli.js', query, '--top', '3', '--json']);
    const isStarting = /"status":"starting"|"error":"Server is starting/.test(r.stdout);
    if (!isStarting && r.code === 0 && r.stdout.includes('"results"')) {
      return { wallMs: performance.now() - t0, attempts };
    }
    await new Promise((res) => setTimeout(res, RETRY_SLEEP_MS));
  }
  return { wallMs: performance.now() - t0, attempts, timedOut: true };
}

async function measureWarmQuery(query) {
  const r = await runTimed('node', ['core/cli.js', query, '--top', '3', '--json']);
  return { wallMs: r.wallMs, ok: r.stdout.includes('"results"') };
}

// -----------------------------------------------------------------------
// Trial
// -----------------------------------------------------------------------

async function runTrial(condition) {
  await stopServer();

  let preheatMs = null;
  if (condition === 'preheat') {
    const r = await runTimed('node', ['core/search/session-preheat-hook.mjs']);
    preheatMs = r.wallMs;
  }

  // First query — includes daemon spin-up
  const first = await measureColdQuery(QUERIES[0]);

  // Remaining queries — should hit the now-warm daemon
  const warmTimes = [];
  for (let i = 1; i < QUERIES.length; i++) {
    const r = await measureWarmQuery(QUERIES[i]);
    warmTimes.push(r.wallMs);
  }

  return { condition, preheatMs, firstMs: first.wallMs, firstAttempts: first.attempts, warmTimes };
}

function p(arr, pct) {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length * pct) / 100))];
}

function fmt(ms) {
  if (Number.isNaN(ms)) return '   —  ';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(0)}ms`;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

async function main() {
  console.log(`Running ${TRIALS} trials × 2 conditions × ${QUERIES.length} queries`);
  console.log(`Interleaved ordering, results include noise from OS page cache carryover.\n`);

  const results = [];

  for (let t = 0; t < TRIALS; t++) {
    const order = t % 2 === 0 ? ['baseline', 'preheat'] : ['preheat', 'baseline'];
    for (const condition of order) {
      process.stderr.write(`[trial ${t + 1}/${TRIALS}] ${condition.padEnd(9)} `);
      const r = await runTrial(condition);
      results.push({ trial: t, ...r });
      process.stderr.write(
        `preheat=${fmt(r.preheatMs ?? 0).padStart(7)}  first=${fmt(r.firstMs).padStart(7)}  ` +
          `warm-p50=${fmt(p(r.warmTimes, 50)).padStart(6)}\n`
      );
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Aggregate results');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const cond of ['baseline', 'preheat']) {
    const runs = results.filter((r) => r.condition === cond);
    const firsts = runs.map((r) => r.firstMs);
    const warms = runs.flatMap((r) => r.warmTimes);
    const preheats = runs.map((r) => r.preheatMs).filter((x) => x != null);

    console.log(cond.toUpperCase());
    if (preheats.length) {
      console.log(`  preheat overhead:     p50=${fmt(p(preheats, 50))}  p95=${fmt(p(preheats, 95))}`);
    }
    console.log(
      `  first query (cold):   p50=${fmt(p(firsts, 50))}  p95=${fmt(p(firsts, 95))}  min=${fmt(Math.min(...firsts))}  max=${fmt(Math.max(...firsts))}`
    );
    console.log(`  warm queries:         p50=${fmt(p(warms, 50))}  p95=${fmt(p(warms, 95))}`);
    console.log();
  }

  const baseline = results.filter((r) => r.condition === 'baseline').map((r) => r.firstMs);
  const preheat = results.filter((r) => r.condition === 'preheat').map((r) => r.firstMs);
  const preheatCosts = results.filter((r) => r.condition === 'preheat').map((r) => r.preheatMs);

  const baselineP50 = p(baseline, 50);
  const preheatP50 = p(preheat, 50);
  const preheatCostP50 = p(preheatCosts, 50);
  const rawDelta = baselineP50 - preheatP50;
  const netDelta = rawDelta - preheatCostP50;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Verdict');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`  First-query latency, baseline p50:  ${fmt(baselineP50)}`);
  console.log(`  First-query latency, preheat p50:   ${fmt(preheatP50)}`);
  console.log(`  Raw speedup (baseline - preheat):   ${rawDelta >= 0 ? '+' : ''}${fmt(rawDelta)}`);
  console.log(`  Preheat hook cost:                  ${fmt(preheatCostP50)}`);
  console.log(`  Net savings (speedup - cost):       ${netDelta >= 0 ? '+' : ''}${fmt(netDelta)}`);
  console.log();
  if (netDelta >= 50) {
    console.log(`  → Net positive: preheat reduces perceived first-query latency.`);
  } else if (netDelta <= -50) {
    console.log(`  → Net negative: preheat costs more than it saves. Consider removing.`);
  } else {
    console.log(`  → No meaningful effect: preheat within noise. Consider removing.`);
  }

  // Persist JSON for later analysis
  const outDir = join(REPO_ROOT, '.sweet-search');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'bench-preheat-results.json');
  writeFileSync(
    outPath,
    JSON.stringify(
      { timestamp: new Date().toISOString(), trials: TRIALS, queries: QUERIES, results },
      null,
      2
    )
  );
  console.log(`\nRaw results: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
