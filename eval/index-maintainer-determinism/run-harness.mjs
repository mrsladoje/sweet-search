#!/usr/bin/env node
/**
 * Index-maintainer determinism + crash-consistency harness (Plan G0).
 *
 * The USER runs this to byte-diff "flags off" (baseline) vs "flags on"
 * (candidate) for every Tier-1/Tier-2 efficiency lever, and to prove a
 * SIGKILL mid-tick reconverges to a clean run's artifacts (the E.1/E.2
 * crash-consistency gate). Nothing here is production code: it drives the
 * REAL reconciler tick path against a fixed fixture mini-repo + a fixed JSON
 * edit script, then dumps the five artifacts canonically (see
 * `dump-artifacts.mjs`).
 *
 * Determinism strategy: the production reconciler accepts injected
 * `vectorEncoder` / `liEncoder`, so the harness injects pure, hash-derived
 * stub encoders. That removes the GPU/ORT model (the only run-to-run
 * non-determinism source outside the index itself) so any diff that DOES
 * surface is attributable to the index code under test — exactly what the
 * verification plan needs.
 *
 * Usage (CLI):
 *   node eval/index-maintainer-determinism/run-harness.mjs               # baseline vs baseline
 *   node eval/index-maintainer-determinism/run-harness.mjs --candidate SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS=1
 *   node eval/index-maintainer-determinism/run-harness.mjs --kill-after-tick 2
 *
 * Programmatic:
 *   import { runFixedSequence, runBaselineVsCandidate, runCrashConsistency } from './run-harness.mjs';
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { dumpAllArtifacts, byteDiff } from './dump-artifacts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const MINI_REPO = path.join(FIXTURES_DIR, 'mini-repo');
const EDIT_SCRIPT = path.join(FIXTURES_DIR, 'edit-script.json');

const DIRTY_QUEUE = 'index-maintainer-queue.jsonl';

/**
 * Fixed model info for the stub encoders. Small dimension keeps dumps compact;
 * the value is irrelevant to determinism as long as it is constant.
 */
const MODEL_INFO = Object.freeze({
  provider: 'harness',
  model: 'deterministic-stub',
  dimension: 8,
  hnswDimension: 8,
});

const SILENT_LOGGER = { info() {}, warn() {}, error() {} };

// ---------------------------------------------------------------------------
// Deterministic stub encoders (pure: text -> vector, no global RNG)
// ---------------------------------------------------------------------------

/** FNV-1a over a string → uint32. Stable across processes. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Map a text + element index to a stable float in [0,1). Hash-derived so the
 * SAME text always produces the SAME vector — across calls, ticks, and
 * processes — which is the property the determinism harness depends on.
 */
function stubVector(text, dim) {
  const base = fnv1a(text);
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    out[i] = (fnv1a(`${base}:${i}`) % 100003) / 100003;
  }
  return out;
}

async function stubVectorEncoder(texts) {
  return texts.map((text) => stubVector(text, MODEL_INFO.hnswDimension));
}

async function stubLiEncoder(texts) {
  // Each document → a small, fixed-shape, content-derived token matrix.
  return texts.map((text) => {
    const seed = fnv1a(text);
    const numTokens = 2;
    const tokenDim = 4;
    const tokens = [];
    for (let t = 0; t < numTokens; t += 1) {
      const row = new Float32Array(tokenDim);
      for (let d = 0; d < tokenDim; d += 1) {
        row[d] = (fnv1a(`${seed}:${t}:${d}`) % 1000) / 1000;
      }
      tokens.push(row);
    }
    return tokens;
  });
}

// ---------------------------------------------------------------------------
// Fixture / edit-script helpers
// ---------------------------------------------------------------------------

export function loadEditScript() {
  return JSON.parse(fs.readFileSync(EDIT_SCRIPT, 'utf-8'));
}

/** Copy the fixture mini-repo into a fresh temp project root. */
function materializeRepo() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-determinism-'));
  copyDir(MINI_REPO, projectRoot);
  return projectRoot;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** Append dirty-scan-shaped lines to the queue (mirrors dirty-scan.mjs). */
