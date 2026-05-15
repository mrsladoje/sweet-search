/**
 * Schema migrations for the incremental-indexing bounded context.
 *
 * Plan § 7.1.6, § 7.2, § 13 Phase 1, § 33 Phase 1 Pre-Merge Checklist.
 *
 * Adds the strict-row-visibility and exact-encoder-input columns required by
 * the reconcile path. All columns carry `DEFAULT` clauses so an older daemon
 * running the original INSERT path (e.g. after a git rollback) does NOT crash
 * with `SQLITE_CONSTRAINT_NOTNULL`. This is load-bearing: without the
 * defaults a rollback would put the daemon into a permanent crash-loop.
 *
 * The migrations are idempotent: `ALTER TABLE ... ADD COLUMN` is skipped when
 * the column already exists, mirroring the pattern in
 * `core/graph/graph-extractor.js`.
 *
 * Index choice: the epoch visibility index is a full B-tree on
 * `epoch_written` rather than a partial recent-window index. Plan § 0 / § 36.5
 * requires Phase 0 benchmarking before committing to the partial form;
 * SQLite's single-writer monotonic-integer append is already a fast path, so
 * we default to the full B-tree and revisit only if Phase 0 measurement shows
 * insertion latency creep.
 */

/**
 * Add a column only if it is missing, in a transaction-safe way.
 * Helper kept private to this module.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} table
 * @param {string} column
 * @param {string} definition  e.g. `"TEXT NOT NULL DEFAULT ''"`.
 * @returns {boolean} true if the column was added; false if it already existed.
 */
function addColumnIfMissing(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function createIndexIfMissing(db, indexName, sql) {
  db.exec(sql);
  // SQLite's CREATE INDEX IF NOT EXISTS already covers idempotence; this
  // helper exists for symmetry with addColumnIfMissing in case we ever need
  // to wrap with logging.
  void indexName;
}

/**
 * Apply the reconcile-v2 vectors-table migration.
 *
 * Adds (plan § 7.2):
 *   - `chunk_struct_id        TEXT NOT NULL DEFAULT ''`
 *   - `chunk_text_hash        TEXT NOT NULL DEFAULT ''`
 *   - `embedding_input_hash   TEXT NOT NULL DEFAULT ''`
 *   - `li_input_hash          TEXT NOT NULL DEFAULT ''`
 *   - `metadata_fingerprint   TEXT NOT NULL DEFAULT ''`
 *   - `logical_chunk_id       TEXT NOT NULL DEFAULT ''`
 *   - `epoch_written          INTEGER NOT NULL DEFAULT 0`
 *   - `epoch_retired          INTEGER`
 *
 * Plus the epoch visibility index.
 *
 * Idempotent. Safe to call on every daemon start.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{added: string[]}}
 */
export function migrateVectorsSchema(db) {
  const added = [];
  const columns = [
    ['chunk_struct_id', "TEXT NOT NULL DEFAULT ''"],
    ['chunk_text_hash', "TEXT NOT NULL DEFAULT ''"],
    ['embedding_input_hash', "TEXT NOT NULL DEFAULT ''"],
    ['li_input_hash', "TEXT NOT NULL DEFAULT ''"],
    ['metadata_fingerprint', "TEXT NOT NULL DEFAULT ''"],
    ['logical_chunk_id', "TEXT NOT NULL DEFAULT ''"],
    ['epoch_written', 'INTEGER NOT NULL DEFAULT 0'],
    ['epoch_retired', 'INTEGER'],
  ];
  // The `vectors` table is created lazily by `createVectorSchema` in
  // `core/indexing/indexer-build.js`. We assume the caller has invoked that
  // already; otherwise the PRAGMA call returns empty and addColumnIfMissing
  // would throw on the ALTER. The reconciler always seeds the schema first.
  const hasTable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='vectors'",
  ).get();
  if (!hasTable) return { added };

  for (const [col, defn] of columns) {
    if (addColumnIfMissing(db, 'vectors', col, defn)) added.push(col);
  }

  createIndexIfMissing(
    db,
    'idx_vectors_struct',
    'CREATE INDEX IF NOT EXISTS idx_vectors_struct ON vectors(chunk_struct_id) WHERE chunk_struct_id != \'\'',
  );
  createIndexIfMissing(
    db,
    'idx_vectors_epoch_written',
    'CREATE INDEX IF NOT EXISTS idx_vectors_epoch_written ON vectors(epoch_written)',
  );
  createIndexIfMissing(
    db,
    'idx_vectors_epoch_retired',
    'CREATE INDEX IF NOT EXISTS idx_vectors_epoch_retired ON vectors(epoch_retired) WHERE epoch_retired IS NOT NULL',
  );
  createIndexIfMissing(
    db,
    'idx_vectors_logical',
    'CREATE INDEX IF NOT EXISTS idx_vectors_logical ON vectors(logical_chunk_id) WHERE logical_chunk_id != \'\'',
  );
  return { added };
}

