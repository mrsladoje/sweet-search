/**
 * Maintenance handlers — real implementations for the four reclamation
 * tiers the soak REPORT.md flagged as queue-only.
 *
 * Each handler is registered by `defaultMaintenanceHandlers()` in
 * `maintenance-worker.mjs`. Handlers run inside the reconcile daemon's
 * single-writer process, so on-disk artifacts have one writer at a time.
 *
 * Atomicity contract: per artifact-family, each handler writes its new
 * artifacts via a path that sorts later than the existing ones (sparse
 * gram), an explicit temp+rename (LI segments, HNSW meta/usearch/vectors),
 * or via the existing `*.next` clean-build flag (Binary HNSW). After a
 * successful publish the handler clears the tier's stale bitmap; on
 * failure the previous artifacts remain readable.
 *
 * Manifest semantics:
 *   - sparse_gram, LI segment: the reconcile manifest is unchanged. New
 *     artifacts replace old ones at canonical paths read fresh per query.
 *   - HNSW (float / binary): canonical paths unchanged; the reconcile
 *     manifest stays at the current epoch. Cross-process readers that
 *     cache an HNSWIndex instance in memory MUST already invalidate on
 *     manifest change — but maintenance does not bump the epoch by
 *     itself. This matches the existing reconcile tick semantics; a
 *     follow-up workstream can add versioned tier paths if needed.
 *
 * The handlers degrade safely when artifacts are missing/corrupt — they
 * throw a descriptive error which the worker converts into the standard
 * retry/dead-letter path.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { BinaryHNSWIndex } from '../../vector-store/binary-hnsw-index.js';
import { HNSWIndex } from '../../vector-store/hnsw-index.js';
import { LateInteractionIndex } from '../../ranking/late-interaction-index.js';
import { compactDeltaSegments, listDeltaSegments } from '../infrastructure/sparse-gram-delta.mjs';
import { mergeLiSegments, LI_MERGE_GRACE_MS } from '../infrastructure/li-segment-merge.mjs';
import { runVectorGc } from '../infrastructure/vector-gc.mjs';
import { runGraphGc } from '../infrastructure/graph-gc.mjs';
import { minLiveEpoch } from '../infrastructure/reader-heartbeat.mjs';
import { readManifest, writeManifest } from '../infrastructure/manifest.mjs';
import {
  loadBitmap, popcount, isSet, createBitmap, saveBitmap,
} from '../infrastructure/tombstone-bitmap.mjs';

function safeUnlink(p) { try { fs.unlinkSync(p); } catch { /* ok */ } }

function float32FromBuffer(buffer) {
  const view = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(view);
}

/* ------------------------------------------------------------------ *
 * sparse_gram                                                         *
 * ------------------------------------------------------------------ */

