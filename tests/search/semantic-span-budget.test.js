/**
 * ss-semantic exact-range budget rules (pure): whole-line cuts, the partial-line case, the
 * omitted-content lines, and the ledger rule (exact whole-line ranges only).
 */
import { describe, expect, it } from 'vitest';

import {
  buildLineOffsets,
  cutToWholeLines,
  enforceExactCharBudget,
  exactFallbackSpan,
  omittedRangeLines,
  rangeChars,
} from '../../core/search/semantic-span-budget.js';
import { collectSemanticShownSpans } from '../../core/search/agent-span-ledger.js';

// 20 lines of 10 characters each ("line NN..." + newline = 11 chars on disk)
const TEXT = Array.from({ length: 20 }, (_, i) => `line ${String(i + 1).padStart(2, '0')}...`).join('\n') + '\n';
const OFFSETS = buildLineOffsets(TEXT);

describe('rangeChars / buildLineOffsets', () => {
  it('counts disk characters, newlines included', () => {
    expect(OFFSETS).toHaveLength(20);
    expect(rangeChars(TEXT, OFFSETS, 1, 1)).toBe(11);
    expect(rangeChars(TEXT, OFFSETS, 3, 5)).toBe(33);
    expect(rangeChars(TEXT, OFFSETS, 20, 20)).toBe(11);
  });

  it('a file without a final newline', () => {
    const t = 'a\nbb\nccc';
    const o = buildLineOffsets(t);
    expect(o).toEqual([0, 2, 5]);
    expect(rangeChars(t, o, 3, 3)).toBe(3);
  });
});

describe('cutToWholeLines', () => {
  it('the longest whole-line prefix that fits; the range is exactly the printed lines', () => {
    const cut = cutToWholeLines(TEXT, OFFSETS, 4, 12, 40);
    expect(cut).toEqual({ startLine: 4, endLine: 6, text: 'line 04...\nline 05...\nline 06...\n' });
  });

  it('exactly fitting lines are kept', () => {
    expect(cutToWholeLines(TEXT, OFFSETS, 1, 20, 33).endLine).toBe(3);
  });

  it('a first line longer than the budget prints as a partial line', () => {
    const long = `${'x'.repeat(500)}\nshort\n`;
    const cut = cutToWholeLines(long, buildLineOffsets(long), 1, 2, 120);
    expect(cut.startLine).toBe(1);
    expect(cut.endLine).toBe(1);
    expect(cut.text).toBe('x'.repeat(120));
    expect(cut.partialLine).toEqual({ line: 1, shownChars: 120, totalChars: 500 });
  });
});

describe('enforceExactCharBudget', () => {
  const spans = () => [
    { startLine: 2, endLine: 4, score: 0.5 },     // 33 chars
    { startLine: 8, endLine: 19, score: 0.9 },    // 132 chars, the top span
  ];

  it('the top span over budget is cut to whole lines and carries its merged range', () => {
    const { spans: out, charsUsed } = enforceExactCharBudget(spans(), TEXT, OFFSETS, 50);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      startLine: 8, endLine: 11, fullStartLine: 8, fullEndLine: 19, truncated: true, exactRange: true,
    });
    expect(out[0].text.split('\n').filter(Boolean)).toHaveLength(4);
    expect(charsUsed).toBe(44);
  });

  it('spans that fit stay whole and unmarked; line order is restored', () => {
    const { spans: out } = enforceExactCharBudget(spans(), TEXT, OFFSETS, 1000);
    expect(out.map(s => [s.startLine, s.endLine, s.truncated])).toEqual([[2, 4, undefined], [8, 19, undefined]]);
    expect(out[0].text).toBe(TEXT.slice(OFFSETS[1], OFFSETS[4]));
  });
});

describe('exactFallbackSpan', () => {
  it('a whole file that fits is unchanged; one that does not is cut at a line boundary', () => {
    expect(exactFallbackSpan('a\nb\n', 2, 100)).toMatchObject({ startLine: 1, endLine: 2, text: 'a\nb\n' });
    const cut = exactFallbackSpan(TEXT, 20, 25);
    expect(cut).toMatchObject({ startLine: 1, endLine: 2, fullStartLine: 1, fullEndLine: 20, truncated: true, exactRange: true });
  });
});

describe('omittedRangeLines', () => {
  it('omitted content before and after, as runnable ss-read commands', () => {
    expect(omittedRangeLines('src/a.go', { startLine: 7, endLine: 13, fullStartLine: 1, fullEndLine: 20, exactRange: true }))
      .toEqual({
        before: ['# not shown: lines 1-6 — ss-read src/a.go 1 6'],
        after: ['# not shown: lines 14-20 — ss-read src/a.go 14 20'],
      });
  });

  it('a partial line is reported before the lines after it', () => {
    expect(omittedRangeLines('m.js', {
      startLine: 1, endLine: 1, fullStartLine: 1, fullEndLine: 3, exactRange: true,
      partialLine: { line: 1, shownChars: 120, totalChars: 500 },
    }).after).toEqual(['(line 1 truncated: 120 of 500 characters)', '# not shown: lines 2-3 — ss-read m.js 2 3']);
  });

  it('nothing for a span that was not cut', () => {
    expect(omittedRangeLines('a', { startLine: 1, endLine: 3 })).toEqual({ before: [], after: [] });
  });
});

describe('ledger: only exact, fully displayed whole-line ranges', () => {
  const result = spans => ({ ok: true, file: 'src/a.go', spans });

  it('an exact cut span is recorded with its printed range; a shipped (mid-line) cut is not', () => {
    const exact = enforceExactCharBudget([{ startLine: 8, endLine: 19, score: 1 }], TEXT, OFFSETS, 50).spans[0];
    expect(collectSemanticShownSpans(result([exact]), {}).map(s => [s.startLine, s.endLine])).toEqual([[8, 11]]);
    const shipped = { startLine: 8, endLine: 19, text: TEXT.slice(OFFSETS[7], OFFSETS[7] + 50), truncated: true };
    expect(collectSemanticShownSpans(result([shipped]), {})).toEqual([]);
  });

  it('a partial line is never recorded', () => {
    const long = `${'x'.repeat(500)}\n`;
    const span = exactFallbackSpan(long, 1, 100);
    expect(span.partialLine).toBeTruthy();
    expect(collectSemanticShownSpans(result([span]), {})).toEqual([]);
  });
});
