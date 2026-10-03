/**
 * ss-* output helpers (core/search/agent-output-fixes.js): the switches still under test
 * (SS_FIX_GREP_FULLLINE, SS_VARIANT_GREP_BROAD), entry selection (A2), summary lines, the compact
 * trace (A4), the regex repair (A5) and the grep hit text. The wiring is in
 * agent-output-fixes-wiring.test.js.
 */
import { describe, expect, it } from 'vitest';

import {
  formatTraceCompact,
  grepBroadHitMax,
  grepHitText,
  isRegexParseError,
  isSummaryOnly,
  isTestLikePath,
  readFixFlags,
  renderSummaryLine,
  selectEntries,
  shownCodeSpan,
  summaryRestatesHeader,
} from '../../core/search/agent-output-fixes.js';
import { renderGrepBody } from '../../core/search/grep-output-shaping.js';

describe('readFixFlags', () => {
  it('SS_FIX_GREP_FULLLINE: on by default; an explicit off value turns it off', () => {
    expect(readFixFlags({})).toEqual({ grepFullLine: true });
    for (const v of ['0', 'false', 'off', 'no', ' OFF ']) expect(readFixFlags({ SS_FIX_GREP_FULLLINE: v }).grepFullLine).toBe(false);
    for (const v of ['1', 'yes', 'maybe', '']) expect(readFixFlags({ SS_FIX_GREP_FULLLINE: v }).grepFullLine).toBe(true);
  });

  it('SS_VARIANT_GREP_BROAD=<min hits>:<chars>; malformed = off', () => {
    expect(readFixFlags({ SS_VARIANT_GREP_BROAD: '100:60' }).grepBroad).toEqual({ minHits: 100, chars: 60 });
    for (const v of ['', '100', '0:60', '100:10', 'a:b']) expect(readFixFlags({ SS_VARIANT_GREP_BROAD: v }).grepBroad).toBeUndefined();
    const flags = readFixFlags({ SS_VARIANT_GREP_BROAD: '100:60' });
    expect(grepBroadHitMax(flags, 99)).toBeUndefined();
    expect(grepBroadHitMax(flags, 100)).toBe(60);
    expect(grepBroadHitMax(readFixFlags({}), 1000)).toBeUndefined();
  });

  it('the deleted switches have no effect', () => {
    const deleted = {
      SS_FIX_A: '0', SWEET_SEARCH_COMPACT_OUTPUT: '0', SS_FIX_TRACE_COMPACT: '0', SS_FIX_GREP_RETRY: '0',
      SS_FIX_GREP_ALLOC: '0', SS_FIX_GREP_LINES: '0', SS_FIX_GREP_WEIGHT: 'sqrt', SS_FIX_GREP_ALLOC_RULE: 'sl',
      SS_FIX_SEMANTIC_RANGES: '0', SS_FIX_TRACE_MODE_BUDGET: '0', SS_FIX_ALREADY_SHOWN: '1',
      SS_FIX_DROP_SUFFICIENCY: '1', SS_FIX_SUMMARY_CAP: '2', SS_FIX_ONE_PER_FILE: '1', SS_FIX_GREP_ORDER: '1',
      SS_FIX_SEARCH_FIRST_UNIT: 'all', SS_FIX_SEMANTIC_PICK: '1',
    };
    expect(readFixFlags(deleted)).toEqual(readFixFlags({}));
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

describe('selectEntries (A2)', () => {
  it('drops a summary only under an earlier CODE entry or an identical span', () => {
    const results = [
      entry({ rank: 1, presentation: 'full', code: 'x', startLine: 10, endLine: 50, shownStartLine: 10, shownEndLine: 50, symbol: 'big' }),
      entry({ rank: 2, startLine: 20, endLine: 30, symbol: 'inner' }),     // inside shown code: dropped
      entry({ rank: 3, startLine: 60, endLine: 70, symbol: 'other' }),
      entry({ rank: 4, startLine: 80, endLine: 90, symbol: 'other' }),     // same symbol, other span: KEPT
      entry({ rank: 5, startLine: 60, endLine: 70, symbol: 'other' }),     // identical span: dropped
    ];
    expect(selectEntries(results).entries.map((e) => e.r.rank)).toEqual([1, 3, 4]);
  });

  it('covers a summary only with the lines a code block SHOWS (cut, sandwich, preview)', () => {
    const inner = entry({ rank: 2, startLine: 20, endLine: 30, symbol: 'inner' });
    const keptUnder = (codeEntry) => selectEntries([codeEntry, inner]).entries.map((e) => e.r.rank);
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
    expect(selectEntries([entry({ ...big, code: 'x', expansionKind: 'sandwich' }), entry({ rank: 2, startLine: 10, endLine: 50 })])
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

  it('never lets a large summary span (a class) swallow its methods', () => {
    const results = [
      entry({ rank: 1, file: 'Parser.ts', startLine: 101, endLine: 3257, symbol: 'Parser', symbolType: 'class' }),
      entry({ rank: 2, file: 'Parser.ts', startLine: 3005, endLine: 3011, symbol: 'check', symbolType: 'method' }),
    ];
    expect(selectEntries(results).entries.map((e) => e.r.rank)).toEqual([1, 2]);
  });

  it('never drops a non-summary entry', () => {
    const results = [
      entry({ rank: 1, presentation: 'full', code: 'x', startLine: 10, endLine: 50, symbol: 'big' }),
      entry({ rank: 2, presentation: 'preview', code: 'y', startLine: 20, endLine: 30, symbol: 'inner' }),
    ];
    expect(selectEntries(results).entries).toHaveLength(2);
  });

  it('reports when a dropped entry carried a continuation with code', () => {
    const results = [
      entry({ rank: 1, presentation: 'full', code: 'x', startLine: 10, endLine: 50, shownStartLine: 10, shownEndLine: 50 }),
      entry({ rank: 2, startLine: 20, endLine: 30, continuation: { kind: 'symbol', code: 'c' } }),
    ];
    expect(selectEntries(results).hiddenCode).toBe(true);
    expect(selectEntries([entry({ rank: 1 }), entry({ rank: 2, file: 'b.go' })]).hiddenCode).toBe(false);
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

describe('ss-grep fixes (A5, hit text)', () => {
  it('recognises a regex parse error and nothing else', () => {
    expect(isRegexParseError(new Error('ripgrep failed (code 2): rg: regex parse error:\n    (?:func()\n error: unclosed group'))).toBe(true);
    expect(isRegexParseError(new Error('regex parse error: repetition operator missing expression'))).toBe(true);
    expect(isRegexParseError(new Error('ECONNREFUSED'))).toBe(false);
    expect(isRegexParseError(new Error('database is locked'))).toBe(false);
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

  it('renderGrepBody fullLine prints the line; without it the matched text', () => {
    const summary = { files: [{ file: 'a.go', total: 2, kept: 2 }, { file: 'b.go', total: 1, kept: 1 }], hiddenFileCount: 0, hiddenMatchCount: 0, hiddenSample: [] };
    const kept = [
      full('a.go', 3, '\tif err := Export(ctx); err != nil {', 'Export'),
      full('a.go', 9, '// Export writes the dump', 'Export'),
      full('b.go', 1, 'func Export(ctx context.Context) error {', 'Export'),
    ];
    expect(renderGrepBody(kept, summary, 10, { fullLine: true }).lines).toEqual([
      'a.go:3: if err := Export(ctx); err != nil {', 'a.go:9: // Export writes the dump', 'b.go:1: func Export(ctx context.Context) error {',
    ]);
    expect(renderGrepBody(kept, summary, 10).lines).toEqual(['a.go:3: Export', 'a.go:9: Export', 'b.go:1: Export']);
  });
});
