/**
 * Embedding Cache - LRU cache, vocabulary, semantic cache, query deduplication.
 * Extracted from embedding-service.js for file size compliance (<500 lines).
 *
 * Telemetry functions live in ./embedding-telemetry.js and are barrel-re-exported
 * below so that existing import sites continue to work unchanged.
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { join } from 'path';
import { EMBEDDING_CONFIG, DB_PATHS } from '../infrastructure/config/index.js';
import { fetchModel, getModelCacheDir } from '../infrastructure/model-fetcher.js';
import { createOrtPipeline, buildFeed } from '../infrastructure/ort-pipeline.js';
import { meanPoolWithAttentionMask } from './embedding-local-model.js';

// =============================================================================
// LRU CACHE
// =============================================================================

export class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.hitCount = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    this.hitCount.set(key, (this.hitCount.get(key) || 0) + 1);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.maxSize) {
      const oldestEntry = this.cache.entries().next().value;
      if (oldestEntry) this.cache.delete(oldestEntry[0]);
    }
    this.cache.set(key, value);
  }

  has(key) { return this.cache.has(key); }
  getHitCount(key) { return this.hitCount.get(key) || 0; }
  size() { return this.cache.size; }
  clear() { this.cache.clear(); this.hitCount.clear(); }

  getFrequentQueries(threshold) {
    const frequent = [];
    for (const [key, count] of this.hitCount) {
      if (count >= threshold && this.cache.has(key)) {
        frequent.push({ query: key, count, embedding: this.cache.get(key) });
      }
    }
    return frequent.sort((a, b) => b.count - a.count);
  }
}

// =============================================================================
// QUERY STATS (Cross-session usage tracking)
// =============================================================================

export class QueryStats {
  constructor(statsPath) {
    this.statsPath = statsPath;
    this.stats = new Map();
    this.loaded = false;
    this.dirty = false;
  }

  async load() {
    if (this.loaded) return;
    try {
      if (existsSync(this.statsPath)) {
        const data = JSON.parse(await fs.readFile(this.statsPath, 'utf-8'));
        for (const [query, count] of Object.entries(data.queries || {})) {
          this.stats.set(query, count);
        }
      }
    } catch (err) {
      if (process.env.DEBUG_CATCHES) process.stderr.write(`[non-fatal] ${err?.message || err}\n`);
    }
    this.loaded = true;
  }

  async save() {
    if (!this.dirty) return;
    const data = { queries: Object.fromEntries(this.stats), lastUpdated: new Date().toISOString() };
    await fs.mkdir(path.dirname(this.statsPath), { recursive: true });
    await fs.writeFile(this.statsPath, JSON.stringify(data));
    this.dirty = false;
  }

  increment(query) {
    const normalized = query.toLowerCase().trim();
    const count = (this.stats.get(normalized) || 0) + 1;
    this.stats.set(normalized, count);
    this.dirty = true;
    return count;
  }

  getCount(query) {
    return this.stats.get(query.toLowerCase().trim()) || 0;
  }
}

// =============================================================================
// VOCABULARY
// =============================================================================

export class Vocabulary {
  constructor(vocabPath) {
    this.vocabPath = vocabPath;
    this.terms = new Map();
    this.metadata = { created: null, lastUpdated: null, version: 2, provider: null };
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    try {
      if (existsSync(this.vocabPath)) {
        const data = JSON.parse(await fs.readFile(this.vocabPath, 'utf-8'));
        if (data.metadata?.provider && data.metadata.provider !== EMBEDDING_CONFIG.provider) {
          console.log(`Vocabulary: Provider changed (${data.metadata.provider} → ${EMBEDDING_CONFIG.provider}), clearing cache`);
          this.terms.clear();
        } else {
          this.metadata = data.metadata || this.metadata;
          for (const [term, embedding] of Object.entries(data.terms || {})) {
            this.terms.set(term, embedding);
          }
          console.log(`Vocabulary: Loaded ${this.terms.size} pre-computed embeddings`);
        }
      }
    } catch (err) {
      console.log(`Vocabulary: Starting fresh (${err.message})`);
    }
    this.loaded = true;
  }

  async save() {
    this.metadata.lastUpdated = new Date().toISOString();
    this.metadata.provider = EMBEDDING_CONFIG.provider;
    if (!this.metadata.created) this.metadata.created = this.metadata.lastUpdated;
    const data = { metadata: this.metadata, terms: Object.fromEntries(this.terms) };
    await fs.mkdir(path.dirname(this.vocabPath), { recursive: true });
    await fs.writeFile(this.vocabPath, JSON.stringify(data, null, 2));
  }

  get(term) { return this.terms.get(this.normalize(term)) || null; }
  set(term, embedding) { this.terms.set(this.normalize(term), embedding); }
  has(term) { return this.terms.has(this.normalize(term)); }
  normalize(term) { return term.toLowerCase().trim(); }
  size() { return this.terms.size; }

  async addDefaultTerms(embedFn) {
    const defaultTerms = [
      'AuthService', 'EmployeeService', 'LoginService', 'UserService',
      'ProcessService', 'EventService', 'ScreenshotService', 'SessionService',
      'AuthController', 'EmployeeController', 'LoginController', 'UserController',
      'authentication', 'authorization', 'login', 'logout', 'password',
      'JWT', 'token', 'session', 'employee', 'monitoring', 'tracking',
      'gRPC', 'REST', 'API', 'endpoint', 'request', 'response',
      'bot detection', 'heuristic', 'trajectory', 'mouse movement',
      'Spring Boot', 'React', 'Java', 'JavaScript', 'proto', 'protobuf',
    ];

    let added = 0;
    for (const term of defaultTerms) {
      if (!this.has(term)) {
        const embedding = await embedFn(term);
        this.set(term, embedding);
        added++;
      }
    }
    if (added > 0) {
      await this.save();
      console.log(`Vocabulary: Added ${added} default terms`);
    }
  }
}

// =============================================================================
// SEMANTIC CACHE (Local Model for Cache Keys)
// =============================================================================

export class SemanticCache {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.85;
    this.maxSize = options.maxSize ?? 500;
    this.entries = [];
    this.localModel = null;
    this.loadingModel = false;
    this.loadPromise = null;
    this.stats = { hits: 0, misses: 0, localModelCalls: 0 };
  }

  async getLocalModel() {
    if (this.localModel) return this.localModel;
    if (this.loadingModel && this.loadPromise) return this.loadPromise;

    this.loadingModel = true;
    this.loadPromise = (async () => {
      const start = Date.now();
      console.log('[SemanticCache] Loading local model for cache keys...');
      await fetchModel('all-minilm-l6-v2');
      const cacheDir = getModelCacheDir('Xenova/all-MiniLM-L6-v2');
      this.localModel = await createOrtPipeline(
        join(cacheDir, 'onnx', 'model_quantized.onnx'),
        join(cacheDir, 'tokenizer.json'),
        { graphOptimizationLevel: 'all' },
      );
      console.log(`[SemanticCache] Local model loaded in ${Date.now() - start}ms`);
      this.loadingModel = false;
      return this.localModel;
    })();

    return this.loadPromise;
  }

  async computeLocalEmbedding(text) {
    const { session, tokenizer } = await this.getLocalModel();
    this.stats.localModelCalls++;
    const tokenized = tokenizer(text, { padding: true, truncation: true, max_length: 256 });
    const feed = buildFeed(tokenized, session.inputNames);
    const output = await session.run(feed);
    const tensor = output[session.outputNames[0]];
    // Mean pooling with L2 normalization
    const pooled = meanPoolWithAttentionMask(tensor, tokenized.attention_mask, true);
    return Array.from(pooled.data);
  }

  cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async findSimilar(text) {
    const localEmb = await this.computeLocalEmbedding(text);

    if (this.entries.length === 0) {
      this.stats.misses++;
      return { voyageEmb: null, localEmb };
    }

    let bestMatch = null;
    let bestSimilarity = -1;

    for (const entry of this.entries) {
      const similarity = this.cosineSimilarity(localEmb, entry.localEmb);
      if (similarity > this.threshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      this.stats.hits++;
      return {
        voyageEmb: bestMatch.voyageEmb,
        similarity: bestSimilarity,
        matchedQuery: bestMatch.query,
        localEmb,
      };
    }

    this.stats.misses++;
    return { voyageEmb: null, localEmb };
  }

  add(text, localEmb, voyageEmb) {
    if (this.entries.length >= this.maxSize) {
      this.entries.shift();
    }
    this.entries.push({
      query: text,
      localEmb,
      voyageEmb,
      addedAt: Date.now(),
    });
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total * 100).toFixed(1) : 0;
    return {
      ...this.stats,
      size: this.entries.length,
      hitRate: `${hitRate}%`,
      threshold: this.threshold,
    };
  }
}

// =============================================================================
// QUERY DEDUPLICATION
// =============================================================================

export class QueryDeduplicator {
  constructor() {
    this.inflight = new Map();
  }

  get(text) {
    return this.inflight.get(text) || null;
  }

  set(text, promise) {
    this.inflight.set(text, promise);
    promise.finally(() => this.inflight.delete(text));
  }

  has(text) {
    return this.inflight.has(text);
  }
}

// =============================================================================
// SINGLETONS
// =============================================================================

export const queryCache = new LRUCache(EMBEDDING_CONFIG.cache?.maxSize || 1000);
export const vocabulary = new Vocabulary(DB_PATHS.vocabulary);
export const semanticCache = new SemanticCache({ threshold: 0.85, maxSize: 500 });
export const queryDeduplicator = new QueryDeduplicator();
export const queryStats = new QueryStats(DB_PATHS.vocabulary.replace('.json', '-stats.json'));
/** Mutable cache counters — access via getCacheStatsRef() to make singleton dependency explicit. */
const _cacheStats = { hits: 0, misses: 0, vocabularyHits: 0, apiCalls: 0 };

