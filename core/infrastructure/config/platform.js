import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import { estimateComputeCores } from '../onnx-session-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveProjectRoot() {
  const fromEnv = process.env.SWEET_SEARCH_PROJECT_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const cwd = process.cwd();

  // Prefer an existing sweet-search state dir so indexed corpus subdirectories
  // do not get pulled back to an outer package root.
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.sweet-search'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
  }

  // Fallback to the historical project markers for cold-start/init flows before
  // .sweet-search/ exists.
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, '.git')) || existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
  }

  return cwd;
}

export const PROJECT_ROOT = resolveProjectRoot();

try {
  const { existsSync, readFileSync } = await import('fs');

  // __dirname is core/infrastructure/config/, so go up 3 levels
  const localEnvPath = path.join(__dirname, '..', '..', '..', '.env');
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

  // Binary HNSW index (32x smaller, Hamming distance)
  binaryHnswIndex: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-binary-hnsw.idx'),

  // Int8 vectors for rescore stage
  // DEPRECATED: This SQLite DB path is no longer used. Int8 vectors are stored in
  // .int8.json sidecar alongside binary HNSW index. See binary-hnsw-index.js.
  // Kept for backward compatibility - getArtifactStats() warns if this file exists.
  int8Vectors: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-int8.db'),

  // Late interaction token embeddings
  lateInteraction: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-late-interaction.db'),

  // Sparse gram artifact for pattern prefiltering
  sparseGramIndex: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-sparse-grams.idx'),

  // Merkle state for incremental indexing
  merkle: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'merkle-state.json'),

  // Query vocabulary cache
  vocabulary: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'query-vocabulary.json'),

};

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
  const logicalCores = overrides?.cpuCount ?? os.cpus().length;
  const computeCores = estimateComputeCores({ logicalCores, arch });
  const totalMemGB = totalMemBytes / (1024 ** 3);

  let batchSize = 8;
  let flushRows = 64;

  if (totalMemGB >= 24 && computeCores >= 8) {
    batchSize = 64;
    flushRows = 1;
  } else if (totalMemGB >= 12 && computeCores >= 6) {
    batchSize = 32;
    flushRows = 8;
  } else if (totalMemGB >= 8 && computeCores >= 4) {
    batchSize = 16;
    flushRows = 32;
  }

  // Default to sequential embedding -> LI phases. This is the safe
  // cross-machine choice when both models are CPU-bound and share caches.
  // Callers can still opt into overlap via env override for experimentation.
  const parallelLI = false;

  return {
    batchSize,
    flushRows,
    parallelLI,
    executionMode: parallelLI ? 'parallel-models' : 'sequential-phases',
    logicalCores,
    computeCores,
    totalMemBytes,
    totalMemGB,
    isWSL,
    platform,
    arch,
  };
}

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
    if (process.env.SWEET_SEARCH_ALLOW_RUNTIME_DOWNLOAD !== undefined) {
      return envBool('SWEET_SEARCH_ALLOW_RUNTIME_DOWNLOAD', true);
    }
    // Init config written by `sweet-search init`
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

  modelCacheRoot: process.env.SWEET_SEARCH_MODEL_CACHE
    || path.join(os.homedir(), '.cache', 'sweet-search', 'models'),

  // HuggingFace endpoint (overrideable for enterprise mirrors/proxies)
  hfEndpoint: process.env.SWEET_SEARCH_HF_ENDPOINT || 'https://huggingface.co',
};

// Global quiet mode flag - set by CLI tools when --quiet is passed
let _quietMode = false;

/**
 * Set quiet mode globally. When enabled:
 * - timing logs are suppressed
 * - verbose logs are suppressed
 * - Only errors and essential output are shown
 */
export function setQuietMode(enabled) {
  _quietMode = enabled;
}

export function isQuietMode() {
  return _quietMode;
}

export const LOGGING = {
  get verbose() {
    return !_quietMode && process.env.SEARCH_VERBOSE === 'true';
  },

  // Timing logs (performance measurements)
  // Only enabled when SEARCH_TIMING=true AND not in quiet mode
  get timing() {
    return !_quietMode && process.env.SEARCH_TIMING === 'true';
  },

  get debug() {
    return process.env.SEARCH_DEBUG === 'true';
  },
};
