#!/usr/bin/env node

/**
 * Artifact Builder for Binary HNSW + Int8 Quantization
 *
 * Builds optimized index artifacts for 3-stage retrieval:
 *   Stage 1: Binary HNSW (1000 candidates, ~100μs, 32x memory reduction)
 *   Stage 2: Int8 rescore (100 candidates, ~1ms, 4x memory reduction)
 *   Stage 3: Rerank (top 20 → k)
 *
 * Artifact produced: .sweet-search/codebase-binary-hnsw.idx. The int8 rows for
 * stage-2 rescoring live in that same file and are loaded with the HNSW index
 * (O(1) lookup, no SQLite round trip).
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
import { DB_PATHS, BINARY_HNSW_CONFIG, EMBEDDING_CONFIG, PROJECT_ROOT } from '../infrastructure/config/index.js';

/**
 * Threshold configuration for skipping binary artifact rebuilds.
 *
 * Skip rebuild if: changedFiles < SKIP_THRESHOLD
 * This saves ~30s+ for small incremental updates.
 */
export const ARTIFACT_THRESHOLDS = {
  /** Minimum changed files to trigger binary artifact rebuild */
  skipThreshold: 10,

  /** Maximum time (ms) since last rebuild before forcing rebuild (5 minutes) */
  maxAgeSinceRebuild: 5 * 60 * 1000,

  /** State file tracking last rebuild timestamp */
  stateFile: '.sweet-search/artifact-rebuild-state.json',
};

import { BinaryHNSWIndex, binaryHnswIndexExists, readIndexHeader } from '../vector-store/binary-hnsw-index.js';
import { truncateForHNSW, fisherYatesShuffle, normalizedFloatToInt8, floatToBinary } from '../infrastructure/quantization.js';
import { FloatVectorStore, getFloatStorePath, float512StoreEnabled } from '../vector-store/float-vector-store.js';
import { liveVectorSql } from './vector-visibility.js';


async function loadArtifactState() {
  const statePath = path.resolve(PROJECT_ROOT, ARTIFACT_THRESHOLDS.stateFile);
  try {
    if (existsSync(statePath)) {
      const data = JSON.parse(await fs.readFile(statePath, 'utf-8'));
      return {
        lastRebuildTimestamp: data.lastRebuildTimestamp || 0,
        accumulatedChanges: data.accumulatedChanges || 0,
      };
    }
  } catch (err) {
  }
  return { lastRebuildTimestamp: 0, accumulatedChanges: 0 };
}

async function saveArtifactState(state) {
  const statePath = path.resolve(PROJECT_ROOT, ARTIFACT_THRESHOLDS.stateFile);
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

  if (force) {
    return {
      shouldSkip: false,
      reason: 'Force rebuild requested via --force-artifacts',
      state,
    };
  }

  if (accumulatedTotal >= ARTIFACT_THRESHOLDS.skipThreshold) {
    return {
      shouldSkip: false,
      reason: `Accumulated changes (${accumulatedTotal}) >= threshold (${ARTIFACT_THRESHOLDS.skipThreshold})`,
      state,
    };
  }

  if (state.lastRebuildTimestamp > 0 && timeSinceRebuild >= ARTIFACT_THRESHOLDS.maxAgeSinceRebuild) {
    return {
      shouldSkip: false,
      reason: `Time since last rebuild (${Math.round(timeSinceRebuild / 1000)}s) >= max age (${ARTIFACT_THRESHOLDS.maxAgeSinceRebuild / 1000}s)`,
      state,
    };
  }

  if (!binaryHnswIndexExists(DB_PATHS.binaryHnswIndex)) {
    return {
      shouldSkip: false,
      reason: 'No existing binary HNSW artifacts found',
      state,
    };
  }

  return {
    shouldSkip: true,
    reason: `Only ${changedFiles} files changed (threshold: ${ARTIFACT_THRESHOLDS.skipThreshold})`,
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
    await saveArtifactState({
      lastRebuildTimestamp: Date.now(),
      accumulatedChanges: 0,
    });
  } else {
    const accumulated = (previousState.accumulatedChanges || 0) + changedFiles;
    await saveArtifactState({
      lastRebuildTimestamp: previousState.lastRebuildTimestamp || 0,
      accumulatedChanges: accumulated,
    });
  }
}

