/**
 * Agent-facing output fixes for the ss-* wrappers (final-tuning forensic fixes).
 *
 * Bundle A (SS_FIX_A: A1, A2, A7, A5, A4) is DEFAULT ON since 2026-10-01: the ss-* tools that
 * `sweet-search` ships ARE these wrappers (package.json "files"). SWEET_SEARCH_COMPACT_OUTPUT=0
 * restores the previous output byte for byte; an explicit SS_FIX_A=0|1 wins over both (bench).
 * SS_FIX_GREP_ALLOC (ss-grep line allocation), SS_FIX_GREP_FULLLINE and the five 2026-10-03
 * switches (SS_FIX_GREP_LINES, SS_FIX_GREP_ALLOC_RULE, SS_FIX_GREP_WEIGHT, SS_FIX_SEMANTIC_RANGES,
 * SS_FIX_TRACE_MODE_BUDGET) follow the same default. Every other switch here is DEFAULT OFF and
 * is not part of the product. The functions in
 * this file are pure (no I/O, no process state) or take their I/O as an argument
 * (`decideAlreadyShown` gets the socket sender), so they can be unit-tested; the
 * wrapper (eval/agent-read-workflows/bin/_ss-helpers.mjs) wires them to the printers.
 *
 * Switches (read from the environment; on = 1/true/on/yes, off = 0/false/off/no):
 *   SS_FIX_A=1|0               bundle A umbrella (no information loss; default: ON unless
 *                              SWEET_SEARCH_COMPACT_OUTPUT=0):
 *                                A1 no query header (2026-10-04; it was one line), no
 *                                   budget/route header, no score / kind tag / confidence line /
 *                                   trailers, compact `# sufficient=YES` line (only when YES);
 *                                   results grouped by file (renderGroupedBlocks)
 *                                A2 one-line summary rows; dedupe of covered summary entries
 *                                A7 an imports block that the entry's own code already shows is dropped
 *                                A4 and A5 below, unless their own switch says 0
 *   SS_FIX_TRACE_COMPACT=1|0   A4 compact ss-trace + definition resolution (default: SS_FIX_A)
 *   SS_FIX_GREP_RETRY=1|0      A5 ss-grep regex repair + case-insensitive retry (default: SS_FIX_A)
 *   SS_FIX_ALREADY_SHOWN=1     A3 "already shown" omission (NOT part of SS_FIX_A; own A/B; see the
 *                              subagent limitation in FIXES-IMPL.md)
 *   SS_FIX_DROP_SUFFICIENCY=1  drop the compact `# sufficient=YES` line (only with SS_FIX_A)
 *   SS_FIX_SUMMARY_CAP=n       B1 (REJECTED, kept off): at most n summary-only entries; -k caps
 *                              entries. 0 or unset = off.
 *   SS_FIX_ONE_PER_FILE=1      B2 (compress only): one ss-search entry per file
 *   SS_FIX_GREP_ORDER=1        B7: ss-grep source before tests (with a test quota), per-file line
 *                              lists at >= 50 hits, no repeated matched-text column
 *   SS_FIX_GREP_ALLOC=1|0      DEFAULT ON since 2026-10-02 (default: SS_FIX_A, so the product
 *                              opt-out and an SS_FIX_A=0 bench arm keep the previous output too):
 *                              ss-grep keeps the files of
 *                              highest sqrt(hits) x file-type prior (not the first k in path order),
 *                              shares the k lines by Sainte-Laguë and prints files by weight
 *                              (grep-output-shaping.js). 0 restores the previous output byte for
 *                              byte; never pool runs across the two. With B7 on as well, B7's
 *                              source-before-tests body order is not applied (the prior already
 *                              ranks tests below source); B7's line lists and the dropped repeated
 *                              text column stay.
 *   SS_FIX_GREP_FULLLINE=1|0   DEFAULT ON since 2026-10-02 (default: SS_FIX_A, like
 *                              SS_FIX_GREP_ALLOC): each ss-grep hit prints its full source line, as
 *                              `grep -n` does (whitespace collapsed, at most 140 chars; a longer line
 *                              shows a window that contains the match, `…` at a cut side), not only
 *                              the matched substring (grepHitText). 0 restores the matched-substring
 *                              output byte for byte; never pool runs across the two.
 *
 * DEFAULT ON since 2026-10-03 (default: SS_FIX_A, like SS_FIX_GREP_ALLOC, so the product opt-out
 * and an SS_FIX_A=0 bench arm keep the previous output too). Each legacy value below restores
 * the 2026-10-02 output byte for byte; never pool runs across the two:
 *   SS_FIX_GREP_LINES=1|0      ss-grep: a file given fewer lines than it has stored matches shows
 *                              declaration lines first and lines outside every symbol last (code
 *                              graph, freshness-gated, agent format only; grep-line-classes.js).
 *                              Needs SS_FIX_GREP_ALLOC. Legacy: 0.
 *   SS_FIX_GREP_LINE_SPREAD=1|0  ss-grep (DEFAULT ON since 2026-10-04): under SS_FIX_GREP_LINES,
 *                              one line per enclosing symbol before a second line of any symbol.
 *                              Legacy: 0.
 *   SS_FIX_GREP_ALLOC_RULE=guarantee|hh|sl  ss-grep: one line per kept file first, then
 *                              Sainte-Laguë (guarantee, the default) or Huntington–Hill (hh, an
 *                              opt-in control). Needs SS_FIX_GREP_ALLOC. Legacy: sl (or 0).
 *   SS_FIX_GREP_WEIGHT=sat2|sqrt  ss-grep: weight hits / (hits + 2) x prior (sat2, the default)
 *                              instead of sqrt(hits) x prior, in the engine's file selection and
 *                              in the renderer. Needs SS_FIX_GREP_ALLOC. Legacy: sqrt (or 0).
 *   SS_FIX_SEMANTIC_RANGES=1|0 ss-semantic: a span cut by the budget is cut at a line boundary, its
 *                              header names exactly the printed lines, and the omitted lines are
 *                              reported with an ss-read command (semantic-span-budget.js). Legacy: 0.
 *   SS_FIX_TRACE_MODE_BUDGET=1|0  ss-trace: with a mode word (callers / callees / impact), that one
 *                              printed section gets every budget share but the target's. Legacy: 0.
 *
 * DEFAULT OFF (bench only):
 *   SS_FIX_SEMANTIC_PICK=1     ss-semantic: an over-budget span is excerpted around its
 *                              highest-scoring chunk instead of its head. Implies SS_FIX_SEMANTIC_RANGES.
 *   SS_FIX_SEARCH_FIRST_UNIT=calibrated|all  ss-search / ss-find: ranks past 3 get a small
 *                              signature preview instead of a name-only line (calibrated: ranks
 *                              4-5; all: every rank). allocateBudget in context-expander.js.
 *
 * ss-read output is NOT changed by any switch (owner decision 2026-10-01).
 */

import { collectAgentShownSpansIndexed, validAgentSessionId } from './agent-span-ledger.js';
import { isTestLikePath } from '../infrastructure/test-paths.js';
import { kindName, kindNameList } from './kind-words.js';

const TRUE_VALUES = new Set(['1', 'true', 'on', 'yes']);
const FALSE_VALUES = new Set(['0', 'false', 'off', 'no']);

function norm(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isOn(value) {
  return TRUE_VALUES.has(norm(value));
}

/** A sub-switch: an explicit on / off value wins; anything else inherits the umbrella. */
function subSwitch(value, inherited) {
  const v = norm(value);
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return inherited;
}

/**
 * The product switch. Bundle A (A1, A2, A7, A4, A5) is ON by default in the shipped ss-* tools;
 * A1, A2 and A7 also in the daemon's agent text; SWEET_SEARCH_COMPACT_OUTPUT=0 (or false/off/no) restores the
 * previous output byte for byte. Any other value, or no value, keeps the default.
 */
export const COMPACT_OUTPUT_ENV = 'SWEET_SEARCH_COMPACT_OUTPUT';

/** True unless SWEET_SEARCH_COMPACT_OUTPUT is an explicit off value. */
export function compactOutputDefault(env = process.env) {
  return !FALSE_VALUES.has(norm(env?.[COMPACT_OUTPUT_ENV]));
}

/**
 * Parse the switches. `summaryCap` is null (off) or an integer >= 1 (0 means off).
 *
 * Bundle A precedence: an explicit SS_FIX_A on/off value (bench reproducibility) wins; else
 * SWEET_SEARCH_COMPACT_OUTPUT (product opt-out); else ON (A1, A2, A7, A4, A5). A bench arm that must reproduce the
 * pre-Bundle-A output sets SS_FIX_A=0 (an unset SS_FIX_A now means the product default).
 */
export function readFixFlags(env = process.env) {
  const rawCap = String(env?.SS_FIX_SUMMARY_CAP ?? '').trim();
  const capNumber = /^\d+$/.test(rawCap) ? Number.parseInt(rawCap, 10) : 0;
  const compact = subSwitch(env?.SS_FIX_A, compactOutputDefault(env));
  const allocRule = norm(env?.SS_FIX_GREP_ALLOC_RULE);
  const weight = norm(env?.SS_FIX_GREP_WEIGHT);
  const semanticPick = isOn(env?.SS_FIX_SEMANTIC_PICK);
  return {
    compact,
    traceCompact: subSwitch(env?.SS_FIX_TRACE_COMPACT, compact),
    grepRetry: subSwitch(env?.SS_FIX_GREP_RETRY, compact),
    alreadyShown: isOn(env?.SS_FIX_ALREADY_SHOWN),
    dropSufficiency: isOn(env?.SS_FIX_DROP_SUFFICIENCY),
    summaryCap: capNumber > 0 ? capNumber : null,
    onePerFile: isOn(env?.SS_FIX_ONE_PER_FILE),
    grepOrder: isOn(env?.SS_FIX_GREP_ORDER),
    grepAlloc: subSwitch(env?.SS_FIX_GREP_ALLOC, compact),
    grepFullLine: subSwitch(env?.SS_FIX_GREP_FULLLINE, compact),
    grepLines: subSwitch(env?.SS_FIX_GREP_LINES, compact),
    grepLineSpread: subSwitch(env?.SS_FIX_GREP_LINE_SPREAD, compact),
    grepAllocRule: allocRule === 'guarantee' ? 'guarantee'
      : (allocRule === 'hh' || allocRule === 'huntington-hill') ? 'hh'
        : (allocRule === 'sl' || FALSE_VALUES.has(allocRule)) ? null
          : (compact ? 'guarantee' : null),
    grepWeight: weight === 'sat2' ? 'sat2'
      : (weight === 'sqrt' || FALSE_VALUES.has(weight)) ? null
        : (compact ? 'sat2' : null),
    semanticRanges: semanticPick || subSwitch(env?.SS_FIX_SEMANTIC_RANGES, compact),
    semanticPick,
    searchFirstUnit: ['calibrated', 'all'].includes(norm(env?.SS_FIX_SEARCH_FIRST_UNIT)) ? norm(env.SS_FIX_SEARCH_FIRST_UNIT) : null,
    traceModeBudget: subSwitch(env?.SS_FIX_TRACE_MODE_BUDGET, compact),
  };
}

/**
 * True when ss-search / ss-find must use the fixed renderer instead of the original one.
 * `alreadyShownActive` is the EFFECTIVE A3 state (switch on AND a thread key AND the
 * receipt ledger on), computed by the wrapper.
 */
export function resultRenderFixActive(flags, { find = false, alreadyShownActive = false } = {}) {
  return !!(flags.compact || flags.summaryCap != null || (!find && flags.onePerFile) || alreadyShownActive);
}

// --- thread key ----------------------------------------------------------------------

/**
 * A3 keeps its receipts in its OWN ledger namespace, so the original ledger (which drives the
 * Codex ss-read omission text and the query-aware ss-read trailers) sees exactly the same calls
 * with the switch on as with it off.
 */
export const ALREADY_SHOWN_NAMESPACE = 'a3:';

export function alreadyShownSessionId(threadKey) {
  if (!threadKey) return null;
  const id = `${ALREADY_SHOWN_NAMESPACE}${threadKey}`;
  return validAgentSessionId(id) ? id : null;
}

// --- test-file detection: core/infrastructure/test-paths.js (the code graph uses it too) ---

export { isTestLikePath };

// --- ss-search / ss-find entry selection ---------------------------------------------

/** A summary-only entry: no code was packed for it. */
export function isSummaryOnly(r) {
  return !!r && !r.code && (r.presentation === 'summary' || !!r.summary);
}

// `file:line — symbol (kind)`, and the forms without a kind (`file:line — code block`, a chunk
// with no symbol: typedoc printed `src/lib/models/Reflection.ts:356 — code block` under a row).
const RESTATING_SUMMARY_RE = /^\S+:\d+ — (?:.+ \([^)]*\)|code block|[^\s()]+)$/;

