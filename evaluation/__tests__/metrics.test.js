/**
 * Unit tests for SEARCH 100x Evaluation Metrics
 *
 * Tests all metric calculations including:
 * - MRR@K (Mean Reciprocal Rank)
 * - NDCG@K (Normalized Discounted Cumulative Gain)
 * - Recall@K
 * - Success Rate@K
 * - Route Accuracy
 * - Cache Hit Rate
 * - Bootstrap Confidence Intervals
 */

import { describe, it, expect } from 'vitest';
import {
  calculateMRR,
  calculateNDCG,
  calculateRecall,
  calculateSuccessRate,
  calculateRouteAccuracy,
  calculateCacheHitRate,
  bootstrapCI,
  calculateAllMetrics,
  calculateMAP,
} from '../lib/metrics.js';


// =============================================================================
// MRR (Mean Reciprocal Rank) Tests
// =============================================================================

describe('calculateMRR', () => {
  it('returns 1.0 when first result is relevant', () => {
    const queries = [{ matchedResults: [{ relevanceGrade: 3 }] }];
    expect(calculateMRR(queries)).toBe(1.0);
  });

  it('returns 0.5 when first relevant result is at position 2', () => {
    const queries = [{ matchedResults: [{ relevanceGrade: 0 }, { relevanceGrade: 2 }] }];
    expect(calculateMRR(queries)).toBe(0.5);
  });

  it('returns 0.333... when first relevant result is at position 3', () => {
    const queries = [{
      matchedResults: [
        { relevanceGrade: 0 },
        { relevanceGrade: 0 },
        { relevanceGrade: 1 }
      ]
    }];
    expect(calculateMRR(queries)).toBeCloseTo(1/3, 4);
  });

  it('returns 0 for empty results', () => {
    expect(calculateMRR([])).toBe(0);
  });

  it('returns 0 for null/undefined input', () => {
    expect(calculateMRR(null)).toBe(0);
    expect(calculateMRR(undefined)).toBe(0);
  });

  it('respects k cutoff', () => {
    const queries = [{
      matchedResults: Array(15).fill({ relevanceGrade: 0 }).concat([{ relevanceGrade: 1 }])
    }];
    // Relevant at position 16, cutoff at 10 - should return 0
    expect(calculateMRR(queries, 10)).toBe(0);
  });

  it('averages MRR across multiple queries', () => {
    const queries = [
      { matchedResults: [{ relevanceGrade: 3 }] },  // RR = 1
      { matchedResults: [{ relevanceGrade: 0 }, { relevanceGrade: 2 }] }  // RR = 0.5
    ];
    // Average: (1 + 0.5) / 2 = 0.75
    expect(calculateMRR(queries)).toBe(0.75);
  });

  it('handles queries with expected but no matches correctly', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 0 }],
      expected: { exact: [{ file: 'test.java' }] }
    }];
    // Has expected but no relevant found - counts as 0 RR
    expect(calculateMRR(queries)).toBe(0);
  });

  it('handles match object structure with nested relevanceGrade', () => {
    const queries = [{
      matchedResults: [
        { match: { relevanceGrade: 3 } },
        { match: { relevanceGrade: 2 } }
      ]
    }];
    expect(calculateMRR(queries)).toBe(1.0);
  });

  it('uses results as fallback for matchedResults', () => {
    const queries = [{
      results: [{ relevanceGrade: 3 }]
    }];
    expect(calculateMRR(queries)).toBe(1.0);
  });
});


// =============================================================================
// NDCG (Normalized Discounted Cumulative Gain) Tests
// =============================================================================

