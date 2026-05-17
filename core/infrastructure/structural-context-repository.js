// Read-only persistence adapter for the unified structural trace surface.
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { applyReadPragmas } from './db-utils.js';
import { findAliasCallers } from './structural-alias-resolver.js';
import { rankStructuralCandidates } from './structural-candidate-ranker.js';
import { findAssignedMemberDefinitions, findSameFileDefinition } from './structural-source-definitions.js';
import { shouldTrustQualifiedResolution } from './structural-qualified-resolution.js';
import { fetchPageRank, fetchFrontierBackwardEdges, fetchFrontierForwardEdges } from './structural-graph-signals.js';
import { CodeGraphReaderVisibility } from './code-graph-visibility.js';
import { callTargetAliases, clampLimit, isTestPath, lowerCamel, placeholders, qualifiedTargetName, rowToEntity } from './structural-context-utils.js';

export class StructuralContextRepository {
  constructor(dbPath, opts = {}) {
    this._readerVisibility = new CodeGraphReaderVisibility(dbPath, opts);
    this.dbPath = this._readerVisibility.dbPath;
    this.projectRoot = opts.projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
    this.db = null;
    this.fileCache = new Map();
  }

  _syncAdjacentManifest() {
    const changed = this._readerVisibility.sync(() => this.close());
    this.dbPath = this._readerVisibility.dbPath;
    return changed;
  }

  refreshManifestEpoch() {
    this._syncAdjacentManifest();
    return this._readerVisibility.manifestEpoch;
  }

  _open() {
    this._syncAdjacentManifest();
    if (!this.db) {
      if (!existsSync(this.dbPath)) return null;
      this.db = new Database(this.dbPath, { readonly: true });
      applyReadPragmas(this.db, { tempStoreMemory: true });
    }
    return this.db;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this._readerVisibility.reset();
  }

  _entityFromRow(row, prefix = '') {
    const entity = rowToEntity(row, prefix);
    const db = this.db;
    if (entity?.summary && db && !this._readerVisibility.summaryVisible(db, entity.id)) {
      return { ...entity, summary: '' };
    }
    return entity;
  }

  _entitySql(db, alias = '') { return this._readerVisibility.entitySql(db, alias); }
  _entityParams(db) { return this._readerVisibility.entityParams(db); }
  _relationshipSql(db, alias = 'r') { return this._readerVisibility.relationshipSql(db, alias); }
  _relationshipParams(db) { return this._readerVisibility.relationshipParams(db); }

  _resolveUnresolvedTarget(targetName) {
    const db = this._open();
    const names = callTargetAliases(targetName);
    if (!db || names.length === 0) return null;
    const entitySql = this._entitySql(db);
    const entityParams = this._entityParams(db);
    const rows = db.prepare(`
      SELECT id, name, type, file_path, start_line, end_line, signature,
             summary, parent_class, package
      FROM entities
      WHERE ${entitySql}
        AND (${names.map(() => 'name = ?').join(' OR ')})
      ORDER BY
        CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
        length(name),
        (end_line - start_line) ASC
      LIMIT 1
    `).all(...entityParams, ...names);
    return this._entityFromRow(rows[0]);
  }

  _resolveQualifiedAlternative(targetName, excludeId) {
    const db = this._open();
    const name = qualifiedTargetName(targetName);
    if (!db || !name || !excludeId) return null;
    const entitySql = this._entitySql(db);
    const entityParams = this._entityParams(db);
    const rows = db.prepare(`
      SELECT id, name, type, file_path, start_line, end_line, signature,
             summary, parent_class, package
      FROM entities
      WHERE ${entitySql}
        AND lower(name) = lower(?)
        AND id <> ?
      ORDER BY
        CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
        CASE type WHEN 'method' THEN 0 WHEN 'function' THEN 1 ELSE 2 END,
        (end_line - start_line) ASC
      LIMIT 8
    `).all(...entityParams, name, excludeId);
    return rows.map(row => this._entityFromRow(row))
      .sort((a, b) => Number(isTestPath(a.filePath)) - Number(isTestPath(b.filePath)))[0] || null;
  }

  _findAssignedMemberDefinitions(symbol) {
    const db = this._open();
    if (!db || !symbol) return [];
    const entitySql = this._entitySql(db);
    const rows = db.prepare(`
      SELECT DISTINCT file_path FROM entities
      WHERE ${entitySql} AND file_path IS NOT NULL
      ORDER BY CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' OR file_path LIKE '%/examples/%' OR file_path LIKE 'examples/%' THEN 1 ELSE 0 END, file_path
      LIMIT 120
    `).all(...this._entityParams(db));
    return findAssignedMemberDefinitions({
      name: symbol,
      files: rows.map(r => r.file_path),
      readFileRange: this.readFileRange.bind(this),
    });
  }

