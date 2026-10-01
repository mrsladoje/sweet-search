/**
 * Agent-facing output fixes for the ss-* wrappers (final-tuning forensic fixes).
 *
 * Bundle A (SS_FIX_A: A1, A2, A7, A5, A4) is DEFAULT ON since 2026-10-01: the ss-* tools that
 * `sweet-search` ships ARE these wrappers (package.json "files"). SWEET_SEARCH_COMPACT_OUTPUT=0
 * restores the previous output byte for byte; an explicit SS_FIX_A=0|1 wins over both (bench).
 * Every other switch here is DEFAULT OFF and is not part of the product. The functions in
 * this file are pure (no I/O, no process state) or take their I/O as an argument
 * (`decideAlreadyShown` gets the socket sender), so they can be unit-tested; the
 * wrapper (eval/agent-read-workflows/bin/_ss-helpers.mjs) wires them to the printers.
 *
 * Switches (read from the environment; on = 1/true/on/yes, off = 0/false/off/no):
 *   SS_FIX_A=1|0               bundle A umbrella (no information loss; default: ON unless
 *                              SWEET_SEARCH_COMPACT_OUTPUT=0):
 *                                A1 one-line query header instead of the budget/route header,
 *                                   no score / kind tag / confidence line / trailers,
 *                                   compact `# sufficient=YES` line (only when YES)
 *                                A2 one-line summary entries; dedupe of covered summary entries
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
 *
 * ss-read output is NOT changed by any switch (owner decision 2026-10-01).
 */

import { collectAgentShownSpansIndexed, validAgentSessionId } from './agent-span-ledger.js';

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
  return {
    compact,
    traceCompact: subSwitch(env?.SS_FIX_TRACE_COMPACT, compact),
    grepRetry: subSwitch(env?.SS_FIX_GREP_RETRY, compact),
    alreadyShown: isOn(env?.SS_FIX_ALREADY_SHOWN),
    dropSufficiency: isOn(env?.SS_FIX_DROP_SUFFICIENCY),
    summaryCap: capNumber > 0 ? capNumber : null,
    onePerFile: isOn(env?.SS_FIX_ONE_PER_FILE),
    grepOrder: isOn(env?.SS_FIX_GREP_ORDER),
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
 * The key that identifies one agent session, for the A3 ledger.
 *
 * Why the original lookup fired on Codex only: it reads SWEET_SEARCH_SESSION_ID,
 * CODEX_THREAD_ID and CLAUDE_SESSION_ID. Codex sets CODEX_THREAD_ID itself. Claude Code
 * does NOT set CLAUDE_SESSION_ID (it exports CLAUDE_CODE_SESSION_ID; the product only
 * gets a key through an installed SessionStart hook). opencode sets OPENCODE_PID and
 * no session key. This function adds both real variables.
 *
 * LIMIT: a Claude Code subagent inherits its parent's CLAUDE_CODE_SESSION_ID, and opencode
 * subagents run in the same process (same OPENCODE_PID). The key cannot tell a subagent from
 * its parent; that is why A3 is its own default-off switch.
 */
export function resolveThreadKey(env = process.env) {
  const valid = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(v);
  const direct = [env?.SWEET_SEARCH_SESSION_ID, env?.CODEX_THREAD_ID, env?.CLAUDE_CODE_SESSION_ID, env?.CLAUDE_SESSION_ID];
  const found = direct.find(valid);
  if (found) return found;
  // opencode exports its own process id into every tool shell.
  if (valid(env?.OPENCODE_PID) && /^\d+$/.test(env.OPENCODE_PID)) return `opencode-${env.OPENCODE_PID}`;
  return null;
}

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

// --- test-file detection --------------------------------------------------------------

const TEST_DIR_RE = /(^|\/)(__tests__|__mocks__|tests?|specs?|testdata|test_data|fixtures?|e2e|mocks?|testing|integration[-_]tests?)(\/|$)/i;
const TEST_FILE_RES = [
  /_test\.[a-z0-9]+$/i,                       // Go, Python style foo_test.py
  /(^|\/)test_[^/]+\.[a-z0-9]+$/i,            // Python test_foo.py
  /[-_.](test|spec)\.[cm]?[jt]sx?$/i,         // JS/TS foo.test.ts, foo.spec.js
  /_spec\.[a-z0-9]+$/i,                       // Ruby foo_spec.rb
  /(^|\/)[^/]*Tests?\.(java|kt|kts|scala|cs|swift|m|mm|php)$/,   // FooTest.java, FooTests.swift
  /(^|\/)conftest\.py$/i,
];

/** Test, spec, fixture or mock file by path shape only. */
export function isTestLikePath(file) {
  const p = String(file || '').replace(/\\/g, '/');
  if (!p) return false;
  return TEST_DIR_RE.test(p) || TEST_FILE_RES.some((re) => re.test(p));
}

// --- ss-search / ss-find entry selection ---------------------------------------------

/** A summary-only entry: no code was packed for it. */
export function isSummaryOnly(r) {
  return !!r && !r.code && (r.presentation === 'summary' || !!r.summary);
}

const RESTATING_SUMMARY_RE = /^\S+:\d+ — .+ \([^)]*\)$/;

