/**
 * Bare-call resolution (`helper(x)` — a call with no receiver).
 *
 * Bare call sites live in the `call_sites` table, never in `relationships`,
 * so no ranking signal reads them. ss-trace resolves them here, at query
 * time, by the language's scope rules — the names a bare call can reach:
 *
 *   owner    a method of the caller's own type (implicit `this`/`self`:
 *            Java, C#, Kotlin, Swift, Scala, C++, Ruby, Dart, Groovy)
 *   file     a top-level function in the caller's file
 *   imports  a top-level function in a file the caller's file imports
 *            (`importsFile` edges; C-family: also the header's .c/.cpp twin)
 *   package  a top-level function in the caller's directory (Go package)
 *   global   the only non-test top-level function with that name (C, C++,
 *            PHP, Lua, R)
 *
 * Tiers are tried in order; the first non-empty tier decides. A tier with
 * several definitions links only when they are one overload set (same file,
 * same owner); otherwise the call stays unresolved — a missing edge is
 * better than a wrong one (graphify's exactly-one guard). Python and JS/TS
 * never reach a method bare, and a bare name that only an unrelated file
 * defines is never linked.
 */

import { createHash } from 'crypto';
import path from 'path';
import { EXTENSION_MAP } from '../infrastructure/language-patterns/maps.js';
import { createCallResolutionIndex, isTestPath } from './relationship-resolver.js';

const OWNER = 'owner';
const FILE = 'file';
const IMPORTS = 'imports';
const PACKAGE = 'package';
const GLOBAL = 'global';

const SCOPES_BY_LANGUAGE = {
  python: [FILE, IMPORTS],
  javascript: [FILE, IMPORTS],
  typescript: [FILE, IMPORTS],
  tsx: [FILE, IMPORTS],
  rust: [FILE, IMPORTS],
  go: [FILE, PACKAGE],
  java: [OWNER],
  csharp: [OWNER],
  kotlin: [OWNER, FILE, IMPORTS, PACKAGE],
  scala: [OWNER, FILE, IMPORTS],
  // No global tier where overloads resolve by argument type and share names
  // with the standard library (Swift `min(a, b)` is not a repo `min`).
  swift: [OWNER, FILE],
  dart: [OWNER, FILE, IMPORTS],
  groovy: [OWNER, FILE],
  ruby: [OWNER, FILE, IMPORTS],
  php: [FILE, IMPORTS, GLOBAL],
  c: [FILE, IMPORTS, GLOBAL],
  cpp: [OWNER, FILE, IMPORTS, GLOBAL],
  objc: [FILE, IMPORTS, GLOBAL],
  lua: [FILE, IMPORTS, GLOBAL],
  elixir: [FILE, IMPORTS],
  shell: [FILE, IMPORTS],
  perl: [FILE, IMPORTS],
  r: [FILE, GLOBAL],
  julia: [FILE, IMPORTS],
  zig: [FILE, IMPORTS],
  solidity: [OWNER, FILE, IMPORTS],
};
const DEFAULT_SCOPES = [FILE];
const C_FAMILY = new Set(['c', 'cpp', 'objc']);
const FILE_PRIVATE_SIGNATURE = /^\s*(?:local|static)\b/;

export const BARE_CALLABLE_TYPES = new Set([
  'function', 'method', 'rpc', 'arrowFunction', 'objectArrow', 'objectMethod', 'procedure', 'subroutine', 'macro_function',
  // Registry entity types: Lua `local f = function`, Julia `f(x) = …`, Elixir `defp`.
  'assignedFunc', 'shortFunction', 'private',
]);

export function languageOfPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return EXTENSION_MAP[ext] || null;
}

function dirOf(filePath) {
  const p = String(filePath || '');
  const slash = p.lastIndexOf('/');
  return slash >= 0 ? p.slice(0, slash) : '';
}

function stemOf(filePath) {
  const base = path.posix.basename(String(filePath || ''));
  const dot = base.lastIndexOf('.');
  return `${dirOf(filePath)}/${dot > 0 ? base.slice(0, dot) : base}`;
}

/** Imported file or (Go) its package directory `dir/`; C-family headers also cover their source twin. */
function isVisibleViaImport(imported, filePath, language) {
  if (!imported) return false;
  if (imported.has(filePath)) return true;
  const slash = filePath.lastIndexOf('/');
  if (slash > 0 && imported.has(filePath.slice(0, slash + 1))) return true;
  if (C_FAMILY.has(language)) {
    const stem = stemOf(filePath);
    for (const h of imported) if (stemOf(h) === stem) return true;
  }
  return false;
}

/** One overload set: every definition in one file under one owner. */
function asDecision(tier, ownerOf, preferNonTest) {
  if (tier.length === 0) return null;
  let pool = tier;
  if (pool.length > 1 && preferNonTest) {
    const prod = pool.filter(c => !isTestPath(c.file_path));
    if (prod.length > 0) pool = prod;
  }
  if (pool.length === 1) return pool;
  const file = pool[0].file_path;
  const owner = ownerOf(pool[0]);
  return pool.every(c => c.file_path === file && ownerOf(c) === owner) ? pool : [];
}

