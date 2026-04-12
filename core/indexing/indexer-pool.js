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
import fs from 'fs';
import { execSync } from 'child_process';
import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { bestIntraOpThreads, estimateComputeCores } from '../infrastructure/onnx-session-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(__dirname, 'indexer-worker.js');

let _gpuTierFallbackWarned = false;
let _lastLevelCacheBytesCache = null;

/**
 * Detect the largest local shared cache in bytes.
 *
 * On x86 this is typically the L3 (shared among cores, 8-32 MB). On Apple
 * Silicon there is no distinct L3; the shared per-cluster L2 is the last
 * level before the System Level Cache / DRAM (16 MB on M3 Max P-cluster).
 *
 * Used to size the LI attention budget so the per-layer activation working
 * set fits in cache — otherwise tail batches at max sequence length force
 * every transformer layer to read/write DRAM, which on fused Metal SDPA
 * makes long-chunk batches ~7× slower than short-chunk batches (observed
 * on M3 Max with the previous coefficient).
 *
 * Returns 0 on unknown, which makes callers fall back to tier-only caps.
 */
export function detectLastLevelCacheBytes() {
  if (_lastLevelCacheBytesCache !== null) return _lastLevelCacheBytesCache;
  const parseMultiplier = (suffix) => ({
    '': 1, K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024,
  })[suffix];
  try {
    if (process.platform === 'darwin') {
      // Take the max across:
      //   hw.perflevel0.l2cachesize — Apple Silicon P-core cluster L2 (16 MB
      //                               on M3 Max; plain hw.l2cachesize returns
      //                               the 4 MB E-cluster value on AS, which
      //                               dramatically undersizes the budget)
      //   hw.l3cachesize            — Intel Mac shared L3 (8-32 MB)
      //   hw.l2cachesize            — fallback (per-core on Intel, E-cluster on AS)
      let best = 0;
      for (const key of ['hw.perflevel0.l2cachesize', 'hw.l3cachesize', 'hw.l2cachesize']) {
        try {
          const out = execSync(`sysctl -n ${key}`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000,
          }).trim();
          const bytes = parseInt(out, 10);
          if (Number.isFinite(bytes) && bytes > best) best = bytes;
        } catch { /* try next key */ }
      }
      if (best > 0) {
        _lastLevelCacheBytesCache = best;
        return best;
      }
    } else if (process.platform === 'linux') {
      // Prefer L3 (index3), fall back to L2 (index2).
      for (const idx of [3, 2]) {
        try {
          const sizeStr = fs.readFileSync(
            `/sys/devices/system/cpu/cpu0/cache/index${idx}/size`,
            'utf8',
          ).trim();
          const m = sizeStr.match(/^(\d+)\s*([KMG]?)$/);
          if (m) {
            const bytes = parseInt(m[1], 10) * parseMultiplier(m[2]);
            if (Number.isFinite(bytes) && bytes > 0) {
              _lastLevelCacheBytesCache = bytes;
              return bytes;
            }
          }
        } catch { /* try next index */ }
      }
    }
    // Windows and unknown platforms: no portable sysfs path — fall through.
  } catch {
    // fall through
  }
  _lastLevelCacheBytesCache = 0;
  return 0;
}

/**
 * Detect the Apple Silicon chip tier. Used to scale GPU-side batch sizes
 * (LI / embedding) based on the actual GPU core count rather than system RAM,
 * which is only a rough proxy. Returns one of:
 *   { gen: 1|2|3|4|null, variant: 'base'|'pro'|'max'|'ultra'|null, gpuCores: <est>, tier: 0..4 }
 * For non-Apple-Silicon or failure, returns tier=0 so batch falls back to the
 * RAM-based heuristic.
 *
 * tier meaning:
 *   0 = non-Apple or unknown (use RAM-only heuristic)
 *   1 = M* base    (~8-10 GPU cores)  → LI batch ~8-12
 *   2 = M* Pro     (~14-19 GPU cores) → LI batch ~16-20
 *   3 = M* Max     (~30-40 GPU cores) → LI batch ~28-36
 *   4 = M* Ultra   (~60-80 GPU cores) → LI batch ~48-64
 */
