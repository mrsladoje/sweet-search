/**
 * Indexer ANN - HNSW, late interaction, and quantized artifact building.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import { existsSync, openSync, fsyncSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';

import { DB_PATHS, HNSW_CONFIG, BINARY_HNSW_CONFIG } from '../infrastructure/config/index.js';
import { HNSWIndex } from '../vector-store/hnsw-index.js';
import { LateInteractionIndex } from '../ranking/late-interaction-index.js';
import { truncateForHNSW, getEmbeddings, getModelInfo, fisherYatesShuffle } from '../embedding/embedding-service.js';
import { buildFromCodebaseDb as buildQuantizedArtifacts, shouldSkipArtifactRebuild, updateArtifactState, ARTIFACT_THRESHOLDS } from './artifact-builder.js';
import { log, logProgress } from './indexer-utils.js';

// =============================================================================
// DURABLE WRITE HELPERS (Phase E — fsync ordering for checkpoint safety)
// =============================================================================

const CHECKPOINT_INTERVAL_SEC = 30;
const MIN_VECTORS_BETWEEN_SAVES = 1000;

function fsyncFile(filePath) {
  const fd = openSync(filePath, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function fsyncDirectory(dirPath) {
  try {
    const fd = openSync(dirPath, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch (_err) {
    // Directory fsync not supported on all platforms (Windows) — best effort
  }
}

function writeCheckpointSidecar(sidecarPath, data) {
  writeFileSync(sidecarPath, JSON.stringify(data, null, 2));
}

function readCheckpointSidecar(sidecarPath) {
  if (!existsSync(sidecarPath)) return null;
  try {
    return JSON.parse(readFileSync(sidecarPath, 'utf-8'));
  } catch (_err) { return null; }
}

function cleanupCheckpoint(indexPath) {
  const checkpointPath = `${indexPath}.checkpoint`;
  const sidecarPath = `${indexPath}.checkpoint.json`;
  try { unlinkSync(checkpointPath); } catch (_e) { /* noop */ }
  try { unlinkSync(sidecarPath); } catch (_e) { /* noop */ }
}

// =============================================================================
// SQLITE VECTOR STREAMING (Phase B — eliminates O(n*d) in-memory arrays)
// =============================================================================

/**
 * Stream vectors from SQLite in the specified order.
 * For 'sequential' order, reads by rowid (no temp table needed).
 * For 'shuffle' or 'diversity', pre-computes order in a temp table.
 */
function* streamVectorsFromDb(db, _dim, order = 'sequential') {
  if (order !== 'sequential') {
    // Pre-compute insertion order in a temp table
    db.exec('CREATE TEMP TABLE IF NOT EXISTS hnsw_order (pos INTEGER PRIMARY KEY, vector_rowid INTEGER)');
    db.exec('DELETE FROM hnsw_order');

    const totalRows = db.prepare('SELECT COUNT(*) as c FROM vectors').get().c;
    let indices = Array.from({ length: totalRows }, (_, i) => i + 1); // rowid is 1-based

    if (order === 'shuffle') {
      fisherYatesShuffle(indices);
    } else if (order === 'diversity') {
      // Read file paths to compute diversity permutation
      const filePaths = db.prepare('SELECT file_path FROM vectors ORDER BY rowid').all().map(r => r.file_path);
      indices = diversityFirstPermutationRowids(filePaths);
    }

    const insertOrder = db.prepare('INSERT INTO hnsw_order (pos, vector_rowid) VALUES (?, ?)');
    db.transaction(() => {
      for (let pos = 0; pos < indices.length; pos++) {
        insertOrder.run(pos, indices[pos]);
      }
    })();

    const stmt = db.prepare(`
      SELECT v.rowid as rowid, v.id, v.file_path, v.embedding, v.metadata
      FROM hnsw_order o
      JOIN vectors v ON v.rowid = o.vector_rowid
      ORDER BY o.pos
    `);
    for (const row of stmt.iterate()) {
      yield {
        rowid: row.rowid,
        id: row.id,
        file: row.file_path,
        embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
      };
    }

    db.exec('DROP TABLE IF EXISTS temp.hnsw_order');
  } else {
    const stmt = db.prepare('SELECT rowid, id, file_path, embedding, metadata FROM vectors ORDER BY rowid');
    for (const row of stmt.iterate()) {
      yield {
        rowid: row.rowid,
        id: row.id,
        file: row.file_path,
        embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
      };
    }
  }
}

