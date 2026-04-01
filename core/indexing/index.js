/**
 * Indexing Domain - Barrel export.
 * Re-exports public API from all sub-modules.
 */

// Main indexer facade
export * from './index-codebase-v21.js';

// Build pipeline (code graph, vector schema, embedding)
export * from './indexer-build.js';

// Phase runner + phase wrappers
export * from './indexer-phases.js';

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
