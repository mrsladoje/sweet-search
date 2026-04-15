/**
 * Model Fetcher — robust model file downloader with checksums, resumability,
 * atomic writes, retries, and progress reporting.
 *
 * Replaces the bare fetch→writeFileSync in late-interaction-model.js.
 */

import { createHash } from 'crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { MODEL_DELIVERY_CONFIG } from './config/index.js';
import { getModelEntry } from './model-registry.js';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

// =============================================================================
// VERIFICATION CACHE (H6 — avoid N-worker SHA256 stall)
// =============================================================================
//
// Without this cache, every worker_thread that calls `fetchModel(...)` for
// the same ~600 MB safetensors file independently runs its own SHA256 stream
// over the bytes. Node's microtask scheduler is unfair under ORT load, so
// several concurrent verifications can stall for minutes.
//
// Two-layer cache:
//   1. In-process Map<absPath, {mtimeMs,size,dev,ino,sha256,verifiedAt}>
//      — skips repeat verifications within the same worker.
//   2. Disk sidecar `{filePath}.verified.json` — lets a DIFFERENT worker
//      (separate V8 isolate, separate Map) short-circuit on next load
//      without re-streaming. The sidecar is invalidated on any stat mismatch.
//
// TRUST MODEL — READ BEFORE CHANGING ANY OF THIS:
//
// This is a MEMOIZATION OPTIMIZATION, NOT a cryptographic trust anchor. The
// cache remembers a prior successful SHA256 stream, and returns it when the
// file "looks the same" by a stat-fingerprint: (size, mtimeMs, dev, ino).
// Adding (dev, ino) raises the bar for a local same-user attacker who
// replaces the file via `unlink + write` — the new file gets a fresh inode
// and `stat.ino !== sidecar.ino` triggers a re-hash (2026-04-15 hardening).
// On an in-place overwrite that preserves (size, ino, mtimeMs) — which a
// determined local attacker can forge — the memoized hash is trusted.
//
// This is an acceptable trade-off ONLY because:
//   (a) the H6 speedup (~2 min → ~1 s under worker-pool contention) is real;
//   (b) a local same-user attacker who controls the model cache dir has
//       already cleared a significant bar on a developer workstation;
//   (c) the trust anchor for model bytes remains the registry SHA256 in
//       `core/infrastructure/model-registry.js` (code, reviewed via git),
//       which is what gets written as `record.sha256` when we first hash.
//
// Defense-in-depth follow-ups under consideration (not yet implemented):
//   - HMAC the sidecar with a per-install secret in `.sweet-search/install-secret`
//   - Re-verify in the Rust loader before mmap (defense-in-depth across the
//     JS→Rust boundary)
//
// Mandatory invariants — any change that weakens these regresses security:
//   1. The cache NEVER skips verification against a NEW expected hash. A
//      caller supplying `expectedSha256 = X` gets a fresh stream unless the
//      cache already holds a positive record for X.
//   2. The in-process Map is invalidated on every explicit `fetchModelFile`
//      atomic rename (see `invalidateVerifiedSidecar` before the rename).
//   3. A positive record is written ONLY after a successful streaming hash.
//      `recordVerified` is never called without a prior `computeFileHash`
//      that matched `expectedSha256`.

const _verificationMemCache = new Map();

function verifiedSidecarPath(filePath) {
  return filePath + '.verified.json';
}

