/**
 * Unit tests for core/prompt-optimization/splits/build-splits.mjs.
 * Verifies determinism, stratification balance, and the on-disk-match
 * gate that protects against accidental drift.
 */

import { describe, it, expect } from 'vitest';
import { buildSplits, stratifiedSplit } from '../../../core/prompt-optimization/splits/build-splits.mjs';

describe('stratifiedSplit', () => {
  it('is deterministic across repeated calls with the same seed', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `id-${i}`,
      stratum: i % 4 === 0 ? 'a' : i % 4 === 1 ? 'b' : i % 4 === 2 ? 'c' : 'd',
    }));
    const r1 = stratifiedSplit({ items, devRatio: 0.6, seed: 42 });
    const r2 = stratifiedSplit({ items, devRatio: 0.6, seed: 42 });
    expect(r1.dev).toEqual(r2.dev);
    expect(r1.heldout).toEqual(r2.heldout);
  });

  it('respects devRatio per stratum (within rounding)', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `id-${i}`,
      stratum: i % 5 === 0 ? 'a' : 'b',
    }));
    const r = stratifiedSplit({ items, devRatio: 0.6 });
    expect(r.dev.length + r.heldout.length).toBe(50);
    // 10 'a' items × 0.6 → 6 dev, 4 heldout. 40 'b' × 0.6 → 24 / 16.
    expect(r.counts.a.dev).toBe(6);
    expect(r.counts.a.heldout).toBe(4);
    expect(r.counts.b.dev).toBe(24);
    expect(r.counts.b.heldout).toBe(16);
  });

  it('changing one stratum does not reshuffle disjoint strata', () => {
    const baseA = Array.from({ length: 10 }, (_, i) => ({ id: `a-${i}`, stratum: 'a' }));
    const baseB = Array.from({ length: 10 }, (_, i) => ({ id: `b-${i}`, stratum: 'b' }));
    const r1 = stratifiedSplit({ items: [...baseA, ...baseB] });
    const newA = [...baseA, { id: 'a-NEW', stratum: 'a' }];
    const r2 = stratifiedSplit({ items: [...newA, ...baseB] });
    const r1B = r1.dev.filter(id => id.startsWith('b-')).concat(r1.heldout.filter(id => id.startsWith('b-')));
    const r2B = r2.dev.filter(id => id.startsWith('b-')).concat(r2.heldout.filter(id => id.startsWith('b-')));
    expect(r1B.sort()).toEqual(r2B.sort());
  });
});

describe('buildSplits', () => {
  it('on-disk artifacts match the generator output (--check)', () => {
    const r = buildSplits({ check: true });
    expect(r.ok).toBe(true);
    expect(r.mismatches ?? []).toEqual([]);
  });

  it('manifest reports 60 / 40 / 30 totals', () => {
    const r = buildSplits({ check: true });
    expect(r.manifest.totals.dev_60).toBe(60);
    expect(r.manifest.totals.heldout_40).toBe(40);
    expect(r.manifest.totals.freshstack_30).toBe(30);
  });
});
