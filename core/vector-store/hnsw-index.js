#!/usr/bin/env node

/**
 * HNSW Index Wrapper using USearch
 *
 * In-memory Hierarchical Navigable Small World graph for fast ANN search.
 * Replaces O(N) vector scan with O(log N) approximate nearest neighbor search.
 *
 * Target: <1ms p50 ANN lookup (often 50-500μs)
 *
 * Uses usearch for the HNSW implementation (replaces hnswlib-node which had segfaults).
 * USearch is actively maintained, 10x faster with SIMD acceleration, and stable.
 */

import fs from 'fs/promises';
import { existsSync, statSync } from 'fs';
import path from 'path';
import { HNSW_CONFIG, DB_PATHS, EMBEDDING_CONFIG } from '../infrastructure/config/index.js';
import {
  createBitmap,
  loadBitmap,
  resizeBitmap,
  saveBitmap,
  setBit,
  isSet,
} from '../infrastructure/tombstone-bitmap-reader.js';

// =============================================================================
// HNSW INDEX CLASS (USearch Implementation)
// =============================================================================

const HNSW_MAX_ELEMENTS_HARD_CEILING = 100_000_000;

export class HNSWIndex {
  constructor(options = {}) {
    this.dimension = options.dimension || EMBEDDING_CONFIG.hnswDimension;
    this.maxElements = options.maxElements || HNSW_CONFIG.maxElements;
    this.M = options.M || HNSW_CONFIG.M;
    this.efConstruction = options.efConstruction || HNSW_CONFIG.efConstruction;
    this.efSearch = options.efSearch || HNSW_CONFIG.efSearch;
    this.metric = options.metric || HNSW_CONFIG.metric;
    this.indexPath = options.indexPath || DB_PATHS.hnswIndex;
    this.stalePath = options.stalePath || `${this.indexPath}.stale.bin`;

    this.index = null;
    this.idMap = new Map();      // string id -> numeric key
    this.reverseMap = new Map(); // numeric key -> string id
    this.metadata = new Map();   // string id -> metadata
    this.nextKey = 0;

    // Use pure JS fallback if usearch not available
    this.useFallback = false;
    this.vectors = [];           // Fallback: store all vectors
    this.usearchModule = null;
    this._staleBitmapCache = null;
  }

  /**
   * Initialize the HNSW index using USearch
   */
  async init() {
    if (this.index !== null) return;

    try {
      // Try to use usearch (native, fast, SIMD-accelerated)
      this.usearchModule = await import('usearch');
      const Index = this.usearchModule.Index || this.usearchModule.default?.Index;

      if (!Index) {
        throw new Error('Index class not found in usearch module');
      }

      // Map metric to usearch metric
      const metricMap = {
        cosine: 'cos',
        euclidean: 'l2sq',
        ip: 'ip',
      };
      const usearchMetric = metricMap[this.metric] || 'cos';

      // Create USearch index with configuration
      this.index = new Index({
        metric: usearchMetric,
        connectivity: this.M,
        dimensions: this.dimension,
        quantization: 'f32',
      });
      this._reserveNativeCapacity(this.maxElements);
      this.useFallback = false;

      console.log(`HNSW: Using USearch (${usearchMetric}, dim=${this.dimension}, M=${this.M})`);
    } catch (err) {
      // Fallback to pure JS implementation
      console.log(`HNSW: Using pure JS fallback (${err.message})`);
      this.useFallback = true;
      this.vectors = [];
    }
  }

  /**
   * Add a vector to the index
   */
  async add(id, vector, metadata = {}) {
    await this.init();

    // Truncate vector to HNSW dimension if needed
    const truncated = vector.length > this.dimension
      ? vector.slice(0, this.dimension)
      : vector;

    // Normalize for cosine similarity
    const normalized = this.normalize(truncated);

    // Convert to Float32Array for usearch
    const vecArray = new Float32Array(normalized);

    if (this.idMap.has(id)) {
      // Update existing - usearch doesn't support direct update, so we track metadata only
      const key = this.idMap.get(id);
      this.metadata.set(id, metadata);

      if (this.useFallback) {
        this.vectors[key] = { id, vector: normalized, metadata };
      }
      return key;
    }

    // Add new. Commit maps only after native add succeeds; otherwise a
    // transient native failure would leave a row visible without a graph node.
    const key = this.nextKey;

    if (!this.useFallback && this.index) {
      this._addNativeVector(key, vecArray);
    } else {
      this.vectors[key] = { id, vector: normalized, metadata };
    }

    this.nextKey++;
    this.idMap.set(id, key);
    this.reverseMap.set(key, id);
    this.metadata.set(id, metadata);

    return key;
  }

