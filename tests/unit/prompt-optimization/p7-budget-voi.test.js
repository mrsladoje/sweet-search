/**
 * Unit tests for core/prompt-optimization/sweep/op-budget-voi.mjs
 * (OP-D Budget / Value-of-Information early-exit operator, 2026-05-30).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildBudgetVoiPrompt,
  runBudgetVoiEdit,
} from '../../../core/prompt-optimization/sweep/op-budget-voi.mjs';
import { EVENT_KINDS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

const CANDIDATE = 'Route lookups to [[ss-search]], confirm with [[ss-read]]. Conclude [[no-match]] if absent.';
const TRACE = {
  probeId: 'ts-003', stratum: 'literal-lookup', repo: 'vite', target: 'sonnet',
  query: 'Where is defineConfig declared?',
  calls: 6, nativeCalls: 2, meanTokensPerCall: 3000,
  toolCalls: [{ name: 'ss-search' }, { name: 'ss-read' }, { name: 'ss-search' }, { name: 'ss-read' }, { name: 'ss-search' }, { name: 'ss-read' }],
  answer: 'defineConfig is in packages/vite/src/config.ts',
};

describe('buildBudgetVoiPrompt', () => {
  it('constrains the edit to a VoI/early-exit rule — no new search, no hard caps', () => {
    const { systemPrompt } = buildBudgetVoiPrompt({ candidate: CANDIDATE, traces: [TRACE] });
    expect(systemPrompt).toMatch(/value-of-information/i);
    expect(systemPrompt).toMatch(/early-exit/i);
    expect(systemPrompt).toMatch(/Do NOT add new search instructions/i);
    expect(systemPrompt).toMatch(/NO blunt hard caps/i);
    expect(systemPrompt).toMatch(/SAME multiplicity/);
  });

  it('embeds the over-search trace', () => {
    const { userPrompt } = buildBudgetVoiPrompt({ candidate: CANDIDATE, traces: [TRACE] });
    expect(userPrompt).toMatch(/ts-003/);
    expect(userPrompt).toMatch(/6 tool calls vs 2 native/);
    expect(userPrompt).toContain('defineConfig');
    expect(userPrompt).toContain(CANDIDATE);
    expect(userPrompt).not.toMatch(/\bundefined\b/);
    expect(userPrompt).not.toMatch(/\bnull\b/);
  });

  it('renders a graceful fallback line when no traces are supplied', () => {
    const { userPrompt } = buildBudgetVoiPrompt({ candidate: CANDIDATE, traces: [] });
    expect(userPrompt).toMatch(/trust an exact ranked top hit/);
  });
});

describe('runBudgetVoiEdit', () => {
  const base = { candidate: CANDIDATE, traces: [TRACE] };

  it('accepts a token-preserving VoI edit', async () => {
    const callModel = vi.fn(async () => ({ text: 'Route lookups to [[ss-search]]; if the top ranked hit is an exact match, confirm with one [[ss-read]] and stop. Conclude [[no-match]] if absent.', isError: false }));
    const r = await runBudgetVoiEdit({ ...base, callModel });
    expect(r.accepted).toBe(true);
  });

  it('rejects (falls back to candidate) when a [[token]] is dropped', async () => {
    const callModel = vi.fn(async () => ({ text: 'Just [[ss-search]] and stop early.', isError: false })); // drops ss-read + no-match
    const r = await runBudgetVoiEdit({ ...base, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(CANDIDATE);
    expect(r.rejection._kind).toBe(EVENT_KINDS.MUTATION_REJECTION);
    expect(r.rejection.op).toBe('budget-voi');
  });

  it('rejects on model error and falls back to the candidate', async () => {
    const callModel = vi.fn(async () => ({ text: 'rate limited', isError: true }));
    const r = await runBudgetVoiEdit({ ...base, callModel });
    expect(r.accepted).toBe(false);
    expect(r.rejection.reason).toBe('model-error');
  });

  it('throws when callModel is not a function', async () => {
    await expect(runBudgetVoiEdit({ ...base, callModel: undefined })).rejects.toThrow(/callModel/);
  });
});