/**
 * Quantize float32 to int8 (-128 to 127), linear with clipping. 4x smaller,
 * <1% accuracy loss for normalized embeddings (input assumed in -1..1).
 * Delegates to normalizedFloatToInt8, the single source of truth.
 */
export function quantizeToInt8(float32Array) {
  return normalizedFloatToInt8(float32Array);
}

export function quantizeToBinary(float32Array) {
  return floatToBinary(float32Array);
}

function batchQuantizeToInt8(embeddings) {
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

function batchQuantizeToBinary(embeddings) {
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
  // int8 rows may use another prefix width than the codes (bench K4: 512 or all dims); default the same.
  const int8Dimension = options.int8Dimension || floatDimension;
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

  const truncated = items.map(item => truncateForHNSW(item.embedding, floatDimension));

  // Shuffled insertion order (index permutation keeps items↔embeddings paired).
  const order = Array.from({ length: items.length }, (_, i) => i);
  fisherYatesShuffle(order);

  const startTime = performance.now();
  let processed = 0;

  for (const idx of order) {
    const item = items[idx];
    const binary = floatToBinary(truncated[idx]);

    const int8 = includeInt8
      ? quantizeToInt8(int8Dimension === floatDimension ? truncated[idx] : truncateForHNSW(item.embedding, int8Dimension))
      : null;

    await index.addDeferred(item.id, binary, item.metadata || {}, int8, item.embedding);

    processed++;
    if (onProgress && processed % 500 === 0 && processed < items.length) {
      onProgress(processed, items.length);
    }
  }
  // The graph: the lists the per-insert loop gives, built on every core (linkGraph).
  const link = await index.linkGraph();
  if (onProgress && items.length > 0) onProgress(items.length, items.length);

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
      insertionOrder: 'shuffle',
      linkNative: link.native,
      linkThreads: link.threads,
      linkRedos: link.redos,
    },
  };
}

/**
 * Build Binary HNSW index by streaming from a SQLite database.
 * Eliminates the O(n*d) items[] + truncated[] arrays (~400+ MB at 100K vectors).
 * Pre-computes insertion order in a temp table, then streams in that order.
 */
async function buildHnswIndexFromDb(db, options = {}) {
  const {
    M = BINARY_HNSW_CONFIG.M,
    efConstruction = BINARY_HNSW_CONFIG.efConstruction,
    efSearch = BINARY_HNSW_CONFIG.efSearch,
    floatDimension = BINARY_HNSW_CONFIG.floatDimension,
    indexPath = DB_PATHS.binaryHnswIndex,
    includeInt8 = true,
    onProgress = null,
  } = options;

  const dimension = options.dimension || Math.ceil(floatDimension / 8);
  const vectorWhere = liveVectorSql();
  const totalVectors = db.prepare(`SELECT COUNT(*) as c FROM vectors WHERE ${vectorWhere}`).get().c;

  const index = new BinaryHNSWIndex({
    dimension,
    floatDimension,
    M,
    efConstruction,
    efSearch,
    indexPath,
  });

  index.resetForBuild();

  // Shuffled insertion order, precomputed in a temp table.
  db.exec('CREATE TEMP TABLE IF NOT EXISTS artifact_order (pos INTEGER PRIMARY KEY, vector_rowid INTEGER)');
  db.exec('DELETE FROM artifact_order');
  const indices = db.prepare(`SELECT rowid FROM vectors WHERE ${vectorWhere} ORDER BY rowid`).all().map((row) => row.rowid);
  fisherYatesShuffle(indices);
  const insertOrder = db.prepare('INSERT INTO artifact_order (pos, vector_rowid) VALUES (?, ?)');
  db.transaction(() => {
    for (let pos = 0; pos < indices.length; pos++) {
      insertOrder.run(pos, indices[pos]);
    }
  })();
  const stmt = db.prepare(`
    SELECT v.id, v.embedding, v.metadata
    FROM artifact_order o
    JOIN vectors v ON v.rowid = o.vector_rowid
    ORDER BY o.pos
  `);

  const startTime = performance.now();
  let processed = 0;

  for (const row of stmt.iterate()) {
    const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
    const truncated = truncateForHNSW(embedding, floatDimension);
    const binary = floatToBinary(truncated);
    const int8 = includeInt8 ? quantizeToInt8(truncated) : null;
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};

    await index.addDeferred(row.id, binary, metadata, int8, embedding);

    processed++;
    if (onProgress && processed % 500 === 0 && processed < totalVectors) {
      onProgress(processed, totalVectors);
    }
  }
  const link = await index.linkGraph();
  if (onProgress && totalVectors > 0) onProgress(totalVectors, totalVectors);

  db.exec('DROP TABLE IF EXISTS temp.artifact_order');

  const buildTime = performance.now() - startTime;

  return {
    index,
    stats: {
      vectorCount: totalVectors,
      buildTimeMs: Math.round(buildTime),
      vectorsPerSecond: Math.round(totalVectors / (buildTime / 1000)),
      dimension,
      floatDimension,
      M,
      efConstruction,
      insertionOrder: 'shuffle',
      linkNative: link.native,
      linkThreads: link.threads,
      linkRedos: link.redos,
    },
  };
}

