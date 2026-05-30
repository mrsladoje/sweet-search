/**
 * Unit tests for core/prompt-optimization/sweep/op-systemaware-merge.mjs
 * (OP-E System-Aware Merge, 2026-05-30 — replaces OP-2 trajectory-crossover).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  splitSections,
  buildSystemAwareMergePrompt,
  runSystemAwareMerge,
} from '../../../core/prompt-optimization/sweep/op-systemaware-merge.mjs';
import { EVENT_KINDS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

const PROMPT_A = `# Guide
Preamble for A.

## Routing
Route lookups to [[ss-search]]; exact symbols to [[ss-grep]].

## Stopping
Stop once you have a confirmed file+symbol. Conclude [[no-match]] if absent.`;

const PROMPT_B = `# Guide
Preamble for B.

## Routing
Always [[ss-search]] three times then answer.

## Multi-file flow
Follow imports with [[ss-semantic]] then [[ss-grep]], conclude [[no-match]] if dead.`;

describe('splitSections', () => {
  it('splits a prompt into preamble + ## sections', () => {
    const secs = splitSections(PROMPT_A);
    expect(secs[0].header).toBe('(preamble)');
    expect(secs.map((s) => s.header)).toEqual(['(preamble)', 'Routing', 'Stopping']);
    expect(secs.find((s) => s.header === 'Routing').body).toMatch(/ss-search/);
  });

  it('handles a prompt with no ## sections (all preamble)', () => {
    const secs = splitSections('just prose, no headers');
    expect(secs).toHaveLength(1);
    expect(secs[0].header).toBe('(preamble)');
  });
});

describe('buildSystemAwareMergePrompt', () => {
  it('lists both candidates section headers and forbids within-section blending', () => {
    const { systemPrompt, userPrompt } = buildSystemAwareMergePrompt({ promptA: PROMPT_A, promptB: PROMPT_B });
    expect(systemPrompt).toMatch(/MODULE-WISE selection ONLY/);
    expect(systemPrompt).toMatch(/Do NOT blend, average, or write new prose INSIDE a section/);
    expect(systemPrompt).toMatch(/Do NOT invent new \[\[…\]\] tokens|Do NOT invent new \[\[/);
    expect(userPrompt).toMatch(/sections: Routing, Stopping/);
    expect(userPrompt).toMatch(/sections: Routing, Multi-file flow/);
    expect(userPrompt).toContain(PROMPT_A);
    expect(userPrompt).toContain(PROMPT_B);
  });
});

describe('runSystemAwareMerge', () => {
  const base = { promptA: PROMPT_A, promptB: PROMPT_B };

  it('accepts a merge that preserves candidate A token multiplicity', async () => {
    // A's tokens: ss-search×1, ss-grep×1, no-match×1. This merged output keeps them.
    const merged = `# Guide
Preamble.

## Routing
Route lookups to [[ss-search]]; exact symbols to [[ss-grep]].

## Stopping
Stop once confirmed. Conclude [[no-match]] if absent.`;
    const callModel = vi.fn(async () => ({ text: merged, isError: false }));
    const r = await runSystemAwareMerge({ ...base, callModel });
    expect(r.accepted).toBe(true);
    expect(callModel.mock.calls[0][0].systemPrompt).toMatch(/SYSTEM-AWARE MERGE/);
  });

  it('rejects (falls back to promptA) when a [[token]] from A is dropped', async () => {
    const callModel = vi.fn(async () => ({ text: '## Routing\nJust [[ss-search]] and stop.', isError: false })); // drops ss-grep + no-match
    const r = await runSystemAwareMerge({ ...base, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(PROMPT_A);
    expect(r.rejection._kind).toBe(EVENT_KINDS.MUTATION_REJECTION);
    expect(r.rejection.op).toBe('system-aware-merge');
  });

  it('rejects on model error and falls back to promptA', async () => {
    const callModel = vi.fn(async () => ({ text: 'overloaded', isError: true }));
    const r = await runSystemAwareMerge({ ...base, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(PROMPT_A);
    expect(r.rejection.reason).toBe('model-error');
  });

  it('throws when callModel is not a function', async () => {
    await expect(runSystemAwareMerge({ ...base, callModel: null })).rejects.toThrow(/callModel/);
  });

  it('REJECTS a no-op merge that returns ≈ promptA (the gen-3 round-1 clone-of-A bug)', async () => {
    // gemini returned promptA + a trailing newline = a whitespace-only clone of A.
    const callModel = vi.fn(async () => ({ text: `${PROMPT_A}\n`, isError: false }));
    const r = await runSystemAwareMerge({ ...base, callModel });
    expect(r.accepted).toBe(false);
    expect(r.rejection.reason).toBe('merge-noop-clone');
    expect(r.mutated).toBe(PROMPT_A);
  });
});
