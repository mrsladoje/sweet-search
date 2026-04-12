/**
 * Ranking Configuration — reranking, cascade scoring, late interaction.
 * Split from core/config.js during DDD migration.
 */

const VOYAGEAI_API_KEY = process.env.VOYAGEAI_API_KEY || '';
const JINA_API_KEY = process.env.JINA_API_KEY || '';

// =============================================================================
// RERANKING CONFIGURATION (Tiered)
// =============================================================================

export const RERANK_CONFIG = {
  // Shared settings for remote rerankers
  timeout: 30000,        // 30s timeout for API calls (prevents indefinite hangs)
  maxRetries: 2,         // Retry transient failures up to 2 times
  retryDelayMs: 100,     // Base delay for exponential backoff (100, 200, 400ms)
  maxDocTruncation: {    // Per-document truncation limits
    voyage: 4000,        // Voyage has stricter token limits
    jina: 8000,          // Jina v3 has 131K context, but limit per-doc for efficiency
  },

  // Tier 1: Voyage Rerank-2.5 (same quality as 2, 2x faster latency)
  // Reference: https://agentset.ai/rerankers (Dec 2025 benchmarks)
  voyage: {
    enabled: VOYAGEAI_API_KEY.length > 0,
    priority: 1,
    model: 'rerank-2.5',
    endpoint: 'https://api.voyageai.com/v1/rerank',
    apiKey: VOYAGEAI_API_KEY,
    maxDocuments: 100,
    topK: 20,
  },

  // Tier 2: Jina Reranker v3 (listwise, 0.6B params, SOTA BEIR 61.94)
  // "Last but not late" interaction - arXiv:2509.25085
  // Reference: https://jina.ai/reranker
  jina: {
    enabled: JINA_API_KEY.length > 0,
    priority: 2,
    model: 'jina-reranker-v3',
    endpoint: 'https://api.jina.ai/v1/rerank',
    apiKey: JINA_API_KEY,
    maxDocuments: 100,
    topK: 20,
    contextLength: 131072,  // 131K context window (64 docs simultaneously)
  },

  // Tier 3: FlashRank (manual fallback only)
  flashrank: {
    enabled: true,
    priority: 99,
    model: 'ms-marco-TinyBERT-L-2-v2',
    maxDocLength: 512,
  },
};

// =============================================================================
// LOCAL RERANKER CONFIGURATION (GTE ModernBERT INT8)
//
// Architecture:
// - Model: Alibaba-NLP/gte-reranker-modernbert-base (INT8 quantized)
// - Library: Direct onnxruntime-node + native-tokenizer.js
// - Inference: Sequential scoring with global ONNX mutex (onnx-mutex.js)
// - Latency: ~700ms for 50 docs (~14ms/doc after warmup), ~15s cold start
//
// Default direct reranker priority: Local ModernBERT → Jina API → Voyage API
// =============================================================================

export const LOCAL_RERANKER_CONFIG = {
  // Master switch for local reranker
  // true = Use local ModernBERT INT8 (FREE, ~700ms, works offline)
  // false = Use remote APIs (Voyage $0.05/1K or Jina $0.02/1K)
  useLocalReranker: true,

  // Model settings
  model: {
    name: 'gte-reranker-modernbert-base-int8',
    huggingfaceId: 'Alibaba-NLP/gte-reranker-modernbert-base',
    dtype: 'q8',  // INT8 quantization (~150MB, no AVX512 required)
    path: 'models/gte-reranker-int8',  // HuggingFace cache directory
    maxLength: 512,  // Max tokens per query-document pair
  },

  // Direct reranker settings
  stage2: {
    candidateCount: 50,
    requestTimeout: 10000,        // 10s timeout per request
  },
};

/**
 * Check if local reranker should be used.
 *
 * DEFAULT: TRUE (local reranker enabled by default)
 * Set LOCAL_RERANKER_CONFIG.useLocalReranker = false to use Voyage/Jina API instead.
 *
 * Priority when enabled: Local ModernBERT > Voyage API > Jina API
 *
 * @returns {boolean} True if local reranker should be used
 */
export function shouldUseLocalReranker() {
  return LOCAL_RERANKER_CONFIG.useLocalReranker;
}

// Jina Reranker helpers (separate from embeddings)
export function isJinaRerankerAvailable() {
  return RERANK_CONFIG.jina.enabled;
}

export function getJinaRerankerApiKey() {
  return RERANK_CONFIG.jina.apiKey;
}