describe('calculateNDCG', () => {
  it('returns 1.0 for perfect ranking', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 3 }, { relevanceGrade: 2 }, { relevanceGrade: 1 }],
      expected: { exact: [{ relevanceGrade: 3 }, { relevanceGrade: 2 }, { relevanceGrade: 1 }] }
    }];
    const ndcg = calculateNDCG(queries);
    expect(ndcg).toBeCloseTo(1.0, 2);
  });

  it('returns less than 1.0 for suboptimal ranking', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 1 }, { relevanceGrade: 3 }, { relevanceGrade: 2 }],
      expected: { exact: [{ relevanceGrade: 3 }, { relevanceGrade: 2 }, { relevanceGrade: 1 }] }
    }];
    const ndcg = calculateNDCG(queries);
    expect(ndcg).toBeLessThan(1.0);
    expect(ndcg).toBeGreaterThan(0);
  });

  it('returns 0 for empty queries', () => {
    expect(calculateNDCG([])).toBe(0);
    expect(calculateNDCG(null)).toBe(0);
  });

  it('handles queries with no relevant results', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 0 }, { relevanceGrade: 0 }],
      expected: { exact: [{ relevanceGrade: 3 }] }
    }];
    const ndcg = calculateNDCG(queries);
    expect(ndcg).toBe(0);
  });

  it('handles anyOf expected grades correctly', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 2 }],
      expected: { anyOf: [{ minMatches: 2 }] }
    }];
    const ndcg = calculateNDCG(queries);
    expect(ndcg).toBeGreaterThan(0);
  });

  it('handles contains expected grades correctly', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 1 }],
      expected: { contains: [{ namePattern: '.*' }] }
    }];
    const ndcg = calculateNDCG(queries);
    expect(ndcg).toBeGreaterThan(0);
  });

  it('respects k cutoff', () => {
    const queries = [{
      matchedResults: Array(15).fill({ relevanceGrade: 1 }),
      expected: {}
    }];
    const ndcgK5 = calculateNDCG(queries, 5);
    const ndcgK10 = calculateNDCG(queries, 10);
    // K=10 should consider more results
    expect(ndcgK10).toBeGreaterThanOrEqual(ndcgK5);
  });
});


// =============================================================================
// Recall Tests
// =============================================================================

describe('calculateRecall', () => {
  it('returns 1.0 when all relevant results are found', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 3 }, { relevanceGrade: 2 }],
      expected: { exact: [{ file: 'a.java' }, { file: 'b.java' }] }
    }];
    expect(calculateRecall(queries)).toBe(1.0);
  });

  it('returns 0.5 when half of relevant results are found', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 3 }],
      expected: { exact: [{ file: 'a.java' }, { file: 'b.java' }] }
    }];
    expect(calculateRecall(queries)).toBe(0.5);
  });

  it('returns 0 for empty queries', () => {
    expect(calculateRecall([])).toBe(0);
    expect(calculateRecall(null)).toBe(0);
  });

  it('returns 0 when no relevant expected', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 3 }],
      expected: {}
    }];
    // No expected = skip this query
    expect(calculateRecall(queries)).toBe(0);
  });

  it('respects k cutoff', () => {
    const queries = [{
      matchedResults: [
        ...Array(5).fill({ relevanceGrade: 1 }),
        ...Array(15).fill({ relevanceGrade: 0 }),
        ...Array(5).fill({ relevanceGrade: 1 })  // These are at positions 21-25, outside k=20
      ],
      expected: { exact: Array(10).fill({ file: 'x.java' }) }
    }];
    // 5 relevant in top 20 out of 10 expected = 0.5
    expect(calculateRecall(queries, 20)).toBe(0.5);
  });

  it('counts anyOf minMatches correctly', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 2 }],
      expected: { anyOf: [{ minMatches: 2 }] }
    }];
    // 1 found out of 2 expected
    expect(calculateRecall(queries)).toBe(0.5);
  });
});


// =============================================================================
// Success Rate Tests
// =============================================================================

describe('calculateSuccessRate', () => {
  it('returns 1.0 when all queries have at least 1 relevant result', () => {
    const queries = [
      { matchedResults: [{ relevanceGrade: 3 }] },
      { matchedResults: [{ relevanceGrade: 2 }] }
    ];
    expect(calculateSuccessRate(queries)).toBe(1.0);
  });

  it('returns 0.5 when half of queries succeed', () => {
    const queries = [
      { matchedResults: [{ relevanceGrade: 3 }] },
      { matchedResults: [{ relevanceGrade: 0 }] }
    ];
    expect(calculateSuccessRate(queries)).toBe(0.5);
  });

  it('returns 0 for empty queries', () => {
    expect(calculateSuccessRate([])).toBe(0);
  });

  it('respects minRelevant parameter', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 3 }],
      minRelevant: 2
    }];
    // Only 1 relevant, need 2
    expect(calculateSuccessRate(queries)).toBe(0);
  });

  it('respects k cutoff', () => {
    const queries = [{
      matchedResults: [
        ...Array(10).fill({ relevanceGrade: 0 }),
        { relevanceGrade: 3 }
      ]
    }];
    // Relevant at position 11, k=10 should fail
    expect(calculateSuccessRate(queries, 10)).toBe(0);
    expect(calculateSuccessRate(queries, 15)).toBe(1.0);
  });
});


