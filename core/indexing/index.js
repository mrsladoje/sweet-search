/**
 * Indexing Domain - Barrel export.
 * Re-exports public API from all sub-modules.
 */

export * from './index-codebase-v21.js';

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

export * from './indexer-ann.js';

export * from './indexer-utils.js';

export { default as incrementalTracker } from './incremental-tracker.js';
export * from './incremental-tracker.js';

export { default as artifactBuilder } from './artifact-builder.js';
export * from './artifact-builder.js';

export * from './document-chunker.js';

export { ASTChunker } from './ast-chunker.js';

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


export { buildSparseGramArtifact } from './indexer-sparse-gram.js';
