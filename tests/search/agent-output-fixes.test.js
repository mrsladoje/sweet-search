/**
 * ss-* output fixes (SS_FIX_A and its sub-switches, SS_FIX_ALREADY_SHOWN, SS_FIX_SUMMARY_CAP,
 * SS_FIX_ONE_PER_FILE, SS_FIX_GREP_ORDER). The wiring (renderer, ledger protocol, regex repair)
 * is in agent-output-fixes-wiring.test.js.
 *
 * The invariants: Bundle A (SS_FIX_A) is the product default, SWEET_SEARCH_COMPACT_OUTPUT=0 or
 * SS_FIX_A=0 turns every switch off, every other switch is default off, and the pure helpers do
 * what the fix list says.
 * The byte-identical-when-off check for the real CLI is a script run (see FIXES-IMPL.md).
 */
import { describe, expect, it } from 'vitest';

import {
  GREP_COUNTS_THRESHOLD,
  formatTraceCompact,
  isRegexParseError,
  isSummaryOnly,
  isTestLikePath,
  matchTextIsRepeated,
  orderSourceBeforeTests,
  compactOutputDefault,
  readFixFlags,
  renderAlsoInFile,
  renderGrepLineLists,
  renderSummaryLine,
  resolveThreadKey,
  resultRenderFixActive,
  selectEntries,
  shownCodeSpan,
  summaryRestatesHeader,
} from '../../core/search/agent-output-fixes.js';
import { renderGrepBody } from '../../core/search/grep-output-shaping.js';
import {
  AgentSpanLedger,
  collectAgentShownSpans,
  collectAgentShownSpansIndexed,
} from '../../core/search/agent-span-ledger.js';

const OFF = { SS_FIX_A: '0' };
const ALL_OFF = {
  compact: false, traceCompact: false, grepRetry: false, alreadyShown: false,
  dropSufficiency: false, summaryCap: null, onePerFile: false, grepOrder: false,
};

describe('readFixFlags: product default (Bundle A on)', () => {
  it('turns on A1/A2/A7 (compact), A4 and A5 with an empty environment', () => {
    expect(readFixFlags({})).toEqual({ ...ALL_OFF, compact: true, traceCompact: true, grepRetry: true });
    expect(readFixFlags({})).toEqual(readFixFlags({ SS_FIX_A: '1' }));
    expect(resultRenderFixActive(readFixFlags({}))).toBe(true);
    expect(resultRenderFixActive(readFixFlags({}), { find: true })).toBe(true);
  });

  it('SWEET_SEARCH_COMPACT_OUTPUT=0 turns every switch off (the previous output)', () => {
    for (const v of ['0', 'false', 'off', 'no', ' OFF ']) {
      expect(readFixFlags({ SWEET_SEARCH_COMPACT_OUTPUT: v })).toEqual(ALL_OFF);
      expect(compactOutputDefault({ SWEET_SEARCH_COMPACT_OUTPUT: v })).toBe(false);
    }
    for (const v of [undefined, '', '1', 'yes', 'maybe']) {
      expect(compactOutputDefault({ SWEET_SEARCH_COMPACT_OUTPUT: v })).toBe(true);
    }
  });

  it('an explicit SS_FIX_A wins over SWEET_SEARCH_COMPACT_OUTPUT (bench reproducibility)', () => {
    expect(readFixFlags({ SS_FIX_A: '1', SWEET_SEARCH_COMPACT_OUTPUT: '0' }).compact).toBe(true);
    expect(readFixFlags({ SS_FIX_A: '0', SWEET_SEARCH_COMPACT_OUTPUT: '1' })).toEqual(ALL_OFF);
    expect(readFixFlags({ SS_FIX_A: 'garbage', SWEET_SEARCH_COMPACT_OUTPUT: '0' })).toEqual(ALL_OFF);
  });

  it('the product default renders like SS_FIX_A=1 for ss-search, ss-find, ss-grep and ss-trace', () => {
    expect(readFixFlags({})).toEqual(readFixFlags({ SS_FIX_A: '1' }));
    // The trace switch still has its own opt-out inside the product default.
    expect(readFixFlags({ SS_FIX_TRACE_COMPACT: '0' })).toMatchObject({ compact: true, traceCompact: false });
  });

  it('the bench-only switches stay off in the product default', () => {
    expect(readFixFlags({})).toMatchObject({ alreadyShown: false, dropSufficiency: false, summaryCap: null, onePerFile: false, grepOrder: false });
  });
});

