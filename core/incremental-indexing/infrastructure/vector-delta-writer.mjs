/**
 * Vector delta writer.
 *
 * Plan § 7.2 + § 13 Phase 1. The reconcile tick translates a list of
 * dirty chunks into per-row UPSERTs against `codebase.db::vectors`
 * keyed on `(file_path, chunk_struct_id)`. Stable chunks whose
 * `embedding_input_hash` and `li_input_hash` are unchanged keep their
 * BLOB; only changed payloads run through the encoder.
 *
 * This module is intentionally narrow:
 *   - It knows the vectors-table column layout (post `migrateVectorsSchema`).
 *   - It does NOT call the encoder. The caller (reconcile application
 *     service) decides what to re-encode based on the diff result here.
 *   - It does NOT touch HNSW, LI, or sparse-gram artifacts; per-tier
 *     side effects are dispatched by the reconciler.
 *
 * The diff is the load-bearing API. Given the chunker output for a file
 * and the current DB state, it returns:
 *
 *   {
 *     toEncode:   [ { chunk, denseNeeded, liNeeded } ],
 *     toReuse:    [ { chunk, prevRow } ],
 *     toRetire:   [ { rowId, chunkStructId } ],
 *     metadataDirty: [ chunk_struct_id ],   // populated by reconciler
 *     counters: { hit, miss, ... },
 *   }
 *
 * The "retire" set covers chunks that existed in DB for this file but no
 * longer have a matching `chunk_struct_id`. Per plan § 7.2, those rows are
 * tombstoned in the same per-file transaction by setting
 * `epoch_retired = ε+1`; the reconciler does the actual SQL write.
 */

import { assignStructuralIds } from '../domain/chunk-identity.mjs';
import { chunkInputHashes } from '../domain/encoder-input.mjs';

/**
 * Annotate each chunk with its structural ID + per-consumer hashes in
 * one pass. Returns a parallel array; does not mutate the chunks.
 *
 * @param {Array<object>} chunks
 * @param {string} filePath
 * @returns {Array<{chunkStructId:string, structural:boolean, occurrenceIndex:number|null, hashes:{chunk_text_hash:string, embedding_input_hash:string, li_input_hash:string, metadata_fingerprint:string, dedup_fingerprint:string}}>}
 */
export function annotateChunksForDelta(chunks, filePath) {
  const ids = assignStructuralIds(chunks, filePath);
  return ids.map((id, i) => ({
    chunkStructId: id.chunkStructId,
    structural: id.structural,
    occurrenceIndex: id.occurrenceIndex,
    rollingHash: id.rollingHash,
    reason: id.reason,
    hashes: chunkInputHashes(chunks[i]),
  }));
}

/**
 * Fetch the current per-row hash state for one file. Returns a Map keyed
 * by `chunk_struct_id` so the diff can be O(n). Falls back to `chunk_id`
 * (the legacy positional ID stored as the row's primary key) when the
 * row has no structural ID — typical for rows written by the older
 * indexer before the Phase 1 migration.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} filePath
 * @param {{manifestEpoch?: number}} [options]
 * @returns {Map<string, {id:string, chunk_struct_id:string, chunk_text_hash:string, embedding_input_hash:string, li_input_hash:string, metadata_fingerprint:string, epoch_written:number, epoch_retired:number|null}>}
 */
export function snapshotFileRows(db, filePath, options = {}) {
  const map = new Map();
  const pinned = Number.isInteger(options.manifestEpoch);
  const visibilitySql = pinned
    ? `AND (epoch_written IS NULL OR epoch_written <= ?)
       AND (epoch_retired IS NULL OR epoch_retired > ?)`
    : `AND epoch_retired IS NULL`;
  const args = pinned ? [filePath, options.manifestEpoch, options.manifestEpoch] : [filePath];
  const rows = db.prepare(`
    SELECT id, chunk_struct_id, chunk_text_hash, embedding_input_hash,
           li_input_hash, metadata_fingerprint, epoch_written, epoch_retired
    FROM vectors
    WHERE file_path = ?
      ${visibilitySql}
    ORDER BY epoch_written DESC
  `).all(...args);
  for (const row of rows) {
    const key = row.chunk_struct_id && row.chunk_struct_id.length > 0
      ? row.chunk_struct_id
      : `legacy:${row.id}`;
    if (map.has(key)) continue;
    map.set(key, row);
  }
  return map;
}

