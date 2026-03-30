#!/usr/bin/env node

/**
 * FlashRank - Local Reranker Fallback
 *
 * Lightweight cross-encoder reranking when Voyage AI is unavailable.
 * Uses TinyBERT-L2-v2 for 8x faster local inference than MiniLM.
 *
 * Target: ~15ms for 50 documents reranking
 */

import { RERANK_CONFIG, LOCAL_RERANKER_CONFIG, isVoyageAvailable, getVoyageApiKey, isJinaRerankerAvailable, getJinaRerankerApiKey, shouldUseLocalReranker } from './config.js';
import { getGlobalLocalReranker } from './local-reranker.js';
import { withOnnxMutex } from './onnx-mutex.js';
import { buildSessionOptions, loadModelWithSessionOptions, warnIfGraphNotMaterialized } from './onnx-session-utils.js';
import { isAppleSilicon, isCoreMLProviderAvailable } from './coreml-provider.js';

// =============================================================================
// FLASHRANK RERANKER
// =============================================================================

// Model override via environment variable for A/B testing
const FLASHRANK_MODEL_OVERRIDE = process.env.FLASHRANK_MODEL || null;

export class FlashRankReranker {
  constructor(options = {}) {
    this.model = options.model || RERANK_CONFIG.flashrank.model;
    this.maxDocLength = options.maxDocLength || RERANK_CONFIG.flashrank.maxDocLength;
    this.pipeline = null;
    this.tokenizer = null;
    // Support model override for A/B testing
    this.modelOverride = FLASHRANK_MODEL_OVERRIDE;
  }

  /**
   * Initialize the reranker model
   *
   * CRITICAL: Uses feature-extraction pipeline with CLS pooling, NOT text-classification.
   * The MS-MARCO cross-encoder outputs raw logit scores via CLS token, not probabilities.
   *
   * Score semantics (verified empirically):
   * - Range: roughly [-10, -5] for typical code search queries
   * - Higher (closer to 0) = more relevant
   * - Very relevant: > -6.5
   * - Relevant: -6.5 to -8.0
   * - Weak: -8.0 to -9.0
   * - Irrelevant: < -9.0
   */
  async init() {
    if (this.pipeline) return;

    try {
      // Use @huggingface/transformers when available (newer ONNX runtime, fixes crashes on some platforms)
      let transformers;
      try {
        transformers = await import('@huggingface/transformers');
      } catch {
        transformers = await import('@xenova/transformers');
      }

      const modelPath = this.modelOverride || 'Xenova/ms-marco-TinyBERT-L-2-v2';
      const coremlAvailable = isAppleSilicon() ? await isCoreMLProviderAvailable() : false;
      const sessionOpts = buildSessionOptions(`${modelPath}:flashrank:q8`, 'flashrank', coremlAvailable);

      const loadPipeline = (opts) => loadModelWithSessionOptions(
        (o) => transformers.pipeline('feature-extraction', modelPath, o),
        { quantized: true },
        opts,
      );

      try {
        this.pipeline = await loadPipeline(sessionOpts);
      } catch (loadErr) {
        if (sessionOpts.executionProviders?.some(ep => (typeof ep === 'string' ? ep : ep.name) === 'coreml')) {
          // MLProgram failed — try NeuralNetwork format
          console.warn(`FlashRank: CoreML MLProgram failed (${loadErr.message}), trying NeuralNetwork`);
          const { getCoreMLExecutionProviders } = await import('./coreml-provider.js');
          const nnOpts = buildSessionOptions(`${modelPath}:flashrank:q8`, 'flashrank');
          nnOpts.executionProviders = getCoreMLExecutionProviders(false);
          try {
            this.pipeline = await loadPipeline(nnOpts);
          } catch {
            console.warn('FlashRank: CoreML NeuralNetwork also failed, falling back to CPU');
            this.pipeline = await loadPipeline(buildSessionOptions(`${modelPath}:flashrank:q8`, 'flashrank'));
          }
        } else {
          throw loadErr;
        }
      }
      warnIfGraphNotMaterialized('FlashRank', sessionOpts);

      console.log(`FlashRank: Loaded local reranker model (${modelPath})`);
    } catch (err) {
      console.log(`FlashRank: Could not load model: ${err.message}`);
      this.pipeline = null;
    }
  }

