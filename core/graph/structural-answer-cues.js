import { stripNonCode } from './structural-callsite-hints.js';

const STOP = new Set([
  'const', 'let', 'var', 'return', 'function', 'export', 'import', 'from', 'null', 'true', 'false',
  'this', 'self', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'typeof',
  'string', 'number', 'boolean', 'undefined', 'object', 'class', 'struct', 'enum', 'trait', 'impl',
  'pub', 'fn', 'func', 'mut', 'use', 'type', 'async', 'await', 'new', 'def', 'len', 'none', 'the', 'that', 'this', 'with',
  'when', 'where', 'which', 'from', 'into', 'will', 'can', 'may', 'not', 'and', 'or',
]);

// A member read through the receiver (`this.x`, `self.x`, `self::x`, `@x`) is
// state coupling: the field a method reads is the fix surface a body-local
// read cannot show (squashql-295: `this.subQueryMeasures` was the one term
// that mattered and it ranked below `FIXME` and `private`, past the 24 cap).
const RECEIVER_MEMBER_RE = /(?:\b(?:this|self)\s*(?:\.|::)\s*|(?<![\w$])@)([A-Za-z_$][A-Za-z0-9_$]{2,})/g;
const RECEIVER_MEMBER_BONUS = 4;

function terms(text) {
  const out = new Map();
  const source = String(text || '');
  for (const m of source.matchAll(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g)) {
    const raw = m[0];
    const key = raw.toLowerCase();
    if (STOP.has(key)) continue;
    const prev = out.get(key) || { raw, count: 0, score: 0 };
    prev.count++;
    prev.score += /[A-Z_]/.test(raw.slice(1)) || /^[A-Z]/.test(raw) ? 2 : 1;
    out.set(key, prev);
  }
  const boosted = new Set();
  for (const m of source.matchAll(RECEIVER_MEMBER_RE)) {
    const key = m[1].toLowerCase();
    const entry = out.get(key);
    if (!entry || boosted.has(key)) continue;
    boosted.add(key);
    entry.score += RECEIVER_MEMBER_BONUS;
  }
  return out;
}

function rankedTerms(target, hint) {
  const found = terms(`${target.signature || ''}\n${target.summary || ''}\n${stripNonCode(target.code || '')}`);
  const hintText = String(hint || '').toLowerCase();
  for (const [key, value] of found) {
    if (hintText.includes(key)) value.score += 4;
    value.score += Math.min(4, value.count);
  }
  return [...found.values()]
    .sort((a, b) => (b.score - a.score) || a.raw.localeCompare(b.raw))
    .slice(0, 24)
    .map(x => x.raw);
}

function shortItem(x) {
  const loc = x.filePath ? `${x.filePath}:${x.startLine || '?'}` : 'external';
  const edge = x.relationship ? `${x.relationship} ` : '';
  return `${edge}${x.name} (${loc})`;
}

function shortPath(p) {
  return p.path.map(x => `${x.name}${x.filePath ? `@${x.filePath}:${x.startLine || '?'}` : '@external'}`).join(' -> ');
}

function isLowSignalPath(filePath = '') {
  return /(^|\/)(__tests__|tests?|spec|fixtures|examples?|docs?)(\/|$)|[-_.](test|spec)\.[cm]?[jt]sx?$|_test\.go$/.test(filePath);
}

function preferProduction(items, isLowSignal) {
  const primary = items.filter(item => !isLowSignal(item));
  return primary.length ? primary : items;
}

function addSymbol(out, name) {
  if (name && !out.includes(name)) out.push(name);
}

function keySymbols(target, hint, callers, callees, impactPaths) {
  const q = String(hint || '').toLowerCase();
  const out = [];
  addSymbol(out, target.name);
  const wantsCallers = /\b(caller|callers|upstream|references)\b/.test(q);
  const wantsCallees = /\b(callee|callees|downstream|helper|helpers|conversion|next)\b/.test(q);
  const wantsImpact = /\b(impact|changing|change|affect|break|handoff|surface)\b/.test(q);
  if (wantsCallers || (!wantsCallees && !wantsImpact)) callers.slice(0, 3).forEach(item => addSymbol(out, item.name));
  if (wantsCallees || (!wantsCallers && !wantsImpact)) callees.slice(0, 4).forEach(item => addSymbol(out, item.name));
  if (wantsImpact) {
    for (const path of impactPaths.slice(0, 4)) {
      for (const item of path.path || []) {
        if (item.type !== 'external') addSymbol(out, item.name);
      }
    }
  }
  return out.slice(0, 10);
}

