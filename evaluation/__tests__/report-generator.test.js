/**
 * Unit tests for SEARCH 100x Report Generator
 *
 * Tests report generation including:
 * - Latency categorization
 * - Report structure
 * - Console/JSON formatting
 * - Baseline comparison and regression detection
 */

import { describe, it, expect } from 'vitest';
import {
  categorizeLatency,
  separateByLatency,
  getLatencyReport,
  getMetricsByCategory,
  getFailedQueries,
  generateReport,
  formatConsoleReport,
  formatJsonReport,
  compareToBaseline,
} from '../lib/report-generator.js';


// =============================================================================
// categorizeLatency Tests
// =============================================================================

describe('categorizeLatency', () => {
  it('returns cold for isColdStart=true', () => {
    const query = { isColdStart: true };
    expect(categorizeLatency(query)).toBe('cold');
  });

  it('returns cold for isFirstQuery=true', () => {
    const query = { isFirstQuery: true };
    expect(categorizeLatency(query)).toBe('cold');
  });

  it('returns warm_cached for vocabulary source', () => {
    const query = { stats: { embedding: { source: 'vocabulary' } } };
    expect(categorizeLatency(query)).toBe('warm_cached');
  });

  it('returns warm_cached for lru source', () => {
    const query = { stats: { embedding: { source: 'lru' } } };
    expect(categorizeLatency(query)).toBe('warm_cached');
  });

  it('returns warm_cached for semantic source', () => {
    const query = { stats: { embedding: { source: 'semantic' } } };
    expect(categorizeLatency(query)).toBe('warm_cached');
  });

  it('returns warm_uncached for api source', () => {
    const query = { stats: { embedding: { source: 'api' } } };
    expect(categorizeLatency(query)).toBe('warm_uncached');
  });

  it('returns warm_uncached when no cache source', () => {
    const query = { stats: {} };
    expect(categorizeLatency(query)).toBe('warm_uncached');
  });

  it('returns warm_uncached for undefined stats', () => {
    const query = {};
    expect(categorizeLatency(query)).toBe('warm_uncached');
  });
});


// =============================================================================
// separateByLatency Tests
// =============================================================================

describe('separateByLatency', () => {
  it('separates queries into correct buckets', () => {
    const queries = [
      { latencyMs: 1000, isColdStart: true },
      { latencyMs: 200, stats: { embedding: { source: 'api' } } },
      { latencyMs: 10, stats: { embedding: { source: 'vocabulary' } } }
    ];
    const buckets = separateByLatency(queries);

    expect(buckets.cold).toEqual([1000]);
    expect(buckets.warm_uncached).toEqual([200]);
    expect(buckets.warm_cached).toEqual([10]);
  });

  it('handles empty queries', () => {
    const buckets = separateByLatency([]);
    expect(buckets.cold).toEqual([]);
    expect(buckets.warm_uncached).toEqual([]);
    expect(buckets.warm_cached).toEqual([]);
  });
});


// =============================================================================
// getLatencyReport Tests
// =============================================================================

describe('getLatencyReport', () => {
  it('returns null for empty buckets', () => {
    const queries = [
      { latencyMs: 10, stats: { embedding: { source: 'vocabulary' } } }
    ];
    const report = getLatencyReport(queries);

    expect(report.cold).toBeNull();
    expect(report.warmUncached).toBeNull();
    expect(report.warmCached).not.toBeNull();
    expect(report.counts.cold).toBe(0);
    expect(report.counts.warmCached).toBe(1);
  });

  it('calculates stats for each bucket', () => {
    const queries = [
      { latencyMs: 100, stats: { embedding: { source: 'api' } } },
      { latencyMs: 200, stats: { embedding: { source: 'api' } } },
      { latencyMs: 150, stats: { embedding: { source: 'api' } } }
    ];
    const report = getLatencyReport(queries);

    expect(report.warmUncached).not.toBeNull();
    expect(report.warmUncached.p50).toBeDefined();
    expect(report.warmUncached.p95).toBeDefined();
    expect(report.counts.warmUncached).toBe(3);
  });
});


// =============================================================================
// getMetricsByCategory Tests
// =============================================================================

