/**
 * Regex Prefiltering Module — literal extraction and sparse gram candidate lookup.
 *
 * Extracts required literal substrings from regex patterns, then uses either
 * ripgrep fixed-string prefiltering or the sparse trigram index to narrow the
 * file set before the full regex scan.  Keeps the hot-path fast by skipping
 * files that cannot possibly match.
 *
 * Split from search-pattern.js for the 500-line-limit rule.
 */

import {
  extractRegexLiteralClauses,
  loadSparseGramIndex,
  resolveSparseSymbolMask as _resolveSparseSymbolMask,
  nativeGrepFilesWithMatches as _nativeGrepFilesWithMatches,
  nativeGrepFilesWithMatchesFixed as _nativeGrepFilesWithMatchesFixed,
  nativeGrepLines as _nativeGrepLines,
  nativeGrepFull as _nativeGrepFull,
  getSparseGramAllFiles as _getSparseGramAllFiles,
  queryAndGrepLines as _queryAndGrepLines,
  queryAndGrepFull as _queryAndGrepFull,
  searchLines as _searchLines,
  searchFull as _searchFull,
} from '../infrastructure/native-sparse-gram.js';
import { applySparseDeltaOverlay, liveOverlayFiles, loadSparseDeltaOverlay } from './search-pattern-sparse-overlay.js';

// Re-export for search-pattern.js (avoids circular import through native-sparse-gram.js)
export const resolveSparseSymbolMask = _resolveSparseSymbolMask;
export const nativeGrepFilesWithMatches = _nativeGrepFilesWithMatches;
export const nativeGrepFilesWithMatchesFixed = _nativeGrepFilesWithMatchesFixed;
export const nativeGrepLines = _nativeGrepLines;
export const nativeGrepFull = _nativeGrepFull;
export const getSparseGramAllFiles = _getSparseGramAllFiles;
export const queryAndGrepLines = _queryAndGrepLines;
export const queryAndGrepFull = _queryAndGrepFull;
export const searchLines = _searchLines;
export const searchFull = _searchFull;
export {
  applySparseDeltaOverlay,
  getSparseGramAllFilesWithOverlay,
  loadSparseDeltaOverlay,
  sparseDeltaOverlayHasChanges,
  sparseGramPathFilter,
  grepUnfilterablePaths,
  gramsProveNoMatch,
} from './search-pattern-sparse-overlay.js';
import { DB_PATHS } from '../infrastructure/config/index.js';
import { resolveSearchSymbolFilter } from './search-pattern-chunks.js';

// =============================================================================
// Case-insensitive flag detection
// =============================================================================

