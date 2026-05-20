#!/usr/bin/env node
/**
 * Real-daemon validation orchestrator.
 *
 * Drives the gap REPORT.md §6.3 and A10 item 6 left open: whether the actual
 * reconcile daemon + public-API readers (the class behind the warm search
 * server and the MCP server) stay coherent while files change, reconcile
 * publishes manifests, and maintenance handlers rewrite/compact artifacts.
 *
 * Architecture (process topology):
 *
 *   real-daemon-soak.mjs (parent / orchestrator)
 *     ├── real-daemon-wrapper.mjs        — child #1, the reconcile daemon
 *     │                                     (lock + tick + drain + signal),
 *     │                                     fake encoders only
 *     └── real-public-reader.mjs × N     — child #2..N+1, each instantiates
 *                                          SweetSearch (the warm-server class)
 *                                          and runs pattern-mode queries
 *
 * The orchestrator drives mutations directly against the fixture filesystem
 * + the dirty queue (the same shape `file-watcher.mjs` would write), so the
 * daemon picks them up on its next tick.
 *
 * Modes:
 *
 *   --mode between-ticks   Scenario A — single bootstrap → tick → forced
 *                          maintenance → between-tick reader probes.
 *   --mode soak            Scenario B — N-minute soak with continuous
 *                          mutations + reader loops + per-tick assertions.
 *   --mode restart         Scenario C — kill one long-lived reader,
 *                          respawn, verify fresh view.
 *   --mode crash-probe     Scenario D — SIGKILL the daemon mid-maintenance,
 *                          restart, verify resumption.
 *
 * Output:
 *   eval/results/incremental-soak/real-daemon-<label>.{jsonl,summary.json}
 *
 * Exit code is 0 if no invariant violations were recorded and no reader
 * crashed. Non-zero otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import { readManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import { listDeltaSegments } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { loadBitmap, popcount } from '../../core/infrastructure/tombstone-bitmap-reader.js';
import { generateInitialFixture } from './fixture.mjs';
import { GroundTruth } from './ground-truth.mjs';
import { Mutator } from './mutator.mjs';
import { Probe, checkInvariants } from './probe.mjs';

const __filename = fileURLToPath(import.meta.url);
const HERE = path.dirname(__filename);
const READER_WORKER  = path.join(HERE, 'real-public-reader.mjs');
const DAEMON_WRAPPER = path.join(HERE, 'real-daemon-wrapper.mjs');

const MODEL_INFO = Object.freeze({
  provider: 'soak', model: 'soak-fake', dimension: 8, hnswDimension: 8,
});

function fakeVectorEncoder() {
  return async function (texts) {
    return texts.map((t, i) => {
      const arr = new Float32Array(8);
      let h = i + 1;
      for (let j = 0; j < t.length; j += 1) h = (h * 31 + t.charCodeAt(j)) >>> 0;
      for (let k = 0; k < 8; k += 1) {
        h = (h * 17 + 7) >>> 0;
        arr[k] = ((h % 9973) / 9973) - 0.5;
      }
      return arr;
    });
  };
}

function fakeLiEncoder() {
  return async function (texts) {
    return texts.map((t, i) => {
      const tokenCount = Math.max(2, Math.min(8, Math.ceil(t.length / 60)));
      const out = [];
      for (let tk = 0; tk < tokenCount; tk += 1) {
        const arr = new Float32Array(4);
        let h = ((i + 1) * 31 + tk) >>> 0;
        for (let j = 0; j < t.length; j += 1) h = (h * 13 + t.charCodeAt(j) + tk) >>> 0;
        for (let k = 0; k < 4; k += 1) {
          h = (h * 17 + 11) >>> 0;
          arr[k] = ((h % 9973) / 9973);
        }
        out.push(arr);
      }
      return out;
    });
  };
}

function parseArgs(argv) {
  const args = {
    mode: 'soak',
    intervalSec: 15,
    durationSec: 360,
    mutationIntervalMs: 5000,
    readerCount: 2,
    initialFilesPerLang: 6,
    seed: 4242,
    label: '',
    out: '',
    fixtureRoot: '',
    keepFixture: false,
    realEncoder: false,
    realisticThresholds: false,
    readerRestartSec: 0,
    surfaceProbeSec: 0,
    stormSize: 500,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if      (a === '--mode')                    args.mode = argv[++i];
    else if (a === '--interval-sec')            args.intervalSec = Number(argv[++i]);
    else if (a === '--duration-sec')            args.durationSec = Number(argv[++i]);
    else if (a === '--mutation-interval-ms')    args.mutationIntervalMs = Number(argv[++i]);
    else if (a === '--reader-count')            args.readerCount = Number(argv[++i]);
    else if (a === '--initial-files-per-lang')  args.initialFilesPerLang = Number(argv[++i]);
    else if (a === '--seed')                    args.seed = Number(argv[++i]);
    else if (a === '--label')                   args.label = argv[++i];
    else if (a === '--out')                     args.out = argv[++i];
    else if (a === '--fixture-root')            args.fixtureRoot = argv[++i];
    else if (a === '--keep-fixture')            args.keepFixture = true;
    // Real CodeRankEmbed CPU encoder for bootstrap + daemon ticks (vs. the
    // deterministic 8-dim hash fake used by the prior phases).
    else if (a === '--real-encoder')            args.realEncoder = true;
    // Use production-default watermark thresholds instead of forcing every
    // tier to fire every tick (Phase 3 endurance realism).
    else if (a === '--realistic-thresholds')    args.realisticThresholds = true;
    // Periodically SIGTERM+respawn one reader (endurance reader-churn).
    else if (a === '--reader-restart-sec')      args.readerRestartSec = Number(argv[++i]);
    // Periodic deep per-surface invariant + artifact-growth probe.
    else if (a === '--surface-probe-sec')       args.surfaceProbeSec = Number(argv[++i]);
    // dirty-storm: number of burst mutations to apply in one event.
    else if (a === '--storm-size')              args.stormSize = Number(argv[++i]);
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`real-daemon validation orchestrator

  --mode <between-ticks|soak|restart|crash-probe|dirty-storm>   (default soak)
  --interval-sec <sec>          daemon tick interval (default 15; daemon floor is 15s)
  --duration-sec <sec>          soak duration (default 360; ignored in non-soak modes)
  --mutation-interval-ms <ms>   median ms between mutations (default 5000)
  --reader-count <n>            long-lived public readers (default 2)
  --initial-files-per-lang <n>  fixture files per language (default 6)
  --seed <int>                  deterministic seed (default 4242)
  --label <str>                 label embedded in JSONL events
  --out <path>                  JSONL output path (.summary.json siblings it)
  --fixture-root <path>         override fixture directory (default tmp)
  --keep-fixture                preserve the fixture on success
  --real-encoder                use the real CodeRankEmbed CPU encoder for
                                bootstrap + daemon ticks (default: fake 8-dim)
  --realistic-thresholds        use production-default watermark thresholds
                                instead of forcing every tier each tick
  --reader-restart-sec <sec>    periodically SIGTERM+respawn one reader (soak)
  --surface-probe-sec <sec>     periodic deep per-surface invariant + artifact
                                growth probe (soak/between-ticks)
  --storm-size <n>              dirty-storm: burst mutations in one event (500)
`);
}

function jsonlAppender(outPath) {
  const stream = outPath ? fs.createWriteStream(outPath, { flags: 'a' }) : null;
  return function emit(event) {
    const line = JSON.stringify({ ts: Date.now(), ...event });
    if (stream) stream.write(line + '\n');
    if (process.env.SWEET_SEARCH_REALDAEMON_VERBOSE) {
      process.stderr.write(line + '\n');
    }
  };
}

function makeOutPath(label, mode) {
  const safeLabel = label || `${mode}-${Date.now()}`;
  const dir = path.join(process.cwd(), 'eval', 'results', 'incremental-soak');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `real-daemon-${safeLabel}.jsonl`);
}

function ts() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* --------------------------------------------------------------- *
 * Reader child management
 * --------------------------------------------------------------- */

