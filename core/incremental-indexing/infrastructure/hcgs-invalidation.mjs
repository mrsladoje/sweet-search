/**
 * HCGS summary invalidation.
 *
 * Plan § 7.7. HCGS summaries are not one of the five first-stage indices,
 * but stale summaries can still poison reader trust. The reconcile path
 * therefore owns HCGS invalidation in v1:
 *
 *   1. Each summary records `(source_entity_ids, source_chunk_struct_ids,
 *      source_hashes, epoch_written, epoch_retired)`.
 *   2. When graph/vector deltas retire or replace any source entity/chunk,
 *      mark the dependent summary retired in the same manifest epoch.
 *   3. Search and MCP must never serve a summary whose source epoch is not
 *      visible in the pinned manifest. If a fresh summary is missing,
 *      omit it or trigger existing on-demand regeneration; do not serve
 *      the stale text.
 *   4. Regeneration is low-priority CPU / existing provider policy and
 *      happens outside the reconcile tick. Invalidation is the
 *      correctness requirement; eager LLM regeneration is not.
 *
 * The current HCGS implementation (`core/graph/hcgs-generator.js`) stores
 * `summary` and `summary_embedding` directly on the `entities` table. We
 * add a sidecar table `hcgs_summary_metadata` that the reconciler updates
 * in lock-step with the entity/vector deltas. The HCGS query path consults
 * the sidecar to decide whether the live summary is visible at the pinned
 * manifest epoch.
 *
 * Schema:
 *   CREATE TABLE hcgs_summary_metadata (
 *     entity_id          TEXT PRIMARY KEY,
 *     source_entity_ids  TEXT NOT NULL,    -- JSON array
 *     source_chunk_struct_ids TEXT NOT NULL, -- JSON array
 *     source_hashes      TEXT NOT NULL,    -- JSON object {entity_id -> hash}
 *     epoch_written      INTEGER NOT NULL DEFAULT 0,
 *     epoch_retired      INTEGER
 *   ) WITHOUT ROWID;
 *
 * The reconciler writes one row per summary it observes; the maintenance
 * worker prunes rows whose `epoch_retired` is older than `minLiveEpoch`.
 */

/**
 * Ensure the HCGS sidecar schema exists.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function ensureHcgsSidecarSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hcgs_summary_metadata (
      entity_id TEXT PRIMARY KEY,
      source_entity_ids TEXT NOT NULL,
      source_chunk_struct_ids TEXT NOT NULL,
      source_hashes TEXT NOT NULL,
      epoch_written INTEGER NOT NULL DEFAULT 0,
      epoch_retired INTEGER
    ) WITHOUT ROWID
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_hcgs_meta_epoch_written
      ON hcgs_summary_metadata (epoch_written);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_hcgs_meta_epoch_retired
      ON hcgs_summary_metadata (epoch_retired)
      WHERE epoch_retired IS NOT NULL;
  `);
}

/**
 * Record / refresh a summary's source-dependency snapshot.
 *
 * Plan § 7.7 step 1. Caller commits within the per-file transaction so the
 * sidecar can't be in disagreement with the entity row.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} entityId
 * @param {{sourceEntityIds:string[], sourceChunkStructIds:string[], sourceHashes:object, epoch:number}} payload
 */
export function recordSummary(db, entityId, payload) {
  db.prepare(`
    INSERT INTO hcgs_summary_metadata (
      entity_id, source_entity_ids, source_chunk_struct_ids, source_hashes,
      epoch_written, epoch_retired
    ) VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(entity_id) DO UPDATE SET
      source_entity_ids = excluded.source_entity_ids,
      source_chunk_struct_ids = excluded.source_chunk_struct_ids,
      source_hashes = excluded.source_hashes,
      epoch_written = excluded.epoch_written,
      epoch_retired = NULL
  `).run(
    entityId,
    JSON.stringify(payload.sourceEntityIds ?? []),
    JSON.stringify(payload.sourceChunkStructIds ?? []),
    JSON.stringify(payload.sourceHashes ?? {}),
    Number(payload.epoch),
  );
}

/**
 * Retire summaries whose source entities or chunks changed in this tick.
 *
 * Caller passes `{ retiredEntityIds, retiredChunkStructIds }` collected
 * from the graph + vector deltas. Plan § 7.7 step 2 fires the
 * retirement in the same manifest epoch.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{retiredEntityIds:Set<string>|Array<string>, retiredChunkStructIds:Set<string>|Array<string>}} sources
 * @param {number} epoch
 * @returns {number}  How many summaries were retired.
 */
export function retireDependentSummaries(db, sources, epoch) {
  const entityIds = Array.from(sources.retiredEntityIds ?? []);
  const chunkIds = Array.from(sources.retiredChunkStructIds ?? []);
  if (entityIds.length === 0 && chunkIds.length === 0) return 0;

  const rows = db.prepare(`
    SELECT entity_id, source_entity_ids, source_chunk_struct_ids
    FROM hcgs_summary_metadata
    WHERE epoch_retired IS NULL
  `).all();
  const entitySet = new Set(entityIds);
  const chunkSet = new Set(chunkIds);
  const stmt = db.prepare(`
    UPDATE hcgs_summary_metadata
       SET epoch_retired = ?
     WHERE entity_id = ? AND epoch_retired IS NULL
  `);
  let count = 0;
  for (const row of rows) {
    const srcEnts = JSON.parse(row.source_entity_ids || '[]');
    const srcChunks = JSON.parse(row.source_chunk_struct_ids || '[]');
    let hit = false;
    for (const e of srcEnts) if (entitySet.has(e)) { hit = true; break; }
    if (!hit) {
      for (const c of srcChunks) if (chunkSet.has(c)) { hit = true; break; }
    }
    if (hit) {
      stmt.run(epoch, row.entity_id);
      count += 1;
    }
  }
  return count;
}

/**
 * SQL fragment that filters HCGS summary metadata rows visible at a given
 * manifest epoch. Plan § 7.7 step 3 — readers MUST add this predicate to
 * any join against the sidecar before returning a summary.
 *
 * Returns `epoch_written <= :manifestEpoch
 *           AND (epoch_retired IS NULL OR epoch_retired > :manifestEpoch)`.
 *
 * @param {string} [alias]
 * @returns {string}
 */
export function summaryVisibilityPredicate(alias = '') {
  const normalizedAlias = String(alias || '').endsWith('.') ? String(alias).slice(0, -1) : String(alias || '');
  const a = normalizedAlias.length > 0 ? `${normalizedAlias}.` : '';
  return (
    `${a}epoch_written <= :manifestEpoch ` +
    `AND (${a}epoch_retired IS NULL OR ${a}epoch_retired > :manifestEpoch)`
  );
}

/**
 * Drop retired rows older than the prune frontier. Plan § 8.1.1 step 4.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} pruneFrontier
 * @returns {number}
 */
export function pruneRetiredSummaries(db, pruneFrontier) {
  if (!Number.isInteger(pruneFrontier)) {
    throw new Error('pruneRetiredSummaries: pruneFrontier must be an integer');
  }
  const res = db.prepare(`
    DELETE FROM hcgs_summary_metadata
     WHERE epoch_retired IS NOT NULL
       AND epoch_retired <= ?
  `).run(pruneFrontier);
  return res.changes ?? 0;
}