export function hasCaseInsensitiveRegexFlag(regex) {
  return /\(\?[a-z-]*i[a-z-]*:?/.test(regex);
}

// =============================================================================
// Literal extraction from regex patterns
// =============================================================================

/**
 * Substrings that EVERY match of `regex` must contain, for the literal prefilter (ripgrep -F)
 * and the sparse gram index. Used when the native extractor returns nothing (it returns
 * nothing for any `(?i)` pattern, which is what every `ss-grep -i` sends).
 *
 * A prefilter literal must be sound: a wrong one turns real hits into a confident zero
 * (`ss-grep express -i -w` -> `(?i)\b(?:express)\b` used to yield ":express", and `\broute`
 * yielded "broute"). So this parses the pattern instead of scanning characters, and returns
 * [] — no prefilter, a full scan — for anything it does not fully understand.
 *
 * Understood: literal chars, escaped punctuation (`\.` is "."), zero-width and class escapes
 * (`\b \B \d \w \s \A \z` and negations: they break a literal, never join one), `.`, `^`, `$`,
 * character classes (with `[:alpha:]` and nested classes), groups `( )`, `(?: )`, named groups,
 * inline flags `(?i)` / `(?i: )`, lookarounds (skipped: they consume nothing), quantifiers
 * `? * + {n} {n,} {n,m}` with lazy/possessive suffixes. An optional atom contributes nothing; a
 * group with an alternation contributes nothing. Whitespace breaks a literal.
 * Gives up ([]) on: `|` at the top level (the caller expands alternations first), the `x` flag,
 * escapes with arguments or unknown meaning (`\x \u \p \Q \k \1 ...`), a `{` that may be a
 * counted repetition in some dialect (`{,3}`, `{ 2 }`), a quantifier with no atom, and
 * unbalanced groups or classes. Any other `{` is a literal char.
 */
export function extractRequiredLiteralsHeuristic(regex) {
  if (!regex || typeof regex !== 'string') return [];
  const s = regex;
  let i = 0;
  const BREAK = null;
  class Unsure extends Error {}
  const unsure = () => { throw new Unsure(); };

  // Zero-width or class escapes: a known meaning, never a literal char.
  // A `{` that is, or in some dialect may be, a counted repetition. Any other `{` is a literal
  // char (JS, PCRE) or a syntax error (Rust, ripgrep), and a literal is sound for both.
  const MAYBE_COUNTED = /^\{\s*[\d,]/;
  const CLASS_ESCAPES = new Set(['b', 'B', 'd', 'D', 'w', 'W', 's', 'S', 'A', 'z', 'Z', 'n', 'r', 't', 'f', 'v']);

  /** Parse a quantifier at i: { min, max } (max Infinity), or null when none follows. */
  function quantifier() {
    const c = s[i];
    let q = null;
    if (c === '?') q = { min: 0, max: 1 };
    else if (c === '*') q = { min: 0, max: Infinity };
    else if (c === '+') q = { min: 1, max: Infinity };
    if (q) i++;
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(s.slice(i));
      if (m) {
        const min = Number(m[1]);
        q = { min, max: m[2] ? (m[3] ? Number(m[3]) : Infinity) : min };
        i += m[0].length;
      } else if (MAYBE_COUNTED.test(s.slice(i))) unsure();   // `{,3}`, `{ 2 }`: dialect-dependent
      // else a literal `{` (or a syntax error, which matches nothing): the next atom
    }
    if (q && (s[i] === '?' || s[i] === '+')) i++;   // lazy / possessive
    if (q && /[?*+]/.test(s[i] || '')) unsure();   // stacked quantifiers (`a{2}{3}` fails as an atom)
    return q;
  }

  /** Skip a character class starting at i (`[`); returns nothing. */
  function skipClass() {
    let depth = 0;
    let first = true;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') { i += 2; first = false; continue; }
      if (c === '[') {
        if (depth > 0 && s[i + 1] === ':') {     // POSIX [:alpha:]
          const close = s.indexOf(':]', i + 2);
          if (close < 0) unsure();
          i = close + 2; first = false; continue;
        }
        depth++; i++;
        if (s[i] === '^') i++;
        first = true;
        continue;
      }
      if (c === ']' && !first) { depth--; i++; if (depth === 0) return; continue; }
      first = false; i++;
    }
    unsure();                                   // unterminated class
  }

  /**
   * Parse a sequence up to `)` or end. Returns { items, alternated }: items are single
   * required chars or BREAK, in order. With a `|` at this level, alternated is true and the
   * items mean nothing.
   */
  function sequence(depth) {
    const items = [];
    let alternated = false;
    while (i < s.length) {
      const c = s[i];
      if (c === ')') { if (depth === 0) unsure(); break; }
      if (c === '|') { alternated = true; i++; items.push(BREAK); continue; }
      let atom;                                 // array of items the atom contributes once
      if (c === '\\') {
        const e = s[i + 1];
        if (e === undefined) unsure();
        i += 2;
        if (/[A-Za-z0-9]/.test(e)) {
          if (!CLASS_ESCAPES.has(e)) unsure();
          atom = [BREAK];
        } else atom = [e];
      } else if (c === '[') {
        skipClass();
        atom = [BREAK];
      } else if (c === '(') {
        i++;
        let skip = false;                        // lookaround: consumes nothing
        if (s[i] === '?') {
          const m = /^\?([a-zA-Z-]*)([:)])/.exec(s.slice(i));
          if (m) {                               // (?flags) or (?flags: or (?:
            if (m[1].replace(/-.*$/, '').includes('x')) unsure();
            i += m[0].length;
            if (m[2] === ')') { items.push(BREAK); continue; }
          } else if (/^\?(=|!|<=|<!)/.test(s.slice(i))) {
            skip = true;
            i += s[i + 1] === '<' ? 3 : 2;
          } else if (/^\?P?<[A-Za-z_]\w*>/.test(s.slice(i))) {
            i = s.indexOf('>', i) + 1;           // named group: an ordinary group
          } else unsure();
        }
        const inner = sequence(depth + 1);
        if (s[i] !== ')') unsure();
        i++;
        atom = skip || inner.alternated ? [BREAK] : [BREAK, ...inner.items, BREAK];
      } else if (c === '*' || c === '+' || c === '?' || (c === '{' && MAYBE_COUNTED.test(s.slice(i)))) {
        unsure();                                // a quantifier with no atom
      } else {
        i++;
        atom = (c === '.' || c === '^' || c === '$' || /\s/.test(c)) ? [BREAK] : [c];
      }
      const q = quantifier();
      if (!q || (q.min === 1 && q.max === 1)) items.push(...atom);
      else if (q.min === 0) items.push(BREAK);
      else items.push(BREAK, ...atom, BREAK);    // required, but repeats: no joining across it
    }
    return { items, alternated };
  }

  let parsed;
  try {
    parsed = sequence(0);
    if (i !== s.length) return [];
  } catch (err) {
    if (err instanceof Unsure) return [];
    throw err;
  }
  if (parsed.alternated) return [];

  const literals = [];
  let current = '';
  for (const item of [...parsed.items, BREAK]) {
    if (item === BREAK) {
      if (current.length >= 3) literals.push(current);
      current = '';
    } else current += item;
  }
  return [...new Set(literals)];
}

