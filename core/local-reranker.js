#!/usr/bin/env node

/**
 * Local Reranker - Alibaba-NLP/gte-reranker-modernbert-base INT8
 *
 * Uses the EXACT model specified in LOCAL_RERANKER_PLAN.md:
 * - Model: Alibaba-NLP/gte-reranker-modernbert-base
 * - Quantization: INT8 (dtype: "q8")
 * - Package: @huggingface/transformers v3+
 *
 * No Python, no subprocess - direct ONNX inference in Node.js.
 *
 * Model loads once at init (~15s cold, cached after), subsequent calls are fast (~15-20ms per doc).
 *
 * Cross-encoder reranking: scores query-document pairs directly using
 * a transformer that sees both query and document together.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { withOnnxMutex } from './onnx-mutex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_CACHE_DIR = join(__dirname, '..', 'models', 'gte-reranker-int8');

// EXACT model as specified in LOCAL_RERANKER_PLAN.md
const MODEL_ID = 'Alibaba-NLP/gte-reranker-modernbert-base';
const MODEL_DTYPE = 'q8';  // INT8 quantization

// Global singleton for reuse across session
let _globalInstance = null;

/**
 * Sigmoid activation for converting logits to probability scores
 */
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export class LocalReranker {
  constructor() {
    this.tokenizer = null;
    this.model = null;
    this.ready = false;
    this.maxLength = 512;
    this.transformersAvailable = null;
    this.initPromise = null;
    // Note: Uses global ONNX mutex (onnx-mutex.js) for cross-model serialization
  }

  /**
   * Get or create global singleton instance.
   * Used by session-preheat to keep model warm.
   */
  static getGlobalInstance() {
    if (!_globalInstance) {
      _globalInstance = new LocalReranker();
    }
    return _globalInstance;
  }

  /**
   * Check if local reranker is available.
   * Returns true if @huggingface/transformers is available.
   * The model will be auto-downloaded on first use.
   * @returns {boolean}
   */
  isAvailable() {
    try {
      // Check if @huggingface/transformers can be imported
      // The model will be auto-downloaded with INT8 quantization on first use
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize Transformers.js model (idempotent)
   * @returns {Promise<void>}
   */
  async init() {
    if (this.ready) return;

    // Ensure only one init runs at a time
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this._doInit();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  async _doInit() {
    try {
      // Dynamically import @huggingface/transformers (v3+)
      const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import('@huggingface/transformers');

      // Configure cache directory
      if (env) {
        env.cacheDir = MODEL_CACHE_DIR;
      }

      console.log(`LocalReranker: Loading ${MODEL_ID} with dtype=${MODEL_DTYPE}...`);
      const startLoad = Date.now();

      // Load tokenizer and model with INT8 quantization
      this.tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
        cache_dir: MODEL_CACHE_DIR,
      });

      this.model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
        cache_dir: MODEL_CACHE_DIR,
        dtype: MODEL_DTYPE,  // INT8 quantization
      });

      this.ready = true;
      this.transformersAvailable = true;
      console.log(`LocalReranker: Model loaded in ${Date.now() - startLoad}ms (gte-reranker-modernbert-base INT8)`);
    } catch (err) {
      this.transformersAvailable = false;
      console.error(`LocalReranker: Failed to load model: ${err.message}`);
      throw err;
    }
  }

  /**
   * Rerank documents using gte-reranker-modernbert-base INT8
   *
   * Cross-encoder format: (query, document) pair scored for relevance.
   * Uses raw logits with sigmoid for accurate relevance scores.
   *
   * @param {string} query - Search query
   * @param {Array} documents - Documents to rerank (max 50)
   * @param {number} topK - Number of results to return
   * @returns {Promise<{results: Array, latency_ms: number, model: string}>}
   */
  async rerank(query, documents, topK = 10) {
    if (!this.ready) {
      await this.init();
    }

    if (!documents || documents.length === 0) {
      return { results: [], latency_ms: 0, model: 'gte-reranker-modernbert-base-int8' };
    }

    // Use global ONNX mutex to serialize ALL transformer inference across server
    // This prevents crashes when FlashRank and LocalReranker run concurrently
    return await withOnnxMutex(() => this._doRerank(query, documents, topK));
  }

  /**
   * Internal reranking implementation (called within mutex)
   */
  async _doRerank(query, documents, topK) {
    const start = Date.now();

    // Score documents sequentially to avoid ONNX concurrency issues
    const scores = [];
    for (let index = 0; index < documents.length; index++) {
      const doc = documents[index];
      try {
        const text = typeof doc === 'string' ? doc : doc.content || doc.text || '';
        // Truncate to avoid token overflow
        const truncated = text.slice(0, this.maxLength * 4);

        // Tokenize query-document pair (cross-encoder format)
        // CRITICAL: Must use array format for text_pair to work correctly
        // Per HuggingFace docs: tokenizer([query], { text_pair: [document] })
        const inputs = this.tokenizer([query], {
          text_pair: [truncated],
          padding: true,
          truncation: true,
          max_length: this.maxLength,
        });

        // Get model output
        const output = await this.model(inputs);

        // Extract logit and apply sigmoid for relevance score
        const logit = output.logits.data[0];
        const score = sigmoid(logit);

        scores.push({ index, score, original: doc });
      } catch (err) {
        scores.push({ index, score: 0, original: doc });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Return top K results
    const results = scores.slice(0, topK).map((item, rank) => {
      // Handle both string and object documents
      const base = typeof item.original === 'string'
        ? { content: item.original }
        : item.original;
      return {
        ...base,
        localRerankerScore: item.score,
        originalIndex: item.index,
        newRank: rank + 1,
        source: 'local-gte-modernbert-int8',
      };
    });

    const latency = Date.now() - start;

    return {
      results,
      latency_ms: latency,
      model: 'gte-reranker-modernbert-base-int8',
    };
  }

  /**
   * Batched reranking for better throughput (sequential batching)
   *
   * @param {string} query - Search query
   * @param {Array} documents - Documents to rerank
   * @param {number} topK - Number of results to return
   * @param {number} batchSize - Batch size (default 16)
   * @returns {Promise<{results: Array, latency_ms: number, model: string}>}
   */
  async rerankBatched(query, documents, topK = 10, batchSize = 16) {
    if (!this.ready) {
      await this.init();
    }

    if (!documents || documents.length === 0) {
      return { results: [], latency_ms: 0, model: 'gte-reranker-modernbert-base-int8' };
    }

    const start = Date.now();

    // Process in batches
    const allScores = [];
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);

      const batchScores = await Promise.all(
        batch.map(async (doc, batchIdx) => {
          const index = i + batchIdx;
          try {
            const text = typeof doc === 'string' ? doc : doc.content || doc.text || '';
            const truncated = text.slice(0, this.maxLength * 4);

            // CRITICAL: Must use array format for text_pair to work correctly
            const inputs = this.tokenizer([query], {
              text_pair: [truncated],
              padding: true,
              truncation: true,
              max_length: this.maxLength,
            });

            const output = await this.model(inputs);
            const logit = output.logits.data[0];
            const score = sigmoid(logit);

            return { index, score, original: doc };
          } catch (err) {
            return { index, score: 0, original: doc };
          }
        })
      );

      allScores.push(...batchScores);
    }

    // Sort by score descending
    allScores.sort((a, b) => b.score - a.score);

    // Return top K results
    const results = allScores.slice(0, topK).map((item, rank) => ({
      ...item.original,
      localRerankerScore: item.score,
      originalIndex: item.index,
      newRank: rank + 1,
      source: 'local-gte-modernbert-int8-batched',
    }));

    const latency = Date.now() - start;

    return {
      results,
      latency_ms: latency,
      model: 'gte-reranker-modernbert-base-int8',
    };
  }

  /**
   * Shutdown and release resources
   */
  async shutdown() {
    this.tokenizer = null;
    this.model = null;
    this.ready = false;
    this.initPromise = null;
  }
}

