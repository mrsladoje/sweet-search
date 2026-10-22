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

import { loadBitmap, popcount } from './tombstone-bitmap.mjs';
import { readIndexHeader } from '../../vector-store/index-file-header.js';
import { countDeltaRecords, deltaPathFor } from '../../vector-store/hnsw-delta-file.js';
import { EXACT_SCAN_MAX_VECTORS } from '../../vector-store/binary-hnsw-index.js';
import { deltaSizeStats, pendingDeleteStats } from './sparse-gram-delta.mjs';
import { evaluateSegmentRatios, LI_SEGMENT_SIZE } from './li-segment-state.mjs';
import { fts5SegmentCount } from './sqlite-fts5.mjs';

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

/**
 * FTS5: max segment count across the graph FTS tables. Returns 0 when
 * the graph DB is absent or the tables are unmigrated.
 */
export function readFts5State(stateDir) {
  const graph = path.join(stateDir, 'code-graph.db');
  if (!fs.existsSync(graph)) return { segmentCount: 0 };
  const db = new Database(graph, { readonly: true });
  try {
    const segmentCount = Math.max(
      fts5SegmentCount(db, 'entities_fts'),
      fts5SegmentCount(db, 'entities_code_fts'),
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
    const base = path.join(stateDir, 'codebase-sparse-grams.idx');
    const stats = deltaSizeStats(base);
    return { deltaSizeRatio: stats.ratio, deltaSegmentCount: stats.deltaSegments, retiredDue: pendingDeleteStats(base).due };
  } catch {
    return { deltaSizeRatio: 0, deltaSegmentCount: 0, retiredDue: 0 };
  }
}

/**
 * Binary HNSW: the index file header's `count` is the node count (stale
 * nodes included — see `binary-hnsw-index.js::save`). The bitmap at
 * `.idx.stale.bin` flags retired rows; deadDocRatio = popcount / total.
 */
export function readBinaryHnswState(stateDir) {
  const empty = { deadDocRatio: 0 };
  const indexPath = path.join(stateDir, 'codebase-binary-hnsw.idx');
  const head = readIndexHeader(indexPath);
  if (!head) return empty;
  // Nodes = the base's plus its delta rows (the stale bitmap numbers both).
  const baseCount = Number(head.header.count) || 0;
  const deltaCount = countDeltaRecords(deltaPathFor(indexPath), head.header.generation ?? 0, head.header.dimension);
  const total = baseCount + deltaCount;
  if (total <= 0) return empty;
  const graphless = !(head.header.entryPoint >= 0);
  // Above the exact-scan size a graph base is walked and its delta scanned on top.
  const walked = !graphless && total > EXACT_SCAN_MAX_VECTORS;
  const needsGraph = graphless && total > EXACT_SCAN_MAX_VECTORS;
  let bitmap = null;
  try { bitmap = loadBitmap(path.join(stateDir, 'codebase-binary-hnsw.idx.stale.bin')); } catch { bitmap = null; }
  const markedDead = bitmap ? popcount(bitmap) : 0;
  // True dead count is divergence from codebase.db (the liveness authority):
  // binary rows that are no longer live there, whether or not their stale bit
  // was ever set. This catches a retire that never reached the binary tier so
  // binaryHnswHandler (codebase.db-sourced) is scheduled to reclaim it. Falls
  // back to the stale-bitmap popcount when codebase.db is unavailable.
  let divergentDead = 0;
  const dbPath = path.join(stateDir, 'codebase.db');
  if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true });
    try {
      const cols = db.prepare('PRAGMA table_info(vectors)').all().map((c) => c.name);
      if (cols.includes('epoch_retired')) {
        // total - retired: both counts use an index (the retired one is partial). COUNT(*)
        // WHERE epoch_retired IS NULL scanned every row: 822 ms cold on 46k rows, every tick.
        const all = db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n || 0;
        const retired = db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE epoch_retired IS NOT NULL').get().n || 0;
        const live = all - retired;
        divergentDead = Math.max(0, total - live);
      }
    } catch { divergentDead = 0; } finally { db.close(); }
  }
  const dead = Math.max(markedDead, divergentDead);
  // Rows retired in codebase.db whose binary stale bit was never set. This is
  // the precise signature of a retire that failed to reach the binary tier;
  // surfacing it lets the scheduler reclaim promptly instead of waiting for the
  // dead-doc ratio to cross its threshold from unrelated churn.
  const unexplainedDead = Math.max(0, divergentDead - markedDead);
  return { deadDocRatio: dead / total, unexplainedDead, baseCount, deltaCount, walked, needsGraph };
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
 * LI segment-count stats for the batch-merge watermark. `smallSegmentCount`
 * is the number of sealed segments below the SSLX capacity — the ones that
 * accumulate ~1/tick and that the merge collapses. Legacy / missing indices
 * return zeros.
 */