export function extractLiteralClausesHeuristic(regex) {
  const literals = extractRequiredLiteralsHeuristic(regex);
  return literals.length > 0 ? [literals] : [];
}

export function normalizeLiteralClauses(clauses) {
  if (!Array.isArray(clauses)) return [];

  const normalized = [];
  for (const clause of clauses) {
    if (!Array.isArray(clause)) continue;
    const deduped = [];
    for (const literal of clause) {
      if (typeof literal !== 'string') continue;
      const trimmed = literal.trim();
      if (trimmed.length < 3 || deduped.includes(trimmed)) continue;
      deduped.push(trimmed);
    }
    if (deduped.length === 0) continue;
    if (!normalized.some(existing => existing.length === deduped.length && existing.every((value, idx) => value === deduped[idx]))) {
      normalized.push(deduped);
    }
  }

  return normalized;
}


// =============================================================================
// Alternation soundness guard
// =============================================================================
//
// THE DEFECT. A literal prefilter is sound only when EVERY string the regex can match
// contains at least one clause's literals. The native extractor silently drops an
// alternation branch that carries no usable literal:
//
//   extractRegexLiteralClauses('_color|_.*,')  ->  [['_color']]
//
// The `_.*,` branch has no 3-character literal, so it vanishes, and the prefilter then
// keeps only files containing `_color`. Every file that matched the other branch is
// dropped before the regex ever runs, and the agent is told `(no matches)`. Measured
// once on the fresh pool: 59 lines lost, none of them holding the literal the agent
// sought. It is the worst class of search bug — a confident, silent, wrong zero.
//
// The extractor lives in the native addon, so the guard sits here at the JS boundary:
// expand the pattern's alternations into the alternatives they stand for, extract from
// each one independently, and use the union ONLY when every alternative yielded a
// literal. If any alternative yields nothing, no sound prefilter exists and the scan
// must be full. Correctness over speed: a full scan is slower, a false zero is wrong.

