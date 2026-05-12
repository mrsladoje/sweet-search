/**
 * Post-generation validator for PHASE6_REDO probe variants.
 *
 * Spec: docs/PHASE6_REDO.md §5.3 (six checks) + §5.5.6 (path-token stopword
 * list). Runs synchronously after every model emit; drives the §5.5.5
 * re-prompt loop (max 2 retries in author-variants.mjs).
 *
 * Usage as a module:
 *   import { validateVariant, PATH_STOPWORDS } from './validator.mjs';
 *   const verdict = validateVariant(parsed, shape, input);
 *   // verdict.ok === true  → write to disk
 *   // verdict.ok === false → re-prompt with verdict.reason
 *
 * Usage as a CLI (handy for spot-checking one variant manually):
 *   node validator.mjs <input.json> <variant.json> <shape>
 *
 * Design notes:
 *   - Path-token-leak check is deliberately less aggressive than the
 *     prior 3-char rule (PHASE6_REDO §5.5.6): requires ≥5-char shared
 *     substring AND prefix/suffix relationship between the path token and
 *     a symbol sub-token. This admits descriptive NL queries on
 *     symbol-rich paths (the rust `detect_package_root` example) while
 *     still catching direct stem leakage (`package` / `packaging`).
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Cell metadata ─────────────────────────────────────────────────────────

/**
 * Length range per shape cell, in whitespace-split tokens (PHASE6_REDO §5.1).
 * Inclusive bounds. `null` means unbounded on that side.
 */
export const LENGTH_RULES = Object.freeze({
  V1: { min: 1, max: 3 },
  V2: { min: 4, max: 8 },
  V3: { min: 9, max: 15 },
  V4: { min: 9, max: 15 },
  V5: { min: 9, max: 15 },
  V6: { min: 16, max: null },
  // V7 is `medium` per PHASE6_REDO.md §5 table — same length tier as
  // V3/V4/V5 (NOT V2). The descriptive-with-symbol cell needs the medium
  // budget to accommodate "<symbol> <type> that <noun-phrase>" forms.
  V7: { min: 9, max: 15 },
});

export const WITH_SYMBOL_CELLS = Object.freeze(new Set(['V1', 'V2', 'V4', 'V7']));
export const WITHOUT_SYMBOL_CELLS = Object.freeze(new Set(['V3', 'V5', 'V6']));

/**
 * Path-token stopword list per PHASE6_REDO §5.5.6. Path tokens shorter than
 * 4 chars OR present in this set are skipped during the leakage check.
 */
export const PATH_STOPWORDS = Object.freeze(new Set([
  // common directory names that are not lexically meaningful
  'src', 'lib', 'test', 'tests', 'spec', 'specs', 'docs', 'doc',
  'crates', 'packages', 'modules', 'pkg', 'pkgs', 'internal',
  'main', 'core', 'common', 'shared', 'utils', 'util', 'helpers',
  'app', 'apps', 'cmd', 'bin', 'examples', 'example',
  // language-specific
  'rs', 'go', 'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'cs', 'cpp',
  'rb', 'php', 'lua', 'ex', 'exs', 'dart', 'zig', 'kt', 'scala', 'c', 'h',
]));

// ─── Helpers ───────────────────────────────────────────────────────────────

export function whitespaceTokenCount(s) {
  if (s == null) return 0;
  const trimmed = String(s).trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).length;
}

/**
 * Tokenise a file path on `/_.-`, lowercase, drop empties.
 * Used for the path-token-leak check (§5.3 check 5).
 */
