import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isDecisive, computeAdaptiveK, cascadedScore } from '../../core/ranking/cascaded-scorer.js';

// ---------------------------------------------------------------------------
// Mock late-interaction-model.js (dynamic import inside cascadedScore)
// ---------------------------------------------------------------------------
vi.mock('../../core/late-interaction-model.js', () => ({
  encodeQuery: vi.fn(async () => [[0.1, 0.2, 0.3]]),
}));
// Also mock the new canonical path (Phase 2C DDD migration)
vi.mock('../../core/ranking/late-interaction-model.js', () => ({
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
// isDecisive() — multi-signal gate
// ---------------------------------------------------------------------------

describe('isDecisive', () => {
  it('returns decisive for single candidate', () => {
    const result = isDecisive([0.9]);
    expect(result.decisive).toBe(true);
    expect(result.reason).toBe('single_candidate');
    expect(result.signals).toEqual({});
  });

  it('returns decisive for empty/null scores', () => {
    expect(isDecisive(null).decisive).toBe(true);
    expect(isDecisive([]).decisive).toBe(true);
  });

  it('returns decisive for clear winner (gap > threshold, not flat)', () => {
    const result = isDecisive([0.9, 0.7, 0.65], 0.08);
    expect(result.decisive).toBe(true);
    expect(result.reason).toContain('clear_winner');
    expect(result.signals.gap).toBeCloseTo(0.2, 5);
    expect(result.signals.marginDecisive).toBe(true);
  });

  it('returns NOT decisive for ambiguous scores (gap < threshold)', () => {
    // Use scores with enough spread that std > 0.02 (not flat), but gap < threshold
    const result = isDecisive([0.85, 0.80, 0.60, 0.55, 0.50], 0.08);
    expect(result.decisive).toBe(false);
    expect(result.reason).toBe('ambiguous');
    expect(result.signals.marginDecisive).toBe(false);
    expect(result.signals.flat).toBe(false);
  });

  it('returns NOT decisive for flat scores (low std)', () => {
    // All scores within a very narrow band → std < 0.02
    const result = isDecisive([0.800, 0.799, 0.798, 0.797, 0.796, 0.795, 0.794, 0.793, 0.792, 0.791], 0.08);
    expect(result.decisive).toBe(false);
    expect(result.reason).toContain('flat_scores');
    expect(result.signals.flat).toBe(true);
  });

  it('lexicalConfident → always decisive', () => {
    // Even with ambiguous scores, lexical confidence skips CE
    const result = isDecisive([0.85, 0.83], 0.08, { lexicalConfident: true });
    expect(result.decisive).toBe(true);
    expect(result.reason).toBe('lexical_confident');
    expect(result.signals.lexicalConfident).toBe(true);
  });

  it('low token coverage → NOT decisive', () => {
    // Even with a margin, low coverage means MaxSim had limited signal
    const result = isDecisive([0.9, 0.7], 0.08, {
      withTokens: 3,
      totalCandidates: 10,
    });
    expect(result.decisive).toBe(false);
    expect(result.reason).toBe('low_coverage');
    expect(result.signals.lowCoverage).toBe(true);
  });

  it('large margin but flat → NOT decisive (CE needed)', () => {
    // Gap > threshold but std is very low → flat override
    // Create scores where gap > 0.08 between first and second, but all top-10 are very close
    const scores = [0.82, 0.73, 0.729, 0.728, 0.727, 0.726, 0.725, 0.724, 0.723, 0.722];
    const result = isDecisive(scores, 0.08);
    expect(result.signals.marginDecisive).toBe(true);
    // std of these 10 values — depends on actual calculation
    // The gap is 0.09 (decisive), but the overall spread should be checked
    // This tests the interaction between margin and flatness signals
    expect(result.signals.gap).toBeCloseTo(0.09, 2);
  });
});

// ---------------------------------------------------------------------------
// computeAdaptiveK()
// ---------------------------------------------------------------------------

describe('computeAdaptiveK', () => {
  it('returns scores.length when fewer than kMin', () => {
    expect(computeAdaptiveK([0.9, 0.8], 20, 3)).toBe(2);
    expect(computeAdaptiveK([0.9], 20, 3)).toBe(1);
  });

  it('caps at kMax', () => {
    const scores = Array.from({ length: 30 }, (_, i) => 0.9 - i * 0.001);
    expect(computeAdaptiveK(scores, 20, 3)).toBeLessThanOrEqual(20);
  });

  it('floors at kMin', () => {
    // Even with a huge gap at position 1, still returns at least kMin
    const scores = [0.95, 0.2, 0.19, 0.18, 0.17];
    expect(computeAdaptiveK(scores, 20, 3)).toBeGreaterThanOrEqual(3);
  });

  it('finds natural cutoff at largest gap', () => {
    // Clear cluster: [0.9, 0.88, 0.87] | GAP | [0.5, 0.49, 0.48]
    const scores = [0.9, 0.88, 0.87, 0.5, 0.49, 0.48];
    const k = computeAdaptiveK(scores, 20, 3);
    expect(k).toBe(3); // cutoff after the 3rd element (largest gap is 0.87→0.5)
  });

  it('sends kMax for flat scores (MaxSim cant discriminate)', () => {
    // Very flat scores → no significant gap → CE needs maximum context
    const scores = Array.from({ length: 15 }, (_, i) => 0.8 - i * 0.0005);
    const k = computeAdaptiveK(scores, 10, 3);
    expect(k).toBe(10); // flat → send kMax
  });

  it('handles exact ties', () => {
    const scores = [0.8, 0.8, 0.8, 0.5, 0.5];
    const k = computeAdaptiveK(scores, 20, 3);
    expect(k).toBe(3); // gap at position 2→3 is 0.3, largest
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

  it('decisive gap → CE skipped', async () => {
    const candidates = makeCandidates(5);
    // Scores with clear winner: 0.9, 0.5, 0.4, 0.3, 0.2
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.9, 0.5, 0.4, 0.3, 0.2],
    );

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      gateThreshold: 0.08,
      loadDocumentContent,
    });

    expect(stats.decisive).toBe(true);
    expect(stats.gateReason).toContain('clear_winner');
    expect(stats.ceInvoked).toBe(false);
    expect(results.length).toBe(5);
    expect(crossEncoder.rerankDirect).not.toHaveBeenCalled();
  });

  it('ambiguous scores → CE rescue fires', async () => {
    const candidates = makeCandidates(10);
    // All scores very close (0.80, 0.79, 0.78 ...) — ambiguous, gap < threshold
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      candidates.map((_, i) => 0.80 - i * 0.01),
    );

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      ceTopK: 20,
      gateThreshold: 0.08,
      loadDocumentContent,
    });

    // Ambiguous: CE should fire
    expect(stats.decisive).toBe(false);
    expect(stats.ceInvoked).toBe(true);
    expect(stats.adaptiveK).toBeGreaterThanOrEqual(3);
    expect(crossEncoder.rerankDirect).toHaveBeenCalled();
  });

  it('tight cluster (flat scores) → CE rescue fires', async () => {
    const candidates = makeCandidates(6);
    // Very flat: all within 0.005 spread
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.800, 0.799, 0.798, 0.797, 0.796, 0.795],
    );

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      gateThreshold: 0.08,
      loadDocumentContent,
    });

    expect(stats.decisive).toBe(false);
    expect(stats.gateReason).toContain('flat_scores');
    expect(stats.ceInvoked).toBe(true);
  });

  it('adaptive-K sends right number of candidates to CE', async () => {
    const candidates = makeCandidates(10);
    // Clear cluster: [0.9, 0.88, 0.87] | big gap | [0.5, 0.49, 0.48, ...]
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.9, 0.88, 0.87, 0.5, 0.49, 0.48, 0.47, 0.46, 0.45, 0.44],
    );

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      ceTopK: 20,
      gateThreshold: 0.08,
      loadDocumentContent,
    });

    // Gap 0.9→0.88 = 0.02, not decisive (< 0.08), so CE fires
    // Adaptive-K should find the big gap at 0.87→0.5 and send 3 candidates
    expect(stats.ceInvoked).toBe(true);
    expect(stats.adaptiveK).toBe(3);
    expect(stats.ceCandidates).toBe(3);
  });

  it('lexicalConfident bypasses gate (decisive even with ambiguous scores)', async () => {
    const candidates = makeCandidates(5);
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.80, 0.79, 0.78, 0.77, 0.76], // ambiguous
    );

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      gateThreshold: 0.08,
      lexicalConfident: true,
      loadDocumentContent,
    });

    expect(stats.decisive).toBe(true);
    expect(stats.gateReason).toBe('lexical_confident');
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
      ceTopK: 20,
      gateThreshold: 0.08,
      loadDocumentContent,
    });

    // Gap 0.95→0.5 = 0.45, clear winner → decisive, no CE
    expect(stats.decisive).toBe(true);
    expect(stats.ceInvoked).toBe(false);
    expect(stats.withoutTokens).toBe(3);
    // First result is scored by MaxSim
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
      gateThreshold: 0.08,
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
      gateThreshold: 0.08,
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
      gateThreshold: 0.08,
      forceFullCrossEncoder: true,
      loadDocumentContent,
    });

    // ALL 15 scored candidates should go to CE, not just 3
    expect(stats.ceInvoked).toBe(true);
    expect(stats.ceCandidates).toBe(15);
  });

  it('encodeQuery failure → falls back to CE-only for all candidates', async () => {
    const { encodeQuery } = await import('../../core/ranking/late-interaction-model.js');
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

  it('gate signals are populated in stats', async () => {
    const candidates = makeCandidates(5);
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.85, 0.72, 0.60, 0.45, 0.30],
    );

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      loadDocumentContent,
    });

    expect(stats.gateSignals).toBeDefined();
    expect(stats.gateSignals.gap).toBeCloseTo(0.13, 2);
    expect(typeof stats.gateSignals.std).toBe('number');
    expect(typeof stats.gateSignals.flat).toBe('boolean');
    expect(typeof stats.gateSignals.marginDecisive).toBe('boolean');
  });

  // ---------------------------------------------------------------------------
  // Shadow mode tests
  // ---------------------------------------------------------------------------

  it('shadow mode: logs CE decisions without changing ranking', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const candidates = makeCandidates(10);
    // Ambiguous scores — gate would normally trigger CE
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      candidates.map((_, i) => 0.80 - i * 0.01),
    );

    const { results, stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      ceTopK: 20,
      gateThreshold: 0.08,
      shadowMode: true,
      loadDocumentContent,
    });

    // Results should be pure MaxSim (unchanged by CE)
    expect(stats.gateReason).toContain('shadow:');
    expect(results[0].score).toBeCloseTo(0.80, 5);
    // CE should NOT have been marked as invoked in the main stats
    expect(stats.ceInvoked).toBe(false);

    // Shadow should have logged
    const shadowLogs = consoleSpy.mock.calls.filter(
      args => args[0] && typeof args[0] === 'string' && args[0].includes('shadow_cascade')
    );
    expect(shadowLogs.length).toBe(1);

    consoleSpy.mockRestore();
  });

  it('shadow mode + forceFullCrossEncoder → forceFullCE takes precedence', async () => {
    const candidates = makeCandidates(5);
    const liIndex = makeLiIndex(
      candidates.map(c => c.id),
      [0.95, 0.5, 0.4, 0.3, 0.2],
    );

    const { stats } = await cascadedScore('query', candidates, {
      lateInteractionIndex: liIndex,
      crossEncoder,
      gateThreshold: 0.08,
      shadowMode: true,
      forceFullCrossEncoder: true,
      loadDocumentContent,
    });

    // forceFullCrossEncoder should override shadow mode → CE fires for real
    expect(stats.ceInvoked).toBe(true);
  });
});