function enqueue(stateDir, rels) {
  fs.mkdirSync(stateDir, { recursive: true });
  const queue = path.join(stateDir, DIRTY_QUEUE);
  const now = Date.now();
  const lines = rels
    .map((rel) => JSON.stringify({ file_path: rel, timestamp: now, queued_at: now, source: 'harness' }))
    .join('\n');
  fs.appendFileSync(queue, lines + '\n');
}

/** Apply one edit step's file ops to the project root. */
function applyEditOps(projectRoot, step) {
  for (const op of step.ops || []) {
    if (op.op === 'write') {
      const abs = path.join(projectRoot, op.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, op.content);
    } else if (op.op === 'delete') {
      try { fs.unlinkSync(path.join(projectRoot, op.path)); } catch {}
    } else if (op.op === 'rename') {
      const from = path.join(projectRoot, op.from);
      const to = path.join(projectRoot, op.to);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      try { fs.renameSync(from, to); } catch {}
    } else {
      throw new Error(`run-harness: unknown edit op '${op.op}'`);
    }
  }
}

// ---------------------------------------------------------------------------
// Env flag plumbing
// ---------------------------------------------------------------------------

/**
 * The full set of candidate env flags this harness understands (so it can diff
 * flag-on vs flag-off for each group). Listing them keeps the harness honest:
 * when a new lever lands, add its flag here and the USER can sweep it.
 */
export const CANDIDATE_FLAGS = Object.freeze([
  'SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS',
  'SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES',
  'SWEET_SEARCH_RECONCILE_LIVE_HNSW',
  'SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS',
  'SWEET_SEARCH_RECONCILE_FTS5_BUDGET',
  'SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE',
  'SWEET_SEARCH_RECONCILE_INCR_VACUUM',
  'SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF',
  'SWEET_SEARCH_RECONCILE_AUTOTUNE',
]);

/**
 * The HNSW level-assignment flag (FIX-B / Plan G1). Pinned ON by default in
 * EVERY child run of this harness — see `resolveEnvOverrides` below.
 */
export const HNSW_DETERMINISM_FLAG = 'SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS';

/**
 * Pin `SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS=1` into the env of BOTH the
 * baseline and candidate child runs unless the caller has already named the
 * flag in `envOverrides`.
 *
 * WHY this is required for a reliable control: the DEFAULT (flag-off) HNSW
 * level RNG is `getRandomLevel()` — an unseeded `Math.random()` drawn at insert
 * time (`binary-hnsw-index.js`), which `load()` never reseeds. Two otherwise
 * identical flags-off runs therefore consume the global RNG stream differently
 * and produce a structurally different `graphByLevel` / `entryPointId`, making
 * the "baseline-vs-baseline byte-identical" control FLAKY (~25–50% red on a
 * clean tree). FIX-B makes the index deterministic-by-id under this flag, so
 * pinning it ON removes the pre-existing RNG noise and isolates every surviving
 * byte-diff to the lever-under-test (the candidate flags in `envOverrides`).
 * It also makes the post-FIX-B batched==per-file claim verifiable here without
 * `entryPointId` ever being normalized away (it is a real comparison field in
 * `dump-artifacts.mjs`).
 *
 * Opt-OUT: a test that specifically exercises the RNG path passes the flag
 * itself in `envOverrides` — any value (including `'0'`, `''`, or `null` to
 * unset it) — and this helper leaves that explicit choice untouched.
 *
 * @param {object} envOverrides  caller-supplied flag overrides
 * @returns {object} a NEW object with the pin merged in (caller obj untouched)
 */
export function resolveEnvOverrides(envOverrides = {}) {
  // An explicit mention of the flag (even set to null/'' to unset) is honored
  // verbatim so the RNG-path opt-out works.
  if (Object.prototype.hasOwnProperty.call(envOverrides, HNSW_DETERMINISM_FLAG)) {
    return { ...envOverrides };
  }
  return { ...envOverrides, [HNSW_DETERMINISM_FLAG]: '1' };
}

/** Snapshot + apply env overrides; returns a restore() that puts them back. */
function withEnv(envOverrides = {}) {
  const saved = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined;
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return function restore() {
    for (const [key, prev] of Object.entries(saved)) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  };
}

