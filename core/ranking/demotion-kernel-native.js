/**
 * Native batch matchers for the file-kind demotion sub-rules.
 *
 * Resolves the same `sweet-search-native` addon used by MaxSim and the
 * tokenizer. When the addon is absent (e.g., a platform without a
 * matching `@sweet-search/native-*` package) `getNativeDemotionKernel()`
 * returns `null` and JS-side callers fall through to V8 regex.
 *
 * Strictly opt-in by default — controlled by SWEET_SEARCH_DEMOTIONS_NATIVE.
 * Set to '1' / 'true' / 'on' to enable. The parity script
 * `scripts/parity-demotions.js` should pass on a representative corpus
 * before flipping the default.
 */

import { resolveNativeAddon } from '../infrastructure/native-resolver.js';
import { createRequire } from 'node:module';

let cachedKernel = null;
let cachedResolved = false;

function envEnabled() {
  const raw = process.env.SWEET_SEARCH_DEMOTIONS_NATIVE;
  if (raw == null || raw === '') return false;
  return raw === '1' || raw === 'true' || raw === 'on';
}

/**
 * Returns `{ testChunkBodyMatchBatch }` when the native addon is present
 * AND opt-in via env var; returns `null` otherwise. The function shape
 * is stable so callers can `kernel?.testChunkBodyMatchBatch(texts)`.
 *
 * @returns {null | { testChunkBodyMatchBatch: (texts: string[]) => boolean[] }}
 */
export function getNativeDemotionKernel() {
  if (!envEnabled()) return null;
  if (cachedResolved) return cachedKernel;
  cachedResolved = true;
  try {
    const addonPath = resolveNativeAddon();
    if (!addonPath) {
      cachedKernel = null;
      return null;
    }
    const require = createRequire(import.meta.url);
    const addon = require(addonPath);
    if (typeof addon.testChunkBodyMatchBatch !== 'function') {
      cachedKernel = null;
      return null;
    }
    cachedKernel = {
      testChunkBodyMatchBatch: (texts) => addon.testChunkBodyMatchBatch(texts),
    };
    return cachedKernel;
  } catch {
    cachedKernel = null;
    return null;
  }
}

/**
 * Test-only escape hatch for the parity script: bypasses the env-var gate
 * so the kernel can be loaded for direct comparison against the JS path.
 *
 * @returns {null | { testChunkBodyMatchBatch: (texts: string[]) => boolean[] }}
 */
export function getNativeDemotionKernelForceLoad() {
  try {
    const addonPath = resolveNativeAddon();
    if (!addonPath) return null;
    const require = createRequire(import.meta.url);
    const addon = require(addonPath);
    if (typeof addon.testChunkBodyMatchBatch !== 'function') return null;
    return {
      testChunkBodyMatchBatch: (texts) => addon.testChunkBodyMatchBatch(texts),
    };
  } catch {
    return null;
  }
}
