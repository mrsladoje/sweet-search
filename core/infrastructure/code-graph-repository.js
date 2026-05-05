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
   * @returns {{ id: string, name: string, type: string, startLine: number, endLine: number, parentClass: string|null }|null}
   */
  findEnclosingEntity(filePath, startLine, endLine) {
    const db = this._open();
    if (!db) return null;
    try {
      const row = db.prepare(`
        SELECT id, name, type, start_line, end_line, parent_class
        FROM entities
        WHERE file_path = ?
          AND start_line <= ?
          AND end_line >= ?
          AND (stale_since IS NULL)
        ORDER BY (end_line - start_line) ASC
        LIMIT 1
      `).get(filePath, startLine, endLine);
      if (!row) return null;
      return {
        id: row.id,
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
   * Find the first indexed entity fully contained in a chunk range.
   * Useful when a chunk starts at file line 1 but includes the declaration
   * shortly after imports/comments, so strict enclosing lookup cannot match.
   *
   * @param {string} filePath
   * @param {number} startLine
   * @param {number} endLine
   * @returns {{ id: string, name: string, type: string, startLine: number, endLine: number, parentClass: string|null }|null}
   */
  findFirstEntityInRange(filePath, startLine, endLine) {
    const db = this._open();
    if (!db) return null;
    try {
      const row = db.prepare(`
        SELECT id, name, type, start_line, end_line, parent_class
        FROM entities
        WHERE file_path = ?
          AND start_line >= ?
          AND start_line <= ?
          AND (stale_since IS NULL)
        ORDER BY start_line ASC, (end_line - start_line) ASC
        LIMIT 1
      `).get(filePath, startLine, endLine);
      if (!row) return null;
      return {
        id: row.id,
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
   * Get a single entity by id, with file:line metadata.
   *
   * @param {string} entityId
   * @returns {{ id, name, type, filePath, startLine, endLine, parentClass }|null}
   */
  getEntityById(entityId) {
    const db = this._open();
    if (!db) return null;
    try {
      const row = db.prepare(`
        SELECT id, name, type, file_path, start_line, end_line, parent_class
        FROM entities
        WHERE id = ? AND (stale_since IS NULL)
      `).get(entityId);
      if (!row) return null;
      return {
        id: row.id, name: row.name, type: row.type,
        filePath: row.file_path,
        startLine: row.start_line, endLine: row.end_line,
        parentClass: row.parent_class || null,
      };
    } catch {
      return null;
    }
  }

  /**
   * One-hop outgoing relationships from a given source entity.
   *
   * Returns up to `limit` (target_name, type, context_line, full_import_path)
   * tuples joined to the target entity's metadata when target_id is resolved.
   * Used by the agent context packager to render a "neighbours" tier.
   *
   * The relationship `type` field comes from graph-extractor and is one of:
   *   imports | calls | extends | implements | overrides | throws | uses
   *
   * @param {string} sourceId
   * @param {object} [opts]
   * @param {string[]} [opts.types] - filter to these types (default: all)
   * @param {number} [opts.limit=8]
   * @returns {Array<{ type, targetName, targetId: string|null, contextLine: number|null,
   *                   fullImportPath: string|null, target: { id, name, type, filePath, startLine, endLine }|null }>}
   */
  getOutgoingRelationships(sourceId, opts = {}) {
    const db = this._open();
    if (!db || !sourceId) return [];
    const limit = Math.max(1, Math.min(50, opts.limit ?? 8));
    const types = (opts.types && opts.types.length) ? opts.types : null;
    try {
      const baseSql = `
        SELECT r.target_id, r.target_name, r.type as rel_type, r.context_line,
               r.full_import_path,
               e.id as e_id, e.name as e_name, e.type as e_type,
               e.file_path as e_file, e.start_line as e_start, e.end_line as e_end
        FROM relationships r
        LEFT JOIN entities e ON e.id = r.target_id AND (e.stale_since IS NULL)
        WHERE r.source_id = ?
        ${types ? `AND r.type IN (${types.map(() => '?').join(',')})` : ''}
        ORDER BY (CASE WHEN r.target_id IS NULL THEN 1 ELSE 0 END), r.weight DESC
        LIMIT ?
      `;
      const args = types ? [sourceId, ...types, limit] : [sourceId, limit];
      const rows = db.prepare(baseSql).all(...args);
      return rows.map(r => ({
        type: r.rel_type,
        targetName: r.target_name,
        targetId: r.target_id || null,
        contextLine: r.context_line || null,
        fullImportPath: r.full_import_path || null,
        target: r.e_id ? {
          id: r.e_id, name: r.e_name, type: r.e_type,
          filePath: r.e_file, startLine: r.e_start, endLine: r.e_end,
        } : null,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Look up entities by name (case-sensitive), filtered to a set of types.
   *
   * Used by the agent context packager to surface TYPE definitions
   * (struct/enum/interface/class/trait/type) referenced from the top-1's
   * body — the relationships table only captures explicit edges (calls,
   * imports), so a method that uses a struct via a field's type
   * declaration leaves no edge. This name-based lookup recovers them.
   *
   * Returns at most one entity per (name, type) pair, preferring
   * non-stale entries with the smallest body (most likely the canonical
   * definition rather than a re-export).
   *
   * @param {string[]} names - candidate identifier names (Capitalized, etc.)
   * @param {object} [opts]
   * @param {string[]} [opts.types] - filter to entity types
   *   (default: ['struct','class','interface','enum','trait','type'])
   * @param {number} [opts.limit=8] - cap total returned entities
   * @param {string} [opts.excludeFile] - skip entities defined in this file
   *   (caller's own file, since same-file ranks already cover that)
   * @returns {Array<{ id, name, type, filePath, startLine, endLine }>}
   */
  findEntitiesByNames(names, opts = {}) {
    const db = this._open();
    if (!db || !Array.isArray(names) || names.length === 0) return [];
    const uniq = [...new Set(names.filter(n => typeof n === 'string' && n.length >= 2))];
    if (!uniq.length) return [];
    const types = (opts.types && opts.types.length)
      ? opts.types
      : ['struct', 'class', 'interface', 'enum', 'trait', 'type', 'typeAlias'];
    const limit = Math.max(1, Math.min(32, opts.limit ?? 8));
    const excludeFile = typeof opts.excludeFile === 'string' ? opts.excludeFile : null;
    try {
      // One row per (name, type), picking the smallest body when name collides
      // (canonical definition rather than re-export). chunk-style entities are
      // intentionally excluded to avoid false hits on test scaffolding.
      const sql = `
        SELECT id, name, type, file_path, start_line, end_line
        FROM entities
        WHERE name IN (${uniq.map(() => '?').join(',')})
          AND type IN (${types.map(() => '?').join(',')})
          AND (stale_since IS NULL)
          ${excludeFile ? 'AND file_path != ?' : ''}
        ORDER BY (end_line - start_line) ASC
        LIMIT ?
      `;
      const args = excludeFile
        ? [...uniq, ...types, excludeFile, limit]
        : [...uniq, ...types, limit];
      const rows = db.prepare(sql).all(...args);
      // De-dup by name+type, keeping the first (smallest body).
      const seen = new Set();
      const out = [];
      for (const r of rows) {
        const k = `${r.name}|${r.type}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({
          id: r.id, name: r.name, type: r.type,
          filePath: r.file_path, startLine: r.start_line, endLine: r.end_line,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * Case-insensitive variant for query-derived name hints. Used only for
   * ranking tiebreakers where user prose may lowercase an entity name.
   *
   * @param {string[]} names
   * @param {object} [opts]
   * @returns {Array<{ id, name, type, filePath, startLine, endLine }>}
   */
  findEntitiesByNamesCaseInsensitive(names, opts = {}) {
    const db = this._open();
    if (!db || !Array.isArray(names) || names.length === 0) return [];
    const uniq = [...new Set(names
      .filter(n => typeof n === 'string' && n.length >= 2)
      .map(n => n.toLowerCase()))];
    if (!uniq.length) return [];
    const types = (opts.types && opts.types.length)
      ? opts.types
      : ['struct', 'class', 'interface', 'enum', 'trait', 'type', 'typeAlias'];
    const limit = Math.max(1, Math.min(32, opts.limit ?? 8));
    try {
      const sql = `
        SELECT id, name, type, file_path, start_line, end_line
        FROM entities
        WHERE lower(name) IN (${uniq.map(() => '?').join(',')})
          AND type IN (${types.map(() => '?').join(',')})
          AND (stale_since IS NULL)
        ORDER BY (end_line - start_line) ASC
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(...uniq, ...types, limit);
      return rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Look up entities by name (case-insensitive) across ALL entity kinds —
   * functions, methods, type aliases, structs, classes, etc. Used by the
   * Identifier-Anchored Retrieval (IAR) layer in search-anchor.js, which
   * extracts identifier-shaped tokens from natural-language queries and
   * needs to find matching entities regardless of their declared kind.
   *
   * Distinct from `findEntitiesByNamesCaseInsensitive` (which filters to
   * type-shaped kinds for the entity-kind ranking preference).
   *
   * Returns a small set per name, preferring the smallest body (canonical
   * definition over re-exports). Excludes obviously-non-symbol kinds
   * ('chunk', 'message', 'topKey', 'target', 'variable') so we don't
   * surface generic constants on hits like "config".
   *
   * @param {string[]} names
   * @param {object} [opts]
   * @param {number} [opts.limit=16]
   * @param {string[]} [opts.excludeKinds]
   * @returns {Array<{ id, name, type, filePath, startLine, endLine }>}
   */
  findEntitiesByAnyName(names, opts = {}) {
    const db = this._open();
    if (!db || !Array.isArray(names) || names.length === 0) return [];
    const uniq = [...new Set(names
      .filter(n => typeof n === 'string' && n.length >= 2)
      .map(n => n.toLowerCase()))];
    if (!uniq.length) return [];
    const exclude = Array.isArray(opts.excludeKinds) && opts.excludeKinds.length
      ? opts.excludeKinds
      : ['chunk', 'message', 'topKey', 'target', 'variable', 'const'];
    const limit = Math.max(1, Math.min(64, opts.limit ?? 16));
    try {
      const sql = `
        SELECT id, name, type, file_path, start_line, end_line
        FROM entities
        WHERE lower(name) IN (${uniq.map(() => '?').join(',')})
          AND type NOT IN (${exclude.map(() => '?').join(',')})
          AND (stale_since IS NULL)
        ORDER BY (end_line - start_line) ASC
        LIMIT ?
      `;
      const rows = db.prepare(sql).all(...uniq, ...exclude, limit);
      return rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
      }));
    } catch {
      return [];
    }
  }

  /**
   * One-hop incoming relationships into a given target entity (its callers,
   * importers, etc.). Joined to the source entity for file:line rendering.
   *
   * @param {string} targetId
   * @param {object} [opts]
   * @param {string[]} [opts.types]
   * @param {number} [opts.limit=8]
   * @returns {Array<{ type, source: { id, name, type, filePath, startLine, endLine }|null, contextLine }>}
   */
  getIncomingRelationships(targetId, opts = {}) {
    const db = this._open();
    if (!db || !targetId) return [];
    const limit = Math.max(1, Math.min(50, opts.limit ?? 8));
    const types = (opts.types && opts.types.length) ? opts.types : null;
    try {
      const baseSql = `
        SELECT r.source_id, r.type as rel_type, r.context_line,
               e.id as e_id, e.name as e_name, e.type as e_type,
               e.file_path as e_file, e.start_line as e_start, e.end_line as e_end
        FROM relationships r
        LEFT JOIN entities e ON e.id = r.source_id AND (e.stale_since IS NULL)
        WHERE r.target_id = ?
        ${types ? `AND r.type IN (${types.map(() => '?').join(',')})` : ''}
        ORDER BY r.weight DESC
        LIMIT ?
      `;
      const args = types ? [targetId, ...types, limit] : [targetId, limit];
      const rows = db.prepare(baseSql).all(...args);
      return rows.map(r => ({
        type: r.rel_type,
        contextLine: r.context_line || null,
        source: r.e_id ? {
          id: r.e_id, name: r.e_name, type: r.e_type,
          filePath: r.e_file, startLine: r.e_start, endLine: r.e_end,
        } : null,
      })).filter(r => r.source);
    } catch {
      return [];
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