  findEntityCandidates(symbol, opts = {}) {
    const db = this._open();
    const raw = String(symbol || '').trim();
    if (!db || !raw) return [];

    const limit = clampLimit(opts.limit, 12, 50);
    const suffix = raw.includes('.') ? raw.split('.').filter(Boolean).pop() : raw;
    const names = [...new Set([raw, suffix].filter(Boolean))];
    const filePath = typeof opts.filePath === 'string' && opts.filePath.trim()
      ? opts.filePath.trim()
      : null;
    const nameWhere = names.map(() => 'lower(name) = lower(?)').join(' OR ');
    const params = [...names];
    const entitySql = this._entitySql(db);
    const entityParams = this._entityParams(db);
    let fileWhere = '';
    if (filePath) {
      fileWhere = 'AND (file_path = ? OR file_path LIKE ?)';
      params.push(filePath, `%${filePath}%`);
    }

    const exactRows = db.prepare(`
      SELECT id, name, type, file_path, start_line, end_line, signature,
             summary, parent_class, package
      FROM entities
      WHERE ${entitySql}
        AND (${nameWhere})
        ${fileWhere}
      ORDER BY
        CASE
          WHEN name = ? THEN 0
          WHEN lower(name) = lower(?) THEN 1
          ELSE 2
        END,
        CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
        CASE type
          WHEN 'class' THEN 0 WHEN 'struct' THEN 0 WHEN 'trait' THEN 0
          WHEN 'interface' THEN 1 WHEN 'enum' THEN 1 WHEN 'type' THEN 1 WHEN 'typeAlias' THEN 1
          WHEN 'function' THEN 2 WHEN 'method' THEN 2
          ELSE 3
        END,
        (end_line - start_line) ASC
      LIMIT ?
    `).all(...entityParams, ...params, raw, raw, limit);
    if (exactRows.length) {
      const members = this._findAssignedMemberDefinitions(raw);
      const candidates = [...members, ...exactRows.map(row => this._entityFromRow(row))].filter(Boolean);
      return rankStructuralCandidates(candidates, { queryHint: opts.queryHint, readFileRange: this.readFileRange.bind(this) });
    }

    if (raw.length < 3) return [];
    const members = this._findAssignedMemberDefinitions(raw);
    const likeParams = [`%${raw}%`];
    let likeFileWhere = '';
    if (filePath) {
      likeFileWhere = 'AND (file_path = ? OR file_path LIKE ?)';
      likeParams.push(filePath, `%${filePath}%`);
    }
    const likeRows = db.prepare(`
      SELECT id, name, type, file_path, start_line, end_line, signature,
             summary, parent_class, package
      FROM entities
      WHERE ${entitySql}
        AND lower(name) LIKE lower(?)
        ${likeFileWhere}
      ORDER BY
        CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
        length(name), (end_line - start_line) ASC
      LIMIT ?
    `).all(...entityParams, ...likeParams, limit).map(row => this._entityFromRow(row));
    return rankStructuralCandidates([...members, ...likeRows].filter(Boolean), { queryHint: opts.queryHint, readFileRange: this.readFileRange.bind(this) });
  }

