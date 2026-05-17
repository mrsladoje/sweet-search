import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createBitmap, saveBitmap, setBit, loadBitmap, isSet } from '../../core/incremental-indexing/infrastructure/tombstone-bitmap.mjs';

// ---------------------------------------------------------------------------
// Mock heavy native dependencies BEFORE importing the module under test.
// London School: isolate the unit; never let usearch or better-sqlite3 run.
// ---------------------------------------------------------------------------

// Shared mock method spies — refreshed per test via beforeEach.
const mockMethods = {
  add: vi.fn(),
  search: vi.fn().mockReturnValue({
    keys: new BigUint64Array([0n, 1n]),
    distances: new Float32Array([0.1, 0.3]),
    count: 2,
  }),
  remove: vi.fn(),
  reserve: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
};

// A real constructor function (not arrow) so `new Index(...)` succeeds.
function MockUsearchIndex() {
  this.add = mockMethods.add;
  this.search = mockMethods.search;
  this.remove = mockMethods.remove;
  this.reserve = mockMethods.reserve;
  this.save = mockMethods.save;
  this.load = mockMethods.load;
}

vi.mock('usearch', () => ({
  Index: MockUsearchIndex,
}));

// Stub the config module so we never hit real platform detection or DB paths.
vi.mock('../../core/infrastructure/config/index.js', () => ({
  HNSW_CONFIG: {
    maxElements: 50000,
    M: 16,
    efConstruction: 200,
    efSearch: 100,
    metric: 'cosine',
  },
  DB_PATHS: {
    hnswIndex: '/tmp/test-hnsw.idx',
  },
  EMBEDDING_CONFIG: {
    hnswDimension: 256,
  },
}));

// Now import the public API through the barrel — exactly as production code does.
import {
  HNSWIndex,
  createHNSWIndex,
  checkNativeBackend,
  requireNativeAnn,
} from '../../core/vector-store/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset mock call history between tests. */
function resetMocks() {
  mockMethods.add.mockClear();
  mockMethods.search.mockClear().mockReturnValue({
    keys: new BigUint64Array([0n, 1n]),
    distances: new Float32Array([0.1, 0.3]),
    count: 2,
  });
  mockMethods.remove.mockClear();
  mockMethods.reserve.mockClear();
  mockMethods.save.mockClear();
  mockMethods.load.mockClear();
}

// =============================================================================
// 1. HNSWIndex constructor
// =============================================================================

describe('HNSWIndex constructor', () => {
  it('should accept custom config options and store them', () => {
    const opts = {
      dimension: 128,
      maxElements: 5000,
      M: 32,
      efConstruction: 400,
      efSearch: 200,
      metric: 'euclidean',
      indexPath: '/tmp/custom.idx',
    };

    const idx = new HNSWIndex(opts);

    expect(idx.dimension).toBe(128);
    expect(idx.maxElements).toBe(5000);
    expect(idx.M).toBe(32);
    expect(idx.efConstruction).toBe(400);
    expect(idx.efSearch).toBe(200);
    expect(idx.metric).toBe('euclidean');
    expect(idx.indexPath).toBe('/tmp/custom.idx');
  });

  it('should fall back to config defaults when no options are provided', () => {
    const idx = new HNSWIndex();

    expect(idx.dimension).toBe(256);          // EMBEDDING_CONFIG.hnswDimension
    expect(idx.maxElements).toBe(50000);      // HNSW_CONFIG.maxElements
    expect(idx.M).toBe(16);                   // HNSW_CONFIG.M
    expect(idx.efConstruction).toBe(200);     // HNSW_CONFIG.efConstruction
    expect(idx.efSearch).toBe(100);           // HNSW_CONFIG.efSearch
    expect(idx.metric).toBe('cosine');        // HNSW_CONFIG.metric
    expect(idx.indexPath).toBe('/tmp/test-hnsw.idx');
  });

  it('should initialize internal maps as empty', () => {
    const idx = new HNSWIndex();

    expect(idx.idMap.size).toBe(0);
    expect(idx.reverseMap.size).toBe(0);
    expect(idx.metadata.size).toBe(0);
    expect(idx.nextKey).toBe(0);
  });

  it('should not have initialized the native index until init() is called', () => {
    const idx = new HNSWIndex();
    expect(idx.index).toBeNull();
  });

  it('clears stale fallback mode after a successful native init', async () => {
    const idx = new HNSWIndex();
    idx.useFallback = true;

    await idx.init();

    expect(idx.index).not.toBeNull();
    expect(idx.useFallback).toBe(false);
  });
});

