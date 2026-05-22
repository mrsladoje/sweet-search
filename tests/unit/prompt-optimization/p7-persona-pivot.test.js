/**
 * Unit tests for core/prompt-optimization/sweep/op-persona-pivot.mjs
 * (OP-3 Persona / Constraint Pivot + AST-ification, §3.2 / §3.2.3).
 *
 * Covers:
 *  - STATEFUL_SUMMARY_RULE: verbatim §3.2.3 content
 *  - countConditionalRules: prose conditional detection
 *  - pickGenerator: anthropic default + every-3rd-round Kimi/GPT-5.5 rotation
 *  - buildPersonaPivotPrompt: mode-a format pivot vs mode-b AST-ification
 *    (labelled non-executable pseudocode, decision tables over fenced python)
 *  - runPersonaPivot: mode selection (≥3 rules → b), generator routing,
 *    validateMutation gate
 */

import { describe, it, expect, vi } from 'vitest';
import {
  STATEFUL_SUMMARY_RULE,
  countConditionalRules,
  pickGenerator,
  buildPersonaPivotPrompt,
  runPersonaPivot,
} from '../../../core/prompt-optimization/sweep/op-persona-pivot.mjs';
import { EVENT_KINDS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

// ─── fixtures ──────────────────────────────────────────────────────────────

const COND_CAND = [
  'If the query names a symbol then call [[ss-search]].',
  'When the task spans multiple files, prefer [[ss-trace]].',
  'For behavioral queries, invoke [[ss-semantic]].',
  'Unless the path is known, broaden the lookup.',
].join('\n');

const SIMPLE_CAND =
  'You are a code search agent. Prefer [[ss-search]] for quick lookups. ' +
  'Keep answers concise and grounded in retrieved evidence.';

// ─── STATEFUL_SUMMARY_RULE ─────────────────────────────────────────────────

describe('STATEFUL_SUMMARY_RULE (§3.2.3)', () => {
  it('is a non-empty string', () => {
    expect(typeof STATEFUL_SUMMARY_RULE).toBe('string');
    expect(STATEFUL_SUMMARY_RULE.length).toBeGreaterThan(50);
  });

  it('references the <state_summary> block before the 3rd tool call / final answer', () => {
    expect(STATEFUL_SUMMARY_RULE).toMatch(/<state_summary>/);
    expect(STATEFUL_SUMMARY_RULE).toMatch(/before your 3rd tool call/i);
    expect(STATEFUL_SUMMARY_RULE).toMatch(/before your final answer/i);
  });

  it('demands exactly the two required sentences (established + blind spot)', () => {
    expect(STATEFUL_SUMMARY_RULE).toMatch(/\(1\)/);
    expect(STATEFUL_SUMMARY_RULE).toMatch(/\(2\)/);
    expect(STATEFUL_SUMMARY_RULE).toMatch(/established/i);
    expect(STATEFUL_SUMMARY_RULE).toMatch(/blind spot/i);
  });
});

// ─── countConditionalRules ─────────────────────────────────────────────────

describe('countConditionalRules', () => {
  it('counts >=3 conditional routing rules in a rule-dense prompt', () => {
    expect(countConditionalRules(COND_CAND)).toBeGreaterThanOrEqual(3);
  });

  it('counts <3 for a prompt without conditional routing', () => {
    expect(countConditionalRules(SIMPLE_CAND)).toBeLessThan(3);
  });

  it('returns 0 for empty / non-string input', () => {
    expect(countConditionalRules('')).toBe(0);
    expect(countConditionalRules(null)).toBe(0);
    expect(countConditionalRules(42)).toBe(0);
  });
});

// ─── pickGenerator ─────────────────────────────────────────────────────────

describe('pickGenerator', () => {
  it('defaults to anthropic-api / claude-sonnet-4-6 on non-rotation rounds', () => {
    expect(pickGenerator(1)).toEqual({ lineage: 'anthropic-api', model: 'claude-sonnet-4-6' });
    expect(pickGenerator(2)).toEqual({ lineage: 'anthropic-api', model: 'claude-sonnet-4-6' });
    expect(pickGenerator(4)).toEqual({ lineage: 'anthropic-api', model: 'claude-sonnet-4-6' });
  });

  it('rotates to a non-Anthropic generator every 3rd round', () => {
    expect(pickGenerator(3)).toEqual({ lineage: 'moonshot', model: 'kimi-k2.6' });
    expect(pickGenerator(6)).toEqual({ lineage: 'openai-api', model: 'gpt-5.5' });
    expect(pickGenerator(9)).toEqual({ lineage: 'moonshot', model: 'kimi-k2.6' });
    expect(pickGenerator(12)).toEqual({ lineage: 'openai-api', model: 'gpt-5.5' });
  });

  it('falls back to the default for non-finite round', () => {
    expect(pickGenerator('x')).toEqual({ lineage: 'anthropic-api', model: 'claude-sonnet-4-6' });
    expect(pickGenerator(NaN)).toEqual({ lineage: 'anthropic-api', model: 'claude-sonnet-4-6' });
  });
});

// ─── buildPersonaPivotPrompt ───────────────────────────────────────────────

describe('buildPersonaPivotPrompt', () => {
  it('mode a → surface-format pivot, no AST-ification label', () => {
    const { systemPrompt } = buildPersonaPivotPrompt({ candidate: SIMPLE_CAND, mode: 'a' });
    expect(systemPrompt).toMatch(/surface format only/i);
    expect(systemPrompt).not.toMatch(/routing policy pseudocode — NOT executable code/);
  });

  it('mode b → AST-ification with the non-executable pseudocode label', () => {
    const { systemPrompt } = buildPersonaPivotPrompt({ candidate: COND_CAND, mode: 'b' });
    expect(systemPrompt).toMatch(/routing policy pseudocode — NOT executable code/);
  });

  it('mode b prefers decision tables over fenced python', () => {
    const { systemPrompt } = buildPersonaPivotPrompt({ candidate: COND_CAND, mode: 'b' });
    expect(systemPrompt).toMatch(/decision tables/i);
    expect(systemPrompt).toMatch(/python/i);
  });

  it('both modes carry the [[token]] protection + multiplicity constraints', () => {
    for (const mode of ['a', 'b']) {
      const { systemPrompt } = buildPersonaPivotPrompt({ candidate: COND_CAND, mode });
      expect(systemPrompt).toMatch(/PROTECTED/);
      expect(systemPrompt).toMatch(/multiplicity/i);
      expect(systemPrompt).toMatch(/NO\s+whitespace inside the brackets/i);
    }
  });

  it('embeds the candidate in the user prompt', () => {
    const { userPrompt } = buildPersonaPivotPrompt({ candidate: SIMPLE_CAND, mode: 'a' });
    expect(userPrompt).toContain(SIMPLE_CAND);
  });
});

// ─── runPersonaPivot ───────────────────────────────────────────────────────

describe('runPersonaPivot', () => {
  it('selects mode b when the candidate has >=3 conditional rules', async () => {
    const callModel = vi.fn(async () => ({ text: COND_CAND, isError: false }));
    const r = await runPersonaPivot({ candidate: COND_CAND, round: 1, callModel });
    expect(r.mode).toBe('b');
  });

  it('selects mode a for a low-conditional candidate', async () => {
    const callModel = vi.fn(async () => ({ text: SIMPLE_CAND, isError: false }));
    const r = await runPersonaPivot({ candidate: SIMPLE_CAND, round: 1, callModel });
    expect(r.mode).toBe('a');
  });

  it('routes through the default anthropic generator on round 1', async () => {
    const callModel = vi.fn(async () => ({ text: SIMPLE_CAND, isError: false }));
    const r = await runPersonaPivot({ candidate: SIMPLE_CAND, round: 1, callModel });
    const opts = callModel.mock.calls[0][0];
    expect(opts.lineage).toBe('anthropic-api');
    expect(opts.model).toBe('claude-sonnet-4-6');
    expect(r.generator).toEqual({ lineage: 'anthropic-api', model: 'claude-sonnet-4-6' });
  });

  it('rotates to Kimi on round 3', async () => {
    const callModel = vi.fn(async () => ({ text: SIMPLE_CAND, isError: false }));
    await runPersonaPivot({ candidate: SIMPLE_CAND, round: 3, callModel });
    const opts = callModel.mock.calls[0][0];
    expect(opts.lineage).toBe('moonshot');
    expect(opts.model).toBe('kimi-k2.6');
  });

  it('accepts a faithful restructure that preserves [[tokens]]', async () => {
    const restructured = 'Concise agent. Use [[ss-search]] for quick lookups; stay grounded.';
    const callModel = vi.fn(async () => ({ text: restructured, isError: false }));
    const r = await runPersonaPivot({ candidate: SIMPLE_CAND, round: 2, callModel });
    expect(r.accepted).toBe(true);
    expect(r.mutated).toBe(restructured);
  });

  it('rejects (and falls back to candidate) when a [[token]] is dropped', async () => {
    const callModel = vi.fn(async () => ({ text: 'Concise agent with no tools.', isError: false }));
    const r = await runPersonaPivot({ candidate: SIMPLE_CAND, round: 2, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(SIMPLE_CAND);
    expect(r.rejection._kind).toBe(EVENT_KINDS.MUTATION_REJECTION);
    expect(r.rejection.op).toBe('persona-pivot');
  });

  it('rejects on model error, returning the original candidate + generator/mode', async () => {
    const callModel = vi.fn(async () => ({ text: 'boom', isError: true }));
    const r = await runPersonaPivot({ candidate: COND_CAND, round: 3, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(COND_CAND);
    expect(r.rejection.reason).toBe('model-error');
    expect(r.mode).toBe('b');
    expect(r.generator).toEqual({ lineage: 'moonshot', model: 'kimi-k2.6' });
  });

  it('throws when callModel is not a function', async () => {
    await expect(runPersonaPivot({ candidate: SIMPLE_CAND, callModel: null })).rejects.toThrow(/callModel/);
  });

  it('throws when candidate is not a string', async () => {
    await expect(
      runPersonaPivot({ candidate: 123, callModel: async () => ({ text: '' }) }),
    ).rejects.toThrow(/candidate must be a string/);
  });
});
