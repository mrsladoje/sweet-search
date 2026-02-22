// core/onnx-session-utils.js
// Shared ONNX Runtime session configuration utilities.

import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

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

export function buildSessionOptions(modelId, suffix) {
  const cores = Math.max(1, os.cpus().length);
  return {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.min(8, Math.max(2, Math.ceil(cores / 2))),
    interOpNumThreads: 1,
    executionMode: 'parallel',
    enableCpuMemArena: true,
    enableMemPattern: true,
    optimizedModelFilePath: getOptimizedGraphPath(modelId, suffix),
  };
}

/**
 * Try multiple option shapes for session_options because @huggingface/transformers
 * has used both `session_options` and `sessionOptions` across versions.
 */
export async function loadModelWithSessionOptions(loader, baseOptions, sessionOptions) {
  const candidates = [
    { ...baseOptions, session_options: sessionOptions },
    { ...baseOptions, sessionOptions },
    baseOptions,
  ];
  let lastError = null;
  for (const opts of candidates) {
    try {
      return await loader(opts);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Model load failed after all option candidates');
}

export function warnIfGraphNotMaterialized(label, sessionOptions) {
  if (!existsSync(sessionOptions.optimizedModelFilePath)) {
    console.warn(`[ONNX] ${label} optimized graph not materialized at ${sessionOptions.optimizedModelFilePath}`);
  }
}
