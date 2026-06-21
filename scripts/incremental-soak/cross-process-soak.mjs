#!/usr/bin/env node
/**
 * Cross-process incremental-indexing validator.
 *
 * Validates the gap left by `REPORT.md` § 6.3 / § 9 item 3 — whether
 * search readers in *separate processes* observe correct, coherent results
 * across reconcile ticks AND across maintenance runs that mutate canonical
 * artifacts WITHOUT bumping `manifest.epoch`.
 *
 * Modes:
 *   --mode between-ticks   Deterministic phase-2 probe: tick N → forced
 *                          maintenance (sparse + binary HNSW + float HNSW +
 *                          LI) → probe both LONG-LIVED and FRESH readers
 *                          between ticks → tick N+1 → probe again.
 *   --mode soak            5-10 min cross-process soak. Background reader
 *                          processes stay alive throughout; a fresh reader
 *                          process is spawned each maintenance window for
 *                          comparison.
 *
 * The orchestrator runs the reconciler + maintenance worker in the SAME
 * process as itself (reusing scripts/incremental-soak/soak.mjs's call
 * shape), but the readers ARE separate processes. This isolates the
 * cross-process I/O question (mmap, file rewrites, manifest pinning) from
 * the in-process reconcile semantics that REPORT.md already validated.
 *
 * Output:
 *   eval/results/incremental-soak/cross-process-<label>.jsonl
 *   eval/results/incremental-soak/cross-process-<label>.summary.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

import { runProductionReconcileTick } from '../../core/incremental-indexing/application/production-reconciler.mjs';
import {
  processMaintenanceQueue,
  defaultMaintenanceHandlers,
  enqueueMaintenanceJob,
} from '../../core/incremental-indexing/application/maintenance-worker.mjs';
import { readManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import {
  listSparseGramDeltaSegments,
  resolveLatestSparseGramDeltaRecords,
} from '../../core/infrastructure/sparse-gram-delta-reader.js';
import { loadBitmap, isSet } from '../../core/infrastructure/tombstone-bitmap-reader.js';
import { generateInitialFixture } from './fixture.mjs';
import { GroundTruth } from './ground-truth.mjs';
import { Mutator } from './mutator.mjs';

const __filename = fileURLToPath(import.meta.url);
const HERE = path.dirname(__filename);
const READER_WORKER = path.join(HERE, 'cross-process-reader.mjs');

function parseArgs(argv) {
  const args = {
    mode: 'between-ticks',
    interval: 20,
    durationSec: 300,
    mutationIntervalMs: 4000,
    readerCount: 2,
    initialFilesPerLang: 6,
    seed: 42,
    out: '',
    fixtureRoot: '',
    label: '',
    keepFixture: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--mode') args.mode = argv[++i];
    else if (a === '--interval') args.interval = Number(argv[++i]);
    else if (a === '--duration-sec') args.durationSec = Number(argv[++i]);
    else if (a === '--mutation-interval-ms') args.mutationIntervalMs = Number(argv[++i]);
    else if (a === '--reader-count') args.readerCount = Number(argv[++i]);
    else if (a === '--initial-files-per-lang') args.initialFilesPerLang = Number(argv[++i]);
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--fixture-root') args.fixtureRoot = argv[++i];
    else if (a === '--label') args.label = argv[++i];
    else if (a === '--keep-fixture') args.keepFixture = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  console.log(`cross-process soak harness

  --mode <between-ticks|soak>
  --interval <sec>             reconcile tick interval (default 20)
  --duration-sec <sec>         soak duration (default 300; ignored in between-ticks)
  --mutation-interval-ms <ms>  median ms between mutations (default 4000)
  --reader-count <n>           long-lived reader processes (default 2)
  --initial-files-per-lang <n> initial fixture files per language (default 6)
  --seed <int>                 deterministic seed (default 42)
  --out <path>                 JSONL events output path
  --fixture-root <path>        override fixture directory (default tmp)
  --label <s>                  label written into JSONL events
  --keep-fixture               keep the fixture on success
`);
}

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

function ts() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function jsonlAppender(outPath) {
  const out = outPath ? fs.createWriteStream(outPath, { flags: 'a' }) : null;
  return (event) => {
    const line = JSON.stringify({ ts: Date.now(), ...event });
    if (out) out.write(line + '\n');
  };
}

/**
 * Spawn one reader worker. Returns an object that lets the orchestrator
 * send commands and await typed responses.
 */
