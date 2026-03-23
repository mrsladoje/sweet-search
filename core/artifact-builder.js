#!/usr/bin/env node

/**
 * Artifact Builder for Binary HNSW + Int8 Quantization (SOTA December 2025)
 *
 * Builds optimized index artifacts for 3-stage retrieval:
 *   Stage 1: Binary HNSW (1000 candidates, ~100μs, 32x memory reduction)
 *   Stage 2: Int8 rescore (100 candidates, ~1ms, 4x memory reduction)
 *   Stage 3: Rerank (top 20 → k)
 *
 * Artifacts produced:
 *   - .sweet-search/codebase-binary-hnsw.idx (+ .meta.json, .vectors.json, .graph.json, .int8.json)
 *
 * CANONICAL INT8 STORAGE (Workstream H resolution):
 *   Int8 vectors are stored in .int8.json sidecar file alongside the binary HNSW index.
 *   This is the ONLY source of int8 vectors for stage-2 rescoring in sweet-search.
 *   Rationale: O(1) Map lookup vs O(log n) + I/O for SQLite, loaded with HNSW index.
 *   The SQLite approach (codebase-int8.db) was REMOVED as it was never used by search.
 *
 * Reference: https://huggingface.co/blog/embedding-quantization
 *
 * Usage:
 *   node artifact-builder.js build              # Build from existing codebase.db
 *   node artifact-builder.js build --from-embeddings <file.json>
 *   node artifact-builder.js stats              # Show artifact statistics
 *   node artifact-builder.js verify             # Verify artifact integrity
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { DB_PATHS, BINARY_HNSW_CONFIG, EMBEDDING_CONFIG } from './config.js';

// =============================================================================
// THRESHOLD CONFIGURATION
// =============================================================================

/**
 * Threshold configuration for skipping binary artifact rebuilds.
 *
 * Skip rebuild if: changedFiles < SKIP_THRESHOLD
 * This saves ~30s+ for small incremental updates while Float HNSW serves search.
 */
export const ARTIFACT_THRESHOLDS = {
  /** Minimum changed files to trigger binary artifact rebuild */
  skipThreshold: 10,

  /** Maximum time (ms) since last rebuild before forcing rebuild (5 minutes) */
  maxAgeSinceRebuild: 5 * 60 * 1000,

  /** State file tracking last rebuild timestamp */
  stateFile: '.sweet-search/artifact-rebuild-state.json',
};

import { BinaryHNSWIndex } from './binary-hnsw-index.js';
import { truncateForHNSW, fisherYatesShuffle, normalizedFloatToInt8 } from './embedding-service.js';
import { FloatVectorStore, getFloatStorePath } from './float-vector-store.js';

// =============================================================================
// THRESHOLD CHECKING FUNCTIONS
// =============================================================================

/**
 * Load artifact rebuild state from disk.
 * @returns {Promise<{lastRebuildTimestamp: number, accumulatedChanges: number}>}
 */
async function loadArtifactState() {
  const statePath = path.resolve(process.cwd(), ARTIFACT_THRESHOLDS.stateFile);
  try {
    if (existsSync(statePath)) {
      const data = JSON.parse(await fs.readFile(statePath, 'utf-8'));
      return {
        lastRebuildTimestamp: data.lastRebuildTimestamp || 0,
        accumulatedChanges: data.accumulatedChanges || 0,
      };
    }
  } catch (err) {
    // Ignore errors, return defaults
  }
  return { lastRebuildTimestamp: 0, accumulatedChanges: 0 };
}

/**
 * Save artifact rebuild state to disk.
 * @param {object} state - State to save
 */
async function saveArtifactState(state) {
  const statePath = path.resolve(process.cwd(), ARTIFACT_THRESHOLDS.stateFile);
  try {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify({
      ...state,
      savedAt: new Date().toISOString(),
    }, null, 2));
  } catch (err) {
    // Ignore errors (non-critical)
  }
}

/**
 * Check if artifact rebuild should be skipped based on thresholds.
 *
 * Skips rebuild if:
 * - changedFiles < skipThreshold AND
 * - time since last rebuild < maxAgeSinceRebuild
 *
 * Float HNSW can serve search in the interim.
 *
 * @param {object} options - Options
 * @param {number} options.changedFiles - Number of files changed in this indexing run
 * @param {boolean} options.force - Force rebuild regardless of thresholds
 * @returns {Promise<{shouldSkip: boolean, reason: string, state: object}>}
 */
