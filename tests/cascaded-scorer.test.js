import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isDecisive, cascadedScore } from '../core/cascaded-scorer.js';

// ---------------------------------------------------------------------------
// Mock late-interaction-model.js (dynamic import inside cascadedScore)
// ---------------------------------------------------------------------------
vi.mock('../core/late-interaction-model.js', () => ({
  encodeQuery: vi.fn(async () => [[0.1, 0.2, 0.3]]),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidates(count, idPrefix = 'chunk') {
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}_${i}`,
    score: 0.9 - i * 0.05,
    content: `content for ${idPrefix}_${i}`,
  }));
}

function makeLiIndex(knownIds, scores = null) {
  const idSet = new Set(knownIds);
  return {
    hasTokens(chunkIds) {
      const available = new Set();
      for (const id of chunkIds) {
        if (idSet.has(id)) available.add(id);
      }
      return available;
    },
    async scoreWithLateInteraction(queryTokens, candidates) {
      return candidates.map((c, i) => ({
        ...c,
        lateInteractionScore: scores ? scores[i] : (0.8 - i * 0.1),
        originalScore: c.score,
      })).sort((a, b) => b.lateInteractionScore - a.lateInteractionScore);
    },
  };
}

function makeCrossEncoder(reorderedIndices = null) {
  return {
    rerankDirect: vi.fn(async (query, documents, topK) => ({
      results: (reorderedIndices || documents.map((_, i) => i)).map((origIdx, rank) => ({
        originalIndex: origIdx,
        localRerankerScore: 0.95 - rank * 0.05,
      })),
      latency_ms: 42,
      model: 'test-ce',
    })),
  };
}

function makeLoadDocumentContent() {
  return vi.fn(async (candidates) =>
    candidates.map(c => `${c.id}: ${c.content || 'text'}`)
  );
}

// ---------------------------------------------------------------------------
// isDecisive()
// ---------------------------------------------------------------------------

describe('isDecisive', () => {
  it('returns decisive for single candidate', () => {
    const result = isDecisive([0.9]);
    expect(result.decisive).toBe(true);
    expect(result.reason).toBe('single_candidate');
  });

  it('returns decisive for empty/null scores', () => {
    expect(isDecisive(null).decisive).toBe(true);
    expect(isDecisive([]).decisive).toBe(true);
  });

  it('returns decisive for clear winner (gap > threshold)', () => {
    const result = isDecisive([0.9, 0.7, 0.65], 0.12);
    expect(result.decisive).toBe(true);
    expect(result.reason).toContain('clear_winner');
  });

  it('returns NOT decisive for ambiguous scores (gap < threshold)', () => {
    const result = isDecisive([0.85, 0.83, 0.81], 0.12);
    expect(result.decisive).toBe(false);
    expect(result.reason).toBe('ambiguous');
  });

  it('returns NOT decisive for tight cluster', () => {
    // Tight cluster = all scores nearly equal. This is the key design decision:
    // when the model can't discriminate, CE matters most.
    const result = isDecisive([0.80, 0.79, 0.78, 0.77], 0.12);
    expect(result.decisive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cascadedScore()
// ---------------------------------------------------------------------------

describe('cascadedScore', () => {
  let crossEncoder;
  let loadDocumentContent;

  beforeEach(() => {
    crossEncoder = makeCrossEncoder();
    loadDocumentContent = makeLoadDocumentContent();
  });

  it('handles empty candidates', async () => {
    const { results, stats } = await cascadedScore('query', [], {
      crossEncoder,
      loadDocumentContent,
    });
    expect(results).toEqual([]);
    expect(stats.totalCandidates).toBe(0);
  });

  it('single candidate is decisive, CE NOT called', async () => {
    const candidates = makeCandidates(1);
    const liIndex = makeLiIndex(['chunk_0'], [0.9]);

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      loadDocumentContent,
    });

    expect(results).toHaveLength(1);
    expect(stats.decisive).toBe(true);
    expect(stats.ceInvoked).toBe(false);
    expect(crossEncoder.rerankDirect).not.toHaveBeenCalled();
  });

  it('decisive gap → CE NOT called', async () => {
    const candidates = makeCandidates(5);
    // Scores with clear winner: 0.9, 0.5, 0.4, 0.3, 0.2
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.9, 0.5, 0.4, 0.3, 0.2],
    );

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      gateThreshold: 0.12,
      loadDocumentContent,
    });

    expect(stats.decisive).toBe(true);
    expect(stats.ceInvoked).toBe(false);
    expect(results.length).toBe(5);
    expect(crossEncoder.rerankDirect).not.toHaveBeenCalled();
  });

  it('ambiguous scores → pure reranker, CE NOT called', async () => {
    const candidates = makeCandidates(10);
    // All scores very close (0.80, 0.79, 0.78 ...) — would be ambiguous under old gate
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      candidates.map((_, i) => 0.80 - i * 0.01),
    );

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      ceTopK: 5,
      gateThreshold: 0.12,
      loadDocumentContent,
    });

    // Pure reranker: always decisive, no CE
    expect(stats.decisive).toBe(true);
    expect(stats.gateReason).toBe('pure_reranker');
    expect(stats.ceInvoked).toBe(false);
    expect(crossEncoder.rerankDirect).not.toHaveBeenCalled();
    // Results sorted by MaxSim score
    expect(results[0].score).toBeCloseTo(0.80, 5);
    expect(results[9].score).toBeCloseTo(0.71, 5);
  });

  it('tight cluster → pure reranker, CE NOT called', async () => {
    const candidates = makeCandidates(4);
    // All within 0.02 spread — tight cluster
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.80, 0.79, 0.79, 0.78],
    );

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      gateThreshold: 0.12,
      loadDocumentContent,
    });

    // Pure reranker: always decisive, no CE even for tight clusters
    expect(stats.decisive).toBe(true);
    expect(stats.gateReason).toBe('pure_reranker');
    expect(stats.ceInvoked).toBe(false);
  });

  it('mixed candidates (some with tokens, some without) → scored first, unscored at bottom', async () => {
    const candidates = makeCandidates(6);
    // Only first 3 have tokens — rest are "expanded" without LI vectors
    const liIndex = makeLiIndex(
      ['chunk_0', 'chunk_1', 'chunk_2'],
      [0.95, 0.5, 0.4],
    );

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      ceTopK: 3,
      gateThreshold: 0.12,
      loadDocumentContent,
    });

    // Pure reranker: no CE, scored candidates first, unscored at bottom
    expect(stats.ceInvoked).toBe(false);
    expect(stats.withoutTokens).toBe(3);
    expect(stats.gateReason).toBe('pure_reranker');
    // First 3 results are scored by MaxSim
    expect(results[0].score).toBeCloseTo(0.95, 5);
    // Last 3 are unscored (keep original base scores)
    expect(results.slice(3).every(r => r.preLateInteractionScore === undefined)).toBe(true);
  });

  it('no LI tokens on any candidate → all sent to CE', async () => {
    const candidates = makeCandidates(5);
    // LI index exists but has no tokens for these candidates
    const liIndex = makeLiIndex([]);

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      loadDocumentContent,
    });

    expect(stats.withTokens).toBe(0);
    expect(stats.withoutTokens).toBe(5);
    expect(stats.ceInvoked).toBe(true);
    expect(stats.gateReason).toBe('no_scored_candidates');
  });

  it('lateInteractionIndex is null (CE-only fallback)', async () => {
    const candidates = makeCandidates(5);

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: null,
      crossEncoder,
      loadDocumentContent,
    });

    expect(stats.decisive).toBe(false);
    expect(stats.ceInvoked).toBe(true);
    expect(stats.gateReason).toBe('no_li_index');
    expect(stats.ceCandidates).toBe(5);
  });

  it('cross-encoder failure with forceFullCrossEncoder → falls back to MaxSim order', async () => {
    const candidates = makeCandidates(5);
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      candidates.map((_, i) => 0.80 - i * 0.01),
    );

    const failingCE = {
      rerankDirect: vi.fn(async () => { throw new Error('CE unavailable'); }),
    };

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder: failingCE,
      gateThreshold: 0.12,
      forceFullCrossEncoder: true, // force CE to exercise the error path
      loadDocumentContent,
    });

    // Should not crash, returns MaxSim-ordered results
    expect(results.length).toBe(5);
    expect(stats.ceError).toBe('CE unavailable');
    expect(stats.ceInvoked).toBe(false); // reset to false on CE error
  });

  it('forceFullCrossEncoder bypasses gate', async () => {
    const candidates = makeCandidates(5);
    // Decisive gap (clear winner) — would normally skip CE
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.95, 0.5, 0.4, 0.3, 0.2],
    );

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      gateThreshold: 0.12,
      forceFullCrossEncoder: true,
      loadDocumentContent,
    });

    // Despite decisive gap, CE should run because forceFullCrossEncoder = true
    expect(stats.ceInvoked).toBe(true);
  });

  it('forceFullCrossEncoder sends ALL scored candidates (not just ceTopK)', async () => {
    const candidates = makeCandidates(15);
    // Decisive gap — would normally skip CE
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.95, ...Array(14).fill(0).map((_, i) => 0.4 - i * 0.01)],
    );

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      ceTopK: 3, // normally would limit to 3
      gateThreshold: 0.12,
      forceFullCrossEncoder: true,
      loadDocumentContent,
    });

    // ALL 15 scored candidates should go to CE, not just 3
    expect(stats.ceInvoked).toBe(true);
    expect(stats.ceCandidates).toBe(15);
  });

  it('encodeQuery failure → falls back to CE-only for all candidates', async () => {
    const { encodeQuery } = await import('../core/late-interaction-model.js');
    encodeQuery.mockRejectedValueOnce(new Error('ONNX runtime error'));

    const candidates = makeCandidates(5);
    const liIndex = makeLiIndex(candidates.map(c => c.id));

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      loadDocumentContent,
    });

    expect(results.length).toBe(5);
    expect(stats.gateReason).toContain('maxsim_error');
    expect(stats.ceInvoked).toBe(true);
  });

  it('CE results are properly merged when forceFullCrossEncoder is set', async () => {
    const candidates = makeCandidates(10);
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      candidates.map((_, i) => 0.80 - i * 0.01),
    );

    // CE reorders: reverse all
    const reverseCE = {
      rerankDirect: vi.fn(async (query, documents, topK) => ({
        results: documents.map((_, i) => ({
          originalIndex: documents.length - 1 - i,
          localRerankerScore: 0.99 - i * 0.01,
        })),
        latency_ms: 50,
        model: 'test-reverse-ce',
      })),
    };

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder: reverseCE,
      ceTopK: 5,
      forceFullCrossEncoder: true,
      loadDocumentContent,
    });

    expect(stats.ceInvoked).toBe(true);
    expect(stats.ceProvider).toBe('test-reverse-ce');
    // CE-scored candidates should come first
    const ceScored = results.filter(r => r.ceScore !== undefined);
    expect(ceScored.length).toBeGreaterThan(0);
  });

  it('pure reranker: scores are raw MaxSim values', async () => {
    const candidates = makeCandidates(5);
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.85, 0.72, 0.60, 0.45, 0.30],
    );

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      loadDocumentContent,
    });

    expect(stats.gateReason).toBe('pure_reranker');
    expect(stats.ceInvoked).toBe(false);
    // Scores are raw MaxSim values, sorted descending
    expect(results[0].score).toBeCloseTo(0.85, 5);
    expect(results[1].score).toBeCloseTo(0.72, 5);
    expect(results[4].score).toBeCloseTo(0.30, 5);
    // preLateInteractionScore stores original base score
    expect(results[0].preLateInteractionScore).toBeDefined();
  });
});
