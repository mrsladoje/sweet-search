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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(__dirname, 'indexer-worker.js');

// ─── Resource Allocator ─────────────────────────────────────────────────────

/**
 * Detect hardware and compute resource budgets for worker allocation.
 */
export function detectResources() {
  const logicalCores = os.cpus().length;
  const physicalCores = Math.max(1, Math.ceil(logicalCores / 2));
  const totalMemGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);

  // Reserve cores for main thread, I/O, SQLite, HNSW
  const reservedCores = Math.max(2, Math.ceil(physicalCores * 0.15));
  const availableCores = physicalCores - reservedCores;

  // RAM per embedding session: ~150MB model + ~200MB runtime overhead
  // RAM per LI session: ~150MB model + ~100MB runtime overhead
  const embeddingSessionRAM_MB = 350;
  const liSessionRAM_MB = 250;
  const mainThreadRAM_MB = 500; // SQLite, chunks, graphs

  return {
    logicalCores,
    physicalCores,
    totalMemGB,
    availableCores,
    reservedCores,
    embeddingSessionRAM_MB,
    liSessionRAM_MB,
    mainThreadRAM_MB,
  };
}

/**
 * Plan worker allocation given hardware resources.
 * Returns { embeddingWorkers, liWorkers, threadsPerEmbedding, threadsPerLI }
 */
export function planAllocation(resources = detectResources()) {
  const {
    availableCores,
    totalMemGB,
    embeddingSessionRAM_MB,
    liSessionRAM_MB,
    mainThreadRAM_MB,
  } = resources;

  // Memory budget: total RAM minus 2GB for OS and main thread
  const memBudgetMB = Math.max(512, (totalMemGB - 2) * 1024 - mainThreadRAM_MB);

  // Default: 1 embedding worker + 0 LI workers (LI stays in main thread)
  // Upgrade to 2 embedding workers on machines with enough cores + RAM.
  const override = parseInt(process.env.SWEET_SEARCH_EMBEDDING_WORKERS || '0', 10);
  let embeddingWorkers;
  if (override > 0) {
    embeddingWorkers = Math.min(override, 4);
  } else if (availableCores >= 6 && memBudgetMB >= 2 * embeddingSessionRAM_MB) {
    embeddingWorkers = 2;
  } else {
    embeddingWorkers = 1;
  }

  // Divide available cores among embedding workers
  const threadsPerEmbedding = Math.max(2, Math.floor(availableCores / embeddingWorkers));

  // LI stays in the main thread for now (Phase 2 conservative approach).
  // LI parallelism comes from the existing phase-level overlap.
  const liWorkers = 0;
  const threadsPerLI = 0;

  return {
    embeddingWorkers,
    liWorkers,
    threadsPerEmbedding,
    threadsPerLI,
    memBudgetMB,
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
    this.threadsPerWorker = options.threadsPerWorker ?? plan.threadsPerEmbedding;
    this.batchTimeoutMs = options.batchTimeoutMs ?? 30_000;
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