describe('readFixFlags', () => {
  it('is all off with SS_FIX_A=0 (the bench baseline)', () => {
    expect(readFixFlags(OFF)).toEqual({
      compact: false, traceCompact: false, grepRetry: false, alreadyShown: false,
      dropSufficiency: false, summaryCap: null, onePerFile: false, grepOrder: false,
    });
    expect(resultRenderFixActive(readFixFlags(OFF))).toBe(false);
    expect(resultRenderFixActive(readFixFlags(OFF), { find: true })).toBe(false);
  });

  it('SS_FIX_A turns on A1/A2 (compact), A4 and A5, but never A3', () => {
    const a = readFixFlags({ SS_FIX_A: '1' });
    expect(a).toMatchObject({ compact: true, traceCompact: true, grepRetry: true, alreadyShown: false });
    expect(readFixFlags({ SS_FIX_A: 'yes' }).compact).toBe(true);
  });

  it('A4 and A5 have their own switches: on alone, or off inside SS_FIX_A', () => {
    expect(readFixFlags({ ...OFF, SS_FIX_TRACE_COMPACT: '1' })).toMatchObject({ compact: false, traceCompact: true, grepRetry: false });
    expect(readFixFlags({ ...OFF, SS_FIX_GREP_RETRY: 'on' })).toMatchObject({ compact: false, traceCompact: false, grepRetry: true });
    expect(readFixFlags({ SS_FIX_A: '1', SS_FIX_TRACE_COMPACT: '0' })).toMatchObject({ compact: true, traceCompact: false, grepRetry: true });
    expect(readFixFlags({ SS_FIX_A: '1', SS_FIX_GREP_RETRY: 'off' })).toMatchObject({ compact: true, traceCompact: true, grepRetry: false });
    // An unknown value inherits the umbrella.
    expect(readFixFlags({ SS_FIX_A: '1', SS_FIX_GREP_RETRY: 'maybe' }).grepRetry).toBe(true);
  });

  it('A3 and the sufficiency drop are separate switches that accept every on-value', () => {
    expect(readFixFlags({ ...OFF, SS_FIX_ALREADY_SHOWN: '1' })).toMatchObject({ alreadyShown: true, compact: false });
    expect(readFixFlags({ ...OFF, SS_FIX_DROP_SUFFICIENCY: 'true' }).dropSufficiency).toBe(true);
    expect(readFixFlags({ ...OFF, SS_FIX_DROP_SUFFICIENCY: 'on' }).dropSufficiency).toBe(true);
    expect(readFixFlags({ ...OFF, SS_FIX_DROP_SUFFICIENCY: '0' }).dropSufficiency).toBe(false);
  });

  it('reads each switch on its own', () => {
    expect(readFixFlags({ SS_FIX_A: '1' }).compact).toBe(true);
    expect(readFixFlags({ SS_FIX_A: '0' }).compact).toBe(false);
    expect(readFixFlags({ ...OFF, SS_FIX_SUMMARY_CAP: '3' }).summaryCap).toBe(3);
    // 0 means "cap off", as for every other switch in this codebase.
    expect(readFixFlags({ ...OFF, SS_FIX_SUMMARY_CAP: '0' }).summaryCap).toBeNull();
    expect(resultRenderFixActive(readFixFlags({ ...OFF, SS_FIX_SUMMARY_CAP: '0' }))).toBe(false);
    expect(readFixFlags({ ...OFF, SS_FIX_SUMMARY_CAP: '' }).summaryCap).toBeNull();
    expect(readFixFlags({ ...OFF, SS_FIX_SUMMARY_CAP: 'abc' }).summaryCap).toBeNull();
    expect(readFixFlags({ ...OFF, SS_FIX_ONE_PER_FILE: '1' }).onePerFile).toBe(true);
    expect(readFixFlags({ ...OFF, SS_FIX_GREP_ORDER: '1' }).grepOrder).toBe(true);
  });

  it('uses the fixed renderer for ss-search, but one-per-file never reaches ss-find', () => {
    expect(resultRenderFixActive(readFixFlags({ ...OFF, SS_FIX_ONE_PER_FILE: '1' }))).toBe(true);
    expect(resultRenderFixActive(readFixFlags({ ...OFF, SS_FIX_ONE_PER_FILE: '1' }), { find: true })).toBe(false);
    expect(resultRenderFixActive(readFixFlags({ ...OFF, SS_FIX_SUMMARY_CAP: '2' }), { find: true })).toBe(true);
    expect(resultRenderFixActive(readFixFlags({ ...OFF, SS_FIX_GREP_ORDER: '1' }))).toBe(false);
    // Grep / trace sub-switches never touch the ss-search / ss-find renderer.
    expect(resultRenderFixActive(readFixFlags({ ...OFF, SS_FIX_GREP_RETRY: '1', SS_FIX_TRACE_COMPACT: '1' }))).toBe(false);
    // A3 uses the renderer only when it is EFFECTIVE (switch + thread key + receipt ledger).
    expect(resultRenderFixActive(readFixFlags({ ...OFF, SS_FIX_ALREADY_SHOWN: '1' }))).toBe(false);
    expect(resultRenderFixActive(readFixFlags(OFF), { alreadyShownActive: true })).toBe(true);
    expect(resultRenderFixActive(readFixFlags(OFF), { find: true, alreadyShownActive: true })).toBe(true);
  });
});

