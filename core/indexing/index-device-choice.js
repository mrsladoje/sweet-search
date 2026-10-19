/**
 * Index-device choice — accelerator (Metal / CoreML cascade / CUDA) or the
 * ORT INT8 CPU path, decided by a measured speed test, not by chip name.
 *
 * Why: the accelerator is not always faster. On an M3 Max, Metal indexes only
 * 1.48x faster than ORT INT8 (which runs on the CPU's AMX units). A base or
 * Pro chip has far fewer GPU cores but keeps its AMX units, so the CPU can tie
 * or win there. The test encodes the same chunks on both devices and keeps
 * the accelerator unless the CPU is clearly faster (CPU_WIN_MARGIN): CPU
 * indexing occupies every core and slows the user's machine, so the
 * accelerator wins a tie. FP32 and INT8 give equal retrieval quality, so the
 * choice changes speed only.
 *
 * The result is per machine, cached in ~/.cache/sweet-search. The key holds
 * the chip, the backend, the LI model, the ORT profile and the package
 * version, so a new release or a different setup measures again.
 *
 * This module has no model imports (model-pool.js reads it, and runs the
 * test). SWEET_SEARCH_INDEX_DEVICE=accelerator|cpu skips the test.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { getOrtGraphCacheDir } from '../infrastructure/onnx-session-utils.js';

/** The CPU must be at least this much faster to take indexing off the accelerator. */
export const CPU_WIN_MARGIN = 1.2;

export const INDEX_DEVICE_CACHE_FILE = 'index-device.json';

let _packageVersion;
function packageVersion() {
  if (_packageVersion === undefined) {
    try {
      const pkgPath = new URL('../../package.json', import.meta.url);
      _packageVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? 'unknown';
    } catch {
      _packageVersion = 'unknown';
    }
  }
  return _packageVersion;
}

/**
 * Explicit override from SWEET_SEARCH_INDEX_DEVICE, or null for "measure".
 * Accepts accelerator|gpu|metal|cuda → 'accelerator', cpu|ort → 'cpu'.
 */
export function indexDeviceOverride(env = process.env) {
  const raw = (env.SWEET_SEARCH_INDEX_DEVICE ?? '').trim().toLowerCase();
  if (['accelerator', 'gpu', 'metal', 'cuda'].includes(raw)) return 'accelerator';
  if (['cpu', 'ort'].includes(raw)) return 'cpu';
  return null;
}

/**
 * Cache key for one machine + setup. Pure; exported for tests.
 */
export function indexDeviceCacheKey({ hw = {}, liModel, includeLi, backgroundProfile, version = packageVersion() }) {
  const chip = hw.brandString || hw.nvidiaGpu?.name || `${hw.platform}-${hw.arch}`;
  return [
    chip,
    hw.inferenceBackendPreference,
    includeLi ? (liModel || 'li') : 'no-li',
    backgroundProfile ? 'bg' : 'fg',
    version,
  ].join('|');
}

/**
 * Pick the device from two timings (milliseconds for the same work). Pure.
 * Missing or failed timings keep the accelerator (the pre-test behaviour).
 */
export function decideIndexDevice({ cpuMs, acceleratorMs, margin = CPU_WIN_MARGIN }) {
  if (!(cpuMs > 0) || !(acceleratorMs > 0)) return 'accelerator';
  return cpuMs * margin < acceleratorMs ? 'cpu' : 'accelerator';
}

function cachePath(cacheDir) {
  return path.join(cacheDir ?? getOrtGraphCacheDir(), INDEX_DEVICE_CACHE_FILE);
}

function readCache(cacheDir) {
  const p = cachePath(cacheDir);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed.entries === 'object' && parsed.entries ? parsed.entries : {};
  } catch {
    return {};
  }
}

/** The cached result for a key, or null. Never throws. */
export function readIndexDeviceChoice(key, { cacheDir } = {}) {
  try {
    const entry = readCache(cacheDir)[key];
    return entry && (entry.device === 'cpu' || entry.device === 'accelerator') ? entry : null;
  } catch {
    return null;
  }
}

/** Store a result (tmp + rename). A write failure only costs a re-test. */
export function writeIndexDeviceChoice(key, entry, { cacheDir } = {}) {
  try {
    const p = cachePath(cacheDir);
    const entries = { ...readCache(cacheDir), [key]: entry };
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2) + '\n', 'utf8');
    renameSync(tmp, p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deterministic code-like chunks for the test: about 1,400 characters each
 * (a typical chunk length), all different, so no cache helps either device.
 */
export function buildProbeTexts(count = 32) {
  const texts = [];
  for (let i = 0; i < count; i++) {
    const lines = [`// module probe_${i}: request handling and cache upkeep`];
    for (let j = 0; lines.join('\n').length < 1400; j++) {
      const n = i * 31 + j;
      lines.push(
        `export function handleRequest${n}(request, cache${n % 7}) {`,
        `  const key = request.path + ':' + request.query?.id${n % 5};`,
        `  if (cache${n % 7}.has(key)) return cache${n % 7}.get(key);`,
        `  const result = computeValue${n % 11}(request.body, { retries: ${n % 4}, limit: ${100 + n} });`,
        `  cache${n % 7}.set(key, result);`,
        '  return result;',
        '}',
      );
    }
    texts.push(lines.join('\n'));
  }
  return texts;
}
