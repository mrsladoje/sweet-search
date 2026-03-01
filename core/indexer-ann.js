/**
 * Indexer ANN - HNSW, late interaction, and quantized artifact building.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import { existsSync } from 'fs';

import { DB_PATHS, HNSW_CONFIG } from './config.js';
import { HNSWIndex } from './hnsw-index.js';
import { LateInteractionIndex } from './late-interaction-index.js';
import { truncateForHNSW, getEmbeddings, getModelInfo } from './embedding-service.js';
import { buildFromCodebaseDb as buildQuantizedArtifacts, shouldSkipArtifactRebuild, updateArtifactState, ARTIFACT_THRESHOLDS } from './artifact-builder.js';
import { log, logProgress } from './indexer-utils.js';

// =============================================================================
// PHASE 3: HNSW INDEX (Incremental)
// =============================================================================

export async function incrementalUpdateHNSW(newChunks, newEmbeddings, changedFiles, dryRun = false) {
  log('\n━━━ Phase 3: HNSW Index (Incremental) ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping HNSW incremental update', 'magenta');
    return;
  }

  if (!newChunks || !newEmbeddings || newChunks.length === 0) {
    log('No new chunks to add', 'yellow');
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

  log(`Adding ${newChunks.length} new entries...`, 'yellow');
  let added = 0;

  for (let i = 0; i < newChunks.length; i++) {
    const chunk = newChunks[i];
    const embedding = newEmbeddings[i];

    if (!embedding || embedding.length === 0) continue;

    const truncatedEmbedding = truncateForHNSW(embedding);

    await index.add(chunk.id, truncatedEmbedding, {
      file: chunk.file,
      name: chunk.metadata?.symbol,
      type: chunk.metadata?.chunk_type,
    });

    added++;

    if (added % 500 === 0 || i === newChunks.length - 1) {
      logProgress(added, newChunks.length, 'Adding to HNSW');
    }
  }

  log('\nSaving merged HNSW index...', 'yellow');
  await index.save();

  const stats = index.getStats();
  log(`✓ HNSW index saved (${stats.totalVectors} total vectors, +${added} -${removed})`, 'green');
  log(`  Engine: ${stats.engine}, Dimension: ${hnswDim}d (Matryoshka)`, 'dim');
}

// =============================================================================
// PHASE 3: HNSW INDEX (Full Rebuild)
// =============================================================================

export async function buildHNSWIndex(chunks, embeddings, dryRun = false) {
  log('\n━━━ Phase 3: HNSW Index ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping HNSW index', 'magenta');
    return;
  }

  if (!chunks || !embeddings || chunks.length === 0) {
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
    maxElements: Math.max(chunks.length * 2, HNSW_CONFIG.maxElements),
  });

  await index.init();

  log(`Building HNSW index (${modelInfo.dimension}d → ${hnswDim}d Matryoshka, M=${HNSW_CONFIG.M})...`, 'yellow');

  let added = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];

    if (!embedding || embedding.length === 0) continue;

    const truncatedEmbedding = truncateForHNSW(embedding);

    await index.add(chunk.id, truncatedEmbedding, {
      file: chunk.file,
      name: chunk.metadata?.symbol,
      type: chunk.metadata?.chunk_type,
    });

    added++;

    if (added % 500 === 0 || i === chunks.length - 1) {
      logProgress(added, chunks.length, 'Building HNSW');
    }
  }

  await index.save();

  const stats = index.getStats();
  log(`\n✓ HNSW index built: ${stats.totalVectors} vectors (${hnswDim}d)`, 'green');
  log(`  Using fallback: ${stats.useFallback}`, 'dim');
}

// =============================================================================
// PHASE 4: LATE INTERACTION INDEX
// =============================================================================

export async function buildLateInteractionIndex(chunks, dryRun = false, filesToRemove = [], options = {}) {
  const { poolFactor = 1, extendedSkiplist = false } = options;
  log('\n━━━ Phase 4: Late Interaction Index (LateOn-Code) ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping late interaction index', 'magenta');
    return;
  }

  if (!chunks || chunks.length === 0) {
    log('No chunks to index', 'yellow');
    return;
  }

  const { LATE_INTERACTION_CONFIG } = await import('./config.js');
  if (!LATE_INTERACTION_CONFIG.enabled) {
    log('LateInteraction: Disabled via config', 'yellow');
    return;
  }

  const liIndex = new LateInteractionIndex({
    tokenDim: LATE_INTERACTION_CONFIG.tokenDimension,
    maxTokens: 512,
    useInt8: true,
    modelId: LATE_INTERACTION_CONFIG.model,
  });

  await liIndex.init();

  if (filesToRemove && filesToRemove.length > 0) {
    log(`Removing entries for ${filesToRemove.length} changed/deleted files...`, 'yellow');

    let removed = 0;
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
  const { encodeDocuments } = await import('./late-interaction-model.js');

  const BATCH_SIZE = 16; // encode 16 chunks at a time
  const totalChunks = chunks.length;
  let totalAdded = 0;
  const reportInterval = Math.max(1, Math.floor(totalChunks / 20));

  const encodeOpts = {};
  if (poolFactor > 1) encodeOpts.poolFactor = poolFactor;
  if (extendedSkiplist) encodeOpts.extendedSkiplist = true;

  const poolLabel = poolFactor > 1 ? `, pool=${poolFactor}` : '';
  const skipLabel = extendedSkiplist ? ', skiplist=extended' : '';
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
        });
        totalAdded++;
      }
    }

    if ((batchStart + BATCH_SIZE) % (reportInterval * BATCH_SIZE) < BATCH_SIZE || batchEnd === totalChunks) {
      log(`  LateInteraction: ${batchEnd}/${totalChunks} chunks (${Math.round(batchEnd / totalChunks * 100)}%)`, 'dim');
    }
  }

  await liIndex.save();

  const liStats = liIndex.getStats();
  log(`\n✓ Late interaction index built: ${liStats.documents} docs, ${liStats.totalTokens} tokens (model: ${liStats.modelId})`, 'green');
  log(`  Avg tokens/doc: ${liStats.avgTokensPerDoc}, Dim: ${liStats.tokenDim}d, Size: ${liStats.estimatedSizeMB} MB`, 'dim');

  return liStats;
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
