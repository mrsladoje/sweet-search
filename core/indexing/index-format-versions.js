/**
 * Index-format versions — recorded in the index config fingerprint
 * (`core/indexing/config-fingerprint.js`). A mismatch against an on-disk index
 * makes `sweet-search index` rebuild from scratch and keeps the reconcile
 * daemon from writing new-format chunks into the old index.
 *
 * Kept dependency-free so the search-time format check stays cheap. Every file
 * named below carries a pointer comment back here.
 *
 * Bump CHUNKING_VERSION in the same diff as any change that alters chunk
 * boundaries or chunk content: the split rules and MAX_CHUNK_SIZE in
 * `core/indexing/ast-chunker.js`, the cAST sibling merge / header overhead in
 * `core/infrastructure/tree-sitter-provider.js`, the document chunkers in
 * `core/indexing/document-chunker.js` + `core/indexing/chunking/`, or the
 * per-language configs in `core/infrastructure/language-patterns/`.
 *
 * Bump ENRICHMENT_VERSION in the same diff as any change to the text the
 * encoders see: `ASTChunker.enrichEmbeddingText` and the per-language
 * embedding/LI routing in `ast-chunker.js`, the enrichment passes in
 * `indexer-build.js` and
 * `incremental-indexing/application/production-reconciler.mjs`, or
 * `pickLiInput` in `chunk-embed-text.js`.
 *
 * Bump PIPELINE_VERSION in the same diff as any change to the dense embedding
 * pipeline (v2 = int8 quantized embeddings).
 *
 * Bump STATE_VERSION in the same diff as any change to the layout of
 * `merkle-state.json` (2.5: the per-file map moved out into file-state.db).
 *
 * Bumping any of them forces one full rebuild per existing index.
 *
 * The encoder-input policy counters (EMBED_TEXT_POLICY_VERSION and its two
 * siblings) live in `incremental-indexing/domain/encoder-input.mjs`: they feed
 * the incremental hash, not this fingerprint.
 */
export const CHUNKING_VERSION = 2;
export const ENRICHMENT_VERSION = 1;
export const PIPELINE_VERSION = 2;
export const STATE_VERSION = '2.5';

// The index schema version lives with its reader check (infrastructure may not import indexing).
export { SCHEMA_VERSION } from '../infrastructure/index-schema.js';
