import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeCacheHit } from '../../core/search/index.js';
import { createMockSearcher, createMinimalSearchContext } from '../helpers/prototype-test-helper.js';

// Mock late-interaction-model.js for post-expansion tests
const mockEncodeQuery = vi.fn(async () => [
  new Float32Array([0.1, 0.2, 0.3]),
  new Float32Array([0.4, 0.5, 0.6]),
]);
vi.mock('../../core/late-interaction-model.js', () => ({
  encodeQuery: (...args) => mockEncodeQuery(...args),
}));
vi.mock('../../core/ranking/late-interaction-model.js', () => ({
  encodeQuery: (...args) => mockEncodeQuery(...args),
}));

describe('computeCacheHit', () => {
  it('uses direct lexical latency for hybrid mode when provided', () => {
    const result = computeCacheHit('hybrid', {
      latency: 40,
      embedLatencyMs: 35,
      directLexMs: 3,
      embeddingSource: 'vocabulary',
      lexicalHitThresholdMs: 5,
    });

    expect(result.lexSubLatency).toBe(3);
    expect(result.lexHit).toBe(true);
    expect(result.semHit).toBe(true);
    expect(result.cacheHit).toBe(true);
  });

  it('falls back to residual lexical latency when direct timing is absent', () => {
    const result = computeCacheHit('hybrid', {
      latency: 30,
      embedLatencyMs: 10,
      directLexMs: null,
      embeddingSource: 'semantic-cache',
      lexicalHitThresholdMs: 5,
    });

    expect(result.lexSubLatency).toBe(20);
    expect(result.lexHit).toBe(false);
    expect(result.semHit).toBe(true);
    expect(result.cacheHit).toBe(false);
  });

  it('computes lexical mode hit solely from latency threshold', () => {
    const result = computeCacheHit('lexical', {
      latency: 4,
      embeddingSource: null,
      lexicalHitThresholdMs: 5,
    });

    expect(result.lexHit).toBe(true);
    expect(result.semHit).toBe(false);
    expect(result.cacheHit).toBe(true);
  });
});

// =============================================================================
// Late Interaction Post-Expansion Reranking (Phase 6)
// =============================================================================

