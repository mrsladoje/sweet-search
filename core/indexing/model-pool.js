/**
 * Model Pool — GPU/CPU model lifecycle manager for the indexing pipeline.
 *
 * Lives in `core/indexing/` because indexing is the only domain that arms
 * GPU models; queries always use ORT CPU. Per the DDD dependency matrix,
 * `indexing → embedding/ranking/infrastructure` is allowed, so the imports
 * here stay static.
 *
 * Enforces the invariant that CPU (ORT) and GPU (native candle/CoreML)
 * models are never active simultaneously. The lifecycle:
 *
 *   1. teardownAllModels()     — kill everything (CPU + GPU)
 *   2. initIndexGpuPool()      — load GPU models + warmup forward pass
 *   3. ... indexing runs ...
 *   4. teardownIndexGpuPool()  — kill GPU models
 *   5. warmupQueryCpuModels()  — load ORT CPU models + warmup forward passes
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { detectHardwareCapability } from '../infrastructure/hardware-capability.js';
import {
  isNativeInferenceAvailable,
  loadNativeEmbeddingModelWithDevice,
  loadNativeLiModelWithDevice,
  warmupNativeEmbeddingModel,
  warmupNativeLiModel,
  unloadNativeModels,
} from '../infrastructure/native-inference.js';
import {
  getLocalPipeline,
  callLocalModelCpu,
  callLocalModelBucketed,
  unloadLocalModel,
  configureLocalModelRuntime,
  isBackgroundOrtProfile,
} from '../embedding/embedding-local-model.js';
import {
  getLateInteractionPipeline,
  encodeDocumentsCpu,
  encodeDocuments,
  unloadLateInteractionModel,
  configureLateInteractionRuntime,
} from '../ranking/late-interaction-model.js';
import { backgroundIntraOpThreads } from '../infrastructure/onnx-session-utils.js';
import { EMBEDDING_CONFIG, LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { getCoremlCascadeResolvedDirs } from '../infrastructure/coreml-cascade.js';
import {
  CPU_TTL_MS,
  CPU_WIN_MARGIN,
  PROBE_CHILD_TIMEOUT_MS,
  PROBE_RESULT_PREFIX,
  STABLE_TTL_MS,
  UNSTABLE_TTL_MS,
  decideIndexDevice,
  indexDeviceCacheKey,
  indexDeviceOverride,
  isCloseResult,
  readIndexDeviceChoice,
  splitDeviceSwitches,
  tryAcquireProbeLock,
  writeIndexDeviceChoice,
} from './index-device-choice.js';

/**
 * Small-changeset threshold. Incremental runs with fewer files than this use
 * ORT CPU instead of paying the GPU load+warmup+teardown cost, which would
 * dwarf the actual indexing work for tiny edits.
 */
export const GPU_ARMING_MIN_FILES = 20;

/**
 * Translate a hardware-capability `inferenceBackendPreference` string into
 * the ACCELERATOR deviceKind the native addon should arm — or `null` when
 * the host has no usable accelerator and indexing must stay on ORT INT8 CPU.
 *
 *   coreml-cascade | candle-metal → 'metal'
 *   candle-cuda                   → 'cuda'
 *   ort-cpu | candle-cpu | unknown / falsy → null   (no native arming)
 *
 * `candle-cpu` is mapped to `null` too — deliberately. "No accelerator" must
 * never resolve to "load candle on CPU": that path ships FP32 safetensors and
 * lives in a different embedding space than the ORT INT8 query encoder
 * (a measured MRR regression). The only non-accelerator preference the
 * detector emits today is 'ort-cpu'; 'candle-cpu' is handled defensively in
 * case a stale persisted value ever reaches this function.
 *
 * Pure function, exported for unit testing. Keeps the mapping in one place
 * so adding a future accelerator (e.g. "candle-rocm") is a single-location
 * edit that both init-time reporting and runtime dispatch consume.
 */
export function selectAcceleratorDeviceKind(pref) {
  if (pref === 'coreml-cascade' || pref === 'candle-metal') return 'metal';
  if (pref === 'candle-cuda') return 'cuda';
  return null;
}

