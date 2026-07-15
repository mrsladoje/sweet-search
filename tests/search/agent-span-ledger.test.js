import { describe, expect, it } from 'vitest';
import {
  AgentSpanLedger,
  applyReadOmissionDecisions,
  collectAgentShownSpans,
  collectReadShownSpans,
  collectSemanticShownSpans,
  hashShownLines,
  hashShownText,
  exactRereadOmissionEnabled,
  renderReadOmission,
  renderShownFullTrailer,
  resolveAgentSessionId,
  shownSpanTrailerEnabled,
} from '../../core/search/agent-span-ledger.js';

const span = (overrides = {}) => {
  const { text = 'a\nb\nc', ...rest } = overrides;
  return {
    file: 'src/a.js',
    startLine: 10,
    endLine: 12,
    hash: hashShownText(text),
    lineHashes: hashShownLines(text),
    ...rest,
  };
};

describe('agent shown-span extraction', () => {
  it('enables receipts and trailers by default with an explicit opt-out', () => {
    expect(exactRereadOmissionEnabled({})).toBe(true);
    expect(shownSpanTrailerEnabled({})).toBe(true);

    for (const value of ['0', 'false', 'off', 'no', ' FALSE ']) {
      expect(exactRereadOmissionEnabled({ SWEET_SEARCH_EXACT_REREAD_OMISSION: value })).toBe(false);
      expect(shownSpanTrailerEnabled({ SWEET_SEARCH_SHOWN_SPAN_TRAILER: value })).toBe(false);
    }

    expect(exactRereadOmissionEnabled({ SWEET_SEARCH_EXACT_REREAD_OMISSION: '1' })).toBe(true);
    expect(shownSpanTrailerEnabled({ SWEET_SEARCH_SHOWN_SPAN_TRAILER: 'yes' })).toBe(true);
  });

  it('registers only complete full source bodies', () => {
    const spans = collectAgentShownSpans([
      { file: 'src/a.js', startLine: 10, endLine: 12, presentation: 'full', code: 'a\nb\nc' },
      { file: 'src/b.js', startLine: 1, endLine: 20, presentation: 'full', code: 'short\n// ... (18 more lines)' },
      { file: 'src/c.js', startLine: 1, endLine: 2, presentation: 'preview', code: 'a\nb' },
      { file: 'src/d.js', startLine: 1, endLine: 3, presentation: 'full', expansionKind: 'sandwich', code: 'a\nb\nc' },
    ], { projectRoot: '/repo' });

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ file: 'src/a.js', startLine: 10, endLine: 12 });
  });

  it('registers a complete nested continuation without treating its truncated parent as complete', () => {
    const spans = collectAgentShownSpans([{
      file: 'src/a.js',
      startLine: 1,
      endLine: 20,
      presentation: 'full',
      code: 'short\n// ... (18 more lines)',
      continuation: {
        kind: 'symbol',
        file: 'src/a.js',
        startLine: 21,
        endLine: 23,
        symbol: 'nextSymbol',
        code: 'one\ntwo\nthree',
      },
    }], { projectRoot: '/repo' });

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ file: 'src/a.js', startLine: 21, endLine: 23 });
  });

  it('renders one deterministic, compact trailer', () => {
    expect(renderShownFullTrailer([
      span(),
      span({ startLine: 20, endLine: 24, hash: hashShownText('other') }),
      span({ file: 'src/b.js', startLine: 1, endLine: 2, hash: hashShownText('b') }),
    ])).toBe('shown-full: src/a.js:10-12,20-24; src/b.js:1-2');
  });

  it('hashes source-line evidence equivalently with or without one formatter EOL', () => {
    expect(hashShownText('a\nb\n')).toBe(hashShownText('a\nb'));
    expect(hashShownText('a\r\nb\r\n')).toBe(hashShownText('a\nb'));
    expect(hashShownText('a\nchanged\n')).not.toBe(hashShownText('a\nb\n'));
  });

  it('filters degenerate reads without shifting valid batch result indexes', () => {
    const spans = collectReadShownSpans({
      files: [
        { ok: true, file: 'empty.py', text: '', totalLines: 0 },
        {
          ok: true,
          file: 'x.js',
          absolutePath: '/repo/sub/x.js',
          text: 'two\nthree\n',
          range: { startLine: 2, endLine: 3 },
          totalLines: 3,
        },
        {
          ok: true,
          file: 'past-eof.js',
          text: '',
          range: { startLine: 100, endLine: 12 },
          totalLines: 12,
        },
      ],
    }, { projectRoot: '/repo' });

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      file: 'sub/x.js', startLine: 2, endLine: 3, resultIndex: 1,
    });
  });

  it('keeps only complete, coordinate-consistent semantic spans', () => {
    const spans = collectSemanticShownSpans({
      ok: true,
      file: '/repo/src/a.js',
      spans: [
        { startLine: 1, endLine: 2, text: 'a\nb', truncated: true },
        { startLine: 3, endLine: 5, text: 'c\nd' },
        { startLine: 6, endLine: 7, text: 'e\nf' },
      ],
    }, { projectRoot: '/repo' });

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ file: 'src/a.js', startLine: 6, endLine: 7 });
  });
});

