/**
 * Codebase Indexer v2.3 — Thin facade.
 *
 * Full indexing pipeline for Sweet Search:
 * 1. Code Graph: Extract entities and relationships, build FTS5 index
 * 2. Vector Embeddings: Generate embeddings with transformers.js
 * 3. HNSW Index: Build in-memory ANN index for fast semantic search
 *
 * Implementation split across:
 *   indexer-utils.js   - SQLite config, logging, atomic swap, paths, file discovery
 *   indexer-build.js   - Code graph + vector embedding building
 *   indexer-ann.js     - HNSW, late interaction, quantized artifact building
 *   indexer-phases.js  - Phase runner + phase wrappers
 *
 * Incremental Mode (default - RECOMMENDED):
 * - Code graph: ALWAYS full rebuild (relationships span files) - ensures GraphRAG accuracy
 * - Summaries: Auto-regenerated for changed files (uses Cerebras GLM-4.6 for speed)
 * - Vectors: Only changed files reindexed
 * - HNSW: Rebuilt from changed files
 *
 * Usage:
 *   node index-codebase-v21.js                  # Incremental (default)
 *   node index-codebase-v21.js --full           # Full reindex
 *   node index-codebase-v21.js --graph-only     # Only code graph
 *   node index-codebase-v21.js --vectors-only   # Only vectors + HNSW
 *   node index-codebase-v21.js --dry-run        # Preview only
 */

// ── Optional: bump libuv worker thread pool ──
//
// Only useful in opt-in hybrid CPU+GPU mode (SWEET_SEARCH_LI_HYBRID=1 or
// SWEET_SEARCH_EMBED_HYBRID=1) where multiple concurrent napi async ops
// fight for the default 4-thread libuv pool. Pure-GPU and pure-CPU paths
// don't need this. Set SWEET_SEARCH_UV_THREADPOOL_SIZE=64 (or higher) to
// enable. libuv reads this lazily on first thread pool use.
if (process.env.SWEET_SEARCH_UV_THREADPOOL_SIZE && !process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = process.env.SWEET_SEARCH_UV_THREADPOOL_SIZE;
}