export function detectAppleSiliconTier() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return { gen: null, variant: null, gpuCores: null, tier: 0 };
  }
  try {
    const brand = execSync('sysctl -n machdep.cpu.brand_string', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    // Examples: "Apple M1", "Apple M2 Pro", "Apple M3 Max", "Apple M4 Ultra"
    const match = brand.match(/Apple\s+M(\d+)(?:\s+(Pro|Max|Ultra))?/i);
    if (!match) return { gen: null, variant: null, gpuCores: null, tier: 0 };
    const gen = Number(match[1]);
    const variant = (match[2] || 'base').toLowerCase();
    // Approximate GPU core counts (typical configs). Memory bandwidth scales
    // similarly across generations within a variant, so we key the batch size
    // off the variant tier rather than absolute cores.
    const gpuCores = {
      base:  8,
      pro:  16,
      max:  36,
      ultra: 72,
    }[variant] || 8;
    const tier = { base: 1, pro: 2, max: 3, ultra: 4 }[variant] || 1;
    return { gen, variant, gpuCores, tier };
  } catch {
    return { gen: null, variant: null, gpuCores: null, tier: 0 };
  }
}

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

  // Apple Silicon GPU tier (base/Pro/Max/Ultra). Used to scale Metal batch
  // sizes to the actual GPU core count instead of RAM-as-proxy. On non-Apple
  // Silicon, tier=0 → falls back to RAM-based sizing.
  const gpuTier = overrides.gpuTier ?? detectAppleSiliconTier();

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
    gpuTier,
  };
}

/**
 * Given a detected Apple Silicon GPU tier, pick a LI batch size and token
 * budget that saturates the GPU without overshooting memory. Returns
 * `{ liBatchFromTier: null, liTokenBudgetFromTier: null }` for non-Apple GPUs,
 * which makes the caller fall back to the RAM-based heuristic.
 *
 * Sizing is driven by GPU SIMT occupancy: higher-tier chips have more cores
 * and can run wider kernels without losing per-item throughput. Token budget
 * = batch × maxDocLen(2048) so the length-sorted tail packs full batches.
 */
