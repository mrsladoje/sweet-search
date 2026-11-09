#!/usr/bin/env node

/**
 * Incremental Indexing Tracker
 *
 * Tracks file changes using content hashes to enable incremental reindexing.
 * Only files that have changed since last index are reprocessed.
 *
 * - Config-aware invalidation: a config fingerprint mismatch (provider, model,
 *   dimension, hash algorithm, ...) forces a full reindex, which prevents silent
 *   dimension-mismatch corruption.
 * - Content hashes come from the shared incremental hashing wrapper.
 * - Per file it stores { hash, size, mtime_ns, inode }. Fast path: skip the
 *   content read if (size, mtime_ns, inode) match the stored values (10-50x
 *   speedup when few or no files changed).
 *
 * Storage: .sweet-search/merkle-state.json holds the header (version, config fingerprint,
 * lastIndex, stats); the per-file map lives in file-state.db (file-state-store.mjs), so
 * the maintainer reads and writes single rows instead of the whole map.
 */

import fs from 'fs/promises';
import { existsSync, openSync, fsyncSync, closeSync } from 'fs';
import path from 'path';
import { DB_PATHS } from '../infrastructure/config/index.js';
import { contentHashSync } from '../incremental-indexing/infrastructure/hashing.mjs';
import { readFileStateObject, writeFileStateObject, fileStatePath } from '../incremental-indexing/infrastructure/file-state-store.mjs';
import { STATE_VERSION, buildConfigFingerprint, validateConfigFingerprint, diffConfigFingerprint } from './config-fingerprint.js';

const STATE_PATH = DB_PATHS.merkle;

function hashContent(content) {
  return contentHashSync(content);
}

/**
 * Get file metadata (size, mtime in nanoseconds, inode) via fs.stat().
 *
 * Per docs/INCREMENTAL_INDEXING_PLAN.md § 9.1, the dirty-detection tuple is
 * `(mtime_ns, size, inode)`. The naive `mtime > recorded` check misses a
 * second write within the same FS resolution tick; the equality-on-tuple
 * check plus inode detects atomic-rename-over-existing-path (vim swap
 * write, JetBrains safe-write) which produces a new inode at the same
 * path with identical mtime/size.
 *
 * 64-bit inodes from APFS/ZFS/XFS routinely exceed Number.MAX_SAFE_INTEGER;
 * we therefore store inode as a JSON string (BigInt has no JSON type) and
 * cast back via `BigInt(stored.inode)` for comparison. `mtime_ns` and `size`
 * are stored the same way so the tuple has one type policy end to end.
 *
 * @returns {Promise<{size: string, mtime_ns: string, inode: string}>}
 */
async function getFileMetadata(filePath) {
  const stat = await fs.stat(filePath, { bigint: true });
  return {
    size: stat.size.toString(),
    mtime_ns: stat.mtimeNs.toString(),
    inode: stat.ino.toString(),
  };
}

function statFieldToBigIntString(value) {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
}

/**
 * Per docs/INCREMENTAL_INDEXING_PLAN.md § 9.1 the comparison is the full
 * `(mtime_ns, size, inode)` tuple. A stored entry without an inode is
 * deliberately not fast-path eligible: the next run pays one content read
 * and rewrites the complete tuple, which closes the atomic-rename hole for
 * state files produced before inode persistence landed.
 *
 * @param {Object} stored - Stored entry {hash, size, mtime_ns, inode?}
 */
function metadataMatches(stored, current) {
  if (stored.size == null || stored.mtime_ns == null) return false;
  if (statFieldToBigIntString(stored.size) !== statFieldToBigIntString(current.size)) return false;
  if (statFieldToBigIntString(stored.mtime_ns) !== statFieldToBigIntString(current.mtime_ns)) return false;
  if (stored.inode == null || current.inode == null) return false;
  return statFieldToBigIntString(stored.inode) === statFieldToBigIntString(current.inode);
}

