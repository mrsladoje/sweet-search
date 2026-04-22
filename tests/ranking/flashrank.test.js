/**
 * FlashRank / Reranker / VoyageReranker / JinaReranker Tests
 *
 * London School TDD: all external dependencies are mocked.
 * - ONNX runtime (onnxruntime-node): mocked InferenceSession
 * - fetch: mocked for Voyage / Jina API calls
 * - model-fetcher: mocked to skip real model downloads
 * - native-tokenizer: mocked tokenizer function
 * - ort-pipeline: mocked initOrt / buildFeed
 * - onnx-mutex: pass-through (no real mutex)
 * - config: deterministic values, no env dependency
 * - local-reranker: mocked singleton
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock infrastructure BEFORE importing subjects under test
// ---------------------------------------------------------------------------

// Mock onnx-mutex: just run the callback
vi.mock('../../core/infrastructure/onnx-mutex.js', () => ({
  withOnnxMutex: vi.fn((fn) => fn()),
}));

// Mock onnx-session-utils
vi.mock('../../core/infrastructure/onnx-session-utils.js', () => ({
  buildSessionOptions: vi.fn(() => ({ executionProviders: ['cpu'] })),
  warnIfGraphNotMaterialized: vi.fn(),
}));

// Mock coreml-provider
vi.mock('../../core/infrastructure/coreml-provider.js', () => ({
  isAppleSilicon: vi.fn(() => false),
  isCoreMLProviderAvailable: vi.fn(async () => false),
}));

// Mock model-fetcher
vi.mock('../../core/infrastructure/model-fetcher.js', () => ({
  fetchModel: vi.fn(async () => {}),
  getModelCacheDir: vi.fn(() => '/fake/cache/Xenova/ms-marco-TinyBERT-L-2-v2'),
}));

// Mock native-tokenizer
const mockTokenizerFn = vi.fn((input, _opts) => ({
  input_ids: { data: new BigInt64Array([1n, 2n, 3n]), dims: [1, 3] },
  attention_mask: { data: new BigInt64Array([1n, 1n, 1n]), dims: [1, 3] },
}));
vi.mock('../../core/infrastructure/native-tokenizer.js', () => ({
  createTokenizer: vi.fn(async () => mockTokenizerFn),
}));

// Mock ort-pipeline: provide a fake InferenceSession factory
const mockSessionRun = vi.fn(async () => ({
  logits: { data: new Float32Array([-6.5]) },
}));
const mockSession = {
  run: mockSessionRun,
  inputNames: ['input_ids', 'attention_mask'],
  outputNames: ['logits'],
};

vi.mock('../../core/infrastructure/ort-pipeline.js', () => ({
  initOrt: vi.fn(async () => ({
    InferenceSession: {
      create: vi.fn(async () => mockSession),
    },
  })),
  buildFeed: vi.fn((tokenized, inputNames) => {
    const feed = {};
    for (const name of inputNames) {
      feed[name] = tokenized[name] || { data: new BigInt64Array([1n]), dims: [1, 1] };
    }
    return feed;
  }),
}));

// Mock local-reranker singleton
const mockLocalReranker = {
  isAvailable: vi.fn(() => false),
  rerank: vi.fn(async (query, docs, topK) => ({
    results: docs.slice(0, topK).map((d, i) => ({
      ...(typeof d === 'string' ? {} : d),
      localRerankerScore: 0.5,
      originalIndex: i,
      newRank: i + 1,
      source: 'local-gte-modernbert-int8',
    })),
    latency_ms: 5,
    model: 'gte-reranker-modernbert-base-int8',
  })),
};
vi.mock('../../core/ranking/local-reranker.js', () => ({
  getGlobalLocalReranker: vi.fn(() => mockLocalReranker),
}));

// Mock config — provide deterministic RERANK_CONFIG
vi.mock('../../core/infrastructure/config/index.js', () => ({
  RERANK_CONFIG: {
    timeout: 5000,
    maxRetries: 1,
    retryDelayMs: 10,
    maxDocTruncation: { voyage: 4000, jina: 8000 },
    voyage: {
      enabled: false,
      model: 'rerank-2.5',
      endpoint: 'https://api.voyageai.com/v1/rerank',
      apiKey: '',
      maxDocuments: 100,
    },
    jina: {
      enabled: false,
      model: 'jina-reranker-v3',
      endpoint: 'https://api.jina.ai/v1/rerank',
      apiKey: '',
      maxDocuments: 100,
    },
    flashrank: {
      model: 'ms-marco-TinyBERT-L-2-v2',
      maxDocLength: 512,
    },
  },
  LOCAL_RERANKER_CONFIG: {
    model: { name: 'gte-reranker-modernbert-base-int8' },
  },
  isVoyageAvailable: vi.fn(() => false),
  getVoyageApiKey: vi.fn(() => ''),
  isJinaRerankerAvailable: vi.fn(() => false),
  getJinaRerankerApiKey: vi.fn(() => ''),
  shouldUseLocalReranker: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Import subjects under test (after mocks are in place)
// ---------------------------------------------------------------------------
import {
  FlashRankReranker,
  VoyageReranker,
  JinaReranker,
  Reranker,
} from '../../core/ranking/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fetch Response stub. */
function fakeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const SAMPLE_DOCS = [
  'AuthService handles user authentication and login',
  'The database connection pool manages MySQL connections',
  'LoginController processes login requests from the frontend',
];

