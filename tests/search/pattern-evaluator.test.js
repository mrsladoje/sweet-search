/**
 * Pattern Evaluator Unit Tests
 *
 * Tests for eval/lib/pattern-evaluator.js — evaluation logic for ColGrep
 * pattern benchmarks.
 */

import { describe, it, expect } from 'vitest';

import {
  evaluatePatternQuery,
  evaluatePatternQueryGraded,
  getRelevantChunkIds,
  computePerSliceMetrics,
  computeWinRate,
  chunksMatch,
  gradedChunkMatch,
} from '../../eval/lib/pattern-evaluator.js';

import { computeMetrics } from '../../eval/lib/metrics.js';

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

// =============================================================================
// chunksMatch
// =============================================================================

describe('chunksMatch', () => {
  it('returns true on exact ID match', () => {
    const goldId = 'core/sweet-search.js:88-116:3';
    const result = { id: 'core/sweet-search.js:88-116:3', file: 'core/sweet-search.js', startLine: 88, endLine: 116 };
    expect(chunksMatch(goldId, result)).toBe(true);
  });

  it('returns true on fuzzy match when line ranges overlap >50%', () => {
    // Gold: lines 88-116 (29 lines). Result shifted by a few lines: 90-120.
    // Overlap: 90-116 = 27 lines. 27/29 ≈ 0.93 > 0.5 → match.
    const goldId = 'core/sweet-search.js:88-116:3';
    const result = { id: 'core/sweet-search.js:90-120:3', file: 'core/sweet-search.js', startLine: 90, endLine: 120 };
    expect(chunksMatch(goldId, result)).toBe(true);
  });

  it('returns false when file paths differ', () => {
    const goldId = 'core/sweet-search.js:88-116:3';
    const result = { id: 'core/other-file.js:88-116:3', file: 'core/other-file.js', startLine: 88, endLine: 116 };
    expect(chunksMatch(goldId, result)).toBe(false);
  });

  it('returns false when line ranges overlap <=50%', () => {
    // Gold: lines 1-100. Result: lines 51-200. Overlap: 51-100 = 50 lines. 50/100 = 0.5 — not > 0.5.
    const goldId = 'core/sweet-search.js:1-100:0';
    const result = { id: 'core/sweet-search.js:51-200:1', file: 'core/sweet-search.js', startLine: 51, endLine: 200 };
    expect(chunksMatch(goldId, result)).toBe(false);
  });

  it('returns false when line ranges do not overlap at all', () => {
    const goldId = 'core/sweet-search.js:1-50:0';
    const result = { id: 'core/sweet-search.js:60-100:1', file: 'core/sweet-search.js', startLine: 60, endLine: 100 };
    expect(chunksMatch(goldId, result)).toBe(false);
  });

  it('returns false when gold ID format is unparseable and no exact match', () => {
    const goldId = 'not-a-valid-gold-id';
    const result = { id: 'core/sweet-search.js:1-10:0', file: 'core/sweet-search.js', startLine: 1, endLine: 10 };
    expect(chunksMatch(goldId, result)).toBe(false);
  });

  it('returns false when result has no line range information', () => {
    const goldId = 'core/sweet-search.js:88-116:3';
    const result = { id: 'core/sweet-search.js:88-116:3-different', file: 'core/sweet-search.js', startLine: null, endLine: null };
    // id doesn't match exactly; no line info for fuzzy check
    expect(chunksMatch(goldId, result)).toBe(false);
  });
});

// =============================================================================
// gradedChunkMatch
// =============================================================================

describe('gradedChunkMatch', () => {
  it('returns 3 on exact ID match', () => {
    const goldId = 'core/sweet-search.js:88-116:3';
    const result = { id: 'core/sweet-search.js:88-116:3', file: 'core/sweet-search.js', startLine: 88, endLine: 116 };
    expect(gradedChunkMatch(goldId, result)).toBe(3);
  });

  it('returns 3 when same file and overlap >80%', () => {
    // Gold: 1-100 (100 lines). Result: 1-90 → overlap 1-90 = 90 lines → 90% > 80%
    const goldId = 'core/foo.js:1-100:0';
    const result = { id: 'core/foo.js:1-90:0', file: 'core/foo.js', startLine: 1, endLine: 90 };
    expect(gradedChunkMatch(goldId, result)).toBe(3);
  });

  it('returns 2 when same file and overlap 50-80%', () => {
    // Gold: 1-100 (100 lines). Result: 30-100 → overlap 30-100 = 71 lines → 71% in (50%, 80%]
    const goldId = 'core/foo.js:1-100:0';
    const result = { id: 'core/foo.js:30-100:1', file: 'core/foo.js', startLine: 30, endLine: 100 };
    expect(gradedChunkMatch(goldId, result)).toBe(2);
  });

  it('returns 1 when same file and overlap >0 but <=50%', () => {
    // Gold: 1-100 (100 lines). Result: 60-100 → overlap 60-100 = 41 lines → 41% in (0%, 50%]
    const goldId = 'core/foo.js:1-100:0';
    const result = { id: 'core/foo.js:60-200:1', file: 'core/foo.js', startLine: 60, endLine: 200 };
    expect(gradedChunkMatch(goldId, result)).toBe(1);
  });

  it('returns 1 when same file, no line overlap, but non-empty symbol name', () => {
    const goldId = 'core/foo.js:1-50:0';
    const result = { id: 'core/foo.js:100-150:1', file: 'core/foo.js', name: 'fooFunction', startLine: 100, endLine: 150 };
    expect(gradedChunkMatch(goldId, result)).toBe(1);
  });

  it('returns 0 when files differ', () => {
    const goldId = 'core/foo.js:1-100:0';
    const result = { id: 'core/bar.js:1-100:0', file: 'core/bar.js', startLine: 1, endLine: 100 };
    expect(gradedChunkMatch(goldId, result)).toBe(0);
  });

  it('returns 0 when no overlap and no symbol name', () => {
    const goldId = 'core/foo.js:1-50:0';
    const result = { id: 'core/foo.js:60-100:1', file: 'core/foo.js', name: '', startLine: 60, endLine: 100 };
    expect(gradedChunkMatch(goldId, result)).toBe(0);
  });

  it('returns 0 when gold ID is unparseable and no exact match', () => {
    const goldId = 'not-a-valid-gold-id';
    const result = { id: 'core/foo.js:1-10:0', file: 'core/foo.js', startLine: 1, endLine: 10 };
    expect(gradedChunkMatch(goldId, result)).toBe(0);
  });
});

