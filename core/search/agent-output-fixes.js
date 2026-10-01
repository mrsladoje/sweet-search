/**
 * Agent-facing output fixes for the ss-* wrappers (final-tuning forensic fixes).
 *
 * Every switch here is DEFAULT OFF. With every switch unset the wrappers take
 * their original code path and the output stays byte-identical. The functions in
 * this file are pure (no I/O, no process state) so they can be unit-tested; the
 * wrapper (eval/agent-read-workflows/bin/_ss-helpers.mjs) wires them to the
 * printers.
 *
 * Switches (read from the environment):
 *   SS_FIX_A=1             bundle A: no-information-loss cleanup
 *                          (A1 header/tag/trailer drop, A2 one-line summaries,
 *                           A3 already-shown omission, A4 compact ss-trace,
 *                           A5 ss-grep retries)
 *   SS_FIX_SUMMARY_CAP=n   B1: at most n summary-only entries; -k caps entries
 *   SS_FIX_ONE_PER_FILE=1  B2: one ss-search entry per file
 *   SS_FIX_GREP_ORDER=1    B7: ss-grep source-before-test, per-file counts, no repeated text
 *
 * ss-read is NOT changed by any switch (owner decision 2026-10-01).
 */

const TRUE_VALUES = new Set(['1', 'true', 'on', 'yes']);

function isOn(value) {
  return TRUE_VALUES.has(String(value ?? '').trim().toLowerCase());
}

/** Parse the switches. `summaryCap` is null (off) or an integer >= 0. */
export function readFixFlags(env = process.env) {
  const rawCap = String(env?.SS_FIX_SUMMARY_CAP ?? '').trim();
  const cap = /^\d+$/.test(rawCap) ? Number.parseInt(rawCap, 10) : null;
  return {
    bundleA: isOn(env?.SS_FIX_A),
    summaryCap: cap,
    onePerFile: isOn(env?.SS_FIX_ONE_PER_FILE),
    grepOrder: isOn(env?.SS_FIX_GREP_ORDER),
  };
}

/** True when ss-search / ss-find must use the fixed renderer instead of the original one. */
export function resultRenderFixActive(flags, { find = false } = {}) {
  return !!(flags.bundleA || flags.summaryCap != null || (!find && flags.onePerFile));
}

// --- thread key ----------------------------------------------------------------------

/**
 * The key that identifies one agent thread, for the shown-span ledger.
 *
 * Why the original lookup fired on Codex only: it reads SWEET_SEARCH_SESSION_ID,
 * CODEX_THREAD_ID and CLAUDE_SESSION_ID. Codex sets CODEX_THREAD_ID itself. Claude Code
 * does NOT set CLAUDE_SESSION_ID (it exports CLAUDE_CODE_SESSION_ID; the product only
 * gets a key through an installed SessionStart hook). opencode sets OPENCODE_PID and
 * no session key. This function adds both real variables. It is used only when SS_FIX_A=1,
 * so the original `resolveAgentSessionId` (and ss-read behaviour) is untouched.
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
 * Order: A2 dedupe, then B2 one-per-file, then the B1 caps. Rank order is kept; ranks are
 * never renumbered.
 *
 * @param {Array} results   response.results
 * @param {{dedupe?:boolean, onePerFile?:boolean, summaryCap?:number|null, k?:number|null}} o
 * @returns {{entries: Array<{r:object, index:number, also:Array}>, hidden:number}}
 */