function spawnReader({ id, label, stateDir, emit, env = {} }) {
  const child = spawn(process.execPath, [READER_WORKER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const pending = new Map();
  let nextId = 1;
  let stderrBuf = '';
  let bufStdout = '';
  let exited = false;

  child.stdout.on('data', (chunk) => {
    bufStdout += chunk.toString('utf-8');
    const lines = bufStdout.split('\n');
    bufStdout = lines.pop() || '';
    for (const ln of lines) {
      const trimmed = ln.trim();
      if (!trimmed) continue;
      let msg;
      try { msg = JSON.parse(trimmed); } catch (err) {
        emit({ phase: 'reader_parse_error', reader: id, label, raw: trimmed.slice(0, 200) });
        continue;
      }
      const p = pending.get(msg.id);
      if (!p) {
        emit({ phase: 'reader_orphan_reply', reader: id, label, id: msg.id });
        continue;
      }
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || 'unknown error'));
    }
  });

  child.stderr.on('data', (chunk) => {
    const s = chunk.toString('utf-8');
    stderrBuf += s;
    // Stream lines as they arrive so we see crash context immediately.
    const lines = s.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) emit({ phase: 'reader_stderr_line', reader: id, label, line: trimmed.slice(0, 1024) });
    }
    if (stderrBuf.length > 16 * 1024) stderrBuf = stderrBuf.slice(-8 * 1024);
  });

  child.on('exit', (code, signal) => {
    exited = true;
    emit({ phase: 'reader_exit', reader: id, label, code, signal, stderrTail: stderrBuf.slice(-2048) });
    for (const [, p] of pending) p.reject(new Error(`reader exited code=${code} signal=${signal}`));
    pending.clear();
  });

  function call(cmd, args = undefined, timeoutMs = 20_000) {
    if (exited) return Promise.reject(new Error('reader already exited'));
    const cid = nextId++;
    const promise = new Promise((resolve, reject) => {
      pending.set(cid, { resolve, reject });
    });
    const line = JSON.stringify({ id: cid, cmd, ...(args !== undefined ? { args } : {}) }) + '\n';
    child.stdin.write(line);
    const timer = setTimeout(() => {
      if (pending.has(cid)) {
        pending.get(cid).reject(new Error(`reader call ${cmd} timed out after ${timeoutMs}ms`));
        pending.delete(cid);
      }
    }, timeoutMs);
    promise.finally(() => clearTimeout(timer));
    return promise;
  }

  async function close() {
    if (exited) return;
    try { await call('quit', undefined, 3_000); } catch { /* ok */ }
    if (!exited) {
      try { child.kill('SIGTERM'); } catch { /* ok */ }
      await new Promise((r) => setTimeout(r, 100));
      if (!exited) {
        try { child.kill('SIGKILL'); } catch { /* ok */ }
      }
    }
  }

  return { id, label, child, call, close, get exited() { return exited; } };
}

/**
 * Compare two probe results and report differences for each surface.
 * Returns a list of mismatch descriptors (empty list = match).
 *
 * Comparison rule: we ONLY flag a diff when BOTH sides have a defined
 * value AND they differ. A missing-on-one-side is silent because the
 * authoritative probe deliberately doesn't compute every field the
 * worker computes (LI doc-id digest in particular — that would require
 * fully instantiating the LI index and we already do that in the worker).
 */
function compareProbes(actual, expected, { label = '' } = {}) {
  const diffs = [];
  const pickKey = (obj, ...keys) => {
    let cur = obj;
    for (const k of keys) {
      if (cur == null) return undefined;
      cur = cur[k];
    }
    return cur;
  };
  const check = (path, kind = undefined) => {
    const parts = path.split('.');
    const a = pickKey(actual, ...parts);
    const b = pickKey(expected, ...parts);
    if (a === undefined || b === undefined) return;
    if (a !== b) diffs.push({ surface: path, label, actual: a, expected: b, kind });
  };

  // SHA digests on IDs across the canonical-artifact surfaces.
  check('vectors.live.sha', 'vectors_live_sha');
  check('hnsw.ids.sha', 'hnsw_idmap_sha');
  check('binaryHnsw.visible.sha', 'bin_hnsw_visible_sha');
  check('binaryHnsw.int8.sha', 'bin_hnsw_int8_sha');
  check('sparse.liveFiles.sha', 'sparse_live_sha');

  // Counts that must match where defined.
  check('vectors.live.count', 'vector_live_count');
  check('vectors.total', 'vector_total');
  check('hnsw.ids.count', 'hnsw_idmap_count');
  check('binaryHnsw.totalVectors', 'bin_hnsw_total');
  check('binaryHnsw.visible.count', 'bin_hnsw_visible_count');
  check('binaryHnsw.int8.count', 'bin_hnsw_int8_count');
  check('binaryHnsw.stalePopcount', 'bin_hnsw_stale_popcount');
  check('sparse.directorySegmentCount', 'sparse_dir_segs');
  check('sparse.manifestSegmentCount', 'sparse_manifest_segs');
  check('sparse.recordsResolved', 'sparse_records_resolved');
  check('sparse.liveCount', 'sparse_live_count');
  check('sparse.deletedCount', 'sparse_deleted_count');

  // Cross-shape: worker's LI doc count vs authoritative live-doc count.
  const aLiveLI = pickKey(actual, 'li', 'docs', 'count');
  const bLiveLI = (() => {
    const total = pickKey(expected, 'li', 'totalDocs');
    const tomb = pickKey(expected, 'li', 'tombstoned');
    if (typeof total !== 'number') return undefined;
    return total - (tomb || 0);
  })();
  if (aLiveLI !== undefined && bLiveLI !== undefined && aLiveLI !== bLiveLI) {
    diffs.push({ surface: 'li.liveDocsCount', label, actual: aLiveLI, expected: bLiveLI, kind: 'li_live_doc_count' });
  }

  return diffs;
}

