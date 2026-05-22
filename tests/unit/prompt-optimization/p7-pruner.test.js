/**
 * Unit tests for core/prompt-optimization/sweep/op-pruner.mjs
 * (OP-5 The Pruner, §3.2 / Gemini 3rd-pass §C1, §3.2.3 re-export).
 *
 * Covers:
 *  - STATEFUL_SUMMARY_RULE re-export equals the persona-pivot canonical source
 *  - buildPrunerPrompt: ~20% prose-only, pseudocode/if-then/fence protection,
 *    [[token]] preservation, PRUNER_SKIP refuse-if-minimal instruction
 *  - runPruner: minTokens skip path (no model call), PRUNER_SKIP handling,
 *    validateMutation gate, model-error rejection
 */

import { describe, it, expect, vi } from 'vitest';
import {
  STATEFUL_SUMMARY_RULE,
  buildPrunerPrompt,
  runPruner,
} from '../../../core/prompt-optimization/sweep/op-pruner.mjs';
import { STATEFUL_SUMMARY_RULE as PIVOT_RULE } from '../../../core/prompt-optimization/sweep/op-persona-pivot.mjs';
import { EVENT_KINDS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

const PRUNE_CAND =
  'You are a careful and meticulous code search agent. ' +
  'Always prefer [[ss-search]] for quick literal lookups, and use [[ss-trace]] ' +
  'when you must follow call relationships across the repository.';

// ─── STATEFUL_SUMMARY_RULE re-export ───────────────────────────────────────

describe('STATEFUL_SUMMARY_RULE re-export', () => {
  it('is re-exported and identical to the persona-pivot canonical source', () => {
    expect(STATEFUL_SUMMARY_RULE).toBe(PIVOT_RULE);
    expect(STATEFUL_SUMMARY_RULE).toMatch(/<state_summary>/);
  });
});

// ─── buildPrunerPrompt ─────────────────────────────────────────────────────

describe('buildPrunerPrompt', () => {
  const { systemPrompt, userPrompt } = buildPrunerPrompt({ candidate: PRUNE_CAND });

  it('targets ~20% removal restricted to prose only', () => {
    expect(systemPrompt).toMatch(/20%/);
    expect(systemPrompt).toMatch(/PROSE/);
  });

  it('protects pseudocode, if/then blocks, and fenced code from edits', () => {
    expect(systemPrompt).toMatch(/DO NOT alter the syntax, indentation, or logic/i);
    expect(systemPrompt).toMatch(/pseudocode/i);
    expect(systemPrompt).toMatch(/if\/then/i);
    expect(systemPrompt).toMatch(/fenced code blocks/i);
  });

  it('requires every [[token]] preserved at the same multiplicity', () => {
    expect(systemPrompt).toMatch(/\[\[token\]\]/);
    expect(systemPrompt).toMatch(/multiplicity/i);
  });

  it('instructs the model to emit PRUNER_SKIP when the prompt is already minimal', () => {
    expect(systemPrompt).toMatch(/PRUNER_SKIP/);
    expect(systemPrompt).toMatch(/already minimal/i);
  });

  it('embeds the candidate in the user prompt', () => {
    expect(userPrompt).toContain(PRUNE_CAND);
  });
});

// ─── runPruner — skip paths ────────────────────────────────────────────────

describe('runPruner — skip paths', () => {
  it('skips (no model call) when candidate is at/below minTokens', async () => {
    const callModel = vi.fn(async () => ({ text: 'should not run', isError: false }));
    const r = await runPruner({ candidate: 'Use [[ss-search]].', callModel, minTokens: 50 });
    expect(callModel).not.toHaveBeenCalled();
    expect(r).toEqual({ mutated: 'Use [[ss-search]].', accepted: true, skipped: true });
  });

  it('still calls the model when above minTokens', async () => {
    const callModel = vi.fn(async () => ({ text: PRUNE_CAND, isError: false }));
    await runPruner({ candidate: PRUNE_CAND, callModel, minTokens: 3 });
    expect(callModel).toHaveBeenCalledOnce();
  });

  it('treats a bare PRUNER_SKIP response as a skip (returns original candidate)', async () => {
    const callModel = vi.fn(async () => ({ text: 'PRUNER_SKIP', isError: false }));
    const r = await runPruner({ candidate: PRUNE_CAND, callModel });
    expect(r.accepted).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.mutated).toBe(PRUNE_CAND);
  });

  it('recovers the body when PRUNER_SKIP is followed by the unchanged prompt', async () => {
    const callModel = vi.fn(async () => ({ text: `PRUNER_SKIP\n${PRUNE_CAND}`, isError: false }));
    const r = await runPruner({ candidate: PRUNE_CAND, callModel });
    expect(r.skipped).toBe(true);
    expect(r.mutated).toBe(PRUNE_CAND);
  });

  it('tolerates leading whitespace before the PRUNER_SKIP sentinel', async () => {
    const callModel = vi.fn(async () => ({ text: '   PRUNER_SKIP', isError: false }));
    const r = await runPruner({ candidate: PRUNE_CAND, callModel });
    expect(r.skipped).toBe(true);
    expect(r.mutated).toBe(PRUNE_CAND);
  });
});

// ─── runPruner — prune + validation ────────────────────────────────────────

describe('runPruner — prune + validation', () => {
  it('routes to moonshot / kimi-k2.6', async () => {
    const callModel = vi.fn(async () => ({ text: PRUNE_CAND, isError: false }));
    await runPruner({ candidate: PRUNE_CAND, callModel });
    const opts = callModel.mock.calls[0][0];
    expect(opts.lineage).toBe('moonshot');
    expect(opts.model).toBe('kimi-k2.6');
  });

  it('accepts a pruned output that preserves every [[token]]', async () => {
    const pruned = 'You are a code search agent. Prefer [[ss-search]] for lookups; use [[ss-trace]] to follow calls.';
    const callModel = vi.fn(async () => ({ text: pruned, isError: false }));
    const r = await runPruner({ candidate: PRUNE_CAND, callModel });
    expect(r.accepted).toBe(true);
    expect(r.mutated).toBe(pruned);
    expect(r.skipped).toBeUndefined();
  });

  it('rejects a prune that drops a [[token]] (over-aggressive pruning)', async () => {
    const callModel = vi.fn(async () => ({ text: 'Terse agent. Prefer [[ss-search]].', isError: false }));
    const r = await runPruner({ candidate: PRUNE_CAND, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(PRUNE_CAND);
    expect(r.rejection._kind).toBe(EVENT_KINDS.MUTATION_REJECTION);
    expect(r.rejection.op).toBe('pruner');
    expect(r.rejection.failures.some((f) => f.reason === 'missing-token' && f.token === '[[ss-trace]]')).toBe(true);
  });

  it('rejects on model error', async () => {
    const callModel = vi.fn(async () => ({ text: 'timeout', isError: true }));
    const r = await runPruner({ candidate: PRUNE_CAND, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(PRUNE_CAND);
    expect(r.rejection.reason).toBe('model-error');
  });

  it('throws when callModel is not a function', async () => {
    await expect(runPruner({ candidate: PRUNE_CAND, callModel: null })).rejects.toThrow(/callModel/);
  });

  it('throws when candidate is not a string', async () => {
    await expect(runPruner({ candidate: 0, callModel: async () => ({ text: '' }) })).rejects.toThrow(
      /candidate must be a string/,
    );
  });
});