describe('resolveThreadKey', () => {
  it('finds the session key of each harness', () => {
    expect(resolveThreadKey({ CODEX_THREAD_ID: 'thr-1' })).toBe('thr-1');
    expect(resolveThreadKey({ CLAUDE_CODE_SESSION_ID: 'cc-1' })).toBe('cc-1');
    expect(resolveThreadKey({ OPENCODE_PID: '4242' })).toBe('opencode-4242');
    expect(resolveThreadKey({ SWEET_SEARCH_SESSION_ID: 'explicit', CODEX_THREAD_ID: 'thr-1' })).toBe('explicit');
  });

  it('returns null without a usable key', () => {
    expect(resolveThreadKey({})).toBeNull();
    expect(resolveThreadKey({ CLAUDE_CODE_SESSION_ID: '' })).toBeNull();
    expect(resolveThreadKey({ OPENCODE_PID: 'not-a-pid' })).toBeNull();
  });
});

describe('isTestLikePath', () => {
  it('recognises test, spec, fixture and mock files', () => {
    for (const p of ['tree_test.go', 'tests/a.py', 'src/foo.test.ts', 'src/foo.spec.js', 'test_x.py',
      'spec/models/user_spec.rb', 'app/src/FooTest.java', 'testdata/a.json', '__mocks__/x.js']) {
      expect(isTestLikePath(p), p).toBe(true);
    }
  });

  it('keeps source files as non-test', () => {
    for (const p of ['tree.go', 'src/context.js', 'lib/contest.py', 'src/latest.ts', 'core/search/a.js']) {
      expect(isTestLikePath(p), p).toBe(false);
    }
  });
});

function entry(over) {
  return {
    rank: 1, file: 'a.go', startLine: 1, endLine: 10, symbol: 'f', symbolType: 'function',
    presentation: 'summary', code: null, summary: 'a.go:1 — f (function)', ...over,
  };
}