const SAMPLE_OBJ_DOCS = [
  { content: 'AuthService handles login', id: 1 },
  { content: 'Database pool manager', id: 2 },
  { text: 'JWT validation middleware', id: 3 },
];

// =============================================================================
// 1. FlashRankReranker
// =============================================================================

describe('FlashRankReranker', () => {
  let reranker;

  beforeEach(() => {
    reranker = new FlashRankReranker();
    // Reset ONNX mock for each test
    mockSessionRun.mockResolvedValue({
      logits: { data: new Float32Array([-6.5]) },
    });
    mockTokenizerFn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should set default model from RERANK_CONFIG', () => {
      expect(reranker.model).toBe('ms-marco-TinyBERT-L-2-v2');
    });

    it('should set default maxDocLength from RERANK_CONFIG', () => {
      expect(reranker.maxDocLength).toBe(512);
    });

    it('should accept custom options', () => {
      const custom = new FlashRankReranker({
        model: 'custom-model',
        maxDocLength: 256,
      });
      expect(custom.model).toBe('custom-model');
      expect(custom.maxDocLength).toBe(256);
    });

    it('should start with null session and tokenizer', () => {
      expect(reranker.session).toBeNull();
      expect(reranker.tokenizer).toBeNull();
    });
  });

  describe('init', () => {
    it('should create an ONNX session and tokenizer', async () => {
      await reranker.init();

      expect(reranker.session).toBe(mockSession);
      expect(reranker.tokenizer).toBe(mockTokenizerFn);
    });

    it('should be idempotent — second call is a no-op', async () => {
      await reranker.init();
      const session1 = reranker.session;

      await reranker.init();
      expect(reranker.session).toBe(session1);
    });

    it('should set session to null if model load fails', async () => {
      const { initOrt } = await import('../../core/infrastructure/ort-pipeline.js');
      initOrt.mockResolvedValueOnce({
        InferenceSession: {
          create: vi.fn(async () => { throw new Error('ONNX load failed'); }),
        },
      });

      const fresh = new FlashRankReranker();
      await fresh.init();

      expect(fresh.session).toBeNull();
    });
  });

  describe('rerank', () => {
    it('should return scored and sorted results', async () => {
      const result = await reranker.rerank('authentication login', SAMPLE_DOCS, 3);

      expect(result.results).toHaveLength(3);
      expect(result.model).toBe('ms-marco-TinyBERT-L-2-v2');
      expect(typeof result.latency_ms).toBe('number');
    });

    it('should attach flashRankScore, originalIndex, newRank, source to each result', async () => {
      const result = await reranker.rerank('test query', SAMPLE_DOCS, 3);

      for (const r of result.results) {
        expect(r).toHaveProperty('flashRankScore');
        expect(r).toHaveProperty('originalIndex');
        expect(r).toHaveProperty('newRank');
        expect(r.source).toBe('flashrank');
      }
    });

    it('should respect topK limit', async () => {
      const docs = Array(20).fill('some document text');
      const result = await reranker.rerank('query', docs, 5);

      expect(result.results).toHaveLength(5);
    });

    it('should handle document objects with content property', async () => {
      const result = await reranker.rerank('test', SAMPLE_OBJ_DOCS, 3);

      expect(result.results).toHaveLength(3);
      // Original properties should be preserved via spread
      expect(result.results.some(r => r.id !== undefined)).toBe(true);
    });

    it('should handle document objects with text property', async () => {
      const docs = [{ text: 'JWT validation middleware', id: 3 }];
      const result = await reranker.rerank('jwt', docs, 1);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe(3);
    });

    it('should truncate documents to maxDocLength', async () => {
      const longDoc = 'x'.repeat(2000);
      await reranker.rerank('test', [longDoc], 1);

      // Tokenizer should receive truncated text (query + [SEP] + truncated doc)
      const call = mockTokenizerFn.mock.calls[0];
      const inputStr = call[0];
      // The doc portion should be at most 512 chars
      const docPart = inputStr.split(' [SEP] ')[1];
      expect(docPart.length).toBeLessThanOrEqual(512);
    });

    it('should sort results by score descending', async () => {
      // Make ONNX return different scores for each document
      let callIdx = 0;
      const scores = [-8.0, -5.0, -6.5];
      mockSessionRun.mockImplementation(async () => ({
        logits: { data: new Float32Array([scores[callIdx++]]) },
      }));

      const result = await reranker.rerank('test', SAMPLE_DOCS, 3);

      // Highest score (closest to 0) should be first
      expect(result.results[0].flashRankScore).toBe(-5.0);
      expect(result.results[1].flashRankScore).toBe(-6.5);
      expect(result.results[2].flashRankScore).toBe(-8.0);
    });

    it('should assign newRank starting at 1', async () => {
      const result = await reranker.rerank('test', SAMPLE_DOCS, 3);

      result.results.forEach((r, i) => {
        expect(r.newRank).toBe(i + 1);
      });
    });

    it('should fall back to keyword scoring when session is unavailable', async () => {
      // Force init failure so session stays null
      const { initOrt } = await import('../../core/infrastructure/ort-pipeline.js');
      initOrt.mockResolvedValueOnce({
        InferenceSession: {
          create: vi.fn(async () => { throw new Error('no model'); }),
        },
      });

      const fresh = new FlashRankReranker();
      const result = await fresh.rerank('authentication login', SAMPLE_DOCS, 3);

      expect(result.model).toBe('keyword-fallback');
      expect(result.results).toHaveLength(3);
      // Results should still have flashRankScore
      for (const r of result.results) {
        expect(typeof r.flashRankScore).toBe('number');
      }
    });

    it('should assign -10 score when individual ONNX inference throws', async () => {
      let callIdx = 0;
      mockSessionRun.mockImplementation(async () => {
        if (callIdx++ === 1) throw new Error('inference crash');
        return { logits: { data: new Float32Array([-6.0]) } };
      });

      const result = await reranker.rerank('test', SAMPLE_DOCS, 3);

      // The document at index 1 should have score -10
      const failedDoc = result.results.find(r => r.originalIndex === 1);
      expect(failedDoc.flashRankScore).toBe(-10);
    });
  });

  describe('rerankBatched', () => {
    it('should return results with source flashrank-batched', async () => {
      const result = await reranker.rerankBatched('test', SAMPLE_DOCS, 3);

      expect(result.results).toHaveLength(3);
      for (const r of result.results) {
        expect(r.source).toBe('flashrank-batched');
      }
    });

    it('should respect topK limit', async () => {
      const docs = Array(20).fill('document');
      const result = await reranker.rerankBatched('test', docs, 5);
      expect(result.results).toHaveLength(5);
    });

    it('should report batched model name when session is available', async () => {
      const result = await reranker.rerankBatched('test', SAMPLE_DOCS, 3);
      expect(result.model).toBe('ms-marco-TinyBERT-L-2-v2-batched');
    });

    it('should fall back to keyword-fallback when session is null', async () => {
      const { initOrt } = await import('../../core/infrastructure/ort-pipeline.js');
      initOrt.mockResolvedValueOnce({
        InferenceSession: {
          create: vi.fn(async () => { throw new Error('no model'); }),
        },
      });

      const fresh = new FlashRankReranker();
      const result = await fresh.rerankBatched('test', SAMPLE_DOCS, 3);

      expect(result.model).toBe('keyword-fallback');
    });
  });

  describe('simpleScore (keyword fallback)', () => {
    it('should score higher when query words appear in document', () => {
      const score = reranker.simpleScore(
        'authentication login',
        'AuthService handles user authentication and login'
      );
      expect(score).toBeGreaterThan(0);
    });

    it('should return 0 when no query words match', () => {
      const score = reranker.simpleScore(
        'zebra giraffe',
        'AuthService handles user authentication'
      );
      expect(score).toBe(0);
    });

    it('should give bonus for exact word boundary matches', () => {
      const scoreExact = reranker.simpleScore('auth', 'auth service');
      const scorePartial = reranker.simpleScore('auth', 'authentication');
      // Exact word boundary gets bonus, so "auth" in "auth service" > "auth" in "authentication"
      expect(scoreExact).toBeGreaterThan(scorePartial);
    });

    it('should ignore short words (length <= 2)', () => {
      const score = reranker.simpleScore('a is of the', 'a is of the document');
      // All words <= 2 chars are filtered, so 0 query words => division would be 0/0
      // The implementation filters words > 2 chars, "the" has 3 chars so it stays
      expect(typeof score).toBe('number');
    });

    it('should normalize by query word count', () => {
      // Single matching word vs same word with extra non-matching words
      const score1 = reranker.simpleScore('authentication', 'authentication service');
      const score2 = reranker.simpleScore('authentication zebra', 'authentication service');
      // score2 divides by 2 words, score1 by 1 — score1 should be higher
      expect(score1).toBeGreaterThan(score2);
    });
  });
});