/** Cap on expanded alternatives. Beyond this, refuse to prefilter rather than expand. */
const MAX_ALTERNATIVES = 32;

/** True when the pattern contains an alternation operator that actually alternates. */
export function hasAlternation(regex) {
  const s = String(regex);
  let inClass = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === '|') return true;
  }
  return false;
}

/**
 * Expand a regex's alternations into the list of alternative patterns it stands for,
 * preserving the matched language exactly. Returns null when that cannot be done
 * safely, which the caller must treat as "do not prefilter":
 *
 *   - a QUANTIFIED group containing an alternation. `(a|b)+` matches "ab", which
 *     neither `a+` nor `b+` does, so expanding it would narrow the language.
 *   - a non-capturing-group construct other than `(?:` — lookarounds and named
 *     groups — holding an alternation. A lookahead is not part of the match.
 *   - more than MAX_ALTERNATIVES products, or an unbalanced pattern.
 */
export function expandAlternatives(regex, max = MAX_ALTERNATIVES) {
  const s = String(regex);
  let i = 0;
  let bailed = false;

  // alternation := branch ('|' branch)*   — stops at ')' or end of input
  function parseAlternation(depth) {
    const branches = [];
    let current = parseBranch(depth);
    if (bailed) return null;
    branches.push(...current);
    while (i < s.length && s[i] === '|') {
      i++;
      current = parseBranch(depth);
      if (bailed) return null;
      branches.push(...current);
      if (branches.length > max) { bailed = true; return null; }
    }
    return branches;
  }

  // branch := atom*  — returns the cartesian product of its atoms' options
  function parseBranch(depth) {
    let out = [''];
    while (i < s.length && s[i] !== '|' && !(depth > 0 && s[i] === ')')) {
      const options = parseAtom(depth);
      if (bailed) return null;
      const next = [];
      for (const prefix of out) for (const opt of options) next.push(prefix + opt);
      if (next.length > max) { bailed = true; return null; }
      out = next;
    }
    return out;
  }

  function parseAtom(depth) {
    const c = s[i];
    if (c === '\\') {                       // escaped char: two units, never structural
      const lit = s.slice(i, i + 2); i += 2;
      return [lit + takeQuantifier()];
    }
    if (c === '[') {                        // character class: opaque, '|' inside is literal
      const start = i; i++;
      if (s[i] === '^') i++;
      if (s[i] === ']') i++;                // a leading ']' is a literal ']'
      while (i < s.length && s[i] !== ']') { if (s[i] === '\\') i++; i++; }
      if (i >= s.length) { bailed = true; return null; }
      i++;                                  // consume ']'
      return [s.slice(start, i) + takeQuantifier()];
    }
    if (c === '(') {
      const start = i; i++;
      let prefix = '(';
      let expandable = true;
      if (s[i] === '?') {
        // `(?:` is a plain group and expands. Every other `(?...)` construct — lookaround,
        // named group, inline flags — is opaque: expanding it would change what it asserts.
        if (s[i + 1] === ':') { i += 2; prefix = '(?:'; }
        else expandable = false;
      }
      if (!expandable) {
        const end = skipGroup(start);
        if (end < 0) { bailed = true; return null; }
        const body = s.slice(start, end);
        i = end;
        // An opaque construct that itself alternates cannot be reasoned about here.
        if (hasAlternation(body.slice(1, -1))) { bailed = true; return null; }
        return [body + takeQuantifier()];
      }
      const inner = parseAlternation(depth + 1);
      if (bailed) return null;
      if (s[i] !== ')') { bailed = true; return null; }
      i++;                                  // consume ')'
      const quant = takeQuantifier();
      if (quant && inner.length > 1) {
        // `(a|b)+` matches "ab"; no expansion of it preserves the language.
        bailed = true; return null;
      }
      // A quantified single-branch group keeps its parentheses so the quantifier still
      // binds the whole group; an unquantified one can drop them safely.
      return quant ? inner.map(x => `${prefix}${x})${quant}`) : inner;
    }
    if (c === ')') { bailed = true; return null; }   // unbalanced
    i++;
    return [c + takeQuantifier()];
  }

  /** Consume a quantifier suffix if one follows, including its lazy/possessive marker. */
  function takeQuantifier() {
    if (i >= s.length) return '';
    const c = s[i];
    let q = '';
    if (c === '*' || c === '+' || c === '?') { q = c; i++; }
    else if (c === '{') {
      const close = s.indexOf('}', i);
      if (close < 0) return '';
      const body = s.slice(i + 1, close);
      if (!/^\d+(,\d*)?$/.test(body)) return '';   // a literal '{', not a quantifier
      q = s.slice(i, close + 1); i = close + 1;
    }
    if (q && (s[i] === '?' || s[i] === '+')) { q += s[i]; i++; }
    return q;
  }

  /** Index just past the group opening at `from`, honouring classes and escapes. */
  function skipGroup(from) {
    let depth = 0, inClass = false;
    for (let j = from; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (inClass) { if (c === ']') inClass = false; continue; }
      if (c === '[') { inClass = true; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return j + 1; }
    }
    return -1;
  }

  const alts = parseAlternation(0);
  if (bailed || alts === null || i !== s.length) return null;
  if (alts.length === 0 || alts.length > max) return null;
  return alts;
}

