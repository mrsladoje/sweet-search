/**
 * Native artifact resolver — single module for locating platform-specific
 * binaries (MaxSim .node addon and sweet-search CLI binary).
 *
 * Resolution order for each artifact:
 *   1. Local dev build output (crates/sweet-search-native/ or crates/sweet-search-cli/target/)
 *   2. Local package template (packages/native-{platform}-{arch}{libc}/)
 *   3. Installed npm package with CUDA preference on Linux:
 *        @sweet-search/native-{platform}-{arch}{libc}-cuda  (preferred when present)
 *        @sweet-search/native-{platform}-{arch}{libc}       (fallback)
 *   4. null
 *
 * CUDA preference: if the user installed the optional `-cuda` package on a
 * Linux host we prefer it — the binary is built with the `cuda` feature and,
 * on a host with libcuda.so present, enables GPU indexing via candle-cuda.
 * If libcuda.so is NOT present at runtime, loading the addon will fail with
 * a linker error; the JS hardware-capability layer surfaces that by
 * reporting `cudaAddonEnabled = true, cudaAvailable = false` with a
 * pointer to install the plain (non-cuda) variant.
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const require = createRequire(import.meta.url);

// Supported targets — only these get native resolution.
const SUPPORTED_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-x64-gnu',
  'linux-arm64-gnu',
]);

/**
 * Detect the current platform, arch, libc suffix, and expected package name.
 * Returns null for unsupported platforms instead of fabricating a package name.
 *
 * `packageName` is the standard (non-cuda) package; `cudaPackageName` is
 * populated on Linux targets where a `-cuda` variant may be installed.
 * Resolution prefers `cudaPackageName` when it is resolvable on disk.
 */
export function getPlatformInfo() {
  let platform, arch;

  if (process.platform === 'darwin') platform = 'darwin';
  else if (process.platform === 'linux') platform = 'linux';
  else return null;

  if (process.arch === 'arm64') arch = 'arm64';
  else if (process.arch === 'x64') arch = 'x64';
  else return null;

  const libc = platform === 'linux' ? '-gnu' : '';
  const targetKey = `${platform}-${arch}${libc}`;

  if (!SUPPORTED_TARGETS.has(targetKey)) return null;

  const packageName = `@sweet-search/native-${targetKey}`;
  const cudaPackageName = platform === 'linux' ? `${packageName}-cuda` : null;
  return { platform, arch, libc, packageName, cudaPackageName };
}

/**
 * Return the expected npm package name for the current platform, or null if unsupported.
 * This returns the standard (non-cuda) name; use `getPlatformInfo()` if you
 * also need the cuda variant.
 */
export function getPlatformPackageName() {
  const info = getPlatformInfo();
  return info ? info.packageName : null;
}

function defaultPackageDirResolver(packageName) {
  return dirname(require.resolve(`${packageName}/package.json`));
}

/**
 * Resolve the path to the native MaxSim .node addon, or null.
 *
 * On Linux, the `-cuda` variant of the platform package is preferred when
 * installed — it contains a binary built with the `cuda` Cargo feature
 * that will dispatch embedding + LI work to candle-cuda when libcuda.so
 * is present at runtime. Absence of the `-cuda` package or libcuda.so
 * cleanly falls back to the standard CPU variant.
 */