/**
 * Compute the diff between annotated chunks and the current DB rows.
 *
 * Decision rules per chunk:
 *   - structural ID matches an existing row + embedding_input_hash matches
 *     → dense reuse.
 *   - structural ID matches + li_input_hash matches → LI reuse.
 *   - structural ID matches + encoder hashes match but chunk_text_hash or
 *     metadata_fingerprint changed → version the row while reusing encoder
 *     payloads, so readers pinned to the next epoch see fresh text/metadata.
 *   - structural ID matches + only metadata_fingerprint changed →
 *     metadata-dirty (caller may need to re-run graph enrichment and
 *     re-hash; treat as "needs encode" defensively until the reconciler
 *     decides).
 *   - new chunk_struct_id → insert + encode both.
 *   - existing rows whose struct id is absent from the new chunk list →
 *     retire (tombstone in the same per-file transaction).
 *
 * @param {Array<object>} chunks                Output of the chunker.
 * @param {Array<{chunkStructId:string, hashes:object}>} annotations  From annotateChunksForDelta.
 * @param {Map<string, object>} dbSnapshot      From snapshotFileRows.
 * @returns {{toEncode:Array, toReuse:Array, toRetire:Array, counters:{hit:number, miss:number, retire:number, metadata_dirty:number}}}
 */
export function diffChunks(chunks, annotations, dbSnapshot) {
  const toEncode = [];
  const toReuse = [];
  const seenIds = new Set();
  const counters = { hit: 0, miss: 0, retire: 0, metadata_dirty: 0 };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const ann = annotations[i];
    if (!ann || !ann.chunkStructId) {
      // Fallback path: chunk has no structural ID. The reconciler still
      // needs to encode + insert; structural reuse is impossible.
      toEncode.push({
        chunk, ann,
        denseNeeded: true, liNeeded: true,
        reason: 'no-struct-id',
      });
      counters.miss += 1;
      continue;
    }
    const key = ann.chunkStructId;
    seenIds.add(key);
    const prev = dbSnapshot.get(key);

    if (!prev) {
      toEncode.push({
        chunk, ann,
        denseNeeded: true, liNeeded: true,
        reason: 'new',
      });
      counters.miss += 1;
      continue;
    }

    const denseMatch = prev.embedding_input_hash === ann.hashes.embedding_input_hash
      && ann.hashes.embedding_input_hash !== '';
    const liMatch = prev.li_input_hash === ann.hashes.li_input_hash
      && ann.hashes.li_input_hash !== '';

    const textMatch = prev.chunk_text_hash === ann.hashes.chunk_text_hash
      && ann.hashes.chunk_text_hash !== '';
    const metadataMatch = prev.metadata_fingerprint === ann.hashes.metadata_fingerprint;

    if (denseMatch && liMatch && textMatch && metadataMatch) {
      toReuse.push({ chunk, ann, prevRow: prev });
      counters.hit += 1;
      continue;
    }

    if (denseMatch && liMatch) {
      // Text and/or metadata shifted, but encoder payloads are still valid.
      // Write a new row version reusing the old embedding BLOB so old and new
      // manifest epochs each see their matching row contents.
      toReuse.push({
        chunk,
        ann,
        prevRow: prev,
        metadataOnly: !metadataMatch,
        textOnly: !textMatch,
      });
      if (!metadataMatch) counters.metadata_dirty += 1;
      counters.hit += 1;
      continue;
    }

    // Partial reuse: dense XOR LI. The reconciler can choose to re-encode
    // only the affected consumer.
    toEncode.push({
      chunk, ann, prevRow: prev,
      denseNeeded: !denseMatch,
      liNeeded: !liMatch,
      reason: denseMatch ? 'li-only' : (liMatch ? 'dense-only' : 'both'),
    });
    counters.miss += 1;
  }

  const toRetire = [];
  for (const [key, prev] of dbSnapshot.entries()) {
    if (seenIds.has(key)) continue;
    if (prev.epoch_retired != null) continue; // already tombstoned
    toRetire.push({ rowId: prev.id, chunkStructId: prev.chunk_struct_id });
    counters.retire += 1;
  }

  return { toEncode, toReuse, toRetire, counters };
}

/**
 * Apply the writer side of the diff. Exact reuse rows are deliberately
 * left untouched: bumping `epoch_written` in place would make the row
 * disappear for readers pinned to the previous manifest while the SQLite
 * commit is visible but the epoch manifest is not.
 *
 * Text/metadata-only reuse writes a new row version that reuses the previous
 * embedding BLOB, then retires the previous row at `epoch`. This preserves
 * the strict visibility predicate for both old and new readers.
 *
 * Newly encoded rows go through the existing
 * `core/indexing/indexer-build.js::insertVectors` pathway; the reconciler
 * inserts them with the new column values populated via the helpers in
 * this module.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} filePath
 * @param {object} diff                      Output of `diffChunks`.
 * @param {number} epoch                     ε+1 for this tick.
 * @returns {{versionedRows:Array<{oldId:string,newId:string,chunkStructId:string}>, replacedRows:Array<{oldId:string,chunkStructId:string}>, retiredRows:Array<{oldId:string,chunkStructId:string}>}}
 */
