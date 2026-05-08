/**
 * Unit tests for core/prompt-optimization/stats/* — paired permutation,
 * paired bootstrap CI, Plackett-Luce. Determinism checks confirm the
 * seed=42 contract from §11.4.
 */

import { describe, it, expect } from 'vitest';
import { pairedPermutationTest } from '../../../core/prompt-optimization/stats/paired-permutation.mjs';
import { pairedBootstrapCI } from '../../../core/prompt-optimization/stats/bootstrap-ci.mjs';
import {
  plackettLuceFit,
  plackettLuceFitWithBootstrap,
} from '../../../core/prompt-optimization/stats/plackett-luce.mjs';

describe('pairedPermutationTest', () => {
  it('rejects null hypothesis when A dominates B (low p-value)', () => {
    const a = Array.from({ length: 30 }, (_, i) => (i < 27 ? 1 : 0));
    const b = Array.from({ length: 30 }, () => 0);
    const r = pairedPermutationTest({ a, b, iterations: 2000, seed: 42 });
    expect(r.observedDiff).toBeCloseTo(27 / 30, 6);
    expect(r.pValue).toBeLessThan(0.01);
    expect(r.nPairs).toBe(30);
  });

  it('returns near-1 p-value when samples are identical', () => {
    const a = [1, 0, 1, 0, 1, 0, 1, 0];
    const b = [1, 0, 1, 0, 1, 0, 1, 0];
    const r = pairedPermutationTest({ a, b, iterations: 2000, seed: 42 });
    expect(r.observedDiff).toBe(0);
    expect(r.pValue).toBeCloseTo(1, 2);
  });

  it('is deterministic with seed=42', () => {
    const a = [1, 1, 0, 1, 0, 0, 1, 1, 0, 1];
    const b = [0, 1, 0, 0, 0, 0, 1, 0, 0, 1];
    const r1 = pairedPermutationTest({ a, b, iterations: 1000, seed: 42 });
    const r2 = pairedPermutationTest({ a, b, iterations: 1000, seed: 42 });
    expect(r1.pValue).toBe(r2.pValue);
  });

  it('throws on length mismatch', () => {
    expect(() => pairedPermutationTest({ a: [1, 0], b: [1] })).toThrow(/length mismatch/);
  });

  it('throws on empty inputs', () => {
    expect(() => pairedPermutationTest({ a: [], b: [] })).toThrow(/empty inputs/);
  });
});

describe('pairedBootstrapCI', () => {
  it('CI brackets observed diff and is symmetric-ish on noisy data', () => {
    const rng = mulberry32Stub(7);
    const a = Array.from({ length: 100 }, () => (rng() < 0.7 ? 1 : 0));
    const b = Array.from({ length: 100 }, () => (rng() < 0.5 ? 1 : 0));
    const r = pairedBootstrapCI({ a, b, iterations: 2000, seed: 42 });
    expect(r.ciLow).toBeLessThanOrEqual(r.observedDiff);
    expect(r.ciHigh).toBeGreaterThanOrEqual(r.observedDiff);
  });

  it('relDelta is NaN when baseline mean is zero', () => {
    const r = pairedBootstrapCI({ a: [1, 1, 0], b: [0, 0, 0], iterations: 200, seed: 42 });
    expect(r.observedDiff).toBeCloseTo(2 / 3, 6);
    expect(Number.isNaN(r.relDelta)).toBe(true);
  });

  it('respects custom confidence level', () => {
    const a = [1, 1, 0, 1, 0, 0, 1, 1, 0, 1];
    const b = [0, 1, 0, 0, 0, 0, 1, 0, 0, 1];
    const wide = pairedBootstrapCI({ a, b, iterations: 2000, seed: 42, confidence: 0.99 });
    const narrow = pairedBootstrapCI({ a, b, iterations: 2000, seed: 42, confidence: 0.5 });
    expect(wide.ciHigh - wide.ciLow).toBeGreaterThanOrEqual(narrow.ciHigh - narrow.ciLow);
  });
});

describe('plackettLuceFit', () => {
  it('ranks dominant winner first when one item beats every other', () => {
    const r = plackettLuceFit({
      items: ['A', 'B', 'C', 'D'],
      rankings: [
        ['A', 'B'], ['A', 'C'], ['A', 'D'],
        ['A', 'B'], ['A', 'C'], ['A', 'D'],
        ['B', 'C'], ['C', 'D'],
      ],
    });
    expect(r.rank.A).toBe(1);
    expect(r.worth.A).toBeGreaterThan(r.worth.B);
  });

  it('handles k-way rankings (length > 2)', () => {
    const r = plackettLuceFit({
      items: ['T1', 'T2', 'T3'],
      rankings: [
        ['T1', 'T2', 'T3'],
        ['T1', 'T2', 'T3'],
        ['T1', 'T3', 'T2'],
      ],
    });
    // Rank order is the load-bearing assertion. Convergence on dominant-winner
    // inputs is intentionally loose because the MM iteration's spectral gap
    // collapses; accept slow tail convergence as long as the ranking is right.
    expect(r.rank.T1).toBe(1);
    expect(r.rank.T2).toBe(2);
    expect(r.rank.T3).toBe(3);
    expect(r.worth.T1).toBeGreaterThan(0.9);
  });

  it('converges quickly on non-degenerate balanced data', () => {
    // Each item beats each other item the same number of times — symmetric
    // data → MM hits the all-equal fixed point in a handful of iterations.
    const r = plackettLuceFit({
      items: ['A', 'B', 'C'],
      rankings: [
        ['A', 'B'], ['B', 'A'],
        ['A', 'C'], ['C', 'A'],
        ['B', 'C'], ['C', 'B'],
      ],
      maxIter: 100,
      tol: 1e-6,
    });
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThan(50);
    // Worths within rounding of each other.
    expect(Math.abs(r.worth.A - r.worth.B)).toBeLessThan(1e-3);
    expect(Math.abs(r.worth.B - r.worth.C)).toBeLessThan(1e-3);
  });

  it('bootstrap returns CI per item', () => {
    const r = plackettLuceFitWithBootstrap({
      items: ['A', 'B', 'C'],
      rankings: [['A', 'B'], ['A', 'C'], ['B', 'C'], ['A', 'B']],
      bootstrapIters: 50,
      seed: 42,
    });
    expect(r.ciLow.A).toBeDefined();
    expect(r.ciHigh.A).toBeDefined();
    expect(r.ciLow.A).toBeLessThanOrEqual(r.ciHigh.A);
  });

  it('throws on too-few items', () => {
    expect(() => plackettLuceFit({ items: ['A'], rankings: [['A']] })).toThrow(/at least 2 items/);
  });

  it('throws on unknown item in ranking', () => {
    expect(() =>
      plackettLuceFit({ items: ['A', 'B'], rankings: [['A', 'C']] }),
    ).toThrow(/not in items/);
  });
});

// Tiny inline RNG so the noisy-data test does not depend on Math.random().
function mulberry32Stub(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
