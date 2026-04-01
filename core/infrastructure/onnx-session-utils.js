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
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'node_modules', 'onnxruntime-node', 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
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
  const cores = Math.max(1, os.cpus().length);
  const opts = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.min(8, Math.max(2, Math.ceil(cores / 2))),
    interOpNumThreads: 1,
    executionMode: 'parallel',
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