describe('selectEntries (A2, B1, B2)', () => {
  it("'v3' keeps the SS_VARIANT_SEARCH_DEDUPE rule: any earlier span, or the same file + symbol", () => {
    const results = [
      entry({ rank: 1, presentation: 'full', code: 'x', startLine: 10, endLine: 50, symbol: 'big' }),
      entry({ rank: 2, startLine: 20, endLine: 30, symbol: 'inner' }),     // inside rank 1
      entry({ rank: 3, startLine: 60, endLine: 70, symbol: 'other' }),
      entry({ rank: 4, startLine: 80, endLine: 90, symbol: 'other' }),     // repeats file + symbol
    ];
    const { entries } = selectEntries(results, { dedupe: 'v3' });
    expect(entries.map((e) => e.r.rank)).toEqual([1, 3]);
  });

  it("'a2' drops a summary only under an earlier CODE entry or an identical span", () => {
    const results = [
      entry({ rank: 1, presentation: 'full', code: 'x', startLine: 10, endLine: 50, shownStartLine: 10, shownEndLine: 50, symbol: 'big' }),
      entry({ rank: 2, startLine: 20, endLine: 30, symbol: 'inner' }),     // inside shown code: dropped
      entry({ rank: 3, startLine: 60, endLine: 70, symbol: 'other' }),
      entry({ rank: 4, startLine: 80, endLine: 90, symbol: 'other' }),     // same symbol, other span: KEPT
      entry({ rank: 5, startLine: 60, endLine: 70, symbol: 'other' }),     // identical span: dropped
    ];
    expect(selectEntries(results, { dedupe: 'a2' }).entries.map((e) => e.r.rank)).toEqual([1, 3, 4]);
  });

  it("'a2' covers a summary only with the lines a code block SHOWS (cut, sandwich, preview)", () => {
    const inner = entry({ rank: 2, startLine: 20, endLine: 30, symbol: 'inner' });
    const keptUnder = (codeEntry) => selectEntries([codeEntry, inner], { dedupe: 'a2' }).entries.map((e) => e.r.rank);
    const big = { rank: 1, presentation: 'full', startLine: 10, endLine: 50, symbol: 'big' };
    // Body cut at the token cap after line 15: lines 20-30 were never printed.
    expect(keptUnder(entry({ ...big, code: 'x', shownStartLine: 10, shownEndLine: 15, boundaryTruncated: true }))).toEqual([1, 2]);
    // Sandwich (signature + gold + closing, middle elided) and preview bodies print part of the span.
    expect(keptUnder(entry({ ...big, code: 'x', expansionKind: 'sandwich' }))).toEqual([1, 2]);
    expect(keptUnder(entry({ ...big, presentation: 'preview', code: 'x' }))).toEqual([1, 2]);
    // No shown-line stamp: a full body covers its span only when every line of it is printed.
    const fullBody = Array.from({ length: 41 }, (_, i) => `line ${10 + i}`).join('\n');
    expect(keptUnder(entry({ ...big, code: fullBody }))).toEqual([1]);
    expect(keptUnder(entry({ ...big, code: 'x' }))).toEqual([1, 2]);
    // An identical span is a repeat of the header pointer, whatever the body shows.
    expect(selectEntries([entry({ ...big, code: 'x', expansionKind: 'sandwich' }), entry({ rank: 2, startLine: 10, endLine: 50 })], { dedupe: 'a2' })
      .entries.map((e) => e.r.rank)).toEqual([1]);
  });

  it('shownCodeSpan reports only fully printed lines', () => {
    expect(shownCodeSpan(entry({ code: null }))).toBe(null);
    expect(shownCodeSpan(entry({ presentation: 'full', code: 'a\nb', startLine: 5, endLine: 6 }))).toEqual({ start: 5, end: 6 });
    expect(shownCodeSpan(entry({ presentation: 'full', code: 'a\nb\n', startLine: 5, endLine: 6 }))).toEqual({ start: 5, end: 6 });
    expect(shownCodeSpan(entry({ presentation: 'full', code: 'a', startLine: 5, endLine: 9, shownStartLine: 5, shownEndLine: 5 }))).toEqual({ start: 5, end: 5 });
    expect(shownCodeSpan(entry({ presentation: 'full', code: 'a', startLine: 5, endLine: 9, sandwich: { partKinds: [] } }))).toBe(null);
    const noElision = { partKinds: ['signature', 'gold'], elidedHead: 0, elidedTail: 0, elisionMarkers: 0 };
    expect(shownCodeSpan(entry({ presentation: 'full', code: 'a\nb', startLine: 5, endLine: 6, expansionKind: 'sandwich', sandwich: noElision }))).toEqual({ start: 5, end: 6 });
    expect(shownCodeSpan(entry({ presentation: 'full', code: 'a\nb', startLine: 5, endLine: 6, expansionKind: 'sandwich', sandwich: { ...noElision, elidedTail: 3 } }))).toBe(null);
  });

  it("'a2' never lets a large summary span (a class) swallow its methods", () => {
    const results = [
      entry({ rank: 1, file: 'Parser.ts', startLine: 101, endLine: 3257, symbol: 'Parser', symbolType: 'class' }),
      entry({ rank: 2, file: 'Parser.ts', startLine: 3005, endLine: 3011, symbol: 'check', symbolType: 'method' }),
    ];
    expect(selectEntries(results, { dedupe: 'a2' }).entries.map((e) => e.r.rank)).toEqual([1, 2]);
    expect(selectEntries(results, { dedupe: 'v3' }).entries.map((e) => e.r.rank)).toEqual([1]);
  });

  it('never drops a non-summary entry', () => {
    const results = [
      entry({ rank: 1, presentation: 'full', code: 'x', startLine: 10, endLine: 50, symbol: 'big' }),
      entry({ rank: 2, presentation: 'preview', code: 'y', startLine: 20, endLine: 30, symbol: 'inner' }),
    ];
    expect(selectEntries(results, { dedupe: 'v3' }).entries).toHaveLength(2);
    expect(selectEntries(results, { dedupe: 'a2' }).entries).toHaveLength(2);
  });

  it('keeps one entry per file and lists the others', () => {
    const results = [
      entry({ rank: 1, file: 'a.go', symbol: 'a1', startLine: 1, endLine: 5 }),
      entry({ rank: 2, file: 'b.go', symbol: 'b1', startLine: 1, endLine: 5 }),
      entry({ rank: 3, file: 'a.go', symbol: 'a2', startLine: 120, endLine: 130 }),
      entry({ rank: 4, file: 'a.go', symbol: 'a3', startLine: 300, endLine: 310 }),
    ];
    const { entries } = selectEntries(results, { onePerFile: true });
    expect(entries.map((e) => e.r.rank)).toEqual([1, 2]);
    expect(renderAlsoInFile(entries[0].also)).toBe('also in this file: a2 (l.120-130), a3 (l.300-310)');
    expect(renderAlsoInFile(entries[1].also)).toBe('');
    expect(renderAlsoInFile([{ symbol: null, startLine: 7, endLine: 7 }])).toBe('also in this file: code (l.7)');
  });

  it('one-per-file keeps the CODE entry of a file, not an earlier summary-only one', () => {
    const results = [
      entry({ rank: 1, file: 'x.go', presentation: 'full', code: 'x', symbol: 'X' }),
      entry({ rank: 2, file: 'a.go', symbol: 'Summary', startLine: 5, endLine: 9 }),
      entry({ rank: 3, file: 'a.go', presentation: 'full', code: 'fix', symbol: 'Fix', startLine: 50, endLine: 80,
        familyManifest: { rendered: 'family: ...' } }),
    ];
    const { entries, hiddenCode } = selectEntries(results, { onePerFile: true });
    expect(entries.map((e) => e.r.rank)).toEqual([1, 3]);
    expect(entries[1].r.familyManifest.rendered).toBe('family: ...');
    expect(renderAlsoInFile(entries[1].also)).toBe('also in this file: Summary (l.5-9)');
    expect(hiddenCode).toBe(false); // only a summary entry went into the also line
  });

  it('reports when a hidden entry carried code', () => {
    const results = [
      entry({ rank: 1, file: 'a.go', presentation: 'full', code: 'a', symbol: 'A' }),
      entry({ rank: 2, file: 'a.go', presentation: 'full', code: 'b', symbol: 'B', startLine: 50, endLine: 60 }),
    ];
    expect(selectEntries(results, { onePerFile: true }).hiddenCode).toBe(true);
    expect(selectEntries(results, {}).hiddenCode).toBe(false);
    expect(selectEntries(results, { summaryCap: 5, k: 1 }).hiddenCode).toBe(true);
  });

  it('caps summary-only entries and makes k a hard cap on all entries', () => {
    const results = [
      entry({ rank: 1, presentation: 'full', code: 'x', file: 'a.go' }),
      entry({ rank: 2, file: 'b.go' }), entry({ rank: 3, file: 'c.go' }),
      entry({ rank: 4, file: 'd.go' }), entry({ rank: 5, file: 'e.go' }),
    ];
    const capped = selectEntries(results, { summaryCap: 2, k: 10 });
    expect(capped.entries.map((e) => e.r.rank)).toEqual([1, 2, 3]);
    expect(capped.hidden).toBe(2);
    const kCapped = selectEntries(results, { summaryCap: 99, k: 3 });
    expect(kCapped.entries.map((e) => e.r.rank)).toEqual([1, 2, 3]);
    expect(kCapped.hidden).toBe(2);
    expect(selectEntries(results, { summaryCap: 0, k: 10 }).entries.map((e) => e.r.rank)).toEqual([1]);
  });

  it('changes nothing without options', () => {
    const results = [entry({ rank: 1 }), entry({ rank: 2 })];
    expect(selectEntries(results, {}).entries.map((e) => e.r)).toEqual(results);
  });
});

