/**
 * Hardware Capability Detection — identifies the current machine's chip
 * family, accelerator generation, and preferred native inference backend.
 *
 * Used by:
 *   - coreml-cascade.js         → gates cascade fetch/build on M3+ ANE viability
 *   - native-inference.js       → backend selection diagnostics
 *   - scripts/init.js           → decides what artifacts to fetch for the profile
 *   - scripts/uninstall.js      → only removes cascade cache if it exists
 *
 * Design notes:
 *   - `sysctl` is a cheap (~5 ms) one-shot call. The result is cached so
 *     repeated consumers (init, native-inference, uninstall) all share one
 *     detection. Hardware doesn't change at runtime.
 *   - Never throws. Unknown hardware degrades to "candle-cpu fallback" —
 *     this module is only advisory; absence of a capability is never an
 *     error.
 *   - Unknown new Apple chips (e.g. an M5 shipped after this file) are
 *     admitted as cascade-eligible via the ">= 3" rule — we prefer
 *     optimistic new-hardware behavior to silently refusing to try.
 *   - CUDA detection combines two signals: (1) an "addon built with the
 *     cuda feature?" probe via `native_cuda_available()`, and
 *     (2) `nvidia-smi` output for GPU name + compute capability + VRAM.
 *     The addon probe is authoritative for "is CUDA end-to-end usable";
 *     `nvidia-smi` fills in the diagnostic fields. See the CUDA Backend
 *     section in docs/INIT_STRATEGY.md for the full contract.
 */

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { resolveNativeAddon } from './native-resolver.js';
import { createRequire } from 'node:module';

let _cached = null;

/**
 * Parse an Apple chip brand string from `sysctl -n machdep.cpu.brand_string`
 * into a structured descriptor.
 *
 * Known formats:
 *   "Apple M1"            → { family: "M1", generation: 1, variant: "base" }
 *   "Apple M2 Pro"        → { family: "M2", generation: 2, variant: "pro" }
 *   "Apple M3 Max"        → { family: "M3", generation: 3, variant: "max" }
 *   "Apple M4 Ultra"      → { family: "M4", generation: 4, variant: "ultra" }
 *
 * Returns `null` for unrecognised strings (including Intel brand strings).
 */
export function parseAppleChipBrandString(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/\bApple\s+(M(\d+))(?:\s+(Pro|Max|Ultra))?\b/i);
  if (!match) return null;
  return {
    family: match[1].toUpperCase(),
    generation: parseInt(match[2], 10),
    variant: match[3] ? match[3].toLowerCase() : 'base',
  };
}

/**
 * Read CPU brand string via `sysctl`. Only called on darwin; returns
 * `null` on any failure (sandboxed env, sysctl missing, non-zero exit).
 */
function sysctlBrandString() {
  try {
    const out = execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Minimum Apple generation for which the CoreML variant cascade is
 * expected to beat candle Metal BF16 at our NomicBERT + ModernBERT
 * workload.
 *
 * Why M3:
 *   - M1 ANE ≈ 11 TOPS int8; M2 ≈ 15.8; M3 ≈ 18; M4 ≈ 38.
 *   - Our end-to-end measurement on M3 Max saw 18% wall-clock reduction
 *     vs Metal BF16 baseline (commit 4fd9c9a).
 *   - M1/M2 ANE TOPS are below M3 and the spike's measured per-batch
 *     latency improvement on smaller shapes does not cover the mlmodelc
 *     compile overhead for those generations. Rather than ship a
 *     fancier feature that regresses on older hardware, we gate on M3+.
 *   - A future measurement on M1/M2 with a smaller cascade subset could
 *     lower this threshold. For now, conservative gating.
 */
const MIN_APPLE_GENERATION_FOR_CASCADE = 3;

/**
 * Minimum NVIDIA compute capability (as a float) we target for the CUDA
 * backend.
 *
 * Why 7.0:
 *   - SM 6.x (Pascal, e.g. GTX 1080) has no tensor cores. Candle's
 *     stock matmul on CUDA cores runs slower than modern CPU BLAS for
 *     our small (b≤64, s≤1024) shapes. Net regression vs CPU.
 *   - SM 7.0 (Volta, V100) has first-gen tensor cores + F16 matmul with
 *     F32 accumulate. Works, but we pin F32 dtype here because F16 has
 *     precision issues on this generation.
 *   - SM 7.5 (Turing, T4/RTX 20xx) has second-gen tensor cores. F16
 *     works cleanly with F32 accumulate via cuBLASLt / cuDNN.
 *   - SM 8.0+ (Ampere/Ada/Hopper) adds BF16 tensor cores. BF16 is the
 *     default on this tier, matching the Metal story.
 *
 * See the per-CC dtype policy in
 * crates/sweet-search-native/src/inference/mod.rs::optimal_dtype for
 * the full mapping. JS layer is responsible for parsing the
 * `nvidia-smi` compute_cap output and setting
 * SWEET_SEARCH_CUDA_COMPUTE_CAP before the addon loads models.
 */
const MIN_CUDA_COMPUTE_CAPABILITY = 7.0;

/**
 * Parse `nvidia-smi --query-gpu=name,compute_cap,memory.total,driver_version`
 * CSV output into a structured descriptor. Returns `null` on anything
 * unparseable — the surrounding `detectNvidiaGpu()` treats that as
 * "no GPU" just like a missing `nvidia-smi` binary.
 *
 * Expected first data line:
 *   "NVIDIA GeForce RTX 3090, 8.6, 24576, 535.129.03"
 */
export function parseNvidiaSmiOutput(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const firstLine = raw.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!firstLine) return null;
  const cols = firstLine.split(',').map((s) => s.trim());
  if (cols.length < 4) return null;
  const [name, computeCapability, memoryMB, driverVersion] = cols;
  const memInt = parseInt(memoryMB, 10);
  const ccFloat = parseFloat(computeCapability);
  if (!name || !Number.isFinite(ccFloat) || !Number.isFinite(memInt)) return null;
  return {
    name,
    computeCapability,            // string "8.6" — kept as string for faithful passthrough
    computeCapabilityFloat: ccFloat, // float for comparisons
    memoryMB: memInt,
    driverVersion,
  };
}

/**
 * Shell out to `nvidia-smi` on Linux and return the first GPU's metadata.
 * Silent failure (returns `null`) on any of: non-Linux host, missing
 * binary, non-zero exit, malformed output. Bounded at 2s timeout so a
 * hung GPU doesn't block init.
 */
function detectNvidiaGpu() {
  if (process.platform !== 'linux') return null;
  try {
    const out = execFileSync(
      'nvidia-smi',
      [
        '--query-gpu=name,compute_cap,memory.total,driver_version',
        '--format=csv,noheader,nounits',
      ],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      },
    );
    return parseNvidiaSmiOutput(out);
  } catch {
    return null;
  }
}

