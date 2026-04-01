/**
 * PHASE_1_FIXES Unit Tests
 *
 * Tests for the Phase 1 ranking fix helper functions in sweet-search.js:
 * - quantileNormalize: Robust score normalization with outlier handling
 * - shouldFallbackToRRF: Detection of CC fusion edge cases
 * - robustCCFusion: Quantile-normalized CC fusion with RRF fallback
 * - variance: Statistical variance calculation
 * - getBoostIntent: Query router mode to boost intent mapping
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';

// Import SweetSearch class to test instance methods
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sweetSearchPath = path.join(__dirname, '../..', 'core', 'search', 'sweet-search.js');

// Create a minimal SweetSearch instance for testing
// We'll mock the constructor dependencies to avoid needing real DB
let SweetSearch;
let searchInstance;

beforeAll(async () => {
  // Dynamically import SweetSearch class
  const module = await import(sweetSearchPath);
  SweetSearch = module.default || module.SweetSearch;

  // Create instance with minimal config (methods don't need DB for these tests)
  searchInstance = Object.create(SweetSearch.prototype);

  // Bind the log method to suppress output during tests
  searchInstance.log = vi.fn();
  searchInstance.verbose = false;

  // Bind getResultKey method for robustCCFusion tests
  searchInstance.getResultKey = function (result) {
    if (result.id) return String(result.id);
    if (result.file && result.startLine != null) return `${result.file}:${result.startLine}`;
    if (result.name) return String(result.name);
    return JSON.stringify(result || {}).slice(0, 100);
  };
});

// ============================================================================
// quantileNormalize Tests
// ============================================================================

describe('quantileNormalize', () => {
  describe('edge cases', () => {
    it('should return empty array for empty input', () => {
      const result = searchInstance.quantileNormalize([]);
      expect(result).toEqual([]);
    });

    it('should return [0.5] for single element', () => {
      const result = searchInstance.quantileNormalize([42]);
      expect(result).toEqual([0.5]);
    });

    it('should return [0.5] for single element regardless of value', () => {
      expect(searchInstance.quantileNormalize([0])).toEqual([0.5]);
      expect(searchInstance.quantileNormalize([100])).toEqual([0.5]);
      expect(searchInstance.quantileNormalize([-50])).toEqual([0.5]);
    });

    it('should return all 0.5 for degenerate case (all same scores)', () => {
      const scores = [5.0, 5.0, 5.0, 5.0, 5.0];
      const result = searchInstance.quantileNormalize(scores);
      expect(result).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    });

    it('should return all 0.5 for nearly identical scores (range < 1e-9)', () => {
      const scores = [1.0, 1.0 + 1e-10, 1.0 + 2e-10, 1.0 + 3e-10];
      const result = searchInstance.quantileNormalize(scores);
      result.forEach((s) => expect(s).toBe(0.5));
    });
  });

  describe('normal cases', () => {
    it('should normalize varied scores to [0, 1] range', () => {
      const scores = [0, 25, 50, 75, 100];
      const result = searchInstance.quantileNormalize(scores);

      // All results should be in [0, 1]
      result.forEach((s) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      });

      // Should preserve relative ordering
      expect(result[0]).toBeLessThan(result[1]);
      expect(result[1]).toBeLessThan(result[2]);
      expect(result[2]).toBeLessThan(result[3]);
      expect(result[3]).toBeLessThan(result[4]);
    });

    it('should handle scores with different magnitudes', () => {
      const scores = [0.001, 0.01, 0.1, 1, 10];
      const result = searchInstance.quantileNormalize(scores);

      result.forEach((s) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      });
    });

    it('should preserve order with two distinct values', () => {
      const scores = [10, 20, 10, 20, 10, 20];
      const result = searchInstance.quantileNormalize(scores);

      // Values of 10 should be normalized lower than values of 20
      expect(result[0]).toBeLessThan(result[1]);
      expect(result[2]).toBeLessThan(result[3]);
    });
  });

  describe('outlier handling', () => {
    it('should clamp extreme outliers to 0 or 1', () => {
      // Create data with extreme outliers
      // With default quantiles (0.05, 0.95), values outside the range get clamped
      const scores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1000]; // 1000 is extreme outlier
      const result = searchInstance.quantileNormalize(scores);

      // All values should be clamped to [0, 1]
      result.forEach((s) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      });

      // The extreme outlier (1000) should be clamped to 1
      expect(result[result.length - 1]).toBe(1);
    });

    it('should handle negative outliers', () => {
      const scores = [-1000, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = searchInstance.quantileNormalize(scores);

      result.forEach((s) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      });

      // The extreme negative outlier should be clamped to 0
      expect(result[0]).toBe(0);
    });
  });

  describe('quantile parameters', () => {
    it('should respect custom quantile parameters', () => {
      const scores = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

      // With wider quantiles, more scores should be within the normalized range
      const wideResult = searchInstance.quantileNormalize(scores, 0.1, 0.9);
      const narrowResult = searchInstance.quantileNormalize(scores, 0.2, 0.8);

      // Both should still be valid [0, 1] ranges
      wideResult.forEach((s) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      });
      narrowResult.forEach((s) => {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      });
    });
  });
});

// ============================================================================
// shouldFallbackToRRF Tests
// ============================================================================

describe('shouldFallbackToRRF', () => {
  describe('insufficient results', () => {
    it('should trigger fallback when lexical results < 3', () => {
      const lexical = [{ name: 'a', score: 1.0 }, { name: 'b', score: 0.9 }];
      const semantic = [
        { name: 'c', score: 0.8 },
        { name: 'd', score: 0.7 },
        { name: 'e', score: 0.6 },
      ];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('insufficient_results');
    });

    it('should trigger fallback when semantic results < 3', () => {
      const lexical = [
        { name: 'a', score: 1.0 },
        { name: 'b', score: 0.9 },
        { name: 'c', score: 0.8 },
      ];
      const semantic = [{ name: 'd', score: 0.7 }, { name: 'e', score: 0.6 }];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('insufficient_results');
    });

    it('should trigger fallback when both have < 3 results', () => {
      const lexical = [{ name: 'a', score: 1.0 }];
      const semantic = [{ name: 'b', score: 0.9 }];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('insufficient_results');
    });

    it('should trigger fallback for empty arrays', () => {
      const result = searchInstance.shouldFallbackToRRF([], []);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('insufficient_results');
    });
  });

  describe('zero variance', () => {
    it('should trigger fallback when lexical scores have zero variance', () => {
      const lexical = [
        { name: 'a', score: 5.0 },
        { name: 'b', score: 5.0 },
        { name: 'c', score: 5.0 },
      ];
      const semantic = [
        { name: 'd', score: 0.9 },
        { name: 'e', score: 0.7 },
        { name: 'f', score: 0.5 },
      ];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('zero_variance');
    });

    it('should trigger fallback when semantic scores have zero variance', () => {
      const lexical = [
        { name: 'a', score: 1.0 },
        { name: 'b', score: 0.8 },
        { name: 'c', score: 0.6 },
      ];
      const semantic = [
        { name: 'd', score: 0.5 },
        { name: 'e', score: 0.5 },
        { name: 'f', score: 0.5 },
      ];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('zero_variance');
    });
  });

  describe('no valid scores', () => {
    it('should trigger fallback when lexical scores are all undefined', () => {
      const lexical = [
        { name: 'a', score: undefined },
        { name: 'b', score: undefined },
        { name: 'c', score: undefined },
      ];
      const semantic = [
        { name: 'd', score: 0.9 },
        { name: 'e', score: 0.7 },
        { name: 'f', score: 0.5 },
      ];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('zero_variance'); // All undefined become 0, which has zero variance
    });

    it('should trigger fallback when all scores are NaN', () => {
      const lexical = [
        { name: 'a', score: NaN },
        { name: 'b', score: NaN },
        { name: 'c', score: NaN },
      ];
      const semantic = [
        { name: 'd', score: NaN },
        { name: 'e', score: NaN },
        { name: 'f', score: NaN },
      ];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('no_valid_scores');
    });

    it('should handle mixed undefined/NaN and valid scores', () => {
      const lexical = [
        { name: 'a', score: undefined },
        { name: 'b', score: 0.8 },
        { name: 'c', score: NaN },
        { name: 'd', score: 0.6 },
      ];
      const semantic = [
        { name: 'e', score: 0.9 },
        { name: 'f', score: undefined },
        { name: 'g', score: 0.7 },
      ];

      // Should have enough valid scores to not fallback for this reason
      // (unless variance is still too low)
      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      // With mixed values, variance should be non-zero
      expect(result.reason).not.toBe('no_valid_scores');
    });
  });

  describe('outlier compression', () => {
    it('should trigger fallback when outlier compression is detected', () => {
      // Outlier compression: P95 is very close to max (>0.95), but P50 is far from max (<0.3)
      // This means most values are compressed at the bottom with a few outliers at top
      const lexical = [
        { name: 'outlier1', score: 100 }, // Max and ~P95
        { name: 'outlier2', score: 98 },
        { name: 'c', score: 10 }, // P50 area - much lower
        { name: 'd', score: 8 },
        { name: 'e', score: 5 },
        { name: 'f', score: 3 },
        { name: 'g', score: 2 },
        { name: 'h', score: 1 },
        { name: 'i', score: 0.5 },
        { name: 'j', score: 0.1 },
      ];
      const semantic = [
        { name: 'k', score: 0.9 },
        { name: 'l', score: 0.7 },
        { name: 'm', score: 0.5 },
      ];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(true);
      expect(result.reason).toBe('outlier_compression');
    });

    it('should NOT trigger outlier compression for evenly distributed scores', () => {
      const lexical = [
        { name: 'a', score: 1.0 },
        { name: 'b', score: 0.9 },
        { name: 'c', score: 0.8 },
        { name: 'd', score: 0.7 },
        { name: 'e', score: 0.6 },
        { name: 'f', score: 0.5 },
        { name: 'g', score: 0.4 },
        { name: 'h', score: 0.3 },
        { name: 'i', score: 0.2 },
        { name: 'j', score: 0.1 },
      ];
      const semantic = [
        { name: 'k', score: 0.9 },
        { name: 'l', score: 0.7 },
        { name: 'm', score: 0.5 },
      ];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(false);
      expect(result.reason).toBeNull();
    });
  });

  describe('normal case (no fallback)', () => {
    it('should return no fallback for well-behaved inputs', () => {
      const lexical = [
        { name: 'a', score: 1.0 },
        { name: 'b', score: 0.8 },
        { name: 'c', score: 0.6 },
        { name: 'd', score: 0.4 },
        { name: 'e', score: 0.2 },
      ];
      const semantic = [
        { name: 'f', score: 0.9 },
        { name: 'g', score: 0.7 },
        { name: 'h', score: 0.5 },
        { name: 'i', score: 0.3 },
        { name: 'j', score: 0.1 },
      ];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should return no fallback with exactly 3 results on each side', () => {
      const lexical = [
        { name: 'a', score: 1.0 },
        { name: 'b', score: 0.5 },
        { name: 'c', score: 0.1 },
      ];
      const semantic = [
        { name: 'd', score: 0.9 },
        { name: 'e', score: 0.5 },
        { name: 'f', score: 0.1 },
      ];

      const result = searchInstance.shouldFallbackToRRF(lexical, semantic);
      expect(result.fallback).toBe(false);
      expect(result.reason).toBeNull();
    });
  });
});

// ============================================================================
// robustCCFusion Tests
// ============================================================================

describe('robustCCFusion', () => {
  // Helper to create mock results
  const createResult = (name, score, file = null) => ({
    name,
    score,
    file: file || `${name}.js`,
    startLine: 1,
  });

  describe('RRF fallback', () => {
    it('should fallback to RRF when shouldFallbackToRRF returns true', () => {
      // Trigger insufficient results fallback
      const lexical = [createResult('a', 1.0), createResult('b', 0.9)];
      const semantic = [createResult('c', 0.8)];

      const result = searchInstance.robustCCFusion(lexical, semantic);

      expect(result.method).toBe('rrf');
      expect(result.fallbackReason).toBe('insufficient_results');
      expect(result.results).toBeDefined();
    });

    it('should fallback to RRF for zero variance scores', () => {
      const lexical = [
        createResult('a', 5.0),
        createResult('b', 5.0),
        createResult('c', 5.0),
      ];
      const semantic = [
        createResult('d', 0.9),
        createResult('e', 0.7),
        createResult('f', 0.5),
      ];

      const result = searchInstance.robustCCFusion(lexical, semantic);

      expect(result.method).toBe('rrf');
      expect(result.fallbackReason).toBe('zero_variance');
    });
  });

  describe('CC fusion with routeType', () => {
    // Create well-behaved inputs that won't trigger fallback
    const createGoodInputs = () => ({
      lexical: [
        createResult('a', 1.0),
        createResult('b', 0.8),
        createResult('c', 0.6),
        createResult('d', 0.4),
        createResult('e', 0.2),
      ],
      semantic: [
        createResult('f', 0.9),
        createResult('g', 0.7),
        createResult('h', 0.5),
        createResult('i', 0.3),
        createResult('j', 0.1),
      ],
    });

    it('should use alpha=0.85 for identifier/lexical routeType', () => {
      const { lexical, semantic } = createGoodInputs();

      const result = searchInstance.robustCCFusion(lexical, semantic, 'identifier');

      expect(result.method).toBe('cc_robust');
      expect(result.fallbackReason).toBeNull();
      expect(result.results[0].alpha).toBe(0.85);
    });

    it('should use alpha=0.85 for lexical routeType', () => {
      const { lexical, semantic } = createGoodInputs();

      const result = searchInstance.robustCCFusion(lexical, semantic, 'lexical');

      expect(result.method).toBe('cc_robust');
      expect(result.results[0].alpha).toBe(0.85);
    });

    it('should use alpha=0.25 for semantic/conceptual routeType', () => {
      const { lexical, semantic } = createGoodInputs();

      const result = searchInstance.robustCCFusion(lexical, semantic, 'semantic');

      expect(result.method).toBe('cc_robust');
      expect(result.results[0].alpha).toBe(0.25);
    });

    it('should use alpha=0.25 for conceptual routeType', () => {
      const { lexical, semantic } = createGoodInputs();

      const result = searchInstance.robustCCFusion(lexical, semantic, 'conceptual');

      expect(result.method).toBe('cc_robust');
      expect(result.results[0].alpha).toBe(0.25);
    });

    it('should use alpha=0.55 for mixed/hybrid routeType', () => {
      const { lexical, semantic } = createGoodInputs();

      const result = searchInstance.robustCCFusion(lexical, semantic, 'mixed');

      expect(result.method).toBe('cc_robust');
      expect(result.results[0].alpha).toBe(0.55);
    });

    it('should use alpha=0.90 for structural routeType', () => {
      const { lexical, semantic } = createGoodInputs();

      const result = searchInstance.robustCCFusion(lexical, semantic, 'structural');

      expect(result.method).toBe('cc_robust');
      expect(result.results[0].alpha).toBe(0.90);
    });

    it('should use default alpha=0.5 for unknown routeType', () => {
      const { lexical, semantic } = createGoodInputs();

      const result = searchInstance.robustCCFusion(lexical, semantic, 'unknown_type');

      expect(result.method).toBe('cc_robust');
      expect(result.results[0].alpha).toBe(0.5);
    });

    it('should respect custom alpha in options', () => {
      const { lexical, semantic } = createGoodInputs();

      const result = searchInstance.robustCCFusion(lexical, semantic, 'identifier', {
        alpha: 0.7,
      });

      expect(result.method).toBe('cc_robust');
      expect(result.results[0].alpha).toBe(0.7);
    });
  });

  describe('score combination', () => {
    it('should combine lexical and semantic scores correctly', () => {
      const lexical = [
        createResult('shared', 1.0, 'shared.js'),
        createResult('lexOnly', 0.8, 'lexOnly.js'),
      ];
      const semantic = [
        createResult('shared', 0.9, 'shared.js'),
        createResult('semOnly', 0.7, 'semOnly.js'),
      ];

      // Add extra results to avoid fallback
      lexical.push(createResult('lex2', 0.6), createResult('lex3', 0.4));
      semantic.push(createResult('sem2', 0.5), createResult('sem3', 0.3));

      const result = searchInstance.robustCCFusion(lexical, semantic, 'mixed');

      expect(result.method).toBe('cc_robust');

      // Find the shared result
      const sharedResult = result.results.find((r) => r.name === 'shared');
      expect(sharedResult).toBeDefined();
      expect(sharedResult.sources).toContain('lexical');
      expect(sharedResult.sources).toContain('semantic');

      // Shared result should have both lexScore and semScore
      expect(sharedResult.lexScore).toBeDefined();
      expect(sharedResult.semScore).toBeDefined();
    });

    it('should sort results by combined score descending', () => {
      const lexical = [
        createResult('a', 1.0),
        createResult('b', 0.8),
        createResult('c', 0.6),
        createResult('d', 0.4),
        createResult('e', 0.2),
      ];
      const semantic = [
        createResult('f', 0.9),
        createResult('g', 0.7),
        createResult('h', 0.5),
        createResult('i', 0.3),
        createResult('j', 0.1),
      ];

      const result = searchInstance.robustCCFusion(lexical, semantic, 'mixed');

      // Verify descending order
      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].score).toBeGreaterThanOrEqual(result.results[i].score);
      }
    });

    it('should include ccScore equal to score', () => {
      const lexical = [
        createResult('a', 1.0),
        createResult('b', 0.5),
        createResult('c', 0.1),
      ];
      const semantic = [
        createResult('d', 0.9),
        createResult('e', 0.5),
        createResult('f', 0.1),
      ];

      const result = searchInstance.robustCCFusion(lexical, semantic, 'mixed');

      result.results.forEach((r) => {
        expect(r.ccScore).toBe(r.score);
      });
    });
  });

  describe('source tracking', () => {
    it('should track sources correctly for lexical-only results', () => {
      const lexical = [
        createResult('lexOnly1', 1.0),
        createResult('lexOnly2', 0.8),
        createResult('lexOnly3', 0.6),
      ];
      const semantic = [
        createResult('semOnly1', 0.9),
        createResult('semOnly2', 0.7),
        createResult('semOnly3', 0.5),
      ];

      const result = searchInstance.robustCCFusion(lexical, semantic, 'mixed');

      const lexOnlyResult = result.results.find((r) => r.name === 'lexOnly1');
      expect(lexOnlyResult.sources).toEqual(['lexical']);
    });

    it('should track sources correctly for semantic-only results', () => {
      const lexical = [
        createResult('lexOnly1', 1.0),
        createResult('lexOnly2', 0.8),
        createResult('lexOnly3', 0.6),
      ];
      const semantic = [
        createResult('semOnly1', 0.9),
        createResult('semOnly2', 0.7),
        createResult('semOnly3', 0.5),
      ];

      const result = searchInstance.robustCCFusion(lexical, semantic, 'mixed');

      const semOnlyResult = result.results.find((r) => r.name === 'semOnly1');
      expect(semOnlyResult.sources).toEqual(['semantic']);
    });

    it('should track both sources for shared results', () => {
      const lexical = [
        createResult('shared', 1.0, 'shared.js'),
        createResult('lex1', 0.8),
        createResult('lex2', 0.6),
      ];
      const semantic = [
        createResult('shared', 0.9, 'shared.js'),
        createResult('sem1', 0.7),
        createResult('sem2', 0.5),
      ];

      const result = searchInstance.robustCCFusion(lexical, semantic, 'mixed');

      const sharedResult = result.results.find((r) => r.name === 'shared');
      expect(sharedResult.sources).toContain('lexical');
      expect(sharedResult.sources).toContain('semantic');
      expect(sharedResult.sources.length).toBe(2);
    });
  });
});

// ============================================================================
// variance Tests
// ============================================================================

describe('variance', () => {
  it('should return 0 for empty array', () => {
    expect(searchInstance.variance([])).toBe(0);
  });

  it('should return 0 for single element', () => {
    expect(searchInstance.variance([42])).toBe(0);
  });

  it('should return 0 for uniform values', () => {
    expect(searchInstance.variance([5, 5, 5, 5, 5])).toBe(0);
  });

  it('should calculate correct variance for known distribution', () => {
    // Variance of [1, 2, 3, 4, 5]:
    // Mean = 3
    // Variance = ((1-3)^2 + (2-3)^2 + (3-3)^2 + (4-3)^2 + (5-3)^2) / 5
    //          = (4 + 1 + 0 + 1 + 4) / 5 = 10 / 5 = 2
    const result = searchInstance.variance([1, 2, 3, 4, 5]);
    expect(result).toBe(2);
  });

  it('should calculate correct variance for simple case', () => {
    // Variance of [0, 10]:
    // Mean = 5
    // Variance = ((0-5)^2 + (10-5)^2) / 2 = (25 + 25) / 2 = 25
    const result = searchInstance.variance([0, 10]);
    expect(result).toBe(25);
  });

  it('should handle negative numbers', () => {
    // Variance of [-5, 0, 5]:
    // Mean = 0
    // Variance = (25 + 0 + 25) / 3 = 50/3 = 16.666...
    const result = searchInstance.variance([-5, 0, 5]);
    expect(result).toBeCloseTo(50 / 3, 10);
  });

  it('should handle floating point numbers', () => {
    // Variance of [0.1, 0.2, 0.3]:
    // Mean = 0.2
    // Variance = ((0.1-0.2)^2 + (0.2-0.2)^2 + (0.3-0.2)^2) / 3
    //          = (0.01 + 0 + 0.01) / 3 = 0.02/3
    const result = searchInstance.variance([0.1, 0.2, 0.3]);
    expect(result).toBeCloseTo(0.02 / 3, 10);
  });

  it('should handle large numbers', () => {
    const result = searchInstance.variance([1000000, 2000000, 3000000]);
    // Mean = 2000000
    // Variance = ((1e6-2e6)^2 + (2e6-2e6)^2 + (3e6-2e6)^2) / 3
    //          = (1e12 + 0 + 1e12) / 3 = 2e12/3
    expect(result).toBeCloseTo(2e12 / 3, -5); // Less precision for large numbers
  });
});

// ============================================================================
// getBoostIntent Tests
// ============================================================================

describe('getBoostIntent', () => {
  describe('lexical mode', () => {
    it('should return definition_strong for lexical + high confidence (>= 0.8)', () => {
      expect(searchInstance.getBoostIntent('lexical', 0.8)).toBe('definition_strong');
      expect(searchInstance.getBoostIntent('lexical', 0.9)).toBe('definition_strong');
      expect(searchInstance.getBoostIntent('lexical', 1.0)).toBe('definition_strong');
    });

    it('should return definition_mild for lexical + low confidence (< 0.8)', () => {
      expect(searchInstance.getBoostIntent('lexical', 0.7)).toBe('definition_mild');
      expect(searchInstance.getBoostIntent('lexical', 0.5)).toBe('definition_mild');
      expect(searchInstance.getBoostIntent('lexical', 0.1)).toBe('definition_mild');
      expect(searchInstance.getBoostIntent('lexical', 0)).toBe('definition_mild');
    });
  });

  describe('hybrid mode', () => {
    it('should return general for hybrid mode regardless of confidence', () => {
      expect(searchInstance.getBoostIntent('hybrid', 0.9)).toBe('general');
      expect(searchInstance.getBoostIntent('hybrid', 0.5)).toBe('general');
      expect(searchInstance.getBoostIntent('hybrid', 0.1)).toBe('general');
    });
  });

  describe('semantic mode', () => {
    it('should return none for semantic mode regardless of confidence', () => {
      expect(searchInstance.getBoostIntent('semantic', 0.9)).toBe('none');
      expect(searchInstance.getBoostIntent('semantic', 0.5)).toBe('none');
      expect(searchInstance.getBoostIntent('semantic', 0.1)).toBe('none');
    });
  });

  describe('structural mode', () => {
    it('should return structural for structural mode regardless of confidence', () => {
      expect(searchInstance.getBoostIntent('structural', 0.9)).toBe('structural');
      expect(searchInstance.getBoostIntent('structural', 0.5)).toBe('structural');
      expect(searchInstance.getBoostIntent('structural', 0.1)).toBe('structural');
    });
  });

  describe('fallback cases', () => {
    it('should return general for unknown modes', () => {
      expect(searchInstance.getBoostIntent('unknown', 0.9)).toBe('general');
      expect(searchInstance.getBoostIntent('foobar', 0.5)).toBe('general');
    });

    it('should return general for undefined/null modes', () => {
      expect(searchInstance.getBoostIntent(undefined, 0.9)).toBe('general');
      expect(searchInstance.getBoostIntent(null, 0.5)).toBe('general');
    });

    it('should handle edge case confidence values', () => {
      // Exactly at threshold
      expect(searchInstance.getBoostIntent('lexical', 0.8)).toBe('definition_strong');
      // Just below threshold
      expect(searchInstance.getBoostIntent('lexical', 0.79999)).toBe('definition_mild');
    });
  });
});