  getCallers(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id) return [];
    const limit = clampLimit(opts.limit, 120, 500);
    const types = opts.types?.length ? opts.types : ['calls', 'uses', 'implements', 'extends', 'overrides'];
    const patterns = [
      target.name,
      `${target.name}.%`,
      `${lowerCamel(target.name)}.%`,
      `%.${target.name}`,
      `%::${target.name}`,
    ];
    const entitySql = this._entitySql(db, 'e');
    const relationshipSql = this._relationshipSql(db, 'r');
    const rows = db.prepare(`
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package,
        r.context_line, r.target_name, r.weight, r.type as rel_type
      FROM relationships r
      JOIN entities e ON e.id = r.source_id
      WHERE r.type IN (${placeholders(types)})
        AND ${entitySql}
        AND ${relationshipSql}
        AND e.id <> ?
        AND (
          r.target_id = ?
          OR r.target_name = ?
          OR r.target_name LIKE ?
          OR r.target_name LIKE ?
          OR r.target_name LIKE ?
          OR r.target_name LIKE ?
        )
      ORDER BY r.weight DESC, e.file_path, r.context_line
      LIMIT ?
    `).all(...types, ...this._entityParams(db), ...this._relationshipParams(db), target.id, target.id, ...patterns, limit);
    return rows.map(row => ({
      ...this._entityFromRow(row),
      relationship: row.rel_type,
      contextLine: row.context_line || null,
      targetName: row.target_name || null,
      weight: row.weight ?? 1,
    }));
  }

  getAliasCallers(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id) return [];
    return findAliasCallers({ db, target, readFileRange: this.readFileRange.bind(this), limit: clampLimit(opts.limit, 40, 200), entityVisibilitySql: this._entitySql(db), entityVisibilityParams: this._entityParams(db), mapEntity: row => this._entityFromRow(row) });
  }

  getCallees(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id) return [];
    const limit = clampLimit(opts.limit, 120, 500);
    const entitySql = this._entitySql(db, 'e');
    const relationshipSql = this._relationshipSql(db, 'r');
    const rows = db.prepare(`
      SELECT
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package,
        r.context_line, r.target_name, r.weight, r.type as rel_type
      FROM relationships r
      LEFT JOIN entities e ON e.id = r.target_id AND ${entitySql}
      WHERE r.source_id = ?
        AND r.type = 'calls'
        AND ${relationshipSql}
      ORDER BY r.context_line, r.weight DESC
      LIMIT ?
    `).all(...this._entityParams(db), target.id, ...this._relationshipParams(db), limit);
    return rows.map((row, idx) => {
      let resolved = row.id ? this._entityFromRow(row) : (this._resolveUnresolvedTarget(row.target_name) || {
        id: `external:${idx}:${row.target_name || 'unknown'}`,
        name: row.target_name || 'external',
        type: 'external',
        filePath: null,
        startLine: null,
        endLine: null,
        signature: row.target_name || '',
        summary: '',
      });
      if (row.id && !shouldTrustQualifiedResolution(row.target_name, resolved)) resolved = { id: `external:${idx}:${row.target_name || 'unknown'}`, name: row.target_name || 'external', type: 'external', filePath: null, startLine: null, endLine: null, signature: row.target_name || '', summary: '' };
      if (resolved.id === target.id) {
        resolved = this._resolveQualifiedAlternative(row.target_name, target.id) || resolved;
      }
      return {
        ...resolved,
        relationship: row.rel_type,
        contextLine: row.context_line || null,
        targetName: row.target_name || null,
        weight: row.weight ?? 1,
      };
    });
  }

  getReverseDependents(frontierIds, target, opts = {}) {
    const db = this._open();
    const ids = [...new Set((frontierIds || []).filter(Boolean))];
    if (!db || ids.length === 0) return [];
    const limit = clampLimit(opts.limit, 160, 1000);
    const types = opts.types?.length
      ? opts.types
      : ['calls', 'uses', 'implements', 'extends', 'overrides'];
    const includeNamePattern = opts.includeNamePattern === true && target?.name;

    const nameClause = includeNamePattern
      ? `OR r.target_name = ? OR r.target_name LIKE ? OR r.target_name LIKE ? OR r.target_name LIKE ?`
      : '';
    const nameParams = includeNamePattern
      ? [target.name, `${lowerCamel(target.name)}.%`, `%.${target.name}`, `%::${target.name}`]
      : [];
    const entitySql = this._entitySql(db, 'e');
    const relationshipSql = this._relationshipSql(db, 'r');

    const rows = db.prepare(`
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package,
        r.target_id, r.target_name, r.context_line, r.weight, r.type as rel_type
      FROM relationships r
      JOIN entities e ON e.id = r.source_id
      WHERE ${entitySql}
        AND ${relationshipSql}
        AND r.type IN (${placeholders(types)})
        AND (r.target_id IN (${placeholders(ids)}) ${nameClause})
      ORDER BY r.weight DESC, e.file_path, r.context_line
      LIMIT ?
    `).all(...this._entityParams(db), ...this._relationshipParams(db), ...types, ...ids, ...nameParams, limit);

    return rows.map(row => ({
      ...this._entityFromRow(row),
      relationship: row.rel_type,
      targetId: row.target_id || null,
      targetName: row.target_name || null,
      contextLine: row.context_line || null,
      weight: row.weight ?? 1,
    }));
  }

  getForwardDependencies(frontierIds, opts = {}) {
    const db = this._open();
    const ids = [...new Set((frontierIds || []).filter(id => id && !String(id).startsWith('external:')))];
    if (!db || ids.length === 0) return [];
    const limit = clampLimit(opts.limit, 160, 1000);
    const types = opts.types?.length
      ? opts.types
      : ['calls', 'uses', 'implements', 'extends', 'overrides'];
    const entitySql = this._entitySql(db, 'e');
    const relationshipSql = this._relationshipSql(db, 'r');

    const rows = db.prepare(`
      SELECT
        r.source_id, r.target_id, r.target_name, r.context_line, r.weight, r.type as rel_type,
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package
      FROM relationships r
      LEFT JOIN entities e ON e.id = r.target_id AND ${entitySql}
      WHERE r.source_id IN (${placeholders(ids)})
        AND r.type IN (${placeholders(types)})
        AND ${relationshipSql}
      ORDER BY r.weight DESC, r.source_id, r.context_line
      LIMIT ?
    `).all(...this._entityParams(db), ...ids, ...types, ...this._relationshipParams(db), limit);

    return rows.map((row, idx) => {
      let resolved = row.id ? this._entityFromRow(row) : (this._resolveUnresolvedTarget(row.target_name) || {
        id: `external:${row.source_id}:${idx}:${row.target_name || 'unknown'}`,
        name: row.target_name || 'external',
        type: 'external',
        filePath: null,
        startLine: null,
        endLine: null,
        signature: row.target_name || '',
        summary: '',
      });
      if (row.id && !shouldTrustQualifiedResolution(row.target_name, resolved)) resolved = { id: `external:${row.source_id}:${idx}:${row.target_name || 'unknown'}`, name: row.target_name || 'external', type: 'external', filePath: null, startLine: null, endLine: null, signature: row.target_name || '', summary: '' };
      if (resolved.id === row.source_id) {
        resolved = this._resolveQualifiedAlternative(row.target_name, row.source_id) || resolved;
      }
      return {
        ...resolved,
        relationship: row.rel_type,
        sourceId: row.source_id,
        targetId: row.target_id || null,
        targetName: row.target_name || null,
        contextLine: row.context_line || null,
        weight: row.weight ?? 1,
      };
    });
  }

  getFanCounts(entityIds) {
    const db = this._open();
    const ids = [...new Set((entityIds || []).filter(id => id && !String(id).startsWith('external:')))];
    const out = new Map(ids.map(id => [id, { fanIn: 0, fanOut: 0 }]));
    if (!db || ids.length === 0) return out;
    const relationshipSql = this._relationshipSql(db, '');
    const relationshipParams = this._relationshipParams(db);

    const inRows = db.prepare(`
      SELECT target_id as id, COUNT(DISTINCT source_id) as n
      FROM relationships
      WHERE target_id IN (${placeholders(ids)})
        AND ${relationshipSql}
      GROUP BY target_id
    `).all(...ids, ...relationshipParams);
    for (const row of inRows) {
      if (out.has(row.id)) out.get(row.id).fanIn = row.n || 0;
    }

    const outRows = db.prepare(`
      SELECT source_id as id, COUNT(DISTINCT COALESCE(target_id, target_name)) as n
      FROM relationships
      WHERE source_id IN (${placeholders(ids)})
        AND ${relationshipSql}
      GROUP BY source_id
    `).all(...ids, ...relationshipParams);
    for (const row of outRows) {
      if (out.has(row.id)) out.get(row.id).fanOut = row.n || 0;
    }
    return out;
  }

  /** Precomputed PageRank values for a batch of entity IDs (0 for missing). */
  getPageRank(entityIds) {
    const db = this._open();
    return fetchPageRank(db, entityIds, { entityVisibilitySql: db ? this._entitySql(db) : undefined, entityVisibilityParams: db ? this._entityParams(db) : undefined });
  }

  /** One-hop reverse edges (callers) for Forward Push backward subgraph. */
  getFrontierBackwardEdges(frontierIds, opts = {}) {
    const db = this._open();
    return fetchFrontierBackwardEdges(db, frontierIds, { ...opts, relationshipVisibilitySql: db ? this._relationshipSql(db, '') : undefined, relationshipVisibilityParams: db ? this._relationshipParams(db) : undefined });
  }

  /** One-hop forward edges (callees) for Forward Push forward subgraph. */
  getFrontierForwardEdges(frontierIds, opts = {}) {
    const db = this._open();
    return fetchFrontierForwardEdges(db, frontierIds, { ...opts, relationshipVisibilitySql: db ? this._relationshipSql(db, '') : undefined, relationshipVisibilityParams: db ? this._relationshipParams(db) : undefined });
  }

  findSameFileDefinition(name, filePath) { return findSameFileDefinition({ name, filePath, readFileRange: this.readFileRange.bind(this) }); }

  getEntityCount() {
    const db = this._open();
    if (!db) return 0;
    return db.prepare(`SELECT COUNT(*) as n FROM entities WHERE ${this._entitySql(db)}`)
      .get(...this._entityParams(db))?.n || 0;
  }

  readFileRange(filePath, startLine, endLine) {
    if (!filePath) return null;
    try {
      const root = this.projectRoot;
      const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
      const resolved = path.resolve(abs);
      const resolvedRoot = path.resolve(root);
      if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) return null;
      let lines = this.fileCache.get(resolved);
      if (!lines) {
        lines = readFileSync(resolved, 'utf8').split('\n');
        this.fileCache.set(resolved, lines);
      }
      const start = Math.max(1, Number.parseInt(startLine || 1, 10));
      const end = Math.max(start, Number.parseInt(endLine || start, 10));
      return lines.slice(start - 1, end).join('\n');
    } catch {
      return null;
    }
  }
}

export default StructuralContextRepository;
