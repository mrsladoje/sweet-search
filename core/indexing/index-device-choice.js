/**
 * Index-device choice — accelerator (Metal / CoreML cascade / CUDA) or the
 * ORT INT8 CPU path, decided by a measured speed test, not by chip name.
 *
 * Why: the accelerator is not always faster. A base or Pro chip has far fewer
 * GPU cores than a Max but keeps its CPU AMX units, so ORT INT8 can tie or win
 * there. The test (model-pool.js::measureIndexDevices) encodes the same chunks
 * on both devices, each in its own child process, and keeps the accelerator
 * unless the CPU is clearly faster (CPU_WIN_MARGIN): CPU indexing occupies
 * every core and slows the user's machine, so the accelerator wins a tie.
 * FP32 and INT8 give equal retrieval quality, so the choice changes speed only.
 *
 * The result is per machine and setup, cached in ~/.cache/sweet-search. The
 * key holds everything that changes the comparison (chip, effective backend
 * and CoreML cascade state, models, thread plan, batch budgets, split-device
 * switches, ORT profile, package version). Entries expire, so a test taken on
 * a busy machine does not hold for ever. A machine-wide lock keeps two
 * processes from testing at once (they would slow each other's timings and
 * load two copies of the models).
 *
 * This module has no model imports (model-pool.js reads it and runs the
 * test; index-device-probe-child.mjs is one side of the test).
 * SWEET_SEARCH_INDEX_DEVICE=accelerator|cpu skips the test.
 */

import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { getOrtGraphCacheDir } from '../infrastructure/onnx-session-utils.js';

/** The CPU must be at least this much faster to take indexing off the accelerator. */
export const CPU_WIN_MARGIN = 1.2;

/**
 * A first result whose accelerator/CPU time ratio falls in this band is close
 * to the margin; the test runs a second time, in the opposite order, and the
 * two runs must agree.
 */
export const CLOSE_RATIO_BAND = [CPU_WIN_MARGIN / 1.5, CPU_WIN_MARGIN * 1.5];

/** A stable result is reused for 30 days; one where the two runs disagreed, for 1 day. */
export const STABLE_TTL_MS = 30 * 24 * 3600 * 1000;
export const UNSTABLE_TTL_MS = 24 * 3600 * 1000;

export const INDEX_DEVICE_CACHE_FILE = 'index-device.json';
export const INDEX_DEVICE_LOCK_FILE = 'index-device.lock';
export const PROBE_RESULT_PREFIX = 'INDEX_DEVICE_PROBE ';

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
 * Cache key for one machine + setup. Pure; exported for tests. `setup` holds
 * the values that change what each device has to do, as the caller
 * resolved them (see model-pool.js::ensureIndexDeviceChoice).
 */
