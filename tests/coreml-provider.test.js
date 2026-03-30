import { describe, expect, it, afterEach, vi, beforeEach } from 'vitest';

import {
  isAppleSilicon,
  shouldUseCoreML,
  getCoreMLExecutionProviders,
  _resetCoreMLCache,
} from '../core/coreml-provider.js';

afterEach(() => {
  delete process.env.SWEET_SEARCH_USE_COREML;
  _resetCoreMLCache();
  vi.restoreAllMocks();
});

describe('isAppleSilicon', () => {
  it('checks process.platform and os.arch', () => {
    // Structural test: function returns a boolean derived from platform + arch
    const result = isAppleSilicon();
    expect(typeof result).toBe('boolean');
    // On this machine it's deterministic — assert the actual value
    const expected = process.platform === 'darwin' && process.arch === 'arm64';
    expect(result).toBe(expected);
  });
});

describe('shouldUseCoreML', () => {
  // These tests exercise shouldUseCoreML logic independent of platform.
  // The platform gate (isAppleSilicon) is tested separately.
  // On non-Apple-Silicon machines, all "should enable" tests correctly return false
  // because shouldUseCoreML checks isAppleSilicon() internally.

  it('returns false when providerAvailable is false regardless of env', () => {
    expect(shouldUseCoreML(false)).toBe(false);
    process.env.SWEET_SEARCH_USE_COREML = 'on';
    expect(shouldUseCoreML(false)).toBe(false);
  });

  describe('env var parsing (off variants)', () => {
    for (const val of ['off', '0', 'false', 'OFF', '  off  ', ' FALSE ']) {
      it(`returns false when env is "${val}"`, () => {
        process.env.SWEET_SEARCH_USE_COREML = val;
        expect(shouldUseCoreML(true)).toBe(false);
      });
    }
  });

  describe('env var parsing (on variants)', () => {
    // These only return true on Apple Silicon — that's the correct behavior.
    const isAS = process.platform === 'darwin' && process.arch === 'arm64';
    for (const val of ['on', '1', 'true', 'ON', '  on  ']) {
      it(`returns ${isAS} when env is "${val}" with provider available`, () => {
        process.env.SWEET_SEARCH_USE_COREML = val;
        expect(shouldUseCoreML(true)).toBe(isAS);
      });
    }
  });

  it('auto mode (unset env) enables on Apple Silicon with provider', () => {
    delete process.env.SWEET_SEARCH_USE_COREML;
    const isAS = process.platform === 'darwin' && process.arch === 'arm64';
    expect(shouldUseCoreML(true)).toBe(isAS);
  });

  it('auto mode with env="auto" behaves same as unset', () => {
    process.env.SWEET_SEARCH_USE_COREML = 'auto';
    const isAS = process.platform === 'darwin' && process.arch === 'arm64';
    expect(shouldUseCoreML(true)).toBe(isAS);
  });

  it('rejects unrecognized env values', () => {
    process.env.SWEET_SEARCH_USE_COREML = 'maybe';
    expect(shouldUseCoreML(true)).toBe(false);
  });
});

describe('getCoreMLExecutionProviders', () => {
  it('defaults to MLProgram format (coreMlFlags 0x010)', () => {
    const providers = getCoreMLExecutionProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0]).toEqual({ name: 'coreml', coreMlFlags: 0x010 });
    expect(providers[1]).toBe('cpu');
  });

  it('supports NeuralNetwork format (coreMlFlags 0) when useMLProgram=false', () => {
    const providers = getCoreMLExecutionProviders(false);
    expect(providers[0]).toEqual({ name: 'coreml', coreMlFlags: 0 });
    expect(providers[1]).toBe('cpu');
  });

  it('uses lowercase provider names compatible with ORT 1.24+', () => {
    for (const useML of [true, false]) {
      const providers = getCoreMLExecutionProviders(useML);
      for (const ep of providers) {
        const name = typeof ep === 'string' ? ep : ep.name;
        expect(name).toBe(name.toLowerCase());
      }
    }
  });
});
