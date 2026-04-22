#!/usr/bin/env node
/**
 * Benchmark: does the daemon-prewarm SessionStart hook make the first query
 * faster for the user?
 *
 * The hook runs in background during SessionStart — spawns a detached daemon
 * that loads models + indexes while the user reads Claude's first response.
 * By the time the user types their first `sweet-search <query>`, the daemon
 * should already be up.
 *
 * Design:
 *   For each trial:
 *     1. Kill any running daemon. Clean socket.
 *     2. (prewarm condition) Run session-daemon-prewarm.mjs — exits in ms,
 *        leaves a detached daemon loading in the background.
 *        (baseline condition) No-op.
 *     3. Wait WAIT_MS (simulating the delay before the user's first query).
 *     4. Issue first lexical query via the CLI. Retry until result comes back.
 *        Stop timing on first result.
 *     5. Issue N more lexical queries to the daemon. Time each.
 *     6. Stop daemon.
 *
 * Why lexical queries:
 *   - Semantic search is broken on this branch (embedding.slice error); lexical
 *     exercises the daemon's socket + FTS5 path cleanly.
 *
 * The WAIT_MS gap matters: if the user queries before the daemon finishes
 * loading, the retry loop captures the remaining spin-up cost. If the daemon
 * had enough time, the first query hits the warm path.
 */

import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const TRIALS = parseInt(process.env.BENCH_TRIALS ?? '6', 10);
const MAX_WAIT_MS = 30_000;
const RETRY_SLEEP_MS = 100;
// Simulated gap between SessionStart and user's first query. 5s is the
// realistic floor (reading Claude's first response + typing a question).
const WAIT_MS = parseInt(process.env.BENCH_WAIT_MS ?? '5000', 10);

const QUERIES = [
  'LateInteractionIndex',
  'HNSWIndex',
  'vocab warmer',
  'embedding cache',
  'session preheat',
  'search server',
  'dedup fingerprint',
];

// -----------------------------------------------------------------------
// Subprocess helpers
// -----------------------------------------------------------------------

function runTimed(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const p = spawn(cmd, args, { cwd: REPO_ROOT, stdio: 'pipe', ...opts });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('exit', (code) => resolve({ wallMs: performance.now() - t0, code, stdout, stderr }));
  });
}

async function stopServer() {
  spawnSync('node', ['core/cli.js', '--stop'], { cwd: REPO_ROOT, stdio: 'pipe' });
  await new Promise((r) => setTimeout(r, 300));
  const pg = spawnSync('pgrep', ['-f', 'core/start-server.js'], { stdio: 'pipe' });
  for (const pid of pg.stdout.toString().trim().split('\n').filter(Boolean)) {
    try { process.kill(Number(pid), 'SIGKILL'); } catch {}
  }
  spawnSync('rm', ['-f', '/tmp/sweet-search-server.pid', '/tmp/sweet-search.sock'], { stdio: 'pipe' });
  await new Promise((r) => setTimeout(r, 500));
}

function looksReady(stdout) {
  // Results JSON present and not a "starting" placeholder.
  if (/"status":"starting"|"Server is starting"/.test(stdout)) return false;
  return stdout.includes('"results"');
}

async function measureFirstQuery(query) {
  const t0 = performance.now();
  const deadline = t0 + MAX_WAIT_MS;
  let attempts = 0;
  while (performance.now() < deadline) {
    attempts++;
    const r = await runTimed('node', ['core/cli.js', query, '--top', '1', '--mode', 'lexical', '--json']);
    if (looksReady(r.stdout)) {
      return { wallMs: performance.now() - t0, attempts };
    }
    await new Promise((res) => setTimeout(res, RETRY_SLEEP_MS));
  }
  return { wallMs: performance.now() - t0, attempts, timedOut: true };
}

async function measureWarmQuery(query) {
  const r = await runTimed('node', ['core/cli.js', query, '--top', '1', '--mode', 'lexical', '--json']);
  return { wallMs: r.wallMs, ok: looksReady(r.stdout) };
}

// -----------------------------------------------------------------------
// Trial
// -----------------------------------------------------------------------

async function runTrial(condition) {
  await stopServer();

  let prewarmMs = null;
  if (condition === 'prewarm') {
    // Detach a daemon in the background. Script exits in ~ms.
    const r = await runTimed('node', ['core/search/session-daemon-prewarm.mjs']);
    prewarmMs = r.wallMs;
  }

  // Simulate the SessionStart → first-query gap. Both conditions wait the
  // same amount so the comparison is apples-to-apples. In the prewarm case
  // the daemon is loading during this wait; in the baseline case nothing
  // is happening.
  await new Promise((r) => setTimeout(r, WAIT_MS));

  // Query 1: if daemon isn't up yet, spin it up + first result. If it is,
  // this measures the warm-query time.
  const first = await measureFirstQuery(QUERIES[0]);
  if (first.timedOut) {
    return { condition, prewarmMs, firstMs: first.wallMs, timedOut: true };
  }

  // Queries 2..N: warm daemon
  const warmTimes = [];
  for (let i = 1; i < QUERIES.length; i++) {
    const r = await measureWarmQuery(QUERIES[i]);
    warmTimes.push(r.wallMs);
  }

  return { condition, prewarmMs, firstMs: first.wallMs, firstAttempts: first.attempts, warmTimes };
}

