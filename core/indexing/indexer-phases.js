/**
 * Indexer Phases - Phase runner helper and all phase wrappers.
 * Extracted from index-codebase-v21.js for file size compliance (<500 lines).
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import { DB_PATHS, PROJECT_ROOT, EMBEDDING_CONFIG, HCGS_CONFIG } from '../infrastructure/config/index.js';
import { getChangedFiles, updateState, getStats as getIncrementalStats, updatePhaseProgress, markPhaseComplete, clearPhaseProgress } from './incremental-tracker.js';
import { backupSummaries, restoreSummaries, markForRegeneration } from '../graph/summary-manager.js';
import { colors, log, logProgress, logError, discoverFiles, readFilesFromStdin, atomicSwapDatabase } from './indexer-utils.js';
import { buildCodeGraph, buildVectorIndex, chunkFiles } from './indexer-build.js';
import { runDedupPhase, formatDedupSummary } from './dedup/dedup-phase.js';
import { DEDUP_CONFIG } from '../infrastructure/config/index.js';
import { incrementalUpdateHNSW, buildHNSWIndex, buildLateInteractionIndex, buildQuantizedArtifactsPhase } from './indexer-ann.js';
import { buildSparseGramArtifact } from './indexer-sparse-gram.js';
import {
  configureLocalModelRuntime,
  resetLocalModelRuntime,
} from '../embedding/embedding-local-model.js';
import { isNativeInferenceAvailable } from '../infrastructure/native-inference.js';
import { teardownAllModels, initIndexGpuPool, teardownIndexGpuPool, warmupQueryCpuModels, GPU_ARMING_MIN_FILES } from './model-pool.js';
import {
  configureLateInteractionRuntime,
  resetLateInteractionRuntime,
} from '../ranking/late-interaction-model.js';
import {
  planAllocation,
  initEmbeddingPool,
  shutdownEmbeddingPool,
} from './indexer-pool.js';

async function unlinkIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function rmDirIfExists(dirPath) {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Path where the LateInteractionIndex should stage its segment files during
 * a stage-and-swap rebuild. MUST NOT collide with the live
 * {finalPath}.segments directory — using {live}.tmp.segments (the old behavior)
 * aliases into the live path once the atomic stub rename promotes
 * {live}.tmp → {live} because {stagedStub}.segments and {live}.segments share
 * the same basename form via the `.tmp` suffix.
 */
function stagedLateInteractionSegmentDir(stagedStubPath) {
  return stagedStubPath + '-stage.segments';
}

async function cleanupStagedLateInteractionIndex(stagedPath, finalPath = DB_PATHS.lateInteraction) {
  await unlinkIfExists(stagedPath);
  await unlinkIfExists(stagedPath + '.bak');
  // Also remove the staged segments directory — a failed rebuild must leave
  // no orphan segment files on disk.
  await rmDirIfExists(stagedLateInteractionSegmentDir(stagedPath));
  // And remove the .segments.bak sidecar that `atomicSwapLateInteractionIndex`
  // leaves behind on a failed swap (2026-04-15 fix for leak spotted in review).
  // Guarded by finalPath so callers who use a non-default final location
  // get their own cleanup.
  await rmDirIfExists(finalPath + '.segments.bak');
}

async function invalidateLateInteractionIndex() {
  await unlinkIfExists(DB_PATHS.lateInteraction);
  await unlinkIfExists(DB_PATHS.lateInteraction + '.bak');
  await rmDirIfExists(DB_PATHS.lateInteraction + '.segments');
}

/**
 * Atomic promote for the Late Interaction index.
 *
 * Renames both the stub file and the segments directory together so the
 * stub's stored segmentDir basename (recorded at save time under
 * `resetForSave({finalIndexPath})`) resolves correctly on the next load.
 *
 * Crash-safety: if the rename of the segments directory succeeds but the
 * stub rename fails, the old stub still points at the old basename but the
 * on-disk directory was renamed — load will see a missing segments dir and
 * self-heal via the `.tmp.segments` migration path in late-interaction-index.js.
 * This window is narrow (two filesystem renames) and the self-heal is idempotent.
 *
 * Rollback sequence when the stub swap at line 106 throws AFTER the new
 * segments have already landed in finalSegDir:
 *   1. Move the new segments out of the way to `.failed-swap`
 *   2. Restore the original segments from `.bak`
 *   3. Propagate the original error
 *
 * The prior revision had a broken rollback: its catch predicate
 * `!existsSync(finalSegDir)` was always false after a successful segments
 * rename, so no restoration ran and the live index was left in a torn state
 * (OLD stub pointing at NEW segments, ORIGINAL segments stranded in .bak).
 * That's the same severity class as the C1 bug the whole helper was meant
 * to replace. See docs/reviews/INDEXING_OPT_2026-04-15/correctness.md §N1.
 */
