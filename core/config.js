/**
 * Sweet Search Configuration v2.3 (SOTA December 2025)
 *
 * Hybrid search stack with tiered embedding providers:
 * - Tier 1: Voyage Code 3 (best for code, 1024d, Matryoshka)
 * - Tier 2: Mistral Codestral Embed (3072d, claims SOTA)
 * - Tier 3: Jina Embeddings v3 (8192 tokens, multilingual)
 * - Tier 4: Local Xenova (offline fallback)
 *
 * Reranking: Voyage rerank-2 → Jina reranker v3 → FlashRank local
 * Late Interaction: Jina ColBERT v2 (code + 89 languages)
 *
 * References:
 * - https://blog.voyageai.com/2024/12/04/voyage-code-3/
 * - https://mistral.ai/news/codestral-embed
 * - https://jina.ai/news/jina-colbert-v2-multilingual-late-interaction-retriever-for-embedding-and-reranking/
 */

import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveProjectRoot() {
  const fromEnv = process.env.SWEET_SEARCH_PROJECT_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  // In standalone repo and npm scripts, cwd is the workspace root.
  return process.cwd();
}

// Project root detection
export const PROJECT_ROOT = resolveProjectRoot();

// =============================================================================
// ENVIRONMENT & API KEYS
// =============================================================================

// Load .env file if exists (check both local and project root)
try {
  const { existsSync, readFileSync } = await import('fs');

  // Priority 1: Local .env (in sweet-search directory)
  const localEnvPath = path.join(__dirname, '..', '.env');
  // Priority 2: Project root .env
  const projectEnvPath = path.join(PROJECT_ROOT, '.env');

  const dotenvPath = existsSync(localEnvPath) ? localEnvPath : projectEnvPath;

  if (existsSync(dotenvPath)) {
    const envContent = readFileSync(dotenvPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=]+)=["']?([^"'\n]+)["']?$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }
} catch (e) { /* .env loading is optional */ }

const VOYAGEAI_API_KEY = process.env.VOYAGEAI_API_KEY || '';
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const JINA_API_KEY = process.env.JINA_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// =============================================================================
// DATABASE PATHS
// =============================================================================

// Data directory: SWEET_SEARCH_DATA_DIR (canonical) or AGENTDB_PATH (deprecated fallback)
const DATA_DIR_NAME = (() => {
  if (process.env.SWEET_SEARCH_DATA_DIR) {
    return process.env.SWEET_SEARCH_DATA_DIR;
  }
  if (process.env.AGENTDB_PATH) {
    console.error('[sweet-search] AGENTDB_PATH is deprecated. Use SWEET_SEARCH_DATA_DIR instead.');
    return process.env.AGENTDB_PATH;
  }
  return '.sweet-search';
})();

export const DB_PATHS = {
  // Main codebase vectors
  codebase: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase.db'),

  // Code graph (entities + relationships + FTS5 + summaries)
  codeGraph: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'code-graph.db'),

  // HNSW index (in-memory at query time)
  hnswIndex: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-hnsw.idx'),

  // Binary HNSW index (32x smaller, Hamming distance)
  binaryHnswIndex: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-binary-hnsw.idx'),

  // Int8 vectors for rescore stage
  // DEPRECATED: This SQLite DB path is no longer used. Int8 vectors are stored in
  // .int8.json sidecar alongside binary HNSW index. See binary-hnsw-index.js.
  // Kept for backward compatibility - getArtifactStats() warns if this file exists.
  int8Vectors: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-int8.db'),

  // ColBERT token embeddings (late interaction)
  colbert: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'codebase-colbert.db'),

  // Merkle state for incremental indexing
  merkle: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'merkle-state.json'),

  // Query vocabulary cache
  vocabulary: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'query-vocabulary.json'),

  // HCGS summaries cache (hierarchical code graph summaries)
  summaries: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'code-summaries.json'),

  // Translation cache
  translationCache: path.join(PROJECT_ROOT, DATA_DIR_NAME, 'translation-cache.json'),
};

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
      hnsw: 512,            // Optimal for HNSW (balance speed/quality)
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

  // Tier 4: Local Xenova - Offline fallback (always available)
  local: {
    enabled: true,
    priority: 99,
    model: 'Xenova/all-MiniLM-L6-v2',
    dimensions: {
      full: 384,
      hnsw: 256,
    },
    contextLength: 512,
    batchSize: 32,
  },
};

