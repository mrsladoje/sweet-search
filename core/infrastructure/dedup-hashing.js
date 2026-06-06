/**
 * Dedup hashing — thin JS wrapper over the Rust NAPI addon's
 * SimHash + MinHash + LSH clustering entrypoints.
 *
 * Zero domain logic lives here. If the native addon is missing
 * (unsupported platform), `isAvailable()` returns false and callers
 * fall back to a no-op that treats every chunk as its own exemplar.
 */

import { loadNativeAddon } from './native-resolver.js';
import { DEDUP_CONFIG } from './config/dedup.js';

let _addon = null;
let _loadAttempted = false;
let _loadError = null;

function loadAddon() {
  if (_loadAttempted) return _addon;
  _loadAttempted = true;
  // CUDA-preferred with CPU fallback (see loadNativeAddon): a CUDA addon that
  // can't load on a no-GPU box falls back to the plain CPU addon.
  const res = loadNativeAddon({
    validate: (m) => typeof m.dedupFingerprintBatch === 'function' && typeof m.dedupCluster === 'function',
  });
  if (res) {
    _addon = res.mod;
  } else {
    _loadError = new Error('dedup-hashing: native addon not available for this platform');
    _addon = null;
  }
  return _addon;
}

/**
 * Returns true iff the Rust NAPI dedup functions are callable on this machine.
 * Used by callers to decide whether to run the dedup phase or skip it cleanly.
 */
export function isAvailable() {
  const addon = loadAddon();
  return !!(
    addon &&
    typeof addon.dedupFingerprintBatch === 'function' &&
    typeof addon.dedupCluster === 'function'
  );
}

export function getLoadError() {
  loadAddon();
  return _loadError;
}

/**
 * Compute per-chunk SimHash + MinHash fingerprints for a batch of texts.
 * Returns `[{simhashHex: string, minhash: Buffer(512)}]`, one per input.
 * Throws if the native addon isn't available — callers should check `isAvailable()` first.
 */
export function computeFingerprints(texts, config = DEDUP_CONFIG) {
  const addon = loadAddon();
  if (!addon) throw _loadError ?? new Error('dedup native addon unavailable');
  return addon.dedupFingerprintBatch(texts, config.ngramSize, config.numPerm, config.seed);
}

/**
 * Cluster fingerprints into near-duplicate groups via banded LSH +
 * SimHash Hamming secondary filter + union-find collapse.
 * Returns `[{exemplarIdx, siblingIdxs, clusterId}]`. Entries include
 * singletons (siblingIdxs.length === 0) so callers can enumerate every chunk's
 * cluster assignment — filter them out to get only true clusters.
 */
export function clusterFingerprints(fingerprints, config = DEDUP_CONFIG) {
  const addon = loadAddon();
  if (!addon) throw _loadError ?? new Error('dedup native addon unavailable');
  return addon.dedupCluster(
    fingerprints,
    config.numPerm,
    config.numBands,
    config.jaccardThreshold,
    config.simhashHammingMax,
  );
}
