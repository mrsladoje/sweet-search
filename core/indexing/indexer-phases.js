/**
 * Indexer Phases - Phase runner helper and all phase wrappers.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import { DB_PATHS, PROJECT_ROOT, EMBEDDING_CONFIG } from '../infrastructure/config/index.js';
import { getChangedFiles, updateState, getStats as getIncrementalStats } from './incremental-tracker.js';
import { backupSummaries, restoreSummaries, markForRegeneration } from '../graph/summary-manager.js';
import { colors, log, logProgress, logError, discoverFiles, readFilesFromStdin, atomicSwapDatabase } from './indexer-utils.js';
import { buildCodeGraph, buildVectorIndex, chunkFiles } from './indexer-build.js';
import { incrementalUpdateHNSW, buildHNSWIndex, buildLateInteractionIndex, buildQuantizedArtifactsPhase } from './indexer-ann.js';
import { buildSparseGramArtifact } from './indexer-sparse-gram.js';
import { buildChunkGramArtifact } from './indexer-chunk-gram.js';

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function cleanupStagedLateInteractionIndex(stagedPath) {
  await unlinkIfExists(stagedPath);
  await unlinkIfExists(stagedPath + '.bak');
}

async function invalidateLateInteractionIndex() {
  await unlinkIfExists(DB_PATHS.lateInteraction);
  await unlinkIfExists(DB_PATHS.lateInteraction + '.bak');
}

// =============================================================================
// PHASE RUNNER HELPER
// =============================================================================

export async function runPhase(phaseName, phaseFn, options = {}) {
  const startTime = Date.now();
  log(`\n${colors.cyan}>>> ${phaseName}${colors.reset}`, 'cyan');

  try {
    const result = await phaseFn(options);
    const duration = Date.now() - startTime;
    log(`${colors.green}<<< ${phaseName} completed in ${duration}ms${colors.reset}`, 'green');
    return { success: true, result, duration };
  } catch (err) {
    const duration = Date.now() - startTime;
    log(`${colors.red}<<< ${phaseName} failed after ${duration}ms: ${err.message}${colors.reset}`, 'red');
    return { success: false, error: err, duration };
  }
}

// =============================================================================
// EXTRACTED PHASES
// =============================================================================

export async function discoverFilesPhase(options = {}) {
  const { filesFromStdin = false, quiet = false } = options;

  let stdinFiles = null;

  if (filesFromStdin) {
    log('\n--- Reading Files from stdin ---', 'bright');
    stdinFiles = await readFilesFromStdin();

    if (stdinFiles.length === 0) {
      log('No files provided via stdin', 'yellow');
      return { allFiles: [], stdinFiles: [], earlyExit: true, exitReason: 'no_stdin_input' };
    }

    log(`Received ${stdinFiles.length} files from stdin`, 'green');
    if (!quiet && stdinFiles.length <= 20) {
      for (const f of stdinFiles) {
        log(`    - ${f}`, 'dim');
      }
    }
  }

  const allFiles = await discoverFiles();

  if (allFiles.length === 0) {
    log('No files to index', 'yellow');
    return { allFiles: [], stdinFiles, earlyExit: true, exitReason: 'no_files' };
  }

  return { allFiles, stdinFiles, earlyExit: false };
}

export async function determineFilesToIndexPhase(options = {}) {
  const { allFiles, stdinFiles, filesFromStdin, fullReindex, dryRun, quiet } = options;

  let filesToIndex = allFiles;
  let incrementalInfo = null;

  if (filesFromStdin && stdinFiles && stdinFiles.length > 0) {
    log('\n--- Targeted Indexing Mode ---', 'bright');

    const allFilesSet = new Set(allFiles);
    const validStdinFiles = stdinFiles.filter(f => allFilesSet.has(f));

    if (validStdinFiles.length < stdinFiles.length) {
      const skipped = stdinFiles.length - validStdinFiles.length;
      log(`Skipped ${skipped} files (not found in codebase or excluded)`, 'yellow');
    }

    if (validStdinFiles.length === 0) {
      log('No valid files to index from stdin', 'yellow');
      return { filesToIndex: [], incrementalInfo: null, earlyExit: true, exitReason: 'no_valid_files' };
    }

    filesToIndex = validStdinFiles;
    log(`  Targeting ${filesToIndex.length} files for vector/summary updates`, 'green');
    log(`  Graph will still be fully rebuilt (${allFiles.length} files)`, 'dim');

    incrementalInfo = {
      toIndex: filesToIndex,
      toRemove: [],
      unchanged: allFiles.filter(f => !validStdinFiles.includes(f)),
      currentHashes: {},
    };

  } else if (!fullReindex && !dryRun) {
    log('\n--- Checking for Changes ---', 'bright');
    incrementalInfo = await getChangedFiles(allFiles, PROJECT_ROOT);

    if (incrementalInfo.toIndex.length === 0 && incrementalInfo.toRemove.length === 0) {
      log('No changes detected - index is up to date!', 'green');
      log(`  ${incrementalInfo.unchanged.length} files unchanged`, 'dim');
      return { filesToIndex: [], incrementalInfo, earlyExit: true, exitReason: 'no_changes' };
    }

    filesToIndex = incrementalInfo.toIndex;
    log(`  Changed/new: ${incrementalInfo.toIndex.length} files`, 'yellow');
    log(`  Removed: ${incrementalInfo.toRemove.length} files`, 'yellow');
    log(`  Unchanged: ${incrementalInfo.unchanged.length} files`, 'dim');

    if (incrementalInfo.toIndex.length < 20) {
      log('  Files to reindex:', 'dim');
      for (const f of incrementalInfo.toIndex.slice(0, 10)) {
        log(`    - ${f}`, 'dim');
      }
      if (incrementalInfo.toIndex.length > 10) {
        log(`    ... and ${incrementalInfo.toIndex.length - 10} more`, 'dim');
      }
    }
  } else if (fullReindex) {
    log('\n--- Full Reindex Mode ---', 'bright');
  }

  return { filesToIndex, incrementalInfo, earlyExit: false };
}

export async function buildCodeGraphWithHCGSPhase(options = {}) {
  const {
    allFiles,
    filesToIndex,
    dryRun,
    fullReindex,
    filesFromStdin,
    incrementalInfo,
    skipSummaryRegen,
  } = options;

  let summaryBackup = { summaries: [], count: 0 };
  if (!dryRun) {
    summaryBackup = await backupSummaries(DB_PATHS.codeGraph);
    if (summaryBackup.count > 0) {
      log(`Backed up ${summaryBackup.count} existing summaries (with type validation)`, 'green');
    }
    if (summaryBackup.error) {
      log(`Backup partial: ${summaryBackup.error}`, 'yellow');
    }
  }

  if (skipSummaryRegen) {
    log('\nDEPRECATION: --skip-summary-regen is no longer needed', 'yellow');
    log('  Summaries are now ALWAYS automatically preserved across rebuilds', 'dim');
  }

  const graphStats = await buildCodeGraph(allFiles, dryRun);

  if (!dryRun && summaryBackup.count > 0) {
    const restoreResult = await restoreSummaries(DB_PATHS.codeGraph, summaryBackup);
    log(`Restored ${restoreResult.restored} summaries (${restoreResult.skipped.total} skipped - entity removed/type changed)`, 'green');
  }

  let hcgsPromise = null;

  const shouldRunHCGS = !dryRun && (
    fullReindex ||
    filesFromStdin ||
    (incrementalInfo && filesToIndex.length > 0)
  );

  if (shouldRunHCGS) {
    const hcgsMode = fullReindex ? 'Full Regeneration' : 'Changed Files';
    log(`\n--- Preparing HCGS Summaries (${hcgsMode}) ---`, 'bright');

    let entitiesToRegenerate = 0;

    try {
      if (!fullReindex && filesToIndex.length > 0) {
        const markResult = await markForRegeneration(DB_PATHS.codeGraph, filesToIndex);
        entitiesToRegenerate = markResult.marked;
        log(`Marked ${markResult.marked} entities for summary regeneration`, 'green');
      } else if (fullReindex) {
        entitiesToRegenerate = -1;
        log('Will regenerate summaries for all entities', 'yellow');
      }
    } catch (e) {
      log(`Summary marking skipped: ${e.message}`, 'yellow');
    }

    if (entitiesToRegenerate !== 0) {
      hcgsPromise = (async () => {
        try {
          const { generateAllSummaries } = await import('../graph/index.js');
          const { getEmbedding } = await import('../embedding/index.js');
          const summaryResult = await generateAllSummaries({
            dbPath: DB_PATHS.codeGraph,
            verbose: false,
            embedFn: getEmbedding,
          });
          return summaryResult;
        } catch (e) {
          log(`Summary regeneration failed: ${e.message}`, 'yellow');
          log('  Run manually: node hcgs-generator.js generate', 'dim');
          return { generated: 0, skipped: 0, error: e.message };
        }
      })();
    }
  }

  return { graphStats, hcgsPromise };
}

export async function buildVectorsAndArtifactsPhase(options = {}) {
  const {
    filesToIndex,
    dryRun,
    fullReindex,
    incrementalInfo,
    forceArtifacts,
    hcgsPromise,
    noLateInteraction,
    lateInteractionPool,
    lateInteractionExtendedSkiplist,
    sqliteFastMode,
    allFiles,
  } = options;

  // Determine if we can parallelize LI encoding with vector embedding.
  // Requires sufficient RAM + cores (see detectIndexerProfile).
  const shouldParallelLI = !noLateInteraction
    && !dryRun
    && filesToIndex.length > 0
    && EMBEDDING_CONFIG.parallelLateInteraction;
  const stagedLateInteractionPath = DB_PATHS.lateInteraction + '.tmp';

  // When running in parallel, chunk files up front so both encoders share
  // the same chunk list without waiting for each other.
  let preChunked = null;
  if (shouldParallelLI) {
    preChunked = await chunkFiles(filesToIndex);
  }

  const vectorOptions = {
    fullRebuild: fullReindex,
    filesToRemove: incrementalInfo?.toRemove || [],
    sqliteFastMode,
    ...(preChunked && { preChunked }),
  };

  const vectorPromise = buildVectorIndex(filesToIndex, dryRun, vectorOptions);

  // Compute LI file removal list (used by both parallel and sequential paths)
  const filesToRemoveFromLI = incrementalInfo && !fullReindex
    ? [...incrementalInfo.toIndex, ...(incrementalInfo.toRemove || [])]
    : [];

  const buildLateInteraction = (chunks) => buildLateInteractionIndex(chunks, dryRun, filesToRemoveFromLI, {
    poolFactor: lateInteractionPool,
    extendedSkiplist: lateInteractionExtendedSkiplist,
    loadFromPath: DB_PATHS.lateInteraction,
    saveToPath: stagedLateInteractionPath,
  });

  // Start LI encoding in parallel if the platform profile allows it.
  let liPromise = null;
  if (shouldParallelLI && (preChunked.allChunks.length > 0 || filesToRemoveFromLI.length > 0)) {
    liPromise = buildLateInteraction(preChunked.allChunks);
  }

  const runningTasks = [];
  if (hcgsPromise) runningTasks.push('HCGS Summaries');
  runningTasks.push('Vector Embeddings');
  if (liPromise) runningTasks.push('Late Interaction');

  if (runningTasks.length > 1) {
    log(`\n--- Running in Parallel: ${runningTasks.join(' + ')} ---`, 'bright');
    log('  (Independent stages running concurrently for faster indexing)', 'dim');
  }

  const [hcgsResult, vectorOutcome, liOutcome] = await Promise.all([
    hcgsPromise || Promise.resolve(null),
    vectorPromise.then(result => ({ ok: true, result }), error => ({ ok: false, error })),
    liPromise
      ? liPromise.then(result => ({ ok: true, result }), error => ({ ok: false, error }))
      : Promise.resolve({ ok: true, result: null }),
  ]);

  if (hcgsResult && !hcgsResult.error) {
    log(`Summaries regenerated (${hcgsResult.generated} generated, ${hcgsResult.skipped} skipped)`, 'green');
  }

  if (!vectorOutcome.ok) {
    await cleanupStagedLateInteractionIndex(stagedLateInteractionPath);
    throw vectorOutcome.error;
  }

  const vectorResult = vectorOutcome.result;
  const vectorStats = vectorResult || { chunks: 0, embeddings: 0 };

  // HNSW depends on vector embeddings — must run after Promise.all
  try {
    if (!dryRun && vectorResult && vectorResult.allChunks && vectorResult.allEmbeddings) {
      if (incrementalInfo && !fullReindex) {
        const allFilesToRemoveFromHNSW = [
          ...incrementalInfo.toIndex,
          ...(incrementalInfo.toRemove || [])
        ];
        await incrementalUpdateHNSW(vectorResult.allChunks, vectorResult.allEmbeddings, allFilesToRemoveFromHNSW, dryRun);
      } else {
        await buildHNSWIndex(vectorResult.allChunks, vectorResult.allEmbeddings, dryRun);
      }
    }
  } catch (err) {
    await cleanupStagedLateInteractionIndex(stagedLateInteractionPath);
    throw err;
  }

  let lateInteractionResult = liOutcome.result;

  // LI: only run sequentially if not already done in parallel
  if (!liPromise && !dryRun && !noLateInteraction && (vectorResult?.allChunks || filesToRemoveFromLI.length > 0)) {
    try {
      lateInteractionResult = await buildLateInteraction(vectorResult?.allChunks || []);
      liOutcome.ok = true;
    } catch (err) {
      liOutcome.ok = false;
      liOutcome.error = err;
    }
  }

  if (!dryRun && !noLateInteraction && (liPromise || vectorResult?.allChunks || filesToRemoveFromLI.length > 0)) {
    if (liOutcome.ok && lateInteractionResult) {
      await atomicSwapDatabase(stagedLateInteractionPath, DB_PATHS.lateInteraction);
      log('Late interaction index promoted', 'green');
    } else if (!liOutcome.ok) {
      await cleanupStagedLateInteractionIndex(stagedLateInteractionPath);
      await invalidateLateInteractionIndex();
      log(`Late interaction rebuild failed; invalidated existing index: ${liOutcome.error.message}`, 'yellow');
      lateInteractionResult = { error: liOutcome.error.message, invalidated: true };
    }
  }

  if (!dryRun && vectorStats.embeddings > 0) {
    await buildQuantizedArtifactsPhase(dryRun, {
      changedFiles: filesToIndex.length,
      force: forceArtifacts || fullReindex,
    });
  }

  let sparseGramResult = null;
  if (!dryRun && Array.isArray(allFiles) && allFiles.length > 0) {
    sparseGramResult = await buildSparseGramArtifact(allFiles, dryRun);
  }

  let chunkGramResult = null;
  if (!dryRun) {
    // Pass allChunks from the vector/LI pipeline so the chunk gram covers
    // the same corpus as the late interaction index (avoids reading the 4GB LI file).
    const liChunks = vectorResult?.allChunks || preChunked?.allChunks || null;
    chunkGramResult = await buildChunkGramArtifact(dryRun, liChunks);
  }

  return { vectorStats, hcgsResult, lateInteractionResult, sparseGramResult, chunkGramResult };
}

export async function updateIncrementalStatePhase(options = {}) {
  const { dryRun, fullReindex, incrementalInfo, allFiles, vectorStats, graphStats } = options;

  if (dryRun) return;

  if (incrementalInfo) {
    await updateState(incrementalInfo.currentHashes, {
      totalChunks: vectorStats.chunks,
      entities: graphStats.entities,
      relationships: graphStats.relationships
    });
    log('\nIncremental state updated', 'green');
  } else if (fullReindex) {
    const hashes = {};
    const crypto = await import('crypto');
    for (const file of allFiles) {
      try {
        const fullPath = path.join(PROJECT_ROOT, file);
        const [content, stat] = await Promise.all([
          fs.readFile(fullPath, 'utf-8'),
          fs.stat(fullPath).catch(() => null),
        ]);
        hashes[file] = {
          hash: crypto.createHash('sha256').update(content).digest('hex').slice(0, 16),
          size: stat?.size ?? null,
          mtime_ns: stat ? String(BigInt(Math.round(stat.mtimeMs)) * 1000000n) : null,
        };
      } catch (e) { /* skip */ }
    }
    await updateState(hashes, {
      totalChunks: vectorStats.chunks,
      entities: graphStats.entities,
      relationships: graphStats.relationships
    });
    log('\nIncremental state saved', 'green');
  }
}

