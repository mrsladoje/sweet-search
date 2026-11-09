/**
 * Renders code-graph neighbours (callers, callees, types, imports) for the top result and extracts type candidates from code.
 */

import path from 'path';
import { rankingRelationshipTypes } from '../../infrastructure/relationship-types.js';
import { trustedCalleeEdge } from '../../infrastructure/structural-qualified-resolution.js';
import { isTestLikePath } from '../../infrastructure/test-paths.js';
import { GO_PACKAGE_PREFIX, RUST_PATH_PREFIX, UNRESOLVED_IMPORT_PREFIX } from '../../infrastructure/import-path-prefixes.js';
import { RECEIVER_TYPE_PREFIX } from '../../infrastructure/receiver-type-annotation.js';
import { LANG_KEYWORDS } from './header-context.js';
import { RELATED_DEFAULT_ROWS, RELATED_FANIN_PROBE, RELATED_GENERIC_DEFS, RELATED_AMBIGUOUS_DEFS, RELATED_AMBIGUOUS_FANIN, safeCall, selectRelatedRows, shortestUniquePath, renderRelatedRowLine, subjectOf } from './related-rows.js';
import { estimateTokens } from './budget.js';

// An `imports` row annotated with the repo file it loads (no entity target):
// a repo-relative path, or a Go / Terraform / Swift package dir ending '/'.
// Java rows carry a dotted FQN instead (`com.example.app.R`), never a path.
const IMPORT_FILE_EXT_RE = /\.(?:[cm]?[jt]sx?|mts|cts|py|pyi|rs|go|h|hh|hpp|hxx|c|cc|cpp|cxx|m|mm|java|kts?|scala|groovy|rb|php|dart|cs|swift|exs?|lua|zig|l?hs|clj[cs]?|sol|sh|bash|zsh|proto|jl|elm|p[lm]|[rR]|ps[dm]?1|[eh]rl|cr|s[ac]ss|less|css|vue|svelte|astro|tf)$/;

function isResolvedImportFile(p) {
  if (p.endsWith('/')) return true;
  // Root-level files have one dot (`utils.py`); FQNs have more or no slash.
  return (p.includes('/') || p.indexOf('.') === p.lastIndexOf('.')) && IMPORT_FILE_EXT_RE.test(p) && !/^[\w$]+(?:\.[\w$]+){2,}$/.test(p);
}

/**
 * Pack modes that never carry the 1-hop graph-neighbour tier. Pattern mode is
 * ColGrep (ss-find, `sweet-search grep -e`, MCP `regex`): regex plus semantic
 * rerank. The tier is bloat there, so it is neither computed nor reserved.
 * This is the ONE place that decides; the printers only render what exists.
 */
const GRAPH_NEIGHBORS_EXCLUDED_MODES = new Set(['pattern']);

/**
 * @param {{ mode?: string|null, ablations?: Set<string> }} ctx
 * @returns {boolean} true when packageForAgent may build `neighbors` for top-1
 */
export function graphNeighborsEnabled({ mode = null, ablations = new Set() } = {}) {
  if (ablations.has('no-graph-neighbors')) return false;
  return !GRAPH_NEIGHBORS_EXCLUDED_MODES.has(mode);
}

/**
 * A Go type whose name starts lowercase is unexported: only code of its own package (its
 * directory) can name it. dgraph AssignIds (dgraph/cmd/zero) was linked to `struct
 * rateLimiter` of package worker by name alone.
 */
function goUnexportedElsewhere(fromFile, t) {
  if (!/\.go$/.test(String(fromFile || '')) || !/\.go$/.test(String(t?.filePath || ''))) return false;
  if (!/^[a-z_]/.test(String(t.name || ''))) return false;
  return path.posix.dirname(String(fromFile)) !== path.posix.dirname(String(t.filePath));
}

/**
 * Extract identifier candidates from a code body that look like type names
 * (struct / interface / class / enum / trait / type). Used by the
 * graph-neighbour tier to find type definitions that the relationships
 * table didn't capture as explicit edges (the canonical failure case is
 * gin:http-dispatch — `methodTree` is an unexported Go struct referenced
 * via a field-of-field, never as a direct relationship edge).
 *
 * Heuristic: any token ≥3 chars containing at least one uppercase AND at
 * least one lowercase letter (Pascal/camelCase). This captures both
 * exported types (`Engine`, `Context`, `ErrorKind`) and unexported Go
 * types (`methodTree`, `nodeType`). It deliberately rejects:
 *   - all-uppercase SCREAMING_SNAKE_CASE constants
 *   - all-lowercase variables / function names
 *   - language keywords
 *   - the symbol's own name
 *
 * False positives (e.g. method names in camelCase) are cheap because the
 * downstream SQL lookup ALSO filters by entity type, so a camelCase
 * function name won't match a struct/interface/class entity.
 *
 * @param {string} code
 * @param {string|null} ownName - the symbol's own name, excluded from results
 * @returns {string[]}
 */
