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
  callLocalModelGpu,
  unloadLocalModel,
  configureLocalModelRuntime,
  isBackgroundOrtProfile,
} from '../embedding/embedding-local-model.js';
import {
  getLateInteractionPipeline,
  encodeDocumentsCpu,
  encodeDocumentsGpu,
  unloadLateInteractionModel,
  configureLateInteractionRuntime,
} from '../ranking/late-interaction-model.js';
import { backgroundIntraOpThreads } from '../infrastructure/onnx-session-utils.js';
import { LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import {
  buildProbeTexts,
  decideIndexDevice,
  indexDeviceCacheKey,
  indexDeviceOverride,
  readIndexDeviceChoice,
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
 * (force_spinning_stop + arena-off + 2–4 intra-op threads) prevents the two
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

async function timeEncodes({ embed, encodeLi, texts, batchSize }) {
  // Warm up on a full batch first: Metal compiles pipelines per shape and ORT
  // grows its arena on the first run; neither belongs in the timing.
  const warm = texts.slice(0, batchSize);
  await embed(warm);
  if (encodeLi) await encodeLi(warm);
  const t0 = performance.now();
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    await embed(batch);
    if (encodeLi) await encodeLi(batch);
  }
  return performance.now() - t0;
}

/**
 * Time the same chunks on ORT INT8 CPU and on the accelerator, one device at
 * a time (CPU and GPU models never coexist), and unload everything after.
 * The CPU side uses the indexer's own thread plan but runs inline, while the
 * real CPU index can use a worker pool — so the test leans to the
 * accelerator, which is the side we keep on a tie anyway.
 */
export async function measureIndexDevices({
  includeLi = true,
  embeddingThreads,
  lateInteractionThreads,
  texts = buildProbeTexts(32),
  batchSize = 16,
} = {}) {
  await teardownAllModels();
  if (embeddingThreads) configureLocalModelRuntime({ intraOpThreads: embeddingThreads });
  if (lateInteractionThreads) configureLateInteractionRuntime({ intraOpThreads: lateInteractionThreads });
  try {
    const cpuMs = await timeEncodes({
      embed: callLocalModelCpu,
      encodeLi: includeLi ? encodeDocumentsCpu : null,
      texts,
      batchSize,
    });
    await teardownAllModels();
    await initIndexGpuPool({ includeLi });
    const acceleratorMs = await timeEncodes({
      embed: callLocalModelGpu,
      encodeLi: includeLi ? encodeDocumentsGpu : null,
      texts,
      batchSize,
    });
    return { cpuMs, acceleratorMs, chunks: texts.length };
  } finally {
    await teardownAllModels();
  }
}

/**
 * Decide, once per machine + setup, whether indexing runs on the accelerator
 * or on ORT INT8 CPU, and apply the choice to this process. Order: no
 * accelerator → cpu; SWEET_SEARCH_INDEX_DEVICE override; cached result;
 * otherwise measure (only when `allowMeasure` — the caller passes true only
 * when it would arm the accelerator anyway, so small incremental runs never
 * pay for the test). A failed test keeps the accelerator and is not cached.
 *
 * @returns {Promise<{device: 'cpu'|'accelerator', source: string, cpuMs?: number, acceleratorMs?: number}>}
 */
export async function ensureIndexDeviceChoice({
  allowMeasure = false,
  includeLi = true,
  embeddingThreads,
  lateInteractionThreads,
  measure = measureIndexDevices,
  cacheDir,
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
  const key = indexDeviceCacheKey({
    hw: detectHardwareCapability(),
    liModel: LATE_INTERACTION_CONFIG.model,
    includeLi,
    backgroundProfile: isBackgroundOrtProfile(),
  });
  const cached = readIndexDeviceChoice(key, { cacheDir });
  if (cached) {
    _indexDeviceChoice = cached.device;
    return { ...cached, source: 'cached' };
  }
  if (!allowMeasure) {
    _indexDeviceChoice = null;
    return { device: 'accelerator', source: 'default' };
  }
  try {
    const { cpuMs, acceleratorMs, chunks } = await measure({ includeLi, embeddingThreads, lateInteractionThreads });
    const device = decideIndexDevice({ cpuMs, acceleratorMs });
    const entry = {
      device,
      cpuMs: Math.round(cpuMs),
      acceleratorMs: Math.round(acceleratorMs),
      chunks,
      measuredAt: new Date().toISOString(),
    };
    writeIndexDeviceChoice(key, entry, { cacheDir });
    _indexDeviceChoice = device;
    return { ...entry, source: 'measured' };
  } catch (err) {
    _indexDeviceChoice = null;
    return { device: 'accelerator', source: 'measure-failed', error: err?.message ?? String(err) };
  }
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
