import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSearcher } from './helpers/prototype-test-helper.js';

// ---------------------------------------------------------------------------
// Module-level mocks: expandResults + cascadedScore
// ---------------------------------------------------------------------------

const mockExpandResults = vi.fn((db, results) => [
  ...results,
  { id: 'expanded1', name: 'ExpandedEntity', score: 0.6, file: 'expanded.js', _expandedFrom: 'r1' },
]);
vi.mock('../core/graph-expansion.js', () => ({
  expandResults: (...args) => mockExpandResults(...args),
}));

const mockCascadedScore = vi.fn(async (query, results) => ({
  results: results.map(r => ({
    ...r,
    lateInteractionScore: 0.8,
    ceScore: r._expandedFrom ? 0.65 : 0.9,
  })),
  stats: {
    ceInvoked: true,
    ceProvider: 'modernbert',
    ceCandidates: results.length,
    ceTokens: results.length * 50,
  },
}));
vi.mock('../core/cascaded-scorer.js', () => ({
  cascadedScore: (...args) => mockCascadedScore(...args),
}));

// ---------------------------------------------------------------------------
// Shared mock factory
// ---------------------------------------------------------------------------

const defaultLexResults = [
  { id: 'lex1', name: 'handleAuth', score: 25, file: 'auth.js' },
  { id: 'lex2', name: 'loginUser', score: 18, file: 'login.js' },
];
const defaultSemResults = [
  { id: 'sem1', name: 'authMiddleware', score: 0.85, file: 'middleware.js' },
  { id: 'sem2', name: 'tokenVerify', score: 0.72, file: 'token.js' },
];

async function makeSearcher(overrides = {}) {
  return createMockSearcher({
    initialized: true,
    init: vi.fn(async () => {}),
    hasGraphIndex: true,
    hasBinaryHnswIndex: false,
    hasHnswIndex: false,
    hasCodebaseIndex: false,
    hasLateInteractionIndex: false,
    enableTranslationFallback: false,
    timing: false,
    qualityWeight: 0,
    cascadeEnabled: false,
    useLateInteraction: false,
    binaryHnswIndex: null,
    graphSearch: {
      init: vi.fn(async () => {}),
      db: { _stubDb: true },
      dbPath: '/tmp/test.db',
      bm25Search: vi.fn(async () => ({
        results: [...defaultLexResults],
        latency: 3,
      })),
      graphExpandedSearch: vi.fn(async () => ({
        results: [...defaultLexResults],
        stats: { confidence: 'exact', mode: 'bm25_only', bm25_ms: 2 },
      })),
    },
    semanticSearch: vi.fn(async () => ({
      results: [...defaultSemResults],
      stats: { embedding: { tokens: 10, provider: 'local' }, queryInt8: new Int8Array([1, 2, 3]) },
    })),
    robustCCFusion: vi.fn((lex, sem) => ({
      results: [...lex, ...sem].map((r, i) => ({ ...r, score: 1 - i * 0.1 })),
      method: 'cc',
      fallbackReason: null,
    })),
    applyPostFusionBoosts: vi.fn((r) => r),
    loadDocumentContent: vi.fn(async (candidates) => candidates.map(() => 'content')),
    reranker: {},
    cascadeCeTopK: 8,
    cascadeGateThreshold: 0.12,
    cascadeForceFullCE: false,
    ...overrides,
  });
}

beforeEach(() => {
  mockExpandResults.mockClear();
  mockCascadedScore.mockClear();
});

// =============================================================================
// hybridSearchV2 uses raw bm25Search (not graphExpandedSearch)
// =============================================================================

