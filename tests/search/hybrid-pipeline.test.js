import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSearcher } from '../helpers/prototype-test-helper.js';

// ---------------------------------------------------------------------------
// Module-level mocks: expandResults + cascadedScore
// ---------------------------------------------------------------------------

const mockExpandResults = vi.fn((db, results) => [
  ...results,
  { id: 'expanded1', name: 'ExpandedEntity', score: 0.6, file: 'expanded.js', _expandedFrom: 'r1' },
]);
vi.mock('../../core/graph-expansion.js', () => ({
  expandResults: (...args) => mockExpandResults(...args),
}));
vi.mock('../../core/graph/graph-expansion.js', () => ({
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
vi.mock('../../core/cascaded-scorer.js', () => ({
  cascadedScore: (...args) => mockCascadedScore(...args),
}));
vi.mock('../../core/ranking/cascaded-scorer.js', () => ({
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
      bm25SearchRaw: vi.fn(async () => ({
        results: [...defaultLexResults],
        latency: 3,
      })),
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
// hybridSearchV2 uses bm25SearchRaw (not graphExpandedSearch)
// =============================================================================

describe('hybridSearchV2 uses bm25SearchRaw', () => {
  it('calls bm25SearchRaw with limit 50', async () => {
    const searcher = await makeSearcher();
    await searcher.hybridSearchV2('auth middleware');

    expect(searcher.graphSearch.bm25SearchRaw).toHaveBeenCalledOnce();
    expect(searcher.graphSearch.bm25SearchRaw).toHaveBeenCalledWith('auth middleware', 50);
    expect(searcher.graphSearch.bm25Search).not.toHaveBeenCalled();
  });

  it('ignores lexical telemetry fields and only fuses raw results', async () => {
    const searcher = await makeSearcher({
      graphSearch: {
        init: vi.fn(async () => {}),
        db: { _stubDb: true },
        bm25SearchRaw: vi.fn(async () => ({
          results: [...defaultLexResults],
          latency: 4,
          searchQuality: 'exact',
          lexicalMeta: { lexicalPath: 'fts5', restrictedFallback: false },
        })),
        bm25Search: vi.fn(async () => ({ results: [...defaultLexResults], latency: 4 })),
      },
    });

    const result = await searcher.hybridSearchV2('auth middleware');
    const lexicalArg = searcher.robustCCFusion.mock.calls[0][0];

    expect(lexicalArg).toHaveLength(defaultLexResults.length);
    expect(result.fusionStats.lexicalLatencyMs).toBe(4);
    expect(result.fusionStats.searchQuality).toBeUndefined();
  });

  it('does NOT call graphExpandedSearch', async () => {
    const searcher = await makeSearcher({
      graphSearch: {
        init: vi.fn(async () => {}),
        db: { _stubDb: true },
        bm25SearchRaw: vi.fn(async () => ({ results: [...defaultLexResults], latency: 2 })),
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

  it('captures latency from bm25SearchRaw.latency', async () => {
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
        bm25SearchRaw: vi.fn(async () => ({
          results: rawScores.map((s, i) => ({ id: `b${i}`, name: `func${i}`, score: s, file: `${i}.js` })),
          latency: 2,
        })),
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

  it('applies file-kind ranking before top-k truncation', async () => {
    const searcher = await makeSearcher({
      robustCCFusion: vi.fn(() => ({
        results: [
          { id: 'doc', file: 'docs/Reference/Hooks.md', name: 'Hooks docs', score: 1.0 },
          { id: 'test', file: 'binding/json_test.go', name: 'TestJSONBindingBindBody', score: 0.95 },
          { id: 'yaml', file: '.github/labeler.yml', name: 'plugin', score: 0.90, startLine: 15, endLine: 15 },
          { id: 'impl', file: 'lib/server.js', name: 'getServerInstance', score: 0.40, startLine: 309, endLine: 362 },
        ],
        method: 'cc_robust',
        fallbackReason: null,
      })),
      applyPostFusionBoosts: vi.fn(r => r),
    });

    const result = await searcher.hybridSearchV2(
      'how does Fastify decide between HTTP HTTPS and HTTP/2 server creation',
      { k: 1, useMMR: false }
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].file).toBe('lib/server.js');
    expect(result.fusionStats.fileKindIntent).toBe('implementation');
    expect(result.fusionStats.fileKindRankingApplied).toBe(true);
  });

  it('retries empty implementation queries with scaffolding stripped', async () => {
    const searcher = await makeSearcher({
      robustCCFusion: vi.fn()
        .mockReturnValueOnce({ results: [], method: 'rrf', fallbackReason: 'insufficient_results' })
        .mockReturnValueOnce({
          results: [
            { id: 'impl', file: 'lib/validation.js', name: 'validate', score: 0.8, startLine: 146, endLine: 203 },
          ],
          method: 'cc_robust',
          fallbackReason: null,
        }),
      applyPostFusionBoosts: vi.fn(r => r),
    });

    const result = await searcher.hybridSearchV2(
      'where does Fastify validate request body schema',
      { k: 1, useMMR: false }
    );

    expect(searcher.graphSearch.bm25SearchRaw).toHaveBeenNthCalledWith(1, 'where does Fastify validate request body schema', 50);
    expect(searcher.graphSearch.bm25SearchRaw).toHaveBeenNthCalledWith(2, 'validate request body schema', 50);
    expect(result.results[0].file).toBe('lib/validation.js');
    expect(result.fusionStats.queryRewrite).toEqual({
      from: 'where does Fastify validate request body schema',
      to: 'validate request body schema',
      reason: 'empty_results',
    });
  });

  it('retries implementation queries whose top window has no source results', async () => {
    const searcher = await makeSearcher({
      robustCCFusion: vi.fn()
        .mockReturnValueOnce({
          results: [
            { id: 'doc', file: 'docs/Reference/Validation.md', name: 'Validation', score: 1.0 },
            { id: 'test', file: 'test/request-validate.test.js', name: null, score: 0.95 },
          ],
          method: 'cc_robust',
          fallbackReason: null,
        })
        .mockReturnValueOnce({
          results: [
            { id: 'impl', file: 'lib/validation.js', name: 'validate', score: 0.8, startLine: 146, endLine: 203 },
          ],
          method: 'cc_robust',
          fallbackReason: null,
        }),
      applyPostFusionBoosts: vi.fn(r => r),
    });

    const result = await searcher.hybridSearchV2(
      'where does Fastify validate request body schema',
      { k: 2, useMMR: false }
    );

    expect(searcher.graphSearch.bm25SearchRaw).toHaveBeenNthCalledWith(2, 'validate request body schema', 50);
    expect(result.results[0].file).toBe('lib/validation.js');
    expect(result.fusionStats.queryRewrite?.reason).toBe('no_implementation_in_top_results');
  });

  // Removed (2026-05-05): the standalone tiny-chunk-demotion rule was
  // dropped once cAST sibling-merge in tree-sitter-provider.js was
  // confirmed in production. Adjacent siblings are merged at index time
  // (recursiveChunk in tree-sitter-provider) so a 2-line module.exports
  // chunk shouldn't exist as a standalone retrieval unit. The previous
  // test fixture was artificial — in production the LI index would have
  // returned a merged sibling group, not the 2-line tail in isolation.
  // The range-preservation invariant in applyResultDemotions also stops
  // entity adoption from shrinking already-merged chunks.

  it('prefers enum declaration over impl block before top-k truncation', async () => {
    const searcher = await makeSearcher({
      robustCCFusion: vi.fn(() => ({
        results: [
          {
            id: 'impl',
            file: 'crates/core/flags/lowargs.rs',
            name: 'Mode',
            type: 'impl',
            score: 0.55,
            startLine: 172,
            endLine: 267,
          },
          {
            id: 'enum',
            file: 'crates/core/flags/lowargs.rs',
            name: 'Mode',
            type: 'enum',
            score: 0.50,
            startLine: 100,
            endLine: 170,
          },
        ],
        method: 'cc_robust',
        fallbackReason: null,
      })),
      applyPostFusionBoosts: vi.fn(r => r),
    });

    const result = await searcher.hybridSearchV2(
      'what enum represents output mode for ripgrep results',
      { k: 1, useMMR: false }
    );

    expect(result.results[0].id).toBe('enum');
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
  it('stats.lexicalLatencyMs comes from bm25SearchRaw latency field', async () => {
    const searcher = await makeSearcher({
      graphSearch: {
        init: vi.fn(async () => {}),
        db: { _stubDb: true },
        bm25SearchRaw: vi.fn(async () => ({
          results: [{ id: 'r1', name: 'test', score: 10, file: 'test.js' }],
          latency: 7,
        })),
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