// =============================================================================
// ACTIVE EMBEDDING CONFIGURATION
// =============================================================================

// Select best available provider
function selectProvider() {
  const available = Object.entries(EMBEDDING_PROVIDERS)
    .filter(([_, p]) => p.enabled)
    .sort((a, b) => a[1].priority - b[1].priority);

  if (available.length === 0) {
    return { name: 'local', config: EMBEDDING_PROVIDERS.local };
  }

  return { name: available[0][0], config: available[0][1] };
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
    autoExpand: true,
    expansionThreshold: 3,
  },

  // All available providers for fallback
  providers: EMBEDDING_PROVIDERS,
};

// =============================================================================
// CEREBRAS GLM CONFIGURATION (Fast Standalone LLM)
// Reference: https://inference-docs.cerebras.ai/models/zai-glm-46
// =============================================================================

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';

// =============================================================================
// TRANSLATION CONFIGURATION (T3 Tier)
// Reference: docs/TRANSLATION.md
// =============================================================================

export const TRANSLATION_PROVIDERS = {
  // Tier 1: Cerebras (current default, reuses CEREBRAS_API_KEY)
  cerebras: {
    enabled: CEREBRAS_API_KEY.length > 0,
    priority: 1,
    name: 'Cerebras',
    apiKey: CEREBRAS_API_KEY,
    baseUrl: 'https://api.cerebras.ai/v1',
    endpoint: '/chat/completions',
    model: process.env.CEREBRAS_TRANSLATE_MODEL || 'llama3.1-8b',
    maxTokens: 100,
    temperature: 0.1,
    rateLimit: {
      timeout: 5000,
      maxRetries: 2,
      retryDelay: 100,
      backoffMultiplier: 2,
    },
    pricing: { perMillionTokens: 0.20 },
  },

  // Tier 2: Groq (50% cheaper, good speed)
  groq: {
    enabled: GROQ_API_KEY.length > 0,
    priority: 2,
    name: 'Groq',
    apiKey: GROQ_API_KEY,
    baseUrl: 'https://api.groq.com/openai/v1',
    endpoint: '/chat/completions',
    model: process.env.GROQ_TRANSLATE_MODEL || 'llama-3.1-8b-instant',
    maxTokens: 100,
    temperature: 0.1,
    rateLimit: {
      timeout: 5000,
      maxRetries: 2,
      retryDelay: 100,
      backoffMultiplier: 2,
    },
    pricing: { perMillionTokens: 0.13 },
  },

  // Tier 3: OpenRouter (free tier)
  openrouter: {
    enabled: OPENROUTER_API_KEY.length > 0,
    priority: 3,
    name: 'OpenRouter',
    apiKey: OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    endpoint: '/chat/completions',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    maxTokens: 100,
    temperature: 0.1,
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/panonitorg/sweet-search',
      'X-Title': 'Sweet Search Translation',
    },
    rateLimit: {
      timeout: 10000,
      maxRetries: 2,
      retryDelay: 500,
      backoffMultiplier: 2,
    },
    pricing: { perMillionTokens: 0 },
  },

  // Tier 99: Custom (for Ollama, LM Studio, vLLM)
  custom: {
    enabled: process.env.TRANSLATION_API_URL?.length > 0,
    priority: 99,
    name: 'Custom',
    apiKey: process.env.TRANSLATION_API_KEY || '',
    baseUrl: process.env.TRANSLATION_API_URL || 'http://localhost:11434/v1',
    endpoint: '/chat/completions',
    model: process.env.TRANSLATION_MODEL || 'llama3.1:8b',
    maxTokens: 100,
    temperature: 0.1,
    rateLimit: {
      timeout: 30000,
      maxRetries: 1,
      retryDelay: 1000,
      backoffMultiplier: 1,
    },
    pricing: { perMillionTokens: 0 },
  },
};