export function pathTokens(filePath) {
  if (!filePath) return [];
  return String(filePath)
    .toLowerCase()
    .split(/[/_.\-\\]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Tokenise a symbol into lowercase sub-tokens. Splits on:
 *   - underscores (`detect_package_root` → "detect", "package", "root")
 *   - camelCase boundaries (`redisReaderGetReply` → "redis", "reader",
 *     "get", "reply"; `HTTPSConnection` → "https", "connection")
 *
 * Without the camelCase split, languages like C / C# / Java / TypeScript
 * (where most symbols are camelCase, NOT snake_case) collapsed into a
 * single giant pseudo-token, causing the §5.3 check-5b stem rule to fire
 * with misleading sub-tokens like "redisreadergetreply" and confusing the
 * model with prompts that gave a list of "forbidden tokens" containing
 * only entire symbol names. Fix committed 2026-05-13 after the first full
 * 1,212-variant sweep surfaced 17 such leaks.
 */
export function symbolSubTokens(symbol) {
  if (!symbol) return [];
  const out = [];
  for (const piece of String(symbol).split(/[_]+/u).filter(Boolean)) {
    // Two-pass camelCase splitter:
    //   1) Acronym boundary: insert split between an uppercase run and the
    //      next CapitalisedWord (`HTTPS|Connection`).
    //   2) Word boundary: insert split between a lowercase / digit and the
    //      next uppercase (`redis|Reader`).
    const broken = piece
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([a-z\d])([A-Z])/g, '$1 $2');
    for (const tok of broken.split(/\s+/u)) {
      if (tok) out.push(tok.toLowerCase());
    }
  }
  return out;
}

/**
 * Longest common substring length between two lowercase strings.
 * O(n*m) DP; fine for path/symbol tokens that are ≤ ~30 chars each.
 */
export function longestCommonSubstringLen(a, b) {
  if (!a || !b) return 0;
  const n = a.length;
  const m = b.length;
  let best = 0;
  // Row-by-row DP, O(min(n,m)) memory.
  let prev = new Uint16Array(m + 1);
  let curr = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    // Zero out the row about to be re-used.
    curr.fill(0);
  }
  return best;
}

/**
 * Length of the longest common prefix between two lowercase strings.
 */
