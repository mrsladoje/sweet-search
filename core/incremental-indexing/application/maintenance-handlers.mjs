/**
 * Maintenance handlers — real implementations for the four reclamation
 * tiers the soak REPORT.md flagged as queue-only.
 *
 * Each handler is registered by `defaultMaintenanceHandlers()` in
 * `maintenance-worker.mjs`. Handlers run inside the reconcile daemon's
 * single-writer process, so on-disk artifacts have one writer at a time.
 *
 * Atomicity contract: per artifact-family, each handler writes its new
 * artifacts via a path that sorts later than the existing ones (merged
 * sparse-gram deltas), an explicit temp+rename (LI segments, the rebuilt
 * sparse-gram base), or via the existing `*.next` clean-build flag (Binary
 * HNSW). After a successful publish the handler clears the tier's stale
 * bitmap; on failure the previous artifacts remain readable.
 *
 * Manifest semantics:
 *   - sparse_gram: same epoch; the manifest's delta list drops the segments a
 *     merge or base rebuild consumed (they stay on disk for a grace period), and
 *     a rebuild sets the new weights id. Readers reload the base by file identity.
 *   - LI segment: the reconcile manifest is unchanged. New artifacts replace
 *     old ones at canonical paths read fresh per query.
 *   - Binary HNSW: canonical paths unchanged; the reconcile manifest
 *     stays at the current epoch. Cross-process readers that cache a
 *     binary HNSW index in memory MUST already invalidate on manifest
 *     change — but maintenance does not bump the epoch by itself. This
 *     matches the existing reconcile tick semantics; a follow-up
 *     workstream can add versioned tier paths if needed.
 *
 * The handlers degrade safely when artifacts are missing/corrupt — they
 * throw a descriptive error which the worker converts into the standard
 * retry/dead-letter path.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { BinaryHNSWIndex, EXACT_SCAN_MAX_VECTORS, binaryHnswIndexExists } from '../../vector-store/binary-hnsw-index.js';
import {
  buildCompactedBase, discardStagedCompaction, publishCompactedBase, readLiveVectorIds,
  rollForwardHnswCompaction, startBackgroundCompaction,
} from '../infrastructure/hnsw-compaction.mjs';
import { LateInteractionIndex } from '../../ranking/late-interaction-index.js';
import {
  compactDeltaSegments, deltaSizeStats, listDeltaSegments, sweepRetiredDeltaSegments,
} from '../infrastructure/sparse-gram-delta.mjs';
import { DEFAULT_WATERMARKS, loadWatermarkConfig } from '../domain/watermark-scheduler.mjs';
import { loadSparseGramIndex, getSparseGramAllFiles } from '../../infrastructure/native-sparse-gram.js';
import { buildSparseGramFold, publishSparseGramFold } from '../infrastructure/sparse-gram-fold.mjs';
import { startBackgroundBuild } from '../infrastructure/background-build.mjs';
import { mergeLiSegments, collectLiveDocs, nextSegmentSeq, quarantineSegmentFiles, LI_MERGE_GRACE_MS } from '../infrastructure/li-segment-merge.mjs';
import { runVectorGc } from '../infrastructure/vector-gc.mjs';
import { runGraphGc } from '../infrastructure/graph-gc.mjs';
import { PAGERANK_STATE, VOCAB_RUNNING, VOCAB_STATE, graphChangeEpoch } from '../infrastructure/maintenance-state-reader.mjs';
import { refreshVocabulary } from '../../vocabulary/vocab-warmup-orchestrator.js';
import { populatePageRankColumn } from '../../graph/structural-pagerank.js';
import { minLiveEpoch } from '../infrastructure/reader-heartbeat.mjs';
import { readManifest, writeManifest } from '../infrastructure/manifest.mjs';
import {
  loadBitmap, popcount, isSet, createBitmap, saveBitmap,
} from '../infrastructure/tombstone-bitmap.mjs';

function safeUnlink(p) { try { fs.unlinkSync(p); } catch { /* ok */ } }
function progressFn(onProgress) {
  return typeof onProgress === 'function'
    ? (phase) => { onProgress(phase); }
    : () => {};
}