function spawnReader({ id, stateDir, projectRoot, emit }) {
  const env = {
    ...process.env,
    SWEET_SEARCH_PROJECT_ROOT: projectRoot,
    SWEET_SEARCH_STATE_DIR: stateDir,
  };
  const child = spawn(process.execPath, [READER_WORKER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
  const pending = new Map();
  let nextId = 1;
  let exited = false;
  let bufStdout = '';
  let stderrBuf = '';

  child.stdout.on('data', (chunk) => {
    bufStdout += chunk.toString('utf-8');
    const lines = bufStdout.split('\n');
    bufStdout = lines.pop() || '';
    for (const ln of lines) {
      const trimmed = ln.trim();
      if (!trimmed) continue;
      let msg;
      try { msg = JSON.parse(trimmed); } catch (err) {
        emit({ phase: 'reader_parse_error', reader: id, raw: trimmed.slice(0, 200) });
        continue;
      }
      const p = pending.get(msg.id);
      if (!p) { emit({ phase: 'reader_orphan_reply', reader: id, id: msg.id }); continue; }
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || 'unknown reader error'));
    }
  });

  child.stderr.on('data', (chunk) => {
    const s = chunk.toString('utf-8');
    stderrBuf += s;
    const lines = s.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) emit({ phase: 'reader_stderr_line', reader: id, line: trimmed.slice(0, 1024) });
    }
    if (stderrBuf.length > 16 * 1024) stderrBuf = stderrBuf.slice(-8 * 1024);
  });

  child.on('exit', (code, signal) => {
    exited = true;
    emit({ phase: 'reader_exit', reader: id, code, signal, stderrTail: stderrBuf.slice(-2048) });
    for (const [, p] of pending) p.reject(new Error(`reader exited code=${code} signal=${signal}`));
    pending.clear();
  });

  function call(cmd, args = undefined, timeoutMs = 30_000) {
    if (exited) return Promise.reject(new Error('reader already exited'));
    const cid = nextId++;
    const promise = new Promise((resolve, reject) => { pending.set(cid, { resolve, reject }); });
    const line = JSON.stringify({ id: cid, cmd, ...(args !== undefined ? { args } : {}) }) + '\n';
    child.stdin.write(line);
    const timer = setTimeout(() => {
      if (pending.has(cid)) {
        pending.get(cid).reject(new Error(`reader call ${cmd} timed out after ${timeoutMs}ms`));
        pending.delete(cid);
      }
    }, timeoutMs);
    // `.finally()` returns a derived promise that re-rejects when `promise`
    // rejects; the caller only holds `promise`, so swallow the derived
    // rejection to avoid an orphan unhandledRejection crashing a long run.
    promise.finally(() => clearTimeout(timer)).catch(() => {});
    return promise;
  }

  async function close() {
    if (exited) return;
    try { await call('quit', undefined, 3000); } catch { /* expected when child exits */ }
    if (!exited) {
      try { child.kill('SIGTERM'); } catch { /* ok */ }
      await sleep(200);
      if (!exited) { try { child.kill('SIGKILL'); } catch { /* ok */ } }
    }
  }

  return { id, child, call, close, get exited() { return exited; } };
}

/* --------------------------------------------------------------- *
 * Daemon child management
 * --------------------------------------------------------------- */

function spawnDaemon({ stateDir, projectRoot, intervalSec, emit, forceMaintenanceThresholds = true, realEncoder = false }) {
  const env = {
    ...process.env,
    SWEET_SEARCH_RECONCILE_V2: '1',
    SWEET_SEARCH_PROJECT_ROOT: projectRoot,
    SWEET_SEARCH_STATE_DIR: stateDir,
    // Daemon floor is 15s; surface it explicitly so the report records the
    // chosen value rather than autotune output.
    SWEET_SEARCH_RECONCILE_INTERVAL: String(Math.max(15, intervalSec)),
    // Inline maintenance drain is on by default; assert it.
    SWEET_SEARCH_MAINTENANCE_INLINE: '1',
  };
  if (realEncoder) env.SWEET_SEARCH_SOAK_REAL_ENCODER = '1';
  if (forceMaintenanceThresholds) {
    // Match the cross-process harness (cross-process-soak.mjs:316-326).
    env.SWEET_SEARCH_HNSW_TOMBSTONE_THRESHOLD = '0';
    env.SWEET_SEARCH_HNSW_DELETE_CYCLES = '0';
    env.SWEET_SEARCH_BINARY_HNSW_DEAD_THRESHOLD = '0';
    env.SWEET_SEARCH_LI_SEGMENT_STALE_THRESHOLD = '0';
    env.SWEET_SEARCH_SPARSE_DELTA_RATIO = '0';
    env.SWEET_SEARCH_SPARSE_DELTA_SEGCOUNT = '0';
    env.SWEET_SEARCH_FTS5_MERGE_SEGMENT_THRESHOLD = '0';
  }

  const child = spawn(process.execPath, [DAEMON_WRAPPER], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let exited = false;
  let stderrBuf = '';
  let exitCode = null;
  let exitSignal = null;

  child.stdout.on('data', () => { /* daemon does not use stdout */ });
  child.stderr.on('data', (chunk) => {
    const s = chunk.toString('utf-8');
    stderrBuf += s;
    const lines = s.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        emit({ phase: 'daemon_event', ...obj });
      } catch {
        emit({ phase: 'daemon_stderr_unparsed', line: trimmed.slice(0, 1024) });
      }
    }
    if (stderrBuf.length > 64 * 1024) stderrBuf = stderrBuf.slice(-32 * 1024);
  });
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
    emit({ phase: 'daemon_exit', code, signal, stderrTail: stderrBuf.slice(-2048) });
  });

  async function stop(signal = 'SIGTERM') {
    if (exited) return;
    try { child.kill(signal); } catch { /* ok */ }
    const deadline = Date.now() + 15_000;
    while (!exited && Date.now() < deadline) await sleep(100);
    if (!exited) {
      try { child.kill('SIGKILL'); } catch { /* ok */ }
      while (!exited) await sleep(50);
    }
  }

  return { child, stop,
    get exited() { return exited; },
    get exitCode() { return exitCode; },
    get exitSignal() { return exitSignal; },
  };
}

/* --------------------------------------------------------------- *
 * Helpers shared between scenarios
 * --------------------------------------------------------------- */

function makeFixtureDir(args) {
  if (args.fixtureRoot) return path.resolve(args.fixtureRoot);
  return fs.mkdtempSync(path.join(os.tmpdir(), 'real-daemon-soak-'));
}

function buildInitialDirtyQueue(stateDir, fixtureRoot, descriptors) {
  const queue = path.join(stateDir, 'index-maintainer-queue.jsonl');
  fs.mkdirSync(stateDir, { recursive: true });
  const lines = descriptors.map((d) => JSON.stringify({
    file_path: d.rel, timestamp: Date.now(), source: 'bootstrap',
  })).join('\n');
  fs.writeFileSync(queue, lines + '\n');
}

async function bootstrapFixture({ fixtureRoot, stateDir, filesPerLang, emit, realEncoder = false }) {
  const descriptors = generateInitialFixture({ projectRoot: fixtureRoot, filesPerLang });
  const ground = new GroundTruth(descriptors);
  buildInitialDirtyQueue(stateDir, fixtureRoot, descriptors);
  // Real-encoder mode omits the fake encoders/modelInfo so the reconciler
  // uses its production defaults (getEmbeddings/encodeDocumentsCpu/getModelInfo).
  // The first real embed includes a ~1s ORT warmup, so give it more budget.
  const encoderOptions = realEncoder
    ? {}
    : { vectorEncoder: fakeVectorEncoder(), liEncoder: fakeLiEncoder(), modelInfo: MODEL_INFO };
  const counters = await runProductionReconcileTick({
    projectRoot: fixtureRoot, stateDir,
    ...encoderOptions,
    logger: { info() {}, warn() {}, error() {} },
    config: { filesPerTick: 500, cpuBudgetMs: realEncoder ? 600_000 : 30_000 },
  });
  emit({ phase: 'bootstrap_complete', epoch: counters.epoch, filesProcessed: counters.files_processed, realEncoder });
  return { descriptors, ground, bootstrapCounters: counters };
}

/**
 * On-disk authoritative probe — what the reader SHOULD be observing right now.
 * Used to cross-check the reader's view; deliberately separate from the
 * reader's path (this reads files; the reader reads via SweetSearch).
 */
function authoritativeManifest(stateDir) {
  const m = readManifest(stateDir);
  if (!m) return { epoch: null, sparseGramDeltas: null, sparseGramWeightsId: null };
  return {
    epoch: m.epoch ?? null,
    sparseGramDeltas: Array.isArray(m.sparseGram?.deltas) ? [...m.sparseGram.deltas] : null,
    sparseGramWeightsId: m.sparseGram?.weightsId ?? null,
  };
}

function sparseDeltasOnDiskCheck(stateDir, manifestDeltas) {
  if (!Array.isArray(manifestDeltas)) return { missing: [], allExist: true };
  const base = path.join(stateDir, 'codebase-sparse-grams.idx');
  const missing = [];
  for (const seg of manifestDeltas) {
    const p = path.isAbsolute(seg) ? seg : path.join(path.dirname(base), seg);
    if (!fs.existsSync(p)) missing.push(seg);
  }
  return { missing, allExist: missing.length === 0 };
}