export function applyDiff(db, filePath, diff, epoch) {
  if (!Number.isInteger(epoch)) {
    throw new Error(`applyDiff: epoch must be an integer, got ${epoch}`);
  }
  const tombstoneStmt = db.prepare(`
    UPDATE vectors
       SET epoch_retired = ?
     WHERE id = ? AND (epoch_retired IS NULL OR epoch_retired > ?)
  `);
  const summary = { versionedRows: [], replacedRows: [], retiredRows: [] };

  for (const reused of diff.toReuse) {
    if (!reused.metadataOnly && !reused.textOnly) continue;
    const { chunk, ann, prevRow } = reused;
    const newId = insertReusedRowVersion(db, filePath, chunk, ann, prevRow, epoch);
    tombstoneStmt.run(epoch, prevRow.id, epoch);
    if (newId) {
      summary.versionedRows.push({
        oldId: prevRow.id,
        newId,
        chunkStructId: ann.chunkStructId,
      });
    }
  }

  for (const encoded of diff.toEncode || []) {
    if (encoded.prevRow?.id) {
      tombstoneStmt.run(epoch, encoded.prevRow.id, epoch);
      summary.replacedRows.push({
        oldId: encoded.prevRow.id,
        chunkStructId: encoded.ann?.chunkStructId ?? encoded.prevRow.chunk_struct_id,
      });
    }
  }

  for (const retired of diff.toRetire) {
    tombstoneStmt.run(epoch, retired.rowId, epoch);
    summary.retiredRows.push({
      oldId: retired.rowId,
      chunkStructId: retired.chunkStructId,
    });
  }
  return summary;
}

function uniqueVersionedId(db, baseId, epoch) {
  let candidate = `${baseId}@e${epoch}`;
  let suffix = 1;
  const exists = db.prepare('SELECT 1 FROM vectors WHERE id = ?');
  while (exists.get(candidate)) {
    candidate = `${baseId}@e${epoch}.${suffix++}`;
  }
  return candidate;
}

function insertReusedRowVersion(db, filePath, chunk, ann, prevRow, epoch) {
  const source = db.prepare('SELECT * FROM vectors WHERE id = ?').get(prevRow.id);
  if (!source) return null;

  const columns = db.prepare('PRAGMA table_info(vectors)').all().map((c) => c.name);
  const next = { ...source };
  next.id = uniqueVersionedId(db, prevRow.id, epoch);
  if (columns.includes('file_path')) next.file_path = coalescePath(filePath, source.file_path);
  if (columns.includes('text')) next.text = chunk?.content ?? chunk?.text ?? source.text ?? '';
  if (columns.includes('metadata')) {
    next.metadata = Object.hasOwn(chunk ?? {}, 'metadata')
      ? JSON.stringify(vectorRowMetadata(filePath, chunk, source.metadata, source.file_path))
      : source.metadata;
  }
  if (columns.includes('chunk_struct_id')) next.chunk_struct_id = ann.chunkStructId;
  if (columns.includes('chunk_text_hash')) next.chunk_text_hash = ann.hashes.chunk_text_hash;
  if (columns.includes('embedding_input_hash')) next.embedding_input_hash = ann.hashes.embedding_input_hash;
  if (columns.includes('li_input_hash')) next.li_input_hash = ann.hashes.li_input_hash;
  if (columns.includes('metadata_fingerprint')) next.metadata_fingerprint = ann.hashes.metadata_fingerprint;
  if (columns.includes('logical_chunk_id')) {
    next.logical_chunk_id = source.logical_chunk_id || ann.chunkStructId;
  }
  if (columns.includes('epoch_written')) next.epoch_written = epoch;
  if (columns.includes('epoch_retired')) next.epoch_retired = null;

  const quoted = columns.map((c) => `"${c}"`).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO vectors (${quoted}) VALUES (${placeholders})`)
    .run(...columns.map((c) => next[c]));
  return next.id;
}

function parseJsonObject(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function coalesce(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function coalescePath(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
    if (!normalized || normalized === '.' || normalized.startsWith('/')) continue;
    if (/^[A-Za-z]:\//.test(normalized)) continue;
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) continue;
    return normalized;
  }
  return null;
}

function vectorRowMetadata(filePath, chunk, previousRawMetadata, storedFilePath) {
  const previous = parseJsonObject(previousRawMetadata);
  const meta = chunk?.metadata ?? {};
  return {
    ...previous,
    file: coalescePath(meta.relative_path, meta.path, meta.file_path, storedFilePath, filePath, chunk?.file, meta.file, previous.file),
    type: coalesce(meta.type, meta.chunk_type, previous.type, 'code'),
    name: coalesce(meta.name, meta.symbol, previous.name),
    startLine: coalesce(meta.startLine, meta.line_start, previous.startLine),
    endLine: coalesce(meta.endLine, meta.line_end, previous.endLine),
    language: coalesce(meta.language, previous.language),
    provider: coalesce(previous.provider, meta.provider),
    dimension: coalesce(previous.dimension, meta.dimension),
    simhash: coalesce(meta.simhash, previous.simhash),
    clusterId: coalesce(meta.clusterId, previous.clusterId),
    exemplarId: coalesce(meta.exemplarId, previous.exemplarId),
    isExemplar: coalesce(meta.isExemplar, previous.isExemplar),
  };
}