async function atomicSwapLateInteractionIndex(stagedStubPath, finalStubPath) {
  const stagedSegDir = stagedLateInteractionSegmentDir(stagedStubPath);
  const finalSegDir = finalStubPath + '.segments';
  const bakSegDir = finalSegDir + '.bak';
  const failedSegDir = finalSegDir + '.failed-swap';

  // Best-effort cleanup of any stale .bak / .failed-swap sibling from a
  // previous failed swap. Both must be gone before we rename into them.
  await rmDirIfExists(bakSegDir);
  await rmDirIfExists(failedSegDir);

  // Back up existing live segments before promoting new ones
  let hadOriginalSeg = false;
  if (existsSync(finalSegDir)) {
    await fs.rename(finalSegDir, bakSegDir);
    hadOriginalSeg = true;
  }

  let newSegMoved = false;
  try {
    if (existsSync(stagedSegDir)) {
      await fs.rename(stagedSegDir, finalSegDir);
      newSegMoved = true;
    }
    await atomicSwapDatabase(stagedStubPath, finalStubPath);
  } catch (err) {
    // Each step runs in its own try so a partial rollback failure still
    // attempts the remaining steps. Order matters: move new segments aside
    // FIRST so the bak-rename target is clear, then restore.
    try {
      if (newSegMoved && existsSync(finalSegDir)) {
        await rmDirIfExists(failedSegDir);
        await fs.rename(finalSegDir, failedSegDir);
      }
    } catch (_e) { /* leaves .failed-swap for manual cleanup */ }
    try {
      if (hadOriginalSeg && existsSync(bakSegDir) && !existsSync(finalSegDir)) {
        await fs.rename(bakSegDir, finalSegDir);
      }
    } catch (_e) { /* best effort */ }
    throw err;
  }

  await rmDirIfExists(bakSegDir);
  await rmDirIfExists(failedSegDir);

  // Clean up any orphaned .tmp.segments left over from a pre-fix broken state
  // (where the stub used to record an absolute path with `.tmp.segments`).
  await rmDirIfExists(finalStubPath + '.tmp.segments');
}

/**
 * Internal helpers exposed for direct testing. NOT re-exported via the
 * `core/indexing/index.js` barrel — callers outside the domain should go
 * through `buildVectorsAndArtifactsPhase`. Keeps N1 regression tests able
 * to monkey-patch `atomicSwapDatabase` without needing to set up the full
 * phase runner.
 */