/**
 * G3: arm the BACKGROUND/maintainer ORT profile for BOTH resident CPU
 * sessions — dense (embedding-local-model) and late-interaction. The profile
 * (force_spinning_stop + arena-off + 2–6 intra-op threads) prevents the two
 * resident-daemon pathologies: idle spinning workers (~a core of idle CPU)
 * and monotonic RSS from ORT arena extension (#25325; measured 354 × 128MB
 * ≈ 34GB after one edit-heavy day when the LI session was left on the
 * foreground profile). MUST run before the first encode — both session
 * singletons are built once; configuring after is a silent no-op.
 *
 * Lives here (model-pool owns indexing-side model lifecycle) so daemon
 * entrypoints don't need their own cross-context imports of the two model
 * modules.
 *
 * @returns {{armed: boolean}}
 */
export function armBackgroundOrtProfiles() {
  const intraOpThreads = backgroundIntraOpThreads();
  configureLocalModelRuntime({ intraOpThreads, background: true });
  configureLateInteractionRuntime({ intraOpThreads, background: true });
  return { armed: true };
}

/**
 * Whether this host has an inference accelerator (Metal / CoreML cascade /
 * CUDA) and a loadable native addon. Hardware only — it ignores the
 * index-device speed test. Reads the cached hardware-capability snapshot.
 */
export function hasIndexAcceleratorHardware() {
  if (!isNativeInferenceAvailable()) return false;
  return selectAcceleratorDeviceKind(
    detectHardwareCapability().inferenceBackendPreference,
  ) !== null;
}

// 'cpu' | 'accelerator' | null — set by ensureIndexDeviceChoice() for this
// process. null = no choice made yet → the accelerator (if any) is used.
let _indexDeviceChoice = null;

/**
 * Whether this process should index on the accelerator. False when there is
 * no accelerator, OR when SWEET_SEARCH_INDEX_DEVICE=cpu, OR when the speed
 * test (ensureIndexDeviceChoice) found ORT INT8 CPU clearly faster. When
 * false, indexing stays on the optimized ORT INT8 CPU path and the GPU arm →
 * teardown → CPU-rewarm lifecycle is skipped entirely.
 */
export function isIndexAcceleratorAvailable() {
  if (!hasIndexAcceleratorHardware()) return false;
  const override = indexDeviceOverride();
  if (override) return override === 'accelerator';
  return _indexDeviceChoice !== 'cpu';
}

/** Test hook: forget this process's index-device choice. */
export function _resetIndexDeviceChoice() {
  _indexDeviceChoice = null;
}

/**
 * The indexer's own encode entry points and runtime setters, for the
 * index-device test child (index-device-probe-child.mjs): dense through the
 * bucketing dispatcher, late interaction through the encodeDocuments
 * dispatcher — the same calls indexing makes.
 */
export const probeEncoders = Object.freeze({
  embed: (texts) => callLocalModelBucketed(texts, {}),
  encodeLi: (texts) => encodeDocuments(texts, {}),
  configureRuntimes({ embeddingThreads = null, lateInteractionThreads = null, background = false } = {}) {
    configureLocalModelRuntime({ intraOpThreads: embeddingThreads, ...(background ? { background: true } : {}) });
    configureLateInteractionRuntime({ intraOpThreads: lateInteractionThreads, ...(background ? { background: true } : {}) });
  },
});

const PROBE_CHILD = fileURLToPath(new URL('./index-device-probe-child.mjs', import.meta.url));

/**
 * Run one side of the test in a child process and wait for it to exit (see
 * index-device-probe-child.mjs). Resolves to the child's timing in ms.
 *
 * The child cannot outlive this process: it exits when its stdin pipe closes
 * (the parent died, even by SIGKILL), it has its own deadline, and an exiting
 * parent kills it. `onSpawn(pid)` lets the caller record the child in the
 * probe lock.
 */
export function runProbeChild(device, setup, { timeoutMs = PROBE_CHILD_TIMEOUT_MS, onSpawn, childPath = PROBE_CHILD } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, SWEET_SEARCH_INDEX_DEVICE: device };
    if (setup.includeLi && setup.liModel) env.SWEET_SEARCH_LATE_INTERACTION_MODEL = setup.liModel;
    const child = spawn(process.execPath, [childPath, JSON.stringify({ ...setup, device, deadlineMs: timeoutMs })], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const killChild = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
    process.once('exit', killChild);
    if (child.pid) onSpawn?.(child.pid);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.stdin.on('error', () => { /* child exited first */ });
    const timer = setTimeout(killChild, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      process.removeListener('exit', killChild);
    };
    child.on('error', (e) => { done(); reject(e); });
    child.on('close', (code, signal) => {
      done();
      const line = out.split('\n').find((l) => l.startsWith(PROBE_RESULT_PREFIX));
      if (code === 0 && line) {
        try {
          const result = JSON.parse(line.slice(PROBE_RESULT_PREFIX.length));
          if (result.ms > 0) return resolve(result.ms);
        } catch { /* fall through */ }
      }
      const tail = err.trim().split('\n').slice(-3).join(' | ');
      reject(new Error(`${device} probe ${signal ? `killed (${signal})` : `exited ${code}`}${tail ? `: ${tail}` : ''}`));
    });
  });
}