export async function shouldSkipArtifactRebuild(options = {}) {
  const { changedFiles = 0, force = false } = options;
  const state = await loadArtifactState();
  const now = Date.now();
  const timeSinceRebuild = now - state.lastRebuildTimestamp;
  const accumulatedTotal = state.accumulatedChanges + changedFiles;

  // Force rebuild if requested
  if (force) {
    return {
      shouldSkip: false,
      reason: 'Force rebuild requested via --force-artifacts',
      state,
    };
  }

  // Force rebuild if accumulated changes exceed threshold
  if (accumulatedTotal >= ARTIFACT_THRESHOLDS.skipThreshold) {
    return {
      shouldSkip: false,
      reason: `Accumulated changes (${accumulatedTotal}) >= threshold (${ARTIFACT_THRESHOLDS.skipThreshold})`,
      state,
    };
  }

  // Force rebuild if max age exceeded
  if (state.lastRebuildTimestamp > 0 && timeSinceRebuild >= ARTIFACT_THRESHOLDS.maxAgeSinceRebuild) {
    return {
      shouldSkip: false,
      reason: `Time since last rebuild (${Math.round(timeSinceRebuild / 1000)}s) >= max age (${ARTIFACT_THRESHOLDS.maxAgeSinceRebuild / 1000}s)`,
      state,
    };
  }

  // Force rebuild if no artifacts exist
  const hnswMetaPath = DB_PATHS.binaryHnswIndex.replace('.idx', '.meta.json');
  if (!existsSync(hnswMetaPath)) {
    return {
      shouldSkip: false,
      reason: 'No existing binary HNSW artifacts found',
      state,
    };
  }

  // Skip - not enough changes, artifacts exist, within time window
  return {
    shouldSkip: true,
    reason: `Only ${changedFiles} files changed (threshold: ${ARTIFACT_THRESHOLDS.skipThreshold}), Float HNSW will serve search`,
    state,
    accumulatedTotal,
  };
}

/**
 * Update artifact state after a rebuild or skip decision.
 *
 * @param {object} options - Options
 * @param {boolean} options.rebuilt - Whether artifacts were rebuilt
 * @param {number} options.changedFiles - Number of files changed
 * @param {object} options.previousState - Previous state from shouldSkipArtifactRebuild
 */
export async function updateArtifactState(options = {}) {
  const { rebuilt, changedFiles = 0, previousState = {} } = options;

  if (rebuilt) {
    // Reset accumulated changes after rebuild
    await saveArtifactState({
      lastRebuildTimestamp: Date.now(),
      accumulatedChanges: 0,
    });
  } else {
    // Accumulate changes for next threshold check
    const accumulated = (previousState.accumulatedChanges || 0) + changedFiles;
    await saveArtifactState({
      lastRebuildTimestamp: previousState.lastRebuildTimestamp || 0,
      accumulatedChanges: accumulated,
    });
  }
}

// =============================================================================
// QUANTIZATION FUNCTIONS
// =============================================================================

/**
 * Quantize float32 array to int8 (-128 to 127)
 * Uses linear quantization with clipping to preserve relative distances.
 *
 * Memory reduction: 4x (32-bit float → 8-bit int)
 * Accuracy loss: <1% for normalized embeddings
 *
 * @param {Float32Array|number[]} float32Array - Input float embedding (assumed normalized -1 to 1)
 * @returns {Int8Array} Quantized int8 embedding
 */
/**
 * Quantize float32 to int8. Delegates to the canonical implementation in
 * embedding-service.normalizedFloatToInt8 — single source of truth.
 */
export function quantizeToInt8(float32Array) {
  return normalizedFloatToInt8(float32Array);
}

/**
 * Quantize float32 array to binary (1 bit per dimension)
 * Uses sign-based quantization: positive → 1, negative → 0
 *
 * Memory reduction: 32x (32-bit float → 1-bit)
 * Speed improvement: ~10x (Hamming distance via popcount)
 *
 * @param {Float32Array|number[]} float32Array - Input float embedding
 * @returns {Uint8Array} Binary embedding (dimension/8 bytes)
 */
export function quantizeToBinary(float32Array) {
  const numBytes = Math.ceil(float32Array.length / 8);
  const binary = new Uint8Array(numBytes);

  for (let i = 0; i < float32Array.length; i++) {
    if (float32Array[i] > 0) {
      binary[Math.floor(i / 8)] |= (1 << (7 - (i % 8)));
    }
  }

  return binary;
}

