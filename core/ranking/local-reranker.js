#!/usr/bin/env node

/**
 * Local Reranker - Alibaba-NLP/gte-reranker-modernbert-base INT8
 *
 * Direct onnxruntime-node session + native-tokenizer.js; no Python, no subprocess.
 * Model loads once at init (~15s cold, cached after), subsequent calls are fast (~15-20ms per doc).
 */

import { join } from 'path';
import { buildSessionOptions, warnIfGraphNotMaterialized } from '../infrastructure/onnx-session-utils.js';
import { isAppleSilicon, isCoreMLProviderAvailable } from '../infrastructure/coreml-provider.js';
import { withOnnxMutex } from '../infrastructure/onnx-mutex.js';
import { fetchModel, getModelCacheDir } from '../infrastructure/model-fetcher.js';
import { createTokenizer } from '../infrastructure/native-tokenizer.js';
import { initOrt, buildFeed } from '../infrastructure/ort-pipeline.js';

const MODEL_ID = 'Alibaba-NLP/gte-reranker-modernbert-base';
const MODEL_DTYPE = 'q8';  // INT8 quantization

let _globalInstance = null;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export class LocalReranker {
  constructor() {
    this.tokenizer = null;
    this.session = null;
    this.ready = false;
    this.maxLength = 512;
    this.initPromise = null;
  }

  /** Used by session-preheat to keep the model warm. */
  static getGlobalInstance() {
    if (!_globalInstance) {
      _globalInstance = new LocalReranker();
    }
    return _globalInstance;
  }

  /** Always true: model files are fetched on init from the managed cache. */
  isAvailable() {
    return true;
  }

  /** Idempotent. */
  async init() {
    if (this.ready) return;

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
      // Fetch model files to managed cache (verifies checksums, respects allowRuntimeModelDownload)
      await fetchModel('gte-reranker-modernbert-base');

      console.log(`LocalReranker: Loading ${MODEL_ID} with dtype=${MODEL_DTYPE}...`);
      const startLoad = Date.now();

      const cacheDir = getModelCacheDir(MODEL_ID);
      this.tokenizer = await createTokenizer(join(cacheDir, 'tokenizer.json'));

      const ort = await initOrt();
      const onnxPath = join(cacheDir, 'onnx', 'model_quantized.onnx');

      const coremlAvailable = isAppleSilicon() ? await isCoreMLProviderAvailable() : false;
      const sessionOpts = buildSessionOptions(`${MODEL_ID}:${MODEL_DTYPE}`, 'local-reranker', coremlAvailable);

      try {
        this.session = await ort.InferenceSession.create(onnxPath, sessionOpts);
      } catch (loadErr) {
        if (sessionOpts.executionProviders?.some(ep => (typeof ep === 'string' ? ep : ep.name) === 'coreml')) {
          console.warn(`LocalReranker: CoreML failed (${loadErr.message}), falling back to CPU`);
          const cpuOpts = buildSessionOptions(`${MODEL_ID}:${MODEL_DTYPE}`, 'local-reranker');
          this.session = await ort.InferenceSession.create(onnxPath, cpuOpts);
        } else {
          throw loadErr;
        }
      }

      this.ready = true;
      warnIfGraphNotMaterialized('LocalReranker', sessionOpts);
      console.log(`LocalReranker: Model loaded in ${Date.now() - startLoad}ms (gte-reranker-modernbert-base INT8)`);
    } catch (err) {
      console.error(`LocalReranker: Failed to load model: ${err.message}`);
      throw err;
    }
  }

  /**
   * Raw logits through sigmoid give the relevance score.
   *
   * @param {Array} documents - Documents to rerank (max 50)
   * @returns {Promise<{results: Array, latency_ms: number, model: string}>}
   */
  async rerank(query, documents, topK = 10) {
    if (!documents || documents.length === 0) {
      return { results: [], latency_ms: 0, model: 'gte-reranker-modernbert-base-int8' };
    }

    if (!this.ready) {
      await this.init();
    }

    // Global ONNX mutex serializes all transformer inference: FlashRank and
    // LocalReranker running concurrently crash.
    return await withOnnxMutex(() => this._doRerank(query, documents, topK));
  }

  /** Called within the mutex. One query-doc pair per forward pass. */
  async _doRerank(query, documents, topK) {
    const start = Date.now();

    const scores = [];
    for (let index = 0; index < documents.length; index++) {
      const doc = documents[index];
      try {
        const text = typeof doc === 'string' ? doc : doc.content || doc.text || '';
        const truncated = text.slice(0, this.maxLength * 4);

        const tokenized = this.tokenizer(query, {
          text_pair: truncated,
          padding: true,
          truncation: true,
          max_length: this.maxLength,
        });

        const feed = buildFeed(tokenized, this.session.inputNames);
        const output = await this.session.run(feed);
        const logitTensor = output[this.session.outputNames[0]];
        const logit = logitTensor.data[0];
        scores.push({ index, score: sigmoid(logit), original: doc });
      } catch {
        scores.push({ index, score: 0, original: doc });
      }
    }

    scores.sort((a, b) => b.score - a.score);

    const results = scores.slice(0, topK).map((item, rank) => {
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

    return {
      results,
      latency_ms: Date.now() - start,
      model: 'gte-reranker-modernbert-base-int8',
    };
  }

  /** ORT sessions are not safe for concurrent inference from JS, so scoring is sequential like _doRerank. */
  async rerankBatched(query, documents, topK = 10) {
    if (!documents || documents.length === 0) {
      return { results: [], latency_ms: 0, model: 'gte-reranker-modernbert-base-int8' };
    }

    if (!this.ready) {
      await this.init();
    }

    return await withOnnxMutex(() => this._doRerank(query, documents, topK));
  }

  async shutdown() {
    if (this.session) {
      try { await this.session.release(); } catch { /* ORT release can throw */ }
    }
    this.tokenizer = null;
    this.session = null;
    this.ready = false;
    this.initPromise = null;
  }
}

export function getGlobalLocalReranker() {
  return LocalReranker.getGlobalInstance();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  console.log(`
LocalReranker CLI - gte-reranker-modernbert-base INT8

Model: ${MODEL_ID}
Dtype: ${MODEL_DTYPE} (INT8 quantization)
Cache: ${getModelCacheDir(MODEL_ID)}

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
        console.log(`  Cache: ${getModelCacheDir(MODEL_ID)}`);
        console.log(`  Available: ${reranker.isAvailable()}`);

        console.log('\nInitializing model (may download on first run)...');
        const initStart = Date.now();
        await reranker.init();
        console.log(`  Init time: ${Date.now() - initStart}ms`);
        console.log(`  Ready: ${reranker.ready}`);

      } else if (command === 'test') {
        console.log('\nRunning LocalReranker performance test...\n');

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

        console.log('\n--- Cold Start ---');
        const coldStart = Date.now();
        await reranker.rerank(query, documents, 5);
        console.log(`Cold latency: ${Date.now() - coldStart}ms (includes model load)`);

        console.log('\n--- Warm Run ---');
        const warmResult = await reranker.rerank(query, documents, 5);
        console.log(`Warm latency: ${warmResult.latency_ms}ms`);
        console.log(`Model: ${warmResult.model}`);
        console.log('\nTop 5 results:');
        warmResult.results.forEach((r, i) => {
          const text = documents[r.originalIndex];
          console.log(`  ${i + 1}. [${r.localRerankerScore.toFixed(4)}] ${text.slice(0, 60)}...`);
        });

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
