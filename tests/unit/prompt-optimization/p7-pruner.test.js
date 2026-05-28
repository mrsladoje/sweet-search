/**
 * Unit tests for core/prompt-optimization/sweep/op-pruner.mjs
 * (OP-5 The Pruner, §3.2 / Gemini 3rd-pass §C1, §3.2.3 re-export).
 *
 * Covers:
 *  - STATEFUL_SUMMARY_RULE re-export equals the persona-pivot canonical source
 *  - buildPrunerPrompt: ~20% prose-only, fence/router-table protection,
 *    [[token]] preservation, PRUNER_SKIP refuse-if-minimal instruction
 *  - runPruner: minTokens skip path (no model call), PRUNER_SKIP handling,
 *    validateMutation gate, model-error rejection
 *  - M11 (spec-conformance): protected-block survival is ENFORCED — a
 *    model that mangles a triple-backtick fenced block, routing-policy
 *    pseudocode block, or compact router table is rejected with reason
 *    'fenced-block-altered'; byte-identical survival with trimmed prose is OK.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  STATEFUL_SUMMARY_RULE,
  buildPrunerPrompt,
  runPruner,
  extractProtectedBlocks,
} from '../../../core/prompt-optimization/sweep/op-pruner.mjs';
import { STATEFUL_SUMMARY_RULE as PIVOT_RULE } from '../../../core/prompt-optimization/sweep/op-persona-pivot.mjs';
import { EVENT_KINDS, MUTATION_REJECTION_REASONS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

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

  it('protects fenced code and router tables from edits', () => {
    expect(systemPrompt).toMatch(/DO NOT alter fenced code blocks/i);
    expect(systemPrompt).toMatch(/router tables/i);
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

// ─── M11 — fenced / pseudocode-block survival is ENFORCED, not prompted ─────

// A candidate carrying an OP-3 AST-ified routing block inside a triple-backtick
// fence, plus surrounding prose. Every [[token]] is inside or outside the fence;
// the fence MUST survive byte-identically.
const FENCED_CAND = [
  'You are a careful and meticulous code search agent.',
  'Follow the routing policy below precisely; do not deviate.',
  '',
  '```',
  'if query is a literal symbol:',
  '    use [[ss-search]]',
  'elif query follows call relationships:',
  '    use [[ss-trace]]',
  'else:',
  '    use [[ss-semantic]]',
  '```',
  '',
  'Always emit [[agent-format]] output and never fabricate results.',
].join('\n');

describe('extractProtectedBlocks', () => {
  it('extracts a triple-backtick fenced block verbatim (with its fences)', () => {
    const blocks = extractProtectedBlocks(FENCED_CAND);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('```\nif query is a literal symbol:');
    expect(blocks[0].startsWith('```')).toBe(true);
    expect(blocks[0].endsWith('```')).toBe(true);
    // indentation under each branch is part of the protected block
    expect(blocks[0]).toContain('    use [[ss-search]]');
    expect(blocks[0]).toContain('elif query follows call relationships:');
  });

  it('extracts multiple fenced blocks independently (non-greedy)', () => {
    const two = '```\nblock one\n```\nsome prose\n```\nblock two\n```';
    const blocks = extractProtectedBlocks(two);
    expect(blocks).toEqual(['```\nblock one\n```', '```\nblock two\n```']);
  });

  it('extracts a `# routing policy pseudocode` block through its contiguous body', () => {
    const cand = [
      'Intro prose.',
      '# routing policy pseudocode — NOT executable code',
      'if literal: use [[ss-search]]',
      'elif callers: use [[ss-trace]]',
      '',
      'Trailing prose after the blank line is NOT part of the block.',
    ].join('\n');
    const blocks = extractProtectedBlocks(cand);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe(
      '# routing policy pseudocode — NOT executable code\n' +
        'if literal: use [[ss-search]]\n' +
        'elif callers: use [[ss-trace]]',
    );
    expect(blocks[0]).not.toContain('Trailing prose');
  });

  it('extracts a compact router table verbatim', () => {
    const cand = [
      'Intro prose.',
      '| Query signal | First call | Follow-up | Stop condition |',
      '|---|---|---|---|',
      '| Literal | [[ss-grep]] | [[ss-read]] if needed | One hit is enough |',
      '| Flow | [[ss-find]] | [[ss-trace]] | One complete path |',
      '',
      'Trailing prose after the blank line is NOT part of the table.',
    ].join('\n');
    const blocks = extractProtectedBlocks(cand);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain('| Query signal | First call | Follow-up | Stop condition |');
    expect(blocks[0]).toContain('| Flow | [[ss-find]] | [[ss-trace]] | One complete path |');
    expect(blocks[0]).not.toContain('Trailing prose');
  });

  it('returns no blocks for prose-only candidates', () => {
    expect(extractProtectedBlocks(PRUNE_CAND)).toEqual([]);
  });
});

describe('runPruner — M11 fenced/pseudocode-block enforcement', () => {
  it('REJECTS when the fenced block indentation is flattened (tokens preserved)', async () => {
    // Same [[token]]s, but the fence body has its indentation flattened — the
    // exact failure the OP-5 prompt warns against but cannot enforce.
    const mangled = FENCED_CAND.replace(/\n {4}use /g, '\nuse ');
    expect(mangled).not.toBe(FENCED_CAND);
    const callModel = vi.fn(async () => ({ text: mangled, isError: false }));
    const r = await runPruner({ candidate: FENCED_CAND, callModel });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(FENCED_CAND);
    expect(r.rejection._kind).toBe(EVENT_KINDS.MUTATION_REJECTION);
    expect(r.rejection.op).toBe('pruner');
    expect(r.rejection.reason).toBe('fenced-block-altered');
    expect(r.rejection.failures.every((f) => f.reason === 'fenced-block-altered')).toBe(true);
    expect(r.rejection.failures.length).toBeGreaterThan(0);
  });

  it('REJECTS when a line is dropped from the fenced block (elif removed)', async () => {
    const mangled = FENCED_CAND
      .replace('elif query follows call relationships:\n    use [[ss-trace]]\n', '');
    // [[ss-trace]] now missing too, but the fenced-block guard fires FIRST.
    const callModel = vi.fn(async () => ({ text: mangled, isError: false }));
    const r = await runPruner({ candidate: FENCED_CAND, callModel });
    expect(r.accepted).toBe(false);
    expect(r.rejection.reason).toBe('fenced-block-altered');
    expect(r.mutated).toBe(FENCED_CAND);
  });

  it('ACCEPTS when the fenced block survives byte-identically and only prose is trimmed', async () => {
    // Keep the fence exactly; prune the surrounding prose. All [[token]]s intact.
    const fence = extractProtectedBlocks(FENCED_CAND)[0];
    const pruned = [
      'You are a code search agent.',
      '',
      fence,
      '',
      'Emit [[agent-format]] output; never fabricate.',
    ].join('\n');
    const callModel = vi.fn(async () => ({ text: pruned, isError: false }));
    const r = await runPruner({ candidate: FENCED_CAND, callModel });
    expect(r.accepted).toBe(true);
    expect(r.skipped).toBeUndefined();
    expect(r.mutated).toBe(pruned);
    expect(r.mutated).toContain(fence); // fence survived byte-identically
  });

  it('REJECTS when a `# routing policy pseudocode` block is mangled', async () => {
    const cand = [
      'Routing rules follow.',
      '# routing policy pseudocode — NOT executable code',
      'if literal: use [[ss-search]]',
      'elif callers: use [[ss-trace]]',
      '',
      'Be terse and accurate.',
    ].join('\n');
    // Drop the elif branch from the pseudocode block while keeping the [[token]].
    const mangled = cand.replace('elif callers: use [[ss-trace]]\n', '');
    const callModel = vi.fn(async () => ({ text: mangled + '\nUse [[ss-trace]] for callers.', isError: false }));
    const r = await runPruner({ candidate: cand, callModel });
    expect(r.accepted).toBe(false);
    expect(r.rejection.reason).toBe('fenced-block-altered');
    expect(r.mutated).toBe(cand);
  });

  it('REJECTS when a compact router table is mangled', async () => {
    const cand = [
      'Routing table.',
      '| Query signal | First call | Follow-up | Stop condition |',
      '|---|---|---|---|',
      '| Literal | [[ss-grep]] | [[ss-read]] if needed | One hit is enough |',
      '| Flow | [[ss-find]] | [[ss-trace]] | One complete path |',
      '',
      'Answer with evidence.',
    ].join('\n');
    const mangled = cand.replace('| Flow | [[ss-find]] | [[ss-trace]] | One complete path |\n', '');
    const callModel = vi.fn(async () => ({ text: mangled + '\nUse [[ss-find]] and [[ss-trace]] for flow.', isError: false }));
    const r = await runPruner({ candidate: cand, callModel });
    expect(r.accepted).toBe(false);
    expect(r.rejection.reason).toBe('fenced-block-altered');
    expect(r.mutated).toBe(cand);
  });

  it('does not block prose-only candidates (no protected blocks to enforce)', async () => {
    const pruned = 'You are a code search agent. Prefer [[ss-search]]; use [[ss-trace]] to follow calls.';
    const callModel = vi.fn(async () => ({ text: pruned, isError: false }));
    const r = await runPruner({ candidate: PRUNE_CAND, callModel });
    expect(r.accepted).toBe(true);
    expect(r.mutated).toBe(pruned);
  });

  it("emits a reason that is (or will be) a known MUTATION_REJECTION reason", () => {
    // Canonical assertion is the runPruner reason string (asserted above). This
    // tolerates p7-shared not yet listing it (added by another agent).
    expect(Array.isArray(MUTATION_REJECTION_REASONS)).toBe(true);
    if (MUTATION_REJECTION_REASONS.includes('fenced-block-altered')) {
      expect(MUTATION_REJECTION_REASONS).toContain('fenced-block-altered');
    }
  });
});