/**
 * Returns a reference to the mutable stats object.
 * Prefer this getter over a bare export so that the singleton
 * dependency is explicit and mockable in tests.
 */
export function getCacheStatsRef() {
  return _cacheStats;
}

/** @deprecated Use getCacheStatsRef(). Kept for backward compatibility during migration. */
export const cacheStats = _cacheStats;
// Integration point: search modes (lexical/semantic/hybrid) should call
// recordQueryTelemetry(mode, hit, latencyMs) after each query to feed
// per-mode cache-hit telemetry for the vocabulary prewarm pipeline.

// =============================================================================
// TELEMETRY (barrel re-exports from ./embedding-telemetry.js)
// =============================================================================

export { telemetryStats, recordQueryTelemetry, getTelemetryReport, resetTelemetryStats, flushTelemetry } from './embedding-telemetry.js';

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================

export function getCacheStats(circuitBreakerState) {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? ((cacheStats.hits + cacheStats.vocabularyHits) / total * 100).toFixed(1) : 0;
  return {
    ...cacheStats,
    total,
    hitRate: `${hitRate}%`,
    cacheSize: queryCache.size(),
    vocabularySize: vocabulary.size(),
    semanticCache: semanticCache.getStats(),
    circuitBreaker: circuitBreakerState || null,
    provider: EMBEDDING_CONFIG.provider,
    model: EMBEDDING_CONFIG.model,
  };
}