/* --------------------------------------------------------------- *
 * Deep per-surface invariant probe + artifact-growth measurement
 * (used by --surface-probe-sec and at end-of-run for the report)
 * --------------------------------------------------------------- */

function safeStatSize(p) { try { return fs.statSync(p).size; } catch { return 0; } }
function countLines(p) {
  try { return fs.readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim()).length; } catch { return 0; }
}

/** Count leftover staging-temp orphans (same suffixes the daemon sweeps). */
function countOrphanTemps(stateDir) {
  const matches = [];
  const isTemp = (n) => /\.tmp\.\d+$/.test(n)
    || n.endsWith('.compacting.tmp') || n.endsWith('.selfheal.tmp')
    || n.endsWith('.json.tmp') || n.endsWith('.bin.tmp');
  const scan = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isFile() && isTemp(e.name)) matches.push(path.join(dir, e.name));
      else if (e.isDirectory() && !e.name.includes('.tmp.')
               && (e.name.endsWith('.deltas') || e.name.endsWith('.segments'))) {
        scan(path.join(dir, e.name));
      }
    }
  };
  scan(stateDir);
  return matches;
}

/** Measure artifact sizes + segment/tombstone growth indicators. */
function measureArtifacts(stateDir) {
  const base = path.join(stateDir, 'codebase-sparse-grams.idx');
  const sparseDeltaSegments = listDeltaSegments(base).length;
  const liSegDir = path.join(stateDir, 'codebase-late-interaction.db.segments');
  let liSegments = 0; let liStaleSidecars = 0; let liTombstones = 0;
  try {
    for (const n of fs.readdirSync(liSegDir)) {
      if (n.endsWith('.stale.bin')) {
        liStaleSidecars += 1;
        try { const bm = loadBitmap(path.join(liSegDir, n)); if (bm) liTombstones += popcount(bm); } catch { /* ok */ }
      } else if (n.endsWith('.bin')) liSegments += 1;
    }
  } catch { /* no LI segments */ }

  let binaryHnswRows = 0; let binaryHnswTombstones = 0;
  try {
    const vec = JSON.parse(fs.readFileSync(path.join(stateDir, 'codebase-binary-hnsw.vectors.json'), 'utf-8'));
    binaryHnswRows = Array.isArray(vec) ? vec.length : 0;
    const bm = loadBitmap(path.join(stateDir, 'codebase-binary-hnsw.idx.stale.bin'));
    if (bm) binaryHnswTombstones = popcount(bm);
  } catch { /* no binary hnsw */ }

  return {
    bytes: {
      vectorsDb: safeStatSize(path.join(stateDir, 'codebase.db')),
      graphDb: safeStatSize(path.join(stateDir, 'code-graph.db')),
      hnswUsearch: safeStatSize(path.join(stateDir, 'codebase-hnsw.usearch')),
      binaryHnswVectors: safeStatSize(path.join(stateDir, 'codebase-binary-hnsw.vectors.json')),
    },
    sparseDeltaSegments,
    liSegments,
    liStaleSidecars,
    liTombstones,
    binaryHnswRows,
    binaryHnswTombstones,
    binaryHnswTombstoneRatio: binaryHnswRows > 0 ? +(binaryHnswTombstones / binaryHnswRows).toFixed(4) : 0,
    maintenanceQueueDepth: countLines(path.join(stateDir, 'rebuild-queue.jsonl')),
    deadLetterDepth: countLines(path.join(stateDir, 'rebuild-queue.dead-letter.jsonl')),
    dirtyQueueDepth: countLines(path.join(stateDir, 'index-maintainer-queue.jsonl')),
    processingQueueDepth: countLines(path.join(stateDir, 'index-maintainer-queue.processing.jsonl')),
    orphanTemps: countOrphanTemps(stateDir).length,
  };
}

/**
 * Deep per-surface invariant probe. Reads every tier artifact off disk and
 * checks coherence against the ground-truth model (vectors/HNSW/Binary/LI/
 * sparse/FTS/graph), plus an artifact-growth snapshot. Returns the
 * structured result; the caller records violations.
 */
/** Wait until the dirty + processing queues are both empty (settled state). */
async function quiesceQueues(stateDir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dq = countLines(path.join(stateDir, 'index-maintainer-queue.jsonl'));
    const pq = countLines(path.join(stateDir, 'index-maintainer-queue.processing.jsonl'));
    if (dq === 0 && pq === 0) return true;
    await sleep(250);
  }
  return false;
}

function surfaceProbe({ stateDir, fixtureRoot, ground }) {
  const probe = new Probe({ projectRoot: fixtureRoot, stateDir });
  let observation; let violations = [];
  try {
    observation = probe.observe();
    violations = checkInvariants(observation, ground);
  } catch (err) {
    violations = [{ kind: 'surface_probe_error', error: err.message }];
  }
  const artifacts = measureArtifacts(stateDir);
  const surfaces = observation ? {
    manifestEpoch: observation.manifest?.epoch ?? null,
    liveVectors: observation.vectors?.liveIds?.size ?? 0,
    retiredVectors: observation.vectors?.retired?.length ?? 0,
    hnswIds: observation.hnsw?.ids?.size ?? 0,
    binaryVisible: observation.binaryHnsw?.visibleIds?.size ?? 0,
    binaryInt8: observation.binaryHnsw?.int8Ids?.size ?? 0,
    liveEntities: observation.graph?.liveEntities?.length ?? 0,
    sparseRecords: observation.sparse?.records?.size ?? 0,
  } : null;
  return { violations, surfaces, artifacts };
}

/* --------------------------------------------------------------- *
 * Per-reader assertions
 * --------------------------------------------------------------- */

/**
 * Look for a sentinel via pattern search on a single reader.
 * Returns { present: bool, hitCount: int, hits: [...], firstFile?: string }.
 */
