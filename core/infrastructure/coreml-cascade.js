/**
 * CoreML Variant Cascade — management for the M3+ CoreML inference cascade.
 *
 * This module is the single source of truth for:
 *   - Loading the cascade shape set from coreml-cascade.json
 *   - Whether the cascade is applicable to the current hardware
 *   - Where the cascade artifacts live on disk (managed cache root)
 *   - What's currently present vs missing
 *   - A programmatic entry point for building the cascade locally
 *
 * Consumers:
 *   - scripts/init.js                → detects capability, resolves state,
 *                                      records diagnostics in .sweet-search/config.json
 *   - scripts/uninstall.js           → cleans the cascade cache dir
 *   - core/infrastructure/native-inference.js
 *                                    → resolves cascade dirs and passes them
 *                                      to NativeEmbeddingModel.load /
 *                                      NativeLateInteractionModel.load
 *   - scripts/build-coreml-cascade.js
 *                                    → local build entrypoint that traces
 *                                      the cascade in-place under the
 *                                      managed cache root
 *
 * Design invariants (Codex will check these):
 *
 *   (A) Cascade is ALWAYS optional. Absence of cache, absence of hardware
 *       support, and absence of the whole module must NEVER fail init.
 *       The candle path is the unconditional fallback.
 *
 *   (B) Capability is never decided here. Hardware detection lives in
 *       hardware-capability.js; this module only consumes that decision.
 *
 *   (C) Cache root always lives under MODEL_DELIVERY_CONFIG.modelCacheRoot
 *       so enterprise mirrors (SWEET_SEARCH_MODEL_CACHE), init, and
 *       uninstall all see the same path.
 *
 *   (D) Filename format matches the Rust parser in
 *       crates/sweet-search-native/src/inference/{embedding_model,li_model}.rs
 *       (parse_embed_variant_filename / parse_li_variant_filename). The
 *       format string lives in coreml-cascade.json and is formatted here.
 *       A mismatch would cause the Rust side to silently ignore the
 *       cascade and fall through to candle.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, renameSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL_DELIVERY_CONFIG } from './config/index.js';
import { detectHardwareCapability } from './hardware-capability.js';
import { fetchModelFile } from './model-fetcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CASCADE_SPEC_PATH = join(__dirname, 'coreml-cascade.json');

let _spec = null;

/**
 * Load and cache the shape set JSON. Throws if the JSON is missing or
 * malformed — that's always a packaging bug, never a runtime concern,
 * so fail loud rather than silently degrading.
 */
export function getCascadeSpec() {
  if (_spec) return _spec;
  const raw = readFileSync(CASCADE_SPEC_PATH, 'utf-8');
  _spec = JSON.parse(raw);
  return _spec;
}

/**
 * Managed cache root for all CoreML cascade artifacts on this machine.
 *
 * Layout:
 *   {modelCacheRoot}/coreml-cascade/
 *     embed/                             ← six .mlpackage dirs
 *       nomic_bert_b64_s96_fp16.mlpackage/
 *       nomic_bert_b64_s192_fp16.mlpackage/
 *       ...
 *     li/                                ← six .mlpackage dirs
 *       li_modernbert_b128_s48_fp16.mlpackage/
 *       ...
 *
 * Sibling .mlmodelc compiled caches live next to each .mlpackage,
 * managed by coreml_shim.m. `getAllCoremlPaths()` returns them so
 * uninstall can clean everything.
 */
export function getCoremlCascadeRoot() {
  return join(MODEL_DELIVERY_CONFIG.modelCacheRoot, 'coreml-cascade');
}

/** Subdirectory holding embedding variants. */
export function getCoremlEmbedDir() {
  return join(getCoremlCascadeRoot(), 'embed');
}

/** Subdirectory holding LI variants. */
export function getCoremlLiDir() {
  return join(getCoremlCascadeRoot(), 'li');
}