// ---------------------------------------------------------------------------
// Core: run the fixed sequence in-process
// ---------------------------------------------------------------------------

/**
 * Build a baseline index of the fixture mini-repo, then replay the edit script
 * through the reconciler tick path, then dump all artifacts canonically.
 *
 * @param {object} opts
 * @param {'baseline'|'candidate'} [opts.variant]   label only (env does the work)
 * @param {object} [opts.envOverrides]              candidate flags, e.g. { SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS: '1' }
 * @param {string} [opts.projectRoot]               reuse an existing materialized repo (crash-restart path)
 * @param {{tick:number}} [opts.stopAfterTick]      stop replaying after this many TICKS (0=baseline only)
 * @param {boolean} [opts.keepRepo]                 do not rm the temp repo (caller cleans up)
 * @param {boolean} [opts.normalizeEpochs]          dense-rank SQLite epochs (crash path)
 * @param {boolean} [opts.liveOnly]                 drop retired rows (crash live-state diff)
 * @returns {Promise<{variant, projectRoot, stateDir, ticksRun, dump, dumpLive}>}
 */
export async function runFixedSequence(opts = {}) {
  const {
    variant = 'baseline',
    envOverrides = {},
    projectRoot: providedRoot = null,
    stopAfterTick = null,
    keepRepo = false,
    normalizeEpochs = false,
    liveOnly = false,
  } = opts;

  // Import the reconciler lazily and AFTER env is set so any module-load-time
  // flag reads see the candidate environment. The HNSW determinism flag is
  // pinned ON (unless the caller opts out) so the byte-diff isolates the
  // lever-under-test from the default level RNG — see `resolveEnvOverrides`.
  const restore = withEnv(resolveEnvOverrides(envOverrides));
  let projectRoot = providedRoot;
  let createdRepo = false;
  try {
    if (!projectRoot) {
      projectRoot = materializeRepo();
      createdRepo = true;
    }
    const stateDir = path.join(projectRoot, '.sweet-search');
    fs.mkdirSync(stateDir, { recursive: true });

    const { runProductionReconcileTick } = await import(
      '../../core/incremental-indexing/application/production-reconciler.mjs'
    );

    const runTick = () =>
      runProductionReconcileTick({
        projectRoot,
        stateDir,
        vectorEncoder: stubVectorEncoder,
        liEncoder: stubLiEncoder,
        modelInfo: MODEL_INFO,
        logger: SILENT_LOGGER,
        config: { filesPerTick: 50, cpuBudgetMs: 600_000 },
      });

    const script = loadEditScript();
    const maxTicks = stopAfterTick == null ? Infinity : stopAfterTick;
    let ticksRun = 0;

    // Tick 1: baseline build (enqueue the base files).
    if (ticksRun < maxTicks) {
      enqueue(stateDir, script.baselineEnqueue);
      await runTick();
      ticksRun += 1;
    }

    // Subsequent ticks: one per edit-script step.
    for (const step of script.steps) {
      if (ticksRun >= maxTicks) break;
      applyEditOps(projectRoot, step);
      enqueue(stateDir, step.enqueue);
      await runTick();
      ticksRun += 1;
    }

    const dump = await dumpAllArtifacts(stateDir, { normalizeEpochs });
    // The live-only dump (retired rows dropped) is what a searcher sees; the
    // crash path compares it to assert the *queryable* index reconverged.
    const dumpLive = liveOnly
      ? await dumpAllArtifacts(stateDir, { normalizeEpochs, liveOnly: true })
      : null;
    return { variant, projectRoot, stateDir, ticksRun, dump, dumpLive };
  } finally {
    restore();
    if (createdRepo && !keepRepo) {
      try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Baseline-vs-candidate diff
// ---------------------------------------------------------------------------

/**
 * Run the fixed sequence twice — baseline (flags off) and candidate (flags on)
 * — and byte-diff their canonical dumps.
 *
 * @param {object} [envOverrides]  candidate flags
 * @returns {Promise<{diff, baseline, candidate}>}  diff is null when identical
 */
export async function runBaselineVsCandidate(envOverrides = {}) {
  const baseline = await runFixedSequence({ variant: 'baseline', envOverrides: {} });
  const candidate = await runFixedSequence({ variant: 'candidate', envOverrides });
  const diff = byteDiff(baseline.dump, candidate.dump);
  return { diff, baseline, candidate };
}

// ---------------------------------------------------------------------------
// Crash-consistency mode (SIGKILL mid-sequence in a child, restart, assert)
// ---------------------------------------------------------------------------

/**
 * Crash-consistency: run the sequence up to (but not through) tick `killTick`
 * in a CHILD process, SIGKILL the child mid-way, then in THIS process restart
 * the reconciler against the same state dir, drain the remaining ticks, and
 * assert the final artifacts equal a clean (uninterrupted) run's.
 *
 * The child is killed via SIGKILL while the tick is in flight (it busy-runs the
 * tick path with a self-kill timer), reproducing a maintainer crash between the
 * SQLite commit and the HNSW batch-save that the E.1/E.2 levers must survive.
 *
 * Two diffs are returned:
 *   - `liveDiff`: the QUERYABLE index (retired rows dropped, epochs ranked).
 *     This MUST be null — a crash must never lose or corrupt a live row.
 *   - `strictDiff`: the full on-disk artifacts. May be non-null on the per-file
 *     code path because re-reconciling a crashed tick can leave an extra
 *     MVCC-retired (invisible) row — the persist-before-advance residue that
 *     G2's batching + manifest-gating is designed to eliminate. Informational
 *     for G0; G2 drives it to null.
 *
 * @param {object} opts
 * @param {number} [opts.killTick]      1-based tick index to crash within (default 2)
 * @param {object} [opts.envOverrides]  candidate flags to apply to BOTH child + restart + clean run
 * @returns {Promise<{liveDiff, strictDiff, ticksBeforeKill, ticksAfterRestart, childSignal, childStatus}>}
 */
export async function runCrashConsistency(opts = {}) {
  const { killTick = 2, envOverrides = {} } = opts;

  // 1) Materialize a repo the child + restart will share.
  const projectRoot = materializeRepo();
  const stateDir = path.join(projectRoot, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });

  try {
    // 2) Child: replay ticks, then SIGKILL itself mid-`killTick`.
    const child = spawnSync(
      process.execPath,
      [__filename, '--child-crash', String(killTick), projectRoot, JSON.stringify(envOverrides)],
      { encoding: 'utf-8', timeout: 120_000 },
    );
    // The child self-SIGKILLs, so a null/SIGKILL signal is EXPECTED, not an error.
    const ticksBeforeKill = readChildTickCount(stateDir);

    // 3) Restart in-process against the crashed state dir; drain remaining ticks
    //    by replaying the full sequence (the reconciler skips already-applied
    //    work via content hashing + the merkle state).
    const restarted = await runFixedSequence({
      variant: 'restart',
      envOverrides,
      projectRoot,
      keepRepo: true,
      normalizeEpochs: true,
      liveOnly: true,
    });

    // 4) Clean run in a fresh repo with the same flags.
    const clean = await runFixedSequence({
      variant: 'clean',
      envOverrides,
      normalizeEpochs: true,
      liveOnly: true,
    });

    const liveDiff = byteDiff(restarted.dumpLive, clean.dumpLive);
    const strictDiff = byteDiff(restarted.dump, clean.dump);
    return {
      liveDiff,
      strictDiff,
      ticksBeforeKill,
      ticksAfterRestart: restarted.ticksRun,
      childSignal: child.signal ?? null,
      childStatus: child.status ?? null,
    };
  } finally {
    try { fs.rmSync(projectRoot, { recursive: true, force: true }); } catch {}
  }
}

function readChildTickCount(stateDir) {
  try {
    const metrics = path.join(stateDir, 'reconcile-metrics.jsonl');
    const lines = fs.readFileSync(metrics, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Child entrypoint: run N-1 ticks cleanly, then crash mid-tick N
// ---------------------------------------------------------------------------

async function childCrashMain(killTick, projectRoot, envJson) {
  const envOverrides = JSON.parse(envJson || '{}');
  // Apply the SAME HNSW determinism pin the in-process restart + clean run use
  // (`runFixedSequence` → `resolveEnvOverrides`), so the crashed child and the
  // restart agree on level assignment and the crash-consistency diff reflects
  // durability, not pre-existing RNG noise.
  const restore = withEnv(resolveEnvOverrides(envOverrides));
  const stateDir = path.join(projectRoot, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });

  const { runProductionReconcileTick } = await import(
    '../../core/incremental-indexing/application/production-reconciler.mjs'
  );
  const script = loadEditScript();

  const runTick = (onProgress) =>
    runProductionReconcileTick({
      projectRoot,
      stateDir,
      vectorEncoder: stubVectorEncoder,
      liEncoder: stubLiEncoder,
      modelInfo: MODEL_INFO,
      logger: SILENT_LOGGER,
      onProgress,
      config: { filesPerTick: 50, cpuBudgetMs: 600_000 },
    });

  let ticks = 0;
  const stepsAsTicks = [{ baseline: true }, ...script.steps];
  for (const entry of stepsAsTicks) {
    const tickNumber = ticks + 1;
    if (!entry.baseline) applyEditOps(projectRoot, entry);
    enqueue(stateDir, entry.baseline ? script.baselineEnqueue : entry.enqueue);

    if (tickNumber === killTick) {
      // Crash WHILE this tick is being applied: self-SIGKILL the moment the
      // reconciler reports it has written SQLite vectors but before the tick
      // completes. This reproduces "SQLite committed, HNSW batch unsaved".
      await runTick((phase) => {
        if (phase === 'production:vector-written') {
          process.kill(process.pid, 'SIGKILL');
        }
      });
      // Unreachable if the kill fired; if the phase never arrived, fall through.
      process.exit(0);
    }
    await runTick();
    ticks += 1;
  }
  restore();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseEnvArgs(args) {
  const env = {};
  for (const a of args) {
    const m = a.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function cliMain(argv) {
  const args = argv.slice(2);

  if (args[0] === '--child-crash') {
    await childCrashMain(Number(args[1]), args[2], args[3]);
    return;
  }

  if (args.includes('--kill-after-tick')) {
    const idx = args.indexOf('--kill-after-tick');
    const killTick = Number(args[idx + 1]) || 2;
    const env = parseEnvArgs(args);
    const res = await runCrashConsistency({ killTick, envOverrides: env });
    if (res.liveDiff) {
      console.error('CRASH-CONSISTENCY FAIL: live (queryable) index diverged from a clean run');
      console.error(JSON.stringify(res.liveDiff, null, 2));
      process.exit(1);
    }
    console.log(
      `CRASH-CONSISTENCY PASS: live index reconverged to a clean run ` +
      `(ticksBeforeKill=${res.ticksBeforeKill}, ticksAfterRestart=${res.ticksAfterRestart}).`,
    );
    if (res.strictDiff) {
      console.log(
        'NOTE: strict (incl. retired rows) diff is non-null — expected per-file crash residue ' +
        '(an extra MVCC-invisible row). G2 persist-before-advance drives this to null:',
      );
      console.log(JSON.stringify(res.strictDiff, null, 2));
    } else {
      console.log('NOTE: strict diff is ALSO null (no retired-row residue).');
    }
    return;
  }

  const candidateIdx = args.indexOf('--candidate');
  const envOverrides = candidateIdx >= 0 ? parseEnvArgs(args.slice(candidateIdx + 1)) : {};
  const { diff } = await runBaselineVsCandidate(envOverrides);
  if (diff) {
    console.error('BYTE-DIFF: baseline and candidate diverge');
    console.error(JSON.stringify(diff, null, 2));
    process.exit(1);
  }
  console.log(
    Object.keys(envOverrides).length === 0
      ? 'BYTE-DIFF CLEAN: baseline == baseline (control passed).'
      : `BYTE-DIFF CLEAN: candidate == baseline for ${JSON.stringify(envOverrides)}.`,
  );
}

// Run as CLI only when invoked directly (not when imported by tests).
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  cliMain(process.argv).catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}

export const __testing = {
  MODEL_INFO,
  stubVectorEncoder,
  stubLiEncoder,
  stubVector,
  fnv1a,
  materializeRepo,
  enqueue,
  applyEditOps,
};