/**
 * Force every maintenance handler to fire by zeroing the thresholds for
 * this run. Forces `evaluateWatermarks` to enqueue every tier when any
 * activity has occurred.
 */
function forcedMaintenanceEnv() {
  return {
    SWEET_SEARCH_HNSW_TOMBSTONE_THRESHOLD: '0',
    SWEET_SEARCH_HNSW_DELETE_CYCLES: '0',
    SWEET_SEARCH_BINARY_HNSW_DEAD_THRESHOLD: '0',
    SWEET_SEARCH_LI_SEGMENT_STALE_THRESHOLD: '0',
    SWEET_SEARCH_SPARSE_DELTA_RATIO: '0',
    SWEET_SEARCH_SPARSE_DELTA_SEGCOUNT: '0',
    SWEET_SEARCH_FTS5_MERGE_SEGMENT_THRESHOLD: '0',
  };
}

function applyForcedMaintenanceEnv() {
  for (const [k, v] of Object.entries(forcedMaintenanceEnv())) {
    process.env[k] = v;
  }
}

async function tickFn({ fixtureRoot, stateDir, vectorEncoder, liEncoder, emit }) {
  const startedAt = Date.now();
  try {
    const counters = await runProductionReconcileTick({
      projectRoot: fixtureRoot, stateDir,
      vectorEncoder, liEncoder, modelInfo: MODEL_INFO,
      logger: { info() {}, warn() {}, error() {} },
      config: { filesPerTick: 200, cpuBudgetMs: 30_000 },
    });
    const took = Date.now() - startedAt;
    emit({ phase: 'tick_complete', took, counters });
    return { ok: true, counters, took };
  } catch (err) {
    emit({ phase: 'tick_error', took: Date.now() - startedAt, error: err.message, stack: err.stack });
    return { ok: false, err };
  }
}

async function drainMaintenance({ stateDir, emit, maxJobs = 32, maxAttempts = 3 }) {
  try {
    const summary = await processMaintenanceQueue(stateDir, {
      handlers: defaultMaintenanceHandlers(stateDir),
      maxJobs, maxAttempts,
    });
    emit({ phase: 'maintenance_drain', summary });
    return summary;
  } catch (err) {
    emit({ phase: 'maintenance_drain_error', error: err.message });
    return null;
  }
}

/**
 * Enqueue one job per tier so every handler is exercised even when the
 * watermark scheduler hasn't flagged that tier this tick (e.g. binary
 * HNSW with no live tombstones). Idempotent — the queue's coalescing
 * skips duplicates.
 */
function enqueueAllTiersIfPossible(stateDir) {
  const liSegmentDir = path.join(stateDir, 'codebase-late-interaction.db.segments');
  const liManifestPath = path.join(liSegmentDir, 'manifest.json');
  let liSegmentId = null;
  if (fs.existsSync(liManifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(liManifestPath, 'utf-8'));
      if (Array.isArray(m?.segments)) {
        for (const seg of m.segments) {
          const seg0Stale = path.join(liSegmentDir, `${seg.path}.stale.bin`);
          if (fs.existsSync(seg0Stale)) {
            liSegmentId = seg.path;
            break;
          }
        }
      }
    } catch { /* tolerate */ }
  }
  enqueueMaintenanceJob(stateDir, {
    tier: 'sparse_gram', reason: 'forced_test',
    epoch: 0, payload: {},
  });
  enqueueMaintenanceJob(stateDir, {
    tier: 'binary_hnsw', reason: 'forced_test',
    epoch: 0, payload: {},
  });
  if (liSegmentId) {
    enqueueMaintenanceJob(stateDir, {
      tier: 'li_segment', reason: 'forced_test',
      epoch: 0, payload: { segmentId: liSegmentId },
    });
  }
  return { liSegmentId };
}

/* ------------------------------------------------------------------ *
 * Authoritative probe — what the on-disk state ACTUALLY says now.
 * Used as the "expected" reference against which fresh readers and
 * long-lived readers are compared.
 * ------------------------------------------------------------------ */

function hashDigest(values) {
  // Match cross-process-reader's `digest()` exactly so SHAs are comparable.
  const sorted = [...values].map(String).sort();
  const h = createHash('sha256');
  for (const v of sorted) h.update(v).update('\0');
  return { count: sorted.length, sha: h.digest('hex').slice(0, 16), sample: sorted.slice(0, 5) };
}

