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
 */

import { execFileSync } from 'node:child_process';
import os from 'node:os';

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
 *   candleGpuBackend             — "metal" | null (future: "cuda")
 *   inferenceBackendPreference   — "coreml-cascade" | "candle-metal" | "candle-cpu"
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

  // Candle GPU backend availability is independent of CoreML cascade.
  //   darwin-arm64 → metal (bundled with the darwin-arm64 native package)
  //   darwin-x64   → null  (no useful GPU; falls through to candle CPU)
  //   linux-*-gnu  → null  (CUDA backend not in the current native addon builds —
  //                         see INIT_STRATEGY.md cross-target validation)
  //   anything else → null
  let candleGpuBackend = null;
  if (platform === 'darwin' && arch === 'arm64') {
    candleGpuBackend = 'metal';
  }

  const inferenceBackendPreference = coremlCascadeEligible
    ? 'coreml-cascade'
    : (candleGpuBackend ? `candle-${candleGpuBackend}` : 'candle-cpu');

  _cached = Object.freeze({
    platform,
    arch,
    totalMemGB,
    logicalCores,
    brandString,
    appleSilicon,
    coremlCascadeEligible,
    coremlCascadeReason,
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
