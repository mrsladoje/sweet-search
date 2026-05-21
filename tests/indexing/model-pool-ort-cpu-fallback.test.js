/**
 * Unit tests for the no-accelerator (ORT INT8 CPU) fallback in
 * core/indexing/model-pool.js.
 *
 * The contract under test (AGENTS.md "wrong CPU fallback cascade" fix):
 *   - On a host with no usable accelerator (inferenceBackendPreference
 *     === 'ort-cpu'), `initIndexGpuPool()` MUST return a `{ backend:
 *     'ort-cpu' }` diagnostic WITHOUT loading any native model — even when
 *     the native addon happens to be present. That keeps indexing on the ORT
 *     INT8 CPU path, matching the always-ORT-INT8 query encoder, and never
 *     loads candle/native FP32 on CPU.
 *   - On a Metal/CUDA host, the native loaders ARE called with the right
 *     device kind (the existing accelerated path is preserved).
 *
 * native-inference + hardware-capability are mocked so the test never touches
 * the real napi addon or sysctl — it asserts purely on dispatch decisions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/infrastructure/hardware-capability.js', () => ({
  detectHardwareCapability: vi.fn(),
}));

vi.mock('../../core/infrastructure/native-inference.js', () => ({
  isNativeInferenceAvailable: vi.fn(() => true),
  loadNativeEmbeddingModelWithDevice: vi.fn(async () => ({ dim: 768 })),
  loadNativeLiModelWithDevice: vi.fn(async () => ({ dim: 128 })),
  warmupNativeEmbeddingModel: vi.fn(async () => {}),
  warmupNativeLiModel: vi.fn(async () => {}),
  unloadNativeModels: vi.fn(),
}));

import {
  initIndexGpuPool,
  isIndexAcceleratorAvailable,
} from '../../core/indexing/model-pool.js';
import { detectHardwareCapability } from '../../core/infrastructure/hardware-capability.js';
import {
  isNativeInferenceAvailable,
  loadNativeEmbeddingModelWithDevice,
  loadNativeLiModelWithDevice,
} from '../../core/infrastructure/native-inference.js';

const setPreference = (pref) =>
  detectHardwareCapability.mockReturnValue({ inferenceBackendPreference: pref });

describe('initIndexGpuPool — no-accelerator (ort-cpu) fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativeInferenceAvailable.mockReturnValue(true);
  });

  it('returns { backend: "ort-cpu" } and loads NO native models when preference is ort-cpu', async () => {
    setPreference('ort-cpu');

    const diag = await initIndexGpuPool();

    expect(diag.backend).toBe('ort-cpu');
    expect(loadNativeEmbeddingModelWithDevice).not.toHaveBeenCalled();
    expect(loadNativeLiModelWithDevice).not.toHaveBeenCalled();
  });

  it('loads NO native models even when a stale candle-cpu preference reaches the pool', async () => {
    // Defensive: the detector no longer emits 'candle-cpu', but if it ever
    // did, "no accelerator" must still never mean "load candle on CPU".
    setPreference('candle-cpu');

    const diag = await initIndexGpuPool();

    expect(diag.backend).toBe('ort-cpu');
    expect(loadNativeEmbeddingModelWithDevice).not.toHaveBeenCalled();
    expect(loadNativeLiModelWithDevice).not.toHaveBeenCalled();
  });

  it('returns { backend: "unavailable" } and loads nothing when the native addon is absent', async () => {
    isNativeInferenceAvailable.mockReturnValue(false);
    setPreference('candle-metal'); // even an accelerator-capable host

    const diag = await initIndexGpuPool();

    expect(diag.backend).toBe('unavailable');
    expect(loadNativeEmbeddingModelWithDevice).not.toHaveBeenCalled();
    expect(loadNativeLiModelWithDevice).not.toHaveBeenCalled();
  });

  it('arms native embedding + LI on metal (candle-metal) — accelerated path preserved', async () => {
    setPreference('candle-metal');

    const diag = await initIndexGpuPool({ includeLi: true });

    expect(diag.backend).toBe('candle-metal');
    expect(loadNativeEmbeddingModelWithDevice).toHaveBeenCalledWith('metal');
    expect(loadNativeLiModelWithDevice).toHaveBeenCalledWith('metal');
  });

  it('arms native embedding on cuda (candle-cuda); skips LI when includeLi=false', async () => {
    setPreference('candle-cuda');

    const diag = await initIndexGpuPool({ includeLi: false });

    expect(diag.backend).toBe('candle-cuda');
    expect(loadNativeEmbeddingModelWithDevice).toHaveBeenCalledWith('cuda');
    expect(loadNativeLiModelWithDevice).not.toHaveBeenCalled();
  });

  it('maps coreml-cascade to the metal device kind', async () => {
    setPreference('coreml-cascade');

    const diag = await initIndexGpuPool({ includeLi: true });

    expect(diag.backend).toBe('coreml-cascade');
    expect(loadNativeEmbeddingModelWithDevice).toHaveBeenCalledWith('metal');
    expect(loadNativeLiModelWithDevice).toHaveBeenCalledWith('metal');
  });
});

describe('isIndexAcceleratorAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is false on a no-accelerator (ort-cpu) host', () => {
    setPreference('ort-cpu');
    expect(isIndexAcceleratorAvailable()).toBe(false);
  });

  it('is true on Metal / CoreML cascade hosts', () => {
    setPreference('candle-metal');
    expect(isIndexAcceleratorAvailable()).toBe(true);
    setPreference('coreml-cascade');
    expect(isIndexAcceleratorAvailable()).toBe(true);
  });

  it('is true on a CUDA host', () => {
    setPreference('candle-cuda');
    expect(isIndexAcceleratorAvailable()).toBe(true);
  });

  it('is false when native inference is disabled even on accelerator hardware', () => {
    isNativeInferenceAvailable.mockReturnValue(false);
    setPreference('candle-metal');

    expect(isIndexAcceleratorAvailable()).toBe(false);
  });
});