function createEmptyState() {
  return {
    version: STATE_VERSION,
    config_fingerprint: buildConfigFingerprint(),
    files: {},
    lastIndex: null,
    stats: { totalFiles: 0, totalChunks: 0 },
  };
}

/**
 * Load previous indexing state with config validation. A missing, corrupt and
 * unreadable state file are told apart.
 * @returns {Object} { state, configValidation }
 */
async function loadState(silent = false) {
  if (!existsSync(STATE_PATH)) {
    if (!silent) {
      console.log('[incremental-tracker] State file not found, starting fresh');
    }
    return { state: createEmptyState(), configValidation: { valid: true, reason: 'new' } };
  }

  try {
    const data = await fs.readFile(STATE_PATH, 'utf-8');
    const state = JSON.parse(data);
    state.files = readFileStateObject(path.dirname(STATE_PATH));

    const configValidation = validateConfigFingerprint(state.config_fingerprint);

    return { state, configValidation };
  } catch (err) {
    // File deleted between the exists check and the read
    if (err.code === 'ENOENT') {
      if (!silent) {
        console.log('[incremental-tracker] State file removed, starting fresh');
      }
      return { state: createEmptyState(), configValidation: { valid: true, reason: 'removed' } };
    }

    if (err instanceof SyntaxError) {
      if (!silent) {
        console.error('[incremental-tracker] CORRUPT state file detected, backing up and starting fresh');
      }
      try {
        await fs.rename(STATE_PATH, STATE_PATH + '.corrupt.' + Date.now());
      } catch {}
      return { state: createEmptyState(), configValidation: { valid: false, reason: 'corrupt' } };
    }

    if (!silent) {
      console.error(`[incremental-tracker] Error reading state: ${err.message}`);
    }
    return { state: createEmptyState(), configValidation: { valid: false, reason: err.message } };
  }
}

/** Atomic temp+rename for crash safety; no pretty-printing, for smaller files and faster writes. */
async function saveState(state) {
  state.version = STATE_VERSION;
  state.config_fingerprint = buildConfigFingerprint();

  const tempPath = STATE_PATH + '.tmp';
  const { files, ...header } = state;
  const content = JSON.stringify(header);

  try {
    await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
    // Rows first: the header (with its fingerprint) is what marks the state complete.
    writeFileStateObject(path.dirname(STATE_PATH), files || {});

    await fs.writeFile(tempPath, content);

    // POSIX guarantees rename atomicity
    await fs.rename(tempPath, STATE_PATH);
  } catch (err) {
    try {
      await fs.unlink(tempPath);
    } catch {
    }

    if (err.code === 'ENOSPC') {
      console.error('[incremental-tracker] CRITICAL: Disk full, cannot save merkle state');
      console.error('[incremental-tracker] Free up disk space and run /index-codebase');
    }
    throw err;
  }
}

/**
 * Determine which files need reindexing.
 * fs.stat() first (one syscall, ~0.1ms); if (size, mtime_ns, inode) match the stored
 * values the content read is skipped, else the content is read and hashed.
 * Stats run in parallel batches of 100 (2-4x faster than sequential).
 *
 * @returns {Promise<Object>} Result object with:
 *   - toIndex {string[]} - Files that need indexing (new or changed)
 *   - toRemove {string[]} - Files that were deleted
 *   - unchanged {string[]} - Files with no changes
 *   - currentHashes {Object} - Current file hash state for saving
 *   - previousState {Object} - Previous state for comparison
 *   - configInvalidated {boolean} - Whether config changed invalidated cache
 *   - configValidation {Object} - Config validation details { valid, reason }
 *   - fastPathStats {Object} - Fast-path hit/miss statistics { hits, misses, contentReads }
 */
