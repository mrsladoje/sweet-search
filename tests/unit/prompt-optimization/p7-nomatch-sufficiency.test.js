/**
 * Unit tests for core/prompt-optimization/sweep/op-nomatch-sufficiency.mjs
 * (OP-B No-Match Sufficiency operator, 2026-05-30).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildNoMatchSufficiencyPrompt,
  runNoMatchSufficiency,
} from '../../../core/prompt-optimization/sweep/op-nomatch-sufficiency.mjs';
import { EVENT_KINDS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

const CANDIDATE = 'Route lookups to [[ss-search]], fall back to [[ss-grep]]. Conclude [[no-match]] only after exhaustive search.';
const TRACE = {
  probeId: 'kotlin-009', stratum: 'no-match', repo: 'ktor', target: 'sonnet',
  query: 'Where is the GraphQL subscription handler?',
  calls: 19, nativeCalls: 6, meanTokensPerCall: 4200,
  toolCalls: new Array(19).fill({ name: 'ss-search' }),
  answer: 'No GraphQL subscription handler exists in this repo.',
};

describe('buildNoMatchSufficiencyPrompt', () => {
  it('returns { systemPrompt, userPrompt } strings', () => {
    const { systemPrompt, userPrompt } = buildNoMatchSufficiencyPrompt({ candidate: CANDIDATE, noMatchTraces: [TRACE] });
    expect(typeof systemPrompt).toBe('string');
    expect(typeof userPrompt).toBe('string');
    expect(systemPrompt.length).toBeGreaterThan(50);
  });

  it('constrains the edit to a positive sufficiency rule — no new search instructions, no hard caps', () => {
    const { systemPrompt } = buildNoMatchSufficiencyPrompt({ candidate: CANDIDATE, noMatchTraces: [TRACE] });
    expect(systemPrompt).toMatch(/SUFFICIENCY rule/);
    expect(systemPrompt).toMatch(/COVERAGE condition/i);
    expect(systemPrompt).toMatch(/Do NOT add new search instructions/i);
    expect(systemPrompt).toMatch(/NO blunt hard caps/i);
    expect(systemPrompt).toMatch(/SAME multiplicity/);
  });

  it('embeds the no-match trace (probe, call count, query, answer)', () => {
    const { userPrompt } = buildNoMatchSufficiencyPrompt({ candidate: CANDIDATE, noMatchTraces: [TRACE] });
    expect(userPrompt).toMatch(/kotlin-009/);
    expect(userPrompt).toMatch(/19 tool calls vs 6 native/);
    expect(userPrompt).toMatch(/avg ~4200 tok\/call/);
    expect(userPrompt).toContain('GraphQL subscription handler');
    expect(userPrompt).toContain(CANDIDATE);
    expect(userPrompt).not.toMatch(/\bundefined\b/);
    expect(userPrompt).not.toMatch(/\bnull\b/);
  });

  it('renders a graceful fallback line when no traces are supplied', () => {
    const { userPrompt } = buildNoMatchSufficiencyPrompt({ candidate: CANDIDATE, noMatchTraces: [] });
    expect(userPrompt).toMatch(/two complementary searches come back empty/);
    expect(userPrompt).not.toMatch(/\bundefined\b/);
  });
});

describe('runNoMatchSufficiency', () => {
  const base = { candidate: CANDIDATE, noMatchTraces: [TRACE] };

  it('routes through callModel and accepts a token-preserving sufficiency edit', async () => {
    // Keeps every source token at the same multiplicity (ss-search×1, ss-grep×1, no-match×1).
    const callModel = vi.fn(async () => ({ text: 'Route lookups to [[ss-search]], fall back to [[ss-grep]]. Once both return nothing, conclude [[no-match]] and stop.', isError: false }));
    const r = await runNoMatchSufficiency({ ...base, callModel });
    expect(r.accepted).toBe(true);
    expect(callModel).toHaveBeenCalledOnce();
  });

  it('rejects (and falls back to candidate) when a [[token]] is dropped', async () => {
    const callModel = vi.fn(async () => ({ text: 'Route lookups to [[ss-search]] and stop early.', isError: false })); // dropped [[ss-grep]] + [[no-match]]
    const r = await runNoMatchSufficiency({ ...base, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(CANDIDATE);
    expect(r.rejection._kind).toBe(EVENT_KINDS.MUTATION_REJECTION);
    expect(r.rejection.op).toBe('no-match-sufficiency');
    expect(r.rejection.failures.some((f) => f.reason === 'missing-token')).toBe(true);
  });

  it('rejects on model error and falls back to the candidate', async () => {
    const callModel = vi.fn(async () => ({ text: 'overloaded', isError: true }));
    const r = await runNoMatchSufficiency({ ...base, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(CANDIDATE);
    expect(r.rejection.reason).toBe('model-error');
  });

  it('throws when callModel is not a function', async () => {
    await expect(runNoMatchSufficiency({ ...base, callModel: null })).rejects.toThrow(/callModel/);
  });
});
