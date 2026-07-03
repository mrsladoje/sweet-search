/**
 * Probe / invariant checker for the soak harness.
 *
 * Inspects the per-tier artifacts produced by the production reconciler and
 * returns a structured observation. The harness consumes the observation to
 * compute staleness, detect mixed-epoch state, and assert per-surface
 * coherence with the ground-truth model.
 *
 * Surfaces probed:
 *   - manifest                          (.sweet-search/reconcile-manifest.json)
 *   - vectors                           (codebase.db: vectors table)
 *   - graph entities + relationships    (code-graph.db)
 *   - FTS5 entities_fts + entities_trigram
 *   - Float HNSW idMap                  (codebase-hnsw.meta.json)
 *   - Binary HNSW vectors/int8 sidecars
 *   - LI segments + tombstones
 *   - sparse-gram delta records
 *   - merkle-state.json
 *
 * SQLite reads use better-sqlite3 in read-only mode. HNSW/LI state is read
 * by direct JSON/binary inspection rather than going through the search
 * pipeline, since the soak does not rely on actual encoders.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { readManifest } from '../../core/incremental-indexing/infrastructure/manifest.mjs';
import { resolveLatestRecords, listDeltaSegments } from '../../core/incremental-indexing/infrastructure/sparse-gram-delta.mjs';
import { loadBitmap, isSet } from '../../core/infrastructure/tombstone-bitmap-reader.js';
import { readVectorsSidecarSync, readInt8SidecarSync } from '../../core/vector-store/binary-hnsw-index.js';

export class Probe {
  constructor({ projectRoot, stateDir }) {
    this.projectRoot = projectRoot;
    this.stateDir = stateDir;
  }

  observe() {
    const manifest = readManifest(this.stateDir);
    const merkle = readJsonSafe(path.join(this.stateDir, 'merkle-state.json'));
    const vectors = this._readVectors();
    const graph = this._readGraph();
    const hnsw = this._readHnsw();
    const binaryHnsw = this._readBinaryHnsw();
    const li = this._readLI();
    const sparse = this._readSparse();
    return {
      manifest,
      merkle,
      vectors,
      graph,
      hnsw,
      binaryHnsw,
      li,
      sparse,
      observedAt: Date.now(),
    };
  }

  _readVectors() {
    const dbPath = path.join(this.stateDir, 'codebase.db');
    if (!fs.existsSync(dbPath)) {
      return { live: [], retired: [], all: [], byFile: new Map(), liveIds: new Set() };
    }
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db.prepare(`SELECT id, file_path, embedding_input_hash, epoch_written, epoch_retired, length(embedding) AS embedding_bytes, metadata FROM vectors`).all();
      const live = rows.filter((r) => r.epoch_retired == null);
      const retired = rows.filter((r) => r.epoch_retired != null);
      const byFile = new Map();
      for (const r of live) {
        const arr = byFile.get(r.file_path) || [];
        arr.push(r);
        byFile.set(r.file_path, arr);
      }
      return {
        live,
        retired,
        all: rows,
        byFile,
        liveIds: new Set(live.map((r) => r.id)),
      };
    } finally {
      db.close();
    }
  }

  _readGraph() {
    const dbPath = path.join(this.stateDir, 'code-graph.db');
    if (!fs.existsSync(dbPath)) {
      return { liveEntities: [], retiredEntities: [], liveRelationships: [], fts5Names: new Map() };
    }
    const db = new Database(dbPath, { readonly: true });
    try {
      const entities = db.prepare(`SELECT id, logical_entity_id, file_path, type, name, start_line, end_line, epoch_written, epoch_retired FROM entities`).all();
      const relationships = db.prepare(`SELECT source_id, target_name, type, epoch_written, epoch_retired FROM relationships`).all();
      const liveEntities = entities.filter((e) => e.epoch_retired == null);
      const retiredEntities = entities.filter((e) => e.epoch_retired != null);
      const liveRelationships = relationships.filter((r) => r.epoch_retired == null);

      const fts5Names = new Map();
      let hasFts = false;
      try {
        const ftsRows = db.prepare(`SELECT e.id, e.name FROM entities_fts f JOIN entities e ON e.rowid = f.rowid WHERE e.epoch_retired IS NULL`).all();
        hasFts = true;
        for (const r of ftsRows) {
          const arr = fts5Names.get(r.name) || [];
          arr.push(r.id);
          fts5Names.set(r.name, arr);
        }
      } catch {}

      const trigramNames = new Map();
      let hasTrigram = false;
      try {
        const trRows = db.prepare(`SELECT e.id, e.name FROM entities_trigram f JOIN entities e ON e.rowid = f.rowid WHERE e.epoch_retired IS NULL`).all();
        hasTrigram = true;
        for (const r of trRows) {
          const arr = trigramNames.get(r.name) || [];
          arr.push(r.id);
          trigramNames.set(r.name, arr);
        }
      } catch {}

      return { entities, relationships, liveEntities, retiredEntities, liveRelationships, fts5Names, trigramNames, hasFts, hasTrigram };
    } finally {
      db.close();
    }
  }

  _readHnsw() {
    const metaPath = path.join(this.stateDir, 'codebase-hnsw.meta.json');
    if (!fs.existsSync(metaPath)) return { ids: new Set(), idMap: [] };
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const idMap = meta.idMap || [];
      const ids = new Set(idMap.map(([id]) => id));
      return { ids, idMap };
    } catch (err) {
      return { ids: new Set(), idMap: [], readError: err.message };
    }
  }

  _readBinaryHnsw() {
    const vecPath = path.join(this.stateDir, 'codebase-binary-hnsw.vectors.json');
    const int8Path = path.join(this.stateDir, 'codebase-binary-hnsw.int8.json');
    const stalePath = path.join(this.stateDir, 'codebase-binary-hnsw.idx.stale.bin');
    // NDJSON v2 sidecars (v1 back-compat) — canonical sync readers.
    const vectors = readSidecarSafe(() => readVectorsSidecarSync(vecPath)) || [];
    const int8 = readSidecarSafe(() => readInt8SidecarSync(int8Path)) || {};
    const vectorRows = vectors || [];
    const vectorIds = new Set(vectorRows.map((r) => r.id));
    const int8Ids = new Set(Object.keys(int8 || {}));
    // Load the stale bitmap and compute the *visible* set (vector rows minus
    // tombstoned indices). Binary HNSW keeps retired vectors in the JSON and
    // filters at query time via the bitmap.
    let bitmap = null;
    if (fs.existsSync(stalePath)) {
      try { bitmap = loadBitmap(stalePath); } catch {}
    }
    const visibleIds = new Set();
    const tombstonedIds = new Set();
    for (let i = 0; i < vectorRows.length; i++) {
      const id = vectorRows[i].id;
      if (bitmap && isSet(bitmap, i)) tombstonedIds.add(id);
      else visibleIds.add(id);
    }
    return { vectorIds, int8Ids, visibleIds, tombstonedIds };
  }

  _readLI() {
    const indexPath = path.join(this.stateDir, 'codebase-late-interaction.db');
    const segDir = path.join(this.stateDir, 'codebase-late-interaction.db.segments');
    const manifest = readJsonSafe(path.join(segDir, 'manifest.json'));
    const segments = [];
    if (fs.existsSync(segDir)) {
      for (const name of fs.readdirSync(segDir)) {
        const full = path.join(segDir, name);
        if (!name.endsWith('.bin')) continue;
        // An in-flight LI merge can delete a quarantined segment between this
        // readdir and the stat (TOCTOU). That's a benign concurrent-merge race
        // in measurement code, not a product defect — skip the vanished file.
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        const isStale = name.endsWith('.stale.bin');
        segments.push({ name, size: stat.size, isStale });
      }
    }
    const stubExists = fs.existsSync(indexPath);
    return { manifest, segments, stubExists, indexPath, segDir };
  }

  _readSparse() {
    const basePath = path.join(this.stateDir, 'codebase-sparse-grams.idx');
    // These helpers list the delta dir and read each file directly; a
    // concurrent sparse compaction can unlink a delta between the listdir and
    // the read (TOCTOU). Production search resolves deltas via the manifest's
    // gated list, so this is a measurement-only race — tolerate it and report
    // partial sparse state rather than failing the whole surface probe.
    let deltas = [];
    let records = new Map();
    try { deltas = listDeltaSegments(basePath); } catch { /* concurrent compaction unlink */ }
    try { records = resolveLatestRecords(basePath); } catch { /* concurrent compaction unlink */ }
    return { basePath, deltas, records };
  }
}