describe('getMetricsByCategory', () => {
  it('groups metrics by category', () => {
    const queries = [
      {
        category: 'lexical',
        matchedResults: [{ relevanceGrade: 3 }],
        latencyMs: 10,
        actualRoute: 'lexical',
        expectedRoute: 'lexical'
      },
      {
        category: 'semantic',
        matchedResults: [{ relevanceGrade: 2 }],
        latencyMs: 200,
        actualRoute: 'semantic',
        expectedRoute: 'semantic'
      }
    ];
    const byCategory = getMetricsByCategory(queries);

    expect(byCategory).toHaveProperty('lexical');
    expect(byCategory).toHaveProperty('semantic');
    expect(byCategory.lexical.count).toBe(1);
    expect(byCategory.semantic.count).toBe(1);
    expect(byCategory.lexical.mrr).toBe(1.0);
  });

  it('uses unknown for queries without category', () => {
    const queries = [
      { matchedResults: [{ relevanceGrade: 1 }] }
    ];
    const byCategory = getMetricsByCategory(queries);

    expect(byCategory).toHaveProperty('unknown');
    expect(byCategory.unknown.count).toBe(1);
  });
});


// =============================================================================
// getFailedQueries Tests
// =============================================================================

describe('getFailedQueries', () => {
  it('identifies queries with 0 relevant in top K', () => {
    const queries = [
      {
        id: 'Q1',
        query: 'test query 1',
        matchedResults: [{ match: { relevanceGrade: 0 } }],
        results: [{ file: 'wrong.java', score: 0.5 }],
        expected: { exact: [{ file: 'right.java' }] }
      },
      {
        id: 'Q2',
        query: 'test query 2',
        matchedResults: [{ match: { relevanceGrade: 3 } }],
        results: [{ file: 'right.java', score: 0.9 }]
      }
    ];
    const failed = getFailedQueries(queries);

    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe('Q1');
    expect(failed[0].topResults).toHaveLength(1);
  });

  it('returns empty array when all queries succeed', () => {
    const queries = [
      { id: 'Q1', matchedResults: [{ match: { relevanceGrade: 3 } }] }
    ];
    const failed = getFailedQueries(queries);
    expect(failed).toHaveLength(0);
  });

  it('respects k cutoff', () => {
    const queries = [{
      id: 'Q1',
      query: 'test',
      matchedResults: [
        { match: { relevanceGrade: 0 } },
        { match: { relevanceGrade: 0 } },
        { match: { relevanceGrade: 3 } }  // Relevant at position 3
      ]
    }];
    // k=2 should mark as failed
    expect(getFailedQueries(queries, 2)).toHaveLength(1);
    // k=5 should mark as success
    expect(getFailedQueries(queries, 5)).toHaveLength(0);
  });
});


// =============================================================================
// generateReport Tests
// =============================================================================

describe('generateReport', () => {
  const mockQueries = [
    {
      id: 'TEST-001',
      query: 'AuthService',
      category: 'lexical',
      matchedResults: [{ relevanceGrade: 3 }],
      actualRoute: 'lexical',
      expectedRoute: 'lexical',
      latencyMs: 10,
      stats: { embedding: { source: 'vocabulary' } },
      expected: { exact: [{ file: 'AuthService.java' }] }
    },
  ];

  it('generates valid report structure', () => {
    const report = generateReport(mockQueries);

    expect(report.aggregate).toBeDefined();
    expect(report.aggregate.mrr).toBeGreaterThan(0);
    expect(report.routeAccuracy).toBeDefined();
    expect(report.latency).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(report.queryCount).toBe(1);
  });

  it('includes all aggregate metrics', () => {
    const report = generateReport(mockQueries);

    expect(report.aggregate).toHaveProperty('mrr');
    expect(report.aggregate).toHaveProperty('ndcg');
    expect(report.aggregate).toHaveProperty('recall');
    expect(report.aggregate).toHaveProperty('successRate');
    expect(report.aggregate).toHaveProperty('successRate5');
    expect(report.aggregate).toHaveProperty('successRate1');
  });

  it('handles empty data without throwing', () => {
    expect(() => generateReport([])).not.toThrow();
    const report = generateReport([]);
    expect(report.queryCount).toBe(0);
    expect(report.aggregate.mrr).toBe(0);
  });

  it('includes CI when queries >= 10 and includeCI=true', () => {
    const queries = Array(15).fill({
      matchedResults: [{ relevanceGrade: 3 }],
      expected: { exact: [{ file: 'x.java' }] },
      latencyMs: 10
    });
    const report = generateReport(queries, { includeCI: true });

    expect(report.aggregate.mrrCI).toBeDefined();
    expect(report.aggregate.ndcgCI).toBeDefined();
    expect(report.aggregate.recallCI).toBeDefined();
  });

  it('omits CI when queries < 10', () => {
    const queries = Array(5).fill({
      matchedResults: [{ relevanceGrade: 3 }],
      latencyMs: 10
    });
    const report = generateReport(queries, { includeCI: true });

    expect(report.aggregate.mrrCI).toBeUndefined();
  });

  it('includes cost when costTracker provided', () => {
    const mockCostTracker = {
      getStats: () => ({
        costs: { embed: 0.001, rerank: 0.002, total: 0.003 },
        calls: { embed: 10, embedCached: 5, rerank: 3, rerankSkipped: 2 },
        avgCostPerQuery: 0.0003
      })
    };
    const report = generateReport(mockQueries, { costTracker: mockCostTracker });

    expect(report.cost).not.toBeNull();
    expect(report.cost.costs.total).toBe(0.003);
  });

  it('uses custom k and recallK values', () => {
    const report = generateReport(mockQueries, { k: 5, recallK: 15 });
    // Report should be generated without error
    expect(report.aggregate).toBeDefined();
  });
});