// =============================================================================
// Route Accuracy Tests
// =============================================================================

describe('calculateRouteAccuracy', () => {
  it('returns 1.0 accuracy when all routes match', () => {
    const queries = [
      { actualRoute: 'lexical', expectedRoute: 'lexical' },
      { actualRoute: 'semantic', expectedRoute: 'semantic' }
    ];
    const result = calculateRouteAccuracy(queries);
    expect(result.accuracy).toBe(1.0);
    expect(result.correct).toBe(2);
    expect(result.total).toBe(2);
    expect(result.misroutes).toHaveLength(0);
  });

  it('returns 0.5 accuracy when half match', () => {
    const queries = [
      { id: 'Q1', query: 'test', actualRoute: 'lexical', expectedRoute: 'lexical' },
      { id: 'Q2', query: 'test2', actualRoute: 'semantic', expectedRoute: 'lexical' }
    ];
    const result = calculateRouteAccuracy(queries);
    expect(result.accuracy).toBe(0.5);
    expect(result.correct).toBe(1);
    expect(result.misroutes).toHaveLength(1);
    expect(result.misroutes[0]).toEqual({
      queryId: 'Q2',
      query: 'test2',
      expected: 'lexical',
      actual: 'semantic'
    });
  });

  it('returns 0 for empty queries', () => {
    const result = calculateRouteAccuracy([]);
    expect(result.accuracy).toBe(0);
    expect(result.correct).toBe(0);
    expect(result.total).toBe(0);
  });

  it('counts queries without expectedRoute as mismatches in total', () => {
    // Current implementation counts ALL queries in total, so missing expectedRoute
    // is counted as a non-match (accuracy = correct / total)
    const queries = [
      { actualRoute: 'lexical' },  // No expectedRoute - counts in total but not as correct
      { actualRoute: 'semantic', expectedRoute: 'semantic' }  // Correct match
    ];
    const result = calculateRouteAccuracy(queries);
    // 1 correct out of 2 total = 0.5
    expect(result.accuracy).toBe(0.5);
    expect(result.correct).toBe(1);
    expect(result.total).toBe(2);
  });
});


// =============================================================================
// Cache Hit Rate Tests
// =============================================================================

describe('calculateCacheHitRate', () => {
  it('returns 1.0 when all queries are cached', () => {
    const queries = [
      { stats: { embedding: { source: 'vocabulary' } } },
      { stats: { embedding: { source: 'lru' } } },
      { stats: { embedding: { source: 'semantic' } } }
    ];
    const result = calculateCacheHitRate(queries);
    expect(result.rate).toBe(1.0);
    expect(result.breakdown.vocabulary).toBe(1);
    expect(result.breakdown.lru).toBe(1);
    expect(result.breakdown.semantic).toBe(1);
    expect(result.breakdown.api).toBe(0);
  });

  it('returns 0 when all queries hit API', () => {
    const queries = [
      { stats: { embedding: { source: 'api' } } },
      { stats: { embedding: { source: 'api' } } }
    ];
    const result = calculateCacheHitRate(queries);
    expect(result.rate).toBe(0);
    expect(result.breakdown.api).toBe(2);
  });

  it('returns 0.5 when half cached', () => {
    const queries = [
      { stats: { embedding: { source: 'vocabulary' } } },
      { stats: { embedding: { source: 'api' } } }
    ];
    const result = calculateCacheHitRate(queries);
    expect(result.rate).toBe(0.5);
  });

  it('returns 0 for empty queries', () => {
    const result = calculateCacheHitRate([]);
    expect(result.rate).toBe(0);
  });

  it('defaults to api when source is missing', () => {
    const queries = [
      { stats: {} },
      { stats: { embedding: {} } }
    ];
    const result = calculateCacheHitRate(queries);
    expect(result.rate).toBe(0);
    expect(result.breakdown.api).toBe(2);
  });
});


// =============================================================================
// Bootstrap CI Tests
// =============================================================================