  _addNativeVector(key, vecArray) {
    try {
      this.index.add(BigInt(key), vecArray);
      return;
    } catch (err) {
      if (!isNativeCapacityError(err)) {
        throw err;
      }
    }

    const nextCapacity = this._nextNativeCapacity();
    if (!this._reserveNativeCapacity(nextCapacity)) {
      throw new Error(
        `HNSW capacity exhausted at ${this.maxElements} elements and native reserve() is unavailable`
      );
    }
    this.index.add(BigInt(key), vecArray);
  }

  _nextNativeCapacity() {
    const current = Math.max(1, this.maxElements, this.nextKey + 1);
    return Math.min(
      HNSW_MAX_ELEMENTS_HARD_CEILING,
      Math.max(current + 1, Math.ceil(current * 1.25), this.nextKey + 1)
    );
  }

  _reserveNativeCapacity(capacity) {
    if (!this.index || typeof this.index.reserve !== 'function') return false;
    const nextCapacity = Math.min(HNSW_MAX_ELEMENTS_HARD_CEILING, Math.ceil(capacity));
    if (!Number.isFinite(nextCapacity) || nextCapacity <= 0) return false;
    this.index.reserve(nextCapacity);
    this.maxElements = Math.max(this.maxElements, nextCapacity);
    return true;
  }

  /**
   * Batch add vectors
   */
  async addBatch(items) {
    await this.init();

    const results = [];
    for (const { id, vector, metadata } of items) {
      const key = await this.add(id, vector, metadata || {});
      results.push(key);
    }
    return results;
  }

