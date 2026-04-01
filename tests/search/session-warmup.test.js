import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';

process.env.SWEET_SEARCH_USE_UNDICI_POOL = '0';

// ---------------------------------------------------------------------------
// Mock setup (before imports)
// ---------------------------------------------------------------------------

// Mock config — use vi.hoisted() so both mock paths share the same objects
const { sharedConfig } = vi.hoisted(() => {
  const DB_PATHS = {
    codeGraph: '/tmp/test-code-graph.db',
    hnswIndex: '/tmp/test-hnsw.idx',
    binaryHnswIndex: '/tmp/test-binary-hnsw.idx',
    codebase: '/tmp/test-codebase.db',
    vocabulary: '/tmp/test-vocab.json',
  };
  const EMBEDDING_CONFIG = {
    provider: 'local',
    isRemote: false,
    providerConfig: { model: 'test', enabled: true },
  };
  const EMBEDDING_PROVIDERS = {
    voyage: { enabled: false, apiKey: '', model: 'voyage-code-3', endpoint: 'https://api.voyageai.com/v1/embeddings' },
    mistral: { enabled: false, apiKey: '', model: 'codestral-embed', endpoint: 'https://api.mistral.ai/v1/embeddings' },
    jina: { enabled: false, apiKey: '', model: 'jina-embeddings-v3', endpoint: 'https://api.jina.ai/v1/embeddings' },
    local: { enabled: true, model: 'CodeRankEmbed-onnx' },
  };
  const RERANK_CONFIG = {
    voyage: { enabled: false, apiKey: '', model: 'rerank-2.5', endpoint: 'https://api.voyageai.com/v1/rerank' },
    jina: { enabled: false, apiKey: '', model: 'jina-reranker-v3', endpoint: 'https://api.jina.ai/v1/rerank' },
  };
  const LOCAL_RERANKER_CONFIG = { useLocalReranker: true };
  const LATE_INTERACTION_CONFIG = { enabled: true };
  const shouldUseLocalReranker = () => LOCAL_RERANKER_CONFIG.useLocalReranker;
  return {
    sharedConfig: {
      DB_PATHS,
      EMBEDDING_CONFIG,
      EMBEDDING_PROVIDERS,
      RERANK_CONFIG,
      LOCAL_RERANKER_CONFIG,
      LATE_INTERACTION_CONFIG,
      shouldUseLocalReranker,
    },
  };
});
vi.mock('../../core/config.js', () => sharedConfig);
vi.mock('../../core/infrastructure/config/index.js', () => sharedConfig);

// Mock vocab-constants (inlined to avoid hoisting issues)
vi.mock('../../core/vocab-constants.js', () => ({
  ARTIFACT_PATHS: {
    identifiersBin: '/tmp/test-vocab-identifiers.bin',
    identifiersMeta: '/tmp/test-vocab-identifiers.meta.json',
    semanticSeedsBin: '/tmp/test-vocab-seeds.bin',
    semanticSeedsMeta: '/tmp/test-vocab-seeds.meta.json',
    communities: '/tmp/test-communities.json',
    dynamicVocab: '/tmp/test-dynamic.json',
  },
}));
vi.mock('../../core/vocabulary/vocab-constants.js', () => ({
  ARTIFACT_PATHS: {
    identifiersBin: '/tmp/test-vocab-identifiers.bin',
    identifiersMeta: '/tmp/test-vocab-identifiers.meta.json',
    semanticSeedsBin: '/tmp/test-vocab-seeds.bin',
    semanticSeedsMeta: '/tmp/test-vocab-seeds.meta.json',
    communities: '/tmp/test-communities.json',
    dynamicVocab: '/tmp/test-dynamic.json',
  },
}));

// Mock better-sqlite3
const mockGet = vi.fn(() => ({ cnt: 42 }));
const mockPrepare = vi.fn(() => ({ get: mockGet }));
const mockClose = vi.fn();
const _mockDbInstance = vi.fn(function () {
  return { prepare: mockPrepare, close: mockClose };
});
vi.mock('better-sqlite3', () => ({ default: _mockDbInstance }));