describe('Late interaction post-expansion reranking', () => {
  let searcher;

  beforeEach(async () => {
    mockEncodeQuery.mockClear();

    searcher = await createMockSearcher({
      hasLateInteractionIndex: true,
      useLateInteraction: true,
      lateInteractionBlendWeight: 0.3,
      stage3Candidates: 5,
      hasGraphIndex: false,
      enableTranslationFallback: false,
      timing: false,
      qualityWeight: 0,
      lateInteractionIndex: {
        modelMismatch: false,
        scoreWithLateInteraction: vi.fn(async (queryTokens, candidates) =>
          candidates.map((c, i) => ({
            ...c,
            lateInteractionScore: 0.9 - i * 0.1, // Descending late interaction scores
            originalScore: c.score,
          }))
        ),
      },
    });
  });

  async function runPostRetrieval(results, options = {}) {
    const ctx = createMinimalSearchContext();
    return searcher._applyPostRetrieval(results, 'test query', options, ctx);
  }

  it('runs late interaction after graph expansion and blends scores', async () => {
    const results = [
      { id: 'a', score: 0.8, name: 'a' },
      { id: 'b', score: 0.7, name: 'b' },
      { id: 'c', score: 0.6, name: 'c' },
    ];

    const { stats } = await runPostRetrieval(results);

    expect(stats.lateInteraction).toBeDefined();
    expect(stats.lateInteraction.position).toBe('post-expansion');
    expect(stats.lateInteraction.candidates).toBe(3);
    expect(stats.lateInteraction.queryTokens).toBe(2); // mockEncodeQuery returns 2 tokens
    expect(mockEncodeQuery).toHaveBeenCalledWith('test query');
    expect(searcher.lateInteractionIndex.scoreWithLateInteraction).toHaveBeenCalledOnce();
  });

  it('uses pure MaxSim reranking (no alpha-blend)', async () => {
    // 2 candidates: base=[0.8, 0.6], LI=[0.9, 0.8] (from mock: 0.9 - i*0.1)
    // Pure reranker: score = lateInteractionScore directly
    const results = [
      { id: 'a', score: 0.8, name: 'a' },
      { id: 'b', score: 0.6, name: 'b' },
    ];

    const { results: output } = await runPostRetrieval(results);

    expect(output[0].preLateInteractionScore).toBe(0.8);
    expect(output[0].score).toBeCloseTo(0.9, 5); // raw MaxSim score
    expect(output[1].preLateInteractionScore).toBe(0.6);
    expect(output[1].score).toBeCloseTo(0.8, 5); // raw MaxSim score
  });

  it('skips late interaction when useLateInteraction=false in options', async () => {
    const results = [{ id: 'a', score: 0.8, name: 'a' }];
    const { stats } = await runPostRetrieval(results, { useLateInteraction: false });

    expect(stats.lateInteraction).toBeUndefined();
    expect(mockEncodeQuery).not.toHaveBeenCalled();
  });

  it('skips late interaction when no late interaction index exists', async () => {
    searcher.hasLateInteractionIndex = false;
    const results = [{ id: 'a', score: 0.8, name: 'a' }];
    const { stats } = await runPostRetrieval(results);

    expect(stats.lateInteraction).toBeUndefined();
    expect(mockEncodeQuery).not.toHaveBeenCalled();
  });

  it('skips late interaction on model mismatch', async () => {
    searcher.lateInteractionIndex.modelMismatch = true;
    const results = [{ id: 'a', score: 0.8, name: 'a' }];
    const { stats } = await runPostRetrieval(results);

    expect(stats.lateInteraction).toBeUndefined();
    expect(mockEncodeQuery).not.toHaveBeenCalled();
  });

  it('skips late interaction when results are empty', async () => {
    const { stats } = await runPostRetrieval([]);

    expect(stats.lateInteraction).toBeUndefined();
    expect(mockEncodeQuery).not.toHaveBeenCalled();
  });

  it('handles late interaction encoding failure gracefully', async () => {
    mockEncodeQuery.mockRejectedValueOnce(new Error('ONNX runtime error'));

    const results = [{ id: 'a', score: 0.8, name: 'a' }];
    const { results: output, stats } = await runPostRetrieval(results);

    // Results should be unchanged (original scores preserved)
    expect(output[0].score).toBe(0.8);
    expect(stats.lateInteraction.error).toBe('ONNX runtime error');
    expect(stats.lateInteraction.position).toBe('post-expansion');
  });

  it('only scores top stage3Candidates results', async () => {
    searcher.stage3Candidates = 2;
    const results = [
      { id: 'a', score: 0.9, name: 'a' },
      { id: 'b', score: 0.8, name: 'b' },
      { id: 'c', score: 0.7, name: 'c' }, // Should not be scored
    ];

    const { results: output, stats } = await runPostRetrieval(results);

    expect(stats.lateInteraction.candidates).toBe(2);
    // Third result should still be present but not re-scored
    expect(output.length).toBe(3);
    // The last candidate (from remainder) should keep its original score
    const lastResult = output.find(r => r.id === 'c');
    expect(lastResult.score).toBe(0.7);
  });

  it('respects useLateInteraction from this.useLateInteraction when not in options', async () => {
    searcher.useLateInteraction = true;
    const results = [{ id: 'a', score: 0.8, name: 'a' }];
    // No useLateInteraction in options — should fall back to this.useLateInteraction
    const { stats } = await runPostRetrieval(results, {});

    expect(stats.lateInteraction).toBeDefined();
    expect(mockEncodeQuery).toHaveBeenCalled();
  });
});