  /**
   * Rerank documents using local cross-encoder
   */
  async rerank(query, documents, topK = 10) {
    const start = Date.now();

    // CRITICAL: Initialize model BEFORE checking this.pipeline
    // Previously init() was inside if(this.pipeline), so it never ran on cold call
    await this.init();

    // Prepare query-document pairs
    const pairs = documents.map((doc, index) => ({
      index,
      text: typeof doc === 'string' ? doc : doc.content || doc.text || '',
      original: doc,
    }));

    // Truncate documents for efficiency
    const truncatedPairs = pairs.map(p => ({
      ...p,
      text: p.text.slice(0, this.maxDocLength),
    }));

    let scores;

    if (this.pipeline) {
      // Use cross-encoder model with CLS pooling
      // Output is raw logit score (higher = more relevant, typically [-10, -5] range)

      // Process sequentially with global ONNX mutex to prevent concurrent inference crashes
      scores = await withOnnxMutex(async () => {
        const results = [];
        for (const pair of truncatedPairs) {
          try {
            // Cross-encoder takes query + document as input
            const input = `${query} [SEP] ${pair.text}`;
            const result = await this.pipeline(input, { pooling: 'cls' });

            // CLS pooling returns single logit score
            const score = result.data?.[0] ?? -10;  // Default to low score on failure
            results.push({ ...pair, score });
          } catch (err) {
            results.push({ ...pair, score: -10 });  // Low score on error
          }
        }
        return results;
      });
    } else {
      // Fallback: simple keyword matching score
      scores = truncatedPairs.map(pair => {
        const score = this.simpleScore(query, pair.text);
        return { ...pair, score };
      });
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    // Return top K results
    const results = scores.slice(0, topK).map((item, rank) => ({
      ...item.original,
      flashRankScore: item.score,
      originalIndex: item.index,
      newRank: rank + 1,
      source: 'flashrank',
    }));

    const latency = Date.now() - start;

    return {
      results,
      latency_ms: latency,
      model: this.pipeline ? 'ms-marco-TinyBERT-L-2-v2' : 'keyword-fallback',
    };
  }

  /**
   * Simple keyword-based scoring fallback
   */
  simpleScore(query, document) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const docLower = document.toLowerCase();

    let score = 0;
    for (const word of queryWords) {
      // Count occurrences
      const regex = new RegExp(word, 'gi');
      const matches = docLower.match(regex);
      if (matches) {
        score += matches.length;

        // Bonus for exact word match
        const wordRegex = new RegExp(`\\b${word}\\b`, 'gi');
        const exactMatches = docLower.match(wordRegex);
        if (exactMatches) {
          score += exactMatches.length * 2;
        }
      }
    }

    // Normalize by query length
    return score / queryWords.length;
  }

