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
import path from 'path';
import { DB_PATHS } from '../infrastructure/config/index.js';

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
  if (!existsSync(dbPath)) {
    return { summaries: [], count: 0 };
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

    return {
      summaries,
      count: summaries.length,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.warn(`[summary-manager] Warning: Could not backup summaries: ${err.message}`);
    return {
      summaries: [],
      count: 0,
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
