import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSearcher, createMinimalSearchContext } from './helpers/prototype-test-helper.js';

// =============================================================================
// Integration Tests: Normalized Late Interaction Blending
// =============================================================================

// Mock late-interaction-model.js
const mockEncodeQuery = vi.fn(async () => [
  new Float32Array([0.1, 0.2, 0.3]),
  new Float32Array([0.4, 0.5, 0.6]),
]);
vi.mock('../core/late-interaction-model.js', () => ({
  encodeQuery: (...args) => mockEncodeQuery(...args),
}));

describe('Normalized late interaction blending', () => {

  /**
   * Helper: create a searcher with a custom scoreWithLateInteraction mock.
   * The liScoreMap maps candidate id → lateInteractionScore.
   */
  async function createSearcherWithLIScores(liScoreMap, overrides = {}) {
    return createMockSearcher({
      hasLateInteractionIndex: true,
      useLateInteraction: true,
      lateInteractionBlendWeight: 0.3,
      stage3Candidates: 20,
      hasGraphIndex: false,
      enableTranslationFallback: false,
      timing: false,
      qualityWeight: 0,
      lateInteractionIndex: {
        modelMismatch: false,
        scoreWithLateInteraction: vi.fn(async (_queryTokens, candidates) => {
          // Mirror real scoreWithLateInteraction: add LI scores then sort by LI desc
          const scored = candidates.map(c => ({
            ...c,
            lateInteractionScore: liScoreMap[c.id] ?? 0.5,
            originalScore: c.score,
          }));
          scored.sort((a, b) => b.lateInteractionScore - a.lateInteractionScore);
          return scored;
        }),
      },
      ...overrides,
    });
  }

  async function runPostRetrieval(s, results, options = {}) {
    const ctx = createMinimalSearchContext();
    return s._applyPostRetrieval(results, 'test query', options, ctx);
  }

  beforeEach(() => {
    mockEncodeQuery.mockClear();
  });

  // ---------------------------------------------------------------------------
  // Core normalization behavior
  // ---------------------------------------------------------------------------

  it('blend with matched ranges produces scores in [0, 1]', async () => {
    // Both base and LI in [0, 1] — normalization stretches to full [0, 1]
    const s = await createSearcherWithLIScores({ a: 0.8, b: 0.6, c: 0.4 });
    const results = [
      { id: 'a', score: 0.9, name: 'a' },
      { id: 'b', score: 0.7, name: 'b' },
      { id: 'c', score: 0.5, name: 'c' },
    ];

    const { results: output } = await runPostRetrieval(s, results);

    for (const r of output) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('pure reranker: MaxSim scores determine ranking regardless of base scale', async () => {
    // Pure reranker: score = lateInteractionScore, base scores ignored for ranking
    const s = await createSearcherWithLIScores(
      { a: 0.4, b: 0.55, c: 0.7 },
    );
    const results = [
      { id: 'a', score: 0.016, name: 'a' },
      { id: 'b', score: 0.012, name: 'b' },
      { id: 'c', score: 0.008, name: 'c' },
    ];

    const { results: output } = await runPostRetrieval(s, results);

    // LI ranking: c(0.7) > b(0.55) > a(0.4)
    expect(output[0].id).toBe('c');
    expect(output[0].score).toBeCloseTo(0.7, 5);
    expect(output[1].id).toBe('b');
    expect(output[1].score).toBeCloseTo(0.55, 5);
    expect(output[2].id).toBe('a');
    expect(output[2].score).toBeCloseTo(0.4, 5);
  });

  it('pure reranker: scores are raw MaxSim values (not normalized)', async () => {
    // Pure reranker uses raw LI scores — no normalization to [0,1]
    const s = await createSearcherWithLIScores(
      { a: 0.3, b: 0.5, c: 0.6 },
    );
    const results = [
      { id: 'a', score: 0.5, name: 'a' },
      { id: 'b', score: 1.2, name: 'b' },
      { id: 'c', score: 1.8, name: 'c' },
    ];

    const { results: output } = await runPostRetrieval(s, results);

    // Scores are raw LI values, sorted descending
    expect(output[0].id).toBe('c');
    expect(output[0].score).toBeCloseTo(0.6, 5);
    expect(output[1].id).toBe('b');
    expect(output[1].score).toBeCloseTo(0.5, 5);
    expect(output[2].id).toBe('a');
    expect(output[2].score).toBeCloseTo(0.3, 5);
  });

  // ---------------------------------------------------------------------------
  // Degenerate cases: uniform scores on one side
  // ---------------------------------------------------------------------------

  it('uniform MaxSim scores: all candidates get same score', async () => {
    // All LI scores identical → all get score 0.5
    const s = await createSearcherWithLIScores(
      { a: 0.5, b: 0.5, c: 0.5 },
    );
    const results = [
      { id: 'a', score: 0.9, name: 'a' },
      { id: 'b', score: 0.7, name: 'b' },
      { id: 'c', score: 0.5, name: 'c' },
    ];

    const { results: output } = await runPostRetrieval(s, results);

    // All scores equal (pure reranker, all LI scores = 0.5)
    for (const r of output) {
      expect(r.score).toBeCloseTo(0.5, 5);
    }
  });

  it('preserves LI ordering when base is uniform', async () => {
    // All base scores identical → normBase = [0.5, 0.5, 0.5]
    // Blend: alpha*normLI + (1-alpha)*0.5 → LI ordering determines ranking
    const s = await createSearcherWithLIScores(
      { a: 0.3, b: 0.7, c: 0.5 },
      { lateInteractionBlendWeight: 0.3 }
    );
    const results = [
      { id: 'a', score: 0.6, name: 'a' },
      { id: 'b', score: 0.6, name: 'b' },
      { id: 'c', score: 0.6, name: 'c' },
    ];

    const { results: output } = await runPostRetrieval(s, results);

    // LI ranking: b(0.7) > c(0.5) > a(0.3)
    expect(output[0].id).toBe('b');
    expect(output[1].id).toBe('c');
    expect(output[2].id).toBe('a');
  });

  // ---------------------------------------------------------------------------
  // Single candidate
  // ---------------------------------------------------------------------------

  it('single candidate gets raw MaxSim score', async () => {
    const s = await createSearcherWithLIScores({ a: 0.65 });
    const results = [{ id: 'a', score: 0.8, name: 'a' }];

    const { results: output } = await runPostRetrieval(s, results);

    // Pure reranker: score = lateInteractionScore
    expect(output[0].score).toBeCloseTo(0.65, 5);
  });

  // ---------------------------------------------------------------------------
  // preLateInteractionScore stores raw (unnormalized) base score
  // ---------------------------------------------------------------------------

  it('preLateInteractionScore stores raw unnormalized base score', async () => {
    const s = await createSearcherWithLIScores({ a: 0.8, b: 0.6 });
    const results = [
      { id: 'a', score: 0.9, name: 'a' },
      { id: 'b', score: 0.3, name: 'b' },
    ];

    const { results: output } = await runPostRetrieval(s, results);

    const resultA = output.find(r => r.id === 'a');
    const resultB = output.find(r => r.id === 'b');
    expect(resultA.preLateInteractionScore).toBe(0.9);
    expect(resultB.preLateInteractionScore).toBe(0.3);
  });

  it('preLateInteractionScore uses int8Score when score is undefined', async () => {
    const s = await createSearcherWithLIScores({ a: 0.7 });
    const results = [
      { id: 'a', score: undefined, int8Score: 0.65, name: 'a' },
    ];

    const { results: output } = await runPostRetrieval(s, results);

    expect(output[0].preLateInteractionScore).toBe(0.65);
  });

  // ---------------------------------------------------------------------------
  // Stats include normalization ranges
  // ---------------------------------------------------------------------------

  it('stats include mode pure-reranker', async () => {
    const s = await createSearcherWithLIScores(
      { a: 0.4, b: 0.7, c: 0.9 }
    );
    const results = [
      { id: 'a', score: 0.8, name: 'a' },
      { id: 'b', score: 0.5, name: 'b' },
      { id: 'c', score: 0.3, name: 'c' },
    ];

    const { stats } = await runPostRetrieval(s, results);

    expect(stats.lateInteraction.mode).toBe('pure-reranker');
    expect(stats.lateInteraction.candidates).toBe(3);
    expect(stats.lateInteraction.queryTokens).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Alpha controls actual influence after normalization
  // ---------------------------------------------------------------------------

  it('pure reranker: MaxSim always determines ranking (blend weight ignored)', async () => {
    const s = await createSearcherWithLIScores(
      { a: 0.9, b: 0.1 }, // LI strongly favors a
    );
    const results = [
      { id: 'a', score: 0.3, name: 'a' }, // low base
      { id: 'b', score: 0.8, name: 'b' }, // high base
    ];

    const { results: output } = await runPostRetrieval(s, results);

    // Pure reranker: LI determines ranking regardless of base scores
    expect(output[0].id).toBe('a');
    expect(output[0].score).toBeCloseTo(0.9, 5);
    expect(output[1].id).toBe('b');
    expect(output[1].score).toBeCloseTo(0.1, 5);
  });

  // ---------------------------------------------------------------------------
  // Ranking reversal example from the plan
  // ---------------------------------------------------------------------------

  it('pure reranker: MaxSim reverses base ordering when LI disagrees', async () => {
    // Base: A=0.75, B=0.70, C=0.65 (A is best)
    // LI:   A=0.50, B=0.70, C=0.55 (B is best)
    // Pure reranker → B, C, A (LI ordering)
    const s = await createSearcherWithLIScores(
      { A: 0.50, B: 0.70, C: 0.55 },
    );
    const results = [
      { id: 'A', score: 0.75, name: 'A' },
      { id: 'B', score: 0.70, name: 'B' },
      { id: 'C', score: 0.65, name: 'C' },
    ];

    const { results: output } = await runPostRetrieval(s, results);

    expect(output[0].id).toBe('B');
    expect(output[0].score).toBeCloseTo(0.70, 3);
    expect(output[1].id).toBe('C');
    expect(output[1].score).toBeCloseTo(0.55, 3);
    expect(output[2].id).toBe('A');
    expect(output[2].score).toBeCloseTo(0.50, 3);
  });

  // ---------------------------------------------------------------------------
  // Remainder candidates (beyond stage3Candidates) are not re-scored
  // ---------------------------------------------------------------------------

  it('does not rescore candidates beyond stage3Candidates', async () => {
    const s = await createSearcherWithLIScores(
      { a: 0.9, b: 0.8 },
      { stage3Candidates: 2 }
    );
    const results = [
      { id: 'a', score: 0.9, name: 'a' },
      { id: 'b', score: 0.8, name: 'b' },
      { id: 'c', score: 0.7, name: 'c' }, // beyond stage3Candidates
    ];

    const { results: output } = await runPostRetrieval(s, results);

    const lastResult = output.find(r => r.id === 'c');
    expect(lastResult.score).toBe(0.7); // untouched
    expect(lastResult.preLateInteractionScore).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Sorted output
  // ---------------------------------------------------------------------------

  it('results are sorted by MaxSim score descending (pure reranker)', async () => {
    // Pure reranker: score = lateInteractionScore, so LI reverses the base order
    const s = await createSearcherWithLIScores(
      { a: 0.2, b: 0.5, c: 0.9 },
    );
    const results = [
      { id: 'a', score: 0.9, name: 'a' },
      { id: 'b', score: 0.5, name: 'b' },
      { id: 'c', score: 0.1, name: 'c' },
    ];

    const { results: output } = await runPostRetrieval(s, results);

    // Verify sorted descending by MaxSim score
    for (let i = 0; i < output.length - 1; i++) {
      expect(output[i].score).toBeGreaterThanOrEqual(output[i + 1].score);
    }
    // c should be first (LI=0.9), b second (LI=0.5), a last (LI=0.2)
    expect(output[0].id).toBe('c');
    expect(output[2].id).toBe('a');
  });

  // ---------------------------------------------------------------------------
  // Numerical precision: many candidates with close scores
  // ---------------------------------------------------------------------------

  it('guards against undefined and non-finite scores (NaN isolation)', async () => {
    // Pure reranker: non-finite LI scores fall back to base score.
    // Non-finite base scores fall back to 0.
    const s = await createMockSearcher({
      hasLateInteractionIndex: true,
      useLateInteraction: true,
      stage3Candidates: 20,
      hasGraphIndex: false,
      enableTranslationFallback: false,
      timing: false,
      qualityWeight: 0,
      lateInteractionIndex: {
        modelMismatch: false,
        scoreWithLateInteraction: vi.fn(async (_qt, candidates) =>
          candidates.map((c, i) => ({
            ...c,
            lateInteractionScore: i === 0 ? Number.POSITIVE_INFINITY : (i === 1 ? undefined : 0.7),
            originalScore: c.score,
          }))
        ),
      },
    });
    const results = [
      { id: 'a', score: Number.NaN, name: 'a' }, // non-finite base + non-finite LI → 0
      { id: 'b', score: 0.6, name: 'b' }, // undefined LI → falls back to base 0.6
      { id: 'c', score: 0.4, name: 'c' }, // finite LI 0.7
    ];

    const { results: output } = await runPostRetrieval(s, results, {});

    // No NaN/Infinity in output after finite fallback guards
    for (const r of output) {
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).not.toBeNaN();
    }
  });

  it('handles 20 candidates without numerical issues', async () => {
    const liMap = {};
    const results = [];
    for (let i = 0; i < 20; i++) {
      const id = `item-${i}`;
      liMap[id] = 0.3 + (i / 19) * 0.4; // LI from 0.3 to 0.7
      results.push({ id, score: 0.9 - (i / 19) * 0.5, name: id }); // base from 0.9 to 0.4
    }

    const s = await createSearcherWithLIScores(liMap, { stage3Candidates: 20 });
    const { results: output } = await runPostRetrieval(s, results);

    // All scores should be in [0, 1]
    for (const r of output) {
      expect(r.score).toBeGreaterThanOrEqual(-1e-10);
      expect(r.score).toBeLessThanOrEqual(1 + 1e-10);
    }
    // Should still be sorted
    for (let i = 0; i < output.length - 1; i++) {
      expect(output[i].score).toBeGreaterThanOrEqual(output[i + 1].score - 1e-10);
    }
  });
});
