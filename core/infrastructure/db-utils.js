/**
 * Database Utilities - Shared SQLite configuration helpers.
 */

import Database from 'better-sqlite3';

/**
 * Maximum number of bound parameters in a single SQLite statement.
 *
 * SQLite's compiled-in `SQLITE_LIMIT_VARIABLE_NUMBER` is 32766 on builds
 * since 3.32, but the historic floor is 999, and `better-sqlite3` does
 * not expose `sqlite3_limit()` to raise it at runtime. Using 999 makes
 * `chunkedIn()` safe against any SQLite version or fork the runtime may
 * be vendoring, with no dependency on binding internals.
 *
 * Reference: https://www.sqlite.org/limits.html (LIMIT_VARIABLE_NUMBER).
 */
export const SAFE_IN_CLAUSE_BATCH = 999;

/**
 * Apply read-path PRAGMA optimizations to a read-only database connection.
 *
 * - mmap_size = 256MB: Maps entire DB into OS page cache (typical DBs are 5-50MB).
 *   Subsequent reads bypass SQLite's page cache via xFetch().
 * - cache_size = 20MB: Modest bump from default ~16MB. Partially redundant with mmap
 *   but acts as safety net for internal bookkeeping.
 * - temp_store = MEMORY (optional): Use only for bounded, latency-sensitive read paths.
 *
 * These are best-effort optimizations. PRAGMA failures should not change the caller's
 * fallback behavior or make a readable database look unavailable.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ tempStoreMemory?: boolean }} [options]
 */
export function applyReadPragmas(db, options = {}) {
  if (!db || typeof db.pragma !== 'function') return;
  const { tempStoreMemory = false } = options;

  for (const pragma of [
    'mmap_size = 268435456', // 256MB
    'cache_size = -20000',   // 20MB
  ]) {
    try {
      db.pragma(pragma);
    } catch {
      // Best-effort only.
    }
  }

  if (tempStoreMemory) {
    try {
      db.pragma('temp_store = MEMORY');
    } catch {
      // Best-effort only.
    }
  }
}

/**
 * Throw if an array would overflow SQLite's bound-parameter limit when
 * splatted into a single `IN (?,?,...)` clause. Use this at sites that
 * cannot easily be migrated to {@link chunkedIn} (e.g. UPDATE/DELETE with
 * non-trivial templates, or queries with multiple interpolated
 * placeholder groups) as a fail-fast guard. Crash with a clear domain
 * message instead of the opaque "too many SQL variables" from SQLite.
 *
 * @param {number} n - Length of the values array
 * @param {string} [siteLabel] - Caller identifier for the error message
 */
export function assertInClauseSize(n, siteLabel = 'IN clause') {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
    throw new TypeError(`assertInClauseSize: invalid size ${String(n)}`);
  }
  if (n > SAFE_IN_CLAUSE_BATCH) {
    throw new RangeError(
      `${siteLabel} would bind ${n} parameters; SQLite IN(?,?,...) clauses ` +
      `must be chunked at SAFE_IN_CLAUSE_BATCH=${SAFE_IN_CLAUSE_BATCH}. ` +
      `Migrate this call to chunkedIn() in core/infrastructure/db-utils.js.`
    );
  }
}

/**
 * Execute a SELECT-style query with a dynamic `IN (?,?,...)` clause across
 * an arbitrarily large `values` array by chunking the binds at
 * {@link SAFE_IN_CLAUSE_BATCH}. The caller passes a SQL template that
 * contains the literal token `__IN_PLACEHOLDERS__` exactly once; the
 * helper replaces it with the right number of `?`s per batch and unions
 * the per-batch rows. Empty `values` yields an empty array without
 * preparing a statement.
 *
 * Rows are NOT re-sorted across batches — within a batch SQLite honours
 * any ORDER BY in the template, but batch boundaries break global order.
 * Callers that need globally monotonic output (e.g. ORDER BY rowid for
 * deterministic HNSW insertion) must sort the result themselves.
 *
 * This is the SQLite-variable-limit fix referenced in CLAUDE.md and the
 * indexer-ann.js handoff: the same helper is reused at every site that
 * needs to splat a potentially-large array into an IN clause.
 *
 * @template T
 * @param {import('better-sqlite3').Database} db - Open SQLite handle
 * @param {string} sqlTemplate - Must contain `__IN_PLACEHOLDERS__` once
 * @param {ReadonlyArray<unknown>} values - Values to bind in chunks
 * @returns {T[]} Concatenated rows from each batch
 */