// =============================================================================
// formatConsoleReport Tests
// =============================================================================

describe('formatConsoleReport', () => {
  it('generates readable console output', () => {
    const report = generateReport([{
      id: 'Q1',
      query: 'test query',
      matchedResults: [{ relevanceGrade: 3 }],
      actualRoute: 'lexical',
      expectedRoute: 'lexical',
      latencyMs: 10,
      stats: { embedding: { source: 'vocabulary' } }
    }]);
    const consoleOutput = formatConsoleReport(report, false);  // No colors

    expect(consoleOutput).toContain('SEARCH 100x EVALUATION REPORT');
    expect(consoleOutput).toContain('Aggregate Metrics');
    expect(consoleOutput).toContain('MRR@10');
    expect(consoleOutput).toContain('Routing');
    expect(consoleOutput).toContain('Cache Efficiency');
    expect(consoleOutput).toContain('Latency');
  });

  it('handles null values gracefully', () => {
    const report = generateReport([]);
    // Should not throw with empty data
    const consoleOutput = formatConsoleReport(report, false);
    expect(consoleOutput).toContain('0');
    expect(consoleOutput).toContain('Queries: 0');
  });

  it('supports color output', () => {
    const report = generateReport([{
      id: 'Q1',
      query: 'test query',
      matchedResults: [{ relevanceGrade: 3 }],
      latencyMs: 10
    }]);
    const consoleWithColors = formatConsoleReport(report, true);

    // Should contain ANSI escape codes
    expect(consoleWithColors).toContain('\x1b[');
  });

  it('shows misroutes when present', () => {
    const report = generateReport([{
      id: 'Q1',
      query: 'test query',
      matchedResults: [],
      actualRoute: 'semantic',
      expectedRoute: 'lexical',
      latencyMs: 10
    }]);
    const console = formatConsoleReport(report, false);

    expect(console).toContain('Misroutes');
  });

  it('truncates long query text', () => {
    const longQuery = 'a'.repeat(100);
    const report = generateReport([{
      id: 'Q1',
      query: longQuery,
      matchedResults: [],
      results: [],
      expected: { exact: [{ file: 'test.java' }] },
      latencyMs: 10
    }]);
    const console = formatConsoleReport(report, false);

    // Should truncate and add ellipsis
    expect(console).toContain('...');
  });
});


// =============================================================================
// formatJsonReport Tests
// =============================================================================

describe('formatJsonReport', () => {
  it('generates valid JSON', () => {
    const report = generateReport([{
      matchedResults: [{ relevanceGrade: 3 }],
      latencyMs: 10
    }]);
    const json = formatJsonReport(report);

    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.aggregate).toBeDefined();
    expect(parsed.queryCount).toBe(1);
  });

  it('preserves all report properties', () => {
    const report = generateReport([{
      matchedResults: [{ relevanceGrade: 3 }],
      category: 'lexical',
      latencyMs: 10,
      actualRoute: 'lexical',
      expectedRoute: 'lexical'
    }]);
    const json = formatJsonReport(report);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty('timestamp');
    expect(parsed).toHaveProperty('aggregate');
    expect(parsed).toHaveProperty('routeAccuracy');
    expect(parsed).toHaveProperty('cacheHitRate');
    expect(parsed).toHaveProperty('latency');
    expect(parsed).toHaveProperty('byCategory');
    expect(parsed).toHaveProperty('failedQueries');
  });
});


// =============================================================================
// compareToBaseline Tests
// =============================================================================