export async function sparseGramHandler(job, { stateDir }) {
  const base = path.join(stateDir, 'codebase-sparse-grams.idx');
  // Stage the compaction in deferred-delete mode. The compacted segment is
  // already on disk via tmp+rename; the consumed old segments stay until
  // we have rewritten the reconcile manifest (or confirmed nobody is
  // pinning the old paths). This closes the microsecond window in which a
  // cross-process reader holding the OLD manifest's `sparseGram.deltas`
  // list could resolve `recordsResolved = 0` against deleted files.
  const result = compactDeltaSegments(base, { dropTombstones: false, deferDelete: true });
  if (result.skipped) {
    return { skipped: result.skipped };
  }

  const consumedSet = new Set(result.consumedSegmentPaths);
  let manifestUpdated = false;
  let manifestError = null;
  let hadSparseGramPin = false;
  try {
    const manifest = readManifest(stateDir);
    if (manifest?.sparseGram) {
      hadSparseGramPin = true;
      // Future-of-disk list: everything currently in the delta dir minus
      // the segments we are about to unlink. In the steady state that is
      // just the compacted segment; filtering keeps us correct if a
      // reconcile tick somehow slipped in another segment between
      // compaction and manifest write.
      const remaining = listDeltaSegments(base).filter((seg) => !consumedSet.has(seg.path));
      manifest.sparseGram.deltas = remaining.map((seg) =>
        path.relative(stateDir, seg.path).replace(/\\/g, '/'),
      );
      writeManifest(stateDir, manifest);
      manifestUpdated = true;
    }
  } catch (err) {
    manifestError = err?.message || String(err);
  }

  // Publish gate. Only delete the old segments once the new manifest is
  // live (or we know nobody is pinning the old paths). On a manifest write
  // failure we leave the old segments in place; the next maintenance pass
  // re-runs the compaction across both the leftover compacted file and
  // the old segments, then re-attempts the manifest publish.
  let unlinked = 0;
  const safeToUnlink = manifestUpdated || !hadSparseGramPin;
  if (safeToUnlink) {
    for (const segPath of result.consumedSegmentPaths) {
      try { fs.unlinkSync(segPath); unlinked += 1; } catch { /* tolerate concurrent deletion */ }
    }
  }

  return {
    tier: 'sparse_gram',
    consumedSegments: unlinked,
    recordsWritten: result.recordsWritten,
    compactedPath: path.relative(stateDir, result.compactedPath).replace(/\\/g, '/'),
    manifestUpdated,
    ...(manifestError ? { manifestError } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * binary_hnsw                                                         *
 * ------------------------------------------------------------------ */

/**
 * Read the set of live vector ids from `codebase.db` (`epoch_retired IS NULL`).
 * `codebase.db` is the source of truth for vector liveness; the Binary-HNSW
 * stale bitmap is a derived query-time cache that can drift from it if a retire
 * op fails to reach the binary tier. Returns `null` when the DB / column is
 * unavailable so the caller can fall back to the stale bitmap.
 */
function readLiveVectorIds(stateDir) {
  const dbPath = path.join(stateDir, 'codebase.db');
  if (!fs.existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    const cols = db.prepare('PRAGMA table_info(vectors)').all().map((c) => c.name);
    if (!cols.includes('epoch_retired')) return null;
    return new Set(db.prepare('SELECT id FROM vectors WHERE epoch_retired IS NULL').all().map((r) => r.id));
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function binaryHnswHandler(job, { stateDir }) {
  const indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
  const metaPath = path.join(stateDir, 'codebase-binary-hnsw.meta.json');
  if (!fs.existsSync(metaPath)) return { skipped: 'no-index' };

  const existing = new BinaryHNSWIndex({ indexPath });
  await existing.load(indexPath);

  // Liveness authority is codebase.db, NOT the binary stale bitmap. This makes
  // binary reclamation self-healing and consistent with floatHnswHandler
  // (which already rebuilds from `vectors WHERE epoch_retired IS NULL`): a
  // vector retired in codebase.db is dropped here even if its binary stale bit
  // was never set. Falls back to the stale bitmap only when codebase.db is
  // unavailable.
  const liveIds = readLiveVectorIds(stateDir);
  const staleBitmap = existing._loadStaleBitmap();
  const live = [];
  for (let i = 0; i < existing.vectors.length; i += 1) {
    const v = existing.vectors[i];
    const isStale = liveIds ? !liveIds.has(v.id) : (staleBitmap && isSet(staleBitmap, i));
    if (isStale) continue;
    const int8 = existing.int8Vectors.get(v.id) || null;
    live.push({ id: v.id, binary: v.binary, metadata: v.metadata, int8 });
  }
  const dropped = existing.vectors.length - live.length;
  if (dropped === 0) {
    return { skipped: 'no-stale-vectors', dropped: 0 };
  }

  // Rebuild the index in memory and let `BinaryHNSWIndex.save()`
  // publish via its tmp+rename protocol — every sidecar is staged then
  // atomically renamed (data first, .meta.json last) so fresh readers
  // don't see torn `(meta, vectors, graph, int8)` tuples.
  const fresh = new BinaryHNSWIndex({
    indexPath,
    floatDimension: existing.floatDimension,
    M: existing.M,
    efConstruction: existing.efConstruction,
    efSearch: existing.efSearch,
    maxElements: existing.maxElements,
  });
  fresh.resetForBuild();
  for (const v of live) {
    await fresh.add(v.id, v.binary, v.metadata, v.int8);
  }
  fresh._cleanBuild = true;
  await fresh.save(indexPath);

  return {
    tier: 'binary_hnsw',
    kept: live.length,
    dropped,
    staleBitmapCleared: true,
    atomicPublish: true,
  };
}

/* ------------------------------------------------------------------ *
 * float_hnsw                                                          *
 * ------------------------------------------------------------------ */

/**
 * Float HNSW clean replacement.
 *
 * Source of truth for "which vectors are live" is `codebase.db`. The
 * existing HNSW meta.json's idMap is also pruned, but we re-read the DB
 * to pick up `embedding` blobs the in-memory HNSWIndex doesn't expose.
 *
 * Caller invariant: the codebase.db schema columns (`id`, `embedding`,
 * `metadata`, `epoch_retired`) are stable — verified in the production
 * reconciler `applyVectorDelta` path.
 */
export async function floatHnswHandler(job, { stateDir }) {
  const indexPath = path.join(stateDir, 'codebase-hnsw.idx');
  const metaPath = path.join(stateDir, 'codebase-hnsw.meta.json');
  const dbPath = path.join(stateDir, 'codebase.db');
  if (!fs.existsSync(metaPath)) return { skipped: 'no-index' };
  if (!fs.existsSync(dbPath)) return { skipped: 'no-vector-db' };

  // Load existing index to discover dimension / parameters (cheap).
  const existing = new HNSWIndex({ indexPath });
  try { await existing.load(indexPath); } catch { return { skipped: 'load-failed' }; }
  const dimension = existing.dimension;
  const stalePath = existing.stalePath;

  const stalePresent = fs.existsSync(stalePath);
  const liveIdsBefore = new Set(existing.idMap.keys());

  // Walk live vectors from codebase.db.
  const db = new Database(dbPath, { readonly: true });
  let liveRows;
  try {
    liveRows = db.prepare(
      'SELECT id, embedding, metadata FROM vectors WHERE epoch_retired IS NULL'
    ).all();
  } finally {
    db.close();
  }

  // If everything aligns AND no stale bitmap → nothing to do.
  if (!stalePresent && liveIdsBefore.size === liveRows.length) {
    return { skipped: 'no-stale-vectors', dropped: 0 };
  }

  // Rebuild the index in memory and let `HNSWIndex.save()` publish via
  // its tmp+rename protocol — that protocol keeps any cross-process
  // `usearch.view()` mmap valid against the unlinked old inode.
  const fresh = new HNSWIndex({
    indexPath,
    stalePath,
    dimension,
    maxElements: existing.maxElements,
    M: existing.M,
    efConstruction: existing.efConstruction,
    efSearch: existing.efSearch,
    metric: existing.metric,
  });
  await fresh.init();
  for (const row of liveRows) {
    const embedding = float32FromBuffer(row.embedding);
    let meta;
    try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
    const truncated = embedding.length > dimension ? embedding.slice(0, dimension) : embedding;
    await fresh.add(row.id, truncated, meta);
  }
  await fresh.save(indexPath);
  // Stale bitmap is meaningless after rebuild — keys are fresh.
  safeUnlink(stalePath);

  return {
    tier: 'float_hnsw',
    kept: liveRows.length,
    dropped: Math.max(0, liveIdsBefore.size - liveRows.length),
    staleBitmapCleared: true,
    atomicPublish: true,
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
export async function liSegmentHandler(job, { stateDir }) {
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

  // Open the index. The SSLX loader at `_loadSegmented` already drops
  // tombstoned docs via the per-segment stale bitmap, so
  // `index.documents` after init contains only LIVE entries. The
  // already-quantized doc entries can be reused verbatim — we just need
  // to rewrite the segment file with the surviving docs (in insertion
  // order; `_docSegmentPositions` lets us recover that).
  const index = new LateInteractionIndex({
    indexPath: stubPath,
    loadExisting: true,
    modelId: manifest.modelId || null,
  });
  await index.init();

  const ordered = [];
  for (const [docId, doc] of index.documents.entries()) {
    const position = index._docSegmentPositions?.get(docId);
    if (!position || position.segmentPath !== segmentPath) continue;
    ordered.push({ docIndex: position.docIndex, docId, doc });
  }
  ordered.sort((a, b) => a.docIndex - b.docIndex);
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

  const tmpSegPath = segmentPath + '.compacting.tmp';
  await writer._writeSegmentFile(tmpSegPath, liveDocs);
  // Atomic replace of the segment file.
  fs.renameSync(tmpSegPath, segmentPath);
  // Reset the segment's stale bitmap to a fresh, zero-tombstone bitmap
  // sized for the new doc count.
  safeUnlink(staleSidecar);
  if (liveDocs.size > 0) {
    saveBitmap(staleSidecar, createBitmap(Math.max(1, liveDocs.size)));
  }

  // Update the manifest entry's count atomically.
  segmentEntry.count = liveDocs.size;
  manifest.totalDocuments = manifest.segments.reduce((sum, s) => sum + (s?.count || 0), 0);
  const tmpManifest = manifestPath + '.tmp';
  fs.writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2));
  fs.renameSync(tmpManifest, manifestPath);

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
export async function liSegmentsHandler(job, { stateDir }) {
  const graceRaw = Number.parseInt(process.env.SWEET_SEARCH_LI_MERGE_GRACE_MS || '', 10);
  const graceMs = Number.isFinite(graceRaw) && graceRaw >= 0 ? graceRaw : LI_MERGE_GRACE_MS;
  // A `pending_delete` re-fire only needs the cheap quarantine/orphan sweep —
  // never reload the full index just to unlink a few deferred files.
  const sweepOnly = job?.reason === 'pending_delete';
  return mergeLiSegments(stateDir, { graceMs, sweepOnly });
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
export function vectorGcHandler(job, { stateDir }) {
  const batchRaw = Number.parseInt(process.env.SWEET_SEARCH_VECTOR_GC_BATCH || '', 10);
  const maxRaw = Number.parseInt(process.env.SWEET_SEARCH_VECTOR_GC_MAX_ROWS || '', 10);
  return runVectorGc(stateDir, {
    minLiveEpoch,
    readManifest,
    batchSize: Number.isFinite(batchRaw) && batchRaw > 0 ? batchRaw : undefined,
    maxRows: Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined,
  });
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
export function graphGcHandler(job, { stateDir }) {
  const batchRaw = Number.parseInt(process.env.SWEET_SEARCH_GRAPH_GC_BATCH || '', 10);
  const maxRaw = Number.parseInt(process.env.SWEET_SEARCH_GRAPH_GC_MAX_ROWS || '', 10);
  return runGraphGc(stateDir, {
    minLiveEpoch,
    readManifest,
    batchSize: Number.isFinite(batchRaw) && batchRaw > 0 ? batchRaw : undefined,
    maxRows: Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : undefined,
  });
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
export function reclamationHandlers(stateDir) {
  return {
    sparse_gram: (job) => sparseGramHandler(job, { stateDir }),
    binary_hnsw: (job) => binaryHnswHandler(job, { stateDir }),
    float_hnsw: (job) => floatHnswHandler(job, { stateDir }),
    li_segment: (job) => liSegmentHandler(job, { stateDir }),
    li_segments: (job) => liSegmentsHandler(job, { stateDir }),
    vector_gc: (job) => vectorGcHandler(job, { stateDir }),
    graph_gc: (job) => graphGcHandler(job, { stateDir }),
  };
}