describe('bootstrapCI', () => {
  it('returns valid confidence interval bounds', () => {
    const queries = Array(20).fill({ matchedResults: [{ relevanceGrade: 3 }] });
    const ci = bootstrapCI(queries, calculateMRR, 100);
    expect(ci.lower).toBeLessThanOrEqual(ci.mean);
    expect(ci.upper).toBeGreaterThanOrEqual(ci.mean);
  });

  it('returns same values for single query', () => {
    const queries = [{ matchedResults: [{ relevanceGrade: 3 }] }];
    const ci = bootstrapCI(queries, calculateMRR, 100);
    expect(ci.lower).toBe(ci.mean);
    expect(ci.upper).toBe(ci.mean);
    expect(ci.stddev).toBe(0);
  });

  it('handles edge case of index bounds', () => {
    // This tests the upper bound fix that prevents out-of-bounds access
    const queries = Array(10).fill({ matchedResults: [{ relevanceGrade: 1 }] });
    const ci = bootstrapCI(queries, calculateMRR, 1000);
    // Should not throw - the upper bound fix prevents out-of-bounds access
    expect(ci.upper).toBeDefined();
    expect(typeof ci.upper).toBe('number');
    expect(ci.upper).not.toBeNaN();
  });

  it('returns consistent results with high iteration count', () => {
    // Need to include expected for MRR to count non-matching queries
    const queries = Array(50).fill(null).map((_, i) => ({
      matchedResults: i % 2 === 0 ? [{ relevanceGrade: 3 }] : [{ relevanceGrade: 0 }],
      expected: { exact: [{ file: 'test.java' }] }  // Required for proper MRR calculation
    }));
    const ci = bootstrapCI(queries, calculateMRR, 1000);
    // Mean should be around 0.5 (half succeed with RR=1, half have 0 RR with expected)
    expect(ci.mean).toBeCloseTo(0.5, 1);
    expect(ci.stddev).toBeGreaterThan(0);
  });

  it('handles empty queries', () => {
    const ci = bootstrapCI([], calculateMRR, 100);
    expect(ci.mean).toBe(0);
    expect(ci.lower).toBe(0);
    expect(ci.upper).toBe(0);
  });

  // Edge case tests
  it('handles single query without error', () => {
    const queries = [{ matchedResults: [{ relevanceGrade: 3 }] }];
    const ci = bootstrapCI(queries, calculateMRR, 100);
    // With 1 query, should return the single value for all
    expect(ci.lower).toBe(ci.upper);
    expect(ci.mean).toBe(1.0);
  });

  it('lower bound is never negative', () => {
    const queries = Array(5).fill({ matchedResults: [{ relevanceGrade: 1 }] });
    const ci = bootstrapCI(queries, calculateMRR, 10); // Small iterations
    expect(ci.lower).toBeGreaterThanOrEqual(0);
    expect(ci.lower).toBeLessThanOrEqual(1);
  });
});


// =============================================================================
// MAP (Mean Average Precision) Edge Case Tests
// =============================================================================

describe('calculateMAP edge cases', () => {
  it('handles all relevant docs beyond position k', () => {
    const queries = [{
      matchedResults: Array(15).fill({ relevanceGrade: 0 }),
      expected: { exact: [{ relevanceGrade: 3 }] } // Relevant doc not in results
    }];
    const map = calculateMAP(queries, 10);
    expect(map).toBe(0); // No relevant in top-k
  });

  it('handles query with no expected results', () => {
    const queries = [{ matchedResults: [{ relevanceGrade: 3 }], expected: {} }];
    const map = calculateMAP(queries, 10);
    // Should handle gracefully - no expected means query is skipped
    expect(map).toBe(0);
  });

  it('handles empty expected.exact array', () => {
    const queries = [{ matchedResults: [{ relevanceGrade: 3 }], expected: { exact: [] } }];
    const map = calculateMAP(queries, 10);
    expect(map).toBe(0);
  });

  it('returns 0 for empty queries', () => {
    expect(calculateMAP([])).toBe(0);
    expect(calculateMAP(null)).toBe(0);
    expect(calculateMAP(undefined)).toBe(0);
  });

  it('calculates perfect MAP for perfect ranking', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 3 }, { relevanceGrade: 2 }],
      expected: { exact: [{ file: 'a.java' }, { file: 'b.java' }] }
    }];
    const map = calculateMAP(queries, 10);
    // All relevant at positions 1 and 2: P@1=1/1=1, P@2=2/2=1
    // AP = (1 + 1) / 2 = 1.0
    expect(map).toBeCloseTo(1.0, 2);
  });

  it('respects k cutoff', () => {
    const queries = [{
      matchedResults: [
        ...Array(10).fill({ relevanceGrade: 0 }),
        { relevanceGrade: 3 }  // Relevant at position 11
      ],
      expected: { exact: [{ file: 'a.java' }] }
    }];
    // k=10 should not see the relevant result
    expect(calculateMAP(queries, 10)).toBe(0);
    // k=15 should see it
    expect(calculateMAP(queries, 15)).toBeGreaterThan(0);
  });
});


