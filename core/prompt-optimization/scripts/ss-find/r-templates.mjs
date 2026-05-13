/**
 * Deterministic regex-template generators for the PHASE6_REDO ss-find sweep.
 *
 * The ss-find shape grid has TWO axes (PHASE6_REDO §12.1, refined 2026-05-13
 * after the ss-search redo landed):
 *   - Axis 1 (this module): 7 regex anchor shapes R1..R7, derived from
 *     `gold.expectedSymbol` + family + goldQuery + graph neighbours. No LLM.
 *   - Axis 2 (author-variants-ss-find.mjs): 7 semantic-query shapes Q1..Q7
 *     authored by DeepSeek V4-Flash.
 *
 * Each R-cell is one fact about what regex the agent would write. The set
 * is chosen to cover practical regex space — bare → word-bound → definition-
 * form → wildcard → alternation (narrow → broad) → character-class.
 *
 *   R1: bare-literal (no anchors)            — most permissive
 *   R2: word-bounded literal                  — canonical "narrow"
 *   R3: definition-anchored                   — language-keyword + symbol
 *   R4: wildcard around symbol sub-token      — catches `useSymbol`, `SymbolImpl`, etc.
 *   R5: small alternation (3 terms)           — canonical "medium"
 *   R6: broad alternation (6 terms)           — canonical "broad"
 *   R7: character-class shape pattern         — `[a-z_]*<sub>[a-z_]*\b`
 *
 * The output is a string ready to hand to ripgrep via `patternSearch`.
 *
 * Exports a single `buildAllRegexCells(input)` function plus the seven
 * individual generators for unit-test access.
 */

import { symbolSubTokens } from '../validator.mjs';

// Per-family definition keyword sets. Used by R3 (definition-anchored cell).
// Per-family rather than per-language keeps the table small while covering
// the agent's realistic regex vocabulary.
export const FAMILY_DEF_KEYWORDS = Object.freeze({
  'OO-monolithic': '(public|private|protected|static|final|class|interface|enum|void|fun|object|val|var|def|sealed)',
  'Systems-modular-terse': '(pub\\s+fn|fn|struct|trait|impl|enum|type|const|static|func|var|use)',
  'C-family': '(static|inline|extern|class|struct|template|void|int|auto|namespace)',
  'JS-mobile': '(function|const|let|var|class|export|async|abstract|void|Future|Stream)',
  'Scripting-dynamic': '(def|defp|defmodule|defmacro|defstruct|class|module|function|local function)',
});

const FALLBACK_DEF_KEYWORDS = '(function|def|class|fn|struct|interface|impl|public|static|const|let|var)';

// Common English stopwords + common-but-noisy code words that should NOT
// drive R6's broad alternation. Mirrors the QUERY_STOPWORDS spirit from the
// main codebase but kept local so this module stays standalone.
const Q_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'into', 'from', 'how', 'where',
  'what', 'when', 'which', 'does', 'do', 'is', 'are', 'was', 'were', 'has',
  'have', 'had', 'be', 'been', 'will', 'would', 'should', 'could', 'can', 'may',
  'might', 'must', 'shall', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'by', 'as',
  'or', 'but', 'not', 'no', 'yes', 'so', 'up', 'out', 'all', 'any', 'some',
  'one', 'two', 'three', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'such', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'see', 'them',
  'their', 'there', 'these', 'those', 'they', 'we', 'you', 'i', 'he', 'she',
  'function', 'method', 'class', 'struct', 'type', 'file', 'line', 'code',
  'name', 'value', 'string', 'number', 'object', 'item', 'list', 'array',
]);

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Escape a literal string for use inside a regex (ripgrep + JS-style PCRE).
 * Conservative — escapes every byte that has meaning in either flavour.
 */
export function regexEscape(literal) {
  if (literal == null) return '';
  return String(literal).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

/**
 * Pick the largest interesting sub-token of the symbol (used by R4 / R7).
 * "Largest interesting" = the longest non-stopword sub-token of length ≥ 4.
 * If none qualify, fall back to the longest sub-token; if no sub-tokens at
 * all, fall back to the raw lowercased symbol.
 */
export function pickPrimarySubToken(symbol) {
  const subs = symbolSubTokens(symbol);
  if (subs.length === 0) return String(symbol || '').toLowerCase();
  const interesting = subs.filter((s) => s.length >= 4 && !Q_STOPWORDS.has(s));
  const pool = interesting.length ? interesting : subs;
  // tie-break: longest first; stable insertion order for ties.
  return pool.slice().sort((a, b) => b.length - a.length || subs.indexOf(a) - subs.indexOf(b))[0];
}

/**
 * Pick K domain-content tokens from a free-text query (goldQuery / goldNotes
 * / source snippet). Used by R6 to produce a broad-alternation regex. Drops
 * stopwords, repeats, tokens < 4 chars, and tokens identical to a symbol
 * sub-token (so the gold's own sub-tokens aren't recounted).
 */
export function pickDomainTokens(text, k, { exclude = new Set() } = {}) {
  if (!text) return [];
  // Split on whitespace + identifier separators (`_`, `-`) so a compound
  // identifier like `detect_package_root` in the gold's prose decomposes to
  // `detect | package | root` and lands in the exclude-by-stem filter.
  const tokens = String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length >= 4 && !Q_STOPWORDS.has(t) && !exclude.has(t));
  // Stable-deduplicate while preserving discovery order — first-mention wins.
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= k) break;
  }
  return out;
}