  /**
   * Batched reranking - true transformer batch inference
   *
   * Uses transformers.js native batching for significant speedup.
   * Instead of N forward passes, processes all documents in batches.
   *
   * Expected improvement: 10-20x faster than sequential rerank()
   *
   * @param {string} query - Search query
   * @param {Array} documents - Documents to rerank
   * @param {number} topK - Number of results to return
   * @returns {Promise<{results: Array, latency_ms: number, model: string}>}
   */
  async rerankBatched(query, documents, topK = 10) {
    const start = Date.now();
    await this.init();

    // Prepare query-document pairs
    const pairs = documents.map((doc, index) => ({
      index,
      text: (typeof doc === 'string' ? doc : doc.content || doc.text || '').slice(0, this.maxDocLength),
      original: doc,
    }));

    let scores;

    if (this.pipeline) {
      // Process inputs with CLS pooling for cross-encoder logit scores
      // Use global ONNX mutex to prevent concurrent inference crashes
      const inputs = pairs.map(pair => `${query} [SEP] ${pair.text}`);

      const allResults = await withOnnxMutex(async () => {
        const results = [];
        for (const input of inputs) {
          try {
            const result = await this.pipeline(input, { pooling: 'cls' });
            // CLS pooling returns single logit score in result.data[0]
            results.push(result.data?.[0] ?? -10);
          } catch (err) {
            results.push(-10);
          }
        }
        return results;
      });

      // Map results back to pairs
      scores = pairs.map((pair, i) => ({
        ...pair,
        score: allResults[i] ?? -10,
      }));
    } else {
      // Fallback to simple scoring
      scores = pairs.map(pair => ({
        ...pair,
        score: this.simpleScore(query, pair.text),
      }));
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    // Return top K results
    const results = scores.slice(0, topK).map((item, rank) => ({
      ...item.original,
      flashRankScore: item.score,
      originalIndex: item.index,
      newRank: rank + 1,
      source: 'flashrank-batched',
    }));

    const latency = Date.now() - start;

    return {
      results,
      latency_ms: latency,
      model: this.pipeline ? 'ms-marco-TinyBERT-L-2-v2-batched' : 'keyword-fallback',
    };
  }
}

// =============================================================================
// VOYAGE AI RERANKER
// =============================================================================

export class VoyageReranker {
  constructor(options = {}) {
    this.model = options.model || RERANK_CONFIG.voyage.model;
    this.endpoint = options.endpoint || RERANK_CONFIG.voyage.endpoint;
    this.apiKey = options.apiKey || getVoyageApiKey();
    this.maxDocuments = options.maxDocuments || RERANK_CONFIG.voyage.maxDocuments;
  }

  /**
   * Check if Voyage AI is available
   */
  isAvailable() {
    return this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Rerank documents using Voyage AI
   *
   * Features:
   * - Request timeout (default 30s) via AbortController
   * - Retry with exponential backoff for transient failures
   * - Input validation for query and documents
   *
   * @param {string} query - Search query
   * @param {Array} documents - Documents to rerank
   * @param {number} topK - Number of results to return
   * @returns {Promise<{results: Array, latency_ms: number, model: string}>}
   */
  async rerank(query, documents, topK = 10) {
    // Input validation
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Query must be a non-empty string');
    }
    if (!Array.isArray(documents) || documents.length === 0) {
      return { results: [], latency_ms: 0, model: this.model };
    }
    if (!this.isAvailable()) {
      throw new Error('Voyage API key not configured');
    }

    const start = Date.now();
    const timeout = RERANK_CONFIG.timeout || 30000;
    const maxRetries = RERANK_CONFIG.maxRetries || 2;
    const retryDelay = RERANK_CONFIG.retryDelayMs || 100;
    const maxDocLength = RERANK_CONFIG.maxDocTruncation?.voyage || 4000;

    // Prepare documents (truncate to avoid token limits)
    const preparedDocs = documents.slice(0, this.maxDocuments).map(doc => {
      const text = typeof doc === 'string' ? doc : doc.content || doc.text || '';
      return text.slice(0, maxDocLength);
    });

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            documents: preparedDocs,
            model: this.model,
            top_k: topK,
            return_documents: false,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          // Don't retry on 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) {
            throw new Error(`Voyage API error (${response.status}): ${errorText}`);
          }
          // Retry on 5xx or network errors (will be caught and retried)
          throw new Error(`Voyage API error (${response.status}): ${errorText}`);
        }

        const result = await response.json();

        // Voyage API returns 'data' array with index + relevance_score
        const rankedData = result.data || result.results || [];
        const results = rankedData.map((r, rank) => ({
          ...documents[r.index],
          voyageScore: r.relevance_score,
          originalIndex: r.index,
          newRank: rank + 1,
          source: 'voyage',
        }));

        return {
          results,
          latency_ms: Date.now() - start,
          model: this.model,
        };
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;

        // Don't retry on abort (timeout) or client errors
        if (err.name === 'AbortError') {
          const error = new Error(`Voyage reranking timed out after ${timeout}ms`);
          error.cause = err;
          throw error;
        }