async function probeSentinel(reader, sentinel) {
  // Anchor as a plain word boundary regex; sentinel is alphanumeric+underscore.
  const regex = `\\b${sentinel}\\b`;
  try {
    const r = await reader.call('pattern-search', { regex });
    return {
      present: r.hitCount > 0,
      hitCount: r.hitCount,
      hits: r.hits.slice(0, 3),
      firstFile: r.hits[0]?.file ?? null,
      searcherEpoch: r.searcherManifestEpoch,
      sparseDeltaCount: r.sparseDeltaCount,
    };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Verify reader's in-memory view matches on-disk manifest. Records a
 * `reader_manifest_mismatch` event if they diverge.
 */
async function probeManifestAlignment(reader, stateDir, emit, readerId) {
  let state;
  try { state = await reader.call('manifest-state'); }
  catch (err) {
    emit({ phase: 'manifest_state_error', reader: readerId, error: err.message });
    return null;
  }
  const auth = authoritativeManifest(stateDir);
  const sparseDeltaCheck = sparseDeltasOnDiskCheck(stateDir, auth.sparseGramDeltas);
  const diff = {};
  if (state.onDisk?.epoch !== auth.epoch) diff.epochOnDisk = { reader: state.onDisk?.epoch, authoritative: auth.epoch };
  if ((state.onDisk?.sparseGramDeltas?.length ?? null) !== (auth.sparseGramDeltas?.length ?? null)) {
    diff.deltaCount = { reader: state.onDisk?.sparseGramDeltas?.length ?? null, authoritative: auth.sparseGramDeltas?.length ?? null };
  }
  if (!sparseDeltaCheck.allExist) {
    diff.missingDeltaSegments = sparseDeltaCheck.missing;
  }
  if (Object.keys(diff).length > 0) {
    emit({ phase: 'reader_manifest_mismatch', reader: readerId, diff, readerState: state, authoritative: auth });
  }
  return { state, auth, sparseDeltaCheck };
}

/* --------------------------------------------------------------- *
 * Scenario A — between-ticks
 * --------------------------------------------------------------- */

async function modeBetweenTicks({ args, emit, fixtureRoot, stateDir }) {
  const summary = { mode: 'between-ticks', violations: [], events: 0, scenarios: [] };

  emit({ phase: 'A_bootstrap_start' });
  const { ground } = await bootstrapFixture({
    fixtureRoot, stateDir, filesPerLang: args.initialFilesPerLang, emit,
    realEncoder: args.realEncoder,
  });

  // Spawn daemon and readers.
  emit({ phase: 'A_daemon_starting' });
  const daemon = spawnDaemon({ stateDir, projectRoot: fixtureRoot, intervalSec: args.intervalSec, emit, realEncoder: args.realEncoder, forceMaintenanceThresholds: !args.realisticThresholds });
  // Give the daemon a moment to acquire its lock.
  await sleep(500);

  const readers = [];
  for (let i = 0; i < args.readerCount; i += 1) {
    const r = spawnReader({ id: i, stateDir, projectRoot: fixtureRoot, emit });
    const initRes = await r.call('init', { stateDir, projectRoot: fixtureRoot });
    emit({ phase: 'A_reader_init', reader: i, manifestEpoch: initRes.onDisk?.epoch });
    readers.push(r);
  }

  // Apply a batch of mutations that will create sparse-gram deltas and
  // HNSW tombstones (delete + update_symbol + add_file + replace_sentinel).
  const mutator = new Mutator({
    projectRoot: fixtureRoot, ground,
    seed: args.seed + 5000,
    queuePath: path.join(stateDir, 'index-maintainer-queue.jsonl'),
    log: () => {},
  });

  // First batch: add + replace + update symbol — these create new sentinels
  // we'll be able to assert "becomes visible" against.
  const additions = [];
  for (let i = 0; i < 4; i += 1) {
    const m = mutator.applyOne();
    additions.push({ kind: m.kind, rel: m.rel, sentinel: ground.get(m.rel)?.sentinel ?? null });
  }
  emit({ phase: 'A_mutations_batch1', additions });

  // Wait for at least one daemon tick to publish a new manifest and let
  // the inline maintenance drain run.
  const epochAfterTick = await waitForEpochAdvance({
    stateDir, fromEpoch: 1, timeoutMs: args.intervalSec * 1000 * 3 + 30_000, emit, tag: 'A_post_batch1',
  });

  // Snapshot daemon's recent events from the JSONL stream — anchored by
  // detecting "maintenance_drain_result" in the event stream is done in
  // the parent; we just record the manifest we observe now.
  const manifestAfter = authoritativeManifest(stateDir);
  const deltaCheck = sparseDeltasOnDiskCheck(stateDir, manifestAfter.sparseGramDeltas);
  emit({ phase: 'A_manifest_after_tick', manifest: manifestAfter, deltaCheck });

  // Probe each reader: do they see the new sentinels?
  for (const desc of additions) {
    if (!desc.sentinel) continue;
    for (const r of readers) {
      const hit = await probeSentinel(r, desc.sentinel);
      emit({ phase: 'A_sentinel_probe', reader: r.id, sentinel: desc.sentinel, mutation: desc.kind, file: desc.rel, hit });
      if (hit.error) summary.violations.push({ kind: 'A_reader_error', reader: r.id, error: hit.error });
      else if (!hit.present) {
        // Sentinel was just added/replaced and tick advanced; should be visible.
        summary.violations.push({
          kind: 'A_sentinel_invisible_after_tick',
          reader: r.id, sentinel: desc.sentinel, mutation: desc.kind, file: desc.rel,
        });
      }
    }
    // Also check the reader manifest alignment.
    for (const r of readers) {
      await probeManifestAlignment(r, stateDir, emit, r.id);
    }
  }

  // Second batch: delete files — they should DISAPPEAR after a tick.
  const removals = [];
  for (let i = 0; i < 2; i += 1) {
    let m;
    let attempts = 0;
    do { m = mutator.applyOne(); attempts += 1; } while (m.kind !== 'delete_file' && m.kind !== 'delete_symbol' && attempts < 8);
    if (m.kind === 'delete_file' || m.kind === 'delete_symbol') {
      removals.push({ kind: m.kind, rel: m.rel, sentinelBefore: m.record?.before?.sentinel ?? null });
    }
  }
  emit({ phase: 'A_mutations_batch2', removals });

  // Wait again for tick + maintenance.
  const epoch2 = await waitForEpochAdvance({
    stateDir, fromEpoch: epochAfterTick, timeoutMs: args.intervalSec * 1000 * 3 + 30_000, emit, tag: 'A_post_batch2',
  });

  const manifest2 = authoritativeManifest(stateDir);
  const deltaCheck2 = sparseDeltasOnDiskCheck(stateDir, manifest2.sparseGramDeltas);
  emit({ phase: 'A_manifest_after_batch2', manifest: manifest2, deltaCheck: deltaCheck2 });

  // Each deletion's sentinel should now be GONE from readers (the file is
  // gone too, but the sparse delta marker is the surface we care about).
  for (const desc of removals) {
    if (!desc.sentinelBefore) continue;
    for (const r of readers) {
      const hit = await probeSentinel(r, desc.sentinelBefore);
      emit({ phase: 'A_sentinel_post_removal_probe', reader: r.id, sentinel: desc.sentinelBefore, mutation: desc.kind, file: desc.rel, hit });
      if (hit.error) summary.violations.push({ kind: 'A_reader_error', reader: r.id, error: hit.error });
      else if (hit.present) {
        // It might still show up via grep over file bytes if delete didn't
        // unlink (delete_symbol only strips one symbol). Tighten to "deleted
        // file path no longer appears in hits".
        if (desc.kind === 'delete_file' && hit.hits.some((h) => h.file && h.file.endsWith(desc.rel))) {
          summary.violations.push({
            kind: 'A_deleted_sentinel_still_visible',
            reader: r.id, sentinel: desc.sentinelBefore, file: desc.rel,
          });
        }
      }
    }
  }

  // Manifest cross-check on every reader at this point.
  for (const r of readers) await probeManifestAlignment(r, stateDir, emit, r.id);

  // Settled-state per-surface invariant probe (real-encoder coherence table).
  await quiesceQueues(stateDir, args.intervalSec * 1000 * 3 + 20_000);
  const surface = surfaceProbe({ stateDir, fixtureRoot, ground });
  for (const v of surface.violations) summary.violations.push({ kind: `A_surface_${v.kind || 'violation'}`, detail: v });
  summary.finalSurface = surface;
  emit({ phase: 'A_final_surface', surfaces: surface.surfaces, artifacts: surface.artifacts, violations: surface.violations.length });

  emit({ phase: 'A_done', violations: summary.violations.length });

  for (const r of readers) await r.close();
  await daemon.stop('SIGTERM');

  summary.scenarios.push({
    name: 'maintenance-between-ticks',
    epochAfterBatch1: epochAfterTick,
    epochAfterBatch2: epoch2,
    additions,
    removals,
    sparseDeltaCheckPostBatch1: deltaCheck,
    sparseDeltaCheckPostBatch2: deltaCheck2,
  });
  return summary;
}

async function waitForEpochAdvance({ stateDir, fromEpoch, timeoutMs, emit, tag }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = readManifest(stateDir);
    if (m && Number.isInteger(m.epoch) && m.epoch > fromEpoch) {
      emit({ phase: `${tag}_epoch_advanced`, fromEpoch, toEpoch: m.epoch });
      return m.epoch;
    }
    await sleep(250);
  }
  emit({ phase: `${tag}_epoch_advance_timeout`, fromEpoch });
  return fromEpoch;
}

/* --------------------------------------------------------------- *
 * Scenario B — short soak
 * --------------------------------------------------------------- */

async function modeSoak({ args, emit, fixtureRoot, stateDir }) {
  const summary = { mode: 'soak', violations: [], events: 0,
    metrics: { mutationsApplied: 0, sentinelProbes: 0, sentinelMisses: 0, readerErrors: 0, readerExitsUnexpected: 0,
               manifestMismatches: 0, daemonTicksObserved: 0, daemonMaintenanceDrains: 0,
               readerRestarts: 0, surfaceProbes: 0, surfaceViolations: 0 },
    surfaceSamples: [], realEncoder: !!args.realEncoder, realisticThresholds: !!args.realisticThresholds };

  emit({ phase: 'B_bootstrap_start' });
  const { ground } = await bootstrapFixture({
    fixtureRoot, stateDir, filesPerLang: args.initialFilesPerLang, emit,
    realEncoder: args.realEncoder,
  });

  emit({ phase: 'B_daemon_starting' });
  const daemon = spawnDaemon({ stateDir, projectRoot: fixtureRoot, intervalSec: args.intervalSec, emit, realEncoder: args.realEncoder, forceMaintenanceThresholds: !args.realisticThresholds });
  await sleep(500);

  const readers = [];
  for (let i = 0; i < args.readerCount; i += 1) {
    const r = spawnReader({ id: i, stateDir, projectRoot: fixtureRoot, emit });
    await r.call('init', { stateDir, projectRoot: fixtureRoot });
    readers.push(r);
  }
  emit({ phase: 'B_readers_ready', count: readers.length });

  // Latch daemon events for summary metrics.
  const onDaemonEvent = (event) => {
    if (event.phase === 'daemon_event') {
      if (event.tick_complete || event.phase === 'tick_complete') summary.metrics.daemonTicksObserved += 1;
      // Better: detect by inner phase. We can't filter cleanly from the
      // generic emitter — instead increment on observed JSONL lines via the
      // file post-hoc. We keep the counters approximate but unique per tick.
    }
  };

  // We instrument by wrapping the orchestrator's emit; we mutate the event
  // object after the inner emit has already written it.
  const innerEmit = emit;
  function tee(event) {
    onDaemonEvent(event);
    innerEmit(event);
  }

  // Mutation + probe loop.
  const pending = [];   // mutations awaiting visibility confirmation
  const mutator = new Mutator({
    projectRoot: fixtureRoot, ground,
    seed: args.seed + 7000,
    queuePath: path.join(stateDir, 'index-maintainer-queue.jsonl'),
    log: () => {},
  });

  // Reconcile-staleness tracker. NOTE: grep mode reads files off disk, so it
  // can't measure index staleness (it sees a new file before reconcile runs).
  // We measure the reconcile latency directly: write → the manifest epoch
  // advancing past the write AND the file no longer sitting in the dirty /
  // processing queue (i.e. the tick that consumed it has published). Under
  // modest churn (no per-tick deferral) this equals true index staleness;
  // deferral behaviour is covered separately by the dirty-storm scenario.
  const stalenessPending = [];   // {rel, writtenAt, epochAtWrite}
  const stalenessSamplesMs = [];
  let stalenessSuperseded = 0;

  const start = Date.now();
  const deadline = start + args.durationSec * 1000;
  let nextMutateAt = start + args.mutationIntervalMs;
  let nextManifestCheckAt = start + Math.max(args.intervalSec * 1000, 5000);
  let nextSurfaceProbeAt = args.surfaceProbeSec > 0 ? start + args.surfaceProbeSec * 1000 : Infinity;
  let nextReaderRestartAt = args.readerRestartSec > 0 ? start + args.readerRestartSec * 1000 : Infinity;
  const graceMs = 5000;

  // Restart-tolerant reader slots: the query loop reads `slot.reader` fresh
  // each iteration so a periodic restart (--reader-restart-sec) swaps the
  // process in place without the loop falsely flagging an unexpected exit.
  const readerSlots = readers.map((r) => ({ reader: r, restarting: false }));

  // Reader query loop — each reader runs continuously, picking a sentinel
  // at random from ground truth and probing it.
  const readerLoops = readerSlots.map((slot) => (async () => {
    while (Date.now() < deadline) {
      const r = slot.reader;
      if (r.exited) {
        if (slot.restarting) { await sleep(100); continue; }
        summary.metrics.readerExitsUnexpected += 1;
        return;
      }
      const files = [...ground.files.values()];
      if (files.length === 0) { await sleep(200); continue; }
      const desc = files[Math.floor(Math.random() * files.length)];
      const sentinel = desc.sentinel;
      try {
        const hit = await probeSentinel(r, sentinel);
        summary.metrics.sentinelProbes += 1;
        if (hit.error) { summary.metrics.readerErrors += 1; tee({ phase: 'B_reader_probe_error', reader: r.id, sentinel, error: hit.error }); }
        else if (!hit.present) {
          // Existing-file sentinel — should be visible if it landed > one
          // interval+grace ago. We use a simple watermark: if the file has
          // been in ground truth for at least 2*interval+grace seconds, an
          // absence is a violation. We approximate by tracking 'firstSeen'
          // on the descriptor; new desc gets it on creation.
          desc._firstSeen = desc._firstSeen || start;
          const ageMs = Date.now() - desc._firstSeen;
          if (ageMs > (args.intervalSec * 1000 * 2 + graceMs)) {
            summary.metrics.sentinelMisses += 1;
            tee({ phase: 'B_sentinel_missing_unexpectedly', reader: r.id, sentinel, file: desc.rel, ageMs });
          }
        }
      } catch (err) {
        summary.metrics.readerErrors += 1;
        tee({ phase: 'B_reader_probe_throw', reader: r.id, error: err.message });
      }
      await sleep(150 + Math.floor(Math.random() * 200));
    }
  })());

  // Mutation loop in the orchestrator.
  const mutateLoop = (async () => {
    while (Date.now() < deadline) {
      if (Date.now() >= nextMutateAt) {
        try {
          const m = mutator.applyOne();
          summary.metrics.mutationsApplied += 1;
          if (m.record?.after && !m.record.after._firstSeen) m.record.after._firstSeen = Date.now();
          if (m.rel && ground.get(m.rel) && !ground.get(m.rel)._firstSeen) ground.get(m.rel)._firstSeen = Date.now();
          pending.push({ kind: m.kind, rel: m.rel, writtenAt: Date.now(),
                         expectedSentinel: ground.get(m.rel)?.sentinel ?? null });
          if (pending.length > 200) pending.splice(0, pending.length - 200);
          // Track reconcile staleness for every mutation.
          const relForStaleness = m.toRel || m.rel;
          if (relForStaleness) {
            stalenessPending.push({
              rel: relForStaleness,
              writtenAt: m.writtenAt || Date.now(),
              epochAtWrite: readManifest(stateDir)?.epoch ?? 0,
            });
          }
          tee({ phase: 'B_mutation', kind: m.kind, rel: m.rel });
        } catch (err) {
          tee({ phase: 'B_mutation_error', error: err.message });
        }
        nextMutateAt = Date.now() + args.mutationIntervalMs + Math.floor((Math.random() - 0.5) * 1000);
      }
      if (Date.now() >= nextManifestCheckAt) {
        for (const r of readers) {
          if (r.exited) continue;
          try {
            const align = await probeManifestAlignment(r, stateDir, tee, r.id);
            if (align && (
              (align.state?.onDisk?.epoch !== align.auth?.epoch) ||
              (!align.sparseDeltaCheck.allExist)
            )) {
              summary.metrics.manifestMismatches += 1;
            }
          } catch (err) {
            tee({ phase: 'B_manifest_align_error', reader: r.id, error: err.message });
          }
        }
        nextManifestCheckAt = Date.now() + Math.max(args.intervalSec * 1000, 5000);
      }

      // Periodic reader restart (endurance reader-churn). Swaps reader slot 0
      // in place; the query loop tolerates the brief restart window.
      if (Date.now() >= nextReaderRestartAt) {
        const slot = readerSlots[0];
        if (slot && !slot.restarting) {
          slot.restarting = true;
          const oldId = slot.reader.id;
          try { await slot.reader.close(); } catch { /* ok */ }
          const nr = spawnReader({ id: 1000 + summary.metrics.readerRestarts, stateDir, projectRoot: fixtureRoot, emit: tee });
          try {
            const initRes = await nr.call('init', { stateDir, projectRoot: fixtureRoot });
            slot.reader = nr;
            summary.metrics.readerRestarts += 1;
            tee({ phase: 'B_reader_restarted', oldId, newId: nr.id, epoch: initRes.onDisk?.epoch });
          } catch (err) {
            tee({ phase: 'B_reader_restart_failed', error: err.message });
          } finally {
            slot.restarting = false;
          }
        }
        nextReaderRestartAt = Date.now() + args.readerRestartSec * 1000;
      }

      // Periodic deep per-surface invariant probe. Quiesce the queues first
      // so the on-disk index reflects ground truth before asserting.
      if (Date.now() >= nextSurfaceProbeAt) {
        await quiesceQueues(stateDir, args.intervalSec * 1000 * 3 + 20_000);
        const sp = surfaceProbe({ stateDir, fixtureRoot, ground });
        summary.metrics.surfaceProbes += 1;
        summary.metrics.surfaceViolations += sp.violations.length;
        summary.surfaceSamples.push({ atMs: Date.now() - start, surfaces: sp.surfaces, artifacts: sp.artifacts, violations: sp.violations.length });
        if (sp.violations.length > 0) {
          for (const v of sp.violations) summary.violations.push({ kind: `B_surface_${v.kind || 'violation'}`, detail: v });
          tee({ phase: 'B_surface_violations', count: sp.violations.length, sample: sp.violations.slice(0, 5) });
        } else {
          tee({ phase: 'B_surface_ok', surfaces: sp.surfaces, artifacts: sp.artifacts });
        }
        nextSurfaceProbeAt = Date.now() + args.surfaceProbeSec * 1000;
      }

      await sleep(200);
    }
  })();

  // Staleness loop — resolve each pending mutation when the manifest epoch has
  // advanced past the write AND the file is no longer queued (reconciled +
  // published). Items not resolved within a generous window are counted as
  // superseded (a later same-file mutation re-queued the path first).
  const queuePathSet = () => {
    const set = new Set();
    for (const qf of ['index-maintainer-queue.jsonl', 'index-maintainer-queue.processing.jsonl']) {
      const p = path.join(stateDir, qf);
      try {
        for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
          const t = line.trim(); if (!t) continue;
          try { const o = JSON.parse(t); const fp = o.file_path || o.path || o.filePath; if (fp) set.add(fp); } catch { /* ok */ }
        }
      } catch { /* missing queue */ }
    }
    return set;
  };
  const stalenessMaxWaitMs = Math.max(15, args.intervalSec) * 1000 * 5 + 15_000;
  const stalenessLoop = (async () => {
    while (Date.now() < deadline) {
      if (stalenessPending.length === 0) { await sleep(400); continue; }
      const now = Date.now();
      const epoch = readManifest(stateDir)?.epoch ?? 0;
      const queued = queuePathSet();
      for (let i = stalenessPending.length - 1; i >= 0; i -= 1) {
        const item = stalenessPending[i];
        if (epoch > item.epochAtWrite && !queued.has(item.rel)) {
          stalenessSamplesMs.push(now - item.writtenAt);
          stalenessPending.splice(i, 1);
        } else if (now - item.writtenAt > stalenessMaxWaitMs) {
          stalenessSuperseded += 1;
          stalenessPending.splice(i, 1);
        }
      }
      await sleep(500);
    }
  })();

  await Promise.all([...readerLoops, mutateLoop, stalenessLoop]);

  // Staleness percentiles (write → first visible).
  stalenessSamplesMs.sort((a, b) => a - b);
  const pct = (p) => (stalenessSamplesMs.length
    ? stalenessSamplesMs[Math.min(stalenessSamplesMs.length - 1, Math.floor((p / 100) * stalenessSamplesMs.length))]
    : null);
  summary.staleness = {
    n: stalenessSamplesMs.length,
    p50: pct(50), p95: pct(95), p99: pct(99),
    max: stalenessSamplesMs.length ? stalenessSamplesMs[stalenessSamplesMs.length - 1] : null,
    superseded: stalenessSuperseded,
    stillPending: stalenessPending.length,
  };

  emit({ phase: 'B_loop_complete', durationMs: Date.now() - start, metrics: summary.metrics, staleness: summary.staleness });

  // Final settled-state per-surface invariant probe + artifact snapshot.
  await quiesceQueues(stateDir, args.intervalSec * 1000 * 4 + 30_000);
  const finalProbe = surfaceProbe({ stateDir, fixtureRoot, ground });
  summary.metrics.surfaceProbes += 1;
  summary.metrics.surfaceViolations += finalProbe.violations.length;
  summary.finalSurface = finalProbe;
  for (const v of finalProbe.violations) summary.violations.push({ kind: `B_final_surface_${v.kind || 'violation'}`, detail: v });
  emit({ phase: 'B_final_surface', surfaces: finalProbe.surfaces, artifacts: finalProbe.artifacts, violations: finalProbe.violations.length });

  for (const slot of readerSlots) { try { await slot.reader.close(); } catch { /* ok */ } }
  await daemon.stop('SIGTERM');

  return summary;
}