// =============================================================================
// 2. checkNativeBackend
// =============================================================================

describe('checkNativeBackend', () => {
  it('should return an object with available and engine fields', async () => {
    const result = await checkNativeBackend();

    expect(result).toHaveProperty('available');
    expect(result).toHaveProperty('engine');
    expect(typeof result.available).toBe('boolean');
    expect(typeof result.engine).toBe('string');
  });

  it('should report usearch as available when mock resolves', async () => {
    // Our vi.mock('usearch') provides Index constructor, so this should succeed.
    const result = await checkNativeBackend();
    expect(result.available).toBe(true);
    expect(result.engine).toBe('usearch');
  });

  it('should not include an error field when backend is available', async () => {
    const result = await checkNativeBackend();
    expect(result.error).toBeUndefined();
  });
});

// =============================================================================
// 3. requireNativeAnn
// =============================================================================

describe('requireNativeAnn', () => {
  it('should resolve when usearch is available', async () => {
    const result = await requireNativeAnn();
    expect(result).toEqual({ available: true, engine: 'usearch' });
  });

  it('should return the same shape as checkNativeBackend when available', async () => {
    const [required, checked] = await Promise.all([
      requireNativeAnn(),
      checkNativeBackend(),
    ]);
    expect(required.available).toBe(checked.available);
    expect(required.engine).toBe(checked.engine);
  });
});

// =============================================================================
// 4. createHNSWIndex factory
// =============================================================================

