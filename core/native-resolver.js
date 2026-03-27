/**
 * Native artifact resolver — single module for locating platform-specific
 * binaries (MaxSim .node addon and sweet-search CLI binary).
 *
 * Resolution order for each artifact:
 *   1. Local dev build output (native-maxsim/ or sweet-search-cli/target/)
 *   2. Local package template (packages/native-{platform}-{arch}{libc}/)
 *   3. Installed npm package (@sweet-search/native-{platform}-{arch}{libc})
 *   4. null
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
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
  return { platform, arch, libc, packageName };
}

/**
 * Return the expected npm package name for the current platform, or null if unsupported.
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
 */
export function resolveNativeAddon(options = {}) {
  const info = getPlatformInfo();
  if (!info) return null;
  const { platform, arch, libc } = info;
  const binaryName = `maxsim.${platform}-${arch}.node`;
  const exists = options.existsSync ?? existsSync;
  const rootDir = options.rootDir ?? root;
  const resolvePackageDir = options.resolvePackageDir ?? defaultPackageDirResolver;

  // 1. Local dev: native-maxsim/ directory
  const localDev = join(rootDir, 'native-maxsim', binaryName);
  if (exists(localDev)) return localDev;

  // 2. Local package template: packages/native-*/
  const pkgDir = `native-${platform}-${arch}${libc}`;
  const localPkg = join(rootDir, 'packages', pkgDir, 'maxsim.node');
  if (exists(localPkg)) return localPkg;

  // 3. Installed npm package
  try {
    const npmPkgDir = resolvePackageDir(getPlatformPackageName());
    const npmAddon = join(npmPkgDir, 'maxsim.node');
    if (exists(npmAddon)) return npmAddon;
  } catch {
    // Package not installed
  }

  return null;
}

/**
 * Resolve the path to the native sweet-search CLI binary, or null.
 */
export function resolveNativeBinary(options = {}) {
  const info = getPlatformInfo();
  if (!info) return null;
  const { platform, arch, libc } = info;
  const exists = options.existsSync ?? existsSync;
  const rootDir = options.rootDir ?? root;
  const resolvePackageDir = options.resolvePackageDir ?? defaultPackageDirResolver;

  // 1. Local dev: sweet-search-cli/target/release/
  const localDev = join(rootDir, 'sweet-search-cli', 'target', 'release', 'sweet-search');
  if (exists(localDev)) return localDev;

  // 2. Local package template: packages/native-*/
  const pkgDir = `native-${platform}-${arch}${libc}`;
  const localPkg = join(rootDir, 'packages', pkgDir, 'sweet-search');
  if (exists(localPkg)) return localPkg;

  // 3. Installed npm package
  try {
    const npmPkgDir = resolvePackageDir(getPlatformPackageName());
    const npmBin = join(npmPkgDir, 'sweet-search');
    if (exists(npmBin)) return npmBin;
  } catch {
    // Package not installed
  }

  return null;
}
