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
import { applyReadPragmas, prepareCached } from './db-utils.js';
import { readAdjacentManifest, resolveManifestCodeGraphPath, sqlAliasPrefix } from './code-graph-visibility.js';

function pathIsUnsafe(value) {
  return value.startsWith('/') || value === '..' || value.startsWith('../') || value.includes('/../');
}

export class CodeGraphRepository {
  constructor(dbPath, options = {}) {
    this._baseDbPath = dbPath;
    this._explicitManifestEpoch = Number.isInteger(options.manifestEpoch);
    this._manifestEpoch = this._explicitManifestEpoch ? options.manifestEpoch : null;
    const manifest = this._explicitManifestEpoch ? readAdjacentManifest(this._baseDbPath) : null;
    this._dbPath = this._explicitManifestEpoch
      ? resolveManifestCodeGraphPath(this._baseDbPath, manifest)
      : dbPath;
    this._db = null;
    this._hasEntityEpochVisibility = null;
    this._hasRelationshipEpochVisibility = null;
    if (!this._explicitManifestEpoch) {
      this._syncAdjacentManifest();
    }
  }

  _syncAdjacentManifest() {
    if (this._explicitManifestEpoch) return false;
    const manifest = readAdjacentManifest(this._baseDbPath);
    const nextEpoch = Number.isInteger(manifest?.epoch) ? manifest.epoch : null;
    const nextDbPath = resolveManifestCodeGraphPath(this._baseDbPath, manifest);
    const changed = nextEpoch !== this._manifestEpoch || nextDbPath !== this._dbPath;
    this._manifestEpoch = nextEpoch;
    this._dbPath = nextDbPath;
    if (changed) {
      this.close();
    }
    return changed;
  }

  refreshManifestEpoch() {
    this._syncAdjacentManifest();
    return this._manifestEpoch;
  }

  getManifestEpoch() {
    return this._manifestEpoch;
  }

  _resetDerivedCaches() {
    this._refCountExact = null;
    this._refSuffixSafe = null;
    this._refBareRelationshipFanout = null;
    this._refCountIndex = null;
  }

  /** Lazy read-only connection with optimized pragmas. */
  _open() {
    this._syncAdjacentManifest();
    if (!this._db) {
      if (!existsSync(this._dbPath)) return null;
      this._db = new Database(this._dbPath, { readonly: true });
      applyReadPragmas(this._db);
    }
    return this._db;
  }

  _hasColumns(db, table, columns) {
    const rows = prepareCached(db, `PRAGMA table_info(${table})`).all();
    const names = new Set(rows.map((row) => row.name));
    return columns.every((column) => names.has(column));
  }

  _ensureVisibilityInfo(db) {
    if (this._hasEntityEpochVisibility === null) {
      this._hasEntityEpochVisibility = this._hasColumns(db, 'entities', ['epoch_written', 'epoch_retired']);
    }
    if (this._hasRelationshipEpochVisibility === null) {
      this._hasRelationshipEpochVisibility = this._hasColumns(db, 'relationships', ['epoch_written', 'epoch_retired']);
    }
  }

  _entityVisibilitySql(db, alias = '') {
    this._ensureVisibilityInfo(db);
    const prefix = sqlAliasPrefix(alias);
    if (!this._hasEntityEpochVisibility) return `${prefix}stale_since IS NULL`;
    if (this._manifestEpoch !== null) {
      return `(${prefix}epoch_written IS NULL OR ${prefix}epoch_written <= ?)
        AND (${prefix}epoch_retired IS NULL OR ${prefix}epoch_retired > ?)
        AND (${prefix}stale_since IS NULL OR (${prefix}epoch_retired IS NOT NULL AND ${prefix}epoch_retired > ?))`;
    }
    return `${prefix}stale_since IS NULL AND ${prefix}epoch_retired IS NULL`;
  }

  _entityVisibilityParams(db) {
    this._ensureVisibilityInfo(db);
    if (!this._hasEntityEpochVisibility || this._manifestEpoch === null) return [];
    return [this._manifestEpoch, this._manifestEpoch, this._manifestEpoch];
  }

