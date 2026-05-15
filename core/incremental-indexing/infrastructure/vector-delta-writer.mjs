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
 * @returns {Map<string, {id:string, chunk_struct_id:string, chunk_text_hash:string, embedding_input_hash:string, li_input_hash:string, metadata_fingerprint:string, epoch_written:number, epoch_retired:number|null}>}
 */
export function snapshotFileRows(db, filePath) {
  const map = new Map();
  const rows = db.prepare(`
    SELECT id, chunk_struct_id, chunk_text_hash, embedding_input_hash,
           li_input_hash, metadata_fingerprint, epoch_written, epoch_retired
    FROM vectors
    WHERE file_path = ?
  `).all(filePath);
  for (const row of rows) {
    const key = row.chunk_struct_id && row.chunk_struct_id.length > 0
      ? row.chunk_struct_id
      : `legacy:${row.id}`;
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

    if (denseMatch && liMatch && prev.metadata_fingerprint === ann.hashes.metadata_fingerprint) {
      toReuse.push({ chunk, ann, prevRow: prev });
      counters.hit += 1;
      continue;
    }

    if (denseMatch && liMatch) {
      // Only metadata fingerprint shifted — the embedding bytes are still
      // valid but the row's stored metadata needs a refresh. The reconciler
      // can update the row in place; it does NOT need to re-encode.
      toReuse.push({ chunk, ann, prevRow: prev, metadataOnly: true });
      counters.metadata_dirty += 1;
      counters.hit += 1;
      continue;
    }

    // Partial reuse: dense XOR LI. The reconciler can choose to re-encode
    // only the affected consumer.
    toEncode.push({
      chunk, ann,
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
 * Apply the writer side of the diff: persist the new column values back
 * onto existing rows that we reused, and tombstone retired rows. The
 * caller controls the transaction.
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
 */
export function applyDiff(db, filePath, diff, epoch) {
  if (!Number.isInteger(epoch)) {
    throw new Error(`applyDiff: epoch must be an integer, got ${epoch}`);
  }
  const updateRowStmt = db.prepare(`
    UPDATE vectors
       SET chunk_struct_id      = ?,
           chunk_text_hash      = ?,
           embedding_input_hash = ?,
           li_input_hash        = ?,
           metadata_fingerprint = ?,
           logical_chunk_id     = COALESCE(NULLIF(logical_chunk_id, ''), ?),
           epoch_written        = ?
     WHERE id = ?
  `);
  const tombstoneStmt = db.prepare(`
    UPDATE vectors
       SET epoch_retired = ?
     WHERE id = ? AND (epoch_retired IS NULL OR epoch_retired > ?)
  `);

  for (const reused of diff.toReuse) {
    const { chunk, ann, prevRow } = reused;
    updateRowStmt.run(
      ann.chunkStructId,
      ann.hashes.chunk_text_hash,
      ann.hashes.embedding_input_hash,
      ann.hashes.li_input_hash,
      ann.hashes.metadata_fingerprint,
      ann.chunkStructId, // logical_chunk_id mirrors struct id until rename surfaces
      epoch,
      prevRow.id,
    );
    void chunk;
  }

  for (const retired of diff.toRetire) {
    tombstoneStmt.run(epoch, retired.rowId, epoch);
  }
}
