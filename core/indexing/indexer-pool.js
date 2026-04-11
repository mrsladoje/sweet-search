/**
 * Inference Pool — Coordinated worker management for indexing.
 *
 * Phase 2 of the Inference Speedup Plan. Provides:
 *   - Global resource allocator (CPU threads, RAM budget)
 *   - Per-model worker pools (embedding, LI)
 *   - Round-robin batch dispatch with per-batch timeout
 *   - Graceful fallback to inline single-session inference
 *
 * Architecture: worker_threads with independent ORT sessions. Each worker
 * has its own ORT thread pool, giving true CPU parallelism. The allocator
 * divides physical cores across active workers + main thread.
 */

import os from 'os';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { bestIntraOpThreads, estimateComputeCores } from '../infrastructure/onnx-session-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(__dirname, 'indexer-worker.js');

// ─── Resource Allocator ─────────────────────────────────────────────────────

/**
 * Detect hardware and compute resource budgets for worker allocation.
 */
export function detectResources(overrides = {}) {
  const logicalCores = overrides.logicalCores ?? os.cpus().length;
  const arch = overrides.arch ?? process.arch;
  const platform = overrides.platform ?? process.platform;
  const totalMemBytes = overrides.totalMemBytes ?? os.totalmem();
  const totalMemGB = totalMemBytes / 1024 / 1024 / 1024;
  const computeCores = estimateComputeCores({ logicalCores, arch });

  // Leave a small amount of headroom for SQLite, chunking, and OS scheduling.
  const reservedCores = computeCores >= 8 ? 2 : 1;
  const availableCores = Math.max(1, computeCores - reservedCores);

  // RAM per embedding session: ~150MB model + ~200MB runtime overhead
  // RAM per LI session: ~150MB model + ~100MB runtime overhead
  const embeddingSessionRAM_MB = 350;
  const liSessionRAM_MB = 250;
  const mainThreadRAM_MB = 500; // SQLite, chunks, graphs

  return {
    logicalCores,
    computeCores,
    totalMemGB,
    totalMemBytes,
    platform,
    arch,
    availableCores,
    reservedCores,
    embeddingSessionRAM_MB,
    liSessionRAM_MB,
    mainThreadRAM_MB,
  };
}

/**
 * Plan worker allocation given hardware resources.
 * Returns a sequential phase plan that can scale from small WSL laptops to
 * many-core workstations.
 */