  /**
   * Search for k nearest neighbors
   */
  _loadStaleBitmap() {
    let stat;
    try {
      stat = statSync(this.stalePath, { bigint: true });
    } catch {
      this._staleBitmapCache = null;
      return null;
    }
    const statKey = `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;

    if (
      this._staleBitmapCache
      && this._staleBitmapCache.statKey === statKey
    ) {
      return this._staleBitmapCache.bitmap;
    }

    try {
      const bitmap = loadBitmap(this.stalePath);
      this._staleBitmapCache = { statKey, bitmap };
      return bitmap;
    } catch (err) {
      if (process.env.SWEET_DEBUG) {
        console.debug(`[HNSW] ignoring unreadable stale bitmap ${this.stalePath}: ${err.message}`);
      }
      this._staleBitmapCache = { statKey, bitmap: null };
      return null;
    }
  }

  _isKeyStale(key, bitmap) {
    return bitmap ? isSet(bitmap, key) : false;
  }

  _markKeyStale(key) {
    const capacity = Math.max(key + 1, this.nextKey, 1);
    let bitmap = null;
    try {
      bitmap = loadBitmap(this.stalePath);
    } catch (err) {
      if (process.env.SWEET_DEBUG) {
        console.debug(`[HNSW] replacing unreadable stale bitmap ${this.stalePath}: ${err.message}`);
      }
    }
    bitmap = bitmap ? resizeBitmap(bitmap, capacity) : createBitmap(capacity);
    setBit(bitmap, key);
    saveBitmap(this.stalePath, bitmap);
    this._staleBitmapCache = null;
  }

  async clearStaleBitmap() {
    await fs.rm(this.stalePath, { force: true });
    this._staleBitmapCache = null;
  }

  _oversampleTarget(k, bitmap) {
    const searchable = this._searchableKeyCount();
    const live = this._liveCount(bitmap);
    const tombstoned = Math.max(0, searchable - live);
    if (tombstoned === 0) return k;
    const s = Math.max(0, Math.min(tombstoned / Math.max(1, searchable), 0.5));
    return Math.min(Math.max(k + 64, Math.ceil(k / Math.max(0.05, 1 - s) * 2)), k * 20);
  }

  _searchableKeyCount() {
    if (this.useFallback) return this.vectors.length;
    return Math.max(this.nextKey, this.idMap.size);
  }

  _liveCount(bitmap) {
    if (!bitmap) return this.idMap.size;
    let live = 0;
    for (const key of this.reverseMap.keys()) {
      if (!this._isKeyStale(key, bitmap)) live++;
    }
    return live;
  }

  async search(queryVector, k = 10) {
    await this.init();

    const start = performance.now();
    const staleBitmap = this._loadStaleBitmap();

    // Truncate and normalize query
    const truncated = queryVector.length > this.dimension
      ? queryVector.slice(0, this.dimension)
      : queryVector;
    const normalized = this.normalize(truncated);

    let results;

    if (!this.useFallback && this.index) {
      // Use native USearch
      const vecArray = new Float32Array(normalized);
      const candidateK = this._oversampleTarget(k, staleBitmap);
      const actualK = Math.min(candidateK, this._searchableKeyCount());

      if (actualK === 0) {
        results = [];
      } else {
        const collect = (limit) => {
          const searchResult = this.index.search(vecArray, limit);
          const collected = [];
          // USearch returns { keys: BigUint64Array, distances: Float32Array, count: number }
          const count = searchResult.count || searchResult.keys?.length || 0;

          for (let i = 0; i < count; i++) {
            const key = Number(searchResult.keys[i]);
            if (this._isKeyStale(key, staleBitmap)) continue;
            const id = this.reverseMap.get(key);
            if (id) {
              // Convert distance to similarity (cosine distance to similarity)
              const distance = searchResult.distances[i];
              const score = this.metric === 'cosine' ? 1 - distance : -distance;

              collected.push({
                id,
                score,
                metadata: this.metadata.get(id) || {},
              });
              if (collected.length >= k) break;
            }
          }
          return collected;
        };

        results = collect(actualK);
        const retryK = Math.min(actualK * 2, this._searchableKeyCount());
        if (results.length < k && retryK > actualK) {
          results = collect(retryK);
        }
      }
    } else {
      // Pure JS fallback: O(N) scan
      results = this.vectors
        .map((v, key) => ({ v, key }))
        .filter(({ v, key }) => v !== null && !this._isKeyStale(key, staleBitmap))
        .map(({ v }) => ({
          id: v.id,
          score: this.cosineSimilarity(normalized, v.vector),
          metadata: v.metadata || {},
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }

    const latency = performance.now() - start;

    return {
      results,
      latency_us: Math.round(latency * 1000), // microseconds
      latency_ms: latency.toFixed(3),
      k,
      total: this._liveCount(staleBitmap),
      usedFallback: this.useFallback,
    };
  }

  /**
   * Get vector by ID
   */
  async get(id) {
    if (!this.idMap.has(id)) return null;
    const key = this.idMap.get(id);
    if (this._isKeyStale(key, this._loadStaleBitmap())) return null;

    if (this.useFallback) {
      return this.vectors[key];
    }

    return {
      id,
      metadata: this.metadata.get(id),
    };
  }

  /**
   * Remove vector by ID (soft delete)
   */
  async remove(id) {
    if (!this.idMap.has(id)) return false;

    const key = this.idMap.get(id);
    this._markKeyStale(key);

    if (this.useFallback) {
      this.vectors[key] = null;
    }

    this.idMap.delete(id);
    this.reverseMap.delete(key);
    this.metadata.delete(id);

    return true;
  }

  /**
   * Save index to disk.
   *
   * Publish semantics: each sidecar is written to a sibling
   * `<path>.tmp.<pid>` and then `renameSync`'d into its canonical name.
   * On POSIX, atomic rename keeps existing mmaps valid against the
   * unlinked old inode — without this, a cross-process reader that
   * holds a `usearch.view()` mmap over the canonical .usearch file
   * would SIGBUS / SIGSEGV the moment the next reconcile tick or
   * maintenance pass truncates+writes the file in place.
   *
   * Publish ORDER: data first (.usearch / .vectors.json), then
   * .meta.json LAST. A fresh reader that successfully reads the new
   * meta.json is guaranteed to read the matching data sidecar
   * alongside it. The brief residual window — `(OLD meta, NEW
   * .usearch)` — yields MISSING results (keys beyond the new index
   * size are absent) instead of GARBAGE results.
   */
  async save(indexPath = this.indexPath) {
    await fs.mkdir(path.dirname(indexPath), { recursive: true });

    // Save index state
    const state = {
      dimension: this.dimension,
      maxElements: this.maxElements,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      metric: this.metric,
      nextKey: this.nextKey,
      idMap: Array.from(this.idMap.entries()),
      metadata: Array.from(this.metadata.entries()),
      useFallback: this.useFallback,
    };

    const metaPath = indexPath.replace('.idx', '.meta.json');
    const metaTmpPath = `${metaPath}.tmp.${process.pid}`;
    await fs.writeFile(metaTmpPath, JSON.stringify(state, null, 2));

    if (!this.useFallback && this.index) {
      const usearchPath = indexPath.replace('.idx', '.usearch');
      const usearchTmpPath = `${usearchPath}.tmp.${process.pid}`;
      this.index.save(usearchTmpPath);
      // Atomic rename: data first, descriptor last.
      await fs.rename(usearchTmpPath, usearchPath);
      await fs.rename(metaTmpPath, metaPath);
      console.log(`HNSW: Saved ${this.nextKey} vectors to ${usearchPath} (USearch)`);
    } else {
      const vectorsPath = indexPath.replace('.idx', '.vectors.json');
      const vectorsTmpPath = `${vectorsPath}.tmp.${process.pid}`;
      await fs.writeFile(vectorsTmpPath, JSON.stringify(this.vectors));
      await fs.rename(vectorsTmpPath, vectorsPath);
      await fs.rename(metaTmpPath, metaPath);
      console.log(`HNSW: Saved ${this.vectors.length} vectors to ${vectorsPath} (fallback)`);
    }
  }

  /**
   * Load index from disk.
   * @param {string} indexPath - Path to index files (defaults to this.indexPath)
   * @param {Object} options - Load options
   * @param {boolean} options.mmap - Use memory-mapped view() for zero-copy search (read-only, no add/remove)
   */
  async load(indexPath = this.indexPath, options = {}) {
    const { mmap = false } = options;
    const metaPath = indexPath.replace('.idx', '.meta.json');

    if (!existsSync(metaPath)) {
      throw new Error(`Index metadata not found: ${metaPath}`);
    }

    // Load metadata
    const state = JSON.parse(await fs.readFile(metaPath, 'utf-8'));

    this.dimension = state.dimension;
    this.maxElements = state.maxElements;
    this.M = state.M;
    this.efConstruction = state.efConstruction;
    this.efSearch = state.efSearch;
    this.metric = state.metric;
    this.nextKey = state.nextKey;
    this.idMap = new Map(state.idMap);
    this.metadata = new Map(state.metadata);

    // Rebuild reverse map
    this.reverseMap = new Map();
    for (const [id, key] of this.idMap) {
      this.reverseMap.set(key, id);
    }

    // Try to load USearch index
    const usearchPath = indexPath.replace('.idx', '.usearch');
    if (!state.useFallback && existsSync(usearchPath)) {
      try {
        this.usearchModule = await import('usearch');
        const Index = this.usearchModule.Index || this.usearchModule.default?.Index;

        const metricMap = { cosine: 'cos', euclidean: 'l2sq', ip: 'ip' };
        const usearchMetric = metricMap[this.metric] || 'cos';

        this.index = new Index({
          metric: usearchMetric,
          connectivity: this.M,
          dimensions: this.dimension,
          quantization: 'f32',
        });

        // Load from file: view() = mmap zero-copy (search only), load() = full copy
        if (mmap) {
          this.index.view(usearchPath);
        } else {
          this.index.load(usearchPath);
        }
        this.useFallback = false;

        console.log(`HNSW: ${mmap ? 'Mapped' : 'Loaded'} ${this.nextKey} vectors from ${usearchPath} (USearch${mmap ? ', mmap' : ''})`);
      } catch (err) {
        console.log(`HNSW: Failed to load USearch index, using fallback: ${err.message}`);
        this.useFallback = true;
      }
    }

    // Fallback: try legacy hnswlib-node index or vectors.json
    if (this.useFallback || !this.index) {
      const vectorsPath = indexPath.replace('.idx', '.vectors.json');
      if (existsSync(vectorsPath)) {
        this.vectors = JSON.parse(await fs.readFile(vectorsPath, 'utf-8'));
        this.useFallback = true;
        console.log(`HNSW: Loaded ${this.vectors.length} vectors from ${vectorsPath} (fallback)`);
      } else if (!state.useFallback && (state.idMap?.length || state.nextKey || 0) > 0) {
        throw new Error(
          `HNSW native artifact is missing or unreadable for ${indexPath}; refusing to serve stale metadata without vectors`
        );
      } else {
        // Initialize empty fallback
        this.useFallback = true;
        this.vectors = [];
        console.log('HNSW: No saved vectors found, starting fresh');
      }
    }
  }

  /**
   * Get index statistics
   */
  getStats() {
    return {
      dimension: this.dimension,
      totalVectors: this.idMap.size,  // Accurate live count (not nextKey which never decrements)
      maxElements: this.maxElements,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      metric: this.metric,
      useFallback: this.useFallback,
      engine: this.useFallback ? 'js-fallback' : 'usearch',
      nextKey: this.nextKey,  // Expose for debugging (total keys ever assigned)
    };
  }

  /**
   * Normalize vector to unit length
   */
  normalize(vector) {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    if (norm === 0) return vector;

    const normalized = new Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
      normalized[i] = vector[i] / norm;
    }
    return normalized;
  }

  /**
   * Cosine similarity between two vectors
   */
  cosineSimilarity(a, b) {
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }
    return dotProduct; // Already normalized
  }

  /**
   * Clear all data
   */
  async clear() {
    this.idMap.clear();
    this.reverseMap.clear();
    this.metadata.clear();
    this.nextKey = 0;
    this.vectors = [];
    await this.clearStaleBitmap();
    this.index = null;
    await this.init();
  }
}

function isNativeCapacityError(err) {
  const message = String(err?.message || err).toLowerCase();
  return /\b(capacity|reserve|max\s*elements?|max_elements|full|allocation|out of memory|oom)\b/.test(message);
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create or load an HNSW index
 */
export async function createHNSWIndex(options = {}) {
  const index = new HNSWIndex(options);

  if (options.load && hnswArtifactsExist(options.indexPath || DB_PATHS.hnswIndex)) {
    await index.load(options.indexPath);
  } else {
    await index.init();
  }

  return index;
}

function hnswArtifactsExist(indexPath) {
  const metaPath = indexPath.replace('.idx', '.meta.json');
  return existsSync(metaPath);
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  console.log(`
HNSW Index CLI (USearch backend)

Usage:
  hnsw-index.js stats           Show index statistics
  hnsw-index.js test            Run performance test
  hnsw-index.js search <query>  Search with query text (requires embedding model)

Options:
  --index <path>   Path to index file (default: .sweet-search/codebase-hnsw.idx)
`);

  const command = args[0];

  (async () => {
    const index = new HNSWIndex();

    try {
      if (command === 'stats') {
        await index.load();
        console.log('\nIndex Statistics:');
        console.log(JSON.stringify(index.getStats(), null, 2));
      } else if (command === 'test') {
        // Performance test
        console.log('\nRunning HNSW performance test (USearch)...\n');

        await index.init();

        const dim = 256;
        const numVectors = 10000;
        const numQueries = 100;

        // Generate random vectors
        console.log(`Generating ${numVectors} random ${dim}-dim vectors...`);
        const vectors = [];
        for (let i = 0; i < numVectors; i++) {
          const vec = new Array(dim).fill(0).map(() => Math.random());
          vectors.push(vec);
        }

        // Add vectors
        console.log('Adding vectors to index...');
        const addStart = performance.now();
        for (let i = 0; i < numVectors; i++) {
          await index.add(`vec-${i}`, vectors[i], { index: i });
        }
        const addTime = performance.now() - addStart;
        console.log(`Added ${numVectors} vectors in ${addTime.toFixed(2)}ms (${(numVectors / addTime * 1000).toFixed(0)} vec/s)`);

        // Search
        console.log(`\nRunning ${numQueries} searches...`);
        const latencies = [];
        for (let i = 0; i < numQueries; i++) {
          const queryVec = new Array(dim).fill(0).map(() => Math.random());
          const result = await index.search(queryVec, 10);
          latencies.push(result.latency_us);
        }

        // Stats
        latencies.sort((a, b) => a - b);
        const p50 = latencies[Math.floor(numQueries * 0.5)];
        const p95 = latencies[Math.floor(numQueries * 0.95)];
        const p99 = latencies[Math.floor(numQueries * 0.99)];
        const avg = latencies.reduce((a, b) => a + b, 0) / numQueries;

        console.log(`\nSearch Latency (μs):`);
        console.log(`  p50: ${p50.toFixed(0)}μs`);
        console.log(`  p95: ${p95.toFixed(0)}μs`);
        console.log(`  p99: ${p99.toFixed(0)}μs`);
        console.log(`  avg: ${avg.toFixed(0)}μs`);
        console.log(`\nEngine: ${index.useFallback ? 'JS fallback' : 'USearch'}`);
      } else {
        console.log('Unknown command. Use: stats, test, or search');
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}

/**
 * Check if native ANN backend (usearch) is available.
 * @returns {Promise<{ available: boolean, engine: string, error?: string }>}
 */
export async function checkNativeBackend() {
  try {
    const mod = await import('usearch');
    const Index = mod.Index || mod.default?.Index;
    if (!Index) {
      return { available: false, engine: 'js-fallback', error: 'Index class not found in usearch module' };
    }
    return { available: true, engine: 'usearch' };
  } catch (err) {
    return { available: false, engine: 'js-fallback', error: err.message };
  }
}

/**
 * Require native ANN backend. Throws if usearch is not available.
 * Use this in benchmark runs to prevent accidentally benchmarking the slow JS fallback.
 * @throws {Error} If usearch is not available
 */
export async function requireNativeAnn() {
  const result = await checkNativeBackend();
  if (!result.available) {
    throw new Error(
      `Native ANN backend (usearch) is required but not available: ${result.error}. ` +
      'Install usearch or remove --require-native-ann flag.'
    );
  }
  return result;
}

export default HNSWIndex;