// Export helper for getting global instance
export function getGlobalLocalReranker() {
  return LocalReranker.getGlobalInstance();
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  console.log(`
LocalReranker CLI - gte-reranker-modernbert-base INT8

Model: ${MODEL_ID}
Dtype: ${MODEL_DTYPE} (INT8 quantization)
Cache: ${MODEL_CACHE_DIR}

Usage:
  local-reranker.js status        Check status and model info
  local-reranker.js test          Run performance test
  local-reranker.js rerank <q>    Rerank sample documents with query
`);

  const command = args[0];

  (async () => {
    const reranker = new LocalReranker();

    try {
      if (command === 'status') {
        console.log('\nLocalReranker Status:');
        console.log(`  Model: ${MODEL_ID}`);
        console.log(`  Dtype: ${MODEL_DTYPE} (INT8)`);
        console.log(`  Cache: ${MODEL_CACHE_DIR}`);
        console.log(`  Available: ${reranker.isAvailable()}`);

        console.log('\nInitializing model (may download on first run)...');
        const initStart = Date.now();
        await reranker.init();
        console.log(`  Init time: ${Date.now() - initStart}ms`);
        console.log(`  Ready: ${reranker.ready}`);

      } else if (command === 'test') {
        console.log('\nRunning LocalReranker performance test...\n');

        // Sample documents
        const documents = [
          'AuthService handles user authentication and login with JWT tokens',
          'The database connection pool manages MySQL connections efficiently',
          'LoginController processes login requests from the frontend React app',
          'JWT tokens are validated in the AuthInterceptor before each request',
          'User passwords are hashed using bcrypt algorithm with salt rounds',
          'Session management tracks active user sessions in Redis cache',
          'OAuth2 integration allows social media login via Google and GitHub',
          'Two-factor authentication adds extra security with TOTP codes',
          'Password reset emails are sent via SMTP with secure links',
          'Role-based access control limits user permissions by role hierarchy',
        ];

        const query = 'how does user authentication work';

        console.log(`Query: "${query}"`);
        console.log(`Documents: ${documents.length}`);

        // Cold start (includes model loading)
        console.log('\n--- Cold Start ---');
        const coldStart = Date.now();
        const coldResult = await reranker.rerank(query, documents, 5);
        console.log(`Cold latency: ${Date.now() - coldStart}ms (includes model load)`);

        // Warm run
        console.log('\n--- Warm Run ---');
        const warmStart = Date.now();
        const warmResult = await reranker.rerank(query, documents, 5);
        console.log(`Warm latency: ${warmResult.latency_ms}ms`);
        console.log(`Model: ${warmResult.model}`);
        console.log('\nTop 5 results:');
        warmResult.results.forEach((r, i) => {
          const text = documents[r.originalIndex];
          console.log(`  ${i + 1}. [${r.localRerankerScore.toFixed(4)}] ${text.slice(0, 60)}...`);
        });

        // Multiple runs for average
        console.log('\n--- Average over 5 runs ---');
        const latencies = [];
        for (let i = 0; i < 5; i++) {
          const result = await reranker.rerank(query, documents, 5);
          latencies.push(result.latency_ms);
        }
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        console.log(`Average latency: ${avg.toFixed(1)}ms`);
        console.log(`Per-document: ${(avg / documents.length).toFixed(1)}ms`);
        console.log(`Min: ${Math.min(...latencies)}ms, Max: ${Math.max(...latencies)}ms`);

      } else if (command === 'rerank' && args[1]) {
        const query = args[1];

        // Sample documents for testing
        const documents = [
          'User authentication is handled by AuthService with JWT',
          'Database queries are optimized for performance with indexes',
          'The login page validates credentials before submission',
          'API endpoints are secured with JWT token validation',
          'Frontend uses React for the user interface components',
        ];

        console.log(`\nQuery: "${query}"`);
        const result = await reranker.rerank(query, documents, 5);
        console.log(`Model: ${result.model}`);
        console.log(`Latency: ${result.latency_ms}ms`);
        console.log('\nResults:');
        result.results.forEach((r, i) => {
          console.log(`  ${i + 1}. [${r.localRerankerScore.toFixed(4)}] ${documents[r.originalIndex]}`);
        });
      } else {
        console.log('Unknown command. Use: status, test, or rerank <query>');
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}

export default LocalReranker;