/** True when the summary text only restates the entry header (`file:line — symbol (kind)`). */
export function summaryRestatesHeader(summary) {
  return RESTATING_SUMMARY_RE.test(String(summary ?? '').trim());
}

/**
 * The source lines an entry's code block shows in full, as `{start, end}`, or null. The entry's
 * `startLine..endLine` can be wider than what the agent sees: a packed body cut at the token cap
 * (`// ... (N more lines)`), a sandwich (middle elided), a preview (signature + snippet). The
 * packer stamps `shownStartLine` / `shownEndLine` on full, non-sandwich agent bodies; without
 * them, a full body whose line count equals the span counts as shown, and an unexpanded preview
 * shows the lines above its cut marker (all of them when it has none and fits the span).
 */
export function shownCodeSpan(r) {
  if (!r?.code) return null;
  if (r.expansionKind === 'sandwich' || r.sandwich) {
    // A sandwich covers its span only when its stamp says nothing was elided.
    const s = r.sandwich;
    if (!s || s.elidedHead !== 0 || s.elidedTail !== 0 || s.elisionMarkers !== 0) return null;
  }
  if (Number.isInteger(r.shownStartLine) && Number.isInteger(r.shownEndLine)) {
    return r.shownEndLine >= r.shownStartLine ? { start: r.shownStartLine, end: r.shownEndLine } : null;
  }
  if (!Number.isInteger(r.startLine) || !Number.isInteger(r.endLine)) return null;
  const lines = String(r.code).replace(/\r?\n$/, '').split('\n');
  if (r.presentation === 'preview' && !r.expanded) {
    // An unexpanded preview is a prefix of the chunk (compressToPreview): all of it, or its
    // first lines plus the `// ... (N more lines)` cut marker.
    const cut = PREVIEW_CUT_RE.test(lines[lines.length - 1]);
    if (cut) return lines.length >= 2 ? { start: r.startLine, end: r.startLine + lines.length - 2 } : null;
    return lines.length === r.endLine - r.startLine + 1 ? { start: r.startLine, end: r.endLine } : null;
  }
  if (r.presentation !== 'full') return null;
  return lines.length === r.endLine - r.startLine + 1 ? { start: r.startLine, end: r.endLine } : null;
}

const PREVIEW_CUT_RE = /^\s*\/\/ \.\.\. \(\d+ more lines?\)\s*$/;

/**
 * Entry selection for ss-search / ss-find under the fix switches.
 *
 * Order: dedupe, then B2 one-per-file, then the B1 caps. Rank order is kept; ranks are
 * never renumbered.
 *
 * dedupe:
 *   'v3' — the final-tuning SS_VARIANT_SEARCH_DEDUPE rule, unchanged (used only on the
 *          non-compact path so that variant prints what it always printed): a summary entry
 *          inside ANY earlier span, or repeating an earlier file + symbol, is dropped.
 *   'a2' — SS_FIX_A rule: a summary-only entry is dropped only when an earlier entry has the
 *          IDENTICAL span, or printed code SHOWS all of its lines: any entry's code
 *          (shownCodeSpan: a cut, sandwiched or preview body covers only what it prints) or any
 *          entry's continuation code.
 *          No same-symbol rule (overloads, `String()` on two receivers, generic names), and a
 *          large summary span (a class) never swallows its methods.
 *
 * onePerFile (B2, compress only): per file, the entry that has code is kept (the first by
 * rank); if no entry of the file has code, the first entry is kept. The others become
 * `also in this file:` pointers on the kept entry. The freed pack budget is NOT re-spent.
 *
 * @param {Array} results   response.results
 * @param {{dedupe?:false|'v3'|'a2', onePerFile?:boolean, summaryCap?:number|null, k?:number|null}} o
 * @returns {{entries: Array<{r:object, index:number, also:Array}>, hidden:number, hiddenCode:boolean}}
 *   hiddenCode: true when an entry that carries code (or a continuation) is not printed.
 */
export function selectEntries(results, o = {}) {
  const input = (Array.isArray(results) ? results : []).map((r, index) => ({ r, index, also: [] }));
  let list = input;

  if (o.dedupe === 'v3') {
    const seen = [];
    list = list.filter(({ r }) => {
      const covered = seen.some((x) => x.file === r.file
        && ((r.startLine >= x.start && r.endLine <= x.end) || (r.symbol && x.symbol === r.symbol)));
      seen.push({ file: r.file, start: r.startLine, end: r.endLine, symbol: r.symbol || null });
      return !(covered && r.presentation === 'summary');
    });
  } else if (o.dedupe === 'a2') {
    // Lines printed code shows, anywhere in the output: every entry's shown code and every
    // continuation's code (the renderer groups a file's entries together, so code printed by a
    // lower-ranked entry covers a summary row above it as well).
    const printed = printedCodeSpans(list);
    const seen = [];
    list = list.filter(({ r }) => {
      const covered = isSummaryOnly(r) && (
        seen.some((x) => x.file === r.file && x.start === r.startLine && x.end === r.endLine)
        || insideAny(printed.get(r.file), r.startLine, r.endLine));
      if (!covered) seen.push({ file: r.file, start: r.startLine, end: r.endLine });
      return !covered;
    });
  }

  if (o.onePerFile) {
    const byFile = new Map();
    for (const e of list) {
      if (!byFile.has(e.r.file)) byFile.set(e.r.file, []);
      byFile.get(e.r.file).push(e);
    }
    const keepers = new Set();
    for (const group of byFile.values()) {
      const keeper = group.find((e) => !!e.r.code) || group[0];
      keepers.add(keeper);
      for (const e of group) {
        if (e !== keeper) keeper.also.push({ symbol: e.r.symbol || null, startLine: e.r.startLine, endLine: e.r.endLine });
      }
    }
    list = list.filter((e) => keepers.has(e));
  }

  let folded = false;
  if (o.foldDeclarationBlocks) {
    // A code entry that only lists member declarations of a type (declarationBlockOf, set by
    // the agent-format packer) prints as one row when a better-ranked code entry already shows
    // code of the same type: the agent has the type; the row keeps the range and the names.
    const codeSpans = [];
    list = list.map((e) => {
      const { r } = e;
      const block = r?.declarationBlockOf;
      if (r?.code && block && codeSpans.some((c) => c.file === r.file
          && c.start >= block.startLine && c.end <= block.endLine)) {
        folded = true;
        const row = { ...r, presentation: 'summary', code: null, headerContext: null, continuation: null,
          neighbors: null, sameFile: null, siblingLine: null, familyManifest: null, summary: null };
        return { ...e, r: row };
      }
      if (r?.code) codeSpans.push({ file: r.file, start: r.startLine, end: r.endLine });
      return e;
    });
  }

  let hidden = 0;
  if (o.summaryCap != null) {
    const k = Number.isInteger(o.k) && o.k > 0 ? o.k : Infinity;
    const kept = [];
    let summaries = 0;
    for (const e of list) {
      const summary = isSummaryOnly(e.r);
      if (kept.length >= k || (summary && summaries >= o.summaryCap)) { hidden++; continue; }
      if (summary) summaries++;
      kept.push(e);
    }
    list = kept;
  }

  const printed = new Set(list.map((e) => e.index));
  const hiddenCode = folded
    || input.some((e) => !printed.has(e.index) && (!!e.r.code || !!e.r.continuation?.code));
  return { entries: list, hidden, hiddenCode };
}

/** `also in this file: symA (l.120-140), symB (l.300)` (B2). */
export function renderAlsoInFile(also) {
  if (!also || also.length === 0) return '';
  const range = (a) => (a.endLine && a.endLine !== a.startLine ? `${a.startLine}-${a.endLine}` : `${a.startLine}`);
  return `also in this file: ${also.map((a) => `${a.symbol || 'code'} (l.${range(a)})`).join(', ')}`;
}

/** A3 omission line. It says how to see the lines again. */
export function renderAlreadyShownLine(file, startLine, endLine) {
  const f = /\s/.test(String(file)) ? `"${file}"` : file;
  return `(lines ${startLine}-${endLine} already shown above — re-read: ss-read ${f} ${startLine} ${endLine})`;
}