export async function getChangedFiles(allFiles, projectRoot) {
  const BATCH_SIZE = 100;
  const { state, configValidation } = await loadState();
  const currentHashes = {};

  const fastPathStats = { hits: 0, misses: 0, contentReads: 0 };

  if (!configValidation.valid) {
    console.warn(`\n[Sweet Search] CONFIG CHANGE DETECTED - Full reindex required`);
    console.warn(`  Reason: ${configValidation.reason}`);
    if (configValidation.details) {
      console.warn(`  ${configValidation.details.message}`);
    }
    console.warn('');

    for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
      const batch = allFiles.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async (file) => {
          const filePath = path.join(projectRoot, file);
          try {
            const [content, metadata] = await Promise.all([
              fs.readFile(filePath),
              getFileMetadata(filePath),
            ]);
            const hash = hashContent(content);
            return {
              file,
              data: {
                hash,
                size: metadata.size,
                mtime_ns: metadata.mtime_ns,
                inode: metadata.inode,
              },
              error: null,
            };
          } catch (err) {
            return { file, data: null, error: err };
          }
        }),
      );

      for (const { file, data, error } of results) {
        if (!error && data) {
          currentHashes[file] = data;
          fastPathStats.contentReads++;
        }
      }
    }

    const currentFiles = new Set(Object.keys(currentHashes));
    const toRemove = Object.keys(state.files).filter((f) => !currentFiles.has(f));

    return {
      toIndex: allFiles.filter((f) => currentHashes[f]), // only files we could read
      toRemove,
      unchanged: [],
      currentHashes,
      previousState: state,
      configInvalidated: true,
      configValidation,
      fastPathStats: { hits: 0, misses: allFiles.length, contentReads: fastPathStats.contentReads },
    };
  }

  if (configValidation.migrated) {
    console.log(`[Sweet Search] ${configValidation.details?.message || 'State migrated'}`);
  }

  const toIndex = [];
  const unchanged = [];
  const toRemove = [];

  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);

    const metadataResults = await Promise.all(
      batch.map(async (file) => {
        const filePath = path.join(projectRoot, file);
        try {
          const metadata = await getFileMetadata(filePath);
          return { file, filePath, metadata, error: null };
        } catch (err) {
          return { file, filePath, metadata: null, error: err };
        }
      }),
    );

    const needsContentRead = [];
    for (const { file, filePath, metadata, error } of metadataResults) {
      if (error || !metadata) {
        if (state.files[file]) {
          toRemove.push(file);
        }
        continue;
      }

      const stored = state.files[file];
      const storedEntry = stored && typeof stored === 'object' && stored.hash ? stored : null;

      if (storedEntry && metadataMatches(storedEntry, metadata)) {
        currentHashes[file] = {
          hash: storedEntry.hash,
          size: metadata.size,
          mtime_ns: metadata.mtime_ns,
          inode: metadata.inode,
        };
        unchanged.push(file);
        fastPathStats.hits++;
      } else {
        fastPathStats.misses++;
        needsContentRead.push({ file, filePath, metadata, storedEntry });
      }
    }

    if (needsContentRead.length > 0) {
      const contentResults = await Promise.all(
        needsContentRead.map(async ({ file, filePath, metadata, storedEntry }) => {
          try {
            const content = await fs.readFile(filePath);
            const hash = hashContent(content);
            return { file, hash, metadata, storedEntry, error: null };
          } catch (err) {
            return { file, hash: null, metadata, storedEntry, error: err };
          }
        }),
      );

      for (const { file, hash, metadata, storedEntry, error } of contentResults) {
        if (error || !hash) {
          console.error(`[incremental-tracker] Error reading ${file}: ${error?.message || 'unknown'}`);
          continue;
        }

        fastPathStats.contentReads++;
        currentHashes[file] = {
          hash,
          size: metadata.size,
          mtime_ns: metadata.mtime_ns,
          inode: metadata.inode,
        };

        if (!storedEntry || storedEntry.hash !== hash) {
          toIndex.push(file);
        } else {
          // Touched, not modified
          unchanged.push(file);
        }
      }
    }
  }

  for (const file of Object.keys(state.files)) {
    if (!currentHashes[file] && !toRemove.includes(file)) {
      toRemove.push(file);
    }
  }

  if (allFiles.length > 0) {
    const fastPathRatio = ((fastPathStats.hits / allFiles.length) * 100).toFixed(1);
    console.log(
      `[Sweet Search] Fast-path: ${fastPathStats.hits}/${allFiles.length} files (${fastPathRatio}%), ` +
        `content reads: ${fastPathStats.contentReads}`,
    );
  }

  return {
    toIndex,
    toRemove,
    unchanged,
    currentHashes,
    previousState: state,
    configInvalidated: false,
    configValidation,
    fastPathStats,
  };
}