        // Retry on network errors or 5xx with exponential backoff
        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
    }

    // All retries exhausted
    const error = new Error(`Voyage reranking failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
    error.cause = lastError;
    throw error;
  }
}

// =============================================================================
// JINA RERANKER v3
// =============================================================================

export class JinaReranker {
  constructor(options = {}) {
    this.model = options.model || RERANK_CONFIG.jina.model;
    this.endpoint = options.endpoint || RERANK_CONFIG.jina.endpoint;
    this.apiKey = options.apiKey || getJinaRerankerApiKey();
    this.maxDocuments = options.maxDocuments || RERANK_CONFIG.jina.maxDocuments;
  }

  /**
   * Check if Jina Reranker is available
   */
  isAvailable() {
    return this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Rerank documents using Jina Reranker v3
   *
   * API: POST https://api.jina.ai/v1/rerank
   * Body: {model, query, documents, top_n, return_documents}
   * Response: {results: [{index, relevance_score}, ...]}
   *
   * Features:
   * - Request timeout (default 30s) via AbortController
   * - Retry with exponential backoff for transient failures
   * - Input validation for query and documents
   *
   * @param {string} query - Search query
   * @param {Array} documents - Documents to rerank
   * @param {number} topK - Number of results to return
   * @returns {Promise<{results: Array, latency_ms: number, model: string}>}
   */
  async rerank(query, documents, topK = 10) {
    // Input validation
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Query must be a non-empty string');
    }
    if (!Array.isArray(documents) || documents.length === 0) {
      return { results: [], latency_ms: 0, model: this.model };
    }
    if (!this.isAvailable()) {
      throw new Error('Jina API key not configured');
    }

    const start = Date.now();
    const timeout = RERANK_CONFIG.timeout || 30000;
    const maxRetries = RERANK_CONFIG.maxRetries || 2;
    const retryDelay = RERANK_CONFIG.retryDelayMs || 100;
    const maxDocLength = RERANK_CONFIG.maxDocTruncation?.jina || 8000;

    // Prepare documents (Jina v3 has 131K context, but limit per-doc for efficiency)
    const preparedDocs = documents.slice(0, this.maxDocuments).map(doc => {
      const text = typeof doc === 'string' ? doc : doc.content || doc.text || '';
      return text.slice(0, maxDocLength);
    });

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            documents: preparedDocs,
            model: this.model,
            top_n: topK,  // Jina uses top_n, not top_k
            return_documents: false,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          // Don't retry on 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) {
            throw new Error(`Jina API error (${response.status}): ${errorText}`);
          }
          // Retry on 5xx or network errors (will be caught and retried)
          throw new Error(`Jina API error (${response.status}): ${errorText}`);
        }

        const result = await response.json();

        // Jina API returns 'results' array with index + relevance_score
        const rankedData = result.results || [];
        if (!rankedData.length && documents.length > 0) {
          throw new Error('Jina API returned empty results');
        }

        const results = rankedData.map((r, rank) => ({
          ...documents[r.index],
          jinaScore: r.relevance_score,
          originalIndex: r.index,
          newRank: rank + 1,
          source: 'jina',
        }));

        return {
          results,
          latency_ms: Date.now() - start,
          model: this.model,
        };
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;

        // Don't retry on abort (timeout) or client errors
        if (err.name === 'AbortError') {
          const error = new Error(`Jina reranking timed out after ${timeout}ms`);
          error.cause = err;
          throw error;
        }

        // Retry on network errors or 5xx with exponential backoff
        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
    }

    // All retries exhausted
    const error = new Error(`Jina reranking failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
    error.cause = lastError;
    throw error;
  }
}

// =============================================================================
// UNIFIED RERANKER
// =============================================================================

export class Reranker {
  constructor(options = {}) {
    this.voyageReranker = new VoyageReranker(options);
    this.jinaReranker = new JinaReranker(options);
    this.flashRankReranker = new FlashRankReranker(options);
    this.localReranker = getGlobalLocalReranker();  // Use preheated global instance
    this.preferVoyage = options.preferVoyage !== false;
    this.preferJina = options.preferJina !== false;
    this.useLocalReranker = options.useLocalReranker ?? shouldUseLocalReranker();
  }