describe('createHNSWIndex', () => {
  beforeEach(() => resetMocks());

  it('should return an HNSWIndex instance', async () => {
    const idx = await createHNSWIndex({ dimension: 64 });
    expect(idx).toBeInstanceOf(HNSWIndex);
  });

  it('should call init() and prepare the native index', async () => {
    const idx = await createHNSWIndex({ dimension: 64 });
    // After createHNSWIndex, the index should be initialized (not null)
    // because init() was called during factory.
    expect(idx.index).not.toBeNull();
  });

  it('should forward options to the underlying HNSWIndex', async () => {
    const idx = await createHNSWIndex({
      dimension: 64,
      M: 48,
      efConstruction: 500,
    });
    expect(idx.dimension).toBe(64);
    expect(idx.M).toBe(48);
    expect(idx.efConstruction).toBe(500);
  });

  it('reserves the configured native capacity during initialization', async () => {
    await createHNSWIndex({ dimension: 64, maxElements: 1234 });
    expect(mockMethods.reserve).toHaveBeenCalledWith(1234);
  });

  it('loads fallback sidecar artifacts even when the .idx placeholder is absent', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-hnsw-factory-'));
    try {
      const indexPath = join(tmpDir, 'saved.idx');
      writeFileSync(indexPath.replace('.idx', '.meta.json'), JSON.stringify({
        dimension: 7,
        maxElements: 123,
        M: 4,
        efConstruction: 9,
        efSearch: 11,
        metric: 'cosine',
        nextKey: 0,
        idMap: [],
        metadata: [],
        useFallback: true,
      }));
      writeFileSync(indexPath.replace('.idx', '.vectors.json'), '[]');

      expect(existsSync(indexPath)).toBe(false);

      const idx = await createHNSWIndex({ indexPath, load: true, dimension: 64 });

      expect(idx.dimension).toBe(7);
      expect(idx.maxElements).toBe(123);
      expect(idx.useFallback).toBe(true);
      expect(idx.vectors).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('refuses native metadata without a native graph or fallback vectors', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-hnsw-missing-native-'));
    try {
      const indexPath = join(tmpDir, 'saved.idx');
      writeFileSync(indexPath.replace('.idx', '.meta.json'), JSON.stringify({
        dimension: 7,
        maxElements: 123,
        M: 4,
        efConstruction: 9,
        efSearch: 11,
        metric: 'cosine',
        nextKey: 1,
        idMap: [['doc', 0]],
        metadata: [['doc', { file: 'doc.js' }]],
        useFallback: false,
      }));

      await expect(createHNSWIndex({ indexPath, load: true, dimension: 64 }))
        .rejects.toThrow(/native artifact is missing/i);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// 5. Index operations — add, search, size (mocked usearch calls)
// =============================================================================

describe('HNSWIndex operations', () => {
  let idx;
  let suiteTmpDir;

  beforeEach(async () => {
    resetMocks();
    suiteTmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-hnsw-ops-'));
    idx = new HNSWIndex({
      dimension: 4,
      indexPath: join(suiteTmpDir, 'codebase-hnsw.idx'),
      stalePath: join(suiteTmpDir, 'codebase-hnsw.idx.stale.bin'),
    });
    await idx.init();
  });

  afterEach(() => {
    if (suiteTmpDir) rmSync(suiteTmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // add
  // -------------------------------------------------------------------------

  describe('add', () => {
    it('should assign an incrementing numeric key for each new id', async () => {
      const key0 = await idx.add('doc-a', [1, 0, 0, 0]);
      const key1 = await idx.add('doc-b', [0, 1, 0, 0]);

      expect(key0).toBe(0);
      expect(key1).toBe(1);
    });

    it('should call usearch index.add with BigInt key and Float32Array', async () => {
      await idx.add('doc-a', [1, 0, 0, 0]);

      expect(mockMethods.add).toHaveBeenCalledTimes(1);
      const [bigIntKey, vecArray] = mockMethods.add.mock.calls[0];
      expect(bigIntKey).toBe(0n);
      expect(vecArray).toBeInstanceOf(Float32Array);
      expect(vecArray.length).toBe(4);
    });

    it('should populate idMap and reverseMap correctly', async () => {
      await idx.add('doc-a', [1, 0, 0, 0]);

      expect(idx.idMap.get('doc-a')).toBe(0);
      expect(idx.reverseMap.get(0)).toBe('doc-a');
    });

    it('should store metadata alongside the vector', async () => {
      await idx.add('doc-a', [1, 0, 0, 0], { file: 'foo.js' });

      expect(idx.metadata.get('doc-a')).toEqual({ file: 'foo.js' });
    });

    it('should not re-add an existing id but update metadata', async () => {
      await idx.add('doc-a', [1, 0, 0, 0], { v: 1 });
      const key = await idx.add('doc-a', [0, 1, 0, 0], { v: 2 });

      // Same key returned.
      expect(key).toBe(0);
      // usearch.add only called once (first insert); second is metadata-only update.
      expect(mockMethods.add).toHaveBeenCalledTimes(1);
      // Metadata updated.
      expect(idx.metadata.get('doc-a')).toEqual({ v: 2 });
    });

    it('should truncate vectors longer than dimension', async () => {
      await idx.add('doc-a', [1, 2, 3, 4, 5, 6]);

      const [, vecArray] = mockMethods.add.mock.calls[0];
      // Dimension is 4, so only first 4 elements kept (after normalization).
      expect(vecArray.length).toBe(4);
    });

    it('should normalize vectors before passing to usearch', async () => {
      await idx.add('doc-a', [3, 0, 0, 0]);

      const [, vecArray] = mockMethods.add.mock.calls[0];
      // [3,0,0,0] normalized = [1,0,0,0]
      expect(vecArray[0]).toBeCloseTo(1.0, 5);
      expect(vecArray[1]).toBeCloseTo(0.0, 5);
    });

    it('reserves more native capacity and retries when USearch is full', async () => {
      idx.maxElements = 4;
      mockMethods.reserve.mockClear();
      mockMethods.add
        .mockImplementationOnce(() => {
          throw new Error('capacity exceeded');
        })
        .mockImplementationOnce(() => undefined);

      const key = await idx.add('doc-a', [1, 0, 0, 0]);

      expect(key).toBe(0);
      expect(mockMethods.reserve).toHaveBeenCalledWith(5);
      expect(mockMethods.add).toHaveBeenCalledTimes(2);
      expect(idx.maxElements).toBe(5);
      expect(idx.idMap.get('doc-a')).toBe(0);
      expect(idx.nextKey).toBe(1);
    });

    it('does not publish maps when native add fails for a non-capacity error', async () => {
      mockMethods.add.mockImplementationOnce(() => {
        throw new Error('dimension mismatch');
      });

      await expect(idx.add('bad-doc', [1, 0, 0, 0])).rejects.toThrow('dimension mismatch');

      expect(idx.idMap.has('bad-doc')).toBe(false);
      expect(idx.reverseMap.size).toBe(0);
      expect(idx.metadata.has('bad-doc')).toBe(false);
      expect(idx.nextKey).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  describe('search', () => {
    beforeEach(async () => {
      // Pre-populate two documents so search has something to find.
      await idx.add('doc-a', [1, 0, 0, 0], { rank: 1 });
      await idx.add('doc-b', [0, 1, 0, 0], { rank: 2 });
    });

    it('should call usearch index.search with Float32Array and clamped k', async () => {
      await idx.search([1, 0, 0, 0], 5);

      expect(mockMethods.search).toHaveBeenCalledTimes(1);
      const [vecArray, k] = mockMethods.search.mock.calls[0];
      expect(vecArray).toBeInstanceOf(Float32Array);
      // k clamped to idMap.size = 2 (we only have 2 docs).
      expect(k).toBe(2);
    });

    it('should return results array with id, score, metadata', async () => {
      const response = await idx.search([1, 0, 0, 0], 2);

      expect(response).toHaveProperty('results');
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBeGreaterThan(0);

      const first = response.results[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('score');
      expect(first).toHaveProperty('metadata');
    });

    it('should convert cosine distance to similarity (1 - distance)', async () => {
      // Mock returns distances [0.1, 0.3] for keys [0, 1].
      const response = await idx.search([1, 0, 0, 0], 2);

      // Cosine similarity = 1 - distance
      expect(response.results[0].score).toBeCloseTo(0.9, 5);
      expect(response.results[1].score).toBeCloseTo(0.7, 5);
    });

    it('should include latency and total count in response envelope', async () => {
      const response = await idx.search([1, 0, 0, 0], 2);

      expect(response).toHaveProperty('latency_us');
      expect(response).toHaveProperty('latency_ms');
      expect(response).toHaveProperty('k', 2);
      expect(response).toHaveProperty('total', 2);
      expect(response).toHaveProperty('usedFallback', false);
      expect(typeof response.latency_us).toBe('number');
    });

    it('filters tombstoned HNSW keys from the stale bitmap', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-hnsw-stale-'));
      try {
        const stalePath = join(tmpDir, 'codebase-hnsw.idx.stale.bin');
        idx.stalePath = stalePath;
        const bitmap = createBitmap(2);
        setBit(bitmap, 0);
        saveBitmap(stalePath, bitmap);

        const response = await idx.search([1, 0, 0, 0], 2);

        expect(response.results.map((r) => r.id)).toEqual(['doc-b']);
        expect(response.total).toBe(1);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should return empty results when index has no vectors', async () => {
      const emptyIdx = new HNSWIndex({ dimension: 4 });
      await emptyIdx.init();

      const response = await emptyIdx.search([1, 0, 0, 0], 5);
      expect(response.results).toEqual([]);
      expect(response.total).toBe(0);
    });

    it('should truncate query vector longer than dimension', async () => {
      await idx.search([1, 2, 3, 4, 5, 6], 2);

      const [vecArray] = mockMethods.search.mock.calls[0];
      expect(vecArray.length).toBe(4);
    });
  });

  // -------------------------------------------------------------------------
  // size / getStats
  // -------------------------------------------------------------------------

  describe('getStats', () => {
    it('should report totalVectors equal to number of added documents', async () => {
      await idx.add('doc-a', [1, 0, 0, 0]);
      await idx.add('doc-b', [0, 1, 0, 0]);
      await idx.add('doc-c', [0, 0, 1, 0]);

      const stats = idx.getStats();
      expect(stats.totalVectors).toBe(3);
    });

    it('should report engine as usearch when native backend is used', async () => {
      const stats = idx.getStats();
      expect(stats.engine).toBe('usearch');
      expect(stats.useFallback).toBe(false);
    });

    it('should include all configuration fields', async () => {
      const stats = idx.getStats();

      expect(stats).toHaveProperty('dimension', 4);
      expect(stats).toHaveProperty('maxElements');
      expect(stats).toHaveProperty('M');
      expect(stats).toHaveProperty('efConstruction');
      expect(stats).toHaveProperty('efSearch');
      expect(stats).toHaveProperty('metric');
      expect(stats).toHaveProperty('nextKey');
    });

    it('should decrement totalVectors after removal', async () => {
      await idx.add('doc-a', [1, 0, 0, 0]);
      await idx.add('doc-b', [0, 1, 0, 0]);
      await idx.remove('doc-a');

      const stats = idx.getStats();
      expect(stats.totalVectors).toBe(1);
      // nextKey never decrements — it tracks total keys ever assigned.
      expect(stats.nextKey).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  describe('remove', () => {
    it('should return true when removing an existing id', async () => {
      await idx.add('doc-a', [1, 0, 0, 0]);
      const removed = await idx.remove('doc-a');
      expect(removed).toBe(true);
    });

    it('should return false when removing a non-existent id', async () => {
      const removed = await idx.remove('nope');
      expect(removed).toBe(false);
    });

    it('should not call usearch index.remove on the live graph', async () => {
      await idx.add('doc-a', [1, 0, 0, 0]);
      await idx.remove('doc-a');

      expect(mockMethods.remove).not.toHaveBeenCalled();
    });

    it('marks the stale bitmap bit for a removed key', async () => {
      await idx.add('doc-a', [1, 0, 0, 0]);
      await idx.add('doc-b', [0, 1, 0, 0]);

      await idx.remove('doc-a');

      const bitmap = loadBitmap(idx.stalePath);
      expect(isSet(bitmap, 0)).toBe(true);
      expect(isSet(bitmap, 1)).toBe(false);
    });

    it('should clean up idMap, reverseMap, and metadata', async () => {
      await idx.add('doc-a', [1, 0, 0, 0], { x: 1 });
      await idx.remove('doc-a');

      expect(idx.idMap.has('doc-a')).toBe(false);
      expect(idx.reverseMap.has(0)).toBe(false);
      expect(idx.metadata.has('doc-a')).toBe(false);
    });

    it('oversamples metadata-tombstoned keys left in the native graph', async () => {
      await idx.add('doc-a', [1, 0, 0, 0]);
      await idx.add('doc-b', [0, 1, 0, 0]);
      await idx.add('doc-c', [0, 0, 1, 0]);
      await idx.remove('doc-a');
      mockMethods.search.mockImplementation((_vec, limit) => ({
        keys: limit > 1 ? new BigUint64Array([0n, 1n]) : new BigUint64Array([0n]),
        distances: limit > 1 ? new Float32Array([0.01, 0.2]) : new Float32Array([0.01]),
        count: limit > 1 ? 2 : 1,
      }));

      const result = await idx.search([1, 0, 0, 0], 1);

      expect(mockMethods.search.mock.calls[0][1]).toBeGreaterThan(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe('doc-b');
      expect(result.results[0].score).toBeCloseTo(0.8);
      expect(result.total).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // addBatch
  // -------------------------------------------------------------------------

  describe('addBatch', () => {
    it('should add multiple vectors and return array of keys', async () => {
      const items = [
        { id: 'a', vector: [1, 0, 0, 0], metadata: { i: 0 } },
        { id: 'b', vector: [0, 1, 0, 0], metadata: { i: 1 } },
        { id: 'c', vector: [0, 0, 1, 0], metadata: { i: 2 } },
      ];

      const keys = await idx.addBatch(items);

      expect(keys).toEqual([0, 1, 2]);
      expect(idx.getStats().totalVectors).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('should return metadata for an existing id', async () => {
      await idx.add('doc-a', [1, 0, 0, 0], { file: 'a.js' });
      const result = await idx.get('doc-a');

      expect(result).toEqual({ id: 'doc-a', metadata: { file: 'a.js' } });
    });

    it('should return null for a tombstoned id', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'sweet-search-hnsw-get-stale-'));
      try {
        await idx.add('doc-a', [1, 0, 0, 0], { file: 'a.js' });
        idx.stalePath = join(tmpDir, 'codebase-hnsw.idx.stale.bin');
        const bitmap = createBitmap(1);
        setBit(bitmap, 0);
        saveBitmap(idx.stalePath, bitmap);

        expect(await idx.get('doc-a')).toBeNull();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('should return null for a non-existent id', async () => {
      const result = await idx.get('nope');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe('clear', () => {
    it('should reset all internal state', async () => {
      await idx.add('doc-a', [1, 0, 0, 0]);
      await idx.add('doc-b', [0, 1, 0, 0]);
      await idx.remove('doc-a');
      expect(loadBitmap(idx.stalePath)).not.toBeNull();

      await idx.clear();

      expect(idx.idMap.size).toBe(0);
      expect(idx.reverseMap.size).toBe(0);
      expect(idx.metadata.size).toBe(0);
      expect(idx.nextKey).toBe(0);
      expect(idx.getStats().totalVectors).toBe(0);
      expect(loadBitmap(idx.stalePath)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // normalize (indirectly tested but also directly accessible)
  // -------------------------------------------------------------------------

  describe('normalize', () => {
    it('should produce unit-length vector', () => {
      const v = [3, 4, 0, 0]; // length = 5
      const n = idx.normalize(v);

      expect(n[0]).toBeCloseTo(0.6, 5);
      expect(n[1]).toBeCloseTo(0.8, 5);

      const magnitude = Math.sqrt(n.reduce((s, x) => s + x * x, 0));
      expect(magnitude).toBeCloseTo(1.0, 5);
    });

    it('should return zero vector unchanged', () => {
      const v = [0, 0, 0, 0];
      const n = idx.normalize(v);
      expect(n).toEqual([0, 0, 0, 0]);
    });
  });
});
