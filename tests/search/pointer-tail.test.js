/**
 * Pointer tail (owner decision 2026-10-04, default ON, agent formats): rank 2/3 print as one
 * row instead of a code preview when top-1's score is at least POINTER_TAIL_RATIO x theirs. A
 * `sufficient=YES` verdict no longer triggers it (it hid gold ranks 2/3 in 18 of 74 YES packs).
 */
import { describe, expect, it } from 'vitest';

import { allocateBudget, POINTER_TAIL_RATIO } from '../../core/search/context-expander.js';

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