  /**
   * Rerank documents using the best available direct cross-encoder.
   * FlashRank is intentionally excluded from the default path.
   *
   * @param {string} query
   * @param {Array} documents
   * @param {number} topK
   * @param {object} options - { forceLocal, forceJina }
   */
  async rerank(query, documents, topK = 10, options = {}) {
    const {
      forceLocal = false,
      forceJina = false,
    } = options;

    // Preserve the explicit/manual FlashRank escape hatch.
    if (forceLocal) {
      await this.flashRankReranker.init();
      return await this.flashRankReranker.rerank(query, documents, topK);
    }

    // Force Jina for testing
    if (forceJina && this.jinaReranker.isAvailable()) {
      return await this.jinaReranker.rerank(query, documents, topK);
    }

    return this.rerankDirect(query, documents, topK);
  }

  /**
   * Direct cross-encoder reranking, bypassing FlashRank.
   * Uses the best available code-aware reranker: local ModernBERT > Jina > Voyage.
   * Called by the cascaded scorer (Section 26) for ambiguous/unscored candidates.
   *
   * @param {string} query
   * @param {Array} documents
   * @param {number} topK
   * @returns {Promise<{results: Array, latency_ms: number, model: string}>}
   */
  async rerankDirect(query, documents, topK = 10) {
    if (this.useLocalReranker && this.localReranker.isAvailable()) {
      return this.localReranker.rerank(query, documents, topK);
    }
    if (this.preferJina && this.jinaReranker.isAvailable()) {
      return this.jinaReranker.rerank(query, documents, topK);
    }
    if (this.preferVoyage && this.voyageReranker.isAvailable()) {
      return this.voyageReranker.rerank(query, documents, topK);
    }
    throw new Error('No direct cross-encoder available');
  }

  /**
   * Fast local reranking only (FlashRank, ~15ms)
   * Use when embeddings are cached and you don't want remote reranker latency
   */
  async localRerank(query, documents, topK = 10) {
    await this.flashRankReranker.init();
    return await this.flashRankReranker.rerank(query, documents, topK);
  }

  /**
   * Get reranker status
   */
  getStatus() {
    return {
      voyageAvailable: this.voyageReranker.isAvailable(),
      voyageModel: RERANK_CONFIG.voyage.model,
      jinaAvailable: this.jinaReranker.isAvailable(),
      jinaModel: RERANK_CONFIG.jina.model,
      flashRankModel: RERANK_CONFIG.flashrank.model,
      localRerankerAvailable: this.localReranker.isAvailable(),
      localRerankerModel: LOCAL_RERANKER_CONFIG.model.name,
      useLocalReranker: this.useLocalReranker,
      preferVoyage: this.preferVoyage,
      preferJina: this.preferJina,
    };
  }
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  console.log(`
FlashRank Reranker CLI

Usage:
  flashrank.js status           Check reranker availability
  flashrank.js test             Run performance test
  flashrank.js rerank <query>   Rerank sample documents

Options:
  --voyage        Force Voyage AI (requires VOYAGEAI_API_KEY)
  --jina          Force Jina Reranker v3 (requires JINA_API_KEY)
  --local         Force local FlashRank (TinyBERT)
  --local-modernbert  Force local ModernBERT INT8 reranker
`);

  const command = args[0];

