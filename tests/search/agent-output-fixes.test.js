/**
 * ss-* output fixes (SS_FIX_A, SS_FIX_SUMMARY_CAP, SS_FIX_ONE_PER_FILE, SS_FIX_GREP_ORDER).
 *
 * The invariants: every switch is default off, and the pure helpers do what the fix list says.
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
  readFixFlags,
  renderAlsoInFile,
  renderGrepCounts,
  renderSummaryLine,
  resolveThreadKey,
  resultRenderFixActive,
  selectEntries,
  summaryRestatesHeader,
} from '../../core/search/agent-output-fixes.js';
import { renderGrepBody } from '../../core/search/grep-output-shaping.js';
import {
  AgentSpanLedger,
  collectAgentShownSpans,
  collectAgentShownSpansIndexed,
} from '../../core/search/agent-span-ledger.js';

describe('readFixFlags', () => {
  it('is all off with an empty environment', () => {
    expect(readFixFlags({})).toEqual({ bundleA: false, summaryCap: null, onePerFile: false, grepOrder: false });
    expect(resultRenderFixActive(readFixFlags({}))).toBe(false);
  });

  it('reads each switch on its own', () => {
    expect(readFixFlags({ SS_FIX_A: '1' }).bundleA).toBe(true);
    expect(readFixFlags({ SS_FIX_A: '0' }).bundleA).toBe(false);
    expect(readFixFlags({ SS_FIX_SUMMARY_CAP: '3' }).summaryCap).toBe(3);
    expect(readFixFlags({ SS_FIX_SUMMARY_CAP: '0' }).summaryCap).toBe(0);
    expect(readFixFlags({ SS_FIX_SUMMARY_CAP: '' }).summaryCap).toBeNull();
    expect(readFixFlags({ SS_FIX_SUMMARY_CAP: 'abc' }).summaryCap).toBeNull();
    expect(readFixFlags({ SS_FIX_ONE_PER_FILE: '1' }).onePerFile).toBe(true);
    expect(readFixFlags({ SS_FIX_GREP_ORDER: '1' }).grepOrder).toBe(true);
  });

  it('uses the fixed renderer for ss-search, but one-per-file never reaches ss-find', () => {
    expect(resultRenderFixActive(readFixFlags({ SS_FIX_ONE_PER_FILE: '1' }))).toBe(true);
    expect(resultRenderFixActive(readFixFlags({ SS_FIX_ONE_PER_FILE: '1' }), { find: true })).toBe(false);
    expect(resultRenderFixActive(readFixFlags({ SS_FIX_SUMMARY_CAP: '2' }), { find: true })).toBe(true);
    expect(resultRenderFixActive(readFixFlags({ SS_FIX_GREP_ORDER: '1' }))).toBe(false);
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
  it('drops summary entries covered by an earlier span or repeating file + symbol', () => {
    const results = [
      entry({ rank: 1, presentation: 'full', code: 'x', startLine: 10, endLine: 50, symbol: 'big' }),
      entry({ rank: 2, startLine: 20, endLine: 30, symbol: 'inner' }),     // inside rank 1
      entry({ rank: 3, startLine: 60, endLine: 70, symbol: 'other' }),
      entry({ rank: 4, startLine: 80, endLine: 90, symbol: 'other' }),     // repeats file + symbol
    ];
    const { entries } = selectEntries(results, { dedupe: true });
    expect(entries.map((e) => e.r.rank)).toEqual([1, 3]);
  });

  it('never drops a non-summary entry', () => {
    const results = [
      entry({ rank: 1, presentation: 'full', code: 'x', startLine: 10, endLine: 50, symbol: 'big' }),
      entry({ rank: 2, presentation: 'preview', code: 'y', startLine: 20, endLine: 30, symbol: 'inner' }),
    ];
    expect(selectEntries(results, { dedupe: true }).entries).toHaveLength(2);
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
    expect(renderAlsoInFile(entries[0].also)).toBe('also in this file: a2 (l.120), a3 (l.300)');
    expect(renderAlsoInFile(entries[1].also)).toBe('');
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

  it('renders per-file counts with source first and tests collapsed', () => {
    const files = [
      { file: 'a_test.go', total: 40 }, { file: 'a.go', total: 3 }, { file: 'b.go', total: 9 }, { file: 'tests/x.py', total: 2 },
    ];
    const lines = renderGrepCounts(files, new Map([['a.go', 11], ['b.go', 4]]), 10);
    expect(lines[0]).toBe('b.go:4 (9 matches)');
    expect(lines[1]).toBe('a.go:11 (3 matches)');
    expect(lines[2]).toContain('test/spec/fixture files: 2 file(s), 42 match(es): a_test.go (40), tests/x.py (2)');
    expect(GREP_COUNTS_THRESHOLD).toBe(50);
  });
});
