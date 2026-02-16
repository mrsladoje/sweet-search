#!/usr/bin/env node

/**
 * Embedding Service v2.2 (SOTA December 2025)
 *
 * Multi-provider embedding service with tiered fallback:
 * - Tier 1: Voyage Code 3 (best for code, 1024d)
 * - Tier 2: Mistral Codestral Embed (3072d)
 * - Tier 3: Jina Embeddings v3 (1024d, multilingual)
 * - Tier 4: Local Xenova (offline fallback)
 *
 * Features:
 * - Automatic provider selection based on API keys
 * - LRU cache for recent query embeddings (<0.1ms lookup)
 * - Persistent vocabulary with pre-computed embeddings
 * - Rate limiting and retry logic for remote APIs
 * - Matryoshka dimension truncation for HNSW
 *
 * Performance:
 *   Cache hit: <0.1ms (sub-millisecond)
 *   Voyage API: ~50-100ms per batch
 *   Local model (warm): 2-3ms
 *   Local model (cold): ~3-5s (model loading)
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { gzipSync, gunzipSync, brotliDecompressSync } from 'zlib';
import { EMBEDDING_CONFIG, EMBEDDING_PROVIDERS, DB_PATHS } from './config.js';

// =============================================================================
// SEQUENCE LENGTH CONSTANTS (L2: configurable via env)
// =============================================================================
const INDEXING_MAX_LENGTH = parseInt(process.env.SWEET_SEARCH_INDEXING_MAX_LENGTH || '512', 10);
const QUERY_MAX_LENGTH = parseInt(process.env.SWEET_SEARCH_QUERY_MAX_LENGTH || '512', 10);

// =============================================================================
// CIRCUIT BREAKER FOR API STABILITY
// =============================================================================
// Prevents cascading failures during external API outages

const circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  state: 'CLOSED',  // CLOSED (normal), OPEN (blocking), HALF_OPEN (testing)

  // Configuration
  FAILURE_THRESHOLD: 5,      // Open circuit after 5 consecutive failures
  COOLDOWN_MS: 60000,        // Wait 60s before testing recovery
  SUCCESS_TO_CLOSE: 2,       // Need 2 successes to close circuit

  successCount: 0,

  /**
   * Check if request is allowed through the circuit
   * @returns {{ allowed: boolean, reason?: string }}
   */
  canRequest() {
    const now = Date.now();

    if (this.state === 'CLOSED') {
      return { allowed: true };
    }

    if (this.state === 'OPEN') {
      // Check if cooldown period has passed
      if (now - this.lastFailure > this.COOLDOWN_MS) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        console.log('[embedding-service] Circuit breaker entering HALF_OPEN state');
        return { allowed: true };
      }
      return { allowed: false, reason: `Circuit OPEN - retry in ${Math.ceil((this.COOLDOWN_MS - (now - this.lastFailure)) / 1000)}s` };
    }

    // HALF_OPEN - allow limited requests to test recovery
    return { allowed: true };
  },

  /**
   * Record a successful API call
   */
  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.SUCCESS_TO_CLOSE) {
        this.state = 'CLOSED';
        this.failures = 0;
        console.log('[embedding-service] Circuit breaker CLOSED - API recovered');
      }
    } else {
      this.failures = 0;  // Reset on any success in CLOSED state
    }
  },

  /**
   * Record a failed API call
   */
  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Failed during recovery test - reopen
      this.state = 'OPEN';
      console.log('[embedding-service] Circuit breaker re-OPENED - recovery failed');
    } else if (this.failures >= this.FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      console.error(`[embedding-service] Circuit breaker OPENED after ${this.failures} consecutive failures`);
    }
  },

  /**
   * Get current circuit state for monitoring
   */
  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure,
      cooldownRemaining: this.state === 'OPEN'
        ? Math.max(0, this.COOLDOWN_MS - (Date.now() - this.lastFailure))
        : 0
    };
  }
};

// Export for testing and monitoring
export { circuitBreaker };

// =============================================================================
// V2b: REQUEST/RESPONSE COMPRESSION
// =============================================================================

// Per-provider request compression support cache.
// Tracks whether each provider accepts gzip-encoded request bodies.
// Starts optimistic (true); set to false on 415/400 rejection.
const _providerCompressionSupport = new Map(); // provider -> boolean

function providerSupportsRequestCompression(provider) {
  return _providerCompressionSupport.get(provider) !== false;
}

function markProviderNoCompression(provider) {
  _providerCompressionSupport.set(provider, false);
}

/**
 * Quick check if data looks like JSON (starts with '{' or '[' after whitespace).
 * Used to guard against double-decompression when undici auto-decompresses
 * but still reports the original Content-Encoding header.
 */
function looksLikeJson(data) {
  const u8 = new Uint8Array(
    data instanceof Buffer
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data
  );
  if (u8.length === 0) return false;
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    if (c === 0x20 || c === 0x0A || c === 0x0D || c === 0x09) continue; // whitespace
    return c === 0x7B || c === 0x5B; // '{' or '['
  }
  return false;
}

/**
 * Parse a potentially compressed API response.
 * Handles gzip/brotli decompression with a double-decompression guard:
 * some undici versions auto-decompress yet still report the original
 * Content-Encoding header.
 *
 * @param {object} response - { body, statusCode, headers }
 * @returns {object} Parsed JSON response body
 */
async function parseCompressedResponse({ body, statusCode, headers: resHeaders }) {
  if (statusCode !== 200) {
    const error = await body.text();
    throw new Error(`API error: ${statusCode} - ${error}`);
  }

  const encoding = resHeaders?.['content-encoding'];
  let responseData = await body.arrayBuffer();

  // Only manually decompress if encoding header present AND data is not already JSON
  // (undici may auto-decompress depending on version)
  if (encoding && !looksLikeJson(responseData)) {
    try {
      if (encoding === 'gzip') {
        responseData = gunzipSync(Buffer.from(responseData));
      } else if (encoding === 'br') {
        responseData = brotliDecompressSync(Buffer.from(responseData));
      }
    } catch {
      // Decompression failed — data was likely already decompressed by undici
    }
  }

  // Parse JSON from buffer
  const text = typeof responseData === 'string'
    ? responseData
    : Buffer.isBuffer(responseData)
      ? responseData.toString('utf8')
      : new TextDecoder().decode(responseData);
  return JSON.parse(text);
}

/**
 * V2b: Make an API request with optional gzip request compression and
 * response decompression via an undici pool.
 *
 * Request compression flow:
 * 1. Serialize request body to JSON
 * 2. If provider accepts compression, gzip the body
 * 3. Only use compressed body if it saves >10% space
 * 4. On 415/400 with Content-Encoding, mark provider as no-compression and retry
 *
 * @param {object} pool - undici Pool instance
 * @param {string} provider - provider name for compression support tracking
 * @param {string} apiPath - API endpoint path (e.g., '/v1/embeddings')
 * @param {object} requestBody - request payload (will be JSON-serialized)
 * @param {string} apiKey - authorization bearer token
 * @returns {object} parsed JSON response
 */
async function compressedApiRequest(pool, provider, apiPath, requestBody, apiKey) {
  const jsonBody = JSON.stringify(requestBody);

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip, br',
  };

  let body = jsonBody;
  if (providerSupportsRequestCompression(provider)) {
    try {
      const compressed = gzipSync(Buffer.from(jsonBody));
      // Only use compression if it actually saves space (>10% reduction)
      if (compressed.length < jsonBody.length * 0.9) {
        headers['Content-Encoding'] = 'gzip';
        body = compressed;
      }
    } catch {
      // gzip failed — send uncompressed
    }
  }

  const response = await pool.request({
    path: apiPath,
    method: 'POST',
    headers,
    body,
  });

  // Handle 415 (Unsupported Media Type) or 400 from providers that reject
  // compressed request bodies — retry once without compression
  if ((response.statusCode === 415 || response.statusCode === 400) && headers['Content-Encoding']) {
    // Drain the error body to avoid undici leak warnings
    try { await response.body.text(); } catch { /* best-effort drain */ }

    markProviderNoCompression(provider);
    delete headers['Content-Encoding'];
    const retryResponse = await pool.request({
      path: apiPath,
      method: 'POST',
      headers,
      body: jsonBody,
    });
    return parseCompressedResponse(retryResponse);
  }

  return parseCompressedResponse(response);
}