/**
 * Build all artifacts from embeddings stored in codebase.db. Int8 rows go into
 * the binary HNSW index file.
 *
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
async function buildAndSaveFloatStoreFromDb(db, floatDimension, floatStorePath) {
  const vectorWhere = liveVectorSql();
  const totalVectors = db.prepare(`SELECT COUNT(*) as c FROM vectors WHERE ${vectorWhere}`).get().c;
  console.log(`Building float vector store (${totalVectors} vectors, ${floatDimension}d)...`);
  const floatStore = new FloatVectorStore();
  const floatEntries = [];
  const stmt = db.prepare(`SELECT id, embedding FROM vectors WHERE ${vectorWhere} ORDER BY rowid`);
  for (const row of stmt.iterate()) {
    const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
    floatEntries.push({
      id: row.id,
      vector: truncateForHNSW(embedding, floatDimension),
    });
  }
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

  console.log(`\nStreaming embeddings from ${codebaseDbPath}...`);

  const Database = (await import('better-sqlite3')).default;
  const { applyReadPragmas } = await import('../infrastructure/db-utils.js');
  // The shuffled insertion order uses a temp table, so the connection is not readonly.
  const db = new Database(codebaseDbPath);
  applyReadPragmas(db);

  const totalVectors = db.prepare(`SELECT COUNT(*) as c FROM vectors WHERE ${liveVectorSql()}`).get().c;

  console.log(`Found ${totalVectors} vectors`);

  if (totalVectors === 0) {
    db.close();
    throw new Error('No vectors found in codebase database');
  }

  // Build HNSW index by streaming from SQLite — no full items[] array needed.
  // Pre-compute insertion order in a temp table, then stream in that order.
  console.log(`\nBuilding Binary HNSW index with Int8 sidecar...`);
  const { index: hnswIndex, stats: hnswBuildStats } = await buildHnswIndexFromDb(db, {
    indexPath: hnswIndexPath,
    floatDimension,
    M,
    efConstruction,
    efSearch,
    includeInt8: true,
    onProgress: (current, total) => {
      if (onProgress) onProgress('hnsw', current, total);
      const percent = ((current / total) * 100).toFixed(1);
      process.stdout.write(`\rBuilding HNSW: ${percent}% (${current}/${total})`);
    },
  });
  process.stdout.write('\n');

  console.log(`Saving HNSW index + Int8 sidecar to ${hnswIndexPath}...`);
  await hnswIndex.save(hnswIndexPath);

  // Float vector store for Stage 2.5 (streamed) — only when that stage is on.
  const floatStorePath = getFloatStorePath(hnswIndexPath);
  if (float512StoreEnabled()) await buildAndSaveFloatStoreFromDb(db, floatDimension, floatStorePath);

  db.close();

  const totalBuildTimeMs = Math.round(performance.now() - overallStartTime);
  const vectorsPerSecond = totalBuildTimeMs > 0
    ? Math.round(totalVectors / (totalBuildTimeMs / 1000))
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
      // The graph build: native on linkThreads threads, or the JS loop (linkNative false).
      linkNative: hnswBuildStats.linkNative,
      linkThreads: hnswBuildStats.linkThreads,
      path: hnswIndexPath,
      floatStorePath,
    },
    stats: {
      totalVectors,
      floatDimension,
      binaryDimension: Math.ceil(floatDimension / 8),
      memoryReduction: {
        binary: '32x',
        int8: '4x',
      },
    },
  };
}

export async function getArtifactStats() {
  const stats = {
    binaryHnsw: null,
    int8Sidecar: null,
  };

  // header only; int8 rows are in the same file
  const head = readIndexHeader(DB_PATHS.binaryHnswIndex);
  if (head) {
    const { header } = head;
    const { sections: _sections, levels: _levels, ...meta } = header;
    stats.binaryHnsw = { ...meta, vectorCount: header.count, exists: true };
    stats.int8Sidecar = header.int8Count > 0
      ? {
        exists: true,
        count: header.int8Count,
        dimension: header.int8Dim,
        path: DB_PATHS.binaryHnswIndex,
        note: 'Canonical source for stage-2 rescoring (in the index file)',
      }
      : { exists: false };
  } else {
    stats.binaryHnsw = { exists: false };
    stats.int8Sidecar = { exists: false };
  }

  return stats;
}

export async function verifyArtifacts() {
  const results = {
    binaryHnsw: { valid: false, error: null },
    int8Sidecar: { valid: false, error: null },
    stage2Rescore: { valid: false, error: null },
  };

  try {
    const hnswIndex = new BinaryHNSWIndex();
    await hnswIndex.load();

    if (hnswIndex.size > 0) {
      const testVector = hnswIndex.nodeBinary(0);
      const searchResult = await hnswIndex.search(testVector, 1);

      if (searchResult.results.length > 0) {
        results.binaryHnsw.valid = true;
        results.binaryHnsw.vectorCount = hnswIndex.size;
      }
    } else {
      results.binaryHnsw.valid = true;
      results.binaryHnsw.vectorCount = 0;
    }

    const int8Count = hnswIndex.int8Count();
    results.int8Sidecar.count = int8Count;
    results.int8Sidecar.valid = true;

    if (int8Count > 0) {
      let node = 0;
      while (!hnswIndex.nodeInt8(node)) node++;
      results.int8Sidecar.sampleDimension = hnswIndex.nodeInt8(node).length;
      results.int8Sidecar.note = 'Loaded from the index file (canonical source)';
    }

    if (hnswIndex.size > 0 && int8Count > 0) {
      const testId = hnswIndex.nodeId(0);
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

        console.log('\nInt8 quantization...');
        let start = performance.now();
        const { stats: int8Stats } = batchQuantizeToInt8(vectors);
        console.log(`  Time: ${(performance.now() - start).toFixed(2)}ms`);
        console.log(`  Compression: ${int8Stats.compressionRatio}x`);
        console.log(`  Original: ${(int8Stats.originalSizeBytes / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Quantized: ${(int8Stats.quantizedSizeBytes / 1024 / 1024).toFixed(2)} MB`);

        console.log('\nBinary quantization...');
        start = performance.now();
        const { stats: binaryStats } = batchQuantizeToBinary(vectors);
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
  quantizeToInt8,
  quantizeToBinary,
  batchQuantizeToInt8,
  batchQuantizeToBinary,
  buildHnswIndex,
  buildFromCodebaseDb,
  getArtifactStats,
  verifyArtifacts,
  shouldSkipArtifactRebuild,
  updateArtifactState,
  ARTIFACT_THRESHOLDS,
};