/** Diversity-first permutation returning 1-based rowid indices */
function diversityFirstPermutationRowids(filePaths) {
  const buckets = new Map();
  for (let i = 0; i < filePaths.length; i++) {
    const dir = filePaths[i] ? filePaths[i].replace(/\/[^/]+$/, '') : '_unknown';
    if (!buckets.has(dir)) buckets.set(dir, []);
    buckets.get(dir).push(i + 1); // 1-based rowid
  }
  const dirs = [...buckets.keys()];
  fisherYatesShuffle(dirs);
  const order = [];
  let remaining = filePaths.length;
  while (remaining > 0) {
    for (const dir of dirs) {
      const bucket = buckets.get(dir);
      if (bucket.length > 0) { order.push(bucket.shift()); remaining--; }
    }
  }
  return order;
}

// =============================================================================
// INSERTION ORDER TUNING
// =============================================================================

// NOTE: applyInsertionOrder and diversityFirstPermutation (in-memory array permutation)
// removed in Phase B. Insertion order is now handled via SQLite temp tables in
// streamVectorsFromDb() and diversityFirstPermutationRowids().

// =============================================================================
// PHASE 3: HNSW INDEX (Incremental)
// =============================================================================

export async function incrementalUpdateHNSW(dbPath, changedFiles, dryRun = false) {
  log('\n━━━ Phase 3: HNSW Index (Incremental) ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping HNSW incremental update', 'magenta');
    return;
  }

  const modelInfo = getModelInfo();
  const hnswDim = modelInfo.hnswDimension;

  log('Loading existing HNSW index...', 'yellow');
  const index = new HNSWIndex({
    dimension: hnswDim,
    M: HNSW_CONFIG.M,
    efConstruction: HNSW_CONFIG.efConstruction,
    efSearch: HNSW_CONFIG.efSearch,
  });

  let existingCount = 0;
  try {
    await index.load();
    existingCount = index.nextKey;
    log(`✓ Loaded existing index with ${existingCount} vectors`, 'green');
  } catch (err) {
    log(`No existing index found, creating new one`, 'yellow');
    await index.init();
  }

  let removed = 0;
  if (changedFiles && changedFiles.length > 0) {
    log(`Removing entries for ${changedFiles.length} changed files...`, 'yellow');

    const changedFileSet = new Set(changedFiles);
    const idsToRemove = [];
    for (const [id, metadata] of index.metadata.entries()) {
      if (metadata.file && changedFileSet.has(metadata.file)) {
        idsToRemove.push(id);
      }
    }

    for (const id of idsToRemove) {
      await index.remove(id);
      removed++;
    }

    log(`✓ Removed ${removed} old entries`, 'green');
  }

  // Read new vectors for changed files from SQLite
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath, { readonly: true });

  const changedFileSet = new Set(changedFiles || []);
  const placeholders = [...changedFileSet].map(() => '?').join(',');
  const stmt = changedFileSet.size > 0
    ? db.prepare(`SELECT rowid, id, file_path, embedding, metadata FROM vectors WHERE file_path IN (${placeholders}) ORDER BY rowid`)
    : db.prepare('SELECT rowid, id, file_path, embedding, metadata FROM vectors ORDER BY rowid');

  const rows = changedFileSet.size > 0 ? stmt.all(...changedFileSet) : [];
  const totalNew = changedFileSet.size > 0 ? rows.length : 0;

  log(`Adding ${totalNew} new entries...`, 'yellow');
  let added = 0;

  for (const row of rows) {
    const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
    if (!embedding || embedding.length === 0) continue;

    const truncatedEmbedding = truncateForHNSW(embedding);
    const metadata = row.metadata ? JSON.parse(row.metadata) : {};

    await index.add(row.id, truncatedEmbedding, {
      file: row.file_path,
      name: metadata?.symbol,
      type: metadata?.chunk_type,
    });

    added++;

    if (added % 500 === 0 || added === totalNew) {
      logProgress(added, totalNew, 'Adding to HNSW');
    }
  }

  db.close();

  log('\nSaving merged HNSW index...', 'yellow');
  await index.save();

  const stats = index.getStats();
  log(`✓ HNSW index saved (${stats.totalVectors} total vectors, +${added} -${removed})`, 'green');
  log(`  Engine: ${stats.engine}, Dimension: ${hnswDim}d (Matryoshka)`, 'dim');
}