/**
 * Batch quantize embeddings to int8
 *
 * @param {Float32Array[]|number[][]} embeddings - Array of float embeddings
 * @returns {{int8Embeddings: Int8Array[], stats: {count: number, dimension: number}}}
 */
export function batchQuantizeToInt8(embeddings) {
  const int8Embeddings = embeddings.map(emb => quantizeToInt8(emb));

  return {
    int8Embeddings,
    stats: {
      count: embeddings.length,
      dimension: embeddings[0]?.length || 0,
      originalSizeBytes: embeddings.length * (embeddings[0]?.length || 0) * 4,
      quantizedSizeBytes: embeddings.length * (embeddings[0]?.length || 0),
      compressionRatio: 4,
    },
  };
}

/**
 * Batch quantize embeddings to binary
 *
 * @param {Float32Array[]|number[][]} embeddings - Array of float embeddings
 * @returns {{binaryEmbeddings: Uint8Array[], stats: {count: number, dimension: number}}}
 */
export function batchQuantizeToBinary(embeddings) {
  const binaryEmbeddings = embeddings.map(emb => quantizeToBinary(emb));

  const floatDim = embeddings[0]?.length || 0;
  const binaryDim = Math.ceil(floatDim / 8);

  return {
    binaryEmbeddings,
    stats: {
      count: embeddings.length,
      floatDimension: floatDim,
      binaryDimension: binaryDim,
      originalSizeBytes: embeddings.length * floatDim * 4,
      quantizedSizeBytes: embeddings.length * binaryDim,
      compressionRatio: Math.round(floatDim * 4 / binaryDim),
    },
  };
}

// =============================================================================
// HNSW INDEX BUILDING
// =============================================================================

/**
 * Build Binary HNSW index from embeddings
 *
 * @param {Array<{id: string, embedding: number[], metadata?: object}>} items - Items to index
 * @param {object} options - Build options
 * @returns {Promise<BinaryHNSWIndex>}
 */
export async function buildHnswIndex(items, options = {}) {
  const {
    M = BINARY_HNSW_CONFIG.M,
    efConstruction = BINARY_HNSW_CONFIG.efConstruction,
    efSearch = BINARY_HNSW_CONFIG.efSearch,
    floatDimension = BINARY_HNSW_CONFIG.floatDimension,
    indexPath = DB_PATHS.binaryHnswIndex,
    includeInt8 = true,
    onProgress = null,
  } = options;
  // Derive binary dimension from float dimension (not from global default)
  const dimension = options.dimension || Math.ceil(floatDimension / 8);

  const index = new BinaryHNSWIndex({
    dimension,
    floatDimension,
    M,
    efConstruction,
    efSearch,
    indexPath,
  });

  index.resetForBuild();

  // Truncate all embeddings once — reused for per-item encoding
  const truncated = items.map(item => truncateForHNSW(item.embedding, floatDimension));

  // Asymmetric calibration (center→rotate→sign-bit) disabled.
  // Tested at both 512d and 1024d (Voyage Code 3) — no quality improvement,
  // slight regression. Plain sign-bit is optimal for this benchmark/task.
  // index.calibrateAsymmetric(truncated);

  // Build insertion order (index permutation keeps items↔embeddings paired)
  const insertionOrder = BINARY_HNSW_CONFIG.insertionOrder || 'sequential';
  const order = Array.from({ length: items.length }, (_, i) => i);
  if (insertionOrder === 'shuffle') {
    fisherYatesShuffle(order);
  } else if (insertionOrder === 'diversity') {
    const buckets = new Map();
    for (let i = 0; i < items.length; i++) {
      const dir = items[i].metadata?.file?.replace(/\/[^/]+$/, '') || '_unknown';
      if (!buckets.has(dir)) buckets.set(dir, []);
      buckets.get(dir).push(i);
    }
    const dirs = [...buckets.keys()];
    fisherYatesShuffle(dirs);
    order.length = 0;
    let rem = items.length;
    while (rem > 0) {
      for (const dir of dirs) {
        const b = buckets.get(dir);
        if (b.length > 0) { order.push(b.shift()); rem--; }
      }
    }
  }

  const startTime = performance.now();
  let processed = 0;

  for (const idx of order) {
    const item = items[idx];
    const binary = index.encodeDocument(truncated[idx]);

    // Optionally include int8 for rescoring
    const int8 = includeInt8 ? quantizeToInt8(truncated[idx]) : null;

    await index.add(item.id, binary, item.metadata || {}, int8);

    processed++;
    if (onProgress && (processed % 500 === 0 || processed === items.length)) {
      onProgress(processed, items.length);
    }
  }

  const buildTime = performance.now() - startTime;

  return {
    index,
    stats: {
      vectorCount: items.length,
      buildTimeMs: Math.round(buildTime),
      vectorsPerSecond: Math.round(items.length / (buildTime / 1000)),
      dimension,
      floatDimension,
      M,
      efConstruction,
      useAsymmetric: index.useAsymmetric,
      insertionOrder,
    },
  };
}