/** Clauses for one pattern with no alternation left in it. */
function extractClausesDirect(regex, options) {
  if (!options.forceHeuristic) {
    try {
      const nativeClauses = normalizeLiteralClauses(extractRegexLiteralClauses(regex)?.clauses);
      if (nativeClauses.length > 0) return { clauses: nativeClauses, source: 'native' };
    } catch {
      // Fall back to heuristic extraction below.
    }
  }
  const heuristicClauses = extractLiteralClausesHeuristic(regex);
  if (heuristicClauses.length > 0) return { clauses: heuristicClauses, source: 'heuristic' };
  return { clauses: [], source: 'none' };
}

/**
 * Under `(?i)` the regex engines fold case with Unicode rules: `k` also matches U+212A (Kelvin
 * sign) and `s` matches U+017F (long s). The sparse gram index folds ASCII only, so a literal
 * holding `k` or `s` could miss such a line. Cut each literal there; a clause left with no
 * literal means no sound prefilter (an OR-clause cannot simply be dropped).
 */
function foldSafeClauses(clauses) {
  const out = [];
  for (const clause of clauses) {
    const parts = clause.flatMap((literal) => literal.split(/[ks]/i)).filter((part) => part.trim().length >= 3);
    if (parts.length === 0) return [];
    out.push(parts);
  }
  return normalizeLiteralClauses(out);
}

export function extractLiteralClauses(regex, options = {}) {
  if (!regex || typeof regex !== 'string') {
    return { clauses: [], source: 'none' };
  }
  const plan = extractLiteralClausesCased(regex, options);
  if (plan.clauses.length === 0 || !hasCaseInsensitiveRegexFlag(regex)) return plan;
  const clauses = foldSafeClauses(plan.clauses);
  return clauses.length > 0 ? { clauses, source: plan.source } : { clauses: [], source: 'none' };
}

function extractLiteralClausesCased(regex, options) {

  // An alternating pattern is only prefilterable when EVERY alternative it can match
  // carries a literal. Extract per alternative and union; the union is sound because each
  // alternative is covered by its own clause. If the pattern cannot be expanded safely, or
  // any alternative yields nothing, there is no sound prefilter and the scan must be full.
  if (hasAlternation(regex)) {
    const alternatives = expandAlternatives(regex);
    if (!alternatives) return { clauses: [], source: 'unsafe-alternation' };
    const union = [];
    let source = 'native';
    for (const alt of alternatives) {
      const got = extractClausesDirect(alt, options);
      if (got.clauses.length === 0) return { clauses: [], source: 'unsafe-alternation' };
      if (got.source === 'heuristic') source = 'heuristic';
      union.push(...got.clauses);
    }
    const clauses = normalizeLiteralClauses(union);
    return clauses.length > 0 ? { clauses, source } : { clauses: [], source: 'unsafe-alternation' };
  }

  return extractClausesDirect(regex, options);
}

