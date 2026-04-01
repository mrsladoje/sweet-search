// core/coreml-provider.js
// CoreML execution provider detection and configuration for macOS Apple Silicon.

import os from 'os';

/**
 * Check if running on macOS Apple Silicon (ARM64).
 * CoreML EP only benefits Apple Silicon; on Intel Macs it falls back to CPU anyway.
 */
export function isAppleSilicon() {
  return process.platform === 'darwin' && os.arch() === 'arm64';
}

let _coremlAvailable = null;

/**
 * Check if CoreML EP is available in the onnxruntime-node binary.
 * Uses ort.listSupportedBackends() which is available in ORT >= 1.18.
 * Result is cached after first call.
 */
export async function isCoreMLProviderAvailable() {
  if (_coremlAvailable !== null) return _coremlAvailable;
  try {
    const ort = await import('onnxruntime-node');
    if (typeof ort.listSupportedBackends === 'function') {
      const backends = ort.listSupportedBackends();
      _coremlAvailable = backends.some(b => b.name === 'coreml' && b.bundled);
      return _coremlAvailable;
    }
  } catch { /* ignore — ORT not installed or too old */ }
  _coremlAvailable = false;
  return false;
}

/**
 * Determine if CoreML EP should be used, following the same tri-state pattern
 * as SWEET_SEARCH_USE_OPENVINO: auto | on | off.
 *
 * "auto" (default): enable on Apple Silicon when provider is available.
 * "on"/"1"/"true": force enable (still gated to darwin+arm64).
 * "off"/"0"/"false": force disable.
 *
 * @param {boolean} providerAvailable - result of isCoreMLProviderAvailable()
 */
export function shouldUseCoreML(providerAvailable) {
  const raw = (process.env.SWEET_SEARCH_USE_COREML ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  if (!isAppleSilicon()) return false;

  const autoMode = raw === '' || raw === 'auto';
  const explicitOn = raw === '1' || raw === 'true' || raw === 'on';
  if (!autoMode && !explicitOn) return false;

  return providerAvailable;
}

/**
 * Build the executionProviders array for CoreML with CPU fallback.
 *
 * Two CoreML model formats exist:
 * - MLProgram (coreMlFlags 0x010): newer, supports ANE, requires Core ML 5+.
 *   Better performance when supported, but some models fail to compile.
 * - NeuralNetwork (coreMlFlags 0): older default, broader op coverage,
 *   silently casts FP32→FP16. Works with more model architectures.
 *
 * ORT 1.24+ uses lowercase backend names ('cpu', 'coreml', 'webgpu').
 * The legacy PascalCase names ('CPUExecutionProvider') are NOT recognized.
 *
 * @param {boolean} useMLProgram - true for MLProgram format, false for NeuralNetwork
 */
export function getCoreMLExecutionProviders(useMLProgram = true) {
  return [
    { name: 'coreml', coreMlFlags: useMLProgram ? 0x010 : 0 },
    'cpu',
  ];
}

/** Reset cached state (for testing and A/B benchmark pass switching). */
export function _resetCoreMLCache() {
  _coremlAvailable = null;
}
