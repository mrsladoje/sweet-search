/**
 * Indexing Domain - Barrel export.
 * Re-exports public API from all sub-modules.
 */

// Main indexer facade
export * from './index-codebase-v21.js';

// Build pipeline (code graph, vector schema, embedding)
export * from './indexer-build.js';

// Phase runner + phase wrappers (explicit named exports — do NOT switch back
// to `export *` without preserving the hiding of module-private helpers.
// `indexer-phases.js` has `_testInternals` and other file-local state that
// MUST NOT leak through the barrel per the L2/L3 DDD fix in 34089b2.)
export {
  runPhase,
  discoverFilesPhase,
  determineFilesToIndexPhase,
  buildCodeGraphWithHCGSPhase,
  buildVectorsAndArtifactsPhase,
  updateIncrementalStatePhase,
  printSummaryPhase,
} from './indexer-phases.js';

// HNSW, late interaction, quantized artifacts
export * from './indexer-ann.js';

// SQLite config, logging, atomic swap, file discovery
export * from './indexer-utils.js';

// Incremental tracker (has default export)
export { default as incrementalTracker } from './incremental-tracker.js';
export * from './incremental-tracker.js';

// Incremental parser (has default export)
export { default as IncrementalParser } from './incremental-parser.js';
export * from './incremental-parser.js';

// Artifact builder (has default export)
export { default as artifactBuilder } from './artifact-builder.js';
export * from './artifact-builder.js';

// Merkle tracker
export * from './merkle-tracker.js';

// Document chunker
export * from './document-chunker.js';

// AST Chunker
export { ASTChunker } from './ast-chunker.js';

// Index maintainer (file watcher queue management)
export {
  normalizePathSeparators, CONFIG as INDEX_MAINTAINER_CONFIG,
  ensureDataDir, normalizePath, parseQueueContent,
  atomicAcquireQueue, cleanupProcessingFile, requeueEntries,
} from './index-maintainer.mjs';

// Chunking sub-modules
export * from './chunking/chunk-builder.js';
export { default as MarkdownChunker } from './chunking/markdown-chunker.js';
export * from './chunking/markdown-chunker.js';
export { default as PlainTextChunker } from './chunking/plaintext-chunker.js';
export * from './chunking/plaintext-chunker.js';

// Resource planner + worker pools (public API — consumed by tests and
// external tooling for hardware-aware indexing configuration)
export {
  planAllocation,
  detectResources,
  detectAppleSiliconTier,
  planLateInteractionFromGpuTier,
  detectLastLevelCacheBytes,
  EmbeddingPool,
  LateInteractionPool,
  initEmbeddingPool,
  shutdownEmbeddingPool,
  getEmbeddingPool,
} from './indexer-pool.js';

// Shared indexing file policy (embedding, sparse/BM25 artifacts, and LI)
export {
  applyIndexingChunkPolicy,
  isExcludedByConfig,
  chunkLooksGenerated,
} from './indexing-file-policy.js';

// Late-interaction compatibility export
export { applyLiSkipPolicy } from './li-skip-policy.js';

// Sparse-gram artifact builder (tier-1 grep acceleration)
export { buildSparseGramArtifact } from './indexer-sparse-gram.js';