export async function updateState(currentHashes, stats = {}) {
  const state = {
    version: STATE_VERSION,
    config_fingerprint: buildConfigFingerprint(),
    files: currentHashes,
    lastIndex: new Date().toISOString(),
    stats: {
      totalFiles: Object.keys(currentHashes).length,
      ...stats,
    },
  };
  await saveState(state);
  return state;
}

export async function clearState() {
  try {
    for (const suffix of ['', '-wal', '-shm']) await fs.rm(fileStatePath(path.dirname(STATE_PATH)) + suffix, { force: true });
    await fs.unlink(STATE_PATH);
    console.log('State cleared, next index will be full');
  } catch (err) {
  }
}

export async function getStats() {
  const { state, configValidation } = await loadState();
  return {
    lastIndex: state.lastIndex,
    totalFiles: state.stats?.totalFiles || 0,
    totalChunks: state.stats?.totalChunks || 0,
    hasState: Object.keys(state.files).length > 0,
    configFingerprint: state.config_fingerprint,
    configValid: configValidation.valid,
    configValidation,
  };
}

export function getCurrentConfigFingerprint() {
  return buildConfigFingerprint();
}

export async function validateCurrentState() {
  const { state, configValidation } = await loadState();
  return {
    hasState: Object.keys(state.files || {}).length > 0,
    lastIndex: state.lastIndex,
    configValid: configValidation.valid,
    configValidation,
    currentFingerprint: buildConfigFingerprint(),
    storedFingerprint: state.config_fingerprint,
  };
}

/**
 * Return the persisted tracker snapshot without emitting CLI-oriented logs.
 * Used by search-time overlays that need "changed since last index" state.
 */
export async function getStateSnapshot() {
  const { state, configValidation } = await loadState(true);
  return {
    version: state.version,
    lastIndex: state.lastIndex,
    files: state.files || {},
    stats: state.stats || {},
    configValidation,
  };
}

// Per-phase progress markers for crash-resume.
const PROGRESS_PATH = DB_PATHS.merkle.replace('merkle-state.json', 'phase-progress.json');

/**
 * Update per-phase progress marker. Written durably (fsync) so crash-resume
 * knows how far each phase progressed.
 */
