/**
 * Unit tests for core/prompt-optimization/sweep/op-persona-pivot.mjs
 * (OP-3 Persona / Constraint Pivot + compact router tables, §3.2 / §3.2.3).
 *
 * Covers:
 *  - STATEFUL_SUMMARY_RULE: verbatim §3.2.3 content
 *  - countConditionalRules: prose conditional detection
 *  - pickGenerator: anthropic default + every-3rd-round Kimi/GPT-5.5 rotation
 *  - buildPersonaPivotPrompt: mode-a format pivot vs mode-b router table
 *    (compact routing table; no AST/procedure/pseudocode/fenced code)
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

  it('references the <state_summary> block before the third sweet-search query / final answer', () => {
    expect(STATEFUL_SUMMARY_RULE).toMatch(/<state_summary>/);
    expect(STATEFUL_SUMMARY_RULE).toMatch(/before your third sweet-search query/i);
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
  it('mode a → surface-format pivot, no router-table consolidation', () => {
    const { systemPrompt } = buildPersonaPivotPrompt({ candidate: SIMPLE_CAND, mode: 'a' });
    expect(systemPrompt).toMatch(/surface format only/i);
    expect(systemPrompt).not.toMatch(/router table/i);
  });

  it('mode b → compact router table consolidation', () => {
    const { systemPrompt } = buildPersonaPivotPrompt({ candidate: COND_CAND, mode: 'b' });
    expect(systemPrompt).toMatch(/compact router table/i);
    expect(systemPrompt).toMatch(/Query signal \| First call \| Follow-up \| Stop condition/);
  });

  it('mode b forbids AST, procedure, pseudocode, flowchart, and fenced code outputs', () => {
    const { systemPrompt } = buildPersonaPivotPrompt({ candidate: COND_CAND, mode: 'b' });
    expect(systemPrompt).toMatch(/Do NOT create ASTs, procedure blocks, pseudocode blocks, flowcharts, or fenced code/);
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

// ─── OP-3 ↔ OP-5 cooperation: mode-b output validation ────────────────────
// The whole point of mode-b is to produce a router table that op-pruner's
// extractProtectedBlocks() will later protect. The detection regex anchors
// on a header row containing both "Query signal" and "First call"
// (case-insensitive). If the mutator paraphrases those column names, the
// resulting table is NOT protected and a downstream OP-5 pass would
// silently delete the routing rules. These tests pin the cooperation
// contract: mode-b output MUST contain a table whose header survives the
// OP-5 detection regex, or the mutation is REJECTED rather than silently
// admitted into the front. The detection regex is duplicated (intentionally)
// in op-persona-pivot.mjs:containsRouterTable; the last test pipes mode-b
// output through op-pruner.extractProtectedBlocks to catch drift between
// the two regexes.
describe('OP-3 mode-b ↔ OP-5 cooperation — router-table header validation', () => {
  // A candidate with enough conditional rules to trip mode-b. Each [[token]]
  // appears exactly once so the mutator's table can echo the same multiplicity.
  const COND_CAND_LOCAL =
    'You are a code search agent.\n\n' +
    'When the query is a literal anchor, use [[ss-grep]].\n' +
    'When the symbol is known, use [[ss-find]].\n' +
    'For unknown prose, use [[ss-search]].\n' +
    'Unless the question is about flow, otherwise use [[ss-trace]].\n' +
    'For multi-file queries, prefer the same flow after an anchor.\n';

  const canonicalTableOutput =
    'You are a code search agent.\n\n' +
    '| Query signal | First call | Follow-up | Stop condition |\n' +
    '|---|---|---|---|\n' +
    '| Literal anchor | [[ss-grep]] | inspect the hit | One hit is enough |\n' +
    '| Known symbol | [[ss-find]] | confirm the definition | Once the symbol is clear |\n' +
    '| Unknown prose | [[ss-search]] | narrow the span | Once the span answers |\n' +
    '| Multi-file flow | [[ss-trace]] | follow callers | One complete path |\n';

  it('ACCEPTS mode-b output with canonical "Query signal | First call" header', async () => {
    const callModel = vi.fn(async () => ({ text: canonicalTableOutput, isError: false }));
    const r = await runPersonaPivot({ candidate: COND_CAND_LOCAL, round: 1, callModel });
    expect(r.mode).toBe('b');
    expect(r.accepted).toBe(true);
    expect(r.mutated).toBe(canonicalTableOutput);
  });

  it('REJECTS mode-b output that paraphrases the header to "Query type | Primary tool" (silent-failure prevention)', async () => {
    // [[token]]s all preserved at the same multiplicity → token-validator
    // would accept. But the header has been paraphrased, so OP-5 would not
    // protect it. Without the new gate, this would silently land on the
    // front and be deleted by the next OP-5 pruner pass.
    const paraphrasedHeader =
      'You are a code search agent.\n\n' +
      '| Query type | Primary tool | Follow-up | Stop |\n' +
      '|---|---|---|---|\n' +
      '| Literal anchor | [[ss-grep]] | inspect the hit | One hit is enough |\n' +
      '| Known symbol | [[ss-find]] | confirm the definition | Once the symbol is clear |\n' +
      '| Unknown prose | [[ss-search]] | narrow the span | Once the span answers |\n' +
      '| Multi-file flow | [[ss-trace]] | follow callers | One complete path |\n';
    const callModel = vi.fn(async () => ({ text: paraphrasedHeader, isError: false }));
    const r = await runPersonaPivot({ candidate: COND_CAND_LOCAL, round: 1, callModel });
    expect(r.mode).toBe('b');
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(COND_CAND_LOCAL); // fell back to source
    expect(r.rejection._kind).toBe(EVENT_KINDS.MUTATION_REJECTION);
    expect(r.rejection.op).toBe('persona-pivot');
    expect(r.rejection.reason).toBe('router-table-header-missing');
    expect(r.rejection.failures[0].reason).toBe('router-table-header-missing');
  });

  it('REJECTS mode-b output that omits the table entirely (rewrote rules as prose)', async () => {
    // Some LLMs will "consolidate" routing rules into a short paragraph
    // instead of a table. Same hazard: no protected block downstream.
    const noTable =
      'You are a code search agent. For literal anchors, call [[ss-grep]]; for known symbols, call [[ss-find]]; for unknown prose, call [[ss-search]]; for flow or multi-file queries, call [[ss-trace]] after an anchor.';
    const callModel = vi.fn(async () => ({ text: noTable, isError: false }));
    const r = await runPersonaPivot({ candidate: COND_CAND_LOCAL, round: 1, callModel });
    expect(r.accepted).toBe(false);
    expect(r.rejection.reason).toBe('router-table-header-missing');
  });

  it('mode "a" does NOT enforce the router-table check (mode-a never emits tables)', async () => {
    // SIMPLE_CAND has <3 conditional rules, so mode-a is selected.
    // The output has no router table, but that is fine in mode-a.
    const callModel = vi.fn(async () => ({ text: 'Concise agent. Use [[ss-search]].', isError: false }));
    const r = await runPersonaPivot({ candidate: 'Concise agent. Use [[ss-search]].', round: 1, callModel });
    expect(r.mode).toBe('a');
    expect(r.accepted).toBe(true);
  });

  it('mode-b accepted output is detectable by op-pruner.extractProtectedBlocks (drift catcher)', async () => {
    // The detection regex is duplicated in op-pruner.mjs and op-persona-pivot.mjs
    // to avoid a circular import. This test pipes mode-b accepted output
    // through extractProtectedBlocks; if the two regexes ever drift, this
    // test fails before any live run wastes a slot.
    const { extractProtectedBlocks } = await import('../../../core/prompt-optimization/sweep/op-pruner.mjs');
    const callModel = vi.fn(async () => ({ text: canonicalTableOutput, isError: false }));
    const r = await runPersonaPivot({ candidate: COND_CAND_LOCAL, round: 1, callModel });
    expect(r.accepted).toBe(true);
    const blocks = extractProtectedBlocks(r.mutated);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks.some((b) => /\|\s*Query signal\s*\|/.test(b) && /\|\s*First call\s*\|/.test(b))).toBe(true);
  });

  it('mode-b prompt tells the mutator the header is hard-required (auto-validator will REJECT paraphrases)', () => {
    const { systemPrompt } = buildPersonaPivotPrompt({ candidate: COND_CAND_LOCAL, mode: 'b' });
    expect(systemPrompt).toMatch(/header row MUST contain/i);
    expect(systemPrompt).toMatch(/"Query signal" and "First call"/);
    expect(systemPrompt).toMatch(/automated validator/i);
    expect(systemPrompt).toMatch(/REJECTED/);
  });
});