function extractTypeCandidates(code, ownName, { go = false } = {}) {
  if (!code) return [];
  const own = (ownName || '').toLowerCase();
  const seen = new Set();
  const out = [];
  for (const m of code.matchAll(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g)) {
    const id = m[0];
    if (seen.has(id)) continue;
    // Go: a lowercase name right after `.` is a field or method (`s.rateLimiter`), never a
    // type — Go names another package's type only as `pkg.Exported`. (Other languages allow
    // `models.userRecord`.) Its other occurrences still count.
    if (go && /^[a-z_]/.test(id) && /\.\s*$/.test(code.slice(Math.max(0, m.index - 3), m.index))) continue;
    seen.add(id);
    if (LANG_KEYWORDS.has(id)) continue;
    if (id.toLowerCase() === own) continue;
    // Require BOTH upper and lower (Pascal/camelCase). Filters out
    // SCREAMING_SNAKE constants AND all-lowercase variables. A pure
    // single-word lowercase token like `trees` is rejected — most
    // unexported Go types are camelCase like `methodTree` and survive.
    if (!/[A-Z]/.test(id)) continue;
    if (!/[a-z]/.test(id)) continue;
    out.push(id);
  }
  // Cap the candidate list — DB lookup is bounded but we still pay query cost.
  return out.slice(0, 32);
}

/**
 * The 1-hop graph-neighbour tier for the top-1 result ("related" rows: callers, callees, types
 * the body names). It answers the loss where the agent stopped at one tight symbol and missed
 * a caller or a helper the chunk plainly references.
 *
 *   - outgoing relationships (calls / imports / uses / extends / implements / overrides /
 *     throws), incoming callers / users, and type names found in the body;
 *   - rows whose target is already in the pack (skipKeys) are dropped;
 *   - rows that come from AMBIGUOUS name-only resolution are dropped: the graph resolves a call
 *     to `request()` by name, so a name with many definitions (Kotlin `Chain.request`, 18
 *     definitions in okhttp) gets the callers of every `request` (8 unrelated test functions).
 *     Incoming rows are dropped when the target's name has >= 10 definitions, or >= 3 and a
 *     fan-in >= 20; a call / use into another file, and a body type name, when its name has
 *     >= 3 definitions. A type name prefers a non-test definition (Ruby `module Sequel` is
 *     reopened in hundreds of files; its only `class` rows were spec files);
 *   - with `query`, rows are SELECTED by a relevance score (relatedRowScore): test-file rows
 *     only when the query asks about tests, then the overlap of the row's name and path tokens
 *     with the query tokens, plus a bonus when the row's entity is itself a search candidate
 *     (`candidateKeys`). At most `maxRows` rows that clear the threshold; none when no row does;
 *   - hard-caps the rendered text at `tokenCap`. Fully elidable: cap 0 → null.
 *
 * `rows` is the structured form the compact ss-search renderer prints (one line per kind, the
 * path once per file, `shortPath` = the shortest path suffix that is unique in the repository);
 * `rendered` is the one-row-per-line form of the same rows.
 *
 * @param {object} opts
 * @param {object} opts.codeGraphRepo - CodeGraphRepository instance
 * @param {object} opts.entity        - { id, filePath, startLine, endLine, name, type }
 * @param {Set<string>} opts.skipKeys - "file|startLine|endLine" of results already in the pack
 * @param {number} opts.tokenCap      - max tokens for the rendered tier
 * @param {string} [opts.body]        - top-1 code body, used to discover referenced TYPE names
 * @param {string} [opts.query]       - the search query; turns on relevance selection
 * @param {Array<{file:string,startLine:number,endLine:number}>} [opts.candidates] - search
 *   candidates (pack + reserve), for the candidate bonus
 * @param {number} [opts.maxRows=3]   - rows kept by relevance selection
 * @returns {{ rendered: string, rows: Array, count: number, tokens: number,
 *             outgoingCount: number, incomingCount: number,
 *             typeRefCount: number }|null}
 */
