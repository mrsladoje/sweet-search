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

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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

/**
 * How long a result is reused: "accelerator" (the default device) for 30
 * days; "cpu" for 7 days, because a wrong "cpu" costs the user every core;
 * a result whose two runs disagreed, or a test that failed, for 1 day (it
 * keeps the accelerator and is not retried on every run).
 */
export const STABLE_TTL_MS = 30 * 24 * 3600 * 1000;
export const CPU_TTL_MS = 7 * 24 * 3600 * 1000;
export const UNSTABLE_TTL_MS = 24 * 3600 * 1000;

export const INDEX_DEVICE_CACHE_FILE = 'index-device.json';
export const INDEX_DEVICE_LOCK_FILE = 'index-device.lock';
export const PROBE_RESULT_PREFIX = 'INDEX_DEVICE_PROBE ';

/** Per-child time limit; four children at most, so a test ends well inside LOCK_HARD_STALE_MS. */
export const PROBE_CHILD_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * A lock whose holder (or its test child) is alive is never taken over,
 * except after this age: a test cannot run this long, so the pid was reused.
 */
export const LOCK_HARD_STALE_MS = 60 * 60 * 1000;

/** A lock file with no readable holder (half-written) is taken over after this age. */
const LOCK_UNREADABLE_STALE_MS = 30 * 1000;

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
 * Switches that split one index run over both devices (dense on ORT CPU, late
 * interaction on the accelerator, or the reverse; or the hybrid dense mode).
 * With one of them set, the accelerator side would hold ORT CPU and GPU models
 * in one process, so the test does not run and the accelerator is kept.
 */
export function splitDeviceSwitches(env = process.env) {
  // The dispatchers read EMBED_HYBRID as 1/true/on and the *_USE_CPU switches
  // as '1'; the wider parse here can only skip a test, never run one wrongly.
  return ['SWEET_SEARCH_EMBED_USE_CPU', 'SWEET_SEARCH_LI_USE_CPU', 'SWEET_SEARCH_EMBED_HYBRID']
    .filter((name) => ['1', 'true', 'on'].includes((env[name] ?? '').trim().toLowerCase()));
}

/**
 * Environment for an indexer that background maintenance starts: always ORT
 * CPU, so it never arms the GPU and never runs the speed test, whatever the
 * inherited environment says.
 */
export function maintainerIndexerEnv(env = process.env) {
  return { ...env, SWEET_SEARCH_INDEX_DEVICE: 'cpu' };
}

/**
 * The work schedule the test must copy, from the indexer's own plan
 * (indexer-phases.js). `parallel`: dense and late interaction overlapped
 * (the in-memory path only; the streaming path runs them one after the
 * other). `cpuPool` / `cpuLiPool`: the worker pools an ORT CPU run would
 * use (none when the models run in parallel).
 */
export function indexDeviceRunShape({
  shouldParallelLI, useStreaming, resourcePlan = {}, lateInteractionWorkers = 1, lateInteractionWorkerThreads = 0,
}) {
  return {
    parallel: !!shouldParallelLI && !useStreaming,
    cpuPool: resourcePlan.useWorkerPool && !shouldParallelLI && resourcePlan.embeddingWorkers > 1
      ? { workers: resourcePlan.embeddingWorkers, threadsPerWorker: resourcePlan.threadsPerEmbeddingWorker }
      : null,
    cpuLiPool: !shouldParallelLI && lateInteractionWorkers > 1 && lateInteractionWorkerThreads > 0
      ? { workers: lateInteractionWorkers, threadsPerWorker: lateInteractionWorkerThreads }
      : null,
  };
}

function poolLabel(p) {
  return p ? `${p.workers}x${p.threadsPerWorker}` : 'inline';
}

/** CPU model and logical core count of this host (the GPU comes from `hw`). */
export function machineIdentity() {
  const cpus = os.cpus();
  return { cpuModel: cpus[0]?.model?.trim() || 'unknown-cpu', cores: os.availableParallelism?.() ?? cpus.length };
}

// Environment settings that change what either encoder does per chunk
// (lengths, batch and attention budgets, threads, quantisation, backends).
const ENCODER_ENV = /^SWEET_SEARCH_(EMBED|LI_|LATE_INTERACTION|BATCHING|INDEXING_MAX_LENGTH|INTRA_OP|ORT_|COMPUTE_CORES|COREML|CUDA|NATIVE_INFERENCE|LOCAL_QUANTIZED|USE_OPENVINO|DISABLE_MEM_GUARD)/;

