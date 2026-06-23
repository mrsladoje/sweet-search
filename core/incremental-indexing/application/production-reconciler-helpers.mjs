import { existsSync } from 'node:fs';
import { normalizeIdentifier } from '../../graph/graph-extractor.js';
import { FloatVectorStore, getFloatStorePath } from '../../vector-store/float-vector-store.js';
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

export function insertEntity(db, e, id, epoch, hasFts) {
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
    null,
    ['method', 'field', 'rpc'].includes(e.type) ? 1 : 0,
    e.id,
    epoch,
  );
  if (!hasFts) return;
  const rowid = db.prepare('SELECT rowid FROM entities WHERE id = ?').get(id)?.rowid;
  if (!rowid) return;
  try { db.prepare('INSERT INTO entities_fts(rowid, name, name_alias, signature, doc_comment) VALUES (?, ?, ?, ?, ?)').run(rowid, e.name, nameAlias || null, e.signature || null, e.doc_comment || null); } catch {}
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

export function markBinaryStale(index, id) {
  const idx = index.idToIndex.get(id);
  if (idx == null) return false;
  const stalePath = index.stalePath || `${index.indexPath}.stale.bin`;
  let bitmap = null;
  try { bitmap = loadBitmap(stalePath); } catch {}
  bitmap = bitmap ? resizeBitmap(bitmap, Math.max(idx + 1, index.vectors.length, 1)) : createBitmap(Math.max(idx + 1, index.vectors.length, 1));
  setBit(bitmap, idx);
  saveBitmap(stalePath, bitmap);
  index.idToIndex.delete(id);
  index.int8Vectors.delete(id);
  index._staleBitmapCache = null;
  return true;
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