/**
 * Definitions a bare call `name(…)` in `caller` reaches, or [] when none or
 * ambiguous. `candidates`: callable entities named `name` (any file).
 *
 * @param {object} caller - entity making the call
 * @param {object[]} candidates
 * @param {{ ownerOf: Function, importsOf: Function }} index
 * @returns {object[]} the chosen overload set (empty = unresolved)
 */
export function resolveBareCall(caller, candidates, index) {
  if (!caller || !candidates || candidates.length === 0) return [];
  const { ownerOf, importsOf } = index;
  const language = languageOfPath(caller.file_path);
  const scopes = SCOPES_BY_LANGUAGE[language] || DEFAULT_SCOPES;
  const enclosingFunctionOf = index.enclosingFunctionOf || (() => null);
  // A function nested in another function (a local helper, a closure) is
  // visible only inside that function's span.
  const visibleNested = (c) => {
    const host = enclosingFunctionOf(c);
    if (!host) return true;
    if (host.id === caller.id) return true;
    return caller.file_path === host.file_path
      && caller.start_line >= host.start_line && (caller.end_line ?? caller.start_line) <= host.end_line;
  };
  const pool = candidates.filter(c => c.id !== caller.id && visibleNested(c)); // no self loops
  if (pool.length === 0) return [];
  const preferNonTest = !isTestPath(caller.file_path);
  const callerOwner = ownerOf(caller);
  const ownerless = pool.filter(c => !ownerOf(c));

  for (const scope of scopes) {
    let tier;
    if (scope === OWNER) {
      if (!callerOwner) continue;
      tier = pool.filter(c => ownerOf(c) === callerOwner);
    } else if (scope === FILE) {
      tier = ownerless.filter(c => c.file_path === caller.file_path);
    } else if (scope === IMPORTS) {
      const imported = importsOf(caller.file_path);
      if (!imported) continue;
      tier = ownerless.filter(c => isVisibleViaImport(imported, c.file_path, language));
    } else if (scope === PACKAGE) {
      const dir = dirOf(caller.file_path);
      tier = ownerless.filter(c => dirOf(c.file_path) === dir);
    } else {
      const sameFamily = (l) => l === language || (C_FAMILY.has(language) && C_FAMILY.has(l));
      // `static` (C/C++) and `local` (Lua) functions are file-private.
      tier = ownerless.filter(c => sameFamily(languageOfPath(c.file_path)) && !FILE_PRIVATE_SIGNATURE.test(c.signature || ''));
    }
    if (tier.length === 0) continue;
    return asDecision(tier, ownerOf, preferNonTest) || [];
  }
  return [];
}

/** Graph id of a file node in a full build (GraphExtractor.makeId(path, 'file', basename)). */
function fileNodeId(filePath) {
  return createHash('sha256').update(`${filePath}:file:${path.basename(filePath)}`).digest('hex').slice(0, 16);
}

const ENTITY_COLS = 'e.rowid AS _rowid, e.id, e.name, e.type, e.file_path, e.start_line, e.end_line, e.signature, e.parent_class';
const CONTAINER_TYPES = ['class', 'struct', 'interface', 'trait', 'impl', 'enum', 'extension', 'protocol', 'object', 'namespace', 'module', 'record', 'actor', 'union'];
const HOST_TYPES = [...CONTAINER_TYPES, ...BARE_CALLABLE_TYPES];