// =============================================================================
// Literal prefiltering via ripgrep fixed-string mode
// =============================================================================

/**
 * Run literal prefilter for a single AND-clause of literals.
 *
 * Accepts `rgFunctions` to avoid a circular import with search-pattern.js.
 * The caller (generateRegexMatches) passes { getRgCapabilities, runRipgrepFilesWithMatches }.
 */
async function runLiteralPrefilter(literals, searchDir, files, opts, rgFunctions) {
  if (!Array.isArray(literals) || literals.length === 0) {
    return Array.isArray(files) ? [...files] : null;
  }

  const caseInsensitive = opts.caseInsensitive ?? false;
  const timeout = opts.timeout ?? 10000;
  const globs = opts.globs ?? [];
  const { supportsAnd } = rgFunctions.getRgCapabilities();

  if (supportsAnd && literals.length > 1) {
    return rgFunctions.runRipgrepFilesWithMatches(literals, searchDir, {
      files,
      fixedString: true,
      caseInsensitive,
      globs,
      timeout,
      useAnd: true,
    });
  }

  let currentFiles = files;
  for (const literal of literals) {
    currentFiles = await rgFunctions.runRipgrepFilesWithMatches(literal, searchDir, {
      files: currentFiles,
      fixedString: true,
      caseInsensitive,
      globs,
      timeout,
    });
    if (Array.isArray(currentFiles) && currentFiles.length === 0) {
      break;
    }
  }

  return currentFiles;
}

/**
 * Run literal prefilter across OR-clauses (each clause is an AND-set of literals).
 *
 * Accepts `rgFunctions` to avoid a circular import with search-pattern.js.
 */
export async function runLiteralPrefilterClauses(clauses, searchDir, files = null, opts = {}, rgFunctions = {}) {
  if (!Array.isArray(clauses) || clauses.length === 0) {
    return Array.isArray(files) ? [...files] : null;
  }

  const combined = new Set();
  for (const clause of clauses) {
    if (!Array.isArray(clause) || clause.length === 0) {
      return Array.isArray(files) ? [...files] : null;
    }
    const clauseMatches = await runLiteralPrefilter(clause, searchDir, files, opts, rgFunctions);
    if (!Array.isArray(clauseMatches)) {
      return null;
    }
    for (const file of clauseMatches) combined.add(file);
  }

  return [...combined];
}

// =============================================================================
// Sparse gram index candidate lookup
// =============================================================================

export function ensureSparseGramIndex(searcher, options = {}) {
  if (!searcher) return null;
  const useGramIndex = options.useGramIndex ?? options.gramIndex ?? true;
  if (!useGramIndex) return null;
  const indexPath = options.sparseGramIndexPath || searcher.sparseGramIndexPath || DB_PATHS.sparseGramIndex;
  if (searcher.sparseGramIndex) {
    if (!searcher._sparseGramLoadedPath || searcher._sparseGramLoadedPath === indexPath) {
      return searcher.sparseGramIndex;
    }
    searcher.sparseGramIndex = null;
    searcher._sparseGramLoadedPath = null;
  }
  const loaded = loadSparseGramIndex(indexPath);
  if (loaded) {
    searcher.sparseGramIndex = loaded;
    searcher._sparseGramLoadedPath = indexPath;
  }
  return loaded;
}