// =============================================================================
// CASCADE SCORING CONFIGURATION (Section 26)
// =============================================================================
// Streamlined semantic pipeline: HNSW → expand → MaxSim → gate → conditional CE.
// Default-on. Set SWEET_SEARCH_CASCADE_ENABLED=false to opt out.

export const CASCADE_CONFIG = {
  enabled: process.env.SWEET_SEARCH_CASCADE_ENABLED !== 'false',

  // MaxSim score gap threshold for decisive classification
  gateThreshold: parseFloat(process.env.SWEET_SEARCH_CASCADE_GATE_THRESHOLD) || 0.08,

  // K_max for adaptive-K candidate selection (actual K is 3..ceTopK based on score distribution)
  ceTopK: parseInt(process.env.SWEET_SEARCH_CASCADE_CE_TOP_K) || 20,

  // Whether to force cross-encoder on ALL candidates (bypass gate, for benchmarking)
  forceFullCrossEncoder: process.env.SWEET_SEARCH_FORCE_FULL_CE === 'true',

  // Shadow mode (default ON): compute gate signals + CE in shadow, log results, keep pure-MaxSim ranking.
  // CE rescue has no proven lift over MaxSim on GenCodeSearchNet. Shadow mode collects data
  // to identify the subset where CE helps. Set SWEET_SEARCH_CASCADE_SHADOW=false to activate CE.
  shadowMode: process.env.SWEET_SEARCH_CASCADE_SHADOW !== 'false',
};

// =============================================================================
// LATE INTERACTION CONFIGURATION
// =============================================================================

export const LATE_INTERACTION_CONFIG = {
  // false = disabled, 'lateon-code' = full 149M, 'lateon-code-edge' = 17M
  model: process.env.SWEET_SEARCH_LATE_INTERACTION_MODEL || 'lateon-code',

  get enabled() {
    return !!this.model && this.model !== 'false';
  },

  // Per-model maxDocLength is overridable via SWEET_SEARCH_LI_MAX_DOC_LENGTH.
  // Lower caps (e.g. 1024) trade some long-context recall for ~4× less
  // attention compute on the long-chunk tail (attention is O(seq²)).
  // The A/B benchmark for the cap lives in `eval/run_benchmark.js`.
  models: {
    'lateon-code': {
      hfId: 'lightonai/LateOn-Code',
      onnxFile: 'model_int8.onnx',          // 150 MB INT8
      backboneDim: 768,                      // raw ModernBERT hidden size
      tokenDimension: 128,                   // final output after projection
      projectionPaths: ['1_Dense/model.safetensors'],  // 768→128 single stage
      maxQueryLength: 256,
      get maxDocLength() {
        const env = parseInt(process.env.SWEET_SEARCH_LI_MAX_DOC_LENGTH || '', 10);
        return Number.isFinite(env) && env > 0 ? env : 2048;
      },
      queryPrefix: '[Q] ',
      docPrefix: '[D] ',
    },
    'lateon-code-edge': {
      hfId: 'lightonai/LateOn-Code-edge',
      onnxFile: 'model.onnx',               // 68 MB FP32
      backboneDim: 256,                      // raw ModernBERT hidden size
      tokenDimension: 48,                    // final output after 2-stage projection
      projectionPaths: ['1_Dense/model.safetensors', '2_Dense/model.safetensors'],  // 256→512→48
      maxQueryLength: 256,
      get maxDocLength() {
        const env = parseInt(process.env.SWEET_SEARCH_LI_MAX_DOC_LENGTH || '', 10);
        return Number.isFinite(env) && env > 0 ? env : 2048;
      },
      queryPrefix: '[Q] ',
      docPrefix: '[D] ',
    },
  },

  get activeModel() { return this.models[this.model] || null; },
  get tokenDimension() { return this.activeModel?.tokenDimension || 128; },
  get hfModelId() { return this.activeModel?.hfId || null; },

  // Storage default: int4 per-token quantization for LI tokens.
  // Query-time behavior is restored from persisted index metadata.
  quantization: 'int4',
  blendWeight: 0.3,     // tune per-model in Phase 5

  // 32 skiplist punctuation characters (filtered from doc tokens, NOT query tokens)
  skiplistChars: new Set([
    '!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.',
    '/', ':', ';', '<', '=', '>', '?', '@', '[', '\\', ']', '^', '_', '`',
    '{', '|', '}', '~',
  ]),
};