function float32FromBuffer(buffer) {
  const view = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(view);
}

/* ------------------------------------------------------------------ *
 * sparse_gram                                                         *
 * ------------------------------------------------------------------ */

// Files above which the fold runs in a child process (it reads every file); one at
// a time per base.
export const SPARSE_FOLD_INLINE_MAX_FILES = 2000;
let sparseFold = null;
let sparseInlineMaxFiles = SPARSE_FOLD_INLINE_MAX_FILES;

function baseIdentity(p) {
  try { const st = fs.statSync(p); return `${st.ino}:${st.size}:${st.mtimeMs}`; } catch { return null; }
}

/** Test seams: the inline-fold size, and the running background fold. */
export const __sparseTesting = {
  setInlineMaxFiles(n) { sparseInlineMaxFiles = n; },
  fold: () => sparseFold,
};

/**
 * Sparse-gram maintenance:
 *   1. past the delta size ratio, rebuild the base from the corpus on disk and empty the
 *      deltas (sparse-gram-fold.mjs): merging deltas alone kept the ratio, so the job
 *      fired again on every tick and rewrote the whole delta each time. Above
 *      SPARSE_FOLD_INLINE_MAX_FILES the build runs in a child process across drains
 *      (the job stays queued until it ends) while ticks continue;
 *   2. else past the segment count, merge the segments into one;
 *   3. publish: the manifest lists exactly the live segments (this also repairs a list
 *      that a failed publish left pointing at retired segments);
 *   4. delete the retired segments past their grace, except any the manifest lists.
 * Consumed segments stay on disk for readers holding an older manifest until then.
 */
