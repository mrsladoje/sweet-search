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

// Indexing profiles (re-export from platform)
export * from './indexing.js';

// Code graph config
export * from './graph.js';

// Vector store indices (HNSW, Binary HNSW, SEISMIC)
export * from './vector-store.js';

// Translation, Cerebras, HCGS
export * from './translation.js';

// Aggregate default export (preserves backward compatibility)
import { PROJECT_ROOT, DB_PATHS, detectIndexerProfile, MODEL_DELIVERY_CONFIG, LOGGING, setQuietMode, isQuietMode } from './platform.js';
import { EMBEDDING_PROVIDERS, EMBEDDING_CONFIG, getActiveProvider, isVoyageAvailable, isMistralAvailable, isJinaAvailable, getVoyageApiKey, getJinaApiKey, getOptimalBatchSize } from './embedding.js';
import { RERANK_CONFIG, LOCAL_RERANKER_CONFIG, shouldUseLocalReranker, isJinaRerankerAvailable, getJinaRerankerApiKey, CASCADE_CONFIG, LATE_INTERACTION_CONFIG } from './ranking.js';
import { FILE_PATTERNS, AGENTIC_GITIGNORE_ALLOWLIST, ROUTING_CONFIG, PERFORMANCE_TARGETS, loadProjectConfig } from './search.js';
import { GRAPH_CONFIG } from './graph.js';
import { HNSW_CONFIG, BINARY_HNSW_CONFIG, SEISMIC_CONFIG } from './vector-store.js';
import { CEREBRAS_CONFIG, TRANSLATION_PROVIDERS, TRANSLATION_LOCAL_MODELS, TRANSLATION_CONFIG, HCGS_CONFIG, isCerebrasAvailable, getCerebrasModel, isTranslationAvailable, getTranslationProvider, getTranslationLocalModel } from './translation.js';

export default {
  PROJECT_ROOT,
  DB_PATHS,
  EMBEDDING_PROVIDERS,
  EMBEDDING_CONFIG,
  CEREBRAS_CONFIG,
  TRANSLATION_PROVIDERS,
  TRANSLATION_LOCAL_MODELS,
  TRANSLATION_CONFIG,
  RERANK_CONFIG,
  LOCAL_RERANKER_CONFIG,
  LATE_INTERACTION_CONFIG,
  HNSW_CONFIG,
  BINARY_HNSW_CONFIG,
  SEISMIC_CONFIG,
  GRAPH_CONFIG,
  HCGS_CONFIG,
  ROUTING_CONFIG,
  FILE_PATTERNS,
  PERFORMANCE_TARGETS,
  LOGGING,
  getActiveProvider,
  isVoyageAvailable,
  isMistralAvailable,
  isJinaAvailable,
  isJinaRerankerAvailable,
  getJinaRerankerApiKey,
  isCerebrasAvailable,
  getCerebrasModel,
  isTranslationAvailable,
  getTranslationProvider,
  getTranslationLocalModel,
  getOptimalBatchSize,
  detectIndexerProfile,
  setQuietMode,
  isQuietMode,
  shouldUseLocalReranker,
};