export const _testInternals = {
  atomicSwapLateInteractionIndex,
  stagedLateInteractionSegmentDir,
  cleanupStagedLateInteractionIndex,
};

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

  const hcgsEnabled = HCGS_CONFIG.enabled;

  let summaryBackup = { summaries: [], count: 0 };
  if (!dryRun && hcgsEnabled) {
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

  if (!dryRun && hcgsEnabled && summaryBackup.count > 0) {
    const restoreResult = await restoreSummaries(DB_PATHS.codeGraph, summaryBackup);
    log(`Restored ${restoreResult.restored} summaries (${restoreResult.skipped.total} skipped - entity removed/type changed)`, 'green');
  }

  let hcgsPromise = null;

  const shouldRunHCGS = !dryRun && hcgsEnabled && (
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

  const resourcePlan = planAllocation();
  const shouldParallelLI = !noLateInteraction
    && !dryRun
    && filesToIndex.length > 0
    && EMBEDDING_CONFIG.parallelLateInteraction;
  const parallelPhaseThreads = Math.max(1, Math.min(8, Math.floor(resourcePlan.computeCores / 2)));
  const embeddingThreads = shouldParallelLI
    ? parallelPhaseThreads
    : resourcePlan.inlineEmbeddingThreads;
  const lateInteractionThreads = shouldParallelLI
    ? parallelPhaseThreads
    : resourcePlan.lateInteractionThreads;
  const lateInteractionWorkers = shouldParallelLI ? 1 : resourcePlan.lateInteractionWorkers;
  const lateInteractionWorkerThreads = shouldParallelLI
    ? parallelPhaseThreads
    : resourcePlan.threadsPerLateInteractionWorker;
  const stagedLateInteractionPath = DB_PATHS.lateInteraction + '.tmp';

  // Always chunk files up front so both vector and LI encoders share
  // the same chunk list. Vectors are written to SQLite and HNSW reads
  // from the DB directly (Phase B — no in-memory arrays passed around).
  let preChunked = null;
  if (!dryRun && filesToIndex.length > 0) {
    preChunked = await chunkFiles(filesToIndex);

    // Near-duplicate dedup: annotates chunks in place with {simhash, clusterId,
    // exemplarId, isExemplar}. Downstream embedding / LI paths see the
    // annotations and skip encoding work for aliases.
    const dedupResult = await runDedupPhase(preChunked.allChunks, DEDUP_CONFIG);
    log(formatDedupSummary(dedupResult), dedupResult.skipped ? 'dim' : 'cyan');
  }

  // The embedding worker pool uses ORT INT8 CPU in each worker. It must only
  // be active when the query-time encoder ALSO uses ORT INT8 CPU, otherwise
  // the stored index and the query vectors live in different embedding spaces
  // (gencodesearchnet 83% → 58% MRR regression). Two cases where that's true:
  //   1. Native inference isn't available at all (pre-native hosts).
  //   2. SWEET_SEARCH_EMBED_USE_CPU=1 — the user opted into CPU embed on
  //      both sides (index + query), so pool ORT embed matches dispatcher
  //      ORT embed. This is the "ORT embed on CPU ‖ native LI on Metal"
  //      pipeline that maximises index throughput by running embed and LI
  //      on different devices.
  //
  // The historical `!shouldParallelLI` gate existed for the all-CPU era where
  // pool workers and parallel LI both wanted CPU and fought. In the CPU-embed
  // + Metal-LI world, that conflict goes away — pool workers do ORT on CPU
  // cores, the main thread drives Metal LI dispatches (negligible CPU), no
  // contention. So when `SWEET_SEARCH_EMBED_USE_CPU=1` we lift the gate and
  // let the pool run alongside parallel LI.
  const forceEmbedCpu = process.env.SWEET_SEARCH_EMBED_USE_CPU === '1';
  const queryTimeEmbedIsCpu = !isNativeInferenceAvailable() || forceEmbedCpu;
  // When LI is on Metal (native), pool + parallelLI is safe — the LI driver
  // is just dispatching commands, not competing for CPU cores.
  const liOnMetal = isNativeInferenceAvailable() && !noLateInteraction;
  const allowPoolWithParallelLi = forceEmbedCpu && liOnMetal;
  const useEmbeddingPool = !dryRun
    && filesToIndex.length > 0
    && EMBEDDING_CONFIG.provider === 'local'
    && resourcePlan.useWorkerPool
    && (!shouldParallelLI || allowPoolWithParallelLi)
    && queryTimeEmbedIsCpu;

  if (!dryRun && EMBEDDING_CONFIG.provider === 'local' && filesToIndex.length > 0) {
    configureLocalModelRuntime({ intraOpThreads: embeddingThreads });
    configureLateInteractionRuntime({ intraOpThreads: lateInteractionThreads });
    const embeddingLabel = useEmbeddingPool
      ? `${resourcePlan.embeddingWorkers} workers x ${resourcePlan.threadsPerEmbeddingWorker} threads`
      : `${embeddingThreads} inline threads`;
    const liLabel = lateInteractionWorkers > 1
      ? `${lateInteractionWorkers} workers x ${lateInteractionWorkerThreads} threads`
      : `${lateInteractionThreads} inline threads`;
    const llcMB = resourcePlan.lastLevelCacheBytes > 0
      ? (resourcePlan.lastLevelCacheBytes / (1024 * 1024)).toFixed(0)
      : '?';
    const liLongSeqBatch = resourcePlan.lateInteractionCacheBoundLongSeqBatch ?? '?';
    log(
      `Inference plan: ${shouldParallelLI ? 'parallel models' : resourcePlan.executionStrategy}, `
      + `computeCores=${resourcePlan.computeCores}, embedding=${embeddingLabel}, `
      + `li=${liLabel}, liBatch=${resourcePlan.lateInteractionBatchSize}, liTokens=${resourcePlan.lateInteractionTokenBudget}, `
      + `llc=${llcMB}MB, liLongSeqBatch=${liLongSeqBatch}`,
      'dim'
    );
  }

  if (useEmbeddingPool) {
    try {
      await initEmbeddingPool({
        workers: resourcePlan.embeddingWorkers,
        threadsPerWorker: resourcePlan.threadsPerEmbeddingWorker,
      });
    } catch (err) {
      log(`[InferencePool] Pool init failed, falling back to inline: ${err.message}`, 'yellow');
    }
  }

  const vectorOptions = {
    fullRebuild: fullReindex,
    filesToRemove: incrementalInfo?.toRemove || [],
    sqliteFastMode,
    ...(preChunked ? { preChunked } : {}),
  };

  // ── GPU model lifecycle: kill CPU → arm GPU → prewarm ──
  //
  // CPU and GPU models must never be active simultaneously (memory
  // contention). For large changesets, kill all resident models first,
  // then arm the best GPU backend detected by hardware-capability.js and
  // run a dummy forward pass to compile Metal pipelines / CoreML variants
  // / BLAS threads.
  //
  // Small-changeset skip: incremental runs with fewer than
  // GPU_ARMING_MIN_FILES files keep the ORT CPU path. The GPU load +
  // warmup + teardown + CPU rewarm round-trip costs 5–15s on M3 class
  // hardware and would dwarf the actual work (<1s per file on CPU).
  // Full reindex always arms the GPU regardless of file count.
  const shouldArmGpu = !dryRun
    && filesToIndex.length > 0
    && EMBEDDING_CONFIG.provider === 'local'
    && isNativeInferenceAvailable()
    && (fullReindex || filesToIndex.length >= GPU_ARMING_MIN_FILES);

  if (shouldArmGpu) {
    try {
      await teardownAllModels();
      log('All resident models unloaded for GPU indexing', 'dim');
    } catch (err) {
      log(`Model unload warning: ${err.message}`, 'yellow');
    }

    try {
      const gpuDiag = await initIndexGpuPool({ includeLi: !noLateInteraction });
      log(
        `GPU index pool armed (${gpuDiag.backend}): embed=${gpuDiag.embedLoadMs}+${gpuDiag.embedWarmMs}ms`
        + (noLateInteraction ? '' : `, li=${gpuDiag.liLoadMs}+${gpuDiag.liWarmMs}ms`),
        'dim',
      );
    } catch (err) {
      log(`GPU pool arming failed: ${err.message} — falling back to ORT CPU`, 'yellow');
    }
  } else if (!dryRun && filesToIndex.length > 0 && filesToIndex.length < GPU_ARMING_MIN_FILES) {
    log(`Small changeset (${filesToIndex.length} < ${GPU_ARMING_MIN_FILES} files) — using ORT CPU`, 'dim');
  }

  try {
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
      // finalIndexPath drives the basename the stub records for its
      // segmentDir field — must be the POST-swap stub path so load() after
      // promotion resolves to {finalIndexPath}.segments.
      finalIndexPath: DB_PATHS.lateInteraction,
      stagingSegmentDir: stagedLateInteractionSegmentDir(stagedLateInteractionPath),
      fullRebuild: fullReindex,
      workerCount: lateInteractionWorkers,
      threadsPerWorker: lateInteractionWorkerThreads,
      batchSize: resourcePlan.lateInteractionBatchSize,
      batchSizeUpperCap: resourcePlan.lateInteractionBatchSizeUpperCap,
      tokenBudget: resourcePlan.lateInteractionTokenBudget,
      attentionBudget: resourcePlan.lateInteractionAttentionBudget,
      // Thread PROJECT_ROOT through so LI skip policy loads the same
      // .sweet-search.config.json excludes the embed indexer uses. Without
      // this, a non-cwd invocation (CI cd elsewhere, MCP tool, future daemon)
      // would silently diverge — embed and LI would apply different skip
      // lists and the bde9b26 unification refactor would be incomplete.
      projectRoot: PROJECT_ROOT,
    });

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

    if (!dryRun && vectorStats.embeddings > 0) {
      await markPhaseComplete('vectors');
    }

    try {
      if (!dryRun && vectorStats.embeddings > 0) {
        await updatePhaseProgress({ phase: 'hnsw', status: 'in_progress' });
        if (incrementalInfo && !fullReindex) {
          const allFilesToRemoveFromHNSW = [
            ...incrementalInfo.toIndex,
            ...(incrementalInfo.toRemove || [])
          ];
          await incrementalUpdateHNSW(DB_PATHS.codebase, allFilesToRemoveFromHNSW, dryRun);
        } else {
          await buildHNSWIndex(DB_PATHS.codebase, dryRun);
        }
        await markPhaseComplete('hnsw');
      }
    } catch (err) {
      await cleanupStagedLateInteractionIndex(stagedLateInteractionPath);
      throw err;
    }

    let lateInteractionResult = liOutcome.result;

    if (!liPromise && !dryRun && !noLateInteraction && (preChunked?.allChunks?.length > 0 || filesToRemoveFromLI.length > 0)) {
      try {
        await updatePhaseProgress({ phase: 'late-interaction', status: 'in_progress' });
        lateInteractionResult = await buildLateInteraction(preChunked?.allChunks || []);
        liOutcome.ok = true;
      } catch (err) {
        liOutcome.ok = false;
        liOutcome.error = err;
      }
    }

    if (!dryRun && !noLateInteraction && (liPromise || preChunked?.allChunks?.length > 0 || filesToRemoveFromLI.length > 0)) {
      if (liOutcome.ok && lateInteractionResult) {
        await atomicSwapLateInteractionIndex(stagedLateInteractionPath, DB_PATHS.lateInteraction);
        log('Late interaction index promoted', 'green');
        await markPhaseComplete('late-interaction');
      } else if (!liOutcome.ok) {
        await cleanupStagedLateInteractionIndex(stagedLateInteractionPath);
        await invalidateLateInteractionIndex();
        log(`Late interaction rebuild failed; invalidated existing index: ${liOutcome.error.message}`, 'yellow');
        lateInteractionResult = { error: liOutcome.error.message, invalidated: true };
      }
    }

    if (!dryRun && vectorStats.embeddings > 0) {
      await updatePhaseProgress({ phase: 'artifacts', status: 'in_progress' });
      await buildQuantizedArtifactsPhase(dryRun, {
        changedFiles: filesToIndex.length,
        force: forceArtifacts || fullReindex,
      });
      await markPhaseComplete('artifacts');
    }

    let sparseGramResult = null;
    if (!dryRun && Array.isArray(allFiles) && allFiles.length > 0) {
      sparseGramResult = await buildSparseGramArtifact(allFiles, dryRun);
    }

    if (!dryRun) {
      await clearPhaseProgress();
    }

    return { vectorStats, hcgsResult, lateInteractionResult, sparseGramResult };
  } finally {
    await shutdownEmbeddingPool();
    resetLocalModelRuntime();
    resetLateInteractionRuntime();

    // ── Post-index: tear down GPU models (if armed), warm CPU for queries ──
    //
    // Only runs the swap if we actually armed GPU for this run. Small
    // changesets that stayed on ORT CPU skip this entirely — the CPU
    // models are still loaded and warm from session-warmup.
    if (shouldArmGpu) {
      try {
        teardownIndexGpuPool();
        const cpuDiag = await warmupQueryCpuModels();
        log(
          `CPU models warmed for queries: load=${cpuDiag.loadMs}ms, warm=${cpuDiag.warmMs}ms`
          + ` (embed=${cpuDiag.embedOk ? 'ok' : 'skipped'}, li=${cpuDiag.liOk ? 'ok' : 'skipped'})`,
          'dim',
        );
      } catch (err) {
        log(`CPU model warmup failed: ${err.message}`, 'yellow');
      }
    }
  }
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