/**
 * Probe the native Rust addon for CUDA readiness. Returns the boolean
 * reported by `native_cuda_available()` or `null` when the addon is
 * missing / doesn't expose that export (older builds).
 *
 * The addon may return `Some(false)` when the `cuda` feature IS built in
 * but the runtime driver is missing — in that case we know the package
 * is the `-cuda` variant but libcuda.so didn't load, which is worth
 * surfacing to the user.
 */
function probeAddonCudaAvailability() {
  try {
    const addonPath = resolveNativeAddon();
    if (!addonPath) return null;
    const addonRequire = createRequire(import.meta.url);
    const addon = addonRequire(addonPath);
    if (typeof addon?.nativeCudaAvailable !== 'function') return null;
    return Boolean(addon.nativeCudaAvailable());
  } catch {
    return null;
  }
}

/**
 * Detect the current hardware capability. Returns a stable, read-only
 * descriptor that callers use to pick inference backends and decide
 * which artifacts to fetch at init time.
 *
 * Fields:
 *   platform                     — process.platform
 *   arch                         — process.arch
 *   totalMemGB                   — os.totalmem() in GiB (float)
 *   logicalCores                 — os.cpus().length
 *   brandString                  — raw sysctl output (darwin-arm64 only)
 *   appleSilicon                 — parsed chip descriptor or null
 *   coremlCascadeEligible        — boolean; M3+ darwin-arm64 only
 *   coremlCascadeReason          — human string explaining eligible/not
 *   nvidiaGpu                    — { name, computeCapability, computeCapabilityFloat,
 *                                    memoryMB, driverVersion } | null
 *   cudaAddonEnabled             — boolean; addon built with cuda feature + libcuda.so loaded
 *   cudaAvailable                — boolean; cudaAddonEnabled AND nvidiaGpu AND CC ≥ 7.0
 *   cudaReason                   — human string explaining eligible/not
 *   candleGpuBackend             — "metal" | "cuda" | null
 *   inferenceBackendPreference   — "coreml-cascade" | "candle-metal"
 *                                  | "candle-cuda" | "candle-cpu"
 */
