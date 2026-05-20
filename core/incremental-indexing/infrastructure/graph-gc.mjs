/**
 * Retired-row physical GC for `code-graph.db`.
 *
 * The reconcile path only *tombstones* superseded graph rows: `applyGraphDelta`
 * sets `epoch_retired` on retired entities/relationships (and HCGS summaries),
 * but nothing ever deletes them, so `code-graph.db` grows without bound under a
 * long-lived daemon. The post-fix soak ended with ~90% of entity rows retired
 * (3466/3870, ~3.8 MB), which is the dominant long-run growth source once the
 * vector / LI / sparse tiers are bounded. This module physically removes
 * retired graph rows once no reader can still observe them.
 *
 * Safety (strict visibility — mirrors `vector-gc.mjs` § 8.1.1):
 *   An entity row is visible to a reader pinned at manifest epoch E iff
 *     (epoch_written IS NULL OR epoch_written <= E)
 *     AND (epoch_retired IS NULL OR epoch_retired > E)
 *     AND (stale_since IS NULL OR (epoch_retired IS NOT NULL AND epoch_retired > E))
 *   Relationships and HCGS summaries use the same epoch_written/epoch_retired
 *   rule. So a row with `epoch_retired = R` is invisible to every reader whose
 *   pinned epoch E satisfies E >= R. The smallest epoch any live reader pins is
 *   `minLiveEpoch` (from reader heartbeats); the repository always re-syncs to
 *   the latest manifest, so a reader's query epoch never drops below its
 *   heartbeat epoch. Deleting rows with `epoch_retired <= frontier`, where
 *   `frontier = minLiveEpoch ?? currentManifestEpoch`, can never remove a row
 *   any reader still sees:
 *     - readers present → frontier = minLiveEpoch <= every reader's epoch.
 *     - no readers      → frontier = currentManifestEpoch; any future reader
 *       reads a manifest at epoch >= currentManifestEpoch (monotonic), so the
 *       deleted rows (retired <= currentManifestEpoch <= future E) are already
 *       invisible to it.
 *
 * Reference integrity: deleting a retired entity cannot orphan a *live*
 * relationship. The read path LEFT JOINs relationships to entities under the
 * entity-visibility filter; a retired entity (epoch_retired <= frontier <= E)
 * is already filtered out of that join at every visible epoch, so any live
 * relationship pointing at it already resolves to NULL and is dropped from
 * results. Removing the already-invisible entity changes no query result.
 * A retired entity's own outgoing relationships are retired in the same
 * reconcile transaction at the same epoch, so they fall under the same
 * frontier and are GC'd alongside it.
 *
 * FTS5 consistency: `entities_fts` and `entities_trigram` are external-content
 * FTS5 tables (`content='entities'`, `content_rowid='rowid'`). Deleting an
 * entity content row does NOT update the index, so we must issue the FTS5
 * `'delete'` command (rowid + the originally-indexed column values, read from
 * the still-present row) before unlinking the content row, all in one
 * transaction. Retired rows are immutable apart from `epoch_retired` /
 * `stale_since` (neither is an FTS column), so the current column values equal
 * the indexed values and the delete is exact.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const DEFAULT_GRAPH_GC_BATCH = 2000;
export const DEFAULT_GRAPH_GC_MAX_ROWS = 100_000;

function tableExists(db, name) {
  return !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
  ).get(name);
}

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch {
    return false;
  }
}

function normalizeBatchOpts(opts) {
  const batchSize = Number.isInteger(opts.batchSize) && opts.batchSize > 0
    ? opts.batchSize : DEFAULT_GRAPH_GC_BATCH;
  const maxRows = Number.isInteger(opts.maxRows) && opts.maxRows > 0
    ? opts.maxRows : DEFAULT_GRAPH_GC_MAX_ROWS;
  return { batchSize, maxRows };
}

/**
 * Delete retired `relationships` rows at or below `frontier` in bounded
 * batches. Relationships carry no FTS coupling and no dependents, so a plain
 * `rowid IN (… LIMIT ?)` delete is sufficient (works regardless of whether
 * SQLite was built with SQLITE_ENABLE_UPDATE_DELETE_LIMIT).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} frontier
 * @param {{batchSize?:number, maxRows?:number}} [opts]
 * @returns {{deleted:number, batches:number, hitCap:boolean, skipped?:string}}
 */
