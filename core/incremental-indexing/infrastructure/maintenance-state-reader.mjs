/**
 * Maintenance-state readers.
 *
 * The reconciler invokes `readMaintenanceState()` at the end of each tick;
 * `domain/watermark-scheduler.mjs::evaluateWatermarks` consumes the output
 * and emits jobs when a tier crosses its threshold. Prior to this module,
 * the production adapter reported only FTS5 and sparse-gram counters, so
 * Float HNSW, Binary HNSW, and LI maintenance jobs never fired (see
 * `eval/results/incremental-soak/REPORT.md` § 6.2 Finding 1).
 *
 * Each reader is intentionally cheap (small JSON + small bitmap reads) and
 * degrades safely to a zero-metric object when an artifact is missing,
 * legacy, or unreadable. Readers MUST NOT throw — the maintenance loop
 * tolerates partial state, not exceptions.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadBitmap, popcount, tombstoneFraction } from './tombstone-bitmap.mjs';
import { deltaSizeStats } from './sparse-gram-delta.mjs';
import { evaluateSegmentRatios } from './li-segment-state.mjs';
import { fts5SegmentCount } from './sqlite-fts5.mjs';

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

/**
 * FTS5: max segment count across the two graph FTS tables. Returns 0 when
 * the graph DB is absent or the tables are unmigrated.
 */
export function readFts5State(stateDir) {
  const graph = path.join(stateDir, 'code-graph.db');
  if (!fs.existsSync(graph)) return { segmentCount: 0 };
  const db = new Database(graph, { readonly: true });
  try {
    const segmentCount = Math.max(
      fts5SegmentCount(db, 'entities_fts'),
      fts5SegmentCount(db, 'entities_trigram'),
    );
    return { segmentCount };
  } catch {
    return { segmentCount: 0 };
  } finally {
    db.close();
  }
}

/**
 * Sparse-gram delta artifacts: relative size + segment count for the
 * compaction watermark.
 */
export function readSparseGramState(stateDir) {
  try {
    const stats = deltaSizeStats(path.join(stateDir, 'codebase-sparse-grams.idx'));
    return { deltaSizeRatio: stats.ratio, deltaSegmentCount: stats.deltaSegments };
  } catch {
    return { deltaSizeRatio: 0, deltaSegmentCount: 0 };
  }
}

/**
 * Float HNSW: meta.json carries `idMap` (live ids — pruned on `remove()`)
 * and the stale bitmap at `.idx.stale.bin` mirrors the soft-delete state.
 *
 *   tombstoneFraction = popcount(bitmap) / (popcount + liveTotal)
 *
 * `liveCandidateShortfall` stays undefined here — that signal must come
 * from a query-path counter (plan § 7.3), not from offline state.
 */
export function readFloatHnswState(stateDir) {
  const empty = { tombstoneFraction: 0, deleteCycles: 0 };
  const metaPath = path.join(stateDir, 'codebase-hnsw.meta.json');
  if (!fs.existsSync(metaPath)) return empty;
  const meta = readJson(metaPath);
  if (!meta) return empty;
  const idMap = Array.isArray(meta.idMap) ? meta.idMap : [];
  const liveTotal = idMap.length;
  let bitmap = null;
  try { bitmap = loadBitmap(path.join(stateDir, 'codebase-hnsw.idx.stale.bin')); } catch { bitmap = null; }
  const fraction = bitmap ? tombstoneFraction(bitmap, liveTotal) : 0;
  return { tombstoneFraction: fraction, deleteCycles: 0 };
}

/**
 * Binary HNSW: meta.json's `vectorCount` is the row count in `vectors.json`
 * (never pruned — see `binary-hnsw-index.js::save`). The bitmap at
 * `.idx.stale.bin` flags retired rows; deadDocRatio = popcount / total.
 */
export function readBinaryHnswState(stateDir) {
  const empty = { deadDocRatio: 0 };
  const metaPath = path.join(stateDir, 'codebase-binary-hnsw.meta.json');
  if (!fs.existsSync(metaPath)) return empty;
  const meta = readJson(metaPath);
  if (!meta) return empty;
  const total = Number(meta.vectorCount) || 0;
  if (total <= 0) return empty;
  let bitmap = null;
  try { bitmap = loadBitmap(path.join(stateDir, 'codebase-binary-hnsw.idx.stale.bin')); } catch { bitmap = null; }
  const dead = bitmap ? popcount(bitmap) : 0;
  return { deadDocRatio: dead / total };
}

/**
 * LI segments: walks `codebase-late-interaction.db.segments/manifest.json`
 * and asks `li-segment-state.evaluateSegmentRatios` for the stale ratio
 * per segment. Legacy unsegmented indices (or missing manifest) return [].
 */
export function readLiSegmentsState(stateDir) {
  const stubPath = path.join(stateDir, 'codebase-late-interaction.db');
  if (!fs.existsSync(stubPath)) return [];
  const stub = readJson(stubPath);
  if (!stub || stub.format !== 'segmented' || !stub.segmentDir) return [];
  const segmentDir = path.resolve(stateDir, stub.segmentDir);
  const manifestPath = path.join(segmentDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = readJson(manifestPath);
  if (!manifest || !Array.isArray(manifest.segments)) return [];
  const docCounts = new Map();
  for (const seg of manifest.segments) {
    if (!seg || typeof seg.path !== 'string' || !Number.isFinite(seg.count)) continue;
    docCounts.set(path.join(segmentDir, seg.path), seg.count);
  }
  if (docCounts.size === 0) return [];
  try {
    return evaluateSegmentRatios(segmentDir, docCounts);
  } catch {
    return [];
  }
}

/**
 * One-shot bundle for the reconciler adapter. Returns the full shape
 * `evaluateWatermarks` expects: `fts5 / sparseGram / floatHnsw /
 * binaryHnsw / liSegments`.
 */
export function readMaintenanceState(stateDir) {
  return {
    fts5: readFts5State(stateDir),
    sparseGram: readSparseGramState(stateDir),
    floatHnsw: readFloatHnswState(stateDir),
    binaryHnsw: readBinaryHnswState(stateDir),
    liSegments: readLiSegmentsState(stateDir),
  };
}