export function indexDeviceCacheKey({ hw = {}, setup = {}, env = process.env, version = packageVersion() }) {
  const chip = hw.brandString || hw.nvidiaGpu?.name || `${hw.platform}-${hw.arch}`;
  const lb = setup.liBatch || {};
  return [
    chip,
    hw.inferenceBackendPreference,
    `cascade=${setup.cascadeStatus ?? 'n/a'}`,
    `embed=${setup.embeddingModel ?? '?'}`,
    setup.includeLi ? `li=${setup.liModel ?? '?'}` : 'li=off',
    `par=${setup.parallel ? 1 : 0}`,
    `thr=${setup.embeddingThreads ?? 'd'}/${setup.lateInteractionThreads ?? 'd'}`,
    `lib=${lb.batchSize ?? 'd'}/${lb.batchSizeUpperCap ?? 'd'}/${lb.tokenBudget ?? 'd'}/${lb.attentionBudget ?? 'd'}`,
    `cpu=${env.SWEET_SEARCH_EMBED_USE_CPU === '1' ? 'e' : ''}${env.SWEET_SEARCH_LI_USE_CPU === '1' ? 'l' : ''}`,
    setup.backgroundProfile ? 'bg' : 'fg',
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

/** True when a result is close enough to the margin to need a second run. */
export function isCloseResult({ cpuMs, acceleratorMs }, band = CLOSE_RATIO_BAND) {
  if (!(cpuMs > 0) || !(acceleratorMs > 0)) return false;
  const ratio = acceleratorMs / cpuMs;
  return ratio > band[0] && ratio < band[1];
}

/** Whether a cached entry may still be used at time `now`. */
export function isEntryFresh(entry, now = Date.now()) {
  if (!entry || (entry.device !== 'cpu' && entry.device !== 'accelerator')) return false;
  const expires = Date.parse(entry.expiresAt ?? '');
  return Number.isFinite(expires) && expires > now;
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

/** The cached, unexpired result for a key, or null. Never throws. */
export function readIndexDeviceChoice(key, { cacheDir, now = Date.now() } = {}) {
  try {
    const entry = readCache(cacheDir)[key];
    return isEntryFresh(entry, now) ? entry : null;
  } catch {
    return null;
  }
}

/**
 * Store a result (read-merge-write, tmp + rename). Call it while holding the
 * probe lock, so two writers cannot drop each other's entries. Expired
 * entries are pruned. A write failure only costs a re-test.
 */
export function writeIndexDeviceChoice(key, entry, { cacheDir, now = Date.now() } = {}) {
  try {
    const p = cachePath(cacheDir);
    const entries = {};
    for (const [k, v] of Object.entries(readCache(cacheDir))) {
      if (isEntryFresh(v, now)) entries[k] = v;
    }
    entries[key] = entry;
    const tmp = `${p}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 2, entries }, null, 2) + '\n', 'utf8');
    renameSync(tmp, p);
    return true;
  } catch {
    return false;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Take the machine-wide probe lock. Returns a release function, or null when
 * another live process holds it. A lock left by a dead process, or older than
 * `staleMs`, is taken over.
 */
export function tryAcquireProbeLock({ cacheDir, staleMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  const p = path.join(cacheDir ?? getOrtGraphCacheDir(), INDEX_DEVICE_LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(p, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }));
      closeSync(fd);
      return () => {
        try {
          const held = JSON.parse(readFileSync(p, 'utf8'));
          if (held?.pid === process.pid) unlinkSync(p);
        } catch { /* already gone */ }
      };
    } catch (err) {
      if (err?.code !== 'EEXIST') return null;
      let holder = null;
      try { holder = JSON.parse(readFileSync(p, 'utf8')); } catch { /* half-written or gone */ }
      let age = 0;
      try { age = now - statSync(p).mtimeMs; } catch { continue; }
      const stale = age > staleMs || (holder && !pidAlive(holder.pid));
      if (!stale) return null;
      try { unlinkSync(p); } catch { /* another process took it over first */ }
    }
  }
  return null;
}

/**
 * Deterministic code-like chunks for the test, all different (no cache helps
 * either device). Lengths cycle from about 400 to 3,000 characters, so the
 * batches have the mixed shapes that real chunk lists have.
 */
export function buildProbeTexts(count = 32) {
  const LENGTHS = [400, 900, 1400, 2000, 3000, 700, 1200, 1700];
  const texts = [];
  for (let i = 0; i < count; i++) {
    const target = LENGTHS[i % LENGTHS.length];
    const lines = [`// module probe_${i}: request handling and cache upkeep`];
    for (let j = 0; lines.join('\n').length < target; j++) {
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

/**
 * For benchmark builds: a message when an index that should have been
 * written by the accelerator was written only by ORT (every recorded dense
 * and late-interaction encoder label is ORT or the model server), else null.
 * Indexes built before provenance was kept (no counts) pass.
 */
export function acceleratorProvenanceProblem(manifest) {
  const labels = [];
  for (const tier of [manifest?.vectors?.encoders, manifest?.lateInteraction?.encoders]) {
    for (const [label, n] of Object.entries(tier?.counts || {})) if (n > 0) labels.push(label);
  }
  if (labels.length === 0) return null;
  const cpuOnly = labels.every((l) => l.startsWith('ort-') || l === 'model-server');
  return cpuOnly ? `index written by ORT CPU only (${labels.join(', ')}), expected the accelerator` : null;
}
