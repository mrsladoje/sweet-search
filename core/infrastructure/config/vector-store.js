/**
 * Vector Store Configuration — HNSW, Binary HNSW, SEISMIC indices.
 * Split from core/config.js during DDD migration.
 */

import { EMBEDDING_CONFIG } from './embedding.js';

// =============================================================================
// HNSW INDEX CONFIGURATION
// =============================================================================

export const HNSW_CONFIG = {
  // Dimension matches active provider's HNSW dimension
  get dimension() {
    return EMBEDDING_CONFIG.hnswDimension;
  },

  // Index construction
  M: 16,                     // Bi-directional links
  efConstruction: 200,       // Construction-time candidate list

  // Search parameters
  efSearch: 100,             // Query-time candidate list

  // Distance metric
  metric: 'cosine',

  // Memory settings
  maxElements: 100000,
};

// =============================================================================
// BINARY HNSW INDEX CONFIGURATION (32x memory reduction, 10x faster search)
// Reference: https://huggingface.co/blog/embedding-quantization
// =============================================================================

export const BINARY_HNSW_CONFIG = {
  // Binary dimension = float dimension / 8 (bits to bytes)
  // 512d float → 64 bytes binary
  get dimension() {
    return Math.ceil(EMBEDDING_CONFIG.hnswDimension / 8);
  },

  // Float dimension for rescore stage
  get floatDimension() {
    return EMBEDDING_CONFIG.hnswDimension;
  },

  // Index construction (can be more aggressive since search is cheap)
  M: 64,                     // Dense graph for fast convergence + recall
  efConstruction: 800,       // High ef for quality graph construction

  // Search parameters
  efSearch: 400,             // Higher budget — adaptive ef reduces for easy queries

  // Distance metric
  metric: 'hamming',

  // Memory settings (can hold more since binary is 32x smaller)
  maxElements: 500000,

  // 3-stage retrieval configuration
  retrieval: {
    stage1Candidates: 1000,  // Binary HNSW retrieves top 1000
    stage2Candidates: 200,   // Int8 rescores top 200 (legacy fixed, used as maxStage2 fallback)
    stage2_5Candidates: 200, // Float rescore pool size (legacy fixed, used as maxStage2_5 fallback)
    stage3Candidates: 20,    // Reranker sees top 20

    // Phase 1 flag: batched normalized-dot Stage 2 scoring.
    // When false, falls back to per-candidate int8CosineSimilarity.
    useBatchedDot: true,

    // Phase 3: Adaptive oversampling (replaces fixed 200/200 pools)
    // Pool sizes derived from k × oversample, adjusted by score spread.
    adaptive: {
      minStage2: 40,         // Hard minimum for Stage 2 pool
      maxStage2: 400,        // Hard maximum for Stage 2 pool
      oversample1: 10,       // Stage 2 base = k × oversample1
      minStage2_5: 20,       // Hard minimum for Stage 2.5 pool
      maxStage2_5: 200,      // Hard maximum for Stage 2.5 pool
      oversample2: 5,        // Stage 2.5 base = k × oversample2
    },
  },

  // Insertion order for graph quality ('sequential' | 'shuffle' | 'diversity')
  insertionOrder: 'shuffle',

  // Adaptive early termination thresholds (Fix 4).
  // Tune via parameter sweep; values below are starting heuristics.
  earlyTermination: {
    windowSize: 16,             // Sliding window for discovery rate
    // [progressThreshold, discoveryRateThreshold]
    // "If progress > X and discoveryRate < Y, stop."
    thresholds: [
      [0.3, 0.05],  // Mature search with near-zero discovery
      [0.6, 0.10],  // Well-explored with diminishing returns
    ],
  },
};

// =============================================================================
// SEISMIC SPARSE VECTOR INDEX CONFIGURATION
// =============================================================================
// SEISMIC: block-based inverted index with summary pruning for learned sparse
// embeddings (SPLADE, etc.). Third retrieval pathway alongside FTS5 + HNSW.
// Currently DISABLED: requires a code-specific sparse encoder (SPLADE or similar)
// that is not yet available. See docs/AST_OPTIMIZATIONS.md #12 for full plan.

export const SEISMIC_CONFIG = {
  enabled: false,  // Disabled by default until sparse encoder is available
  blockSize: 64,   // Postings per block in inverted lists
  alpha: 0.8,      // Importance fraction (reserved for future scoring tuning)
  weight: 0.2,     // Weight in reciprocal rank fusion (when enabled)
};