export function pruneRetiredRelationships(db, frontier, opts = {}) {
  if (!Number.isInteger(frontier)) {
    throw new Error(`pruneRetiredRelationships: frontier must be an integer, got ${frontier}`);
  }
  if (!hasColumn(db, 'relationships', 'epoch_retired')) {
    return { deleted: 0, batches: 0, hitCap: false, skipped: 'no-epoch-column' };
  }
  const { batchSize, maxRows } = normalizeBatchOpts(opts);
  const stmt = db.prepare(`
    DELETE FROM relationships
     WHERE rowid IN (
       SELECT rowid FROM relationships
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
    const changes = stmt.run(frontier, take).changes ?? 0;
    deleted += changes;
    batches += 1;
    if (changes < take) break; // drained
  }
  return { deleted, batches, hitCap };
}

/**
 * Delete retired `entities` rows at or below `frontier` in bounded batches,
 * keeping the external-content FTS5 indices consistent. For each row we issue
 * the FTS5 `'delete'` command (rowid + originally-indexed columns) before
 * unlinking the content row, inside one transaction per batch so cross-process
 * readers (WAL) observe an all-or-nothing change.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} frontier
 * @param {{batchSize?:number, maxRows?:number}} [opts]
 * @returns {{deleted:number, batches:number, hitCap:boolean, ftsDeleted:number, skipped?:string}}
 */
export function pruneRetiredEntities(db, frontier, opts = {}) {
  if (!Number.isInteger(frontier)) {
    throw new Error(`pruneRetiredEntities: frontier must be an integer, got ${frontier}`);
  }
  if (!hasColumn(db, 'entities', 'epoch_retired')) {
    return { deleted: 0, batches: 0, hitCap: false, ftsDeleted: 0, skipped: 'no-epoch-column' };
  }
  const { batchSize, maxRows } = normalizeBatchOpts(opts);
  const hasFts = tableExists(db, 'entities_fts');
  const hasTrigram = tableExists(db, 'entities_trigram');

  const selectStmt = db.prepare(`
    SELECT rowid AS rid, name, name_alias, signature, doc_comment
      FROM entities
     WHERE epoch_retired IS NOT NULL AND epoch_retired <= ?
     LIMIT ?
  `);
  const ftsDel = hasFts ? db.prepare(
    `INSERT INTO entities_fts(entities_fts, rowid, name, name_alias, signature, doc_comment)
     VALUES('delete', ?, ?, ?, ?, ?)`,
  ) : null;
  const triDel = hasTrigram ? db.prepare(
    `INSERT INTO entities_trigram(entities_trigram, rowid, name, signature)
     VALUES('delete', ?, ?, ?)`,
  ) : null;
  const delStmt = db.prepare('DELETE FROM entities WHERE rowid = ?');

  const runBatch = db.transaction((take) => {
    const rows = selectStmt.all(frontier, take);
    let ftsRemoved = 0;
    for (const r of rows) {
      if (ftsDel) { try { ftsDel.run(r.rid, r.name, r.name_alias, r.signature, r.doc_comment); ftsRemoved += 1; } catch { /* index drift — tolerate */ } }
      if (triDel) { try { triDel.run(r.rid, r.name, r.signature); } catch { /* tolerate */ } }
      delStmt.run(r.rid);
    }
    return { count: rows.length, ftsRemoved };
  });

  let deleted = 0;
  let batches = 0;
  let ftsDeleted = 0;
  let hitCap = false;
  for (;;) {
    const remainingCap = maxRows - deleted;
    if (remainingCap <= 0) { hitCap = true; break; }
    const take = Math.min(batchSize, remainingCap);
    const { count, ftsRemoved } = runBatch(take);
    deleted += count;
    ftsDeleted += ftsRemoved;
    batches += 1;
    if (count < take) break; // drained
  }
  return { deleted, batches, hitCap, ftsDeleted };
}

/**
 * Delete retired `hcgs_summary_metadata` rows at or below `frontier` in bounded
 * batches. The table is WITHOUT ROWID (PK `entity_id`), so we bound via an
 * `entity_id IN (… LIMIT ?)` subquery.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} frontier
 * @param {{batchSize?:number, maxRows?:number}} [opts]
 * @returns {{deleted:number, batches:number, hitCap:boolean, skipped?:string}}
 */
export function pruneRetiredGraphSummaries(db, frontier, opts = {}) {
  if (!Number.isInteger(frontier)) {
    throw new Error(`pruneRetiredGraphSummaries: frontier must be an integer, got ${frontier}`);
  }
  if (!tableExists(db, 'hcgs_summary_metadata') || !hasColumn(db, 'hcgs_summary_metadata', 'epoch_retired')) {
    return { deleted: 0, batches: 0, hitCap: false, skipped: 'no-summary-table' };
  }
  const { batchSize, maxRows } = normalizeBatchOpts(opts);
  const stmt = db.prepare(`
    DELETE FROM hcgs_summary_metadata
     WHERE entity_id IN (
       SELECT entity_id FROM hcgs_summary_metadata
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
    const changes = stmt.run(frontier, take).changes ?? 0;
    deleted += changes;
    batches += 1;
    if (changes < take) break; // drained
  }
  return { deleted, batches, hitCap };
}

/**
 * Run retired-row GC against `<stateDir>/code-graph.db`.
 *
 * Computes the safe prune frontier from reader heartbeats (falling back to the
 * current manifest epoch when no readers are live), prunes relationships, then
 * entities (with FTS cleanup), then HCGS summaries — sharing a single per-run
 * row budget — then issues a PASSIVE WAL checkpoint to keep the WAL bounded
 * without ever blocking concurrent readers. Never throws on a missing DB /
 * table / column / heartbeat dir — returns `{ skipped }` instead.
 *
 * @param {string} stateDir
 * @param {{
 *   dbPath?:string, batchSize?:number, maxRows?:number,
 *   minLiveEpoch?:(dir:string)=>(number|null),
 *   readManifest?:(dir:string)=>(object|null),
 * }} [deps]
 * @returns {{
 *   deletedEntities:number, deletedRelationships:number, deletedSummaries:number,
 *   frontier:number, hadReaders:boolean, batches:number, hitCap:boolean
 * } | {skipped:string}}
 */
export function runGraphGc(stateDir, deps = {}) {
  const dbPath = deps.dbPath || path.join(stateDir, 'code-graph.db');
  if (!fs.existsSync(dbPath)) return { skipped: 'no-graph-db' };

  const minLiveEpochFn = deps.minLiveEpoch;
  const readManifestFn = deps.readManifest;
  if (typeof minLiveEpochFn !== 'function' || typeof readManifestFn !== 'function') {
    throw new Error('runGraphGc: minLiveEpoch and readManifest deps are required');
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

  const { batchSize, maxRows } = normalizeBatchOpts(deps);
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    // Relationships first (cheapest, no FTS), then entities (FTS cleanup),
    // then HCGS summaries — sharing one per-run row budget so a churny graph
    // can never starve the reconcile tick. Safe in any order: every deleted
    // row is already invisible at the frontier.
    let budget = maxRows;
    const rel = tableExists(db, 'relationships')
      ? pruneRetiredRelationships(db, frontier, { batchSize, maxRows: budget })
      : { deleted: 0, batches: 0, hitCap: false };
    budget -= rel.deleted;
    const ent = (budget > 0 && tableExists(db, 'entities'))
      ? pruneRetiredEntities(db, frontier, { batchSize, maxRows: budget })
      : { deleted: 0, batches: 0, hitCap: false };
    budget -= ent.deleted;
    const sum = (budget > 0)
      ? pruneRetiredGraphSummaries(db, frontier, { batchSize, maxRows: budget })
      : { deleted: 0, batches: 0, hitCap: false };

    const totalDeleted = rel.deleted + ent.deleted + sum.deleted;
    if (totalDeleted > 0) {
      try { db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* best-effort */ }
    }

    return {
      deletedEntities: ent.deleted,
      deletedRelationships: rel.deleted,
      deletedSummaries: sum.deleted,
      ftsDeleted: ent.ftsDeleted ?? 0,
      frontier,
      hadReaders,
      batches: rel.batches + ent.batches + sum.batches,
      hitCap: !!(rel.hitCap || ent.hitCap || sum.hitCap),
    };
  } finally {
    db.close();
  }
}