export async function updatePhaseProgress(progress) {
  const data = {
    ...progress,
    configFingerprint: buildConfigFingerprint(),
    timestamp: new Date().toISOString(),
  };
  await fs.writeFile(PROGRESS_PATH, JSON.stringify(data, null, 2));
  try {
    const fd = openSync(PROGRESS_PATH, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch (_err) { /* fsync not critical for progress file */ }
}

/**
 * Read per-phase progress. Returns null if no progress file or config fingerprint changed.
 */
export async function getPhaseProgress() {
  try {
    const data = JSON.parse(await fs.readFile(PROGRESS_PATH, 'utf-8'));
    // Stale progress (config changed) is discarded
    if (!data.configFingerprint ||
        diffConfigFingerprint(data.configFingerprint).length > 0 ||
        data.configFingerprint.version !== STATE_VERSION) {
      return null;
    }
    return data;
  } catch (_err) {
    return null;
  }
}

export async function markPhaseComplete(phase) {
  await updatePhaseProgress({ phase, status: 'complete' });
}

export async function clearPhaseProgress() {
  try {
    await fs.unlink(PROGRESS_PATH);
  } catch (_err) {
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.includes('--clear')) {
    await clearState();
  } else if (args.includes('--stats')) {
    const stats = await getStats();
    console.log('Indexing State:');
    console.log(`  Last index: ${stats.lastIndex || 'Never'}`);
    console.log(`  Total files: ${stats.totalFiles}`);
    console.log(`  Total chunks: ${stats.totalChunks}`);
    console.log(`  Has state: ${stats.hasState}`);
    console.log('\nConfig Fingerprint:');
    if (stats.configFingerprint) {
      console.log(`  Provider: ${stats.configFingerprint.provider}`);
      console.log(`  Model: ${stats.configFingerprint.model}`);
      console.log(`  Dimension: ${stats.configFingerprint.dimension}d`);
      console.log(`  HNSW Dimension: ${stats.configFingerprint.hnswDimension}d`);
      console.log(`  Version: ${stats.configFingerprint.version}`);
    } else {
      console.log('  (none - legacy state)');
    }
    console.log(`\nConfig Valid: ${stats.configValid ? 'Yes' : 'NO - REINDEX REQUIRED'}`);
    if (!stats.configValid && stats.configValidation.details) {
      console.log(`  Reason: ${stats.configValidation.details.message}`);
    }
  } else if (args.includes('--validate')) {
    const validation = await validateCurrentState();
    console.log('Config Validation:');
    console.log(`  Has existing state: ${validation.hasState}`);
    console.log(`  Config valid: ${validation.configValid}`);
    if (!validation.configValid) {
      console.log(`  Reason: ${validation.configValidation.reason}`);
      if (validation.configValidation.details) {
        console.log(`  Details: ${validation.configValidation.details.message}`);
      }
    }
    console.log('\nCurrent Config:');
    console.log(`  Provider: ${validation.currentFingerprint.provider}`);
    console.log(`  Model: ${validation.currentFingerprint.model}`);
    console.log(`  Dimension: ${validation.currentFingerprint.dimension}d`);
    if (validation.storedFingerprint) {
      console.log('\nStored Config:');
      console.log(`  Provider: ${validation.storedFingerprint.provider}`);
      console.log(`  Model: ${validation.storedFingerprint.model}`);
      console.log(`  Dimension: ${validation.storedFingerprint.dimension}d`);
    }
  } else {
    console.log(`
Incremental Indexing Tracker v${STATE_VERSION}

Usage:
  node incremental-tracker.js --stats     Show indexing statistics
  node incremental-tracker.js --validate  Validate config fingerprint
  node incremental-tracker.js --clear     Clear state (force full reindex)

Config-Aware Cache Invalidation (Sweet Search v2.3):
  The tracker now stores a config fingerprint with each index state.
  If the embedding provider, model, or dimensions change, the index
  is automatically invalidated and a full reindex is triggered.

  This prevents silent dimension mismatch corruption when switching
  between providers (e.g., Voyage -> Mistral).

mtime/size/inode Fast-Path Optimization (Sweet Search v2.3):
  Each file entry now stores { hash, size, mtime_ns, inode } instead of just hash.
  On incremental checks, fs.stat() is called first (~0.1ms per file).
  If (size, mtime_ns, inode) match stored values, content read is skipped entirely.

  This provides 10-50x speedup for typical incremental checks when
  few or no files have changed. First run after upgrade reads all files
  but stores the new format for subsequent fast-path checks.

This module is primarily used by index-codebase-v21.js for incremental indexing.
`);
  }
}

export default {
  getChangedFiles,
  updateState,
  clearState,
  getStats,
  getCurrentConfigFingerprint,
  validateCurrentState,
  getStateSnapshot,
};
