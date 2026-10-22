/**
 * Incremental-indexing sidecar tables.
 *
 * The vectors, entities and relationships tables are created in their final shape by
 * createVectorSchema (core/indexing/indexer-build.js) and createGraphSchema
 * (core/graph/graph-extractor.js); there are no migrations (an index with another
 * SCHEMA_VERSION is rebuilt).
 */

/**
 * Apply the encoder-input dependency sidecar (plan § 7.2.1 / § 13 Phase 1).
 *
 * Stores reverse dependencies from external facts to dependent chunks:
 *   `(dependency_key, file_path, chunk_struct_id, consumer)`
 *
 * `consumer` is one of `dense | li | dedup` so the reconciler can mark a
 * chunk metadata-dirty for the specific consumer whose input changed.
 * Future cross-file metadata rules register dependency keys whose changes
 * expand the dirty set; the table also holds the dense / LI / dedup
 * dependencies for same-file metadata edits.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function ensureEncoderDepsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS encoder_input_dependencies (
      dependency_key TEXT NOT NULL,
      file_path TEXT NOT NULL,
      chunk_struct_id TEXT NOT NULL,
      consumer TEXT NOT NULL CHECK (consumer IN ('dense', 'li', 'dedup')),
      PRIMARY KEY (dependency_key, file_path, chunk_struct_id, consumer)
    ) WITHOUT ROWID;
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_encoder_deps_by_chunk
      ON encoder_input_dependencies (file_path, chunk_struct_id);
  `);
}
