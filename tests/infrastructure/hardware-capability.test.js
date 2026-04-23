/**
 * Unit tests for core/infrastructure/hardware-capability.js
 *
 * Covers:
 *   - parseAppleChipBrandString across every known chip family + variant
 *     and several unknown/garbage strings
 *   - detectHardwareCapability structure and cache behavior on the
 *     current machine (whatever it happens to be — tests adapt to the
 *     real host rather than mocking sysctl)
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  parseAppleChipBrandString,
  parseNvidiaSmiOutput,
  detectHardwareCapability,
  _resetHardwareCapabilityCache,
} from '../../core/infrastructure/hardware-capability.js';

describe('parseAppleChipBrandString', () => {
  it('parses M1 base', () => {
    expect(parseAppleChipBrandString('Apple M1')).toEqual({
      family: 'M1',
      generation: 1,
      variant: 'base',
    });
  });

  it('parses M1 Pro', () => {
    expect(parseAppleChipBrandString('Apple M1 Pro')).toEqual({
      family: 'M1',
      generation: 1,
      variant: 'pro',
    });
  });

  it('parses M1 Max', () => {
    expect(parseAppleChipBrandString('Apple M1 Max')).toEqual({
      family: 'M1',
      generation: 1,
      variant: 'max',
    });
  });

  it('parses M1 Ultra', () => {
    expect(parseAppleChipBrandString('Apple M1 Ultra')).toEqual({
      family: 'M1',
      generation: 1,
      variant: 'ultra',
    });
  });

  it('parses M2 variants', () => {
    expect(parseAppleChipBrandString('Apple M2')).toMatchObject({ generation: 2, variant: 'base' });
    expect(parseAppleChipBrandString('Apple M2 Pro')).toMatchObject({ generation: 2, variant: 'pro' });
    expect(parseAppleChipBrandString('Apple M2 Max')).toMatchObject({ generation: 2, variant: 'max' });
    expect(parseAppleChipBrandString('Apple M2 Ultra')).toMatchObject({ generation: 2, variant: 'ultra' });
  });

  it('parses M3 Max (the dev box)', () => {
    expect(parseAppleChipBrandString('Apple M3 Max')).toEqual({
      family: 'M3',
      generation: 3,
      variant: 'max',
    });
  });

  it('parses M4 Ultra (future hardware)', () => {
    expect(parseAppleChipBrandString('Apple M4 Ultra')).toMatchObject({
      generation: 4,
      variant: 'ultra',
    });
  });

  it('admits higher-generation chips that post-date this file', () => {
    // Future-proofing: an M5 / M6 should still parse and yield a
    // generation number the detectHardwareCapability code can compare
    // against the min-generation threshold. If this regex breaks on
    // a future chip we'd rather admit it optimistically than silently
    // gate it out.
    const result = parseAppleChipBrandString('Apple M12');
    expect(result).toEqual({ family: 'M12', generation: 12, variant: 'base' });
  });

  it('returns null for Intel brand strings', () => {
    expect(parseAppleChipBrandString('Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz')).toBeNull();
    expect(parseAppleChipBrandString('Intel(R) Xeon(R) W-3275M CPU @ 2.50GHz')).toBeNull();
  });

  it('returns null for empty / non-string input', () => {
    expect(parseAppleChipBrandString('')).toBeNull();
    expect(parseAppleChipBrandString(null)).toBeNull();
    expect(parseAppleChipBrandString(undefined)).toBeNull();
    expect(parseAppleChipBrandString(42)).toBeNull();
  });

  it('is case-insensitive on variant', () => {
    // Some tools might uppercase the brand string. Parser should
    // still extract the variant correctly.
    expect(parseAppleChipBrandString('apple m3 max')).toMatchObject({
      family: 'M3',
      variant: 'max',
    });
    expect(parseAppleChipBrandString('APPLE M3 MAX')).toMatchObject({
      family: 'M3',
      variant: 'max',
    });
  });

  it('rejects strings that merely contain "Apple M" substring', () => {
    // Contrived but easy to get wrong: the parser should not match
    // random strings that happen to have "Apple M" embedded.
    expect(parseAppleChipBrandString('Pineapple M3')).toBeNull();
    expect(parseAppleChipBrandString('Apple Mountain')).toBeNull();
  });
});

describe('detectHardwareCapability', () => {
  beforeEach(() => {
    _resetHardwareCapabilityCache();
  });

  it('returns a frozen object with all expected keys', () => {
    const hw = detectHardwareCapability();
    expect(Object.isFrozen(hw)).toBe(true);
    expect(hw).toHaveProperty('platform');
    expect(hw).toHaveProperty('arch');
    expect(hw).toHaveProperty('totalMemGB');
    expect(hw).toHaveProperty('logicalCores');
    expect(hw).toHaveProperty('brandString');
    expect(hw).toHaveProperty('appleSilicon');
    expect(hw).toHaveProperty('coremlCascadeEligible');
    expect(hw).toHaveProperty('coremlCascadeReason');
    expect(hw).toHaveProperty('candleGpuBackend');
    expect(hw).toHaveProperty('inferenceBackendPreference');
  });

  it('caches the result across calls', () => {
    const a = detectHardwareCapability();
    const b = detectHardwareCapability();
    expect(a).toBe(b);
  });

  it('cache reset returns a fresh object (still deeply equal)', () => {
    const a = detectHardwareCapability();
    _resetHardwareCapabilityCache();
    const b = detectHardwareCapability();
    // Not the same reference, but equal values on a stable host.
    expect(a).not.toBe(b);
    expect(a.platform).toBe(b.platform);
    expect(a.arch).toBe(b.arch);
    expect(a.brandString).toBe(b.brandString);
    expect(a.coremlCascadeEligible).toBe(b.coremlCascadeEligible);
  });

  it('reports values consistent with process.platform/arch', () => {
    const hw = detectHardwareCapability();
    expect(hw.platform).toBe(process.platform);
    expect(hw.arch).toBe(process.arch);
  });

  it('non-darwin always has coremlCascadeEligible=false', () => {
    const hw = detectHardwareCapability();
    if (hw.platform !== 'darwin') {
      expect(hw.coremlCascadeEligible).toBe(false);
      expect(hw.appleSilicon).toBeNull();
    }
  });

  it('darwin-x64 always has coremlCascadeEligible=false', () => {
    const hw = detectHardwareCapability();
    if (hw.platform === 'darwin' && hw.arch === 'x64') {
      expect(hw.coremlCascadeEligible).toBe(false);
      expect(hw.coremlCascadeReason).toMatch(/Apple Silicon/i);
    }
  });

  it('darwin-arm64 has appleSilicon populated when brand string is parseable', () => {
    const hw = detectHardwareCapability();
    if (hw.platform === 'darwin' && hw.arch === 'arm64' && hw.brandString) {
      // Any correctly-running M-series Mac should produce a parseable
      // brand string. The only scenario where this is null is sandboxed
      // sysctl failure, which we can't trigger from a vitest process.
      expect(hw.appleSilicon).not.toBeNull();
      expect(hw.appleSilicon.generation).toBeGreaterThanOrEqual(1);
    }
  });

  it('candleGpuBackend is "metal" on darwin-arm64 and null elsewhere', () => {
    const hw = detectHardwareCapability();
    if (hw.platform === 'darwin' && hw.arch === 'arm64') {
      expect(hw.candleGpuBackend).toBe('metal');
    } else {
      expect(hw.candleGpuBackend).toBeNull();
    }
  });

  it('inferenceBackendPreference is one of the four expected values', () => {
    const hw = detectHardwareCapability();
    expect([
      'coreml-cascade',
      'candle-metal',
      'candle-cuda',
      'candle-cpu',
    ]).toContain(hw.inferenceBackendPreference);
  });

  it('inferenceBackendPreference follows the cascade→metal→cuda→cpu priority', () => {
    const hw = detectHardwareCapability();
    if (hw.coremlCascadeEligible) {
      expect(hw.inferenceBackendPreference).toBe('coreml-cascade');
    } else if (hw.candleGpuBackend === 'metal') {
      expect(hw.inferenceBackendPreference).toBe('candle-metal');
    } else if (hw.candleGpuBackend === 'cuda') {
      expect(hw.inferenceBackendPreference).toBe('candle-cuda');
    } else {
      expect(hw.inferenceBackendPreference).toBe('candle-cpu');
    }
  });

  it('exposes CUDA capability fields on the frozen descriptor', () => {
    const hw = detectHardwareCapability();
    expect(hw).toHaveProperty('nvidiaGpu');
    expect(hw).toHaveProperty('cudaAddonEnabled');
    expect(hw).toHaveProperty('cudaAvailable');
    expect(hw).toHaveProperty('cudaReason');
  });

  it('non-linux hosts never report cudaAvailable=true', () => {
    const hw = detectHardwareCapability();
    if (hw.platform !== 'linux') {
      expect(hw.cudaAvailable).toBe(false);
      expect(hw.candleGpuBackend).not.toBe('cuda');
    }
  });

  it('darwin-arm64 prefers metal even if nvidia-smi is somehow present', () => {
    // sanity: the CUDA detection path is Linux-gated so this should never
    // get confused on the dev box.
    const hw = detectHardwareCapability();
    if (hw.platform === 'darwin' && hw.arch === 'arm64') {
      expect(hw.cudaAvailable).toBe(false);
      expect(hw.inferenceBackendPreference).toMatch(/^(coreml-cascade|candle-metal)$/);
    }
  });
});

describe('parseNvidiaSmiOutput', () => {
  it('parses a valid nvidia-smi CSV row (Ampere RTX 3090)', () => {
    const raw = 'NVIDIA GeForce RTX 3090, 8.6, 24576, 535.129.03';
    expect(parseNvidiaSmiOutput(raw)).toEqual({
      name: 'NVIDIA GeForce RTX 3090',
      computeCapability: '8.6',
      computeCapabilityFloat: 8.6,
      memoryMB: 24576,
      driverVersion: '535.129.03',
    });
  });

  it('parses Hopper H100', () => {
    const raw = 'NVIDIA H100 80GB HBM3, 9.0, 81559, 535.129.03';
    expect(parseNvidiaSmiOutput(raw)).toMatchObject({
      name: 'NVIDIA H100 80GB HBM3',
      computeCapability: '9.0',
      computeCapabilityFloat: 9.0,
      memoryMB: 81559,
    });
  });

  it('parses Turing T4 (SM 7.5)', () => {
    const raw = 'Tesla T4, 7.5, 15360, 535.129.03';
    expect(parseNvidiaSmiOutput(raw)).toMatchObject({
      computeCapability: '7.5',
      computeCapabilityFloat: 7.5,
      memoryMB: 15360,
    });
  });

  it('parses Volta V100 (SM 7.0)', () => {
    const raw = 'Tesla V100-SXM2-16GB, 7.0, 16160, 535.129.03';
    expect(parseNvidiaSmiOutput(raw)).toMatchObject({
      computeCapability: '7.0',
      computeCapabilityFloat: 7.0,
    });
  });

  it('parses Pascal GTX 1080 (SM 6.1 — below the CUDA threshold)', () => {
    const raw = 'NVIDIA GeForce GTX 1080, 6.1, 8192, 535.129.03';
    const parsed = parseNvidiaSmiOutput(raw);
    expect(parsed).toMatchObject({
      computeCapability: '6.1',
      computeCapabilityFloat: 6.1,
    });
    // Parser accepts it; the gating decision happens in detectHardwareCapability.
  });

  it('returns null for empty input', () => {
    expect(parseNvidiaSmiOutput('')).toBeNull();
    expect(parseNvidiaSmiOutput(null)).toBeNull();
    expect(parseNvidiaSmiOutput(undefined)).toBeNull();
  });

  it('returns null for malformed rows (missing columns)', () => {
    // Only 2 columns — not enough to populate the descriptor.
    expect(parseNvidiaSmiOutput('NVIDIA RTX 3090, 8.6')).toBeNull();
  });

  it('returns null when compute capability is not a number', () => {
    const raw = 'Weird GPU, compute_cap, 24576, 535.129.03';
    expect(parseNvidiaSmiOutput(raw)).toBeNull();
  });

  it('handles multi-line output by taking the first data row', () => {
    const raw = 'NVIDIA GeForce RTX 3090, 8.6, 24576, 535.129.03\nNVIDIA A100, 8.0, 40960, 535.129.03';
    expect(parseNvidiaSmiOutput(raw)).toMatchObject({
      name: 'NVIDIA GeForce RTX 3090',
      computeCapability: '8.6',
    });
  });

  it('trims surrounding whitespace in each column', () => {
    const raw = '  NVIDIA RTX 3090 ,  8.6 , 24576 , 535.129.03  ';
    expect(parseNvidiaSmiOutput(raw)).toMatchObject({
      name: 'NVIDIA RTX 3090',
      computeCapability: '8.6',
    });
  });

  it('M3 Max on the dev box is cascade-eligible', () => {
    const hw = detectHardwareCapability();
    // If we're running on an M3+ machine, cascade should be eligible.
    // This test is a spot check for the common dev configuration and
    // is a no-op on non-M3 machines.
    if (hw.appleSilicon?.generation >= 3) {
      expect(hw.coremlCascadeEligible).toBe(true);
      expect(hw.coremlCascadeReason).toMatch(/suitable for cascade/i);
    }
  });

  it('M1/M2 would be gated out by the min-generation floor', () => {
    const hw = detectHardwareCapability();
    if (hw.appleSilicon && hw.appleSilicon.generation < 3) {
      expect(hw.coremlCascadeEligible).toBe(false);
      expect(hw.coremlCascadeReason).toMatch(/below cascade threshold|ANE/i);
    }
  });
});