describe('hybridSearchV2 uses raw bm25Search', () => {
  it('calls bm25Search with limit:50 and skipBoosts:true', async () => {
    const searcher = await makeSearcher();
    await searcher.hybridSearchV2('auth middleware');

    expect(searcher.graphSearch.bm25Search).toHaveBeenCalledOnce();
    expect(searcher.graphSearch.bm25Search).toHaveBeenCalledWith(
      'auth middleware',
      { limit: 50, skipBoosts: true }
    );
  });

  it('does NOT call graphExpandedSearch', async () => {
    const searcher = await makeSearcher({
      graphSearch: {
        init: vi.fn(async () => {}),
        db: { _stubDb: true },
        bm25Search: vi.fn(async () => ({ results: [...defaultLexResults], latency: 2 })),
        graphExpandedSearch: vi.fn(async () => {
          throw new Error('graphExpandedSearch should NOT be called');
        }),
      },
    });
    await searcher.hybridSearchV2('auth middleware');
    expect(searcher.graphSearch.graphExpandedSearch).not.toHaveBeenCalled();
  });

  it('no expanded entities in pre-fusion lexical results', async () => {
    const searcher = await makeSearcher();
    await searcher.hybridSearchV2('auth middleware');

    const lexicalArg = searcher.robustCCFusion.mock.calls[0][0];
    for (const r of lexicalArg) {
      expect(r.searchPath).toBe('lexical');
      expect(r._expandedFrom).toBeUndefined();
      expect(r.graphExpanded).toBeUndefined();
    }
  });

  it('captures latency from bm25Search.latency (not stats.bm25_ms)', async () => {
    const searcher = await makeSearcher();
    const result = await searcher.hybridSearchV2('auth middleware');
    expect(result.fusionStats.lexicalLatencyMs).toBe(3);
  });

  it('propagates semanticStats (including queryInt8) from semantic path', async () => {
    const searcher = await makeSearcher();
    const result = await searcher.hybridSearchV2('auth middleware');
    expect(result.semanticStats).toBeDefined();
    expect(result.semanticStats.queryInt8).toBeInstanceOf(Int8Array);
  });

  it('fusion receives only raw BM25 scores (no synthetic expansion scores)', async () => {
    const rawScores = [30, 20, 15];
    const searcher = await makeSearcher({
      graphSearch: {
        init: vi.fn(async () => {}),
        db: { _stubDb: true },
        bm25Search: vi.fn(async () => ({
          results: rawScores.map((s, i) => ({ id: `b${i}`, name: `func${i}`, score: s, file: `${i}.js` })),
          latency: 2,
        })),
      },
    });

    await searcher.hybridSearchV2('test');
    const lexArg = searcher.robustCCFusion.mock.calls[0][0];

    expect(lexArg).toHaveLength(3);
    expect(lexArg.map(r => r.score)).toEqual(rawScores);
    for (const r of lexArg) {
      expect(r._expandedFrom).toBeUndefined();
    }
  });
});

// =============================================================================
// Expansion policy — hybrid, semantic, ambiguous lexical get 2-hop
// =============================================================================