/**
 * Apply the reconcile-v2 entities-table migration.
 *
 * Adds (plan § 7.1.6):
 *   - `logical_entity_id  TEXT NOT NULL DEFAULT ''`
 *   - `epoch_written      INTEGER NOT NULL DEFAULT 0`
 *   - `epoch_retired      INTEGER`
 *
 * The `stale_since` column is already present; we keep it for compatibility
 * with existing soft-delete behaviour in `core/graph/graph-extractor.js`.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{added: string[]}}
 */
export function migrateEntitiesSchema(db) {
  const added = [];
  const hasTable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='entities'",
  ).get();
  if (!hasTable) return { added };

  if (addColumnIfMissing(db, 'entities', 'logical_entity_id', "TEXT NOT NULL DEFAULT ''")) {
    added.push('logical_entity_id');
  }
  if (addColumnIfMissing(db, 'entities', 'epoch_written', 'INTEGER NOT NULL DEFAULT 0')) {
    added.push('epoch_written');
  }
  if (addColumnIfMissing(db, 'entities', 'epoch_retired', 'INTEGER')) {
    added.push('epoch_retired');
  }
  createIndexIfMissing(
    db,
    'idx_entities_logical',
    'CREATE INDEX IF NOT EXISTS idx_entities_logical ON entities(logical_entity_id) WHERE logical_entity_id != \'\'',
  );
  createIndexIfMissing(
    db,
    'idx_entities_epoch_written',
    'CREATE INDEX IF NOT EXISTS idx_entities_epoch_written ON entities(epoch_written)',
  );
  createIndexIfMissing(
    db,
    'idx_entities_epoch_retired',
    'CREATE INDEX IF NOT EXISTS idx_entities_epoch_retired ON entities(epoch_retired) WHERE epoch_retired IS NOT NULL',
  );
  return { added };
}

/**
 * Apply the reconcile-v2 relationships-table migration.
 *
 * Adds (plan § 7.1.6 / § 33):
 *   - `logical_relationship_id  TEXT NOT NULL DEFAULT ''`
 *   - `epoch_written            INTEGER NOT NULL DEFAULT 0`
 *   - `epoch_retired            INTEGER`
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{added: string[]}}
 */
export function migrateRelationshipsSchema(db) {
  const added = [];
  const hasTable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='relationships'",
  ).get();
  if (!hasTable) return { added };

  if (addColumnIfMissing(db, 'relationships', 'logical_relationship_id', "TEXT NOT NULL DEFAULT ''")) {
    added.push('logical_relationship_id');
  }
  if (addColumnIfMissing(db, 'relationships', 'epoch_written', 'INTEGER NOT NULL DEFAULT 0')) {
    added.push('epoch_written');
  }
  if (addColumnIfMissing(db, 'relationships', 'epoch_retired', 'INTEGER')) {
    added.push('epoch_retired');
  }
  createIndexIfMissing(
    db,
    'idx_rel_logical',
    'CREATE INDEX IF NOT EXISTS idx_rel_logical ON relationships(logical_relationship_id) WHERE logical_relationship_id != \'\'',
  );
  createIndexIfMissing(
    db,
    'idx_rel_epoch_written',
    'CREATE INDEX IF NOT EXISTS idx_rel_epoch_written ON relationships(epoch_written)',
  );
  createIndexIfMissing(
    db,
    'idx_rel_epoch_retired',
    'CREATE INDEX IF NOT EXISTS idx_rel_epoch_retired ON relationships(epoch_retired) WHERE epoch_retired IS NOT NULL',
  );
  return { added };
}

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

/**
 * Run every reconcile-v2 schema migration against the given database.
 *
 * The migrations are split by destination table so callers that only need
 * one can call the focused helper, but the umbrella is the common path for
 * the reconcile bootstrap.
 *
 * @param {{ codeGraph: import('better-sqlite3').Database, vectors: import('better-sqlite3').Database }} dbs
 * @returns {{vectors:{added:string[]}, entities:{added:string[]}, relationships:{added:string[]}}}
 */
export function applyReconcileSchemaMigrations(dbs) {
  const { codeGraph, vectors } = dbs;
  const vRes = migrateVectorsSchema(vectors);
  const eRes = migrateEntitiesSchema(codeGraph);
  const rRes = migrateRelationshipsSchema(codeGraph);
  ensureEncoderDepsSchema(codeGraph);
  return { vectors: vRes, entities: eRes, relationships: rRes };
}
