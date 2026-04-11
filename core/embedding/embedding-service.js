#!/usr/bin/env node

/**
 * Embedding Service v2.2 (SOTA December 2025)
 *
 * Facade module - imports from specialized sub-modules and re-exports all public APIs.
 * Hub functions (generateEmbedding, getEmbedding, etc.) live here because they
 * orchestrate across remote, local-model, and cache sub-modules.
 */

import { EMBEDDING_CONFIG, EMBEDDING_PROVIDERS } from '../infrastructure/config/index.js';
import { wasmHammingDistance, wasmInt8Cosine, wasmAsymmetricDistance, wasmInt8BatchDot, isWasmAvailable } from '../infrastructure/simd-distance.js';

// --- Sub-module imports (no circular deps) ---
import {
  circuitBreaker,
  _providerCompressionSupport,
  looksLikeJson,
  RateLimiter,
  TimeWindowRateLimiter,
  rateLimiters,
  timeWindowLimiters,
  callVoyageAPI,
  callMistralAPI,
  callJinaAPI,
} from './embedding-remote.js';

import {
  INDEXING_MAX_LENGTH,
  QUERY_MAX_LENGTH,
  callLocalModel,
  callLocalModelBucketed,
  applyLocalQueryPrefix,
  getLocalPipeline,
  unloadLocalModel,
  isLocalModelLoaded,
  configureLocalModelRuntime,
  resetLocalModelRuntime,
  initEmbeddingPool,
  shutdownEmbeddingPool,
  getEmbeddingPool,
} from './embedding-local-model.js';

import {
  queryCache,
  vocabulary,
  semanticCache,
  queryDeduplicator,
  queryStats,
  cacheStats,
  getCacheStats as _getCacheStats,
  getSemanticCacheStats,
  clearCache,
  getFrequentQueries,
  addToVocabulary as _addToVocabulary,
  expandVocabulary as _expandVocabulary,
  autoPersistFrequentQueries,
  registerAutoPersistOnExit,
} from './embedding-cache.js';

// Re-export sub-module symbols that were previously named exports
export { circuitBreaker };
export { TimeWindowRateLimiter };

// =============================================================================
// UNIFIED EMBEDDING SERVICE (hub functions)
// =============================================================================