function authoritativeProbe(stateDir) {
  // Build the same shape the worker's probe() returns so `compareProbes`
  // works directly. This is THE on-disk truth used as the comparison
  // reference for fresh and long-lived reader probes.
  const out = { vectors: null, hnsw: null, binaryHnsw: null, li: null, sparse: null, manifestNow: null, errors: [] };
  try {
    const m = readManifest(stateDir);
    out.manifestNow = m ? {
      epoch: m.epoch,
      sparseGramEpoch: m.sparseGram?.epoch ?? null,
      sparseWeightsId: m.sparseGram?.weightsId ?? null,
      sparseDeltas: Array.isArray(m.sparseGram?.deltas) ? m.sparseGram.deltas : [],
    } : null;
  } catch (err) { out.errors.push({ surface: 'manifest', error: err.message }); }

  const dbPath = path.join(stateDir, 'codebase.db');
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.prepare('SELECT id, epoch_retired FROM vectors').all();
      const live = rows.filter((r) => r.epoch_retired == null).map((r) => r.id);
      const retired = rows.filter((r) => r.epoch_retired != null).map((r) => r.id);
      out.vectors = { live: hashDigest(live), retired: hashDigest(retired), total: rows.length };
    } finally { db.close(); }
  }

  const hnswMeta = path.join(stateDir, 'codebase-hnsw.meta.json');
  if (fs.existsSync(hnswMeta)) {
    try {
      const meta = JSON.parse(fs.readFileSync(hnswMeta, 'utf-8'));
      const ids = (meta.idMap || []).map(([id]) => id);
      out.hnsw = { ids: hashDigest(ids), nextKey: meta.nextKey, dimension: meta.dimension, stalePopcount: 0 };
    } catch (err) { out.errors.push({ surface: 'hnsw_meta', error: err.message }); }
  }

  const binMeta = path.join(stateDir, 'codebase-binary-hnsw.meta.json');
  const binVectors = path.join(stateDir, 'codebase-binary-hnsw.vectors.json');
  if (fs.existsSync(binMeta) && fs.existsSync(binVectors)) {
    try {
      const vec = JSON.parse(fs.readFileSync(binVectors, 'utf-8'));
      const allIds = vec.map((v) => v.id);
      const stalePath = path.join(stateDir, 'codebase-binary-hnsw.idx.stale.bin');
      let bm = null;
      if (fs.existsSync(stalePath)) { try { bm = loadBitmap(stalePath); } catch { bm = null; } }
      const visible = [];
      let stalePopcount = 0;
      for (let i = 0; i < vec.length; i += 1) {
        if (bm && isSet(bm, i)) stalePopcount += 1;
        else visible.push(vec[i].id);
      }
      let int8Ids = [];
      const int8Path = path.join(stateDir, 'codebase-binary-hnsw.int8.json');
      if (fs.existsSync(int8Path)) {
        try {
          const obj = JSON.parse(fs.readFileSync(int8Path, 'utf-8'));
          int8Ids = Object.keys(obj || {});
        } catch { /* tolerate */ }
      }
      out.binaryHnsw = {
        totalVectors: vec.length,
        visible: hashDigest(visible),
        all: hashDigest(allIds),
        int8: hashDigest(int8Ids),
        stalePopcount,
        stalePresent: !!bm,
      };
    } catch (err) { out.errors.push({ surface: 'binary_hnsw', error: err.message }); }
  }

  // LI: read segment manifest + per-segment stale bitmap to derive live
  // doc count without instantiating the full index (fast, deterministic).
  const liStubPath = path.join(stateDir, 'codebase-late-interaction.db');
  if (fs.existsSync(liStubPath)) {
    try {
      const stub = JSON.parse(fs.readFileSync(liStubPath, 'utf-8'));
      if (stub?.format === 'segmented' && stub.segmentDir) {
        const segDir = path.resolve(stateDir, stub.segmentDir);
        const liMfPath = path.join(segDir, 'manifest.json');
        if (fs.existsSync(liMfPath)) {
          const liMf = JSON.parse(fs.readFileSync(liMfPath, 'utf-8'));
          let totalDocs = 0;
          let tombstoned = 0;
          for (const seg of liMf?.segments || []) {
            const count = Number(seg?.count) || 0;
            totalDocs += count;
            const sidecarPath = path.join(segDir, seg.path + '.stale.bin');
            if (fs.existsSync(sidecarPath)) {
              try {
                const bm = loadBitmap(sidecarPath);
                if (bm) {
                  for (let i = 0; i < count; i += 1) if (isSet(bm, i)) tombstoned += 1;
                }
              } catch { /* tolerate */ }
            }
          }
          out.li = {
            modelId: liMf?.modelId ?? null,
            totalDocs, tombstoned,
            // We do NOT compute a per-doc digest here — the worker uses the
            // index's live doc IDs (which excludes tombstoned ones). The
            // comparison happens via counts; a `docs.sha` mismatch with the
            // worker is expected because the worker has actual doc IDs.
          };
        }
      }
    } catch (err) { out.errors.push({ surface: 'li', error: err.message }); }
  }

  const basePath = path.join(stateDir, 'codebase-sparse-grams.idx');
  try {
    const manifest = readManifest(stateDir);
    const maxEpoch = Number.isInteger(manifest?.epoch) ? manifest.epoch : Number.MAX_SAFE_INTEGER;
    const dirSegs = listSparseGramDeltaSegments(basePath, { maxEpoch });
    const manifestSegments = Array.isArray(manifest?.sparseGram?.deltas) ? manifest.sparseGram.deltas : null;
    const manifestSegPaths = manifestSegments
      ? manifestSegments.map((s) => (path.isAbsolute(s) ? s : path.join(stateDir, s)))
      : null;
    const manifestMissing = manifestSegPaths
      ? manifestSegPaths.filter((p) => !fs.existsSync(p)).map((p) => path.basename(p))
      : null;
    // Resolve records via MANIFEST-PINNED segments (this is what fresh
    // sweet-search readers do).
    const records = manifestSegments != null
      ? resolveLatestSparseGramDeltaRecords(basePath, { maxEpoch, segments: manifestSegments })
      : new Map();
    const liveFiles = [];
    let deletedCount = 0;
    for (const { record } of records.values()) {
      if (record.deleted) deletedCount += 1;
      else liveFiles.push(record.filePath);
    }
    out.sparse = {
      manifestSegmentCount: manifestSegments ? manifestSegments.length : null,
      manifestExisting: manifestSegPaths ? manifestSegPaths.filter((p) => fs.existsSync(p)).length : null,
      manifestMissing,
      directorySegmentCount: dirSegs.length,
      recordsResolved: records.size,
      liveCount: liveFiles.length,
      deletedCount,
      liveFiles: hashDigest(liveFiles),
    };
  } catch (err) { out.errors.push({ surface: 'sparse', error: err.message }); }

  return out;
}