/**
 * The original ` sufficient=<verdict>[ (<reason>)]` fragment of the confidence line (the ss-*
 * wrappers' renderSufficiency; _ss-argparse.mjs re-exports this one).
 */
export function renderSufficiencyFragment(response) {
  const verdict = response.sufficiencyVerdict
    ? (response.sufficiencyVerdict === 'yes' ? 'YES' : response.sufficiencyVerdict)
    : (response.sufficient ? 'YES' : 'no');
  const why = response.sufficiencyReason ? ` (${response.sufficiencyReason})` : '';
  return ` sufficient=${verdict}${why}`;
}

/**
 * A1 keeps a compact sufficiency token: `# sufficient=YES` only when the verdict is YES, and
 * (like the original line) only together with a confidence verdict. `sufficiencyText` is the
 * original ` sufficient=...` fragment. `drop` = SS_FIX_DROP_SUFFICIENCY.
 */
export function renderCompactSufficiency(response, sufficiencyText, { drop = false } = {}) {
  // Zero results print exactly `(no results)`.
  if (drop || !response?.confidence || (Array.isArray(response.results) && response.results.length === 0)) return '';
  return /^ sufficient=YES\b/.test(String(sufficiencyText ?? '')) ? '# sufficient=YES\n' : '';
}

// --- A7: imports block that the entry's code already shows -----------------------------

function contentLines(text) {
  return String(text).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
}

/**
 * A7. The `### imports` block repeats the top of the file. When the entry's own code block
 * already shows those lines, they are dropped:
 *   - every import line is inside the code (as one contiguous run) → '' (no block);
 *   - the last import lines are the first lines of the code → those lines are cut.
 * Otherwise the block is returned unchanged (no partial edits in the middle of a block).
 */
export function dedupeImports(headerContext, code) {
  if (typeof headerContext !== 'string' || !headerContext) return headerContext;
  if (typeof code !== 'string' || !code) return headerContext;
  const head = contentLines(headerContext);
  const body = contentLines(code);
  if (head.length === 0 || body.length === 0) return headerContext;

  // Whole block inside the code, as one contiguous run.
  for (let i = 0; i + head.length <= body.length; i++) {
    let all = true;
    for (let j = 0; j < head.length; j++) if (body[i + j] !== head[j]) { all = false; break; }
    if (all) return '';
  }

  // The tail of the imports is the head of the code: cut that tail.
  let overlap = 0;
  for (let m = Math.min(head.length - 1, body.length); m >= 1; m--) {
    let same = true;
    for (let j = 0; j < m; j++) if (head[head.length - m + j] !== body[j]) { same = false; break; }
    if (same) { overlap = m; break; }
  }
  if (overlap === 0 || !head.slice(head.length - overlap).some((l) => /[A-Za-z]/.test(l))) return headerContext;
  const raw = headerContext.split('\n');
  let toCut = overlap;
  let end = raw.length;
  while (end > 0 && toCut > 0) {
    end--;
    if (raw[end].trim().length > 0) toCut--;
  }
  const kept = raw.slice(0, end);
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.join('\n');
}

// --- imports the entry's code uses ---------------------------------------------------

/**
 * The names an import statement binds in the file, or null when they cannot be told (a
 * wildcard, a C# namespace `using`, `#include`, `require 'x'`): such a line is kept.
 *   Kotlin/Java/Scala/PHP/Rust path   `import a.b.C` · `use A\B\C;` · `use a::b::c;` → C / c
 *   alias                             `import a.B as C` · `use a::b as c;` · `import x as y` → C / c / y
 *   braces (JS/TS, Rust, destructure) `import D, { a, b as c } from 'm'` · `use a::{B, C as D};` → D, a, c
 *   Python from-import                `from m import a, b as c` → a, c
 *   JS default / namespace / require  `import X from 'm'` · `import * as ns from 'm'` · `const x = require('m')`
 *   Go                                `"github.com/x/dgraph/v25/posting"` → posting · `pb "x/protos"` → pb
 */
export function importBoundNames(stmt) {
  const line = String(stmt || '').trim().replace(/;\s*$/, '').replace(/\s*\/\/.*$/, '');
  // JS/TS: `import * as ns from 'm'`, `import X from 'm'`, `const x = require('m')`.
  const ns = /^import\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\b/.exec(line)
    || /^import\s+(?:type\s+)?([\w$]+)\s+from\b/.exec(line)
    || /^(?:const|let|var)\s+([\w$]+)\s*=\s*require\s*\(/.exec(line);
  if (ns) return [ns[1]];
  // Rust `use x::Trait as _;` brings methods into scope under no name: cannot be told.
  if (/\bas\s+_$/.test(line)) return null;
  if (!line || /\*/.test(line) || /^#\s*include\b/.test(line) || /^using\b/.test(line) || /^require\b/.test(line)) return null;
  const ID = /^[A-Za-z_$][\w$]*$/;
  const aliasOf = (part) => {
    const m = /^(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+)|\s*:\s*([\w$]+))?$/.exec(part.trim());
    if (!m) return null;
    return m[2] || m[3] || m[1];
  };
  const names = [];
  const braces = /\{([^}]*)\}/.exec(line);
  if (braces) {
    for (const part of braces[1].split(',')) {
      const n = part.trim() === 'self' ? null : aliasOf(part);
      if (n) names.push(n);
    }
    // `import Default, { … } from 'm'`
    const def = /^import\s+(?:type\s+)?([\w$]+)\s*,/.exec(line);
    if (def) names.push(def[1]);
    // Rust `use a::b::{self, …}` binds b.
    if (/\bself\b/.test(braces[1])) {
      const seg = /([\w$]+)\s*::\s*\{/.exec(line);
      if (seg) names.push(seg[1]);
    }
    return names.length ? names : null;
  }
  const py = /^from\s+\S+\s+import\s+\(?([^)]*)\)?$/.exec(line);
  if (py) {
    for (const part of py[1].split(',')) { const n = aliasOf(part); if (n) names.push(n); }
    return names.length ? names : null;
  }
  const go = /^(?:import\s+)?(?:([\w.]+)\s+)?"([^"]+)"$/.exec(line);
  if (go) {
    if (go[1] === '_' || go[1] === '.') return null;
    if (go[1]) return [go[1]];
    const segs = go[2].split('/').filter(Boolean);
    let last = segs.pop() || '';
    if (/^v\d+$/.test(last) && segs.length) last = segs.pop();
    return ID.test(last.replace(/-/g, '_')) ? [last.replace(/-/g, '_')] : null;
  }
  const alias = /\sas\s+([\w$]+)$/.exec(line);
  if (alias) return [alias[1]];
  const path = /^(?:pub\s+)?(?:import|use)\s+(?:static\s+)?(?:function\s+|const\s+)?([\w$.\\:]+)$/.exec(line);
  if (path) {
    const last = path[1].split(/\.|\\|::/).filter(Boolean).pop();
    return last && ID.test(last) ? [last] : null;
  }
  return null;
}

/**
 * The import lines whose bound names the code uses (whole word). A line whose names cannot be
 * told stays. The packer's own filter matches any code identifier as a SUBSTRING of the line
 * (`Cache` keeps `import okhttp3.internal.cache.DiskLruCache`; Kotlin's `internal` keeps every
 * `okhttp3.internal.*` import), which kept imports the shown code never touches.
 */
export function usedImports(headerContext, code) {
  if (typeof headerContext !== 'string' || !headerContext || typeof code !== 'string' || !code) return headerContext;
  const words = new Set(code.match(/[A-Za-z_$][\w$]*/g) || []);
  return headerContext.split('\n').filter((line) => {
    if (!line.trim()) return false;
    const names = importBoundNames(line);
    return !names || names.some((n) => words.has(n));
  }).join('\n');
}

// --- compact renderer (ss-search / ss-find agent output) -----------------------------

/** `start-end`, or `start` for one line. */
function lineRange(start, end) {
  return Number.isInteger(end) && end !== start ? `${start}-${end}` : `${start}`;
}

/** The source lines a continuation's code shows, or null (a trailer shows none). */
function continuationSpan(r) {
  const c = r?.continuation;
  if (!c || c.kind !== 'symbol' || !c.code || !Number.isInteger(c.startLine) || !Number.isInteger(c.endLine)) return null;
  return { file: c.file || r.file, start: c.startLine, end: c.endLine };
}

/**
 * Every source span the printed code of `entries` shows, per file: the entry's own shown code
 * (shownCodeSpan) and its continuation code. `omitted` keys (A3) count too: the thread saw them.
 * @returns {Map<string, Array<{start:number,end:number}>>}
 */
export function printedCodeSpans(entries) {
  const byFile = new Map();
  const add = (file, span) => {
    if (!file || !span) return;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ start: span.start, end: span.end });
  };
  for (const e of entries || []) {
    const r = e?.r ?? e;
    add(r?.file, shownCodeSpan(r));
    const c = continuationSpan(r);
    if (c) add(c.file, c);
  }
  return byFile;
}

function insideAny(spans, start, end) {
  return Array.isArray(spans) && spans.some((s) => start >= s.start && end <= s.end);
}

function overlapsAny(spans, start, end) {
  return Array.isArray(spans) && spans.some((s) => start <= s.end && end >= s.start);
}

// Kind words in front of names (shared with ss-read): kind-words.js.
export { kindWord, kindName, kindNameList } from './kind-words.js';

/** The entry's symbols as `{name, type, startLine, endLine}` (symbolInfo, else symbols / symbol). */
function entrySymbols(r) {
  if (Array.isArray(r?.symbolInfo) && r.symbolInfo.length) return r.symbolInfo;
  const names = Array.isArray(r?.symbols) && r.symbols.length ? r.symbols : (r?.symbol ? [r.symbol] : []);
  return names.map((name) => ({ name, type: name === r.symbol ? r.symbolType : null, startLine: null, endLine: null }));
}

// Kinds that name a type (a summary row of a type covers its members' lines on purpose).
const TYPE_KIND_TAGS = new Set(['class', 'struct', 'interface', 'trait', 'impl', 'enum', 'protocol', 'record', 'object', 'extension', 'actor']);
const SUMMARY_NAME_CAP = 3;