// =============================================================================
// evaluatePatternQueryGraded
// =============================================================================

describe('evaluatePatternQueryGraded', () => {
  it('sets gradedNDCG to true', () => {
    const query = {
      query_id: 'pg001',
      regex: 'class.*Search',
      semantic_query: 'search',
      relevant_chunk_ids: ['core/sweet-search.js:1-100:0'],
    };
    const evaluated = evaluatePatternQueryGraded(query, []);
    expect(evaluated.gradedNDCG).toBe(true);
  });

  it('returns grade 3 for exact match at top position', () => {
    const query = {
      query_id: 'pg002',
      regex: 'class.*Search',
      semantic_query: 'search',
      relevant_chunk_ids: ['core/sweet-search.js:88-116:3'],
    };
    const results = [
      { id: 'core/sweet-search.js:88-116:3', file: 'core/sweet-search.js', startLine: 88, endLine: 116 },
      { id: 'core/config.js:1-20:0', file: 'core/config.js', startLine: 1, endLine: 20 },
    ];
    const evaluated = evaluatePatternQueryGraded(query, results);
    expect(evaluated.rankedRelevance[0]).toBe(3);
    expect(evaluated.rankedRelevance[1]).toBe(0);
  });

  it('returns max grade across all gold IDs for each result', () => {
    const query = {
      query_id: 'pg003',
      regex: 'function.*search',
      semantic_query: 'search fn',
      relevant_chunk_ids: [
        'core/foo.js:1-100:0',  // gold A — large range
        'core/bar.js:1-10:0',   // gold B — different file
      ],
    };
    // Result is in foo.js with 90% overlap → grade 3 against gold A
    const results = [
      { id: 'core/foo.js:1-90:0', file: 'core/foo.js', startLine: 1, endLine: 90 },
    ];
    const evaluated = evaluatePatternQueryGraded(query, results);
    expect(evaluated.rankedRelevance[0]).toBe(3);
  });

  it('returns grade 2 for partial overlap result', () => {
    const query = {
      query_id: 'pg004',
      regex: 'fn.*handler',
      semantic_query: 'handler',
      relevant_chunk_ids: ['core/foo.js:1-100:0'],
    };
    // Overlap: 30-100 = 71 lines / 100 = 71% → grade 2
    const results = [
      { id: 'core/foo.js:30-100:1', file: 'core/foo.js', startLine: 30, endLine: 100 },
    ];
    const evaluated = evaluatePatternQueryGraded(query, results);
    expect(evaluated.rankedRelevance[0]).toBe(2);
  });

  it('returns totalRelevant equal to count of distinct gold chunk IDs', () => {
    const query = {
      query_id: 'pg005',
      regex: 'class',
      semantic_query: 'cls',
      relevant_chunk_ids: ['a.js:1-10:0', 'b.js:1-10:0', 'c.js:1-10:0'],
    };
    const evaluated = evaluatePatternQueryGraded(query, []);
    expect(evaluated.totalRelevant).toBe(3);
  });

  it('returns all zeros when no results match any gold ID', () => {
    const query = {
      query_id: 'pg006',
      regex: 'class.*Missing',
      semantic_query: 'missing',
      relevant_chunk_ids: ['core/missing.js:1-10:0'],
    };
    const results = [
      { id: 'core/other.js:1-10:0', file: 'core/other.js', startLine: 1, endLine: 10 },
    ];
    const evaluated = evaluatePatternQueryGraded(query, results);
    expect(evaluated.rankedRelevance).toEqual([0]);
  });

  it('preserves slice metadata', () => {
    const query = {
      query_id: 'pg007',
      regex: 'class.*',
      semantic_query: 'test',
      relevant_chunk_ids: ['test.js:1-10:0'],
      regex_family: 'class',
      difficulty: 'hard',
      naming_quality: 'mixed',
    };
    const evaluated = evaluatePatternQueryGraded(query, []);
    expect(evaluated.regexFamily).toBe('class');
    expect(evaluated.difficulty).toBe('hard');
    expect(evaluated.namingQuality).toBe('mixed');
  });
});

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