export function planLateInteractionFromGpuTier(gpuTier) {
  if (!gpuTier || gpuTier.tier === 0) {
    return { liBatchFromTier: null, liTokenBudgetFromTier: null };
  }
  // Batch sizes tuned to roughly half the GPU core count — candle's Metal
  // SDPA kernel dispatches ~2 SIMT groups per batch item at typical seq
  // lengths, so batch ≈ cores/2 gives one-pass occupancy without queueing.
  // Budget is batch × 2048 (LateOn-Code maxDocLength).
  const byTier = {
    1: { batch:  8, budget:  8 * 2048 }, // base ~8-10 cores
    2: { batch: 16, budget: 16 * 2048 }, // Pro  ~14-19 cores
    3: { batch: 32, budget: 32 * 2048 }, // Max  ~30-40 cores
    4: { batch: 64, budget: 64 * 2048 }, // Ultra ~60-80 cores
  }[gpuTier.tier];
  if (!byTier) return { liBatchFromTier: null, liTokenBudgetFromTier: null };
  return {
    liBatchFromTier: byTier.batch,
    liTokenBudgetFromTier: byTier.budget,
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
    gpuTier = { tier: 0, variant: null, gpuCores: null },
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

  // Base LI batch + token budget: preferred sizing based on the detected
  // Apple Silicon GPU tier (actual core count), falling back to RAM-as-proxy
  // for non-Apple-Silicon or undetected hardware. The goal is to saturate
  // the GPU's SIMT groups on each dispatch — higher-tier GPUs with more
  // cores can chew through larger batches per kernel launch.
  //
  // Token budget scales together: maxDoc for LateOn-Code is 2048, so the
  // budget needs to be `batch * 2048` to fit the tail where long chunks
  // cluster after length-sorted bucketing. Too-small budgets force the
  // tail into 8-12 item batches and under-utilize the GPU.
  const {
    liBatchFromTier,
    liTokenBudgetFromTier,
  } = planLateInteractionFromGpuTier(gpuTier);

  let lateInteractionBatchSize;
  if (liBatchOverride > 0) {
    // Hard cap at 128 to catch typos; no sane config exceeds this.
    lateInteractionBatchSize = Math.min(liBatchOverride, 128);
  } else if (liBatchFromTier != null) {
    lateInteractionBatchSize = liBatchFromTier;
  } else {
    if (!_gpuTierFallbackWarned) {
      _gpuTierFallbackWarned = true;
      const reason = gpuTier && gpuTier.tier === 0
        ? (process.platform === 'darwin' && process.arch === 'arm64'
          ? 'Apple Silicon variant not recognized'
          : 'non-Apple-Silicon platform')
        : 'GPU tier detection returned no data';
      console.warn(`[indexer-pool] GPU tier unknown (${reason}); using RAM-based LI batch heuristic (totalMemGB=${totalMemGB.toFixed(1)})`);
    }
    if (totalMemGB <= 8) {
      lateInteractionBatchSize = 2;
    } else if (totalMemGB <= 16) {
      lateInteractionBatchSize = 4;
    } else if (totalMemGB <= 32) {
      lateInteractionBatchSize = computeCores >= 8 ? 6 : 4;
    } else {
      lateInteractionBatchSize = computeCores >= 12 ? 8 : 6;
    }
  }

  const lateInteractionTokenBudget = liTokenBudgetOverride > 0
    ? liTokenBudgetOverride
    : liTokenBudgetFromTier != null
      ? liTokenBudgetFromTier
      : totalMemGB <= 8
        ? 4_096
        : totalMemGB <= 16
          ? 6_144
          : totalMemGB <= 32
            ? 8_192
            : 12_288;

  // Upper cap for dynamic batch growth in buildLateInteractionBatches. Short
  // code chunks (typical 100-300 tokens) leave the GPU under-utilized at the
  // baseline batch size (tuned for 2048-token max-length chunks). Letting the
  // bucketer grow up to this cap when token budget allows keeps SIMT groups
  // saturated for short-chunk batches. 4x baseline, capped at 128.
  const lateInteractionBatchSizeUpperCap = Math.min(
    128,
    lateInteractionBatchSize * 4,
  );

  // Attention budget caps per-batch compute work (seq² × batch). On top of
  // the token budget (which caps memory), this bound also determines the
  // long-sequence tail batch size, which is where cache pressure matters.
  //
  // Previous tier-based formula `floor(batchSize/2) × maxLength²` landed
  // M3 Max tail batches at B=16 × N=2048, and measured ~7× slower per batch
  // than short-chunk batches because activations spilled out of cache on
  // every transformer layer.
  //
  // Formula (weights-aware cache model):
  //   perLayerWeightBytes = 12 × hiddenDim² × dtypeBytes
  //     Derivation: one transformer layer has QKV (3d²) + attention output
  //     (d²) + FFN up (4d²) + FFN down (4d²) = 12 d² params. During each
  //     layer's forward pass the layer's weights are resident in the same
  //     last-level cache that holds activations, so they directly reduce
  //     the budget available for activations.
  //   usableCache = (lastLevelCache − perLayerWeightBytes) × l2Safety
  //   perItemAtMaxLen = maxLength × hiddenDim × dtypeBytes
  //   maxBatchAtMaxLen = max(1, floor(usableCache / perItemAtMaxLen))
  //
  // Concrete: M3 Max L2 = 16 MB, ModernBERT-base d=768 fp16 → per-layer
  // weights ≈ 13.5 MB, usable ≈ 2.5 MB, perItem at N=2048 ≈ 3.15 MB →
  // B=1 at the long-seq tail. Matches the microbench optimum (B=1 is
  // strictly fastest at 613 ms/chunk; B=16 is 2.13× slower).
  //
  // The formula self-adapts: LateOn-Code-edge (d=256) has per-layer
  // weights ≈ 1.6 MB, leaving ≈ 14.4 MB usable → B≈14 at N=2048, which
  // is appropriate for that much smaller model.
  //
  // Overrides:
  //   SWEET_SEARCH_LI_ATTENTION_BUDGET  — explicit FLOPs cap (0 disables)
  //   SWEET_SEARCH_LI_L2_SAFETY         — multiplicative safety on
  //                                       usableCache; default 1.0
  const liMaxLength = 2048; // matches LATE_INTERACTION_CONFIG.activeModel.maxDocLength
  const LI_HIDDEN_DIM = 768; // LateOn-Code backbone (ModernBERT-base) hidden size
  const LI_DTYPE_BYTES = 2;  // fp16 activations / weights on the Metal path
  const perLayerWeightBytes = 12 * LI_HIDDEN_DIM * LI_HIDDEN_DIM * LI_DTYPE_BYTES;
  const perItemBytesAtMaxLen = liMaxLength * LI_HIDDEN_DIM * LI_DTYPE_BYTES;
  const lastLevelCacheBytes = detectLastLevelCacheBytes();
  const parsedL2Safety = Number(process.env.SWEET_SEARCH_LI_L2_SAFETY);
  const l2SafetyFactor = Number.isFinite(parsedL2Safety) && parsedL2Safety > 0
    ? parsedL2Safety
    : 1.0;
  const usableCacheBytes = lastLevelCacheBytes > 0
    ? Math.max(0, (lastLevelCacheBytes - perLayerWeightBytes) * l2SafetyFactor)
    : 0;
  // When cache is detected but weights don't fit (usable ≤ 0), clamp to B=1
  // rather than null — cache *was* detected, we just can't fit activations
  // alongside weights, so the right answer is "as small as possible", not
  // "fall back to the tier heuristic".
  let cacheBoundLongSeqBatch;
  if (lastLevelCacheBytes <= 0) {
    cacheBoundLongSeqBatch = null; // detection failed
  } else if (usableCacheBytes <= 0) {
    cacheBoundLongSeqBatch = 1;
  } else {
    cacheBoundLongSeqBatch = Math.max(1, Math.floor(usableCacheBytes / perItemBytesAtMaxLen));
  }

  const liAttentionBudgetOverride = parseInt(
    process.env.SWEET_SEARCH_LI_ATTENTION_BUDGET || '',
    10,
  );
  let lateInteractionAttentionBudget;
  if (liAttentionBudgetOverride === 0) {
    lateInteractionAttentionBudget = null; // disabled
  } else if (Number.isFinite(liAttentionBudgetOverride) && liAttentionBudgetOverride > 0) {
    lateInteractionAttentionBudget = liAttentionBudgetOverride;
  } else {
    const tierLongSeqBatch = Math.max(1, Math.floor(lateInteractionBatchSize / 2));
    const effectiveLongSeqBatch = cacheBoundLongSeqBatch != null
      ? Math.min(tierLongSeqBatch, cacheBoundLongSeqBatch)
      : tierLongSeqBatch;
    lateInteractionAttentionBudget = effectiveLongSeqBatch * liMaxLength * liMaxLength;
  }

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
    lateInteractionBatchSizeUpperCap,
    lateInteractionTokenBudget,
    lateInteractionAttentionBudget,
    lastLevelCacheBytes,
    lateInteractionCacheBoundLongSeqBatch: cacheBoundLongSeqBatch,
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
