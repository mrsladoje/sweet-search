/**
 * Unified structural context builder.
 *
 * Produces one agent-oriented trace for a symbol: callers, callees, and
 * transitive impact paths, ranked and packed under an adaptive token budget.
 */

import { DB_PATHS } from '../infrastructure/config/index.js';
import { StructuralContextRepository } from '../infrastructure/structural-context-repository.js';
import { isLikelyCodeEntity } from '../infrastructure/structural-context-utils.js';
import { buildAnswerCues } from './structural-answer-cues.js';
import { callsiteHintSites, isSelfReceiver } from './structural-callsite-hints.js';
import { extractHeaderContext } from './structural-header-context.js';
import { scoreEntity, scoreImpactPath, tokenize, safeMax } from './structural-importance.js';
import { personalizedPageRank } from './structural-forward-push.js';
import { isTraceOnlyRelationship } from './relationship-types.js';
const BUDGETS = { preview: 4000, full: 8000, xl: 12000 };
const DEFAULT_MAX_DEPTH = 3;
// Targets whose signature users (`typeRef`) ss-trace lists as callers, at
// most TYPE_REF_CALLER_LIMIT of them, scored at TYPE_REF_IMPORTANCE × normal.
const TYPE_USER_TARGETS = new Set([
  'class', 'struct', 'interface', 'enum', 'trait', 'protocol', 'record', 'object',
  'type', 'typeAlias', 'typealias', 'union', 'actor',
]);
const TYPE_REF_CALLER_LIMIT = 40;
const TYPE_REF_IMPORTANCE = 0.5;
function estimateTokens(text) {
  return text ? Math.ceil(String(text).length / 3.5) : 0;
}
function clamp(n, lo, hi) {
  const x = Number.parseInt(n, 10);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function entropy(items) {
  if (!items.length) return 0;
  const sum = items.reduce((acc, x) => acc + Math.max(0, x.importance || 0), 0);
  if (sum <= 0 || items.length === 1) return 0;
  const h = items.reduce((acc, x) => {
    const p = Math.max(0, x.importance || 0) / sum;
    return p > 0 ? acc - p * Math.log(p) : acc;
  }, 0);
  return h / Math.log(items.length);
}

function selectBudget(explicitBudget, candidates) {
  if (explicitBudget) {
    const n = clamp(explicitBudget, 1000, 16000);
    return { tier: n >= 11000 ? 'xl' : n >= 7000 ? 'full' : 'preview', tokenBudget: n, reason: 'explicit' };
  }
  const all = [...candidates.callers, ...candidates.callees, ...candidates.impactPaths];
  const total = all.length;
  const h = entropy(all);
  const sorted = [...all].sort((a, b) => (b.importance || 0) - (a.importance || 0));
  const dominance = sorted.length > 1
    ? (sorted[0].importance || 0) / Math.max(0.001, sorted[1].importance || 0)
    : 99;
  if (total <= 10 && dominance >= 2.0 && h < 0.65) {
    return { tier: 'preview', tokenBudget: BUDGETS.preview, reason: 'compact_dominant' };
  }
  if (total > 35 || h >= 0.82 || candidates.impactPaths.length > 18) {
    return { tier: 'xl', tokenBudget: BUDGETS.xl, reason: 'high_entropy_impact' };
  }
  return { tier: 'full', tokenBudget: BUDGETS.full, reason: 'balanced' };
}

/**
 * Fan-in and fan-out of the traced symbol, counted over the SAME caller and
 * callee sets the report prints. One source feeds the header, the section
 * budget split and the body, so they cannot disagree. A stored-edge count
 * misses callers found by the same-file scan, bare-call resolution and name
 * matches on unresolved edges. Callers count once per calling entity (one
 * caller with two call sites is one caller). A callee counts once per
 * definition, or once per name for an external callee.
 */
export function traceFanCounts(callers, callees) {
  const callerKeys = new Set();
  for (const c of callers || []) if (c?.id) callerKeys.add(c.id);
  const calleeKeys = new Set();
  for (const c of callees || []) {
    if (!c?.id) continue;
    calleeKeys.add(c.type === 'external' ? `external:${c.targetName || c.name}` : c.id);
  }
  return { fanIn: callerKeys.size, fanOut: calleeKeys.size };
}

function sectionShares(targetFan, hint = '', target = null) {
  const q = String(hint || '').toLowerCase(); if (/^(class|struct|trait|interface|enum|type|typeAlias)$/.test(target?.type || '')) return { target: 0.50, callers: 0.25, callees: 0.05, impact: 0.20 };
  if (/\b(callee|callees|downstream|helper|helpers|relies|next)\b/.test(q)) return { target: 0.16, callers: 0.08, callees: 0.54, impact: 0.22 };
  if (/\b(caller|callers|who calls|upstream|references)\b/.test(q)) return { target: 0.16, callers: 0.54, callees: 0.10, impact: 0.20 };
  if (/\b(impact|changing|change|affect|break|handoff)\b/.test(q)) return { target: 0.16, callers: 0.24, callees: 0.20, impact: 0.40 };
  const fanIn = targetFan.fanIn || 0, fanOut = targetFan.fanOut || 0;
  if (fanIn === 0 && fanOut > 0) return { target: 0.10, callers: 0.05, callees: 0.55, impact: 0.30 };
  if (fanIn >= fanOut * 2) return { target: 0.10, callers: 0.55, callees: 0.12, impact: 0.23 };
  if (fanOut >= fanIn * 2) return { target: 0.10, callers: 0.18, callees: 0.52, impact: 0.20 };
  return { target: 0.10, callers: 0.36, callees: 0.34, impact: 0.20 };
}

function readSlices(readFileRange, filePath, slices) {
  const out = [];
  let previousEnd = null;
  for (const s of slices.sort((a, b) => a.start - b.start)) {
    if (previousEnd != null && s.start > previousEnd + 1) {
      out.push(`// ... (${s.start - previousEnd - 1} lines elided) ...`);
    }
    const text = readFileRange(filePath, s.start, s.end);
    if (text) out.push(text);
    previousEnd = s.end;
  }
  return out.join('\n');
}

function clampText(text, tokenCap) {
  if (!text || tokenCap <= 0) return '';
  if (estimateTokens(text) <= tokenCap) return text;
  const lines = text.split('\n');
  while (lines.length > 0 && estimateTokens(`${lines.join('\n')}\n// ...`) > tokenCap) {
    lines.pop();
  }
  return lines.length ? `${lines.join('\n')}\n// ...` : '';
}

function renderCode(entity, opts) {
  if (!entity.filePath || !entity.startLine || !entity.endLine || opts.tokenCap < 80) {
    return { code: null, codeTokens: 0, presentation: 'summary' };
  }
  const lines = Math.max(1, entity.endLine - entity.startLine + 1);
  let code;
  let presentation = 'full';
  if (lines * 9 <= opts.tokenCap) {
    code = opts.readFileRange(entity.filePath, entity.startLine, entity.endLine);
  } else {
    presentation = 'preview';
    const slices = [{ start: entity.startLine, end: Math.min(entity.endLine, entity.startLine + 3) }];
    // A window around each call site (the first four), so a preview shows
    // every call the summary line lists.
    const lines = siteLines(entity).length ? siteLines(entity).slice(0, 4) : [opts.focusLine];
    for (const line of lines) {
      if (line && line >= entity.startLine && line <= entity.endLine) {
        slices.push({ start: Math.max(entity.startLine, line - 2), end: Math.min(entity.endLine, line + 2) });
      }
    }
    if (entity.endLine > entity.startLine + 4) slices.push({ start: entity.endLine, end: entity.endLine });
    code = readSlices(opts.readFileRange, entity.filePath, mergeSlices(slices));
  }
  code = clampText(code || '', opts.tokenCap);
  const codeTokens = estimateTokens(code);
  return code
    ? { code, codeTokens, presentation }
    : { code: null, codeTokens: 0, presentation: 'summary' };
}

function mergeSlices(slices) {
  const sorted = slices.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end + 1) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/** Every site line of an item: `contextLines`, else its single `contextLine`. */
function siteLines(entity) {
  if (entity.contextLines?.length) return entity.contextLines;
  return entity.contextLine ? [entity.contextLine] : [];
}

/**
 * One item per (entity, relationship), carrying every site line. A caller
 * that calls the target on lines 440 and 476 is one caller with
 * `contextLines: [440, 476]`, not two items (two items would pack its code
 * twice). Keeps the first item's fields and input order.
 */
export function mergeCallSites(items) {
  const byKey = new Map();
  for (const item of items || []) {
    if (!item?.id) continue;
    const key = `${item.id}\u0000${item.relationship || ''}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...item, contextLines: [...siteLines(item)] });
      continue;
    }
    for (const line of siteLines(item)) if (!prev.contextLines.includes(line)) prev.contextLines.push(line);
  }
  return [...byKey.values()].map((item) => {
    item.contextLines.sort((a, b) => a - b);
    item.contextLine = item.contextLines[0] ?? item.contextLine ?? null;
    return item;
  });
}

/**
 * `new Foo()` is both a construction (`instantiates`) and, to the bare-call
 * scanner, a call of `Foo`: the same entity would be listed twice with the
 * same lines and every site counted twice. A call line that the same entity's
 * `instantiates` row already lists is dropped; a call row left with no line
 * goes. Other call lines of that entity stay.
 */
export function foldConstructorCalls(items) {
  const built = new Map();
  for (const item of items) {
    if (item.relationship !== 'instantiates') continue;
    const lines = built.get(item.id) || new Set();
    for (const line of siteLines(item)) lines.add(line);
    built.set(item.id, lines);
  }
  if (built.size === 0) return items;
  const out = [];
  for (const item of items) {
    const lines = item.relationship === 'calls' ? built.get(item.id) : null;
    if (!lines) { out.push(item); continue; }
    const rest = siteLines(item).filter((line) => !lines.has(line));
    if (rest.length === 0) continue;
    if (rest.length === siteLines(item).length) { out.push(item); continue; }
    out.push({ ...item, contextLines: rest, contextLine: rest[0] });
  }
  return out;
}

/** Call sites across items: each item counts its site lines (at least one). */
function siteCount(items) {
  return (items || []).reduce((n, item) => n + Math.max(1, siteLines(item).length), 0);
}

// Rows that are calls of the target: stored and bare calls, and hint
// handoffs (a name called in the target's body).
const CALL_ROW_TYPES = new Set(['calls', 'handoff']);

/**
 * The noun for a section's site count: "call sites" when every counted row
 * is a call, else "sites" — a callers section also lists the code that
 * constructs (`instantiates`), extends, implements or overrides the target.
 */
export function siteNoun(items) {
  return (items || []).every((item) => !item?.relationship || CALL_ROW_TYPES.has(item.relationship))
    ? 'call sites'
    : 'sites';
}

// Site lines printed per row; the rest are counted (`…+N`). One function can
// call or construct one target on 100+ lines (jj `env.render_ok`: 121).
const MAX_PRINTED_SITE_LINES = 16;

/** `4,5,6`, or the first MAX_PRINTED_SITE_LINES lines and `…+N`. */
export function printedSiteLines(lines) {
  if (lines.length <= MAX_PRINTED_SITE_LINES) return lines.join(',');
  return `${lines.slice(0, MAX_PRINTED_SITE_LINES).join(',')},…+${lines.length - MAX_PRINTED_SITE_LINES}`;
}

function itemSummary(entity) {
  const loc = entity.filePath ? `${entity.filePath}:${entity.startLine || '?'}` : '(external)';
  const lines = printedSiteLines(siteLines(entity));
  // Trace-only edges are not calls: say what they are (`(overrides)`,
  // `(instantiates)@12`). Call/uses/extends rows list every site line.
  if (isTraceOnlyRelationship(entity.relationship)) {
    const at = lines ? `@${lines}` : '';
    return `${entity.name} [${entity.type}] ${loc} (${entity.relationship})${at}`;
  }
  const call = lines ? ` call@${lines}` : '';
  return `${entity.name} [${entity.type}] ${loc}${call}`;
}

function packSection(items, budget, opts) {
  const sorted = [...items].sort((a, b) => b.importance - a.importance);
  const utilityOrder = [...sorted].sort((a, b) => {
    const ac = Math.max(60, Math.min(1200, ((a.endLine || 0) - (a.startLine || 0) + 1) * 9));
    const bc = Math.max(60, Math.min(1200, ((b.endLine || 0) - (b.startLine || 0) + 1) * 9));
    return (b.importance / bc) - (a.importance / ac);
  });
  const codeWinners = new Set();
  let projected = 0;
  const maxItems = Math.max(3, Math.min(40, Math.floor(budget / 90)));
  for (const item of utilityOrder) {
    const est = Math.max(80, Math.min(opts.perItemCap, ((item.endLine || 0) - (item.startLine || 0) + 1) * 9));
    if (projected + est > budget) continue;
    codeWinners.add(item.id);
    projected += est;
  }

  let used = 0;
  const packed = [];
  for (const item of sorted) {
    if (packed.length >= maxItems) break;
    const summaryTokens = estimateTokens(itemSummary(item));
    if (used + summaryTokens > budget && packed.length >= 3) break;
    const remaining = Math.max(0, budget - used - summaryTokens);
    let codeInfo = { code: null, codeTokens: 0, presentation: 'summary' };
    if (codeWinners.has(item.id) && remaining >= 80) {
      codeInfo = renderCode(item, { ...opts, tokenCap: Math.min(opts.perItemCap, remaining) });
    }
    used += summaryTokens + codeInfo.codeTokens;
    packed.push({
      id: item.id,
      name: item.name,
      type: item.type,
      file: item.filePath,
      startLine: item.startLine,
      endLine: item.endLine,
      contextLine: item.contextLine || null,
      contextLines: siteLines(item),
      relationship: item.relationship || null,
      depth: item.depth || 1,
      importance: Number(item.importance.toFixed(4)),
      presentation: codeInfo.presentation,
      summary: itemSummary(item),
      code: codeInfo.code,
      codeTokens: codeInfo.codeTokens,
    });
  }
  return { items: packed, tokensUsed: used };
}

function buildImpactPaths(repo, target, opts) {
  const maxDepth = clamp(opts.maxDepth ?? DEFAULT_MAX_DEPTH, 1, 4);
  const limit = clamp(opts.limit ?? 80, 10, 250);
  let frontier = new Map([[target.id, { entity: target, path: [target], edgeTypes: [] }]]);
  const upstreamVisited = new Set([target.id]);
  const paths = [];
  const seenPathIds = new Set();

  for (let depth = 1; depth <= maxDepth && paths.length < limit; depth++) {
    const rows = repo.getReverseDependents([...frontier.keys()], target, {
      includeNamePattern: depth === 1,
      limit: limit * 3,
    });
    const next = new Map();
    for (const row of rows) {
      if (!row.id || row.id === target.id || upstreamVisited.has(row.id)) continue;
      const parent = frontier.get(row.targetId) || (depth === 1 ? frontier.get(target.id) : null);
      if (!parent) continue;
      const path = [row, ...parent.path];
      const edgeTypes = [row.relationship, ...parent.edgeTypes];
      const id = `up:${path.map(p => p.id).join('>')}`;
      if (!seenPathIds.has(id)) {
        paths.push({ id, direction: 'upstream', path, edgeTypes, depth });
        seenPathIds.add(id);
      }
      next.set(row.id, { entity: row, path, edgeTypes });
      upstreamVisited.add(row.id);
      if (paths.length >= limit) break;
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  frontier = new Map([[target.id, { entity: target, path: [target], edgeTypes: [] }]]);
  const downstreamVisited = new Set([target.id]);
  for (let depth = 1; depth <= maxDepth && paths.length < limit; depth++) {
    const rows = repo.getForwardDependencies?.([...frontier.keys()], { limit: limit * 3 }) || [];
    const next = new Map();
    for (const row of rows) {
      if (!row.id || row.id === target.id || downstreamVisited.has(row.id)) continue;
      const parent = frontier.get(row.sourceId);
      if (!parent) continue;
      const path = [...parent.path, row];
      const edgeTypes = [...parent.edgeTypes, row.relationship];
      const id = `down:${path.map(p => p.id).join('>')}`;
      if (!seenPathIds.has(id)) {
        paths.push({ id, direction: 'downstream', path, edgeTypes, depth });
        seenPathIds.add(id);
      }
      if (!String(row.id).startsWith('external:')) {
        next.set(row.id, { entity: row, path, edgeTypes });
        downstreamVisited.add(row.id);
      }
      if (paths.length >= limit) break;
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  addHintImpactPaths(paths, seenPathIds, repo, target, opts.hintSites || [], limit, opts.resolvedCallees || []);
  return paths;
}

/**
 * Definition a qualified call hint (`a.b(`, `a::b(`, `a->b(`) reaches, or null.
 * It binds ONLY to the callee the call resolved to, or to a same-file
 * definition when the receiver is the target's own type (self/this, the Go
 * receiver name, the owning type's name). It never falls back to a global
 * name match: `posting.Oracle()` must not land on an unrelated `Oracle` in
 * another package. Same no-guess rule as the call resolver.
 */
function bindQualifiedHint(site, repo, target, calleesByName) {
  const resolved = (calleesByName.get(site.name) || []).find(c => {
    if (!c?.id || String(c.id).startsWith('external:')) return false;
    // The call's own receiver (`x` in `x.Parse(`) must be one the hint wrote.
    const parts = String(c.targetName || '').replace(/::|->/g, '.').split('.').filter(Boolean);
    return parts.length < 2 || site.qualifiers.includes(parts[parts.length - 2]);
  });
  if (resolved) return resolved;
  if (!site.qualifiers.some(q => isSelfReceiver(q, target))) return null;
  const local = repo.findSameFileMember
    ? repo.findSameFileMember(site.name, target)
    : repo.findSameFileDefinition?.(site.name, target.filePath);
  return local?.id ? local : null;
}

function groupCalleesByName(resolvedCallees) {
  const byName = new Map();
  for (const c of resolvedCallees) {
    if (!c?.id || !c.name) continue;
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
  return byName;
}

function addHintImpactPaths(paths, seen, repo, target, hintSites, limit, resolvedCallees = []) {
  const calleesByName = groupCalleesByName(resolvedCallees);
  for (const site of hintSites) {
    if (paths.length >= limit) break;
    // An unqualified name called in the target's body binds to the definition
    // that call resolved to (GRDB: the broker's own `databaseDidRollback(notify…)`,
    // not the protocol requirement or DatabaseRegionObservation's), then to the
    // definition in the target's own file, then to the global top candidate.
    // A qualified name never takes the global candidate (bindQualifiedHint);
    // when it binds to nothing it is left out.
    let hint;
    if (site.qualified) {
      hint = bindQualifiedHint(site, repo, target, calleesByName);
    } else {
      const local = calleesByName.get(site.name)?.[0] || repo.findSameFileDefinition?.(site.name, target.filePath);
      hint = local?.id ? local : repo.findEntityCandidates?.(site.name, { limit: 1 })?.[0];
    }
    if (!hint || hint.id === target.id || !isLikelyCodeEntity(hint)) continue;
    const id = `hint:${target.id}>${hint.id}`;
    if (!seen.has(id)) {
      paths.push({ id, direction: 'downstream', path: [target, hint], edgeTypes: ['handoff'], depth: 1 });
      seen.add(id);
    }
    for (const row of repo.getForwardDependencies?.([hint.id], { limit: 12 }) || []) {
      if (paths.length >= limit) break;
      if (!row.id || row.id === target.id) continue;
      const rid = `hint:${target.id}>${hint.id}>${row.id}`;
      if (seen.has(rid)) continue;
      paths.push({ id: rid, direction: 'downstream', path: [target, hint, row], edgeTypes: ['handoff', row.relationship], depth: 2 });
      seen.add(rid);
    }
  }
}

function formatPath(path) {
  return path.path.map(p => {
    const loc = p.filePath ? `${p.filePath}:${p.startLine || '?'}` : 'external';
    return `${p.name} (${loc})`;
  }).join(' -> ');
}

export class StructuralContextBuilder {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd();
    this.repo = options.repository || new StructuralContextRepository(options.graphDbPath || DB_PATHS.codeGraph, {
      projectRoot: this.projectRoot,
      manifestEpoch: options.manifestEpoch,
    });
  }

  close() {
    this.repo?.close?.();
  }

  build(symbol, options = {}) {
    const started = performance.now();
    const cleanSymbol = String(symbol || '').trim();
    if (!cleanSymbol || cleanSymbol.length > 256) {
      return this._empty(cleanSymbol, 'invalid_symbol', started);
    }

    const candidates = this.repo.findEntityCandidates(cleanSymbol, { filePath: options.filePath, queryHint: options.queryHint, limit: 12 });
    if (!candidates.length) return this._empty(cleanSymbol, 'not_found', started);

    const target = candidates[0];
    const readFileRange = this.repo.readFileRange?.bind(this.repo) || (() => null);
    const targetSource = readFileRange(target.filePath, target.startLine, target.endLine);
    const targetHeaderContext = extractHeaderContext(readFileRange, target.filePath);
    const targetHintSites = callsiteHintSites(targetSource, new Set([target.name]));
    const targetCallsiteHints = targetHintSites.map(h => h.name);
    const storedCallers = [...this.repo.getCallers(target, { limit: 160 }), ...(this.repo.getAliasCallers?.(target, { limit: 80 }) || [])];
    // A type's signature users (`typeRef`: functions that take or return it).
    // Many types have no other referrer (jj 468 of 755, drogon 142 of 183),
    // so their callers section would be empty without them; a popular type
    // has hundreds (GRDB Database: 661), so they come from their own capped
    // query and rank below every other row. A function already listed by a
    // stronger relationship (calls, instantiates) is not repeated.
    if (TYPE_USER_TARGETS.has(target.type)) {
      const listed = new Set(storedCallers.map(x => x.id));
      for (const user of this.repo.getCallers(target, { types: ['typeRef'], limit: TYPE_REF_CALLER_LIMIT })) {
        if (!listed.has(user.id)) storedCallers.push(user);
      }
    }
    // Bare calls (`helper(x)`), resolved by scope rules from call_sites. They
    // come from indexed call sites (scope-resolved), so they count as stored,
    // not as the same-file text scan. Indexed items carry every site line
    // (call_lines / call_sites); one item per calling entity and relationship.
    const bareCallers = this.repo.getBareCallers?.(target, { limit: 80 }) || [];
    const indexedCallers = foldConstructorCalls(mergeCallSites([...storedCallers, ...bareCallers]));
    const storedIds = new Set(indexedCallers.map(x => x.id));
    // Same-file callsite scan: recovers callers the extractor stored no edge
    // for (bare local calls, out-of-line C++ methods). Deduped against indexed
    // callers by entity id — a stored edge may carry a different context_line
    // for the same call (multi-line invocations), and a same-entity duplicate
    // would double-pack the caller section.
    const sameFileCallers = mergeCallSites((this.repo.getSameFileCallers?.(target, { limit: 24 }) || [])
      .filter(x => !storedIds.has(x.id)));
    const callerProvenance = {
      stored: indexedCallers.length,
      sameFileFallback: sameFileCallers.length,
    };
    const callersRaw = [...indexedCallers, ...sameFileCallers].map(x => ({ ...x, depth: 1 }));
    let calleesRaw = mergeCallSites([
      ...this.repo.getCallees(target, { limit: 160 }),
      ...(this.repo.getBareCallees?.(target, { limit: 80 }) || []),
    ]).map(x => ({ ...x, depth: 1 }));
    if (!calleesRaw.length) {
      // No stored callees: fall back to names called in the body. A qualified
      // name binds only through bindQualifiedHint (own-type receiver, same
      // file); an unqualified name keeps the global top candidate.
      const noResolvedCallees = new Map();
      calleesRaw = targetHintSites
        .map(site => (site.qualified
          ? bindQualifiedHint(site, this.repo, target, noResolvedCallees)
          : this.repo.findEntityCandidates?.(site.name, { limit: 1 })?.[0]))
        .filter(isLikelyCodeEntity)
        .map(x => ({ ...x, relationship: 'handoff', depth: 1 }));
    }
    const impactRaw = buildImpactPaths(this.repo, target, {
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      limit: 120,
      hintSites: targetHintSites,
      // Resolved callees (stored + scope-resolved bare calls) bind a hint
      // name to the definition the call actually reaches.
      resolvedCallees: calleesRaw.filter(x => x.relationship !== 'handoff'),
    });
    const ids = [
      target.id,
      ...callersRaw.map(x => x.id),
      ...calleesRaw.map(x => x.id),
      ...impactRaw.flatMap(p => p.path.map(x => x.id)),
    ];
    const fan = this.repo.getFanCounts(ids);
    const pageRank = this.repo.getPageRank(ids);
    const backwardRun = personalizedPageRank({
      sourceId: target.id,
      loadFrontier: (idsBatch) => this.repo.getFrontierBackwardEdges(idsBatch),
    });
    const forwardRun = personalizedPageRank({
      sourceId: target.id,
      loadFrontier: (idsBatch) => this.repo.getFrontierForwardEdges(idsBatch),
    });
    const maxFanIn = safeMax([...fan.values()].map(x => x.fanIn));
    const maxPageRank = safeMax(pageRank.values());
    const hintTokens = tokenize(options.queryHint || cleanSymbol);
    const callerCtx = {
      fan, pageRank, hintTokens,
      pprScores: backwardRun.scores,
      maxFanIn, maxPageRank,
      maxPpr: safeMax(backwardRun.scores.values()),
    };
    const calleeCtx = {
      fan, pageRank, hintTokens,
      pprScores: forwardRun.scores,
      maxFanIn, maxPageRank,
      maxPpr: safeMax(forwardRun.scores.values()),
    };
    // Signature users rank below callers, constructors and subtypes.
    const callers = callersRaw.map(x => ({
      ...x,
      importance: scoreEntity(x, callerCtx) * (x.relationship === 'typeRef' ? TYPE_REF_IMPORTANCE : 1),
    }));
    const callees = calleesRaw.map(x => ({ ...x, importance: scoreEntity(x, calleeCtx) }));
    const impactPaths = impactRaw.map(p => ({
      ...p,
      importance: scoreImpactPath(p, p.direction === 'downstream' ? calleeCtx : callerCtx),
    })).sort((a, b) => b.importance - a.importance);

    callers.sort((a, b) => b.importance - a.importance);
    callees.sort((a, b) => b.importance - a.importance);
    const budget = selectBudget(options.tokenBudget, { callers, callees, impactPaths });
    const targetFan = traceFanCounts(callersRaw, calleesRaw);
    const shares = sectionShares(targetFan, options.queryHint, target);
    const targetInfo = renderCode(target, {
      readFileRange,
      tokenCap: Math.floor(budget.tokenBudget * shares.target),
      perItemCap: Math.floor(budget.tokenBudget * shares.target),
    });
    const packOpts = {
      readFileRange,
      perItemCap: budget.tier === 'xl' ? 1400 : budget.tier === 'full' ? 1100 : 800,
    };
    const callersPack = packSection(callers, Math.floor(budget.tokenBudget * shares.callers), packOpts);
    const calleesPack = packSection(callees, Math.floor(budget.tokenBudget * shares.callees), packOpts);
    const impactPack = this._packImpact(impactPaths, Math.floor(budget.tokenBudget * shares.impact));
    const targetWithCode = { ...target, code: targetInfo.code };
    const targetForCues = { ...targetWithCode, code: targetSource || targetInfo.code };
    const tokensUsed = targetInfo.codeTokens + estimateTokens(targetHeaderContext) + callersPack.tokensUsed + calleesPack.tokensUsed + impactPack.tokensUsed;

    return {
      format: 'structural_context',
      tool: 'trace',
      symbol: cleanSymbol,
      target: {
        ...targetWithCode,
        fanIn: targetFan.fanIn,
        fanOut: targetFan.fanOut,
        headerContext: targetHeaderContext || null,
        codeTokens: targetInfo.codeTokens,
        presentation: targetInfo.presentation,
        callsiteHints: targetCallsiteHints,
      },
      answerCues: buildAnswerCues({ target: targetForCues, hint: options.queryHint, callers, callees, impactPaths, resolveTerm: name => this.repo.findSameFileDefinition?.(name, target.filePath) }),
      disambiguation: candidates.slice(1).map(c => ({
        name: c.name, type: c.type, file: c.filePath, startLine: c.startLine,
      })),
      budgetTier: budget.tier,
      budgetReason: budget.reason,
      tokenBudget: budget.tokenBudget,
      tokensUsed,
      maxDepth: clamp(options.maxDepth ?? DEFAULT_MAX_DEPTH, 1, 4),
      stats: {
        totalEntities: this.repo.getEntityCount(),
        callers: callers.length,
        callees: callees.length,
        impactPaths: impactPaths.length,
        entropy: Number(entropy([...callers, ...callees, ...impactPaths]).toFixed(4)),
        latencyMs: Math.round(performance.now() - started),
      },
      sections: {
        // `total` counts sites (an item lists every line it calls / constructs
        // on); `siteNoun` names them; `distinct` counts calling / called
        // entities (= fan-in / fan-out).
        callers: {
          total: siteCount(callers), siteNoun: siteNoun(callers), distinct: targetFan.fanIn, shown: callersPack.items.length, items: callersPack.items,
          provenance: callerProvenance,
        },
        callees: { total: siteCount(callees), siteNoun: siteNoun(callees), distinct: targetFan.fanOut, shown: calleesPack.items.length, items: calleesPack.items },
        impact: { total: impactPaths.length, shown: impactPack.paths.length, paths: impactPack.paths },
      },
    };
  }

  _packImpact(paths, budget) {
    const out = [];
    let used = 0;
    const maxPaths = Math.max(3, Math.min(24, Math.floor(budget / 80)));
    for (const p of paths) {
      if (out.length >= maxPaths) break;
      const row = {
        path: formatPath(p),
        direction: p.direction || 'upstream',
        depth: p.depth,
        edgeTypes: p.edgeTypes,
        importance: Number(p.importance.toFixed(4)),
      };
      const cost = estimateTokens(`${row.path} ${row.edgeTypes.join(' ')}`);
      if (used + cost > budget && out.length >= 3) break;
      used += cost;
      out.push(row);
    }
    return { paths: out, tokensUsed: used };
  }

  _empty(symbol, reason, started) {
    return {
      format: 'structural_context',
      tool: 'trace',
      symbol,
      target: null,
      disambiguation: [],
      budgetTier: 'preview',
      budgetReason: reason,
      tokenBudget: BUDGETS.preview,
      tokensUsed: 0,
      maxDepth: DEFAULT_MAX_DEPTH,
      stats: { totalEntities: this.repo.getEntityCount(), callers: 0, callees: 0, impactPaths: 0, entropy: 0, latencyMs: Math.round(performance.now() - started) },
      sections: {
        callers: { total: 0, shown: 0, items: [], provenance: { stored: 0, sameFileFallback: 0 } },
        callees: { total: 0, shown: 0, items: [] },
        impact: { total: 0, shown: 0, paths: [] },
      },
    };
  }
}

export { formatStructuralContext, TRACE_MODES } from './structural-context-format.js';

export default StructuralContextBuilder;