function readVerifiedSidecar(filePath) {
  const sidecarPath = verifiedSidecarPath(filePath);
  if (!existsSync(sidecarPath)) return null;
  try {
    const raw = readFileSync(sidecarPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeVerifiedSidecar(filePath, record) {
  try {
    writeFileSync(verifiedSidecarPath(filePath), JSON.stringify(record));
  } catch {
    // Best-effort — a failed sidecar write just means the next run re-verifies.
  }
}

function invalidateVerifiedSidecar(filePath) {
  try {
    unlinkSync(verifiedSidecarPath(filePath));
  } catch (err) {
    if (err && err.code !== 'ENOENT') { /* ignore */ }
  }
  _verificationMemCache.delete(filePath);
}

/**
 * Check if the cached stat-fingerprint matches the live file.
 *
 * The fingerprint is `(size, mtimeMs, dev, ino)`. Adding `(dev, ino)` to the
 * original `(size, mtime)` pair raises the bar for local same-user file
 * replacement: an attacker who does `unlink + write` to plant a forged file
 * while reusing a matching `verified.json` sidecar gets a FRESH inode on
 * the new file, so `stat.ino !== record.ino` triggers a re-hash. This is
 * not cryptographic protection, but it turns a common forgery pattern from
 * a silent bypass into a logged re-verification.
 *
 * Records from older sidecars that lack dev/ino (written before this
 * hardening landed) still validate on (size, mtime) alone — this is
 * necessary for backwards compatibility with existing caches.
 */
function stableStatFingerprint(stat) {
  return { size: stat.size, mtimeMs: stat.mtimeMs, dev: stat.dev, ino: stat.ino };
}

function fingerprintMatches(record, stat) {
  if (record.size !== stat.size) return false;
  if (record.mtimeMs !== stat.mtimeMs) return false;
  // dev / ino are optional on legacy sidecars. When the record carries them,
  // require a match; when it doesn't, accept on (size, mtime) alone so we
  // don't force a re-hash on every existing cache entry.
  if (record.dev != null && record.dev !== stat.dev) return false;
  if (record.ino != null && record.ino !== stat.ino) return false;
  return true;
}

/**
 * Check the verification cache for a file. Returns true iff the file's
 * current stat-fingerprint matches a cached record AND the cached
 * record's sha256 matches `expectedSha256`. Checks the in-process map
 * first, falls back to the on-disk sidecar.
 */
function isVerified(filePath, expectedSha256) {
  if (!expectedSha256) return false;
  let stat;
  try { stat = statSync(filePath); } catch { return false; }

  const memRecord = _verificationMemCache.get(filePath);
  if (memRecord && memRecord.sha256 === expectedSha256 && fingerprintMatches(memRecord, stat)) {
    return true;
  }

  const diskRecord = readVerifiedSidecar(filePath);
  if (diskRecord && diskRecord.sha256 === expectedSha256 && fingerprintMatches(diskRecord, stat)) {
    _verificationMemCache.set(filePath, diskRecord);
    return true;
  }

  return false;
}

function recordVerified(filePath, sha256) {
  let stat;
  try { stat = statSync(filePath); } catch { return; }
  const record = {
    sha256,
    ...stableStatFingerprint(stat),
    verifiedAt: Date.now(),
  };
  _verificationMemCache.set(filePath, record);
  writeVerifiedSidecar(filePath, record);
}

/**
 * Get the managed cache directory for a HuggingFace model.
 */
export function getModelCacheDir(hfId) {
  const normalized = hfId.replace('/', '--');
  const dir = join(MODEL_DELIVERY_CONFIG.modelCacheRoot, normalized);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Compute SHA256 of a local file.
 */
export async function computeFileHash(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Check if a cached file is valid (exists, correct size, correct checksum if known).
 *
 * Short-circuits via the verification cache when possible: if a previous
 * call to this function (in this process OR a prior one) verified the same
 * (path, mtime, size, sha256) tuple and the stat hasn't changed, we skip
 * the expensive streaming hash. This is the H6 fix — without it, N embedding
 * workers each independently re-hash the 596 MB safetensors file.
 */
export async function isCacheValid(filePath, expectedSize, expectedSha256) {
  if (!existsSync(filePath)) return false;

  const stat = statSync(filePath);
  if (stat.size === 0) return false;
  if (expectedSize && stat.size !== expectedSize) return false;

  if (expectedSha256) {
    if (isVerified(filePath, expectedSha256)) {
      return true;
    }
    const hash = await computeFileHash(filePath);
    if (hash !== expectedSha256) {
      invalidateVerifiedSidecar(filePath);
      return false;
    }
    recordVerified(filePath, hash);
  }

  return true;
}

/**
 * Download a single file from HuggingFace with retries, resumability, and atomic writes.
 *
 * @param {string} hfId - HuggingFace model ID (e.g. 'lightonai/LateOn-Code')
 * @param {string} filePath - File path within the model repo (e.g. 'model_int8.onnx')
 * @param {string} destDir - Local directory to save into
 * @param {object} options
 * @param {string} [options.sha256] - Expected SHA256 checksum
 * @param {number} [options.expectedSize] - Expected file size in bytes
 * @param {string} [options.hfEndpoint] - HuggingFace endpoint override
 * @param {function} [options.onProgress] - Progress callback(downloadedBytes, totalBytes)
 * @param {AbortSignal} [options.signal] - Abort signal
 * @returns {string} Absolute path to the verified local file
 */
export async function fetchModelFile(hfId, filePath, destDir, options = {}) {
  const { sha256, expectedSize, onProgress, signal } = options;
  const hfEndpoint = options.hfEndpoint || MODEL_DELIVERY_CONFIG.hfEndpoint;

  // Preserve directory structure (e.g. onnx/model.onnx stays as onnx/model.onnx)
  const finalPath = join(destDir, filePath);
  mkdirSync(join(finalPath, '..'), { recursive: true });
  const tmpPath = finalPath + '.tmp';

  // Check existing cache
  if (await isCacheValid(finalPath, expectedSize, sha256)) {
    return finalPath;
  }

  // Check if runtime download is allowed
  if (!MODEL_DELIVERY_CONFIG.allowRuntimeModelDownload) {
    throw new Error(
      `[ModelFetcher] Model file not found: ${hfId}/${filePath}\n` +
      `  Expected at: ${finalPath}\n` +
      `  Runtime model downloads are disabled.\n` +
      `  Run \`sweet-search init\` to download required models.`
    );
  }

  const url = `${hfEndpoint}/${hfId}/resolve/main/${filePath}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Check for partial download (resumability)
      let startByte = 0;
      if (existsSync(tmpPath)) {
        startByte = statSync(tmpPath).size;
      }

      const headers = {};
      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`;
      }

      const resp = await fetch(url, { headers, signal });

      if (resp.status === 416) {
        // Range not satisfiable — file changed on server, restart
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
        startByte = 0;
        continue;
      }

      if (!resp.ok && resp.status !== 206) {
        throw new Error(`HTTP ${resp.status} downloading ${url}`);
      }

      const totalSize = expectedSize || parseInt(resp.headers.get('content-length') || '0', 10) + startByte;
      const isResume = resp.status === 206;

      process.stderr.write(`[ModelFetcher] ${isResume ? 'Resuming' : 'Downloading'} ${filePath} from ${hfId}...`);

      const writeStream = createWriteStream(tmpPath, { flags: isResume ? 'a' : 'w' });
      const reader = resp.body.getReader();
      let downloaded = startByte;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writeStream.write(Buffer.from(value));
        downloaded += value.byteLength;
        if (onProgress) onProgress(downloaded, totalSize);
      }

      writeStream.end();
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      const downloadedSize = statSync(tmpPath).size;
      const sizeMB = (downloadedSize / 1024 / 1024).toFixed(1);
      process.stderr.write(` ${sizeMB} MB\n`);

      // Verify size
      if (expectedSize && downloadedSize !== expectedSize) {
        unlinkSync(tmpPath);
        throw new Error(`Size mismatch: expected ${expectedSize} bytes, got ${downloadedSize}`);
      }

      // Verify checksum
      if (sha256) {
        process.stderr.write(`[ModelFetcher] Verifying checksum...`);
        const hash = await computeFileHash(tmpPath);
        if (hash !== sha256) {
          unlinkSync(tmpPath);
          throw new Error(`Checksum mismatch for ${filePath}: expected ${sha256}, got ${hash}`);
        }
        process.stderr.write(` OK\n`);
      }

      // Atomic rename — a fresh file overwrites the verification sidecar's
      // mtime/size assumptions, so drop the cache before we record a new one.
      invalidateVerifiedSidecar(finalPath);
      renameSync(tmpPath, finalPath);
      if (sha256) {
        recordVerified(finalPath, sha256);
      }
      return finalPath;

    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        process.stderr.write(`\n[ModelFetcher] Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...\n`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        // Clean up tmp on final failure
        if (existsSync(tmpPath)) unlinkSync(tmpPath);
        throw new Error(`[ModelFetcher] Failed to download ${hfId}/${filePath} after ${MAX_RETRIES} attempts: ${err.message}`);
      }
    }
  }
}

/**
 * Download all files for a registered model.
 *
 * @param {string} registryKey - Key in MODEL_REGISTRY
 * @param {object} [options] - Options passed to fetchModelFile
 * @returns {{ files: Map<string, string>, cached: number, downloaded: number }}
 */
export async function fetchModel(registryKey, options = {}) {
  const entry = getModelEntry(registryKey);
  if (!entry) throw new Error(`[ModelFetcher] Unknown model: ${registryKey}`);

  const destDir = getModelCacheDir(entry.hfId);
  const files = new Map();
  let cached = 0;
  let downloaded = 0;

  for (const file of entry.files) {
    const finalPath = join(destDir, file.path);

    const wasPresent = await isCacheValid(finalPath, file.sizeBytes, file.sha256);

    const resultPath = await fetchModelFile(entry.hfId, file.path, destDir, {
      sha256: file.sha256,
      expectedSize: file.sizeBytes,
      ...options,
    });

    files.set(file.path, resultPath);
    if (wasPresent) cached++;
    else downloaded++;
  }

  return { files, cached, downloaded };
}

/**
 * Resolve the local cache path for a model file. Returns null if not cached or invalid.
 */
export async function resolveModelFile(hfId, filePath, expectedSize, expectedSha256) {
  const destDir = getModelCacheDir(hfId);
  const finalPath = join(destDir, filePath);

  if (await isCacheValid(finalPath, expectedSize, expectedSha256)) {
    return finalPath;
  }
  return null;
}
