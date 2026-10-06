import { existsSync } from 'node:fs';
import { entityHierarchyLevel, normalizeIdentifier } from '../../graph/graph-extractor.js';
import { FloatVectorStore, getFloatStorePath, float512StoreEnabled } from '../../vector-store/float-vector-store.js';
import {
  loadBitmap,
  createBitmap,
  resizeBitmap,
  saveBitmap,
  setBit,
} from '../infrastructure/tombstone-bitmap.mjs';

function entitySearchText(e) {
  return [e.name, e.signature, e.doc_comment].filter(Boolean).join(' ').toLowerCase().slice(0, 1000);
}

/**
 * Insert one maintained entity row. `parentId` is the stored (physical) id
 * of its HCGS parent row (entityParentIds), as a full build stores it.
 */
export function insertEntity(db, e, id, epoch, hasFts, parentId = null) {
  const nameAlias = normalizeIdentifier(e.name);
  const stmt = db.prepare(`
    INSERT INTO entities
    (id, file_path, type, name, signature, signature_hash, doc_comment, start_line, end_line, package, parent_class, search_text, name_alias, parent_id, hierarchy_level, logical_entity_id, epoch_written, epoch_retired, stale_since)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `);
  stmt.run(
    id,
    e.file_path,
    e.type,
    e.name,
    e.signature || null,
    e.signature_hash || null,
    e.doc_comment || null,
    e.start_line || null,
    e.end_line || null,
    e.package || null,
    e.parent_class || null,
    entitySearchText(e),
    nameAlias || null,
    parentId || null,
    entityHierarchyLevel(e.type),
    e.id,
    epoch,
  );
  if (!hasFts) return;
  const rowid = db.prepare('SELECT rowid FROM entities WHERE id = ?').get(id)?.rowid;
  if (!rowid) return;
  try { db.prepare('INSERT INTO entities_fts(rowid, name, name_alias, signature, doc_comment) VALUES (?, ?, ?, ?, ?)').run(rowid, e.name, nameAlias || null, e.signature || null, e.doc_comment || null); } catch {}
  try { db.prepare('INSERT INTO entities_code_fts(rowid, name, name_alias, signature) VALUES (?, ?, ?, ?)').run(rowid, e.name, nameAlias || null, e.signature || null); } catch {}
  try { db.prepare('INSERT INTO entities_trigram(rowid, name, signature) VALUES (?, ?, ?)').run(rowid, e.name, e.signature || null); } catch {}
}

