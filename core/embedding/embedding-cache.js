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
  delete(key) { this.hitCount.delete(key); return this.cache.delete(key); }
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
// ATOMIC JSON WRITER — serialised tmp-file-and-rename
// =============================================================================
//
// Both Vocabulary.save() and QueryStats.save() are fired as background
// promises from the embedding hot path (`vocabulary.save().catch(()=>{})`
// inside getEmbedding). Under concurrent benchmarks (12+ in-flight queries)
// multiple save() calls overlap on the same file. The previous direct
// `fs.writeFile` was non-atomic — interleaving writes produced invalid JSON,
// which then poisoned every subsequent `.load()` call and silently degraded
// retrieval quality to near-zero.
//
// `writeJsonAtomic` writes to a unique temp file then atomically renames it
// into place. `serialiseAtomicWrite` chains an instance's writes so at most
// one is in flight at a time — and at most one extra coalesced write is
// queued behind the in-flight one. Bursts of N saves collapse into 2 writes,
// each producing a fully-formed file.

async function writeJsonAtomic(targetPath, json) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fs.writeFile(tmpPath, json);
    await fs.rename(tmpPath, targetPath);
  } catch (err) {
    try { await fs.unlink(tmpPath); } catch { /* may not exist */ }
    throw err;
  }
}

/**
 * Serialise calls to `produce()` for a given owner. At most one write is
 * in flight; bursts coalesce so callers arriving during an in-flight save
 * all share a single follow-up save, but no further waste accumulates.
 *
 * @param {object} owner - instance with mutable `_atomicInFlight` / `_atomicPending` slots
 * @param {() => Promise<void>} produce - async writer that captures the
 *   current state at call time and writes it atomically
 * @returns {Promise<void>}
 */
function serialiseAtomicWrite(owner, produce) {
  if (owner._atomicPending) return owner._atomicPending;

  const previous = owner._atomicInFlight || Promise.resolve();
  owner._atomicPending = previous
    .catch(() => { /* a previous save's failure must not block the next one */ })
    .then(() => {
      // Move from "pending" to "in-flight" before doing the actual write,
      // so additional save() callers arriving during the write start a new
      // pending entry rather than piggy-backing on this one (otherwise they
      // would not see their latest state on disk).
      owner._atomicPending = null;
      const inFlight = produce();
      owner._atomicInFlight = inFlight.finally(() => {
        if (owner._atomicInFlight === inFlight) owner._atomicInFlight = null;
      });
      return owner._atomicInFlight;
    });
  return owner._atomicPending;
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
    return serialiseAtomicWrite(this, async () => {
      // Re-check dirty inside the queued task: if a coalesced earlier write
      // already persisted everything, there is nothing left to do.
      if (!this.dirty) return;
      const data = { queries: Object.fromEntries(this.stats), lastUpdated: new Date().toISOString() };
      this.dirty = false;
      try {
        await writeJsonAtomic(this.statsPath, JSON.stringify(data));
      } catch (err) {
        // Re-mark dirty so a future save retries this state
        this.dirty = true;
        throw err;
      }
    });
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

// Schema version for the persisted vocabulary file. Bump when the on-disk
// shape changes in a way that should invalidate previously-saved files.
//   v2: { metadata: { created, lastUpdated, version, provider }, terms: {...} }
//   v3: { metadata: { ..., model, dimension, schemaVersion: 3 }, terms: {...} }
//        — adds full embedding fingerprint so a cache produced under one
//        model is not silently served when a different model is active.
const VOCAB_SCHEMA_VERSION = 3;

/**
 * Coerce an input value into a Float32Array suitable for downstream embedding
 * math (truncateForHNSW, late-interaction MaxSim, cosine similarity).
 *
 * Why this exists: persisted vocabularies are JSON-serialised. JSON.stringify
 * on a Float32Array produces an indexed object `{"0": v0, "1": v1, ...}`,
 * not an array. After `JSON.parse`, the value has `.length === undefined`,
 * `.slice === undefined`, and crashes any downstream consumer that calls
 * vector methods. This helper repairs the value at the cache boundary so
 * the rest of the embedding pipeline can rely on a uniform vector contract.
 *
 * Accepted inputs:
 *   - Float32Array → returned as-is
 *   - Array<number> → wrapped in Float32Array
 *   - Float64Array / Int*Array etc. → copied into Float32Array
 *   - Plain object with stringly-keyed numeric indices ("0","1",...,"N-1")
 *     → reconstructed as Float32Array of length N
 *
 * Returns null when the input cannot be sensibly interpreted as a vector
 * (callers should drop the cache entry and re-derive).
 *
 * @param {*} value
 * @returns {Float32Array|null}
 */
export function coerceToFloat32Vector(value) {
  if (value == null) return null;
  if (value instanceof Float32Array) return value;
  if (Array.isArray(value)) return Float32Array.from(value);
  // Other typed arrays: copy values into a Float32Array.
  if (ArrayBuffer.isView(value) && typeof value.length === 'number') {
    return Float32Array.from(value);
  }
  // Plain object form from JSON-deserialised Float32Array.
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return null;
    // All keys must be string-encoded non-negative integers and contiguous
    // from 0 to length-1. (We do not try to "fill gaps" — that would silently
    // mask a real bug.)
    const indices = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      // Reject anything that isn't an integer-shaped key.
      if (!/^\d+$/.test(k)) return null;
      const n = +k;
      if (!Number.isInteger(n) || n < 0 || n >= keys.length) return null;
      indices[n] = value[k];
    }
    for (let i = 0; i < indices.length; i++) {
      if (typeof indices[i] !== 'number' || !Number.isFinite(indices[i])) return null;
    }
    return Float32Array.from(indices);
  }
  return null;
}

