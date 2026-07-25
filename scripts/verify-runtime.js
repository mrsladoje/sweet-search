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

import { getModelEntry, computeFileHash, getModelCacheDir, resolveNativeAddon, resolveNativeBinary, getPlatformInfo } from '../core/infrastructure/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

/**
 * Remedy text for a missing native SQLite binding.
 *
 * npm >= 11.16 gates package lifecycle scripts behind an `allow-scripts`
 * allowlist and, with `strict-allow-scripts=false`, only WARNS when it skips
 * them. better-sqlite3 obtains its prebuilt binary from exactly such a script
 * (`prebuild-install || node-gyp rebuild`), so a default `npm install` on those
 * npm versions yields a JS-only better-sqlite3 with no binding. Every index and
 * search path opens a database, so the install is unusable.
 */
export const SQLITE_BINDING_REMEDY = [
  'The native SQLite binding (better-sqlite3) could not be loaded, so indexing',
  'and search cannot run. Your package manager almost certainly skipped install',
  'scripts — npm >= 11.16 blocks them by default and only warns, and',
  'better-sqlite3 fetches its prebuilt binary from one.',
  '',
  'Fix (global install) — approve the scripts and reinstall:',
  '  npm install -g sweet-search --allow-scripts=sweet-search,better-sqlite3',
  '',
  'Fix (project install) — npm rejects that flag for project-scoped installs,',
  'so add the allowlist to your package.json, then reinstall:',
  '  "allowScripts": { "sweet-search": true, "better-sqlite3": true }',
  '  rm -rf node_modules && npm install',
].join('\n         ');

/**
 * Probe the native SQLite binding by actually opening a database.
 *
 * `require('better-sqlite3')` is NOT sufficient: the module resolves its
 * `.node` binding lazily on first Database construction, so a broken install
 * imports cleanly and only fails later, mid-index. We therefore open an
 * in-memory database and run one statement. Cost is sub-millisecond.
 *
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function probeSqliteBinding() {
  let db = null;
  try {
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    db = new Database(':memory:');
    db.exec('CREATE TABLE _sweet_search_probe (x INTEGER)');
    return { ok: true };
  } catch (err) {
    // Lead with the remedy. better-sqlite3's own error enumerates a dozen
    // candidate binding paths, none of which are actionable, so keep only its
    // first line for diagnosis.
    const cause = String(err?.message ?? err).split('\n')[0].trim();
    return { ok: false, message: `${SQLITE_BINDING_REMEDY}\n         Underlying error: ${cause}` };
  } finally {
    try { db?.close(); } catch { /* best-effort */ }
  }
}

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
  const manifestPath = join(packageRoot, 'core', 'infrastructure', 'manifest.json');
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

  // 4. Native SQLite binding — a hard requirement, unlike the optional native
  //    addon/binary above which have JS/WASM fallbacks. Checked in FAST mode
  //    because a missing binding makes the install unusable, and a green init
  //    followed by a bindings stack trace on first index is the worst outcome.
  const sqliteProbe = probeSqliteBinding();
  checks.push(sqliteProbe.ok
    ? { name: 'native:sqlite', status: 'pass' }
    : { name: 'native:sqlite', status: 'fail', message: sqliteProbe.message });

  // 5. Deep: load WASM router and CatBoost router
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
  const wasmPath = join(PACKAGE_ROOT, 'core', 'infrastructure', 'maxsim.wasm');
  if (existsSync(wasmPath)) return 'wasm';
  return 'js-fallback';
}

/**
 * Determine the router type string for reporting.
 */
export function getRouterType() {
  const wasmPath = join(PACKAGE_ROOT, 'crates', 'wasm-router', 'pkg', 'query_router_wasm_bg.wasm');
  if (existsSync(wasmPath)) return 'wasm';
  return 'js-fallback';
}