export const TRANSLATION_LOCAL_MODELS = {
  // Default: NLLB-200 (broad coverage)
  'nllb-200': {
    enabled: true,
    priority: 1,
    name: 'NLLB-200 Distilled',
    type: 'translation',  // Transformers.js pipeline type
    model: 'Xenova/nllb-200-distilled-600M',
    quantized: true,
    device: 'cpu',
    size: '600MB',
    languages: 200,
    avgLatency: '500-1000ms',
  },

  // Faster: Opus-MT many-to-English
  'opus-mt': {
    enabled: true,
    priority: 2,
    name: 'Opus-MT Many→English',
    type: 'translation',
    model: 'Helsinki-NLP/opus-mt-mul-en',
    quantized: true,
    device: 'cpu',
    size: '300MB',
    languages: 'many→en',
    avgLatency: '50-200ms',
  },

  // Experimental: mT5 (requires text2text-generation pipeline)
  'mt5-small': {
    enabled: false,  // Disabled by default - experimental
    priority: 99,
    name: 'mT5 Small',
    type: 'text2text-generation',  // Different pipeline!
    model: 'google/mt5-small',
    quantized: true,
    device: 'cpu',
    size: '300MB',
    languages: 101,
    avgLatency: '100-300ms',
    experimental: true,
    note: 'Requires different prompting strategy',
  },
};

// Select best available cloud provider
function selectTranslationProvider() {
  const available = Object.entries(TRANSLATION_PROVIDERS)
    .filter(([_, p]) => p.enabled)
    .sort((a, b) => a[1].priority - b[1].priority);

  if (available.length === 0) {
    return { name: null, config: null };
  }

  return { name: available[0][0], config: available[0][1] };
}

// Select best available local model
function selectLocalModel() {
  const available = Object.entries(TRANSLATION_LOCAL_MODELS)
    .filter(([_, m]) => m.enabled && !m.experimental)
    .sort((a, b) => a[1].priority - b[1].priority);

  if (available.length === 0) {
    return { name: 'nllb-200', config: TRANSLATION_LOCAL_MODELS['nllb-200'] };
  }

  return { name: available[0][0], config: available[0][1] };
}

const autoSelectedProvider = selectTranslationProvider();
const autoSelectedLocalModel = selectLocalModel();

// Handle env overrides with proper config derivation
const envProviderKey = process.env.TRANSLATION_PROVIDER;
const envLocalModelKey = process.env.TRANSLATION_LOCAL_MODEL;

// If env forces a provider, derive config from that key (not auto-selected)
const activeProviderKey = envProviderKey || autoSelectedProvider.name;
const activeProviderConfig = envProviderKey
  ? TRANSLATION_PROVIDERS[envProviderKey] || null
  : autoSelectedProvider.config;

// If env forces a local model, derive config from that key
const activeLocalModelKey = envLocalModelKey || autoSelectedLocalModel.name;
const activeLocalModelConfig = envLocalModelKey
  ? TRANSLATION_LOCAL_MODELS[envLocalModelKey] || null
  : autoSelectedLocalModel.config;