describe('summary rendering (A2)', () => {
  it('prints the whole entry on one line', () => {
    expect(renderSummaryLine(entry({ file: 'tree.go', startLine: 135, endLine: 249, symbol: 'addRoute', symbolType: 'method' })))
      .toBe('tree.go:135-249 addRoute (method)');
    expect(renderSummaryLine(entry({ symbol: null, symbolType: null, startLine: 7, endLine: 7 }))).toBe('a.go:7');
  });

  it('knows which summary text only restates the header', () => {
    expect(summaryRestatesHeader('tree.go:135 — addRoute (method)')).toBe(true);
    expect(summaryRestatesHeader('tree.go:135 handles routes')).toBe(false);
    expect(isSummaryOnly(entry({}))).toBe(true);
    expect(isSummaryOnly(entry({ presentation: 'full', code: 'x', summary: null }))).toBe(false);
  });
});

describe('A3 already-shown ledger flow', () => {
  const body = Array.from({ length: 6 }, (_, i) => `line ${i + 10}`).join('\n');
  const result = { file: 'a.go', startLine: 10, endLine: 15, presentation: 'full', code: body, rank: 1 };

  it('collects spans with the result index and part', () => {
    const indexed = collectAgentShownSpansIndexed([{ presentation: 'summary' }, result], { projectRoot: '/repo' });
    expect(indexed).toHaveLength(1);
    expect(indexed[0].resultIndex).toBe(1);
    expect(indexed[0].part).toBe('result');
    // The original collector is unchanged and agrees on the spans.
    expect(collectAgentShownSpans([{ presentation: 'summary' }, result], { projectRoot: '/repo' }))
      .toEqual(indexed.map((x) => x.span));
  });

  it('omits code a thread already saw, and only for that thread', () => {
    const ledger = new AgentSpanLedger();
    const span = collectAgentShownSpansIndexed([result], { projectRoot: '/repo' })[0].span;
    const first = ledger.beginCall('thread-1');
    expect(ledger.decideAndObserveAtCall('thread-1', first, [span])[0].omit).toBe(false);
    const second = ledger.beginCall('thread-1');
    expect(ledger.decideAndObserveAtCall('thread-1', second, [span])[0].omit).toBe(true);
    const other = ledger.beginCall('thread-2');
    expect(ledger.decideAndObserveAtCall('thread-2', other, [span])[0].omit).toBe(false);
  });

  it('does not omit when the shown lines changed', () => {
    const ledger = new AgentSpanLedger();
    const original = collectAgentShownSpansIndexed([result], { projectRoot: '/repo' })[0].span;
    const edited = collectAgentShownSpansIndexed([{ ...result, code: body.replace('line 12', 'EDITED') }], { projectRoot: '/repo' })[0].span;
    const first = ledger.beginCall('t');
    ledger.decideAndObserveAtCall('t', first, [original]);
    const second = ledger.beginCall('t');
    expect(ledger.decideAndObserveAtCall('t', second, [edited])[0].omit).toBe(false);
  });
});