/**
 * Time the same chunks on ORT INT8 CPU and on the accelerator, each in its
 * own child process, one after the other. A second run, in the opposite
 * order, follows when the first result is close to the margin OR picks the
 * CPU: other GPU work on the machine (another project indexing) or a hot
 * chip can slow the accelerator side of one run, and a wrong "cpu" costs
 * every core. When the two runs disagree, the result is marked unstable (it
 * keeps the accelerator, cached for a short time). After two runs it reports
 * the CPU's slower time and the accelerator's faster time, which leans to the
 * accelerator.
 */
export async function measureIndexDevices(setup, { runChild = runProbeChild, onSpawn } = {}) {
  const run = (device) => runChild(device, setup, { onSpawn });
  const first = {
    cpuMs: await run('cpu'),
    acceleratorMs: await run('accelerator'),
  };
  if (!isCloseResult(first) && decideIndexDevice(first) === 'accelerator') return { ...first, runs: 1, stable: true };
  const second = {
    acceleratorMs: await run('accelerator'),
    cpuMs: await run('cpu'),
  };
  const stable = decideIndexDevice(first) === decideIndexDevice(second);
  return {
    cpuMs: Math.max(first.cpuMs, second.cpuMs),
    acceleratorMs: Math.min(first.acceleratorMs, second.acceleratorMs),
    runs: 2,
    stable,
  };
}

/**
 * Release `lock` if this process exits or is stopped by SIGINT / SIGTERM
 * while the test runs (a `finally` does not run then). Returns the
 * function that removes the handlers.
 */
function releaseLockOnExit(lock) {
  const onExit = () => lock.release();
  const onSignal = (signal) => {
    lock.release();
    remove();
    // With no other handler, re-raise for the default action (the process
    // ends); a handler of the indexer's own already got this signal.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  const remove = () => {
    process.removeListener('exit', onExit);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  };
  process.once('exit', onExit);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return remove;
}

const _pendingChoices = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decide, once per machine + setup, whether indexing runs on the accelerator
 * or on ORT INT8 CPU, and apply the choice to this process. Order: no
 * accelerator → cpu; SWEET_SEARCH_INDEX_DEVICE override; cached result;
 * otherwise measure (only when `allowMeasure` — the caller passes true only
 * when it would arm the accelerator anyway, so small incremental runs never
 * pay for the test). The test runs under a machine-wide lock; a process that
 * finds the lock taken waits for the other's result, and keeps the
 * accelerator if none arrives in `lockWaitMs`. A failed test keeps the
 * accelerator and is cached as such for 1 day (so a slow or broken test is
 * not paid on every run). A split-device switch (see splitDeviceSwitches) or
 * a cache directory that cannot be written keeps the accelerator with no test.
 *
 * `parallel`, `cpuPool` and `cpuLiPool` are the schedule and the CPU worker
 * pools the run will really use (index-device-choice.js::indexDeviceRunShape).
 *
 * @returns {Promise<{device: 'cpu'|'accelerator', source: string, cpuMs?: number, acceleratorMs?: number}>}
 */