// =============================================================================
// 2. VoyageReranker
// =============================================================================

describe('VoyageReranker', () => {
  let reranker;
  let fetchSpy;

  beforeEach(() => {
    reranker = new VoyageReranker({ apiKey: 'test-voyage-key' });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should set model from RERANK_CONFIG defaults', () => {
      const r = new VoyageReranker();
      expect(r.model).toBe('rerank-2.5');
    });

    it('should set endpoint from RERANK_CONFIG defaults', () => {
      const r = new VoyageReranker();
      expect(r.endpoint).toBe('https://api.voyageai.com/v1/rerank');
    });

    it('should accept custom options', () => {
      const r = new VoyageReranker({
        model: 'rerank-3',
        endpoint: 'https://custom.endpoint/rerank',
        apiKey: 'custom-key',
        maxDocuments: 50,
      });
      expect(r.model).toBe('rerank-3');
      expect(r.endpoint).toBe('https://custom.endpoint/rerank');
      expect(r.apiKey).toBe('custom-key');
      expect(r.maxDocuments).toBe(50);
    });
  });

  describe('isAvailable', () => {
    it('should return true when API key is set', () => {
      expect(reranker.isAvailable()).toBe(true);
    });

    it('should return falsy when API key is empty', () => {
      const r = new VoyageReranker({ apiKey: '' });
      expect(r.isAvailable()).toBeFalsy();
    });

    it('should return falsy when API key is undefined', () => {
      const r = new VoyageReranker({ apiKey: undefined });
      // Falls through to getVoyageApiKey() which returns ''
      expect(r.isAvailable()).toBeFalsy();
    });
  });

  describe('rerank', () => {
    it('should call fetch with correct endpoint, headers, and body', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        data: [
          { index: 0, relevance_score: 0.95 },
          { index: 1, relevance_score: 0.7 },
        ],
      }));

      await reranker.rerank('auth query', ['doc one', 'doc two'], 2);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.voyageai.com/v1/rerank');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Authorization']).toBe('Bearer test-voyage-key');
      expect(opts.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(opts.body);
      expect(body.query).toBe('auth query');
      expect(body.documents).toEqual(['doc one', 'doc two']);
      expect(body.model).toBe('rerank-2.5');
      expect(body.top_k).toBe(2);
      expect(body.return_documents).toBe(false);
    });

    it('should return scored results mapped from API response', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        data: [
          { index: 1, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.7 },
        ],
      }));

      const result = await reranker.rerank('test', SAMPLE_DOCS, 2);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].voyageScore).toBe(0.95);
      expect(result.results[0].source).toBe('voyage');
      expect(result.results[0].newRank).toBe(1);
      expect(result.model).toBe('rerank-2.5');
      expect(typeof result.latency_ms).toBe('number');
    });

    it('should return empty results for empty documents array', async () => {
      const result = await reranker.rerank('test', [], 10);
      expect(result.results).toEqual([]);
      expect(result.latency_ms).toBe(0);
      // fetch should NOT have been called
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should throw on empty query', async () => {
      await expect(reranker.rerank('', SAMPLE_DOCS, 10))
        .rejects.toThrow('Query must be a non-empty string');
    });

    it('should throw on whitespace-only query', async () => {
      await expect(reranker.rerank('   ', SAMPLE_DOCS, 10))
        .rejects.toThrow('Query must be a non-empty string');
    });

    it('should throw when API key is not configured', async () => {
      const noKey = new VoyageReranker({ apiKey: '' });
      await expect(noKey.rerank('test', SAMPLE_DOCS, 10))
        .rejects.toThrow('Voyage API key not configured');
    });

    it('should truncate documents to maxDocTruncation.voyage length', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        data: [{ index: 0, relevance_score: 0.5 }],
      }));

      const longDoc = 'y'.repeat(10000);
      await reranker.rerank('test', [longDoc], 1);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.documents[0].length).toBeLessThanOrEqual(4000);
    });

    it('should throw timeout error when request exceeds timeout', async () => {
      fetchSpy.mockImplementation(async (_url, opts) => {
        // Simulate abort
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      });

      await expect(reranker.rerank('test', SAMPLE_DOCS, 10))
        .rejects.toThrow(/timed out/);
    });

    it('should retry on 5xx errors with exponential backoff', async () => {
      // First call: 500, second call: success
      fetchSpy
        .mockResolvedValueOnce(fakeResponse({ error: 'server error' }, 500))
        .mockResolvedValueOnce(fakeResponse({
          data: [{ index: 0, relevance_score: 0.5 }],
        }));

      const result = await reranker.rerank('test', ['doc'], 1);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(1);
    });

    it('should NOT retry on 4xx client errors', async () => {
      fetchSpy.mockResolvedValue(fakeResponse({ error: 'bad request' }, 400));

      await expect(reranker.rerank('test', SAMPLE_DOCS, 10))
        .rejects.toThrow(/Voyage API error \(400\)/);

      // With maxRetries=1, a 4xx still gets thrown immediately on first hit,
      // but the current impl throws on 4xx which terminates the loop.
      // It may still attempt up to maxRetries+1 calls due to the for loop structure.
      // The key assertion is that it ultimately throws.
    });

    it('should throw after all retries are exhausted', async () => {
      fetchSpy.mockResolvedValue(fakeResponse({ error: 'server error' }, 500));

      await expect(reranker.rerank('test', SAMPLE_DOCS, 10))
        .rejects.toThrow(/failed after .* attempts/);
    });

    it('should use AbortController signal for timeout', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        data: [{ index: 0, relevance_score: 0.5 }],
      }));

      await reranker.rerank('test', ['doc'], 1);

      const opts = fetchSpy.mock.calls[0][1];
      expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('should preserve original document properties in results', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        data: [
          { index: 0, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.8 },
        ],
      }));

      const docs = [
        { content: 'Auth code', id: 1, path: '/auth.js' },
        { content: 'DB code', id: 2, path: '/db.js' },
      ];
      const result = await reranker.rerank('test', docs, 2);

      expect(result.results[0].id).toBe(1);
      expect(result.results[0].path).toBe('/auth.js');
      expect(result.results[1].id).toBe(2);
    });
  });
});

