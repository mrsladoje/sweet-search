/**
 * Unit tests for core/prompt-optimization/sweep/op-trajectory-crossover.mjs
 * (OP-2 Contrastive Trajectory Crossover, §3.2 / GPT-5.5 review §B3).
 *
 * Covers:
 *  - buildTrajectoryCrossoverPrompt: target-tagging, bottleneck classification
 *    (sonnet-only / gpt-only / joint balanced pair), reflectionHint hard negative,
 *    [[token]] preservation instruction
 *  - runTrajectoryCrossover: moonshot/kimi-k2.6 routing, validateMutation gate,
 *    model-error + token-corruption rejection
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildTrajectoryCrossoverPrompt,
  runTrajectoryCrossover,
} from '../../../core/prompt-optimization/sweep/op-trajectory-crossover.mjs';
import { EVENT_KINDS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

// ─── fixtures ──────────────────────────────────────────────────────────────

const PROBE = { id: 'JS-014', query: 'Where is the retry policy configured?' };
const PROMPT_A = 'WINNING: route literal lookups to [[ss-search]], deep flows to [[ss-trace]].';
const PROMPT_B = 'LOSING: just call [[ss-search]] once and answer.';

const trajSonnet = { target: 'sonnet', toolCalls: [{ tool: 'ss-search' }, { tool: 'ss-trace' }], answer: 'config.js:42' };
const trajGpt = { target: 'gpt5_5', toolCalls: [{ tool: 'ss-search' }], answer: 'unknown' };

// ─── buildTrajectoryCrossoverPrompt ────────────────────────────────────────

describe('buildTrajectoryCrossoverPrompt', () => {
  it('returns { systemPrompt, userPrompt } strings', () => {
    const { systemPrompt, userPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: trajSonnet,
      trajectoryB: trajGpt,
    });
    expect(typeof systemPrompt).toBe('string');
    expect(typeof userPrompt).toBe('string');
    expect(systemPrompt.length).toBeGreaterThan(50);
  });

  it('tags each trajectory with its target in the user prompt', () => {
    const { userPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: trajSonnet,
      trajectoryB: trajGpt,
    });
    expect(userPrompt).toMatch(/target: sonnet/);
    expect(userPrompt).toMatch(/target: gpt5_5/);
  });

  it('classifies a joint bottleneck as a balanced pair when both targets won', () => {
    const { systemPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: { target: 'sonnet' },
      trajectoryB: { target: 'gpt5_5' },
    });
    expect(systemPrompt).toMatch(/COMPATIBLE WITH BOTH/i);
    expect(systemPrompt).toMatch(/Both Sonnet and GPT-5\.5/);
  });

  it('classifies sonnet-only bottleneck (only sonnet has a winning trajectory)', () => {
    const { systemPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: { target: 'sonnet' },
      trajectoryB: null,
    });
    expect(systemPrompt).toMatch(/BOTTLENECK: Sonnet-only/);
    expect(systemPrompt).toMatch(/Do NOT import Sonnet's exploration cadence/);
  });

  it('classifies gpt-only bottleneck (only gpt has a winning trajectory)', () => {
    const { systemPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: { target: 'gpt5_5' },
      trajectoryB: null,
    });
    expect(systemPrompt).toMatch(/BOTTLENECK: GPT-only/);
  });

  it('honours an explicit bottleneck override', () => {
    const { systemPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: { target: 'sonnet' },
      trajectoryB: { target: 'gpt5_5' },
      bottleneck: 'gpt-only',
    });
    expect(systemPrompt).toMatch(/BOTTLENECK: GPT-only/);
    expect(systemPrompt).not.toMatch(/COMPATIBLE WITH BOTH/i);
  });

  it('injects the reflectionHint as an overriding HARD NEGATIVE constraint', () => {
    const { systemPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: trajSonnet,
      trajectoryB: trajGpt,
      reflectionHint: 'Stop telling the agent to read entire files.',
    });
    expect(systemPrompt).toMatch(/HARD NEGATIVE CONSTRAINT/);
    expect(systemPrompt).toMatch(/Stop telling the agent to read entire files\./);
    expect(systemPrompt).toMatch(/overrides all other guidance/i);
  });

  it('omits the hard-negative block when no reflectionHint is given', () => {
    const { systemPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: trajSonnet,
      trajectoryB: trajGpt,
    });
    expect(systemPrompt).not.toMatch(/HARD NEGATIVE CONSTRAINT/);
  });

  it('instructs the reflector to preserve [[tokens]] verbatim', () => {
    const { systemPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: trajSonnet,
      trajectoryB: trajGpt,
    });
    expect(systemPrompt).toMatch(/\[\[ \]\]/);
    expect(systemPrompt).toMatch(/NO whitespace inside the brackets/i);
  });

  it('embeds the probe id, query and both candidate prompts', () => {
    const { userPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: trajSonnet,
      trajectoryB: trajGpt,
    });
    expect(userPrompt).toMatch(/JS-014/);
    expect(userPrompt).toContain(PROBE.query);
    expect(userPrompt).toContain(PROMPT_A);
    expect(userPrompt).toContain(PROMPT_B);
  });

  it('adds a PRIMARY cost objective with the $ figures when costContext is provided', () => {
    const { systemPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: trajSonnet,
      trajectoryB: trajGpt,
      costContext: { costWinner: 0.10, costLoser: 0.30, callsWinner: 3, callsLoser: 9 },
    });
    expect(systemPrompt).toMatch(/Cost objective \(PRIMARY\)/);
    expect(systemPrompt).toMatch(/\$0\.1000/);
    expect(systemPrompt).toMatch(/\$0\.3000/);
    expect(systemPrompt).toMatch(/3\.0× more/);
    expect(systemPrompt).toMatch(/REDUCED cost/);
    expect(systemPrompt).toMatch(/3 tool call\(s\)/);
    expect(systemPrompt).toMatch(/9 tool call\(s\)/);
  });

  it('omits the cost objective when no costContext is given', () => {
    const { systemPrompt } = buildTrajectoryCrossoverPrompt({
      probe: PROBE,
      promptA: PROMPT_A,
      promptB: PROMPT_B,
      trajectoryA: trajSonnet,
      trajectoryB: trajGpt,
    });
    expect(systemPrompt).not.toMatch(/Cost objective/);
  });
});

// ─── runTrajectoryCrossover ────────────────────────────────────────────────

describe('runTrajectoryCrossover', () => {
  const baseArgs = {
    probe: PROBE,
    promptA: PROMPT_A,
    promptB: PROMPT_B,
    trajectoryA: trajSonnet,
    trajectoryB: trajGpt,
  };

  it('routes to moonshot / kimi-k2.6 by default', async () => {
    const callModel = vi.fn(async () => ({ text: PROMPT_A, isError: false }));
    await runTrajectoryCrossover({ ...baseArgs, callModel });
    const opts = callModel.mock.calls[0][0];
    expect(opts.lineage).toBe('moonshot');
    expect(opts.model).toBe('kimi-k2.6');
  });

  it('honours a reflector model override', async () => {
    const callModel = vi.fn(async () => ({ text: PROMPT_A, isError: false }));
    await runTrajectoryCrossover({ ...baseArgs, callModel, reflector: 'kimi-k2.6-turbo' });
    expect(callModel.mock.calls[0][0].model).toBe('kimi-k2.6-turbo');
  });

  it('accepts a mutation that preserves every [[token]]', async () => {
    const merged = 'MERGED: use [[ss-search]] for lookups and [[ss-trace]] for flows.';
    const callModel = vi.fn(async () => ({ text: merged, isError: false }));
    const r = await runTrajectoryCrossover({ ...baseArgs, callModel });
    expect(r.accepted).toBe(true);
    expect(r.mutated).toBe(merged);
  });

  it('rejects (and falls back to promptA) when a [[token]] is dropped', async () => {
    const broken = 'MERGED but only [[ss-search]] survived.';
    const callModel = vi.fn(async () => ({ text: broken, isError: false }));
    const r = await runTrajectoryCrossover({ ...baseArgs, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(PROMPT_A);
    expect(r.rejection._kind).toBe(EVENT_KINDS.MUTATION_REJECTION);
    expect(r.rejection.op).toBe('trajectory-crossover');
    expect(r.rejection.failures.some((f) => f.reason === 'missing-token')).toBe(true);
  });

  it('rejects on model error and falls back to promptA', async () => {
    const callModel = vi.fn(async () => ({ text: 'rate limited', isError: true }));
    const r = await runTrajectoryCrossover({ ...baseArgs, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(PROMPT_A);
    expect(r.rejection.reason).toBe('model-error');
  });

  it('throws when callModel is not a function', async () => {
    await expect(runTrajectoryCrossover({ ...baseArgs, callModel: null })).rejects.toThrow(/callModel/);
  });
});