// =============================================================================
// PHASE 3: HNSW INDEX (Full Rebuild)
// =============================================================================

export async function buildHNSWIndex(dbPath, dryRun = false) {
  log('\n━━━ Phase 3: HNSW Index ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping HNSW index', 'magenta');
    return;
  }

  const Database = (await import('better-sqlite3')).default;
  const orderMode = BINARY_HNSW_CONFIG.insertionOrder || 'sequential';
  // Non-sequential orders require temp tables → can't use readonly
  const db = new Database(dbPath, orderMode === 'sequential' ? { readonly: true } : {});

  const totalVectors = db.prepare('SELECT COUNT(*) as c FROM vectors').get().c;
  if (totalVectors === 0) {
    db.close();
    log('No chunks to index', 'yellow');
    return;
  }

  const modelInfo = getModelInfo();
  const hnswDim = modelInfo.hnswDimension;

  const index = new HNSWIndex({
    dimension: hnswDim,
    M: HNSW_CONFIG.M,
    efConstruction: HNSW_CONFIG.efConstruction,
    efSearch: HNSW_CONFIG.efSearch,
    maxElements: Math.max(totalVectors * 2, HNSW_CONFIG.maxElements),
  });

  // Checkpoint resume is only safe with sequential order — non-sequential
  // orders shuffle the stream so rowid is not a reliable resume boundary.
  const canCheckpoint = orderMode === 'sequential';

  const indexPath = DB_PATHS.hnswIndex;
  const usearchPath = indexPath.replace('.idx', '.usearch');
  const checkpointPath = `${usearchPath}.checkpoint`;
  const sidecarPath = `${usearchPath}.checkpoint.json`;
  const sidecar = canCheckpoint ? readCheckpointSidecar(sidecarPath) : null;

  let resumeFromRowId = 0;

  await index.init();

  if (sidecar && existsSync(checkpointPath)) {
    try {
      if (index.index) {
        // Load raw USearch graph from checkpoint
        index.index.load(checkpointPath);
        resumeFromRowId = sidecar.lastRowId || 0;

        // Rebuild JS-side metadata (idMap, reverseMap, metadata, nextKey) for
        // vectors already in the checkpoint. Without this, add() reuses keys
        // from 0 and the final .meta.json would be incomplete.
        const metaStmt = db.prepare(
          'SELECT id, file_path, metadata FROM vectors WHERE rowid <= ? ORDER BY rowid'
        );
        let restoredKey = 0;
        for (const row of metaStmt.iterate(resumeFromRowId)) {
          const meta = row.metadata ? JSON.parse(row.metadata) : {};
          const key = restoredKey++;
          index.idMap.set(row.id, key);
          index.reverseMap.set(key, row.id);
          index.metadata.set(row.id, {
            file: row.file_path,
            name: meta?.symbol,
            type: meta?.chunk_type,
          });
        }
        index.nextKey = restoredKey;

        log(`Resuming from checkpoint: ${sidecar.vectorsAdded} vectors, skipping rowid <= ${resumeFromRowId}`, 'green');
      }
    } catch (err) {
      log(`Checkpoint found but could not load, starting fresh: ${err.message}`, 'yellow');
      resumeFromRowId = 0;
      // Reset any partial metadata restoration
      index.idMap.clear();
      index.reverseMap.clear();
      index.metadata.clear();
      index.nextKey = 0;
    }
  }

  // Discard stale checkpoint from a previous non-sequential build
  if (!canCheckpoint) {
    cleanupCheckpoint(usearchPath);
  }

  log(`Building HNSW index (${modelInfo.dimension}d → ${hnswDim}d Matryoshka, M=${HNSW_CONFIG.M}, order=${orderMode})...`, 'yellow');

  let added = resumeFromRowId > 0 ? (sidecar?.vectorsAdded || 0) : 0;
  let lastCheckpointTime = Date.now();
  let vectorsSinceCheckpoint = 0;

  for (const row of streamVectorsFromDb(db, hnswDim, orderMode)) {
    // Skip already-checkpointed vectors on resume (only valid for sequential order)
    if (resumeFromRowId > 0 && row.rowid <= resumeFromRowId) continue;

    if (!row.embedding || row.embedding.length === 0) continue;

    const truncatedEmbedding = truncateForHNSW(row.embedding);

    await index.add(row.id, truncatedEmbedding, {
      file: row.file,
      name: row.metadata?.symbol,
      type: row.metadata?.chunk_type,
    });

    added++;
    vectorsSinceCheckpoint++;

    // Time-based checkpoint: bounded data loss on crash (~30s max)
    // Only for sequential order where rowid-based resume is valid.
    if (canCheckpoint) {
      const elapsed = (Date.now() - lastCheckpointTime) / 1000;
      if (elapsed >= CHECKPOINT_INTERVAL_SEC && vectorsSinceCheckpoint >= MIN_VECTORS_BETWEEN_SAVES) {
        if (!index.useFallback && index.index) {
          index.index.save(checkpointPath);
          fsyncFile(checkpointPath);
          writeCheckpointSidecar(sidecarPath, {
            vectorsAdded: added,
            lastRowId: row.rowid,
            version: row.rowid,
            timestamp: new Date().toISOString(),
            elapsedMs: Date.now() - lastCheckpointTime,
          });
          fsyncFile(sidecarPath);
          fsyncDirectory(path.dirname(checkpointPath));
          log(`  checkpoint: ${added}/${totalVectors} vectors`, 'dim');
        }
        lastCheckpointTime = Date.now();
        vectorsSinceCheckpoint = 0;
      }
    }

    if (added % 500 === 0 || added === totalVectors) {
      logProgress(added, totalVectors, 'Building HNSW');
    }
  }

  db.close();

  await index.save();

  // Clean up checkpoint files after successful completion
  cleanupCheckpoint(usearchPath);

  const stats = index.getStats();
  log(`\n✓ HNSW index built: ${stats.totalVectors} vectors (${hnswDim}d)`, 'green');
  log(`  Using fallback: ${stats.useFallback}`, 'dim');
}

