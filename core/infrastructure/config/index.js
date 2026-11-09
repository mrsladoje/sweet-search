/**
 * Infrastructure Config — Strangler Fig re-export facade.
 * All existing `import { X } from './config.js'` paths resolve through here.
 */

// Platform & infrastructure
export * from './platform.js';

// Embedding providers & config
export * from './embedding.js';

// Ranking, reranking, cascade, late interaction
export * from './ranking.js';

// Search patterns, routing, performance targets
export * from './search.js';


// Code graph config
export * from './graph.js';

// Vector store indices (HNSW, Binary HNSW)
export * from './vector-store.js';

// Cerebras LLM (used by llm-provider.js for graph/HCGS generation)
export * from './translation.js';

// Near-duplicate chunk dedup (SimHash + MinHash-LSH)
export * from './dedup.js';
export { describeDedupConfig } from './dedup.js';