export function querySparseGramCandidates(searcher, literalClauses, options = {}) {
  const useGramIndex = options.useGramIndex ?? options.gramIndex ?? true;
  if (!useGramIndex) {
    return {
      eligible: false,
      reason: 'disabled',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    };
  }
  if (!Array.isArray(literalClauses) || literalClauses.length === 0) {
    return {
      eligible: false,
      reason: 'not_eligible',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    };
  }

  try {
    const symbolMask = _resolveSparseSymbolMask(resolveSearchSymbolFilter(options));
    const overlay = loadSparseDeltaOverlay(searcher, options);
    const sparseGramIndex = ensureSparseGramIndex(searcher, options);
    if (!sparseGramIndex) {
      return {
        eligible: false,
        reason: 'not_loaded',
        totalFiles: 0,
        gramsUsed: 0,
        denseGramsTouched: 0,
        sparseGramsTouched: 0,
        candidateFiles: 0,
        files: null,
      };
    }

    const maxCandidateFiles = options.maxGramCandidateFiles ?? 100000;
    const maxCandidateRatio = options.maxGramCandidateRatio ?? 1.0;
    const combined = new Set();
    let totalFiles = 0;
    let gramsUsed = 0;
    let denseGramsTouched = 0;
    let sparseGramsTouched = 0;

    for (const clause of literalClauses) {
      if (!Array.isArray(clause) || clause.length === 0) {
        return {
          eligible: false,
          reason: 'not_eligible',
          totalFiles,
          gramsUsed,
          denseGramsTouched,
          sparseGramsTouched,
          candidateFiles: 0,
          files: null,
        };
      }
      const result = sparseGramIndex.queryLiterals(
        clause,
        options.maxGramCandidates ?? 0,
        symbolMask || 0
      );
      if (!result?.eligible) {
        return {
          eligible: false,
          reason: 'not_eligible',
          totalFiles: Math.max(totalFiles, result?.totalFiles || 0),
          gramsUsed: gramsUsed + (result?.gramsUsed || 0),
          denseGramsTouched: denseGramsTouched + (result?.denseGramsTouched || 0),
          sparseGramsTouched: sparseGramsTouched + (result?.sparseGramsTouched || 0),
          candidateFiles: Array.isArray(result?.files) ? result.files.length : 0,
          files: null,
        };
      }
      totalFiles = Math.max(totalFiles, result.totalFiles || 0);
      gramsUsed += result.gramsUsed || 0;
      denseGramsTouched += result.denseGramsTouched || 0;
      sparseGramsTouched += result.sparseGramsTouched || 0;
      const baseClauseFiles = Array.isArray(result.files) ? result.files : [];
      const clauseFiles = applySparseDeltaOverlay(
        baseClauseFiles,
        overlay,
        symbolMask || 0,
        searcher?.projectRoot || options.projectRoot,
        clause,
        sparseGramIndex,
      );
      const clauseTotalFiles = (result.totalFiles || 0) + liveOverlayFiles(overlay, symbolMask || 0).length;
      totalFiles = Math.max(totalFiles, clauseTotalFiles);
      if (
        clauseFiles.length > maxCandidateFiles ||
        (clauseTotalFiles > 0 && (clauseFiles.length / clauseTotalFiles) > maxCandidateRatio)
      ) {
        return {
          eligible: false,
          reason: 'too_broad',
          totalFiles,
          gramsUsed,
          denseGramsTouched,
          sparseGramsTouched,
          candidateFiles: clauseFiles.length,
          files: null,
        };
      }
      for (const file of clauseFiles) combined.add(file);
    }

    const files = [...combined];
    if (
      files.length > maxCandidateFiles ||
      (totalFiles > 0 && (files.length / totalFiles) > maxCandidateRatio)
    ) {
      return {
        eligible: false,
        reason: 'too_broad',
        totalFiles,
        gramsUsed,
        denseGramsTouched,
        sparseGramsTouched,
        candidateFiles: files.length,
        files: null,
      };
    }

    return {
      eligible: true,
      reason: 'ok',
      totalFiles,
      gramsUsed,
      denseGramsTouched,
      sparseGramsTouched,
      candidateFiles: files.length,
      files,
    };
  } catch {
    return {
      eligible: false,
      reason: 'error',
      totalFiles: 0,
      gramsUsed: 0,
      denseGramsTouched: 0,
      sparseGramsTouched: 0,
      candidateFiles: 0,
      files: null,
    };
  }
}
