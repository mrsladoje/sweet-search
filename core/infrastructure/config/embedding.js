/**
 * Embedding Configuration — providers, active config, helper functions.
 * Split from core/config.js during DDD migration.
 */

import { DB_PATHS, detectIndexerProfile } from './platform.js';
import { bootLog } from '../boot-log.js';
import { resolveNativeAddon } from '../native-resolver.js';

const VOYAGEAI_API_KEY = process.env.VOYAGEAI_API_KEY || '';
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const JINA_API_KEY = process.env.JINA_API_KEY || '';

// =============================================================================
// EMBEDDING PROVIDERS (Tiered by preference)
// =============================================================================

export const EMBEDDING_PROVIDERS = {
  // Tier 1: Voyage Code 3 - Best for code retrieval (Dec 2024)
  // 13-17% better than OpenAI/CodeSage, Matryoshka support, int8/binary quantization
  voyage: {
    enabled: VOYAGEAI_API_KEY.length > 0,
    priority: 1,
    apiKey: VOYAGEAI_API_KEY,
    model: 'voyage-code-3',
    endpoint: 'https://api.voyageai.com/v1/embeddings',
    dimensions: {
      full: 1024,           // Default output
      matryoshka: [1024, 512, 256],  // Supported truncations
      hnsw: 512,            // 512d sufficient — 1024d and asymmetric add no quality (tested March 2026)
    },
    contextLength: 32000,   // 32K tokens
    batchSize: 128,
    quantization: ['float', 'int8', 'uint8', 'binary', 'ubinary'],
    rateLimit: {
      requestsPerMinute: 300,
      tokensPerMinute: 1000000,
      maxRetries: 3,
      retryDelay: 1000,
      backoffMultiplier: 2,
    },
    pricing: { perMillionTokens: 0.22 },
  },

  // Tier 2: Mistral Codestral Embed - Claims to outperform Voyage (May 2025)
  // Best on SWE-Bench and Text2Code benchmarks
  mistral: {
    enabled: MISTRAL_API_KEY.length > 0,
    priority: 2,
    apiKey: MISTRAL_API_KEY,
    model: 'codestral-embed-2505',
    endpoint: 'https://api.mistral.ai/v1/embeddings',
    dimensions: {
      full: 3072,           // Maximum output
      matryoshka: [3072, 1024, 512, 256],
      hnsw: 512,
    },
    contextLength: 32000,
    batchSize: 64,
    quantization: ['float', 'int8'],
    rateLimit: {
      requestsPerMinute: 100,
      maxRetries: 3,
      retryDelay: 1000,
      backoffMultiplier: 2,
    },
    pricing: { perMillionTokens: 0.15 },
  },

  // Tier 3: Jina Embeddings v3 - Great multilingual + code support
  // 8192 token context, 89 languages including programming
  jina: {
    enabled: JINA_API_KEY.length > 0,
    priority: 3,
    apiKey: JINA_API_KEY,
    model: 'jina-embeddings-v3',
    endpoint: 'https://api.jina.ai/v1/embeddings',
    dimensions: {
      full: 1024,
      matryoshka: [1024, 512, 256, 128, 64],
      hnsw: 512,
    },
    contextLength: 8192,
    batchSize: 128,
    taskTypes: ['retrieval.query', 'retrieval.passage', 'text-matching', 'classification'],
    rateLimit: {
      requestsPerMinute: 500,
      maxRetries: 3,
      retryDelay: 500,
      backoffMultiplier: 2,
    },
    pricing: { perMillionTokens: 0.02 },
  },

  // Tier 4: Local CodeRankEmbed - Code-specialized offline model (always available)
  // 137M params, 768d, 8192 token context, Apache 2.0
  // CodeSearchNet MRR: 77.9% (vs Voyage Code 3: ~81.7%)
  local: {
    enabled: true,
    priority: 99,
    // FP32 baseline model (522 MB)
    model: 'jalipalo/CodeRankEmbed-onnx',
    // Dynamic INT8 quantized model: 4× smaller (132 MB), ~2× faster, ≥0.96 cosine fidelity
    // Set SWEET_SEARCH_LOCAL_QUANTIZED=false to use the FP32 model instead
    quantizedModel: 'mrsladoje/CodeRankEmbed-onnx-int8',
    queryPrefix: 'Represent this query for searching relevant code: ',
    dimensions: {
      full: 768,
      hnsw: 512,
    },
    contextLength: 8192,
    batchSize: 32,
  },
};