export function planAllocation(resources = detectResources()) {
  const {
    logicalCores,
    computeCores,
    availableCores,
    totalMemGB,
    embeddingSessionRAM_MB,
    liSessionRAM_MB,
    mainThreadRAM_MB,
  } = resources;

  // Memory budget: total RAM minus 2GB for OS and main thread
  const memBudgetMB = Math.max(512, (totalMemGB - 2) * 1024 - mainThreadRAM_MB);

  // Default: 1 embedding worker (inline session). Multiple ORT sessions in
  // worker_threads cannot share a global thread pool (separate V8 isolates),
  // so per-session pools fight for L2 cache and memory bandwidth.
  // Measured: 2 workers × 7-8 threads = 37% per-thread efficiency vs 80% with
  // 1 session × 8 threads. ORT issue #17011 confirms this is a known limitation.
  // Override via SWEET_SEARCH_EMBEDDING_WORKERS=2 to experiment.
  const override = parseInt(process.env.SWEET_SEARCH_EMBEDDING_WORKERS || '0', 10);
  let embeddingWorkers;
  if (override > 0) {
    embeddingWorkers = Math.min(override, 4);
  } else {
    embeddingWorkers = 1;
  }

  const useWorkerPool = embeddingWorkers > 1;
  const reserveCores = computeCores >= 8 ? 2 : (computeCores >= 4 ? 1 : 0);
  const threadsPerEmbeddingWorker = useWorkerPool
    ? Math.max(2, Math.floor((computeCores - reserveCores) / embeddingWorkers))
    : 0;
  const inlineEmbeddingThreads = bestIntraOpThreads({
    logicalCores,
    computeCores,
    reserveCores: computeCores >= 4 ? 1 : 0,
  });
  const lateInteractionThreads = bestIntraOpThreads({
    logicalCores,
    computeCores,
    reserveCores: computeCores >= 4 ? 1 : 0,
  });
  const liOverride = parseInt(process.env.SWEET_SEARCH_LI_WORKERS || '0', 10);
  let lateInteractionWorkers;
  if (liOverride > 0) {
    lateInteractionWorkers = Math.min(liOverride, 4);
  } else {
    // Same rationale as embedding workers: 1 session is faster than
    // multiple sessions fighting for L2 cache on the same CPU.
    lateInteractionWorkers = 1;
  }
  const useLateInteractionPool = lateInteractionWorkers > 1;
  const liReserveCores = computeCores >= 8 ? 2 : (computeCores >= 4 ? 1 : 0);
  const threadsPerLateInteractionWorker = useLateInteractionPool
    ? Math.max(2, Math.floor((computeCores - liReserveCores) / lateInteractionWorkers))
    : lateInteractionThreads;
  const liBatchOverride = parseInt(process.env.SWEET_SEARCH_LI_BATCH_SIZE || '0', 10);
  const liTokenBudgetOverride = parseInt(process.env.SWEET_SEARCH_LI_TOKEN_BUDGET || '0', 10);
  let lateInteractionBatchSize;
  if (liBatchOverride > 0) {
    lateInteractionBatchSize = Math.min(liBatchOverride, 16);
  } else if (totalMemGB <= 8) {
    lateInteractionBatchSize = 2;
  } else if (totalMemGB <= 16) {
    lateInteractionBatchSize = 4;
  } else if (totalMemGB <= 32) {
    lateInteractionBatchSize = computeCores >= 8 ? 6 : 4;
  } else {
    lateInteractionBatchSize = computeCores >= 12 ? 8 : 6;
  }
  const lateInteractionTokenBudget = liTokenBudgetOverride > 0
    ? liTokenBudgetOverride
    : totalMemGB <= 8
      ? 4_096
      : totalMemGB <= 16
        ? 6_144
        : totalMemGB <= 32
          ? 8_192
          : 12_288;

  return {
    executionStrategy: 'sequential-phases',
    useWorkerPool,
    embeddingWorkers,
    threadsPerEmbeddingWorker,
    inlineEmbeddingThreads,
    useLateInteractionPool,
    lateInteractionWorkers,
    threadsPerLateInteractionWorker,
    lateInteractionThreads,
    lateInteractionBatchSize,
    lateInteractionTokenBudget,
    memBudgetMB,
    availableCores,
    computeCores,
    totalMemGB,
  };
}

// ─── Worker Pool ────────────────────────────────────────────────────────────

/**
 * EmbeddingPool — manages a pool of embedding worker threads.
 *
 * Usage:
 *   const pool = new EmbeddingPool({ workers: 2, threadsPerWorker: 4 });
 *   await pool.init();
 *   const embeddings = await pool.embed(texts, { maxLength: 512 });
 *   await pool.shutdown();
 */
export class EmbeddingPool {
  constructor(options = {}) {
    const plan = planAllocation();
    this.numWorkers = options.workers ?? plan.embeddingWorkers;
    this.threadsPerWorker = options.threadsPerWorker ?? plan.threadsPerEmbeddingWorker;
    this.batchTimeoutMs = options.batchTimeoutMs ?? 120_000;
    this.maxRestarts = options.maxRestarts ?? 2;
    this.workers = [];
    this.roundRobin = 0;
    this.nextBatchId = 0;
    this.restartCounts = new Map();
    this._ready = false;
  }

  async init() {
    if (this._ready) return;
    const spawnPromises = [];
    for (let i = 0; i < this.numWorkers; i++) {
      spawnPromises.push(this._spawnWorker(i));
    }
    await Promise.all(spawnPromises);
    this._ready = true;
    console.log(`[InferencePool] ${this.numWorkers} embedding worker(s) ready (${this.threadsPerWorker} threads each)`);
  }