describe('expansion policy in search()', () => {
  it('hybrid path calls expandResults with expandMode 2hop', async () => {
    const searcher = await makeSearcher();
    await searcher.search('test query', { mode: 'hybrid' });

    expect(mockExpandResults).toHaveBeenCalledOnce();
    const opts = mockExpandResults.mock.calls[0][2];
    expect(opts.expandMode).toBe('2hop');
    expect(opts.adaptiveHop2).toBe(true);
  });

  it('hybrid path records expansion in stats (success path)', async () => {
    const searcher = await makeSearcher();
    const { stats } = await searcher.search('test query', { mode: 'hybrid' });

    expect(stats.graphExpansion).toBeDefined();
    expect(stats.graphExpansion.mode).toBe('2hop');
    expect(stats.graphExpansion.error).toBeUndefined();
    expect(stats.graphExpansion.total).toBeGreaterThan(0);
  });

  it('semantic path calls expandResults with expandMode 2hop', async () => {
    const searcher = await makeSearcher();
    await searcher.search('test query', { mode: 'semantic' });

    expect(mockExpandResults).toHaveBeenCalledOnce();
    const opts = mockExpandResults.mock.calls[0][2];
    expect(opts.expandMode).toBe('2hop');
  });

  it('semantic path records expansion in stats (success path)', async () => {
    const searcher = await makeSearcher();
    const { stats } = await searcher.search('test query', { mode: 'semantic' });

    expect(stats.graphExpansion).toBeDefined();
    expect(stats.graphExpansion.mode).toBe('2hop');
    expect(stats.graphExpansion.error).toBeUndefined();
  });

  it('ambiguous lexical gets 2hop expansion (not 1hop)', async () => {
    const searcher = await makeSearcher({
      graphSearch: {
        init: vi.fn(async () => {}),
        db: { _stubDb: true },
        graphExpandedSearch: vi.fn(async () => ({
          results: [
            { id: 'r1', name: 'conf', score: 5, file: 'a.js' },
            { id: 'r2', name: 'confLoader', score: 4.5, file: 'b.js' },
          ],
          stats: { confidence: 'ambiguous', mode: 'bm25_ambiguous', bm25_ms: 2 },
        })),
      },
    });

    const { stats } = await searcher.search('conf', { mode: 'lexical' });

    expect(stats.confidence).toBe('ambiguous');
    expect(mockExpandResults).toHaveBeenCalledOnce();
    expect(mockExpandResults.mock.calls[0][2].expandMode).toBe('2hop');
  });

  it('confident lexical (exact) skips expansion entirely', async () => {
    const searcher = await makeSearcher({
      graphSearch: {
        init: vi.fn(async () => {}),
        db: { _stubDb: true },
        graphExpandedSearch: vi.fn(async () => ({
          results: [{ id: 'r1', name: 'AuthService', score: 40, file: 'auth.js' }],
          stats: { confidence: 'exact', mode: 'bm25_exact_match', bm25_ms: 1 },
        })),
      },
    });

    const { stats } = await searcher.search('AuthService', { mode: 'lexical' });

    expect(stats.confidence).toBe('exact');
    expect(mockExpandResults).not.toHaveBeenCalled();
    expect(stats.graphExpansion).toBeUndefined();
  });

  it('expand:false disables postprocess expansion for hybrid', async () => {
    const searcher = await makeSearcher();
    const { stats } = await searcher.search('test query', { mode: 'hybrid', expand: false });

    expect(mockExpandResults).not.toHaveBeenCalled();
    expect(stats.graphExpansion).toBeUndefined();
  });

  it('expand:false disables postprocess expansion for semantic', async () => {
    const searcher = await makeSearcher();
    const { stats } = await searcher.search('test query', { mode: 'semantic', expand: false });

    expect(mockExpandResults).not.toHaveBeenCalled();
    expect(stats.graphExpansion).toBeUndefined();
  });

  it('passes queryInt8 to expandResults for query-dependent scoring', async () => {
    const searcher = await makeSearcher();
    await searcher.search('test query', { mode: 'hybrid' });

    const opts = mockExpandResults.mock.calls[0][2];
    expect(opts.queryInt8).toBeInstanceOf(Int8Array);
    expect(opts.queryInt8).toEqual(new Int8Array([1, 2, 3]));
  });
});

// =============================================================================
// Cascade scores expanded entities (the whole point of the refactor)
// =============================================================================