export function chunkedIn(db, sqlTemplate, values) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('chunkedIn: db must be a better-sqlite3 Database');
  }
  if (typeof sqlTemplate !== 'string' || !sqlTemplate.includes('__IN_PLACEHOLDERS__')) {
    throw new TypeError("chunkedIn: sqlTemplate must contain '__IN_PLACEHOLDERS__'");
  }
  if (!values || values.length === 0) return [];

  const out = [];
  for (let i = 0; i < values.length; i += SAFE_IN_CLAUSE_BATCH) {
    const batch = Array.isArray(values)
      ? values.slice(i, i + SAFE_IN_CLAUSE_BATCH)
      : [...values].slice(i, i + SAFE_IN_CLAUSE_BATCH);
    const placeholders = batch.map(() => '?').join(',');
    const sql = sqlTemplate.replace('__IN_PLACEHOLDERS__', placeholders);
    const rows = db.prepare(sql).all(...batch);
    for (let j = 0; j < rows.length; j++) out.push(rows[j]);
  }
  return out;
}

/**
 * UPDATE/DELETE counterpart to {@link chunkedIn}. Same template rules; the
 * helper returns the total `changes` across batches and is executed inside
 * a single transaction so partial-batch failure rolls everything back.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sqlTemplate - Must contain `__IN_PLACEHOLDERS__` once
 * @param {ReadonlyArray<unknown>} values
 * @returns {{ changes: number }} Cumulative row-change count
 */
export function chunkedInExec(db, sqlTemplate, values) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('chunkedInExec: db must be a better-sqlite3 Database');
  }
  if (typeof sqlTemplate !== 'string' || !sqlTemplate.includes('__IN_PLACEHOLDERS__')) {
    throw new TypeError("chunkedInExec: sqlTemplate must contain '__IN_PLACEHOLDERS__'");
  }
  if (!values || values.length === 0) return { changes: 0 };

  const runBatches = db.transaction((items) => {
    let changes = 0;
    for (let i = 0; i < items.length; i += SAFE_IN_CLAUSE_BATCH) {
      const batch = items.slice(i, i + SAFE_IN_CLAUSE_BATCH);
      const placeholders = batch.map(() => '?').join(',');
      const sql = sqlTemplate.replace('__IN_PLACEHOLDERS__', placeholders);
      const result = db.prepare(sql).run(...batch);
      changes += result.changes || 0;
    }
    return changes;
  });

  const items = Array.isArray(values) ? values : [...values];
  return { changes: runBatches(items) };
}

/**
 * Warm the graph database page cache with lightweight queries.
 * Opens an ephemeral connection, touches FTS5/relationship/summary pages, closes.
 * Intentionally minimal — no heavy imports, no query infrastructure.
 *
 * @param {string} dbPath - Path to code_graph.db
 * @returns {{ summaries: number }}
 */
export function warmGraphDbCache(dbPath) {
  const db = new Database(dbPath, { readonly: true, timeout: 5000 });
  applyReadPragmas(db);
  try {
    try { db.prepare('SELECT count(*) FROM entities_fts WHERE name MATCH "warmup"').get(); } catch { /* table may not exist */ }
    try { db.prepare('SELECT count(*) FROM relationships').get(); } catch { /* table may not exist */ }
    let summaries = 0;
    try {
      const row = db.prepare('SELECT count(*) as cnt FROM entities WHERE summary IS NOT NULL').get();
      summaries = row?.cnt || 0;
    } catch { /* column may not exist */ }
    return { summaries };
  } finally {
    db.close();
  }
}
