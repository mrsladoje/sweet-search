// core/onnx-session-utils.js
// Shared ONNX Runtime session configuration utilities.

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

export function buildSessionOptions(modelId, suffix, coremlAvailable = false) {
  // Phase 1a: benchmarked sequential vs parallel — parallel wins on Apple Silicon.
  // Configurable via env for A/B testing on other platforms.
  const executionMode = process.env.SWEET_SEARCH_ORT_EXEC_MODE || 'parallel';
  const interOpThreads = parseInt(process.env.SWEET_SEARCH_ORT_INTER_OP_THREADS || '1', 10);
  const opts = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: bestIntraOpThreads(),
    interOpNumThreads: interOpThreads,
    executionMode,
    enableCpuMemArena: true,
    enableMemPattern: true,
    optimizedModelFilePath: getOptimizedGraphPath(modelId, suffix),
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
 * Moved from embedding-local-model.js — shared by ranking + embedding.
 */
export function bestIntraOpThreads() {
  const logicalCores = Math.max(1, os.cpus().length);
  const override = Number.parseInt(process.env.SWEET_SEARCH_INTRA_OP_THREADS ?? '', 10);
  if (Number.isFinite(override) && override > 0) {
    return Math.min(override, logicalCores);
  }

  const physicalCores = Math.max(1, Math.ceil(logicalCores / 2));
  const baseline = Math.min(Math.max(1, physicalCores - 1), 8);

  if (logicalCores >= 4) return Math.max(2, baseline);
  return baseline;
}