export const TRANSLATION_CONFIG = {
  // Active cloud provider (env override or auto-selected)
  provider: activeProviderKey,
  providerConfig: activeProviderConfig,

  // Active local model (env override or auto-selected)
  localModel: activeLocalModelKey,
  localModelConfig: activeLocalModelConfig,

  // Convenience getters - now consistent with env overrides
  get isCloudAvailable() {
    // Check if the active provider is actually enabled (has API key)
    const config = this.providerConfig;
    return config !== null && config.enabled === true;
  },

  get isOfflineMode() {
    return process.env.TRANSLATION_OFFLINE === 'true' || !this.isCloudAvailable;
  },

  // Prompt templates
  prompts: {
    short: `Translate to English (preserve code identifiers): "{query}"

Translation:`,

    extended: `Translate this code search query to English.

RULES:
1. Preserve code identifiers (PascalCase, camelCase, snake_case) unchanged
2. Translate natural language parts to English programming terminology
3. Output ONLY the translated query, nothing else
4. If already English, return as-is

Query: {query}

Translation:`,

    // Use extended prompt for queries longer than this
    extendedThreshold: 50,
  },

  // Output cleaning (fixes Cerebras verbose output)
  cleaning: {
    enabled: true,
    stripPrefixes: [
      /^The translation of .+? (?:to English )?is[:\s]*/i,
      /^(?:Here'?s? (?:the )?)?translation[:\s]*/i,
      /^In English[,:\s]*/i,
      /^Translated[:\s]*/i,
      /^English[:\s]*/i,
      /^Output[:\s]*/i,
    ],
    stripQuotes: true,
    firstLineOnly: true,
    maxLength: 200,
  },

  // Pipeline behavior
  pipeline: {
    // Fallback order (evaluated in sequence)
    // 'cloud' = active cloud provider, 'local' = active local model
    fallbackOrder: ['cloud', 'local', 'passthrough'],

    // CRITICAL FIX: Make "likely English" a SOFT hint, not hard stop
    // When true: skip translation ONLY if isLikelyEnglish AND results are good
    // When false: old behavior (hard stop on ASCII queries)
    softEnglishCheck: true,

    // Minimum result score to skip translation for ASCII queries
    // (only applies when softEnglishCheck is true)
    softEnglishMinScore: 0.3,

    // Minimum result count to skip translation for ASCII queries
    softEnglishMinResults: 3,
  },

  // Latin-script language detection (fixes German/French/Spanish)
  // NOTE: Order matters! More specific patterns should come first.
  // Patterns are checked in order; first match wins.
  latinDetection: {
    enabled: true,
    patterns: {
      // German: ä, ö, ü, ß (unique diacritics)
      // Removed compoundWord pattern - too aggressive, matches English identifiers
      deu_Latn: {
        diacritics: /[äöüß]/i,
      },
      // Polish: unique chars ą, ć, ę, ł, ń, ś, ź, ż (check before Spanish/French)
      pol_Latn: {
        diacritics: /[ąćęłńśźż]/i,
      },
      // Czech: unique chars ě, ř, ů (check before Spanish/French)
      ces_Latn: {
        diacritics: /[ěřůčďňšťž]/i,
      },
      // French: unique chars à, â, ç, è, ê, ë, î, ï, ô, ù, û, ÿ, œ, æ (check before Spanish)
      // Note: é is shared with Spanish, but French has more unique chars
      fra_Latn: {
        diacritics: /[àâçèêëîïôùûÿœæ]/i,
      },
      // Portuguese: unique chars ã, õ (check before Spanish)
      por_Latn: {
        diacritics: /[ãõ]/i,
      },
      // Spanish: á, é, í, ó, ú, ñ, ¿, ¡ (most common, check last)
      spa_Latn: {
        diacritics: /[ñ¿¡]/i,
      },
    },
  },

  // Caching (uses .sweet-search/ for consistency)
  cache: {
    enabled: true,
    ttl: 3600000,  // 1 hour
    maxEntries: 10000,
    // Cache key includes: query + provider + model + promptVersion + cleaningVersion
    // This prevents stale results when config changes
    keyVersion: 1,
    filePath: DB_PATHS.translationCache,
  },

  // All providers/models for manual selection
  providers: TRANSLATION_PROVIDERS,
  localModels: TRANSLATION_LOCAL_MODELS,
};

// Helper functions (following existing patterns)
export function isTranslationAvailable() {
  return TRANSLATION_CONFIG.isCloudAvailable || TRANSLATION_CONFIG.localModelConfig !== null;
}

export function getTranslationProvider(providerKey = null) {
  const key = providerKey || TRANSLATION_CONFIG.provider;
  return TRANSLATION_PROVIDERS[key] || null;
}

export function getTranslationLocalModel(modelKey = null) {
  const key = modelKey || TRANSLATION_CONFIG.localModel;
  return TRANSLATION_LOCAL_MODELS[key] || null;
}

export const CEREBRAS_CONFIG = {
  enabled: CEREBRAS_API_KEY.length > 0,
  apiKey: CEREBRAS_API_KEY,
  baseUrl: 'https://api.cerebras.ai/v1',

  // Available models (December 2025)
  // Run: node -e "fetch('https://api.cerebras.ai/v1/models', {headers:{'Authorization':'Bearer '+process.env.CEREBRAS_API_KEY}}).then(r=>r.json()).then(d=>d.data.forEach(m=>console.log(m.id)))"
  models: {
    // GLM-4.6: Best general purpose reasoning (~1000 tok/s)
    'glm-4.6': {
      id: 'zai-glm-4.6',
      contextLength: 131072,  // 131K
      features: ['reasoning', 'tool_use', 'json_mode'],
      speed: '1000+ tok/s',
      strengths: ['general', 'fast', 'reasoning'],
    },
    // Qwen 3 235B: Large MoE model for complex tasks
    'qwen3-235b': {
      id: 'qwen-3-235b-a22b-instruct-2507',
      contextLength: 32768,
      features: ['instruct'],
      speed: '500+ tok/s',
      strengths: ['complex', 'multilingual'],
    },
    // Llama 3.3 70B: Strong all-rounder
    'llama-70b': {
      id: 'llama-3.3-70b',
      contextLength: 128000,
      features: ['instruct', 'tool_use'],
      speed: '800+ tok/s',
      strengths: ['coding', 'general'],
    },
    // Llama 3.1 8B: Fast small model
    'llama-8b': {
      id: 'llama3.1-8b',
      contextLength: 128000,
      features: ['instruct'],
      speed: '2000+ tok/s',
      strengths: ['fast', 'simple'],
    },
    // Qwen 3 32B: Good balance of speed and quality
    'qwen3-32b': {
      id: 'qwen-3-32b',
      contextLength: 32768,
      features: ['instruct'],
      speed: '1000+ tok/s',
      strengths: ['balanced', 'multilingual'],
    },
  },

  // Default model for different use cases
  defaults: {
    fast: 'zai-glm-4.6',           // Speed + quality balance
    coding: 'llama-3.3-70b',       // Best for code
    simple: 'llama3.1-8b',         // Quick simple tasks
    hcgs: 'zai-glm-4.6',           // Summary generation
    complex: 'qwen-3-235b-a22b-instruct-2507',  // Complex reasoning
  },

  // Reasoning mode (disable for faster direct responses)
  reasoning: {
    // disable_reasoning: true skips chain-of-thought
    fastMode: true,  // Default: no CoT for speed
  },
};

export function isCerebrasAvailable() {
  return CEREBRAS_CONFIG.enabled;
}

export function getCerebrasModel(useCase = 'fast') {
  return CEREBRAS_CONFIG.defaults[useCase] || CEREBRAS_CONFIG.defaults.fast;
}

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

  // Tier 3: FlashRank (local, no API needed)
  // TinyBERT: 8x faster than MiniLM (8ms vs 75ms), same accuracy on raw code
  // Will be fine-tuned on code search data for improved accuracy
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
// - Library: @huggingface/transformers (auto-downloads model on first use)
// - Inference: Sequential scoring with global ONNX mutex (onnx-mutex.js)
// - Latency: ~700ms for 50 docs (~14ms/doc after warmup), ~15s cold start
//
// Cascade Priority: FlashRank TinyBERT (~15ms) → Local ModernBERT → Voyage API → Jina API
// Skip Logic: Stage 2 skipped if FlashRank scores show clear winner (see flashrank.js)
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

  // Stage 2 cascade settings
  stage2: {
    candidateCount: 50,           // Rerank top 50 from FlashRank Stage 1
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

// =============================================================================
// COLBERT LATE INTERACTION CONFIGURATION
// =============================================================================

export const COLBERT_CONFIG = {
  // Jina ColBERT v2 - Multilingual + code support
  // 6.5% better than ColBERT v2, 89 languages including programming
  enabled: true,              // Master switch: auto-enable ColBERT for uncached queries
  model: 'jinaai/jina-colbert-v2',
  tokenDimension: 128,        // Full token dimension
  compressedDimension: 64,    // 50% compression, 1.5% accuracy loss
  maxTokensPerDoc: 512,
  quantization: 'int8',       // 4x compression
  useLocal: true,             // Use local model via transformers.js
  blendWeight: 0.3,           // 30% ColBERT, 70% int8 score
};

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
  M: 32,                     // More links for better recall
  efConstruction: 400,       // Higher ef for better graph quality

  // Search parameters
  efSearch: 200,             // Higher ef since Hamming is cheap

  // Distance metric
  metric: 'hamming',

  // Memory settings (can hold more since binary is 32x smaller)
  maxElements: 500000,

  // 3-stage retrieval configuration
  retrieval: {
    stage1Candidates: 1000,  // Binary HNSW retrieves top 1000
    stage2Candidates: 100,   // Int8 rescores top 100
    stage3Candidates: 20,    // Reranker sees top 20
  },
};

// =============================================================================
// CODE GRAPH CONFIGURATION
// =============================================================================

export const GRAPH_CONFIG = {
  relationshipWeights: {
    extends: 2.0,
    implements: 1.8,
    overrides: 1.5,
    calls: 1.0,
    uses: 0.5,
    throws: 0.6,
    imports: 0.3,
  },
  expansion: {
    maxHops: 2,
    maxExpanded: 30,
  },
};

// =============================================================================
// HCGS CONFIGURATION (Hierarchical Code Graph Summaries)
// Reference: https://arxiv.org/abs/2504.08975 (Code-Craft paper, April 2025)
// =============================================================================

export const HCGS_CONFIG = {
  // Summary generation
  enabled: true,

  // Hierarchy levels (bottom-up order)
  levels: ['function', 'method', 'field', 'class', 'interface', 'enum', 'package', 'file'],

  // Adaptive summary token limits by entity type (SOTA December 2025)
  // Based on: Code-Craft paper + Qodo RAG recommendations
  // Key insight: complexity-aware lengths improve retrieval precision
  summaryTokenLimits: {
    // Leaf entities: brief descriptions (1-2 sentences)
    method: 80,       // "Validates user credentials against database and returns boolean result"
    function: 80,     // Same as method
    field: 40,        // "User ID for session tracking"
    rpc: 80,          // "gRPC endpoint for streaming events"

    // Container entities: purpose + responsibilities
    class: 150,       // Describe purpose, key methods, design patterns
    interface: 120,   // Contract description + key method signatures
    enum: 60,         // List values and their meaning
    service: 150,     // Service responsibilities + dependencies
    message: 80,      // Protobuf message structure

    // File/Package level: architectural overview
    file: 200,        // Main exports, dependencies, role in system
    package: 250,     // Package purpose + key classes + relationships
  },

  // Default for unknown types
  defaultTokenLimit: 100,

  // Legacy fallback (chars) - kept for backward compatibility
  maxSummaryLength: 500,        // ~100-125 tokens
  maxChildContext: 800,         // chars of child summaries to include

  // Model for summary generation (Claude Haiku is fast and cheap)
  model: 'claude-3-5-haiku-latest',

  // Batch processing
  batchSize: 20,

  // Cache settings
  cacheEnabled: true,

  // Token savings: return summary first, full code on "expand"
  returnSummaryFirst: true,
  summaryTokenBudget: 150,      // tokens per result in summary mode
  fullCodeTokenBudget: 1000,    // tokens per result in expanded mode
};

// =============================================================================
// QUERY ROUTING CONFIGURATION
// =============================================================================

export const ROUTING_CONFIG = {
  lexicalPatterns: [
    /^[A-Z][a-zA-Z0-9]*$/,           // CamelCase (starts with capital)
    /^[a-z]+[A-Z][a-zA-Z0-9]*$/,     // camelCase (has capital in middle) - Fix #3
    /^[a-z][a-z0-9_]*_[a-z0-9_]+$/,  // snake_case (must have underscore) - Fix #3
    /^[A-Z_][A-Z0-9_]*$/,            // SCREAMING_SNAKE
    /\.(java|js|jsx|ts|tsx|proto)$/, // File extensions
    /\/|\\/,                          // Paths
    /"[^"]*"/,                        // Quoted strings
    /\bclass\s+\w+/,
    /\bfunction\s+\w+/,
    /\binterface\s+\w+/,
    // Fix #5: Code Structural Keywords
    /\b(method|constructor|field|property|annotation|decorator|enum|abstract|static|final|private|public|protected)\b/i,
    /^@\w+/,  // Annotations: @Override, @Test
    /\b(extends|implements)\s+\w+/i,
  ],
  semanticPatterns: [
    /how\s+(does|do|to|can)/i,
    /what\s+(is|are|does)/i,
    /why\s+(does|is|are)/i,
    /where\s+(is|are|does)/i,
    /find\s+.*\s+(that|which)/i,
    /\s+(related|similar)\s+to/i,
    /implement/i,
    /handle|handling/i,
    /work(s|ing)?/i,
    // Fix #4: Imperative Command Detection
    /^(list|show|find|get|fetch|retrieve|search|locate)\s+(all|any)/i,
    /^(list|show|display)\s+/i,
  ],
  defaultMode: 'hybrid',
};