/** One summary row: `start-end kind name, ...` (+ ` STALE`). `hideSpans`: printed code of the file. */
export function renderSummaryRow(r, hideSpans = []) {
  const symbols = entrySymbols(r).filter((s) => !(Number.isInteger(s.startLine) && Number.isInteger(s.endLine)
    && insideAny(hideSpans, s.startLine, s.endLine)));
  const names = kindNameList(symbols, SUMMARY_NAME_CAP);
  // A row that holds part of a definition says so: reading its lines alone gives part of it.
  // A large type's row names the members the query names (context-expander containerRowMembers).
  const members = Array.isArray(r.memberHits) && r.memberHits.length
    ? `; query names ${r.memberHits.map(m => `${kindName(m.name, m.type)} (${m.startLine})`).join(' · ')}` : '';
  return `${lineRange(r.startLine, r.endLine)}${names ? ` ${names}` : ''}${partOfNote(r, r.endLine)}${members}${r.stale ? ' STALE' : ''}`;
}

/**
 * PATH RULE, typed files: a path the agent typed in the command is known to it, so a mention
 * of that file prints its shortest suffix that no other path of the same output (`others`)
 * ends with, which is its file name as a rule. Files the agent has not seen print in full.
 */
export function typedPathLabel(file, others = []) {
  const parts = String(file || '').split('/');
  for (let n = 1; n < parts.length; n++) {
    const suffix = parts.slice(-n).join('/');
    if (others.every((o) => o === file || !(o === suffix || String(o).endsWith(`/${suffix}`)))) return suffix;
  }
  return file;
}

// How a related row reads, given the subject S (`class TimedQueueConnectionPool`): the lead of
// its line. Outgoing edges start with S; incoming edges say S is their object.
const RELATED_LEADS = {
  caller: (S) => `callers of ${S}`, user: (S) => `users of ${S}`,
  calls: (S) => `${S} calls`, uses: (S) => `${S} uses`, imports: (S) => `${S} imports`,
  extends: (S) => `${S} extends`, implements: (S) => `${S} implements`, overrides: (S) => `${S} overrides`,
  throws: (S) => `${S} throws`, type: (S) => `types in ${S}`,
  extendedBy: (S) => `${S} is extended by`, implementedBy: (S) => `${S} is implemented by`,
};

const VERB_LEADS = new Set(['extends', 'implements', 'overrides', 'extendedBy', 'implementedBy']);

/**
 * Related rows (context-expander.js renderGraphNeighbors `rows`), one line per kind, each naming
 * the subject: `class TimedQueueConnectionPool extends class ConnectionPool (lib/sequel/connection_pool.rb 27-175)`.
 * A row's path prints once per run of rows in the same file. PATH RULE (one tool output): a
 * file's path prints in full the first time the output names it; a later mention may use the
 * shortest unique suffix (`shortPath`). `printed`: full paths this output already printed; updated.
 * @param {{name?:string,type?:string}|null} subject the entity the rows hang off
 */
/**
 * C#, Kotlin and Swift write a base class and the interfaces a type implements in one list
 * (`class A : Base, IFoo`), and the graph stores each as `extends`. A class or struct that
 * `extends` an interface implements it; an interface `extendedBy` a class is implemented by it.
 */
function baseListKind(kind, subjectType, otherType) {
  const isInterface = (t) => t === 'interface' || t === 'protocol';
  if (kind === 'extends' && isInterface(otherType) && subjectType && !isInterface(subjectType)) return 'implements';
  if (kind === 'extendedBy' && isInterface(subjectType) && otherType && !isInterface(otherType)) return 'implementedBy';
  return kind;
}

export function renderRelatedRows(rows, printed = new Set(), subject = null) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const S = subject?.name ? kindName(subject.name, subject.type) : 'this';
  const byKind = new Map();
  for (const row of rows) {
    if (!row?.name) continue;
    const kind = baseListKind(row.kind, subject?.type, row.entityType);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(row);
  }
  const pathFor = (row) => {
    if (printed.has(row.file)) return row.shortPath || row.file;
    printed.add(row.file);
    return row.file;
  };
  const lines = [];
  for (const [kind, list] of byKind) {
    let prevFile = null;
    const items = list.map((row) => {
      const what = kindName(row.name, row.entityType);
      if (row.file && Number.isInteger(row.startLine)) {
        const where = row.file === prevFile ? '' : `${pathFor(row)} `;
        prevFile = row.file;
        return `${what} (${where}${lineRange(row.startLine, row.endLine)})`;
      }
      prevFile = null;
      if (row.file) return `${what} (${pathFor(row)})`;
      if (row.line) return `${what} (line ${row.line})`;
      return what;
    });
    const lead = RELATED_LEADS[kind] ? RELATED_LEADS[kind](S) : `${kind} of ${S}`;
    // A verb lead reads as a sentence (`class X extends class Y (...)`); a list lead takes a colon.
    lines.push(`${lead}${VERB_LEADS.has(kind) ? ' ' : ': '}${items.join(' · ')}`);
  }
  return lines;
}

/**
 * The same-file neighbours of the entry (context-expander's span map) as sibling sites
 * `{name, kind, line}`, without those whose lines printed code shows. They print in the one
 * `not shown, same file:` line (before: a second `# same file: … — sweep: …` line).
 */
function sameFileMapSites(sameFile, spans) {
  if (!Array.isArray(sameFile?.neighbors)) return [];
  return sameFile.neighbors.filter((n) => n?.name && !overlapsAny(spans, n.startLine, n.endLine))
    .map((n) => ({ name: n.name, kind: n.type || null, line: n.startLine }));
}

/**
 * `not shown, same file: method preallocated_make_new (135) · 210: @size = [0]` — the same-file
 * family of the entry above, without the sites inside printed code or inside another entry of
 * this file (code or row): those already print. A declaration site prints its kind and name;
 * an assignment site prints its source line.
 */
function renderSiblingLine(siblingLine, spans, rowSpans = [], extra = []) {
  if (siblingLine?.rendered && !Array.isArray(siblingLine.sites)) return siblingLine.rendered;
  const sites = [...(siblingLine?.rendered ? siblingLine.sites : []), ...extra];
  const lines = new Set();
  const kept = sites.filter((s) => !insideAny(spans, s.line, s.line) && !insideAny(rowSpans, s.line, s.line))
    .filter((s) => (lines.has(s.line) ? false : (lines.add(s.line), true)))
    .sort((a, b) => a.line - b.line);
  if (kept.length === 0) return null;
  const site = (s) => (s.name ? `${kindName(s.name, s.kind)} (${s.line})` : `${s.line}: ${s.text}`);
  return `not shown, same file: ${kept.map(site).join(' · ')}`;
}

/** `interface Chain (part, whole 84-297)` when the entry shows only part of its primary symbol. */
function partOfNote(r, shownEnd) {
  const symbols = entrySymbols(r);
  const primary = symbols.find((s) => s.name === r.symbol) || (symbols.length === 1 ? symbols[0] : null);
  if (!primary || !Number.isInteger(primary.startLine) || !Number.isInteger(primary.endLine)) return '';
  if (primary.startLine >= r.startLine && primary.endLine <= shownEnd) return '';
  return ` (part; whole ${lineRange(primary.startLine, primary.endLine)})`;
}

/**
 * Compact ss-search / ss-find output: numbered entries in rank order.
 *
 *   1. okhttp/src/.../Interceptor.kt 84-104 interface Chain (part; whole 84-297)
 *   ```(code)```
 *   continues: 245-247 method wait_until_available   code right after a cut, not a hit
 *   imports of Interceptor.kt: import java.io.IOException   (entry 1 only)
 *   class X extends class Y (path 27-175)              related rows, one line per kind
 *   not shown, same file: method preallocated_make_new (135)
 *   2. also Interceptor.kt 109-112 function withConnectTimeout
 *   3. samples/.../LoggingInterceptors.java 25-58 class LoggingInterceptors
 *
 * PATH RULE: a file's path prints in full the first time the output names it; a later entry of
 * the same file says `also <short name>`. A file the agent typed (--in) prints its short name,
 * and nothing when it is the only file. Every name carries its kind word.
 */