// =============================================================================
// NDCG Edge Case Tests
// =============================================================================

describe('calculateNDCG edge cases', () => {
  it('skips queries with no ground truth', () => {
    const queries = [
      { matchedResults: [{ relevanceGrade: 3 }], expected: {} }, // No ground truth
      { matchedResults: [{ relevanceGrade: 3 }], expected: { exact: [{ relevanceGrade: 3 }] } }
    ];
    const ndcg = calculateNDCG(queries);
    // Should only count the second query
    expect(ndcg).toBeCloseTo(1.0, 2);
  });

  it('handles empty exact array in expected', () => {
    const queries = [
      { matchedResults: [{ relevanceGrade: 3 }], expected: { exact: [] } }
    ];
    const ndcg = calculateNDCG(queries);
    // Empty ground truth should be skipped, returning 0
    expect(ndcg).toBe(0);
  });

  it('handles mixed ground truth types', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 2 }, { relevanceGrade: 1 }],
      expected: {
        anyOf: [{ minMatches: 1 }],
        contains: [{ namePattern: '.*' }]
      }
    }];
    const ndcg = calculateNDCG(queries);
    expect(ndcg).toBeGreaterThan(0);
    expect(ndcg).toBeLessThanOrEqual(1);
  });
});


// =============================================================================
// calculateAllMetrics Tests
// =============================================================================

describe('calculateAllMetrics', () => {
  it('returns all metrics in expected structure', () => {
    const queries = [
      {
        matchedResults: [{ relevanceGrade: 3 }],
        actualRoute: 'lexical',
        expectedRoute: 'lexical',
        stats: { embedding: { source: 'vocabulary' } }
      }
    ];
    const metrics = calculateAllMetrics(queries);

    expect(metrics).toHaveProperty('mrr');
    expect(metrics).toHaveProperty('ndcg');
    expect(metrics).toHaveProperty('recall');
    expect(metrics).toHaveProperty('successRate');
    expect(metrics).toHaveProperty('successRate5');
    expect(metrics).toHaveProperty('successRate1');
    expect(metrics).toHaveProperty('routeAccuracy');
    expect(metrics).toHaveProperty('cacheHitRate');
  });

  it('respects k and recallK options', () => {
    const queries = [{
      matchedResults: Array(25).fill({ relevanceGrade: 1 }),
      expected: { exact: Array(30).fill({ file: 'x.java' }) }
    }];
    const metricsK5 = calculateAllMetrics(queries, { k: 5, recallK: 10 });
    const metricsK10 = calculateAllMetrics(queries, { k: 10, recallK: 20 });

    // Different k values should produce different results
    expect(metricsK5.recall).not.toBe(metricsK10.recall);
  });

  it('includes CI when requested', () => {
    const queries = Array(15).fill({
      matchedResults: [{ relevanceGrade: 3 }],
      expected: { exact: [{ file: 'x.java' }] }
    });
    const metrics = calculateAllMetrics(queries, { includeCI: true });

    expect(metrics).toHaveProperty('mrrCI');
    expect(metrics).toHaveProperty('ndcgCI');
    expect(metrics).toHaveProperty('recallCI');
    expect(metrics.mrrCI).toHaveProperty('lower');
    expect(metrics.mrrCI).toHaveProperty('upper');
    expect(metrics.mrrCI).toHaveProperty('mean');
  });

  it('omits CI when not requested', () => {
    const queries = [{
      matchedResults: [{ relevanceGrade: 3 }]
    }];
    const metrics = calculateAllMetrics(queries, { includeCI: false });

    expect(metrics).not.toHaveProperty('mrrCI');
    expect(metrics).not.toHaveProperty('ndcgCI');
  });
});