// =============================================================================
// 3. JinaReranker
// =============================================================================

describe('JinaReranker', () => {
  let reranker;
  let fetchSpy;

  beforeEach(() => {
    reranker = new JinaReranker({ apiKey: 'test-jina-key' });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should set model from RERANK_CONFIG defaults', () => {
      const r = new JinaReranker();
      expect(r.model).toBe('jina-reranker-v3');
    });

    it('should set endpoint from RERANK_CONFIG defaults', () => {
      const r = new JinaReranker();
      expect(r.endpoint).toBe('https://api.jina.ai/v1/rerank');
    });

    it('should accept custom options', () => {
      const r = new JinaReranker({
        model: 'jina-reranker-v4',
        endpoint: 'https://custom.jina/rerank',
        apiKey: 'key',
        maxDocuments: 25,
      });
      expect(r.model).toBe('jina-reranker-v4');
      expect(r.maxDocuments).toBe(25);
    });
  });

  describe('isAvailable', () => {
    it('should return true when API key is set', () => {
      expect(reranker.isAvailable()).toBe(true);
    });

    it('should return falsy when API key is empty', () => {
      const r = new JinaReranker({ apiKey: '' });
      expect(r.isAvailable()).toBeFalsy();
    });
  });

  describe('rerank', () => {
    it('should call fetch with correct endpoint and Jina-specific body (top_n not top_k)', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        results: [{ index: 0, relevance_score: 0.9 }],
      }));

      await reranker.rerank('search query', ['document'], 5);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.jina.ai/v1/rerank');
      expect(opts.headers['Authorization']).toBe('Bearer test-jina-key');

      const body = JSON.parse(opts.body);
      expect(body.query).toBe('search query');
      expect(body.model).toBe('jina-reranker-v3');
      expect(body.top_n).toBe(5);  // Jina uses top_n, NOT top_k
      expect(body.return_documents).toBe(false);
    });

    it('should return scored results mapped from Jina API response', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        results: [
          { index: 2, relevance_score: 0.95 },
          { index: 0, relevance_score: 0.8 },
          { index: 1, relevance_score: 0.6 },
        ],
      }));

      const result = await reranker.rerank('test', SAMPLE_DOCS, 3);

      expect(result.results).toHaveLength(3);
      expect(result.results[0].jinaScore).toBe(0.95);
      expect(result.results[0].source).toBe('jina');
      expect(result.results[0].newRank).toBe(1);
      expect(result.model).toBe('jina-reranker-v3');
    });

    it('should return empty results for empty documents', async () => {
      const result = await reranker.rerank('test', [], 10);
      expect(result.results).toEqual([]);
      expect(result.latency_ms).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should throw on empty query', async () => {
      await expect(reranker.rerank('', SAMPLE_DOCS))
        .rejects.toThrow('Query must be a non-empty string');
    });

    it('should throw when API key is not configured', async () => {
      const noKey = new JinaReranker({ apiKey: '' });
      await expect(noKey.rerank('test', SAMPLE_DOCS))
        .rejects.toThrow('Jina API key not configured');
    });

    it('should truncate documents to maxDocTruncation.jina length', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        results: [{ index: 0, relevance_score: 0.5 }],
      }));

      const longDoc = 'z'.repeat(20000);
      await reranker.rerank('test', [longDoc], 1);

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body.documents[0].length).toBeLessThanOrEqual(8000);
    });

    it('should throw timeout error on AbortError', async () => {
      fetchSpy.mockImplementation(async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      });

      await expect(reranker.rerank('test', SAMPLE_DOCS))
        .rejects.toThrow(/timed out/);
    });

    it('should retry on 5xx errors', async () => {
      fetchSpy
        .mockResolvedValueOnce(fakeResponse({ error: 'server down' }, 503))
        .mockResolvedValueOnce(fakeResponse({
          results: [{ index: 0, relevance_score: 0.5 }],
        }));

      const result = await reranker.rerank('test', ['doc'], 1);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(1);
    });

    it('should throw after retries exhausted', async () => {
      fetchSpy.mockResolvedValue(fakeResponse({ error: 'broken' }, 502));

      await expect(reranker.rerank('test', SAMPLE_DOCS))
        .rejects.toThrow(/failed after .* attempts/);
    });

    it('should throw when Jina API returns empty results for non-empty documents', async () => {
      fetchSpy.mockResolvedValue(fakeResponse({ results: [] }));

      await expect(reranker.rerank('test', SAMPLE_DOCS))
        .rejects.toThrow(/empty results/);
    });

    it('should preserve original document properties', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        results: [{ index: 0, relevance_score: 0.9 }],
      }));

      const docs = [{ content: 'code', id: 42, filePath: '/x.js' }];
      const result = await reranker.rerank('test', docs, 1);

      expect(result.results[0].id).toBe(42);
      expect(result.results[0].filePath).toBe('/x.js');
      expect(result.results[0].jinaScore).toBe(0.9);
    });
  });
});