/** Generate embedding using the active provider with circuit breaker */
async function generateEmbedding(text, provider = EMBEDDING_CONFIG.provider, isQuery = false) {
  const localText = isQuery ? applyLocalQueryPrefix(text) : text;
  const localMaxLength = isQuery ? QUERY_MAX_LENGTH : INDEXING_MAX_LENGTH;

  const config = EMBEDDING_PROVIDERS[provider];
  if (!config || !config.enabled) {
    return (await callLocalModel([localText], { maxLength: localMaxLength }))[0];
  }

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

      if (provider !== 'local') circuitBreaker.recordSuccess();
      return result;
    } catch (err) {
      lastError = err;
      if (provider !== 'local') circuitBreaker.recordFailure();
      const delay = (rateLimit?.retryDelay || 1000) * Math.pow(rateLimit?.backoffMultiplier || 2, attempt);
      console.warn(`Embedding attempt ${attempt + 1} failed: ${err.message}, retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.warn(`All attempts failed for ${provider}, falling back to local model`);
  return (await callLocalModel([localText], { maxLength: localMaxLength }))[0];
}

/** Generate embeddings for multiple texts (batched, V2 concurrent) */
async function generateEmbeddings(texts, provider = EMBEDDING_CONFIG.provider, options = {}) {
  if (!texts || texts.length === 0) return [];

  const localBucketOptions = {
    maxLength: options.maxLength,
    hardCap: options.hardCap,
    resolveHardCap: options.resolveHardCap,
    batchingSafety: options.batchingSafety,
    onProgress: options.onProgress,
  };

  const config = EMBEDDING_PROVIDERS[provider];
  // Local model: always use direct bucketed path for global length-sorting.
  // The API-style batched path (below) splits texts into batchSize=32 chunks
  // which destroys length-sorting and causes massive padding waste (5.5x slower).
  if (!config || !config.enabled || provider === 'local') {
    return callLocalModelBucketed(texts, localBucketOptions);
  }

  const batchSize = config.batchSize || 32;
  const concurrency = options.concurrency || 4;

  const apiOptions = {};
  if (options.outputDimension) apiOptions.outputDimension = options.outputDimension;
  if (options.inputType) apiOptions.inputType = options.inputType;

  const batches = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }

  const results = [];

  async function embedBatch(batch) {
    if (timeWindowLimiters[provider]) {
      await timeWindowLimiters[provider].acquire();
    }
    cacheStats.apiCalls++;

    switch (provider) {
      case 'voyage': return callVoyageAPI(batch, config, apiOptions);
      case 'mistral': return callMistralAPI(batch, config, apiOptions);
      case 'jina': return callJinaAPI(batch, config, apiOptions);
      case 'local': return callLocalModelBucketed(batch, localBucketOptions);
      default: throw new Error(`Unknown provider: ${provider}`);
    }
  }

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

/** Get embedding with caching (LRU -> Vocabulary -> Semantic Cache -> API) */
export async function getEmbedding(text, options = {}) {
  const { useCache = true, useSemanticCache = true, isQuery = false } = options;
  const start = performance.now();
  const cacheKey = isQuery ? `q:${text}` : text;

  if (useCache && EMBEDDING_CONFIG.cache?.enabled) {
    const cached = queryCache.get(cacheKey);
    if (cached) {
      cacheStats.hits++;
      return { embedding: cached, cached: true, source: 'lru', latency_us: Math.round((performance.now() - start) * 1000) };
    }

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

  if (isQuery && useSemanticCache && EMBEDDING_CONFIG.isRemote) {
    const semanticResult = await semanticCache.findSimilar(text);
    if (semanticResult?.voyageEmb) {
      cacheStats.hits++;
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
    var localEmbForCache = semanticResult?.localEmb;
  }

  cacheStats.misses++;

  const inflight = queryDeduplicator.get(cacheKey);
  if (inflight) {
    const result = await inflight;
    return { ...result, source: 'deduplicated', latency_us: Math.round((performance.now() - start) * 1000) };
  }

  const embeddingPromise = generateEmbedding(text, EMBEDDING_CONFIG.provider, isQuery);
  queryDeduplicator.set(cacheKey, embeddingPromise.then(emb => ({ embedding: emb })));
  const embedding = await embeddingPromise;

  if (useCache && EMBEDDING_CONFIG.cache?.enabled) {
    queryCache.set(cacheKey, embedding);
    if (localEmbForCache) {
      semanticCache.add(text, localEmbForCache, embedding);
    }
    if (isQuery && EMBEDDING_CONFIG.cache?.autoExpand) {
      await queryStats.load();
      const usageCount = queryStats.increment(text);
      queryStats.save().catch(() => {});
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

export async function embed(text, options = {}) {
  const result = await getEmbedding(text, options);
  return result.embedding;
}

export async function getEmbeddings(texts, options = {}) {
  const {
    useCache = true,
    provider = EMBEDDING_CONFIG.provider,
    providerOptions = {},
    onProgress,
  } = options;

  const hasShapeAffectingProviderOptions =
    provider !== EMBEDDING_CONFIG.provider ||
    providerOptions.maxLength !== undefined ||
    providerOptions.outputDimension !== undefined ||
    providerOptions.outputDtype !== undefined ||
    providerOptions.inputType !== undefined;
  const allowCache = useCache && !hasShapeAffectingProviderOptions;

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

  if (uncachedTexts.length > 0) {
    const newEmbeddings = await generateEmbeddings(uncachedTexts, provider, { ...providerOptions, onProgress });
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

// =============================================================================
// QUANTIZATION / MATH RE-EXPORTS (canonical impls in infrastructure/quantization.js)
// =============================================================================

import {
  truncateForHNSW as _truncateForHNSW,
  fisherYatesShuffle,
  floatToBinary,
  computeCentroid,
  generateSignVector,
  walshHadamardTransform,
  fastRotate,
  asymmetricDocEncode,
  asymmetricQueryEncode,
  floatToInt8,
  normalizedFloatToInt8,
} from '../infrastructure/quantization.js';

export { fisherYatesShuffle, floatToBinary, computeCentroid, generateSignVector, walshHadamardTransform, fastRotate, asymmetricDocEncode, asymmetricQueryEncode };

/**
 * Truncate embedding to target dimension and L2 re-normalize.
 * Thin wrapper that supplies the domain-specific default dimension.
 * @param {number[]} embedding
 * @param {number} [targetDim] - defaults to EMBEDDING_CONFIG.hnswDimension
 */
export function truncateForHNSW(embedding, targetDim = EMBEDDING_CONFIG.hnswDimension) {
  return _truncateForHNSW(embedding, targetDim);
}

/**
 * Asymmetric distance: 1-bit document vs 4-bit query.
 * Approximates squared distance via asymmetric dot product + correction.
 */
export function asymmetricDistance(docBinary, queryInt4, queryNorm) {
  // Delegate to WASM when available
  if (isWasmAvailable()) {
    // WASM version expects integer-scaled queryNorm
    return wasmAsymmetricDistance(docBinary, queryInt4, Math.round(queryNorm));
  }
  let approxDot = 0;
  const dim = queryInt4.length;
  for (let byteIdx = 0; byteIdx < docBinary.length; byteIdx++) {
    let byte = docBinary[byteIdx];
    const baseIdx = byteIdx * 8;
    for (let bit = 7; bit >= 0; bit--) {
      const idx = baseIdx + (7 - bit);
      if (idx >= dim) break;
      if (byte & (1 << bit)) {
        approxDot += queryInt4[idx];
      } else {
        approxDot -= queryInt4[idx];
      }
    }
  }
  return queryNorm - 2 * approxDot;
}

export { floatToInt8, normalizedFloatToInt8 };

/**
 * Batch int8 dot product scoring for normalized vectors.
 * Returns scores in cosine-similarity scale [~-1, ~1].
 *
 * For int8 vectors from L2-normalized floats:
 *   rawDot ≈ 127² × cos(a_float, b_float)
 *   normalizedScore = rawDot / (127 * 127)
 *
 * @param {Int8Array} query - Query int8 vector (from normalizedFloatToInt8)
 * @param {Int8Array[]} candidates - Candidate int8 vectors
 * @returns {Float64Array} Cosine-approximation scores
 */
export function int8BatchDotScores(query, candidates) {
  const rawDots = wasmInt8BatchDot(query, candidates);
  const scale = 1.0 / (127 * 127);
  const scores = new Float64Array(rawDots.length);
  for (let i = 0; i < rawDots.length; i++) {
    scores[i] = rawDots[i] * scale;
  }
  return scores;
}

const POPCOUNT_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  POPCOUNT_TABLE[i] = (i & 1) + POPCOUNT_TABLE[i >> 1];
}

export function hammingDistance(a, b) {
  if (a.length !== b.length) {
    throw new Error(`Hamming dimension mismatch: ${a.length} vs ${b.length}`);
  }
  if (isWasmAvailable()) {
    return wasmHammingDistance(a, b);
  }
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    distance += POPCOUNT_TABLE[a[i] ^ b[i]];
  }
  return distance;
}

export function int8CosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(`int8CosineSimilarity dimension mismatch: ${a.length} vs ${b.length}`);
  }
  if (isWasmAvailable()) {
    return wasmInt8Cosine(a, b);
  }
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

/** @deprecated Use int8CosineSimilarity (for cosine) or int8BatchDotScores (for normalized dot). */
export { int8CosineSimilarity as int8DotProduct };

// =============================================================================
// BINARY / INT8 EMBEDDING
// =============================================================================

export async function getBinaryEmbedding(text) {
  const start = performance.now();
  const cacheKey = `binary:${text}`;
  if (EMBEDDING_CONFIG.cache?.enabled) {
    const cached = queryCache.get(cacheKey);
    if (cached) {
      cacheStats.hits++;
      return { binary: cached.binary, float: cached.float, cached: true, source: 'cache', latency_us: Math.round((performance.now() - start) * 1000) };
    }
  }

  // Voyage-native binary (outputDtype: 'ubinary') bypasses the asymmetric
  // quantization pipeline. All providers use client-side quantization so
  // query vectors match the index-time center→rotate→quantize encoding.

  const floatResult = await getEmbedding(text, { isQuery: true });
  const truncated = truncateForHNSW(floatResult.embedding);
  const binary = floatToBinary(truncated);
  const result = { binary, float: floatResult.embedding, cached: false, source: 'client-quantized', latency_us: Math.round((performance.now() - start) * 1000) };
  if (EMBEDDING_CONFIG.cache?.enabled) queryCache.set(cacheKey, { binary: result.binary, float: result.float });
  return result;
}

export async function getInt8Embedding(text) {
  const start = performance.now();
  const cacheKey = `int8:${text}`;
  if (EMBEDDING_CONFIG.cache?.enabled) {
    const cached = queryCache.get(cacheKey);
    if (cached) {
      cacheStats.hits++;
      return { int8: cached.int8, float: cached.float, cached: true, source: 'cache', latency_us: Math.round((performance.now() - start) * 1000) };
    }
  }

  // All providers use client-side int8 quantization for consistency.

  const floatResult = await getEmbedding(text, { isQuery: true });
  const truncated = truncateForHNSW(floatResult.embedding);
  const int8 = floatToInt8(truncated);
  const result = { int8, float: floatResult.embedding, cached: false, source: 'client-quantized', latency_us: Math.round((performance.now() - start) * 1000) };
  if (EMBEDDING_CONFIG.cache?.enabled) queryCache.set(cacheKey, { int8: result.int8, float: result.float });
  return result;
}

// =============================================================================
// WARMUP / LIFECYCLE
// =============================================================================

export async function warmup(options = {}) {
  const { initVocabulary = true, initSemanticCache = true } = options;

  console.log(`\nWarming up embedding service...`);
  console.log(`  Provider: ${EMBEDDING_CONFIG.provider} (${EMBEDDING_CONFIG.model})`);
  console.log(`  Dimensions: ${EMBEDDING_CONFIG.dimension}d full, ${EMBEDDING_CONFIG.hnswDimension}d HNSW`);

  const warmupStart = performance.now();
  const warmupTasks = [];

  if (EMBEDDING_CONFIG.provider === 'local') {
    warmupTasks.push(
      getLocalPipeline().then(() => console.log(`  ✓ Local embedding model loaded`))
    );
  }

  if (initSemanticCache && EMBEDDING_CONFIG.isRemote) {
    warmupTasks.push(
      semanticCache.getLocalModel().then(() => console.log(`  ✓ SemanticCache local model loaded`))
    );
  }

  if (EMBEDDING_CONFIG.isRemote) {
    warmupTasks.push(
      generateEmbedding('warmup')
        .then(() => console.log(`  ✓ ${EMBEDDING_CONFIG.provider} API connection verified`))
        .catch(err => console.log(`  ⚠ ${EMBEDDING_CONFIG.provider} API: ${err.message}`))
    );
  }

  if (initVocabulary && EMBEDDING_CONFIG.cache?.enabled) {
    warmupTasks.push(
      vocabulary.load()
        .then(() => console.log(`  ✓ Vocabulary loaded (${vocabulary.size()} terms)`))
    );
  }

  await Promise.all(warmupTasks);

  const elapsed = Math.round(performance.now() - warmupStart);
  console.log(`Warmup complete in ${elapsed}ms\n`);
  return true;
}

export function isWarm() {
  return EMBEDDING_CONFIG.provider === 'local' ? isLocalModelLoaded() : true;
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
  await unloadLocalModel();
  console.log('Local model unloaded');
}

// =============================================================================
// WRAPPED CACHE EXPORTS (inject dependencies to avoid circular imports)
// =============================================================================

export function getCacheStats() {
  return _getCacheStats(circuitBreaker.getState());
}

export async function addToVocabulary(term) {
  return _addToVocabulary(term, embed);
}

export async function expandVocabulary(terms) {
  return _expandVocabulary(terms, embed);
}

// Re-export cache functions that need no wrapping
export { getSemanticCacheStats, clearCache, getFrequentQueries, autoPersistFrequentQueries, registerAutoPersistOnExit };

// Named exports for internal generator functions (used by vocab-warmer)
export { generateEmbedding, generateEmbeddings };

// Worker pool lifecycle (Phase 2 — parallel indexing)
export {
  configureLocalModelRuntime,
  resetLocalModelRuntime,
  initEmbeddingPool,
  shutdownEmbeddingPool,
  getEmbeddingPool,
};

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
  floatToBinary,
  floatToInt8,
  normalizedFloatToInt8,
  hammingDistance,
  int8CosineSimilarity,
  int8DotProduct,
  int8BatchDotScores,
  getBinaryEmbedding,
  getInt8Embedding,
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
  INDEXING_MAX_LENGTH,
  QUERY_MAX_LENGTH,
  callLocalModelBucketed,
  TimeWindowRateLimiter,
  looksLikeJson,
  _providerCompressionSupport,
};
