#!/usr/bin/env node

/**
 * Sweet Search init — idempotent setup command.
 *
 * Detects project root, resolves profile, verifies/downloads required assets,
 * generates .sweet-search/config.json, runs verification, and prints a report.
 *
 * Usage:
 *   sweet-search init [--profile <core|full>] [--verify-deep] [--force] [--verbose]
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getModelEntry, getModelsForProfile, MODEL_REGISTRY, fetchModel, getModelCacheDir, getPlatformInfo, resolveNativeAddon, resolveNativeBinary } from '../core/infrastructure/index.js';
import { verifyRuntime, getMaxsimTier, getRouterType } from './verify-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

const VALID_PROFILES = ['core', 'full'];
const DATA_DIR_NAME = '.sweet-search';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseInitArgs(args) {
  const result = { profile: null, verifyDeep: false, force: false, verbose: false, help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--profile' || arg === '-p') {
      result.profile = args[++i] || null;
    } else if (arg.startsWith('--profile=')) {
      result.profile = arg.split('=')[1];
    } else if (arg === '--verify-deep') {
      result.verifyDeep = true;
    } else if (arg === '--force') {
      result.force = true;
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Node.js version check
// ---------------------------------------------------------------------------

export function checkNodeVersion() {
  const major = parseInt(process.versions.node, 10);
  if (major < 18) {
    throw new Error(
      `Node.js ${process.versions.node} is below the minimum required version (18.0.0).\n` +
      `  Please upgrade Node.js: https://nodejs.org/`
    );
  }
}

// ---------------------------------------------------------------------------
// Project root detection
// ---------------------------------------------------------------------------

export function detectProjectRoot(cwd = process.cwd()) {
  let dir = cwd;
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return cwd;
}

// ---------------------------------------------------------------------------
// Data directory
// ---------------------------------------------------------------------------

export function ensureDataDir(projectRoot) {
  const dataDir = join(projectRoot, DATA_DIR_NAME);
  mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

// ---------------------------------------------------------------------------
// Init config read/write
// ---------------------------------------------------------------------------

export function loadInitConfig(dataDir) {
  const configPath = join(dataDir, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeInitConfig(dataDir, config) {
  const configPath = join(dataDir, 'config.json');
  const tmpPath = configPath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, configPath);
}

// ---------------------------------------------------------------------------
// Profile resolution
// ---------------------------------------------------------------------------

export function resolveProfile(cliProfile, existingConfig) {
  if (cliProfile) {
    if (!VALID_PROFILES.includes(cliProfile)) {
      throw new Error(
        `Unknown profile "${cliProfile}". Valid profiles: ${VALID_PROFILES.join(', ')}`
      );
    }
    return cliProfile;
  }
  if (existingConfig?.profile && VALID_PROFILES.includes(existingConfig.profile)) {
    return existingConfig.profile;
  }
  return 'full';
}

// ---------------------------------------------------------------------------
// Runtime asset verification (WASM/router/JS assets in the package)
// ---------------------------------------------------------------------------

export function verifyRuntimeAssets(packageRoot) {
  const manifestPath = join(packageRoot, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { ok: false, missing: ['assets/manifest.json'], present: [] };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const missing = [];
  const present = [];

  for (const [key, relativePath] of Object.entries(manifest.runtimeAssets)) {
    const fullPath = join(packageRoot, relativePath);
    if (existsSync(fullPath)) {
      present.push(relativePath);
    } else {
      missing.push(relativePath);
    }
  }

  return { ok: missing.length === 0, missing, present };
}

// ---------------------------------------------------------------------------
// Native status check
// ---------------------------------------------------------------------------

export function checkNativeStatus() {
  const platformInfo = getPlatformInfo();
  return {
    platform: platformInfo,
    addon: resolveNativeAddon(),
    binary: resolveNativeBinary(),
  };
}

// ---------------------------------------------------------------------------
// Model download
// ---------------------------------------------------------------------------

export async function downloadModelsForProfile(profile, options = {}) {
  const modelKeys = getModelsForProfile(profile);
  if (modelKeys.length === 0) {
    return { results: new Map(), totalDownloaded: 0, totalCached: 0, failures: [] };
  }

  const results = new Map();
  let totalDownloaded = 0;
  let totalCached = 0;
  const failures = [];

  for (const key of modelKeys) {
    const entry = getModelEntry(key);
    if (!entry) {
      failures.push({ key, error: `Unknown model key: ${key}` });
      continue;
    }

    // --force: delete cached files before re-fetching
    if (options.force) {
      const cacheDir = getModelCacheDir(entry.hfId);
      for (const file of entry.files) {
        const filePath = join(cacheDir, file.path);
        if (existsSync(filePath)) {
          try { unlinkSync(filePath); } catch { /* ignore */ }
        }
      }
    }

    try {
      const result = await fetchModel(key, { onProgress: options.onProgress });
      results.set(key, { status: 'cached', cached: result.cached, downloaded: result.downloaded });
      totalDownloaded += result.downloaded;
      totalCached += result.cached;
    } catch (err) {
      failures.push({ key, error: err.message });
    }
  }

  return { results, totalDownloaded, totalCached, failures };
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

