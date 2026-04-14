#!/usr/bin/env node

/**
 * Sweet Search CoreML cascade builder.
 *
 * Traces the M3+ CoreML variant cascade (6 NomicBERT embedding
 * variants + 6 ModernBERT LI variants) and writes the .mlpackage
 * output directly to the managed cache directory resolved by
 * core/infrastructure/coreml-cascade.js::getCoremlCascadeRoot().
 *
 * This is NOT a standard init dependency — it requires Python 3 +
 * coremltools + torch locally, and takes ~12 minutes on an M3 Max.
 * Normal users don't run it. It exists for:
 *
 *   (a) Developers building the cascade for a first release, before
 *       the pre-traced mlpackages are uploaded to HuggingFace.
 *   (b) Power users on M3+ Apple Silicon who want the 18% indexing
 *       speedup and don't mind a one-time Python setup.
 *   (c) CI jobs that cut release tarballs from a fresh machine.
 *
 * The script:
 *
 *   1. Checks hardware capability — refuses to build on non-M3
 *      Apple Silicon (matches the Rust addon's dispatch gate).
 *   2. Verifies the existing spike-coreml venv + coremltools.
 *      Prints an actionable install command if missing.
 *   3. Runs scripts/spike-coreml/trace_cascade.py with an
 *      --output-dir flag pointing at the managed cache.
 *   4. Re-inspects the cache and reports the resulting state.
 *
 * Under the hood this is a thin wrapper around trace_cascade.py.
 * The Python script owns the actual tracing logic and the shape
 * set lives in core/infrastructure/coreml-cascade.json (single
 * source of truth).
 *
 * Usage:
 *   node scripts/build-coreml-cascade.js                    # build the full cascade
 *   node scripts/build-coreml-cascade.js --embed-only       # only the 6 embedding variants
 *   node scripts/build-coreml-cascade.js --li-only          # only the 6 LI variants
 *   node scripts/build-coreml-cascade.js --skip-existing    # don't retrace cached variants
 *   node scripts/build-coreml-cascade.js --verbose          # verbose output
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectHardwareCapability,
  getCoremlCascadeRoot,
  getCoremlEmbedDir,
  getCoremlLiDir,
  getCoremlCascadeState,
} from '../core/infrastructure/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const SPIKE_DIR = join(PACKAGE_ROOT, 'scripts', 'spike-coreml');
const TRACE_SCRIPT = join(SPIKE_DIR, 'trace_cascade.py');
const VENV_DIR = join(SPIKE_DIR, '.venv');
const VENV_PYTHON = join(VENV_DIR, 'bin', 'python');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(args) {
  const result = {
    embedOnly: false,
    liOnly: false,
    skipExisting: false,
    verbose: false,
    force: false,
    help: false,
  };
  for (const arg of args) {
    if (arg === '--embed-only') result.embedOnly = true;
    else if (arg === '--li-only') result.liOnly = true;
    else if (arg === '--skip-existing') result.skipExisting = true;
    else if (arg === '--verbose' || arg === '-v') result.verbose = true;
    else if (arg === '--force') result.force = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
  }
  return result;
}

function printHelp() {
  console.log(`
Sweet Search CoreML cascade builder

Usage:
  node scripts/build-coreml-cascade.js [options]

Options:
  --embed-only     Only trace the 6 NomicBERT embedding variants (~6 min)
  --li-only        Only trace the 6 ModernBERT LI variants (~6 min)
  --skip-existing  Don't retrace variants whose .mlpackage already exists
  --force          Build even on ineligible hardware (debugging only)
  --verbose, -v    Pass through verbose output from the Python script
  --help, -h       Show this help

Requirements:
  - macOS 14+ with M3+ Apple Silicon (or --force)
  - Python 3.10+
  - torch, coremltools, safetensors, packaging, numpy

Setup (first time):
  python3 -m venv scripts/spike-coreml/.venv
  source scripts/spike-coreml/.venv/bin/activate
  pip install torch coremltools safetensors packaging numpy

Output:
  The cascade is written directly into the managed cache dir at
    ~/.cache/sweet-search/models/coreml-cascade/
      embed/  (six .mlpackage dirs)
      li/     (six .mlpackage dirs)

  This is the same path Sweet Search's native inference loads from
  via core/infrastructure/coreml-cascade.js::getCoremlCascadeResolvedDirs.
  Run \`sweet-search init\` afterwards to verify the build.
`);
}

// ---------------------------------------------------------------------------
// Capability + environment checks
// ---------------------------------------------------------------------------

/** Print and return false if hardware is not M3+ Apple Silicon. */
function checkHardware(force) {
  const hw = detectHardwareCapability();
  if (hw.coremlCascadeEligible) {
    process.stderr.write(`[build-cascade] Hardware: ${hw.brandString} — eligible\n`);
    return true;
  }
  if (force) {
    process.stderr.write(`[build-cascade] Hardware: ${hw.brandString || 'unknown'} — NOT eligible, but --force set, continuing\n`);
    process.stderr.write(`[build-cascade] Reason: ${hw.coremlCascadeReason}\n`);
    return true;
  }
  process.stderr.write(`[build-cascade] Hardware: ${hw.brandString || 'unknown'} — NOT eligible. Use --force to override (debugging only).\n`);
  process.stderr.write(`[build-cascade] Reason: ${hw.coremlCascadeReason}\n`);
  return false;
}