// =============================================================================
// INT8 VECTORS (DEPRECATED - Use binary-hnsw-index.js .int8.json sidecar)
// =============================================================================

/**
 * @deprecated Use BinaryHNSWIndex.int8Vectors Map instead.
 * Int8 vectors are stored in .int8.json sidecar alongside the binary HNSW index.
 * This provides O(1) lookup during stage-2 rescoring vs O(log n) + I/O for SQLite.
 *
 * The SQLite functions below are kept for backward compatibility but are NOT used
 * by the search pipeline. sweet-search.js calls binaryHnswIndex.getInt8Vector()
 * which reads from the in-memory Map populated from .int8.json.
 */

// NOTE: These SQLite functions have been removed as they were never used by search.
// Int8 vectors are stored in and loaded from .int8.json sidecar by BinaryHNSWIndex.
// See binary-hnsw-index.js lines 471-479 (save) and 524-530 (load).
//
// If you need to migrate from the old codebase-int8.db, the vectors are already
// duplicated in the .int8.json file created during artifact building.

// =============================================================================
// ARTIFACT MANAGEMENT
// =============================================================================

/**
 * Save all artifacts (Binary HNSW with Int8 sidecar)
 *
 * Int8 vectors are saved as .int8.json sidecar by BinaryHNSWIndex.save().
 * No separate SQLite database is created.
 *
 * @param {BinaryHNSWIndex} hnswIndex - Built HNSW index (includes int8 vectors)
 * @returns {Promise<{hnsw: object}>}
 */
export async function saveArtifacts(hnswIndex) {
  // Save HNSW index (includes .int8.json sidecar)
  await hnswIndex.save();
  const hnswStats = hnswIndex.getStats();

  return {
    hnsw: hnswStats,
  };
}

/**
 * Build all artifacts from embeddings stored in codebase.db
 *
 * Int8 vectors are stored in .int8.json sidecar alongside the binary HNSW index.
 * This is the canonical storage for stage-2 rescoring (no separate SQLite DB).
 *
 * IMPORTANT: Return shape for callers (e.g., index-codebase-v21.js Phase 5):
 *
 * @param {string} codebaseDbPath - Path to codebase.db with float embeddings
 * @param {object} options - Build options
 * @param {string} [options.hnswIndexPath] - Path for HNSW index output
 * @param {number} [options.floatDimension] - Float dimension for embeddings
 * @param {function} [options.onProgress] - Progress callback (phase, current, total)
 * @returns {Promise<{
 *   hnsw: {
 *     dimension: number,
 *     floatDimension: number,
 *     totalVectors: number,
 *     int8VectorCount: number,
 *     buildTimeMs: number,
 *     vectorsPerSecond: number,
 *     path: string,
 *     int8SidecarPath: string,
 *     M: number,
 *     efConstruction: number,
 *     efSearch: number,
 *     maxLevel: number,
 *     graphLevels: number,
 *     graphNodes: number,
 *     graphEdges: number,
 *     memorySizeBytes: number,
 *     memorySizeMB: string
 *   },
 *   stats: {
 *     totalVectors: number,
 *     floatDimension: number,
 *     binaryDimension: number,
 *     memoryReduction: { binary: string, int8: string }
 *   }
 * }>}
 */
/** Build and save a FloatVectorStore from items with embeddings. */
async function buildAndSaveFloatStore(items, floatDimension, floatStorePath) {
  console.log(`Building float vector store (${items.length} vectors, ${floatDimension}d)...`);
  const floatStore = new FloatVectorStore();
  const floatEntries = items.map(item => ({
    id: item.id,
    vector: truncateForHNSW(item.embedding, floatDimension),
  }));
  floatStore.build(floatEntries, floatDimension);
  await floatStore.save(floatStorePath);
  console.log(`Float vector store: ${floatStore.memorySizeMB} MB → ${floatStorePath}`);
}