function renderGroupedBlocks(results, plan, { omitted = new Set(), gutter = (code) => code, typed = [] } = {}) {
  const spansByFile = printedCodeSpans(plan.entries);
  const lines = [];
  const printed = new Set(typed);
  const outputFiles = [...new Set(plan.entries.map((e) => e.r.file))];
  // The path lead of an entry line. First mention: the full path (a typed file: its short name,
  // nothing when it is the only file). Later mentions: `also <short name>`.
  const named = new Set();
  const label = (file) => {
    const short = typedPathLabel(file, outputFiles);
    if (named.has(file)) return `also ${short} `;
    named.add(file);
    if (printed.has(file)) return outputFiles.length > 1 ? `${short} ` : '';
    printed.add(file);
    return `${file} `;
  };
  // Rows of a file: the members a row of this file names (a type's row covers its members on purpose).
  const rowSpansByFile = new Map();
  for (const { r } of plan.entries) {
    if (!isSummaryOnly(r) || TYPE_KIND_TAGS.has(String(r.symbolType || '').toLowerCase())) continue;
    if (!rowSpansByFile.has(r.file)) rowSpansByFile.set(r.file, []);
    rowSpansByFile.get(r.file).push({ start: r.startLine, end: r.endLine });
  }
  let n = 0;
  // Spans of entries printed with code so far: a later entry inside one is no new place.
  const codeEntrySpans = [];
  for (const { r, index, also } of plan.entries) {
    const file = r.file;
    const spans = spansByFile.get(file) || [];
    // An entry that lies inside an earlier entry with code (jj: `fn resolve` 3246-3406 inside
    // `impl VisibilityResolutionContext` 3244-3511) prints as a row: its own code was a
    // slice of the same region (one line, then `... (118 more lines)`).
    if (!isSummaryOnly(r) && r.code && codeEntrySpans.some((o) => o.file === file && o.start <= r.startLine && o.end >= r.endLine)) {
      n++;
      lines.push(`${n}. ${label(file)}${renderSummaryRow(r)}`);
      continue;
    }
    if (!isSummaryOnly(r) && r.code) codeEntrySpans.push({ file, start: r.startLine, end: r.endLine });
    if (isSummaryOnly(r)) {
      // Every name of the row is in printed code above or below: nothing new to point at.
      const syms = entrySymbols(r);
      if (syms.length > 0 && syms.every((x) => Number.isInteger(x.startLine) && Number.isInteger(x.endLine)
        && insideAny(spans, x.startLine, x.endLine))) continue;
      const row = renderSummaryRow(r, spans);
      n++;
      lines.push(`${n}. ${label(file)}${row}`);
      if (r.summary && !summaryRestatesHeader(r.summary)) lines.push(r.summary);
      const alsoLine = renderAlsoInFile(also);
      if (alsoLine) lines.push(alsoLine);
      continue;
    }
    n++;
    const stale = r.stale ? ' STALE' : '';
    const codeOmitted = omitted.has(`${index}:result`);
    const cont = r.continuation || null;
    const contSpan = continuationSpan(r);
    const contOmitted = omitted.has(`${index}:continuation`);
    const shown = shownCodeSpan(r);
    // One block when the continuation's code starts on the line after the entry's last line.
    const merge = !!(r.code && !codeOmitted && contSpan && !contOmitted && contSpan.file === file
      && shown && shown.end === r.endLine && contSpan.start === r.endLine + 1);
    const symbols = [...entrySymbols(r)];
    if (merge && cont.symbol && !symbols.some((s) => s.name === cont.symbol)) {
      symbols.push({ name: cont.symbol, type: cont.symbolType || null });
    }
    const end = merge ? contSpan.end : r.endLine;
    const names = kindNameList(symbols);
    lines.push(`${n}. ${label(file)}${lineRange(r.startLine, end)}${names ? ` ${names}` : ''}${partOfNote(r, end)}${stale}`);
    if (r.code) {
      if (codeOmitted) lines.push(renderAlreadyShownLine(r.file, r.startLine, r.endLine));
      else lines.push('```', gutter(merge ? `${r.code}\n${cont.code}` : r.code, r.startLine), '```');
    } else if (r.summary && !summaryRestatesHeader(r.summary)) {
      lines.push(r.summary);
    }
    if (cont && !merge) {
      // The code right after the entry's cut: part of this entry, not a ranked hit.
      const contFile = cont.file || file;
      const where = contFile === file ? '' : `${label(contFile)}`;
      const what = cont.symbol ? ` ${kindName(cont.symbol, cont.symbolType)}` : '';
      if (contSpan) {
        lines.push(`continues: ${where}${lineRange(contSpan.start, contSpan.end)}${what}`);
        if (contOmitted) lines.push(renderAlreadyShownLine(contSpan.file, contSpan.start, contSpan.end));
        else lines.push('```', cont.code, '```');
      } else if (cont.rendered && Number.isInteger(cont.startLine)
          && !(contFile === file && plan.entries.some(({ r: o }) => isSummaryOnly(o) && o.file === file && o.startLine === cont.startLine))) {
        lines.push(`continues (not shown): ${where}${cont.startLine}${what}`);
      } else if (cont.rendered && !Number.isInteger(cont.startLine)) {
        // No coordinates to merge or regroup by: the continuation's own text.
        lines.push(cont.rendered);
        if (cont.kind === 'symbol' && cont.code) lines.push('```', cont.code, '```');
      }
    }
    // Imports: the winner's only (entry 1), the lines its code uses.
    if (n === 1 && r.headerContext) {
      const imports = r.code && !codeOmitted ? usedImports(dedupeImports(r.headerContext, r.code), r.code) : r.headerContext;
      if (imports) {
        const short = typedPathLabel(file, [...outputFiles, file]).split('/').pop();
        const list = imports.split('\n').filter((l) => l.trim());
        if (list.length === 1) lines.push(`imports of ${short}: ${list[0].trim()}`);
        else lines.push(`imports of ${short}:`, ...list);
      }
    }
    if (r.neighbors) {
      if (Array.isArray(r.neighbors.rows)) lines.push(...renderRelatedRows(r.neighbors.rows, printed, r.neighbors.subject));
      else if (r.neighbors.rendered) lines.push(r.neighbors.rendered);
    }
    // A definition a related row above already names (`types in …: type SortStrategy (sort.ts 28)`)
    // is not repeated among the siblings.
    const relatedHere = (Array.isArray(r.neighbors?.rows) ? r.neighbors.rows : [])
      .filter((x) => x.file === file && Number.isInteger(x.startLine)).map((x) => ({ start: x.startLine, end: x.startLine }));
    // A map with no neighbour data (only its text) still prints as it is.
    if (r.sameFile?.rendered && !Array.isArray(r.sameFile.neighbors)) lines.push(r.sameFile.rendered);
    const siblings = renderSiblingLine(r.siblingLine, spans, [...(rowSpansByFile.get(file) || []), ...relatedHere], sameFileMapSites(r.sameFile, spans));
    if (siblings) lines.push(siblings);
    if (r.familyManifest?.rendered) lines.push(r.familyManifest.rendered);
    const alsoLine = renderAlsoInFile(also);
    if (alsoLine) lines.push(alsoLine);
  }
  if (!results || results.length === 0) lines.push('(no results)');
  else if (plan.hidden > 0) lines.push(`(+${plan.hidden} lower-ranked entries not shown)`);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

// --- fixed renderer -----------------------------------------------------------------

/**
 * Renderer for ss-search / ss-find result blocks when a fix switch is on
 * (resultRenderFixActive).
 *   compact (SS_FIX_A, the product): renderGroupedBlocks (grouped by file, no query header,
 *                       no rank numbers, related rows one line per kind, merged continuations).
 *   not compact:        the original block format, byte for byte (only A3 lines and B1/B2
 *                       changes differ).
 *
 * @param {Array} results
 * @param {{entries:Array, hidden:number}} plan  selectEntries() output
 * @param {object} o
 * @param {boolean} [o.compact]
 * @param {Set<string>} [o.omitted]           A3 keys `<resultIndex>:result|continuation`
 * @param {boolean} [o.dropRestatingSummary]  SS_VARIANT_SEARCH_DEDUPE on ss-search (non-compact)
 * @param {(code:string, startLine:number)=>string} [o.gutter]
 * @param {string[]} [o.typed]                files the agent typed in the command (--in)
 * @returns {string}
 */
export function renderFixedBlocks(results, plan, {
  compact = false,
  omitted = new Set(),
  dropRestatingSummary = false,
  gutter = (code) => code,
  typed = [],
} = {}) {
  if (compact) return renderGroupedBlocks(results, plan, { omitted, gutter, typed });
  const parts = [];
  const out = (text) => parts.push(text);
  for (const { r, index, also } of plan.entries) {
    const stale = r.stale ? ' STALE' : '';
    const sym = r.symbol ? ` [${r.symbolType || 'code'}: ${r.symbol}]` : '';
    const kind = r.expansionKind ? ` kind=${r.expansionKind}` : '';
    out(`\n## #${r.rank} ${r.file}:${r.startLine}-${r.endLine}${sym} (${r.presentation}${kind}${stale}) score=${(r.score || 0).toFixed(3)}\n`);
    const codeOmitted = omitted.has(`${index}:result`);
    if (r.headerContext) out(`### imports\n\`\`\`\n${r.headerContext}\n\`\`\`\n`);
    if (r.code) {
      if (codeOmitted) out(`${renderAlreadyShownLine(r.file, r.startLine, r.endLine)}\n`);
      else out(`\`\`\`\n${gutter(r.code, r.startLine)}\n\`\`\`\n`);
    } else if (r.summary && !(dropRestatingSummary && summaryRestatesHeader(r.summary))) {
      out(`${r.summary}\n`);
    }
    if (r.neighbors && r.neighbors.rendered) {
      out(`### related (1-hop graph, ~${r.neighbors.tokens} tok)\n${r.neighbors.rendered}\n`);
    }
    if (r.sameFile && r.sameFile.rendered) out(`${r.sameFile.rendered}\n`);
    if (r.siblingLine?.rendered) out(`${r.siblingLine.rendered}\n`);
    if (r.continuation?.rendered) {
      out(`${r.continuation.rendered}\n`);
      if (r.continuation.kind === 'symbol' && r.continuation.code) {
        if (omitted.has(`${index}:continuation`)) {
          out(`${renderAlreadyShownLine(r.continuation.file || r.file, r.continuation.startLine, r.continuation.endLine)}\n`);
        } else {
          out(`\`\`\`\n${r.continuation.code}\n\`\`\`\n`);
        }
      }
    }
    if (r.familyManifest?.rendered) out(`${r.familyManifest.rendered}\n`);
    const alsoLine = renderAlsoInFile(also);
    if (alsoLine) out(`${alsoLine}\n`);
  }
  if (!results || results.length === 0) {
    out('(no matches)\n');
  } else if (plan.hidden > 0) {
    out(`(+${plan.hidden} lower-ranked entries not shown)\n`);
  }
  return parts.join('');
}

// --- A3: what to record, what to omit -------------------------------------------------

/** A3 omits a block only when the thread saw it within this many A3-ledger calls. */
export const ALREADY_SHOWN_WINDOW_CALLS = 8;
/** ss-read output longer than this may be cut by the harness; A3 does not record it. */
export const ALREADY_SHOWN_MAX_RECORD_CHARS = 10000;

/**
 * The spans of the blocks this call PRINTS (after dedupe / one-per-file / caps). A hidden
 * entry, or a continuation that has no rendered header, is never recorded.
 */
export function printedSpanCandidates(results, plan, { projectRoot } = {}) {
  // The plan's entry, not the raw result: a folded declaration block prints no code.
  const printed = new Map(plan.entries.map((e) => [e.index, e.r]));
  return collectAgentShownSpansIndexed(results, {
    projectRoot,
    include: (resultIndex, part) => {
      if (!printed.has(resultIndex)) return false;
      const r = printed.get(resultIndex);
      if (part === 'result') return !!r?.code;
      return !!(r?.continuation?.rendered && r.continuation.kind === 'symbol' && r.continuation.code);
    },
  });
}

/**
 * The results whose spans go into the ORIGINAL ledger (Codex ss-read omission). Unchanged
 * (the full result list) unless B1/B2 hide an entry that carries code: then only the printed
 * entries, so ss-read never says "already shown" about lines the agent never saw.
 */
export function resultsForOriginalLedger(results, plan) {
  if (!plan?.hiddenCode) return results;
  return plan.entries.map((e) => e.r);
}

/**
 * A3 protocol, on the A3 namespace only:
 *   1. `read` with the printed spans: the ledger decides per span and records the ones it
 *      does not omit (they print in full now).
 *   2. An omit decision older than `window` calls is overruled (the code prints), and those
 *      spans are recorded again with one `observe`.
 * Fail open: no session, no daemon or a bad reply → nothing is omitted.
 *
 * @param {{send:Function, sessionId:string|null, candidates:Array, window?:number}} o
 * @returns {Promise<Set<string>>} keys `<resultIndex>:<part>` to print as one omission line
 */
export async function decideAlreadyShown({ send, sessionId, candidates, window = ALREADY_SHOWN_WINDOW_CALLS }) {
  const omitted = new Set();
  if (!sessionId || typeof send !== 'function') return omitted;
  const resp = await send({ operation: 'read', spans: candidates.map((c) => c.span), sessionId });
  if (!(resp?.ok && Array.isArray(resp.decisions))) return omitted;
  const refresh = [];
  candidates.forEach((c, i) => {
    const d = resp.decisions[i];
    if (!d?.omit) return;
    if (Number.isInteger(d.callsAgo) && d.callsAgo >= 1 && d.callsAgo <= window) omitted.add(`${c.resultIndex}:${c.part}`);
    else refresh.push(c.span);
  });
  if (refresh.length > 0) await send({ operation: 'observe', spans: refresh, sessionId });
  return omitted;
}

/**
 * ss-read → A3 ledger: the spans ss-read actually printed. A span the original ledger omitted
 * (Codex) printed no code; output above the size limit may be cut by the harness.
 */
export function readSpansForAlreadyShown(spans, decisions, printedChars) {
  if (!Array.isArray(spans) || spans.length === 0) return [];
  if (!(Number.isFinite(printedChars) && printedChars <= ALREADY_SHOWN_MAX_RECORD_CHARS)) return [];
  return spans.filter((_, i) => !decisions?.[i]?.omit);
}

// --- ss-trace ---------------------------------------------------------------------------

// Rows of same-name calls the graph did not resolve, at most.
const UNRESOLVED_CALLER_ROWS = 5;

function isExternalItem(item) {
  return item?.type === 'external' || !item?.file;
}

/** `5,6,7`, or the first 16 lines and `…+N` (same cap as the full trace). */
function siteList(lines) {
  const list = (lines || []).filter((n) => Number.isInteger(n));
  return list.length <= 16 ? list.join(',') : `${list.slice(0, 16).join(',')},…+${list.length - 16}`;
}

/**
 * One caller / callee row under its file's path line, the same shape in both sections:
 * kind, name, the definition's lines, then `@` the lines of the call
 * (`function AddMutationWithIndex 590-650 @606`: it calls the target on 606;
 * `method findPosting 2305-2330 @536`: the target calls it on 536). A row that is no call
 * says what it is: `(extends)`, `(instantiates)`, `(typeRef)`, `(overrides)`; a call made
 * through a method the target overrides names it: `via Chain.proceed`; a call of the
 * traced definition to itself says `(recursive)`.
 */
const isCallRel = (rel) => !rel || rel === 'calls' || rel === 'handoff';

function traceRow(item, target = null) {
  // A file's top-level code (`(top-level)`) spans the whole file: no kind, no span.
  const isFile = item.type === 'file';
  // A call from the traced definition to itself.
  const recursive = target && item.file === target.filePath && item.startLine === target.startLine ? ' (recursive)' : '';
  // Non-call relationships of the row (`overrides`, `extends`); a row can also call.
  const rels = (item.rels || (isCallRel(item.relationship) ? [] : [item.relationship]))
    .map((rel) => (target ? baseListKind(rel, item.type, target.type) : rel));
  const isCall = rels.length === 0;
  // A declaration's own line (`overrides` on the definition line) is no site to print. A
  // file's top-level row has no definition line: its span is the site itself.
  const own = (item.contextLines?.length ? item.contextLines : (item.contextLine ? [item.contextLine] : []))
    .filter((n) => isFile || !(item.onlyNonCall && n === item.startLine));
  const lines = siteList(own);
  const span = !isFile && Number.isInteger(item.startLine) ? ` ${lineRange(item.startLine, item.endLine)}` : '';
  return `${isFile ? item.name : kindName(item.name, item.type)}${span}${isCall ? '' : ` (${rels.join(', ')})`}${recursive}${lines ? ` @${lines}` : ''}${item.via ? ` via ${item.via}` : ''}${item.overloads?.length ? ` (or overloads ${item.overloads.join(', ')})` : ''}`;
}

/**
 * Rows grouped by file (path printed once), files in first-row order: calls before rows that
 * only override / extend / reference the target, test files last. (okhttp: the one production
 * caller of `Interceptor.intercept`, RealInterceptorChain.proceed, came after 12 implementations.)
 */
function groupedRows(items, label, target = null) {
  const rank = (i) => (isTestLikePath(i.file) ? 2 : 0) + (isCallRel(i.relationship) ? 0 : 1);
  const ordered = items.map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map((x) => x.item);
  const byFile = new Map();
  for (const item of ordered) {
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file).push(item);
  }
  const out = [];
  for (const [file, rows] of byFile) {
    out.push(label(file));
    for (const row of mergeEntityRows(rows)) out.push(traceRow(row, target));
  }
  return out;
}

