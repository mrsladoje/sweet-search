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
import { colors, log, logProgress, logError, discoverFiles, readFilesFromStdin, atomicSwapDatabase, shouldStreamVectors } from './indexer-utils.js';
import { buildCodeGraph, buildVectorIndex, chunkFiles } from './indexer-build.js';
import { runDedupPhase, formatDedupSummary } from './dedup/dedup-phase.js';
import { DEDUP_CONFIG } from '../infrastructure/config/index.js';
import { buildLateInteractionIndex, buildQuantizedArtifactsPhase } from './indexer-ann.js';
import { buildSparseGramArtifact } from './indexer-sparse-gram.js';
import { publishIndexerManifest } from './indexer-manifest.js';
import { contentHashSync } from '../incremental-indexing/infrastructure/hashing.mjs';
import {
  configureLocalModelRuntime,
  resetLocalModelRuntime,
} from '../embedding/embedding-local-model.js';
import { isNativeInferenceAvailable } from '../infrastructure/native-inference.js';
import { teardownAllModels, initIndexGpuPool, teardownIndexGpuPool, warmupQueryCpuModels, GPU_ARMING_MIN_FILES, isIndexAcceleratorAvailable } from './model-pool.js';
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

  // ── Bounded-memory streaming path for large full rebuilds ──
  //
  // The in-memory path below materialises the WHOLE chunk corpus (chunkFiles →
  // allChunks/texts) plus all exemplar embeddings, all alias rows, and every
  // LI per-token slab — peak heap O(repo). On big repos (libsql ≈ 431k chunks,
  // swc ≈ 217k) that exceeds the default ~4 GB heap and crashes on EVERY
  // backend (CUDA/Metal/CoreML/ORT-CPU), since the hogs are JS-side, not the
  // model. For large full rebuilds we instead spill chunks to disk and embed/LI
  // in bounded windows (see streaming-vectors.js) so peak heap is O(window).
  //
  // Gated by file count OR total admitted source bytes (see shouldStreamVectors
  // in indexer-utils.js) so small repos + incremental runs keep the original
  // in-memory path byte-for-byte (benchmark indexes unaffected). The byte
  // trigger catches few-files-huge-bytes repos (amalgamations, vendored blobs)
  // that OOM the in-memory path while staying under the file gate.
  // Auto-selected, no opt-in flag; SWEET_SEARCH_STREAM_VECTORS=0 forces the
  // legacy path, SWEET_SEARCH_STREAM_MIN_FILES / SWEET_SEARCH_STREAM_MIN_BYTES
  // tune the thresholds.
  const streamingDecision = await shouldStreamVectors({ filesToIndex, dryRun, fullReindex });
  const useStreaming = streamingDecision.useStreaming;
  if (streamingDecision.reason === 'bytes') {
    log(
      `  Streaming vectors: ${filesToIndex.length} files total ` +
      `${(streamingDecision.totalBytes / 1048576).toFixed(0)}+ MB >= ` +
      `${(streamingDecision.thresholdBytes / 1048576).toFixed(0)} MB (bounded memory)`,
      'dim'
    );
  }

  // The in-memory path pre-chunks up front so both vector + LI encoders share
  // one chunk list. The streaming path does its own windowed chunking + dedup,
  // so skip this for it (this is the O(repo) allocation we're avoiding).
  let preChunked = null;
  if (!dryRun && !useStreaming && filesToIndex.length > 0) {
    preChunked = await chunkFiles(filesToIndex);

    // Near-duplicate dedup: annotates chunks in place with {simhash, clusterId,
    // exemplarId, isExemplar}. Downstream embedding / LI paths see the
    // annotations and skip encoding work for aliases.
    const dedupResult = await runDedupPhase(preChunked.allChunks, DEDUP_CONFIG);
    log(formatDedupSummary(dedupResult), dedupResult.skipped ? 'dim' : 'cyan');
  }

  // The embedding worker pool uses ORT INT8 CPU in each worker. It must only
  // be active when the index-time encoder ALSO uses ORT INT8 CPU, otherwise
  // the stored index and the query vectors live in different embedding spaces
  // (gencodesearchnet 83% → 58% MRR regression — queries are always ORT INT8
  // CPU). Three cases where index-time embed is ORT INT8 CPU:
  //   1. Native inference isn't available at all (pre-native hosts).
  //   2. No usable accelerator (Metal/CoreML/CUDA) — even if the native addon
  //      is installed, the native model is never loaded on a no-accelerator
  //      host (see model-pool.initIndexGpuPool), so embed dispatch falls to
  //      ORT INT8. Running the pool here makes that path multi-threaded
  //      instead of inline.
  //   3. SWEET_SEARCH_EMBED_USE_CPU=1 — the user opted into CPU embed on
  //      both sides (index + query), so pool ORT embed matches dispatcher
  //      ORT embed. This is the "ORT embed on CPU ‖ native LI on accelerator"
  //      pipeline that maximises index throughput by running embed and LI
  //      on different devices.
  //
  // The historical `!shouldParallelLI` gate existed for the all-CPU era where
  // pool workers and parallel LI both wanted CPU and fought. In the CPU-embed
  // + accelerator-LI world, that conflict goes away — pool workers do ORT on
  // CPU cores, the main thread drives accelerator LI dispatches (negligible
  // CPU), no contention. So when `SWEET_SEARCH_EMBED_USE_CPU=1` (and LI is on
  // a real accelerator) we lift the gate and let the pool run alongside
  // parallel LI. On a no-accelerator host LI is also on ORT CPU, so the gate
  // stays in force and pool + parallel LI take turns rather than contend.
  const forceEmbedCpu = process.env.SWEET_SEARCH_EMBED_USE_CPU === '1';
  const indexTimeEmbedIsCpu = !isNativeInferenceAvailable()
    || !isIndexAcceleratorAvailable()
    || forceEmbedCpu;
  // LI runs on a native accelerator only when one is actually armed. When it
  // is, pool + parallelLI is safe — the LI driver is just dispatching GPU
  // commands, not competing for CPU cores.
  const liOnAccelerator = isNativeInferenceAvailable()
    && isIndexAcceleratorAvailable()
    && !noLateInteraction;
  const allowPoolWithParallelLi = forceEmbedCpu && liOnAccelerator;
  const useEmbeddingPool = !dryRun
    && filesToIndex.length > 0
    && EMBEDDING_CONFIG.provider === 'local'
    && resourcePlan.useWorkerPool
    && (!shouldParallelLI || allowPoolWithParallelLi)
    && indexTimeEmbedIsCpu;

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
  // No-accelerator skip: a host with no usable Metal / CoreML / CUDA
  // accelerator indexes on the optimized ORT INT8 CPU path and never arms
  // candle/native. `isIndexAcceleratorAvailable()` gates this even when the
  // optional native addon is installed (e.g. Linux + the CUDA package but a
  // failed/absent CUDA runtime, or SWEET_SEARCH_CUDA=0) — the JS layer is the
  // authoritative selector; we never lean on Rust degrading loadWithDevice()
  // to CPU. Skipping arming also skips the teardown/CPU-rewarm lifecycle in
  // the `finally` below, so a CPU-only full reindex simply runs on ORT CPU.
  //
  // Small-changeset skip: incremental runs with fewer than
  // GPU_ARMING_MIN_FILES files keep the ORT CPU path. The GPU load +
  // warmup + teardown + CPU rewarm round-trip costs 5–15s on M3 class
  // hardware and would dwarf the actual work (<1s per file on CPU).
  // Full reindex always arms the GPU regardless of file count — but only
  // when an accelerator exists.
  const shouldArmGpu = !dryRun
    && filesToIndex.length > 0
    && EMBEDDING_CONFIG.provider === 'local'
    && isNativeInferenceAvailable()
    && isIndexAcceleratorAvailable()
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
  } else if (!dryRun && filesToIndex.length > 0 && !isIndexAcceleratorAvailable()) {
    log('No inference accelerator detected — indexing on ORT INT8 CPU', 'dim');
  }

  try {
    // ── Streaming path: bounded-memory vectors + LI for large full rebuilds ──
    if (useStreaming) {
      const { getModelInfo } = await import('../embedding/embedding-service.js');
      const { buildVectorsAndLiStreaming } = await import('./streaming-vectors.js');
      const modelInfo = getModelInfo();

      const streamed = await buildVectorsAndLiStreaming({
        filesToIndex,
        modelInfo,
        sqliteFastMode,
        noLateInteraction,
        li: {
          poolFactor: lateInteractionPool,
          extendedSkiplist: lateInteractionExtendedSkiplist,
          loadFromPath: DB_PATHS.lateInteraction,
          saveToPath: stagedLateInteractionPath,
          finalIndexPath: DB_PATHS.lateInteraction,
          stagingSegmentDir: stagedLateInteractionSegmentDir(stagedLateInteractionPath),
          workerCount: lateInteractionWorkers,
          threadsPerWorker: lateInteractionWorkerThreads,
          batchSize: resourcePlan.lateInteractionBatchSize,
          batchSizeUpperCap: resourcePlan.lateInteractionBatchSizeUpperCap,
          tokenBudget: resourcePlan.lateInteractionTokenBudget,
          attentionBudget: resourcePlan.lateInteractionAttentionBudget,
        },
      });

      // HCGS (off by default) runs independently of vectors — drain it if armed.
      let hcgsResult = null;
      if (hcgsPromise) {
        try { hcgsResult = await hcgsPromise; } catch (e) { hcgsResult = { error: e.message }; }
        if (hcgsResult && !hcgsResult.error) {
          log(`Summaries regenerated (${hcgsResult.generated} generated, ${hcgsResult.skipped} skipped)`, 'green');
        }
      }

      const vectorStats = streamed.vectorStats || { chunks: 0, embeddings: 0 };
      if (vectorStats.embeddings > 0) await markPhaseComplete('vectors');

      // Promote the staged LI index (built bounded), or invalidate on failure —
      // same contract as the in-memory path's swap/invalidate below.
      let lateInteractionResult = streamed.lateInteractionResult;
      if (!noLateInteraction) {
        if (streamed.liBuilt && lateInteractionResult && !lateInteractionResult.error) {
          await atomicSwapLateInteractionIndex(stagedLateInteractionPath, DB_PATHS.lateInteraction);
          log('Late interaction index promoted', 'green');
          await markPhaseComplete('late-interaction');
        } else {
          await cleanupStagedLateInteractionIndex(stagedLateInteractionPath);
          await invalidateLateInteractionIndex();
          if (lateInteractionResult?.error) {
            log(`Late interaction rebuild failed; invalidated existing index: ${lateInteractionResult.error}`, 'yellow');
            lateInteractionResult = { error: lateInteractionResult.error, invalidated: true };
          }
        }
      }

      // Binary HNSW + int8 artifacts stream from the swapped codebase.db.
      if (vectorStats.embeddings > 0) {
        await updatePhaseProgress({ phase: 'artifacts', status: 'in_progress' });
        await buildQuantizedArtifactsPhase(dryRun, {
          changedFiles: filesToIndex.length,
          force: forceArtifacts || fullReindex,
        });
        await markPhaseComplete('artifacts');
      }

      let sparseGramResult = null;
      if (Array.isArray(allFiles) && allFiles.length > 0) {
        sparseGramResult = await buildSparseGramArtifact(allFiles, dryRun);
      }

      await clearPhaseProgress();
      return { vectorStats, hcgsResult, lateInteractionResult, sparseGramResult };
    }

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
  const { dryRun, fullReindex, incrementalInfo, allFiles, vectorStats, graphStats, manifestStateDir, sparseGramResult } = options;

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
    for (const file of allFiles) {
      try {
        const fullPath = path.join(PROJECT_ROOT, file);
        const [content, stat] = await Promise.all([
          fs.readFile(fullPath),
          fs.stat(fullPath, { bigint: true }).catch(() => null),
        ]);
        hashes[file] = {
          hash: contentHashSync(content),
          size: stat ? stat.size.toString() : null,
          mtime_ns: stat ? stat.mtimeNs.toString() : null,
          inode: stat ? stat.ino.toString() : null,
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
  publishIndexerManifest({
    ...(manifestStateDir ? { stateDir: manifestStateDir } : {}),
    ...(sparseGramResult ? { sparseGramResult } : {}),
  });
  log('Reconcile manifest published', 'green');
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
