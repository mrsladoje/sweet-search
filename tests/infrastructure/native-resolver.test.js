import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Fresh import for each test to avoid module caching issues
async function loadResolver() {
  return import('../../core/infrastructure/native-resolver.js');
}

function withTempRoot(setup) {
  const dir = mkdtempSync(join(tmpdir(), 'sweet-search-native-resolver-'));
  try {
    return setup(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function touch(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, '', 'utf8');
}

describe('native-resolver', () => {
  describe('getPlatformInfo', () => {
    it('returns platform, arch, libc, and packageName on supported platforms', async () => {
      const { getPlatformInfo } = await loadResolver();
      const info = getPlatformInfo();
      // This test runs on a supported platform (darwin-arm64 or similar)
      if (info !== null) {
        expect(info).toHaveProperty('platform');
        expect(info).toHaveProperty('arch');
        expect(info).toHaveProperty('libc');
        expect(info).toHaveProperty('packageName');
        expect(['darwin', 'linux']).toContain(info.platform);
        expect(['arm64', 'x64']).toContain(info.arch);
      }
    });

    it('includes -gnu suffix for Linux', async () => {
      const { getPlatformInfo } = await loadResolver();
      const info = getPlatformInfo();
      if (info && info.platform === 'linux') {
        expect(info.libc).toBe('-gnu');
        expect(info.packageName).toMatch(/-gnu$/);
      } else if (info) {
        expect(info.libc).toBe('');
        expect(info.packageName).not.toMatch(/-gnu$/);
      }
    });

    it('returns null for unsupported platforms', async () => {
      const { getPlatformInfo } = await loadResolver();
      // Temporarily override process.platform to simulate unsupported OS
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        expect(getPlatformInfo()).toBeNull();
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });

    it('returns null for unsupported architectures', async () => {
      const { getPlatformInfo } = await loadResolver();
      const origArch = process.arch;
      Object.defineProperty(process, 'arch', { value: 's390x', configurable: true });
      try {
        expect(getPlatformInfo()).toBeNull();
      } finally {
        Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
      }
    });
  });

  describe('getPlatformPackageName', () => {
    it('returns a scoped @sweet-search/native-* name on supported platforms', async () => {
      const { getPlatformPackageName } = await loadResolver();
      const name = getPlatformPackageName();
      if (name !== null) {
        expect(name).toMatch(/^@sweet-search\/native-/);
      }
    });

    it('returns null on unsupported platforms', async () => {
      const { getPlatformPackageName } = await loadResolver();
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
      try {
        expect(getPlatformPackageName()).toBeNull();
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });
  });

  describe('resolveNativeAddon', () => {
    it('returns a string path or null', async () => {
      const { resolveNativeAddon } = await loadResolver();
      const result = resolveNativeAddon();
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('finds the local dev addon on darwin-arm64', async () => {
      const { resolveNativeAddon } = await loadResolver();
      if (process.platform === 'darwin' && process.arch === 'arm64') {
        const expected = join(ROOT, 'sweet-search-native', 'maxsim.darwin-arm64.node');
        if (existsSync(expected)) {
          expect(resolveNativeAddon()).toBe(expected);
        }
      }
    });

    it('returns null on unsupported platforms', async () => {
      const { resolveNativeAddon } = await loadResolver();
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        expect(resolveNativeAddon()).toBeNull();
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });

    it('finds the local package template addon when local dev binary is absent', async () => {
      const { resolveNativeAddon, getPlatformInfo } = await loadResolver();
      const info = getPlatformInfo();
      if (!info) return;

      withTempRoot((tempRoot) => {
        const packageAddon = join(
          tempRoot,
          'packages',
          `native-${info.platform}-${info.arch}${info.libc}`,
          'maxsim.node',
        );
        touch(packageAddon);
        expect(resolveNativeAddon({ rootDir: tempRoot })).toBe(packageAddon);
      });
    });

    it('finds the installed npm addon when local dev and packages paths are absent', async () => {
      const { resolveNativeAddon } = await loadResolver();
      withTempRoot((tempRoot) => {
        const npmPkgDir = join(tempRoot, 'fake-node-modules', '@sweet-search', 'native-test');
        const npmAddon = join(npmPkgDir, 'maxsim.node');
        touch(join(npmPkgDir, 'package.json'));
        touch(npmAddon);
        const result = resolveNativeAddon({
          rootDir: tempRoot,
          resolvePackageDir: () => npmPkgDir,
        });
        expect(result).toBe(npmAddon);
      });
    });
  });

  describe('resolveNativeBinary', () => {
    it('returns a string path or null', async () => {
      const { resolveNativeBinary } = await loadResolver();
      const result = resolveNativeBinary();
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('returns null on unsupported platforms', async () => {
      const { resolveNativeBinary } = await loadResolver();
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        expect(resolveNativeBinary()).toBeNull();
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });

    it('finds the local package template binary when local dev binary is absent', async () => {
      const { resolveNativeBinary, getPlatformInfo } = await loadResolver();
      const info = getPlatformInfo();
      if (!info) return;

      withTempRoot((tempRoot) => {
        const packageBin = join(
          tempRoot,
          'packages',
          `native-${info.platform}-${info.arch}${info.libc}`,
          'sweet-search',
        );
        touch(packageBin);
        expect(resolveNativeBinary({ rootDir: tempRoot })).toBe(packageBin);
      });
    });

    it('finds the installed npm binary when local dev and packages paths are absent', async () => {
      const { resolveNativeBinary } = await loadResolver();
      withTempRoot((tempRoot) => {
        const npmPkgDir = join(tempRoot, 'fake-node-modules', '@sweet-search', 'native-test');
        const npmBin = join(npmPkgDir, 'sweet-search');
        touch(join(npmPkgDir, 'package.json'));
        touch(npmBin);
        const result = resolveNativeBinary({
          rootDir: tempRoot,
          resolvePackageDir: () => npmPkgDir,
        });
        expect(result).toBe(npmBin);
      });
    });
  });

  describe('resolution order', () => {
    it('prefers local dev path over packages/ path for addon', async () => {
      const { resolveNativeAddon } = await loadResolver();
      if (process.platform === 'darwin' && process.arch === 'arm64') {
        const result = resolveNativeAddon();
        if (result !== null) {
          // Should resolve to sweet-search-native/ (local dev), not packages/
          expect(result).toContain('sweet-search-native');
          expect(result).not.toContain('packages');
        }
      }
    });
  });
});