function printReport(report) {
  const { profile, maxsimTier, routerType, models, verification, runtimeDownloads } = report;

  console.log('');
  console.log('Sweet Search init complete');
  console.log('');
  console.log(`  Profile:              ${profile}`);
  console.log(`  MaxSim:               ${maxsimTier}`);
  console.log(`  Router:               ${routerType}`);

  if (profile !== 'core') {
    for (const [key, info] of models) {
      const label = key.replace(/-/g, ' ');
      console.log(`  ${label}: ${info.status}`);
    }
  }

  console.log(`  Runtime downloads:    ${runtimeDownloads}`);

  const passedCount = verification.checks.filter(c => c.status === 'pass').length;
  const totalCount = verification.checks.length;
  console.log(`  Verification:         ${verification.type}-pass (${passedCount}/${totalCount})`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
Sweet Search init — set up runtime assets and models

Usage:
  sweet-search init [options]

Options:
  --profile <profile>   Install profile: core, full (default: full)
  --verify-deep         Run deep verification (load modules, verify checksums)
  --force               Re-download all models even if cached
  --verbose, -v         Enable verbose output
  --help, -h            Show this help

Profiles:
  core    Lightweight search setup (no models)
  full    Full search with all models (~523 MB download)

Examples:
  sweet-search init                    # Full profile (default)
  sweet-search init --profile core     # Core profile (no model downloads)
  sweet-search init --force            # Re-download all models
`);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runInit(args) {
  const parsed = parseInitArgs(args);

  if (parsed.help) {
    printHelp();
    return;
  }

  // 1. Node.js version check
  checkNodeVersion();

  // 2. Detect project root
  const projectRoot = detectProjectRoot();
  if (parsed.verbose) {
    process.stderr.write(`[init] Project root: ${projectRoot}\n`);
  }

  // 3. Ensure .sweet-search/ directory
  const dataDir = ensureDataDir(projectRoot);
  if (parsed.verbose) {
    process.stderr.write(`[init] Data directory: ${dataDir}\n`);
  }

  // 4. Resolve profile
  const existingConfig = loadInitConfig(dataDir);
  const profile = resolveProfile(parsed.profile, existingConfig);
  process.stderr.write(`[init] Profile: ${profile}\n`);

  // 5. Verify runtime assets (WASM, router, etc.)
  const assetCheck = verifyRuntimeAssets(PACKAGE_ROOT);
  if (!assetCheck.ok) {
    process.stderr.write(`[init] ERROR: Missing runtime assets:\n`);
    for (const m of assetCheck.missing) {
      process.stderr.write(`  - ${m}\n`);
    }
    process.stderr.write(`  Try reinstalling sweet-search: npm install sweet-search\n`);
    process.exit(1);
  }
  process.stderr.write(`[init] Runtime assets: OK (${assetCheck.present.length}/${assetCheck.present.length} present)\n`);

  // 6. Check native status
  const nativeStatus = checkNativeStatus();
  const maxsimTier = getMaxsimTier();
  const routerType = getRouterType();
  if (parsed.verbose) {
    process.stderr.write(`[init] MaxSim tier: ${maxsimTier}\n`);
    process.stderr.write(`[init] Router type: ${routerType}\n`);
  }

  // 7. Download models for profile
  const modelKeys = getModelsForProfile(profile);
  let modelResults = new Map();

  if (modelKeys.length > 0) {
    process.stderr.write(`[init] Downloading models for profile "${profile}"...\n`);
    const downloadResult = await downloadModelsForProfile(profile, {
      force: parsed.force,
    });

    modelResults = downloadResult.results;

    if (downloadResult.failures.length > 0) {
      process.stderr.write(`[init] ERROR: Failed to download required models:\n`);
      for (const f of downloadResult.failures) {
        process.stderr.write(`  - ${f.key}: ${f.error}\n`);
      }
      process.stderr.write(`  Run \`sweet-search init --force\` to retry.\n`);

      // Write partial config for diagnostics before exiting
      const partialConfig = buildConfig({
        profile, maxsimTier, routerType, nativeStatus,
        modelResults, verification: { type: 'none', timestamp: new Date().toISOString(), checks: [] },
        failed: true,
      });
      writeInitConfig(dataDir, partialConfig);

      process.exit(1);
    }

    const cached = downloadResult.totalCached;
    const downloaded = downloadResult.totalDownloaded;
    process.stderr.write(`[init] Models: ${cached} cached, ${downloaded} downloaded\n`);
  } else {
    process.stderr.write(`[init] No models required for profile "${profile}"\n`);
  }

  // 8. Write init config (before verification so it's available for diagnostics)
  const runtimeDownloads = profile === 'core' ? 'enabled' : 'disabled';
  const allowRuntimeModelDownload = profile === 'core';

  const preVerifyConfig = buildConfig({
    profile, maxsimTier, routerType, nativeStatus,
    modelResults, allowRuntimeModelDownload,
    verification: { type: 'pending', timestamp: new Date().toISOString(), checks: [] },
    failed: false,
  });
  writeInitConfig(dataDir, preVerifyConfig);

  // 9. Run verification
  process.stderr.write(`[init] Running ${parsed.verifyDeep ? 'deep' : 'fast'} verification...\n`);
  const verification = await verifyRuntime({
    profile,
    modelKeys,
    deep: parsed.verifyDeep,
    packageRoot: PACKAGE_ROOT,
  });

  // Update config with verification result
  const finalConfig = buildConfig({
    profile, maxsimTier, routerType, nativeStatus,
    modelResults, allowRuntimeModelDownload,
    verification,
    failed: false,
  });
  writeInitConfig(dataDir, finalConfig);

  if (!verification.passed) {
    process.stderr.write(`[init] ERROR: Verification failed:\n`);
    for (const check of verification.checks) {
      if (check.status === 'fail') {
        process.stderr.write(`  FAIL ${check.name}: ${check.message}\n`);
      }
    }
    process.exit(1);
  }

  // 10. Install index-maintainer daemon hook
  try {
    const hookDir = join(projectRoot, '.claude', 'hooks');
    const hookDest = join(hookDir, 'index-maintainer.mjs');
    const hookSrc = join(PACKAGE_ROOT, 'core', 'indexing', 'index-maintainer.mjs');
    if (!existsSync(hookDest)) {
      mkdirSync(hookDir, { recursive: true });
      copyFileSync(hookSrc, hookDest);
      process.stderr.write(`[init] Installed index-maintainer daemon to ${hookDir}\n`);
    } else {
      process.stderr.write(`[init] Index-maintainer daemon already installed\n`);
    }
  } catch (e) {
    process.stderr.write(`[init] Warning: Could not install index-maintainer: ${e.message}\n`);
  }

  // 11. Print report
  printReport({
    profile,
    maxsimTier,
    routerType,
    models: modelResults,
    verification,
    runtimeDownloads,
  });
}

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

