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
  grepHitText,
  isRegexParseError,
  isSummaryOnly,
  isTestLikePath,
  matchTextIsRepeated,
  orderSourceBeforeTests,
  compactOutputDefault,
  readFixFlags,
  renderAlsoInFile,
  renderGrepLineLists,
  renderSummaryRow,
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
  dropSufficiency: false, summaryCap: null, onePerFile: false, grepOrder: false, grepAlloc: false,
  grepFullLine: false,
  grepLines: false, grepAllocRule: null, grepWeight: null, semanticRanges: false, semanticPick: false,
  searchFirstUnit: null, traceModeBudget: false,
};

describe('readFixFlags: product default (Bundle A on)', () => {
  it('turns on A1/A2/A7 (compact), A4 and A5 with an empty environment', () => {
    expect(readFixFlags({})).toEqual({
      ...ALL_OFF, compact: true, traceCompact: true, grepRetry: true, grepAlloc: true, grepFullLine: true,
      grepLines: true, grepAllocRule: 'guarantee', grepWeight: 'sat2', semanticRanges: true, traceModeBudget: true,
    });
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
    expect(readFixFlags(OFF)).toEqual(ALL_OFF);
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

  it('SS_FIX_GREP_ALLOC: on by default, follows SS_FIX_A / the product opt-out, its own 0 or 1 wins', () => {
    expect(readFixFlags({}).grepAlloc).toBe(true);
    for (const v of ['0', 'false', 'off', 'no']) expect(readFixFlags({ SS_FIX_GREP_ALLOC: v }).grepAlloc).toBe(false);
    expect(readFixFlags({ SS_FIX_GREP_ALLOC: 'maybe' }).grepAlloc).toBe(true);
    expect(readFixFlags(OFF).grepAlloc).toBe(false);
    expect(readFixFlags({ SWEET_SEARCH_COMPACT_OUTPUT: '0' }).grepAlloc).toBe(false);
    expect(readFixFlags({ ...OFF, SS_FIX_GREP_ALLOC: '1' })).toMatchObject({ compact: false, grepAlloc: true });
    // it never turns another switch on or off
    expect(readFixFlags({ SS_FIX_GREP_ALLOC: '0' })).toEqual({ ...readFixFlags({}), grepAlloc: false });
  });

  it('SS_FIX_GREP_FULLLINE: on by default, follows SS_FIX_A / the product opt-out, its own 0 or 1 wins', () => {
    expect(readFixFlags({}).grepFullLine).toBe(true);
    for (const v of ['0', 'false', 'off', 'no']) expect(readFixFlags({ SS_FIX_GREP_FULLLINE: v }).grepFullLine).toBe(false);
    expect(readFixFlags(OFF).grepFullLine).toBe(false);
    expect(readFixFlags({ SWEET_SEARCH_COMPACT_OUTPUT: '0' }).grepFullLine).toBe(false);
    expect(readFixFlags({ ...OFF, SS_FIX_GREP_FULLLINE: '1' })).toMatchObject({ compact: false, grepFullLine: true });
    expect(readFixFlags({ SS_FIX_GREP_FULLLINE: '0' })).toEqual({ ...readFixFlags({}), grepFullLine: false });
  });

  it('the five 2026-10-03 arms are ON in the product default; PICK and FIRST_UNIT stay off', () => {
    expect(readFixFlags({})).toMatchObject({
      grepLines: true, grepAllocRule: 'guarantee', grepWeight: 'sat2', semanticRanges: true, traceModeBudget: true,
      semanticPick: false, searchFirstUnit: null,
    });
  });

  it('each default-ON arm has a legacy value, and SS_FIX_A=0 / the product opt-out turn them all off', () => {
    expect(readFixFlags({ SS_FIX_GREP_LINES: '0' }).grepLines).toBe(false);
    expect(readFixFlags({ SS_FIX_GREP_ALLOC_RULE: 'sl' }).grepAllocRule).toBeNull();
    expect(readFixFlags({ SS_FIX_GREP_ALLOC_RULE: '0' }).grepAllocRule).toBeNull();
    expect(readFixFlags({ SS_FIX_GREP_WEIGHT: 'sqrt' }).grepWeight).toBeNull();
    expect(readFixFlags({ SS_FIX_GREP_WEIGHT: 'off' }).grepWeight).toBeNull();
    expect(readFixFlags({ SS_FIX_SEMANTIC_RANGES: '0' }).semanticRanges).toBe(false);
    expect(readFixFlags({ SS_FIX_TRACE_MODE_BUDGET: '0' }).traceModeBudget).toBe(false);
    for (const env of [{ SS_FIX_A: '0' }, { SWEET_SEARCH_COMPACT_OUTPUT: '0' }]) {
      expect(readFixFlags(env)).toMatchObject({
        grepLines: false, grepAllocRule: null, grepWeight: null, semanticRanges: false, traceModeBudget: false,
      });
    }
    // An explicit value wins over the umbrella, as for every sub-switch.
    expect(readFixFlags({ SS_FIX_A: '0', SS_FIX_GREP_WEIGHT: 'sat2', SS_FIX_GREP_ALLOC_RULE: 'guarantee' }))
      .toMatchObject({ grepWeight: 'sat2', grepAllocRule: 'guarantee' });
  });

  it('SS_FIX_GREP_ALLOC_RULE / SS_FIX_GREP_WEIGHT: named values; anything else keeps the default', () => {
    expect(readFixFlags({ SS_FIX_GREP_ALLOC_RULE: 'guarantee' }).grepAllocRule).toBe('guarantee');
    expect(readFixFlags({ SS_FIX_GREP_ALLOC_RULE: ' HH ' }).grepAllocRule).toBe('hh');
    expect(readFixFlags({ SS_FIX_GREP_ALLOC_RULE: 'huntington-hill' }).grepAllocRule).toBe('hh');
    for (const v of ['1', 'dhondt', '']) expect(readFixFlags({ SS_FIX_GREP_ALLOC_RULE: v }).grepAllocRule).toBe('guarantee');
    for (const v of ['1', 'dhondt', '']) expect(readFixFlags({ SS_FIX_A: '0', SS_FIX_GREP_ALLOC_RULE: v }).grepAllocRule).toBeNull();
    expect(readFixFlags({ SS_FIX_GREP_WEIGHT: 'sat2' }).grepWeight).toBe('sat2');
    for (const v of ['sat4', '1', '']) expect(readFixFlags({ SS_FIX_GREP_WEIGHT: v }).grepWeight).toBe('sat2');
    for (const v of ['sat4', '1', '']) expect(readFixFlags({ SS_FIX_A: '0', SS_FIX_GREP_WEIGHT: v }).grepWeight).toBeNull();
    expect(readFixFlags({ SS_FIX_A: '0', SS_FIX_GREP_LINES: '1' }).grepLines).toBe(true);
  });

  it('SS_FIX_SEARCH_FIRST_UNIT: calibrated or all, else off', () => {
    expect(readFixFlags({}).searchFirstUnit).toBeNull();
    expect(readFixFlags({ SS_FIX_SEARCH_FIRST_UNIT: 'calibrated' }).searchFirstUnit).toBe('calibrated');
    expect(readFixFlags({ SS_FIX_SEARCH_FIRST_UNIT: ' ALL ' }).searchFirstUnit).toBe('all');
    for (const v of ['1', 'on', 'ranks']) expect(readFixFlags({ SS_FIX_SEARCH_FIRST_UNIT: v }).searchFirstUnit).toBeNull();
  });

  it('SS_FIX_SEMANTIC_PICK implies SS_FIX_SEMANTIC_RANGES; RANGES alone does not imply PICK', () => {
    expect(readFixFlags({ SS_FIX_SEMANTIC_PICK: '1' })).toMatchObject({ semanticPick: true, semanticRanges: true });
    expect(readFixFlags({ SS_FIX_SEMANTIC_RANGES: '1' })).toMatchObject({ semanticPick: false, semanticRanges: true });
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

  it('the folded one-pass form answers exactly as the seven separate rules did', () => {
    // The rules as they were written before the fold (2026-10-02), applied one by one.
    const dir = /(^|\/)(__tests__|__mocks__|tests?|specs?|testdata|test_data|fixtures?|e2e|mocks?|testing|integration[-_]tests?)(\/|$)/i;
    const files = [/_test\.[a-z0-9]+$/i, /(^|\/)test_[^/]+\.[a-z0-9]+$/i, /[-_.](test|spec)\.[cm]?[jt]sx?$/i, /_spec\.[a-z0-9]+$/i,
      /(^|\/)[^/]*Tests?\.(java|kt|kts|scala|cs|swift|m|mm|php)$/, /(^|\/)conftest\.py$/i];
    const seven = (f) => {
      const p = String(f || '').replace(/\\/g, '/');
      return !!p && (dir.test(p) || files.some((re) => re.test(p)));
    };
    const parts = ['src', 'tests', 'Test', 'spec', 'Specs', 'fixture', 'mocks', 'e2e', 'testing', 'lib', 'test_data',
      'integration_tests', '__tests__', '__mocks__', 'TESTDATA', 'contest', 'latest'];
    const names = ['a.go', 'a_test.go', 'A_TEST.GO', 'test_a.py', 'a.test.ts', 'a-spec.mjs', 'a.spec.cjs', 'a_spec.rb',
      'FooTest.java', 'FooTests.swift', 'Footest.java', 'FOOTEST.JAVA', 'conftest.py', 'CONFTEST.PY', 'Testament.java',
      'test', 'tests', 'spec', 'x.test', 'test_.py', 'mock'];
    let seed = 13;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 5000; i++) {
      const segs = [];
      for (let d = Math.floor(r() * 4); d > 0; d--) segs.push(parts[Math.floor(r() * parts.length)]);
      const p = [...segs, names[Math.floor(r() * names.length)]].join(r() < 0.1 ? '\\' : '/');
      expect(isTestLikePath(p), p).toBe(seven(p));
    }
    for (const p of ['', null, undefined]) expect(isTestLikePath(p)).toBe(false);
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
  it('prints the row: range, then every name with its kind word', () => {
    expect(renderSummaryRow(entry({ file: 'tree.go', startLine: 135, endLine: 249, symbol: 'addRoute', symbolType: 'method' })))
      .toBe('135-249 method addRoute');
    expect(renderSummaryRow(entry({ symbol: 'Engine', symbolType: 'struct', startLine: 10, endLine: 40 }))).toBe('10-40 struct Engine');
    expect(renderSummaryRow(entry({ symbol: 'Opts', symbolType: 'typeAlias', startLine: 1, endLine: 2 }))).toBe('1-2 type Opts');
    expect(renderSummaryRow(entry({ symbol: null, symbolType: null, startLine: 7, endLine: 7 }))).toBe('7');
    // The chunker's placeholder name for an unnamed chunk prints no name.
    expect(renderSummaryRow(entry({ symbol: 'unknown', symbolType: 'code', startLine: 1, endLine: 70 }))).toBe('1-70');
    expect(renderSummaryRow(entry({ symbol: 'a', symbols: ['a', 'b', 'c', 'd', 'e'], startLine: 1, endLine: 9, stale: true })))
      .toBe('1-9 function a, b, c +2 more STALE');
    const info = ['available', 'wait_until_available', 'owned_connection', 'preconnect'].map((name, i) => ({ name, type: 'method', startLine: 240 + i * 5, endLine: 242 + i * 5 }));
    expect(renderSummaryRow(entry({ symbol: 'available', symbolInfo: info, startLine: 236, endLine: 293 }))).toBe('236-293 methods available, wait_until_available, owned_connection +1 more');
    // A name whose code printed code shows is not repeated (sequel wait_until_available).
    expect(renderSummaryRow(entry({ symbol: 'available', symbolInfo: info, startLine: 236, endLine: 293 }), [{ start: 245, end: 247 }]))
      .toBe('236-293 methods available, owned_connection, preconnect');
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
  it('prints rows only: no bodies, cue lines, budget, latency or fan counts', () => {
    const out = formatTraceCompact(traceResult());
    expect(out.split('\n')[0]).toBe('# a.go:5-20');
    expect(out).not.toContain('fan-in');
    expect(out).toContain('b.go\nmethod c1 7');
    expect(out).not.toContain('[method]');
    expect(out).not.toContain('BODY');
    expect(out).not.toContain('answer cues');
    expect(out).not.toContain('latency');
    expect(out).not.toContain('importance=');
  });

  it('header: the traced definition, `# lines a-b` when --in named its file', () => {
    expect(formatTraceCompact(traceResult(), { inFile: 'a.go' }).split('\n')[0]).toBe('# lines 5-20');
    expect(formatTraceCompact(traceResult(), { inFile: 'other.go' }).split('\n')[0]).toBe('# a.go:5-20');
  });

  it('path rule: the --in file typed in full prints as its file name in rows and impact paths', () => {
    const r = traceResult({
      target: { name: 'target', type: 'method', filePath: 'pkg/a.go', startLine: 5, endLine: 20, fanIn: 2, fanOut: 3 },
    });
    r.sections.callers.items = [{ name: 'c1', type: 'method', file: 'pkg/a.go', startLine: 30 }, { name: 'c2', type: 'method', file: 'pkg/x/c.go', startLine: 9 }];
    r.sections.impact.paths = [{ direction: 'upstream', path: 'z (pkg/a.go:40) -> c2 (pkg/x/c.go:9) -> target (pkg/a.go:5)' }];
    const out = formatTraceCompact(r, { inFile: 'pkg/a.go', mode: null });
    expect(out.split('\n')[0]).toBe('# lines 5-20');
    expect(out).toContain('\na.go\nmethod c1 30\npkg/x/c.go\n');
    expect(out).toContain('z a.go:40');
    expect(out).not.toContain('pkg/a.go');
  });

  it('groups rows by file (path once), non-test files first; every row reads kind, name, definition lines, then @ the call lines', () => {
    const r = traceResult();
    r.sections.callers.items = [
      { name: 't1', type: 'function', file: 'x_test.go', startLine: 3, contextLines: [4] },
      { name: 'c1', type: 'method', file: 'b.go', startLine: 7, contextLines: [8, 12] },
      { name: 'c3', type: 'method', file: 'b.go', startLine: 20, contextLines: [21] },
    ];
    const out = formatTraceCompact(r, { mode: 'callers' });
    expect(out).toBe('# a.go:5-20\nb.go\nmethod c1 7 @8,12\nmethod c3 20 @21\nx_test.go\nfunction t1 3 @4');
  });

  it('a callee row has the same shape as a caller row; non-call rows name their relationship; dispatch rows name the method', () => {
    const r = traceResult();
    r.sections.callers.items = [
      { name: 'Impl', type: 'class', file: 'i.go', startLine: 2, contextLines: [2], relationship: 'extends' },
      { name: 'run', type: 'function', file: 'r.go', startLine: 1, contextLines: [5], relationship: 'calls', via: 'Base.target' },
    ];
    const out = formatTraceCompact(r);
    expect(out).toContain('i.go\nclass Impl 2 (extends)\n');
    expect(out).toContain('r.go\nfunction run 1 @5 via Base.target');
    expect(out).toContain('## callees\nd.go\nmethod d1 1');
    const withLines = traceResult();
    withLines.sections.callees.items[0].contextLines = [9, 14];
    expect(formatTraceCompact(withLines, { mode: 'callees' })).toContain('d.go\nmethod d1 1 @9,14');
  });

  it('counts every row it leaves out: unresolved callees and rows over the cap', () => {
    const out = formatTraceCompact(traceResult(), { mode: 'callees' });
    expect(out).toContain('d.go\nmethod d1 1');
    expect(out).not.toContain('ext1');
    expect(out).toContain('+2 unresolved calls');
    const r = traceResult();
    r.sections.callers.hidden = 4;
    r.sections.callees.external = 1;
    const text = formatTraceCompact(r);
    expect(text).toContain('+4 more (ss-grep the name for every site)');
    expect(text).toContain('+1 unresolved call\n');
  });

  it('prints only the requested section, without a heading', () => {
    const out = formatTraceCompact(traceResult(), { mode: 'callers' });
    expect(out).not.toContain('## ');
    expect(out).not.toContain('d1');
    expect(out).toContain('c.go\nmethod c2 9');
  });

  it('says so when a section has no row in the repository', () => {
    const r = traceResult();
    r.sections.callees.items = r.sections.callees.items.filter((i) => i.file === null);
    expect(formatTraceCompact(r, { mode: 'callees' })).toBe('# a.go:5-20\n(no callees in the repository)\n+2 unresolved calls');
  });

  it('impact asked for: an upstream and a downstream tree, the target never repeated, no external path', () => {
    const out = formatTraceCompact(traceResult(), { mode: 'impact' });
    expect(out).toBe('# a.go:5-20\n## upstream\nc1 b.go:7\n  z z.go:1\n## downstream\nd1 d.go:1');
    expect(out).not.toContain('external');
    expect(out).not.toContain('target');
  });

  it('no mode word: a one-hop path to a printed row is dropped; a printed node keeps only its name', () => {
    const out = formatTraceCompact(traceResult());
    expect(out).toContain('## upstream\nc1\n  z z.go:1');
    expect(out).not.toContain('## downstream');
  });

  it('tree nodes: kind words; a node printed above (row or tree) prints its name only; a printed file prints short', () => {
    const r = traceResult();
    r.sections.callees.items = [
      { name: 'State', type: 'function', file: 'pkg/s.go', startLine: 67, endLine: 69, contextLines: [9] },
      { name: 'fp', type: 'function', file: 'pkg/l.go', startLine: 30, endLine: 40, contextLines: [8] },
    ];
    const n = (name, type, file, line) => ({ name, type, file, line });
    const T = n('target', 'method', 'a.go', 5);
    r.sections.impact.paths = [
      { direction: 'downstream', nodes: [T, n('fp', 'function', 'pkg/l.go', 30), n('State', 'function', 'pkg/s.go', 67)] },
      { direction: 'downstream', nodes: [T, n('fp', 'function', 'pkg/l.go', 30), n('walk', 'method', 'pkg/l.go', 90)] },
      { direction: 'downstream', nodes: [T, n('fp', 'function', 'pkg/l.go', 30), n('Fatalf', 'function', 'x/e.go', 4)] },
      { direction: 'upstream', nodes: [n('main', 'function', 'cmd/m.go', 3), n('Fatalf', 'function', 'x/e.go', 4), T] },
    ];
    const out = formatTraceCompact(r, { mode: 'impact' });
    expect(out).toBe('# a.go:5-20\n## upstream\nfunction Fatalf x/e.go:4\n  function main cmd/m.go:3\n## downstream\nfunction fp pkg/l.go:30\n  function State pkg/s.go:67\n  method walk l.go:90\n  Fatalf');
    const both = formatTraceCompact(r);
    expect(both).toContain('## callees\npkg/s.go\nfunction State 67-69 @9\npkg/l.go\nfunction fp 30-40 @8');
    expect(both).toContain('## downstream\nfp\n  State\n  method walk l.go:90\n  Fatalf');
  });

  it('counts impact paths that did not fit', () => {
    const r = traceResult();
    r.sections.impact.hidden = 3;
    expect(formatTraceCompact(r, { mode: 'impact' })).toContain('+3 more paths');
  });

  it('other definitions: Owner.name and where, a line only in the traced file, and how to pick one', () => {
    const r = traceResult({ disambiguation: [
      { name: 'target', owner: 'Other', file: 'a.go', startLine: 40 },
      { name: 'target', owner: null, file: 'a_test.go', startLine: 3 },
    ] });
    expect(formatTraceCompact(r)).toContain('# other definitions (pick with --in <file> or Owner.name): Other.target 40, a_test.go:3');
    const same = traceResult({ disambiguation: [{ name: 'target', owner: 'Other', file: 'a.go', startLine: 40 }] });
    expect(formatTraceCompact(same)).toContain('# other definitions (pick with Owner.name): Other.target 40');
  });

  it('adds notes and keeps the not-found sentence', () => {
    expect(formatTraceCompact(traceResult(), { notes: ['# not defined in x.go; traced the definition above'] }))
      .toContain('# a.go:5-20\n# not defined in x.go; traced the definition above');
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

  // SS_FIX_GREP_FULLLINE: matchText and content differ here, unlike the fixtures above.
  const full = (file, line, content, matchText, column) => ({ file, line, content, matchText, column });

  it('grepHitText: a match ending in whitespace or \\r stays inside the window (review d2ec22bd)', () => {
    const pad = 'x'.repeat(150);
    const out = grepHitText({ matchText: 'target_fn(a):\r', column: 151, content: `${pad}target_fn(a):` }, { fullLine: true });
    expect(out).toContain('target_fn(a):');
    expect(out.length).toBe(140);
  });

  it('grepHitText: no false left ellipsis at column 1; never splits a surrogate pair', () => {
    expect(grepHitText({ matchText: 'A'.repeat(200), column: 1, content: 'A'.repeat(300) }, { fullLine: true }).startsWith('…')).toBe(false);
    const e = '\u{1F600}'.repeat(100);
    const out = grepHitText({ matchText: 'MATCH', column: e.length + 1, content: `${e}MATCH${e}` }, { fullLine: true });
    expect(out).toContain('MATCH');
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)).toBe(false);
  });

  it('grepHitText: the full line, whitespace collapsed; off = the matched text, as before', () => {
    const m = full('a.c', 240, '\t\tsqlite3_commit_hook(db,   commitHook,\tctx);   ', 'sqlite3_commit_hook', 3);
    expect(grepHitText(m, { fullLine: true })).toBe('sqlite3_commit_hook(db, commitHook, ctx);');
    expect(grepHitText(m)).toBe('sqlite3_commit_hook');
    expect(grepHitText(m, { fullLine: false })).toBe('sqlite3_commit_hook');
    // no line text: the matched text
    expect(grepHitText({ matchText: ' x  y ' }, { fullLine: true })).toBe('x y');
    expect(grepHitText({ matchText: 'x', content: '   ' }, { fullLine: true })).toBe('x');
  });

  it('grepHitText: a long line shows a 140-char window that contains the match', () => {
    const head = 'a'.repeat(200);
    const m = full('a.js', 1, `    const x = ${head} + NEEDLE_HERE + ${'b'.repeat(200)};`, 'NEEDLE_HERE');
    const out = grepHitText(m, { fullLine: true });
    expect(out.length).toBe(140);
    expect(out).toContain('NEEDLE_HERE');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    // 40 chars of the line before the match
    expect(out.indexOf('NEEDLE_HERE')).toBe(41);
    // a match near the start keeps the head of the line
    const early = full('a.js', 1, `NEEDLE ${'c'.repeat(300)}`, 'NEEDLE', 1);
    expect(grepHitText(early, { fullLine: true })).toBe(`NEEDLE ${'c'.repeat(132)}…`);
    // a match at the end: the tail of the line, cut on the left only
    const late = full('a.js', 1, `${'d'.repeat(300)} NEEDLE;`, 'NEEDLE');
    const tail = grepHitText(late, { fullLine: true });
    expect(tail).toBe(`…${'d'.repeat(131)} NEEDLE;`);
    expect(tail.length).toBe(140);
    // the column picks the hit when the text occurs twice
    const twice = full('a.js', 1, `x ${'e'.repeat(150)} x ${'f'.repeat(300)}`, 'x', 154);
    expect(grepHitText(twice, { fullLine: true })).toBe(`…${'e'.repeat(39)} x ${'f'.repeat(96)}…`);
    // indentation collapse does not move the window off the match
    const tabs = full('a.py', 1, `\t\t\t${'g'.repeat(180)}\t\tTARGET\t${'h'.repeat(50)}`, 'TARGET');
    expect(grepHitText(tabs, { fullLine: true })).toContain('TARGET');
    expect(grepHitText(tabs, { fullLine: true }).length).toBeLessThanOrEqual(140);
  });

  it('renderGrepBody fullLine prints the line; the repeated-text drop compares the shown lines', () => {
    const summary = { files: [{ file: 'a.go', total: 2, kept: 2 }, { file: 'b.go', total: 1, kept: 1 }], hiddenFileCount: 0, hiddenMatchCount: 0, hiddenSample: [] };
    const kept = [
      full('a.go', 3, '\tif err := Export(ctx); err != nil {', 'Export'),
      full('a.go', 9, '// Export writes the dump', 'Export'),
      full('b.go', 1, 'func Export(ctx context.Context) error {', 'Export'),
    ];
    for (const alloc of [undefined, 'weight']) {
      const opts = alloc ? { alloc, fullLine: true } : { fullLine: true };
      expect(renderGrepBody(kept, summary, 10, opts).lines.sort()).toEqual([
        'a.go:3: if err := Export(ctx); err != nil {', 'a.go:9: // Export writes the dump', 'b.go:1: func Export(ctx context.Context) error {',
      ]);
      // same matched text, different lines: the text stays
      expect(renderGrepBody(kept, summary, 10, { ...opts, dropRepeatedText: true }).lines)
        .toEqual(renderGrepBody(kept, summary, 10, opts).lines);
      expect(matchTextIsRepeated(kept)).toBe(true);
      expect(matchTextIsRepeated(kept, { fullLine: true })).toBe(false);
      // every shown full line identical: the text drops
      const same = kept.map((m) => ({ ...m, content: '  return Export(ctx)' }));
      expect(matchTextIsRepeated(same, { fullLine: true })).toBe(true);
      expect(renderGrepBody(same, summary, 10, { ...opts, dropRepeatedText: true }).lines.sort())
        .toEqual(['a.go:3', 'a.go:9', 'b.go:1']);
    }
    // without fullLine: the matched text, byte for byte the previous output
    expect(renderGrepBody(kept, summary, 10).lines).toEqual(['a.go:3: Export', 'a.go:9: Export', 'b.go:1: Export']);
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
