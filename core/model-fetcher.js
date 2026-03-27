/**
 * Model Fetcher — robust model file downloader with checksums, resumability,
 * atomic writes, retries, and progress reporting.
 *
 * Replaces the bare fetch→writeFileSync in late-interaction-model.js.
 */

import { createHash } from 'crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { MODEL_DELIVERY_CONFIG } from './config.js';
import { getModelEntry } from './model-registry.js';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

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
 */
export async function isCacheValid(filePath, expectedSize, expectedSha256) {
  if (!existsSync(filePath)) return false;

  const stat = statSync(filePath);
  if (stat.size === 0) return false;
  if (expectedSize && stat.size !== expectedSize) return false;

  if (expectedSha256) {
    const hash = await computeFileHash(filePath);
    if (hash !== expectedSha256) return false;
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

      // Atomic rename
      renameSync(tmpPath, finalPath);
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