// Mock fs for existsSync
const existingPaths = new Set();
vi.mock('fs', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    existsSync: (p) => existingPaths.has(p),
  };
});

// Mock vocab-warmer
const mockWarmFromCache = vi.fn(async () => ({
  fts5Queries: 50,
  hnswTraversals: 100,
  elapsedMs: 10,
}));
vi.mock('../../core/vocab-warmer.js', () => ({
  warmFromCache: mockWarmFromCache,
}));
vi.mock('../../core/vocabulary/vocab-warmer.js', () => ({
  warmFromCache: mockWarmFromCache,
}));

// Mock late-interaction-model (loaded dynamically by session-warmup's late-interaction-model warmup entry)
const mockGetLateInteractionPipeline = vi.fn(async () => ({ session: {}, tokenizer: {} }));
vi.mock('../../core/late-interaction-model.js', () => ({
  getLateInteractionPipeline: mockGetLateInteractionPipeline,
}));
vi.mock('../../core/ranking/late-interaction-model.js', () => ({
  getLateInteractionPipeline: mockGetLateInteractionPipeline,
}));

// Mock global fetch
const mockFetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: 'ready' }) }));

// Mock undici Pool
const mockPoolRequest = vi.fn(async () => ({
  statusCode: 200,
  body: { text: async () => '{}' },
}));
const mockPoolClose = vi.fn(async () => {});
const MockPool = vi.fn(function () {
  return { request: mockPoolRequest, close: mockPoolClose };
});
vi.mock('undici', () => ({ Pool: MockPool }));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { warmSession, readHealth, waitForReady, isHealthReady, getPoolForEndpoint, postJsonWithKeepAlive, closeConnectionPools } = await import('../../core/search/session-warmup.js');
const { EMBEDDING_CONFIG, EMBEDDING_PROVIDERS, RERANK_CONFIG, LOCAL_RERANKER_CONFIG, LATE_INTERACTION_CONFIG } = await import('../../core/config.js');

// ---------------------------------------------------------------------------
// Shared mock reset (single source of truth for both describe blocks)
// ---------------------------------------------------------------------------