// =============================================================================
// PHASE 4: LATE INTERACTION INDEX
// =============================================================================

export async function buildLateInteractionIndex(chunks, dryRun = false, filesToRemove = [], options = {}) {
  const {
    poolFactor = 1,
    extendedSkiplist = false,
    loadFromPath = DB_PATHS.lateInteraction,
    saveToPath = loadFromPath,
  } = options;
  log('\n━━━ Phase 4: Late Interaction Index (LateOn-Code) ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping late interaction index', 'magenta');
    return;
  }

  const hasChunks = Array.isArray(chunks) && chunks.length > 0;
  const hasRemovals = Array.isArray(filesToRemove) && filesToRemove.length > 0;
  if (!hasChunks && !hasRemovals) {
    log('No chunks to index', 'yellow');
    return;
  }

  const { LATE_INTERACTION_CONFIG } = await import('../infrastructure/config/index.js');
  if (!LATE_INTERACTION_CONFIG.enabled) {
    log('LateInteraction: Disabled via config', 'yellow');
    return;
  }

  // Default to the product LI quantization, with env vars available for A/B overrides.
  const defaultQuantBits = LATE_INTERACTION_CONFIG.quantization === 'int4' ? 4 : 8;
  const quantBits = parseInt(process.env.SWEET_SEARCH_LI_QUANT_BITS || String(defaultQuantBits), 10);
  const whtSeed = parseInt(process.env.SWEET_SEARCH_LI_WHT_SEED || '0', 10);
  const whtOrdering = process.env.SWEET_SEARCH_LI_WHT_ORDERING || 'natural';

  const liIndex = new LateInteractionIndex({
    tokenDim: LATE_INTERACTION_CONFIG.tokenDimension,
    maxTokens: 512,
    useInt8: quantBits !== 32,
    quantBits,
    whtSeed,
    whtOrdering,
    modelId: LATE_INTERACTION_CONFIG.model,
    indexPath: loadFromPath,
  });
  if (quantBits !== defaultQuantBits || whtSeed !== 0) {
    log(`LI config: quantBits=${quantBits}, whtSeed=${whtSeed}, whtOrdering=${whtOrdering}, poolFactor=${poolFactor}`, 'cyan');
  }

  await liIndex.init();

  // Isolate the write target BEFORE any add() calls can flush segments.
  // Without this, _flushSegment() during add() writes into the live
  // .segments directory, corrupting the served index on a failed rebuild.
  if (saveToPath !== loadFromPath) {
    liIndex.resetForSave(saveToPath);
  }

  let removed = 0;
  if (filesToRemove && filesToRemove.length > 0) {
    log(`Removing entries for ${filesToRemove.length} changed/deleted files...`, 'yellow');

    for (const [id, doc] of liIndex.documents.entries()) {
      const docFile = doc.metadata?.file || id.split(':')[0];
      if (filesToRemove.includes(docFile)) {
        liIndex.documents.delete(id);
        removed++;
      }
    }

    log(`  Removed ${removed} existing entries`, 'dim');
  }

  // Use real LateOn-Code model for per-token embeddings
  const { encodeDocuments } = await import('../ranking/late-interaction-model.js');

  const BATCH_SIZE = 16; // encode 16 chunks at a time
  const totalChunks = hasChunks ? chunks.length : 0;
  let totalAdded = 0;
  const reportInterval = Math.max(1, Math.floor(totalChunks / 20));

  const encodeOpts = {};
  if (poolFactor > 1) encodeOpts.poolFactor = poolFactor;
  if (extendedSkiplist) encodeOpts.extendedSkiplist = true;

  const poolLabel = poolFactor > 1 ? `, pool=${poolFactor}` : '';
  const skipLabel = extendedSkiplist ? ', skiplist=extended' : '';
  if (hasChunks) {
    log(`LateInteraction: Encoding ${totalChunks} chunks with ${LATE_INTERACTION_CONFIG.model} (${LATE_INTERACTION_CONFIG.tokenDimension}d${poolLabel}${skipLabel})...`, 'yellow');

    for (let batchStart = 0; batchStart < totalChunks; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks);
      const batchChunks = chunks.slice(batchStart, batchEnd);
      const batchTexts = batchChunks.map(c => c.text || c.content || '');

      // encodeDocuments handles [D] prefix, tokenization, skiplist filtering, pooling
      const tokenArrays = await encodeDocuments(batchTexts, encodeOpts);

      for (let j = 0; j < batchChunks.length; j++) {
        const chunk = batchChunks[j];
        const tokens = tokenArrays[j];
        if (tokens && tokens.length > 0) {
          await liIndex.add(chunk.id, tokens, {
            file: chunk.file,
            name: chunk.metadata?.symbol,
            type: chunk.metadata?.chunk_type,
            startLine: chunk.metadata?.line_start || null,
            endLine: chunk.metadata?.line_end || null,
            ...(poolFactor > 1 ? { _pooledUpstream: true } : {}),
          });
          totalAdded++;
        }
      }

      log(`  LateInteraction: ${batchEnd}/${totalChunks} chunks (${Math.round(batchEnd / totalChunks * 100)}%)`, 'dim');
    }
  } else {
    log('LateInteraction: No new chunks to encode; applying removals only', 'dim');
  }

  // If paths matched (no staging), resetForSave was not called above; set path now.
  if (saveToPath === loadFromPath) {
    liIndex.indexPath = saveToPath;
  }
  await liIndex.save();

  const liStats = liIndex.getStats();
  log(`\n✓ Late interaction index built: ${liStats.documents} docs, ${liStats.totalTokens} tokens (model: ${liStats.modelId})`, 'green');
  log(`  Avg tokens/doc: ${liStats.avgTokensPerDoc}, Dim: ${liStats.tokenDim}d, Size: ${liStats.estimatedSizeMB} MB`, 'dim');

  return { ...liStats, added: totalAdded, removed, saveToPath };
}