function readSidecarSafe(read) {
  try { return read(); } catch { return null; }
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Run all coherence invariants against an observation + ground truth.
 * Returns an array of violation records.
 */
export function checkInvariants(observation, ground) {
  const violations = [];
  const { manifest, vectors, graph, hnsw, binaryHnsw, li, sparse } = observation;

  if (!manifest) {
    violations.push({ kind: 'manifest_missing', detail: 'reconcile-manifest.json not present after first tick' });
    return violations;
  }

  if (!Number.isInteger(manifest.epoch) || manifest.epoch < 1) {
    violations.push({ kind: 'manifest_epoch_invalid', detail: `epoch=${manifest.epoch}` });
  }

  // === Manifest tier epoch consistency ===
  for (const tier of ['codeGraph', 'vectors', 'hnsw', 'binaryHnsw', 'lateInteraction', 'sparseGram']) {
    if (!manifest[tier] || manifest[tier].epoch !== manifest.epoch) {
      violations.push({ kind: 'manifest_tier_epoch_mismatch', tier, expected: manifest.epoch, actual: manifest[tier]?.epoch });
    }
  }

  // === Vectors: live IDs equal HNSW live IDs ===
  const vectorLiveIds = vectors.liveIds;
  const hnswMissing = [...vectorLiveIds].filter((id) => !hnsw.ids.has(id));
  const hnswExtra = [...hnsw.ids].filter((id) => !vectorLiveIds.has(id));
  if (hnswMissing.length > 0) violations.push({ kind: 'hnsw_missing_live_vectors', count: hnswMissing.length, sample: hnswMissing.slice(0, 5) });
  if (hnswExtra.length > 0) violations.push({ kind: 'hnsw_has_retired_vectors', count: hnswExtra.length, sample: hnswExtra.slice(0, 5) });

  // === Binary HNSW: every live vector must be VISIBLE (not tombstoned, present in vectors.json).
  // Binary HNSW keeps retired rows in the JSON and uses a stale bitmap to filter at query time.
  const binMissingVec = [...vectorLiveIds].filter((id) => !binaryHnsw.visibleIds.has(id));
  // The visible set must not contain any non-live id (would be a real leak past the tombstone filter).
  const binVisibleRetired = [...binaryHnsw.visibleIds].filter((id) => !vectorLiveIds.has(id));
  if (binMissingVec.length > 0) violations.push({ kind: 'binary_hnsw_missing_live_vectors', count: binMissingVec.length, sample: binMissingVec.slice(0, 5) });
  if (binVisibleRetired.length > 0) violations.push({ kind: 'binary_hnsw_visible_retired_vectors', count: binVisibleRetired.length, sample: binVisibleRetired.slice(0, 5) });
  // int8 sidecar should contain every live id (it's pruned, unlike vectors.json).
  const binMissingInt8 = [...vectorLiveIds].filter((id) => !binaryHnsw.int8Ids.has(id));
  if (binMissingInt8.length > 0) violations.push({ kind: 'binary_hnsw_int8_missing_live', count: binMissingInt8.length, sample: binMissingInt8.slice(0, 5) });

  // === Graph entities by file: every file in ground truth has live entities (best-effort) ===
  const groundFiles = ground.expectedFiles();
  const liveEntityFiles = new Set(graph.liveEntities.map((e) => e.file_path));
  const retiredFiles = [...liveEntityFiles].filter((f) => !groundFiles.has(f));
  for (const f of retiredFiles) {
    violations.push({ kind: 'graph_entity_for_unknown_file', file: f });
  }

  // Files that have live vectors but no live entities at all → graph stale
  for (const f of groundFiles) {
    const hasVectors = vectors.byFile.has(f) && vectors.byFile.get(f).length > 0;
    if (!hasVectors) continue;
    const hasLiveEntity = liveEntityFiles.has(f);
    if (!hasLiveEntity) {
      violations.push({ kind: 'graph_missing_for_ground_file', file: f });
    }
  }

  // === Graph relationships: source_id must point to live or retired entity (never missing) ===
  const allEntityIds = new Set(graph.entities.map((e) => e.id));
  for (const rel of graph.relationships) {
    if (rel.source_id && !allEntityIds.has(rel.source_id)) {
      violations.push({ kind: 'graph_relationship_dangling', source_id: rel.source_id, target: rel.target_name });
      break; // one example is enough
    }
  }

  // === Vectors per live-file: every ground-truth file has live vectors ===
  for (const f of groundFiles) {
    if (!vectors.byFile.has(f) || vectors.byFile.get(f).length === 0) {
      violations.push({ kind: 'vectors_missing_for_ground_file', file: f });
    }
  }

  // === Vectors: no live vector points at a file not in ground truth ===
  for (const f of vectors.byFile.keys()) {
    if (!groundFiles.has(f)) {
      violations.push({ kind: 'vectors_for_deleted_file', file: f });
    }
  }

  // === Sparse gram: latest record per file matches ground truth presence ===
  const sparseLive = new Set();
  for (const { record } of sparse.records.values()) {
    if (record && !record.deleted) sparseLive.add(record.filePath);
  }
  for (const f of groundFiles) {
    if (!sparseLive.has(f)) {
      violations.push({ kind: 'sparse_missing_for_ground_file', file: f });
    }
  }
  for (const f of sparseLive) {
    if (!groundFiles.has(f)) {
      violations.push({ kind: 'sparse_for_deleted_file', file: f });
    }
  }

  // === LI segments: at least one live segment when there are live vectors ===
  if (vectorLiveIds.size > 0) {
    const liveSegments = li.segments.filter((s) => !s.isStale);
    if (liveSegments.length === 0) {
      violations.push({ kind: 'li_no_live_segments_with_live_vectors' });
    }
  }

  // === FTS5: every live entity name with type != 'file' should appear if FTS exists ===
  if (graph.hasFts) {
    const ftsNames = graph.fts5Names;
    const missingFromFts = [];
    for (const e of graph.liveEntities) {
      if (e.type === 'file') continue;
      if (!e.name) continue;
      if (!ftsNames.has(e.name)) {
        missingFromFts.push({ name: e.name, type: e.type, file: e.file_path });
      }
    }
    if (missingFromFts.length > 0) {
      violations.push({ kind: 'fts5_missing_live_entity', count: missingFromFts.length, sample: missingFromFts.slice(0, 5) });
    }
  }

  // === FTS5: no name only from retired entities ===
  if (graph.hasFts) {
    const liveNames = new Set(graph.liveEntities.map((e) => e.name).filter(Boolean));
    for (const name of graph.fts5Names.keys()) {
      if (!liveNames.has(name)) {
        violations.push({ kind: 'fts5_for_retired_entity', name });
        break;
      }
    }
  }

  // === Vectors retired status sanity: any row with epoch_retired must be ≤ manifest.epoch ===
  for (const row of vectors.retired) {
    if (row.epoch_retired > manifest.epoch) {
      violations.push({ kind: 'vector_retired_in_future_epoch', id: row.id, epoch_retired: row.epoch_retired, manifest: manifest.epoch });
      break;
    }
  }

  return violations;
}

/**
 * Surface-level visibility checks for a specific (file, symbol, sentinel)
 * tuple. The reconciler is considered to "see" the mutation when every
 * surface reports the post-state.
 *
 * Returns one record with per-surface flags so the harness can compute
 * staleness per-surface and detect mixed-tier publication.
 */
export function surfaceVisibility(observation, expect) {
  // expect: { file, symbolNames: [...], sentinel, deleted }
  const v = observation.vectors;
  const g = observation.graph;
  const sp = observation.sparse;

  const vectorsHaveFile = v.byFile.has(expect.file) && v.byFile.get(expect.file).length > 0;
  const liveEntityNames = new Set(g.liveEntities.filter((e) => e.file_path === expect.file).map((e) => e.name));
  const allSymbolsLive = expect.symbolNames.every((n) => liveEntityNames.has(n));
  const anySymbolLive = expect.symbolNames.some((n) => liveEntityNames.has(n));

  let sparseLive = false;
  let sparseFound = null;
  for (const { record } of sp.records.values()) {
    if (record?.filePath === expect.file) { sparseFound = record; sparseLive = !record.deleted; break; }
  }

  const fts5Hit = expect.symbolNames.length === 0
    ? null
    : expect.symbolNames.some((n) => g.fts5Names?.has?.(n));

  // Approximate HNSW/LI per-file presence by joining with vectors.byFile
  const liveIdsForFile = vectorsHaveFile ? new Set(v.byFile.get(expect.file).map((r) => r.id)) : new Set();
  const hnswHasFile = liveIdsForFile.size > 0 && [...liveIdsForFile].every((id) => observation.hnsw.ids.has(id));
  const binaryHasFile = liveIdsForFile.size > 0 && [...liveIdsForFile].every((id) => observation.binaryHnsw.visibleIds.has(id));
  const int8HasFile = liveIdsForFile.size > 0 && [...liveIdsForFile].every((id) => observation.binaryHnsw.int8Ids.has(id));

  if (expect.deleted) {
    // For deleted files, sparse should also be marked deleted=true OR fully absent.
    let sparseFlaggedDeleted = false;
    if (sparseFound && sparseFound.deleted) sparseFlaggedDeleted = true;
    return {
      file: expect.file,
      kind: 'deleted',
      vectorsAbsent: !vectorsHaveFile,
      graphAbsent: !anySymbolLive,
      sparseAbsent: !sparseLive,
      sparseFlaggedDeleted,
      fts5Absent: fts5Hit === null ? null : !fts5Hit,
      hnswAbsent: liveIdsForFile.size === 0,
      binaryHnswAbsent: liveIdsForFile.size === 0,
      int8Absent: liveIdsForFile.size === 0,
      allAbsent: !vectorsHaveFile && !anySymbolLive && !sparseLive && liveIdsForFile.size === 0,
    };
  }

  return {
    file: expect.file,
    kind: 'present',
    vectorsHaveFile,
    graphAllSymbols: allSymbolsLive,
    graphAnySymbol: anySymbolLive,
    sparseLive,
    fts5AnySymbol: fts5Hit,
    hnswHasFile,
    binaryHasFile,
    int8HasFile,
    allPresent: vectorsHaveFile && allSymbolsLive && sparseLive && hnswHasFile && binaryHasFile && int8HasFile,
  };
}