function resetMockState() {
  vi.clearAllMocks();
  existingPaths.clear();
  globalThis.fetch = mockFetch;
  process.env.SWEET_SEARCH_USE_UNDICI_POOL = '0';
  EMBEDDING_CONFIG.provider = 'local';
  EMBEDDING_CONFIG.isRemote = false;
  EMBEDDING_PROVIDERS.voyage.enabled = false;
  EMBEDDING_PROVIDERS.voyage.apiKey = '';
  RERANK_CONFIG.voyage.enabled = false;
  RERANK_CONFIG.voyage.apiKey = '';
  RERANK_CONFIG.jina.enabled = false;
  RERANK_CONFIG.jina.apiKey = '';
  LOCAL_RERANKER_CONFIG.useLocalReranker = true;
  LATE_INTERACTION_CONFIG.enabled = true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session-warmup', () => {
  beforeEach(() => {
    resetMockState();
  });

  afterEach(() => {
    delete globalThis.fetch;
    void fs.unlink('/tmp/test-vocab-identifiers.bin').catch(() => {});
    void fs.unlink('/tmp/test-vocab-identifiers.meta.json').catch(() => {});
  });

  // -------------------------------------------------------------------------
  // readHealth
  // -------------------------------------------------------------------------

  describe('readHealth', () => {
    it('returns parsed JSON on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ready', warm: true }),
      });
      const result = await readHealth('http://localhost:9876', 1000);
      expect(result).toEqual({ status: 'ready', warm: true });
    });

    it('returns null on fetch error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const result = await readHealth('http://localhost:9876', 1000);
      expect(result).toBeNull();
    });

    it('returns null on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      const result = await readHealth('http://localhost:9876', 1000);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // isHealthReady
  // -------------------------------------------------------------------------

  describe('isHealthReady', () => {
    it('returns false for null/empty input', () => {
      expect(isHealthReady(null)).toBe(false);
      expect(isHealthReady(undefined)).toBe(false);
      expect(isHealthReady({})).toBe(false);
    });

    it('returns true for status=ready', () => {
      expect(isHealthReady({ status: 'ready' })).toBe(true);
    });

    it('returns true for legacy status=ok + warm=true', () => {
      expect(isHealthReady({ status: 'ok', warm: true })).toBe(true);
    });

    it('returns false for legacy status=ok without warm=true', () => {
      expect(isHealthReady({ status: 'ok' })).toBe(false);
      expect(isHealthReady({ status: 'ok', warm: false })).toBe(false);
    });

    it('returns true for explicit ready=true', () => {
      expect(isHealthReady({ ready: true })).toBe(true);
    });

    it('returns false for starting', () => {
      expect(isHealthReady({ status: 'starting', warm: true })).toBe(false);
      expect(isHealthReady({ status: 'starting' })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // warmSession - skip path
  // -------------------------------------------------------------------------

  describe('warmSession - already ready', () => {
    it('skips warmup when server reports ready', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ready', warm: true, initTimeMs: 1234 }),
      });

      const result = await warmSession({ baseUrl: 'http://localhost:9876' });
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('already-ready');
      // Should NOT have called warmFromCache or opened SQLite
      expect(mockWarmFromCache).not.toHaveBeenCalled();
      expect(_mockDbInstance).not.toHaveBeenCalled();
    });

    it('skips warmup with legacy health contract (status=ok, warm=true)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', warm: true }),
      });

      const result = await warmSession({ baseUrl: 'http://localhost:9876' });
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('already-ready');
      expect(mockWarmFromCache).not.toHaveBeenCalled();
      expect(_mockDbInstance).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // warmSession - full warmup path
  // -------------------------------------------------------------------------

  describe('warmSession - full warmup', () => {
    it('warms FTS5+HCGS when indexed', async () => {
      existingPaths.add('/tmp/test-code-graph.db');

      // First call: health check returns null (server not up)
      // Subsequent calls: return "starting" then "ready"
      let callCount = 0;
      mockFetch.mockImplementation(async (url) => {
        callCount++;
        if (url.includes('/health')) {
          if (callCount <= 2) return { ok: true, json: async () => ({ status: 'starting' }) };
          return { ok: true, json: async () => ({ status: 'ready', warm: true }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const result = await warmSession({
        baseUrl: 'http://localhost:9876',
        readyTimeoutMs: 5000,
        warmServerPath: false,
      });

      expect(result.skipped).toBe(false);
      expect(result.ready).toBe(true);
      // FTS5+HCGS should have run (via warmFromCache)
      expect(mockWarmFromCache).toHaveBeenCalledWith({ maxFts5Queries: 50, maxHnswTraversals: 100 });
      const ftsResult = result.components.find((c) => c.component === 'fts5+hcgs');
      expect(ftsResult).toBeDefined();
      expect(ftsResult.ok).toBe(true);
    });

    it('includes vocabulary in plan when binary artifact exists', async () => {
      existingPaths.add('/tmp/test-code-graph.db');
      existingPaths.add('/tmp/test-vocab-identifiers.bin');

      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { ok: false }; // initial: down
        return { ok: true, json: async () => ({ status: 'ready' }) };
      });

      const result = await warmSession({ baseUrl: 'http://localhost:9876', warmServerPath: false });

      // Vocabulary should have been attempted (may fail since file doesn't exist on disk)
      const vocabResult = result.components.find((c) => c.component === 'vocabulary');
      expect(vocabResult).toBeDefined();
      // It was attempted - the conditional logic worked
      expect(vocabResult.component).toBe('vocabulary');
    });

    it('skips vocabulary when binary artifact does not exist', async () => {
      existingPaths.add('/tmp/test-code-graph.db');
      // NOT adding vocab binary paths

      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) });

      const result = await warmSession({ baseUrl: 'http://localhost:9876', warmServerPath: false });

      const vocabResult = result.components.find((c) => c.component === 'vocabulary');
      expect(vocabResult).toBeUndefined();
    });

    it('skips FTS5+HCGS when not indexed', async () => {
      // codeGraph doesn't exist, vocab binary doesn't exist

      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { ok: true, json: async () => null };
        return { ok: true, json: async () => ({ status: 'ready' }) };
      });

      // First readHealth returns null (not up), then ready
      mockFetch
        .mockResolvedValueOnce({ ok: false }) // initial health: down
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) }); // poll: ready

      const result = await warmSession({ baseUrl: 'http://localhost:9876', warmServerPath: false });
      // late-interaction-model warmup still runs (doesn't depend on index existence)
      const nonLateInteractionComponents = result.components.filter((c) => c.component !== 'late-interaction-model');
      expect(nonLateInteractionComponents.length).toBe(0);
      expect(mockWarmFromCache).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Conditional API connection warmup
  // -------------------------------------------------------------------------

  describe('warmSession - API connection warmup', () => {
    it('warms Voyage TLS when Voyage is the active provider', async () => {
      existingPaths.add('/tmp/test-code-graph.db');

      // Switch to remote provider
      EMBEDDING_CONFIG.provider = 'voyage';
      EMBEDDING_CONFIG.isRemote = true;
      EMBEDDING_PROVIDERS.voyage.enabled = true;
      EMBEDDING_PROVIDERS.voyage.apiKey = 'test-key';

      // Health: not ready, then ready
      mockFetch
        .mockResolvedValueOnce({ ok: false }) // initial: down
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) }) // poll: ready
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }); // API warmup

      const result = await warmSession({
        baseUrl: 'http://localhost:9876',
        readyTimeoutMs: 2000,
        warmServerPath: false,
      });

      expect(result.skipped).toBe(false);
      // Should have 3 components: fts5+hcgs, api-connection (no vocab since binary doesn't exist)
      const apiResult = result.components.find((c) => c.component.includes('connection'));
      expect(apiResult).toBeDefined();
      expect(apiResult.ok).toBe(true);

      // Verify the API call was to Voyage endpoint
      const apiCall = mockFetch.mock.calls.find((c) => c[0]?.includes?.('voyageai.com'));
      expect(apiCall).toBeDefined();
    });

    it('does NOT warm API when provider is local', async () => {
      existingPaths.add('/tmp/test-code-graph.db');

      EMBEDDING_CONFIG.provider = 'local';
      EMBEDDING_CONFIG.isRemote = false;

      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) });

      const result = await warmSession({ baseUrl: 'http://localhost:9876', warmServerPath: false });

      const apiResult = result.components.find((c) => c.component.includes('connection'));
      expect(apiResult).toBeUndefined();

      // No calls to embedding APIs
      const apiCalls = mockFetch.mock.calls.filter(
        (c) => c[0]?.includes?.('voyageai') || c[0]?.includes?.('mistral') || c[0]?.includes?.('jina'),
      );
      expect(apiCalls.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Server-path warmups (query-router + late interaction)
  // -------------------------------------------------------------------------

  describe('warmSession - server-path warmups', () => {
    it('warms query-router and late interaction when warmServerPath=true', async () => {
      existingPaths.add('/tmp/test-code-graph.db');

      let healthCalls = 0;
      mockFetch.mockImplementation(async (url) => {
        const raw = String(url);
        if (raw.includes('/health')) {
          healthCalls++;
          if (healthCalls === 1) return { ok: false };
          return { ok: true, json: async () => ({ status: 'ready' }) };
        }
        if (raw.includes('/search?')) {
          return { ok: true, json: async () => ({ results: [], stats: {} }) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const result = await warmSession({
        baseUrl: 'http://localhost:9876',
        warmServerPath: true,
      });

      const searchCalls = mockFetch.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/search?'))
        .map((u) => new URL(u));

      expect(searchCalls).toHaveLength(2);
      expect(searchCalls.some((u) => u.searchParams.get('mode') === 'auto')).toBe(true);
      expect(searchCalls.some((u) => u.searchParams.get('late-interaction') === 'true')).toBe(true);

      const qr = result.components.find((c) => c.component === 'query-router');
      const lateInteraction = result.components.find((c) => c.component === 'late-interaction');
      expect(qr?.ok).toBe(true);
      expect(lateInteraction?.ok).toBe(true);
    });

    it('does not run server-path warmups when warmServerPath=false', async () => {
      existingPaths.add('/tmp/test-code-graph.db');

      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) });

      const result = await warmSession({
        baseUrl: 'http://localhost:9876',
        warmServerPath: false,
      });

      const searchCalls = mockFetch.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/search?'));
      expect(searchCalls).toHaveLength(0);
      expect(result.components.find((c) => c.component === 'query-router')).toBeUndefined();
    });

    it('reports server-path warmup errors on non-2xx responses', async () => {
      existingPaths.add('/tmp/test-code-graph.db');

      let healthCalls = 0;
      mockFetch.mockImplementation(async (url) => {
        const raw = String(url);
        if (raw.includes('/health')) {
          healthCalls++;
          if (healthCalls === 1) return { ok: false };
          return { ok: true, json: async () => ({ status: 'ready' }) };
        }
        if (raw.includes('/search?') && raw.includes('mode=auto')) {
          return { ok: false, status: 503 };
        }
        if (raw.includes('/search?') && raw.includes('mode=semantic')) {
          return { ok: false, status: 502 };
        }
        return { ok: true, json: async () => ({}) };
      });

      const result = await warmSession({
        baseUrl: 'http://localhost:9876',
        warmServerPath: true,
      });

      const qr = result.components.find((c) => c.component === 'query-router');
      const lateInteraction = result.components.find((c) => c.component === 'late-interaction');
      expect(qr?.ok).toBe(false);
      expect(lateInteraction?.ok).toBe(false);
      expect(String(qr?.error)).toContain('HTTP 503');
      expect(String(lateInteraction?.error)).toContain('HTTP 502');
    });
  });

  // -------------------------------------------------------------------------
  // Fallback paths
  // -------------------------------------------------------------------------

  describe('warmSession - fallback paths', () => {
    it('falls back to direct SQLite when warmFromCache fails', async () => {
      existingPaths.add('/tmp/test-code-graph.db');

      mockWarmFromCache.mockRejectedValueOnce(new Error('import failed'));

      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) });

      const result = await warmSession({ baseUrl: 'http://localhost:9876', warmServerPath: false });

      const sqliteResult = result.components.find((c) => c.component === 'fts5+hcgs');
      expect(sqliteResult).toBeDefined();
      expect(sqliteResult.ok).toBe(true);
      expect(sqliteResult.details.fallback).toBe(true);
      // Should have opened SQLite directly
      expect(_mockDbInstance).toHaveBeenCalledWith('/tmp/test-code-graph.db', { readonly: true, timeout: 5000 });
    });

    it('handles server timeout gracefully', async () => {
      existingPaths.add('/tmp/test-code-graph.db');

      // Server never becomes ready
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'starting' }) });

      const result = await warmSession({
        baseUrl: 'http://localhost:9876',
        readyTimeoutMs: 500,
        warmServerPath: false,
      });

      expect(result.ready).toBe(false);
      // Warmup components should still have run
      expect(result.components.length).toBeGreaterThan(0);
    });

    it('reports corrupt vocabulary metadata distinctly', async () => {
      existingPaths.add('/tmp/test-code-graph.db');
      existingPaths.add('/tmp/test-vocab-identifiers.bin');
      existingPaths.add('/tmp/test-vocab-identifiers.meta.json');
      await fs.writeFile('/tmp/test-vocab-identifiers.bin', Buffer.from('abc'));
      await fs.writeFile('/tmp/test-vocab-identifiers.meta.json', '{invalid');

      mockFetch
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ready' }) });

      const result = await warmSession({
        baseUrl: 'http://localhost:9876',
        warmServerPath: false,
      });

      const vocab = result.components.find((c) => c.component === 'vocabulary');
      expect(vocab).toBeDefined();
      expect(vocab.ok).toBe(false);
      expect(vocab.error).toContain('corrupt meta.json');
    });
  });

  // -------------------------------------------------------------------------
  // Health contract alignment
  // -------------------------------------------------------------------------

  describe('health contract', () => {
    it('recognizes status=ready from enhanced health endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'ready',
          warm: true,
          initTimeMs: 3500,
          components: { graphIndex: true, hnswIndex: true },
          pid: 12345,
          uptime: 10,
        }),
      });

      const health = await readHealth('http://localhost:9876');
      expect(health.status).toBe('ready');
      expect(health.components.graphIndex).toBe(true);
      expect(health.initTimeMs).toBe(3500);
    });

    it('recognizes status=starting during initialization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'starting', warm: false, pid: 12345 }),
      });

      const health = await readHealth('http://localhost:9876');
      expect(health.status).toBe('starting');
      expect(health.warm).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Undici Pool path tests