export function printSummaryPhase(options) {
  const {
    graphStats,
    vectorStats,
    filesToIndex,
    allFiles,
    incrementalInfo,
    vectorsOnly,
    graphOnly,
    fullReindex,
    filesFromStdin,
    quiet,
    startTime,
  } = options;

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const mode = fullReindex ? 'FULL' : (incrementalInfo ? 'INCREMENTAL' : 'FULL');

  log(`\n${'='.repeat(50)}`, 'bright');
  log(`INDEXING COMPLETE (${mode})`, 'bright');
  log(`${'='.repeat(50)}`, 'bright');
  log(`Duration: ${duration}s`, 'dim');
  log(`Files indexed: ${filesToIndex.length}${incrementalInfo ? ` (of ${allFiles.length} total)` : ''}`, 'dim');

  if (!vectorsOnly) {
    log(`Entities: ${graphStats.entities}`, 'dim');
    log(`Relationships: ${graphStats.relationships}`, 'dim');
    if (graphStats.resolved !== undefined) {
      log(`  Resolved: ${graphStats.resolved}`, 'dim');
      if (graphStats.unresolvedTotal > 0) {
        log(`  Unresolved: ${graphStats.unresolvedTotal}`, 'dim');
      }
    }
  }

  if (!graphOnly) {
    log(`Chunks: ${vectorStats.chunks}`, 'dim');
    log(`Embeddings: ${vectorStats.embeddings}`, 'dim');
  }

  log('', 'reset');
  log('Indexes created:', 'green');
  if (!vectorsOnly) log(`  - ${DB_PATHS.codeGraph}`, 'green');
  if (!graphOnly) {
    log(`  - ${DB_PATHS.codebase}`, 'green');
    log(`  - ${DB_PATHS.hnswIndex}`, 'green');
    if (existsSync(DB_PATHS.binaryHnswIndex.replace('.idx', '.meta.json'))) {
      log(`  - ${DB_PATHS.binaryHnswIndex} (Binary HNSW, 32x smaller)`, 'green');
    }
    if (existsSync(DB_PATHS.int8Vectors)) {
      log(`  - ${DB_PATHS.int8Vectors} (Int8 vectors, 4x smaller)`, 'green');
    }
  }

  if (quiet) {
    console.log(JSON.stringify({
      success: true,
      filesProcessed: filesToIndex.length,
      entities: graphStats.entities,
      relationships: graphStats.relationships,
      chunks: vectorStats.chunks,
      embeddings: vectorStats.embeddings,
      durationSeconds: parseFloat(duration),
      mode: filesFromStdin ? 'targeted' : mode.toLowerCase(),
    }));
  }
}