import { existsSync } from 'fs';
import { DB_PATHS, LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { applyPersistedLiModel } from '../infrastructure/init-config.js';
import { resolveRelationshipTargets } from '../graph/relationship-resolver.js';
import { requireNativeAnn as requireNativeAnnBackend } from '../vector-store/hnsw-index.js';
import { getStats as getIncrementalStats } from './incremental-tracker.js';
import { ARTIFACT_THRESHOLDS } from './artifact-builder.js';

// Sub-module imports (used in main + re-exported for backward compatibility)
import {
  isWalSafe, configureJournalMode,
  colors, setQuietMode, isQuietMode, setVerboseMode, log, logProgress, logError,
  atomicSwapDatabase,
  readFilesFromStdin, discoverFiles,
} from './indexer-utils.js';
import {
  buildCodeGraph, createVectorSchema, ensureVectorSchema,
  buildInsertItems, insertVectors, pipelinedEmbedAndInsert,
  buildVectorIndex,
} from './indexer-build.js';
import {
  incrementalUpdateHNSW, buildHNSWIndex,
  buildLateInteractionIndex, buildQuantizedArtifactsPhase,
} from './indexer-ann.js';
import {
  runPhase,
  discoverFilesPhase, determineFilesToIndexPhase,
  buildCodeGraphWithHCGSPhase, buildVectorsAndArtifactsPhase,
  updateIncrementalStatePhase, printSummaryPhase,
} from './indexer-phases.js';
// =============================================================================
// CLI ARGUMENT PARSING
// =============================================================================

/**
 * Parse CLI arguments into a structured flags object.
 * @param {string[]} [argv] - Arguments to parse (defaults to process.argv.slice(2))
 */
function parseArgs(argv) {
  const args = argv ?? process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    graphOnly: args.includes('--graph-only'),
    vectorsOnly: args.includes('--vectors-only'),
    fullReindex: args.includes('--full'),
    showStats: args.includes('--stats'),
    resolveOnly: args.includes('--resolve-only'),
    skipSummaryRegen: args.includes('--skip-summary-regen'),
    filesFromStdin: args.includes('--files-from-stdin'),
    quiet: args.includes('--quiet'),
    forceArtifacts: args.includes('--force-artifacts'),
    help: args.includes('--help') || args.includes('-h'),
    noLateInteraction: args.includes('--no-late-interaction'),
    lateInteractionModel: args.find(a => a.startsWith('--late-interaction-model='))?.split('=')[1] || null,
    lateInteractionPool: parseInt(args.find(a => a.startsWith('--late-interaction-pool='))?.split('=')[1] || process.env.SWEET_SEARCH_LI_POOL_FACTOR || '1', 10),
    lateInteractionExtendedSkiplist: args.includes('--late-interaction-skiplist=extended'),
    requireNativeAnn: args.includes('--require-native-ann'),
    sqliteFastMode: args.includes('--sqlite-fast') || process.env.SWEET_SEARCH_SQLITE_FAST_MODE === '1',
    verbose: args.includes('--verbose') || args.includes('-v'),
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const startTime = Date.now();

  const { dryRun, graphOnly, vectorsOnly, fullReindex, showStats, resolveOnly,
          skipSummaryRegen, filesFromStdin, quiet, forceArtifacts, help,
          noLateInteraction, lateInteractionModel, lateInteractionPool, lateInteractionExtendedSkiplist,
          requireNativeAnn, sqliteFastMode, verbose } = parseArgs();

  if (quiet) {
    setQuietMode(true);
  }

  if (verbose) {
    setQuietMode(false);
    setVerboseMode(true);
  }

  // Apply late interaction model overrides before any model code runs.
  // Precedence: --no-late-interaction > --late-interaction-model=… > env
  // var (already honoured by LATE_INTERACTION_CONFIG.model at module load) >
  // .sweet-search/config.json::runtime.li.model > built-in default. Only
  // touch the persisted-config branch when neither CLI flag was used —
  // applyPersistedLiModel internally re-checks the env var.
  if (noLateInteraction) {
    LATE_INTERACTION_CONFIG.model = false;
  } else if (lateInteractionModel) {
    LATE_INTERACTION_CONFIG.model = lateInteractionModel;
  } else {
    applyPersistedLiModel(process.env.SWEET_SEARCH_PROJECT_ROOT || process.cwd());
  }

  log(`${colors.bright}╔═══════════════════════════════════════════════════╗${colors.reset}`, 'bright');
  log(`${colors.bright}║   Sweet Search Codebase Indexer v2.3 (SOTA Dec'25) ║${colors.reset}`, 'bright');
  log(`${colors.bright}╚═══════════════════════════════════════════════════╝${colors.reset}`, 'bright');

  if (vectorsOnly) {
    log('⚠ WARNING: --vectors-only skips code graph rebuild', 'yellow');
    log('  GraphRAG structural queries will use stale data', 'yellow');
    log('  Use default mode (no flags) to ensure full functionality', 'dim');
    log('', 'reset');
  }

  if (help) {
    console.log(`
Usage:
  node index-codebase-v21.js [options]

Options:
  (default)        Incremental (recommended) - FULL code graph + incremental vectors
                   Code graph always fully rebuilt for GraphRAG accuracy
  --full           Full reindex - rebuild everything from scratch.
                   Automatically runs HCGS summary regeneration for all entities.
  --graph-only     Only build code graph (Phase 1)
  --vectors-only   Only vectors + HNSW (SKIPS code graph, breaks GraphRAG!)
  --resolve-only   Only resolve relationship targets (no reindexing)
  --skip-summary-regen  [DEPRECATED] No longer needed - summaries are always preserved.
                       This flag is ignored; use it for backward compatibility only.
  --files-from-stdin   Read file paths from stdin (newline-delimited) for targeted indexing.
                       Only these files will have their vectors/summaries updated.
                       Graph is still fully rebuilt (relationships span files).
                       Automatically runs HCGS for the specified files.
  --force-artifacts    Force binary HNSW + Int8 artifact rebuild regardless of change count.
                       Default: skip rebuild if <${ARTIFACT_THRESHOLDS.skipThreshold} files changed (Float HNSW serves search).
  --no-late-interaction  Skip late interaction index build (faster indexing when not needed)
  --late-interaction-model=ID  Use specific model (lateon-code or lateon-code-edge)
  --late-interaction-pool=N    Token pooling factor (2=halve tokens, 3=third). Reduces index size.
  --late-interaction-skiplist=extended  Extend skiplist with code-noise tokens (whitespace, semicolons)
  --require-native-ann  Fail fast if native ANN backend (usearch) is unavailable.
                   Prevents accidental fallback to slower JS ANN in benchmarks.
  --sqlite-fast    Use unsafe SQLite pragmas for faster builds (benchmarking only).
                   Can also be set via SWEET_SEARCH_SQLITE_FAST_MODE=1.
                   WARNING: Data may be lost on crash - do NOT use in production.
  --verbose, -v    Force progress output with newlines (visible in pipes/logs).
                   Shows embedding %, LI %, and phase timings on separate lines.
  --quiet          Suppress progress bars and non-essential output (for daemon use).
                   Errors still go to stderr.
  --dry-run        Preview without indexing
  --stats          Show indexing statistics
  --help, -h       Show this help

HCGS Summary Regeneration:
  HCGS (Hierarchical Code Graph Summaries) automatically runs when:
    1. --full flag is set (regenerates ALL entity summaries)
    2. --files-from-stdin is used (regenerates summaries for stdin files)
    3. Incremental changes detected (regenerates summaries for changed files)

  Summaries use Cerebras GLM-4.6 for fast generation (~1000 tok/s), with fallback
  to Haiku/Ollama/static patterns when API key is not set.

Targeted Indexing (daemon mode):
  printf "A.java\\nB.java\\n" | node index-codebase-v21.js --files-from-stdin --quiet

  This only re-embeds/updates vectors and summaries for the specified files,
  while still rebuilding the graph (required for accurate relationships).

Note: Code graph is ALWAYS fully rebuilt (except with --vectors-only) to ensure
GraphRAG structural queries ("what calls X", "implementations of Y") are accurate.
This is intentional since relationships span across files.

Output:
  .sweet-search/code-graph.db      Code graph with FTS5 (lexical search)
  .sweet-search/codebase.db        Vector embeddings (semantic search)
  .sweet-search/codebase-hnsw.idx  HNSW index (fast ANN)
  .sweet-search/merkle-state.json  Incremental indexing state
`);
    process.exit(0);
  }

  if (showStats) {
    const stats = await getIncrementalStats();
    log('\nIndexing Statistics:', 'bright');
    log(`  Last indexed: ${stats.lastIndex || 'Never'}`, 'dim');
    log(`  Total files: ${stats.totalFiles}`, 'dim');
    log(`  Total chunks: ${stats.totalChunks}`, 'dim');
    log(`  Has state: ${stats.hasState}`, 'dim');
    return;
  }

  if (resolveOnly) {
    log('\n━━━ Resolve-Only Mode ━━━', 'bright');

    if (!existsSync(DB_PATHS.codeGraph)) {
      log('✗ Code graph database not found. Run indexing first.', 'red');
      process.exit(1);
    }

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(DB_PATHS.codeGraph);

    log('Resolving relationship targets...', 'yellow');
    const resolutionStats = resolveRelationshipTargets(db);

    db.close();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`\n${'━'.repeat(50)}`, 'bright');
    log(`RESOLUTION COMPLETE`, 'bright');
    log(`${'━'.repeat(50)}`, 'bright');
    log(`Duration: ${duration}s`, 'dim');
    log(`Resolved: ${resolutionStats.resolved}/${resolutionStats.total}`, 'dim');
    if (resolutionStats.ambiguous > 0) {
      log(`Ambiguous: ${resolutionStats.ambiguous}`, 'dim');
    }

    return;
  }

  if (requireNativeAnn) {
    await requireNativeAnnBackend();
  }

  try {
    // =========================================================================
    // PHASE 1: File Discovery
    // =========================================================================
    const discoveryResult = await runPhase('File Discovery', discoverFilesPhase, {
      filesFromStdin,
      quiet,
    });

    if (!discoveryResult.success) {
      throw discoveryResult.error;
    }

    const { allFiles, stdinFiles, earlyExit: discoveryEarlyExit, exitReason: discoveryExitReason } = discoveryResult.result;

    if (discoveryEarlyExit) {
      if (quiet) {
        console.log(JSON.stringify({ success: true, filesProcessed: 0, reason: discoveryExitReason }));
      }
      return;
    }

    // =========================================================================
    // PHASE 2: Determine Files to Index
    // =========================================================================
    const filesToIndexResult = await runPhase('Determine Files to Index', determineFilesToIndexPhase, {
      allFiles,
      stdinFiles,
      filesFromStdin,
      fullReindex,
      dryRun,
      quiet,
    });

    if (!filesToIndexResult.success) {
      throw filesToIndexResult.error;
    }

    const { filesToIndex, incrementalInfo, earlyExit, exitReason } = filesToIndexResult.result;

    if (earlyExit) {
      if (quiet && exitReason === 'no_valid_files') {
        console.log(JSON.stringify({ success: true, filesProcessed: 0, reason: exitReason }));
      }
      return;
    }

    if (dryRun) {
      if (skipSummaryRegen) {
        log('\nDEPRECATION: --skip-summary-regen is no longer needed', 'yellow');
        log('  Summaries are now ALWAYS automatically preserved across rebuilds', 'dim');
      }

      if (!quiet) {
        log('\n--- Dry Run Preview ---', 'bright');
        log('DRY RUN: Skipping graph, vector, LI, HNSW, and artifact phases', 'magenta');
      }

      printSummaryPhase({
        graphStats: { entities: 0, relationships: 0 },
        vectorStats: { chunks: 0, embeddings: 0 },
        filesToIndex,
        allFiles,
        incrementalInfo,
        vectorsOnly,
        graphOnly,
        fullReindex,
        filesFromStdin,
        quiet,
        startTime,
      });

      return;
    }

    // =========================================================================
    // PHASE 3: Code Graph + HCGS Preparation (if not --vectors-only)
    // =========================================================================
    let graphStats = { entities: 0, relationships: 0 };
    let hcgsPromise = null;

    if (!vectorsOnly) {
      const graphResult = await runPhase('Code Graph + HCGS Prep', buildCodeGraphWithHCGSPhase, {
        allFiles,
        filesToIndex,
        dryRun,
        fullReindex,
        filesFromStdin,
        incrementalInfo,
        skipSummaryRegen,
      });

      if (!graphResult.success) {
        throw graphResult.error;
      }

      graphStats = graphResult.result.graphStats;
      hcgsPromise = graphResult.result.hcgsPromise;
    }

    // =========================================================================
    // PHASE 4: Vectors + HNSW + Artifacts (if not --graph-only)
    // =========================================================================
    let vectorStats = { chunks: 0, embeddings: 0 };
    let sparseGramResult = null;

    if (!graphOnly) {
      const vectorsResult = await runPhase('Vectors + HNSW + Artifacts', buildVectorsAndArtifactsPhase, {
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
      });

      if (!vectorsResult.success) {
        throw vectorsResult.error;
      }

      vectorStats = vectorsResult.result.vectorStats;
      sparseGramResult = vectorsResult.result.sparseGramResult;
    } else if (hcgsPromise) {
      const hcgsResult = await hcgsPromise;
      if (hcgsResult && !hcgsResult.error) {
        log(`Summaries regenerated (${hcgsResult.generated} generated, ${hcgsResult.skipped} skipped)`, 'green');
      }
    }

    // =========================================================================
    // PHASE 5: Update Incremental State
    // =========================================================================
    await runPhase('Update Incremental State', updateIncrementalStatePhase, {
      dryRun,
      fullReindex,
      incrementalInfo,
      allFiles,
      vectorStats,
      graphStats,
      sparseGramResult,
    });

    // =========================================================================
    // PHASE 6: Print Summary
    // =========================================================================
    printSummaryPhase({
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
    });

    // =========================================================================
    // PHASE 7: Post-Indexing Vocabulary Warmup (non-fatal)
    // =========================================================================
    try {
      const { runFullWarmup } = await import('../vocabulary/vocab-warmer.js');
      await runFullWarmup({ depth: 'medium', top: 1000 });
      if (!quiet) log('Vocabulary warmup complete', 'green');
    } catch (err) {
      // Non-fatal: warmup failure should not block indexing
      if (!quiet) log(`[vocab-prewarm] Post-indexing warmup skipped: ${err.message}`, 'dim');
    }

  } catch (err) {
    logError(`Fatal error: ${err.message}`);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }

    if (quiet) {
      console.log(JSON.stringify({
        success: false,
        error: err.message,
      }));
    }

    process.exit(1);
  }
}

// Direct-run guard. The previous `import.meta.url === \`file://${process.argv[1]}\``
// form silently no-op'd under three real-world conditions:
//   1. `npm install ../sweet-search-private` (file install) symlinks
//      `node_modules/sweet-search/` to the source — `process.argv[1]` is the
//      symlink path while `import.meta.url` resolves to the realpath.
//   2. Paths containing spaces or unicode — the URL form encodes them but
//      `file://` + raw path doesn't.
//   3. Windows backslash vs URL forward-slash mismatch.
// Resolve both sides through `realpathSync(fileURLToPath(...))` so the
// comparison survives every common install layout. Falls back to never-direct
// (safe default) if either side errors.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const _isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();
if (_isDirectRun) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export {
  main,
  discoverFiles,
  buildCodeGraph,
  buildVectorIndex,
  buildHNSWIndex,
  buildLateInteractionIndex,
  buildQuantizedArtifactsPhase,
  parseArgs,
  readFilesFromStdin,
  setQuietMode,
  isQuietMode,
  setVerboseMode,
  createVectorSchema,
  ensureVectorSchema,
  insertVectors,
  atomicSwapDatabase,
  isWalSafe,
  configureJournalMode,
  buildInsertItems,
  pipelinedEmbedAndInsert,
};