/**
 * One row per entity: an entity that overrides the target and also calls it (CookieStickySessions
 * `LeaseAsync`) prints once, `(overrides) @87`, with the call lines only.
 */
function mergeEntityRows(rows) {
  const byEntity = new Map();
  for (const row of rows) {
    const key = `${row.name}\u0000${row.startLine}`;
    const rel = isCallRel(row.relationship) ? null : row.relationship;
    const prev = byEntity.get(key);
    if (!prev) {
      byEntity.set(key, { ...row, rels: rel ? [rel] : [], onlyNonCall: !!rel });
      continue;
    }
    if (rel && !prev.rels.includes(rel)) prev.rels.push(rel);
    if (!rel) {
      prev.contextLines = row.contextLines?.length ? row.contextLines : (row.contextLine ? [row.contextLine] : []);
      prev.via = prev.via || row.via;
      prev.onlyNonCall = false;
    }
  }
  return [...byEntity.values()];
}

/**
 * Impact paths as two trees: `## upstream` (who reaches the target: a caller, then the
 * callers of that caller, indented) and `## downstream` (what it reaches). The target
 * itself, which every path started or ended with, is not repeated. A node prints as
 * `kind name path:line` the first time, and as `name` alone when it already printed above
 * (a caller / callee row, or an earlier tree row).
 */
/** A path's nodes: `nodes` when the trace carries them, else parsed from `a (f:1) -> b (external)`. */
function pathNodes(p) {
  if (Array.isArray(p.nodes)) return p.nodes;
  return String(p.path || '').split(' -> ').map((seg) => {
    const m = /^(.*) \(([^()]*)\)$/.exec(seg);
    if (!m) return { name: seg, file: null, line: null };
    if (m[2] === 'external') return { name: m[1], file: null, line: null };
    const at = m[2].lastIndexOf(':');
    return { name: m[1], file: m[2].slice(0, at), line: Number(m[2].slice(at + 1)) || null };
  });
}

function impactTrees(paths, { listedKeys, skipOneHopListed, label = (file) => file }) {
  const printed = new Set(listedKeys);
  const trees = { upstream: [], downstream: [] };
  for (const dir of ['upstream', 'downstream']) {
    const root = new Map();
    for (const p of paths) {
      const nodes = pathNodes(p);
      if ((p.direction || 'upstream') !== dir || nodes.length < 2) continue;
      // Nodes away from the target, nearest first.
      const chain = dir === 'downstream' ? nodes.slice(1) : nodes.slice(0, -1).reverse();
      if (chain.some((n) => !n.file)) continue;
      if (skipOneHopListed && chain.length === 1 && listedKeys.has(`${chain[0].file}:${chain[0].line}`)) continue;
      let level = root;
      for (const n of chain) {
        const key = `${n.name}\u0000${n.file}:${n.line}`;
        if (!level.has(key)) level.set(key, { node: n, children: new Map() });
        level = level.get(key).children;
      }
    }
    const walk = (level, depth) => {
      for (const { node, children } of level.values()) {
        const key = `${node.file}:${node.line}`;
        const row = printed.has(key) ? node.name : `${kindName(node.name, node.type)} ${label(node.file)}:${node.line ?? '?'}`;
        printed.add(key);
        trees[dir].push(`${'  '.repeat(depth)}${row}`);
        walk(children, depth + 1);
      }
    };
    walk(root, 0);
  }
  return trees;
}

/**
 * Other definitions the symbol names: `Owner.name` (when it has an owner) and where.
 * A definition in the traced file prints its line only.
 */
function alternativesLine(result, label = (file) => file) {
  const t = result.target;
  const alts = (result.disambiguation || []).slice(0, 5);
  if (!alts.length) return null;
  const more = (result.disambiguation || []).length - alts.length;
  const anyOwner = alts.some((a) => a.owner);
  const anyOtherFile = alts.some((a) => a.file !== t.filePath);
  const pick = [anyOtherFile ? '--in <file>' : null, anyOwner ? 'Owner.name' : null].filter(Boolean).join(' or ');
  const list = alts.map((a) => {
    // With owners in the list, an ownerless definition names itself too: serde_json's free
    // `from_str 2709` read as a second line of `Number.from_str 1299, 2709`.
    const name = a.owner ? `${a.owner}.${a.name} ` : (anyOwner && a.file === t.filePath ? `${a.name || t.name} ` : '');
    return a.file === t.filePath ? `${name}${a.startLine}` : `${name}${label(a.file)}:${a.startLine}`;
  }).join(', ');
  return `# other definitions${pick ? ` (pick with ${pick})` : ''}: ${list}${more > 0 ? `, +${more} more` : ''}`;
}

/**
 * Compact ss-trace rendering (A4). One row per caller / callee, grouped by file, no
 * bodies, no answer-cue lines, no budget / latency line, no fan counts (the rows are the
 * count; every row left out is counted). Only the requested section prints when `mode`
 * is set, and then without its heading.
 *
 * Header: `# path:a-b` of the traced definition — which of several definitions was traced,
 * and its span; `# lines a-b` when --in already named that file.
 *
 * @param {object} result  traceSymbol's response
 * @param {object} [opts]
 * @param {string|null} [opts.mode]    callers | callees | impact | null
 * @param {string|null} [opts.inFile]  the --in file of the call
 * @param {string[]} [opts.notes]      lines printed under the header
 */
