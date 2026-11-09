import { describe, expect, it, afterEach, vi, beforeEach } from 'vitest';
import os from 'os';

import {
  isAppleSilicon,
  shouldUseCoreML,
  getCoreMLExecutionProviders,
  _resetCoreMLCache,
} from '../../core/infrastructure/coreml-provider.js';

const REAL_PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform');

// Pretend to run on a given host, so the result does not depend on this machine.
function fakeHost(platform, arch) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  vi.spyOn(os, 'arch').mockReturnValue(arch);
}

afterEach(() => {
  Object.defineProperty(process, 'platform', REAL_PLATFORM);
  delete process.env.SWEET_SEARCH_USE_COREML;
  _resetCoreMLCache();
  vi.restoreAllMocks();
});

describe('isAppleSilicon', () => {
  it('is true only for darwin on arm64', () => {
    fakeHost('darwin', 'arm64');
    expect(isAppleSilicon()).toBe(true);
    fakeHost('darwin', 'x64');
    expect(isAppleSilicon()).toBe(false);
    fakeHost('linux', 'arm64');
    expect(isAppleSilicon()).toBe(false);
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
        fakeHost('darwin', 'arm64');
        expect(shouldUseCoreML(true)).toBe(false);
      });
    }
  });

  describe('env var parsing (on variants)', () => {
    for (const val of ['on', '1', 'true', 'ON', '  on  ']) {
      it(`enables on Apple Silicon and not on Intel when env is "${val}" with provider available`, () => {
        process.env.SWEET_SEARCH_USE_COREML = val;
        fakeHost('darwin', 'arm64');
        expect(shouldUseCoreML(true)).toBe(true);
        fakeHost('darwin', 'x64');
        expect(shouldUseCoreML(true)).toBe(false);
      });
    }
  });

  it('auto mode (unset env) enables on Apple Silicon with provider', () => {
    delete process.env.SWEET_SEARCH_USE_COREML;
    fakeHost('darwin', 'arm64');
    expect(shouldUseCoreML(true)).toBe(true);
    fakeHost('linux', 'x64');
    expect(shouldUseCoreML(true)).toBe(false);
  });

  it('auto mode with env="auto" behaves same as unset', () => {
    process.env.SWEET_SEARCH_USE_COREML = 'auto';
    fakeHost('darwin', 'arm64');
    expect(shouldUseCoreML(true)).toBe(true);
  });

  it('rejects unrecognized env values', () => {
    process.env.SWEET_SEARCH_USE_COREML = 'maybe';
    fakeHost('darwin', 'arm64');
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