describe('AgentSpanLedger', () => {
  it('isolates sessions and rejects shifted evidence', () => {
    const ledger = new AgentSpanLedger();
    const firstCall = ledger.beginCall('session-a');
    ledger.observeAtCall('session-a', firstCall, [span()]);

    const shifted = span({ startLine: 15, endLine: 17 });
    const secondCall = ledger.beginCall('session-a');
    expect(ledger.decideAndObserveAtCall('session-a', secondCall, [shifted])[0].omit).toBe(false);

    const thirdCall = ledger.beginCall('session-a');
    expect(ledger.decideAndObserveAtCall('session-a', thirdCall, [span()])[0]).toMatchObject({
      omit: true,
      callsAgo: 2,
      previous: { startLine: 10, endLine: 12 },
    });

    const otherSessionCall = ledger.beginCall('session-b');
    expect(ledger.decideAndObserveAtCall('session-b', otherSessionCall, [span()])[0].omit).toBe(false);
  });

  it('returns full content when bytes inside the span changed', () => {
    const ledger = new AgentSpanLedger();
    ledger.observeAtCall('s', ledger.beginCall('s'), [span()]);
    const changed = span({ text: 'a\nCHANGED\nc' });
    expect(ledger.decideAndObserveAtCall('s', ledger.beginCall('s'), [changed])[0].omit).toBe(false);
  });

  it('omits coordinate-contained matching lines but not expanded or shifted ranges', () => {
    const ledger = new AgentSpanLedger();
    const shown = span({ text: 'a\nb\nc\nd\ne', startLine: 10, endLine: 14 });
    ledger.observeAtCall('s', ledger.beginCall('s'), [shown]);

    const contained = span({ text: 'b\nc\nd', startLine: 11, endLine: 13 });
    const shifted = span({ text: 'a\nb\nc\nd\ne', startLine: 20, endLine: 24 });
    const changed = span({ text: 'b\nCHANGED\nd', startLine: 11, endLine: 13 });
    const expanded = span({ text: 'UNSEEN\na\nb\nc\nd\ne', startLine: 9, endLine: 14 });
    const decisions = ledger.decideAndObserveAtCall(
      's', ledger.beginCall('s'), [contained, shifted, changed, expanded],
    );
    expect(decisions[0]).toMatchObject({
      omit: true,
      callsAgo: 1,
      previous: { startLine: 10, endLine: 14 },
    });
    expect(decisions[1].omit).toBe(false);
    expect(decisions[2].omit).toBe(false);
    expect(decisions[3].omit).toBe(false);
  });

  it('scopes force to the exact read authorized by an omission', () => {
    const ledger = new AgentSpanLedger();
    const shown = span({ text: 'a\nb\nc\nd\ne', startLine: 10, endLine: 14 });
    const otherShown = span({ file: 'src/b.js', text: 'a\nb\nc\nd\ne', startLine: 10, endLine: 14 });
    const contained = span({ text: 'b\nc\nd', startLine: 11, endLine: 13 });
    const otherContained = span({ file: 'src/b.js', text: 'b\nc\nd', startLine: 11, endLine: 13 });
    ledger.observeAtCall('s', ledger.beginCall('s'), [shown, otherShown]);

    const omittedCall = ledger.beginCall('s');
    expect(ledger.decideAndObserveAtCall('s', omittedCall, [contained])[0].omit).toBe(true);

    const unrelatedForceCall = ledger.beginCall('s');
    expect(ledger.decideAndObserveAtCall('s', unrelatedForceCall, [otherContained], { force: true })[0].omit).toBe(true);

    const forcedCall = ledger.beginCall('s');
    expect(ledger.decideAndObserveAtCall('s', forcedCall, [contained], { force: true })[0].omit).toBe(false);
    const nextCall = ledger.beginCall('s');
    expect(ledger.decideAndObserveAtCall('s', nextCall, [contained])[0]).toMatchObject({ omit: true, callsAgo: 1 });
  });

  it('does not refresh omitted reads and returns full text after 30 calls', () => {
    const ledger = new AgentSpanLedger();
    ledger.observeAtCall('s', ledger.beginCall('s'), [span()]);
    for (let callsAgo = 1; callsAgo <= 30; callsAgo++) {
      expect(ledger.decideAndObserveAtCall('s', ledger.beginCall('s'), [span()])[0]).toMatchObject({
        omit: true,
        callsAgo,
      });
    }
    expect(ledger.decideAndObserveAtCall('s', ledger.beginCall('s'), [span()])[0].omit).toBe(false);
  });

  it('retains receipts for 30 calls, then expires them', () => {
    const ledger = new AgentSpanLedger();
    ledger.observeAtCall('s', ledger.beginCall('s'), [span()]);
    for (let i = 0; i < 30; i++) ledger.beginCall('s');
    expect(ledger.stats()).toEqual({ sessions: 1, receipts: 1 });
    ledger.beginCall('s');
    expect(ledger.stats()).toEqual({ sessions: 1, receipts: 0 });
  });

  it('reset invalidates immediately and both caps are hard bounds', () => {
    const ledger = new AgentSpanLedger({ receiptsPerSession: 2, maxSessions: 2 });
    let call = ledger.beginCall('s1');
    ledger.observeAtCall('s1', call, [span(), span({ file: 'b' }), span({ file: 'c' })]);
    expect(ledger.stats()).toEqual({ sessions: 1, receipts: 2 });
    ledger.beginCall('s2');
    ledger.beginCall('s3');
    expect(ledger.stats().sessions).toBe(2);
    expect(ledger.reset('s3')).toBe(true);
    expect(ledger.stats().sessions).toBe(1);
  });
});

describe('read omission rendering', () => {
  it('removes only matched text and narrowly scopes the just-in-time override', () => {
    const results = {
      files: [{ file: 'src/a.js', ok: true, range: { startLine: 11, endLine: 11 }, totalLines: 40, text: 'b\n' }],
    };
    applyReadOmissionDecisions(results, [{
      omit: true,
      callsAgo: 7,
      previous: span(),
    }]);
    expect(results.files[0].text).toBe('');
    expect(renderReadOmission(results.files[0], { surface: 'ss-read' })).toBe(
      '[unchanged reread omitted; these exact source lines were already shown 7 sweet-search calls ago within src/a.js:10-12. Continue from that copy. ONLY if the prior copy is unavailable, repeat this same path/range with --force; this one-use override applies only to this omission.]',
    );
    expect(renderReadOmission(results.files[0], { surface: 'mcp' })).toContain(
      'ONLY if the prior copy is unavailable, repeat this same path/range with force=true',
    );
  });

  it('fails closed on untrusted session ids', () => {
    expect(resolveAgentSessionId('bad\nsession', {})).toBeNull();
    expect(resolveAgentSessionId(null, { CODEX_THREAD_ID: 'thread-123' })).toBe('thread-123');
  });
});
