/**
 * Global ONNX Mutex
 *
 * ONNX Runtime (used by @huggingface/transformers) doesn't handle concurrent
 * model inference well, especially when multiple models are loaded.
 *
 * This module provides a global mutex to serialize ALL ONNX operations
 * across the entire server (FlashRank, LocalReranker, SemanticCache).
 *
 * Usage:
 *   import { withOnnxMutex } from './onnx-mutex.js';
 *   const result = await withOnnxMutex(() => model(inputs));
 */

// Global promise chain for serializing ONNX operations
let _onnxQueue = Promise.resolve();

/**
 * Execute a function while holding the global ONNX mutex.
 * All ONNX operations should go through this to prevent concurrent inference crashes.
 *
 * @param {Function} fn - Async function that performs ONNX inference
 * @returns {Promise<*>} - Result of fn()
 */
export async function withOnnxMutex(fn) {
  return new Promise((resolve, reject) => {
    _onnxQueue = _onnxQueue.then(async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Reset the mutex queue (for testing)
 */
export function resetOnnxMutex() {
  _onnxQueue = Promise.resolve();
}

export default { withOnnxMutex, resetOnnxMutex };