/** True when the summary text only restates the entry header (`file:line — symbol (kind)`). */
export function summaryRestatesHeader(summary) {
  return RESTATING_SUMMARY_RE.test(String(summary ?? '').trim());
}

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
 *   'a2' — SS_FIX_A rule (review 2026-10-01): a summary-only entry is dropped only when an
 *          earlier entry has the IDENTICAL span, or an earlier entry WITH CODE contains it.
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
    const seen = [];
    list = list.filter(({ r }) => {
      const covered = isSummaryOnly(r) && seen.some((x) => x.file === r.file
        && ((x.start === r.startLine && x.end === r.endLine)
          || (x.hasCode && r.startLine >= x.start && r.endLine <= x.end)));
      if (!covered) seen.push({ file: r.file, start: r.startLine, end: r.endLine, hasCode: !!r.code });
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
  const hiddenCode = input.some((e) => !printed.has(e.index) && (!!e.r.code || !!e.r.continuation?.code));
  return { entries: list, hidden, hiddenCode };
}

/** `path:start-end symbol (kind)` — the whole summary entry on one line (A2). */
export function renderSummaryLine(r) {
  const span = r.endLine && r.endLine !== r.startLine ? `${r.startLine}-${r.endLine}` : `${r.startLine}`;
  const sym = r.symbol ? ` ${r.symbol}` : '';
  const kind = r.symbolType ? ` (${r.symbolType})` : '';
  const stale = r.stale ? ' STALE' : '';
  return `${r.file}:${span}${sym}${kind}${stale}`;
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
 * A1 one-line header: `# <tool>: N results for "<query>"` (ss-find adds ` /<regex>/`). It
 * replaces the routed / budget / used / subMode header.
 */
export function renderCompactHeader(tool, count, query, { regex = null } = {}) {
  const n = Number(count) || 0;
  const rx = regex == null ? '' : ` /${regex}/`;
  return `# ${tool}: ${n} result${n === 1 ? '' : 's'} for "${query ?? ''}"${rx}\n`;
}

/**
 * A1 keeps a compact sufficiency token: `# sufficient=YES` only when the verdict is YES, and
 * (like the original line) only together with a confidence verdict. `sufficiencyText` is the
 * original ` sufficient=...` fragment. `drop` = SS_FIX_DROP_SUFFICIENCY.
 */
export function renderCompactSufficiency(response, sufficiencyText, { drop = false } = {}) {
  if (drop || !response?.confidence) return '';
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

// --- fixed renderer -----------------------------------------------------------------

/**
 * Fixed renderer for ss-search / ss-find result blocks. Used only when a switch is on
 * (resultRenderFixActive); otherwise the original loops run unchanged.
 *   compact (SS_FIX_A): A1 rank header without presentation/kind tag and score, A2 one-line
 *                       summary entries, A7 imports dedupe.
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
 * @returns {string}
 */
export function renderFixedBlocks(results, plan, {
  compact = false,
  omitted = new Set(),
  dropRestatingSummary = false,
  gutter = (code) => code,
} = {}) {
  const parts = [];
  const out = (text) => parts.push(text);
  let wroteAny = false;
  let inSummaryRun = false;
  const lead = () => (compact ? (wroteAny ? '\n' : '') : '\n');
  for (const { r, index, also } of plan.entries) {
    const stale = r.stale ? ' STALE' : '';
    if (compact && isSummaryOnly(r)) {
      out(`${inSummaryRun ? '' : lead()}${renderSummaryLine(r)}\n`);
      if (r.summary && !summaryRestatesHeader(r.summary)) out(`${r.summary}\n`);
      const alsoLine = renderAlsoInFile(also);
      if (alsoLine) out(`${alsoLine}\n`);
      inSummaryRun = true;
      wroteAny = true;
      continue;
    }
    inSummaryRun = false;
    const sym = r.symbol ? ` [${r.symbolType || 'code'}: ${r.symbol}]` : '';
    if (compact) {
      out(`${lead()}## #${r.rank} ${r.file}:${r.startLine}-${r.endLine}${sym}${stale}\n`);
    } else {
      const kind = r.expansionKind ? ` kind=${r.expansionKind}` : '';
      out(`\n## #${r.rank} ${r.file}:${r.startLine}-${r.endLine}${sym} (${r.presentation}${kind}${stale}) score=${(r.score || 0).toFixed(3)}\n`);
    }
    wroteAny = true;
    const codeOmitted = omitted.has(`${index}:result`);
    if (r.headerContext) {
      const imports = compact && r.code && !codeOmitted ? dedupeImports(r.headerContext, r.code) : r.headerContext;
      if (imports) out(`### imports\n\`\`\`\n${imports}\n\`\`\`\n`);
    }
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
    out(`${wroteAny && compact ? '\n' : ''}(+${plan.hidden} lower-ranked entries not shown)\n`);
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
  const printed = new Set(plan.entries.map((e) => e.index));
  return collectAgentShownSpansIndexed(results, {
    projectRoot,
    include: (resultIndex, part) => {
      if (!printed.has(resultIndex)) return false;
      const r = results[resultIndex];
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

const EXTERNAL_PATH_RE = /\(external\)/;

function isExternalItem(item) {
  return item?.type === 'external' || !item?.file;
}

/**
 * Compact ss-trace rendering (A4). One row per caller / callee, no bodies, no answer-cue
 * lines, no budget / latency line. Only the requested section prints when `mode` is set.
 * External (not in the repository) callees are filtered; one line says how many.
 */
export function formatTraceCompact(result, { mode = null, notes = [] } = {}) {
  if (!result.target) return `No indexed symbol found for "${result.symbol}".`;
  const t = result.target;
  const show = (section) => mode === null || mode === section;
  const lines = [];
  const provenance = result.sections.callers.provenance || { stored: 0, sameFileFallback: 0 };
  lines.push(`# trace ${t.name} [${t.type}] ${t.filePath}:${t.startLine}-${t.endLine}`);
  lines.push(`fan-in=${t.fanIn} fan-out=${t.fanOut}`);
  if (provenance.sameFileFallback > 0 && provenance.stored === 0) {
    lines.push('note: callers below come from a same-file source scan (no stored cross-file edges).');
  } else if (provenance.sameFileFallback > 0) {
    lines.push(`note: caller sources are mixed — ${provenance.stored} from stored call edges, ${provenance.sameFileFallback} from a same-file source scan.`);
  } else if (t.fanIn === 0 && t.fanOut === 0 && !result.sections.callers.total && !result.sections.callees.total) {
    lines.push('no stored call edges for this symbol — map its sites with one broad ss-grep of the symbol stem instead.');
  }
  for (const n of notes) lines.push(n);
  if (result.disambiguation?.length) {
    lines.push(`ambiguous: using first match; alternatives: ${result.disambiguation.slice(0, 5).map((a) => `${a.name} ${a.file}:${a.startLine}`).join(', ')}`);
  }

  const listed = new Set(); // `file:line` of every caller / callee row printed below
  for (const [title, section] of [['callers', result.sections.callers], ['callees', result.sections.callees]]) {
    if (!show(title)) continue;
    const internal = section.items.filter((i) => !isExternalItem(i));
    const external = section.items.length - internal.length;
    // Same count as the full trace (structural-context-format.js): every row, and the distinct
    // callers / callees when they differ, so the heading and fan-in / fan-out read as one set.
    // External rows are counted here and named in the `(+N external ...)` line below.
    const total = section.total || 0;
    const noun = title === 'callers' ? 'caller' : 'callee';
    const count = section.distinct != null && section.distinct !== total
      ? `${total} call sites, ${section.distinct} distinct ${noun}${section.distinct === 1 ? '' : 's'}`
      : `${total}`;
    lines.push(`\n## ${title} (${count})`);
    for (const item of internal) {
      lines.push(item.summary);
      listed.add(`${item.file}:${item.startLine || '?'}`);
    }
    if (!internal.length) lines.push('(none)');
    if (external > 0) lines.push(`(+${external} external/unresolved ${title} not listed)`);
  }

  if (show('impact')) {
    // Without a mode word, a one-hop path whose other end is already a printed caller /
    // callee row adds nothing and is dropped. With `impact` asked for, every path prints.
    // Paths that end in an external (not in the repository) symbol are always filtered.
    const oneHopRepeats = (p) => {
      const segs = String(p.path).split(' -> ');
      if (segs.length !== 2) return false;
      const other = p.direction === 'upstream' ? segs[0] : segs[1];
      const loc = other.match(/\(([^()]*)\)$/);
      return !!loc && listed.has(loc[1]);
    };
    const paths = result.sections.impact.paths
      .filter((p) => !EXTERNAL_PATH_RE.test(String(p.path)))
      .filter((p) => mode === 'impact' || !oneHopRepeats(p));
    lines.push(`\n## impact paths (${paths.length}, depth <= ${result.maxDepth})`);
    if (!paths.length) lines.push('(none)');
    paths.forEach((p, i) => lines.push(`${i + 1}. ${p.direction} ${p.path}`));
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
    if (ch === ')') { if (open.length) { open.pop(); tokens.push(')'); } else tokens.push('\\)'); continue; }
    if (ch === '{') {
      const q = /^\{\d+(,\d*)?\}/.exec(branch.slice(i));
      const prev = tokens[tokens.length - 1];
      if (q && prev && prev !== '(' && prev !== '|' && !/^[*+?]$/.test(prev)) { tokens.push(q[0]); i += q[0].length - 1; } else tokens.push('\\{');
      continue;
    }
    if (ch === '}') { tokens.push('\\}'); continue; }
    if (/[*+?]/.test(ch)) {
      const prev = tokens[tokens.length - 1];
      if (!prev || prev === '(' || prev === '|') { tokens.push(`\\${ch}`); continue; }
    }
    tokens.push(ch);
  }
  for (const at of open) {
    tokens[at] = '\\(';
    // A `|` the author wrote INSIDE this group (`app.(get|post`) must not become a top-level
    // alternative once the `(` is literal: that would search for any `post`. The `|` tokens at
    // the group's own depth become a literal pipe, written `[|]` (a `\|` would trip the
    // regex-dialect hint about GNU alternation); `|` inside a closed nested group keeps its meaning.
    let depth = 0;
    for (let i = at + 1; i < tokens.length; i++) {
      if (tokens[i] === '(') depth++;
      else if (tokens[i] === ')') depth--;
      else if (tokens[i] === '|' && depth === 0) tokens[i] = '[|]';
    }
  }
  return tokens.join('');
}

/** A branch as plain literal text: a punctuation escape (`\(`) is the literal character. */
function literalBranch(branch) {
  return String(branch).replace(/\\([^A-Za-z0-9])/g, '$1').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function normText(m) {
  return String(m?.matchText || '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** True when more than one hit is shown and every hit carries the same matched text. */
export function matchTextIsRepeated(matches) {
  if (!Array.isArray(matches) || matches.length < 2) return false;
  const first = normText(matches[0]);
  return matches.every((m) => normText(m) === first);
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
