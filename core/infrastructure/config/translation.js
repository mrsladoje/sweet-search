/**
 * Translation Configuration — providers, local models, Cerebras, HCGS.
 * Split from core/config.js during DDD migration.
 */

import { DB_PATHS } from './platform.js';

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// =============================================================================
// CEREBRAS GLM CONFIGURATION (Fast Standalone LLM)
// Reference: https://inference-docs.cerebras.ai/models/zai-glm-46
// =============================================================================

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
    hcgs: 'llama3.1-8b',           // Summary generation (fast, cheap — GLM-4.6 is overkill)
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
  // Primary: OPUS-MT Local Router (verified Xenova pair/family models)
  'opus-router': {
    enabled: true,
    priority: 1,
    name: 'OPUS-MT Local Router',
    type: 'opus-router',
    device: 'cpu',
    quantized: true,
    size: '~105-115MB per loaded model',
    languages: 'verified set + mul-en fallback',
  },

  // Legacy: NLLB-200 (broken in practice - kept for rollback)
  'nllb-200': {
    enabled: false,
    priority: 99,
    name: 'NLLB-200 Distilled',
    type: 'translation',  // Transformers.js pipeline type
    model: 'Xenova/nllb-200-distilled-600M',
    quantized: true,
    device: 'cpu',
    size: '600MB',
    languages: 200,
    avgLatency: '500-1000ms',
  },

  // Legacy: Opus-MT many-to-English (superseded by opus-router)
  'opus-mt': {
    enabled: false,
    priority: 98,
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

  get isDisabled() {
    return process.env.SWEET_SEARCH_TRANSLATE === 'false';
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
    fallbackOrder: ['local', 'cloud', 'passthrough'],

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
      // Italian: ì (i-grave) is unique among major Latin languages
      ita_Latn: {
        diacritics: /ì/,
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

// HCGS_CONFIG moved to ./graph.js (graph-related, not translation)
