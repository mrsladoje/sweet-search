/**
 * Indexer ANN - HNSW, ColBERT, and quantized artifact building.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import { existsSync } from 'fs';

import { DB_PATHS, HNSW_CONFIG } from './config.js';
import { HNSWIndex } from './hnsw-index.js';
import { ColBERTIndex } from './colbert-index.js';
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
// PHASE 4: COLBERT INDEX (Late Interaction)
// =============================================================================

export async function buildColBERTIndex(chunks, dryRun = false, filesToRemove = []) {
  log('\n━━━ Phase 4: ColBERT Index ━━━', 'bright');

  if (dryRun) {
    log('DRY RUN: Skipping ColBERT index', 'magenta');
    return;
  }

  if (!chunks || chunks.length === 0) {
    log('No chunks to index', 'yellow');
    return;
  }

  const colbert = new ColBERTIndex({
    tokenDim: 64,
    maxTokens: 32,
    useInt8: true,
  });

  await colbert.init();

  if (filesToRemove && filesToRemove.length > 0) {
    log(`Removing entries for ${filesToRemove.length} changed/deleted files...`, 'yellow');

    let removed = 0;
    for (const [id, doc] of colbert.documents.entries()) {
      const docFile = doc.metadata?.file || id.split(':')[0];
      if (filesToRemove.includes(docFile)) {
        colbert.documents.delete(id);
        removed++;
      }
    }

    log(`  Removed ${removed} existing entries`, 'dim');
  }

  const MAX_LINES_PER_CHUNK = 16;
  const MIN_LINE_LENGTH = 10;
  const MAX_LINE_LENGTH = 200;

  log(`ColBERT: Extracting pseudo-tokens from ${chunks.length} chunks...`, 'yellow');

  const allLines = [];
  const lineToChunk = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const text = chunk.text || chunk.content || '';

    const lines = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length >= MIN_LINE_LENGTH)
      .slice(0, MAX_LINES_PER_CHUNK)
      .map(line => line.slice(0, MAX_LINE_LENGTH));

    for (const line of lines) {
      allLines.push(line);
      lineToChunk.push(i);
    }
  }

  log(`  Extracted ${allLines.length} lines from ${chunks.length} chunks`, 'dim');

  if (allLines.length === 0) {
    log('No valid lines found for ColBERT indexing', 'yellow');
    return;
  }

  const MEGA_BATCH_SIZE = 10_000;

  log('ColBERT: Generating line embeddings (mega-batch)...', 'yellow');

  const totalLines = allLines.length;
  let embedded = 0;
  const reportInterval = Math.max(1000, Math.floor(totalLines / 20));

  let totalAdded = 0;

  for (let megaStart = 0; megaStart < allLines.length; megaStart += MEGA_BATCH_SIZE) {
    const megaEnd = Math.min(megaStart + MEGA_BATCH_SIZE, allLines.length);
    const megaBatch = allLines.slice(megaStart, megaEnd);

    const megaResults = await getEmbeddings(megaBatch, {
      useCache: false,
      providerOptions: {
        maxLength: 256,
        resolveHardCap: (candidateLongest) => (candidateLongest <= 128 ? 128 : 64),
      },
    });
    const megaEmbeddings = megaResults.map(r => r.embedding);

    embedded += megaEmbeddings.length;
    if (embedded % reportInterval < megaEmbeddings.length || embedded === totalLines) {
      log(`  ColBERT: ${embedded}/${totalLines} lines (${Math.round(embedded / totalLines * 100)}%)`, 'dim');
    }

    const chunkTokens = new Map();
    for (let j = 0; j < megaEmbeddings.length; j++) {
      const chunkIdx = lineToChunk[megaStart + j];
      if (!chunkTokens.has(chunkIdx)) {
        chunkTokens.set(chunkIdx, []);
      }
      chunkTokens.get(chunkIdx).push(megaEmbeddings[j]);
    }

    for (const [chunkIdx, tokens] of chunkTokens) {
      const chunk = chunks[chunkIdx];
      await colbert.add(chunk.id, tokens, {
        file: chunk.file,
        name: chunk.metadata?.symbol,
      });
      totalAdded++;
    }
  }

  log(`\nColBERT: Building token index... (${totalAdded} chunks indexed)`, 'yellow');

  await colbert.save();

  const colbertStats = colbert.getStats();
  log(`\n✓ ColBERT index built: ${colbertStats.documents} docs, ${colbertStats.totalTokens} tokens`, 'green');
  log(`  Avg tokens/doc: ${colbertStats.avgTokensPerDoc}, Size: ${colbertStats.estimatedSizeMB} MB`, 'dim');

  return colbertStats;
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
