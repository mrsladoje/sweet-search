/**
 * Database Utilities - Shared SQLite configuration helpers.
 */

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