/* ------------------------------------------------------------------ *
 * MODE: between-ticks                                                  *
 * ------------------------------------------------------------------ */

async function modeBetweenTicks({ args, emit, fixtureRoot, stateDir, ground, vectorEncoder, liEncoder, log }) {
  const summary = { mode: 'between-ticks', scenarios: [] };

  // Bootstrap tick — publish epoch 1, every artifact populated.
  emit({ phase: 'phase2_bootstrap_start' });
  await tickFn({ fixtureRoot, stateDir, vectorEncoder, liEncoder, emit });
  emit({ phase: 'phase2_bootstrap_complete', manifest: readManifest(stateDir) });

  // Spawn long-lived readers; they capture the post-bootstrap state.
  const longLived = [];
  for (let i = 0; i < args.readerCount; i += 1) {
    const r = spawnReader({ id: i, label: `ll-${i}`, stateDir, emit });
    longLived.push(r);
  }
  for (const r of longLived) {
    const res = await r.call('init', { stateDir });
    emit({ phase: 'longlived_init', reader: r.id, result_manifest: res.manifestNow });
  }

  // Apply a batch of mutations sufficient to create work for every
  // maintenance tier (delete + update_symbol = HNSW tombstones, body +
  // sentinel = sparse deltas, LI tombstones).
  const mutator = new Mutator({
    projectRoot: fixtureRoot, ground,
    seed: args.seed + 5000, queuePath: path.join(stateDir, 'index-maintainer-queue.jsonl'),
    log: () => {},
  });
  for (let i = 0; i < 8; i += 1) mutator.applyOne();
  emit({ phase: 'phase2_mutations_applied', count: 8 });

  // Tick N+1.
  await tickFn({ fixtureRoot, stateDir, vectorEncoder, liEncoder, emit });
  const manifestPostTick = readManifest(stateDir);
  emit({ phase: 'phase2_tick_n1_complete', manifest: manifestPostTick });

  // Snapshot disk state before maintenance (for comparison after).
  const before = authoritativeProbe(stateDir);
  emit({ phase: 'phase2_before_maintenance_probe', state: before });

  // Force every tier to run.
  const forced = enqueueAllTiersIfPossible(stateDir);
  emit({ phase: 'phase2_forced_enqueue', forced });
  const drain = await drainMaintenance({ stateDir, emit, maxJobs: 32 });
  emit({ phase: 'phase2_drain_done', drain });

  // Post-maintenance snapshot (this is what fresh readers will see).
  const after = authoritativeProbe(stateDir);
  emit({ phase: 'phase2_after_maintenance_probe', state: after });

  // Probe long-lived readers (cached view) — they should NOT have refreshed.
  const llCached = [];
  for (const r of longLived) {
    const probe = await r.call('probe-cached');
    llCached.push({ id: r.id, probe });
    emit({ phase: 'phase2_longlived_cached_probe', reader: r.id,
      manifest: probe.manifestNow, manifestAtLoad: probe.manifestAtLoad,
      hnsw: probe.hnsw, binaryHnsw: probe.binaryHnsw, li: probe.li,
      sparse: probe.sparse, vectors: probe.vectors,
      errors: probe.errors });
  }

  // Smoke search — does HNSW/Binary HNSW respond without error after the
  // canonical artifacts were rewritten in place?
  const llSmoke = [];
  for (const r of longLived) {
    const smoke = await r.call('search-smoke');
    llSmoke.push({ id: r.id, smoke });
    emit({ phase: 'phase2_longlived_smoke', reader: r.id, smoke });
  }

  // Spawn FRESH readers — they load disk state RIGHT NOW (post-maintenance).
  const fresh = [];
  for (let i = 0; i < args.readerCount; i += 1) {
    const r = spawnReader({ id: 100 + i, label: `fresh-${i}`, stateDir, emit });
    fresh.push(r);
  }
  const freshProbes = [];
  for (const r of fresh) {
    const p = await r.call('init', { stateDir });
    freshProbes.push({ id: r.id, probe: p });
    emit({ phase: 'phase2_fresh_probe', reader: r.id,
      manifest: p.manifestNow, manifestAtLoad: p.manifestAtLoad,
      hnsw: p.hnsw, binaryHnsw: p.binaryHnsw, li: p.li,
      sparse: p.sparse, vectors: p.vectors, errors: p.errors });
  }

  // Compare each fresh reader against the authoritative disk snapshot.
  const freshDiffs = [];
  for (const { id, probe } of freshProbes) {
    const diffs = compareProbes(probe, after, { label: `fresh-${id}` });
    freshDiffs.push({ readerId: id, diffs });
    if (diffs.length > 0) emit({ phase: 'phase2_fresh_diff', readerId: id, diffs });
  }

  // Also: did the long-lived readers' on-disk-tolerant surfaces (sparse,
  // SQLite vectors) match the post-maintenance disk snapshot? The
  // in-memory ones (HNSW/LI) are expected to be stale.
  const llDiffs = [];
  for (const { id, probe } of llCached) {
    const diffs = compareProbes(probe, after, { label: `ll-${id}` });
    llDiffs.push({ readerId: id, diffs });
  }
  emit({ phase: 'phase2_longlived_diff_summary', llDiffs });

  // Apply another batch + tick N+2 to confirm the system recovers.
  for (let i = 0; i < 4; i += 1) mutator.applyOne();
  emit({ phase: 'phase2_mutations_post_maint', count: 4 });
  await tickFn({ fixtureRoot, stateDir, vectorEncoder, liEncoder, emit });
  const manifestPostTick2 = readManifest(stateDir);
  emit({ phase: 'phase2_tick_n2_complete', manifest: manifestPostTick2 });

  // Long-lived readers should NOW refresh — but only via `probe-fresh`,
  // since the worker only auto-refreshes on explicit reload (real
  // sweet-search auto-reloads when manifest epoch changes; our worker is
  // intentionally manual so we can observe staleness vs forced reload).
  const llRefreshed = [];
  for (const r of longLived) {
    const probe = await r.call('probe-fresh');
    llRefreshed.push({ id: r.id, probe });
  }
  const llRefreshedDiffs = [];
  const afterTick2 = authoritativeProbe(stateDir);
  for (const { id, probe } of llRefreshed) {
    const diffs = compareProbes(probe, afterTick2, { label: `ll-${id}-refreshed` });
    llRefreshedDiffs.push({ readerId: id, diffs });
  }
  emit({ phase: 'phase2_longlived_refresh_diff_summary', llRefreshedDiffs });

  // Cleanup.
  for (const r of [...longLived, ...fresh]) await r.close();

  summary.scenarios.push({
    name: 'maintenance-between-ticks',
    bootstrap_manifest_epoch: readManifest(stateDir)?.epoch ?? null,
    forced,
    drain,
    before: digestableProbe(before),
    after: digestableProbe(after),
    llCached: llCached.map(({ id, probe }) => ({ id, ...digestableProbe(probe) })),
    llSmoke,
    freshProbes: freshProbes.map(({ id, probe }) => ({ id, ...digestableProbe(probe) })),
    freshDiffs,
    llDiffs,
    llRefreshedDiffs,
  });

  return summary;
}