function traceResult(over = {}) {
  const item = (name, file, line, type = 'method') => ({
    name, type, file, startLine: line, summary: `${name} [${type}] ${file ?? '(external)'}${file ? `:${line}` : ''} call@${line}`, code: 'BODY',
  });
  return {
    symbol: 'target',
    target: { name: 'target', type: 'method', filePath: 'a.go', startLine: 5, endLine: 20, fanIn: 2, fanOut: 3, code: 'TARGET BODY' },
    maxDepth: 3,
    tokensUsed: 100, tokenBudget: 3000, budgetTier: 'x', budgetReason: 'y', stats: { latencyMs: 5 },
    disambiguation: [],
    answerCues: { targetTerms: ['t'], topCallers: ['c'], topCallees: [], criticalPaths: [] },
    sections: {
      callers: { total: 2, items: [item('c1', 'b.go', 7), item('c2', 'c.go', 9)] },
      callees: { total: 3, items: [item('d1', 'd.go', 1), item('ext1', null, 0, 'external'), item('ext2', null, 0, 'external')] },
      impact: {
        total: 4,
        paths: [
          { direction: 'upstream', importance: 0.5, path: 'c1 (b.go:7) -> target (a.go:5)' },
          { direction: 'downstream', importance: 0.4, path: 'target (a.go:5) -> d1 (d.go:1)' },
          { direction: 'downstream', importance: 0.3, path: 'target (a.go:5) -> ext1 (external)' },
          { direction: 'upstream', importance: 0.2, path: 'z (z.go:1) -> c1 (b.go:7) -> target (a.go:5)' },
        ],
      },
    },
    ...over,
  };
}