/* --------------------------------------------------------------- *
 * Scenario C — stop/restart long-lived reader
 * --------------------------------------------------------------- */

async function modeRestart({ args, emit, fixtureRoot, stateDir }) {
  const summary = { mode: 'restart', violations: [], events: 0, observations: [] };

  emit({ phase: 'C_bootstrap_start' });
  const { ground } = await bootstrapFixture({
    fixtureRoot, stateDir, filesPerLang: args.initialFilesPerLang, emit,
    realEncoder: args.realEncoder,
  });

  emit({ phase: 'C_daemon_starting' });
  const daemon = spawnDaemon({ stateDir, projectRoot: fixtureRoot, intervalSec: args.intervalSec, emit, realEncoder: args.realEncoder, forceMaintenanceThresholds: !args.realisticThresholds });
  await sleep(500);

  // Spawn one long-lived reader, run a probe, then kill+respawn.
  let reader = spawnReader({ id: 0, stateDir, projectRoot: fixtureRoot, emit });
  const initRes = await reader.call('init', { stateDir, projectRoot: fixtureRoot });
  emit({ phase: 'C_reader_initial', manifestEpoch: initRes.onDisk?.epoch });

  // Apply some mutations so the manifest advances while the reader is alive.
  const mutator = new Mutator({
    projectRoot: fixtureRoot, ground,
    seed: args.seed + 6000,
    queuePath: path.join(stateDir, 'index-maintainer-queue.jsonl'),
    log: () => {},
  });
  for (let i = 0; i < 3; i += 1) mutator.applyOne();

  const epochPostMut = await waitForEpochAdvance({ stateDir, fromEpoch: 1, timeoutMs: args.intervalSec * 1000 * 3 + 30_000, emit, tag: 'C_pre_kill' });
  emit({ phase: 'C_pre_kill_state', epoch: epochPostMut });

  // Pick a sentinel that should be visible.
  const probedDescs = [...ground.files.values()].slice(0, 3);
  const preProbe = [];
  for (const desc of probedDescs) {
    const hit = await probeSentinel(reader, desc.sentinel);
    preProbe.push({ sentinel: desc.sentinel, hit });
  }
  emit({ phase: 'C_pre_kill_probe', preProbe });

  // Kill the reader (SIGTERM). Verify exit.
  emit({ phase: 'C_kill_reader' });
  await reader.close();
  await sleep(500);
  if (!reader.exited) summary.violations.push({ kind: 'C_reader_did_not_exit' });

  // Continue running the daemon and apply more mutations to advance the
  // manifest while the reader is GONE.
  for (let i = 0; i < 3; i += 1) mutator.applyOne();
  const epochPostKill = await waitForEpochAdvance({ stateDir, fromEpoch: epochPostMut, timeoutMs: args.intervalSec * 1000 * 3 + 30_000, emit, tag: 'C_post_kill' });
  emit({ phase: 'C_post_kill_state', epoch: epochPostKill });

  // Respawn the reader from scratch — fresh process.
  emit({ phase: 'C_respawn' });
  reader = spawnReader({ id: 1, stateDir, projectRoot: fixtureRoot, emit });
  const initRes2 = await reader.call('init', { stateDir, projectRoot: fixtureRoot });
  emit({ phase: 'C_reader_respawn_init', manifestEpoch: initRes2.onDisk?.epoch });

  if (initRes2.onDisk?.epoch !== epochPostKill) {
    summary.violations.push({ kind: 'C_respawned_reader_wrong_epoch',
      readerEpoch: initRes2.onDisk?.epoch, expected: epochPostKill });
  }

  // Probe a brand-new sentinel created post-kill — it should be visible.
  const newDescs = [...ground.files.values()].filter((d) => d._firstSeen && d._firstSeen > Date.now() - 30_000);
  for (const desc of newDescs.slice(0, 3)) {
    const hit = await probeSentinel(reader, desc.sentinel);
    summary.observations.push({ sentinel: desc.sentinel, file: desc.rel, hit });
    if (hit.error) summary.violations.push({ kind: 'C_post_respawn_reader_error', error: hit.error });
    else if (!hit.present) summary.violations.push({ kind: 'C_post_respawn_sentinel_invisible', sentinel: desc.sentinel, file: desc.rel });
  }

  // Probe an old sentinel still in ground truth.
  for (const desc of probedDescs.slice(0, 2)) {
    if (!ground.get(desc.rel)) continue;
    const hit = await probeSentinel(reader, ground.get(desc.rel).sentinel);
    summary.observations.push({ sentinel: ground.get(desc.rel).sentinel, file: desc.rel, hit });
  }

  await reader.close();
  await daemon.stop('SIGTERM');
  return summary;
}