/** Build the embedding-fingerprint we expect a vocabulary file to match. */
function currentVocabFingerprint() {
  return {
    schemaVersion: VOCAB_SCHEMA_VERSION,
    provider: EMBEDDING_CONFIG.provider,
    model: EMBEDDING_CONFIG.model,
    dimension: EMBEDDING_CONFIG.dimension,
  };
}

/**
 * Decide whether a persisted vocabulary file's metadata is compatible
 * with the active embedding configuration. Returns `{ compatible: bool,
 * reason?: string }`. Stale `provider` / `model` / `dimension` /
 * schema-version mismatches are explicitly rejected; a missing file is
 * treated as a fresh start (compatible by definition).
 */
export function isVocabFingerprintCompatible(metadata, fingerprint = currentVocabFingerprint()) {
  if (!metadata || typeof metadata !== 'object') {
    return { compatible: false, reason: 'missing-metadata' };
  }
  // Pre-v3 files persist `version` (not `schemaVersion`) and never recorded
  // `model` / `dimension`. Treat those as incompatible — we cannot prove the
  // cached embeddings came from the active model.
  const persistedSchema = metadata.schemaVersion ?? metadata.version;
  if (persistedSchema !== fingerprint.schemaVersion) {
    return { compatible: false, reason: `schema-version (file=${persistedSchema} expected=${fingerprint.schemaVersion})` };
  }
  if (metadata.provider && metadata.provider !== fingerprint.provider) {
    return { compatible: false, reason: `provider (file=${metadata.provider} expected=${fingerprint.provider})` };
  }
  if (metadata.model && metadata.model !== fingerprint.model) {
    return { compatible: false, reason: `model (file=${metadata.model} expected=${fingerprint.model})` };
  }
  if (Number.isFinite(metadata.dimension)
      && Number.isFinite(fingerprint.dimension)
      && metadata.dimension !== fingerprint.dimension) {
    return { compatible: false, reason: `dimension (file=${metadata.dimension} expected=${fingerprint.dimension})` };
  }
  return { compatible: true };
}

export class Vocabulary {
  constructor(vocabPath) {
    this.vocabPath = vocabPath;
    this.terms = new Map();
    this.metadata = {
      created: null,
      lastUpdated: null,
      schemaVersion: VOCAB_SCHEMA_VERSION,
      provider: null,
      model: null,
      dimension: null,
    };
    this.loaded = false;
  }