function buildConfig({ profile, maxsimTier, routerType, nativeStatus, modelResults, allowRuntimeModelDownload, verification, failed }) {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'));

  const models = {};
  for (const [key, info] of modelResults) {
    const entry = getModelEntry(key);
    models[key] = {
      status: info.status,
      cacheDir: entry ? getModelCacheDir(entry.hfId) : null,
    };
  }

  return {
    version: 1,
    profile,
    initTimestamp: new Date().toISOString(),
    sweetSearchVersion: pkg.version,
    platform: {
      os: process.platform,
      arch: process.arch,
      nativePackage: nativeStatus.platform?.packageName || null,
    },
    runtime: {
      maxsimTier,
      routerType,
      allowRuntimeModelDownload: allowRuntimeModelDownload !== undefined ? allowRuntimeModelDownload : profile === 'core',
    },
    models,
    verification: {
      type: verification.type,
      passedAt: verification.passed ? verification.timestamp : null,
      result: failed ? 'failed' : (verification.passed ? 'pass' : 'fail'),
    },
  };
}

// ---------------------------------------------------------------------------
// Direct invocation support: `node scripts/init.js [args]`
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/^\.\//, ''));
if (isDirectRun) {
  runInit(process.argv.slice(2)).catch(err => {
    process.stderr.write(`[init] ${err.message}\n`);
    process.exit(1);
  });
}
