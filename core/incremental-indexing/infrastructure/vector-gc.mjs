/**
 * Retired-vector physical GC for `codebase.db`.
 *
 * `applyDiff` (vector-delta-writer) only *tombstones* superseded rows by
 * setting `epoch_retired`; nothing ever deletes them, so `codebase.db` grows
 * without bound under a long-lived daemon. This module physically removes
 * retired rows once no reader can still observe them.
 *
 * Safety (strict visibility, plan § 8.1.1):
 *   A row is visible to a reader pinned at manifest epoch E iff
 *     epoch_written <= E AND (epoch_retired IS NULL OR epoch_retired > E).
 *   So a row with `epoch_retired = R` is invisible to every reader whose
 *   pinned epoch E satisfies E >= R. The smallest epoch any live reader
 *   pins is `minLiveEpoch` (from reader heartbeats); the repository always
 *   re-syncs to the *latest* manifest, so a reader's query epoch is never
 *   below its heartbeat epoch. Therefore deleting rows with
 *   `epoch_retired <= frontier`, where `frontier = minLiveEpoch ??
 *   currentManifestEpoch`, can never remove a row any reader still sees:
 *     - readers present  → frontier = minLiveEpoch <= every reader's epoch.
 *     - no readers       → frontier = currentManifestEpoch; any future
 *       reader reads a manifest at epoch >= currentManifestEpoch (monotonic),
 *       so deleted rows (retired <= currentManifestEpoch <= future E) are
 *       already invisible to it.
 *
 * The float/binary HNSW indices keep their own vector copies and are rebuilt
 * from live rows (`epoch_retired IS NULL`); they never read retired rows, so
 * deleting retired DB rows cannot desync them.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const DEFAULT_GC_BATCH = 2000;
export const DEFAULT_GC_MAX_ROWS = 100_000;

/**
 * Delete retired rows at or below `frontier` in bounded batches.
 *
 * Uses a `rowid IN (SELECT … LIMIT ?)` subquery so it works regardless of
 * whether SQLite was compiled with `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`.
 *
 * @param {import('better-sqlite3').Database} db   open read-write connection
 * @param {number} frontier                        inclusive prune boundary
 * @param {{batchSize?:number, maxRows?:number}} [opts]
 * @returns {{deleted:number, batches:number, hitCap:boolean}}
 */
export function pruneRetiredVectors(db, frontier, opts = {}) {
  if (!Number.isInteger(frontier)) {
    throw new Error(`pruneRetiredVectors: frontier must be an integer, got ${frontier}`);
  }
  const batchSize = Number.isInteger(opts.batchSize) && opts.batchSize > 0 ? opts.batchSize : DEFAULT_GC_BATCH;
  const maxRows = Number.isInteger(opts.maxRows) && opts.maxRows > 0 ? opts.maxRows : DEFAULT_GC_MAX_ROWS;

  const stmt = db.prepare(`
    DELETE FROM vectors
     WHERE rowid IN (
       SELECT rowid FROM vectors
        WHERE epoch_retired IS NOT NULL AND epoch_retired <= ?
        LIMIT ?
     )
  `);

  let deleted = 0;
  let batches = 0;
  let hitCap = false;
  for (;;) {
    const remainingCap = maxRows - deleted;
    if (remainingCap <= 0) { hitCap = true; break; }
    const take = Math.min(batchSize, remainingCap);
    const res = stmt.run(frontier, take);
    const changes = res.changes ?? 0;
    deleted += changes;
    batches += 1;
    if (changes < take) break; // drained
  }
  return { deleted, batches, hitCap };
}

/**
 * Run retired-vector GC against `<stateDir>/codebase.db`.
 *
 * Computes the safe prune frontier from reader heartbeats (falling back to
 * the current manifest epoch when no readers are live), prunes in bounded
 * batches, then issues a PASSIVE WAL checkpoint to keep the WAL from
 * growing without ever blocking concurrent readers. Never throws on a
 * missing DB / column / heartbeat dir — returns `{ skipped }` instead.
 *
 * @param {string} stateDir
 * @param {{
 *   dbPath?:string, batchSize?:number, maxRows?:number,
 *   minLiveEpoch?:(dir:string)=>(number|null),
 *   readManifest?:(dir:string)=>(object|null),
 * }} [deps]
 * @returns {{deleted:number, frontier:number, hadReaders:boolean, batches:number, hitCap:boolean}|{skipped:string}}
 */
export function runVectorGc(stateDir, deps = {}) {
  const dbPath = deps.dbPath || path.join(stateDir, 'codebase.db');
  if (!fs.existsSync(dbPath)) return { skipped: 'no-vector-db' };

  const minLiveEpochFn = deps.minLiveEpoch;
  const readManifestFn = deps.readManifest;
  if (typeof minLiveEpochFn !== 'function' || typeof readManifestFn !== 'function') {
    throw new Error('runVectorGc: minLiveEpoch and readManifest deps are required');
  }

  let frontier = null;
  let hadReaders = false;
  const live = minLiveEpochFn(stateDir);
  if (Number.isInteger(live)) {
    frontier = live;
    hadReaders = true;
  } else {
    const manifest = readManifestFn(stateDir);
    if (Number.isInteger(manifest?.epoch)) frontier = manifest.epoch;
  }
  if (!Number.isInteger(frontier)) return { skipped: 'no-frontier' };

  const db = new Database(dbPath);
  try {
    const cols = db.prepare('PRAGMA table_info(vectors)').all().map((c) => c.name);
    if (!cols.includes('epoch_retired')) return { skipped: 'no-epoch-column' };
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    const result = pruneRetiredVectors(db, frontier, deps);
    if (result.deleted > 0) {
      try { db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* best-effort */ }
    }
    return { ...result, frontier, hadReaders };
  } finally {
    db.close();
  }
}