  async _spawnWorker(index) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_SCRIPT, {
        workerData: {
          modelType: 'embedding',
          intraOpThreads: this.threadsPerWorker,
          workerIndex: index,
        },
      });

      const timer = setTimeout(() => {
        reject(new Error(`Worker ${index} startup timeout`));
      }, 60_000);

      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          clearTimeout(timer);
          this.workers[index] = worker;
          this.restartCounts.set(index, 0);
          resolve(worker);
        }
      });

      worker.on('error', (err) => {
        clearTimeout(timer);
        console.warn(`[InferencePool] Worker ${index} error: ${err.message}`);
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && this._ready) {
          console.warn(`[InferencePool] Worker ${index} exited with code ${code}`);
          this._handleWorkerExit(index);
        }
      });
    });
  }

  async _handleWorkerExit(index) {
    const restarts = (this.restartCounts.get(index) || 0) + 1;
    if (restarts > this.maxRestarts) {
      console.error(`[InferencePool] Worker ${index} exceeded restart budget (${this.maxRestarts})`);
      this.workers[index] = null;
      return;
    }
    this.restartCounts.set(index, restarts);
    console.log(`[InferencePool] Restarting worker ${index} (attempt ${restarts}/${this.maxRestarts})`);
    try {
      await this._spawnWorker(index);
    } catch (err) {
      console.error(`[InferencePool] Worker ${index} restart failed: ${err.message}`);
      this.workers[index] = null;
    }
  }

  /**
   * Embed a batch of texts using the next available worker.
   * Falls back to inline inference if all workers are dead.
   *
   * @param {string[]} texts
   * @param {object} options - { maxLength }
   * @returns {Float32Array[]} Array of embedding vectors
   */
  async embed(texts, options = {}) {
    if (!this._ready || this.numWorkers === 0) {
      return this._inlineFallback(texts, options);
    }

    // Round-robin to next alive worker
    let worker = null;
    for (let attempt = 0; attempt < this.numWorkers; attempt++) {
      const idx = this.roundRobin % this.numWorkers;
      this.roundRobin++;
      if (this.workers[idx]) {
        worker = this.workers[idx];
        break;
      }
    }

    if (!worker) {
      return this._inlineFallback(texts, options);
    }

    const batchId = this.nextBatchId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Batch ${batchId} timed out after ${this.batchTimeoutMs}ms`));
      }, this.batchTimeoutMs);

      const handler = (msg) => {
        if (msg.type === 'embedResult' && msg.batchId === batchId) {
          clearTimeout(timer);
          worker.removeListener('message', handler);
          if (msg.error) {
            reject(new Error(msg.error));
          } else {
            // Reconstruct Float32Arrays from transferred buffer
            const dim = msg.dim;
            const embeddings = [];
            for (let i = 0; i < msg.count; i++) {
              embeddings.push(new Float32Array(msg.buffer, i * dim * 4, dim));
            }
            resolve(embeddings);
          }
        }
      };

      worker.on('message', handler);
      worker.postMessage({
        type: 'embed',
        texts,
        maxLength: options.maxLength || 512,
        batchId,
      });
    });
  }

  async _inlineFallback(texts, options) {
    // Lazy import to avoid circular dependency
    const { callLocalModel } = await import('../embedding/embedding-local-model.js');
    return callLocalModel(texts, options);
  }

  async shutdown() {
    this._ready = false;
    const termPromises = this.workers
      .filter(w => w)
      .map(w => w.terminate().catch(() => {}));
    await Promise.all(termPromises);
    this.workers = [];
    console.log('[InferencePool] Shutdown complete');
  }
}

export class LateInteractionPool {
  constructor(options = {}) {
    const plan = planAllocation();
    this.numWorkers = options.workers ?? plan.lateInteractionWorkers;
    this.threadsPerWorker = options.threadsPerWorker ?? plan.threadsPerLateInteractionWorker;
    this.batchTimeoutMs = options.batchTimeoutMs ?? 120_000;
    this.maxRestarts = options.maxRestarts ?? 2;
    this.workers = [];
    this.roundRobin = 0;
    this.nextBatchId = 0;
    this.restartCounts = new Map();
    this._ready = false;
  }

  async init() {
    if (this._ready) return;
    await Promise.all(Array.from({ length: this.numWorkers }, (_, i) => this._spawnWorker(i)));
    this._ready = true;
    console.log(`[InferencePool] ${this.numWorkers} LI worker(s) ready (${this.threadsPerWorker} threads each)`);
  }

  async _spawnWorker(index) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_SCRIPT, {
        workerData: {
          modelType: 'late-interaction',
          intraOpThreads: this.threadsPerWorker,
          workerIndex: index,
        },
      });

      const timer = setTimeout(() => reject(new Error(`LI worker ${index} startup timeout`)), 60_000);

      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          clearTimeout(timer);
          this.workers[index] = worker;
          this.restartCounts.set(index, 0);
          resolve(worker);
        }
      });

      worker.on('error', (err) => {
        clearTimeout(timer);
        console.warn(`[InferencePool] LI worker ${index} error: ${err.message}`);
        reject(err);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && this._ready) {
          console.warn(`[InferencePool] LI worker ${index} exited with code ${code}`);
          this._handleWorkerExit(index);
        }
      });
    });
  }

  async _handleWorkerExit(index) {
    const restarts = (this.restartCounts.get(index) || 0) + 1;
    if (restarts > this.maxRestarts) {
      console.error(`[InferencePool] LI worker ${index} exceeded restart budget (${this.maxRestarts})`);
      this.workers[index] = null;
      return;
    }
    this.restartCounts.set(index, restarts);
    try {
      await this._spawnWorker(index);
    } catch (err) {
      console.error(`[InferencePool] LI worker ${index} restart failed: ${err.message}`);
      this.workers[index] = null;
    }
  }

  async encodeDocuments(texts, options = {}) {
    if (!this._ready || this.numWorkers === 0) {
      return this._inlineFallback(texts, options);
    }

    let worker = null;
    for (let attempt = 0; attempt < this.numWorkers; attempt++) {
      const idx = this.roundRobin % this.numWorkers;
      this.roundRobin++;
      if (this.workers[idx]) {
        worker = this.workers[idx];
        break;
      }
    }
    if (!worker) return this._inlineFallback(texts, options);

    const batchId = this.nextBatchId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`LI batch ${batchId} timed out after ${this.batchTimeoutMs}ms`));
      }, this.batchTimeoutMs);

      const handler = (msg) => {
        if (msg.type === 'encodeDocumentsResult' && msg.batchId === batchId) {
          clearTimeout(timer);
          worker.removeListener('message', handler);
          if (msg.error) {
            reject(new Error(msg.error));
            return;
          }

          const tokenCounts = new Uint32Array(msg.tokenCountsBuffer);
          const vectors = new Float32Array(msg.vectorsBuffer);
          const preNorms = new Float32Array(msg.preNormsBuffer);
          const docs = new Array(msg.count);
          let tokenOffset = 0;
          for (let docIdx = 0; docIdx < msg.count; docIdx++) {
            const tokenCount = tokenCounts[docIdx];
            const doc = new Array(tokenCount);
            for (let tokenIdx = 0; tokenIdx < tokenCount; tokenIdx++) {
              const start = (tokenOffset + tokenIdx) * msg.dim;
              doc[tokenIdx] = vectors.subarray(start, start + msg.dim);
            }
            doc.preNorms = preNorms.subarray(tokenOffset, tokenOffset + tokenCount);
            docs[docIdx] = doc;
            tokenOffset += tokenCount;
          }
          resolve(docs);
        }
      };

      worker.on('message', handler);
      worker.postMessage({
        type: 'encodeDocuments',
        texts,
        poolFactor: options.poolFactor || 1,
        extendedSkiplist: options.extendedSkiplist || false,
        batchId,
      });
    });
  }

  async _inlineFallback(texts, options) {
    const { encodeDocuments } = await import('../ranking/late-interaction-model.js');
    return encodeDocuments(texts, options);
  }

  async shutdown() {
    this._ready = false;
    await Promise.all(this.workers.filter(Boolean).map((worker) => worker.terminate().catch(() => {})));
    this.workers = [];
    console.log('[InferencePool] LI shutdown complete');
  }
}