  _relationshipVisibilitySql(db, alias = 'r') {
    this._ensureVisibilityInfo(db);
    if (!this._hasRelationshipEpochVisibility) return '1=1';
    const prefix = sqlAliasPrefix(alias);
    if (this._manifestEpoch !== null) {
      return `(${prefix}epoch_written IS NULL OR ${prefix}epoch_written <= ?)
        AND (${prefix}epoch_retired IS NULL OR ${prefix}epoch_retired > ?)`;
    }
    return `${prefix}epoch_retired IS NULL`;
  }

  _relationshipVisibilityParams(db) {
    this._ensureVisibilityInfo(db);
    if (!this._hasRelationshipEpochVisibility || this._manifestEpoch === null) return [];
    return [this._manifestEpoch, this._manifestEpoch];
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
      const row = prepareCached(db, `
        SELECT id, name, type, start_line, end_line, parent_class
        FROM entities
        WHERE file_path = ?
          AND start_line <= ?
          AND end_line >= ?
          AND ${this._entityVisibilitySql(db)}
        ORDER BY (end_line - start_line) ASC
        LIMIT 1
      `).get(filePath, startLine, endLine, ...this._entityVisibilityParams(db));
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
  /**
   * Check whether a chunk range contains an entity whose name matches the target
   * (case-insensitive, also tries snake_case ↔ camelCase normalization).
   * Used by symbol-exact-match boost when chunk's labeled symbol doesn't match
   * but a sibling/contained entity does.
   *
   * @param {string} filePath
   * @param {number} startLine
   * @param {number} endLine
   * @param {string} targetName
   * @returns {boolean}
   */
  /**
   * Find the matching entity by name within a chunk range, if it exists.
   * Returns the actual canonical name + type (so callers can relabel chunks
   * to the contained-entity name when the query target matches).
   *
   * @param {string} filePath
   * @param {number} startLine
   * @param {number} endLine
   * @param {string} targetName
   * @returns {{ name: string, type: string, startLine: number, endLine: number }|null}
   */
  findEntityWithNameInRange(filePath, startLine, endLine, targetName) {
    if (!targetName) return null;
    const db = this._open();
    if (!db) return null;
    try {
      const tLower = String(targetName).toLowerCase();
      const tNorm = tLower.replace(/[_-]/g, '');
      // Two-pass query: prefer entities FULLY CONTAINED in chunk range (most
      // confident match); if none, fall back to entities whose START line is
      // in the chunk range (catches entities like a multi-chunk struct whose
      // declaration starts in this chunk but body extends beyond — e.g. gin
      // Engine struct at gin.go:92-189 split across chunks 92-133 and 134-189).
      const containedRows = prepareCached(db, `
        SELECT name, type, start_line, end_line FROM entities
        WHERE file_path = ? AND start_line >= ? AND end_line <= ? AND ${this._entityVisibilitySql(db)}
        ORDER BY (end_line - start_line) DESC
      `).all(filePath, startLine, endLine, ...this._entityVisibilityParams(db));
      for (const row of containedRows) {
        if (!row.name) continue;
        const nLower = String(row.name).toLowerCase();
        if (nLower === tLower || nLower.replace(/[_-]/g, '') === tNorm) {
          return { name: row.name, type: row.type, startLine: row.start_line, endLine: row.end_line };
        }
      }
      const startsInRows = prepareCached(db, `
        SELECT name, type, start_line, end_line FROM entities
        WHERE file_path = ? AND start_line >= ? AND start_line <= ? AND ${this._entityVisibilitySql(db)}
        ORDER BY (end_line - start_line) DESC
      `).all(filePath, startLine, endLine, ...this._entityVisibilityParams(db));
      for (const row of startsInRows) {
        if (!row.name) continue;
        const nLower = String(row.name).toLowerCase();
        if (nLower === tLower || nLower.replace(/[_-]/g, '') === tNorm) {
          return { name: row.name, type: row.type, startLine: row.start_line, endLine: row.end_line };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  hasEntityWithNameInRange(filePath, startLine, endLine, targetName) {
    return this.findEntityWithNameInRange(filePath, startLine, endLine, targetName) !== null;
  }

  findFirstEntityInRange(filePath, startLine, endLine) {
    const db = this._open();
    if (!db) return null;
    try {
      const row = prepareCached(db, `
        SELECT id, name, type, start_line, end_line, parent_class
        FROM entities
        WHERE file_path = ?
          AND start_line >= ?
          AND start_line <= ?
          AND ${this._entityVisibilitySql(db)}
        ORDER BY start_line ASC, (end_line - start_line) ASC
        LIMIT 1
      `).get(filePath, startLine, endLine, ...this._entityVisibilityParams(db));
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
   * Return ALL entities whose start_line falls in [startLine, endLine]
   * (i.e. every entity declared inside the chunk's range). Used by the
   * F9 additional_symbols re-anchoring rule (file-kind-ranking.js): when a
   * chunk merged ≥2 top-level boundaries, the chunker's stored `symbol` is
   * just the first boundary's name. Re-querying the entities table picks up
   * every declared symbol in the chunk and lets ranking pick the best name
   * match against the user's query.
   *
   * Capped at 64 to bound the per-result scan cost. Ordered by start_line.
   *
   * @param {string} filePath
   * @param {number} startLine
   * @param {number} endLine
   * @returns {Array<{ id, name, type, startLine, endLine, parentClass }>}
   */
  findEntitiesInRange(filePath, startLine, endLine) {
    const db = this._open();
    if (!db) return [];
    try {
      const rows = prepareCached(db, `
        SELECT id, name, type, start_line, end_line, parent_class
        FROM entities
        WHERE file_path = ?
          AND start_line >= ?
          AND start_line <= ?
          AND ${this._entityVisibilitySql(db)}
        ORDER BY start_line ASC
        LIMIT 64
      `).all(filePath, startLine, endLine, ...this._entityVisibilityParams(db));
      return rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        startLine: row.start_line,
        endLine: row.end_line,
        parentClass: row.parent_class || null,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Every visible named entity in one file, in start_line order. Powers the
   * singleton-grep sibling line: a whole-file symbol table (fields included)
   * is what "which same-file declarations share this hit's identifier
   * family" needs. Capped (default 512) to bound the scan on generated files.
   *
   * @param {string} filePath
   * @param {{ limit?: number }} [opts]
   * @returns {Array<{ id, name, type, startLine, endLine, parentClass }>}
   */
  findEntitiesInFile(filePath, opts = {}) {
    const db = this._open();
    if (!db || !filePath) return [];
    const limit = Math.min(Math.max(1, opts.limit | 0 || 512), 2048);
    try {
      const rows = prepareCached(db, `
        SELECT id, name, type, start_line, end_line, parent_class
        FROM entities
        WHERE file_path = ?
          AND name IS NOT NULL AND name != ''
          AND start_line IS NOT NULL AND end_line IS NOT NULL
          AND ${this._entityVisibilitySql(db)}
        ORDER BY start_line ASC, end_line DESC
        LIMIT ?
      `).all(filePath, ...this._entityVisibilityParams(db), limit);
      return rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        startLine: row.start_line,
        endLine: row.end_line,
        parentClass: row.parent_class || null,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Find the named entities immediately ADJACENT to a shown line window in
   * the same file: the nearest ones lying fully ABOVE the window
   * (end_line < startLine) and the nearest ones starting BELOW it
   * (start_line > endLine). Powers the agent-format same-file span map —
   * the pointer that tells an agent which sibling symbols sit just outside
   * the chunk window it was shown.
   *
   * Entities enclosing the window (e.g. the surrounding class) never match
   * either predicate, so results are true siblings. Inner entities contained
   * in an already-kept row (closures inside the adjacent function) are
   * filtered so the map names outermost neighbors only.
   *
   * @param {string} filePath
   * @param {number} startLine - first shown line (1-based)
   * @param {number} endLine - last shown line (1-based)
   * @param {{ perSide?: number }} [opts] - max entities per side (default 2)
   * @returns {{ above: Array<{id,name,type,startLine,endLine,parentClass}>,
   *             below: Array<{id,name,type,startLine,endLine,parentClass}> }}
   */
  findAdjacentEntities(filePath, startLine, endLine, opts = {}) {
    const perSide = opts.perSide ?? 2;
    const empty = { above: [], below: [] };
    if (!filePath || !Number.isFinite(startLine) || !Number.isFinite(endLine)) return empty;
    const db = this._open();
    if (!db) return empty;
    const mapRow = row => ({
      id: row.id,
      name: row.name,
      type: row.type,
      startLine: row.start_line,
      endLine: row.end_line,
      parentClass: row.parent_class || null,
    });
    // Keep outermost neighbors: drop rows contained in an already-kept row.
    const keepOutermost = rows => {
      const kept = [];
      for (const row of rows) {
        if (kept.some(k => row.start_line >= k.start_line && row.end_line <= k.end_line)) continue;
        kept.push(row);
        if (kept.length >= perSide) break;
      }
      return kept.map(mapRow);
    };
    try {
      const aboveRows = prepareCached(db, `
        SELECT id, name, type, start_line, end_line, parent_class
        FROM entities
        WHERE file_path = ?
          AND end_line < ?
          AND name IS NOT NULL AND name != ''
          AND ${this._entityVisibilitySql(db)}
        ORDER BY end_line DESC, start_line ASC
        LIMIT 8
      `).all(filePath, startLine, ...this._entityVisibilityParams(db));
      const belowRows = prepareCached(db, `
        SELECT id, name, type, start_line, end_line, parent_class
        FROM entities
        WHERE file_path = ?
          AND start_line > ?
          AND name IS NOT NULL AND name != ''
          AND ${this._entityVisibilitySql(db)}
        ORDER BY start_line ASC, end_line DESC
        LIMIT 8
      `).all(filePath, endLine, ...this._entityVisibilityParams(db));
      return { above: keepOutermost(aboveRows), below: keepOutermost(belowRows) };
    } catch {
      return empty;
    }
  }

  /**
   * Find exact indexed symbol-family candidates under a bounded directory.
   * The search domain supplies an identifier stem discovered from indexed
   * seeds; this adapter performs only parameterized persistence work.
   *
   * @param {string} stem - alphanumeric identifier fragment (3-64 chars)
   * @param {{ filePrefix:string, types?:string[], limit?:number }} opts
   * @returns {Array<{id,name,type,filePath,startLine,endLine,parentClass}>}
   */
  findFamilyCandidates(stem, opts = {}) {
    const db = this._open();
    if (!db || typeof stem !== 'string' || !/^[A-Za-z][A-Za-z0-9]{2,63}$/.test(stem)) return [];
    const prefix = typeof opts.filePrefix === 'string'
      ? opts.filePrefix.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
      : '';
    if (!prefix || prefix === '.' || pathIsUnsafe(prefix)) return [];
    const types = Array.isArray(opts.types)
      ? [...new Set(opts.types.filter((type) => typeof type === 'string' && /^[A-Za-z][\w-]{0,31}$/.test(type)))].slice(0, 16)
      : [];
    const limit = Math.max(1, Math.min(128, opts.limit ?? 64));
    const escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');
    try {
      const typeSql = types.length > 0 ? `AND type IN (${types.map(() => '?').join(',')})` : '';
      const sql = `
        SELECT id, name, type, file_path, start_line, end_line, parent_class
        FROM entities
        WHERE lower(name) LIKE lower(?) ESCAPE '\\'
          AND file_path LIKE ? ESCAPE '\\'
          ${typeSql}
          AND ${this._entityVisibilitySql(db)}
        ORDER BY name ASC, file_path ASC, start_line ASC
        LIMIT ?
      `;
      const args = [
        `%${escapeLike(stem)}%`,
        `${escapeLike(prefix)}/%`,
        ...types,
        ...this._entityVisibilityParams(db),
        limit,
      ];
      return prepareCached(db, sql).all(...args).map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        parentClass: row.parent_class || null,
      }));
    } catch {
      return [];
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
      const row = prepareCached(db, `
        SELECT id, name, type, file_path, start_line, end_line, parent_class
        FROM entities
        WHERE id = ? AND ${this._entityVisibilitySql(db)}
      `).get(entityId, ...this._entityVisibilityParams(db));
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
        LEFT JOIN entities e ON e.id = r.target_id AND ${this._entityVisibilitySql(db, 'e')}
        WHERE r.source_id = ?
        AND ${this._relationshipVisibilitySql(db, 'r')}
        AND (r.target_id IS NULL OR e.id IS NOT NULL)
        ${types ? `AND r.type IN (${types.map(() => '?').join(',')})` : ''}
        ORDER BY (CASE WHEN r.target_id IS NULL THEN 1 ELSE 0 END), r.weight DESC
        LIMIT ?
      `;
      const args = types
        ? [...this._entityVisibilityParams(db), sourceId, ...this._relationshipVisibilityParams(db), ...types, limit]
        : [...this._entityVisibilityParams(db), sourceId, ...this._relationshipVisibilityParams(db), limit];
      const rows = prepareCached(db, baseSql).all(...args);
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
          AND ${this._entityVisibilitySql(db)}
          ${excludeFile ? 'AND file_path != ?' : ''}
        ORDER BY (end_line - start_line) ASC
        LIMIT ?
      `;
      const args = excludeFile
        ? [...uniq, ...types, ...this._entityVisibilityParams(db), excludeFile, limit]
        : [...uniq, ...types, ...this._entityVisibilityParams(db), limit];
      const rows = prepareCached(db, sql).all(...args);
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
          AND ${this._entityVisibilitySql(db)}
        ORDER BY (end_line - start_line) ASC
        LIMIT ?
      `;
      const rows = prepareCached(db, sql).all(...uniq, ...types, ...this._entityVisibilityParams(db), limit);
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
          AND ${this._entityVisibilitySql(db)}
        ORDER BY (end_line - start_line) ASC
        LIMIT ?
      `;
      const rows = prepareCached(db, sql).all(...uniq, ...exclude, ...this._entityVisibilityParams(db), limit);
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
   * Count how many entities exist for each requested name (case-insensitive),
   * across the same kind-set as `findEntitiesByAnyName`. Used by IAR to gate
   * anchor injection on per-name uniqueness — common identifiers ("get",
   * "set", "default") matching dozens of unrelated entities flood the
   * candidate set; rare ones ("kSchemaController", "FST_ERR_HOOK_TIMEOUT")
   * are safe.
   *
   * Mirrors KPR/SPAR's IDF-gated entity injection: the helpfulness of
   * anchoring is proportional to entity rarity in the target corpus.
   *
   * @param {string[]} names
   * @param {object} [opts]
   * @param {string[]} [opts.excludeKinds]
   * @returns {Map<string, number>} lowercase-name → entity count
   */
  countEntitiesByAnyName(names, opts = {}) {
    const db = this._open();
    if (!db || !Array.isArray(names) || names.length === 0) return new Map();
    const uniq = [...new Set(names
      .filter(n => typeof n === 'string' && n.length >= 2)
      .map(n => n.toLowerCase()))];
    if (!uniq.length) return new Map();
    const exclude = Array.isArray(opts.excludeKinds) && opts.excludeKinds.length
      ? opts.excludeKinds
      : ['chunk', 'message', 'topKey', 'target', 'variable', 'const'];
    try {
      const sql = `
        SELECT lower(name) as lname, COUNT(*) as count
        FROM entities
        WHERE lower(name) IN (${uniq.map(() => '?').join(',')})
          AND type NOT IN (${exclude.map(() => '?').join(',')})
          AND ${this._entityVisibilitySql(db)}
        GROUP BY lname
      `;
      const rows = prepareCached(db, sql).all(...uniq, ...exclude, ...this._entityVisibilityParams(db));
      const map = new Map();
      for (const r of rows) map.set(r.lname, r.count);
      // Names with no row are absent — caller treats absent as 0.
      return map;
    } catch {
      return new Map();
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
        LEFT JOIN entities e ON e.id = r.source_id AND ${this._entityVisibilitySql(db, 'e')}
        WHERE r.target_id = ?
        AND ${this._relationshipVisibilitySql(db, 'r')}
        AND e.id IS NOT NULL
        ${types ? `AND r.type IN (${types.map(() => '?').join(',')})` : ''}
        ORDER BY r.weight DESC
        LIMIT ?
      `;
      const args = types
        ? [...this._entityVisibilityParams(db), targetId, ...this._relationshipVisibilityParams(db), ...types, limit]
        : [...this._entityVisibilityParams(db), targetId, ...this._relationshipVisibilityParams(db), limit];
      const rows = prepareCached(db, baseSql).all(...args);
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
   * Build in-memory ref-count indexes for incoming `calls` edges.
   *
   * Two maps:
   *   - `_refCountExact`: `target_name` → count (one GROUP BY row each)
   *   - `_refSuffixSafe`: bare suffix → Σ counts, only for bare names whose
   *     relationship fanout (distinct qualified targets sharing that suffix)
   *     is ≤ SWEET_SEARCH_REF_SUFFIX_AGG_FANOUT_MAX (default 12; tighten via env).
   *
   * Previously we always merged every `*.decorate` into bare `decorate`, which
   * is correct for real repos (few homonyms) but poisons GenCodeSearchNet-style
   * corpora (dozens of unrelated `get` functions sharing one inflated total).
   *
   * Lookup rule (see countIncomingCallsByNames):
   *   - Qualified names (contain `.`) → exact map only
   *   - Bare names → suffix safe aggregate when present, else exact fallback
   */
  prebuildRefCountIndex() {
    if (this._refCountExact) return this._refCountExact;
    const exact = new Map();
    const bareFanout = new Map();
    const db = this._open();
    if (!db) {
      this._refCountExact = exact;
      this._refSuffixSafe = new Map();
      this._refBareRelationshipFanout = bareFanout;
      this._refCountIndex = exact;
      return exact;
    }
    const maxFan = (() => {
      const raw = process.env.SWEET_SEARCH_REF_SUFFIX_AGG_FANOUT_MAX;
      const n = parseInt(raw != null && raw !== '' ? raw : '12', 10);
      return Number.isFinite(n) && n > 0 ? n : 12;
    })();
    try {
      const rows = prepareCached(db, `
        SELECT r.target_name, COUNT(*) as cnt
        FROM relationships r
        LEFT JOIN entities e ON e.id = r.target_id AND ${this._entityVisibilitySql(db, 'e')}
        WHERE r.type = 'calls' AND r.target_name IS NOT NULL AND r.target_name != ''
          AND ${this._relationshipVisibilitySql(db, 'r')}
          AND (r.target_id IS NULL OR e.id IS NOT NULL)
        GROUP BY target_name
      `).all(...this._entityVisibilityParams(db), ...this._relationshipVisibilityParams(db));

      for (const row of rows) {
        const tn = row.target_name;
        const cnt = row.cnt;
        exact.set(tn, (exact.get(tn) || 0) + cnt);
        const dot = tn.lastIndexOf('.');
        const bareKey = dot > 0 ? tn.slice(dot + 1) : tn;
        bareFanout.set(bareKey, (bareFanout.get(bareKey) || 0) + 1);
      }

      const suffix = new Map();
      for (const row of rows) {
        const tn = row.target_name;
        const cnt = row.cnt;
        const dot = tn.lastIndexOf('.');
        const bareKey = dot > 0 ? tn.slice(dot + 1) : tn;
        if ((bareFanout.get(bareKey) || 0) <= maxFan) {
          suffix.set(bareKey, (suffix.get(bareKey) || 0) + cnt);
        }
      }

      this._refSuffixSafe = suffix;
    } catch {
      this._refSuffixSafe = new Map();
    }
    this._refCountExact = exact;
    this._refBareRelationshipFanout = bareFanout;
    // Legacy field: kept for any code that peeked at the exact map
    this._refCountIndex = exact;
    return exact;
  }

  /**
   * @param {string} bareName
   * @returns {number}
   */
  relationshipBareFanout(bareName) {
    if (!bareName || typeof bareName !== 'string') return 1;
    this.prebuildRefCountIndex();
    const m = this._refBareRelationshipFanout;
    if (!m || !(m instanceof Map)) return 1;
    return m.get(bareName) || 1;
  }

  /**
   * Batched incoming-call count by entity NAME.
   *
   * For each name in `names`, returns the total number of `relationships`
   * rows of type='calls' whose target is either the bare name or any
   * qualified suffix (e.g. `fastify.decorate`, `app.decorate`). Backed by
   * the lazy in-memory index built by `prebuildRefCountIndex` — first call
   * pays ~10 ms; subsequent calls are sub-millisecond.
   *
   * Counts EXCLUDE 'imports', 'uses', 'extends', 'implements' — only direct
   * `calls` participate. This keeps the signal behavioural (function-was-
   * invoked) rather than structural (type-was-mentioned), matching the
   * Aider PageRank / Cody ref-rank intent.
   *
   * Returns a Map<name, count> with one entry per input name (counts of 0
   * are present, not omitted).
   *
   * @param {string[]} names
   * @returns {Map<string, number>}
   */
  countIncomingCallsByNames(names) {
    const out = new Map();
    if (!Array.isArray(names) || names.length === 0) return out;
    const uniq = [...new Set(names.filter(n => typeof n === 'string' && n.length >= 2))];
    if (uniq.length === 0) return out;
    this.prebuildRefCountIndex();
    const exact = this._refCountExact || new Map();
    const suffix = this._refSuffixSafe || new Map();
    for (const name of uniq) {
      const dot = name.lastIndexOf('.');
      let c;
      if (dot > 0) {
        c = exact.get(name) || 0;
      } else {
        const agg = suffix.get(name);
        c = agg !== undefined ? agg : (exact.get(name) || 0);
      }
      out.set(name, c);
    }
    return out;
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
      if (this._hasColumns(db, 'entities', ['epoch_written', 'epoch_retired'])) {
        const visible = prepareCached(db, `
          SELECT 1 FROM entities
          WHERE file_path = ? AND ${this._entityVisibilitySql(db)}
          LIMIT 1
        `).get(filePath, ...this._entityVisibilityParams(db));
        if (visible) return { staleSince: null };

        const staleSql = this._manifestEpoch !== null
          ? `
            SELECT stale_since
            FROM entities
            WHERE file_path = ?
              AND stale_since IS NOT NULL
              AND (epoch_written IS NULL OR epoch_written <= ?)
              AND (epoch_retired IS NULL OR epoch_retired <= ?)
            ORDER BY stale_since DESC
            LIMIT 1
          `
          : `
            SELECT stale_since
            FROM entities
            WHERE file_path = ?
              AND stale_since IS NOT NULL
            ORDER BY stale_since DESC
            LIMIT 1
          `;
        const staleArgs = this._manifestEpoch !== null
          ? [filePath, this._manifestEpoch, this._manifestEpoch]
          : [filePath];
        const staleRow = prepareCached(db, staleSql).get(...staleArgs);
        return staleRow ? { staleSince: staleRow.stale_since || null } : null;
      }
      const row = prepareCached(db, `
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
    this._hasEntityEpochVisibility = null;
    this._hasRelationshipEpochVisibility = null;
    this._resetDerivedCaches();
  }
}