export function resolveNativeAddon(options = {}) {
  const info = getPlatformInfo();
  if (!info) return null;
  const { platform, arch, libc, cudaPackageName } = info;
  // napi-rs --platform output includes the libc suffix on Linux
  // (e.g. `sweet-search-native.linux-x64-gnu.node`). macOS has no
  // libc suffix so `${libc}` is '' there, yielding `.darwin-arm64.node`.
  // Historic bug: this constructed `${platform}-${arch}` only, which
  // worked on darwin but silently missed the Linux build output.
  const binaryName = `sweet-search-native.${platform}-${arch}${libc}.node`;
  const exists = options.existsSync ?? existsSync;
  const rootDir = options.rootDir ?? root;
  const resolvePackageDir = options.resolvePackageDir ?? defaultPackageDirResolver;

  // 1. Local dev: crates/sweet-search-native/ directory (or legacy native-maxsim/)
  const localDev = join(rootDir, 'crates', 'sweet-search-native', binaryName);
  if (exists(localDev)) return localDev;
  const legacyDev = join(rootDir, 'native-maxsim', binaryName);
  if (exists(legacyDev)) return legacyDev;

  // 2. Local package template: packages/native-*-cuda/ preferred, then packages/native-*/
  if (cudaPackageName) {
    const cudaLocalPkg = join(rootDir, 'packages', `native-${platform}-${arch}${libc}-cuda`, 'sweet-search-native.node');
    if (exists(cudaLocalPkg)) return cudaLocalPkg;
  }
  const pkgDir = `native-${platform}-${arch}${libc}`;
  const localPkg = join(rootDir, 'packages', pkgDir, 'sweet-search-native.node');
  if (exists(localPkg)) return localPkg;

  // 3. Installed npm package — CUDA variant preferred on Linux.
  if (cudaPackageName) {
    try {
      const cudaNpmPkgDir = resolvePackageDir(cudaPackageName);
      const cudaNpmAddon = join(cudaNpmPkgDir, 'sweet-search-native.node');
      if (exists(cudaNpmAddon)) return cudaNpmAddon;
    } catch {
      // -cuda package not installed — fall through to standard variant.
    }
  }
  try {
    const npmPkgDir = resolvePackageDir(getPlatformPackageName());
    const npmAddon = join(npmPkgDir, 'sweet-search-native.node');
    if (exists(npmAddon)) return npmAddon;
  } catch {
    // Package not installed
  }

  return null;
}

/**
 * Resolve the path to the native sweet-search CLI binary, or null.
 *
 * Preference order matches `resolveNativeAddon`: prefer the `-cuda` variant
 * on Linux hosts when installed.
 */
export function resolveNativeBinary(options = {}) {
  const info = getPlatformInfo();
  if (!info) return null;
  const { platform, arch, libc, cudaPackageName } = info;
  const exists = options.existsSync ?? existsSync;
  const rootDir = options.rootDir ?? root;
  const resolvePackageDir = options.resolvePackageDir ?? defaultPackageDirResolver;

  // 1. Local dev: crates/sweet-search-cli/target/release/
  const localDev = join(rootDir, 'crates', 'sweet-search-cli', 'target', 'release', 'sweet-search');
  if (exists(localDev)) return localDev;

  // 2. Local package template: packages/native-*-cuda/ preferred, then packages/native-*/
  if (cudaPackageName) {
    const cudaLocalPkg = join(rootDir, 'packages', `native-${platform}-${arch}${libc}-cuda`, 'sweet-search');
    if (exists(cudaLocalPkg)) return cudaLocalPkg;
  }
  const pkgDir = `native-${platform}-${arch}${libc}`;
  const localPkg = join(rootDir, 'packages', pkgDir, 'sweet-search');
  if (exists(localPkg)) return localPkg;

  // 3. Installed npm package — CUDA variant preferred on Linux.
  if (cudaPackageName) {
    try {
      const cudaNpmPkgDir = resolvePackageDir(cudaPackageName);
      const cudaNpmBin = join(cudaNpmPkgDir, 'sweet-search');
      if (exists(cudaNpmBin)) return cudaNpmBin;
    } catch {
      // -cuda package not installed — fall through to standard variant.
    }
  }
  try {
    const npmPkgDir = resolvePackageDir(getPlatformPackageName());
    const npmBin = join(npmPkgDir, 'sweet-search');
    if (exists(npmBin)) return npmBin;
  } catch {
    // Package not installed
  }

  return null;
}
