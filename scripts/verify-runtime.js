/**
 * Runtime verification for Sweet Search.
 *
 * Checks that all required assets and models are present and valid
 * after `sweet-search init`. Used both by the init command and as
 * a standalone diagnostic.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getModelEntry } from '../core/infrastructure/model-registry.js';
import { computeFileHash, getModelCacheDir } from '../core/infrastructure/model-fetcher.js';
import { resolveNativeAddon, resolveNativeBinary, getPlatformInfo } from '../core/infrastructure/native-resolver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

/**
 * Run runtime verification.
 *
 * @param {object} options
 * @param {string} options.profile - Init profile ('core' or 'full')
 * @param {string[]} options.modelKeys - Model registry keys to verify
 * @param {boolean} [options.deep=false] - Run deep verification (load modules, verify checksums)
 * @param {string} [options.packageRoot] - Override package root (for testing)
 * @returns {Promise<{ passed: boolean, type: string, timestamp: string, checks: Array<{ name: string, status: string, message?: string }> }>}
 */
export async function verifyRuntime(options) {
  const {
    profile,
    modelKeys = [],
    deep = false,
    packageRoot = PACKAGE_ROOT,
  } = options;

  const checks = [];
  const type = deep ? 'deep' : 'fast';

  // 1. Load and verify runtime assets from manifest
  const manifestPath = join(packageRoot, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) {
    checks.push({ name: 'manifest', status: 'fail', message: `Missing ${manifestPath}` });
    return { passed: false, type, timestamp: new Date().toISOString(), checks };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  for (const [key, relativePath] of Object.entries(manifest.runtimeAssets)) {
    const fullPath = join(packageRoot, relativePath);
    if (existsSync(fullPath)) {
      checks.push({ name: `asset:${key}`, status: 'pass' });
    } else {
      checks.push({ name: `asset:${key}`, status: 'fail', message: `Missing ${relativePath}` });
    }
  }

  // 2. Verify model files for the profile
  for (const modelKey of modelKeys) {
    const entry = getModelEntry(modelKey);
    if (!entry) {
      checks.push({ name: `model:${modelKey}`, status: 'fail', message: 'Unknown model key' });
      continue;
    }

    const cacheDir = getModelCacheDir(entry.hfId);

    for (const file of entry.files) {
      const filePath = join(cacheDir, file.path);
      const checkName = `model:${modelKey}/${file.path}`;

      if (!existsSync(filePath)) {
        checks.push({ name: checkName, status: 'fail', message: `Missing ${filePath}` });
        continue;
      }

      // Size check
      const stat = statSync(filePath);
      if (file.sizeBytes && stat.size !== file.sizeBytes) {
        checks.push({
          name: checkName,
          status: 'fail',
          message: `Size mismatch: expected ${file.sizeBytes}, got ${stat.size}`,
        });
        continue;
      }

      // Deep: SHA256 checksum verification for files that have checksums
      if (deep && file.sha256) {
        const hash = await computeFileHash(filePath);
        if (hash !== file.sha256) {
          checks.push({
            name: checkName,
            status: 'fail',
            message: `Checksum mismatch: expected ${file.sha256}, got ${hash}`,
          });
          continue;
        }
      }

      checks.push({ name: checkName, status: 'pass' });
    }
  }

  // 3. Native addon/binary status (informational)
  const platformInfo = getPlatformInfo();
  const addonPath = resolveNativeAddon();
  const binaryPath = resolveNativeBinary();

  if (platformInfo) {
    checks.push({
      name: 'native:addon',
      status: addonPath ? 'pass' : 'warn',
      message: addonPath ? `Found at ${addonPath}` : `Not found for ${platformInfo.packageName} (WASM fallback active)`,
    });
    checks.push({
      name: 'native:binary',
      status: binaryPath ? 'pass' : 'warn',
      message: binaryPath ? `Found at ${binaryPath}` : `Not found (JS fallback active)`,
    });
  } else {
    checks.push({
      name: 'native:platform',
      status: 'warn',
      message: `Platform ${process.platform}-${process.arch} has no native package (JS/WASM fallback active)`,
    });
  }

  // 4. Deep: load WASM router and CatBoost router
  if (deep) {
    // WASM router
    try {
      const require = createRequire(import.meta.url);
      require(join(packageRoot, manifest.runtimeAssets.wasmRouter));
      checks.push({ name: 'load:wasm-router', status: 'pass' });
    } catch (err) {
      checks.push({ name: 'load:wasm-router', status: 'fail', message: err.message });
    }

    // CatBoost router
    try {
      await import(join(packageRoot, manifest.runtimeAssets.catboostRouter));
      checks.push({ name: 'load:catboost-router', status: 'pass' });
    } catch (err) {
      checks.push({ name: 'load:catboost-router', status: 'fail', message: err.message });
    }
  }

  const passed = checks.every(c => c.status !== 'fail');

  return {
    passed,
    type,
    timestamp: new Date().toISOString(),
    checks,
  };
}

/**
 * Determine the MaxSim tier string for reporting.
 */
export function getMaxsimTier() {
  if (resolveNativeAddon()) return 'native';
  const wasmPath = join(PACKAGE_ROOT, 'core', 'maxsim.wasm');
  if (existsSync(wasmPath)) return 'wasm';
  return 'js-fallback';
}

/**
 * Determine the router type string for reporting.
 */
export function getRouterType() {
  const wasmPath = join(PACKAGE_ROOT, 'wasm-router', 'pkg', 'query_router_wasm_bg.wasm');
  if (existsSync(wasmPath)) return 'wasm';
  return 'js-fallback';
}