export async function ensureIndexDeviceChoice({
  allowMeasure = false,
  includeLi = true,
  parallel = false,
  cpuPool = null,
  cpuLiPool = null,
  embeddingThreads = null,
  lateInteractionThreads = null,
  liBatch = {},
  measure = measureIndexDevices,
  cacheDir,
  lockWaitMs = 3 * 60 * 1000,
  lockPollMs = 1000,
} = {}) {
  if (!hasIndexAcceleratorHardware()) {
    _indexDeviceChoice = null;
    return { device: 'cpu', source: 'no-accelerator' };
  }
  const override = indexDeviceOverride();
  if (override) {
    _indexDeviceChoice = override;
    return { device: override, source: 'env' };
  }
  const split = splitDeviceSwitches();
  if (split.length > 0) {
    _indexDeviceChoice = null;
    return { device: 'accelerator', source: 'split-device', switches: split };
  }

  const hw = detectHardwareCapability();
  // Late interaction counts only when it is really on: a persisted
  // `--li-model none` disables it without the --no-late-interaction flag.
  const liOn = includeLi && LATE_INTERACTION_CONFIG.enabled && !!LATE_INTERACTION_CONFIG.activeModel;
  const liModel = liOn ? LATE_INTERACTION_CONFIG.model : null;
  const setup = {
    includeLi: liOn,
    liModel,
    parallel: liOn && parallel,
    cpuPool: cpuPool && cpuPool.workers > 1 ? { workers: cpuPool.workers, threadsPerWorker: cpuPool.threadsPerWorker } : null,
    cpuLiPool: liOn && cpuLiPool && cpuLiPool.workers > 1
      ? { workers: cpuLiPool.workers, threadsPerWorker: cpuLiPool.threadsPerWorker }
      : null,
    embeddingThreads,
    lateInteractionThreads,
    liBatch,
    background: isBackgroundOrtProfile(),
    backgroundProfile: isBackgroundOrtProfile(),
    embeddingModel: EMBEDDING_CONFIG.model,
    cascadeStatus: hw.inferenceBackendPreference === 'coreml-cascade'
      ? getCoremlCascadeResolvedDirs(liModel || 'lateon-code').status
      : null,
  };
  const key = indexDeviceCacheKey({ hw, setup });

  const cached = readIndexDeviceChoice(key, { cacheDir });
  if (cached) {
    _indexDeviceChoice = cached.failed ? null : cached.device;
    return { ...cached, source: cached.failed ? 'cached-failure' : 'cached' };
  }
  if (!allowMeasure) {
    _indexDeviceChoice = null;
    return { device: 'accelerator', source: 'default' };
  }

  // One test per key per process, even when callers overlap.
  if (!_pendingChoices.has(key)) {
    _pendingChoices.set(key, (async () => {
      const deadline = Date.now() + lockWaitMs;
      let lock = tryAcquireProbeLock({ cacheDir });
      while (lock.status !== 'acquired') {
        if (lock.status === 'unavailable') return { device: 'accelerator', source: 'cache-unwritable' };
        const other = readIndexDeviceChoice(key, { cacheDir });
        if (other) return { ...other, source: 'cached' };
        if (Date.now() >= deadline) return { device: 'accelerator', source: 'lock-busy' };
        await sleep(lockPollMs);
        lock = tryAcquireProbeLock({ cacheDir });
      }
      const removeExitHandlers = releaseLockOnExit(lock);
      try {
        // Another process may have finished the test while we waited.
        const other = readIndexDeviceChoice(key, { cacheDir });
        if (other) return { ...other, source: 'cached' };
        // No model of this process may stay resident while a child loads its own.
        await teardownAllModels();
        let measured;
        try {
          measured = await measure(setup, { onSpawn: (pid) => lock.setChildPid(pid) });
        } catch (err) {
          const now = Date.now();
          const error = err?.message ?? String(err);
          writeIndexDeviceChoice(key, {
            device: 'accelerator',
            failed: true,
            error: error.slice(0, 500),
            measuredAt: new Date(now).toISOString(),
            expiresAt: new Date(now + UNSTABLE_TTL_MS).toISOString(),
          }, { cacheDir });
          return { device: 'accelerator', source: 'measure-failed', error };
        }
        const { cpuMs, acceleratorMs, runs, stable } = measured;
        const device = stable ? decideIndexDevice({ cpuMs, acceleratorMs }) : 'accelerator';
        const now = Date.now();
        const ttl = !stable ? UNSTABLE_TTL_MS : device === 'cpu' ? CPU_TTL_MS : STABLE_TTL_MS;
        const entry = {
          device,
          cpuMs: Math.round(cpuMs),
          acceleratorMs: Math.round(acceleratorMs),
          runs,
          stable,
          margin: CPU_WIN_MARGIN,
          measuredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + ttl).toISOString(),
        };
        writeIndexDeviceChoice(key, entry, { cacheDir });
        return { ...entry, source: 'measured' };
      } catch (err) {
        return { device: 'accelerator', source: 'measure-failed', error: err?.message ?? String(err) };
      } finally {
        removeExitHandlers();
        lock.release();
      }
    })().finally(() => _pendingChoices.delete(key)));
  }
  const result = await _pendingChoices.get(key);
  _indexDeviceChoice = ['measure-failed', 'lock-busy', 'cache-unwritable'].includes(result.source) ? null : result.device;
  return result;
}

