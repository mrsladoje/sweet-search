/**
 * Summary Manager - HCGS Summary Backup/Restore
 *
 * Handles automatic preservation of HCGS summaries across incremental rebuilds.
 * Core module for Phase 1 of the INDEXING_PLAN.md implementation.
 *
 * Key features:
 * - Always-on backup (no flag needed)
 * - Collision-proof restore (file_path + type + name + signature_hash)
 * - Graceful fallback for legacy summaries without signature_hash
 * - Atomic operations with transaction support
 *
 * Restore Strategy (cascading match):
 * 1. Try stable ID match first (fastest, most reliable for unchanged signatures)
 * 2. Fall back to (file_path, type, name, signature_hash) for renamed IDs
 * 3. Fall back to (file_path, type, name) for legacy data without signature_hash
 *    but ONLY if there's exactly one match (no duplicates)
 *
 * @module summary-manager
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { DB_PATHS } from '../infrastructure/config/index.js';

// =============================================================================
// CRASH-SAFE DISK PERSISTENCE
// =============================================================================
//
// The in-memory backup model has a fatal gap: if the process is killed
// between `backupSummaries` and `restoreSummaries` (e.g., mid-`buildCodeGraph`
// which atomically swaps the code-graph DB), the in-memory copy is lost AND
// the old DB with summaries has already been unlinked on atomic-swap success.
// The next run's backup then reads an empty DB and has nothing to restore.
// The summaries are permanently gone.
//
// Fix: persist the backup to `{dbPath}.summaries.bak.json` before the
// destructive phase runs, and only delete the disk backup after a successful
// restore. On next `backupSummaries` call, detect any orphaned disk backup
// and prefer it when the live DB has no summaries (crash recovery).
//
// Storage format: JSON with `summary_embedding` blobs base64-encoded since
// JSON has no native Buffer type.

function diskBackupPath(dbPath) {
  return dbPath + '.summaries.bak.json';
}

function serializeSummaries(summaries) {
  return summaries.map(row => ({
    ...row,
    summary_embedding: row.summary_embedding != null
      ? { __b64: Buffer.from(row.summary_embedding).toString('base64') }
      : null,
  }));
}

function deserializeSummaries(serialized) {
  return serialized.map(row => ({
    ...row,
    summary_embedding: row.summary_embedding && row.summary_embedding.__b64 != null
      ? Buffer.from(row.summary_embedding.__b64, 'base64')
      : row.summary_embedding,
  }));
}

async function writeDiskBackup(dbPath, backup) {
  const bakPath = diskBackupPath(dbPath);
  const tmpPath = bakPath + '.tmp';
  const payload = {
    version: 1,
    dbPath,
    count: backup.count,
    timestamp: backup.timestamp ?? Date.now(),
    summaries: serializeSummaries(backup.summaries),
  };
  await fs.mkdir(path.dirname(bakPath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(payload));
  await fs.rename(tmpPath, bakPath);
}

async function readDiskBackup(dbPath) {
  const bakPath = diskBackupPath(dbPath);
  if (!existsSync(bakPath)) return null;
  try {
    const raw = await fs.readFile(bakPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.summaries)) return null;
    // Version gate: reject unknown formats rather than silently deserializing
    // against the wrong schema. The writer always sets version: 1; a future v2
    // format must change this check before shipping.
    if (parsed.version != null && parsed.version !== 1) {
      console.warn(`[summary-manager] Ignoring disk backup at ${bakPath}: unsupported version ${parsed.version}`);
      return null;
    }
    return {
      summaries: deserializeSummaries(parsed.summaries),
      count: parsed.count ?? parsed.summaries.length,
      timestamp: parsed.timestamp,
      fromDisk: true,
    };
  } catch (err) {
    // ENOENT between existsSync and readFile is a race, not a corruption;
    // silently return null. Only noise-warn on real parse/IO errors.
    if (err && err.code === 'ENOENT') return null;
    console.warn(`[summary-manager] Warning: Corrupt disk backup at ${bakPath}: ${err.message}`);
    return null;
  }
}

async function unlinkDiskBackup(dbPath) {
  const bakPath = diskBackupPath(dbPath);
  try {
    await fs.unlink(bakPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[summary-manager] Warning: Failed to remove disk backup: ${err.message}`);
    }
  }
}

/**
 * Backup summaries from existing database.
 * Returns all entities with non-null summaries for later restoration.
 *
 * Includes id and signature_hash for collision-proof restore of overloaded methods.
 *
 * @param {string} [dbPath] - Path to the database (defaults to DB_PATHS.codeGraph)
 * @returns {Promise<{summaries: Array, count: number, error?: string}>}
 */