export function detectHardwareCapability() {
  if (_cached) return _cached;

  const platform = process.platform;
  const arch = process.arch;
  const totalMemGB = os.totalmem() / (1024 ** 3);
  const logicalCores = os.cpus().length;

  let brandString = null;
  let appleSilicon = null;
  if (platform === 'darwin' && arch === 'arm64') {
    brandString = sysctlBrandString();
    appleSilicon = parseAppleChipBrandString(brandString);
  }

  let coremlCascadeEligible = false;
  let coremlCascadeReason;
  if (platform !== 'darwin') {
    coremlCascadeReason = `CoreML is macOS-only (current platform: ${platform})`;
  } else if (arch !== 'arm64') {
    coremlCascadeReason = `CoreML cascade requires Apple Silicon (current arch: ${arch})`;
  } else if (!appleSilicon) {
    coremlCascadeReason = `Could not identify Apple Silicon chip (sysctl brand: ${brandString || 'unavailable'})`;
  } else if (appleSilicon.generation < MIN_APPLE_GENERATION_FOR_CASCADE) {
    coremlCascadeReason = `${brandString}: ${appleSilicon.family} ANE below cascade threshold (M${MIN_APPLE_GENERATION_FOR_CASCADE}+ required)`;
  } else {
    coremlCascadeEligible = true;
    coremlCascadeReason = `${brandString}: ${appleSilicon.family} ANE suitable for cascade`;
  }

  // NVIDIA GPU detection — Linux only. `nvidia-smi` tells us what's
  // installed; the addon probe tells us whether the installed native
  // package actually knows how to dispatch to it.
  const nvidiaGpu = detectNvidiaGpu();
  const addonCudaProbe = probeAddonCudaAvailability();
  const cudaAddonEnabled = addonCudaProbe === true;

  // Diagnostic opt-out: SWEET_SEARCH_CUDA=0 force-disables CUDA even on
  // an otherwise-eligible host. Parallels SWEET_SEARCH_COREML_CASCADE=0.
  const cudaForceDisabled = ['0', 'false', 'off'].includes(
    (process.env.SWEET_SEARCH_CUDA ?? '').toLowerCase(),
  );

  let cudaAvailable = false;
  let cudaReason;
  if (cudaForceDisabled) {
    cudaReason = 'CUDA force-disabled via SWEET_SEARCH_CUDA=0';
  } else if (platform !== 'linux') {
    cudaReason = `CUDA native backend ships for Linux only (current platform: ${platform})`;
  } else if (!nvidiaGpu) {
    cudaReason = 'No NVIDIA GPU detected (nvidia-smi missing or no device 0)';
  } else if (nvidiaGpu.computeCapabilityFloat < MIN_CUDA_COMPUTE_CAPABILITY) {
    cudaReason = `${nvidiaGpu.name}: compute capability ${nvidiaGpu.computeCapability} below threshold (${MIN_CUDA_COMPUTE_CAPABILITY}+ required)`;
  } else if (addonCudaProbe === null) {
    cudaReason = `${nvidiaGpu.name} detected, but the installed native package does not expose a CUDA probe — reinstall with @sweet-search/native-linux-${arch === 'arm64' ? 'arm64' : 'x64'}-gnu-cuda to enable GPU indexing`;
  } else if (addonCudaProbe === false) {
    cudaReason = `${nvidiaGpu.name} detected, but the native addon reports Device::new_cuda(0) failed (driver / libcuda.so mismatch?)`;
  } else {
    cudaAvailable = true;
    cudaReason = `${nvidiaGpu.name} (compute ${nvidiaGpu.computeCapability}, ${nvidiaGpu.memoryMB} MB, driver ${nvidiaGpu.driverVersion}) — suitable for candle-cuda`;
  }

  // Candle GPU backend availability.
  //   darwin-arm64 → metal (bundled with the darwin-arm64 native package)
  //   linux-*-gnu + NVIDIA + cuda-enabled addon → cuda
  //   everything else → null (falls through to candle CPU)
  let candleGpuBackend = null;
  if (platform === 'darwin' && arch === 'arm64') {
    candleGpuBackend = 'metal';
  } else if (cudaAvailable) {
    candleGpuBackend = 'cuda';
  }

  // Preference order: coreml-cascade > candle-metal > candle-cuda > candle-cpu.
  // coreml-cascade and candle-cuda never co-exist on the same host
  // (one is darwin, the other is linux), so the ordering is orthogonal
  // in practice.
  let inferenceBackendPreference;
  if (coremlCascadeEligible) {
    inferenceBackendPreference = 'coreml-cascade';
  } else if (candleGpuBackend === 'metal') {
    inferenceBackendPreference = 'candle-metal';
  } else if (candleGpuBackend === 'cuda') {
    inferenceBackendPreference = 'candle-cuda';
  } else {
    inferenceBackendPreference = 'candle-cpu';
  }

  _cached = Object.freeze({
    platform,
    arch,
    totalMemGB,
    logicalCores,
    brandString,
    appleSilicon,
    coremlCascadeEligible,
    coremlCascadeReason,
    nvidiaGpu,
    cudaAddonEnabled,
    cudaAvailable,
    cudaReason,
    candleGpuBackend,
    inferenceBackendPreference,
  });
  return _cached;
}

/**
 * Reset the cached detection result. Tests only — production callers
 * should never need this because hardware doesn't change at runtime.
 */
export function _resetHardwareCapabilityCache() {
  _cached = null;
}