function p(arr, pct) {
  if (arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length * pct) / 100))];
}

function fmt(ms) {
  if (ms == null || Number.isNaN(ms)) return '   —  ';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(0)}ms`;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

async function main() {
  console.log(`Running ${TRIALS} trials × 2 conditions (lexical queries, cold daemon per trial)`);
  console.log(`Simulated wait between SessionStart and first query: ${WAIT_MS}ms`);
  console.log(`Each trial: 1 first query + ${QUERIES.length - 1} follow-up queries.\n`);

  const results = [];
  for (let t = 0; t < TRIALS; t++) {
    const order = t % 2 === 0 ? ['baseline', 'prewarm'] : ['prewarm', 'baseline'];
    for (const condition of order) {
      process.stderr.write(`[trial ${t + 1}/${TRIALS}] ${condition.padEnd(9)} `);
      const r = await runTrial(condition);
      results.push({ trial: t, ...r });
      if (r.timedOut) {
        process.stderr.write(`TIMED OUT after ${fmt(r.firstMs)} (${r.firstAttempts ?? '?'} attempts)\n`);
      } else {
        process.stderr.write(
          `prewarm=${fmt(r.prewarmMs ?? 0).padStart(7)}  first=${fmt(r.firstMs).padStart(7)}  warm-p50=${fmt(p(r.warmTimes, 50)).padStart(6)}\n`
        );
      }
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Aggregate (excludes timed-out trials)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const cond of ['baseline', 'prewarm']) {
    const runs = results.filter((r) => r.condition === cond && !r.timedOut);
    const firsts = runs.map((r) => r.firstMs);
    const warms = runs.flatMap((r) => r.warmTimes ?? []);
    const prewarms = runs.map((r) => r.prewarmMs).filter((x) => x != null);

    console.log(`${cond.toUpperCase()}  (n=${runs.length})`);
    if (prewarms.length) {
      console.log(`  prewarm hook exits in:                      p50=${fmt(p(prewarms, 50))}  (detached daemon keeps loading in background)`);
    }
    if (firsts.length) {
      console.log(`  first query after ${WAIT_MS}ms wait:              p50=${fmt(p(firsts, 50))}  p95=${fmt(p(firsts, 95))}  min=${fmt(Math.min(...firsts))}  max=${fmt(Math.max(...firsts))}`);
    }
    if (warms.length) {
      console.log(`  follow-up queries (daemon already up):      p50=${fmt(p(warms, 50))}  p95=${fmt(p(warms, 95))}`);
    }
    console.log();
  }

  const baseline = results.filter((r) => r.condition === 'baseline' && !r.timedOut);
  const prewarmRuns = results.filter((r) => r.condition === 'prewarm' && !r.timedOut);

  if (baseline.length === 0 || prewarmRuns.length === 0) {
    console.log('Insufficient successful trials to compute verdict.');
  } else {
    const baseFirstP50 = p(baseline.map((r) => r.firstMs), 50);
    const prewarmFirstP50 = p(prewarmRuns.map((r) => r.firstMs), 50);
    const baseWarmP50 = p(baseline.flatMap((r) => r.warmTimes), 50);
    const prewarmWarmP50 = p(prewarmRuns.flatMap((r) => r.warmTimes), 50);
    const speedup = baseFirstP50 - prewarmFirstP50;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Verdict (first-query latency after ${WAIT_MS}ms SessionStart→query gap)`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`  first query p50,  baseline → prewarm: ${fmt(baseFirstP50)} → ${fmt(prewarmFirstP50)}  (Δ ${speedup >= 0 ? '+' : ''}${fmt(speedup)} ${speedup > 0 ? 'faster' : 'slower'})`);
    console.log(`  follow-up p50,    baseline → prewarm: ${fmt(baseWarmP50)} → ${fmt(prewarmWarmP50)}  (Δ ${baseWarmP50 - prewarmWarmP50 >= 0 ? '+' : ''}${fmt(baseWarmP50 - prewarmWarmP50)})`);
    console.log();
    if (speedup >= 500) {
      console.log(`  → Net positive: prewarm saves ~${fmt(speedup)} on first query.`);
    } else if (speedup <= -200) {
      console.log(`  → Net negative: prewarm makes first query slower.`);
    } else {
      console.log(`  → No meaningful first-query effect at this wait time.`);
    }
  }

  const outDir = join(REPO_ROOT, '.sweet-search');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'bench-prewarm-results.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), trials: TRIALS, queries: QUERIES, results }, null, 2)
  );
  console.log(`Raw results: ${join(outDir, 'bench-prewarm-results.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