/** Short hash of the encoder environment settings (sorted name=value pairs). */
export function encoderEnvDigest(env = process.env) {
  const pairs = Object.keys(env).filter((k) => ENCODER_ENV.test(k)).sort().map((k) => `${k}=${env[k]}`);
  if (pairs.length === 0) return 'none';
  return createHash('sha1').update(pairs.join('\n')).digest('hex').slice(0, 12);
}

/**
 * Cache key for one machine + setup. Pure; exported for tests. `setup` holds
 * the values that change what each device has to do, as the caller
 * resolved them (see model-pool.js::ensureIndexDeviceChoice).
 */
export function indexDeviceCacheKey({
  hw = {}, setup = {}, env = process.env, version = packageVersion(), machine = machineIdentity(),
}) {
  const gpu = hw.nvidiaGpu?.name || hw.brandString || `${hw.platform}-${hw.arch}`;
  const lb = setup.liBatch || {};
  return [
    `cpu=${machine.cpuModel}/${machine.cores}`,
    `gpu=${gpu}`,
    hw.inferenceBackendPreference,
    `cascade=${setup.cascadeStatus ?? 'n/a'}`,
    `embed=${setup.embeddingModel ?? '?'}`,
    setup.includeLi ? `li=${setup.liModel ?? '?'}` : 'li=off',
    `par=${setup.parallel ? 1 : 0}`,
    `thr=${setup.embeddingThreads ?? 'd'}/${setup.lateInteractionThreads ?? 'd'}`,
    `lib=${lb.batchSize ?? 'd'}/${lb.batchSizeUpperCap ?? 'd'}/${lb.tokenBudget ?? 'd'}/${lb.attentionBudget ?? 'd'}`,
    `pool=${poolLabel(setup.cpuPool)}/${poolLabel(setup.cpuLiPool)}`,
    `env=${encoderEnvDigest(env)}`,
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
    mkdirSync(path.dirname(p), { recursive: true });
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

/** Start time (epoch ms) of a live process, or null when it cannot be read (e.g. Windows). */
function processStartMs(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim();
    const t = Date.parse(out);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/**
 * Whether `pid` is still the process that wrote `startedAt`. A live pid with
 * a different start time was reused by another program: the holder is dead.
 * `ps` gives whole seconds, so allow a few seconds of difference.
 */
function sameProcessAlive(pid, startedAt) {
  if (!pidAlive(pid)) return false;
  if (!Number.isFinite(startedAt)) return true;
  const actual = processStartMs(pid);
  return actual == null || Math.abs(actual - startedAt) < 5000;
}

/** This process's start time (epoch ms), as recorded in the lock. */
const OWN_START_MS = Math.round(Date.now() - process.uptime() * 1000);

/** The lock file's holder and age, or null when there is no lock file. */
function inspectLock(p, now) {
  let ageMs;
  try { ageMs = now - statSync(p).mtimeMs; } catch { return null; }
  let holder = null;
  try { holder = JSON.parse(readFileSync(p, 'utf8')); } catch { /* half-written */ }
  return { holder: holder && typeof holder === 'object' ? holder : null, ageMs };
}

function isLockStale({ holder, ageMs }) {
  if (!holder) return ageMs > LOCK_UNREADABLE_STALE_MS;
  if (ageMs > LOCK_HARD_STALE_MS) return true;
  return !sameProcessAlive(holder.pid, holder.startedAt) && !sameProcessAlive(holder.childPid, holder.childStartedAt);
}

/**
 * Remove a takeover file left by a killed process, but only the one we saw:
 * move it aside (atomic), and if the moved file is a newer one (another
 * process took the mutex in between), put it back.
 */
function clearDeadMutex(mutex, seenNonce) {
  const aside = `${mutex}.${process.pid}.${randomUUID()}`;
  try { renameSync(mutex, aside); } catch { return; }
  let nonce = null;
  try { nonce = readFileSync(aside, 'utf8').trim() || null; } catch { /* unreadable */ }
  if (nonce !== seenNonce) {
    try { linkSync(aside, mutex); } catch { /* a third process holds a new one */ }
  }
  try { unlinkSync(aside); } catch { /* gone */ }
}

/**
 * Take the machine-wide probe lock. Returns one of:
 *   { status: 'acquired', release(), setChildPid(pid) }
 *   { status: 'busy' }         another live process holds it
 *   { status: 'unavailable' }  the cache directory cannot be written
 *
 * The holder records its pid and the pid of its running test child, so a
 * lock is taken over only when both are dead (a killed indexer's child can
 * outlive it for a moment). Takeover runs under a second exclusive file and
 * re-checks that the lock still holds the same stale holder, so two
 * processes cannot both delete and re-create it.
 */
export function tryAcquireProbeLock({ cacheDir, now = Date.now() } = {}) {
  const dir = cacheDir ?? getOrtGraphCacheDir();
  const p = path.join(dir, INDEX_DEVICE_LOCK_FILE);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return { status: 'unavailable' };
  }
  const token = { pid: process.pid, startedAt: OWN_START_MS, nonce: randomUUID(), at: new Date(now).toISOString() };
  const owns = () => {
    try { return JSON.parse(readFileSync(p, 'utf8'))?.nonce === token.nonce; } catch { return false; }
  };
  const lock = {
    status: 'acquired',
    release() {
      try { if (owns()) unlinkSync(p); } catch { /* already gone */ }
    },
    setChildPid(childPid) {
      if (!owns()) return;
      const tmp = `${p}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, JSON.stringify({ ...token, childPid, childStartedAt: Date.now() }));
        renameSync(tmp, p);
      } catch { /* the parent pid alone still marks the lock as held */ }
    },
  };
  const create = () => {
    const fd = openSync(p, 'wx');
    try { writeFileSync(fd, JSON.stringify(token)); } finally { closeSync(fd); }
    return lock;
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return create();
    } catch (err) {
      if (err?.code !== 'EEXIST') return { status: 'unavailable' };
    }
    const seen = inspectLock(p, now);
    if (!seen) continue; // released between our create and our look
    if (!isLockStale(seen)) return { status: 'busy' };

    const mutex = `${p}.takeover`;
    const mutexNonce = randomUUID();
    try {
      const fd = openSync(mutex, 'wx');
      try { writeFileSync(fd, mutexNonce); } finally { closeSync(fd); }
    } catch (err) {
      if (err?.code !== 'EEXIST') return { status: 'unavailable' };
      // A takeover takes milliseconds; a mutex this old was left by a killed process.
      let ageMs = 0;
      let seenNonce = null;
      try {
        ageMs = now - statSync(mutex).mtimeMs;
        seenNonce = readFileSync(mutex, 'utf8').trim() || null;
      } catch { /* gone */ }
      if (ageMs > LOCK_UNREADABLE_STALE_MS) clearDeadMutex(mutex, seenNonce);
      return { status: 'busy' };
    }
    try {
      const again = inspectLock(p, now);
      if (again) {
        if (again.holder?.nonce !== seen.holder?.nonce || !isLockStale(again)) return { status: 'busy' };
        try { unlinkSync(p); } catch { /* gone */ }
      }
      try {
        return create();
      } catch (err) {
        return { status: err?.code === 'EEXIST' ? 'busy' : 'unavailable' };
      }
    } finally {
      try {
        if (readFileSync(mutex, 'utf8').trim() === mutexNonce) unlinkSync(mutex);
      } catch { /* gone */ }
    }
  }
  return { status: 'busy' };
}

/**
 * For the test child: exit when the parent dies (its stdin pipe closes, even
 * after SIGKILL of the parent) or when `deadlineMs` passes.
 */
export function exitWhenOrphaned(deadlineMs, { exit = (code) => process.exit(code) } = {}) {
  process.stdin.on('end', () => exit(3));
  process.stdin.on('close', () => exit(3));
  process.stdin.on('error', () => exit(3));
  process.stdin.resume();
  if (deadlineMs > 0) {
    setTimeout(() => {
      process.stderr.write(`index-device probe: deadline ${deadlineMs}ms passed\n`);
      exit(4);
    }, deadlineMs).unref();
  }
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

// Accelerator encoder labels (inference-provenance.js): native "<device>/<dtype>"
// with device metal or cuda, optionally "coreml+" first. "cpu/f32" (candle on
// CPU), "ort-…", "ort/cpu" and "model-server" are CPU encoders.
const ACCELERATOR_LABEL = /^(coreml\+)?(metal|cuda)\//;
const CPU_LABEL = /^(ort[-/]|cpu\/|model-server$)/;

/**
 * For benchmark builds: a message when an index that should have been
 * written by the accelerator has a tier (dense or late interaction) whose
 * recorded encoders are all CPU encoders, else null. Labels that are neither
 * ("unknown") do not fail the check. Indexes built before provenance was kept
 * (no counts) pass.
 */
export function acceleratorProvenanceProblem(manifest) {
  const problems = [];
  for (const [name, tier] of [['dense', manifest?.vectors?.encoders], ['late interaction', manifest?.lateInteraction?.encoders]]) {
    const labels = Object.entries(tier?.counts || {}).filter(([, n]) => n > 0).map(([label]) => label);
    if (labels.length === 0 || labels.some((l) => ACCELERATOR_LABEL.test(l))) continue;
    if (labels.every((l) => CPU_LABEL.test(l))) problems.push(`${name} written by CPU encoders only (${labels.join(', ')})`);
  }
  return problems.length ? `${problems.join('; ')}, expected the accelerator` : null;
}