describe('formatTraceCompact (A4)', () => {
  it('prints rows only: no bodies, cue lines, budget or latency', () => {
    const out = formatTraceCompact(traceResult());
    expect(out).toContain('# trace target [method] a.go:5-20');
    expect(out).toContain('fan-in=2 fan-out=3');
    expect(out).toContain('c1 [method] b.go:7 call@7');
    expect(out).not.toContain('BODY');
    expect(out).not.toContain('answer cues');
    expect(out).not.toContain('latency');
    expect(out).not.toContain('importance=');
  });

  it('counts every row in the heading, as the full trace does, and names distinct callers when they differ', () => {
    const out = formatTraceCompact(traceResult());
    expect(out).toContain('## callers (2)');
    expect(out).toContain('## callees (3)');
    const withDistinct = traceResult();
    withDistinct.sections.callers.distinct = 1;
    withDistinct.sections.callees.distinct = 3;
    const text = formatTraceCompact(withDistinct);
    expect(text).toContain('## callers (2 call sites, 1 distinct caller)');
    expect(text).toContain('## callees (3)');
  });

  it('filters external callees and says how many', () => {
    const out = formatTraceCompact(traceResult(), { mode: 'callees' });
    expect(out).toContain('d1 [method] d.go:1');
    expect(out).not.toContain('ext1 [external]');
    expect(out).toContain('(+2 external/unresolved callees not listed)');
  });

  it('prints only the requested section', () => {
    const out = formatTraceCompact(traceResult(), { mode: 'callers' });
    expect(out).toContain('## callers (2)');
    expect(out).not.toContain('## callees');
    expect(out).not.toContain('## impact');
  });

  it('keeps every impact path when impact is asked for, minus external ones', () => {
    const out = formatTraceCompact(traceResult(), { mode: 'impact' });
    expect(out).toContain('## impact paths (3');
    expect(out).not.toContain('(external)');
  });

  it('drops one-hop paths that a caller / callee row already carries (no mode word)', () => {
    const out = formatTraceCompact(traceResult());
    expect(out).toContain('z (z.go:1) -> c1 (b.go:7) -> target (a.go:5)');
    expect(out).not.toMatch(/\d\. upstream c1 \(b\.go:7\) -> target/);
    expect(out).not.toMatch(/\d\. downstream target \(a\.go:5\) -> d1/);
  });

  it('adds notes and keeps the not-found sentence', () => {
    expect(formatTraceCompact(traceResult(), { notes: ['note: fallback'] })).toContain('note: fallback');
    expect(formatTraceCompact({ symbol: 'nope', target: null })).toBe('No indexed symbol found for "nope".');
  });
});