// =============================================================================
// FILE PATTERNS
// =============================================================================

export const FILE_PATTERNS = {
  include: [
    // Source code (all major languages)
    '**/*.{js,jsx,ts,tsx,mjs,cjs}',      // JavaScript/TypeScript
    '**/*.{java,kt,kts,scala,groovy}',    // JVM
    '**/*.{py,pyi}',                       // Python
    '**/*.{go}',                           // Go
    '**/*.{rs}',                           // Rust
    '**/*.{c,cpp,cc,cxx,h,hpp,hxx}',      // C/C++
    '**/*.{cs,fs,vb}',                     // .NET
    '**/*.{rb,erb}',                       // Ruby
    '**/*.{php}',                          // PHP
    '**/*.{swift,m,mm}',                   // Apple
    '**/*.{lua,zig,nim,ex,exs}',           // Other
    '**/*.{sh,bash,zsh,fish,ps1}',         // Shell
    '**/*.{sql}',                          // SQL
    '**/*.{proto}',                        // Protobuf
    '**/*.{graphql,gql}',                  // GraphQL
    // Config & docs
    '**/*.{json,yaml,yml,toml,xml}',       // Config
    '**/*.{md,mdx,rst,txt}',               // Documentation
    '**/*.{html,css,scss,less,svg}',        // Web
    // Project markers
    '**/CLAUDE.md',
    '**/README.md',
  ],
  exclude: [
    '**/node_modules/**',
    '**/target/**',
    '**/build/**',
    '**/dist/**',
    '**/.git/**',
    '**/.vite/**',
    '**/coverage/**',
    '**/__pycache__/**',
    '**/*.class',
    '**/*.log',
    '**/bun.lock',
    '**/package-lock.json',
  ],
};