function digestableProbe(p) {
  if (!p) return null;
  const out = {
    manifestNow: p.manifestNow ?? null,
    vectors: null,
    hnsw: null,
    binaryHnsw: null,
    li: null,
    sparse: null,
    errors: p.errors ?? null,
  };
  if (p.vectors) {
    out.vectors = {
      count: p.vectors.live?.count ?? null,
      sha: p.vectors.live?.sha ?? null,
      total: p.vectors.total ?? null,
    };
  }
  if (p.hnsw) {
    out.hnsw = {
      count: p.hnsw.ids?.count ?? null,
      sha: p.hnsw.ids?.sha ?? null,
      stalePopcount: p.hnsw.stalePopcount ?? null,
      nextKey: p.hnsw.nextKey ?? null,
      loadError: p.hnsw.loadError ?? null,
    };
  }
  if (p.binaryHnsw) {
    out.binaryHnsw = {
      totalVectors: p.binaryHnsw.totalVectors ?? null,
      visible: {
        count: p.binaryHnsw.visible?.count ?? null,
        sha: p.binaryHnsw.visible?.sha ?? null,
      },
      int8: {
        count: p.binaryHnsw.int8?.count ?? null,
        sha: p.binaryHnsw.int8?.sha ?? null,
      },
      stalePopcount: p.binaryHnsw.stalePopcount ?? null,
      stalePresent: p.binaryHnsw.stalePresent ?? null,
      loadError: p.binaryHnsw.loadError ?? null,
    };
  }
  if (p.li) {
    out.li = {
      // Worker shape:
      docsCount: p.li.docs?.count ?? null,
      docsSha: p.li.docs?.sha ?? null,
      modelId: p.li.modelId ?? null,
      // Authoritative shape:
      totalDocs: p.li.totalDocs ?? null,
      tombstoned: p.li.tombstoned ?? null,
      loadError: p.li.loadError ?? null,
    };
  }
  if (p.sparse) {
    out.sparse = {
      manifestSegmentCount: p.sparse.manifestSegmentCount ?? null,
      manifestExisting: p.sparse.manifestExisting ?? null,
      manifestMissing: p.sparse.manifestMissing ?? null,
      directorySegmentCount: p.sparse.directorySegmentCount ?? null,
      recordsResolved: p.sparse.recordsResolved ?? null,
      liveCount: p.sparse.liveCount ?? null,
      deletedCount: p.sparse.deletedCount ?? null,
      liveSha: p.sparse.liveFiles?.sha ?? null,
    };
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * MODE: soak                                                          *
 * ------------------------------------------------------------------ */

async function modeSoak({ args, emit, fixtureRoot, stateDir, ground, vectorEncoder, liEncoder, log }) {
  const summary = { mode: 'soak', readers: args.readerCount, interval: args.interval, durationSec: args.durationSec };

  // Bootstrap tick.
  await tickFn({ fixtureRoot, stateDir, vectorEncoder, liEncoder, emit });
  emit({ phase: 'soak_bootstrap_complete', manifest: readManifest(stateDir) });

  // Long-lived readers.
  const longLived = [];
  for (let i = 0; i < args.readerCount; i += 1) {
    const r = spawnReader({ id: i, label: `ll-${i}`, stateDir, emit });
    longLived.push(r);
    await r.call('init', { stateDir });
  }

  const mutator = new Mutator({
    projectRoot: fixtureRoot, ground,
    seed: args.seed + 7777, queuePath: path.join(stateDir, 'index-maintainer-queue.jsonl'),
    log: () => {},
  });
  const stopAt = Date.now() + args.durationSec * 1000;
  let nextTickAt = Date.now() + args.interval * 1000;
  let nextMutateAt = Date.now() + args.mutationIntervalMs;
  const stats = {
    ticks: 0, mutations: 0, maintenanceDrains: 0,
    freshReaderSpawns: 0, freshReaderErrors: 0,
    longLivedSmokeErrors: 0,
    crossProcessDiffs: 0,
    longLivedTornAfterMaintenance: 0,
    sparseManifestStaleAfterMaintenance: 0,
  };

  while (Date.now() < stopAt) {
    if (Date.now() >= nextMutateAt) {
      mutator.applyOne();
      stats.mutations += 1;
      nextMutateAt = Date.now() + args.mutationIntervalMs;
    }
    if (Date.now() >= nextTickAt) {
      stats.ticks += 1;
      await tickFn({ fixtureRoot, stateDir, vectorEncoder, liEncoder, emit });

      // Force every tier to run.
      const forced = enqueueAllTiersIfPossible(stateDir);
      const drain = await drainMaintenance({ stateDir, emit, maxJobs: 32 });
      stats.maintenanceDrains += 1;

      // Post-maintenance authoritative snapshot.
      const afterMaint = authoritativeProbe(stateDir);

      // Long-lived smoke + cached probe.
      for (const r of longLived) {
        try {
          const smoke = await r.call('search-smoke');
          if ((smoke.hnsw && smoke.hnsw.ok === false) || (smoke.binaryHnsw && smoke.binaryHnsw.ok === false)) {
            stats.longLivedSmokeErrors += 1;
            stats.longLivedTornAfterMaintenance += 1;
            emit({ phase: 'longlived_smoke_failed', reader: r.id, smoke });
          }
          const probe = await r.call('probe-cached');
          if (probe.errors && probe.errors.length > 0) {
            emit({ phase: 'longlived_probe_errors', reader: r.id, errors: probe.errors });
          }
          // Sparse manifest staleness: long-lived reader's manifest read is
          // fresh-per-probe, but the manifest stays at the LAST reconcile
          // epoch. After maintenance compaction, the manifest's
          // `sparseGram.deltas` list still references segments that may now
          // be deleted on disk. Count occurrences.
          if (probe.sparse?.manifestMissing && probe.sparse.manifestMissing.length > 0) {
            stats.sparseManifestStaleAfterMaintenance += 1;
            emit({ phase: 'longlived_sparse_manifest_stale', reader: r.id,
              missing: probe.sparse.manifestMissing,
              directorySegmentCount: probe.sparse.directorySegmentCount,
              manifestSegmentCount: probe.sparse.manifestSegmentCount });
          }
        } catch (err) {
          stats.longLivedSmokeErrors += 1;
          emit({ phase: 'longlived_probe_threw', reader: r.id, error: err.message });
        }
      }

      // Spawn fresh reader, init, probe, exit.
      const fresh = spawnReader({ id: 1_000_000 + stats.freshReaderSpawns, label: `fresh-${stats.freshReaderSpawns}`, stateDir, emit });
      stats.freshReaderSpawns += 1;
      try {
        const p = await fresh.call('init', { stateDir });
        const diffs = compareProbes(p, afterMaint, { label: `fresh-${fresh.id}` });
        if (diffs.length > 0) {
          stats.crossProcessDiffs += 1;
          emit({ phase: 'fresh_diff', readerId: fresh.id, diffs,
            manifestNow: p.manifestNow,
            sparseRecords: p.sparse?.recordsResolved,
            sparseLive: p.sparse?.liveCount });
        }
        // Sparse delta zero-records is the key "fresh reader regression"
        // signature: the manifest lists segments that no longer exist, so
        // resolveLatestSparseGramDeltaRecords returns 0 records.
        if (p.sparse && p.sparse.manifestMissing && p.sparse.manifestMissing.length > 0) {
          emit({ phase: 'fresh_sparse_manifest_stale', readerId: fresh.id,
            missing: p.sparse.manifestMissing,
            directorySegmentCount: p.sparse.directorySegmentCount,
            recordsResolved: p.sparse.recordsResolved });
        }
      } catch (err) {
        stats.freshReaderErrors += 1;
        emit({ phase: 'fresh_reader_error', error: err.message });
      } finally {
        await fresh.close();
      }

      nextTickAt = Date.now() + args.interval * 1000;
    }
    await sleep(50);
  }

  for (const r of longLived) await r.close();
  summary.stats = stats;
  summary.finalManifest = readManifest(stateDir);
  return summary;
}

/* ------------------------------------------------------------------ *
 * Main                                                                *
 * ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['between-ticks', 'soak'].includes(args.mode)) {
    process.stderr.write(`unknown mode: ${args.mode}\n`); process.exit(2);
  }
  const label = args.label || `xproc-${args.mode}-${Date.now()}`;
  const fixtureRoot = args.fixtureRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'ss-xproc-'));
  const stateDir = path.join(fixtureRoot, '.sweet-search');
  fs.mkdirSync(stateDir, { recursive: true });

  applyForcedMaintenanceEnv();

  // Reader child crashes (SIGSEGV from a stale mmap) reject in-flight RPC
  // promises that the orchestrator MUST tolerate so we can still write the
  // postmortem summary. Install the handler before any spawn happens.
  process.on('unhandledRejection', (err) => {
    process.stderr.write(`[${ts()}] xproc unhandled rejection: ${err?.stack || err?.message || err}\n`);
  });

  const outPath = args.out
    ? path.resolve(args.out)
    : path.resolve(`eval/results/incremental-soak/cross-process-${label}.jsonl`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const summaryPath = outPath.replace(/\.jsonl$/, '.summary.json');
  const emit = jsonlAppender(outPath);

  emit({ phase: 'start', label, args, fixtureRoot, stateDir, pid: process.pid, host: os.hostname(),
    forcedEnv: forcedMaintenanceEnv() });
  process.stderr.write(`[${ts()}] xproc start: ${label} root=${fixtureRoot} out=${outPath}\n`);

  // Silence the noisy index-load console.log spam from the orchestrator
  // too — keeps stderr quiet, JSONL clean.
  console.log = () => {};

  // Fixture + ground truth.
  const descriptors = generateInitialFixture({ projectRoot: fixtureRoot, filesPerLang: args.initialFilesPerLang });
  const ground = new GroundTruth(descriptors);
  emit({ phase: 'fixture_ready', fileCount: descriptors.length });

  // Seed the dirty queue.
  const queuePath = path.join(stateDir, 'index-maintainer-queue.jsonl');
  for (const d of descriptors) {
    fs.appendFileSync(queuePath, JSON.stringify({ file_path: d.rel, timestamp: Date.now(), source: 'xproc-bootstrap' }) + '\n');
  }

  const vectorEncoder = fakeVectorEncoder();
  const liEncoder = fakeLiEncoder();

  let summary;
  try {
    if (args.mode === 'between-ticks') {
      summary = await modeBetweenTicks({ args, emit, fixtureRoot, stateDir, ground, vectorEncoder, liEncoder, log: emit });
    } else {
      summary = await modeSoak({ args, emit, fixtureRoot, stateDir, ground, vectorEncoder, liEncoder, log: emit });
    }
  } catch (err) {
    emit({ phase: 'fatal', error: err.message, stack: err.stack });
    process.stderr.write(`[${ts()}] xproc fatal ${err.stack || err.message}\n`);
    process.exitCode = 3;
    summary = { mode: args.mode, error: err.message };
  }

  fs.writeFileSync(summaryPath, JSON.stringify({ label, args, fixtureRoot, ...summary }, null, 2));
  emit({ phase: 'summary', summary });
  process.stderr.write(`[${ts()}] xproc done: summary=${summaryPath}\n`);

  if (!args.keepFixture) {
    try { fs.rmSync(fixtureRoot, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

main().catch((err) => {
  process.stderr.write(`[${ts()}] xproc FATAL ${err.stack || err.message}\n`);
  process.exit(3);
});