/**
 * Pick 2 graph-neighbour symbol names for R5's small-alternation cell.
 * Prefers callers + callees; ignores entries with no name or with names
 * lexically identical to the gold symbol.
 */
export function pickNeighborSymbols(graphNeighbors, k, expectedSymbol) {
  const out = [];
  const seen = new Set([String(expectedSymbol || '').toLowerCase()]);
  const candidates = [
    ...(graphNeighbors?.callers ?? []),
    ...(graphNeighbors?.callees ?? []),
    ...(graphNeighbors?.implementors ?? []),
  ];
  for (const c of candidates) {
    const name = c?.symbol;
    if (!name) continue;
    const lower = String(name).toLowerCase();
    if (seen.has(lower)) continue;
    if (lower.length < 3) continue;
    seen.add(lower);
    out.push(name);
    if (out.length >= k) break;
  }
  return out;
}

/**
 * Pick K sibling identifiers from a chunk's text — used by R5 as a fallback
 * when graph-neighbours are sparse (which is the common case for many of the
 * 144 AST-tester golds, per the 2026-05-13 spot-check). An "identifier" here
 * is a token that:
 *   - is ≥ 3 chars
 *   - starts with an uppercase letter OR contains `_` OR is camelCase
 *     (lower→Upper transition); i.e., looks like code, not English prose
 *   - is NOT the gold symbol itself (case-insensitive)
 *   - is NOT a generic keyword (the family-keyword sets are too noisy here,
 *     so we use a small built-in stopword list of common reserved words)
 *
 * Picks in first-appearance order — the chunk's leading siblings are usually
 * the most semantically related to the gold symbol.
 */
const CHUNK_KEYWORD_STOPS = new Set([
  // common reserved / language keywords that shouldn't be picked as siblings
  'pub', 'fn', 'def', 'class', 'struct', 'trait', 'impl', 'enum', 'type',
  'const', 'static', 'mut', 'self', 'this', 'super', 'use', 'mod', 'pkg',
  'let', 'var', 'val', 'object', 'package', 'import', 'from', 'as', 'in',
  'if', 'else', 'for', 'while', 'do', 'return', 'break', 'continue',
  'public', 'private', 'protected', 'internal', 'final', 'abstract',
  'async', 'await', 'function', 'method', 'module', 'interface',
  'void', 'true', 'false', 'null', 'none', 'undefined', 'new', 'try',
  'catch', 'finally', 'throw', 'with', 'yield', 'and', 'not', 'or',
  // common stdlib types that turn up everywhere
  'string', 'int', 'bool', 'float', 'double', 'long', 'short',
  'option', 'result', 'vec', 'list', 'map', 'set', 'hashmap', 'hashset',
  'self', 'cls', 'args', 'kwargs',
]);

export function pickSiblingSymbolsFromChunk(chunkText, expectedSymbol, k) {
  if (!chunkText) return [];
  const goldLower = String(expectedSymbol || '').toLowerCase();
  const seen = new Set([goldLower]);
  const out = [];
  // Match identifier-shaped tokens. A run of ASCII letters / digits /
  // underscores; we'll filter by shape below.
  const re = /[A-Za-z_][A-Za-z0-9_]{2,}/g;
  let m;
  while ((m = re.exec(chunkText)) !== null) {
    const tok = m[0];
    const lower = tok.toLowerCase();
    if (seen.has(lower)) continue;
    if (CHUNK_KEYWORD_STOPS.has(lower)) continue;
    if (lower.length < 3) continue;
    // Identifier-shape heuristic: must look like code, not English prose.
    const startsUpper = /^[A-Z]/.test(tok);
    const hasUnderscore = tok.includes('_');
    const isCamel = /[a-z][A-Z]/.test(tok);
    if (!startsUpper && !hasUnderscore && !isCamel) continue;
    seen.add(lower);
    out.push(tok);
    if (out.length >= k) break;
  }
  return out;
}