export function renderGraphNeighbors(opts) {
  const { codeGraphRepo, entity, skipKeys, tokenCap = 0, body = '', query = null, candidates = [], maxRows = RELATED_DEFAULT_ROWS } = opts;
  if (!codeGraphRepo || !entity || !entity.id || tokenCap <= 0) return null;

  // Trace-only types (relationship-types.js) stay out of search output:
  // these neighbours were tuned on graphs without them.
  const OUT_TYPES = rankingRelationshipTypes(['imports', 'calls', 'uses', 'extends', 'implements', 'overrides', 'throws']);
  const IN_TYPES = ['calls', 'uses', 'extends', 'implements'];
  // typeAlias is what Go's graph extractor stores for struct/interface/type
  // declarations; the others cover JS/TS/Java/Rust/Python conventions.
  const TYPE_KINDS = ['struct', 'class', 'interface', 'enum', 'trait', 'type', 'typeAlias', 'object', 'actor', 'extension'];

  let outgoing = [];
  let incoming = [];
  let typeRefs = [];
  try { outgoing = codeGraphRepo.getOutgoingRelationships(entity.id, { types: OUT_TYPES, limit: 16 }) || []; }
  catch { outgoing = []; }
  // A call written with a receiver binds only as ss-trace binds it (requests
  // `DEFAULT_PORTS.get(` is a dict lookup, not Session.get).
  outgoing = outgoing.filter((r) => r.type !== 'calls' || !r.target || !/[.:]/.test(String(r.targetName || ''))
    || trustedCalleeEdge(r.targetName, r.target));
  try { incoming = codeGraphRepo.getIncomingRelationships(entity.id, { types: IN_TYPES, limit: RELATED_FANIN_PROBE }) || []; }
  catch { incoming = []; }

  // How many definitions a name has (null when the repository cannot say: no filtering).
  const defCounts = new Map();
  const countDefs = (names) => {
    const want = [...new Set(names.filter((n) => typeof n === 'string' && n.length >= 2 && !defCounts.has(n.toLowerCase())))];
    if (want.length && typeof codeGraphRepo.countEntitiesByAnyName === 'function') {
      let map = null;
      try { map = codeGraphRepo.countEntitiesByAnyName(want); } catch { map = null; }
      for (const n of want) defCounts.set(n.toLowerCase(), map ? (map.get(n.toLowerCase()) || 0) : null);
    }
  };
  const defs = (name) => defCounts.get(String(name || '').toLowerCase()) ?? null;

  // Incoming rows of a name with many definitions come from name-only resolution.
  const fanIn = incoming.length;
  countDefs([entity.name]);
  const ownDefs = defs(entity.name);
  if (ownDefs != null && (ownDefs >= RELATED_GENERIC_DEFS || (ownDefs >= RELATED_AMBIGUOUS_DEFS && fanIn >= RELATED_AMBIGUOUS_FANIN))) {
    incoming = [];
  }
  incoming = incoming.slice(0, 8);

  // Type-reference discovery: identifiers of the body that name a struct / interface / class /
  // enum / trait / type. Recovers what the relationships table misses (a Go method whose
  // receiver field has type `methodTree` never gets an edge to it; gin:http-dispatch).
  // Same-file types count (Engine next to handleHTTPRequest); range dedupe uses skipKeys.
  if (body && typeof codeGraphRepo.findEntitiesByNames === 'function') {
    try {
      const ids = extractTypeCandidates(body, entity.name, { go: /\.go$/.test(String(entity.filePath || '')) });
      if (ids.length) {
        const rows = codeGraphRepo.findEntitiesByNames(ids, { types: TYPE_KINDS, limit: 32, distinct: false }) || [];
        countDefs(rows.map((t) => t.name));
        const byName = new Map();
        for (const t of rows) {
          const n = defs(t.name);
          if (n != null && n >= RELATED_AMBIGUOUS_DEFS) continue;
          if (isTestLikePath(t.filePath)) continue;
          if (goUnexportedElsewhere(entity.filePath, t)) continue;
          const prev = byName.get(`${t.name}|${t.type}`);
          if (!prev || (t.endLine - t.startLine) < (prev.endLine - prev.startLine)) byName.set(`${t.name}|${t.type}`, t);
        }
        typeRefs = [...byName.values()].slice(0, 8);
      }
    } catch { typeRefs = []; }
  }

  if (outgoing.length === 0 && incoming.length === 0 && typeRefs.length === 0) return null;

  const ownKey = `${entity.filePath}|${entity.startLine}|${entity.endLine}`;
  const seen = new Set([ownKey, ...(skipKeys || [])]);
  const rows = [];
  // The entity itself is never related to itself (composer `types in class VersionParser:
  // class VersionParser`: the expansion's range 21-38 is not the class's range 21-94).
  const self = typeof codeGraphRepo.getEntityById === 'function' ? safeCall(() => codeGraphRepo.getEntityById(entity.id)) : null;
  const isSelf = (t) => (t.id && t.id === entity.id)
    || (self && t.name === self.name && t.filePath === (self.filePath || self.file_path || entity.filePath)
      && t.startLine === (self.startLine ?? self.start_line));
  const pushResolved = (kind, target) => {
    const k = `${target.filePath}|${target.startLine}|${target.endLine}`;
    if (seen.has(k) || isSelf(target)) return;
    seen.add(k);
    rows.push({ kind, name: target.name, file: target.filePath, startLine: target.startLine, endLine: target.endLine, entityType: target.type || null });
  };

  // Resolved targets, then unresolved imports, in family order.
  const grouped = new Map();
  for (const r of outgoing) {
    if (!grouped.has(r.type)) grouped.set(r.type, []);
    grouped.get(r.type).push(r);
  }
  countDefs(outgoing.filter((r) => r.target?.filePath && r.target.filePath !== entity.filePath).map((r) => r.target.name));
  for (const fam of OUT_TYPES) {
    for (const r of grouped.get(fam) || []) {
      if (r.target && r.target.filePath) {
        // A call / use into another file of a name with many definitions: name-only resolution.
        const n = r.target.filePath !== entity.filePath && (fam === 'calls' || fam === 'uses') ? defs(r.target.name) : null;
        if (n != null && n >= RELATED_AMBIGUOUS_DEFS) continue;
        pushResolved(fam, r.target);
      } else if (r.fullImportPath && (r.fullImportPath.startsWith(UNRESOLVED_IMPORT_PREFIX) || r.fullImportPath.startsWith(GO_PACKAGE_PREFIX)
        || r.fullImportPath.startsWith(RUST_PATH_PREFIX)
        || r.fullImportPath.startsWith(RECEIVER_TYPE_PREFIX))) {
        // A module outside the repo (package, stdlib), a Go package call with no function
        // target (`types.TypeID(v)` is a conversion), or a call on a receiver whose declared
        // type has no such method in the repo: the internal marker is not shown.
        if (r.targetName) rows.push({ kind: fam, name: r.targetName, line: r.contextLine || null });
      } else if (r.fullImportPath && fam === 'imports' && isResolvedImportFile(r.fullImportPath)) {
        // Resolved to a repo file, but to no single entity in it.
        rows.push({ kind: fam, name: r.targetName, file: r.fullImportPath });
      } else if (r.fullImportPath) {
        rows.push({ kind: fam, name: r.targetName, importPath: r.fullImportPath, unresolved: true });
      } else if (r.targetName) {
        rows.push({ kind: fam, name: r.targetName, line: r.contextLine || null });
      }
    }
  }
  for (const r of incoming) {
    // Incoming extends / implements read the other way round: `X extends <entity>`.
    const inKind = { calls: 'caller', uses: 'user', extends: 'extendedBy', implements: 'implementedBy' }[r.type] || r.type;
    if (r.source) pushResolved(inKind, r.source);
  }
  for (const t of typeRefs) pushResolved('type', t);

  let selected = rows;
  if (typeof query === 'string') selected = selectRelatedRows(rows, query, candidates, maxRows);
  if (selected.length === 0) return null;

  const index = typeof codeGraphRepo.fileBasenameIndex === 'function' ? safeCall(() => codeGraphRepo.fileBasenameIndex()) : null;
  for (const row of selected) if (row.file) row.shortPath = shortestUniquePath(row.file, index);

  const lines = selected.map(renderRelatedRowLine);
  let combined = lines.join('\n');
  while (estimateTokens(combined) > tokenCap && lines.length > 1) {
    lines.pop();
    selected = selected.slice(0, lines.length);
    combined = lines.join('\n');
  }
  if (estimateTokens(combined) > tokenCap) return null;

  return {
    rendered: combined,
    rows: selected,
    // The entity the rows are related to (the agent output names it: `class X extends ...`).
    subject: subjectOf(codeGraphRepo, entity),
    count: lines.length,
    tokens: estimateTokens(combined),
    outgoingCount: outgoing.length,
    incomingCount: incoming.length,
    typeRefCount: typeRefs.length,
  };
}