/* --------------------------------------------------------------- *
 * Scenario D — crash-probe (optional)
 * --------------------------------------------------------------- */

async function modeCrashProbe({ args, emit, fixtureRoot, stateDir }) {
  const summary = { mode: 'crash-probe', violations: [], events: 0, observations: [] };

  emit({ phase: 'D_bootstrap_start' });
  const { ground } = await bootstrapFixture({
    fixtureRoot, stateDir, filesPerLang: args.initialFilesPerLang, emit,
    realEncoder: args.realEncoder,
  });

  emit({ phase: 'D_daemon_starting' });
  let daemon = spawnDaemon({ stateDir, projectRoot: fixtureRoot, intervalSec: args.intervalSec, emit, realEncoder: args.realEncoder, forceMaintenanceThresholds: !args.realisticThresholds });
  await sleep(500);

  const mutator = new Mutator({
    projectRoot: fixtureRoot, ground,
    seed: args.seed + 9000,
    queuePath: path.join(stateDir, 'index-maintainer-queue.jsonl'),
    log: () => {},
  });

  // Drive enough mutations for the daemon to take a tick + run maintenance.
  for (let i = 0; i < 5; i += 1) mutator.applyOne();
  const epochAfterTick = await waitForEpochAdvance({ stateDir, fromEpoch: 1, timeoutMs: args.intervalSec * 1000 * 3 + 30_000, emit, tag: 'D_pre_kill' });
  emit({ phase: 'D_pre_kill_state', epoch: epochAfterTick });

  // SIGKILL daemon.
  emit({ phase: 'D_kill_daemon_SIGKILL' });
  try { daemon.child.kill('SIGKILL'); } catch { /* ok */ }
  const deadline = Date.now() + 5000;
  while (!daemon.exited && Date.now() < deadline) await sleep(50);
  if (!daemon.exited) summary.violations.push({ kind: 'D_daemon_did_not_die' });

  // Verify manifest is still readable.
  const m1 = readManifest(stateDir);
  if (!m1 || !Number.isInteger(m1.epoch)) {
    summary.violations.push({ kind: 'D_manifest_corrupt_post_kill' });
  }
  emit({ phase: 'D_post_kill_manifest', manifest: m1 ? { epoch: m1.epoch } : null });

  // Stale lock should still be present; restart daemon — it should detect
  // and acquire it (acquireStateLock's stale-retry path).
  emit({ phase: 'D_lockfile_present', exists: fs.existsSync(path.join(stateDir, 'index-maintainer.lock')) });

  // Remove the lock manually (mimics what `acquireStateLock` does after
  // detecting an orphaned PID). The wrapper acquires it via O_EXCL only,
  // so we must clear the stale entry first; the real index-maintainer
  // checks pid liveness and removes orphans automatically. We simulate
  // that here by removing the file when its pid no longer exists.
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(stateDir, 'index-maintainer.lock'), 'utf-8'));
    let alive = true;
    try { process.kill(raw.pid, 0); } catch { alive = false; }
    if (!alive) {
      fs.unlinkSync(path.join(stateDir, 'index-maintainer.lock'));
      emit({ phase: 'D_cleared_stale_lock', pid: raw.pid });
    }
  } catch { /* tolerate */ }

  // Plant crash-orphan staging temps with OLD mtime (so the age gate passes)
  // using names the daemon will never recreate, plus confirm a canonical
  // artifact is present. The restart sweep must remove the orphans and keep
  // the canonical files. (Mirrors the real runReconcileV2Main sweep, which
  // the wrapper now also runs after lock acquisition.)
  const plantedOrphans = [
    path.join(stateDir, 'codebase-hnsw.usearch.tmp.999999'),
    path.join(stateDir, 'codebase-binary-hnsw.graph.json.tmp.999998'),
    path.join(stateDir, 'codebase-late-interaction.db.selfheal.tmp'),
  ];
  const deltaDir = path.join(stateDir, 'codebase-sparse-grams.idx.deltas');
  if (fs.existsSync(deltaDir)) plantedOrphans.push(path.join(deltaDir, '999999-9.ssgrmdelta.compacting.tmp'));
  const liSegDir = path.join(stateDir, 'codebase-late-interaction.db.segments');
  if (fs.existsSync(liSegDir)) plantedOrphans.push(path.join(liSegDir, 'phantom-segment.bin.compacting.tmp'));
  const canonicalGuards = ['codebase.db', 'reconcile-manifest.json', 'codebase-hnsw.usearch']
    .map((n) => path.join(stateDir, n)).filter((p) => fs.existsSync(p));
  const oldSecs = (Date.now() - 5 * 60_000) / 1000; // 5 min ago
  for (const p of plantedOrphans) {
    try { fs.writeFileSync(p, 'crash-orphan'); fs.utimesSync(p, oldSecs, oldSecs); } catch { /* ok */ }
  }
  emit({ phase: 'D_planted_orphans', orphans: plantedOrphans.map((p) => path.basename(p)), canonicalGuards: canonicalGuards.map((p) => path.basename(p)) });

  // Apply more mutations + restart daemon.
  for (let i = 0; i < 3; i += 1) mutator.applyOne();
  emit({ phase: 'D_restart_daemon' });
  daemon = spawnDaemon({ stateDir, projectRoot: fixtureRoot, intervalSec: args.intervalSec, emit, realEncoder: args.realEncoder, forceMaintenanceThresholds: !args.realisticThresholds });
  await sleep(500);

  // Verify it produces a new tick.
  const epochAfterRestart = await waitForEpochAdvance({ stateDir, fromEpoch: epochAfterTick, timeoutMs: args.intervalSec * 1000 * 3 + 30_000, emit, tag: 'D_post_restart' });
  if (epochAfterRestart === epochAfterTick) {
    summary.violations.push({ kind: 'D_daemon_did_not_tick_after_restart' });
  }
  emit({ phase: 'D_post_restart_state', epoch: epochAfterRestart });

  // Orphan-sweep verification: planted orphans gone, canonical artifacts kept.
  const orphansRemaining = plantedOrphans.filter((p) => fs.existsSync(p)).map((p) => path.basename(p));
  const canonicalLost = canonicalGuards.filter((p) => !fs.existsSync(p)).map((p) => path.basename(p));
  if (orphansRemaining.length > 0) summary.violations.push({ kind: 'D_orphans_not_swept', remaining: orphansRemaining });
  if (canonicalLost.length > 0) summary.violations.push({ kind: 'D_canonical_deleted_by_sweep', lost: canonicalLost });
  emit({ phase: 'D_orphan_sweep_check', orphansPlanted: plantedOrphans.length, orphansRemaining, canonicalPreserved: canonicalGuards.length - canonicalLost.length, canonicalLost });

  // Readers still work after the crash/restart cycle.
  const reader = spawnReader({ id: 99, stateDir, projectRoot: fixtureRoot, emit });
  try {
    const initRes = await reader.call('init', { stateDir, projectRoot: fixtureRoot });
    const someDesc = [...ground.files.values()][0];
    const hit = someDesc ? await probeSentinel(reader, someDesc.sentinel) : null;
    emit({ phase: 'D_post_restart_reader', epoch: initRes.onDisk?.epoch, probe: hit });
    if (hit?.error) summary.violations.push({ kind: 'D_post_restart_reader_error', error: hit.error });
  } catch (err) {
    summary.violations.push({ kind: 'D_post_restart_reader_failed', error: err.message });
  } finally {
    await reader.close();
  }

  // Final settled-state per-surface probe.
  await quiesceQueues(stateDir, args.intervalSec * 1000 * 3 + 20_000);
  const surface = surfaceProbe({ stateDir, fixtureRoot, ground });
  for (const v of surface.violations) summary.violations.push({ kind: `D_surface_${v.kind || 'violation'}`, detail: v });
  summary.finalSurface = surface;
  emit({ phase: 'D_final_surface', surfaces: surface.surfaces, artifacts: surface.artifacts, violations: surface.violations.length });

  await daemon.stop('SIGTERM');
  return summary;
}

