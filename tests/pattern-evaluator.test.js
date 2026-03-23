/**
 * Pattern Evaluator Unit Tests
 *
 * Tests for eval/lib/pattern-evaluator.js — evaluation logic for ColGrep
 * pattern benchmarks.
 */

import { describe, it, expect } from 'vitest';

import {
  evaluatePatternQuery,
  getRelevantChunkIds,
  computePerSliceMetrics,
  computeWinRate,
} from '../eval/lib/pattern-evaluator.js';

import { computeMetrics } from '../eval/lib/metrics.js';

// =============================================================================
// evaluatePatternQuery
// =============================================================================

describe('evaluatePatternQuery', () => {
  it('marks top result as relevant when chunk ID matches', () => {
    const query = {
      query_id: 'p001',
      regex: 'class.*Search',
      semantic_query: 'main search',
      relevant_chunk_ids: ['core/sweet-search.js:253-360:10'],
      language: 'javascript',
    };

    const results = [
      { id: 'core/sweet-search.js:253-360:10', file: 'core/sweet-search.js', name: 'SweetSearch', score: 0.9 },
      { id: 'core/config.js:1-20:0', file: 'core/config.js', name: 'Config', score: 0.5 },
    ];

    const evaluated = evaluatePatternQuery(query, results);

    expect(evaluated.rankedRelevance[0]).toBe(1);
    expect(evaluated.rankedRelevance[1]).toBe(0);
    expect(evaluated.totalRelevant).toBe(1);
  });

  it('handles multiple relevant chunk IDs', () => {
    const query = {
      query_id: 'p002',
      regex: 'class.*Reranker',
      semantic_query: 'reranking',
      relevant_chunk_ids: ['core/flashrank.js:10-40:0', 'core/local-reranker.js:20-60:1'],
      language: 'javascript',
    };

    const results = [
      { id: 'core/config.js:1-20:0', file: 'core/config.js', score: 0.9 },
      { id: 'core/local-reranker.js:20-60:1', file: 'core/local-reranker.js', score: 0.8 },
      { id: 'core/flashrank.js:10-40:0', file: 'core/flashrank.js', score: 0.7 },
    ];

    const evaluated = evaluatePatternQuery(query, results);
    expect(evaluated.rankedRelevance).toEqual([0, 1, 1]);
    expect(evaluated.totalRelevant).toBe(2);
  });

  it('reports miss when no chunk ID matches', () => {
    const query = {
      query_id: 'p003',
      regex: 'class.*Foo',
      semantic_query: 'foo',
      relevant_chunk_ids: ['core/foo.js:1-10:0'],
      language: 'javascript',
    };

    const results = [
      { id: 'core/bar.js:1-10:0', file: 'core/bar.js', score: 0.5 },
      { id: 'core/baz.js:1-10:0', file: 'core/baz.js', score: 0.3 },
    ];

    const evaluated = evaluatePatternQuery(query, results);
    expect(evaluated.rankedRelevance).toEqual([0, 0]);
  });

  it('deduplicates duplicate returned chunk IDs', () => {
    const query = {
      query_id: 'p004',
      regex: 'class.*Search',
      semantic_query: 'search',
      relevant_chunk_ids: ['core/sweet-search.js:253-360:10'],
      language: 'javascript',
    };

    const results = [
      { id: 'core/sweet-search.js:253-360:10', file: 'core/sweet-search.js', score: 0.9 },
      { id: 'core/sweet-search.js:253-360:10', file: 'core/sweet-search.js', score: 0.5 },
    ];

    const evaluated = evaluatePatternQuery(query, results);
    expect(evaluated.rankedRelevance).toEqual([1, 0]);
  });

  it('handles empty results', () => {
    const query = {
      query_id: 'p005',
      regex: 'class.*Missing',
      semantic_query: 'missing',
      relevant_chunk_ids: ['core/missing.js:1-10:0'],
      language: 'javascript',
    };

    const evaluated = evaluatePatternQuery(query, []);
    expect(evaluated.rankedRelevance).toEqual([]);
    expect(evaluated.totalRelevant).toBe(1);
  });

  it('preserves slice metadata', () => {
    const query = {
      query_id: 'p006',
      regex: 'class.*',
      semantic_query: 'test',
      relevant_chunk_ids: ['test.js:1-10:0'],
      language: 'javascript',
      regex_family: 'class',
      difficulty: 'easy',
      naming_quality: 'descriptive',
    };

    const evaluated = evaluatePatternQuery(query, []);
    expect(evaluated.regexFamily).toBe('class');
    expect(evaluated.difficulty).toBe('easy');
    expect(evaluated.namingQuality).toBe('descriptive');
  });

  it('throws when relevant_chunk_ids are missing', () => {
    expect(() => evaluatePatternQuery({
      query_id: 'p007',
      regex: 'class.*',
      semantic_query: 'test',
    }, [])).toThrow('missing relevant_chunk_ids');
  });
});