// ─── R-cell generators ─────────────────────────────────────────────────────

export function buildR1(input) {
  // R1: bare literal — no anchors, no word boundaries. Most permissive form
  // an agent might write (e.g., `rg "detect_package_root"`).
  return regexEscape(input.expectedSymbol ?? '');
}

export function buildR2(input) {
  // R2: word-bounded literal — the canonical "narrow" anchor.
  const sym = regexEscape(input.expectedSymbol ?? '');
  return sym ? `\\b${sym}\\b` : '';
}

export function buildR3(input) {
  // R3: definition-anchored — language-keyword (per family) followed by the
  // symbol. Catches the place the symbol is DEFINED rather than every site
  // it's referenced.
  const sym = regexEscape(input.expectedSymbol ?? '');
  if (!sym) return '';
  const kw = FAMILY_DEF_KEYWORDS[input.family] ?? FALLBACK_DEF_KEYWORDS;
  return `\\b${kw}\\s+${sym}\\b`;
}

export function buildR4(input) {
  // R4: wildcard-around-sub-token — catches `useDetect`, `detectorImpl`,
  // etc. when the agent wants any identifier containing a relevant stem.
  const stem = pickPrimarySubToken(input.expectedSymbol ?? '');
  if (!stem) return '';
  return `\\b\\w*${regexEscape(stem)}\\w*\\b`;
}

export function buildR5(input) {
  // R5: small alternation — symbol + up to 2 graph neighbours. The canonical
  // "medium" anchor. When graph-neighbours are sparse (common across the
  // AST-tester corpus per the 2026-05-13 spot-check), fall back to scanning
  // the containing chunk for sibling identifiers — gives R5 distinct
  // discriminative power from R2's bare word-bounded form even on golds
  // with no recorded callers/callees.
  const sym = input.expectedSymbol ?? '';
  if (!sym) return '';
  const need = 2;
  const neighbours = pickNeighborSymbols(input.graphNeighbors, need, sym);
  if (neighbours.length < need) {
    const fromChunk = pickSiblingSymbolsFromChunk(
      input.containingChunk?.text ?? input.sourceSnippet?.text ?? '',
      sym, need - neighbours.length,
    );
    for (const sib of fromChunk) {
      if (!neighbours.some((n) => n.toLowerCase() === sib.toLowerCase())) {
        neighbours.push(sib);
      }
    }
  }
  const alts = [sym, ...neighbours].map(regexEscape);
  return `\\b(${alts.join('|')})\\b`;
}

export function buildR6(input) {
  // R6: broad alternation — 6 domain-content tokens drawn from the gold's
  // own description (goldQuery + goldNotes). The agent picking R6 is
  // saying "I don't know the exact identifier, here's a wide net of terms".
  // Excludes the symbol's own sub-tokens so R6 is distinct from R5.
  const symSubs = new Set(symbolSubTokens(input.expectedSymbol ?? ''));
  const corpus = `${input.goldQuery ?? ''} ${input.goldNotes ?? ''}`;
  const tokens = pickDomainTokens(corpus, 6, { exclude: symSubs });
  if (tokens.length < 2) return buildR2(input); // fall back to narrow when corpus is too thin
  return `\\b(${tokens.map(regexEscape).join('|')})\\b`;
}

export function buildR7(input) {
  // R7: character-class shape pattern — `[a-z_]*<stem>[a-z_]*\b`. Different
  // from R4 in that it forbids digits / uppercase mid-token — slightly
  // narrower while still catching morphological variants.
  const stem = pickPrimarySubToken(input.expectedSymbol ?? '');
  if (!stem) return '';
  return `\\b[a-z_]*${regexEscape(stem)}[a-z_]*\\b`;
}

const R_BUILDERS = Object.freeze({
  R1: buildR1, R2: buildR2, R3: buildR3, R4: buildR4,
  R5: buildR5, R6: buildR6, R7: buildR7,
});

export const R_CELLS = Object.freeze(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']);

export const R_LABELS = Object.freeze({
  R1: 'bare-literal+no-anchor',
  R2: 'word-bounded+literal',
  R3: 'definition-anchored+family-keyword',
  R4: 'wildcard-around+sub-token',
  R5: 'small-alternation+symbol+neighbours',
  R6: 'broad-alternation+domain-tokens',
  R7: 'character-class+sub-token',
});

/**
 * Build all 7 R-cells for one input record. Returns a `{ R1, ..., R7 }` map
 * of cell → regex string; cells that cannot be derived (e.g., no symbol)
 * return an empty string and should be skipped at sweep time.
 */
export function buildAllRegexCells(input) {
  const out = {};
  for (const cell of R_CELLS) {
    out[cell] = R_BUILDERS[cell](input);
  }
  return out;
}
