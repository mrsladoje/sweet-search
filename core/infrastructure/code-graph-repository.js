/**
 * Code Graph Repository — encapsulates read access to code-graph.db.
 *
 * The search domain calls repository methods instead of running raw SQL
 * against the code graph. This keeps persistence in the infrastructure
 * layer per the DDD boundary contract.
 *
 * Uses lazy initialization — the database is only opened on first query.
 */

import Database from 'better-sqlite3';
import { existsSync, statSync } from 'fs';
import { applyReadPragmas } from './db-utils.js';

export class CodeGraphRepository {
  constructor(dbPath) {
    this._dbPath = dbPath;
    this._db = null;
  }

  /** Lazy read-only connection with optimized pragmas. */
  _open() {
    if (!this._db) {
      if (!existsSync(this._dbPath)) return null;
      this._db = new Database(this._dbPath, { readonly: true });
      applyReadPragmas(this._db);
    }
    return this._db;
  }

  /**
   * Find the tightest entity that fully encloses a given line range.
   *
   * Used by the context expander for symbol-complete expansion:
   * given a chunk's file:line range, find the smallest enclosing
   * function/class/method so the result can be expanded to full
   * symbol boundaries.
   *
   * @param {string} filePath - Relative file path (as stored in entities.file_path)
   * @param {number} startLine - 1-indexed start line of the chunk
   * @param {number} endLine - 1-indexed end line of the chunk
   * @returns {{ name: string, type: string, startLine: number, endLine: number, parentClass: string|null }|null}
   */
  findEnclosingEntity(filePath, startLine, endLine) {
    const db = this._open();
    if (!db) return null;
    try {
      const row = db.prepare(`
        SELECT name, type, start_line, end_line, parent_class
        FROM entities
        WHERE file_path = ?
          AND start_line <= ?
          AND end_line >= ?
        ORDER BY (end_line - start_line) ASC
        LIMIT 1
      `).get(filePath, startLine, endLine);
      if (!row) return null;
      return {
        name: row.name,
        type: row.type,
        startLine: row.start_line,
        endLine: row.end_line,
        parentClass: row.parent_class || null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the index timestamp for a file (from stale_since or fallback to mtime).
   *
   * Used by the context expander to populate `stale` and `indexedAt` fields
   * in agent mode results.
   *
   * @param {string} filePath - Relative file path
   * @returns {{ staleSince: number|null, indexedAt: string|null }|null}
   */
  getFileIndexInfo(filePath) {
    const db = this._open();
    if (!db) return null;
    try {
      // Check if any entity for this file is stale
      const row = db.prepare(`
        SELECT stale_since, MIN(ROWID) as first_row
        FROM entities
        WHERE file_path = ?
        LIMIT 1
      `).get(filePath);
      if (!row) return null;
      return {
        staleSince: row.stale_since || null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the modification time of the database file.
   * Used as a proxy for "when was the index last built".
   *
   * @returns {Date|null}
   */
  getDbMtime() {
    try {
      const stat = statSync(this._dbPath, { throwIfNoEntry: false });
      return stat ? stat.mtime : null;
    } catch {
      return null;
    }
  }

  close() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
  }
}