export async function sparseGramHandler(job, { stateDir, projectRoot = null, onProgress = null, config = DEFAULT_WATERMARKS }) {
  const progress = progressFn(onProgress);
  const base = path.join(stateDir, 'codebase-sparse-grams.idx');
  const root = projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT || path.dirname(stateDir);
  const stats = deltaSizeStats(base);
  let action = null;
  let result = {};
  if (sparseFold?.base === base) {
    // No merge while the build runs: the segments after its snapshot are the ones
    // the publish re-extracts.
    if (!sparseFold.done) return { requeue: true, background: 'building' };
    const built = sparseFold;
    sparseFold = null;
    if (built.error) {
      safeUnlink(`${base}.next`);
      throw built.error;
    }
    if (baseIdentity(base) !== built.baseIdentity) {
      // A full build replaced the base meanwhile: the fold is stale.
      safeUnlink(built.result.stagedPath);
      return { skipped: 'base-replaced' };
    }
    const published = publishSparseGramFold({ base, stagedPath: built.result.stagedPath, segments: built.segments, projectRoot: built.projectRoot, weightsId: built.result.weightsId });
    result = { files: built.result.files, weightsId: built.result.weightsId, background: true, ...published };
    action = 'fold';
  } else if (stats.ratio > (config.sparseDeltaRatio ?? DEFAULT_WATERMARKS.sparseDeltaRatio) && fs.existsSync(base)) {
    const segments = listDeltaSegments(base).map((seg) => seg.path);
    const fileCount = (getSparseGramAllFiles(loadSparseGramIndex(base)) || []).length;
    if (fileCount > sparseInlineMaxFiles) {
      sparseFold = startBackgroundBuild('sparse_gram', { stateDir, base, projectRoot: root, segments });
      Object.assign(sparseFold, { base, segments, projectRoot: root, baseIdentity: baseIdentity(base) });
      progress('maintenance:sparse-gram:background');
      return { requeue: true, background: 'started', files: fileCount };
    }
    const built = await buildSparseGramFold({ stateDir, base, projectRoot: root, segments });
    const published = publishSparseGramFold({ base, stagedPath: built.stagedPath, segments, projectRoot: root, weightsId: built.weightsId });
    result = { files: built.files, weightsId: built.weightsId, ...published };
    action = 'fold';
  } else if (stats.deltaSegments > (config.sparseDeltaSegmentCount ?? DEFAULT_WATERMARKS.sparseDeltaSegmentCount)) {
    const compacted = compactDeltaSegments(base, { dropTombstones: false });
    if (!compacted.skipped) {
      result = {
        recordsWritten: compacted.recordsWritten,
        consumedSegments: compacted.consumedSegmentPaths.length,
        compactedPath: path.relative(stateDir, compacted.compactedPath).replace(/\\/g, '/'),
      };
      action = 'merge';
    }
  }
  if (action) progress(`maintenance:sparse-gram:${action}`);

  let manifestUpdated = false;
  let manifestError = null;
  let listed = null;
  try {
    const manifest = readManifest(stateDir);
    if (manifest?.sparseGram) {
      const live = listDeltaSegments(base).map((seg) => path.relative(stateDir, seg.path).replace(/\\/g, '/'));
      const prev = Array.isArray(manifest.sparseGram.deltas) ? manifest.sparseGram.deltas : [];
      const weightsChanged = !!result.weightsId && result.weightsId !== manifest.sparseGram.weightsId;
      if (weightsChanged || prev.length !== live.length || prev.some((p, i) => p !== live[i])) {
        manifest.sparseGram.deltas = live;
        if (weightsChanged) manifest.sparseGram.weightsId = result.weightsId;
        writeManifest(stateDir, manifest);
        manifestUpdated = true;
      }
      listed = new Set(manifest.sparseGram.deltas.map((p) => path.basename(p)));
    }
  } catch (err) {
    manifestError = err?.message || String(err);
  }
  // Without a published list, keep every retired segment: the manifest may still name it.
  const swept = manifestError ? 0 : sweepRetiredDeltaSegments(base, { keep: listed });
  if (!action && !manifestUpdated && swept === 0) return { skipped: 'under-watermarks' };

  return {
    tier: 'sparse_gram',
    ...(action ? { action } : {}),
    sweptSegments: swept,
    ...result,
    manifestUpdated,
    ...(manifestError ? { manifestError } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * binary_hnsw                                                         *
 * ------------------------------------------------------------------ */

// The graph build of a large base runs in a child process across drains; one at a
// time per index (this process is the index's single writer).
let hnswBuild = null;
// Live nodes above which the base keeps a graph (search walks it); tests lower it.
let hnswGraphMin = EXACT_SCAN_MAX_VECTORS;

/** Test seams: the graph threshold, and the running background build. */
export const __hnswTesting = {
  setGraphMin(n) { hnswGraphMin = n; },
  build: () => hnswBuild,
};

/**
 * Fold the delta rows into a new base and drop retired nodes (hnsw-compaction.mjs).
 * Up to EXACT_SCAN_MAX_VECTORS live nodes the base is flat and built inline (no
 * graph: search scans it). Above, a child process builds the graph from a snapshot
 * while ticks continue; the job stays queued (`requeue`) until the build ends, and
 * the drain after that publishes it.
 */
export async function binaryHnswHandler(job, { stateDir, onProgress = null }) {
  const progress = progressFn(onProgress);
  const indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
  rollForwardHnswCompaction(indexPath);
  if (!binaryHnswIndexExists(indexPath)) return { skipped: 'no-index' };

  if (hnswBuild?.indexPath === indexPath) {
    if (!hnswBuild.done) return { requeue: true, background: 'building' };
    const built = hnswBuild;
    hnswBuild = null;
    if (built.error) {
      discardStagedCompaction(indexPath);
      throw built.error;
    }
    const published = await publishCompactedBase({
      indexPath, stagedPath: built.result.stagedPath, snapshotCount: built.result.snapshotCount, baseGeneration: built.baseGeneration,
    });
    if (published.skipped) return published;
    progress('maintenance:binary-hnsw:published');
    return { tier: 'binary_hnsw', graph: true, background: true, dropped: built.result.dropped, ...published };
  }

  const existing = new BinaryHNSWIndex({ indexPath });
  await existing.load(indexPath);
  progress('maintenance:binary-hnsw:loaded');
  let liveCount = 0;
  let dropped = 0;
  const liveIds = readLiveVectorIds(stateDir);
  const stale = existing._loadStaleBitmap();
  for (let i = 0; i < existing.size; i += 1) {
    const id = existing.nodeId(i);
    if (liveIds ? !liveIds.has(id) : (stale && isSet(stale, i))) dropped += 1;
    else liveCount += 1;
  }
  const deltaCount = existing.deltaCount;
  const hasGraph = !existing.graphless;
  const total = existing.size;
  existing.close();
  const needsGraph = liveCount > hnswGraphMin;
  if (dropped === 0 && deltaCount === 0 && (needsGraph ? hasGraph : true)) {
    return { skipped: 'no-stale-vectors', dropped: 0 };
  }
  if (needsGraph) {
    discardStagedCompaction(indexPath);
    hnswBuild = startBackgroundCompaction({ indexPath, stateDir, snapshotCount: total });
    progress('maintenance:binary-hnsw:background');
    return { requeue: true, background: 'started', snapshotCount: total };
  }
  const built = await buildCompactedBase({ indexPath, stateDir, graph: false, onProgress: progress });
  const published = await publishCompactedBase({ indexPath, stagedPath: built.stagedPath, snapshotCount: built.snapshotCount });
  progress('maintenance:binary-hnsw:saved');
  return {
    tier: 'binary_hnsw',
    graph: false,
    kept: built.count,
    dropped: built.dropped,
    foldedDelta: deltaCount,
    staleBitmapCleared: true,
    atomicPublish: true,
    ...published,
  };
}

/* ------------------------------------------------------------------ *
 * li_segment                                                          *
 * ------------------------------------------------------------------ */

/**
 * Per-segment recompaction. Reads the sealed segment, drops docs marked
 * by the segment's stale bitmap, writes a new compacted segment, then
 * updates the segment manifest atomically.
 *
 * Crash recovery: if we fail after writing the compacted segment but
 * before updating the manifest, the next pass re-runs from the
 * (untouched) old segment.
 */
export async function liSegmentHandler(job, { stateDir, onProgress = null }) {
  const progress = progressFn(onProgress);
  const segmentId = job?.payload?.segmentId;
  if (!segmentId || typeof segmentId !== 'string') {
    throw new Error('li_segment: missing payload.segmentId');
  }
  const stubPath = path.join(stateDir, 'codebase-late-interaction.db');
  if (!fs.existsSync(stubPath)) return { skipped: 'no-li-index' };
  let stub;
  try { stub = JSON.parse(fs.readFileSync(stubPath, 'utf-8')); } catch { return { skipped: 'corrupt-stub' }; }
  if (stub?.format !== 'segmented' || !stub.segmentDir) return { skipped: 'legacy-format' };
  const segmentDir = path.resolve(stateDir, stub.segmentDir);
  const manifestPath = path.join(segmentDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { skipped: 'no-segments-manifest' };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { return { skipped: 'corrupt-manifest' }; }
  if (!Array.isArray(manifest.segments)) return { skipped: 'corrupt-manifest' };

  const segmentEntry = manifest.segments.find((s) => s?.path === segmentId);
  if (!segmentEntry) return { skipped: 'unknown-segment' };

  const segmentPath = path.join(segmentDir, segmentId);
  const staleSidecar = segmentPath + '.stale.bin';
  if (!fs.existsSync(staleSidecar)) {
    return { skipped: 'no-stale-bitmap', segmentId };
  }
  const bitmap = loadBitmap(staleSidecar);
  if (!bitmap) return { skipped: 'no-stale-bitmap', segmentId };
  const tombstoned = popcount(bitmap);
  if (tombstoned === 0) {
    safeUnlink(staleSidecar);
    return { skipped: 'no-tombstones-after-bitmap-load', segmentId };
  }

  // Read this segment's LIVE docs (tombstoned docs dropped per the stale
  // bitmap) in insertion order. The already-quantized entries are reused
  // verbatim; only this segment is read, not the whole index.
  const { index, collected: ordered } = await collectLiveDocs(stubPath, segmentDir, manifest, new Set([segmentPath]));
  progress('maintenance:li-segment:loaded');
  const liveDocs = new Map();
  for (const { docId, doc } of ordered) liveDocs.set(docId, doc);
  const droppedDocs = tombstoned;
  if (liveDocs.size === 0) {
    return { skipped: 'no-live-docs', segmentId };
  }

  // Use a writer purely as the SSLX serializer; we never call `add()`.
  const writer = new LateInteractionIndex({
    indexPath: stubPath,
    loadExisting: false,
    tokenDim: index.tokenDim,
    maxTokens: index.maxTokens,
    useInt8: index.useInt8,
    quantBits: index.quantBits,
    modelId: index.modelId,
    poolFactor: index.poolFactor,
    whtSeed: index.whtSeed,
    whtOrdering: index.whtOrdering,
    matryoshkaDim: index.matryoshkaDim,
  });
  await writer.init();

  // A new segment name, not a rewrite in place: the stale bitmap is positional, and the
  // compacted file renumbers its docs. Replacing the file and then resetting its bitmap
  // left a window (and, after a crash, a lasting state) where the old bitmap hid the
  // wrong docs. The old file and its bitmap stay for the quarantine grace (readers).
  const seq = nextSegmentSeq(manifest);
  const newName = `segment-${String(seq).padStart(4, '0')}.bin`;
  await writer._writeSegmentFile(path.join(segmentDir, newName), liveDocs);
  progress('maintenance:li-segment:written');
  const nextManifest = {
    ...manifest,
    segments: manifest.segments.map((s) => (s?.path === segmentId ? { path: newName, count: liveDocs.size } : s)),
    nextSeq: seq + 1,
  };
  nextManifest.totalDocuments = nextManifest.segments.reduce((sum, s) => sum + (s?.count || 0), 0);
  const tmpManifest = manifestPath + '.tmp';
  fs.writeFileSync(tmpManifest, JSON.stringify(nextManifest, null, 2));
  fs.renameSync(tmpManifest, manifestPath);
  quarantineSegmentFiles(segmentDir, [segmentId, segmentId + '.stale.bin']);

  return {
    tier: 'li_segment',
    segmentId,
    kept: liveDocs.size,
    dropped: droppedDocs,
    staleBitmapCleared: true,
  };
}

/* ------------------------------------------------------------------ *
 * li_segments (batch merge)                                           *
 * ------------------------------------------------------------------ */

/**
 * Batch-merge small live LI segments into fewer larger segments so the
 * segment count stays bounded (the per-segment `li_segment` handler only
 * compacts within a segment; it never reduces the count). Idempotent and
 * crash-safe — see `infrastructure/li-segment-merge.mjs`. Honors
 * `SWEET_SEARCH_LI_MERGE_GRACE_MS` for the quarantine grace window.
 */
export async function liSegmentsHandler(job, { stateDir, onProgress = null }) {
  const progress = progressFn(onProgress);
  const graceRaw = Number.parseInt(process.env.SWEET_SEARCH_LI_MERGE_GRACE_MS || '', 10);
  const graceMs = Number.isFinite(graceRaw) && graceRaw >= 0 ? graceRaw : LI_MERGE_GRACE_MS;
  // A `pending_delete` re-fire only needs the cheap quarantine/orphan sweep —
  // never reload the full index just to unlink a few deferred files.
  const sweepOnly = job?.reason === 'pending_delete';
  const result = await mergeLiSegments(stateDir, { graceMs, sweepOnly });
  progress('maintenance:li-segments:merged');
  return result;
}

/* ------------------------------------------------------------------ *
 * vector_gc (retired-row physical prune)                             *
 * ------------------------------------------------------------------ */

/**
 * Physically delete retired `codebase.db` vector rows that no live or
 * future reader can observe. Reader-safe (see
 * `infrastructure/vector-gc.mjs`); never throws on a missing DB. Batch
 * size / per-run cap tunable via `SWEET_SEARCH_VECTOR_GC_BATCH` and
 * `SWEET_SEARCH_VECTOR_GC_MAX_ROWS`.
 */
export function vectorGcHandler(job, { stateDir, onProgress = null }) {
  const progress = progressFn(onProgress);
  const batchRaw = Number.parseInt(process.env.SWEET_SEARCH_VECTOR_GC_BATCH || '', 10);
  const maxRaw = Number.parseInt(process.env.SWEET_SEARCH_VECTOR_GC_MAX_ROWS || '', 10);
  const result = runVectorGc(stateDir, {
    minLiveEpoch,
    readManifest,
    batchSize: Number.isFinite(batchRaw) && batchRaw > 0 ? batchRaw : undefined,
    maxRows: Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined,
  });
  progress('maintenance:vector-gc:done');
  return result;
}

/* ------------------------------------------------------------------ *
 * graph_gc (retired graph-row physical prune)                         *
 * ------------------------------------------------------------------ */

/**
 * Physically delete retired `code-graph.db` rows (entities + relationships +
 * HCGS summaries) that no live or future reader can observe, keeping the
 * external-content FTS5 indices consistent. Reader-safe (see
 * `infrastructure/graph-gc.mjs`); never throws on a missing DB. Batch size /
 * per-run cap tunable via `SWEET_SEARCH_GRAPH_GC_BATCH` and
 * `SWEET_SEARCH_GRAPH_GC_MAX_ROWS`.
 */
export function graphGcHandler(job, { stateDir, onProgress = null }) {
  const progress = progressFn(onProgress);
  const batchRaw = Number.parseInt(process.env.SWEET_SEARCH_GRAPH_GC_BATCH || '', 10);
  const maxRaw = Number.parseInt(process.env.SWEET_SEARCH_GRAPH_GC_MAX_ROWS || '', 10);
  const result = runGraphGc(stateDir, {
    minLiveEpoch,
    readManifest,
    batchSize: Number.isFinite(batchRaw) && batchRaw > 0 ? batchRaw : undefined,
    maxRows: Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined,
  });
  progress('maintenance:graph-gc:done');
  return result;
}

/* ------------------------------------------------------------------ *
 * graph_pagerank (recompute the page_rank column)                     *
 * ------------------------------------------------------------------ */

/**
 * Recompute PageRank over the live graph, as the full build does, and record the time and
 * the graph epoch it scored in PAGERANK_STATE. Scores change in place; no epoch.
 */
export function graphPageRankHandler(job, { stateDir, onProgress = null }) {
  const progress = progressFn(onProgress);
  const dbPath = path.join(stateDir, 'code-graph.db');
  if (!fs.existsSync(dbPath)) return { skipped: 'no-graph' };
  const db = new Database(dbPath);
  try {
    db.pragma('busy_timeout = 5000');
    // Read first: a change made during the pass then triggers the next one.
    const graphEpoch = graphChangeEpoch(db);
    const result = populatePageRankColumn(db, { onlyChanged: true });
    const statePath = path.join(stateDir, PAGERANK_STATE);
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify({ ranAt: Date.now(), graphEpoch, entities: result.entities }));
    fs.renameSync(`${statePath}.tmp`, statePath);
    progress('maintenance:graph-pagerank:done');
    return { tier: 'graph_pagerank', ...result };
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ *
 * vocab_refresh (communities + vocabulary artifacts)                  *
 * ------------------------------------------------------------------ */

let vocabRun = null;

/**
 * Rebuild communities.json and the vocabulary embedding artifacts from the live graph, as
 * the full build's post-index warmup does (core/vocabulary refreshVocabulary). The run
 * takes seconds on a large repo (mining, communities), so the handler starts it and
 * returns: the heavy steps run in a worker thread and the maintainer keeps reconciling.
 * The embeddings go through `embed` (the maintainer's encoder child); texts the current
 * artifacts hold are reused. Every file is published by rename; readers read them whole
 * from disk when they use them. Without an encoder only communities.json is rebuilt.
 *
 * While a run is in flight VOCAB_RUNNING names this process, so the watermark does not
 * fire again. The graph epoch read before the run is recorded, so a change made during it
 * counts toward the next one; a failed run records its time, so the interval paces retries.
 * `wait`: resolve with the run's result (tests, a one-shot CLI).
 */
export async function vocabRefreshHandler(job, { stateDir, projectRoot = null, embed = null, onProgress = null, wait = false }) {
  const progress = progressFn(onProgress);
  if (vocabRun) return { skipped: 'running' };
  const dbPath = path.join(stateDir, 'code-graph.db');
  if (!fs.existsSync(dbPath)) return { skipped: 'no-graph' };
  let graphEpoch = 0;
  const db = new Database(dbPath, { readonly: true });
  try { graphEpoch = graphChangeEpoch(db); } finally { db.close(); }
  const root = projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT || path.dirname(stateDir);
  const marker = path.join(stateDir, VOCAB_RUNNING);
  fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, startedAt: Date.now(), graphEpoch }));
  vocabRun = refreshVocabulary({ projectRoot: root, stateDir, graphEpoch, ...(embed ? { embed } : {}) })
    .then((result) => ({ tier: 'vocab_refresh', graphEpoch, ...result }))
    .catch((err) => {
      const statePath = path.join(stateDir, VOCAB_STATE);
      let prev = {};
      try { prev = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* none */ }
      try { fs.writeFileSync(statePath, JSON.stringify({ ...prev, ranAt: Date.now(), lastError: err?.message || String(err) })); } catch { /* best effort */ }
      return { tier: 'vocab_refresh', graphEpoch, error: err?.message || String(err) };
    })
    .finally(() => {
      safeUnlink(marker);
      vocabRun = null;
      progress('maintenance:vocab-refresh:done');
    });
  if (wait) return vocabRun;
  progress('maintenance:vocab-refresh:started');
  return { tier: 'vocab_refresh', started: true, graphEpoch };
}

/** The vocab_refresh run in flight, or null (shutdown and tests wait on it). */
export function vocabRefreshInFlight() {
  return vocabRun;
}

/* ------------------------------------------------------------------ *
 * Registry                                                            *
 * ------------------------------------------------------------------ */

/**
 * Build the full handler set used by the maintenance worker. The fts5
 * handler stays in maintenance-worker.mjs::defaultMaintenanceHandlers
 * (built-in to the same file as the worker); this returns the four
 * additional handlers and lets the caller merge them.
 */
export function reclamationHandlers(stateDir, { embed = null } = {}) {
  return {
    sparse_gram: (job, ctx = {}) => sparseGramHandler(job, { stateDir, onProgress: ctx.onProgress, config: loadWatermarkConfig() }),
    binary_hnsw: (job, ctx = {}) => binaryHnswHandler(job, { stateDir, onProgress: ctx.onProgress }),
    li_segment: (job, ctx = {}) => liSegmentHandler(job, { stateDir, onProgress: ctx.onProgress }),
    li_segments: (job, ctx = {}) => liSegmentsHandler(job, { stateDir, onProgress: ctx.onProgress }),
    vector_gc: (job, ctx = {}) => vectorGcHandler(job, { stateDir, onProgress: ctx.onProgress }),
    graph_gc: (job, ctx = {}) => graphGcHandler(job, { stateDir, onProgress: ctx.onProgress }),
    graph_pagerank: (job, ctx = {}) => graphPageRankHandler(job, { stateDir, onProgress: ctx.onProgress }),
    vocab_refresh: (job, ctx = {}) => vocabRefreshHandler(job, { stateDir, embed, onProgress: ctx.onProgress }),
  };
}
