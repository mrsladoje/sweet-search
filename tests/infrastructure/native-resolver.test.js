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
        const expected = join(ROOT, 'crates', 'sweet-search-native', 'sweet-search-native.darwin-arm64.node');
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
          'sweet-search-native.node',
        );
        touch(packageAddon);
        expect(resolveNativeAddon({ rootDir: tempRoot })).toBe(packageAddon);
      });
    });

    it('finds the installed npm addon when local dev and packages paths are absent', async () => {
      const { resolveNativeAddon } = await loadResolver();
      withTempRoot((tempRoot) => {
        const npmPkgDir = join(tempRoot, 'fake-node-modules', '@sweet-search', 'native-test');
        const npmAddon = join(npmPkgDir, 'sweet-search-native.node');
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
          // Should resolve to crates/sweet-search-native/ (local dev), not packages/
          expect(result).toContain('sweet-search-native');
          expect(result).not.toContain('packages');
        }
      }
    });
  });

  describe('CUDA package preference (Linux)', () => {
    // Simulate a Linux host by overriding process.platform / process.arch
    // for each test. The resolver is DI-friendly (accepts rootDir +
    // resolvePackageDir), so we don't need to actually be on Linux.
    function withLinuxEnv(arch, fn) {
      const origPlatform = process.platform;
      const origArch = process.arch;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      Object.defineProperty(process, 'arch', { value: arch, configurable: true });
      try {
        return fn();
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
        Object.defineProperty(process, 'arch', { value: origArch, configurable: true });
      }
    }

    it('exposes cudaPackageName on Linux targets from getPlatformInfo', async () => {
      const { getPlatformInfo } = await loadResolver();
      withLinuxEnv('x64', () => {
        const info = getPlatformInfo();
        expect(info).not.toBeNull();
        expect(info.packageName).toBe('@sweet-search/native-linux-x64-gnu');
        expect(info.cudaPackageName).toBe('@sweet-search/native-linux-x64-gnu-cuda');
      });
      withLinuxEnv('arm64', () => {
        const info = getPlatformInfo();
        expect(info.cudaPackageName).toBe('@sweet-search/native-linux-arm64-gnu-cuda');
      });
    });

    it('does NOT expose cudaPackageName on darwin', async () => {
      const { getPlatformInfo } = await loadResolver();
      if (process.platform === 'darwin') {
        const info = getPlatformInfo();
        expect(info.cudaPackageName).toBeNull();
      }
    });

    it('prefers the -cuda addon when BOTH packages resolve on linux', async () => {
      const { resolveNativeAddon } = await loadResolver();
      withLinuxEnv('x64', () => {
        withTempRoot((tempRoot) => {
          const cudaPkgDir = join(tempRoot, 'fake-node-modules', '@sweet-search', 'native-linux-x64-gnu-cuda');
          const stdPkgDir = join(tempRoot, 'fake-node-modules', '@sweet-search', 'native-linux-x64-gnu');
          const cudaAddon = join(cudaPkgDir, 'sweet-search-native.node');
          const stdAddon = join(stdPkgDir, 'sweet-search-native.node');
          touch(join(cudaPkgDir, 'package.json'));
          touch(join(stdPkgDir, 'package.json'));
          touch(cudaAddon);
          touch(stdAddon);

          const resolvePackageDir = (name) => {
            if (name.endsWith('-cuda')) return cudaPkgDir;
            return stdPkgDir;
          };

          const result = resolveNativeAddon({ rootDir: tempRoot, resolvePackageDir });
          expect(result).toBe(cudaAddon);
        });
      });
    });

    it('falls back to standard addon when -cuda package is absent', async () => {
      const { resolveNativeAddon } = await loadResolver();
      withLinuxEnv('x64', () => {
        withTempRoot((tempRoot) => {
          const stdPkgDir = join(tempRoot, 'fake-node-modules', '@sweet-search', 'native-linux-x64-gnu');
          const stdAddon = join(stdPkgDir, 'sweet-search-native.node');
          touch(join(stdPkgDir, 'package.json'));
          touch(stdAddon);

          // Simulate -cuda package missing: throw from resolvePackageDir for
          // that specific name, succeed for the standard name.
          const resolvePackageDir = (name) => {
            if (name.endsWith('-cuda')) throw new Error('package not installed');
            return stdPkgDir;
          };

          const result = resolveNativeAddon({ rootDir: tempRoot, resolvePackageDir });
          expect(result).toBe(stdAddon);
        });
      });
    });

    it('prefers local packages/ -cuda template over npm package', async () => {
      const { resolveNativeAddon } = await loadResolver();
      withLinuxEnv('x64', () => {
        withTempRoot((tempRoot) => {
          const localCudaPkg = join(tempRoot, 'packages', 'native-linux-x64-gnu-cuda', 'sweet-search-native.node');
          const localStdPkg = join(tempRoot, 'packages', 'native-linux-x64-gnu', 'sweet-search-native.node');
          touch(localCudaPkg);
          touch(localStdPkg);

          // Resolver should pick local -cuda template even though both exist.
          const result = resolveNativeAddon({
            rootDir: tempRoot,
            resolvePackageDir: () => { throw new Error('unused'); },
          });
          expect(result).toBe(localCudaPkg);
        });
      });
    });

    it('applies the same -cuda preference to resolveNativeBinary', async () => {
      const { resolveNativeBinary } = await loadResolver();
      withLinuxEnv('x64', () => {
        withTempRoot((tempRoot) => {
          const cudaPkgDir = join(tempRoot, 'fake-node-modules', '@sweet-search', 'native-linux-x64-gnu-cuda');
          const stdPkgDir = join(tempRoot, 'fake-node-modules', '@sweet-search', 'native-linux-x64-gnu');
          const cudaBin = join(cudaPkgDir, 'sweet-search');
          const stdBin = join(stdPkgDir, 'sweet-search');
          touch(join(cudaPkgDir, 'package.json'));
          touch(join(stdPkgDir, 'package.json'));
          touch(cudaBin);
          touch(stdBin);

          const resolvePackageDir = (name) => (name.endsWith('-cuda') ? cudaPkgDir : stdPkgDir);
          const result = resolveNativeBinary({ rootDir: tempRoot, resolvePackageDir });
          expect(result).toBe(cudaBin);
        });
      });
    });
  });
});