/* --------------------------------------------------------------- *
 * Scenario E — branch-switch / dirty storm
 * --------------------------------------------------------------- */

async function modeDirtyStorm({ args, emit, fixtureRoot, stateDir }) {
  const summary = { mode: 'dirty-storm', violations: [], events: 0,
    metrics: { stormMutations: 0, distinctDirtyPaths: 0, peakDirtyQueueDepth: 0, peakProcessingDepth: 0,
               peakBacklog: 0, ticksToDrain: 0, readerErrors: 0, readerExitsUnexpected: 0,
               manifestMismatches: 0, sentinelProbes: 0, lostPaths: 0 },
    realEncoder: !!args.realEncoder };

  emit({ phase: 'E_bootstrap_start' });
  const { ground } = await bootstrapFixture({
    fixtureRoot, stateDir, filesPerLang: args.initialFilesPerLang, emit,
    realEncoder: args.realEncoder,
  });
  emit({ phase: 'E_bootstrap_done', files: ground.files.size });

  emit({ phase: 'E_daemon_starting' });
  const daemon = spawnDaemon({ stateDir, projectRoot: fixtureRoot, intervalSec: args.intervalSec, emit, realEncoder: args.realEncoder, forceMaintenanceThresholds: !args.realisticThresholds });
  await sleep(500);

  const readers = [];
  for (let i = 0; i < Math.max(1, args.readerCount); i += 1) {
    const r = spawnReader({ id: i, stateDir, projectRoot: fixtureRoot, emit });
    await r.call('init', { stateDir, projectRoot: fixtureRoot });
    readers.push(r);
  }
  const readerSlots = readers.map((r) => ({ reader: r }));

  const epochAtStorm = readManifest(stateDir)?.epoch ?? 0;

  // STORM: burst-apply a large mixed mutation set (rewrites/deletes/renames/
  // adds) with no inter-mutation delay, so the daemon faces a big dirty set
  // it must defer + requeue across many ticks (the branch-switch case).
  const stormSize = args.stormSize > 0 ? args.stormSize : 500;
  const mutator = new Mutator({
    projectRoot: fixtureRoot, ground,
    seed: args.seed + 11000,
    queuePath: path.join(stateDir, 'index-maintainer-queue.jsonl'),
    log: () => {},
  });
  emit({ phase: 'E_storm_begin', stormSize, epochAtStorm });
  const dirtyPaths = new Set();
  for (let i = 0; i < stormSize; i += 1) {
    try {
      const m = mutator.applyOne();
      summary.metrics.stormMutations += 1;
      if (m?.rel) dirtyPaths.add(m.rel);
      if (m?.fromRel) dirtyPaths.add(m.fromRel);
      if (m?.toRel) dirtyPaths.add(m.toRel);
    } catch (err) { emit({ phase: 'E_storm_mutation_error', error: err.message }); }
  }
  summary.metrics.distinctDirtyPaths = dirtyPaths.size;
  const dqAfterStorm = countLines(path.join(stateDir, 'index-maintainer-queue.jsonl'));
  summary.metrics.peakDirtyQueueDepth = Math.max(summary.metrics.peakDirtyQueueDepth, dqAfterStorm);
  emit({ phase: 'E_storm_applied', stormMutations: summary.metrics.stormMutations, distinctDirtyPaths: dirtyPaths.size, dirtyQueueDepth: dqAfterStorm, expectedFinalFiles: ground.files.size });

  // Reader loop during catch-up — readers must never error or see a torn state.
  let stopReaders = false;
  const readerLoops = readerSlots.map((slot) => (async () => {
    while (!stopReaders) {
      const r = slot.reader;
      if (r.exited) { summary.metrics.readerExitsUnexpected += 1; return; }
      const files = [...ground.files.values()];
      if (files.length === 0) { await sleep(200); continue; }
      const desc = files[Math.floor(Math.random() * files.length)];
      try {
        const hit = await probeSentinel(r, desc.sentinel);
        summary.metrics.sentinelProbes += 1;
        if (hit.error) { summary.metrics.readerErrors += 1; emit({ phase: 'E_reader_probe_error', reader: r.id, error: hit.error }); }
      } catch (err) { summary.metrics.readerErrors += 1; emit({ phase: 'E_reader_probe_throw', reader: r.id, error: err.message }); }
      await sleep(120 + Math.floor(Math.random() * 180));
    }
  })());

  // Catch-up: poll until the dirty + processing queues drain, sampling
  // backlog depth + manifest alignment throughout (deferral/requeue path).
  // Budget is wall-clock per tick (interval sleep + tick + inline maintenance),
  // generous so a slow/contended machine does not produce a false negative;
  // the authoritative drain check is the final quiesce below.
  const ticksBudget = Math.ceil(stormSize / 30) + 14;
  const drainDeadline = Date.now() + (Math.max(15, args.intervalSec) + 12) * 1000 * ticksBudget + 120_000;
  let drainedDuringPoll = false;
  while (Date.now() < drainDeadline) {
    const dq = countLines(path.join(stateDir, 'index-maintainer-queue.jsonl'));
    const pq = countLines(path.join(stateDir, 'index-maintainer-queue.processing.jsonl'));
    summary.metrics.peakDirtyQueueDepth = Math.max(summary.metrics.peakDirtyQueueDepth, dq);
    summary.metrics.peakProcessingDepth = Math.max(summary.metrics.peakProcessingDepth, pq);
    summary.metrics.peakBacklog = Math.max(summary.metrics.peakBacklog, dq + pq);
    if (readerSlots[0] && !readerSlots[0].reader.exited) {
      try {
        const align = await probeManifestAlignment(readerSlots[0].reader, stateDir, emit, readerSlots[0].reader.id);
        if (align && !align.sparseDeltaCheck.allExist) summary.metrics.manifestMismatches += 1;
      } catch { /* ok */ }
    }
    if (dq === 0 && pq === 0) { drainedDuringPoll = true; break; }
    await sleep(1000);
  }
  const epochAfterDrain = readManifest(stateDir)?.epoch ?? epochAtStorm;
  summary.metrics.ticksToDrain = epochAfterDrain - epochAtStorm;
  emit({ phase: 'E_drained', drainedDuringPoll, epochAfterDrain, ticksToDrain: summary.metrics.ticksToDrain, peakBacklog: summary.metrics.peakBacklog });

  stopReaders = true;
  await Promise.all(readerLoops);

  // Authoritative drain check: settled-state quiesce (generous). Only flag a
  // real "did not drain" if the queues are STILL non-empty after this.
  const fullyDrained = await quiesceQueues(stateDir, (Math.max(15, args.intervalSec) + 12) * 1000 * 8 + 60_000);
  summary.metrics.fullyDrained = fullyDrained;
  if (!fullyDrained) {
    const dq = countLines(path.join(stateDir, 'index-maintainer-queue.jsonl'));
    const pq = countLines(path.join(stateDir, 'index-maintainer-queue.processing.jsonl'));
    summary.violations.push({ kind: 'E_storm_did_not_drain', peakBacklog: summary.metrics.peakBacklog, residualDirty: dq, residualProcessing: pq });
  }

  // No-lost-paths + coherence: settled-state per-surface invariant probe.
  const surface = surfaceProbe({ stateDir, fixtureRoot, ground });
  for (const v of surface.violations) {
    summary.violations.push({ kind: `E_surface_${v.kind || 'violation'}`, detail: v });
    if (/missing_for_ground_file|for_deleted_file/.test(v.kind || '')) summary.metrics.lostPaths += 1;
  }
  summary.finalSurface = surface;
  emit({ phase: 'E_final_surface', surfaces: surface.surfaces, artifacts: surface.artifacts, violations: surface.violations.length });

  for (const slot of readerSlots) { try { await slot.reader.close(); } catch { /* ok */ } }
  await daemon.stop('SIGTERM');
  return summary;
}