export function selectEntries(results, o = {}) {
  let list = (Array.isArray(results) ? results : []).map((r, index) => ({ r, index, also: [] }));

  if (o.dedupe) {
    // Same rule as the SS_VARIANT_SEARCH_DEDUPE variant: a summary entry whose span lies
    // inside an earlier listed span, or that repeats an earlier file + symbol, is dropped.
    const seen = [];
    list = list.filter(({ r }) => {
      const covered = seen.some((x) => x.file === r.file
        && ((r.startLine >= x.start && r.endLine <= x.end) || (r.symbol && x.symbol === r.symbol)));
      seen.push({ file: r.file, start: r.startLine, end: r.endLine, symbol: r.symbol || null });
      return !(covered && r.presentation === 'summary');
    });
  }

  if (o.onePerFile) {
    const firstOfFile = new Map();
    const kept = [];
    for (const e of list) {
      const first = firstOfFile.get(e.r.file);
      if (!first) {
        firstOfFile.set(e.r.file, e);
        kept.push(e);
      } else {
        first.also.push({ symbol: e.r.symbol || null, startLine: e.r.startLine });
      }
    }
    list = kept;
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
  return { entries: list, hidden };
}

/** `path:start-end symbol (kind)` — the whole summary entry on one line (A2). */
export function renderSummaryLine(r) {
  const span = r.endLine && r.endLine !== r.startLine ? `${r.startLine}-${r.endLine}` : `${r.startLine}`;
  const sym = r.symbol ? ` ${r.symbol}` : '';
  const kind = r.symbolType ? ` (${r.symbolType})` : '';
  const stale = r.stale ? ' STALE' : '';
  return `${r.file}:${span}${sym}${kind}${stale}`;
}

/** `also in this file: symA (l.120), symB (l.300)` (B2). */
export function renderAlsoInFile(also) {
  if (!also || also.length === 0) return '';
  return `also in this file: ${also.map((a) => `${a.symbol || 'code'} (l.${a.startLine})`).join(', ')}`;
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
    const total = Math.max(0, (section.total || 0) - external);
    lines.push(`\n## ${title} (${total})`);
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

// --- ss-grep ------------------------------------------------------------------------------

/** A regex the engine could not parse (ripgrep / Rust regex), as opposed to a real failure. */
export function isRegexParseError(err) {
  const msg = String(err?.message || err || '');
  return /regex parse error|error parsing regex|unclosed group|unclosed character class|unopened group|unrecognized escape|repetition operator missing|invalid regex|look-?around|backreferences? (are )?not supported/i.test(msg);
}

/** Stable partition: non-test files first, test-like files after. Input stays grouped by file. */
export function orderSourceBeforeTests(matches) {
  const src = [];
  const tst = [];
  for (const m of matches) (isTestLikePath(m.file) ? tst : src).push(m);
  return [...src, ...tst];
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

/**
 * Per-file counts instead of the full flood (B7, >= 50 hits). Non-test files first (most
 * hits first), test-like files collapsed into one line.
 *
 * @param {Array<{file:string,total:number}>} files   fileSummary.files (engine order)
 * @param {Map<string,number>} firstLine              file -> first hit line
 * @param {number} k                                  maximum number of source rows
 */
export function renderGrepCounts(files, firstLine, k) {
  const byCountDesc = (a, b) => b.total - a.total || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  const src = files.filter((f) => !isTestLikePath(f.file)).sort(byCountDesc);
  const tst = files.filter((f) => isTestLikePath(f.file)).sort(byCountDesc);
  const plural = (n) => `${n} ${n === 1 ? 'match' : 'matches'}`;
  const lines = [];
  for (const f of src.slice(0, k)) {
    const at = firstLine.get(f.file);
    lines.push(`${f.file}${at ? `:${at}` : ''} (${plural(f.total)})`);
  }
  const srcHidden = src.slice(k);
  if (srcHidden.length) {
    lines.push(`# +${srcHidden.length} more non-test file(s) with ${srcHidden.reduce((a, f) => a + f.total, 0)} match(es): ${srcHidden.slice(0, 3).map((f) => f.file).join(', ')}`);
  }
  if (tst.length) {
    const names = tst.slice(0, 6).map((f) => `${f.file} (${f.total})`).join(', ');
    lines.push(`# test/spec/fixture files: ${tst.length} file(s), ${tst.reduce((a, f) => a + f.total, 0)} match(es): ${names}${tst.length > 6 ? ', ...' : ''}`);
  }
  return lines;
}
