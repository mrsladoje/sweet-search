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
