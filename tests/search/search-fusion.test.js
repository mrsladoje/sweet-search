/**
 * Search Fusion Unit Tests
 *
 * Tests for all 8 exported functions + ROUTE_ALPHAS constant from core/search-fusion.js.
 * No SweetSearch instance needed — `this`-bound functions tested via `.call(mockThis, ...)`.
 * Note: makeMockThis() injects real sub-functions (getResultKey, variance, etc.) for integration-level
 * coverage; only shouldFallbackToRRF is stubbed in robustCCFusion tests for path control.
 */

import { describe, it, expect } from 'vitest';

import {
  ROUTE_ALPHAS,
  getResultKey,
  minMaxNormalize,
  quantileNormalize,
  variance,
  convexCombination,
  shouldFallbackToRRF,
  rrfFusion,
  robustCCFusion,
} from '../../core/search/search-fusion.js';

// ---------------------------------------------------------------------------
// ROUTE_ALPHAS
// ---------------------------------------------------------------------------

describe('ROUTE_ALPHAS', () => {
  it('has all 7 expected keys', () => {
    const keys = Object.keys(ROUTE_ALPHAS);
    expect(keys).toHaveLength(7);
    expect(keys).toContain('identifier');
    expect(keys).toContain('lexical');
    expect(keys).toContain('conceptual');
    expect(keys).toContain('semantic');
    expect(keys).toContain('structural');
    expect(keys).toContain('mixed');
    expect(keys).toContain('hybrid');
  });

  it('has expected alpha values', () => {
    expect(ROUTE_ALPHAS.identifier).toBe(0.85);
    expect(ROUTE_ALPHAS.lexical).toBe(0.85);
    expect(ROUTE_ALPHAS.conceptual).toBe(0.25);
    expect(ROUTE_ALPHAS.semantic).toBe(0.25);
    expect(ROUTE_ALPHAS.structural).toBe(0.90);
    expect(ROUTE_ALPHAS.mixed).toBe(0.55);
    expect(ROUTE_ALPHAS.hybrid).toBe(0.55);
  });

  it('all values are in [0, 1]', () => {
    for (const val of Object.values(ROUTE_ALPHAS)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// getResultKey
// ---------------------------------------------------------------------------

describe('getResultKey', () => {
  it('uses id when present', () => {
    expect(getResultKey({ id: 'abc123' })).toBe('abc123');
  });

  it('coerces numeric id to string', () => {
    expect(getResultKey({ id: 42 })).toBe('42');
  });

  it('uses file:startLine when no id', () => {
    expect(getResultKey({ file: 'foo.js', startLine: 10 })).toBe('foo.js:10');
  });

  it('uses file:startLine when startLine is 0', () => {
    expect(getResultKey({ file: 'bar.js', startLine: 0 })).toBe('bar.js:0');
  });

  it('uses name when no id or file+startLine', () => {
    expect(getResultKey({ name: 'myFunc' })).toBe('myFunc');
  });

  it('falls back to MD5 hash when no id/file/name', () => {
    const result = { score: 0.5, type: 'variable' };
    const key = getResultKey(result);
    // P0.1 fix: MD5 hex digest (32 chars) avoids truncation collisions
    expect(key).toMatch(/^[a-f0-9]{32}$/);
  });

  it('falls back gracefully for empty object', () => {
    const key = getResultKey({});
    expect(typeof key).toBe('string');
    expect(key).toMatch(/^[a-f0-9]{32}$/);
  });

  it('produces distinct keys for different objects (no collision)', () => {
    const a = getResultKey({ score: 0.5, type: 'variable' });
    const b = getResultKey({ score: 0.9, type: 'function' });
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// minMaxNormalize
// ---------------------------------------------------------------------------

describe('minMaxNormalize', () => {
  it('returns empty array for empty input', () => {
    expect(minMaxNormalize([])).toEqual([]);
  });

  it('returns [1.0] for single element', () => {
    expect(minMaxNormalize([5])).toEqual([1.0]);
  });

  it('returns all 1.0 when all values are the same', () => {
    expect(minMaxNormalize([3, 3, 3])).toEqual([1.0, 1.0, 1.0]);
  });

  it('normalizes to [0, 1] for a normal range', () => {
    const result = minMaxNormalize([0, 5, 10]);
    expect(result).toEqual([0, 0.5, 1.0]);
  });

  it('handles negative values', () => {
    const result = minMaxNormalize([-10, 0, 10]);
    expect(result).toEqual([0, 0.5, 1.0]);
  });

  it('handles null/undefined input gracefully', () => {
    expect(minMaxNormalize(null)).toEqual([]);
    expect(minMaxNormalize(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// quantileNormalize
// ---------------------------------------------------------------------------

describe('quantileNormalize', () => {
  it('returns empty array for empty input', () => {
    expect(quantileNormalize([])).toEqual([]);
  });

  it('returns [0.5] for single element', () => {
    expect(quantileNormalize([42])).toEqual([0.5]);
  });

  it('returns all 0.5 when all scores are identical', () => {
    const result = quantileNormalize([5, 5, 5, 5]);
    result.forEach(v => expect(v).toBe(0.5));
  });

  it('normalizes a normal distribution to [0, 1]', () => {
    const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = quantileNormalize(scores);
    result.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
    // First should be lower than last
    expect(result[0]).toBeLessThan(result[9]);
  });

  it('clamps outliers to [0, 1]', () => {
    // One extreme outlier at 1000
    const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000];
    const result = quantileNormalize(scores);
    result.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
// variance
// ---------------------------------------------------------------------------

describe('variance', () => {
  it('returns 0 for empty array', () => {
    expect(variance([])).toBe(0);
  });

  it('returns 0 for single element', () => {
    expect(variance([7])).toBe(0);
  });

  it('returns 0 for uniform values', () => {
    expect(variance([5, 5, 5, 5])).toBe(0);
  });

  it('computes known variance correctly', () => {
    // [1, 2, 3, 4, 5] => mean=3, var = (4+1+0+1+4)/5 = 2
    expect(variance([1, 2, 3, 4, 5])).toBe(2);
  });

  it('computes variance for two values', () => {
    // [0, 10] => mean=5, var = (25+25)/2 = 25
    expect(variance([0, 10])).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// convexCombination (uses `this`)
// ---------------------------------------------------------------------------

describe('convexCombination', () => {
  const mockThis = { getResultKey };

  it('fuses overlapping results', () => {
    const lex = [
      { id: 'a', score: 10 },
      { id: 'b', score: 5 },
    ];
    const sem = [
      { id: 'a', score: 0.8 },
      { id: 'c', score: 0.6 },
    ];

    const results = convexCombination.call(mockThis, lex, sem, 'mixed');
    expect(results.length).toBe(3); // a, b, c
    // Result 'a' appears in both — should have highest CC score
    const resultA = results.find(r => r.id === 'a');
    expect(resultA).toBeDefined();
    expect(resultA.sources).toContain('lexical');
    expect(resultA.sources).toContain('semantic');
  });

  it('fuses disjoint results', () => {
    const lex = [{ id: 'x', score: 10 }];
    const sem = [{ id: 'y', score: 0.9 }];

    const results = convexCombination.call(mockThis, lex, sem, 'mixed');
    expect(results.length).toBe(2);
  });

  it('respects alpha from routeType', () => {
    const lex = [{ id: 'a', score: 10 }];
    const sem = [{ id: 'a', score: 10 }];

    // identifier alpha = 0.85, so lexical dominates
    const result = convexCombination.call(mockThis, lex, sem, 'identifier');
    expect(result[0].alpha).toBe(0.85);
  });

  it('uses custom alpha from options', () => {
    const lex = [{ id: 'a', score: 10 }];
    const sem = [{ id: 'a', score: 10 }];

    const result = convexCombination.call(mockThis, lex, sem, 'mixed', { alpha: 0.3 });
    expect(result[0].alpha).toBe(0.3);
  });

  it('sets rrfScore as backward-compat alias for ccScore', () => {
    const lex = [{ id: 'a', score: 5 }];
    const sem = [{ id: 'a', score: 3 }];

    const results = convexCombination.call(mockThis, lex, sem);
    expect(results[0].rrfScore).toBe(results[0].ccScore);
  });

  it('sorts results by ccScore descending', () => {
    const lex = [
      { id: 'a', score: 10 },
      { id: 'b', score: 1 },
    ];
    const sem = [
      { id: 'b', score: 0.9 },
      { id: 'a', score: 0.1 },
    ];

    const results = convexCombination.call(mockThis, lex, sem, 'mixed');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].ccScore).toBeGreaterThanOrEqual(results[i].ccScore);
    }
  });

  it('handles empty lexical results', () => {
    const lex = [];
    const sem = [{ id: 'a', score: 0.9 }];
    const results = convexCombination.call(mockThis, lex, sem, 'mixed');
    expect(results.length).toBe(1);
    expect(results[0].sources).toContain('semantic');
  });

  it('handles empty semantic results', () => {
    const lex = [{ id: 'a', score: 10 }];
    const sem = [];
    const results = convexCombination.call(mockThis, lex, sem, 'mixed');
    expect(results.length).toBe(1);
    expect(results[0].sources).toContain('lexical');
  });

  it('handles both empty', () => {
    const results = convexCombination.call(mockThis, [], [], 'mixed');
    expect(results).toEqual([]);
  });

  it('with alpha=0 semantic side dominates ranking', () => {
    // Two items with opposing lex/sem strengths
    const lex = [{ id: 'a', score: 10 }, { id: 'b', score: 0 }];
    const sem = [{ id: 'a', score: 0 }, { id: 'b', score: 10 }];
    const results = convexCombination.call(mockThis, lex, sem, 'mixed', { alpha: 0 });
    expect(results[0].alpha).toBe(0);
    // alpha=0: ccScore = 0*normLex + 1*normSem. 'b' has normSem=1.0, 'a' has normSem=0.0
    expect(results[0].id).toBe('b'); // semantic winner ranks first
  });

  it('with alpha=1 lexical side dominates ranking', () => {
    const lex = [{ id: 'a', score: 10 }, { id: 'b', score: 0 }];
    const sem = [{ id: 'a', score: 0 }, { id: 'b', score: 10 }];
    const results = convexCombination.call(mockThis, lex, sem, 'mixed', { alpha: 1 });
    expect(results[0].alpha).toBe(1);
    // alpha=1: ccScore = 1*normLex + 0*normSem. 'a' has normLex=1.0, 'b' has normLex=0.0
    expect(results[0].id).toBe('a'); // lexical winner ranks first
  });
});

// ---------------------------------------------------------------------------
// shouldFallbackToRRF (uses `this`)
// ---------------------------------------------------------------------------

describe('shouldFallbackToRRF', () => {
  const mockThis = { variance };

  it('returns fallback=true for insufficient_results (lexical < 3)', () => {
    const lex = [{ score: 1 }, { score: 2 }];
    const sem = [{ score: 1 }, { score: 2 }, { score: 3 }];
    const result = shouldFallbackToRRF.call(mockThis, lex, sem);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('insufficient_results');
  });

  it('returns fallback=true for insufficient_results (semantic < 3)', () => {
    const lex = [{ score: 1 }, { score: 2 }, { score: 3 }];
    const sem = [{ score: 1 }];
    const result = shouldFallbackToRRF.call(mockThis, lex, sem);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('insufficient_results');
  });

  it('returns fallback=true for no_valid_scores (all NaN after ?? 0)', () => {
    // To hit no_valid_scores: all scores must be NaN (NaN ?? 0 = NaN, filter removes all)
    const lex = [{ score: NaN }, { score: NaN }, { score: NaN }];
    const sem = [{ score: 1 }, { score: 2 }, { score: 3 }];
    const result = shouldFallbackToRRF.call(mockThis, lex, sem);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('no_valid_scores');
  });

  it('returns zero_variance when NaN filtering leaves identical scores', () => {
    // 3 items pass initial length check (>=3). After ?? 0: [0, NaN, 0].
    // After filter(!isNaN): [0, 0]. Variance = 0 < 1e-6 → zero_variance.
    const lex = [{ score: undefined }, { score: NaN }, { score: undefined }];
    const sem = [{ score: 1 }, { score: 2 }, { score: 3 }];
    const result = shouldFallbackToRRF.call(mockThis, lex, sem);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('zero_variance');
  });

  it('returns fallback=true for zero_variance', () => {
    const lex = [{ score: 5 }, { score: 5 }, { score: 5 }];
    const sem = [{ score: 1 }, { score: 2 }, { score: 3 }];
    const result = shouldFallbackToRRF.call(mockThis, lex, sem);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('zero_variance');
  });

  it('returns fallback=true for outlier_compression', () => {
    // Top 5% threshold / max > 0.95 AND median / max < 0.3
    // Need: sorted desc, top5pct ~= max, median << max
    // E.g. 100 values where the top 5 are at ~100, the rest are at ~10
    const lex = [];
    for (let i = 0; i < 100; i++) {
      lex.push({ score: i < 6 ? 100 : 10 }); // top 6% at 100, rest at 10
    }
    // sorted desc: 100,100,100,100,100,100, 10,10,...
    // max = 100, top5pct = lex[5] = 100, median = lex[50] = 10
    // top5pct/max = 100/100 = 1.0 > 0.95 YES
    // median/max = 10/100 = 0.1 < 0.3 YES
    const sem = [];
    for (let i = 0; i < 100; i++) {
      sem.push({ score: i + 1 });
    }
    const result = shouldFallbackToRRF.call(mockThis, lex, sem);
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('outlier_compression');
  });

  it('returns fallback=false when distribution is normal', () => {
    const lex = [{ score: 1 }, { score: 5 }, { score: 10 }];
    const sem = [{ score: 2 }, { score: 6 }, { score: 11 }];
    const result = shouldFallbackToRRF.call(mockThis, lex, sem);
    expect(result.fallback).toBe(false);
    expect(result.reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rrfFusion (uses `this`)
// ---------------------------------------------------------------------------

describe('rrfFusion', () => {
  const mockThis = { getResultKey };

  it('fuses overlapping result sets', () => {
    const lex = [
      { id: 'a', score: 10 },
      { id: 'b', score: 5 },
    ];
    const sem = [
      { id: 'b', score: 0.9 },
      { id: 'c', score: 0.5 },
    ];

    const results = rrfFusion.call(mockThis, lex, sem, 60);
    expect(results.length).toBe(3);
    // 'b' appears in both lists so should have highest RRF score
    const resultB = results.find(r => r.id === 'b');
    expect(resultB.sources).toContain('lexical');
    expect(resultB.sources).toContain('semantic');
    expect(resultB.score).toBeGreaterThan(0);
  });

  it('fuses disjoint result sets', () => {
    const lex = [{ id: 'x', score: 10 }];
    const sem = [{ id: 'y', score: 5 }];

    const results = rrfFusion.call(mockThis, lex, sem, 60);
    expect(results.length).toBe(2);
    // Both should have equal RRF scores (both rank 0 in their list)
    expect(results[0].score).toBeCloseTo(results[1].score, 5);
  });

  it('sorts by score descending', () => {
    const lex = [
      { id: 'a', score: 10 },
      { id: 'b', score: 5 },
      { id: 'c', score: 1 },
    ];
    const sem = [
      { id: 'c', score: 0.9 },
      { id: 'b', score: 0.5 },
      { id: 'a', score: 0.1 },
    ];

    const results = rrfFusion.call(mockThis, lex, sem, 60);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('uses default k=60', () => {
    const lex = [{ id: 'a', score: 10 }];
    const sem = [];

    const results = rrfFusion.call(mockThis, lex, sem);
    // RRF score for rank 0 with k=60: 1/(60+0+1) = 1/61
    expect(results[0].score).toBeCloseTo(1 / 61, 5);
  });

  it('sets ccScore alias for backward compat', () => {
    const lex = [{ id: 'a', score: 10 }];
    const sem = [];

    const results = rrfFusion.call(mockThis, lex, sem);
    expect(results[0].ccScore).toBe(results[0].score);
  });
});

// ---------------------------------------------------------------------------
// robustCCFusion (uses `this`)
// ---------------------------------------------------------------------------

describe('robustCCFusion', () => {
  function makeMockThis(shouldFallback = false, fallbackReason = null) {
    return {
      getResultKey,
      variance,
      quantileNormalize,
      shouldFallbackToRRF: () => ({ fallback: shouldFallback, reason: fallbackReason }),
      rrfFusion,
      log: () => {},
    };
  }

  it('returns CC path when no fallback needed', () => {
    const lex = [
      { id: 'a', score: 10 },
      { id: 'b', score: 5 },
      { id: 'c', score: 1 },
    ];
    const sem = [
      { id: 'a', score: 0.9 },
      { id: 'd', score: 0.5 },
      { id: 'e', score: 0.1 },
    ];

    const mockCtx = makeMockThis(false);
    const output = robustCCFusion.call(mockCtx, lex, sem, 'mixed');
    expect(output.method).toBe('cc_robust');
    expect(output.fallbackReason).toBeNull();
    expect(output.results.length).toBeGreaterThan(0);
  });

  it('returns RRF fallback when fallback triggered', () => {
    const lex = [
      { id: 'a', score: 5 },
      { id: 'b', score: 5 },
      { id: 'c', score: 5 },
    ];
    const sem = [
      { id: 'a', score: 1 },
      { id: 'b', score: 1 },
      { id: 'c', score: 1 },
    ];

    const mockCtx = makeMockThis(true, 'zero_variance');
    const output = robustCCFusion.call(mockCtx, lex, sem);
    expect(output.method).toBe('rrf');
    expect(output.fallbackReason).toBe('zero_variance');
    expect(output.results.length).toBeGreaterThan(0);
  });

  it('uses routeType alpha for CC path', () => {
    const lex = [{ id: 'a', score: 10 }];
    const sem = [{ id: 'a', score: 10 }];

    const mockCtx = makeMockThis(false);
    const output = robustCCFusion.call(mockCtx, lex, sem, 'identifier');
    expect(output.results[0].alpha).toBe(ROUTE_ALPHAS.identifier);
  });

  it('marks sources correctly on CC path', () => {
    const lex = [{ id: 'a', score: 10 }];
    const sem = [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.5 }];

    const mockCtx = makeMockThis(false);
    const output = robustCCFusion.call(mockCtx, lex, sem, 'mixed');
    const resultA = output.results.find(r => r.id === 'a');
    expect(resultA.sources).toContain('lexical');
    expect(resultA.sources).toContain('semantic');

    const resultB = output.results.find(r => r.id === 'b');
    expect(resultB.sources).toContain('semantic');
    expect(resultB.sources).not.toContain('lexical');
  });

  it('sorts CC results by score descending', () => {
    const lex = [
      { id: 'a', score: 10 },
      { id: 'b', score: 1 },
    ];
    const sem = [
      { id: 'a', score: 0.1 },
      { id: 'b', score: 0.9 },
    ];

    const mockCtx = makeMockThis(false);
    const output = robustCCFusion.call(mockCtx, lex, sem, 'identifier');
    for (let i = 1; i < output.results.length; i++) {
      expect(output.results[i - 1].score).toBeGreaterThanOrEqual(output.results[i].score);
    }
  });

  it('falls back to RRF for empty lexical (via shouldFallbackToRRF stub)', () => {
    // Empty lex triggers fallback; we stub shouldFallbackToRRF directly
    const mockCtx = makeMockThis(true, 'insufficient_results');
    const output = robustCCFusion.call(mockCtx, [], [], 'mixed');
    expect(output.method).toBe('rrf');
    expect(output.results).toEqual([]);
  });
});