  /**
   * Whether `getEmbedding` should consult this vocabulary at all.
   * Reads from `EMBEDDING_CONFIG.cache.useVocabulary` at call time so
   * tests / benchmarks that toggle the env var see the change without
   * having to re-import the module.
   */
  static isEnabled() {
    return EMBEDDING_CONFIG.cache?.useVocabulary !== false;
  }

  async load() {
    if (this.loaded) return;
    try {
      if (existsSync(this.vocabPath)) {
        const data = JSON.parse(await fs.readFile(this.vocabPath, 'utf-8'));
        const compat = isVocabFingerprintCompatible(data.metadata);
        if (!compat.compatible) {
          console.log(`Vocabulary: Ignoring incompatible cache (${compat.reason})`);
          this.terms.clear();
        } else {
          this.metadata = { ...this.metadata, ...(data.metadata || {}) };
          let normalized = 0;
          let dropped = 0;
          for (const [term, raw] of Object.entries(data.terms || {})) {
            // Coerce to Float32Array. Persisted vocabs JSON-serialise typed
            // arrays as indexed objects (`{"0": v0, ...}`), which otherwise
            // crash downstream `embedding.slice(...)` calls (see
            // `truncateForHNSW`). Reject any entry we cannot interpret as a
            // vector — better to re-embed than to surface a corrupt vector.
            const vec = coerceToFloat32Vector(raw);
            if (vec) {
              this.terms.set(term, vec);
              normalized++;
            } else {
              dropped++;
            }
          }
          if (dropped > 0) {
            console.log(`Vocabulary: Loaded ${normalized} pre-computed embeddings (dropped ${dropped} unrecognised)`);
          } else {
            console.log(`Vocabulary: Loaded ${normalized} pre-computed embeddings`);
          }
        }
      }
    } catch (err) {
      console.log(`Vocabulary: Starting fresh (${err.message})`);
    }
    this.loaded = true;
  }

  async save() {
    return serialiseAtomicWrite(this, async () => {
      // Snapshot mutable state INSIDE the queued task so the file written
      // here matches the latest set/has state at write time, not whatever
      // it was when this save() was first scheduled.
      this.metadata.lastUpdated = new Date().toISOString();
      this.metadata.schemaVersion = VOCAB_SCHEMA_VERSION;
      this.metadata.provider = EMBEDDING_CONFIG.provider;
      this.metadata.model = EMBEDDING_CONFIG.model;
      this.metadata.dimension = EMBEDDING_CONFIG.dimension;
      if (!this.metadata.created) this.metadata.created = this.metadata.lastUpdated;
      // Normalise to plain arrays so JSON.stringify produces a compact,
      // round-trippable form. Float32Array would otherwise serialise as
      // an indexed object ({"0": v0, "1": v1, ...}) which load() can read
      // (via coerceToFloat32Vector) but which is wasteful and was the
      // shape that originally caused the `embedding.slice` bug.
      const termsOut = {};
      for (const [term, vec] of this.terms.entries()) {
        termsOut[term] = vec instanceof Float32Array || ArrayBuffer.isView(vec)
          ? Array.from(vec)
          : vec;
      }
      const data = { metadata: this.metadata, terms: termsOut };
      await writeJsonAtomic(this.vocabPath, JSON.stringify(data, null, 2));
    });
  }

  get(term) {
    if (!Vocabulary.isEnabled()) return null;
    return this.terms.get(this.normalize(term)) || null;
  }
  set(term, embedding) { this.terms.set(this.normalize(term), embedding); }
  has(term) { return this.terms.has(this.normalize(term)); }
  delete(term) { return this.terms.delete(this.normalize(term)); }
  normalize(term) { return term.toLowerCase().trim(); }
  size() { return this.terms.size; }

  /**
   * Whether the vocabulary is at or above the configured max-terms cap.
   * Auto-expansion in `getEmbedding` is gated on this so a long-running
   * benchmark cannot inflate the file unbounded. Explicit
   * `addToVocabulary` / `expandVocabulary` calls (admin / pre-warm
   * paths) bypass the cap.
   */
  isFull() {
    const cap = EMBEDDING_CONFIG.cache?.maxTerms;
    if (!Number.isFinite(cap) || cap <= 0) return false;
    return this.terms.size >= cap;
  }

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