export function getSemanticCacheStats() {
  return semanticCache.getStats();
}

export function clearCache() {
  queryCache.clear();
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  cacheStats.vocabularyHits = 0;
  cacheStats.apiCalls = 0;
}

export function getFrequentQueries(threshold = 3) {
  return queryCache.getFrequentQueries(threshold);
}

/**
 * @param {string} term
 * @param {Function} embedFn - Injected embed function (avoids circular dep with facade)
 */
export async function addToVocabulary(term, embedFn) {
  await vocabulary.load();
  if (!vocabulary.has(term)) {
    const embedding = await embedFn(term);
    vocabulary.set(term, embedding);
    await vocabulary.save();
    return true;
  }
  return false;
}

/**
 * @param {string[]} terms
 * @param {Function} embedFn - Injected embed function (avoids circular dep with facade)
 */
export async function expandVocabulary(terms, embedFn) {
  await vocabulary.load();
  let added = 0;
  for (const term of terms) {
    if (!vocabulary.has(term)) {
      const embedding = await embedFn(term);
      vocabulary.set(term, embedding);
      added++;
    }
  }
  if (added > 0) await vocabulary.save();
  return added;
}

export async function autoPersistFrequentQueries(threshold = 2) {
  const frequent = queryCache.getFrequentQueries(threshold);
  if (frequent.length === 0) return { persisted: 0, total: 0 };

  await vocabulary.load();
  let persisted = 0;

  for (const { query, embedding } of frequent) {
    if (!vocabulary.has(query)) {
      vocabulary.set(query, embedding);
      persisted++;
    }
  }

  if (persisted > 0) {
    await vocabulary.save();
    console.log(`Auto-persist: Saved ${persisted} frequent queries to vocabulary`);
  }

  return { persisted, total: frequent.length };
}

let exitHandlerRegistered = false;
export function registerAutoPersistOnExit(threshold = 2) {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;

  const persist = async () => {
    try {
      await autoPersistFrequentQueries(threshold);
    } catch (err) {
      // Ignore errors on exit
    }
  };

  process.on('beforeExit', persist);
  process.on('SIGINT', async () => { await persist(); process.exit(0); });
  process.on('SIGTERM', async () => { await persist(); process.exit(0); });
}