// ---------------------------------------------------------------------------

describe('undici pool path', () => {
  beforeEach(() => {
    resetMockState();
    process.env.SWEET_SEARCH_USE_UNDICI_POOL = '1';
  });

  afterEach(async () => {
    process.env.SWEET_SEARCH_USE_UNDICI_POOL = '0';
    await closeConnectionPools();
    delete globalThis.fetch;
  });

  it('getPoolForEndpoint reuses pool for same origin', () => {
    const { pool: pool1 } = getPoolForEndpoint('http://example.com/path1');
    const { pool: pool2 } = getPoolForEndpoint('http://example.com/path2');
    expect(pool1).toBe(pool2);
    expect(MockPool).toHaveBeenCalledTimes(1);
  });

  it('getPoolForEndpoint creates separate pools for different origins', () => {
    const { pool: pool1 } = getPoolForEndpoint('http://a.example.com/x');
    const { pool: pool2 } = getPoolForEndpoint('http://b.example.com/y');
    expect(pool1).not.toBe(pool2);
    expect(MockPool).toHaveBeenCalledTimes(2);
  });

  it('closeConnectionPools closes all pools', async () => {
    getPoolForEndpoint('http://a.example.com/x');
    getPoolForEndpoint('http://b.example.com/y');
    await closeConnectionPools();
    expect(mockPoolClose).toHaveBeenCalledTimes(2);
  });

  it('postJsonWithKeepAlive uses undici Pool when enabled', async () => {
    await postJsonWithKeepAlive(
      'http://example.com/api/embed',
      { 'Content-Type': 'application/json', Authorization: 'Bearer key' },
      { model: 'test', input: ['hello'] },
    );
    expect(MockPool).toHaveBeenCalledTimes(1);
    expect(MockPool).toHaveBeenCalledWith('http://example.com', expect.objectContaining({
      connections: 2,
      pipelining: 1,
    }));
    expect(mockPoolRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/api/embed',
      body: JSON.stringify({ model: 'test', input: ['hello'] }),
    }));
  });

  it('postJsonWithKeepAlive respects timeout via AbortController', async () => {
    mockPoolRequest.mockImplementationOnce(({ signal }) =>
      new Promise((_, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      }),
    );
    await expect(
      postJsonWithKeepAlive('http://example.com/api', {}, {}, 50),
    ).rejects.toThrow();
  });

  it('warmEmbeddingAPIConnection uses undici pool for remote provider', async () => {
    existingPaths.add('/tmp/test-code-graph.db');
    EMBEDDING_CONFIG.provider = 'voyage';
    EMBEDDING_CONFIG.isRemote = true;
    EMBEDDING_PROVIDERS.voyage.enabled = true;
    EMBEDDING_PROVIDERS.voyage.apiKey = 'test-key';

    let healthCalls = 0;
    mockFetch.mockImplementation(async () => {
      healthCalls++;
      if (healthCalls === 1) return { ok: false };
      return { ok: true, json: async () => ({ status: 'ready' }) };
    });

    const result = await warmSession({
      baseUrl: 'http://localhost:9876',
      readyTimeoutMs: 2000,
      warmServerPath: false,
    });

    expect(MockPool).toHaveBeenCalled();
    expect(mockPoolRequest).toHaveBeenCalled();
    const apiResult = result.components.find((c) => c.component.includes('connection'));
    expect(apiResult).toBeDefined();
    expect(apiResult.ok).toBe(true);
  });
});