  (async () => {
    const reranker = new Reranker();

    try {
      if (command === 'status') {
        console.log('\nReranker Status:');
        console.log(JSON.stringify(reranker.getStatus(), null, 2));
      } else if (command === 'test') {
        console.log('\nRunning reranker performance test...\n');

        // Sample documents
        const documents = [
          'AuthService handles user authentication and login',
          'The database connection pool manages MySQL connections',
          'LoginController processes login requests from the frontend',
          'JWT tokens are validated in the AuthInterceptor',
          'User passwords are hashed using bcrypt algorithm',
          'Session management tracks active user sessions',
          'OAuth2 integration allows social media login',
          'Two-factor authentication adds extra security',
          'Password reset emails are sent via SMTP',
          'Role-based access control limits user permissions',
        ];

        const query = 'how does user authentication work';

        console.log(`Query: "${query}"`);
        console.log(`Documents: ${documents.length}`);

        // Test FlashRank
        console.log('\n--- FlashRank (Local) ---');
        const flashStart = Date.now();
        const flashResult = await reranker.flashRankReranker.rerank(query, documents, 5);
        console.log(`Latency: ${flashResult.latency_ms}ms`);
        console.log(`Model: ${flashResult.model}`);
        console.log('Top 5:');
        flashResult.results.forEach((r, i) => {
          const text = typeof r === 'string' ? r : documents[r.originalIndex];
          console.log(`  ${i + 1}. [${r.flashRankScore.toFixed(4)}] ${text.slice(0, 50)}...`);
        });

        // Test Voyage if available
        if (reranker.voyageReranker.isAvailable()) {
          console.log('\n--- Voyage AI ---');
          const voyageResult = await reranker.voyageReranker.rerank(query, documents, 5);
          console.log(`Latency: ${voyageResult.latency_ms}ms`);
          console.log(`Model: ${voyageResult.model}`);
          console.log('Top 5:');
          voyageResult.results.forEach((r, i) => {
            const text = typeof r === 'string' ? r : documents[r.originalIndex];
            console.log(`  ${i + 1}. [${r.voyageScore.toFixed(4)}] ${text.slice(0, 50)}...`);
          });
        } else {
          console.log('\n--- Voyage AI ---');
          console.log('Not available (VOYAGEAI_API_KEY not set)');
        }

        // Test Jina if available
        if (reranker.jinaReranker.isAvailable()) {
          console.log('\n--- Jina Reranker v3 ---');
          const jinaResult = await reranker.jinaReranker.rerank(query, documents, 5);
          console.log(`Latency: ${jinaResult.latency_ms}ms`);
          console.log(`Model: ${jinaResult.model}`);
          console.log('Top 5:');
          jinaResult.results.forEach((r, i) => {
            const text = typeof r === 'string' ? r : documents[r.originalIndex];
            console.log(`  ${i + 1}. [${r.jinaScore.toFixed(4)}] ${text.slice(0, 50)}...`);
          });
        } else {
          console.log('\n--- Jina Reranker v3 ---');
          console.log('Not available (JINA_API_KEY not set)');
        }

      } else if (command === 'rerank' && args[1]) {
        const query = args[1];
        const useVoyage = args.includes('--voyage');
        const useJina = args.includes('--jina');
        const useLocal = args.includes('--local');

        // Sample documents for testing
        const documents = [
          'User authentication is handled by AuthService',
          'Database queries are optimized for performance',
          'The login page validates credentials',
          'API endpoints are secured with JWT',
          'Frontend uses React for the user interface',
        ];

        let result;
        if (useLocal) {
          result = await reranker.flashRankReranker.rerank(query, documents, 5);
        } else if (useJina && reranker.jinaReranker.isAvailable()) {
          result = await reranker.jinaReranker.rerank(query, documents, 5);
        } else if (useVoyage && reranker.voyageReranker.isAvailable()) {
          result = await reranker.voyageReranker.rerank(query, documents, 5);
        } else {
          result = await reranker.rerank(query, documents, 5);
        }

        console.log(`\nQuery: "${query}"`);
        console.log(`Model: ${result.model}`);
        console.log(`Latency: ${result.latency_ms}ms`);
        console.log('\nResults:');
        result.results.forEach((r, i) => {
          const score = r.rerankScore || r.jinaScore || r.voyageScore || r.flashRankScore || 0;
          console.log(`  ${i + 1}. [${score.toFixed(4)}] ${documents[r.originalIndex]}`);
        });
      } else {
        console.log('Unknown command. Use: status, test, or rerank');
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}

export default Reranker;