// =============================================================================
// ACTIVE EMBEDDING CONFIGURATION
// =============================================================================

function isRemoteEmbeddingEnabled() {
  const raw = process.env.USE_REMOTE_EMBEDDING?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

// Default to the local embedding model unless the user explicitly opts into
// remote embeddings via USE_REMOTE_EMBEDDING. This keeps indexing and search
// fully offline by default, even when remote API keys are present.
function selectProvider() {
  // Explicit override via SWEET_SEARCH_PROVIDER or EMBEDDING_PROVIDER env var
  const override =
    process.env.SWEET_SEARCH_PROVIDER?.trim().toLowerCase()
    || process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();

  const remoteEnabled = isRemoteEmbeddingEnabled();
  if (override && EMBEDDING_PROVIDERS[override]) {
    const config = EMBEDDING_PROVIDERS[override];
    if (override === 'local') {
      return { name: override, config };
    }
    if (remoteEnabled && config.enabled) {
      return { name: override, config };
    }
  }

  if (!remoteEnabled) {
    return { name: 'local', config: EMBEDDING_PROVIDERS.local };
  }

  const availableRemote = Object.entries(EMBEDDING_PROVIDERS)
    .filter(([name, provider]) => name !== 'local' && provider.enabled)
    .sort((a, b) => a[1].priority - b[1].priority);

  if (availableRemote.length > 0) {
    return { name: availableRemote[0][0], config: availableRemote[0][1] };
  }

  return { name: 'local', config: EMBEDDING_PROVIDERS.local };
}

const activeProvider = selectProvider();

export const EMBEDDING_CONFIG = {
  // Active provider info
  provider: activeProvider.name,
  providerConfig: activeProvider.config,

  // Convenience getters
  get model() {
    return this.providerConfig.model;
  },

  get dimension() {
    return this.providerConfig.dimensions.full;
  },

  get hnswDimension() {
    return this.providerConfig.dimensions.hnsw;
  },

  get batchSize() {
    return this.providerConfig.batchSize;
  },

  /** Outer indexer batch size (how many texts per getEmbeddings() call).
   *  Platform-aware for local models: Apple Silicon uses larger batches;
   *  x86/WSL uses batch=1.  Override via SWEET_SEARCH_INDEXER_BATCH_SIZE. */
  get indexerBatchSize() {
    const envVal = parseInt(process.env.SWEET_SEARCH_INDEXER_BATCH_SIZE || '', 10);
    if (Number.isFinite(envVal) && envVal > 0) return envVal;
    if (this.provider !== 'local') return this.providerConfig.batchSize;
    return detectIndexerProfile().batchSize;
  },

  /** Rows to accumulate before flushing a DB write transaction.
   *  Platform-aware for local models: Apple Silicon flushes immediately;
   *  x86/WSL batches writes.  Override via SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS. */
  get indexerWriteFlushRows() {
    const envVal = parseInt(process.env.SWEET_SEARCH_INDEXER_WRITE_FLUSH_ROWS || '', 10);
    if (Number.isFinite(envVal) && envVal > 0) return envVal;
    if (this.provider !== 'local') return 128;
    return detectIndexerProfile().flushRows;
  },

  /** Whether to run late interaction encoding in parallel with vector embeddings.
   *
   *  **Default policy**:
   *  - Metal (native candle inference on Apple Silicon): ON. Inference runs
   *    on the GPU, so NomicBERT and ModernBERT don't fight for L2 cache.
   *    CPU-side work (tokenization, sqlite writes, HCGS summaries) and
   *    Metal command dispatches overlap naturally.
   *  - ORT / CPU / remote providers: OFF. The old rationale still holds —
   *    both ONNX sessions run on the CPU and fight for L2 cache + threads,
   *    so serializing them is faster than racing them.
   *
   *  Override via SWEET_SEARCH_PARALLEL_LI=0 or =1.
   */
  get parallelLateInteraction() {
    const envVal = process.env.SWEET_SEARCH_PARALLEL_LI;
    if (envVal === '0') return false;
    if (envVal === '1') return true;
    if (this.provider !== 'local') return false;
    // Default ON only on the native Metal path. The old "both ONNX sessions
    // fight for L2 cache" rationale still holds for CPU/ORT, so non-Metal
    // stays OFF. Uses resolveNativeAddon() (no side effects) instead of
    // importing native-inference.js, which would create a circular import.
    const nativeDisabled = ['0', 'false', 'off'].includes(
      (process.env.SWEET_SEARCH_NATIVE_INFERENCE ?? '').trim().toLowerCase(),
    );
    const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64';
    if (isAppleSilicon && !nativeDisabled && resolveNativeAddon()) {
      return true;
    }
    return detectIndexerProfile().parallelLI;
  },

  get contextLength() {
    return this.providerConfig.contextLength;
  },

  get isRemote() {
    return this.provider !== 'local';
  },

  // Query embedding cache
  cache: {
    enabled: true,
    maxSize: 1000,
    vocabularyPath: DB_PATHS.vocabulary,
    // Whether `getEmbedding` consults the persistent query-vocabulary
    // cache before calling the live model. Disable to force fresh
    // model output on every query — required for reproducible
    // benchmarks against a populated vocab file. Reads only; writes
    // are gated separately by `autoExpand` below.
    useVocabulary: process.env.SWEET_SEARCH_VOCAB_USE !== '0'
      && process.env.SWEET_SEARCH_VOCAB_USE !== 'false',
    // Whether queries that fire ≥ `expansionThreshold` times within a
    // process are auto-promoted into the persistent vocabulary file.
    autoExpand: process.env.SWEET_SEARCH_VOCAB_AUTO_EXPAND !== '0'
      && process.env.SWEET_SEARCH_VOCAB_AUTO_EXPAND !== 'false',
    expansionThreshold: 3,
    // Hard cap on auto-expanded vocabulary size. Once reached, new
    // auto-promotions are skipped; explicit `addToVocabulary` /
    // `expandVocabulary` calls still write through. Override with
    // `SWEET_SEARCH_VOCAB_MAX_TERMS` (range 1..1e6).
    maxTerms: (() => {
      const v = parseInt(process.env.SWEET_SEARCH_VOCAB_MAX_TERMS || '', 10);
      if (Number.isFinite(v) && v > 0 && v <= 1_000_000) return v;
      return 10_000;
    })(),
  },

  // All available providers for fallback
  providers: EMBEDDING_PROVIDERS,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getActiveProvider() {
  return activeProvider;
}

export function isVoyageAvailable() {
  return EMBEDDING_PROVIDERS.voyage.enabled;
}

export function isMistralAvailable() {
  return EMBEDDING_PROVIDERS.mistral.enabled;
}

export function isJinaAvailable() {
  return EMBEDDING_PROVIDERS.jina.enabled;
}

export function getVoyageApiKey() {
  return EMBEDDING_PROVIDERS.voyage.apiKey;
}

export function getJinaApiKey() {
  return EMBEDDING_PROVIDERS.jina.apiKey;
}

export function getOptimalBatchSize() {
  const heapUsed = process.memoryUsage().heapUsed;
  const heapTotal = process.memoryUsage().heapTotal;
  const usageRatio = heapUsed / heapTotal;

  if (usageRatio > 0.8) return Math.floor(EMBEDDING_CONFIG.batchSize / 4);
  if (usageRatio > 0.6) return Math.floor(EMBEDDING_CONFIG.batchSize / 2);
  return EMBEDDING_CONFIG.batchSize;
}

// Active configuration (silent by default, set SEARCH_DEBUG=1 to enable)
if (process.env.SEARCH_DEBUG) {
  console.log(`[Sweet Search] Active provider: ${EMBEDDING_CONFIG.provider} (${EMBEDDING_CONFIG.model})`);
  bootLog(`[Sweet Search] Dimensions: ${EMBEDDING_CONFIG.dimension}d full, ${EMBEDDING_CONFIG.hnswDimension}d HNSW`);
}