export async function backupSummaries(dbPath = DB_PATHS.codeGraph) {
  // `timestamp` on the returned backup is ALWAYS the time of this call, even
  // when the result is populated from crash-recovery disk orphan data — the
  // field reflects "when did we decide to use this backup", not "when was
  // the original backup written". That preserves the invariant callers rely
  // on: `backup.timestamp` is freshly current on every call.
  const callTimestamp = Date.now();

  // Crash recovery: an orphaned disk backup from a previous run takes
  // precedence when the live DB is missing OR has no summaries of its own.
  // Without this, a process kill between backup and restore would leave the
  // live DB empty and the in-memory copy gone — summaries permanently lost.
  const orphan = await readDiskBackup(dbPath);

  if (!existsSync(dbPath)) {
    if (orphan && orphan.count > 0) {
      console.warn(`[summary-manager] Disk backup recovery: restoring ${orphan.count} summaries from orphaned backup (live DB missing)`);
      return { ...orphan, timestamp: callTimestamp };
    }
    return { summaries: [], count: 0, timestamp: callTimestamp };
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const { applyReadPragmas } = await import('../infrastructure/db-utils.js');
    const db = new Database(dbPath, { readonly: true });
    applyReadPragmas(db);

    // Query all entities with summaries, including id and signature_hash for collision-proof restore
    const summaries = db.prepare(`
      SELECT id, name, file_path, type, signature, signature_hash, summary, summary_embedding
      FROM entities
      WHERE summary IS NOT NULL
    `).all();

    db.close();

    // Crash recovery: if the live DB has zero summaries but the disk backup
    // has a non-empty set, the previous run crashed mid-rebuild before it
    // could restore. Use the disk backup as the authoritative source.
    if (summaries.length === 0 && orphan && orphan.count > 0) {
      console.warn(`[summary-manager] Disk backup recovery: restoring ${orphan.count} summaries from orphaned backup (live DB empty)`);
      return { ...orphan, timestamp: callTimestamp };
    }

    const backup = {
      summaries,
      count: summaries.length,
      timestamp: callTimestamp,
    };

    // Persist to disk BEFORE the caller runs any destructive operation.
    // The subsequent `restoreSummaries()` call clears this file on success.
    if (backup.count > 0) {
      try {
        await writeDiskBackup(dbPath, backup);
      } catch (err) {
        console.warn(`[summary-manager] Warning: Could not persist disk backup: ${err.message}`);
        // Non-fatal: the in-memory backup still works for the happy path.
      }
    } else if (orphan) {
      // No summaries to back up and no disk orphan we want — clean up.
      await unlinkDiskBackup(dbPath);
    }

    return backup;
  } catch (err) {
    console.warn(`[summary-manager] Warning: Could not backup summaries: ${err.message}`);
    return {
      summaries: [],
      count: 0,
      timestamp: callTimestamp,
      error: err.message,
    };
  }
}

/**
 * Restore summaries to new database with collision-proof matching.
 *
 * Uses cascading match strategy for maximum compatibility:
 * 1. Try stable ID match first (fastest, handles most cases)
 * 2. Fall back to (file_path, type, name, signature_hash) for overloaded methods
 * 3. Fall back to (file_path, type, name) only if exactly one match (legacy data)
 *
 * @param {string} [dbPath] - Path to the database (defaults to DB_PATHS.codeGraph)
 * @param {Object} backup - Backup object from backupSummaries()
 * @param {Array} backup.summaries - Array of summary records with id, signature_hash
 * @returns {Promise<{restored: number, skipped: {total: number, idMatch: number, sigHashMatch: number, legacyMatch: number, ambiguous: number, notFound: number}}>}
 */