export function readLiSegmentStats(stateDir) {
  const empty = { segmentCount: 0, smallSegmentCount: 0, pendingDeleteFiles: 0 };
  const stubPath = path.join(stateDir, 'codebase-late-interaction.db');
  if (!fs.existsSync(stubPath)) return empty;
  const stub = readJson(stubPath);
  if (!stub || stub.format !== 'segmented' || !stub.segmentDir) return empty;
  const segmentDir = path.resolve(stateDir, stub.segmentDir);
  const manifestPath = path.join(segmentDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return empty;
  const manifest = readJson(manifestPath);
  if (!manifest || !Array.isArray(manifest.segments)) return empty;
  let small = 0;
  for (const seg of manifest.segments) {
    if (Number.isFinite(seg?.count) && seg.count < LI_SEGMENT_SIZE) small += 1;
  }
  // Quarantined (deferred-delete) segment files awaiting a grace-gated sweep.
  // Surfaced so the watermark can re-trigger the merge handler to drain them
  // even when no segment-count merge is otherwise due.
  let pendingDeleteFiles = 0;
  const pendingPath = path.join(segmentDir, 'pending-delete.jsonl');
  try {
    for (const line of fs.readFileSync(pendingPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed);
        if (entry && Array.isArray(entry.paths)) pendingDeleteFiles += entry.paths.length;
      } catch { /* skip torn line */ }
    }
  } catch { /* no pending-delete journal */ }
  return { segmentCount: manifest.segments.length, smallSegmentCount: small, pendingDeleteFiles };
}

/**
 * Retired-vector counts in `codebase.db` for the physical-GC watermark.
 * `retiredCount` = rows with a non-null `epoch_retired`; `retiredRatio` =
 * retired / total. Returns zeros when the DB / table / column is absent.
 */
export function readVectorGcState(stateDir) {
  const empty = { retiredCount: 0, retiredRatio: 0, totalCount: 0 };
  const dbPath = path.join(stateDir, 'codebase.db');
  if (!fs.existsSync(dbPath)) return empty;
  const db = new Database(dbPath, { readonly: true });
  try {
    const cols = db.prepare('PRAGMA table_info(vectors)').all().map((c) => c.name);
    if (!cols.includes('epoch_retired')) return empty;
    const total = db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n || 0;
    const retired = db.prepare('SELECT COUNT(*) AS n FROM vectors WHERE epoch_retired IS NOT NULL').get().n || 0;
    return { retiredCount: retired, retiredRatio: total > 0 ? retired / total : 0, totalCount: total };
  } catch {
    return empty;
  } finally {
    db.close();
  }
}

/**
 * Retired-row counts in `code-graph.db` for the graph physical-GC watermark.
 * `retiredEntities` / `retiredRelationships` = rows with a non-null
 * `epoch_retired`; `retiredEntityRatio` = retiredEntities / totalEntities.
 * `retiredRows` is the combined entity+relationship tombstone count used by
 * the count watermark. Returns zeros when the DB / tables / column are absent.
 */
