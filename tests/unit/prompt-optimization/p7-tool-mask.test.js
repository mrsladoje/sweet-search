/**
 * Unit tests for core/prompt-optimization/sweep/op-tool-mask.mjs
 * (OP-4 Tool-Signature Masking, §3.2 / Gemini §A3).
 *
 * Covers:
 *  - makeAliasMap: deterministic permutation of ss-* → TOOL_ALPHA..DELTA via mulberry32
 *  - applyMask / unMask: roundtrip identity, escaped-bracket safety
 *  - buildToolMaskPrompt: domain-stripped framing (no code/repository/search/semantic)
 *  - runToolMask: mask → callModel → unMask → validate; alias survival → reject
 */

import { describe, it, expect, vi } from 'vitest';
import {
  makeAliasMap,
  applyMask,
  unMask,
  buildToolMaskPrompt,
  runToolMask,
} from '../../../core/prompt-optimization/sweep/op-tool-mask.mjs';
import { OP4_ALIASES, EVENT_KINDS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';
import { mulberry32 } from '../../../core/prompt-optimization/stats/rng.mjs';

const MASKABLE = ['[[ss-search]]', '[[ss-find]]', '[[ss-semantic]]', '[[ss-trace]]'];
const ALIAS_TOKENS = OP4_ALIASES.map((a) => `[[${a}]]`);

// helper: pull the masked candidate back out of the runner's userPrompt
const extractMasked = (userPrompt) => userPrompt.match(/```\n([\s\S]*?)\n```/)[1];

// ─── makeAliasMap ──────────────────────────────────────────────────────────

describe('makeAliasMap', () => {
  it('maps all four maskable tools to four distinct aliases (a permutation)', () => {
    const map = makeAliasMap(mulberry32(42));
    expect(map.size).toBe(4);
    expect([...map.keys()].sort()).toEqual([...MASKABLE].sort());
    const vals = [...map.values()];
    expect(new Set(vals).size).toBe(4);
    expect(vals.sort()).toEqual([...ALIAS_TOKENS].sort());
  });

  it('is deterministic for the same seed', () => {
    const a = makeAliasMap(mulberry32(123));
    const b = makeAliasMap(mulberry32(123));
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('throws when rng is not a function', () => {
    expect(() => makeAliasMap(null)).toThrow(/rng must be a function/);
  });
});

// ─── applyMask / unMask ────────────────────────────────────────────────────

describe('applyMask / unMask', () => {
  const map = makeAliasMap(mulberry32(7));
  const text = 'Prefer [[ss-search]], escalate to [[ss-trace]], confirm with [[ss-read]].';

  it('applyMask replaces every maskable tool token with its alias', () => {
    const masked = applyMask(text, map);
    expect(masked).not.toMatch(/\[\[ss-search\]\]/);
    expect(masked).not.toMatch(/\[\[ss-trace\]\]/);
    // non-maskable tokens pass through untouched
    expect(masked).toMatch(/\[\[ss-read\]\]/);
    // an alias is now present
    expect(ALIAS_TOKENS.some((a) => masked.includes(a))).toBe(true);
  });

  it('unMask(applyMask(x)) === x (roundtrip identity)', () => {
    expect(unMask(applyMask(text, map), map)).toBe(text);
  });

  it('roundtrips repeated tokens correctly', () => {
    const t = '[[ss-search]] then [[ss-search]] then [[ss-find]]';
    expect(unMask(applyMask(t, map), map)).toBe(t);
  });

  it('applyMask throws on non-string', () => {
    expect(() => applyMask(123, map)).toThrow(/text must be string/);
  });

  it('unMask throws on non-string', () => {
    expect(() => unMask(null, map)).toThrow(/text must be string/);
  });
});

// ─── buildToolMaskPrompt ───────────────────────────────────────────────────

describe('buildToolMaskPrompt — domain stripping', () => {
  const { systemPrompt, userPrompt } = buildToolMaskPrompt({ maskedCandidate: '[[TOOL_ALPHA]] x [[TOOL_BETA]]' });

  it('frames tools generically (database / regex-anchor / vector-similarity / graph-traversal)', () => {
    expect(systemPrompt).toMatch(/database/i);
    expect(systemPrompt).toMatch(/regex-anchor/i);
    expect(systemPrompt).toMatch(/vector-similarity/i);
    expect(systemPrompt).toMatch(/graph-traversal/i);
  });

  it('NEVER leaks the code-search domain words', () => {
    expect(systemPrompt).not.toMatch(/\bcode\b/i);
    expect(systemPrompt).not.toMatch(/\brepositor/i);
    expect(systemPrompt).not.toMatch(/\bsearch\b/i);
    expect(systemPrompt).not.toMatch(/\bsemantic\b/i);
  });

  it('declares all four alias tokens as protected', () => {
    for (const alias of ALIAS_TOKENS) expect(systemPrompt).toContain(alias);
    expect(systemPrompt).toMatch(/multiplicity/i);
  });

  it('embeds the masked candidate in the user prompt', () => {
    expect(userPrompt).toContain('[[TOOL_ALPHA]] x [[TOOL_BETA]]');
  });
});

// ─── runToolMask ───────────────────────────────────────────────────────────

describe('runToolMask', () => {
  const CAND = 'Use [[ss-search]] for lookups, [[ss-trace]] for flows, and [[ss-read]] to confirm.';

  it('masks tool names before the model sees them, then unmasks faithfully', async () => {
    let seenUserPrompt = '';
    const callModel = vi.fn(async ({ userPrompt }) => {
      seenUserPrompt = userPrompt;
      return { text: extractMasked(userPrompt), isError: false }; // echo masked back
    });
    const r = await runToolMask({ candidate: CAND, callModel, rng: mulberry32(99) });

    // model never saw the raw maskable tool names
    expect(seenUserPrompt).not.toMatch(/\[\[ss-search\]\]/);
    expect(seenUserPrompt).not.toMatch(/\[\[ss-trace\]\]/);

    expect(r.accepted).toBe(true);
    expect(r.mutated).toBe(CAND); // roundtrip restored
    expect(r.aliasMap).toBeInstanceOf(Map);
  });

  it('routes to moonshot / kimi-k2.6', async () => {
    const callModel = vi.fn(async ({ userPrompt }) => ({ text: extractMasked(userPrompt), isError: false }));
    await runToolMask({ candidate: CAND, callModel, rng: mulberry32(1) });
    const opts = callModel.mock.calls[0][0];
    expect(opts.lineage).toBe('moonshot');
    expect(opts.model).toBe('kimi-k2.6');
  });

  it('rejects when an alias survives the back-mapping (alias survival → reject)', async () => {
    const callModel = vi.fn(async ({ userPrompt }) => ({
      // echo masked body but inject a spaced alias unMask will miss
      text: `${extractMasked(userPrompt)}\nLeftover: [[ TOOL_ALPHA ]]`,
      isError: false,
    }));
    const r = await runToolMask({ candidate: CAND, callModel, rng: mulberry32(2) });
    expect(r.accepted).toBe(false);
    expect(r.rejection._kind).toBe(EVENT_KINDS.MUTATION_REJECTION);
    expect(r.rejection.op).toBe('tool-mask');
    expect(r.rejection.failures.some((f) => f.reason === 'unmapped-alias')).toBe(true);
  });

  it('rejects when tool tokens go missing in the mutation', async () => {
    const callModel = vi.fn(async () => ({ text: 'A rewritten prompt with no tools at all.', isError: false }));
    const r = await runToolMask({ candidate: CAND, callModel, rng: mulberry32(3) });
    expect(r.accepted).toBe(false);
    expect(r.rejection.failures.some((f) => f.reason === 'missing-token')).toBe(true);
  });

  it('rejects on model error and returns the original candidate', async () => {
    const callModel = vi.fn(async () => ({ text: 'overloaded', isError: true }));
    const r = await runToolMask({ candidate: CAND, callModel, rng: mulberry32(4) });
    expect(r.accepted).toBe(false);
    expect(r.mutated).toBe(CAND);
    expect(r.rejection.reason).toBe('model-error');
  });

  it('throws when callModel is not a function', async () => {
    await expect(runToolMask({ candidate: CAND, callModel: null })).rejects.toThrow(/callModel/);
  });

  it('throws when candidate is not a string', async () => {
    await expect(runToolMask({ candidate: {}, callModel: async () => ({ text: '' }) })).rejects.toThrow(
      /candidate must be a string/,
    );
  });
});