describe('getRelevantChunkIds', () => {
  it('deduplicates relevant chunk IDs', () => {
    const ids = getRelevantChunkIds({
      query_id: 'p008',
      relevant_chunk_ids: ['a:1-2:0', 'a:1-2:0', 'b:3-4:0'],
    });
    expect(ids).toEqual(['a:1-2:0', 'b:3-4:0']);
  });
});

// =============================================================================
// computePerSliceMetrics
// =============================================================================

describe('computePerSliceMetrics', () => {
  it('groups queries by regex family', () => {
    const queries = [
      { regexFamily: 'class', difficulty: 'easy', namingQuality: 'descriptive', rankedRelevance: [1], totalRelevant: 1, latencyMs: 10 },
      { regexFamily: 'class', difficulty: 'easy', namingQuality: 'descriptive', rankedRelevance: [1], totalRelevant: 1, latencyMs: 20 },
      { regexFamily: 'function', difficulty: 'medium', namingQuality: 'mixed', rankedRelevance: [0, 1], totalRelevant: 1, latencyMs: 30 },
    ];

    const slices = computePerSliceMetrics(queries, computeMetrics);

    expect(slices.regexFamily.class.count).toBe(2);
    expect(slices.regexFamily.function.count).toBe(1);
    expect(slices.difficulty.easy.count).toBe(2);
    expect(slices.difficulty.medium.count).toBe(1);
    expect(slices.namingQuality.descriptive.count).toBe(2);
  });

  it('computes metrics per slice', () => {
    const queries = [
      { regexFamily: 'class', difficulty: 'easy', namingQuality: 'descriptive', rankedRelevance: [1, 0], totalRelevant: 1, latencyMs: 10 },
      { regexFamily: 'class', difficulty: 'easy', namingQuality: 'descriptive', rankedRelevance: [0, 1], totalRelevant: 1, latencyMs: 20 },
    ];

    const slices = computePerSliceMetrics(queries, computeMetrics);

    // MRR should be average of 1.0 and 0.5 = 0.75
    expect(slices.regexFamily.class.mrr_at_10).toBe(0.75);
  });
});

// =============================================================================
// computeWinRate
// =============================================================================

describe('computeWinRate', () => {
  it('counts wins, losses, and ties', () => {
    const treatment = [
      { queryId: 'p1', rankedRelevance: [1, 0] },     // RR = 1.0
      { queryId: 'p2', rankedRelevance: [0, 1] },     // RR = 0.5
      { queryId: 'p3', rankedRelevance: [0, 0, 1] },  // RR = 0.33
    ];

    const baseline = [
      { queryId: 'p1', rankedRelevance: [0, 1] },     // RR = 0.5 → treatment wins
      { queryId: 'p2', rankedRelevance: [0, 1] },     // RR = 0.5 → tie
      { queryId: 'p3', rankedRelevance: [1, 0] },     // RR = 1.0 → baseline wins
    ];

    const result = computeWinRate(treatment, baseline);

    expect(result.wins).toBe(1);
    expect(result.losses).toBe(1);
    expect(result.ties).toBe(1);
    expect(result.total).toBe(3);
    expect(result.winRate).toBeCloseTo(1 / 3);
  });

  it('handles missing baseline queries', () => {
    const treatment = [
      { queryId: 'p1', rankedRelevance: [1] },
      { queryId: 'p2', rankedRelevance: [1] },
    ];

    const baseline = [
      { queryId: 'p1', rankedRelevance: [0] },
      // p2 missing from baseline
    ];

    const result = computeWinRate(treatment, baseline);
    expect(result.total).toBe(1);
    expect(result.wins).toBe(1);
  });

  it('returns zero win rate for empty inputs', () => {
    const result = computeWinRate([], []);
    expect(result.winRate).toBe(0);
    expect(result.total).toBe(0);
  });

  it('provides per-query details', () => {
    const treatment = [{ queryId: 'p1', rankedRelevance: [1] }];
    const baseline = [{ queryId: 'p1', rankedRelevance: [0, 1] }];

    const result = computeWinRate(treatment, baseline);
    expect(result.details).toHaveLength(1);
    expect(result.details[0].outcome).toBe('win');
    expect(result.details[0].treatmentRR).toBe(1);
    expect(result.details[0].baselineRR).toBe(0.5);
  });
});
