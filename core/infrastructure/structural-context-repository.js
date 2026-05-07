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
const ACTIVE = 'stale_since IS NULL';

function clampLimit(value, fallback, max) {
  const n = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(max, n));
}

function lowerCamel(name) {
  if (!name) return '';
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function rowToEntity(row, prefix = '') {
  if (!row) return null;
  return {
    id: row[`${prefix}id`],
    name: row[`${prefix}name`],
    type: row[`${prefix}type`],
    filePath: row[`${prefix}file_path`],
    startLine: row[`${prefix}start_line`],
    endLine: row[`${prefix}end_line`],
    signature: row[`${prefix}signature`] || '',
    summary: row[`${prefix}summary`] || '',
    parentClass: row[`${prefix}parent_class`] || null,
    package: row[`${prefix}package`] || null,
  };
}

function callTargetAliases(targetName) {
  const raw = String(targetName || '').trim();
  if (!raw) return [];
  const out = [raw];
  const bound = raw.match(/^(.+)\.(bind|call|apply)$/);
  if (bound) out.push(bound[1]);
  if (raw.includes('::')) out.push(raw.split('::').filter(Boolean).pop());
  return [...new Set(out)];
}

function qualifiedTargetName(targetName) {
  const base = String(targetName || '').trim().replace(/\.(bind|call|apply)$/, '').replace(/::/g, '.');
  if (!base.includes('.')) return null;
  const parts = base.split('.').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

function isTestPath(filePath = '') {
  return /(^|\/)(__tests__|tests?|spec|fixtures|examples?|docs?)(\/|$)|[-_.](test|spec)\.[cm]?[jt]sx?$|_test\.go$/.test(filePath);
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

export class StructuralContextRepository {
  constructor(dbPath, opts = {}) {
    this.dbPath = dbPath;
    this.projectRoot = opts.projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
    this.db = null;
    this.fileCache = new Map();
  }

  _open() {
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
  }

  _resolveUnresolvedTarget(targetName) {
    const db = this._open();
    const names = callTargetAliases(targetName);
    if (!db || names.length === 0) return null;
    const rows = db.prepare(`
      SELECT id, name, type, file_path, start_line, end_line, signature,
             summary, parent_class, package
      FROM entities
      WHERE ${ACTIVE}
        AND (${names.map(() => 'name = ?').join(' OR ')})
      ORDER BY
        CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
        length(name),
        (end_line - start_line) ASC
      LIMIT 1
    `).all(...names);
    return rowToEntity(rows[0]);
  }

  _resolveQualifiedAlternative(targetName, excludeId) {
    const db = this._open();
    const name = qualifiedTargetName(targetName);
    if (!db || !name || !excludeId) return null;
    const rows = db.prepare(`
      SELECT id, name, type, file_path, start_line, end_line, signature,
             summary, parent_class, package
      FROM entities
      WHERE ${ACTIVE}
        AND lower(name) = lower(?)
        AND id <> ?
      ORDER BY
        CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
        CASE type WHEN 'method' THEN 0 WHEN 'function' THEN 1 ELSE 2 END,
        (end_line - start_line) ASC
      LIMIT 8
    `).all(name, excludeId);
    return rows.map(row => rowToEntity(row))
      .sort((a, b) => Number(isTestPath(a.filePath)) - Number(isTestPath(b.filePath)))[0] || null;
  }

  _findAssignedMemberDefinitions(symbol) {
    const db = this._open();
    if (!db || !symbol) return [];
    const rows = db.prepare(`
      SELECT DISTINCT file_path FROM entities
      WHERE ${ACTIVE} AND file_path IS NOT NULL
      ORDER BY CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' OR file_path LIKE '%/examples/%' OR file_path LIKE 'examples/%' THEN 1 ELSE 0 END, file_path
      LIMIT 120
    `).all();
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
    let fileWhere = '';
    if (filePath) {
      fileWhere = 'AND (file_path = ? OR file_path LIKE ?)';
      params.push(filePath, `%${filePath}%`);
    }

    const exactRows = db.prepare(`
      SELECT id, name, type, file_path, start_line, end_line, signature,
             summary, parent_class, package
      FROM entities
      WHERE ${ACTIVE}
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
    `).all(...params, raw, raw, limit);
    if (exactRows.length) {
      const members = this._findAssignedMemberDefinitions(raw);
      const candidates = [...members, ...exactRows.map(row => rowToEntity(row))].filter(Boolean);
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
      WHERE ${ACTIVE}
        AND lower(name) LIKE lower(?)
        ${likeFileWhere}
      ORDER BY
        CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
        length(name), (end_line - start_line) ASC
      LIMIT ?
    `).all(...likeParams, limit).map(row => rowToEntity(row));
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
    const rows = db.prepare(`
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package,
        r.context_line, r.target_name, r.weight, r.type as rel_type
      FROM relationships r
      JOIN entities e ON e.id = r.source_id
      WHERE r.type IN (${placeholders(types)})
        AND e.${ACTIVE}
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
    `).all(...types, target.id, target.id, ...patterns, limit);
    return rows.map(row => ({
      ...rowToEntity(row),
      relationship: row.rel_type,
      contextLine: row.context_line || null,
      targetName: row.target_name || null,
      weight: row.weight ?? 1,
    }));
  }

  getAliasCallers(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id) return [];
    return findAliasCallers({
      db,
      target,
      readFileRange: this.readFileRange.bind(this),
      limit: clampLimit(opts.limit, 40, 200),
    });
  }

  getCallees(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id) return [];
    const limit = clampLimit(opts.limit, 120, 500);
    const rows = db.prepare(`
      SELECT
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package,
        r.context_line, r.target_name, r.weight, r.type as rel_type
      FROM relationships r
      LEFT JOIN entities e ON e.id = r.target_id AND e.${ACTIVE}
      WHERE r.source_id = ?
        AND r.type = 'calls'
      ORDER BY r.context_line, r.weight DESC
      LIMIT ?
    `).all(target.id, limit);
    return rows.map((row, idx) => {
      let resolved = row.id ? rowToEntity(row) : (this._resolveUnresolvedTarget(row.target_name) || {
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

    const rows = db.prepare(`
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package,
        r.target_id, r.target_name, r.context_line, r.weight, r.type as rel_type
      FROM relationships r
      JOIN entities e ON e.id = r.source_id
      WHERE e.${ACTIVE}
        AND r.type IN (${placeholders(types)})
        AND (r.target_id IN (${placeholders(ids)}) ${nameClause})
      ORDER BY r.weight DESC, e.file_path, r.context_line
      LIMIT ?
    `).all(...types, ...ids, ...nameParams, limit);

    return rows.map(row => ({
      ...rowToEntity(row),
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

    const rows = db.prepare(`
      SELECT
        r.source_id, r.target_id, r.target_name, r.context_line, r.weight, r.type as rel_type,
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package
      FROM relationships r
      LEFT JOIN entities e ON e.id = r.target_id AND e.${ACTIVE}
      WHERE r.source_id IN (${placeholders(ids)})
        AND r.type IN (${placeholders(types)})
      ORDER BY r.weight DESC, r.source_id, r.context_line
      LIMIT ?
    `).all(...ids, ...types, limit);

    return rows.map((row, idx) => {
      let resolved = row.id ? rowToEntity(row) : (this._resolveUnresolvedTarget(row.target_name) || {
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

    const inRows = db.prepare(`
      SELECT target_id as id, COUNT(DISTINCT source_id) as n
      FROM relationships
      WHERE target_id IN (${placeholders(ids)})
      GROUP BY target_id
    `).all(...ids);
    for (const row of inRows) {
      if (out.has(row.id)) out.get(row.id).fanIn = row.n || 0;
    }

    const outRows = db.prepare(`
      SELECT source_id as id, COUNT(DISTINCT COALESCE(target_id, target_name)) as n
      FROM relationships
      WHERE source_id IN (${placeholders(ids)})
      GROUP BY source_id
    `).all(...ids);
    for (const row of outRows) {
      if (out.has(row.id)) out.get(row.id).fanOut = row.n || 0;
    }
    return out;
  }

  /** Precomputed PageRank values for a batch of entity IDs (0 for missing). */
  getPageRank(entityIds) {
    return fetchPageRank(this._open(), entityIds);
  }

  /** One-hop reverse edges (callers) for Forward Push backward subgraph. */
  getFrontierBackwardEdges(frontierIds, opts = {}) {
    return fetchFrontierBackwardEdges(this._open(), frontierIds, opts);
  }

  /** One-hop forward edges (callees) for Forward Push forward subgraph. */
  getFrontierForwardEdges(frontierIds, opts = {}) {
    return fetchFrontierForwardEdges(this._open(), frontierIds, opts);
  }

  findSameFileDefinition(name, filePath) { return findSameFileDefinition({ name, filePath, readFileRange: this.readFileRange.bind(this) }); }

  getEntityCount() {
    const db = this._open();
    if (!db) return 0;
    return db.prepare(`SELECT COUNT(*) as n FROM entities WHERE ${ACTIVE}`).get()?.n || 0;
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