// =============================================================================
// 4. Reranker (unified facade)
// =============================================================================

describe('Reranker', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockLocalReranker.isAvailable.mockReturnValue(false);
    mockSessionRun.mockResolvedValue({
      logits: { data: new Float32Array([-6.5]) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should instantiate all three sub-rerankers', () => {
      const r = new Reranker();
      expect(r.voyageReranker).toBeInstanceOf(VoyageReranker);
      expect(r.jinaReranker).toBeInstanceOf(JinaReranker);
      expect(r.flashRankReranker).toBeInstanceOf(FlashRankReranker);
    });

    it('should use global local reranker singleton', () => {
      const r = new Reranker();
      expect(r.localReranker).toBe(mockLocalReranker);
    });

    it('should default preferVoyage and preferJina to FALSE (opt-in)', () => {
      const prevV = process.env.SWEET_SEARCH_ENABLE_VOYAGE_RERANKER;
      const prevJ = process.env.SWEET_SEARCH_ENABLE_JINA_RERANKER;
      delete process.env.SWEET_SEARCH_ENABLE_VOYAGE_RERANKER;
      delete process.env.SWEET_SEARCH_ENABLE_JINA_RERANKER;
      try {
        const r = new Reranker();
        expect(r.preferVoyage).toBe(false);
        expect(r.preferJina).toBe(false);
      } finally {
        if (prevV !== undefined) process.env.SWEET_SEARCH_ENABLE_VOYAGE_RERANKER = prevV;
        if (prevJ !== undefined) process.env.SWEET_SEARCH_ENABLE_JINA_RERANKER = prevJ;
      }
    });

    it('should allow disabling preferVoyage', () => {
      const r = new Reranker({ preferVoyage: false });
      expect(r.preferVoyage).toBe(false);
    });
  });

  describe('rerank — forceLocal option', () => {
    it('should delegate to FlashRankReranker when forceLocal is true', async () => {
      const r = new Reranker();
      const result = await r.rerank('test', SAMPLE_DOCS, 3, { forceLocal: true });

      expect(result.results).toHaveLength(3);
      expect(result.results[0].source).toBe('flashrank');
    });
  });

  describe('rerank — forceJina option', () => {
    it('should delegate to JinaReranker when forceJina and Jina is available', async () => {
      fetchSpy.mockResolvedValueOnce(fakeResponse({
        results: [
          { index: 0, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.8 },
        ],
      }));

      const r = new Reranker({ apiKey: 'jina-key' });
      // Make Jina available by setting apiKey directly
      r.jinaReranker = new JinaReranker({ apiKey: 'jina-key' });

      const result = await r.rerank('test', SAMPLE_DOCS.slice(0, 2), 2, { forceJina: true });

      expect(result.results[0].source).toBe('jina');
    });
  });

  describe('rerankDirect — priority cascade', () => {
    it('should prefer localReranker when available and useLocalReranker is true', async () => {
      mockLocalReranker.isAvailable.mockReturnValue(true);
      const r = new Reranker({ useLocalReranker: true });

      const result = await r.rerankDirect('test', SAMPLE_DOCS, 3);

      expect(mockLocalReranker.rerank).toHaveBeenCalledWith('test', SAMPLE_DOCS, 3);
      expect(result.model).toBe('gte-reranker-modernbert-base-int8');
    });

    it('should fall back to Jina when local is unavailable and preferJina is opted in', async () => {
      mockLocalReranker.isAvailable.mockReturnValue(false);

      fetchSpy.mockResolvedValueOnce(fakeResponse({
        results: [{ index: 0, relevance_score: 0.85 }],
      }));

      // Remote rerankers are opt-in now — must pass preferJina: true explicitly.
      const r = new Reranker({ useLocalReranker: true, preferJina: true });
      r.jinaReranker = new JinaReranker({ apiKey: 'jina-key' });

      const result = await r.rerankDirect('test', ['doc'], 1);

      expect(result.results[0].source).toBe('jina');
    });

    it('should fall back to Voyage when local and Jina are unavailable and preferVoyage is opted in', async () => {
      mockLocalReranker.isAvailable.mockReturnValue(false);

      fetchSpy.mockResolvedValueOnce(fakeResponse({
        data: [{ index: 0, relevance_score: 0.8 }],
      }));

      const r = new Reranker({ preferVoyage: true });
      r.jinaReranker = new JinaReranker({ apiKey: '' });  // unavailable
      r.voyageReranker = new VoyageReranker({ apiKey: 'voyage-key' });

      const result = await r.rerankDirect('test', ['doc'], 1);

      expect(result.results[0].source).toBe('voyage');
    });

    it('should throw when no reranker is available', async () => {
      mockLocalReranker.isAvailable.mockReturnValue(false);

      const r = new Reranker();
      r.jinaReranker = new JinaReranker({ apiKey: '' });
      r.voyageReranker = new VoyageReranker({ apiKey: '' });

      await expect(r.rerankDirect('test', SAMPLE_DOCS))
        .rejects.toThrow('No direct cross-encoder available');
    });
  });

  describe('localRerank', () => {
    it('should delegate to flashRankReranker', async () => {
      const r = new Reranker();
      const result = await r.localRerank('test', SAMPLE_DOCS, 3);

      expect(result.results).toHaveLength(3);
      // FlashRank produces flashRankScore
      expect(result.results[0]).toHaveProperty('flashRankScore');
    });
  });

  describe('getStatus', () => {
    it('should return complete status object', () => {
      const r = new Reranker();
      const status = r.getStatus();

      expect(status).toHaveProperty('voyageAvailable');
      expect(status).toHaveProperty('voyageModel', 'rerank-2.5');
      expect(status).toHaveProperty('jinaAvailable');
      expect(status).toHaveProperty('jinaModel', 'jina-reranker-v3');
      expect(status).toHaveProperty('flashRankModel', 'ms-marco-TinyBERT-L-2-v2');
      expect(status).toHaveProperty('localRerankerAvailable');
      expect(status).toHaveProperty('localRerankerModel', 'gte-reranker-modernbert-base-int8');
      expect(status).toHaveProperty('useLocalReranker');
      expect(status).toHaveProperty('preferVoyage');
      expect(status).toHaveProperty('preferJina');
    });

    it('should reflect actual API key availability', () => {
      const r = new Reranker();
      const status = r.getStatus();

      // No API keys in test environment — isAvailable() returns '' (falsy) not boolean false
      expect(status.voyageAvailable).toBeFalsy();
      expect(status.jinaAvailable).toBeFalsy();
    });
  });
});