/**
 * Load per-project configuration from .sweet-search.config.json
 * Precedence: config file > defaults. Environment variables > config file.
 *
 * @param {string} [projectRoot] - Project root to search for config file
 * @returns {{ include: string[], exclude: string[], projectRoot?: string }}
 */
export function loadProjectConfig(projectRoot = process.cwd()) {
  const configPath = path.join(projectRoot, '.sweet-search.config.json');

  if (!existsSync(configPath)) {
    return { include: FILE_PATTERNS.include, exclude: FILE_PATTERNS.exclude };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Validate known keys, warn on unknown
    const knownKeys = new Set(['include', 'exclude', 'projectRoot', 'indexDocs', 'maxFileSize']);
    for (const key of Object.keys(config)) {
      if (!knownKeys.has(key)) {
        console.error(`[sweet-search] Warning: unknown key "${key}" in .sweet-search.config.json`);
      }
    }

    return {
      include: Array.isArray(config.include) ? config.include : FILE_PATTERNS.include,
      exclude: Array.isArray(config.exclude) ? [...FILE_PATTERNS.exclude, ...config.exclude] : FILE_PATTERNS.exclude,
      ...(config.projectRoot ? { projectRoot: config.projectRoot } : {}),
    };
  } catch (err) {
    console.error(`[sweet-search] Error loading .sweet-search.config.json: ${err.message}`);
    return { include: FILE_PATTERNS.include, exclude: FILE_PATTERNS.exclude };
  }
}

