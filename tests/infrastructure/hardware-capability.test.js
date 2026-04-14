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

  it('inferenceBackendPreference is one of the three expected values', () => {
    const hw = detectHardwareCapability();
    expect(['coreml-cascade', 'candle-metal', 'candle-cpu']).toContain(hw.inferenceBackendPreference);
  });

  it('inferenceBackendPreference follows the cascade→metal→cpu priority', () => {
    const hw = detectHardwareCapability();
    if (hw.coremlCascadeEligible) {
      expect(hw.inferenceBackendPreference).toBe('coreml-cascade');
    } else if (hw.candleGpuBackend === 'metal') {
      expect(hw.inferenceBackendPreference).toBe('candle-metal');
    } else {
      expect(hw.inferenceBackendPreference).toBe('candle-cpu');
    }
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
