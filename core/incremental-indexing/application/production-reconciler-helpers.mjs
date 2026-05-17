import { normalizeIdentifier } from '../../graph/graph-extractor.js';
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
