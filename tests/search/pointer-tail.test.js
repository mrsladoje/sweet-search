/**
 * Pointer tail (owner decision 2026-10-04, default ON, agent formats): rank 2/3 print as one
 * row instead of a code preview when top-1's score is at least POINTER_TAIL_RATIO x theirs, or
 * when the verdict is `sufficient=YES`.
 */
import { describe, expect, it } from 'vitest';

import { allocateBudget, demoteTailOnSufficient, POINTER_TAIL_RATIO } from '../../core/search/context-expander.js';

const scores = (...s) => ({ results: s.map((score) => ({ score })), agentFormat: true });

describe('pointer tail: score ratio', () => {
  it('rank 2/3 become summary rows at >= 2.5x, keep their preview below it', () => {
    expect(POINTER_TAIL_RATIO).toBe(2.5);
    const a = allocateBudget(3000, 5, 'agent_preview', scores(1.0, 0.4, 0.41, 0.3, 0.2));
    expect(a.map((x) => x.presentation)).toEqual(['full', 'summary', 'preview', 'summary', 'summary']);
  });

  it('non-agent formats keep the previews (presentation only for agents)', () => {
    const a = allocateBudget(3000, 5, 'agent_preview', { ...scores(1.0, 0.1, 0.1, 0.1, 0.1), agentFormat: false });
    expect(a.map((x) => x.presentation)).toEqual(['full', 'preview', 'preview', 'summary', 'summary']);
  });
});

describe('pointer tail: sufficient=YES', () => {
  it('drops the code of rank 2/3 only, returns the freed tokens, leaves rank 1 and 4+', () => {
    const r = (rank, code) => ({ rank, file: `f${rank}.js`, startLine: 1, endLine: 9, symbol: `s${rank}`, symbolType: 'function',
      presentation: code ? 'preview' : 'summary', code, codeTokens: code ? 100 : 0, headerContext: 'import x', shownStartLine: 1, shownEndLine: 9 });
    const results = [r(1, 'a'), r(2, 'b'), r(3, 'c'), r(4, null)];
    expect(demoteTailOnSufficient(results)).toBe(200);
    expect(results.map((x) => x.presentation)).toEqual(['preview', 'summary', 'summary', 'summary']);
    expect(results[0].code).toBe('a');
    expect(results[1]).toMatchObject({ code: null, codeTokens: 0, headerContext: null, summary: 'f2.js:1 — s2 (function)' });
    expect(results[1].shownEndLine).toBeUndefined();
  });
});
