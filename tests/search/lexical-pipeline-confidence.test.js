import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSearcher, createMinimalSearchContext } from '../helpers/prototype-test-helper.js';

// Mock late-interaction-model.js
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

// =============================================================================
// graphExpandedSearch confidence signal
// =============================================================================

describe('graphExpandedSearch confidence signal', () => {
  let graphSearch;

  beforeEach(async () => {
    const { GraphSearch } = await import('../../core/graph/graph-search.js');
    graphSearch = new GraphSearch('/nonexistent/path.db');
    // Stub DB methods so we don't need a real database
    graphSearch.db = {};
    graphSearch.hasFts5 = true;
  });

  it('returns confidence: exact for exact definition match', async () => {
    graphSearch.isIdentifierQuery = () => true;
    graphSearch.hybridDefinitionSearch = vi.fn(async () => ({
      results: [
        { id: 1, name: 'AuthService', score: 40, file: 'AuthService.java' },
        { id: 2, name: 'AuthHelper', score: 5, file: 'AuthHelper.java' },
      ],
      stats: { fts5_latency_ms: 1, latency_ms: 2, definition_count: 1 },
    }));

    const { stats } = await graphSearch.graphExpandedSearch('AuthService', { k: 5 });

    expect(stats.confidence).toBe('exact');
    expect(stats.mode).toBe('definition_first_exact');
  });

  it('returns confidence: ambiguous for non-exact definition match with deferExpansion', async () => {
    graphSearch.isIdentifierQuery = () => true;
    // Use names that DON'T exactly match the query so isExactMatchResult returns false.
    // Scores are flat (no 2x gap, no BM25>30, no name match) → ambiguous.
    graphSearch.hybridDefinitionSearch = vi.fn(async () => ({
      results: [
        { id: 1, name: 'appConfig', score: 5, file: 'config.js' },
        { id: 2, name: 'configLoader', score: 4.5, file: 'config_loader.js' },
      ],
      stats: { fts5_latency_ms: 1, latency_ms: 2, definition_count: 2 },
    }));

    const { stats } = await graphSearch.graphExpandedSearch('conf', {
      k: 5, deferExpansion: true,
    });

    expect(stats.confidence).toBe('ambiguous');
    expect(stats.mode).toBe('definition_first_ambiguous');
    expect(stats.skipped_expansion).toBe(true);
  });

  it('returns confidence: ambiguous with internal expansion when deferExpansion: false', async () => {
    graphSearch.isIdentifierQuery = () => true;
    graphSearch.hybridDefinitionSearch = vi.fn(async () => ({
      results: [
        { id: 1, name: 'appConfig', score: 5, file: 'config.js' },
        { id: 2, name: 'configLoader', score: 4.5, file: 'config_loader.js' },
      ],
      stats: { fts5_latency_ms: 1, latency_ms: 2, definition_count: 2 },
    }));
    graphSearch.getRelated = vi.fn(async () => [
      { id: 3, name: 'ConfigParser', file_path: 'parser.js', type: 'class',
        rel_type: 'imports', rel_weight: 0.5, signature: '', doc_comment: '',
        start_line: 1, end_line: 10 },
    ]);

    const { results, stats } = await graphSearch.graphExpandedSearch('conf', {
      k: 10, deferExpansion: false,
    });

    expect(stats.confidence).toBe('ambiguous');
    expect(stats.mode).toBe('definition_first_graph');
    expect(stats.skipped_expansion).toBe(false);
    // Internal expansion should have added the related entity
    expect(results.some(r => r.name === 'ConfigParser')).toBe(true);
  });

  it('returns confidence: exact for BM25 exact match', async () => {
    graphSearch.isIdentifierQuery = () => false;
    graphSearch.bm25Search = vi.fn(async () => ({
      results: [
        { id: 1, name: 'handleError', score: 35, file: 'errors.js' },
        { id: 2, name: 'logError', score: 8, file: 'log.js' },
      ],
      latency: 2,
    }));

    const { stats } = await graphSearch.graphExpandedSearch('handleError', { k: 5 });

    expect(stats.confidence).toBe('exact');
    expect(stats.mode).toBe('bm25_exact_match');
  });

  it('returns confidence: ambiguous for flat BM25 scores with deferExpansion', async () => {
    graphSearch.isIdentifierQuery = () => false;
    graphSearch.bm25Search = vi.fn(async () => ({
      results: [
        { id: 1, name: 'error_handler', score: 8, file: 'a.js' },
        { id: 2, name: 'error_log', score: 7.5, file: 'b.js' },
      ],
      latency: 2,
    }));

    const { stats } = await graphSearch.graphExpandedSearch('error handling', {
      k: 5, deferExpansion: true,
    });

    expect(stats.confidence).toBe('ambiguous');
    expect(stats.mode).toBe('bm25_ambiguous');
    expect(stats.skipped_expansion).toBe(true);
  });

  it('returns confidence: ambiguous with internal expansion when deferExpansion: false (BM25)', async () => {
    graphSearch.isIdentifierQuery = () => false;
    graphSearch.bm25Search = vi.fn(async () => ({
      results: [
        { id: 1, name: 'error_handler', score: 8, file: 'a.js' },
        { id: 2, name: 'error_log', score: 7.5, file: 'b.js' },
      ],
      latency: 2,
    }));
    graphSearch.getRelated = vi.fn(async () => [
      { id: 3, name: 'ErrorReporter', file_path: 'reporter.js', type: 'class',
        rel_type: 'calls', rel_weight: 0.7, signature: '', doc_comment: '',
        start_line: 1, end_line: 10 },
    ]);

    const { results, stats } = await graphSearch.graphExpandedSearch('error handling', {
      k: 10, deferExpansion: false,
    });

    expect(stats.confidence).toBe('ambiguous');
    expect(stats.mode).toBe('bm25_graph');
    expect(stats.skipped_expansion).toBe(false);
    expect(results.some(r => r.name === 'ErrorReporter')).toBe(true);
  });

  it('returns confidence: exact for empty BM25 results', async () => {
    graphSearch.isIdentifierQuery = () => false;
    graphSearch.bm25Search = vi.fn(async () => ({ results: [], latency: 1 }));

    const { stats } = await graphSearch.graphExpandedSearch('xyznonexistent', { k: 5 });

    expect(stats.confidence).toBe('exact');
    expect(stats.mode).toBe('bm25_only');
  });

  it('returns confidence: exact when expand=false', async () => {
    graphSearch.isIdentifierQuery = () => false;
    graphSearch.bm25Search = vi.fn(async () => ({
      results: [{ id: 1, name: 'test', score: 5, file: 'test.js' }],
      latency: 1,
    }));

    const { stats } = await graphSearch.graphExpandedSearch('test', {
      k: 5, expand: false,
    });

    expect(stats.confidence).toBe('exact');
    expect(stats.mode).toBe('bm25_only');
  });
});