/** Locate a usable Python interpreter. Prefers the spike venv. */
function findPython() {
  if (existsSync(VENV_PYTHON)) {
    return { path: VENV_PYTHON, source: 'spike venv' };
  }
  // Fall back to the user's Python 3 — good enough for a first
  // installation when the venv hasn't been created yet.
  const probe = spawnSync('which', ['python3'], { encoding: 'utf-8' });
  if (probe.status === 0 && probe.stdout.trim()) {
    return { path: probe.stdout.trim(), source: 'system python3' };
  }
  return null;
}

/**
 * Check that coremltools + torch + safetensors are importable from
 * the given Python interpreter. Returns { ok, error } — on failure
 * the error message includes the exact pip command the user should
 * run to install the missing packages.
 */
function checkPythonDeps(pythonPath) {
  const probeCode = `
import sys
missing = []
for mod in ('torch', 'coremltools', 'safetensors', 'numpy'):
    try:
        __import__(mod)
    except ImportError:
        missing.append(mod)
if missing:
    print('MISSING:' + ','.join(missing))
    sys.exit(1)
print('OK')
`.trim();
  const result = spawnSync(pythonPath, ['-c', probeCode], { encoding: 'utf-8' });
  if (result.status === 0 && result.stdout.trim() === 'OK') {
    return { ok: true };
  }
  const missingLine = (result.stdout || '').split('\n').find(l => l.startsWith('MISSING:'));
  const missing = missingLine ? missingLine.slice('MISSING:'.length).split(',') : ['?'];
  const installCmd = `${pythonPath} -m pip install ${missing.join(' ')}`;
  return {
    ok: false,
    error: `Python interpreter ${pythonPath} missing: ${missing.join(', ')}. Install with:\n  ${installCmd}`,
  };
}

/**
 * Source safetensors are required — the Python trace script reads
 * them directly. If the user hasn't run `sweet-search init --profile full`
 * yet, these won't exist. Report clearly.
 */