export function insertRelationships(db, relationships, liveIdFor, epoch) {
  const stmt = db.prepare(`
    INSERT INTO relationships
    (source_id, target_id, target_name, type, weight, context_line, full_import_path, is_static, is_wildcard, logical_relationship_id, epoch_written, epoch_retired)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  for (const r of relationships) {
    if (!r.target_name) continue;
    const source = liveIdFor.get(r.source_id) || r.source_id || null;
    const logical = `${source || ''}:${r.type}:${r.target_name}:${r.context_line || ''}`;
    try { stmt.run(source, r.target_id || null, r.target_name, r.type, r.weight || 1, r.context_line || null, r.full_import_path || null, r.is_static ? 1 : 0, r.is_wildcard ? 1 : 0, logical, epoch); } catch {}
  }
}

const REL_SELECT = 'rowid, source_id, target_id, target_name, type, weight, context_line, full_import_path, is_static, is_wildcard, logical_relationship_id, epoch_written';

function chunkedAll(db, sqlFor, values, extra = []) {
  const out = [];
  const list = [...values];
  for (let i = 0; i < list.length; i += 500) {
    const part = list.slice(i, i + 500);
    out.push(...db.prepare(sqlFor(part.map(() => '?').join(','))).all(...part, ...extra));
  }
  return out;
}

function nameKeysOf(targetName) {
  const name = String(targetName || '');
  const keys = [name];
  for (const seg of name.replace(/\(\)/g, '').split(/::|\\|\.|\//)) if (seg) keys.push(seg);
  return keys;
}

/**
 * Resolve the call/type/import edges an incremental graph write touched, with
 * the full build's rules (relationship-resolver resolveRowsScoped), so a
 * maintained graph matches a fresh build for the same files:
 *
 *   1. the file's own rows written this epoch (inserted with no target);
 *   2. live rows elsewhere whose target entity this write retired (an edited
 *      or deleted definition got a new physical id or disappeared);
 *   3. live rows elsewhere whose target name names a definition this write
 *      added under a new name (a new function can now be the better target).
 *
 * Rows written this epoch are updated in place. Older rows are versioned:
 * retired at `epoch` and re-inserted with the new target, so readers pinned to
 * an older manifest epoch keep the edge they saw.
 *
 * @returns {{ resolved: number, rebound: number, scanned: number }}
 */
export function resolveTouchedEdges(db, { epoch, sourceIds = [], retiredIds = [], newNames = [] }, resolveRowsScoped) {
  const rows = new Map();
  const own = chunkedAll(
    db,
    ph => `SELECT ${REL_SELECT} FROM relationships WHERE source_id IN (${ph}) AND epoch_written = ? AND epoch_retired IS NULL AND target_id IS NULL AND type != 'importsFile' AND target_name IS NOT NULL`,
    new Set(sourceIds),
    [epoch],
  );
  for (const r of own) rows.set(r.rowid, r);
  for (const r of chunkedAll(db, ph => `SELECT ${REL_SELECT} FROM relationships WHERE target_id IN (${ph}) AND epoch_retired IS NULL`, new Set(retiredIds))) {
    rows.set(r.rowid, r);
  }
  let scanned = 0;
  if (newNames.length > 0) {
    // SQLite pre-filters by substring in one scan; the exact segment test
    // runs in JS on the few rows that contain a new name.
    const wanted = new Set(newNames);
    const names = [...wanted];
    const hits = [];
    for (let i = 0; i < names.length; i += 50) {
      const part = names.slice(i, i + 50);
      const sql = `SELECT rowid, target_name FROM relationships WHERE epoch_retired IS NULL AND type != 'importsFile' AND target_name IS NOT NULL AND (${part.map(() => 'instr(target_name, ?) > 0').join(' OR ')})`;
      for (const r of db.prepare(sql).iterate(...part)) {
        scanned++;
        if (rows.has(r.rowid)) continue;
        if (nameKeysOf(r.target_name).some(k => wanted.has(k))) hits.push(r.rowid);
      }
    }
    for (const r of chunkedAll(db, ph => `SELECT ${REL_SELECT} FROM relationships WHERE rowid IN (${ph})`, hits)) rows.set(r.rowid, r);
  }
  if (rows.size === 0) return { resolved: 0, rebound: 0, scanned };

  const list = [...rows.values()];
  const targets = resolveRowsScoped(db, list, { liveOnly: true });
  const setTarget = db.prepare('UPDATE relationships SET target_id = ? WHERE rowid = ?');
  const dropRow = db.prepare('DELETE FROM relationships WHERE rowid = ?');
  const retire = db.prepare('UPDATE relationships SET epoch_retired = ? WHERE rowid = ?');
  const insertCopy = db.prepare(`
    INSERT INTO relationships
    (source_id, target_id, target_name, type, weight, context_line, full_import_path, is_static, is_wildcard, logical_relationship_id, epoch_written, epoch_retired)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  let resolved = 0;
  let rebound = 0;
  list.forEach((r, i) => {
    const next = targets[i] || null;
    if (next === (r.target_id || null)) return;
    if (r.epoch_written === epoch) {
      try {
        setTarget.run(next, r.rowid);
      } catch (err) {
        // Same edge already live (two call shapes, one target): keep one row,
        // as the full pass does for its duplicates.
        if (!String(err?.message).includes('UNIQUE')) throw err;
        dropRow.run(r.rowid);
      }
      if (next) resolved++;
      return;
    }
    retire.run(epoch, r.rowid);
    try {
      insertCopy.run(r.source_id, next, r.target_name, r.type, r.weight ?? 1, r.context_line ?? null, r.full_import_path ?? null,
        r.is_static ? 1 : 0, r.is_wildcard ? 1 : 0, r.logical_relationship_id || '', epoch);
    } catch (err) {
      if (!String(err?.message).includes('UNIQUE')) throw err;
    }
    rebound++;
  });
  return { resolved, rebound, scanned };
}

/**
 * Batched stale marking. The per-id `markBinaryStale` loads, mutates, and
 * fsyncs the bitmap file once PER RETIRED ID — O(retires × bitmap size) with
 * an fsync each. A batch loads the bitmap once (lazily, on the first mark),
 * applies every mark in memory with the exact per-op semantics (idToIndex /
 * int8Vectors pruned immediately, reader cache invalidated), and persists
 * once in flush(). End state on disk is identical to N sequential
 * markBinaryStale calls.
 *
 * Crash window: marks staged between flush()es are lost on crash, which the
 * reconciler's persist-before-advance gate already handles — an unflushed
 * tick replays its ops.
 */
export function createStaleBatch(index) {
  const stalePath = index.stalePath || `${index.indexPath}.stale.bin`;
  let bitmap = null;
  let loaded = false;
  let dirty = false;
  return {
    markStale(id) {
      const idx = index.idToIndex.get(id);
      if (idx == null) return false;
      if (!loaded) {
        try { bitmap = loadBitmap(stalePath); } catch {}
        loaded = true;
      }
      bitmap = bitmap
        ? resizeBitmap(bitmap, Math.max(idx + 1, index.vectors.length, 1))
        : createBitmap(Math.max(idx + 1, index.vectors.length, 1));
      setBit(bitmap, idx);
      dirty = true;
      index.idToIndex.delete(id);
      index.int8Vectors.delete(id);
      index._staleBitmapCache = null;
      return true;
    },
    flush() {
      if (!dirty) return false;
      saveBitmap(stalePath, bitmap);
      dirty = false;
      return true;
    },
  };
}

export function markBinaryStale(index, id) {
  const batch = createStaleBatch(index);
  const marked = batch.markStale(id);
  batch.flush();
  return marked;
}

/**
 * Maintain the Stage 2.5 float vector store (`codebase-float-vectors.bin`) as a
 * sidecar of the binary HNSW index. The search runtime derives its path from
 * the binary HNSW path, loads/reloads the two together, and full indexing
 * builds them together — so the float store is conceptually part of the binary
 * HNSW tier, exactly like the int8 sidecar. Keeping it in lockstep here lets
 * reconcile-created docs get true float rescoring in Stage 2.5 instead of
 * falling back to SQLite.
 *
 * Skips when the store is absent but the binary HNSW already held vectors: a
 * store built from the delta alone would be missing every baseline doc and
 * would mis-score them. That abnormal state keeps the existing SQLite fallback
 * until a full rebuild restores the store.
 *
 * @param {string} binaryHnswPath
 * @param {object} delta
 * @param {Array<{id: string, vector: Float32Array}>} delta.upserts
 * @param {string[]} delta.removeIds
 * @param {number} delta.binaryVectorsBefore  Live binary-HNSW vectors before this delta.
 * @param {number} delta.dimension            hnswDimension to seed a fresh empty store.
 */
export async function maintainFloatStore(binaryHnswPath, { upserts, removeIds, binaryVectorsBefore, dimension }) {
  if (!float512StoreEnabled()) return;
  if (upserts.length === 0 && removeIds.length === 0) return;
  const floatStorePath = getFloatStorePath(binaryHnswPath);
  if (!existsSync(floatStorePath) && binaryVectorsBefore > 0) return;
  const store = new FloatVectorStore();
  await store.loadOrInit(floatStorePath, dimension);
  store.applyDelta({ upserts, removeIds });
  await store.save(floatStorePath);
}

/**
 * Tick-finalize variant of `maintainFloatStore` for the batched path (lever
 * E.1). Instead of loading + saving the float store once per file, the
 * reconciler loads the store once at tick start, accumulates all of the tick's
 * float upserts/removes, and calls this once at tick finalize to apply them and
 * save.
 *
 * `binaryVectorsBefore` is the live binary-HNSW vector count captured at TICK
 * START (before any of this tick's appends), preserving the same
 * "abnormal-state skip" semantics as the per-file path: if the float store is
 * absent but the binary HNSW already held vectors, a store built from the delta
 * alone would mis-score every baseline doc, so we skip until a full rebuild
 * restores it.
 *
 * Returns `{ saved: boolean }` — `saved=false` means the delta was empty or the
 * store was skipped (no fsync happened), which the persist-before-advance gate
 * treats as "no float artifact changed this tick".
 *
 * @param {object} args
 * @param {string} args.binaryHnswPath
 * @param {FloatVectorStore} [args.store]        resident store (loaded once at tick start)
 * @param {Array<{id:string, vector:Float32Array}>} args.upserts
 * @param {string[]} args.removeIds
 * @param {number} args.binaryVectorsBefore
 * @param {number} args.dimension
 * @returns {Promise<{saved: boolean}>}
 */
export async function flushFloatStore({ binaryHnswPath, store = null, upserts = [], removeIds = [], binaryVectorsBefore = 0, dimension }) {
  if (!float512StoreEnabled()) return { saved: false };
  if (upserts.length === 0 && removeIds.length === 0) return { saved: false };
  const floatStorePath = getFloatStorePath(binaryHnswPath);
  if (!existsSync(floatStorePath) && binaryVectorsBefore > 0 && !(store && store.loaded && store.count > 0)) {
    return { saved: false };
  }
  const fvs = store || new FloatVectorStore();
  if (!fvs.loaded) await fvs.loadOrInit(floatStorePath, dimension);
  fvs.applyDelta({ upserts, removeIds });
  await fvs.save(floatStorePath);
  return { saved: true };
}