// =============================================================================
// Postprocess confidence gating
// =============================================================================

describe('postprocess confidence gating', () => {
  let searcher;

  beforeEach(async () => {
    mockEncodeQuery.mockClear();
  });

  async function makeSearcher(overrides = {}) {
    return createMockSearcher({
      hasLateInteractionIndex: true,
      useLateInteraction: true,
      lateInteractionBlendWeight: 0.3,
      stage3Candidates: 5,
      hasGraphIndex: true,
      enableTranslationFallback: false,
      timing: false,
      qualityWeight: 0,
      lateInteractionIndex: {
        modelMismatch: false,
        scoreWithLateInteraction: vi.fn(async (queryTokens, candidates) =>
          candidates.map((c, i) => ({
            ...c,
            lateInteractionScore: 0.9 - i * 0.1,
            originalScore: c.score,
          }))
        ),
      },
      graphSearch: {
        init: vi.fn(async () => {}),
        db: {},
      },
      ...overrides,
    });
  }

  const sampleResults = [
    { id: 'a', score: 0.8, name: 'a' },
    { id: 'b', score: 0.7, name: 'b' },
  ];

  it('skips MaxSim for confident lexical (exact)', async () => {
    searcher = await makeSearcher();
    const ctx = createMinimalSearchContext();
    ctx.stats.path = 'lexical';
    ctx.stats.confidence = 'exact';

    const { stats } = await searcher._applyPostRetrieval([...sampleResults], 'AuthService', {}, ctx);

    expect(stats.lateInteraction).toBeUndefined();
    expect(mockEncodeQuery).not.toHaveBeenCalled();
  });

  it('skips MaxSim for confident lexical (high)', async () => {
    searcher = await makeSearcher();
    const ctx = createMinimalSearchContext();
    ctx.stats.path = 'lexical';
    ctx.stats.confidence = 'high';

    const { stats } = await searcher._applyPostRetrieval([...sampleResults], 'getUserById', {}, ctx);

    expect(stats.lateInteraction).toBeUndefined();
    expect(mockEncodeQuery).not.toHaveBeenCalled();
  });

  it('runs MaxSim for ambiguous lexical', async () => {
    searcher = await makeSearcher();
    const ctx = createMinimalSearchContext();
    ctx.stats.path = 'lexical';
    ctx.stats.confidence = 'ambiguous';

    const { stats } = await searcher._applyPostRetrieval([...sampleResults], 'config', {}, ctx);

    expect(stats.lateInteraction).toBeDefined();
    expect(stats.lateInteraction.position).toBe('post-expansion');
    expect(mockEncodeQuery).toHaveBeenCalledWith('config');
  });

  it('runs MaxSim for non-lexical paths regardless of confidence', async () => {
    searcher = await makeSearcher();
    const ctx = createMinimalSearchContext();
    ctx.stats.path = 'hybrid';
    // hybrid path has no confidence field

    const { stats } = await searcher._applyPostRetrieval([...sampleResults], 'test query', {}, ctx);

    expect(stats.lateInteraction).toBeDefined();
    expect(mockEncodeQuery).toHaveBeenCalled();
  });

  it('skips graph expansion for confident lexical even when graphExpand enabled', async () => {
    searcher = await makeSearcher();
    const ctx = createMinimalSearchContext();
    ctx.stats.path = 'lexical';
    ctx.stats.confidence = 'exact';
    ctx.effectiveGraphExpand = '1hop';

    const { stats } = await searcher._applyPostRetrieval([...sampleResults], 'AuthService', {}, ctx);

    expect(stats.graphExpansion).toBeUndefined();
  });

  it('allows graph expansion for ambiguous lexical when graphExpand enabled', async () => {
    // expandResults is imported and called inside applyPostRetrieval,
    // so we need to verify the guard lets it through. We can check
    // the stats.graphExpansion field existence as a proxy.
    searcher = await makeSearcher();
    const ctx = createMinimalSearchContext();
    ctx.stats.path = 'lexical';
    ctx.stats.confidence = 'ambiguous';
    ctx.effectiveGraphExpand = '1hop';

    // The actual expandResults call will fail since we don't have a real DB,
    // but it should attempt it (and log the error).
    const { stats } = await searcher._applyPostRetrieval([...sampleResults], 'config', {}, ctx);

    // It tried to expand (error or success) — graphExpansion key present
    expect(stats.graphExpansion).toBeDefined();
  });

  it('does not treat undefined confidence as confident', async () => {
    // If confidence is missing (e.g. older code paths), isConfidentLexical should be false
    searcher = await makeSearcher();
    const ctx = createMinimalSearchContext();
    ctx.stats.path = 'lexical';
    // stats.confidence intentionally NOT set

    const { stats } = await searcher._applyPostRetrieval([...sampleResults], 'test', {}, ctx);

    // MaxSim should run because undefined confidence is not 'exact' or 'high'
    expect(stats.lateInteraction).toBeDefined();
  });
});
