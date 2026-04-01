/**
 * Embedding Domain - Barrel export.
 * Re-exports public API from all sub-modules.
 *
 * NOTE: expandVocabulary exists in both embedding-service.js and embedding-cache.js
 * with different signatures. The service version (auto-supplies embedFn) is canonical.
 * Telemetry symbols are re-exported by embedding-cache.js from embedding-telemetry.js,
 * so we do NOT also export * from embedding-telemetry.js (ESM ambiguity).
 */

// Facade (has default export)
export { default } from './embedding-service.js';
export * from './embedding-service.js';

// Remote (circuit breaker, rate limiters, API clients)
export * from './embedding-remote.js';

// Local model (ONNX inference)
export * from './embedding-local-model.js';

// Cache (LRU, vocabulary, semantic cache, deduplication)
// NOTE: embedding-cache.js re-exports telemetry symbols from embedding-telemetry.js
export * from './embedding-cache.js';

// Resolve ESM ambiguity: expandVocabulary exists in both service and cache.
// The service version (auto-supplies embedFn) is the public API.
export { expandVocabulary } from './embedding-service.js';