describe('cascade scores expanded entities', () => {
  it('cascade runs on results that include expanded entities (hybrid)', async () => {
    const searcher = await makeSearcher({ cascadeEnabled: true });
    const { stats, results } = await searcher.search('auth query', { mode: 'hybrid' });

    // Expansion ran first
    expect(mockExpandResults).toHaveBeenCalledOnce();
    // Cascade ran second — on the expanded set
    expect(mockCascadedScore).toHaveBeenCalledOnce();
    const cascadeCandidates = mockCascadedScore.mock.calls[0][1];
    // The expanded entity should be in the candidates passed to cascade
    expect(cascadeCandidates.some(r => r._expandedFrom === 'r1')).toBe(true);

    expect(stats.cascade).toBeDefined();
    expect(stats.cascade.ceInvoked).toBe(true);
    expect(stats.cascade.ceCandidates).toBeGreaterThan(0);
  });

  it('expanded entities have LI + CE scores after cascade (hybrid)', async () => {
    const searcher = await makeSearcher({ cascadeEnabled: true });
    const { results } = await searcher.search('auth query', { mode: 'hybrid' });

    const expanded = results.find(r => r._expandedFrom === 'r1');
    expect(expanded).toBeDefined();
    expect(expanded.lateInteractionScore).toBe(0.8);
    expect(expanded.ceScore).toBe(0.65);
  });

  it('cascade runs on results that include expanded entities (semantic)', async () => {
    const searcher = await makeSearcher({ cascadeEnabled: true });
    const { stats } = await searcher.search('auth query', { mode: 'semantic' });

    expect(mockExpandResults).toHaveBeenCalledOnce();
    expect(mockCascadedScore).toHaveBeenCalledOnce();
    expect(stats.cascade).toBeDefined();
    expect(stats.cascade.ceInvoked).toBe(true);
  });

  it('cascade skips for confident lexical (no expansion, no cascade)', async () => {
    const searcher = await makeSearcher({
      cascadeEnabled: true,
      graphSearch: {
        init: vi.fn(async () => {}),
        db: { _stubDb: true },
        graphExpandedSearch: vi.fn(async () => ({
          results: [{ id: 'r1', name: 'AuthService', score: 40, file: 'auth.js' }],
          stats: { confidence: 'exact', mode: 'bm25_exact_match', bm25_ms: 1 },
        })),
      },
    });

    const { stats } = await searcher.search('AuthService', { mode: 'lexical' });

    expect(mockExpandResults).not.toHaveBeenCalled();
    expect(mockCascadedScore).not.toHaveBeenCalled();
    expect(stats.cascade).toBeUndefined();
  });
});

// =============================================================================
// FlashRank not in cascade pipeline
// =============================================================================

describe('FlashRank not in cascade pipeline', () => {
  it('no flashRankScore on any result in hybrid cascade path', async () => {
    const searcher = await makeSearcher({ cascadeEnabled: true });
    const { results } = await searcher.search('auth query', { mode: 'hybrid' });

    for (const r of results) {
      expect(r.flashRankScore).toBeUndefined();
    }
  });
});

// =============================================================================
// queryInt8 propagation through hybrid -> postprocess
// =============================================================================

describe('queryInt8 propagation', () => {
  it('hybrid path passes queryInt8 to postprocess via semanticStats', async () => {
    const fakeQueryInt8 = new Int8Array([10, 20, 30]);
    const searcher = await makeSearcher({
      semanticSearch: vi.fn(async () => ({
        results: [...defaultSemResults],
        stats: { queryInt8: fakeQueryInt8, embedding: { tokens: 5, provider: 'local' } },
      })),
    });

    const originalPostRetrieval = searcher._applyPostRetrieval.bind(searcher);
    let capturedSemanticStats;
    searcher._applyPostRetrieval = async function (results, query, options, ctx) {
      capturedSemanticStats = ctx.semanticStats;
      return originalPostRetrieval(results, query, options, ctx);
    };

    await searcher.search('test query', { mode: 'hybrid' });

    expect(capturedSemanticStats).toBeDefined();
    expect(capturedSemanticStats.queryInt8).toBe(fakeQueryInt8);
  });
});

// =============================================================================
// Latency tracking
// =============================================================================

describe('latency tracking', () => {
  it('stats.lexicalLatencyMs comes from bm25Search latency field', async () => {
    const searcher = await makeSearcher({
      graphSearch: {
        init: vi.fn(async () => {}),
        db: { _stubDb: true },
        bm25Search: vi.fn(async () => ({
          results: [{ id: 'r1', name: 'test', score: 10, file: 'test.js' }],
          latency: 7,
        })),
      },
    });

    const { stats } = await searcher.search('test', { mode: 'hybrid' });
    expect(stats.lexicalLatencyMs).toBe(7);
  });
});