function checkSourceSafetensors() {
  const cacheRoot = process.env.SWEET_SEARCH_MODEL_CACHE
    || join(process.env.HOME || '', '.cache', 'sweet-search', 'models');
  const embedSt = join(cacheRoot, 'nomic-ai--CodeRankEmbed', 'model.safetensors');
  const liSt = join(cacheRoot, 'lightonai--LateOn-Code', 'model.safetensors');
  const missing = [];
  if (!existsSync(embedSt)) missing.push(`nomic-ai/CodeRankEmbed (${embedSt})`);
  if (!existsSync(liSt)) missing.push(`lightonai/LateOn-Code (${liSt})`);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Source safetensors missing:\n  - ${missing.join('\n  - ')}\n  Run \`sweet-search init --profile full\` first to fetch them.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(args) {
  const parsed = parseArgs(args);
  if (parsed.help) { printHelp(); return 0; }

  if (!checkHardware(parsed.force)) {
    return 2;
  }

  const python = findPython();
  if (!python) {
    process.stderr.write(`[build-cascade] No Python 3 interpreter found.\n`);
    process.stderr.write(`[build-cascade] Install Python 3 and create the spike venv:\n`);
    process.stderr.write(`[build-cascade]   python3 -m venv scripts/spike-coreml/.venv\n`);
    process.stderr.write(`[build-cascade]   source scripts/spike-coreml/.venv/bin/activate\n`);
    process.stderr.write(`[build-cascade]   pip install torch coremltools safetensors packaging numpy\n`);
    return 3;
  }
  process.stderr.write(`[build-cascade] Python: ${python.path} (${python.source})\n`);

  const deps = checkPythonDeps(python.path);
  if (!deps.ok) {
    process.stderr.write(`[build-cascade] ${deps.error}\n`);
    return 4;
  }

  const sources = checkSourceSafetensors();
  if (!sources.ok) {
    process.stderr.write(`[build-cascade] ${sources.error}\n`);
    return 5;
  }

  if (!existsSync(TRACE_SCRIPT)) {
    process.stderr.write(`[build-cascade] Trace script not found: ${TRACE_SCRIPT}\n`);
    return 6;
  }

  // Make sure the cascade root + subdirs exist before the Python
  // script runs. mkdirSync recursive=true is a no-op if they
  // already exist.
  const embedDir = getCoremlEmbedDir();
  const liDir = getCoremlLiDir();
  mkdirSync(embedDir, { recursive: true });
  mkdirSync(liDir, { recursive: true });
  process.stderr.write(`[build-cascade] Cascade root: ${getCoremlCascadeRoot()}\n`);
  process.stderr.write(`[build-cascade] Embed output: ${embedDir}\n`);
  process.stderr.write(`[build-cascade] LI output:    ${liDir}\n`);

  // Build the Python arg list. trace_cascade.py accepts --output-dir
  // for the directories and a few passthrough flags we forward.
  const traceArgs = [TRACE_SCRIPT, '--embed-dir', embedDir, '--li-dir', liDir];
  if (parsed.embedOnly) traceArgs.push('--embed-only');
  if (parsed.liOnly) traceArgs.push('--li-only');
  if (parsed.skipExisting) traceArgs.push('--skip-existing');
  if (parsed.verbose) traceArgs.push('--verbose');

  process.stderr.write(`[build-cascade] Running trace_cascade.py...\n`);
  const t0 = Date.now();
  const traceResult = spawnSync(python.path, traceArgs, {
    stdio: 'inherit',
    cwd: SPIKE_DIR,
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (traceResult.status !== 0) {
    process.stderr.write(`[build-cascade] trace_cascade.py failed after ${dt}s with status ${traceResult.status}\n`);
    return 7;
  }
  process.stderr.write(`[build-cascade] trace_cascade.py completed in ${dt}s\n`);

  // Re-inspect the cache and print a summary. Anything short of
  // "complete" is a build anomaly — report it loud so the user can
  // investigate.
  const state = getCoremlCascadeState();
  const total = state.embedTotal + state.liTotal;
  const present = state.embedPresent + state.liPresent;
  process.stderr.write('\n');
  process.stderr.write(`[build-cascade] Cascade state: ${present}/${total} variants (${state.embedPresent}/${state.embedTotal} embed + ${state.liPresent}/${state.liTotal} LI)\n`);
  if (state.complete) {
    const rootSize = estimateDirSize(state.root);
    process.stderr.write(`[build-cascade] ✓ Cascade ready at ${state.root}${rootSize ? ` (${formatBytes(rootSize)})` : ''}\n`);
    return 0;
  }
  process.stderr.write(`[build-cascade] WARNING: cascade incomplete. Missing:\n`);
  for (const m of state.missing) process.stderr.write(`  - ${m}\n`);
  return 8;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Best-effort recursive size — used for reporting only, never for correctness. */
function estimateDirSize(dir) {
  if (!existsSync(dir)) return 0;
  try {
    let total = 0;
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else {
          try { total += statSync(p).size; } catch { /* skip */ }
        }
      }
    };
    walk(dir);
    return total;
  } catch {
    return 0;
  }
}

main(process.argv.slice(2))
  .then(code => process.exit(code))
  .catch(err => {
    process.stderr.write(`[build-cascade] Fatal: ${err.message}\n`);
    process.exit(99);
  });