// =============================================================================
// PHASE 5: BINARY HNSW + INT8 QUANTIZED ARTIFACTS
// =============================================================================

export async function buildQuantizedArtifactsPhase(dryRun = false, options = {}) {
  log('\n━━━ Phase 5: Binary HNSW + Int8 Artifacts ━━━', 'bright');

  const { changedFiles = 0, force = false } = options;

  if (dryRun) {
    log('DRY RUN: Skipping quantized artifact building', 'magenta');
    return { binaryHnsw: null, int8: null };
  }

  try {
    if (!existsSync(DB_PATHS.codebase)) {
      log('⚠ Skipping quantized artifacts: codebase.db not found', 'yellow');
      return { binaryHnsw: null, int8: null };
    }

    const skipCheck = await shouldSkipArtifactRebuild({ changedFiles, force });

    if (skipCheck.shouldSkip) {
      log(`Skipping binary artifacts (only ${changedFiles} files changed, threshold is ${ARTIFACT_THRESHOLDS.skipThreshold})`, 'yellow');
      log('  Float HNSW will serve search until next rebuild', 'dim');
      log(`  Accumulated changes: ${skipCheck.accumulatedTotal || changedFiles}`, 'dim');

      await updateArtifactState({
        rebuilt: false,
        changedFiles,
        previousState: skipCheck.state,
      });

      return { binaryHnsw: null, int8: null, skipped: true, reason: skipCheck.reason };
    }

    log('Building quantized artifacts from codebase.db...', 'yellow');
    log(`  Reason: ${skipCheck.reason}`, 'dim');
    log('  Binary HNSW: 32x memory reduction, Hamming distance', 'dim');
    log('  Int8 vectors: 4x memory reduction, stored in .int8.json sidecar', 'dim');

    const result = await buildQuantizedArtifacts(DB_PATHS.codebase, {
      hnswIndexPath: DB_PATHS.binaryHnswIndex,
      onProgress: (phase, current, total) => {},
    });

    const int8Count = result.hnsw.int8VectorCount || result.hnsw.totalVectors;
    const int8SizeMB = ((int8Count * (result.hnsw.floatDimension || 512)) / 1024 / 1024).toFixed(2);

    log(`\n✓ Binary HNSW: ${result.hnsw.totalVectors} vectors (${result.hnsw.buildTimeMs}ms, ${result.hnsw.vectorsPerSecond} vec/s)`, 'green');
    log(`✓ Int8 vectors: ${int8Count} vectors (~${int8SizeMB} MB) → ${result.hnsw.int8SidecarPath}`, 'green');

    await updateArtifactState({
      rebuilt: true,
      changedFiles,
      previousState: skipCheck.state,
    });

    return {
      binaryHnsw: result.hnsw,
      int8: {
        count: int8Count,
        sizeMB: int8SizeMB,
        path: result.hnsw.int8SidecarPath,
      },
    };
  } catch (err) {
    log(`⚠ Quantized artifact building failed: ${err.message}`, 'yellow');
    log('  3-stage retrieval will fall back to float HNSW', 'dim');
    return { binaryHnsw: null, int8: null, error: err.message };
  }
}
