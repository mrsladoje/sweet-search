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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  getModelEntry, getModelsForProfile, MODEL_REGISTRY, fetchModel, getModelCacheDir,
  getPlatformInfo, resolveNativeAddon, resolveNativeBinary,
  detectHardwareCapability,
  getCoremlCascadeState, getCoremlCascadeReport, fetchCoremlCascade,
} from '../core/infrastructure/index.js';
import { verifyRuntime, getMaxsimTier, getRouterType } from './verify-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

const VALID_PROFILES = ['core', 'full'];
const DATA_DIR_NAME = '.sweet-search';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseInitArgs(args) {
  const result = {
    profile: null,
    verifyDeep: false,
    force: false,
    verbose: false,
    help: false,
    buildCoremlCascade: false,
    skipCoremlCascade: false,
  };

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
    } else if (arg === '--build-coreml-cascade') {
      // Opt-in: run scripts/build-coreml-cascade.js as part of init.
      // Requires Python + coremltools locally (~12 min trace time).
      // Without this flag, init is capability-aware but passive:
      // it detects the cascade, reports its state, and never blocks.
      result.buildCoremlCascade = true;
    } else if (arg === '--skip-coreml-cascade') {
      // Opt-out: skip cascade inspection entirely. Useful on CI
      // or disk-constrained environments where even read-only
      // inspection of the managed cache is unwanted.
      result.skipCoremlCascade = true;
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
  const manifestPath = join(packageRoot, 'core', 'infrastructure', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { ok: false, missing: ['core/infrastructure/manifest.json'], present: [] };
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
  const {
    profile, maxsimTier, routerType, models, verification, runtimeDownloads,
    capability, cascadeReport,
  } = report;

  console.log('');
  console.log('Sweet Search init complete');
  console.log('');
  console.log(`  Profile:              ${profile}`);
  if (capability?.brandString) {
    console.log(`  Hardware:             ${capability.brandString} (${capability.platform}-${capability.arch})`);
  } else {
    console.log(`  Hardware:             ${capability?.platform ?? process.platform}-${capability?.arch ?? process.arch}`);
  }
  console.log(`  MaxSim:               ${maxsimTier}`);
  console.log(`  Router:               ${routerType}`);

  if (profile !== 'core') {
    for (const [key, info] of models) {
      const label = key.replace(/-/g, ' ');
      console.log(`  ${label}: ${info.status}`);
    }
  }

  // CoreML cascade line. Shown only when it says something actionable —
  // silent on ineligible hardware where no user action applies.
  if (cascadeReport) {
    if (cascadeReport.status === 'present') {
      console.log(`  CoreML cascade:       present (${cascadeReport.detail})`);
    } else if (cascadeReport.status === 'partial') {
      console.log(`  CoreML cascade:       PARTIAL — ${cascadeReport.detail}`);
    } else if (cascadeReport.status === 'not-built' && cascadeReport.applicable) {
      console.log(`  CoreML cascade:       eligible but not built — ${cascadeReport.detail}`);
    } else if (cascadeReport.status === 'disabled') {
      console.log(`  CoreML cascade:       disabled (${cascadeReport.detail})`);
    }
    // 'not-applicable' and 'skipped' are silent — no user action available.
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
  --profile <profile>       Install profile: core, full (default: full)
  --verify-deep             Run deep verification (load modules, verify checksums)
  --force                   Re-download all models even if cached
  --build-coreml-cascade    (M3+ Apple Silicon, local builds only) Trace the
                            CoreML variant cascade locally via
                            scripts/build-coreml-cascade.js instead of fetching
                            from HuggingFace. Requires Python 3 + coremltools
                            (~12 min trace time). Skipped automatically on
                            ineligible hardware. Usually not needed — the
                            default HF fetch path is faster and works without
                            Python.
  --skip-coreml-cascade     Skip CoreML cascade fetch entirely. Useful on CI
                            or disk-constrained environments.
  --verbose, -v             Enable verbose output
  --help, -h                Show this help

Profiles:
  core    Lightweight search setup (no models)
  full    Full search with all models (~523 MB download + ~1.8 GB CoreML
          cascade on M3+ Apple Silicon)

CoreML cascade (M3+ Apple Silicon only):
  A fast-path for NomicBERT embedding + ModernBERT late-interaction
  inference via Apple's Neural Engine. Gives ~18% faster full indexing
  on M3 Max vs the candle Metal baseline. Fetched automatically from
  mrsladoje/sweet-search-coreml-cascade on HuggingFace as part of the
  full profile. Non-eligible hardware (Intel Mac, Linux, M1/M2) never
  downloads the cascade. See docs/INIT_STRATEGY.md for the delivery
  strategy.

Examples:
  sweet-search init                         # Full profile (default)
  sweet-search init --profile core          # Core profile (no model downloads)
  sweet-search init --force                 # Re-download all models
  sweet-search init --build-coreml-cascade  # Trace the cascade locally (dev only)
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

  // 8. Resolve hardware capability + CoreML cascade state.
  //
  // The cascade is an M3+ Apple Silicon acceleration for native inference.
  // It's always optional: missing hardware, fetch failure, and explicit
  // opt-out all collapse to the standard candle path. Never fails init.
  //
  // Decision tree (full profile, eligible hardware, cascade not already
  // present):
  //
  //   --skip-coreml-cascade      → skip everything, record 'skipped'
  //   --build-coreml-cascade     → run trace_cascade.py locally via
  //                                scripts/build-coreml-cascade.js
  //                                (requires Python + coremltools)
  //   default (no flags)         → fetch tarballs from the HF repo in
  //                                coreml-cascade.json and extract into
  //                                the managed cache — same delivery
  //                                mechanism as the other models
  //
  // Both paths end up at the same on-disk state and are interchangeable
  // from the addon's point of view.
  const capability = detectHardwareCapability();
  let cascadeReport = { status: 'skipped', detail: 'Cascade inspection skipped' };
  if (!parsed.skipCoremlCascade && profile !== 'core') {
    cascadeReport = getCoremlCascadeReport();

    if (cascadeReport.applicable && cascadeReport.status !== 'present') {
      if (parsed.buildCoremlCascade) {
        // Explicit local-build path — traces the cascade via the
        // Python subprocess. Primarily for developers on machines
        // without internet, or for retracing after a shape-set
        // change in coreml-cascade.json.
        process.stderr.write('[init] Building CoreML cascade via scripts/build-coreml-cascade.js...\n');
        const built = runCoremlCascadeBuild({ verbose: parsed.verbose });
        if (built.ok) {
          cascadeReport = getCoremlCascadeReport();
        } else {
          process.stderr.write(`[init] CoreML cascade build failed: ${built.error}\n`);
          process.stderr.write(`[init] Init continues without the cascade — candle path is unaffected.\n`);
        }
      } else {
        // Default path — fetch from HuggingFace, same pattern as
        // the other models. fetchCoremlCascade handles atomic
        // download + checksum verification + tarball extraction
        // and never throws. Failures are reported but don't
        // abort init.
        process.stderr.write('[init] Fetching CoreML variant cascade from HuggingFace...\n');
        try {
          const fetchResult = await fetchCoremlCascade({ force: parsed.force });
          if (fetchResult.status === 'fetched' || fetchResult.status === 'cached' || fetchResult.status === 'partial') {
            const total = fetchResult.fetched + fetchResult.cached;
            const parts = [];
            if (fetchResult.fetched > 0) parts.push(`${fetchResult.fetched} downloaded`);
            if (fetchResult.cached > 0) parts.push(`${fetchResult.cached} already cached`);
            if (fetchResult.skipped > 0) parts.push(`${fetchResult.skipped} not yet published`);
            if (fetchResult.failures.length > 0) parts.push(`${fetchResult.failures.length} failed`);
            process.stderr.write(`[init] CoreML cascade: ${total}/12 variants installed (${parts.join(', ')})\n`);
            for (const f of fetchResult.failures) {
              process.stderr.write(`[init]   ${f.variant}: ${f.error}\n`);
            }
          } else if (fetchResult.status === 'not-published') {
            process.stderr.write(`[init] CoreML cascade: not yet published on HuggingFace — tarballs will be fetched once checksums are backfilled in coreml-cascade.json\n`);
          } else if (fetchResult.status === 'skipped') {
            if (parsed.verbose) {
              process.stderr.write(`[init] CoreML cascade fetch skipped: ${fetchResult.reason}\n`);
            }
          } else if (fetchResult.status === 'not-configured') {
            process.stderr.write(`[init] CoreML cascade: ${fetchResult.reason} — skipping\n`);
          }
          // Re-inspect the cache now that the fetch is done.
          cascadeReport = getCoremlCascadeReport();
        } catch (err) {
          process.stderr.write(`[init] CoreML cascade fetch errored: ${err.message}\n`);
          process.stderr.write(`[init] Init continues without the cascade — candle path is unaffected.\n`);
        }
      }
    } else if (parsed.buildCoremlCascade && !cascadeReport.applicable) {
      process.stderr.write(`[init] --build-coreml-cascade ignored: ${cascadeReport.detail}\n`);
    }

    if (parsed.verbose) {
      process.stderr.write(`[init] CoreML cascade: ${cascadeReport.status} — ${cascadeReport.detail}\n`);
    }
  }

  // 9. Write init config (before verification so it's available for diagnostics)
  const runtimeDownloads = profile === 'core' ? 'enabled' : 'disabled';
  const allowRuntimeModelDownload = profile === 'core';

  const preVerifyConfig = buildConfig({
    profile, maxsimTier, routerType, nativeStatus,
    modelResults, allowRuntimeModelDownload,
    verification: { type: 'pending', timestamp: new Date().toISOString(), checks: [] },
    failed: false,
    capability,
    cascadeReport,
  });
  writeInitConfig(dataDir, preVerifyConfig);

  // 10. Run verification
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
    capability,
    cascadeReport,
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

  // 12. Print report
  printReport({
    profile,
    maxsimTier,
    routerType,
    models: modelResults,
    verification,
    runtimeDownloads,
    capability,
    cascadeReport,
  });
}

/**
 * Run `node scripts/build-coreml-cascade.js` as a child process and
 * return a pass/fail object. Output is inherited so the user sees
 * the Python progress lines in real time. Errors are caught and
 * reported — init never aborts on cascade build failure.
 */
function runCoremlCascadeBuild(options = {}) {
  const scriptPath = join(PACKAGE_ROOT, 'scripts', 'build-coreml-cascade.js');
  if (!existsSync(scriptPath)) {
    // The build script is repo-only right now (not shipped via npm)
    // because it wraps scripts/spike-coreml/trace_cascade.py which in
    // turn needs Python + coremltools + the PyTorch port code. Until
    // pre-traced mlpackages are hosted on HuggingFace, the cascade can
    // only be built from a clone. Surface this clearly instead of a
    // bare "not found" message.
    return {
      ok: false,
      error: `scripts/build-coreml-cascade.js not found (${scriptPath}).\n` +
        `  The CoreML cascade build path currently requires a local clone\n` +
        `  of the sweet-search repository — it is not yet shipped via npm.\n` +
        `  To build the cascade:\n` +
        `    git clone https://github.com/panonitorg/sweet-search\n` +
        `    cd sweet-search\n` +
        `    node scripts/build-coreml-cascade.js\n` +
        `  Then point your install at the managed cache (init detects it).`,
    };
  }
  const args = [scriptPath];
  if (options.verbose) args.push('--verbose');

  try {
    const result = spawnSync(process.execPath, args, {
      stdio: 'inherit',
      cwd: PACKAGE_ROOT,
    });
    if (result.status === 0) return { ok: true };
    return { ok: false, error: `exit code ${result.status ?? 'unknown'}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

function buildConfig({
  profile, maxsimTier, routerType, nativeStatus, modelResults,
  allowRuntimeModelDownload, verification, failed,
  capability, cascadeReport,
}) {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'));

  const models = {};
  for (const [key, info] of modelResults) {
    const entry = getModelEntry(key);
    models[key] = {
      status: info.status,
      cacheDir: entry ? getModelCacheDir(entry.hfId) : null,
    };
  }

  // Runtime section — records the hardware decision and cascade
  // state so `sweet-search uninstall` and future `sweet-search doctor`
  // can surface the same picture without redetecting.
  const runtime = {
    maxsimTier,
    routerType,
    allowRuntimeModelDownload: allowRuntimeModelDownload !== undefined ? allowRuntimeModelDownload : profile === 'core',
  };
  if (capability) {
    runtime.hardware = {
      platform: capability.platform,
      arch: capability.arch,
      brandString: capability.brandString,
      appleSilicon: capability.appleSilicon,
      candleGpuBackend: capability.candleGpuBackend,
      inferenceBackendPreference: capability.inferenceBackendPreference,
    };
  }
  if (cascadeReport) {
    runtime.coremlCascade = {
      status: cascadeReport.status,
      detail: cascadeReport.detail,
      applicable: cascadeReport.applicable ?? false,
      reason: cascadeReport.reason,
      embedDir: cascadeReport.embedDir ?? null,
      liDir: cascadeReport.liDir ?? null,
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
    runtime,
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
