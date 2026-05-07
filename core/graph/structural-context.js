/**
 * Unified structural context builder.
 *
 * Produces one agent-oriented trace for a symbol: callers, callees, and
 * transitive impact paths, ranked and packed under an adaptive token budget.
 */

import { DB_PATHS } from '../infrastructure/config/index.js';
import { StructuralContextRepository } from '../infrastructure/structural-context-repository.js';
import { buildAnswerCues } from './structural-answer-cues.js';
import { callsiteHints } from './structural-callsite-hints.js';
import { extractHeaderContext } from './structural-header-context.js';
const BUDGETS = { preview: 4000, full: 8000, xl: 12000 };
const DEFAULT_MAX_DEPTH = 3;
const REL_WEIGHT = { calls: 1.0, uses: 0.72, implements: 0.88, extends: 0.84, overrides: 0.78 };
const TYPE_WEIGHT = {
  class: 0.92, struct: 0.9, trait: 0.88, interface: 0.86, enum: 0.84,
  function: 0.84, method: 0.82, component: 0.78, type: 0.7, typeAlias: 0.68, external: 0.2,
};
function estimateTokens(text) {
  return text ? Math.ceil(String(text).length / 3.5) : 0;
}
function clamp(n, lo, hi) {
  const x = Number.parseInt(n, 10);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function isTestPath(filePath = '') {
  return /(^|\/)(__tests__|tests?|spec|fixtures|examples?|docs?)(\/|$)|[-_.](test|spec)\.[cm]?[jt]sx?$|_test\.go$/.test(filePath);
}

function isExported(entity) {
  const name = entity?.name || '';
  const sig = entity?.signature || '';
  if (!name) return false;
  if (/^\w/.test(name) && name[0] === name[0].toUpperCase()) return true;
  return /\b(export|public|pub)\b/.test(sig) || /^[A-Z_][A-Z0-9_]+$/.test(name);
}

function logNorm(value, maxValue) {
  if (!value || !maxValue) return 0;
  return Math.log1p(value) / Math.log1p(maxValue);
}

function tokenize(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) || [])];
}

function hintScore(entity, hintTokens) {
  if (!hintTokens.length) return 0;
  const hay = `${entity.name} ${entity.type} ${entity.signature} ${entity.summary}`.toLowerCase();
  let hits = 0;
  for (const tok of hintTokens) if (hay.includes(tok)) hits++;
  return hits / hintTokens.length;
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

function scoreEntity(entity, ctx) {
  const fan = ctx.fan.get(entity.id) || { fanIn: 0, fanOut: 0 };
  const rel = REL_WEIGHT[entity.relationship] ?? 0.55;
  const maxIn = ctx.maxFanIn || 1;
  const maxOut = ctx.maxFanOut || 1;
  const proximity = 1 / Math.max(1, entity.depth || 1);
  let score =
    0.28 * proximity +
    0.20 * rel +
    0.18 * logNorm(fan.fanIn, maxIn) +
    0.12 * logNorm(fan.fanOut, maxOut) +
    0.10 * (TYPE_WEIGHT[entity.type] ?? 0.5) +
    0.08 * (isExported(entity) ? 1 : 0) +
    0.10 * hintScore(entity, ctx.hintTokens || []);
  if (isTestPath(entity.filePath)) score -= 0.38;
  if (entity.type === 'external') score -= 0.25;
  return Math.max(0.01, score);
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
    const line = entity.contextLine || opts.focusLine;
    if (line && line >= entity.startLine && line <= entity.endLine) {
      slices.push({ start: Math.max(entity.startLine, line - 2), end: Math.min(entity.endLine, line + 2) });
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

function itemSummary(entity) {
  const loc = entity.filePath ? `${entity.filePath}:${entity.startLine || '?'}` : '(external)';
  const call = entity.contextLine ? ` call@${entity.contextLine}` : '';
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
  addHintImpactPaths(paths, seenPathIds, repo, target, opts.hints || [], limit);
  return paths;
}

function addHintImpactPaths(paths, seen, repo, target, hints, limit) {
  for (const name of hints) {
    if (paths.length >= limit) break;
    const hint = repo.findEntityCandidates?.(name, { limit: 1 })?.[0];
    if (!hint || hint.id === target.id) continue;
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

function scoreImpactPath(path, ctx) {
  const nodes = path.direction === 'downstream' ? path.path.slice(1) : path.path.slice(0, -1);
  const scored = nodes.map(node => scoreEntity({ ...node, depth: path.depth }, ctx));
  if (!scored.length) return 0.01;
  const bottleneck = Math.min(...scored);
  const avg = scored.reduce((a, b) => a + b, 0) / scored.length;
  return Math.max(0.01, (0.55 * bottleneck + 0.45 * avg) / Math.sqrt(path.depth));
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
    const targetCallsiteHints = callsiteHints(targetSource, new Set([target.name]));
    const callersRaw = [...this.repo.getCallers(target, { limit: 160 }), ...(this.repo.getAliasCallers?.(target, { limit: 80 }) || [])].map(x => ({ ...x, depth: 1 }));
    let calleesRaw = this.repo.getCallees(target, { limit: 160 }).map(x => ({ ...x, depth: 1 }));
    if (!calleesRaw.length) calleesRaw = targetCallsiteHints.map(name => this.repo.findEntityCandidates?.(name, { limit: 1 })?.[0]).filter(Boolean).map(x => ({ ...x, relationship: 'handoff', depth: 1 }));
    const impactRaw = buildImpactPaths(this.repo, target, {
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      limit: 120,
      hints: targetCallsiteHints,
    });
    const ids = [
      target.id,
      ...callersRaw.map(x => x.id),
      ...calleesRaw.map(x => x.id),
      ...impactRaw.flatMap(p => p.path.map(x => x.id)),
    ];
    const fan = this.repo.getFanCounts(ids);
    const maxFanIn = Math.max(1, ...[...fan.values()].map(x => x.fanIn));
    const maxFanOut = Math.max(1, ...[...fan.values()].map(x => x.fanOut));
    const scoreCtx = {
      fan,
      maxFanIn,
      maxFanOut,
      hintTokens: tokenize(options.queryHint || cleanSymbol),
    };
    const callers = callersRaw.map(x => ({ ...x, importance: scoreEntity(x, scoreCtx) }));
    const callees = calleesRaw.map(x => ({ ...x, importance: scoreEntity(x, scoreCtx) }));
    const impactPaths = impactRaw.map(p => ({ ...p, importance: scoreImpactPath(p, scoreCtx) }))
      .sort((a, b) => b.importance - a.importance);

    callers.sort((a, b) => b.importance - a.importance);
    callees.sort((a, b) => b.importance - a.importance);
    const budget = selectBudget(options.tokenBudget, { callers, callees, impactPaths });
    const targetFan = fan.get(target.id) || { fanIn: callers.length, fanOut: callees.length };
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
        callers: { total: callers.length, shown: callersPack.items.length, items: callersPack.items },
        callees: { total: callees.length, shown: calleesPack.items.length, items: calleesPack.items },
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
      sections: { callers: { total: 0, shown: 0, items: [] }, callees: { total: 0, shown: 0, items: [] }, impact: { total: 0, shown: 0, paths: [] } },
    };
  }
}

export { formatStructuralContext } from './structural-context-format.js';

export default StructuralContextBuilder;