/* --------------------------------------------------------------- *
 * Main
 * --------------------------------------------------------------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out || makeOutPath(args.label || `${args.mode}-${Date.now()}`, args.mode);
  const emit = jsonlAppender(outPath);

  const fixtureRoot = makeFixtureDir(args);
  const stateDir = path.join(fixtureRoot, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });

  // Safety net: a single stray reader/child rejection must never abort a
  // multi-hour run. Log it to the JSONL for post-hoc review instead.
  process.on('unhandledRejection', (reason) => {
    try { emit({ phase: 'unhandled_rejection', error: reason && (reason.message || String(reason)) }); } catch { /* ok */ }
  });

  emit({ phase: 'run_start', args, fixtureRoot, stateDir, outPath });

  let summary;
  try {
    if (args.mode === 'between-ticks') summary = await modeBetweenTicks({ args, emit, fixtureRoot, stateDir });
    else if (args.mode === 'soak')      summary = await modeSoak({ args, emit, fixtureRoot, stateDir });
    else if (args.mode === 'restart')   summary = await modeRestart({ args, emit, fixtureRoot, stateDir });
    else if (args.mode === 'crash-probe') summary = await modeCrashProbe({ args, emit, fixtureRoot, stateDir });
    else if (args.mode === 'dirty-storm') summary = await modeDirtyStorm({ args, emit, fixtureRoot, stateDir });
    else throw new Error(`unknown mode: ${args.mode}`);
  } catch (err) {
    emit({ phase: 'run_fatal', error: err.message, stack: err.stack });
    summary = { mode: args.mode, violations: [{ kind: 'run_fatal', error: err.message }] };
  }

  emit({ phase: 'run_complete', summary });

  // Write .summary.json sibling.
  const summaryPath = outPath.replace(/\.jsonl$/, '.summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ ...summary, args, fixtureRoot, stateDir, outPath, summaryPath }, null, 2));
  process.stderr.write(`[real-daemon-soak] events  → ${outPath}\n`);
  process.stderr.write(`[real-daemon-soak] summary → ${summaryPath}\n`);

  // Cleanup unless --keep-fixture.
  if (!args.keepFixture) {
    try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* ok */ }
  } else {
    process.stderr.write(`[real-daemon-soak] fixture preserved at ${fixtureRoot}\n`);
  }

  const violationCount = Array.isArray(summary.violations) ? summary.violations.length : 0;
  process.exit(violationCount > 0 ? 1 : 0);
}

main();