export function formatTraceCompact(result, { mode = null, inFile = null, notes = [] } = {}) {
  if (!result.target) return `No indexed symbol found for "${result.symbol}".`;
  const t = result.target;
  const show = (section) => mode === null || mode === section;
  const lines = [];
  const provenance = result.sections.callers.provenance || { stored: 0, sameFileFallback: 0 };
  // Only a file typed in full: after a short --in the header must print the full path.
  const sameFile = inFile && inFile === t.filePath;
  // PATH RULE: a file the agent typed (--in) or that this output already printed in full
  // prints as its shortest unique suffix (its file name as a rule) after that.
  const files = [t.filePath, ...result.sections.callers.items, ...result.sections.callees.items].map((x) => x?.file ?? x).filter(Boolean);
  for (const a of result.disambiguation || []) if (a.file) files.push(a.file);
  for (const p of result.sections.impact?.paths || []) for (const n of pathNodes(p)) if (n.file) files.push(n.file);
  const known = new Set([t.filePath, inFile].filter(Boolean));
  const label = (file) => {
    if (known.has(file)) return typedPathLabel(file, files);
    known.add(file);
    return file;
  };
  lines.push(sameFile ? `# lines ${lineRange(t.startLine, t.endLine)}` : `# ${t.filePath}:${lineRange(t.startLine, t.endLine)}`);
  for (const n of notes) lines.push(n);
  const alt = alternativesLine(result, label);
  if (alt) lines.push(alt);
  if (show('callers') && provenance.sameFileFallback > 0 && provenance.stored === 0) {
    lines.push('# no indexed callers; these come from a text scan of this file');
  } else if (t.fanIn === 0 && t.fanOut === 0 && !result.sections.callers.total && !result.sections.callees.total) {
    lines.push('# no call edges stored; map its sites with one ss-grep of the name');
  }

  const listed = new Set(); // `file:line` of every caller / callee definition printed below
  for (const [title, section] of [['callers', result.sections.callers], ['callees', result.sections.callees]]) {
    if (!show(title)) continue;
    const internal = section.items.filter((i) => !isExternalItem(i));
    const external = section.external ?? (section.items.length - internal.length);
    if (!internal.length) {
      lines.push(`(no ${title} in the repository)`);
    } else {
      if (mode === null) lines.push(`## ${title}`);
      // A type's callees are its methods' calls out of it (structural-context.js).
      if (section.viaMembers > 0) lines.push(`# calls out of ${t.name}'s ${section.viaMembers} ${section.viaMembers === 1 ? 'method' : 'methods'}`);
      lines.push(...groupedRows(internal, label, t));
    }
    for (const item of internal) listed.add(`${item.file}:${item.startLine || '?'}`);
    // Every row left out is counted. The section cap is fixed (40 rows), so the way to
    // every call site of a name is ss-grep.
    if (section.hidden > 0) lines.push(`+${section.hidden} more${title === 'callers' ? ' (ss-grep the name for every site)' : ''}`);
    // Calls of the same name the graph bound to no definition: they may call this one.
    const unresolved = title === 'callers' ? (section.unresolvedByName || []).filter((i) => i.file) : [];
    if (unresolved.length) {
      lines.push(`not resolved, same name (may call another ${t.name}):`);
      lines.push(...groupedRows(unresolved.slice(0, UNRESOLVED_CALLER_ROWS), label));
      if (unresolved.length > UNRESOLVED_CALLER_ROWS) lines.push(`+${unresolved.length - UNRESOLVED_CALLER_ROWS} more`);
    }
    if (external > 0) lines.push(`+${external} unresolved ${title === 'callers' ? 'caller' : 'call'}${external === 1 ? '' : 's'}`);
  }

  if (show('impact')) {
    // Without a mode word, a one-hop path to a printed caller / callee row adds nothing.
    const trees = impactTrees(result.sections.impact.paths, { listedKeys: listed, skipOneHopListed: mode !== 'impact', label });
    const hidden = result.sections.impact.hidden || 0;
    for (const dir of ['upstream', 'downstream']) {
      if (!trees[dir].length) continue;
      lines.push(`## ${dir}`);
      lines.push(...trees[dir]);
    }
    if (hidden > 0) lines.push(`+${hidden} more paths`);
    if (mode === 'impact' && !trees.upstream.length && !trees.downstream.length) lines.push('(no impact paths)');
  }
  return lines.join('\n');
}

/**
 * A4: after the trace switched from a test definition to a non-test one, the alternatives
 * list must still name the test definition (the re-run trace has none of its own).
 */
export function alternativesAfterSwitch(original, chosenFile, chosenLine) {
  const t = original?.target;
  const first = t ? [{ name: t.name, type: t.type, file: t.filePath, startLine: t.startLine }] : [];
  const rest = (original?.disambiguation || []).filter((a) => !(a.file === chosenFile && a.startLine === chosenLine));
  return [...first, ...rest];
}

// --- ss-grep: A5 regex repair -----------------------------------------------------------

/** A regex the engine could not parse (ripgrep / Rust regex), as opposed to a real failure. */
export function isRegexParseError(err) {
  const msg = String(err?.message || err || '');
  return /regex parse error|error parsing regex|unclosed group|unclosed character class|unopened group|unrecognized escape|repetition operator missing|invalid regex|look-?around|backreferences? (are )?not supported/i.test(msg);
}

/**
 * Approximate "does the Rust regex engine accept this?" in JavaScript. Used only to choose
 * which alternatives of a pattern the engine ALREADY rejected need escaping; the engine
 * itself decides afterwards. Rust-only syntax is mapped first (inline flags, \A \z, \pL);
 * Rust-unsupported syntax (look-around, back-references) counts as invalid.
 */
