/**
 * Sweet Search Configuration v2.3 (SOTA December 2025)
 *
 * Public facade — DDD Migration Phase 4 complete.
 * All config lives in core/infrastructure/config/*.js.
 * This file re-exports everything as the stable public API.
 *
 * Hybrid search stack with tiered embedding providers:
 * - Tier 1: Voyage Code 3 (best for code, 1024d, Matryoshka)
 * - Tier 2: Mistral Codestral Embed (3072d, claims SOTA)
 * - Tier 3: Jina Embeddings v3 (8192 tokens, multilingual)
 * - Tier 4: Local Xenova (offline fallback)
 *
 * Default ranking path: Late interaction → gated direct cross-encoder
 * FlashRank is retained only as an explicit/manual fallback path.
 * Late Interaction: LateOn-Code (code + 89 languages)
 *
 * References:
 * - https://blog.voyageai.com/2024/12/04/voyage-code-3/
 * - https://mistral.ai/news/codestral-embed
 * - https://huggingface.co/lightonai/LateOn-Code
 */

// This repo is "type": "module" — use ESM syntax only.
// Data directory: '.sweet-search' (default, configurable via SWEET_SEARCH_DATA_DIR)
export * from './infrastructure/config/index.js';
export { default } from './infrastructure/config/index.js';
