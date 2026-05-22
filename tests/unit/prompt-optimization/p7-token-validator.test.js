/**
 * Unit tests for core/prompt-optimization/sweep/token-validator.mjs (§3.2.1).
 *
 * Covers:
 *  - normalizeBrackets: collapses internal whitespace, leaves non-tokens alone
 *  - extractTokens: Map<token,count> with multiplicity
 *  - validateMutation: missing / multiplicity-changed / surplus / unmapped-alias,
 *    the tool-mask-premap skip, and whitespace-as-a-fix (not a failure)
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeBrackets,
  extractTokens,
  validateMutation,
} from '../../../core/prompt-optimization/sweep/token-validator.mjs';

// ─── normalizeBrackets ─────────────────────────────────────────────────────

describe('normalizeBrackets', () => {
  it('collapses leading/trailing whitespace inside [[ ]]', () => {
    expect(normalizeBrackets('[[  ss-search ]]')).toBe('[[ss-search]]');
    expect(normalizeBrackets('[[ ss-find ]]')).toBe('[[ss-find]]');
    expect(normalizeBrackets('[[TOOL_ALPHA]]')).toBe('[[TOOL_ALPHA]]');
  });

  it('normalises every occurrence in a longer string', () => {
    const text = 'use [[ ss-search ]] then [[ss-trace]] and [[  ss-read  ]]';
    expect(normalizeBrackets(text)).toBe('use [[ss-search]] then [[ss-trace]] and [[ss-read]]');
  });

  it('leaves prose and non-token brackets untouched', () => {
    expect(normalizeBrackets('an array[0] and obj["k"]')).toBe('an array[0] and obj["k"]');
  });

  it('throws on non-string input', () => {
    expect(() => normalizeBrackets(42)).toThrow(/string required/);
  });
});

// ─── extractTokens ─────────────────────────────────────────────────────────

describe('extractTokens', () => {
  it('returns a Map of token → count', () => {
    const m = extractTokens('use [[ss-search]] and [[ss-find]]');
    expect(m).toBeInstanceOf(Map);
    expect(m.get('[[ss-search]]')).toBe(1);
    expect(m.get('[[ss-find]]')).toBe(1);
    expect(m.size).toBe(2);
  });

  it('records multiplicity when a token repeats', () => {
    const m = extractTokens('[[ss-search]] ... [[ss-search]] ... [[ss-search]]');
    expect(m.get('[[ss-search]]')).toBe(3);
    expect(m.size).toBe(1);
  });

  it('normalises whitespace before counting, so spaced/unspaced collapse together', () => {
    const m = extractTokens('[[ ss-search ]] and [[ss-search]]');
    expect(m.get('[[ss-search]]')).toBe(2);
    expect(m.size).toBe(1);
  });

  it('returns an empty Map when there are no tokens', () => {
    expect(extractTokens('plain prose, no markers').size).toBe(0);
  });

  it('does not pollute lastIndex state across calls (shared global RE safety)', () => {
    const a = extractTokens('[[ss-search]]');
    const b = extractTokens('[[ss-find]]');
    expect(a.get('[[ss-search]]')).toBe(1);
    expect(b.get('[[ss-find]]')).toBe(1);
  });

  it('throws on non-string input', () => {
    expect(() => extractTokens(null)).toThrow(/string required/);
  });
});

// ─── validateMutation — happy paths ────────────────────────────────────────

describe('validateMutation — accepts faithful mutations', () => {
  it('ok=true when all tokens preserved at same multiplicity', () => {
    const source = 'Route with [[ss-search]] then verify via [[ss-trace]].';
    const mutated = 'Use [[ss-search]] first; afterwards verify with [[ss-trace]].';
    const r = validateMutation({ source, mutated });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('whitespace inside brackets is a fix, not a failure (ok=true, normalized output)', () => {
    const source = 'Prefer [[ss-search]].';
    const mutated = 'Prefer [[  ss-search ]].';
    const r = validateMutation({ source, mutated });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.normalized).toBe('Prefer [[ss-search]].');
  });

  it('preserves repeated-token multiplicity', () => {
    const source = '[[ss-search]] [[ss-search]]';
    const mutated = 'First [[ss-search]] and then [[ss-search]] again.';
    expect(validateMutation({ source, mutated }).ok).toBe(true);
  });

  it('source with no tokens accepts any mutation that adds none', () => {
    const r = validateMutation({ source: 'no tokens here', mutated: 'still no tokens' });
    expect(r.ok).toBe(true);
  });
});

// ─── validateMutation — failure modes ──────────────────────────────────────

describe('validateMutation — rejects corrupted mutations', () => {
  it('flags missing-token when a source token is dropped', () => {
    const r = validateMutation({
      source: 'Use [[ss-search]] and [[ss-find]].',
      mutated: 'Use [[ss-search]] only.',
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toContainEqual({ reason: 'missing-token', token: '[[ss-find]]' });
  });

  it('flags multiplicity-changed when a token count drops', () => {
    const r = validateMutation({
      source: '[[ss-search]] [[ss-search]]',
      mutated: 'just one [[ss-search]]',
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toContainEqual({ reason: 'multiplicity-changed', token: '[[ss-search]]' });
  });

  it('flags multiplicity-changed when a token count increases', () => {
    const r = validateMutation({
      source: '[[ss-search]]',
      mutated: '[[ss-search]] [[ss-search]]',
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toContainEqual({ reason: 'multiplicity-changed', token: '[[ss-search]]' });
  });

  it('flags surplus-token when the mutation invents a new sentinel', () => {
    const r = validateMutation({
      source: 'Use [[ss-search]].',
      mutated: 'Use [[ss-search]] and the new [[ss-magic]].',
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toContainEqual({ reason: 'surplus-token', token: '[[ss-magic]]' });
  });

  it('reports multiple independent failures together', () => {
    const r = validateMutation({
      source: 'Use [[ss-search]] and [[ss-find]].',
      mutated: 'Use [[ss-find]] and [[ss-bogus]].',
    });
    expect(r.ok).toBe(false);
    const reasons = r.failures.map((f) => f.reason).sort();
    expect(reasons).toContain('missing-token'); // [[ss-search]] dropped
    expect(reasons).toContain('surplus-token'); // [[ss-bogus]] invented
  });
});

// ─── validateMutation — OP-4 alias handling ────────────────────────────────

describe('validateMutation — OP-4 alias rejection', () => {
  it('rejects a surviving [[TOOL_ALPHA]] alias by default (op unset)', () => {
    const r = validateMutation({
      source: '[[TOOL_ALPHA]]',
      mutated: '[[TOOL_ALPHA]]',
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toContainEqual({ reason: 'unmapped-alias', token: '[[TOOL_ALPHA]]' });
  });

  it('rejects a surviving alias under op="tool-mask"', () => {
    const r = validateMutation({
      source: 'Use [[ss-search]].',
      mutated: 'Use [[ss-search]] and leftover [[TOOL_DELTA]].',
      op: 'tool-mask',
    });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.reason === 'unmapped-alias' && f.token === '[[TOOL_DELTA]]')).toBe(true);
  });

  it('does NOT double-count an alias as both surplus and unmapped', () => {
    const r = validateMutation({
      source: 'Use [[ss-search]].',
      mutated: 'Use [[ss-search]] and [[TOOL_BETA]].',
      op: 'tool-mask',
    });
    const aliasFailures = r.failures.filter((f) => f.token === '[[TOOL_BETA]]');
    expect(aliasFailures).toHaveLength(1);
    expect(aliasFailures[0].reason).toBe('unmapped-alias');
  });

  it('SKIPS alias rejection when op === "tool-mask-premap"', () => {
    const r = validateMutation({
      source: '[[TOOL_ALPHA]] [[TOOL_BETA]]',
      mutated: '[[TOOL_ALPHA]] [[TOOL_BETA]]',
      op: 'tool-mask-premap',
    });
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('normalises spaced aliases before the alias check catches them', () => {
    const r = validateMutation({
      source: 'Use [[ss-search]].',
      mutated: 'Use [[ss-search]] and [[ TOOL_GAMMA ]].',
      op: 'tool-mask',
    });
    expect(r.ok).toBe(false);
    expect(r.failures).toContainEqual({ reason: 'unmapped-alias', token: '[[TOOL_GAMMA]]' });
  });
});

// ─── validateMutation — input guards + shape ───────────────────────────────

describe('validateMutation — guards and return shape', () => {
  it('throws when source is not a string', () => {
    expect(() => validateMutation({ source: 1, mutated: 'x' })).toThrow(/source must be string/);
  });

  it('throws when mutated is not a string', () => {
    expect(() => validateMutation({ source: 'x', mutated: null })).toThrow(/mutated must be string/);
  });

  it('always returns { ok, normalized, failures }', () => {
    const r = validateMutation({ source: '[[ss-search]]', mutated: '[[ss-search]]' });
    expect(r).toHaveProperty('ok');
    expect(r).toHaveProperty('normalized');
    expect(r).toHaveProperty('failures');
    expect(Array.isArray(r.failures)).toBe(true);
  });
});
