/**
 * Index schema version check for readers of code-graph.db and codebase.db.
 *
 * There are no schema migrations: the full build creates the current schema, and an index
 * built with another SCHEMA_VERSION must be rebuilt. Readers check once per connection and
 * fail with that instruction instead of a SQL error on a missing column.
 */
import { existsSync } from 'fs';
import Database from 'better-sqlite3';

/**
 * Version of the code-graph.db and codebase.db schemas (stored in code-graph.db
 * `schema_meta.version` and codebase.db `PRAGMA user_version`). Bump it in the same diff as
 * any table or column change in `core/graph/graph-extractor.js` createGraphSchema or
 * `core/indexing/indexer-build.js` createVectorSchema. There are no migrations: an index
 * built with another version is rebuilt (`sweet-search index --full`), and readers refuse
 * it with that message (below).
 * 3: the full build creates the epoch-versioned schema (logical ids, epoch columns).
 */
export const SCHEMA_VERSION = 3;

export const INDEX_REBUILD_MESSAGE = 'rebuild it with: sweet-search index --full';

export class IndexSchemaError extends Error {
  constructor(dbPath, found) {
    super(`The index at ${dbPath} has schema version ${found ?? 'none'}, this sweet-search needs ${SCHEMA_VERSION}: ${INDEX_REBUILD_MESSAGE}`);
    this.name = 'IndexSchemaError';
    this.code = 'INDEX_SCHEMA_OUTDATED';
  }
}

/** Version stored in code-graph.db (`schema_meta.version`), or null. */
export function graphSchemaVersion(db) {
  try {
    const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'version'").get();
    return row ? Number.parseInt(row.value, 10) : null;
  } catch {
    return null;
  }
}

/** Version stored in codebase.db (`PRAGMA user_version`; 0 when never set). */
export function vectorSchemaVersion(db) {
  try {
    return db.pragma('user_version', { simple: true }) || null;
  } catch {
    return null;
  }
}

export function assertGraphSchema(db, dbPath = 'code-graph.db') {
  const found = graphSchemaVersion(db);
  if (found !== SCHEMA_VERSION) throw new IndexSchemaError(dbPath, found);
}

export function assertVectorSchema(db, dbPath = 'codebase.db') {
  const found = vectorSchemaVersion(db);
  if (found !== SCHEMA_VERSION) throw new IndexSchemaError(dbPath, found);
}

/**
 * Check both index databases that exist, each on a short read-only connection. Search
 * calls it at init, so every mode (also the semantic one, which reads codebase.db only
 * for a few columns) fails with the rebuild instruction on an index of another version.
 */
export function assertIndexSchemas({ graphDbPath, codebaseDbPath } = {}) {
  for (const [dbPath, assert] of [[graphDbPath, assertGraphSchema], [codebaseDbPath, assertVectorSchema]]) {
    if (!dbPath || !existsSync(dbPath)) continue;
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try { assert(db, dbPath); } finally { db.close(); }
  }
}
