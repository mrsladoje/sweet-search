// Read-only persistence adapter for the unified structural trace surface.
import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { applyReadPragmas } from './db-utils.js';
import { findAliasCallers } from './structural-alias-resolver.js';
import { rankStructuralCandidates } from './structural-candidate-ranker.js';
import { findAssignedMemberDefinitions, findSameFileDefinition } from './structural-source-definitions.js';
import { goPackagePrivateFrom, pythonPackageCallOnMethod, shouldTrustQualifiedResolution, trustedCallerEdge, trustedCalleeEdge } from './structural-qualified-resolution.js';
import { fetchPageRank, fetchFrontierBackwardEdges, fetchFrontierForwardEdges } from './structural-graph-signals.js';
import { CodeGraphReaderVisibility } from './code-graph-visibility.js';
import { SITE_LINE_RELATIONSHIP_TYPES as SITE_LINE_TYPES, TRACE_ONLY_TYPES_SQL } from './relationship-types.js';
import { asTopLevelCaller, fileNodeSourceSql, hasFilesTable, hasGraphColumn, hasGraphTable } from './file-nodes.js';
import { isTestLikePath } from './test-paths.js';
import { GO_PACKAGE_PREFIX, RUST_PATH_PREFIX, UNRESOLVED_IMPORT_PREFIX } from './import-path-prefixes.js';
import { RECEIVER_TYPE_PREFIX, signatureParamTypes } from './receiver-type-annotation.js';
import { callTargetAliases, clampLimit, isLikelyCodeEntity, isTestPath, lowerCamel, placeholders, qualifiedTargetName, rowToEntity } from './structural-context-utils.js';

// Entity types that own members: a call inside one belongs to its own
// member of that name (getSameFileCallers).
const OWNER_TYPES = new Set(['class', 'interface', 'struct', 'enum', 'trait', 'impl', 'object', 'protocol', 'extension', 'record', 'module', 'service']);

// Types whose body declares members without defining them (method specs, requirements).
const DECLARING_OWNER_TYPES = new Set(['interface', 'protocol', 'trait']);

function sortLines(item) {
  item.contextLines.sort((a, b) => a - b);
  item.contextLine = item.contextLines[0] ?? item.contextLine;
  return item;
}

/**
 * A call that build-time resolution bound to a Go package (graph-extractor
 * marks `pkg.Func()` with `gopkg:<dir>/` or `unresolved:<path>`) and left
 * without a target: a non-repo package, or no top-level function of that
 * name in the package. Readers never re-match it by name — `glog.Errorf` is
 * no call of an in-repo `ToGlog.Errorf`.
 */
function packageCallUnbound(row) {
  if (row.target_id || row.rel_type !== 'calls') return false;
  const fip = row.full_import_path || '';
  // A typed receiver (receiver-types.js) whose type has no such method: the
  // call is outside the repo or through an unknown base — no name match.
  return fip.startsWith(GO_PACKAGE_PREFIX) || fip.startsWith(RUST_PATH_PREFIX) || fip.startsWith(UNRESOLVED_IMPORT_PREFIX)
    || fip.startsWith(RECEIVER_TYPE_PREFIX);
}

/**
 * A call build-time resolution bound through its Go package (`x.Parse` →
 * x/keys.go Parse): the package decided it, so the query-time receiver gate
 * (the qualifier `x` names no file stem or owner) does not apply.
 */
function packageCallBound(row) {
  if (row.rel_type !== 'calls' || !(row.target_id || row.id)) return false;
  const fip = String(row.full_import_path || '');
  // Also a call through a receiver of declared type (`l *List` → l.findPosting):
  // the type decided it, not the receiver's name. A PHP factory hint (`recvtype:?`)
  // decides nothing when it binds: the receiver rules did.
  return fip.startsWith(GO_PACKAGE_PREFIX) || fip.startsWith(RUST_PATH_PREFIX)
    || (fip.startsWith(RECEIVER_TYPE_PREFIX) && !fip.startsWith(`${RECEIVER_TYPE_PREFIX}?`));
}

/**
 * A graph built before calls carried their receiver type: the caller's own
 * signature declares the qualifier's type (`func (txn *Txn) f(ctx, l *List)`)
 * and the stored target is a method of that type. Short qualifiers (`l`, `b`)
 * name nothing, so the receiver-name gate below would drop a sound edge.
 */
function declaredReceiverBound(targetName, caller, resolved) {
  if (!caller?.signature || !resolved?.parentClass) return false;
  const parts = String(targetName || '').split('.');
  if (parts.length !== 2) return false;
  return signatureParamTypes(caller.signature).get(parts[0]) === resolved.parentClass;
}

/**
 * Lines inside a triple-quoted string (Elixir `@doc """`, Python docstrings) or a block
 * comment, delimiter lines included: plug's `iex> put_status(conn, :not_found)` doc
 * examples were listed as callers.
 */
function nonCodeLines(lines) {
  const out = new Array(lines.length).fill(false);
  let open = null; // '"""', "'''" or '*/'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      out[i] = true;
      if (line.includes(open)) open = null;
      continue;
    }
    for (const q of ['"""', "'''"]) {
      const n = line.split(q).length - 1;
      if (n > 0) { out[i] = true; if (n % 2 === 1) open = q; break; }
    }
    if (!open && /^\s*\/\*/.test(line) && !line.includes('*/')) { out[i] = true; open = '*/'; }
  }
  return out;
}

// Same-named definitions read before the candidate order is cut to `limit`.
const EXACT_CANDIDATE_POOL = 50;
const candidateKindTier = (type) => {
  const t = String(type || '');
  if (['class', 'struct', 'trait', 'object', 'actor'].includes(t)) return 0;
  if (['interface', 'enum', 'type', 'typeAlias'].includes(t)) return 1;
  // A function bound to a name (`export const getPath = (req) => {…}`) is a
  // function: hono's central url.ts getPath ranked below an adapter's method.
  if (['function', 'method', 'arrowFunction', 'objectArrow', 'objectMethod', 'assignedFunc', 'shortFunction', 'def', 'func', 'proc', 'procedure'].includes(t)) return 2;
  return 3;
};