/**
 * Format a variant filename from the pattern in coreml-cascade.json.
 * `{batch}` → batch, `{seq}` → seq. Kept in lockstep with the Rust parser.
 */
export function formatVariantFilename(pattern, batch, seq) {
  return pattern
    .replace('{batch}', String(batch))
    .replace('{seq}', String(seq));
}

/**
 * True if the current hardware benefits from the cascade.
 *
 * Consumers that need the full reasoning (e.g., init for the status line)
 * should call `detectHardwareCapability()` directly and read
 * `coremlCascadeReason`.
 */
export function isCoremlCascadeApplicable() {
  return detectHardwareCapability().coremlCascadeEligible;
}

/**
 * Sanity-check a `.mlpackage` directory on disk.
 *
 * An mlprogram `.mlpackage` is valid iff:
 *   - it exists and is a directory
 *   - it has a Manifest.json at the root (present in every mlprogram bundle)
 *   - it has a Data/ subdirectory
 *   - Data/ has at least one file (not an empty dir from a failed unpack)
 *
 * This matches what `coreml_shim.m::sweet_coreml_load` needs to load
 * successfully — anything less would compile-fail at load time.
 */
export function isValidMlpackage(path) {
  try {
    if (!existsSync(path)) return false;
    const s = statSync(path);
    if (!s.isDirectory()) return false;
    if (!existsSync(join(path, 'Manifest.json'))) return false;
    const dataDir = join(path, 'Data');
    if (!existsSync(dataDir)) return false;
    if (!statSync(dataDir).isDirectory()) return false;
    const entries = readdirSync(dataDir);
    if (entries.length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Enumerate every expected variant path for the current spec.
 *
 * Returns two lists:
 *   embedPaths: [{ batch, seq, filename, fullPath }, ...]
 *   liPaths:    [{ batch, seq, filename, fullPath }, ...]
 */
export function getExpectedVariantPaths() {
  const spec = getCascadeSpec();
  const embedDir = getCoremlEmbedDir();
  const liDir = getCoremlLiDir();

  const embedPaths = spec.embed.variants.map(v => {
    const filename = formatVariantFilename(spec.embed.filePattern, v.batch, v.seq);
    return { batch: v.batch, seq: v.seq, filename, fullPath: join(embedDir, filename) };
  });
  const liPaths = spec.li.variants.map(v => {
    const filename = formatVariantFilename(spec.li.filePattern, v.batch, v.seq);
    return { batch: v.batch, seq: v.seq, filename, fullPath: join(liDir, filename) };
  });

  return { embedPaths, liPaths };
}

/**
 * Inspect the cascade cache and report what's present, missing, and
 * applicable. Pure read — never writes, never fetches, never builds.
 *
 * Use `getCoremlCascadeResolvedDirs()` when you only need the
 * (embedDir, liDir) pair for native-inference.js to pass to the addon.
 *
 * @returns {{
 *   applicable: boolean,
 *   reason: string,
 *   root: string,
 *   embedDir: string,
 *   liDir: string,
 *   embedPresent: number,
 *   embedTotal: number,
 *   liPresent: number,
 *   liTotal: number,
 *   complete: boolean,
 *   missing: string[],
 * }}
 */
export function getCoremlCascadeState() {
  const hw = detectHardwareCapability();
  const root = getCoremlCascadeRoot();
  const embedDir = getCoremlEmbedDir();
  const liDir = getCoremlLiDir();
  const { embedPaths, liPaths } = getExpectedVariantPaths();

  const missing = [];
  let embedPresent = 0;
  for (const v of embedPaths) {
    if (isValidMlpackage(v.fullPath)) embedPresent++;
    else missing.push(`embed/${v.filename}`);
  }
  let liPresent = 0;
  for (const v of liPaths) {
    if (isValidMlpackage(v.fullPath)) liPresent++;
    else missing.push(`li/${v.filename}`);
  }

  const embedTotal = embedPaths.length;
  const liTotal = liPaths.length;
  const complete = embedPresent === embedTotal && liPresent === liTotal;

  return {
    applicable: hw.coremlCascadeEligible,
    reason: hw.coremlCascadeReason,
    root,
    embedDir,
    liDir,
    embedPresent,
    embedTotal,
    liPresent,
    liTotal,
    complete,
    missing,
  };
}

/**
 * Return the (embedDir, liDir) pair that native-inference.js passes to
 * the Rust addon, OR null values when the cascade should not be
 * dispatched (hardware ineligible or artifacts missing).
 *
 * This is the one function that controls whether the addon's CoreML
 * path is armed. Any caller that wants to force-disable the cascade
 * (tests, benchmarks, diagnostic runs) should pass
 * `SWEET_SEARCH_COREML_CASCADE=0` — see the env-var check below.
 *
 * @returns {{ embedDir: string | null, liDir: string | null, status: string }}
 */
export function getCoremlCascadeResolvedDirs() {
  const rawFlag = (process.env.SWEET_SEARCH_COREML_CASCADE ?? '').trim().toLowerCase();
  if (rawFlag === '0' || rawFlag === 'false' || rawFlag === 'off') {
    return { embedDir: null, liDir: null, status: 'disabled-by-env' };
  }

  const state = getCoremlCascadeState();
  if (!state.applicable) {
    return { embedDir: null, liDir: null, status: 'hardware-ineligible' };
  }
  if (state.embedPresent === 0 && state.liPresent === 0) {
    return { embedDir: null, liDir: null, status: 'not-installed' };
  }

  // Partial cascade: arm only the side that's complete. The Rust addon's
  // parity check runs on the smallest-batch variant of each side
  // independently, so an incomplete embed cascade doesn't block LI from
  // dispatching through its own variants. Any call that picks a missing
  // variant falls through to candle via `pick() → None`.
  const embedDir = state.embedPresent > 0 ? state.embedDir : null;
  const liDir = state.liPresent > 0 ? state.liDir : null;

  let status;
  if (state.complete) {
    status = 'present';
  } else if (embedDir && liDir) {
    status = 'partial';
  } else if (embedDir) {
    status = 'partial-embed-only';
  } else {
    status = 'partial-li-only';
  }

  return { embedDir, liDir, status };
}

/**
 * Build a compact report used by `sweet-search init` to print a one-line
 * status on completion and to record diagnostics in config.json.
 */
export function getCoremlCascadeReport() {
  const state = getCoremlCascadeState();
  const resolved = getCoremlCascadeResolvedDirs();

  if (resolved.status === 'disabled-by-env') {
    return {
      status: 'disabled',
      detail: 'Disabled via SWEET_SEARCH_COREML_CASCADE=0',
      applicable: state.applicable,
      reason: state.reason,
    };
  }
  if (!state.applicable) {
    return {
      status: 'not-applicable',
      detail: state.reason,
      applicable: false,
      reason: state.reason,
    };
  }
  if (state.complete) {
    return {
      status: 'present',
      detail: `${state.embedTotal + state.liTotal} variants ready (${state.embedTotal} embed + ${state.liTotal} LI)`,
      applicable: true,
      reason: state.reason,
      embedDir: state.embedDir,
      liDir: state.liDir,
    };
  }
  if (state.embedPresent === 0 && state.liPresent === 0) {
    return {
      status: 'not-built',
      detail: 'Run `node scripts/build-coreml-cascade.js` to build locally (~12 min, requires Python + coremltools)',
      applicable: true,
      reason: state.reason,
    };
  }
  return {
    status: 'partial',
    detail: `${state.embedPresent}/${state.embedTotal} embed + ${state.liPresent}/${state.liTotal} LI present — rebuild with \`node scripts/build-coreml-cascade.js\``,
    applicable: true,
    reason: state.reason,
    embedDir: state.embedPresent > 0 ? state.embedDir : null,
    liDir: state.liPresent > 0 ? state.liDir : null,
    missing: state.missing,
  };
}

/**
 * Return every path the uninstall command should remove when clearing
 * the cascade — includes the managed cache root AND any sibling
 * `.mlmodelc` compiled caches that coreml_shim.m wrote next to the
 * `.mlpackage` files.
 *
 * We don't rm the top-level modelCacheRoot/coreml-cascade/ directory
 * here — uninstall.js rm -rf's that on its own once we tell it the
 * path. This function exists so uninstall can preview sizes *before*
 * deletion.
 */
export function getAllCoremlCachePaths() {
  const root = getCoremlCascadeRoot();
  return [root]; // rm -rf root cleans sibling .mlmodelc directories too
}

// ───────────────────────────────────────────────────────────────────
// HuggingFace fetch + extract path
// ───────────────────────────────────────────────────────────────────
//
// The cascade ships as per-variant .tar.gz archives from the HF repo
// named in coreml-cascade.json's `hfRepo` field. `sweet-search init`
// calls `fetchCoremlCascade()` after the regular model fetch loop on
// eligible hardware; each missing variant is downloaded, verified,
// and atomically extracted into the managed cache.
//
// Shipping design (see docs/INIT_STRATEGY.md "CoreML variant cascade"):
//   1. The release build machine (or a developer with M3+ hardware)
//      runs scripts/build-coreml-cascade.js once, which traces the
//      12 variants to the managed cache, tars each, computes SHA256,
//      uploads the tarballs to `hfRepo`, and backfills the
//      `tarballSha256` + `tarballSizeBytes` fields in this JSON.
//   2. End-user machines running `sweet-search init` hit the HF fetch
//      path below — no Python dependency, same tooling as the other
//      models, verified by checksum.
//
// Invariants:
//   - Never blocks init. Any download/extract failure is reported
//     but returns normally with a `failures` list. The candle path
//     is unaffected.
//   - Atomic extract — tarball is downloaded to an OS tempdir,
//     extracted into a staging dir, and the resulting .mlpackage
//     is moved into place with `renameSync`. An interrupted run
//     never leaves a half-extracted .mlpackage in the managed cache.
//   - Skips variants that are already installed (via `isValidMlpackage`)
//     so re-running init after a partial cascade fetch resumes
//     cleanly.
//   - Silently skips fetch when `tarballSha256` is null/missing in
//     the JSON spec — that means the release build machine hasn't
//     backfilled checksums yet. On such a state we log a clear
//     one-line note and fall back to candle, matching the pre-HF
//     local-build-only behavior.

/**
 * Resolve the HF tarball filename for a given variant. Matches the
 * `tarballPattern` field in coreml-cascade.json.
 */
export function formatVariantTarballPath(pattern, batch, seq) {
  return pattern
    .replace('{batch}', String(batch))
    .replace('{seq}', String(seq));
}

/**
 * Extract a .mlpackage from a downloaded tarball into an explicit
 * target directory. Uses the system `tar` command because Node has
 * no built-in tar support and we don't want to add a new npm dep
 * just for this one extraction site.
 *
 * Atomicity: the extract runs into a staging directory next to the
 * final target, and the resulting top-level `.mlpackage` directory
 * is moved into place with `renameSync` (atomic on the same
 * filesystem). If the move fails because the target already exists
 * (concurrent init race), the staging directory is cleaned up and
 * the existing target is kept.
 *
 * @param {string} tarballPath    - Downloaded tarball on disk
 * @param {string} extractTarget  - Final path, e.g. `{cascadeRoot}/embed/nomic_bert_b64_s96_fp16.mlpackage`
 */
function extractVariantTarball(tarballPath, extractTarget) {
  const parentDir = dirname(extractTarget);
  mkdirSync(parentDir, { recursive: true });

  // Stage next to the target (same filesystem → atomic rename).
  // Unique per-process to survive concurrent init runs.
  const stagingDir = `${extractTarget}.staging-${process.pid}-${Date.now()}`;
  mkdirSync(stagingDir, { recursive: true });

  try {
    const tarResult = spawnSync('tar', ['-xzf', tarballPath, '-C', stagingDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (tarResult.status !== 0) {
      const stderr = tarResult.stderr?.toString() || '';
      throw new Error(`tar -xzf failed with status ${tarResult.status}: ${stderr.trim()}`);
    }

    // Each tarball should contain exactly one top-level directory
    // (the `.mlpackage`). Anything else is a malformed tarball.
    const entries = readdirSync(stagingDir);
    if (entries.length !== 1) {
      throw new Error(`expected exactly one top-level entry in tarball, got ${entries.length}: [${entries.join(', ')}]`);
    }
    const extractedRoot = join(stagingDir, entries[0]);
    if (!statSync(extractedRoot).isDirectory()) {
      throw new Error(`tarball top-level entry is not a directory: ${entries[0]}`);
    }

    // If a previous run left a target behind (e.g., a corrupted
    // extract from a crashed previous init), remove it. There's a
    // tiny race here with another concurrent init: if process A
    // removes and process B moves into place first, A's subsequent
    // move errors and we leak the staging dir. That's handled by
    // the outer try/finally. Net effect: exactly one winner, no
    // corruption, duplicate compile cost paid on the loser.
    if (existsSync(extractTarget)) {
      rmSync(extractTarget, { recursive: true, force: true });
    }
    renameSync(extractedRoot, extractTarget);
  } finally {
    if (existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }
}

/**
 * Download + verify + extract one cascade variant. Called from
 * `fetchCoremlCascade` per missing variant. All state lives under
 * the OS tempdir during the fetch window; only the final
 * `.mlpackage` directory survives into the managed cache.
 *
 * @param {object} params
 * @param {string} params.hfRepo          - HF repo id, e.g. `mrsladoje/sweet-search-coreml-cascade`
 * @param {string} params.tarballPath     - Path inside the HF repo, e.g. `embed/nomic_bert_b64_s96_fp16.mlpackage.tar.gz`
 * @param {string} params.expectedSha256  - Tarball SHA256 from coreml-cascade.json
 * @param {number} params.expectedSize    - Tarball size in bytes from coreml-cascade.json
 * @param {string} params.extractTarget   - Final .mlpackage path in the managed cache
 * @param {(downloaded: number, total: number) => void} [params.onProgress]
 */
async function fetchAndExtractCascadeVariant({
  hfRepo,
  tarballPath,
  expectedSha256,
  expectedSize,
  extractTarget,
  onProgress,
}) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'ss-cascade-'));
  try {
    // fetchModelFile already implements atomic downloads, checksum
    // verification, retries, and resumability. Point it at our
    // tempdir so the tarball is isolated from other cache state.
    const downloadedTarball = await fetchModelFile(hfRepo, tarballPath, tmpRoot, {
      sha256: expectedSha256,
      expectedSize,
      onProgress,
    });

    extractVariantTarball(downloadedTarball, extractTarget);
  } finally {
    // Remove the tempdir unconditionally — tarballs are intermediate
    // artifacts, we don't keep them after extraction.
    if (existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

/**
 * Fetch the CoreML cascade from the HF repo named in
 * `coreml-cascade.json::hfRepo` and install the variants into the
 * managed cache. Skips variants that are already present.
 *
 * This is the primary end-user delivery path (`sweet-search init`
 * calls it on M3+ Apple Silicon after the regular model fetch loop).
 * Local builds via `scripts/build-coreml-cascade.js` remain supported
 * as a developer path and for machines where HF fetch is unavailable.
 *
 * Never throws. Any failure is captured in the returned `failures`
 * array so the caller can log without aborting init.
 *
 * @param {object} [options]
 * @param {boolean} [options.force]       - Re-download even if the target already exists
 * @param {(variant: string, downloaded: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{
 *   status: string,
 *   fetched: number,
 *   cached: number,
 *   skipped: number,
 *   failures: Array<{ variant: string, error: string }>,
 *   reason?: string,
 * }>}
 */
export async function fetchCoremlCascade(options = {}) {
  const hw = detectHardwareCapability();
  if (!hw.coremlCascadeEligible) {
    return {
      status: 'skipped',
      fetched: 0,
      cached: 0,
      skipped: 12,
      failures: [],
      reason: hw.coremlCascadeReason,
    };
  }

  // Respect the same env opt-out used for dispatch. A user who sets
  // SWEET_SEARCH_COREML_CASCADE=0 clearly doesn't want the cascade —
  // don't download it at init time either.
  const rawFlag = (process.env.SWEET_SEARCH_COREML_CASCADE ?? '').trim().toLowerCase();
  if (rawFlag === '0' || rawFlag === 'false' || rawFlag === 'off') {
    return {
      status: 'skipped',
      fetched: 0,
      cached: 0,
      skipped: 12,
      failures: [],
      reason: 'Disabled via SWEET_SEARCH_COREML_CASCADE=0',
    };
  }

  const spec = getCascadeSpec();
  if (!spec.hfRepo) {
    return {
      status: 'not-configured',
      fetched: 0,
      cached: 0,
      skipped: 12,
      failures: [],
      reason: 'coreml-cascade.json has no hfRepo field',
    };
  }

  const { embedPaths, liPaths } = getExpectedVariantPaths();
  const all = [
    ...embedPaths.map(p => ({ ...p, category: 'embed', categorySpec: spec.embed })),
    ...liPaths.map(p => ({ ...p, category: 'li', categorySpec: spec.li })),
  ];

  let fetched = 0;
  let cached = 0;
  let skipped = 0;
  const failures = [];

  for (const v of all) {
    // Already installed — just account for it.
    if (!options.force && isValidMlpackage(v.fullPath)) {
      cached++;
      continue;
    }

    // Find this variant's tarball metadata in the spec.
    const variantSpec = v.categorySpec.variants.find(
      s => s.batch === v.batch && s.seq === v.seq,
    );
    if (!variantSpec) {
      failures.push({ variant: `${v.category}/${v.filename}`, error: 'not in spec.variants' });
      continue;
    }

    // No checksum backfilled yet means the release machine hasn't
    // published this variant. Skip silently (the cascade as a whole
    // falls back to candle — no regression).
    if (!variantSpec.tarballSha256 || !variantSpec.tarballSizeBytes) {
      skipped++;
      continue;
    }

    const tarballPath = formatVariantTarballPath(
      v.categorySpec.tarballPattern,
      v.batch,
      v.seq,
    );

    try {
      await fetchAndExtractCascadeVariant({
        hfRepo: spec.hfRepo,
        tarballPath,
        expectedSha256: variantSpec.tarballSha256,
        expectedSize: variantSpec.tarballSizeBytes,
        extractTarget: v.fullPath,
        onProgress: options.onProgress
          ? (d, t) => options.onProgress(`${v.category}/${v.filename}`, d, t)
          : undefined,
      });
      fetched++;
    } catch (err) {
      failures.push({
        variant: `${v.category}/${v.filename}`,
        error: err.message || String(err),
      });
    }
  }

  let status;
  if (failures.length > 0) {
    status = fetched > 0 || cached > 0 ? 'partial' : 'failed';
  } else if (skipped > 0 && fetched === 0 && cached === 0) {
    status = 'not-published';
  } else if (fetched === 0 && cached > 0) {
    status = 'cached';
  } else {
    status = 'fetched';
  }

  return { status, fetched, cached, skipped, failures };
}