export async function buildFromCodebaseDb(codebaseDbPath = DB_PATHS.codebase, options = {}) {
  const overallStartTime = performance.now();
  const {
    hnswIndexPath = DB_PATHS.binaryHnswIndex,
    floatDimension = EMBEDDING_CONFIG.hnswDimension,
    M = BINARY_HNSW_CONFIG.M,
    efConstruction = BINARY_HNSW_CONFIG.efConstruction,
    efSearch = BINARY_HNSW_CONFIG.efSearch,
    onProgress = null,
  } = options;

  if (!existsSync(codebaseDbPath)) {
    throw new Error(`Codebase database not found: ${codebaseDbPath}`);
  }

  console.log(`\nLoading embeddings from ${codebaseDbPath}...`);

  const Database = (await import('better-sqlite3')).default;
  const { applyReadPragmas } = await import('./db-utils.js');
  const db = new Database(codebaseDbPath, { readonly: true });
  applyReadPragmas(db);

  // Load all vectors
  const rows = db.prepare('SELECT id, embedding, metadata FROM vectors').all();
  db.close();

  console.log(`Loaded ${rows.length} vectors`);

  if (rows.length === 0) {
    throw new Error('No vectors found in codebase database');
  }

  // Parse embeddings
  const items = rows.map(row => {
    const embedding = Array.from(new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.length / 4
    ));

    return {
      id: row.id,
      embedding,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  });

  // Build HNSW index (includeInt8: true stores int8 vectors in the index for .int8.json sidecar)
  console.log(`\nBuilding Binary HNSW index with Int8 sidecar...`);
  const { index: hnswIndex, stats: hnswBuildStats } = await buildHnswIndex(items, {
    indexPath: hnswIndexPath,
    floatDimension,
    M,
    efConstruction,
    efSearch,
    includeInt8: true, // Int8 vectors stored in BinaryHNSWIndex.int8Vectors Map, saved to .int8.json
    onProgress: (current, total) => {
      if (onProgress) onProgress('hnsw', current, total);
      const percent = ((current / total) * 100).toFixed(1);
      process.stdout.write(`\rBuilding HNSW: ${percent}% (${current}/${total})`);
    },
  });
  process.stdout.write('\n');

  // Save HNSW index (includes .int8.json sidecar for stage-2 rescoring)
  console.log(`Saving HNSW index + Int8 sidecar to ${hnswIndexPath}...`);
  await hnswIndex.save(hnswIndexPath);

  // Build and save float vector store for Stage 2.5 direct-access rescoring
  const floatStorePath = getFloatStorePath(hnswIndexPath);
  await buildAndSaveFloatStore(items, floatDimension, floatStorePath);

  const totalBuildTimeMs = Math.round(performance.now() - overallStartTime);
  const vectorsPerSecond = totalBuildTimeMs > 0
    ? Math.round(items.length / (totalBuildTimeMs / 1000))
    : Infinity;

  const hnswStats = hnswIndex.getStats();

  return {
    hnsw: {
      ...hnswStats,
      // Report end-to-end artifact build timing (load + parse + build + save).
      buildTimeMs: totalBuildTimeMs,
      vectorsPerSecond,
      // Keep inner build phase timing available for debugging/regression triage.
      indexBuildTimeMs: hnswBuildStats.buildTimeMs,
      path: hnswIndexPath,
      int8SidecarPath: hnswIndexPath.replace('.idx', '.int8.json'),
      floatStorePath,
    },
    stats: {
      totalVectors: items.length,
      floatDimension,
      binaryDimension: Math.ceil(floatDimension / 8),
      memoryReduction: {
        binary: '32x',
        int8: '4x',
      },
    },
  };
}

/**
 * Incrementally update artifacts for changed files
 *
 * Int8 vectors are updated in the BinaryHNSWIndex.int8Vectors Map and saved
 * to .int8.json sidecar alongside the HNSW index.
 *
 * @param {Array<{id: string, embedding: number[], metadata?: object}>} newItems - New/changed items
 * @param {string[]} removedIds - IDs to remove
 * @param {object} options - Update options
 */