/**
 * Which of several same-named definitions a bare name means: the owner the name was
 * qualified with, then the exact spelling, then a non-test file (isTestLikePath: ocelot's
 * `unit/`, `testing/`), then the kind tier, then the one the code calls most (incoming
 * edges: ocelot `ILoadBalancer.LeaseAsync` has 23, `NoLoadBalancer.LeaseAsync` 5), then
 * the SQL order (smaller span). Stable on ties.
 */
export function preferCalledDefinitions(rows, qualifier, spelled) {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const A = a.row; const B = b.row;
    const key = (r) => [
      qualifier && r.parent_class === qualifier ? 0 : 1,
      r.name === spelled ? 0 : 1,
      isTestLikePath(r.file_path) ? 1 : 0,
      candidateKindTier(r.type),
    ];
    const ka = key(A); const kb = key(B);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return ((B.fan_in || 0) - (A.fan_in || 0)) || (a.index - b.index);
  }).map(x => x.row);
}

export class StructuralContextRepository {
  /**
   * @param {string} dbPath
   * @param {{projectRoot?: string, BareCallResolver?: Function}} [opts]
   *   `BareCallResolver` (graph/bare-call-resolution.js) enables
   *   `getBareCallers`. It is passed in, not imported: the resolver is graph
   *   domain logic, and infrastructure must not depend on the graph domain.
   *   Without it bare-call callers are empty.
   */
  constructor(dbPath, opts = {}) {
    this._BareCallResolver = typeof opts.BareCallResolver === 'function' ? opts.BareCallResolver : null;
    // graph/receiver-types.js declaredTypeIn, passed in for the same reason.
    this._declaredTypeIn = typeof opts.declaredTypeIn === 'function' ? opts.declaredTypeIn : null;
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

  /**
   * Every site line of the qualified calls and trace-only type usages
   * (`instantiates`, `typeRef`, `extensionOf`) made by `sourceIds`, from the
   * trace-only call_lines table: Map `${source}\0${rel_type}\0${target_name}`
   * → sorted lines. Rows of a table without `rel_type` (written before type
   * usages had site lines) are call lines. Empty for graphs built before the
   * table existed; callers then keep the relationship row's context_line.
   */
  _siteLines(db, sourceIds) {
    const out = new Map();
    const ids = [...new Set((sourceIds || []).filter(Boolean))];
    if (ids.length === 0) return out;
    if (!hasGraphTable(db, 'call_lines')) return out;
    const relType = hasGraphColumn(db, 'call_lines', 'rel_type') ? 'cl.rel_type' : "'calls'";
    const vis = this._relationshipSql(db, 'cl');
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      const rows = db.prepare(`
        SELECT cl.source_id, ${relType} AS rel_type, cl.target_name, cl.context_line FROM call_lines cl
        WHERE cl.source_id IN (${placeholders(part)}) AND ${vis}
      `).all(...part, ...this._relationshipParams(db));
      for (const row of rows) {
        if (row.context_line == null) continue;
        const key = `${row.source_id}\u0000${row.rel_type}\u0000${row.target_name}`;
        let lines = out.get(key);
        if (!lines) { lines = []; out.set(key, lines); }
        if (!lines.includes(row.context_line)) lines.push(row.context_line);
      }
    }
    for (const lines of out.values()) lines.sort((a, b) => a - b);
    return out;
  }