export function readGraphGcState(stateDir) {
  const empty = {
    retiredEntities: 0, retiredRelationships: 0, retiredSummaries: 0,
    retiredRows: 0, totalEntities: 0, retiredEntityRatio: 0,
  };
  const dbPath = path.join(stateDir, 'code-graph.db');
  if (!fs.existsSync(dbPath)) return empty;
  const db = new Database(dbPath, { readonly: true });
  try {
    const tableHas = (table, column) => {
      try { return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column); }
      catch { return false; }
    };
    let retiredEntities = 0;
    let totalEntities = 0;
    if (tableHas('entities', 'epoch_retired')) {
      totalEntities = db.prepare('SELECT COUNT(*) AS n FROM entities').get().n || 0;
      retiredEntities = db.prepare('SELECT COUNT(*) AS n FROM entities WHERE epoch_retired IS NOT NULL').get().n || 0;
    }
    let retiredRelationships = 0;
    if (tableHas('relationships', 'epoch_retired')) {
      retiredRelationships = db.prepare('SELECT COUNT(*) AS n FROM relationships WHERE epoch_retired IS NOT NULL').get().n || 0;
    }
    let retiredSummaries = 0;
    if (tableHas('hcgs_summary_metadata', 'epoch_retired')) {
      retiredSummaries = db.prepare('SELECT COUNT(*) AS n FROM hcgs_summary_metadata WHERE epoch_retired IS NOT NULL').get().n || 0;
    }
    return {
      retiredEntities,
      retiredRelationships,
      retiredSummaries,
      retiredRows: retiredEntities + retiredRelationships,
      totalEntities,
      retiredEntityRatio: totalEntities > 0 ? retiredEntities / totalEntities : 0,
    };
  } catch {
    return empty;
  } finally {
    db.close();
  }
}

/** Written by the graph_pagerank job: when it last ran and the graph epoch it scored. */
export const PAGERANK_STATE = 'graph-pagerank-state.json';

/**
 * Newest epoch at which the live graph changed: the largest epoch_written or epoch_retired
 * of any entity or relationship (four index lookups). 0 for a full build, which writes no
 * epochs and computes PageRank itself.
 */
export function graphChangeEpoch(db) {
  const max = (table, column) => {
    try { return db.prepare(`SELECT MAX(${column}) AS m FROM ${table}`).get().m || 0; } catch { return 0; }
  };
  return Math.max(
    max('entities', 'epoch_written'), max('entities', 'epoch_retired'),
    max('relationships', 'epoch_written'), max('relationships', 'epoch_retired'),
  );
}

/**
 * PageRank freshness for the graph_pagerank watermark: `graphEpoch` (graphChangeEpoch),
 * `rankedEpoch` (the graph epoch the last pass scored; 0 = the full build's), and
 * `msSinceRun` (Infinity when no pass ran). An added entity, a deleted hub and a changed
 * call edge all raise graphEpoch.
 */
export function readGraphRankState(stateDir, now = Date.now()) {
  const empty = { graphEpoch: 0, rankedEpoch: 0, msSinceRun: Infinity };
  const dbPath = path.join(stateDir, 'code-graph.db');
  if (!fs.existsSync(dbPath)) return empty;
  const state = readJson(path.join(stateDir, PAGERANK_STATE));
  const msSinceRun = Number.isFinite(state?.ranAt) ? Math.max(0, now - state.ranAt) : Infinity;
  const rankedEpoch = Number.isInteger(state?.graphEpoch) ? state.graphEpoch : 0;
  const db = new Database(dbPath, { readonly: true });
  try {
    return { graphEpoch: graphChangeEpoch(db), rankedEpoch, msSinceRun };
  } catch {
    return empty;
  } finally {
    db.close();
  }
}

/**
 * One-shot bundle for the reconciler adapter. Returns the full shape
 * `evaluateWatermarks` expects: `fts5 / sparseGram /
 * binaryHnsw / liSegments / liSegmentStats / vectors / graph / graphRank`.
 */
export function readMaintenanceState(stateDir) {
  return {
    fts5: readFts5State(stateDir),
    sparseGram: readSparseGramState(stateDir),
    binaryHnsw: readBinaryHnswState(stateDir),
    liSegments: readLiSegmentsState(stateDir),
    liSegmentStats: readLiSegmentStats(stateDir),
    vectors: readVectorGcState(stateDir),
    graph: readGraphGcState(stateDir),
    graphRank: readGraphRankState(stateDir),
  };
}
