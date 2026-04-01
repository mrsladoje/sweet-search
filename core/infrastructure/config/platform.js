/**
 * Platform Configuration — PROJECT_ROOT, DB_PATHS, platform detection, logging.
 * Split from core/config.js during DDD migration.
 */

import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveProjectRoot() {
  const fromEnv = process.env.SWEET_SEARCH_PROJECT_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  // Walk up from cwd looking for .git or package.json to find the real
  // project root, so that running from a subdirectory still finds the
  // .sweet-search/ data dir and init config.
  let dir = process.cwd();
  while (true) {
    if (existsSync(path.join(dir, '.git')) || existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  // Fallback to cwd if no project marker found
  return process.cwd();
}

// Project root detection
export const PROJECT_ROOT = resolveProjectRoot();

// =============================================================================
// ENVIRONMENT & API KEYS
// =============================================================================

// Load .env file if exists (check both local and project root)
try {
  const { existsSync, readFileSync } = await import('fs');

  // Priority 1: Local .env (in sweet-search directory)
  // __dirname is now core/infrastructure/config/, so go up 3 levels
  const localEnvPath = path.join(__dirname, '..', '..', '..', '.env');
  // Priority 2: Project root .env
  const projectEnvPath = path.join(PROJECT_ROOT, '.env');

  const dotenvPath = existsSync(localEnvPath) ? localEnvPath : projectEnvPath;

  if (existsSync(dotenvPath)) {
    const envContent = readFileSync(dotenvPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=]+)=["']?([^"'\n]+)["']?$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }
} catch (e) { /* .env loading is optional */ }

// =============================================================================
// DATABASE PATHS
// =============================================================================

// Data directory: SWEET_SEARCH_DATA_DIR env or default .sweet-search
const DATA_DIR_NAME = (() => {
  if (process.env.SWEET_SEARCH_DATA_DIR) {
    return process.env.SWEET_SEARCH_DATA_DIR;
  }
  return '.sweet-search';
})();

export const DB_PATHS = {
  // Main codebase vectors
  codebase: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase.db'),

  // Code graph (entities + relationships + FTS5 + summaries)
  codeGraph: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'code-graph.db'),

  // HNSW index (in-memory at query time)
  hnswIndex: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-hnsw.idx'),

  // Binary HNSW index (32x smaller, Hamming distance)
  binaryHnswIndex: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-binary-hnsw.idx'),

  // Int8 vectors for rescore stage
  // DEPRECATED: This SQLite DB path is no longer used. Int8 vectors are stored in
  // .int8.json sidecar alongside binary HNSW index. See binary-hnsw-index.js.
  // Kept for backward compatibility - getArtifactStats() warns if this file exists.
  int8Vectors: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-int8.db'),

  // Late interaction token embeddings
  lateInteraction: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-late-interaction.db'),

  // Merkle state for incremental indexing
  merkle: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'merkle-state.json'),

  // Query vocabulary cache
  vocabulary: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'query-vocabulary.json'),

  // HCGS summaries cache (hierarchical code graph summaries)
  summaries: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'code-summaries.json'),

  // Translation cache
  translationCache: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'translation-cache.json'),
};

// =============================================================================
// PLATFORM DETECTION
// =============================================================================

/**
 * Platform-aware indexer defaults for local embedding.
 *
 * Apple Silicon unified memory architecture benefits from larger batch
 * sizes and immediate DB flushes. x86/WSL performs best with sequential
 * single-item batching and buffered writes.
 *
 * Override via SWEET_SEARCH_INDEXER_BATCH_SIZE / SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS.
 */