describe('compareToBaseline', () => {
  it('detects MRR regressions', () => {
    const current = { aggregate: { mrr: 0.5, ndcg: 0.5, successRate: 0.9 }, latency: {} };
    const baseline = { aggregate: { mrr: 0.8, ndcg: 0.5, successRate: 0.9 }, latency: {} };
    const comparison = compareToBaseline(current, baseline);

    expect(comparison.hasRegressions).toBe(true);
    expect(comparison.regressions).toHaveLength(1);
    expect(comparison.regressions[0].metric).toBe('MRR@10');
    expect(comparison.regressions[0].delta).toBeLessThan(0);
  });

  it('detects MRR improvements', () => {
    const current = { aggregate: { mrr: 0.9, ndcg: 0.5, successRate: 0.9 }, latency: {} };
    const baseline = { aggregate: { mrr: 0.7, ndcg: 0.5, successRate: 0.9 }, latency: {} };
    const comparison = compareToBaseline(current, baseline);

    expect(comparison.hasRegressions).toBe(false);
    expect(comparison.improvements).toHaveLength(1);
    expect(comparison.improvements[0].metric).toBe('MRR@10');
  });

  it('detects NDCG regressions', () => {
    const current = { aggregate: { mrr: 0.7, ndcg: 0.3, successRate: 0.9 }, latency: {} };
    const baseline = { aggregate: { mrr: 0.7, ndcg: 0.6, successRate: 0.9 }, latency: {} };
    const comparison = compareToBaseline(current, baseline);

    expect(comparison.hasRegressions).toBe(true);
    expect(comparison.regressions.some(r => r.metric === 'NDCG@10')).toBe(true);
  });

  it('detects success rate regressions', () => {
    const current = { aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.5 }, latency: {} };
    const baseline = { aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 }, latency: {} };
    const comparison = compareToBaseline(current, baseline);

    expect(comparison.hasRegressions).toBe(true);
    expect(comparison.regressions.some(r => r.metric === 'Success@10')).toBe(true);
  });

  it('detects latency regressions', () => {
    const current = {
      aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 },
      latency: { warmUncached: { p50: 500 } }
    };
    const baseline = {
      aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 },
      latency: { warmUncached: { p50: 100 } }
    };
    const comparison = compareToBaseline(current, baseline);

    expect(comparison.hasRegressions).toBe(true);
    expect(comparison.regressions.some(r => r.metric === 'Latency (warm p50)')).toBe(true);
  });

  it('handles zero baseline latency without error', () => {
    const current = {
      aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 },
      latency: { warmUncached: { p50: 100 } }
    };
    const baseline = {
      aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 },
      latency: { warmUncached: { p50: 0 } }
    };
    // Should not throw or return Infinity
    expect(() => compareToBaseline(current, baseline)).not.toThrow();
    const comparison = compareToBaseline(current, baseline);
    expect(comparison).toBeDefined();
    // Zero baseline should cause division issues - check it handles gracefully
    expect(comparison.regressions.every(r => isFinite(r.ratio || r.delta))).toBe(true);
  });

  it('handles missing latency data', () => {
    const current = { aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 }, latency: {} };
    const baseline = { aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 }, latency: {} };
    const comparison = compareToBaseline(current, baseline);

    // Should not throw
    expect(comparison).toBeDefined();
    expect(comparison.hasRegressions).toBe(false);
  });

  it('respects custom thresholds', () => {
    const current = { aggregate: { mrr: 0.68, ndcg: 0.7, successRate: 0.9 }, latency: {} };
    const baseline = { aggregate: { mrr: 0.70, ndcg: 0.7, successRate: 0.9 }, latency: {} };

    // Default threshold (0.02) - 0.02 drop is exactly at threshold, should not trigger
    const comparisonDefault = compareToBaseline(current, baseline);
    expect(comparisonDefault.regressions.some(r => r.metric === 'MRR@10')).toBe(false);

    // Stricter threshold (0.01) - should trigger
    const comparisonStrict = compareToBaseline(current, baseline, { mrrDelta: 0.01 });
    expect(comparisonStrict.regressions.some(r => r.metric === 'MRR@10')).toBe(true);
  });

  it('reports summary statistics', () => {
    const current = { aggregate: { mrr: 0.5, ndcg: 0.5, successRate: 0.5 }, latency: {} };
    const baseline = { aggregate: { mrr: 0.8, ndcg: 0.8, successRate: 0.9 }, latency: {} };
    const comparison = compareToBaseline(current, baseline);

    expect(comparison.summary).toBeDefined();
    expect(comparison.summary.totalRegressions).toBeGreaterThan(0);
    expect(typeof comparison.summary.totalImprovements).toBe('number');
  });

  // Edge case tests
  it('handles baseline with null latency', () => {
    const current = { aggregate: { mrr: 0.7, ndcg: 0.65, successRate: 0.9 }, latency: {} };
    const baseline = { aggregate: { mrr: 0.7, ndcg: 0.65, successRate: 0.9 }, latency: null };
    const comparison = compareToBaseline(current, baseline);
    expect(comparison).toBeDefined();
    expect(comparison.regressions).toEqual([]);
  });

  it('handles current with zero p50 latency', () => {
    const current = {
      aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 },
      latency: { warmUncached: { p50: 0 } }
    };
    const baseline = {
      aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 },
      latency: { warmUncached: { p50: 100 } }
    };
    const comparison = compareToBaseline(current, baseline);
    expect(comparison).toBeDefined();
    // Zero current latency is an improvement (0 < 100), not an error
    expect(comparison.hasRegressions).toBe(false);
    // Should detect as improvement since latency went down
    expect(comparison.improvements.some(i => i.metric === 'Latency (warm p50)')).toBe(true);
  });

  it('handles both baseline and current with null latency', () => {
    const current = { aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 }, latency: null };
    const baseline = { aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 }, latency: null };
    expect(() => compareToBaseline(current, baseline)).not.toThrow();
    const comparison = compareToBaseline(current, baseline);
    expect(comparison.hasRegressions).toBe(false);
  });

  it('handles undefined warmUncached in baseline', () => {
    const current = {
      aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 },
      latency: { warmUncached: { p50: 50 } }
    };
    const baseline = {
      aggregate: { mrr: 0.7, ndcg: 0.7, successRate: 0.9 },
      latency: { warmCached: { p50: 10 } }  // warmUncached is undefined
    };
    expect(() => compareToBaseline(current, baseline)).not.toThrow();
    const comparison = compareToBaseline(current, baseline);
    expect(comparison).toBeDefined();
  });
});