// =============================================================================
// RATE LIMITER
// =============================================================================

class RateLimiter {
  constructor(requestsPerMinute, tokensPerMinute = Infinity) {
    this.requestsPerMinute = requestsPerMinute;
    this.tokensPerMinute = tokensPerMinute;
    this.requestTimestamps = [];
    this.tokenTimestamps = [];
  }

  async waitForSlot(tokenCount = 0) {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    this.tokenTimestamps = this.tokenTimestamps.filter(t => t.time > oneMinuteAgo);

    // Check request limit
    if (this.requestTimestamps.length >= this.requestsPerMinute) {
      const oldestRequest = this.requestTimestamps[0];
      const waitTime = oldestRequest + 60000 - now;
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Check token limit
    const currentTokens = this.tokenTimestamps.reduce((sum, t) => sum + t.tokens, 0);
    if (currentTokens + tokenCount > this.tokensPerMinute) {
      const waitTime = 60000 - (now - this.tokenTimestamps[0]?.time || 0);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.requestTimestamps.push(Date.now());
    if (tokenCount > 0) {
      this.tokenTimestamps.push({ time: Date.now(), tokens: tokenCount });
    }
  }
}

// =============================================================================
// LRU CACHE
// =============================================================================

class LRUCache {
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
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
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

class QueryStats {
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
    } catch (err) { /* Start fresh */ }
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

const queryStats = new QueryStats(DB_PATHS.vocabulary.replace('.json', '-stats.json'));

// =============================================================================
// VOCABULARY
// =============================================================================

class Vocabulary {
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
        // Check if vocabulary was created with a different provider
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

/**
 * Semantic Cache - Uses local model for cache KEY computation (~2-3ms)
 * and stores Voyage embeddings as VALUES. Enables similarity-based
 * cache lookups instead of exact match only.
 *
 * How it works:
 * 1. Query comes in ("how does auth work")
 * 2. Compute local embedding (~2-3ms)
 * 3. Search cache for similar local embeddings (similarity > threshold)
 * 4. If found, return cached Voyage embedding (<0.1ms)
 * 5. If not found, call Voyage API (~250ms), cache both embeddings
 *
 * Result: ~60-70% cache hit rate, average latency drops significantly.
 */
class SemanticCache {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.85;  // Similarity threshold for cache hit
    this.maxSize = options.maxSize ?? 500;       // Max cached entries
    this.entries = [];                            // { localEmb, voyageEmb, query }
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
      let pipeline;
      try {
        ({ pipeline } = await import('@huggingface/transformers'));
      } catch {
        ({ pipeline } = await import('@xenova/transformers'));
      }
      this.localModel = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
      console.log(`[SemanticCache] Local model loaded in ${Date.now() - start}ms`);
      this.loadingModel = false;
      return this.localModel;
    })();

    return this.loadPromise;
  }

  async computeLocalEmbedding(text) {
    const model = await this.getLocalModel();
    this.stats.localModelCalls++;
    const output = await model(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
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

  /**
   * Find similar query in cache using local embedding
   * @returns {object} { voyageEmb, localEmb, similarity?, matchedQuery? }
   */
  async findSimilar(text) {
    // Always compute local embedding (for caching if miss)
    const localEmb = await this.computeLocalEmbedding(text);

    // If cache is empty, return miss with local embedding
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

  /**
   * Add new entry to semantic cache
   */
  add(text, localEmb, voyageEmb) {
    // Evict oldest if full
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

const semanticCache = new SemanticCache({ threshold: 0.85, maxSize: 500 });

// =============================================================================
// QUERY DEDUPLICATION (Prevent duplicate concurrent API calls)
// =============================================================================

/**
 * Query Deduplicator - Shares in-flight API calls for identical queries
 *
 * If the same query is requested while an API call is in progress,
 * returns the same promise instead of making a duplicate call.
 * Saves ~250ms per duplicate and reduces API costs.
 */
class QueryDeduplicator {
  constructor() {
    this.inflight = new Map();  // text -> Promise
  }

  /**
   * Get or create an in-flight request
   * @returns {Promise|null} Existing promise if query is in-flight, null otherwise
   */
  get(text) {
    return this.inflight.get(text) || null;
  }

  /**
   * Register an in-flight request
   */
  set(text, promise) {
    this.inflight.set(text, promise);
    // Auto-cleanup when promise resolves
    promise.finally(() => this.inflight.delete(text));
  }

  has(text) {
    return this.inflight.has(text);
  }
}

const queryDeduplicator = new QueryDeduplicator();

// =============================================================================
// REMOTE API CLIENTS (with HTTP/2 and connection pooling)
// =============================================================================

/**
 * HTTP/2 Client with undici for reduced latency
 *
 * HTTP/2 multiplexing reduces latency by ~20-50ms compared to HTTP/1.1
 * by avoiding connection setup overhead for concurrent requests.
 */
let undiciPool = null;

async function getUndiciPool() {
  if (undiciPool) return undiciPool;

  try {
    const { Pool } = await import('undici');
    undiciPool = new Pool('https://api.voyageai.com', {
      connections: 10,           // Max concurrent connections
      pipelining: 1,             // HTTP/2 handles multiplexing
      keepAliveTimeout: 30000,   // 30s keep-alive
      keepAliveMaxTimeout: 60000,
    });
    return undiciPool;
  } catch {
    // Fallback: undici not installed
    return null;
  }
}

/**
 * HTTP Agent with connection pooling (fallback for non-undici)
 */
let httpsAgent = null;

async function getHttpsAgent() {
  if (httpsAgent) return httpsAgent;

  try {
    const https = await import('https');
    httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 10,
      maxFreeSockets: 5,
      timeout: 30000,
      freeSocketTimeout: 15000,
    });
    return httpsAgent;
  } catch {
    return undefined;
  }
}

async function callVoyageAPI(texts, config, options = {}) {
  const {
    inputType = 'document',
    outputDtype = 'float',  // 'float', 'int8', 'uint8', 'binary', 'ubinary'
    outputDimension = config.dimensions.full,
  } = options;

  const requestBody = {
    model: config.model,
    input: texts,
    input_type: inputType,
    output_dimension: outputDimension,
  };

  // Add output_dtype for quantized formats (Voyage Code 3 supports this)
  if (outputDtype !== 'float') {
    requestBody.output_dtype = outputDtype;
  }

  // Try HTTP/2 via undici first (20-50ms faster) with V2b compression
  const pool = await getUndiciPool();
  if (pool) {
    try {
      const data = await compressedApiRequest(pool, 'voyage', '/v1/embeddings', requestBody, config.apiKey);
      return data.data.map(d => d.embedding);
    } catch (err) {
      // If it's an API-level error (4xx/5xx), propagate it
      if (!err.message.includes('API error')) {
        console.warn('[HTTP/2] Falling back to fetch:', err.message);
      } else {
        throw err;
      }
    }
  }

  // Fallback: Use standard fetch with connection pooling
  // (native fetch handles response decompression automatically)
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Connection': 'keep-alive',
      'Accept-Encoding': 'gzip, br',
    },
    body: JSON.stringify(requestBody),
  };

  const response = await fetch(config.endpoint, fetchOptions);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

async function callMistralAPI(texts, config, options = {}) {
  const { outputDimension } = options;

  const requestBody = {
    model: config.model,
    input: texts,
  };

  // Mistral Codestral Embed supports Matryoshka via 'dimensions' parameter
  if (outputDimension) {
    requestBody.dimensions = outputDimension;
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip, br',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

async function callJinaAPI(texts, config, options = {}) {
  const {
    task = 'retrieval.passage',
    outputDimension,
  } = options;

  const requestBody = {
    model: config.model,
    input: texts,
    task,
  };

  // Jina Embeddings v3 supports Matryoshka via 'dimensions' parameter
  if (outputDimension) {
    requestBody.dimensions = outputDimension;
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept-Encoding': 'gzip, br',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Jina API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data.map(d => d.embedding);
}

// =============================================================================
// LOCAL MODEL (Xenova)
// =============================================================================

/**
 * L3c: Determine optimal intra-op thread count for ONNX Runtime.
 * Uses physical cores (not hyperthreads), reserves one for Node/event loop, cap at 8.
 */
function bestIntraOpThreads() {
  const physicalCores = Math.ceil(os.cpus().length / 2);
  return Math.min(Math.max(1, physicalCores - 1), 8);
}

function isIntelCpu() {
  const model = os.cpus()?.[0]?.model || '';
  return model.toLowerCase().includes('intel');
}

/**
 * L3b: Return path for the ORT-optimized model graph cache.
 * Deterministic key: ORT version + model name hash → stable across restarts.
 */
function getOptimizedModelPath() {
  const cacheDir = path.join(os.homedir(), '.cache', 'sweet-search');
  mkdirSync(cacheDir, { recursive: true });

  let ortVersion = 'unknown';
  try {
    const ortPkg = JSON.parse(readFileSync(
      path.resolve('node_modules/onnxruntime-node/package.json'), 'utf8'
    ));
    ortVersion = ortPkg.version;
  } catch {
    // ORT pulled in transitively; version unknown is fine
  }

  const modelHash = crypto.createHash('sha256')
    .update(EMBEDDING_PROVIDERS.local.model)
    .digest('hex')
    .slice(0, 12);

  return path.join(cacheDir, `coderankembed-optimized-ort${ortVersion}-${modelHash}.onnx`);
}

/**
 * Token estimation calibration factor.
 * Default ~4 chars/token is safe for code. Can be tuned per-project.
 */
function getCalibrationFactor() {
  return 4;
}

function buildLocalSessionOptions() {
  const sessionOptions = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: bestIntraOpThreads(),
    interOpNumThreads: 2,
    executionMode: 'parallel',
    enableCpuMemArena: true,
    enableMemPattern: true,
    optimizedModelFilePath: getOptimizedModelPath(),
  };

  // L5: OpenVINO EP support (optional, Intel-only, opt-in)
  if (process.env.SWEET_SEARCH_USE_OPENVINO === '1' && isIntelCpu()) {
    sessionOptions.executionProviders = [
      { name: 'OpenVINOExecutionProvider' },
      'CPUExecutionProvider',
    ];
  }

  return sessionOptions;
}

async function createLocalPipeline(pipelineFactory, sessionOptions) {
  const modelName = EMBEDDING_PROVIDERS.local.model;
  const keyCandidates = ['session_options', 'sessionOptions'];
  let lastError = null;

  for (const key of keyCandidates) {
    try {
      const candidate = await pipelineFactory('feature-extraction', modelName, {
        quantized: true,
        [key]: sessionOptions,
      });
      candidate.__sweetSessionKey = key;
      return candidate;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to create local embedding pipeline');
}

function maskIsActive(maskValue) {
  return typeof maskValue === 'bigint' ? maskValue !== 0n : maskValue !== 0;
}

function l2NormalizeRowsInPlace(data, rows, cols) {
  for (let r = 0; r < rows; r++) {
    const offset = r * cols;
    let normSq = 0;
    for (let c = 0; c < cols; c++) {
      const v = data[offset + c];
      normSq += v * v;
    }

    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      const inv = 1 / norm;
      for (let c = 0; c < cols; c++) {
        data[offset + c] *= inv;
      }
    }
  }
}

function meanPoolWithAttentionMask(tokenEmbeddings, attentionMask, normalize = true) {
  const dims = tokenEmbeddings?.dims || [];
  if (dims.length !== 3) {
    throw new Error(`[L1] Expected dims [batch, seq, hidden], got [${dims.join(', ')}]`);
  }

  const [batchSize, seqLength, hiddenSize] = dims;
  const pooled = new Float32Array(batchSize * hiddenSize);
  const tokenData = tokenEmbeddings.data;
  const maskData = attentionMask?.data || null;

  for (let b = 0; b < batchSize; b++) {
    const rowOffset = b * hiddenSize;
    let validTokens = 0;

    for (let t = 0; t < seqLength; t++) {
      const maskOffset = b * seqLength + t;
      if (maskData && !maskIsActive(maskData[maskOffset])) continue;

      validTokens++;
      const tokenOffset = (b * seqLength + t) * hiddenSize;
      for (let h = 0; h < hiddenSize; h++) {
        pooled[rowOffset + h] += tokenData[tokenOffset + h];
      }
    }

    const denom = validTokens > 0 ? validTokens : 1;
    const inv = 1 / denom;
    for (let h = 0; h < hiddenSize; h++) {
      pooled[rowOffset + h] *= inv;
    }
  }

  if (normalize) {
    l2NormalizeRowsInPlace(pooled, batchSize, hiddenSize);
  }

  return {
    data: pooled,
    batchSize,
    dim: hiddenSize,
  };
}

function extractPooledEmbeddings(outputs, attentionMask, normalize = true) {
  const candidate = outputs?.last_hidden_state || outputs?.logits || outputs?.token_embeddings;
  if (!candidate?.dims || !candidate?.data) {
    throw new Error('[L1] Model output missing tensor data for feature extraction');
  }

  if (candidate.dims.length === 3) {
    return meanPoolWithAttentionMask(candidate, attentionMask, normalize);
  }

  if (candidate.dims.length === 2) {
    const [batchSize, dim] = candidate.dims;
    const data = new Float32Array(candidate.data.length);
    data.set(candidate.data);
    if (normalize) {
      l2NormalizeRowsInPlace(data, batchSize, dim);
    }
    return { data, batchSize, dim };
  }

  throw new Error(`[L1] Unsupported tensor shape: [${candidate.dims.join(', ')}]`);
}

let localPipeline = null;
let isLoadingLocal = false;
let loadPromise = null;

async function getLocalPipeline() {
  if (localPipeline) return localPipeline;
  if (isLoadingLocal && loadPromise) return loadPromise;

  isLoadingLocal = true;
  loadPromise = (async () => {
    const start = Date.now();
    console.log(`Loading local model: ${EMBEDDING_PROVIDERS.local.model}...`);
    // Use @huggingface/transformers when available (newer ONNX runtime, fixes crashes on some platforms)
    let pipeline;
    try {
      ({ pipeline } = await import('@huggingface/transformers'));
    } catch {
      ({ pipeline } = await import('@xenova/transformers'));
    }

    const sessionOptions = buildLocalSessionOptions();

    try {
      localPipeline = await createLocalPipeline(pipeline, sessionOptions);
    } catch (err) {
      // If OpenVINO is enabled and unavailable, retry CPU-only once.
      if (sessionOptions.executionProviders) {
        console.warn(`[L5] OpenVINO session init failed (${err.message}), retrying with CPUExecutionProvider only`);
        const cpuOnlyOptions = buildLocalSessionOptions();
        delete cpuOnlyOptions.executionProviders;
        localPipeline = await createLocalPipeline(pipeline, cpuOnlyOptions);
      } else {
        throw err;
      }
    }

    // Warmup call to prime memory arena and allocation patterns
    await localPipeline(["warmup"], { pooling: 'mean', normalize: true, truncation: true, max_length: 64 });
    const optimizedPath = getOptimizedModelPath();
    if (!existsSync(optimizedPath)) {
      console.warn(`[L3b] Optimized model file was not materialized at ${optimizedPath}. Session options may not be fully forwarded.`);
    }

    console.log(`Local model loaded in ${Date.now() - start}ms (threads: ${bestIntraOpThreads()}, sessionKey: ${localPipeline.__sweetSessionKey || 'unknown'})`);
    isLoadingLocal = false;
    return localPipeline;
  })();

  return loadPromise;
}

/**
 * L1: True batch inference for local model.
 * Passes entire batch to pipeline in one call with padding and truncation.
 * Returns Float32Array subarray views from a per-batch pool (zero-copy downstream).
 *
 * @param {string[]} texts - Texts to embed
 * @param {object} options - Options including maxLength
 * @returns {Float32Array[]} Array of Float32Array subarray views (one per text)
 */
async function callLocalModel(texts, options = {}) {
  if (!texts || texts.length === 0) return [];

  const model = await getLocalPipeline();
  const { maxLength = INDEXING_MAX_LENGTH } = options;

  // IMPORTANT: FeatureExtractionPipeline currently hardcodes tokenizer options
  // (padding/truncation) and ignores caller-provided max_length. We therefore
  // run tokenizer + model directly here to enforce maxLength deterministically.
  const modelInputs = model.tokenizer(texts, {
    padding: true,
    truncation: true,
    max_length: maxLength,
  });
  const outputs = await model.model(modelInputs);
  const pooled = extractPooledEmbeddings(outputs, modelInputs.attention_mask, true);
  const { data, batchSize, dim } = pooled;

  if (batchSize !== texts.length) {
    throw new Error(`[L1] Output count mismatch: got ${batchSize} embeddings for ${texts.length} texts`);
  }

  const expectedDim = EMBEDDING_PROVIDERS.local.dimensions.full;
  if (dim !== expectedDim) {
    console.warn(`[L1] Local embedding dim mismatch: expected ${expectedDim}, got ${dim}`);
  }

  // Allocate owned pool buffer and create view slices for zero-copy downstream.
  const pool = new Float32Array(batchSize * dim);
  pool.set(data);

  const embeddings = new Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    embeddings[i] = pool.subarray(i * dim, (i + 1) * dim);
  }
  // Dev-only guard: catches accidental container mutation (embeddings[i] = ...)
  if (process.env.NODE_ENV !== 'production') Object.freeze(embeddings);
  return embeddings;
}

/**
 * L0: Length-sorted bucketing for local model batch inference.
 * Sorts texts by estimated token length, groups into adaptive-sized batches
 * based on a token budget, and un-sorts results via origIdx.
 *
 * @param {string[]} texts - Texts to embed
 * @param {object} options - Options including maxLength, hardCap, batchingSafety
 * @returns {Float32Array[]} Array of Float32Array subarray views (original order)
 */
async function callLocalModelBucketed(texts, options = {}) {
  const maxLength = options.maxLength ?? INDEXING_MAX_LENGTH;

  const charPerToken = getCalibrationFactor();
  const batchingSafety = options.batchingSafety
    ?? Number(process.env.SWEET_SEARCH_BATCHING_SAFETY ?? 1.15);
  const indexed = texts.map((text, i) => {
    const est = Math.ceil((text.length / charPerToken) * batchingSafety);
    const estTokens = Math.max(1, Math.min(est, maxLength));
    return { text, origIdx: i, estTokens };
  });
  indexed.sort((a, b) => a.estTokens - b.estTokens);

  // Adaptive batch sizing: bigger batches for short texts, smaller for long
  const embeddings = new Array(texts.length);
  let i = 0;

  while (i < indexed.length) {
    const tokenBudget = 16384;
    const baseHardCap = options.hardCap ?? (maxLength <= 256 ? 128 : 64);
    const resolveHardCap = options.resolveHardCap ?? (() => baseHardCap);
    const memCapBytes = 512 * 1024 * 1024; // 512MB RSS headroom cap
    const memGuardHighWatermark = 0.85;

    // Peek ahead to find batch size where longest doc * count <= budget
    let batchSize = 1;
    while (i + batchSize < indexed.length) {
      const rawEst = indexed[i + batchSize].estTokens;
      const candidateLongest = Math.min(rawEst, maxLength);
      const candidateCount = batchSize + 1;
      const candidateHardCap = resolveHardCap(candidateLongest);
      if (candidateCount > candidateHardCap) break;
      if (candidateLongest * candidateCount > tokenBudget) break;
      batchSize = candidateCount;
    }

    // RAM guard (OOM prevention only, not batch shaping)
    const rss = process.memoryUsage().rss;
    if (
      !process.env.SWEET_SEARCH_DISABLE_MEM_GUARD &&
      rss > memCapBytes * memGuardHighWatermark
    ) {
      batchSize = Math.max(1, Math.floor(batchSize / 2));
    }

    const batch = indexed.slice(i, i + batchSize);
    const batchTexts = batch.map(b => b.text);
    const batchEmbeddings = await callLocalModel(batchTexts, { maxLength });

    for (let j = 0; j < batch.length; j++) {
      embeddings[batch[j].origIdx] = batchEmbeddings[j];
    }
    i += batchSize;
  }

  return embeddings;
}

// =============================================================================
// UNIFIED EMBEDDING SERVICE
// =============================================================================

const queryCache = new LRUCache(EMBEDDING_CONFIG.cache?.maxSize || 1000);
const vocabulary = new Vocabulary(DB_PATHS.vocabulary);

// =============================================================================
// TIME-WINDOW RATE LIMITER (V2: concurrent-safe for Promise.all)
// =============================================================================

/**
 * Sliding-window rate limiter with mutex serialization for concurrent safety.
 * Unlike the basic RateLimiter, this is safe under Promise.all — a chained
 * promise mutex prevents multiple callers from stampeding past the check.
 *
 * Time-window based with no release() needed: permits expire as timestamps
 * fall out of the 60-second window. No deadlock risk.
 *
 * Optional per-second microburst smoother reduces provider-side 429 spikes.
 */
class TimeWindowRateLimiter {
  constructor(maxRPM, options = {}) {
    this.windowMs = 60_000;
    this.maxInWindow = maxRPM;
    this.timestamps = [];

    // Optional microburst smoother
    this.secondWindowMs = 1_000;
    this.maxPerSecond = options.maxPerSecond ?? (Math.floor(maxRPM / 60) + 1);
    this.secondTimestamps = [];

    this._mutex = Promise.resolve();
  }

  async acquire() {
    const prev = this._mutex;
    let releaseMutex;
    this._mutex = new Promise(resolve => { releaseMutex = resolve; });
    await prev;

    try {
      while (this._atMinuteCapacity() || this._atSecondCapacity()) {
        const waitMs = this._nextWaitMs();
        await new Promise(r => setTimeout(r, waitMs));
        this._pruneWindows();
      }

      const now = Date.now();
      this.timestamps.push(now);
      this.secondTimestamps.push(now);
    } finally {
      releaseMutex();
    }
  }

  _atMinuteCapacity() {
    this._pruneWindows();
    return this.timestamps.length >= this.maxInWindow;
  }

  _atSecondCapacity() {
    this._pruneWindows();
    return this.secondTimestamps.length >= this.maxPerSecond;
  }

  _nextWaitMs() {
    const now = Date.now();
    const minuteWait = this.timestamps.length > 0
      ? Math.max(1, this.windowMs - (now - this.timestamps[0]))
      : 1;
    const secondWait = this.secondTimestamps.length > 0
      ? Math.max(1, this.secondWindowMs - (now - this.secondTimestamps[0]))
      : 1;
    return Math.min(minuteWait, secondWait);
  }

  _pruneWindows() {
    const now = Date.now();
    const minuteCutoff = now - this.windowMs;
    const secondCutoff = now - this.secondWindowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < minuteCutoff) {
      this.timestamps.shift();
    }
    while (this.secondTimestamps.length > 0 && this.secondTimestamps[0] < secondCutoff) {
      this.secondTimestamps.shift();
    }
  }
}

export { TimeWindowRateLimiter };

// Rate limiters per provider (legacy sequential)
const rateLimiters = {
  voyage: new RateLimiter(
    EMBEDDING_PROVIDERS.voyage.rateLimit?.requestsPerMinute || 300,
    EMBEDDING_PROVIDERS.voyage.rateLimit?.tokensPerMinute || 1000000
  ),
  mistral: new RateLimiter(EMBEDDING_PROVIDERS.mistral.rateLimit?.requestsPerMinute || 100),
  jina: new RateLimiter(EMBEDDING_PROVIDERS.jina.rateLimit?.requestsPerMinute || 500),
};

// Concurrent-safe rate limiters for V2 batch processing
const timeWindowLimiters = {
  voyage: new TimeWindowRateLimiter(
    EMBEDDING_PROVIDERS.voyage.rateLimit?.requestsPerMinute || 300
  ),
  mistral: new TimeWindowRateLimiter(
    EMBEDDING_PROVIDERS.mistral.rateLimit?.requestsPerMinute || 100
  ),
  jina: new TimeWindowRateLimiter(
    EMBEDDING_PROVIDERS.jina.rateLimit?.requestsPerMinute || 500
  ),
};

let cacheStats = { hits: 0, misses: 0, vocabularyHits: 0, apiCalls: 0 };

/**
 * Apply query prefix for local models that require it (e.g. CodeRankEmbed).
 * Called before any callLocalModel() invocation for query embeddings.
 */
function applyLocalQueryPrefix(text) {
  const prefix = EMBEDDING_PROVIDERS.local?.queryPrefix || '';
  if (prefix && !text.startsWith(prefix)) {
    return prefix + text;
  }
  return text;
}

/**
 * Generate embedding using the active provider
 * Integrates circuit breaker to prevent cascading failures during API outages
 *
 * @param {string} text - Text to embed
 * @param {string} provider - Provider name
 * @param {boolean} isQuery - If true, applies query prefix for local model (e.g. CodeRankEmbed)
 */
async function generateEmbedding(text, provider = EMBEDDING_CONFIG.provider, isQuery = false) {
  // Apply query prefix when calling local model (direct or fallback from remote)
  const localText = isQuery ? applyLocalQueryPrefix(text) : text;
  const localMaxLength = isQuery ? QUERY_MAX_LENGTH : INDEXING_MAX_LENGTH;

  const config = EMBEDDING_PROVIDERS[provider];
  if (!config || !config.enabled) {
    // Fallback to local
    return (await callLocalModel([localText], { maxLength: localMaxLength }))[0];
  }

  // Circuit breaker check for remote providers
  if (provider !== 'local') {
    const circuitCheck = circuitBreaker.canRequest();
    if (!circuitCheck.allowed) {
      console.warn(`[embedding-service] Circuit breaker blocked request: ${circuitCheck.reason}, falling back to local`);
      return (await callLocalModel([localText], { maxLength: localMaxLength }))[0];
    }
  }

  const rateLimit = config.rateLimit;
  let lastError = null;

  for (let attempt = 0; attempt < (rateLimit?.maxRetries || 3); attempt++) {
    try {
      if (rateLimiters[provider]) {
        await rateLimiters[provider].waitForSlot(text.length);
      }

      cacheStats.apiCalls++;

      let result;
      switch (provider) {
        case 'voyage':
          result = (await callVoyageAPI([text], config, { inputType: isQuery ? 'query' : 'document' }))[0];
          break;
        case 'mistral':
          result = (await callMistralAPI([text], config))[0];
          break;
        case 'jina':
          result = (await callJinaAPI([text], config, { task: isQuery ? 'retrieval.query' : 'retrieval.passage' }))[0];
          break;
        case 'local':
          result = (await callLocalModel([localText], { maxLength: localMaxLength }))[0];
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }

      // Record success with circuit breaker (for remote providers)
      if (provider !== 'local') {
        circuitBreaker.recordSuccess();
      }

      return result;
    } catch (err) {
      lastError = err;

      // Record failure with circuit breaker (for remote providers)
      if (provider !== 'local') {
        circuitBreaker.recordFailure();
      }

      const delay = (rateLimit?.retryDelay || 1000) * Math.pow(rateLimit?.backoffMultiplier || 2, attempt);
      console.warn(`Embedding attempt ${attempt + 1} failed: ${err.message}, retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // Fallback to local on failure
  console.warn(`All attempts failed for ${provider}, falling back to local model`);
  return (await callLocalModel([localText], { maxLength: localMaxLength }))[0];
}

/**
 * Generate embeddings for multiple texts (batched).
 *
 * V1: Accepts options.outputDimension and options.inputType for server-side
 *     Matryoshka truncation (Voyage, Mistral, Jina).
 * V2: Sends up to options.concurrency (default 4) batches in parallel,
 *     using TimeWindowRateLimiter for concurrent safety.
 *
 * @param {string[]} texts - Texts to embed
 * @param {string} provider - Provider name
 * @param {object} options - { outputDimension, inputType, concurrency }
 */
async function generateEmbeddings(texts, provider = EMBEDDING_CONFIG.provider, options = {}) {
  if (!texts || texts.length === 0) return [];

  const localBucketOptions = {
    maxLength: options.maxLength,
    hardCap: options.hardCap,
    resolveHardCap: options.resolveHardCap,
    batchingSafety: options.batchingSafety,
  };

  const config = EMBEDDING_PROVIDERS[provider];
  if (!config || !config.enabled) {
    return callLocalModelBucketed(texts, localBucketOptions);
  }

  const batchSize = config.batchSize || 32;
  const concurrency = options.concurrency || 4;

  // Build provider-specific API options (V1: server-side Matryoshka)
  const apiOptions = {};
  if (options.outputDimension) {
    apiOptions.outputDimension = options.outputDimension;
  }
  if (options.inputType) {
    apiOptions.inputType = options.inputType;
  }

  // Split texts into batches
  const batches = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }

  // V2: Concurrent batch processing for remote providers
  const results = [];

  /**
   * Embed a single batch through the appropriate provider API.
   * Uses TimeWindowRateLimiter for concurrent safety under Promise.all.
   */
  async function embedBatch(batch) {
    // V2: Use time-window limiter for concurrent safety
    if (timeWindowLimiters[provider]) {
      await timeWindowLimiters[provider].acquire();
    }

    cacheStats.apiCalls++;

    switch (provider) {
      case 'voyage':
        return callVoyageAPI(batch, config, apiOptions);
      case 'mistral':
        return callMistralAPI(batch, config, apiOptions);
      case 'jina':
        return callJinaAPI(batch, config, apiOptions);
      case 'local':
        return callLocalModelBucketed(batch, localBucketOptions);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  // Process batches in concurrent groups
  for (let i = 0; i < batches.length; i += concurrency) {
    const concurrent = batches.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      concurrent.map(async (batch) => {
        try {
          return await embedBatch(batch);
        } catch (err) {
          console.warn(`Batch embedding failed: ${err.message}, falling back to local`);
          return callLocalModelBucketed(batch, localBucketOptions);
        }
      })
    );
    for (const batchResult of batchResults) {
      results.push(...batchResult);
    }
  }

  return results;
}

/**
 * Get embedding with caching (LRU → Vocabulary → Semantic Cache → API)
 *
 * Cache hierarchy:
 * 1. LRU cache (exact match, <0.1ms)
 * 2. Vocabulary (pre-computed, <0.1ms)
 * 3. Semantic cache (local model similarity, ~5-10ms)
 * 4. Remote API (Voyage, ~250ms)
 */
export async function getEmbedding(text, options = {}) {
  const { useCache = true, useSemanticCache = true, isQuery = false } = options;

  const start = performance.now();

  // Cache key includes mode to prevent query/document embedding collisions.
  // Models like CodeRankEmbed produce different embeddings for queries (prefixed)
  // vs documents, and Voyage uses inputType='query' vs 'document'.
  const cacheKey = isQuery ? `q:${text}` : text;

  // Check LRU cache (exact match)
  if (useCache && EMBEDDING_CONFIG.cache?.enabled) {
    const cached = queryCache.get(cacheKey);
    if (cached) {
      cacheStats.hits++;
      return { embedding: cached, cached: true, source: 'lru', latency_us: Math.round((performance.now() - start) * 1000) };
    }

    // Check vocabulary (pre-computed) — only for queries
    if (isQuery) {
      await vocabulary.load();
      const vocabHit = vocabulary.get(text);
      if (vocabHit) {
        cacheStats.vocabularyHits++;
        queryCache.set(cacheKey, vocabHit);
        return { embedding: vocabHit, cached: true, source: 'vocabulary', latency_us: Math.round((performance.now() - start) * 1000) };
      }
    }
  }

  // Check semantic cache (similarity-based, uses local model)
  // Only use for remote providers (local model is fast enough)
  if (isQuery && useSemanticCache && EMBEDDING_CONFIG.isRemote) {
    const semanticResult = await semanticCache.findSimilar(text);
    if (semanticResult?.voyageEmb) {
      cacheStats.hits++;
      // Also store in LRU for exact match next time
      if (useCache && EMBEDDING_CONFIG.cache?.enabled) {
        queryCache.set(cacheKey, semanticResult.voyageEmb);
      }
      return {
        embedding: semanticResult.voyageEmb,
        cached: true,
        source: 'semantic-cache',
        similarity: semanticResult.similarity,
        matchedQuery: semanticResult.matchedQuery,
        latency_us: Math.round((performance.now() - start) * 1000),
      };
    }

    // Store local embedding for later if we have to call API
    var localEmbForCache = semanticResult?.localEmb;
  }

  cacheStats.misses++;

  // Check if same query is already in-flight (deduplication)
  const inflight = queryDeduplicator.get(cacheKey);
  if (inflight) {
    const result = await inflight;
    return { ...result, source: 'deduplicated', latency_us: Math.round((performance.now() - start) * 1000) };
  }

  // Generate embedding via API (with deduplication tracking)
  const embeddingPromise = generateEmbedding(text, EMBEDDING_CONFIG.provider, isQuery);
  queryDeduplicator.set(cacheKey, embeddingPromise.then(emb => ({ embedding: emb })));
  const embedding = await embeddingPromise;

  // Store in caches
  if (useCache && EMBEDDING_CONFIG.cache?.enabled) {
    queryCache.set(cacheKey, embedding);

    // Add to semantic cache if we have the local embedding
    if (localEmbForCache) {
      semanticCache.add(text, localEmbForCache, embedding);
    }

    // Track cross-session query usage and auto-expand vocabulary (query-only)
    if (isQuery && EMBEDDING_CONFIG.cache?.autoExpand) {
      await queryStats.load();
      const usageCount = queryStats.increment(text);
      queryStats.save().catch(() => {}); // Async save

      const threshold = EMBEDDING_CONFIG.cache?.expansionThreshold || 3;
      if (usageCount >= threshold && !vocabulary.has(text)) {
        vocabulary.set(text, embedding);
        vocabulary.save().catch(() => {});
        console.log(`Vocabulary: Auto-added "${text}" (used ${usageCount}x)`);
      }
    }
  }

  return {
    embedding,
    cached: false,
    source: EMBEDDING_CONFIG.provider,
    latency_us: Math.round((performance.now() - start) * 1000),
  };
}

/**
 * Simple embedding (returns just the vector)
 */
export async function embed(text, options = {}) {
  const result = await getEmbedding(text, options);
  return result.embedding;
}

/**
 * Batch embeddings
 */
export async function getEmbeddings(texts, options = {}) {
  const {
    useCache = true,
    provider = EMBEDDING_CONFIG.provider,
    providerOptions = {},
  } = options;

  const hasShapeAffectingProviderOptions =
    provider !== EMBEDDING_CONFIG.provider ||
    providerOptions.maxLength !== undefined ||
    providerOptions.outputDimension !== undefined ||
    providerOptions.outputDtype !== undefined ||
    providerOptions.inputType !== undefined;
  const allowCache = useCache && !hasShapeAffectingProviderOptions;

  // Check cache for all texts
  const results = new Array(texts.length);
  const uncachedIndices = [];
  const uncachedTexts = [];

  if (allowCache && EMBEDDING_CONFIG.cache?.enabled) {
    for (let i = 0; i < texts.length; i++) {
      const cached = queryCache.get(texts[i]);
      if (cached) {
        results[i] = { embedding: cached, cached: true };
        cacheStats.hits++;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
        cacheStats.misses++;
      }
    }
  } else {
    for (let i = 0; i < texts.length; i++) {
      uncachedIndices.push(i);
      uncachedTexts.push(texts[i]);
    }
  }

  // Generate embeddings for uncached
  if (uncachedTexts.length > 0) {
    const newEmbeddings = await generateEmbeddings(uncachedTexts, provider, providerOptions);
    for (let i = 0; i < uncachedIndices.length; i++) {
      const idx = uncachedIndices[i];
      results[idx] = { embedding: newEmbeddings[i], cached: false };

      if (allowCache && EMBEDDING_CONFIG.cache?.enabled) {
        queryCache.set(texts[idx], newEmbeddings[i]);
      }
    }
  }

  return results;
}

/**
 * Truncate embedding for HNSW (Matryoshka)
 */
export function truncateForHNSW(embedding) {
  const targetDim = EMBEDDING_CONFIG.hnswDimension;
  if (embedding.length <= targetDim) return embedding;
  return embedding.slice(0, targetDim);
}

// =============================================================================
// QUANTIZATION FUNCTIONS (Binary + Int8)
// Reference: https://huggingface.co/blog/embedding-quantization
// =============================================================================

/**
 * Convert float embedding to binary (1-bit per dimension)
 * Uses sign-based quantization: positive → 1, negative → 0
 * Returns Uint8Array where each byte contains 8 dimensions
 *
 * @param {number[]} embedding - Float embedding
 * @returns {Uint8Array} Binary embedding (dimension/8 bytes)
 */
export function floatToBinary(embedding) {
  const numBytes = Math.ceil(embedding.length / 8);
  const binary = new Uint8Array(numBytes);

  for (let i = 0; i < embedding.length; i++) {
    if (embedding[i] > 0) {
      binary[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
    }
  }

  return binary;
}

/**
 * Convert float embedding to int8 (-128 to 127)
 *
 * FIXED: Now properly scales by max component magnitude to use full Int8 range.
 *
 * For L2-normalized embeddings (like Voyage code-3), individual components are
 * small (~±0.05 for 512d vectors). We scale by max(|v_i|) to utilize the full
 * ±127 Int8 range, preserving relative magnitudes for accurate dot products.
 *
 * The int8CosineSimilarity function computes proper cosine similarity by normalizing
 * by actual L2 norms of the Int8 vectors.
 *
 * @param {number[]} embedding - Float embedding (any range, typically L2-normalized)
 * @returns {Int8Array} Int8 embedding using full [-127, 127] range
 */
export function floatToInt8(embedding) {
  const int8 = new Int8Array(embedding.length);

  // Find max absolute value to scale properly
  let maxAbs = 0;
  for (let i = 0; i < embedding.length; i++) {
    const abs = Math.abs(embedding[i]);
    if (abs > maxAbs) maxAbs = abs;
  }

  // Avoid division by zero; also handle already-scaled vectors
  // If max is already > 0.5, assume vector is in [-1, 1] range (backward compat)
  if (maxAbs === 0) return int8;

  // Scale to use full [-127, 127] range
  const scale = 127 / maxAbs;
  for (let i = 0; i < embedding.length; i++) {
    int8[i] = Math.round(Math.max(-127, Math.min(127, embedding[i] * scale)));
  }

  return int8;
}

/**
 * Hamming distance between two binary vectors
 * Uses population count (popcount) for efficiency
 *
 * @param {Uint8Array} a - Binary vector
 * @param {Uint8Array} b - Binary vector
 * @returns {number} Hamming distance (number of differing bits)
 */
export function hammingDistance(a, b) {
  let distance = 0;
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i++) {
    // XOR gives bits that differ, popcount counts them
    distance += popcount(a[i] ^ b[i]);
  }

  return distance;
}

/**
 * Population count (number of 1 bits in a byte)
 * Uses lookup table for speed
 */
const POPCOUNT_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  POPCOUNT_TABLE[i] = (i & 1) + POPCOUNT_TABLE[i >> 1];
}

function popcount(byte) {
  return POPCOUNT_TABLE[byte];
}

/**
 * Cosine similarity between int8 vectors (for rescoring)
 *
 * FIXED: Now computes proper cosine similarity by normalizing by actual L2 norms.
 * This works correctly regardless of how vectors were scaled (old or new floatToInt8).
 *
 * For L2-normalized source vectors quantized to Int8:
 * - Old floatToInt8: values ~±6-14 (small range)
 * - New floatToInt8: values ~±100-127 (full range)
 *
 * Both produce correct cosine similarity because we normalize by actual norms.
 *
 * @param {Int8Array} a - Int8 vector
 * @param {Int8Array} b - Int8 vector
 * @returns {number} Cosine similarity in [-1, 1], typically [0, 1] for semantic vectors
 */
export function int8CosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // Compute L2 norms
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  // Avoid division by zero
  if (normA === 0 || normB === 0) return 0;

  // Cosine similarity = dot(a,b) / (|a| * |b|)
  return dot / (normA * normB);
}

// Deprecated alias for backward compatibility (named export)
export { int8CosineSimilarity as int8DotProduct };

/**
 * Generate binary embedding via Voyage API (if available) or local conversion
 *
 * @param {string} text - Text to embed
 * @returns {Promise<{binary: Uint8Array, float: number[]}>}
 */
export async function getBinaryEmbedding(text) {
  const start = performance.now();

  // Check cache first
  const cacheKey = `binary:${text}`;
  if (EMBEDDING_CONFIG.cache?.enabled) {
    const cached = queryCache.get(cacheKey);
    if (cached) {
      cacheStats.hits++;
      return {
        binary: cached.binary,
        float: cached.float,
        cached: true,
        source: 'cache',
        latency_us: Math.round((performance.now() - start) * 1000),
      };
    }
  }

  // For Voyage, we can get binary directly from API
  if (EMBEDDING_CONFIG.provider === 'voyage' && EMBEDDING_PROVIDERS.voyage.enabled) {
    try {
      const config = EMBEDDING_PROVIDERS.voyage;
      await rateLimiters.voyage.waitForSlot(text.length);
      cacheStats.apiCalls++;

      // Get both binary and float for rescore capability
      const [binaryResult, floatResult] = await Promise.all([
        callVoyageAPI([text], config, { outputDtype: 'ubinary', inputType: 'query' }),
        callVoyageAPI([text], config, { inputType: 'query' }),
      ]);

      const result = {
        binary: new Uint8Array(binaryResult[0]),
        float: floatResult[0],
        cached: false,
        source: 'voyage-binary',
        latency_us: Math.round((performance.now() - start) * 1000),
      };

      // Cache it
      if (EMBEDDING_CONFIG.cache?.enabled) {
        queryCache.set(cacheKey, { binary: result.binary, float: result.float });
      }

      return result;
    } catch (err) {
      console.warn(`Voyage binary embedding failed: ${err.message}, falling back to local conversion`);
    }
  }

  // Fallback: get float embedding and convert locally
  const floatResult = await getEmbedding(text, { isQuery: true });
  const truncated = truncateForHNSW(floatResult.embedding);
  const binary = floatToBinary(truncated);

  const result = {
    binary,
    float: floatResult.embedding,
    cached: false,
    source: 'local-conversion',
    latency_us: Math.round((performance.now() - start) * 1000),
  };

  // Cache it
  if (EMBEDDING_CONFIG.cache?.enabled) {
    queryCache.set(cacheKey, { binary: result.binary, float: result.float });
  }

  return result;
}

/**
 * Generate int8 embedding for rescore stage
 *
 * @param {string} text - Text to embed
 * @returns {Promise<{int8: Int8Array, float: number[]}>}
 */
export async function getInt8Embedding(text) {
  const start = performance.now();

  // Check cache first
  const cacheKey = `int8:${text}`;
  if (EMBEDDING_CONFIG.cache?.enabled) {
    const cached = queryCache.get(cacheKey);
    if (cached) {
      cacheStats.hits++;
      return {
        int8: cached.int8,
        float: cached.float,
        cached: true,
        source: 'cache',
        latency_us: Math.round((performance.now() - start) * 1000),
      };
    }
  }

  // For Voyage, we can get int8 directly from API
  if (EMBEDDING_CONFIG.provider === 'voyage' && EMBEDDING_PROVIDERS.voyage.enabled) {
    try {
      const config = EMBEDDING_PROVIDERS.voyage;
      await rateLimiters.voyage.waitForSlot(text.length);
      cacheStats.apiCalls++;

      const [int8Result, floatResult] = await Promise.all([
        callVoyageAPI([text], config, { outputDtype: 'int8', inputType: 'query' }),
        callVoyageAPI([text], config, { inputType: 'query' }),
      ]);

      const result = {
        int8: new Int8Array(int8Result[0]),
        float: floatResult[0],
        cached: false,
        source: 'voyage-int8',
        latency_us: Math.round((performance.now() - start) * 1000),
      };

      if (EMBEDDING_CONFIG.cache?.enabled) {
        queryCache.set(cacheKey, { int8: result.int8, float: result.float });
      }

      return result;
    } catch (err) {
      console.warn(`Voyage int8 embedding failed: ${err.message}, falling back to local conversion`);
    }
  }

  // Fallback: get float embedding and convert locally
  const floatResult = await getEmbedding(text, { isQuery: true });
  const truncated = truncateForHNSW(floatResult.embedding);
  const int8 = floatToInt8(truncated);

  const result = {
    int8,
    float: floatResult.embedding,
    cached: false,
    source: 'local-conversion',
    latency_us: Math.round((performance.now() - start) * 1000),
  };

  if (EMBEDDING_CONFIG.cache?.enabled) {
    queryCache.set(cacheKey, { int8: result.int8, float: result.float });
  }

  return result;
}

/**
 * Warmup - preload models and initialize vocabulary
 *
 * CRITICAL: Warms up SemanticCache's local model (~2-3s) which is used
 * for cache key computation even when using remote providers like Voyage.
 * Without this, first semantic search has a 2-3s penalty.
 */
export async function warmup(options = {}) {
  const { initVocabulary = true, initSemanticCache = true } = options;

  console.log(`\nWarming up embedding service...`);
  console.log(`  Provider: ${EMBEDDING_CONFIG.provider} (${EMBEDDING_CONFIG.model})`);
  console.log(`  Dimensions: ${EMBEDDING_CONFIG.dimension}d full, ${EMBEDDING_CONFIG.hnswDimension}d HNSW`);

  const warmupStart = performance.now();

  // Parallel warmup of all components
  const warmupTasks = [];

  // 1. For local provider, preload the main model
  if (EMBEDDING_CONFIG.provider === 'local') {
    warmupTasks.push(
      getLocalPipeline().then(() => console.log(`  ✓ Local embedding model loaded`))
    );
  }

  // 2. CRITICAL: Pre-load SemanticCache's local model (used for cache keys even with remote providers)
  if (initSemanticCache && EMBEDDING_CONFIG.isRemote) {
    warmupTasks.push(
      semanticCache.getLocalModel().then(() => console.log(`  ✓ SemanticCache local model loaded`))
    );
  }

  // 3. For remote providers, test the connection (in parallel)
  if (EMBEDDING_CONFIG.isRemote) {
    warmupTasks.push(
      generateEmbedding('warmup')
        .then(() => console.log(`  ✓ ${EMBEDDING_CONFIG.provider} API connection verified`))
        .catch(err => console.log(`  ⚠ ${EMBEDDING_CONFIG.provider} API: ${err.message}`))
    );
  }

  // 4. Initialize vocabulary
  if (initVocabulary && EMBEDDING_CONFIG.cache?.enabled) {
    warmupTasks.push(
      vocabulary.load()
        .then(() => console.log(`  ✓ Vocabulary loaded (${vocabulary.size()} terms)`))
    );
  }

  // Run all warmup tasks in parallel
  await Promise.all(warmupTasks);

  const elapsed = Math.round(performance.now() - warmupStart);
  console.log(`Warmup complete in ${elapsed}ms\n`);
  return true;
}

export function isWarm() {
  return EMBEDDING_CONFIG.provider === 'local' ? localPipeline !== null : true;
}

export function getCacheStats() {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? ((cacheStats.hits + cacheStats.vocabularyHits) / total * 100).toFixed(1) : 0;
  return {
    ...cacheStats,
    total,
    hitRate: `${hitRate}%`,
    cacheSize: queryCache.size(),
    vocabularySize: vocabulary.size(),
    semanticCache: semanticCache.getStats(),
    circuitBreaker: circuitBreaker.getState(),
    provider: EMBEDDING_CONFIG.provider,
    model: EMBEDDING_CONFIG.model,
  };
}

export function getSemanticCacheStats() {
  return semanticCache.getStats();
}

export function clearCache() {
  queryCache.clear();
  cacheStats = { hits: 0, misses: 0, vocabularyHits: 0, apiCalls: 0 };
}

export function getFrequentQueries(threshold = 3) {
  return queryCache.getFrequentQueries(threshold);
}

export async function addToVocabulary(term) {
  await vocabulary.load();
  if (!vocabulary.has(term)) {
    const embedding = await embed(term);
    vocabulary.set(term, embedding);
    await vocabulary.save();
    return true;
  }
  return false;
}

export async function expandVocabulary(terms) {
  await vocabulary.load();
  let added = 0;
  for (const term of terms) {
    if (!vocabulary.has(term)) {
      const embedding = await embed(term);
      vocabulary.set(term, embedding);
      added++;
    }
  }
  if (added > 0) await vocabulary.save();
  return added;
}

/**
 * Auto-persist frequent queries from LRU cache to vocabulary
 * Call this periodically or on process exit to learn from usage patterns
 */
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

/**
 * Register auto-persist on process exit
 */
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

export function getModelInfo() {
  return {
    provider: EMBEDDING_CONFIG.provider,
    model: EMBEDDING_CONFIG.model,
    dimension: EMBEDDING_CONFIG.dimension,
    hnswDimension: EMBEDDING_CONFIG.hnswDimension,
    isRemote: EMBEDDING_CONFIG.isRemote,
    isWarm: isWarm(),
    cache: { enabled: EMBEDDING_CONFIG.cache?.enabled, ...getCacheStats() },
    availableProviders: Object.entries(EMBEDDING_PROVIDERS)
      .filter(([_, p]) => p.enabled)
      .map(([name, p]) => ({ name, model: p.model, priority: p.priority })),
  };
}

export async function unload() {
  localPipeline = null;
  isLoadingLocal = false;
  loadPromise = null;
  console.log('Local model unloaded');
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.includes('--warmup') || args.includes('warmup')) {
    await warmup({ initVocabulary: true });

    console.log('--- Cache Performance Test ---');
    const q1 = await getEmbedding('AuthService');
    console.log(`Query 1 "AuthService": ${q1.latency_us}μs (${q1.source})`);

    const q2 = await getEmbedding('AuthService');
    console.log(`Query 2 "AuthService": ${q2.latency_us}μs (${q2.source})`);

    const q3 = await getEmbedding('how does authentication work in this codebase');
    console.log(`Query 3 "how does auth work": ${q3.latency_us}μs (${q3.source})`);

    console.log('\nCache stats:', getCacheStats());

  } else if (args.includes('--test') || args.includes('test')) {
    console.log('Testing embedding service...\n');
    console.log('Model info:', JSON.stringify(getModelInfo(), null, 2));

    console.log('\nGenerating test embedding...');
    const result = await getEmbedding('function calculateTotal(items) { return items.reduce((sum, i) => sum + i.price, 0); }');
    console.log(`  Embedding dimension: ${result.embedding.length}`);
    console.log(`  Source: ${result.source}`);
    console.log(`  Latency: ${result.latency_us}μs`);

    console.log(`\nHNSW truncation: ${result.embedding.length}d → ${truncateForHNSW(result.embedding).length}d`);

  } else if (args.includes('--stats')) {
    await vocabulary.load();
    console.log('Embedding Service Stats:');
    console.log(JSON.stringify(getModelInfo(), null, 2));

  } else if (args.includes('--expand')) {
    const terms = args.slice(args.indexOf('--expand') + 1);
    if (terms.length === 0) {
      console.log('Usage: node embedding-service.js --expand term1 term2 ...');
    } else {
      await warmup({ initVocabulary: false });
      const added = await expandVocabulary(terms);
      console.log(`Added ${added} new terms to vocabulary`);
    }

  } else {
    console.log(`
Embedding Service v2.2 (SOTA December 2025)

Usage:
  node embedding-service.js warmup     Preload model + initialize vocabulary
  node embedding-service.js test       Test embedding generation
  node embedding-service.js --stats    Show model and cache info
  node embedding-service.js --expand term1 term2   Add terms to vocabulary

Active Provider: ${EMBEDDING_CONFIG.provider} (${EMBEDDING_CONFIG.model})
Dimensions: ${EMBEDDING_CONFIG.dimension}d full, ${EMBEDDING_CONFIG.hnswDimension}d HNSW

Available Providers:
${Object.entries(EMBEDDING_PROVIDERS)
  .map(([name, p]) => `  ${p.enabled ? '✓' : '✗'} ${name}: ${p.model} (priority ${p.priority})`)
  .join('\n')}
`);
  }
}

// Deprecated alias for backward compatibility
const int8DotProduct = int8CosineSimilarity;

export default {
  getEmbedding,
  embed,
  getEmbeddings,
  truncateForHNSW,
  // Quantization (P0: Binary + Int8)
  floatToBinary,
  floatToInt8,
  hammingDistance,
  int8CosineSimilarity,
  int8DotProduct,  // Deprecated alias
  getBinaryEmbedding,
  getInt8Embedding,
  // Core functions
  warmup,
  isWarm,
  getModelInfo,
  unload,
  getCacheStats,
  clearCache,
  addToVocabulary,
  expandVocabulary,
  getFrequentQueries,
  generateEmbedding,
  generateEmbeddings,
  // L0/L2: Batch inference constants and bucketed entry point
  INDEXING_MAX_LENGTH,
  QUERY_MAX_LENGTH,
  callLocalModelBucketed,
  // V2: Concurrent-safe rate limiter
  TimeWindowRateLimiter,
  // V2b: Compression internals (exported for testing)
  looksLikeJson,
  _providerCompressionSupport,
};