function chunks(values, size = 400) {
  const list = [...values];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Data access for bare-call resolution over one graph DB.
 * `entitySql(alias)` / `entityParams` and `siteSql(alias)` / `siteParams`
 * apply the reader's visibility (epoch) rules.
 */
export class BareCallResolver {
  constructor(db, { entitySql = () => '1=1', entityParams = [], siteSql = () => '1=1', siteParams = [], relSql = () => '1=1', relParams = [] } = {}) {
    this.db = db;
    this.entitySql = entitySql;
    this.entityParams = entityParams;
    this.siteSql = siteSql;
    this.siteParams = siteParams;
    this.relSql = relSql;
    this.relParams = relParams;
    this.available = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='call_sites'").get();
  }

  _callablesNamed(names) {
    const out = [];
    const types = [...BARE_CALLABLE_TYPES];
    for (const part of chunks(names)) {
      out.push(...this.db.prepare(`
        SELECT ${ENTITY_COLS} FROM entities e
        WHERE e.name IN (${part.map(() => '?').join(',')}) AND e.type IN (${types.map(() => '?').join(',')}) AND ${this.entitySql('e')}
      `).all(...part, ...types, ...this.entityParams));
    }
    return out;
  }

  /** Owner lookups + imports for the files involved. */
  _index(entities) {
    const files = new Set(entities.map(e => e.file_path).filter(Boolean));
    const extra = [];
    for (const part of chunks(files)) {
      extra.push(...this.db.prepare(`
        SELECT ${ENTITY_COLS} FROM entities e
        WHERE e.file_path IN (${part.map(() => '?').join(',')})
          AND (e.type IN (${HOST_TYPES.map(() => '?').join(',')}) OR e.type = 'file')
          AND ${this.entitySql('e')}
      `).all(...part, ...HOST_TYPES, ...this.entityParams));
    }
    const byRowid = new Map();
    for (const e of [...entities, ...extra]) if (!byRowid.has(e._rowid ?? e.id)) byRowid.set(e._rowid ?? e.id, e);
    const all = [...byRowid.values()].sort((a, b) => (a._rowid ?? 0) - (b._rowid ?? 0));

    // Callables of these files, for nested-function visibility.
    const callablesByFile = new Map();
    for (const e of all) {
      if (!BARE_CALLABLE_TYPES.has(e.type) || e.start_line == null || e.end_line == null) continue;
      let list = callablesByFile.get(e.file_path);
      if (!list) { list = []; callablesByFile.set(e.file_path, list); }
      list.push(e);
    }
    for (const list of callablesByFile.values()) list.sort((a, b) => a.start_line - b.start_line);
    const hostMemo = new Map();
    const enclosingFunctionOf = (e) => {
      if (hostMemo.has(e.id)) return hostMemo.get(e.id);
      let host = null;
      const end = e.end_line ?? e.start_line;
      for (const f of callablesByFile.get(e.file_path) || []) {
        if (f.start_line > e.start_line) break;
        if (f.id !== e.id && f.end_line >= end && (f.start_line < e.start_line || f.end_line > end)) host = f;
      }
      hostMemo.set(e.id, host);
      return host;
    };

    const fileIdToPath = new Map();
    for (const f of files) fileIdToPath.set(fileNodeId(f), f);
    for (const e of extra) if (e.type === 'file') fileIdToPath.set(e.id, e.file_path);
    const fileImports = new Map();
    for (const part of chunks(fileIdToPath.keys())) {
      const rows = this.db.prepare(`
        SELECT r.source_id, r.target_name FROM relationships r
        WHERE r.type = 'importsFile' AND r.source_id IN (${part.map(() => '?').join(',')}) AND ${this.relSql('r')}
      `).all(...part, ...this.relParams);
      for (const r of rows) {
        const from = fileIdToPath.get(r.source_id);
        if (!from) continue;
        let set = fileImports.get(from);
        if (!set) { set = new Set(); fileImports.set(from, set); }
        set.add(r.target_name);
      }
    }
    return { ...createCallResolutionIndex(all, { fileImports }), enclosingFunctionOf };
  }

  /** Entities whose bare calls resolve to `target`: [{ caller row, contextLine }]. */
  callersOf(target, { limit = 120 } = {}) {
    if (!this.available || !target?.id || !target?.name || !BARE_CALLABLE_TYPES.has(target.type)) return [];
    const sites = this.db.prepare(`
      SELECT ${ENTITY_COLS}, e.summary, e.package, cs.context_line AS context_line
      FROM call_sites cs JOIN entities e ON e.id = cs.source_id
      WHERE cs.callee_name = ? AND ${this.siteSql('cs')} AND ${this.entitySql('e')} AND e.id <> ?
      ORDER BY e.file_path, cs.context_line
      LIMIT ?
    `).all(target.name, ...this.siteParams, ...this.entityParams, target.id, limit * 4);
    if (sites.length === 0) return [];
    const candidates = this._callablesNamed([target.name]);
    if (!candidates.some(c => c.id === target.id)) return [];
    const index = this._index([...candidates, ...sites]);
    const out = [];
    for (const site of sites) {
      const chosen = resolveBareCall(site, candidates, index);
      if (chosen.some(c => c.id === target.id)) out.push(site);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Definitions `source` calls bare: [{ callee entity, contextLine }]. */
  calleesOf(source, { limit = 120 } = {}) {
    if (!this.available || !source?.id) return [];
    const sites = this.db.prepare(`
      SELECT cs.callee_name, cs.context_line FROM call_sites cs
      WHERE cs.source_id = ? AND ${this.siteSql('cs')}
      ORDER BY cs.context_line LIMIT ?
    `).all(source.id, ...this.siteParams, limit * 4);
    if (sites.length === 0) return [];
    const caller = this.db.prepare(`SELECT ${ENTITY_COLS} FROM entities e WHERE e.id = ? AND ${this.entitySql('e')}`).get(source.id, ...this.entityParams);
    if (!caller) return [];
    const candidates = this._callablesNamed([...new Set(sites.map(s => s.callee_name))]);
    if (candidates.length === 0) return [];
    const byName = new Map();
    for (const c of candidates) {
      let list = byName.get(c.name);
      if (!list) { list = []; byName.set(c.name, list); }
      list.push(c);
    }
    const index = this._index([...candidates, caller]);
    const out = [];
    for (const site of sites) {
      const chosen = resolveBareCall(caller, byName.get(site.callee_name) || [], index);
      if (chosen.length > 0) out.push({ entity: chosen[0], contextLine: site.context_line });
      if (out.length >= limit) break;
    }
    return out;
  }
}
