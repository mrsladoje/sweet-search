/**
 * Embedding Domain - Barrel export.
 * Re-exports public API from all sub-modules.
 */

// Facade (has default export)
export { default } from './embedding-service.js';
export * from './embedding-service.js';

// Remote (circuit breaker, rate limiters, API clients)
export * from './embedding-remote.js';

// Local model (ONNX inference)
export * from './embedding-local-model.js';

// Cache (LRU, vocabulary, semantic cache, deduplication)
export * from './embedding-cache.js';

// Telemetry (per-mode query telemetry)
export * from './embedding-telemetry.js';