export function rustRegexLooksValid(pattern) {
  const p = String(pattern ?? '');
  if (!p) return false;
  if (/\(\?<?[=!]/.test(p)) return false;            // look-around
  if (/(^|[^\\])(\\\\)*\\[1-9]/.test(p)) return false; // back-reference
  let q = p
    .replace(/\(\?[a-zA-Z-]+\)/g, '')                  // (?i) (?s-m)
    .replace(/\(\?[a-zA-Z-]+:/g, '(?:')                // (?i:...)
    .replace(/\(\?P<([A-Za-z_]\w*)>/g, '(?<$1>')       // (?P<name>...)
    .replace(/\\([^A-Za-z0-9\s])/g, (_m, c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .replace(/\\[Az]/g, '')
    .replace(/\\([pP])([A-Za-z])/g, '\\$1{$2}');
  try {
    new RegExp(q, 'u');
    return true;
  } catch {
    return false;
  }
}

/**
 * Split on top-level alternation: an unescaped `|`, or the GNU `\|`, outside any group and
 * any character class. An unclosed `(` keeps the rest in one branch.
 */
export function splitTopLevelAlternation(pattern) {
  const p = String(pattern ?? '');
  const branches = [];
  let cur = '';
  let depth = 0;
  let inClass = false;
  let classStart = -1;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\' && i + 1 < p.length) {
      const next = p[i + 1];
      if (!inClass && depth === 0 && next === '|') { branches.push(cur); cur = ''; i++; continue; }
      cur += ch + next;
      i++;
      continue;
    }
    if (inClass) {
      cur += ch;
      if (ch === ']' && i > classStart + 1 && !(i === classStart + 2 && p[classStart + 1] === '^')) inClass = false;
      continue;
    }
    if (ch === '[') { inClass = true; classStart = i; cur += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && depth > 0) depth--;
    if (ch === '|' && depth === 0) { branches.push(cur); cur = ''; continue; }
    cur += ch;
  }
  branches.push(cur);
  return branches;
}

/**
 * The characters the engine's GNU-dialect retry rewrites when written with a backslash (`\(` `\)`
 * `\|` `\+` `\{m,n\}`; regex-dialect.js). On a zero-hit search it would turn an escape that THIS
 * repair added back into an operator (`functio\(n\)` was searched as `functio(n)` and printed every
 * `function` under a "searched it as literal text" note), so the repair writes these characters as
 * one-character classes (`[(]`), which that retry never rewrites. `?` and `}` use the same form.
 */
const GNU_OPERATOR_CHARS = new Set(['(', ')', '{', '}', '+', '?', '|']);

/** One character as literal text, in a form the GNU-dialect retry leaves alone. */
function literalChar(ch) {
  return GNU_OPERATOR_CHARS.has(ch) ? `[${ch}]` : `\\${ch}`;
}

/** Escape only the parts of one branch that cannot parse: lone `(` `)` `[` `{` `}` and a leading quantifier. */
function escapeBrokenParts(branch) {
  const tokens = [];
  const open = [];
  for (let i = 0; i < branch.length; i++) {
    const ch = branch[i];
    if (ch === '\\' && i + 1 < branch.length) { tokens.push(ch + branch[i + 1]); i++; continue; }
    if (ch === '[') {
      let j = i + 1;
      if (branch[j] === '^') j++;
      if (branch[j] === ']') j++;
      for (; j < branch.length; j++) {
        if (branch[j] === '\\') { j++; continue; }
        if (branch[j] === ']') break;
      }
      if (j < branch.length) { tokens.push(branch.slice(i, j + 1)); i = j; } else tokens.push('\\[');
      continue;
    }
    if (ch === '(') { open.push(tokens.length); tokens.push('('); continue; }
    if (ch === ')') { if (open.length) { open.pop(); tokens.push(')'); } else tokens.push(literalChar(')')); continue; }
    if (ch === '{') {
      const q = /^\{\d+(,\d*)?\}/.exec(branch.slice(i));
      const prev = tokens[tokens.length - 1];
      if (q && prev && prev !== '(' && prev !== '|' && !/^[*+?]$/.test(prev)) { tokens.push(q[0]); i += q[0].length - 1; } else tokens.push(literalChar('{'));
      continue;
    }
    if (ch === '}') { tokens.push(literalChar('}')); continue; }
    if (/[*+?]/.test(ch)) {
      const prev = tokens[tokens.length - 1];
      if (!prev || prev === '(' || prev === '|') { tokens.push(literalChar(ch)); continue; }
    }
    tokens.push(ch);
  }
  for (const at of open) {
    tokens[at] = literalChar('(');
    // A `|` the author wrote INSIDE this group (`app.(get|post`) must not become a top-level
    // alternative once the `(` is literal: that would search for any `post`. The `|` tokens at
    // the group's own depth become a literal pipe, written `[|]` (see GNU_OPERATOR_CHARS);
    // `|` inside a closed nested group keeps its meaning.
    let depth = 0;
    for (let i = at + 1; i < tokens.length; i++) {
      if (tokens[i] === '(') depth++;
      else if (tokens[i] === ')') depth--;
      else if (tokens[i] === '|' && depth === 0) tokens[i] = literalChar('|');
    }
  }
  return tokens.join('');
}

/** A branch as plain literal text: a punctuation escape (`\(`) is the literal character. */
function literalBranch(branch) {
  return String(branch).replace(/\\([^A-Za-z0-9])/g, '$1').replace(/[.*+?^${}()|[\]\\]/g, literalChar);
}

/**
 * A5. Repair a pattern the engine rejected, alternative by alternative: an alternative that
 * parses is kept as it is; a broken one gets only its broken parts escaped, or (if that
 * still does not parse) is searched as literal text. `|` alternatives are never merged into
 * one literal string.
 *
 * @returns {{pattern:string, wholeLiteral:boolean, repairedBranches:number}}
 */
export function repairRegexBranches(raw) {
  const branches = splitTopLevelAlternation(raw);
  let repairedBranches = 0;
  const fixed = branches.map((b) => {
    if (rustRegexLooksValid(b)) return b;
    repairedBranches++;
    // Look-around / back-references have no Rust form; escaping a part would change the meaning.
    if (/\(\?<?[=!]/.test(b) || /(^|[^\\])(\\\\)*\\[1-9]/.test(b)) return literalBranch(b);
    const partial = escapeBrokenParts(b);
    if (partial !== b && rustRegexLooksValid(partial)) return partial;
    return literalBranch(b);
  });
  if (repairedBranches === 0) {
    // Every alternative looks valid to JavaScript but the engine rejected the whole: search
    // each alternative as literal text, still as alternatives.
    return { pattern: branches.map(literalBranch).join('|'), wholeLiteral: branches.length === 1, repairedBranches: branches.length };
  }
  return {
    pattern: fixed.join('|'),
    // One alternative, and what is searched is plain literal text (no regex left).
    wholeLiteral: branches.length === 1 && fixed[0] === literalBranch(branches[0]),
    repairedBranches,
  };
}

// --- ss-grep: B7 ordering and flood rendering --------------------------------------------

/** Share of the first k files reserved for test files when there are more files than k. */
export const GREP_TEST_FILE_SHARE = 0.3;

function groupByFile(matches) {
  const groups = new Map();
  for (const m of matches) {
    if (!groups.has(m.file)) groups.set(m.file, []);
    groups.get(m.file).push(m);
  }
  return [...groups.values()];
}

/** How many of `k` file rows go to test files (0 when everything fits or one class is empty). */
export function testFileQuota(srcCount, testCount, k) {
  if (!(Number.isInteger(k) && k > 0) || testCount === 0 || srcCount === 0 || srcCount + testCount <= k) return 0;
  return Math.min(testCount, Math.max(1, Math.round(k * GREP_TEST_FILE_SHARE)));
}

/**
 * Non-test files first, test-like files after, each class in input order. With `k` and more
 * files than k, a quota of test files moves into the first k files so test hits never vanish
 * entirely. Input stays grouped by file.
 */
export function orderSourceBeforeTests(matches, { k = null } = {}) {
  const groups = groupByFile(matches);
  const src = groups.filter((g) => !isTestLikePath(g[0].file));
  const tst = groups.filter((g) => isTestLikePath(g[0].file));
  const q = testFileQuota(src.length, tst.length, k);
  if (q === 0) return [...src, ...tst].flat();
  const srcFirst = Math.max(0, k - q);
  return [...src.slice(0, srcFirst), ...tst.slice(0, q), ...src.slice(srcFirst), ...tst.slice(q)].flat();
}

export const GREP_HIT_TEXT_MAX = 140;

/**
 * A broad ss-grep (at least GREP_BROAD_MIN_HITS total matches) prints each hit line in a window of
 * at most GREP_BROAD_HIT_CHARS chars instead of GREP_HIT_TEXT_MAX. Decided by the 2026-10-03 diet1
 * A/B (core/prompt-optimization/data/obs-loop/TRACES-diet1.md): 18 broad greps saved ~256 chars
 * each, with no re-grep, no extra read and no misread. On a flood the ranking picks which lines
 * show; the line's head around the match is enough to tell them apart.
 *
 * 80, not 60 (2026-10-05): a 60-char window cut the condition that decides a line's meaning
 * (sequel `@fast_pk_lookup_sql = … = nil unles…`; the agent spent an ss-read on it, r282 opencode
 * sequel-08). Over 321,338 code lines of the 11 r3 repos (150 files each, seed 42), a window
 * cuts 17.5% of lines at 60, 5.2% at 80, 1.5% at 100; the mean printed line is 33.6, 35.8 and
 * 36.4 chars (36.7 at the 140 default). 80 keeps ~70% of the 60-char saving and cuts 3.4x fewer
 * lines; one avoided read pays for ~100 hit lines of the difference.
 */
export const GREP_BROAD_MIN_HITS = 50;
export const GREP_BROAD_HIT_CHARS = 80;

/**
 * The grepHitText `max` for a grep with `total` matches (undefined = the default window).
 * The thresholds are parameters so a unit test can use a small fixture.
 */
export function grepBroadHitMax(total, minHits = GREP_BROAD_MIN_HITS, chars = GREP_BROAD_HIT_CHARS) {
  return total >= minHits ? chars : undefined;
}
// Chars of the line kept before the match when a long line is cut on the left.
const GREP_HIT_LEAD = 40;

/**
 * The text ss-grep prints after `file:line: ` for one hit.
 *
 * `fullLine` (SS_FIX_GREP_FULLLINE, default ON): the hit's full source line (`content`), as
 * `grep -n` prints it, whitespace collapsed. A line longer than GREP_HIT_TEXT_MAX chars shows a
 * window of at most that many chars that contains the match, with `…` at each cut side; a match
 * near the start keeps the head of the line. A hit with no line text falls back to the matched text.
 * Off: the matched substring, whitespace collapsed, at most 140 chars (the previous output).
 *
 * `max` (grepBroadHitMax): the window size for a full line, default GREP_HIT_TEXT_MAX.
 *
 * @param {{matchText?: string, content?: string, column?: number}} m
 * @param {{fullLine?: boolean, max?: number}} [opts]
 */
export function grepHitText(m, { fullLine = false, max = GREP_HIT_TEXT_MAX } = {}) {
  const matched = String(m?.matchText || '').replace(/\s+/g, ' ').trim().slice(0, GREP_HIT_TEXT_MAX);
  const raw = fullLine && typeof m?.content === 'string' ? m.content : '';
  if (!raw.trim()) return matched;

  // Whitespace collapsed; `at(i)` is where raw char i lands in `line`: the collapsed length of
  // the raw text before it (through it, for a whitespace char), leading whitespace dropped.
  // Only the match's two ends are ever asked, so a long line (a minified bundle, an inlined
  // SVG) is not walked char by char.
  const line = raw.replace(/\s+/g, ' ').trim();
  const at = (i) => {
    const prefix = raw.slice(0, /\s/.test(raw[i]) ? i + 1 : i).replace(/\s+/g, ' ');
    return prefix.startsWith(' ') ? prefix.length - 1 : prefix.length;
  };
  if (line.length <= max) return line;
  const head = () => `${sliceWhole(line, 0, max - 1)}…`;

  // The match in the raw line: at its column when the text is there, else its first occurrence.
  // Producers trim the end of `content` but not of the match (`foo\s*`, a CRLF `\r`), so trim it too.
  const mt = String(m?.matchText || '').replace(/\s+$/, '');
  const col = Number.isInteger(m?.column) ? m.column - 1 : -1;
  const rawStart = mt && col >= 0 && raw.startsWith(mt, col) ? col : (mt ? raw.indexOf(mt) : -1);
  if (rawStart < 0) return head();
  const start = Math.min(at(rawStart), line.length);
  const end = Math.max(start, Math.min(at(rawStart + mt.length - 1) + 1, line.length));

  if (end <= max - 1) return head();
  const tailRoom = max - 1;
  if (line.length - tailRoom <= start) return `…${sliceWhole(line, line.length - tailRoom, line.length)}`;
  const room = max - 2;
  const from = Math.min(start, Math.max(start - GREP_HIT_LEAD, end - room));
  if (from === 0) return head();
  return `…${sliceWhole(line, from, from + room)}…`;
}

/** line.slice(from, to) that never cuts a surrogate pair in half (it would print as U+FFFD). */
function sliceWhole(line, from, to) {
  if (isLowSurrogate(line.charCodeAt(from))) from++;
  if (to < line.length && isLowSurrogate(line.charCodeAt(to))) to--;
  return line.slice(from, to);
}

const isLowSurrogate = (c) => c >= 0xdc00 && c <= 0xdfff;

/**
 * True when more than one hit is shown and every hit prints the same text (the matched text, or
 * the full line with `fullLine`).
 */
export function matchTextIsRepeated(matches, { fullLine = false } = {}) {
  if (!Array.isArray(matches) || matches.length < 2) return false;
  const first = grepHitText(matches[0], { fullLine });
  return matches.every((m) => grepHitText(m, { fullLine }) === first);
}

export const GREP_COUNTS_THRESHOLD = 50;
export const GREP_LINES_PER_FILE = 3;

/**
 * Flood mode (B7, >= 50 hits): one row per file with its first hit lines, not the hit-line
 * flood. Non-test files first (most hits first), then a quota of test files; files beyond
 * k are summarised in one line per class.
 *
 * @param {Array<{file:string,total:number}>} files   fileSummary.files (engine order)
 * @param {Map<string,number[]>} linesByFile         file -> hit lines (ascending, as fetched)
 * @param {number} k                                  maximum number of file rows
 */
export function renderGrepLineLists(files, linesByFile, k) {
  const byCountDesc = (a, b) => b.total - a.total || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  const src = files.filter((f) => !isTestLikePath(f.file)).sort(byCountDesc);
  const tst = files.filter((f) => isTestLikePath(f.file)).sort(byCountDesc);
  const plural = (n) => `${n} ${n === 1 ? 'match' : 'matches'}`;
  const rows = Number.isInteger(k) && k > 0 ? k : 20;
  const q = testFileQuota(src.length, tst.length, rows);
  const srcN = q > 0 ? Math.min(src.length, rows - q) : Math.min(src.length, rows);
  const tstN = Math.min(tst.length, rows - srcN);
  const row = (f) => {
    const lines = (linesByFile.get(f.file) || []).slice(0, GREP_LINES_PER_FILE);
    if (lines.length === 0) return `${f.file} (${plural(f.total)})`;
    const more = f.total - lines.length;
    return `${f.file}: lines ${lines.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`;
  };
  const tail = (list, label) => (list.length
    ? [`# +${list.length} more ${label} file(s) with ${list.reduce((a, f) => a + f.total, 0)} match(es): ${list.slice(0, 3).map((f) => f.file).join(', ')}${list.length > 3 ? ', ...' : ''}`]
    : []);
  return [
    ...src.slice(0, srcN).map(row),
    ...tst.slice(0, tstN).map(row),
    ...tail(src.slice(srcN), 'non-test'),
    ...tail(tst.slice(tstN), 'test/spec/fixture'),
  ];
}