export function commonPrefixLen(a, b) {
  if (!a || !b) return 0;
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/**
 * Length of the longest common suffix between two lowercase strings.
 */
export function commonSuffixLen(a, b) {
  if (!a || !b) return 0;
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  return i;
}

/**
 * Whether two lowercase tokens share a stem of ≥ STEM_LEN chars (i.e., share
 * a common prefix OR a common suffix that long). The §5.3 check 5 wording
 * uses "prefix OR suffix of that symbol sub-token (or vice versa)", which
 * operationally means a shared anchored stem — see the worked example
 * (`packaging` vs `package`): neither is a whole-string prefix of the other
 * but they share the 6-char leading stem "packag", which the rule
 * deliberately treats as leakage.
 */
const STEM_LEN = 5;

export function sharesStem(a, b) {
  if (!a || !b) return false;
  if (commonPrefixLen(a, b) >= STEM_LEN) return true;
  if (commonSuffixLen(a, b) >= STEM_LEN) return true;
  return false;
}

/**
 * Per-(path-token, symbol-sub-token) leakage condition (§5.3 check 5).
 * Returns the symbol sub-token that triggered the leak (for diagnostics)
 * or null if no leak.
 *
 * Combines clauses (a)-(d) of the spec: path token ≥ 4 chars, not in the
 * §5.5.6 stopword list, shares ≥ 5-char common substring with at least one
 * symbol sub-token, AND that shared substring is anchored at the start or
 * end of both tokens (so they share a stem, not a coincidental fragment).
 */
export function detectPathTokenLeak(pathToken, symSubs) {
  if (!pathToken || pathToken.length < 4) return null;
  if (PATH_STOPWORDS.has(pathToken)) return null;
  for (const sub of symSubs) {
    if (sub.length < 2) continue;
    // Clause (c): ≥ 5-char shared substring anywhere. Cheap necessary condition
    // — if LCS < 5, the stem check can't fire either.
    if (longestCommonSubstringLen(pathToken, sub) < STEM_LEN) continue;
    // Clause (d): the shared substring must be a stem, not a coincidental
    // fragment in the middle. Operationally: ≥ 5-char common prefix OR
    // common suffix.
    if (sharesStem(pathToken, sub)) return sub;
  }
  return null;
}

/**
 * Split a query into lexical tokens on whitespace + common identifier
 * separators (`_`, `-`, `.`, `/`). Used by the §5.3 check-5b query-stem-leak
 * detector: "is_package" in a query becomes ["is", "package"] so a "package"
 * sub-token can be matched even when buried inside a snake_case compound.
 */
export function queryLexicalTokens(query) {
  if (!query) return [];
  return String(query)
    .toLowerCase()
    .split(/[\s_\-./\\]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Per-(query-token, symbol-sub-token) leakage condition (PHASE6_REDO §5.3
 * check 5b — added 2026-05-13 after the RS-008 V3 worked example surfaced
 * that the original check-5 path-token rule did NOT cover query tokens that
 * directly leak symbol sub-tokens). Returns the offending {queryToken,
 * subToken} pair, or null if no leak.
 *
 * Conditions:
 *   (a) query token ≥ 4 chars
 *   (b) symbol sub-token ≥ 4 chars (filters out noise like "to", "or")
 *   (c) shares a ≥ 5-char common prefix OR common suffix (anchored stem,
 *       not coincidental fragment)
 *
 * Note: PATH_STOPWORDS is NOT applied here. It is calibrated for path
 * tokens — common dirnames like "packages" / "modules" / "main" — but in
 * a query those words are load-bearing and DO leak the symbol's stem. The
 * length-≥-4 filter is sufficient noise control for query tokens.
 */
export function detectQueryStemLeak(query, symSubs) {
  if (!query || !symSubs?.length) return null;
  const tokens = queryLexicalTokens(query);
  for (const qt of tokens) {
    if (qt.length < 4) continue;
    for (const sub of symSubs) {
      if (sub.length < 4) continue;
      if (longestCommonSubstringLen(qt, sub) < STEM_LEN) continue;
      if (sharesStem(qt, sub)) return { queryToken: qt, subToken: sub };
    }
  }
  return null;
}

// ─── Validator entry point ─────────────────────────────────────────────────

/**
 * @typedef {Object} ValidatorInput
 * @property {string} goldId
 * @property {string} goldClass     - 'ast-tester' | 'doc-positive'
 * @property {string} expectedFile  - path string from gold
 * @property {string|null} expectedSymbol
 * @property {string[]=} pathTokens - pre-computed path tokens (from preprocess.mjs)
 *
 * @typedef {Object} ParsedVariant
 * @property {string} query
 * @property {string=} rationale
 *
 * @typedef {Object} Verdict
 * @property {boolean} ok
 * @property {string=} reason - human-readable rejection reason
 * @property {string=} check  - which numbered check failed
 */

/**
 * Validate a parsed model emit against the variant schema + cell rules.
 * Returns a Verdict (never throws on legitimate validation failure).
 *
 * @param {unknown} parsed   - the LLM output as already-parsed JSON
 * @param {string}  shape    - cell id, e.g. 'V1' ... 'V7'
 * @param {ValidatorInput} input - the preprocess.mjs input record
 * @returns {Verdict}
 */
export function validateVariant(parsed, shape, input) {
  // §5.3 check 1: JSON-schema conformance.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, check: '1-schema', reason: 'output is not a JSON object' };
  }
  if (typeof parsed.query !== 'string' || parsed.query.length === 0) {
    return { ok: false, check: '1-schema', reason: 'missing or empty `query` string' };
  }
  if (parsed.rationale !== undefined && typeof parsed.rationale !== 'string') {
    return { ok: false, check: '1-schema', reason: '`rationale` must be a string when present' };
  }
  const cell = LENGTH_RULES[shape];
  if (!cell) {
    return { ok: false, check: '1-schema', reason: `unknown shape cell: ${shape}` };
  }

  const query = parsed.query.trim();

  // §5.3 check 6 (run early): empty / boilerplate.
  if (query.length === 0) {
    return { ok: false, check: '6-boilerplate', reason: 'query is whitespace only' };
  }
  if (/^the (function|method|class|struct|trait|enum|interface) that does (.+)$/i.test(query)) {
    return { ok: false, check: '6-boilerplate', reason: 'query is a template-stub phrase' };
  }
  if (/\{symbol\}|\{description\}|\{[a-z_]+\}/i.test(query)) {
    return { ok: false, check: '6-boilerplate', reason: 'query contains an un-substituted template placeholder' };
  }

  // §5.3 check 2: length tier.
  const n = whitespaceTokenCount(query);
  if (cell.min != null && n < cell.min) {
    return {
      ok: false,
      check: '2-length',
      reason: `query has ${n} tokens; cell ${shape} requires ≥ ${cell.min}`,
    };
  }
  if (cell.max != null && n > cell.max) {
    return {
      ok: false,
      check: '2-length',
      reason: `query has ${n} tokens; cell ${shape} requires ≤ ${cell.max}`,
    };
  }

  // §5.3 checks 3 / 4: symbol presence / leak.
  // For doc-positive golds with a null expectedSymbol, both checks are
  // vacuously satisfied (no symbol to require or forbid).
  // For probes with expectedSymbolAnyOf (elixir / lua / zig), check 3
  // requires ANY of the symbols verbatim; check 4 forbids ALL of them
  // (case-insensitive); check 5 unions sub-tokens across all alternatives.
  const sym = input?.expectedSymbol ?? null;
  const symAnyOf = (input?.expectedSymbolAnyOf?.length ? input.expectedSymbolAnyOf : (sym ? [sym] : []));
  const queryLower = query.toLowerCase();
  if (symAnyOf.length > 0 && WITH_SYMBOL_CELLS.has(shape)) {
    // §5.3 check 3: verbatim presence of ANY listed symbol.
    if (!symAnyOf.some((s) => query.includes(s))) {
      return {
        ok: false,
        check: '3-symbol-presence',
        reason: symAnyOf.length === 1
          ? `cell ${shape} requires verbatim symbol "${symAnyOf[0]}" in query`
          : `cell ${shape} requires verbatim any-of [${symAnyOf.join(', ')}] in query`,
      };
    }
  }
  if (symAnyOf.length > 0 && WITHOUT_SYMBOL_CELLS.has(shape)) {
    // §5.3 check 4: NONE of the symbols may appear (case-insensitive substring).
    const leak = symAnyOf.find((s) => queryLower.includes(s.toLowerCase()));
    if (leak) {
      return {
        ok: false,
        check: '4-symbol-leak',
        reason: `cell ${shape} forbids symbol "${leak}" (case-insensitive substring)`,
      };
    }
  }

  // §5.3 check 5: path-token leak (V3 / V5 / V6 only).
  if (symAnyOf.length > 0 && WITHOUT_SYMBOL_CELLS.has(shape)) {
    const tokens = input?.pathTokens?.length
      ? input.pathTokens.map((t) => String(t).toLowerCase())
      : pathTokens(input?.expectedFile);
    // Union sub-tokens across all AnyOf alternatives so any stem leakage
    // is caught regardless of which symbol the retriever would have matched.
    const symSubsSet = new Set();
    for (const s of symAnyOf) for (const sub of symbolSubTokens(s)) symSubsSet.add(sub);
    const symSubs = [...symSubsSet];
    if (symSubs.length > 0) {
      for (const pt of tokens) {
        // Quick guard: only check tokens that appear in the query.
        if (!queryLower.includes(pt)) continue;
        const leakSub = detectPathTokenLeak(pt, symSubs);
        if (leakSub) {
          return {
            ok: false,
            check: '5-path-leak',
            reason:
              `path token "${pt}" leaks symbol stem "${leakSub}" ` +
              `(cell ${shape} forbids — re-phrase without that stem)`,
          };
        }
      }
      // §5.3 check 5b: query-stem leak. Catches the case where a query
      // token (e.g., "package") shares a ≥5-char anchored stem with a
      // symbol sub-token (e.g., "package" from "detect_package_root").
      // Spec extension committed 2026-05-13; was a gap in the original §5.3.
      const queryLeak = detectQueryStemLeak(query, symSubs);
      if (queryLeak) {
        return {
          ok: false,
          check: '5b-query-stem-leak',
          reason:
            `query token "${queryLeak.queryToken}" leaks symbol sub-token ` +
            `"${queryLeak.subToken}" (cell ${shape} forbids — re-phrase without that stem)`,
        };
      }
    }
  }

  return { ok: true };
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function readJsonOrDie(p, label) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    process.stderr.write(`validator: failed to read ${label} at ${p}: ${err.message}\n`);
    process.exit(2);
  }
}

function mainCli() {
  const [inputPath, variantPath, shapeArg] = process.argv.slice(2);
  if (!inputPath || !variantPath) {
    process.stderr.write(
      'Usage: node validator.mjs <input.json> <variant.json> [<shape>]\n' +
        '  input.json   = preprocess.mjs output for the gold\n' +
        '  variant.json = author-variants.mjs output (or any { query, rationale? })\n' +
        '  shape        = V1..V7 (default: variant.shape)\n',
    );
    process.exit(2);
  }
  const input = readJsonOrDie(path.resolve(inputPath), 'input');
  const variant = readJsonOrDie(path.resolve(variantPath), 'variant');
  const shape = shapeArg || variant.shape;
  if (!shape) {
    process.stderr.write('validator: shape not provided and not present in variant\n');
    process.exit(2);
  }
  const verdict = validateVariant(variant, shape, input);
  process.stdout.write(JSON.stringify({ shape, goldId: input.goldId, ...verdict }, null, 2) + '\n');
  process.exit(verdict.ok ? 0 : 1);
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMainModule) {
  mainCli();
}