export async function restoreSummaries(dbPath = DB_PATHS.codeGraph, backup) {
  if (!backup?.summaries || backup.summaries.length === 0) {
    return {
      restored: 0,
      skipped: { total: 0, idMatch: 0, sigHashMatch: 0, legacyMatch: 0, ambiguous: 0, notFound: 0 },
    };
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  // Prepared statements for cascading match strategy
  // Strategy 1: Match by stable ID (most reliable if signature unchanged)
  const updateByIdStmt = db.prepare(`
    UPDATE entities
    SET summary = ?, summary_embedding = ?
    WHERE id = ?
  `);

  // Strategy 2: Match by (file_path, type, name, signature_hash) for overloaded methods
  const updateBySigHashStmt = db.prepare(`
    UPDATE entities
    SET summary = ?, summary_embedding = ?
    WHERE file_path = ? AND type = ? AND name = ? AND signature_hash = ?
  `);

  // Strategy 3: Legacy fallback (file_path, type, name) - only if unique
  const countByNameStmt = db.prepare(`
    SELECT COUNT(*) as cnt FROM entities
    WHERE file_path = ? AND type = ? AND name = ?
  `);
  const updateByNameStmt = db.prepare(`
    UPDATE entities
    SET summary = ?, summary_embedding = ?
    WHERE file_path = ? AND type = ? AND name = ?
  `);

  let restored = 0;
  const skipped = { total: 0, idMatch: 0, sigHashMatch: 0, legacyMatch: 0, ambiguous: 0, notFound: 0 };

  // Use transaction for atomic bulk update
  const transaction = db.transaction(() => {
    for (const row of backup.summaries) {
      let matched = false;

      // Strategy 1: Try ID match first
      if (row.id) {
        const result = updateByIdStmt.run(row.summary, row.summary_embedding, row.id);
        if (result.changes > 0) {
          restored++;
          skipped.idMatch++;
          matched = true;
        }
      }

      // Strategy 2: Try signature_hash match for overloaded methods
      if (!matched && row.signature_hash) {
        const result = updateBySigHashStmt.run(
          row.summary,
          row.summary_embedding,
          row.file_path,
          row.type,
          row.name,
          row.signature_hash
        );
        if (result.changes > 0) {
          restored++;
          skipped.sigHashMatch++;
          matched = true;
        }
      }

      // Strategy 3: Legacy fallback - only if exactly one match
      if (!matched) {
        const countResult = countByNameStmt.get(row.file_path, row.type, row.name);
        if (countResult.cnt === 1) {
          // Safe to restore - only one entity with this name
          const result = updateByNameStmt.run(
            row.summary,
            row.summary_embedding,
            row.file_path,
            row.type,
            row.name
          );
          if (result.changes > 0) {
            restored++;
            skipped.legacyMatch++;
            matched = true;
          }
        } else if (countResult.cnt > 1) {
          // Multiple entities with same name - cannot safely restore without signature_hash
          skipped.ambiguous++;
          skipped.total++;
        }
      }

      if (!matched && skipped.ambiguous === 0) {
        skipped.notFound++;
        skipped.total++;
      }
    }
  });

  try {
    transaction();
  } finally {
    db.close();
  }

  // Remove the on-disk backup — the live DB now holds the authoritative copy.
  // Only delete when restore produced real work; a zero-restore result means
  // there's no signal the summaries made it across and we should leave the
  // backup in place so the NEXT run can try again.
  if (restored > 0) {
    await unlinkDiskBackup(dbPath);
  }

  return { restored, skipped };
}

/**
 * Get summary statistics from database.
 *
 * @param {string} [dbPath] - Path to the database
 * @returns {Promise<{total: number, withSummary: number, withoutSummary: number, byType: Object}>}
 */
export async function getSummaryStats(dbPath = DB_PATHS.codeGraph) {
  if (!existsSync(dbPath)) {
    return { total: 0, withSummary: 0, withoutSummary: 0, byType: {} };
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    const { applyReadPragmas } = await import('../infrastructure/db-utils.js');
    const db = new Database(dbPath, { readonly: true });
    applyReadPragmas(db);

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END) as with_summary,
        SUM(CASE WHEN summary IS NULL THEN 1 ELSE 0 END) as without_summary
      FROM entities
    `).get();

    const byType = db.prepare(`
      SELECT type,
        COUNT(*) as total,
        SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END) as with_summary
      FROM entities
      GROUP BY type
      ORDER BY total DESC
    `).all();

    db.close();

    return {
      total: stats.total,
      withSummary: stats.with_summary,
      withoutSummary: stats.without_summary,
      byType: Object.fromEntries(byType.map(r => [r.type, { total: r.total, withSummary: r.with_summary }])),
    };
  } catch (err) {
    console.warn(`[summary-manager] Warning: Could not get stats: ${err.message}`);
    return { total: 0, withSummary: 0, withoutSummary: 0, byType: {}, error: err.message };
  }
}

/**
 * Mark entities for regeneration by setting their summaries to NULL.
 *
 * @param {string} [dbPath] - Path to the database
 * @param {string[]} filePaths - Array of file paths whose entities should be marked
 * @returns {Promise<{marked: number}>}
 */
export async function markForRegeneration(dbPath = DB_PATHS.codeGraph, filePaths) {
  if (!filePaths || filePaths.length === 0) {
    return { marked: 0 };
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  const placeholders = filePaths.map(() => '?').join(',');
  const stmt = db.prepare(`
    UPDATE entities
    SET summary = NULL, summary_embedding = NULL
    WHERE file_path IN (${placeholders})
  `);

  const result = stmt.run(...filePaths);
  db.close();

  return { marked: result.changes };
}

/**
 * Get entities that need summary generation (summary IS NULL).
 *
 * Includes signature_hash for entity identification in subsequent operations.
 *
 * @param {string} [dbPath] - Path to the database
 * @returns {Promise<Array>}
 */
export async function getEntitiesNeedingSummary(dbPath = DB_PATHS.codeGraph) {
  if (!existsSync(dbPath)) {
    return [];
  }

  const Database = (await import('better-sqlite3')).default;
  const { applyReadPragmas } = await import('../infrastructure/db-utils.js');
  const db = new Database(dbPath, { readonly: true });
  applyReadPragmas(db);

  const entities = db.prepare(`
    SELECT id, name, file_path, type, signature, signature_hash, doc_comment, hierarchy_level, code, parent_id
    FROM entities
    WHERE summary IS NULL
    ORDER BY hierarchy_level DESC, type, name
  `).all();

  db.close();
  return entities;
}

/**
 * Store a single summary with optional embedding.
 *
 * @param {string} [dbPath] - Path to the database
 * @param {number} entityId - Entity ID
 * @param {string} summary - Generated summary
 * @param {Buffer|null} [embedding] - Optional summary embedding
 * @returns {Promise<{success: boolean}>}
 */
export async function storeSummary(dbPath = DB_PATHS.codeGraph, entityId, summary, embedding = null) {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  try {
    const stmt = db.prepare(`
      UPDATE entities
      SET summary = ?, summary_embedding = ?
      WHERE id = ?
    `);

    const result = stmt.run(summary, embedding, entityId);
    return { success: result.changes > 0 };
  } finally {
    db.close();
  }
}

/**
 * Store multiple summaries in a batch (transactional).
 *
 * @param {string} [dbPath] - Path to the database
 * @param {Array<{id: number, summary: string, embedding?: Buffer}>} summaries
 * @returns {Promise<{stored: number}>}
 */
export async function storeSummariesBatch(dbPath = DB_PATHS.codeGraph, summaries) {
  if (!summaries || summaries.length === 0) {
    return { stored: 0 };
  }

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  const stmt = db.prepare(`
    UPDATE entities
    SET summary = ?, summary_embedding = ?
    WHERE id = ?
  `);

  let stored = 0;

  const transaction = db.transaction(() => {
    for (const { id, summary, embedding = null } of summaries) {
      const result = stmt.run(summary, embedding, id);
      if (result.changes > 0) stored++;
    }
  });

  try {
    transaction();
  } finally {
    db.close();
  }

  return { stored };
}

/**
 * Get child summaries for an entity (for hierarchical aggregation).
 *
 * @param {string} [dbPath] - Path to the database
 * @param {number} parentId - Parent entity ID
 * @returns {Promise<Array<{name: string, type: string, summary: string}>>}
 */
export async function getChildSummaries(dbPath = DB_PATHS.codeGraph, parentId) {
  const Database = (await import('better-sqlite3')).default;
  const { applyReadPragmas } = await import('../infrastructure/db-utils.js');
  const db = new Database(dbPath, { readonly: true });
  applyReadPragmas(db);

  try {
    const children = db.prepare(`
      SELECT e.name, e.type, e.summary
      FROM entities e
      JOIN relationships r ON e.id = r.target_id
      WHERE r.source_id = ? AND r.type = 'contains' AND e.summary IS NOT NULL
    `).all(parentId);

    return children;
  } finally {
    db.close();
  }
}

export default {
  backupSummaries,
  restoreSummaries,
  getSummaryStats,
  markForRegeneration,
  getEntitiesNeedingSummary,
  storeSummary,
  storeSummariesBatch,
  getChildSummaries,
};
