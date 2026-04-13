// core/onnx-session-utils.js
// Shared ONNX Runtime session configuration utilities.

import { execFileSync } from 'child_process';
import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { shouldUseCoreML, getCoreMLExecutionProviders } from './coreml-provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _cacheDirEnsured = false;

export function getOnnxRuntimeVersion() {
  try {
    // Try project root first, then traverse up from __dirname
    const candidates = [
      path.resolve('node_modules/onnxruntime-node/package.json'),
      path.resolve(__dirname, '../../node_modules/onnxruntime-node/package.json'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        return JSON.parse(readFileSync(p, 'utf8')).version || 'unknown';
      }
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getOptimizedGraphPath(modelId, suffix) {
  const cacheDir = path.join(os.homedir(), '.cache', 'sweet-search');
  if (!_cacheDirEnsured) {
    mkdirSync(cacheDir, { recursive: true });
    _cacheDirEnsured = true;
  }
  const hash = crypto.createHash('sha256').update(modelId).digest('hex').slice(0, 12);
  return path.join(cacheDir, `${suffix}-optimized-ort${getOnnxRuntimeVersion()}-${hash}.onnx`);
}

/**
 * Detect performance-core count on Apple Silicon via sysctl.
 * Returns null on non-macOS or if detection fails.
 * Cached after first call.
 */
let _cachedPCores = undefined;
export function detectPerformanceCores() {
  if (_cachedPCores !== undefined) return _cachedPCores;
  _cachedPCores = null;
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return _cachedPCores;
  try {
    const out = execFileSync('sysctl', ['-n', 'hw.perflevel0.logicalcpu'], { encoding: 'utf8', timeout: 1000 });
    const n = parseInt(out.trim(), 10);
    if (n > 0) _cachedPCores = n;
  } catch { /* not Apple Silicon or sysctl unavailable */ }
  return _cachedPCores;
}

/**
 * Detect the largest local shared cache in bytes.
 *
 * Used by inference batching to size long-sequence batches so the per-layer
 * activation working set fits in cache instead of spilling to DRAM. On
 * inference workloads, the per-batch activation tensor (B × N × hidden ×
 * dtype) competes with the resident-layer transformer weights for the same
 * last-level cache; pushing this past the cache size dominates wall time
 * for long sequences (verified with a microbench on M3 Max LI inference,
 * where B=16 × N=2048 ran 2.13× slower per chunk than B=1).
 *
 * Returns 0 on unknown platforms (Windows / unrecognised), which lets
 * callers fall back to their tier-only heuristic.
 *
 * Per-platform sources (largest local shared cache):
 *   macOS Apple Silicon — hw.perflevel0.l2cachesize (P-core cluster L2).
 *                         Plain hw.l2cachesize returns the smaller E-cluster
 *                         value (4 MB on M3 Max), which would dramatically
 *                         undersize the budget. perflevel0 is the 16 MB
 *                         P-cluster the inference workload actually hits.
 *   macOS Intel        — hw.l3cachesize (shared L3, 8-32 MB).
 *   Linux              — /sys/devices/system/cpu/cpu0/cache/index{3,2}/size.
 *   Windows / unknown  — 0 (caller falls back).
 */
let _cachedLastLevelCacheBytes = undefined;
export function detectLastLevelCacheBytes() {
  if (_cachedLastLevelCacheBytes !== undefined) return _cachedLastLevelCacheBytes;
  try {
    if (process.platform === 'darwin') {
      let best = 0;
      for (const key of ['hw.perflevel0.l2cachesize', 'hw.l3cachesize', 'hw.l2cachesize']) {
        try {
          const out = execFileSync('sysctl', ['-n', key], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 2000,
          }).trim();
          const bytes = parseInt(out, 10);
          if (Number.isFinite(bytes) && bytes > best) best = bytes;
        } catch { /* try next key */ }
      }
      if (best > 0) {
        _cachedLastLevelCacheBytes = best;
        return best;
      }
    } else if (process.platform === 'linux') {
      const mult = { '': 1, K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 };
      for (const idx of [3, 2]) {
        try {
          const sizeStr = readFileSync(
            `/sys/devices/system/cpu/cpu0/cache/index${idx}/size`,
            'utf8',
          ).trim();
          const m = sizeStr.match(/^(\d+)\s*([KMG]?)$/);
          if (m) {
            const bytes = parseInt(m[1], 10) * mult[m[2]];
            if (Number.isFinite(bytes) && bytes > 0) {
              _cachedLastLevelCacheBytes = bytes;
              return bytes;
            }
          }
        } catch { /* try next index */ }
      }
    }
  } catch { /* fall through */ }
  _cachedLastLevelCacheBytes = 0;
  return 0;
}

/**
 * Compute the largest long-sequence batch B that keeps a transformer layer's
 * working set (one layer of weights resident + B items of activations) inside
 * the supplied cache budget. Returns null when cache detection failed (caller
 * should fall back to its own heuristic) and 1 when weights alone don't fit
 * (we still want the smallest possible B, not the heuristic).
 *
 * Derivation:
 *   perLayerWeightBytes = 12 × hiddenDim² × weightBytesPerParam
 *     (QKV=3d² + attn_out=1d² + FFN_up=4d² + FFN_down=4d² = 12d² params)
 *   usableCache         = max(0, cache - perLayerWeightBytes) × safety
 *   perItemBytes        = maxLength × hiddenDim × actBytesPerItem
 *   maxBatch            = max(1, floor(usableCache / perItemBytes))
 *
 * Empirically validated on M3 Max + ModernBERT-base (d=768, F32 native):
 * weights ≈ 27 MB > L2 (16 MB) → usable=0 → B=1, which matches the
 * microbench optimum (B=1 strictly fastest for long-seq tail batches).
 */
export function computeWeightsAwareBatchCap(options) {
  const {
    cacheBytes,
    hiddenDim,
    maxLength,
    weightBytesPerParam,
    actBytesPerItem,
    safety = 1.0,
  } = options;
  if (!cacheBytes || cacheBytes <= 0) return null;
  const perLayerWeightBytes = 12 * hiddenDim * hiddenDim * weightBytesPerParam;
  const usable = Math.max(0, (cacheBytes - perLayerWeightBytes) * safety);
  const perItemBytes = maxLength * hiddenDim * actBytesPerItem;
  if (usable <= 0 || perItemBytes <= 0) return 1;
  return Math.max(1, Math.floor(usable / perItemBytes));
}

export function estimateComputeCores(options = {}) {
  const logicalCores = Math.max(1, options.logicalCores ?? os.cpus().length);
  const arch = options.arch ?? process.arch;
  const override = Number.parseInt(process.env.SWEET_SEARCH_COMPUTE_CORES ?? '', 10);
  if (Number.isFinite(override) && override > 0) {
    return Math.min(override, logicalCores);
  }

  // x86 logical CPU counts usually include SMT siblings that do not scale ORT
  // inference linearly. ARM/Apple Silicon reports real cores more faithfully.
  if (arch === 'x64' || arch === 'ia32') {
    return Math.max(1, Math.ceil(logicalCores / 2));
  }
  return logicalCores;
}

export function defaultOrtExecutionMode(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  return platform === 'darwin' && arch === 'arm64' ? 'parallel' : 'sequential';
}

export function buildSessionOptions(modelId, suffix, coremlAvailable = false, runtimeOptions = {}) {
  const executionMode = runtimeOptions.executionMode
    ?? process.env.SWEET_SEARCH_ORT_EXEC_MODE
    ?? defaultOrtExecutionMode(runtimeOptions);
  const interOpThreads = runtimeOptions.interOpThreads
    ?? parseInt(process.env.SWEET_SEARCH_ORT_INTER_OP_THREADS || '1', 10);
  const opts = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: runtimeOptions.intraOpThreads ?? bestIntraOpThreads(runtimeOptions),
    interOpNumThreads: interOpThreads,
    executionMode,
    enableCpuMemArena: true,
    enableMemPattern: true,
    optimizedModelFilePath: getOptimizedGraphPath(modelId, suffix),
  };
  // Thread spinning keeps ORT worker threads hot-looping for work instead of
  // sleeping on OS primitives. Trades CPU power for lower inference latency.
  // Safe for batch indexing where we WANT maximum throughput.
  opts.extra = {
    session: {
      intra_op: { allow_spinning: '1' },
    },
  };

  if (shouldUseCoreML(coremlAvailable)) {
    opts.executionProviders = getCoreMLExecutionProviders();
  }

  return opts;
}

export function warnIfGraphNotMaterialized(label, sessionOptions) {
  if (!existsSync(sessionOptions.optimizedModelFilePath)) {
    console.warn(`[ONNX] ${label} optimized graph not materialized at ${sessionOptions.optimizedModelFilePath}`);
  }
}

/**
 * Determine optimal intra-op thread count for ONNX Runtime.
 *
 * Strategy:
 *   Apple Silicon → use P-cores only (E-cores hurt ORT throughput)
 *   x86 with SMT → computeCores is already halved by estimateComputeCores
 *   All platforms → subtract reserveCores for main thread / I/O
 *
 * No artificial cap — the hardware determines the limit.
 * Override: SWEET_SEARCH_INTRA_OP_THREADS=N
 */
export function bestIntraOpThreads(options = {}) {
  const logicalCores = Math.max(1, options.logicalCores ?? os.cpus().length);
  const override = Number.parseInt(process.env.SWEET_SEARCH_INTRA_OP_THREADS ?? '', 10);
  if (Number.isFinite(override) && override > 0) {
    return Math.min(override, logicalCores);
  }

  // On Apple Silicon, use performance cores (not efficiency cores).
  // E-cores are slower and cause ORT thread pool imbalance.
  const pCores = options.pCores !== undefined ? options.pCores : detectPerformanceCores();
  const computeCores = Math.max(1, options.computeCores ?? estimateComputeCores({
    logicalCores,
    arch: options.arch,
  }));
  const effectiveCores = pCores ?? computeCores;
  const reserveCores = Number.isFinite(options.reserveCores)
    ? Math.max(0, options.reserveCores)
    : (effectiveCores >= 6 ? 2 : effectiveCores >= 4 ? 1 : 0);
  // Caller can still cap via maxThreads if needed (e.g., for worker pool splits).
  const maxThreads = Number.isFinite(options.maxThreads)
    ? Math.max(1, options.maxThreads)
    : effectiveCores;
  const requested = Number.isFinite(options.targetThreads)
    ? Math.max(1, options.targetThreads)
    : effectiveCores - reserveCores;
  return Math.max(1, Math.min(requested, maxThreads, logicalCores));
}