describe('ss-grep fixes (A5, B7)', () => {
  it('recognises a regex parse error and nothing else', () => {
    expect(isRegexParseError(new Error('ripgrep failed (code 2): rg: regex parse error:\n    (?:func()\n error: unclosed group'))).toBe(true);
    expect(isRegexParseError(new Error('regex parse error: repetition operator missing expression'))).toBe(true);
    expect(isRegexParseError(new Error('ECONNREFUSED'))).toBe(false);
    expect(isRegexParseError(new Error('database is locked'))).toBe(false);
  });

  const hit = (file, line, matchText = 'Context') => ({ file, line, matchText });

  it('lists source hits before test hits and keeps the order inside each class', () => {
    const ordered = orderSourceBeforeTests([hit('a_test.go', 1), hit('b.go', 2), hit('tests/c.py', 3), hit('d.go', 4)]);
    expect(ordered.map((m) => m.file)).toEqual(['b.go', 'd.go', 'a_test.go', 'tests/c.py']);
    // Everything fits in k: a pure reorder, no quota.
    expect(orderSourceBeforeTests([hit('a_test.go', 1), hit('b.go', 2)], { k: 5 }).map((m) => m.file)).toEqual(['b.go', 'a_test.go']);
  });

  it('moves a quota of test files into the first k files when there are more files than k', () => {
    const matches = [hit('t1_test.go', 1), hit('t2_test.go', 1),
      ...Array.from({ length: 10 }, (_, i) => hit(`s${i}.go`, 1))];
    const files = [...new Set(orderSourceBeforeTests(matches, { k: 10 }).map((m) => m.file))];
    // round(10 * 0.3) = 3, capped by the 2 test files: 8 source files, then both tests.
    expect(files.slice(0, 10)).toEqual(['s0.go', 's1.go', 's2.go', 's3.go', 's4.go', 's5.go', 's6.go', 's7.go', 't1_test.go', 't2_test.go']);
    expect(files.slice(10)).toEqual(['s8.go', 's9.go']);
  });

  it('detects a repeated matched-text column', () => {
    expect(matchTextIsRepeated([hit('a', 1), hit('b', 2)])).toBe(true);
    expect(matchTextIsRepeated([hit('a', 1, 'x'), hit('b', 2, 'y')])).toBe(false);
    expect(matchTextIsRepeated([hit('a', 1)])).toBe(false);
  });

  it('renderGrepBody is unchanged without options and drops the repeated text with them', () => {
    const kept = [hit('a.go', 1), hit('a.go', 5), hit('b.go', 9)];
    const summary = { files: [{ file: 'a.go', total: 4, kept: 2 }, { file: 'b.go', total: 1, kept: 1 }], hiddenFileCount: 0, hiddenMatchCount: 0, hiddenSample: [] };
    expect(renderGrepBody(kept, summary, 10).lines).toEqual([
      'a.go:1: Context', 'a.go:5: Context (+2 more in this file)', 'b.go:9: Context',
    ]);
    expect(renderGrepBody(kept, summary, 10, undefined)).toEqual(renderGrepBody(kept, summary, 10));
    expect(renderGrepBody(kept, summary, 10, { dropRepeatedText: true }).lines).toEqual([
      'a.go:1', 'a.go:5 (+2 more in this file)', 'b.go:9',
    ]);
    const varied = [hit('a.go', 1, 'x'), hit('b.go', 9, 'y')];
    expect(renderGrepBody(varied, summary, 10, { dropRepeatedText: true }).lines)
      .toEqual(renderGrepBody(varied, summary, 10).lines);
  });

  it('flood mode lists up to 3 hit lines per file, source first, tests kept when they fit', () => {
    const files = [
      { file: 'a_test.go', total: 40 }, { file: 'a.go', total: 3 }, { file: 'b.go', total: 9 }, { file: 'tests/x.py', total: 2 },
    ];
    const lines = renderGrepLineLists(files, new Map([
      ['a.go', [11, 12, 13]], ['b.go', [4, 48, 55, 75]], ['a_test.go', [1, 2, 3, 4]], ['tests/x.py', [7, 9]],
    ]), 10);
    expect(lines).toEqual([
      'b.go: lines 4, 48, 55 (+6 more)',
      'a.go: lines 11, 12, 13',
      'a_test.go: lines 1, 2, 3 (+37 more)',
      'tests/x.py: lines 7, 9',
    ]);
    expect(GREP_COUNTS_THRESHOLD).toBe(50);
  });

  it('flood mode keeps a test-file quota when there are more files than k', () => {
    const files = [
      ...Array.from({ length: 12 }, (_, i) => ({ file: `src/s${i}.go`, total: 10 })),
      { file: 'a_test.go', total: 30 }, { file: 'b_test.go', total: 5 }, { file: 'c_test.go', total: 2 },
    ];
    const lines = renderGrepLineLists(files, new Map(), 10);
    const rows = lines.filter((l) => !l.startsWith('#'));
    expect(rows).toHaveLength(10);
    expect(rows.filter((l) => l.includes('_test.go'))).toEqual(['a_test.go (30 matches)', 'b_test.go (5 matches)', 'c_test.go (2 matches)']);
    expect(lines).toContain('# +5 more non-test file(s) with 50 match(es): src/s5.go, src/s6.go, src/s7.go, ...');
  });
});