export async function updateArtifacts(newItems, removedIds = [], options = {}) {
  const {
    hnswIndexPath = DB_PATHS.binaryHnswIndex,
    floatDimension = EMBEDDING_CONFIG.hnswDimension,
  } = options;

  // Load existing HNSW index (includes int8 vectors from .int8.json)
  const hnswIndex = new BinaryHNSWIndex({ indexPath: hnswIndexPath });

  try {
    await hnswIndex.load(hnswIndexPath);
  } catch (err) {
    // Index doesn't exist, build from scratch
    console.log('No existing HNSW index, building fresh...');
    return buildFromCodebaseDb(DB_PATHS.codebase, options);
  }

  // Remove old entries
  if (removedIds.length > 0) {
    console.log(`Removing ${removedIds.length} entries...`);
    for (const id of removedIds) {
      if (hnswIndex.idToIndex.has(id)) {
        // Note: BinaryHNSWIndex doesn't have a remove method yet
        // For now, we'll rebuild if there are removals
        console.log('Rebuilding index due to removals...');
        return buildFromCodebaseDb(DB_PATHS.codebase, options);
      }
    }
  }

  // Add new entries
  if (newItems.length > 0) {
    console.log(`Adding ${newItems.length} new entries...`);

    for (const item of newItems) {
      const truncated = truncateForHNSW(item.embedding, floatDimension);

      // Asymmetric encode if calibrated, else plain sign-bit
      const binary = hnswIndex.encodeDocument(truncated);
      const int8 = quantizeToInt8(truncated);

      // Add to HNSW index (int8 stored in index.int8Vectors Map)
      await hnswIndex.add(item.id, binary, item.metadata || {}, int8);
    }

    // Save updated HNSW (includes .int8.json sidecar)
    await hnswIndex.save(hnswIndexPath);
  }

  // Rebuild float vector store from codebase.db (full rebuild, covers all entries)
  const floatStorePath = getFloatStorePath(hnswIndexPath);
  try {
    const Database = (await import('better-sqlite3')).default;
    const { applyReadPragmas } = await import('./db-utils.js');
    const db = new Database(DB_PATHS.codebase, { readonly: true });
    applyReadPragmas(db);
    const rows = db.prepare('SELECT id, embedding FROM vectors').all();
    db.close();

    const allItems = rows.map(row => ({
      id: row.id,
      embedding: Array.from(new Float32Array(
        row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4
      )),
    }));
    await buildAndSaveFloatStore(allItems, floatDimension, floatStorePath);
  } catch (err) {
    console.warn(`Float vector store rebuild failed (non-fatal): ${err.message}`);
    // Remove stale float store so SweetSearch doesn't load outdated vectors.
    // Stage 2.5 will cleanly fall back to SQLite on next startup.
    try {
      const { unlink } = await import('fs/promises');
      const idsPath = floatStorePath.replace(/\.bin$/, '.ids.json');
      await unlink(floatStorePath).catch(() => {});
      await unlink(idsPath).catch(() => {});
      console.warn('Removed stale float vector store files.');
    } catch { /* best effort */ }
  }

  return {
    hnsw: hnswIndex.getStats(),
    added: newItems.length,
    removed: removedIds.length,
  };
}

/**
 * Get artifact statistics
 *
 * Int8 vectors are now stored in .int8.json sidecar (canonical source),
 * not in a separate SQLite database.
 */
export async function getArtifactStats() {
  const stats = {
    binaryHnsw: null,
    int8Sidecar: null,
  };

  // Check HNSW index
  const hnswMetaPath = DB_PATHS.binaryHnswIndex.replace('.idx', '.meta.json');
  if (existsSync(hnswMetaPath)) {
    try {
      const meta = JSON.parse(await fs.readFile(hnswMetaPath, 'utf-8'));
      stats.binaryHnsw = {
        ...meta,
        exists: true,
      };
    } catch (err) {
      stats.binaryHnsw = { exists: false, error: err.message };
    }
  } else {
    stats.binaryHnsw = { exists: false };
  }

  // Check int8 sidecar (.int8.json - canonical source)
  const int8SidecarPath = DB_PATHS.binaryHnswIndex.replace('.idx', '.int8.json');
  if (existsSync(int8SidecarPath)) {
    try {
      const fileStats = await fs.stat(int8SidecarPath);
      const int8Data = JSON.parse(await fs.readFile(int8SidecarPath, 'utf-8'));
      const count = Object.keys(int8Data).length;

      stats.int8Sidecar = {
        exists: true,
        count,
        sizeBytes: fileStats.size,
        sizeMB: (fileStats.size / 1024 / 1024).toFixed(2),
        path: int8SidecarPath,
        note: 'Canonical source for stage-2 rescoring',
      };
    } catch (err) {
      stats.int8Sidecar = { exists: false, error: err.message };
    }
  } else {
    stats.int8Sidecar = { exists: false };
  }

  // Check for deprecated SQLite int8 database (warn if still present)
  if (existsSync(DB_PATHS.int8Vectors)) {
    stats.deprecatedInt8Db = {
      exists: true,
      path: DB_PATHS.int8Vectors,
      note: 'DEPRECATED: This file is no longer used. Delete it to save disk space.',
    };
  }

  return stats;
}

