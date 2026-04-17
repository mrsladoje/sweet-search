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
  unloadLocalModel,
} from '../embedding/embedding-local-model.js';
import {
  getLateInteractionPipeline,
  encodeDocumentsCpu,
  unloadLateInteractionModel,
} from '../ranking/late-interaction-model.js';

/**
 * Small-changeset threshold. Incremental runs with fewer files than this use
 * ORT CPU instead of paying the GPU load+warmup+teardown cost, which would
 * dwarf the actual indexing work for tiny edits.
 */
export const GPU_ARMING_MIN_FILES = 20;

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

  let deviceKind;
  if (pref === 'coreml-cascade' || pref === 'candle-metal') {
    deviceKind = 'metal';
  } else {
    deviceKind = 'cpu';
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