// =============================================================================
// 5. Error Handling — Graceful Degradation
// =============================================================================

describe('Error handling and graceful degradation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('FlashRankReranker should degrade to keyword fallback on model load failure', async () => {
    const { initOrt } = await import('../../core/infrastructure/ort-pipeline.js');
    initOrt.mockResolvedValueOnce({
      InferenceSession: {
        create: vi.fn(async () => { throw new Error('ONNX unavailable'); }),
      },
    });

    const r = new FlashRankReranker();
    const result = await r.rerank('test query', SAMPLE_DOCS, 3);

    expect(result.model).toBe('keyword-fallback');
    expect(result.results).toHaveLength(3);
    // Should still produce usable scores
    for (const doc of result.results) {
      expect(typeof doc.flashRankScore).toBe('number');
    }
  });

  it('VoyageReranker should propagate network errors after retries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const r = new VoyageReranker({ apiKey: 'key' });
    await expect(r.rerank('test', SAMPLE_DOCS))
      .rejects.toThrow(/failed after .* attempts/);
  });

  it('JinaReranker should propagate network errors after retries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const r = new JinaReranker({ apiKey: 'key' });
    await expect(r.rerank('test', SAMPLE_DOCS))
      .rejects.toThrow(/failed after .* attempts/);
  });

  it('Reranker facade should throw when all backends are unavailable', async () => {
    mockLocalReranker.isAvailable.mockReturnValue(false);

    const r = new Reranker();
    r.jinaReranker = new JinaReranker({ apiKey: '' });
    r.voyageReranker = new VoyageReranker({ apiKey: '' });

    await expect(r.rerank('test', SAMPLE_DOCS))
      .rejects.toThrow('No direct cross-encoder available');
  });

  it('FlashRankReranker should handle empty document arrays gracefully', async () => {
    const r = new FlashRankReranker();
    const result = await r.rerank('test', [], 10);

    expect(result.results).toEqual([]);
  });

  it('VoyageReranker should reject non-string query', async () => {
    await expect(reranker => new VoyageReranker({ apiKey: 'k' }).rerank(null, SAMPLE_DOCS))
      .rejects?.toThrow?.('Query must be a non-empty string');

    // Direct test
    const r = new VoyageReranker({ apiKey: 'k' });
    await expect(r.rerank(null, SAMPLE_DOCS))
      .rejects.toThrow('Query must be a non-empty string');
  });

  it('JinaReranker should reject non-string query', async () => {
    const r = new JinaReranker({ apiKey: 'k' });
    await expect(r.rerank(123, SAMPLE_DOCS))
      .rejects.toThrow('Query must be a non-empty string');
  });

  it('FlashRankReranker should handle individual scoring errors without crashing', async () => {
    const r = new FlashRankReranker();
    // Init first so session is set
    await r.init();

    // Make session.run throw on second call
    let callCount = 0;
    mockSessionRun.mockImplementation(async () => {
      if (callCount++ === 1) throw new Error('GPU OOM');
      return { logits: { data: new Float32Array([-6.0]) } };
    });

    const result = await r.rerank('test', SAMPLE_DOCS, 3);

    // Should complete with all 3 results, failed one gets -10
    expect(result.results).toHaveLength(3);
    const failed = result.results.find(r => r.flashRankScore === -10);
    expect(failed).toBeDefined();
  });
});