export function detectIndexerProfile(overrides) {
  const platform = overrides?.platform ?? process.platform;
  const arch = overrides?.arch ?? process.arch;
  const isWSL = overrides?.isWSL ??
    (!!process.env.WSL_DISTRO_NAME || os.release().toLowerCase().includes('microsoft'));
  const totalMemBytes = overrides?.totalMemBytes ?? os.totalmem();
  const cpuCount = overrides?.cpuCount ?? os.cpus().length;
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64' && !isWSL;

  // Default: conservative (x86/WSL-optimized)
  let batchSize = 1;
  let flushRows = 128;

  if (isAppleSilicon) {
    // Thresholds use raw bytes to avoid GiB-vs-GB mismatch with Apple's
    // marketed RAM sizes.  A "32 GB" Mac reports ~34_359_738_368 bytes;
    // we use 29 GB and 14 GB as safe lower bounds.
    if (totalMemBytes >= 29_000_000_000) {   // High-memory Apple Silicon (32 GB+)
      batchSize = 64;
      flushRows = 1;
    } else if (totalMemBytes >= 14_000_000_000) { // Mid-memory Apple Silicon (16 GB)
      batchSize = 32;
      flushRows = 8;
    } else {                                       // Low-memory Apple Silicon (8 GB)
      batchSize = 16;
      flushRows = 32;
    }
  }

  // Parallel late interaction requires enough RAM for two ONNX models
  // (~500 MB combined) and enough cores to avoid severe contention.
  // Keep the default aligned with the existing Apple Silicon-only
  // batch/flush profile; other platforms can opt in via env override.
  const parallelLI = isAppleSilicon && totalMemBytes >= 14_000_000_000 && cpuCount >= 8;

  return { batchSize, flushRows, parallelLI };
}

// =============================================================================
// MODEL DELIVERY CONFIGURATION
// =============================================================================

function envBool(name, defaultValue) {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  return defaultValue;
}

export const MODEL_DELIVERY_CONFIG = {
  // Allow models to be downloaded at runtime.
  // Priority: explicit env var > init config (.sweet-search/config.json) > default true.
  allowRuntimeModelDownload: (() => {
    // Explicit env var always wins
    if (process.env.SWEET_SEARCH_ALLOW_RUNTIME_DOWNLOAD !== undefined) {
      return envBool('SWEET_SEARCH_ALLOW_RUNTIME_DOWNLOAD', true);
    }
    // Check init config written by `sweet-search init`
    try {
      const initConfigPath = path.join(PROJECT_ROOT, DATA_DIR_NAME, 'config.json');
      if (existsSync(initConfigPath)) {
        const initConfig = JSON.parse(readFileSync(initConfigPath, 'utf-8'));
        if (initConfig.runtime?.allowRuntimeModelDownload !== undefined) {
          return initConfig.runtime.allowRuntimeModelDownload;
        }
      }
    } catch { /* init config is optional — fall through to default */ }
    return true; // backward-compatible default
  })(),

  // Managed model cache root directory
  modelCacheRoot: process.env.SWEET_SEARCH_MODEL_CACHE
    || path.join(os.homedir(), '.cache', 'sweet-search', 'models'),

  // HuggingFace endpoint (overrideable for enterprise mirrors/proxies)
  hfEndpoint: process.env.SWEET_SEARCH_HF_ENDPOINT || 'https://huggingface.co',
};

// =============================================================================
// LOGGING
// =============================================================================

// Global quiet mode flag - set by CLI tools when --quiet is passed
let _quietMode = false;

/**
 * Set quiet mode globally. When enabled:
 * - timing logs are suppressed
 * - verbose logs are suppressed
 * - Only errors and essential output are shown
 *
 * @param {boolean} enabled - Whether quiet mode should be enabled
 */
export function setQuietMode(enabled) {
  _quietMode = enabled;
}

/**
 * Check if quiet mode is currently enabled.
 * @returns {boolean} - True if quiet mode is enabled
 */
export function isQuietMode() {
  return _quietMode;
}

export const LOGGING = {
  // Verbose logging (detailed operation info)
  get verbose() {
    return !_quietMode && process.env.SEARCH_VERBOSE === 'true';
  },

  // Timing logs (performance measurements)
  // Only enabled when SEARCH_TIMING=true AND not in quiet mode
  get timing() {
    return !_quietMode && process.env.SEARCH_TIMING === 'true';
  },

  // Debug logs (developer debugging)
  get debug() {
    return process.env.SEARCH_DEBUG === 'true';
  },
};