const BRANCH_ORDER = [
  'tuple', 'dict', 'list', 'str', 'string', 'bytes', 'bytearray', 'buffer', 'stream', 'json',
  'response', 'status', 'headers', 'params', 'body', 'querystring', 'atomicbool', 'parallel',
];
const BRANCH_WORDS = new Set(BRANCH_ORDER);

function branchTerms(targetTerms) {
  const byLower = new Map();
  for (const term of targetTerms) {
    const lower = term.toLowerCase();
    if (BRANCH_WORDS.has(lower)) {
      byLower.set(lower, term);
      continue;
    }
    for (const branch of BRANCH_ORDER) {
      if (lower === `${branch}s` || lower.startsWith(`${branch}schema`)) {
        byLower.set(branch, branch);
      }
    }
  }
  return BRANCH_ORDER.map(term => byLower.get(term)).filter(Boolean).slice(0, 12);
}

function branchSnippets(target, branches) {
  if (!branches.length || !target.code) return [];
  const wanted = branches.map(x => x.toLowerCase());
  const lines = String(target.code).split('\n');
  const out = [];
  const covered = new Set();
  let tripleQuote = null;
  for (let i = 0; i < lines.length && out.length < 12; i++) {
    const line = lines[i].trim();
    const quote = line.includes('"""') ? '"""' : line.includes("'''") ? "'''" : null;
    if (tripleQuote) {
      if (quote === tripleQuote) tripleQuote = null;
      continue;
    }
    if (quote) {
      if ((line.match(new RegExp(quote, 'g')) || []).length % 2 === 1) tripleQuote = quote;
      continue;
    }
    if (!line || /^(#|\/\/|\/\*|\*|`|:)/.test(line)) continue;
    if (!/[()[\]{}=:]|\b(if|elif|else|case|switch|const|let|var|return)\b/.test(line)) continue;
    const lower = line.toLowerCase();
    const hits = wanted.filter(term => lower.includes(term) || lower.includes(`${term}schema`));
    if (!hits.length || hits.every(term => covered.has(term))) continue;
    const lineNo = (target.startLine || 1) + i;
    out.push(`L${lineNo}: ${line.replace(/\s+/g, ' ')}`);
    hits.forEach(term => covered.add(term));
    if (covered.size >= wanted.length) break;
  }
  return out;
}

function relatedDefinitions(target, targetTerms, resolveTerm) {
  if (!resolveTerm) return [];
  const out = [];
  const seen = new Set([target.id]);
  for (const term of targetTerms.slice(0, 12)) {
    const found = resolveTerm(term);
    if (!found || seen.has(found.id) || found.filePath !== target.filePath) continue;
    if (found.name === target.name && found.startLine === target.startLine) continue;
    seen.add(found.id);
    const snippet = found.summary && found.summary !== 'Same-file definition found from source text'
      ? ` - ${found.summary}`
      : '';
    out.push(`${found.name} [${found.type}] ${found.filePath}:${found.startLine || '?'}${snippet}`);
    if (out.length >= 6) break;
  }
  return out;
}

export function buildAnswerCues({ target, hint, callers, callees, impactPaths, resolveTerm }) {
  const targetTerms = rankedTerms(target, hint);
  const branches = branchTerms(targetTerms);
  const cueCallers = preferProduction(callers, item => isLowSignalPath(item.filePath));
  const cueCallees = preferProduction(callees, item => isLowSignalPath(item.filePath));
  const cuePaths = preferProduction(impactPaths, path => (path.path || []).some(item => isLowSignalPath(item.filePath)));
  return {
    targetTerms,
    keySymbols: keySymbols(target, hint, cueCallers, cueCallees, cuePaths),
    branchTerms: branches,
    branchSnippets: branchSnippets(target, branches),
    relatedDefinitions: relatedDefinitions(target, targetTerms, resolveTerm),
    topCallers: cueCallers.slice(0, 5).map(shortItem),
    topCallees: cueCallees.slice(0, 5).map(shortItem),
    criticalPaths: cuePaths.slice(0, 5).map(shortPath),
  };
}