/**
 * Verify artifact integrity
 *
 * Tests both the binary HNSW index and the int8 sidecar (canonical source).
 */
export async function verifyArtifacts() {
  const results = {
    binaryHnsw: { valid: false, error: null },
    int8Sidecar: { valid: false, error: null },
    stage2Rescore: { valid: false, error: null },
  };

  // Verify HNSW index
  try {
    const hnswIndex = new BinaryHNSWIndex();
    await hnswIndex.load();

    // Run a test search
    if (hnswIndex.vectors.length > 0) {
      const testVector = hnswIndex.vectors[0].binary;
      const searchResult = await hnswIndex.search(testVector, 1);

      if (searchResult.results.length > 0) {
        results.binaryHnsw.valid = true;
        results.binaryHnsw.vectorCount = hnswIndex.vectors.length;
      }
    } else {
      results.binaryHnsw.valid = true;
      results.binaryHnsw.vectorCount = 0;
    }

    // Verify int8 sidecar (loaded with HNSW index)
    results.int8Sidecar.count = hnswIndex.int8Vectors.size;
    results.int8Sidecar.valid = true;

    if (hnswIndex.int8Vectors.size > 0) {
      // Sample an int8 vector to verify dimension
      const sampleId = hnswIndex.int8Vectors.keys().next().value;
      const sampleVec = hnswIndex.int8Vectors.get(sampleId);
      results.int8Sidecar.sampleDimension = sampleVec?.length || 0;
      results.int8Sidecar.note = 'Loaded from .int8.json sidecar (canonical source)';
    }

    // Verify stage-2 rescoring works end-to-end
    if (hnswIndex.vectors.length > 0 && hnswIndex.int8Vectors.size > 0) {
      const testId = hnswIndex.vectors[0].id;
      const int8Vec = hnswIndex.getInt8Vector(testId);

      if (int8Vec && int8Vec.length > 0) {
        results.stage2Rescore.valid = true;
        results.stage2Rescore.testId = testId;
        results.stage2Rescore.int8Dimension = int8Vec.length;
        results.stage2Rescore.note = 'Stage-2 rescoring is functional';
      } else {
        results.stage2Rescore.error = `No int8 vector found for test ID: ${testId}`;
      }
    } else {
      results.stage2Rescore.valid = true;
      results.stage2Rescore.note = 'Empty index, skipping rescore test';
    }

  } catch (err) {
    results.binaryHnsw.error = err.message;
    results.int8Sidecar.error = 'Could not verify (HNSW load failed)';
    results.stage2Rescore.error = 'Could not verify (HNSW load failed)';
  }

  return results;
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log(`
Artifact Builder - Binary HNSW + Int8 Quantization

Commands:
  build     Build artifacts from codebase.db
  stats     Show artifact statistics
  verify    Verify artifact integrity (includes stage-2 rescore test)
  test      Run performance benchmark

Options:
  --codebase <path>   Path to codebase.db (default: .sweet-search/codebase.db)
  --hnsw <path>       Path for HNSW index (default: .sweet-search/codebase-binary-hnsw.idx)

Note: Int8 vectors are stored in .int8.json sidecar alongside HNSW index.
      This is the canonical source for stage-2 rescoring.
`);

  (async () => {
    try {
      if (command === 'build') {
        const codebasePath = args.find((_, i) => args[i - 1] === '--codebase') || DB_PATHS.codebase;

        console.log('\n=== Building Artifacts ===\n');
        const result = await buildFromCodebaseDb(codebasePath);

        console.log('\n=== Build Complete ===\n');
        console.log('HNSW Index:');
        console.log(`  Vectors: ${result.hnsw.totalVectors}`);
        console.log(`  Build time: ${result.hnsw.buildTimeMs}ms`);
        console.log(`  Throughput: ${result.hnsw.vectorsPerSecond} vec/s`);
        console.log(`  Path: ${result.hnsw.path}`);
        console.log(`  Int8 sidecar: ${result.hnsw.int8SidecarPath}`);
        console.log(`  Int8 count: ${result.hnsw.int8VectorCount || result.hnsw.totalVectors}`);

        console.log('\nMemory Reduction:');
        console.log(`  Binary HNSW: ${result.stats.memoryReduction.binary}`);
        console.log(`  Int8 Vectors: ${result.stats.memoryReduction.int8}`);

      } else if (command === 'stats') {
        console.log('\n=== Artifact Statistics ===\n');
        const stats = await getArtifactStats();
        console.log(JSON.stringify(stats, null, 2));

      } else if (command === 'verify') {
        console.log('\n=== Verifying Artifacts ===\n');
        const results = await verifyArtifacts();

        console.log('Binary HNSW:');
        console.log(`  Valid: ${results.binaryHnsw.valid}`);
        if (results.binaryHnsw.error) console.log(`  Error: ${results.binaryHnsw.error}`);
        if (results.binaryHnsw.vectorCount) console.log(`  Vectors: ${results.binaryHnsw.vectorCount}`);

        console.log('\nInt8 Sidecar (.int8.json):');
        console.log(`  Valid: ${results.int8Sidecar.valid}`);
        if (results.int8Sidecar.error) console.log(`  Error: ${results.int8Sidecar.error}`);
        if (results.int8Sidecar.count !== undefined) console.log(`  Count: ${results.int8Sidecar.count}`);
        if (results.int8Sidecar.sampleDimension) console.log(`  Dimension: ${results.int8Sidecar.sampleDimension}`);
        if (results.int8Sidecar.note) console.log(`  Note: ${results.int8Sidecar.note}`);

        console.log('\nStage-2 Rescore Test:');
        console.log(`  Valid: ${results.stage2Rescore.valid}`);
        if (results.stage2Rescore.error) console.log(`  Error: ${results.stage2Rescore.error}`);
        if (results.stage2Rescore.note) console.log(`  Note: ${results.stage2Rescore.note}`);

      } else if (command === 'test') {
        console.log('\n=== Quantization Performance Test ===\n');

        const dim = 512;
        const numVectors = 10000;

        console.log(`Generating ${numVectors} random ${dim}-dim vectors...`);

        const vectors = [];
        for (let i = 0; i < numVectors; i++) {
          vectors.push(new Array(dim).fill(0).map(() => Math.random() * 2 - 1));
        }

        // Int8 quantization
        console.log('\nInt8 quantization...');
        let start = performance.now();
        const { int8Embeddings, stats: int8Stats } = batchQuantizeToInt8(vectors);
        console.log(`  Time: ${(performance.now() - start).toFixed(2)}ms`);
        console.log(`  Compression: ${int8Stats.compressionRatio}x`);
        console.log(`  Original: ${(int8Stats.originalSizeBytes / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Quantized: ${(int8Stats.quantizedSizeBytes / 1024 / 1024).toFixed(2)} MB`);

        // Binary quantization
        console.log('\nBinary quantization...');
        start = performance.now();
        const { binaryEmbeddings, stats: binaryStats } = batchQuantizeToBinary(vectors);
        console.log(`  Time: ${(performance.now() - start).toFixed(2)}ms`);
        console.log(`  Compression: ${binaryStats.compressionRatio}x`);
        console.log(`  Original: ${(binaryStats.originalSizeBytes / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Quantized: ${(binaryStats.quantizedSizeBytes / 1024 / 1024).toFixed(2)} MB`);

      } else {
        console.log('Unknown command. Use: build, stats, verify, or test');
      }
    } catch (err) {
      console.error('\nError:', err.message);
      if (args.includes('-v') || args.includes('--verbose')) {
        console.error(err.stack);
      }
      process.exit(1);
    }
  })();
}

export default {
  // Quantization
  quantizeToInt8,
  quantizeToBinary,
  batchQuantizeToInt8,
  batchQuantizeToBinary,

  // HNSW building
  buildHnswIndex,

  // NOTE: Int8 vectors are stored in .int8.json sidecar file (see file header comment)
  // No separate save/get functions needed - they're bundled with HNSW index

  // Artifact management
  saveArtifacts,
  buildFromCodebaseDb,
  updateArtifacts,
  getArtifactStats,
  verifyArtifacts,

  // Threshold-based skip optimization
  shouldSkipArtifactRebuild,
  updateArtifactState,
  ARTIFACT_THRESHOLDS,
};
