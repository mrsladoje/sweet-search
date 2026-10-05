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
import { BareCallResolver } from './bare-call-resolution.js';
import { declaredTypeIn } from './receiver-types.js';
import { GENERIC_RECEIVER_SPREAD } from './relationship-resolver.js';
import { isTraceOnlyRelationship } from '../infrastructure/relationship-types.js';
import { isTestLikePath } from '../infrastructure/test-paths.js';
const BUDGETS = { preview: 4000, full: 8000, xl: 12000 };
const DEFAULT_MAX_DEPTH = 3;
// Targets whose signature users (`typeRef`) ss-trace lists as callers, at
// most TYPE_REF_CALLER_LIMIT of them, scored at TYPE_REF_IMPORTANCE × normal.
const TYPE_USER_TARGETS = new Set([
  'class', 'struct', 'interface', 'enum', 'trait', 'protocol', 'record', 'object',
  'type', 'typeAlias', 'typealias', 'union', 'actor',
]);
const TYPE_REF_CALLER_LIMIT = 40;
// The most methods of a type whose calls ss-trace gathers as the type's callees.
const MEMBER_CALLEE_SOURCES = 80;
const TYPE_REF_IMPORTANCE = 0.5;
// Rows rank by tier, then importance: calls, then implementations / subtypes (`overrides`,
// `implements`, `extends`), then signature users. okhttp Interceptor.intercept has ~25
// implementations and they pushed real calls (KotlinSourceModernTest:614) out of the cap.
const SUBTYPE_RELATIONS = new Set(['overrides', 'implements', 'extends']);
const relationTier = (x) => (x.relationship === 'typeRef' ? 2 : SUBTYPE_RELATIONS.has(x.relationship) ? 1 : 0);
const byTierThenImportance = (a, b) => (relationTier(a) - relationTier(b)) || (b.importance - a.importance);
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

/**
 * The other definitions a trace could have meant, each named with its owner
 * (`OcelotJRoute.GivenJObject`), the form `Owner.name` that selects it. None
 * when the symbol was already qualified by the target's owner and no other
 * candidate has that owner: the choice was not a guess.
 */