// =============================================================================
// Cost Tracker Edge Case Tests
// =============================================================================

describe('cost tracker edge cases', () => {
  it('handles missing provider gracefully', async () => {
    // This tests the cost tracker's unknown provider handling
    const { CostTracker } = await import('../lib/cost-tracker.js');
    const tracker = new CostTracker();

    // Track with unknown provider - should not throw
    tracker.trackEmbedding(100, 'unknown-provider', false);
    const stats = tracker.getStats();
    expect(stats.costs.embed).toBeGreaterThan(0); // Uses fallback pricing
    expect(stats.calls.embed).toBe(1);
  });

  it('tracks cached embeddings without cost', async () => {
    const { CostTracker } = await import('../lib/cost-tracker.js');
    const tracker = new CostTracker();

    // Track cached embedding - should not add cost
    tracker.trackEmbedding(100, 'voyage', true);
    const stats = tracker.getStats();
    expect(stats.costs.embed).toBe(0);
    expect(stats.calls.embedCached).toBe(1);
  });

  it('resets all counters correctly', async () => {
    const { CostTracker } = await import('../lib/cost-tracker.js');
    const tracker = new CostTracker();

    // Add some data
    tracker.trackEmbedding(100, 'voyage', false);
    tracker.trackEmbedding(50, 'voyage', true);

    // Reset
    tracker.reset();
    const stats = tracker.getStats();

    expect(stats.costs.embed).toBe(0);
    expect(stats.costs.total).toBe(0);
    expect(stats.calls.embed).toBe(0);
    expect(stats.calls.embedCached).toBe(0);
  });

  it('supports local provider with zero cost', async () => {
    const { CostTracker } = await import('../lib/cost-tracker.js');
    const tracker = new CostTracker();

    tracker.trackEmbedding(1000, 'local', false);
    const stats = tracker.getStats();
    expect(stats.costs.embed).toBe(0); // Local is free
    expect(stats.calls.embed).toBe(1);
  });

  it('supports flashrank provider with zero cost', async () => {
    const { CostTracker } = await import('../lib/cost-tracker.js');
    const tracker = new CostTracker();

    tracker.trackEmbedding(1000, 'flashrank', false);
    const stats = tracker.getStats();
    expect(stats.costs.embed).toBe(0); // FlashRank is free
  });
});