  /** `contextLines` for a stored edge: every site line, else its own line. */
  _edgeLines(linesByPair, sourceId, edge) {
    const lines = SITE_LINE_TYPES.has(edge.relationship) && edge.targetName
      ? linesByPair.get(`${sourceId}\u0000${edge.relationship}\u0000${edge.targetName}`)
      : null;
    if (lines?.length) return { contextLine: lines[0], contextLines: lines };
    return { contextLine: edge.contextLine, contextLines: edge.contextLine ? [edge.contextLine] : [] };
  }

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
        CASE WHEN end_line - start_line = 0 THEN 1 ELSE 0 END,
        (end_line - start_line) ASC
      LIMIT 8
    `).all(...entityParams, ...names);
    // Same rule as build-time resolution: link only when the plausible
    // definitions are one type's (or one file's). Several owners left is a
    // guess — `socket.connect` must not land on RealWebSocket.connect.
    const plausible = rows.map(row => this._entityFromRow(row))
      .filter(e => e && isLikelyCodeEntity(e) && shouldTrustQualifiedResolution(targetName, e));
    if (plausible.length === 0) return null;
    const ownerKey = e => (e.parentClass ? `type:${e.parentClass}` : `file:${e.filePath}`);
    const first = ownerKey(plausible[0]);
    return plausible.every(e => ownerKey(e) === first) ? plausible[0] : null;
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
        CASE WHEN end_line - start_line = 0 THEN 1 ELSE 0 END,
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
    // `Owner.name` / `Owner::name`: the member named `name` of `Owner` comes
    // first — the way to reach one of several same-named members (a method
    // repeated in nested classes) that the trace lists as alternatives.
    const parts = raw.split(/::|\./).filter(Boolean);
    const suffix = parts.length > 1 ? parts[parts.length - 1] : raw;
    const qualifier = parts.length > 1 ? parts[parts.length - 2] : null;
    const ownedFirst = (list) => (qualifier
      ? [...list.filter(c => c?.parentClass === qualifier), ...list.filter(c => c?.parentClass !== qualifier)]
      : list);
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
             summary, parent_class, package,
             (SELECT COUNT(*) FROM relationships r WHERE r.target_id = entities.id) AS fan_in
      FROM entities
      WHERE ${entitySql}
        AND (${nameWhere})
        ${fileWhere}
      ORDER BY
        CASE WHEN parent_class IS ? THEN 0 ELSE 1 END,
        CASE
          WHEN name = ? THEN 0
          WHEN lower(name) = lower(?) THEN 1
          ELSE 2
        END,
        CASE WHEN file_path LIKE '%/test/%' OR file_path LIKE 'test/%' OR file_path LIKE 'tests/%' THEN 1 ELSE 0 END,
        CASE type
          WHEN 'class' THEN 0 WHEN 'struct' THEN 0 WHEN 'trait' THEN 0 WHEN 'object' THEN 0 WHEN 'actor' THEN 0
          WHEN 'interface' THEN 1 WHEN 'enum' THEN 1 WHEN 'type' THEN 1 WHEN 'typeAlias' THEN 1
          WHEN 'function' THEN 2 WHEN 'method' THEN 2
          ELSE 3
        END,
        CASE WHEN end_line - start_line = 0 THEN 1 ELSE 0 END,
        (end_line - start_line) ASC
      LIMIT ?
    `).all(...entityParams, ...params, qualifier ?? '\u0000', raw, raw, EXACT_CANDIDATE_POOL);
    if (exactRows.length) {
      const members = this._findAssignedMemberDefinitions(raw);
      const candidates = [...members, ...preferCalledDefinitions(exactRows, qualifier, raw).slice(0, limit).map(row => this._entityFromRow(row))].filter(Boolean);
      return ownedFirst(rankStructuralCandidates(candidates, { queryHint: opts.queryHint, readFileRange: this.readFileRange.bind(this) }));
    }

    // `--in <file>` names a file that CALLS the symbol but does not define it
    // (`ss-trace Replace --in DownstreamUrlCreatorMiddleware.cs`): resolve the name
    // through that file's call edges before any substring match, which used to land
    // on the field `_replacer` (`%Replace%`, case-insensitive) instead of the method.
    if (filePath) {
      const called = this._findCalledTargetsInFile(db, names, filePath, limit);
      if (called.length) {
        return ownedFirst(rankStructuralCandidates(called, { queryHint: opts.queryHint, readFileRange: this.readFileRange.bind(this) }));
      }
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

  /** Resolved targets named `names` of the calls / constructions made in `filePath`. */
  _findCalledTargetsInFile(db, names, filePath, limit) {
    try {
      const nameWhere = names.map(() => 'lower(t.name) = lower(?)').join(' OR ');
      const rows = db.prepare(`
        SELECT t.id, t.name, t.type, t.file_path, t.start_line, t.end_line, t.signature,
               t.summary, t.parent_class, t.package, MIN(r.context_line) AS first_line
        FROM relationships r
        JOIN entities s ON s.id = r.source_id
        JOIN entities t ON t.id = r.target_id
        WHERE r.type IN ('calls', 'instantiates')
          AND (s.file_path = ? OR s.file_path LIKE ?)
          AND (${nameWhere})
          AND ${this._relationshipSql(db, 'r')}
          AND ${this._entitySql(db, 's')}
          AND ${this._entitySql(db, 't')}
        GROUP BY t.id
        ORDER BY first_line ASC
        LIMIT ?
      `).all(filePath, `%${filePath}%`, ...names,
        ...this._relationshipParams(db), ...this._entityParams(db), ...this._entityParams(db), limit);
      return rows.map(row => this._entityFromRow(row)).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Run one caller query against symbols (`entities`) and, when the graph has
   * file nodes, against top-level code (`files`, infrastructure/file-nodes.js) with the
   * same WHERE clause. Top-level rows render as `(top-level) [file]` with the
   * call line as their span. Merged in the queries' own order
   * (weight DESC, file_path, context_line) and cut to `limit`.
   */
  _callerRows(db, sqlFor, params, limit) {
    const rows = db.prepare(sqlFor('entities')).all(...params);
    if (!hasFilesTable(db)) return rows;
    const top = db.prepare(sqlFor(fileNodeSourceSql())).all(...params).map(row => asTopLevelCaller(row));
    if (top.length === 0) return rows;
    return [...rows, ...top]
      .sort((a, b) => ((b.weight ?? 1) - (a.weight ?? 1))
        || String(a.file_path || '').localeCompare(String(b.file_path || ''))
        || ((a.context_line ?? 0) - (b.context_line ?? 0)))
      .slice(0, limit);
  }

  /**
   * `self.cmd.get_arguments()` bound to Command.get_arguments: the caller's own type
   * declares the field (`cmd: &'cmd mut Command`, `private final Command cmd;`,
   * `db *Database`). Short or abbreviated field names (`cmd`, `db`) name no type, so
   * the receiver-name gate dropped such edges.
   */
  _fieldReceiverBound(db, targetName, caller, resolved) {
    if (!this._declaredTypeIn || !caller?.parentClass || !resolved?.parentClass) return false;
    const parts = String(targetName || '').replace(/::/g, '.').split('.').filter(Boolean);
    if (parts.length === 3 && /^(?:self|this)$/.test(parts[0])) parts.shift();
    if (parts.length !== 2 || !/^[A-Za-z_]\w*$/.test(parts[0])) return false;
    const key = `${caller.parentClass}\0${parts[0]}`;
    this._fieldTypes ||= new Map();
    let type = this._fieldTypes.get(key);
    if (type === undefined) {
      type = null;
      try {
        const owners = db.prepare(`SELECT e.file_path, e.start_line, e.end_line FROM entities e
          WHERE ${this._entitySql(db, 'e')} AND e.name = ?
            AND e.type IN ('class','struct','record','object','trait','interface')
          ORDER BY CASE WHEN e.file_path = ? THEN 0 ELSE 1 END LIMIT 4`)
          .all(...this._entityParams(db), caller.parentClass, caller.filePath || '');
        for (const o of owners) {
          const text = this.readFileRange(o.file_path, o.start_line, o.end_line) || '';
          const found = this._declaredTypeIn(text, parts[0], o.file_path)?.type || null;
          if (found) { type = found; break; }
        }
      } catch {
        type = null;
      }
      this._fieldTypes.set(key, type);
    }
    return !!type && type === resolved.parentClass;
  }

  /**
   * `instance().handleSessionForResponse(` bound to HttpAppFrameworkImpl's method: the
   * call that made the receiver is a member of that same type (a singleton `instance()`,
   * a builder or fluent `with_x()`), so the receiver is that type. A call-result
   * receiver names no type, so the receiver-name gate dropped these edges.
   */
  _sameTypeChainBound(db, targetName, resolved) {
    const m = /(?:^|\.)([A-Za-z_]\w*)\(\)\.[A-Za-z_]\w*$/.exec(String(targetName || ''));
    if (!m || !resolved?.parentClass) return false;
    try {
      // Only a producer whose signature returns its own type (`static App &instance()`,
      // `-> Self`, `): this`): a factory `create(): Product` makes another type.
      const owner = resolved.parentClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const ownType = new RegExp(`\\b(?:${owner}|Self|this)\\b`);
      return db.prepare(`SELECT e.signature FROM entities e WHERE ${this._entitySql(db, 'e')} AND e.name = ? AND e.parent_class = ? LIMIT 4`)
        .all(...this._entityParams(db), m[1], resolved.parentClass)
        .some(r => ownType.test(String(r.signature || '').replace(new RegExp(`(?:\\w+::)*\\b${m[1]}\\b[\\s\\S]*?\\(`), '(')));
    } catch {
      return false;
    }
  }

  /** True when `line` of `filePath` lies strictly inside an indexed function or method body. */
  _insideCallable(filePath, line) {
    const db = this._open();
    if (!db) return false;
    try {
      return !!db.prepare(`SELECT 1 FROM entities e WHERE ${this._entitySql(db, 'e')} AND e.file_path = ?
        AND e.type IN ('function','method','constructor','arrowFunction','assignedFunc','objectMethod','objectArrow','shortFunction','def','func','proc','procedure')
        AND e.start_line < ? AND e.end_line >= ? LIMIT 1`).get(...this._entityParams(db), filePath, line, line);
    } catch {
      return false;
    }
  }

  /** Other definitions with the target's name (rivals for an unbound qualified call). */
  _namesakes(db, target) {
    try {
      return db.prepare(`SELECT e.id, e.file_path, e.parent_class, e.package, e.signature, e.summary, e.name
        FROM entities e WHERE ${this._entitySql(db, 'e')} AND e.name = ? LIMIT 200`)
        .all(...this._entityParams(db), target.name)
        .map(r => ({ id: r.id, name: r.name, filePath: r.file_path, parentClass: r.parent_class, package: r.package, signature: r.signature, summary: r.summary }));
    } catch {
      return null;
    }
  }

  getCallers(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id) return [];
    const limit = clampLimit(opts.limit, 120, 500);
    // ss-trace callers also list overriding methods and the code that
    // constructs a type (`instantiates`); typeRef stays opt-in (too many).
    const types = opts.types?.length ? opts.types : ['calls', 'uses', 'implements', 'extends', 'overrides', 'instantiates'];
    const patterns = [
      target.name,
      `${target.name}.%`,
      `${lowerCamel(target.name)}.%`,
      `%.${target.name}`,
      `%::${target.name}`,
    ];
    const entitySql = this._entitySql(db, 'e');
    const relationshipSql = this._relationshipSql(db, 'r');
    const rows = this._callerRows(db, (source) => `
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package,
        r.target_id, r.context_line, r.target_name, r.weight, r.type as rel_type, r.full_import_path,
        (SELECT t.file_path FROM entities t WHERE t.id = r.target_id LIMIT 1) AS resolved_file,
        (SELECT t.parent_class FROM entities t WHERE t.id = r.target_id LIMIT 1) AS resolved_parent
      FROM relationships r
      JOIN ${source} e ON e.id = r.source_id
      WHERE r.type IN (${placeholders(types)})
        AND ${entitySql}
        AND ${relationshipSql}
        -- The target itself only through a resolved call to itself (recursion).
        AND (e.id <> ? OR (r.target_id = e.id AND r.type = 'calls'))
        AND (
          r.target_id = ?
          OR (r.type NOT IN ${TRACE_ONLY_TYPES_SQL} AND (
            r.target_name = ?
            OR r.target_name LIKE ?
            OR r.target_name LIKE ?
            OR r.target_name LIKE ?
            OR r.target_name LIKE ?
          ))
        )
      ORDER BY r.weight DESC, e.file_path, r.context_line
      LIMIT ?
    `, [...types, ...this._entityParams(db), ...this._relationshipParams(db), target.id, target.id, ...patterns, limit], limit);
    // `did_you_mean.as_ref()` names a value, not the function did_you_mean: `name.member` is a
    // use of the target only when the target is a type or module (a static member, a
    // constructor) or through `.call` / `.apply` / `.bind`.
    const callableTarget = /^(?:function|method|arrowFunction|assignedFunc|shortFunction|objectMethod|objectArrow|def|func|macro)$/.test(String(target.type || ''));
    const memberOfName = (tn) => {
      const raw = String(tn || '');
      for (const head of [target.name, lowerCamel(target.name)]) {
        if (raw.startsWith(`${head}.`)) return !/^(?:call|apply|bind)$/.test(raw.slice(head.length + 1));
      }
      return false;
    };
    const named = rows.filter(row => !packageCallUnbound(row)
      && !(callableTarget && row.target_id !== target.id && memberOfName(row.target_name))).map(row => ({
      ...this._entityFromRow(row),
      relationship: row.rel_type,
      contextLine: row.context_line || null,
      targetId: row.target_id || null,
      targetName: row.target_name || null,
      resolvedFile: row.resolved_file || null,
      resolvedParent: row.resolved_parent || null,
      weight: row.weight ?? 1,
    }));
    // A self row is recursion only through the same object: no receiver, this/self, or the
    // owner's name (express `app.use` calls `router.use(`, which the index bound to app.use).
    // A self row is dropped only when its receiver names another known type (`router` ->
    // `Router`): then the index bound a call on that type to this definition. Recursion
    // through a field or a receiver variable (`self.left.insert`, Go `s.serve()`) stays.
    const typeNamed = (q) => {
      try {
        return !!db.prepare(`SELECT 1 FROM entities WHERE lower(name) = ? AND type IN ('class','struct','interface','trait','protocol','object','record','enum') LIMIT 1`).get(q);
      } catch { return false; }
    };
    const selfReceiver = (tn) => {
      const parts = String(tn || '').replace(/::|->/g, '.').split('.').filter(Boolean);
      if (parts.length < 2) return true;
      const q = parts[parts.length - 2].replace(/^[$@]+/, '').toLowerCase();
      if (q === String(target.parentClass || '').toLowerCase()) return true;
      return !typeNamed(q);
    };
    for (let i = named.length - 1; i >= 0; i--) if (named[i].id === target.id && !selfReceiver(named[i].targetName)) named.splice(i, 1);
    // Python: `pkg.method(` through a module the caller imports never reaches a class method.
    for (let i = named.length - 1; i >= 0; i--) if (this._pythonModuleCall(named[i].targetName, target, named[i].filePath)) named.splice(i, 1);
    const targetNested = this._qualifiedCallToNestedFunction(db, 'x.y', target);
    const namesakes = this._namesakes(db, target);
    const edges = named.filter(edge => trustedCallerEdge(edge, target, namesakes)
      && !(targetNested && /[.:]/.test(String(edge.targetName || ''))));
    // `opts.unresolved`: calls of the same name the graph bound to no definition and the
    // receiver check could not trust (`loadBalancer.Data.LeaseAsync(`). They are no caller
    // the graph knows, but the agent must know they exist.
    if (Array.isArray(opts.unresolved)) {
      for (const edge of named) {
        if (!edge.targetId && edge.relationship === 'calls' && !trustedCallerEdge(edge, target, namesakes)
          && !goPackagePrivateFrom(edge.filePath, target)) opts.unresolved.push(edge);
      }
    }
    const linesByPair = this._siteLines(db, edges.filter(e => SITE_LINE_TYPES.has(e.relationship)).map(e => e.id));
    return edges.map(edge => ({ ...edge, ...this._edgeLines(linesByPair, edge.id, edge) }));
  }

  /**
   * Query-time fallback for callers the extractor stored no edge for (bare
   * local calls in JS/TS, out-of-line C++ methods, …): scan the target's own
   * file for `name(` call sites outside the target's span and attribute each
   * to its innermost enclosing entity. Cheap (one cached file read) and
   * language-agnostic.
   */
  getSameFileCallers(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id || !target?.filePath || !target?.name || !target?.startLine) return [];
    const limit = clampLimit(opts.limit, 24, 60);
    const source = this.readFileRange(target.filePath, 1, 1000000);
    if (!source) return [];
    const escaped = String(target.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const callRe = new RegExp(`(?<![.\\w$:])${escaped}\\s*\\(`);
    const defRe = new RegExp(`\\b(function|def|fn|func|sub|proc)\\s+${escaped}\\s*[(<]`);
    const declLineRe = new RegExp(`^\\s*${escaped}\\s*\\(`);
    // A member declared in a type body: `protected abstract getPath(event: E): string`
    // (hono EventProcessor was listed as a caller of its subclasses' getPath).
    // Also with a return type (Java/C# `protected abstract String getPath(E e);`) and
    // accessors (`get getPath()`, `set path(v)`).
    const memberDeclRe = new RegExp(`^\\s*(?:(?:(?:public|private|protected|internal|abstract|static|override|virtual|readonly|async|final|open|declare|sealed|extern|unsafe|synchronized|native|default)\\s+)+(?:[\\w.$]+(?:<[^()]*>)?(?:\\[\\])*\\??\\s+)?|(?:get|set)\\s+)${escaped}\\s*[(<]`);
    // `@spec name(...)` / `@callback name(...)`: an attribute that declares the name's type.
    const attrDeclRe = new RegExp(`^\\s*@\\w+\\s+${escaped}\\s*\\(`);
    const lines = source.split('\n');
    const noCode = nonCodeLines(lines);
    const hits = [];
    for (let i = 0; i < lines.length && hits.length < limit * 2; i++) {
      const ln = i + 1;
      if (ln >= target.startLine && ln <= (target.endLine || target.startLine)) continue;
      if (noCode[i]) continue;
      const text = lines[i].replace(/(^|\s)(\/\/|#).*$/, '');
      if (callRe.test(text) && !defRe.test(text) && !attrDeclRe.test(text)) hits.push(ln);
    }
    if (!hits.length) return [];
    const entitySql = this._entitySql(db);
    const fileEntities = db.prepare(`
      SELECT id, name, type, file_path, start_line, end_line, signature,
             summary, parent_class, package
      FROM entities
      WHERE ${entitySql} AND file_path = ? AND start_line IS NOT NULL AND end_line IS NOT NULL
      ORDER BY start_line
    `).all(...this._entityParams(db), target.filePath);
    // Same-named definitions with different owners in this file (a member
    // repeated in several nested classes): a call made inside class X binds
    // to X's own definition, so it is not a caller of the others.
    const siblings = fileEntities.filter(r => r.name === target.name);
    const ownerOf = (host) => host.parent_class || (OWNER_TYPES.has(host.type) ? host.name : null);
    const out = [];
    const seen = new Set();
    for (const ln of hits) {
      const host = fileEntities
        .filter(r => r.start_line <= ln && r.end_line >= ln)
        .sort((a, b) => (a.end_line - a.start_line) - (b.end_line - b.start_line))[0];
      if (!host || host.id === target.id || host.name === target.name) continue;
      // `Name(ctx, in) (*Out, error)` on its own line inside an interface / protocol / trait
      // body declares the method; it calls nothing (dgraph pb_grpc.pb.go: the WorkerClient and
      // WorkerServer interfaces were listed as callers of UpdateExtSnapshotStreamingState).
      if (DECLARING_OWNER_TYPES.has(host.type) && declLineRe.test(lines[ln - 1])) continue;
      if (OWNER_TYPES.has(host.type) && memberDeclRe.test(lines[ln - 1])) continue;
      if (siblings.length > 1) {
        const owner = ownerOf(host);
        const own = owner ? siblings.find(s => s.parent_class === owner) : null;
        if (own && own.id !== target.id) continue;
      }
      const key = `${host.id}:${ln}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ...this._entityFromRow(host),
        relationship: 'calls',
        contextLine: ln,
        targetId: target.id,
        targetName: target.name,
        weight: 1,
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  _bareResolver(db) {
    if (this._bare?.db === db) return this._bare.resolver;
    let resolver = null;
    try {
      if (!this._BareCallResolver) throw new Error('no BareCallResolver passed');
      resolver = new this._BareCallResolver(db, {
        entitySql: (alias) => this._entitySql(db, alias),
        entityParams: this._entityParams(db),
        // call_sites carries the same epoch columns as relationships.
        siteSql: (alias) => this._relationshipSql(db, alias),
        siteParams: this._relationshipParams(db),
        relSql: (alias) => this._relationshipSql(db, alias),
        relParams: this._relationshipParams(db),
      });
    } catch {
      resolver = null;
    }
    this._bare = { db, resolver };
    return resolver;
  }

  /**
   * Callers through bare calls (`helper(x)`), resolved by scope rules at
   * query time (bare-call-resolution.js). Empty for graphs built before the
   * call_sites table existed.
   */
  getBareCallers(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id) return [];
    const resolver = this._bareResolver(db);
    if (!resolver?.available) return [];
    const limit = clampLimit(opts.limit, 80, 300);
    try {
      // call_sites has one row per site: one caller item per calling entity,
      // carrying every line it calls the target on.
      const byCaller = new Map();
      const ambiguousSites = Array.isArray(opts.ambiguous) ? [] : null;
      for (const row of resolver.callersOf(target, { limit: limit * 4, ambiguous: ambiguousSites })) {
        const line = row.context_line || null;
        const prev = byCaller.get(row.id);
        if (prev) {
          if (line && !prev.contextLines.includes(line)) prev.contextLines.push(line);
          continue;
        }
        if (byCaller.size >= limit) continue;
        byCaller.set(row.id, {
          ...this._entityFromRow(row),
          relationship: 'calls',
          contextLine: line,
          contextLines: line ? [line] : [],
          targetId: target.id,
          targetName: target.name,
          weight: 1,
          bare: true,
        });
      }
      for (const row of ambiguousSites || []) {
        opts.ambiguous.push({
          ...this._entityFromRow(row),
          relationship: 'calls',
          contextLine: row.context_line || null,
          targetId: null,
          targetName: target.name,
          weight: 1,
          bare: true,
        });
      }
      return [...byCaller.values()].map(sortLines);
    } catch {
      return [];
    }
  }

  getBareCallees(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id) return [];
    const resolver = this._bareResolver(db);
    if (!resolver?.available) return [];
    const limit = clampLimit(opts.limit, 80, 300);
    try {
      // One callee item per definition, carrying every line it is called on.
      const byCallee = new Map();
      for (const { entity, contextLine } of resolver.calleesOf(target, { limit: limit * 4 })) {
        const line = contextLine || null;
        const prev = byCallee.get(entity.id);
        if (prev) {
          if (line && !prev.contextLines.includes(line)) prev.contextLines.push(line);
          continue;
        }
        if (byCallee.size >= limit) continue;
        byCallee.set(entity.id, {
          ...this._entityFromRow(entity),
          relationship: 'calls',
          contextLine: line,
          contextLines: line ? [line] : [],
          weight: 1,
          bare: true,
        });
      }
      return [...byCallee.values()].map(sortLines);
    } catch {
      return [];
    }
  }

  getAliasCallers(target, opts = {}) {
    const db = this._open();
    if (!db || !target?.id) return [];
    return findAliasCallers({ db, target, readFileRange: this.readFileRange.bind(this), limit: clampLimit(opts.limit, 40, 200), entityVisibilitySql: this._entitySql(db), entityVisibilityParams: this._entityParams(db), mapEntity: row => this._entityFromRow(row) });
  }

  /** `pkg.name(` in `callerFile` where `pkg` is a module the caller imports and `entity` a class method. */
  _pythonModuleCall(targetName, entity, callerFile) {
    if (!callerFile || !pythonPackageCallOnMethod(targetName, entity)) return false;
    const parts = String(targetName).split('.').filter(Boolean);
    const q = parts[parts.length - 2];
    this._pyImportMemo ||= new Map();
    const key = `${callerFile}\u0000${q}`;
    if (this._pyImportMemo.has(key)) return this._pyImportMemo.get(key);
    const head = this.readFileRange(callerFile, 1, 400) || '';
    const re = new RegExp(`^\\s*(?:import\\s+(?:[\\w.]+\\.)?${q}\\b|from\\s+[\\w.]+\\s+import\\s+(?:\\([^)]*?|[^\\n]*?)\\b${q}\\b)`, 'm');
    const hit = re.test(head);
    this._pyImportMemo.set(key, hit);
    return hit;
  }

  /**
   * A call written with a receiver (`reply.send(`) bound to a function nested inside another
   * function: a nested function is local to its enclosing body and never reachable through a
   * receiver (fastify `reply.send` was bound to `function send ()` inside sendTrailer).
   */
  _qualifiedCallToNestedFunction(db, targetName, entity) {
    if (!/[.:]/.test(String(targetName || '')) || !entity?.id || !entity.filePath || !Number.isInteger(entity.startLine)) return false;
    if (entity.parentClass || !['function', 'arrowFunction', 'objectArrow'].includes(entity.type)) return false;
    this._nestedMemo ||= new Map();
    if (this._nestedMemo.has(entity.id)) return this._nestedMemo.get(entity.id);
    let nested = false;
    try {
      const host = db.prepare(`
        SELECT e.start_line, e.end_line FROM entities e
        WHERE e.file_path = ? AND e.id <> ? AND e.type IN ('function', 'method', 'arrowFunction', 'objectArrow')
          AND e.start_line < ? AND e.end_line >= ? AND ${this._entitySql(db, 'e')}
        ORDER BY (e.end_line - e.start_line) ASC LIMIT 1
      `).get(entity.filePath, entity.id, entity.startLine, entity.endLine ?? entity.startLine, ...this._entityParams(db));
      // Local only when the name never leaves the enclosing body as a property: not returned,
      // not put in an object (`{ addHook, ready }` / `ready: ready`), not assigned (`x.f = f`).
      // fastify's factory returns its nested functions as the instance's methods. Passing it
      // as a callback argument does not make it reachable as `recv.name(`.
      if (host) {
        const body = this.readFileRange(entity.filePath, host.start_line, host.end_line) || '';
        const n = String(entity.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // (`^\s*name,$`: a shorthand property on its own line, as in fastify's instance object.)
        const escapes = new RegExp(`(?:return\\s+${n}\\b|^\\s*${n}\\s*,?\\s*$|[{,]\\s*${n}\\s*[,}]|:\\s*${n}\\s*[,}\\n]|=\\s*${n}\\s*[;,\\n)])`, 'm');
        nested = !escapes.test(body);
      }
    } catch { nested = false; }
    this._nestedMemo.set(entity.id, nested);
    return nested;
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
        r.context_line, r.target_name, r.weight, r.type as rel_type, r.full_import_path
      FROM relationships r
      LEFT JOIN entities e ON e.id = r.target_id AND ${entitySql}
      WHERE r.source_id = ?
        AND r.type = 'calls'
        AND ${relationshipSql}
      ORDER BY r.context_line, r.weight DESC
      LIMIT ?
    `).all(...this._entityParams(db), target.id, ...this._relationshipParams(db), limit);
    const linesByPair = this._siteLines(db, [target.id]);
    return rows.map((row, idx) => {
      let resolved = row.id ? this._entityFromRow(row) : ((!packageCallUnbound(row) && this._resolveUnresolvedTarget(row.target_name)) || {
        id: `external:${idx}:${row.target_name || 'unknown'}`,
        name: row.target_name || 'external',
        type: 'external',
        filePath: null,
        startLine: null,
        endLine: null,
        signature: row.target_name || '',
        summary: '',
      });
      if (row.id && !packageCallBound(row) && !declaredReceiverBound(row.target_name, target, resolved)
        && !trustedCalleeEdge(row.target_name, resolved) && !this._fieldReceiverBound(db, row.target_name, target, resolved)
        && !this._sameTypeChainBound(db, row.target_name, resolved)) resolved = { id: `external:${idx}:${row.target_name || 'unknown'}`, name: row.target_name || 'external', type: 'external', filePath: null, startLine: null, endLine: null, signature: row.target_name || '', summary: '' };
      if (row.id && (this._qualifiedCallToNestedFunction(db, row.target_name, resolved) || this._pythonModuleCall(row.target_name, resolved, target.filePath))) resolved = { id: `external:${idx}:${row.target_name || 'unknown'}`, name: row.target_name || 'external', type: 'external', filePath: null, startLine: null, endLine: null, signature: row.target_name || '', summary: '' };
      if (resolved.id === target.id) {
        resolved = this._resolveQualifiedAlternative(row.target_name, target.id) || resolved;
      }
      const edge = {
        ...resolved,
        relationship: row.rel_type,
        contextLine: row.context_line || null,
        targetName: row.target_name || null,
        weight: row.weight ?? 1,
      };
      return { ...edge, ...this._edgeLines(linesByPair, target.id, edge) };
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

    const rows = this._callerRows(db, (source) => `
      SELECT DISTINCT
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package,
        r.target_id, r.target_name, r.context_line, r.weight, r.type as rel_type, r.full_import_path,
        (SELECT t.file_path FROM entities t WHERE t.id = r.target_id LIMIT 1) AS resolved_file,
        (SELECT t.parent_class FROM entities t WHERE t.id = r.target_id LIMIT 1) AS resolved_parent
      FROM relationships r
      JOIN ${source} e ON e.id = r.source_id
      WHERE ${entitySql}
        AND ${relationshipSql}
        AND r.type IN (${placeholders(types)})
        AND (r.target_id IN (${placeholders(ids)}) ${nameClause})
      ORDER BY r.weight DESC, e.file_path, r.context_line
      LIMIT ?
    `, [...this._entityParams(db), ...this._relationshipParams(db), ...types, ...ids, ...nameParams, limit], limit);

    // Rows admitted by the name-pattern clause (not by target_id) are subject
    // to the same receiver-compat gate as getCallers — otherwise the phantom
    // `this.fetch`-style edges re-enter through impact paths. resolvedFile /
    // resolvedParent let the gate drop a call that resolution already bound
    // to ANOTHER same-named definition (GRDB: `database.statementDidFail` in
    // Statement.swift is Database's method, not the broker's).
    const idSet = new Set(ids);
    return rows.filter(row => !packageCallUnbound(row)).map(row => ({
      ...this._entityFromRow(row),
      relationship: row.rel_type,
      targetId: row.target_id || null,
      targetName: row.target_name || null,
      resolvedFile: row.resolved_file || null,
      resolvedParent: row.resolved_parent || null,
      contextLine: row.context_line || null,
      weight: row.weight ?? 1,
    })).filter(edge => (edge.targetId && idSet.has(edge.targetId)) || trustedCallerEdge(edge, target, this._namesakes(db, target)));
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
        r.source_id, r.target_id, r.target_name, r.context_line, r.weight, r.type as rel_type, r.full_import_path,
        e.id, e.name, e.type, e.file_path, e.start_line, e.end_line,
        e.signature, e.summary, e.parent_class, e.package,
        (SELECT s.signature FROM entities s WHERE s.id = r.source_id LIMIT 1) AS source_signature
      FROM relationships r
      LEFT JOIN entities e ON e.id = r.target_id AND ${entitySql}
      WHERE r.source_id IN (${placeholders(ids)})
        AND r.type IN (${placeholders(types)})
        AND ${relationshipSql}
      ORDER BY r.weight DESC, r.source_id, r.context_line
      LIMIT ?
    `).all(...this._entityParams(db), ...ids, ...types, ...this._relationshipParams(db), limit);

    return rows.map((row, idx) => {
      let resolved = row.id ? this._entityFromRow(row) : ((!packageCallUnbound(row) && this._resolveUnresolvedTarget(row.target_name)) || {
        id: `external:${row.source_id}:${idx}:${row.target_name || 'unknown'}`,
        name: row.target_name || 'external',
        type: 'external',
        filePath: null,
        startLine: null,
        endLine: null,
        signature: row.target_name || '',
        summary: '',
      });
      if (row.id && !packageCallBound(row) && !declaredReceiverBound(row.target_name, { signature: row.source_signature }, resolved)
        && !trustedCalleeEdge(row.target_name, resolved)) resolved = { id: `external:${row.source_id}:${idx}:${row.target_name || 'unknown'}`, name: row.target_name || 'external', type: 'external', filePath: null, startLine: null, endLine: null, signature: row.target_name || '', summary: '' };
      if (row.id && this._qualifiedCallToNestedFunction(db, row.target_name, resolved)) resolved = { id: `external:${row.source_id}:${idx}:${row.target_name || 'unknown'}`, name: row.target_name || 'external', type: 'external', filePath: null, startLine: null, endLine: null, signature: row.target_name || '', summary: '' };
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

  /**
   * Resolve a term to its same-file definition. The entity table is consulted
   * FIRST: it is language-agnostic and already holds Java fields, C# properties,
   * Kotlin members and every other shape the regex list below never learned
   * (smoke-loss forensics 2026-09-03: `subQueryMeasures`, a Java field, was a
   * top target term of the traced method and resolved to nothing while the
   * graph held it as type 'field'). The source-text regex scan remains as the
   * fallback for unindexed files only.
   */
  findSameFileDefinition(name, filePath) {
    const indexed = this._findIndexedSameFileDefinition(name, filePath);
    if (indexed) return indexed;
    const found = findSameFileDefinition({ name, filePath, readFileRange: this.readFileRange.bind(this) });
    // A value declared inside an indexed function body is that function's local
    // (ky `const retry = …` in #calculateRetryDelay was a "constant retry" callee of #retry).
    if (found && !/^(?:function|method|class|struct|interface|trait|enum|type)/.test(String(found.type || '')) && this._insideCallable(filePath, found.startLine)) return null;
    return found;
  }

  _findIndexedSameFileDefinition(name, filePath) {
    const db = this._open();
    const raw = String(name || '').trim();
    if (!db || !raw || !filePath) return null;
    try {
      // Smallest span wins so a field beats the class that declares it and a
      // method beats its enclosing class; an unnamed-span row (start = end,
      // typical of a bare declaration) is fine here — a field IS one line.
      const row = db.prepare(`
        SELECT id, name, type, file_path, start_line, end_line, signature,
               summary, parent_class, package
        FROM entities
        WHERE ${this._entitySql(db)}
          AND file_path = ?
          AND name = ?
          AND start_line IS NOT NULL
        ORDER BY (end_line - start_line) ASC, start_line ASC
        LIMIT 1
      `).get(...this._entityParams(db), filePath, raw);
      if (!row) return null;
      const entity = this._entityFromRow(row);
      if (!entity) return null;
      // The related-definitions line prints the summary as its snippet; a
      // declaration's signature is the honest snippet when no summary exists.
      return { ...entity, summary: entity.summary || entity.signature || '' };
    } catch {
      return null;
    }
  }

  /**
   * Definition that a `self.name(` / `this.name(` call in `target` reaches: an
   * indexed callable named `name` in the target's own file. The target's own
   * owning type wins when it has one. Several owners left is a guess, so the
   * answer is then null (same exactly-one rule as _resolveUnresolvedTarget).
   */
  findSameFileMember(name, target) {
    const db = this._open();
    const raw = String(name || '').trim();
    if (!db || !raw || !target?.filePath) return null;
    try {
      const rows = db.prepare(`
        SELECT id, name, type, file_path, start_line, end_line, signature,
               summary, parent_class, package
        FROM entities
        WHERE ${this._entitySql(db)}
          AND file_path = ?
          AND name = ?
          AND start_line IS NOT NULL
        ORDER BY start_line ASC
        LIMIT 16
      `).all(...this._entityParams(db), target.filePath, raw)
        .map(row => this._entityFromRow(row))
        .filter(e => e && e.id !== target.id && isLikelyCodeEntity(e));
      const sameOwner = target.parentClass ? rows.filter(e => e.parentClass === target.parentClass) : [];
      const pool = sameOwner.length ? sameOwner : rows;
      if (!pool.length) return null;
      const ownerKey = e => e.parentClass || '';
      return pool.every(e => ownerKey(e) === ownerKey(pool[0])) ? pool[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * The definition an UNQUALIFIED call `name(` reaches when nothing resolved it: the one
   * free (ownerless) definition in the repository with exactly this name, else null.
   * A bare call never reaches another type's method (dgraph `getUID(t)`, a local closure,
   * was bound to `User.GetUid` by a case-insensitive match; okhttp `check(...)`, Kotlin's
   * stdlib, to `CertificatePinner.check`), and a name with several free definitions is a
   * guess (same exactly-one rule as _resolveUnresolvedTarget). No substring match: the
   * annotation `@Throws(` is no call of `getHeadersThrows`.
   */
  findUniqueFreeDefinition(name) {
    const db = this._open();
    const raw = String(name || '').trim();
    if (!db || !raw) return null;
    try {
      const rows = db.prepare(`
        SELECT id, name, type, file_path, start_line, end_line, signature,
               summary, parent_class, package
        FROM entities
        WHERE ${this._entitySql(db)}
          AND name = ?
        LIMIT 4
      `).all(...this._entityParams(db), raw)
        .map(row => this._entityFromRow(row))
        .filter(e => e && isLikelyCodeEntity(e));
      if (rows.length !== 1 || rows[0].parentClass) return null;
      return rows[0];
    } catch {
      return null;
    }
  }

  /** How many visible definitions carry exactly this name (null when unknown). */
  countDefinitions(name) {
    const db = this._open();
    const raw = String(name || '').trim();
    if (!db || !raw) return null;
    try {
      return db.prepare(`SELECT COUNT(*) AS n FROM entities WHERE ${this._entitySql(db)} AND name = ?`)
        .get(...this._entityParams(db), raw)?.n ?? null;
    } catch {
      return null;
    }
  }

  /** The methods `target` overrides or implements (stored `overrides` edges), resolved. */
  getOverriddenMethods(target) {
    const db = this._open();
    if (!db || !target?.id) return [];
    try {
      return db.prepare(`
        SELECT e.id, e.name, e.type, e.file_path, e.start_line, e.end_line, e.signature,
               e.summary, e.parent_class, e.package
        FROM relationships r
        JOIN entities e ON e.id = r.target_id
        WHERE r.source_id = ? AND r.type = 'overrides'
          AND ${this._entitySql(db, 'e')}
          AND ${this._relationshipSql(db, 'r')}
        LIMIT 8
      `).all(target.id, ...this._entityParams(db), ...this._relationshipParams(db))
        .map(row => this._entityFromRow(row))
        .filter(e => e && e.id !== target.id);
    } catch {
      return [];
    }
  }

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