export function traceAlternatives(symbol, target, candidates) {
  const parts = String(symbol || '').split(/::|\./).filter(Boolean);
  const qualifier = parts.length > 1 ? parts[parts.length - 2] : null;
  // A class's own constructor (`DynamicCredentialsFileLoader.DynamicCredentialsFileLoader`)
  // is not another definition of the class.
  const rest = candidates.slice(1).filter(c => !(c.name === target?.name && c.parentClass === target?.name
    && c.filePath === target?.filePath && TYPE_USER_TARGETS.has(target?.type)));
  if (qualifier && target?.parentClass === qualifier
    && !rest.some(c => c.parentClass === qualifier && c.name === target.name)) return [];
  return rest.map(c => ({
    name: c.name, owner: c.parentClass || null, type: c.type, file: c.filePath, startLine: c.startLine,
  }));
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

export function sectionShares(targetFan, hint = '', target = null) {
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

/** `hidden` (in-repository rows not packed) and `external` (rows without a definition). */
export function rowCounts(all, packed) {
  const isExternal = (x) => x?.type === 'external' || !(x?.filePath ?? x?.file);
  const shown = new Set((packed || []).map(x => `${x.id}\u0000${x.relationship || ''}`));
  let hidden = 0;
  let external = 0;
  for (const x of all || []) {
    if (isExternal(x)) external++;
    else if (!shown.has(`${x.id}\u0000${x.relationship || ''}`)) hidden++;
  }
  return { hidden, external };
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

// Same thresholds as ss-search's related rows (context-expander.js RELATED_*): a name with
// this many definitions (and incoming rows) is generic, and a call matched to it by name
// alone is a guess.
const GENERIC_NAME_DEFS = 10;
const AMBIGUOUS_NAME_DEFS = 3;
const AMBIGUOUS_NAME_FANIN = 20;

/**
 * Callers without name-only guesses for a generic name. A stored call that the graph did
 * not resolve (`TIMESTAMP.write(`) is matched to the target by its name; for a name with
 * >= 10 definitions, or >= 3 and >= 20 caller rows, that match is a guess (zipkin
 * `V2SpanWriter.write`, 31 definitions: 20 Proto3 field writes listed as its callers).
 * Rows the graph resolved to the target, bare calls, same-file scan rows (both bound to
 * the target's id) and dispatch rows stay.
 */
export function isGenericTargetName(defs, callerRows) {
  return defs != null && (defs >= GENERIC_NAME_DEFS || (defs >= AMBIGUOUS_NAME_DEFS && callerRows >= AMBIGUOUS_NAME_FANIN));
}

export function dropNameOnlyCallers(rows, target, defs, dropped = null) {
  const nameOnly = (x) => !(x.via || x.bare || x.targetId === target.id || !x.targetName);
  // One definition of a generic API name (relationship-resolver GENERIC_RECEIVER_SPREAD):
  // build time left `dict.items()` unbound on purpose — no name match brings it back.
  if (!isGenericTargetName(defs, rows.length) && nameOnlyReceiverSpread(rows, nameOnly) <= GENERIC_RECEIVER_SPREAD) return rows;
  const kept = rows.filter(x => !nameOnly(x) || receiverNamesOwner(x.targetName, target));
  if (Array.isArray(dropped)) for (const x of rows) if (!kept.includes(x)) dropped.push(x);
  return kept;
}

// Distinct plain receivers (`list` in `list.push`) of the name-only rows, counted up to
// one past the threshold.
function nameOnlyReceiverSpread(rows, nameOnly) {
  const seen = new Set();
  for (const x of rows) {
    if (!nameOnly(x)) continue;
    const parts = String(x.targetName).replace(/::|->/g, '.').split('.');
    if (parts.length !== 2 || !/^[a-z_]\w*$/.test(parts[0]) || isSelfReceiver(parts[0])) continue;
    seen.add(parts[0]);
    if (seen.size > GENERIC_RECEIVER_SPREAD) break;
  }
  return seen.size;
}

/**
 * The receiver of a stored call names the target's owner (`interceptor.intercept(` for
 * `Interceptor.intercept`, okhttp RealInterceptorChain.proceed): evidence, not a name guess.
 */
function receiverNamesOwner(targetName, target) {
  const owner = String(target?.parentClass || '').split(/\.|::/).pop().toLowerCase();
  if (!owner) return false;
  const parts = String(targetName || '').replace(/::|->/g, '.').split('.').filter(Boolean);
  return parts.length >= 2 && parts[parts.length - 2].replace(/^[_$@]+/, '').toLowerCase() === owner;
}

/**
 * Callers that call a method `target` overrides or implements, resolved to that
 * method (stored edge with its id), each with `via: 'Owner.name'`. Callers already
 * listed for the target itself are left out. Empty without stored `overrides` edges.
 */
export function dispatchCallersOf(repo, target, listed = [], limit = 80) {
  const bases = repo.getOverriddenMethods?.(target) || [];
  if (!bases.length) return [];
  const seen = new Set(listed.map(x => x?.id).filter(Boolean));
  const out = [];
  for (const base of bases) {
    const via = base.parentClass ? `${base.parentClass}.${base.name}` : base.name;
    for (const row of repo.getCallers(base, { types: ['calls'], limit }) || []) {
      if (!row?.id || row.id === target.id || row.targetId !== base.id || seen.has(row.id)) continue;
      out.push({ ...row, via });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const INHERITANCE_RELATIONSHIPS = new Set(['extends', 'implements']);
const INTERFACE_TARGET_TYPES = new Set(['interface', 'protocol', 'trait']);

function itemSummary(entity) {
  const loc = entity.filePath ? `${entity.filePath}:${entity.startLine || '?'}` : '(external)';
  const lines = printedSiteLines(siteLines(entity));
  // Trace-only edges are not calls: say what they are (`(overrides)`,
  // `(instantiates)@12`). Call/uses/extends rows list every site line.
  // Inheritance is not a call either: `Impl [class] … (implements)@9`, not `call@9`.
  if (isTraceOnlyRelationship(entity.relationship) || INHERITANCE_RELATIONSHIPS.has(entity.relationship)) {
    const at = lines ? `@${lines}` : '';
    return `${entity.name} [${entity.type}] ${loc} (${entity.relationship})${at}`;
  }
  const call = lines ? ` call@${lines}` : '';
  const via = entity.via ? ` via ${entity.via}` : '';
  return `${entity.name} [${entity.type}] ${loc}${call}${via}`;
}

/**
 * SS_FIX_TRACE_MODE_BUDGET (default ON in ss-trace since 2026-10-03): with a mode word, only that section prints, so it
 * takes every share but the target's. Any other mode (or none) keeps the shares.
 */
export function modeSectionShares(shares, mode) {
  if (mode !== 'callers' && mode !== 'callees' && mode !== 'impact') return shares;
  return { target: shares.target, callers: 0, callees: 0, impact: 0, [mode]: 1 - shares.target };
}

/** Most caller / callee rows a section of `budget` tokens lists. */
// Rows per section when the trace prints rows only (compact ss-trace).
const ROWS_ONLY_ITEM_LIMIT = 40;

export function sectionItemLimit(budget) {
  return Math.max(3, Math.min(40, Math.floor(budget / 90)));
}

/** Most impact paths a section of `budget` tokens lists. */
export function impactPathLimit(budget) {
  return Math.max(3, Math.min(24, Math.floor(budget / 80)));
}

/** Token cap of one caller / callee item's code, by budget tier. */
export function itemCodeCap(tier) {
  return tier === 'xl' ? 1400 : tier === 'full' ? 1100 : 800;
}

function packSection(items, budget, opts) {
  const sorted = [...items].sort(byTierThenImportance);
  const utilityOrder = [...sorted].sort((a, b) => {
    if (relationTier(a) !== relationTier(b)) return relationTier(a) - relationTier(b);
    const ac = Math.max(60, Math.min(1200, ((a.endLine || 0) - (a.startLine || 0) + 1) * 9));
    const bc = Math.max(60, Math.min(1200, ((b.endLine || 0) - (b.startLine || 0) + 1) * 9));
    return (b.importance / bc) - (a.importance / ac);
  });
  const codeWinners = new Set();
  let projected = 0;
  // rowsOnly (the compact ss-trace): no code prints, so none is packed, and the cap is the
  // fixed ROWS_ONLY_ITEM_LIMIT rows the output promises (every row left out is counted).
  const maxItems = opts.rowsOnly ? ROWS_ONLY_ITEM_LIMIT : sectionItemLimit(budget);
  for (const item of opts.rowsOnly ? [] : utilityOrder) {
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
    if (!opts.rowsOnly && used + summaryTokens > budget && packed.length >= 3) break;
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
      via: item.via || null,
      ...(item.overloads?.length ? { overloads: item.overloads } : {}),
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

// What a trace reaches downstream is what it runs: the edges the callees section lists.
// `uses` (C++: a namespace or class named in the body), `extends` and `implements` are no
// step of execution. A namespace or module is never a node of a path.
const DOWNSTREAM_IMPACT_EDGES = ['calls', 'instantiates'];
const SCOPE_KINDS = new Set(['namespace', 'module', 'package']);
const isScopeNode = (e) => SCOPE_KINDS.has(String(e?.type || '').toLowerCase());

export function buildImpactPaths(repo, target, opts) {
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
    // Calls through the method a frontier node overrides or implements reach it by dispatch
    // (jj: cli code calls the trait method LockedWorkingCopy::snapshot, which
    // LockedLocalWorkingCopy::snapshot implements) — same rule as the callers section.
    for (const [frontierId, { entity }] of frontier) {
      for (const row of dispatchCallersOf(repo, entity, [], 24)) {
        rows.push({ ...row, targetId: frontierId, targetName: null, relationship: 'calls' });
      }
    }
    const next = new Map();
    for (const row of rows) {
      if (!row.id || row.id === target.id || upstreamVisited.has(row.id) || isScopeNode(row)) continue;
      // A generic name: no caller matched by name alone (dropNameOnlyCallers).
      if (opts.genericName && depth === 1 && row.targetName && row.targetId !== target.id) continue;
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
    const rows = repo.getForwardDependencies?.([...frontier.keys()], { limit: limit * 3, types: DOWNSTREAM_IMPACT_EDGES }) || [];
    // Bare calls (`helper(x)`, resolved from call_sites) are callees too: the callees
    // section lists them, so a step of the tree must reach them as well.
    for (const [sourceId, { entity }] of frontier) {
      for (const callee of repo.getBareCallees?.(entity, { limit: 24 }) || []) rows.push({ ...callee, sourceId });
    }
    const next = new Map();
    for (const row of rows) {
      if (!row.id || row.id === target.id || downstreamVisited.has(row.id) || isScopeNode(row)) continue;
      const parent = frontier.get(row.sourceId);
      if (!parent) continue;
      if (callIntoTestTree(parent.entity.filePath, row.filePath)) continue;
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

/**
 * The global definition an unqualified call `name(` names when the call itself
 * resolved to nothing: the one ownerless definition of exactly that name
 * (repository findUniqueFreeDefinition), never a fuzzy or case-insensitive match
 * and never another type's method.
 */
function unqualifiedCallDefinition(repo, name) {
  if (repo.findUniqueFreeDefinition) return repo.findUniqueFreeDefinition(name);
  const top = repo.findEntityCandidates?.(name, { limit: 1 })?.[0];
  return top && top.name === name && !top.parentClass ? top : null;
}

/**
 * True when a call from `fromPath` resolved into a test / spec / fixture file while the
 * caller is no test file. Production code never calls into the test tree (it is not
 * compiled into the library), so such an edge is a name-based misresolution: GRDB
 * `observer?.databaseWillCommit()` in TransactionObserver.swift was bound to the test
 * class `Observer` in TransactionObserverTests.swift because the receiver is named
 * `observer`. The call is then unresolved.
 */
export function callIntoTestTree(fromPath, toPath) {
  return !!toPath && !!fromPath && isTestLikePath(toPath) && !isTestLikePath(fromPath);
}

/** An item rewritten as an unresolved (external) callee, keeping its call lines. */
function asUnresolved(item, idx) {
  const name = item.targetName || item.name || 'external';
  return {
    ...item, id: `external:test:${idx}:${name}`, name, type: 'external',
    filePath: null, startLine: null, endLine: null, signature: name, summary: '',
  };
}

/** Unqualified `name(` in the target: the same-file definition, else the one free definition. */
function sameFileOrUniqueDefinition(repo, name, target) {
  const local = repo.findSameFileDefinition?.(name, target.filePath);
  return local?.id ? local : unqualifiedCallDefinition(repo, name);
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
    // when it binds to nothing it is left out. The global candidate is the one
    // free definition of exactly that name (unqualifiedCallDefinition).
    let hint;
    if (site.qualified) {
      hint = bindQualifiedHint(site, repo, target, calleesByName);
    } else {
      const local = calleesByName.get(site.name)?.find(c => !String(c.id).startsWith('external:'))
        || repo.findSameFileDefinition?.(site.name, target.filePath);
      hint = local?.id ? local : unqualifiedCallDefinition(repo, site.name);
    }
    if (!hint || hint.id === target.id || !isLikelyCodeEntity(hint) || isScopeNode(hint)) continue;
    if (callIntoTestTree(target.filePath, hint.filePath)) continue;
    const id = `hint:${target.id}>${hint.id}`;
    if (!seen.has(id)) {
      paths.push({ id, direction: 'downstream', path: [target, hint], edgeTypes: ['handoff'], depth: 1 });
      seen.add(id);
    }
    for (const row of repo.getForwardDependencies?.([hint.id], { limit: 12, types: DOWNSTREAM_IMPACT_EDGES }) || []) {
      if (paths.length >= limit) break;
      if (!row.id || row.id === target.id || isScopeNode(row)) continue;
      if (callIntoTestTree(hint.filePath, row.filePath)) continue;
      const rid = `hint:${target.id}>${hint.id}>${row.id}`;
      if (seen.has(rid)) continue;
      paths.push({ id: rid, direction: 'downstream', path: [target, hint, row], edgeTypes: ['handoff', row.relationship], depth: 2 });
      seen.add(rid);
    }
  }
}

// The text of a parenthesised list starting at `open` (index of `(`), or null when unbalanced.
function parenBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<' && /\w/.test(text[i - 1] || '')) depth++;
    else if (ch === ')' || ch === ']' || ch === '}' || (ch === '>' && depth > 1 && text[i - 1] !== '-')) {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

// Top-level comma-separated parts of a parameter / argument list.
function listParts(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// [min, max] arguments a definition's parameter list takes (defaults lower min; variadics: max ∞).
function parameterRange(source, name) {
  // `Write<T0, T1>(`: generic parameters between the name and the list.
  const at = String(source || '').search(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:<[^()]*>)?\\s*\\(`));
  if (at < 0) return null;
  const body = parenBody(source, source.indexOf('(', at));
  if (body == null) return null;
  const params = listParts(body).filter((p) => p !== 'void');
  const variadic = params.some((p) => /\.\.\.|^\*|\bparams\b|vararg/.test(p));
  const min = params.filter((p) => !/=/.test(p) && !/\.\.\.|^\*|\bparams\b|vararg/.test(p)).length;
  return [min, variadic ? Infinity : params.length];
}

/** Callers whose call lines all pass an argument count of another overload are dropped. */
// Languages where an argument can sit outside the parentheses: a trailing block / lambda
// (`retry(3) { }`), or Elixir's pipe (`conn |> put_status(404)` passes conn first; `=` in
// its parameters is a pattern match, not a default). The parenthesised count is not the
// argument count.
const TRAILING_BLOCK_FILE = /\.(?:kt|kts|swift|rb|scala|groovy|gradle|ex|exs)$/i;

// Same-name definitions in the entity's file under the same owner (its overload set, minus itself).
function overloadSiblings(repo, entity) {
  return (repo.findEntityCandidates?.(entity.name, { filePath: entity.filePath, limit: 12 }) || [])
    .filter((e) => e.id !== entity.id && e.name === entity.name && e.filePath === entity.filePath
      && (e.parentClass || null) === (entity.parentClass || null));
}

function overloadRange(repo, e) {
  return parameterRange(repo.readFileRange(e.filePath, e.startLine, Math.min(e.endLine ?? e.startLine, e.startLine + 20)), e.name);
}

const fitsRange = (r, n) => n >= r[0] && n <= r[1];

// Argument count of the first `name(` call on `line` of `file` (null: no call, or a spread).
function argumentCountAt(repo, file, line, name) {
  const text = repo.readFileRange(file, line, line + 4) || '';
  const m = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`).exec(text);
  if (!m) return null;
  const body = parenBody(text, m.index + m[0].length - 1);
  if (body == null || /\.\.\.|^\s*\*\w/.test(body)) return null; // spread: count unknown
  return listParts(body).length;
}

function dropOtherOverloadCalls(repo, target, rows) {
  if (!target?.name || !target.filePath || typeof repo.readFileRange !== 'function') return rows;
  if (TRAILING_BLOCK_FILE.test(target.filePath)) return rows;
  const siblings = overloadSiblings(repo, target);
  if (!siblings.length) return rows;
  const own = overloadRange(repo, target);
  const others = siblings.map((e) => overloadRange(repo, e)).filter(Boolean);
  if (!own || !others.length) return rows;
  return rows.filter((row) => {
    if (row.relationship && row.relationship !== 'calls') return true;
    const lines = siteLines(row);
    if (!lines.length || !row.filePath) return true;
    return lines.some((line) => {
      const n = argumentCountAt(repo, row.filePath, line, target.name);
      return n == null || fitsRange(own, n) || !others.some((r) => fitsRange(r, n));
    });
  });
}

/**
 * A callee with overloads is bound by the argument count at its call site: the one overload
 * that takes that many arguments, or, when several do, the row names the others too
 * (serilog Logger.Write(level, template, values) fits four 3-argument Write overloads; the
 * graph picked the first by position). Types are not known here, so no further choice.
 */
export function bindCalleeOverloads(repo, target, rows) {
  if (!target?.filePath || typeof repo.readFileRange !== 'function') return rows;
  if (TRAILING_BLOCK_FILE.test(target.filePath)) return rows;
  return rows.map((row) => {
    if ((row.relationship && row.relationship !== 'calls') || !row.name || !row.filePath) return row;
    const lines = siteLines(row);
    if (!lines.length) return row;
    const siblings = overloadSiblings(repo, row);
    if (!siblings.length) return row;
    const n = argumentCountAt(repo, target.filePath, lines[0], row.name);
    if (n == null) return row;
    const fitting = [row, ...siblings].filter((e) => {
      const r = overloadRange(repo, e);
      return !r || fitsRange(r, n);
    }).sort((a, b) => (a === row ? -1 : b === row ? 1 : (a.startLine ?? 0) - (b.startLine ?? 0)));
    if (!fitting.length) return row;
    const [chosen, ...rest] = fitting;
    const bound = chosen === row ? row : {
      ...chosen,
      relationship: row.relationship, contextLine: row.contextLine, contextLines: row.contextLines, depth: row.depth,
    };
    return rest.length ? { ...bound, overloads: rest.map((e) => e.startLine).sort((a, b) => a - b) } : bound;
  });
}

/**
 * Impact paths in importance order within each direction, the two directions taking turns:
 * the pack's path slots go to both trees (jj `snapshot`: 25 downstream paths outranked every
 * upstream path past the first hop, and the callers through the trait never printed).
 */
function interleaveDirections(paths) {
  const by = (dir) => paths.filter(p => (p.direction || 'upstream') === dir).sort((a, b) => b.importance - a.importance);
  const up = by('upstream');
  const down = by('downstream');
  const out = [];
  for (let i = 0; i < Math.max(up.length, down.length); i++) {
    if (i < up.length) out.push(up[i]);
    if (i < down.length) out.push(down[i]);
  }
  return out;
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
      BareCallResolver,
      declaredTypeIn,
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
    const unresolvedNamed = [];
    const storedCallers = [...this.repo.getCallers(target, { limit: 160, unresolved: unresolvedNamed }), ...(this.repo.getAliasCallers?.(target, { limit: 80 }) || [])];
    // Several extractors store a class implementing an interface as `extends`; for an
    // interface / protocol / trait target that row is an implementation, so say so.
    if (INTERFACE_TARGET_TYPES.has(target.type)) {
      for (const row of storedCallers) if (row?.relationship === 'extends') row.relationship = 'implements';
    }
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
    const bareCallers = this.repo.getBareCallers?.(target, { limit: 80, ambiguous: unresolvedNamed }) || [];
    // Calls through the method this one overrides or implements reach it by dispatch
    // (okhttp `chain.proceed(request)` binds to the interface `Interceptor.Chain.proceed`;
    // its implementation `RealInterceptorChain.proceed` otherwise had no production caller).
    // Only calls the graph resolved to that method; each row says which method it called.
    const dispatchCallers = dispatchCallersOf(this.repo, target, [...storedCallers, ...bareCallers]);
    const indexedCallers = foldConstructorCalls(mergeCallSites([...storedCallers, ...bareCallers, ...dispatchCallers]));
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
    const targetDefs = this.repo.countDefinitions?.(target.name);
    const allCallers = [...indexedCallers, ...sameFileCallers];
    const genericName = isGenericTargetName(targetDefs, allCallers.length);
    // Name-only guesses dropped for a generic name are listed as unresolved, not lost.
    const callersRaw = dropNameOnlyCallers(allCallers, target, targetDefs, unresolvedNamed).map(x => ({ ...x, depth: 1 }));
    // A call whose argument count fits another overload of the target, not the target itself,
    // calls that overload (drogon newOptionsResponse calls newHttpResponse(a, b), the 2-argument
    // overload, not the 0-argument target).
    const callersByArity = [...dropOtherOverloadCalls(this.repo, target, callersRaw)];
    callersRaw.length = 0;
    callersRaw.push(...callersByArity);
    // Same-name calls the graph did not resolve, from code not already listed as a caller.
    const callerIds = new Set(callersRaw.map(x => x.id));
    const unresolvedCallers = mergeCallSites(unresolvedNamed.filter(x => !callerIds.has(x.id)))
      .map(x => ({ name: x.name, type: x.type, file: x.filePath, startLine: x.startLine, endLine: x.endLine, contextLines: siteLines(x) }));
    let calleesRaw = mergeCallSites([
      ...this.repo.getCallees(target, { limit: 160 }),
      ...(this.repo.getBareCallees?.(target, { limit: 80 }) || []),
    ]).map((x, i) => (callIntoTestTree(target.filePath, x.filePath) ? asUnresolved(x, i) : x))
      .map(x => ({ ...x, depth: 1 }));
    calleesRaw = bindCalleeOverloads(this.repo, target, calleesRaw);
    // A type calls nothing itself: its callees are its methods' calls out of the type
    // (r3hb-okhttp-12: `ss-trace RealCall callees` printed "(no callees in the repository)"
    // for a 560-line class). Calls between its own methods are left out.
    let memberCount = 0;
    // (A class's own rows are at most a few unresolved calls in field initialisers: RealCall had 2.)
    const inRepo = (x) => x?.filePath && !String(x.id).startsWith('external:');
    if (!calleesRaw.some(inRepo) && TYPE_USER_TARGETS.has(target.type) && typeof this.repo.getMemberCallables === 'function') {
      const members = this.repo.getMemberCallables(target, { limit: MEMBER_CALLEE_SOURCES });
      const own = new Set([target.id, ...members.map(m => m.id)]);
      const rows = [];
      for (const m of members) {
        for (const c of [...this.repo.getCallees(m, { limit: 80 }), ...(this.repo.getBareCallees?.(m, { limit: 40 }) || [])]) {
          if (own.has(c.id)) continue;
          // Unresolved rows carry a per-query index in their id: one row per called name.
          rows.push(String(c.id).startsWith('external:') ? { ...c, id: `external:member:${c.name}` } : c);
        }
      }
      const fromMembers = mergeCallSites([...calleesRaw, ...rows])
        .map(x => (callIntoTestTree(target.filePath, x.filePath) ? asUnresolved(x, 0) : x))
        .map(x => ({ ...x, depth: 1 }));
      if (fromMembers.some(inRepo)) {
        calleesRaw = fromMembers;
        memberCount = members.length;
      }
    }
    if (!calleesRaw.length) {
      // No stored callees: fall back to names called in the body. A qualified
      // name binds only through bindQualifiedHint (own-type receiver, same
      // file); an unqualified name binds to its one free definition.
      const noResolvedCallees = new Map();
      calleesRaw = targetHintSites
        .map(site => (site.qualified
          ? bindQualifiedHint(site, this.repo, target, noResolvedCallees)
          : sameFileOrUniqueDefinition(this.repo, site.name, target)))
        .filter(isLikelyCodeEntity)
        .map(x => ({ ...x, relationship: 'handoff', depth: 1 }));
    }
    const impactRaw = buildImpactPaths(this.repo, target, {
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      limit: 120,
      genericName,
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
    const impactPaths = interleaveDirections(impactRaw.map(p => ({
      ...p,
      importance: scoreImpactPath(p, p.direction === 'downstream' ? calleeCtx : callerCtx),
    })));

    callers.sort(byTierThenImportance);
    callees.sort((a, b) => b.importance - a.importance);
    const budget = selectBudget(options.tokenBudget, { callers, callees, impactPaths });
    const targetFan = traceFanCounts(callersRaw, calleesRaw);
    const shares = modeSectionShares(sectionShares(targetFan, options.queryHint, target), options.modeSection);
    const targetInfo = renderCode(target, {
      readFileRange,
      tokenCap: Math.floor(budget.tokenBudget * shares.target),
      perItemCap: Math.floor(budget.tokenBudget * shares.target),
    });
    const packOpts = {
      readFileRange,
      perItemCap: itemCodeCap(budget.tier),
      rowsOnly: options.rowsOnly === true,
    };
    const callersPack = packSection(callers, Math.floor(budget.tokenBudget * shares.callers), packOpts);
    const calleesPack = packSection(callees, Math.floor(budget.tokenBudget * shares.callees), packOpts);
    const impactPack = this._packImpact(impactPaths, Math.floor(budget.tokenBudget * shares.impact), {
      inRepoOnly: options.inRepoImpactOnly === true,
    });
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
      disambiguation: traceAlternatives(cleanSymbol, target, candidates),
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
        // `hidden`: in-repository rows the budget left out; `external`: rows outside the
        // repository (or unresolved), packed or not.
        callers: {
          total: siteCount(callers), siteNoun: siteNoun(callers), distinct: targetFan.fanIn, shown: callersPack.items.length, items: callersPack.items,
          ...rowCounts(callers, callersPack.items),
          provenance: callerProvenance,
          unresolvedByName: unresolvedCallers,
        },
        callees: {
          total: siteCount(callees), siteNoun: siteNoun(callees), distinct: targetFan.fanOut, shown: calleesPack.items.length, items: calleesPack.items,
          ...rowCounts(callees, calleesPack.items),
          // > 0: a type's callees, gathered from this many of its methods.
          ...(memberCount > 0 ? { viaMembers: memberCount } : {}),
        },
        impact: { total: impactPaths.length, shown: impactPack.paths.length, hidden: impactPack.hidden, paths: impactPack.paths },
      },
    };
  }

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.inRepoOnly] - skip paths through a definition outside the
   *   repository (the compact ss-trace never prints them, so they must not take a slot)
   * @returns {{ paths: object[], tokensUsed: number, hidden: number }} `hidden` counts the
   *   distinct (in-repository, with inRepoOnly) paths that did not fit
   */
  _packImpact(paths, budget, { inRepoOnly = false } = {}) {
    const out = [];
    let used = 0;
    let hidden = 0;
    let full = false;
    const maxPaths = impactPathLimit(budget);
    // A stored call and a body hint can reach the same definition: one row per path text.
    const printed = new Set();
    for (const p of paths) {
      if (inRepoOnly && p.path.some(n => !n.filePath)) continue;
      const text = formatPath(p);
      if (printed.has(text)) continue;
      printed.add(text);
      if (full || out.length >= maxPaths) { hidden++; continue; }
      const row = {
        path: text,
        nodes: p.path.map(n => ({ name: n.name, type: n.type || null, file: n.filePath || null, line: n.startLine || null })),
        direction: p.direction || 'upstream',
        depth: p.depth,
        edgeTypes: p.edgeTypes,
        importance: Number(p.importance.toFixed(4)),
      };
      const cost = estimateTokens(`${row.path} ${row.edgeTypes.join(' ')}`);
      if (used + cost > budget && out.length >= 3) { full = true; hidden++; continue; }
      used += cost;
      out.push(row);
    }
    return { paths: out, tokensUsed: used, hidden };
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
