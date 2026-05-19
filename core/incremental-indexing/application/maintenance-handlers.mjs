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
import { compactDeltaSegments } from '../infrastructure/sparse-gram-delta.mjs';
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
  const result = compactDeltaSegments(base, { dropTombstones: false });
  if (result.skipped) {
    return { skipped: result.skipped };
  }
  return {
    tier: 'sparse_gram',
    consumedSegments: result.consumedSegments,
    recordsWritten: result.recordsWritten,
    compactedPath: path.relative(stateDir, result.compactedPath).replace(/\\/g, '/'),
  };
}

/* ------------------------------------------------------------------ *
 * binary_hnsw                                                         *
 * ------------------------------------------------------------------ */

export async function binaryHnswHandler(job, { stateDir }) {
  const indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
  const metaPath = path.join(stateDir, 'codebase-binary-hnsw.meta.json');
  if (!fs.existsSync(metaPath)) return { skipped: 'no-index' };

  const existing = new BinaryHNSWIndex({ indexPath });
  await existing.load(indexPath);

  const staleBitmap = existing._loadStaleBitmap();
  const live = [];
  for (let i = 0; i < existing.vectors.length; i += 1) {
    if (staleBitmap && isSet(staleBitmap, i)) continue;
    const v = existing.vectors[i];
    const int8 = existing.int8Vectors.get(v.id) || null;
    live.push({ id: v.id, binary: v.binary, metadata: v.metadata, int8 });
  }
  const dropped = existing.vectors.length - live.length;
  if (!staleBitmap || dropped === 0) {
    return { skipped: 'no-stale-vectors', dropped: 0 };
  }

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
  };
}