// =============================================================================
// PERFORMANCE TARGETS
// =============================================================================

export const PERFORMANCE_TARGETS = {
  latency: {
    lexicalP50: 10,
    hnswLookupP50: 1,
    semanticP50: 150,
    rerankP50: 100,
  },
  accuracy: {
    topKRecall: 0.85,
  },
};

// =============================================================================
// LOGGING
// =============================================================================

// Global quiet mode flag - set by CLI tools when --quiet is passed
let _quietMode = false;

/**
 * Set quiet mode globally. When enabled:
 * - timing logs are suppressed
 * - verbose logs are suppressed
 * - Only errors and essential output are shown
 *
 * @param {boolean} enabled - Whether quiet mode should be enabled
 */
export function setQuietMode(enabled) {
  _quietMode = enabled;
}

/**
 * Check if quiet mode is currently enabled.
 * @returns {boolean} - True if quiet mode is enabled
 */
export function isQuietMode() {
  return _quietMode;
}

export const LOGGING = {
  // Verbose logging (detailed operation info)
  get verbose() {
    return !_quietMode && process.env.SEARCH_VERBOSE === 'true';
  },

  // Timing logs (performance measurements)
  // Only enabled when SEARCH_TIMING=true AND not in quiet mode
  get timing() {
    return !_quietMode && process.env.SEARCH_TIMING === 'true';
  },

  // Debug logs (developer debugging)
  get debug() {
    return process.env.SEARCH_DEBUG === 'true';
  },
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

// Jina Reranker helpers (separate from embeddings)
export function isJinaRerankerAvailable() {
  return RERANK_CONFIG.jina.enabled;
}

export function getJinaRerankerApiKey() {
  return RERANK_CONFIG.jina.apiKey;
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
  console.log(`[Sweet Search] Dimensions: ${EMBEDDING_CONFIG.dimension}d full, ${EMBEDDING_CONFIG.hnswDimension}d HNSW`);
}

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
  COLBERT_CONFIG,
  HNSW_CONFIG,
  BINARY_HNSW_CONFIG,
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
  setQuietMode,
  isQuietMode,
  shouldUseLocalReranker,
};
