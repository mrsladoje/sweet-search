/**
 * Database Utilities - Shared SQLite configuration helpers.
 */

import Database from 'better-sqlite3';

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