let _gpuDiag = null;
let _cpuDiag = null;

/**
 * Kill ALL resident models — ORT CPU and native GPU.
 * MUST be called before arming GPU to enforce no-coexistence.
 */
export async function teardownAllModels() {
  await unloadLocalModel();
  await unloadLateInteractionModel();
  unloadNativeModels();

  _gpuDiag = null;
  _cpuDiag = null;
}

/**
 * Load native GPU models (embedding + LI) using hardware-auto-detected
 * device, then run a warmup forward pass on each.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeLi=true] - Also load the LI model
 * @returns {{ backend: string, embedLoadMs: number, embedWarmMs: number, liLoadMs: number, liWarmMs: number }}
 */
export async function initIndexGpuPool({ includeLi = true } = {}) {
  if (!isNativeInferenceAvailable()) {
    _gpuDiag = { backend: 'unavailable', embedLoadMs: 0, embedWarmMs: 0, liLoadMs: 0, liWarmMs: 0 };
    return _gpuDiag;
  }

  const hw = detectHardwareCapability();
  const pref = hw.inferenceBackendPreference;

  const deviceKind = selectAcceleratorDeviceKind(pref);

  // No usable accelerator → do NOT load native/candle models. Indexing
  // proceeds on the ORT INT8 CPU path (inline or via the embedding worker
  // pool). This is the authoritative JS-side guard: even if a CPU-only host
  // happens to have the native addon installed (an optional package), we
  // never arm candle on CPU here — that would ship FP32 safetensors and
  // diverge from the ORT INT8 query encoder. callers (indexer-phases) already
  // gate on isIndexAcceleratorAvailable(); this early-return keeps
  // initIndexGpuPool independently correct and ensures we never lean on the
  // Rust layer silently degrading loadWithDevice('metal'|'cuda') to CPU.
  if (deviceKind === null) {
    _gpuDiag = { backend: 'ort-cpu', embedLoadMs: 0, embedWarmMs: 0, liLoadMs: 0, liWarmMs: 0 };
    return _gpuDiag;
  }

  let embedLoadMs = 0;
  let embedWarmMs = 0;
  let liLoadMs = 0;
  let liWarmMs = 0;

  const t0 = Date.now();
  await loadNativeEmbeddingModelWithDevice(deviceKind);
  embedLoadMs = Date.now() - t0;

  if (includeLi) {
    const t1 = Date.now();
    await loadNativeLiModelWithDevice(deviceKind);
    liLoadMs = Date.now() - t1;
  }

  const warmTasks = [];

  const warmEmbed = async () => {
    const t = Date.now();
    await warmupNativeEmbeddingModel();
    embedWarmMs = Date.now() - t;
  };
  warmTasks.push(warmEmbed());

  if (includeLi) {
    const warmLi = async () => {
      const t = Date.now();
      await warmupNativeLiModel();
      liWarmMs = Date.now() - t;
    };
    warmTasks.push(warmLi());
  }

  await Promise.all(warmTasks);

  _gpuDiag = { backend: pref, embedLoadMs, embedWarmMs, liLoadMs, liWarmMs };
  return _gpuDiag;
}

/**
 * Tear down GPU models after indexing. Does NOT load CPU models —
 * call warmupQueryCpuModels() separately.
 */
export function teardownIndexGpuPool() {
  unloadNativeModels();
  _gpuDiag = null;
}

/**
 * Load ORT CPU models (embedding INT8 + LI ORT session) and run a single
 * dummy forward pass on each to warm BLAS thread pools. Both models are
 * warmed so the first query pays no cold-start cost on either path.
 */
export async function warmupQueryCpuModels() {
  const t0 = Date.now();
  await Promise.all([getLocalPipeline(), getLateInteractionPipeline()]);
  const loadMs = Date.now() - t0;

  const t1 = Date.now();
  const [embedOk, liOk] = await Promise.all([
    callLocalModelCpu(['warmup'], { maxLength: 64 }).then(() => true, () => false),
    encodeDocumentsCpu(['warmup'], { maxLength: 64 }).then(() => true, () => false),
  ]);
  const warmMs = Date.now() - t1;

  _cpuDiag = { loadMs, warmMs, embedOk, liOk };
  return _cpuDiag;
}

export function getPoolDiagnostics() {
  return { gpu: _gpuDiag, cpu: _cpuDiag };
}
