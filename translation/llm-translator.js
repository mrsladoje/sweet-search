/**
 * LLM Translator - T3 Translation Tier
 *
 * Translates complex queries using LLM with fallback chain:
 * 1. Cloud provider (Cerebras/Groq/OpenRouter) - ~50-100ms, cloud API
 * 2. Transformers.js NLLB-200 (local) - ~100-500ms, lazy-loaded, no API key
 * 3. Static passthrough (fallback) - 0ms
 *
 * Multi-provider support via TRANSLATION_CONFIG in config.js.
 *
 * Performance: 50-500ms depending on provider
 *
 * @module translation/llm-translator
 */

import { normalizeNFC } from '../training/features/unicode-utils.js';
import {
  TRANSLATION_CONFIG,
  getTranslationProvider,
  isQuietMode,
  LOGGING,
} from '../config.js';
import { isLikelyEnglish as isLikelyEnglishDetector } from './language-detector.js';
import { getTranslationCache } from './translation-cache.js';

// =============================================================================
// OUTPUT CLEANING
// =============================================================================

/**
 * Clean LLM translation output
 * Removes common LLM verbosity patterns like:
 * - "The translation of X is:"
 * - Surrounding quotes
 * - Multi-line explanations
 *
 * @param {string} text - Raw LLM output
 * @param {string} originalQuery - Original query (fallback if cleaning fails)
 * @returns {string} Cleaned translation
 */
function cleanTranslationOutput(text, originalQuery) {
  if (!text) return originalQuery;

  const config = TRANSLATION_CONFIG?.cleaning;
  if (!config?.enabled) return text;

  let cleaned = text;

  // Strip common prefixes
  for (const prefix of config.stripPrefixes || []) {
    cleaned = cleaned.replace(prefix, '');
  }

  // Strip surrounding quotes (various styles)
  if (config.stripQuotes) {
    cleaned = cleaned.replace(/^["'""''`]+|["'""''`]+$/g, '');
  }

  // Take only first line (LLMs sometimes add explanations)
  if (config.firstLineOnly) {
    cleaned = cleaned.split('\n')[0].trim();
  }

  // Truncate if too long
  if (config.maxLength && cleaned.length > config.maxLength) {
    cleaned = cleaned.slice(0, config.maxLength);
  }

  // If cleaning removed everything, return original
  return cleaned.length > 0 ? cleaned.trim() : originalQuery;
}

// =============================================================================
// GENERIC CLOUD PROVIDER TRANSLATION
// =============================================================================

/**
 * Translate using any OpenAI-compatible API
 * @param {string} query - Query to translate
 * @param {string} providerKey - Provider key from config
 * @returns {Promise<TranslationResult>}
 */
async function translateWithCloudProvider(query, providerKey) {
  const provider = getTranslationProvider(providerKey);
  if (!provider || !provider.enabled) {
    throw new Error(`Provider ${providerKey} not available`);
  }

  // Select prompt template
  const prompts = TRANSLATION_CONFIG?.prompts || {
    short: 'Translate to English (preserve code identifiers): "{query}"\n\nTranslation:',
    extendedThreshold: 50,
  };
  const template = query.length > prompts.extendedThreshold
    ? (prompts.extended || prompts.short)
    : prompts.short;
  const prompt = template.replace('{query}', query);

  // Build request
  const url = `${provider.baseUrl}${provider.endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(provider.apiKey && { 'Authorization': `Bearer ${provider.apiKey}` }),
    ...(provider.extraHeaders || {}),
  };

  const start = performance.now();

  // Use AbortController + setTimeout (NOT AbortSignal.timeout for Node 18 compat)
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    provider.rateLimit?.timeout || 5000
  );

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: provider.maxTokens || 100,
        temperature: provider.temperature || 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${provider.name} API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    let translation = data.choices?.[0]?.message?.content?.trim() || query;

    // Apply output cleaning
    translation = cleanTranslationOutput(translation, query);

    const latency_ms = Math.round(performance.now() - start);

    if (LOGGING?.verbose && !isQuietMode()) {
      console.log(`[T3] ${provider.name}: "${query}" → "${translation}" (${latency_ms}ms)`);
    }

    return {
      translation: normalizeNFC(translation),
      provider: providerKey,
      model: provider.model,
      latency_ms,
      tokens: data.usage?.total_tokens || 0,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`${provider.name} timeout after ${provider.rateLimit?.timeout || 5000}ms`);
    }
    throw err;
  }
}

// =============================================================================
// RETRY WITH EXPONENTIAL BACKOFF
// =============================================================================

/**
 * Translate with exponential backoff retry
 * @param {string} query - Query to translate
 * @param {string} providerKey - Provider key
 * @returns {Promise<TranslationResult>}
 */
async function translateWithRetry(query, providerKey) {
  const provider = getTranslationProvider(providerKey);
  const { maxRetries = 2, retryDelay = 100, backoffMultiplier = 2 } = provider?.rateLimit || {};

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await translateWithCloudProvider(query, providerKey);
    } catch (err) {
      lastError = err;

      // Don't retry client errors (4xx except 429)
      if (err.message.includes('API error: 4') && !err.message.includes('429')) {
        throw err;
      }

      // Exponential backoff with jitter
      if (attempt < maxRetries) {
        const delay = retryDelay * Math.pow(backoffMultiplier, attempt);
        const jitter = delay * 0.1 * Math.random();
        await new Promise(r => setTimeout(r, delay + jitter));
      }
    }
  }

  throw lastError;
}

// =============================================================================
// MAIN TRANSLATION FUNCTION
// =============================================================================

/**
 * Translate a query using LLM with fallback chain
 *
 * Fallback chain: Cloud → Transformers.js → Passthrough
 *
 * @param {string} query - Query to translate
 * @param {Object} options - Translation options
 * @param {number} [options.timeout=5000] - Timeout per provider in ms
 * @returns {Promise<{translation: string, provider: string, latency_ms: number, attempts: Array}>}
 *
 * @example
 * const result = await translateWithLLM('認証の仕組み');
 * // { translation: 'how authentication works', provider: 'cerebras', latency_ms: 85 }
 */
export async function translateWithLLM(query, options = {}) {
  const attempts = [];

  // Check cache first
  const cache = getTranslationCache();
  const providerKey = TRANSLATION_CONFIG?.provider;
  // Use getTranslationProvider() helper for consistent config lookup
  const providerConfig = getTranslationProvider(providerKey);
  const model = providerConfig?.model;

  if (cache && providerKey) {
    const cached = cache.get(query, providerKey, model);
    if (cached) {
      return {
        ...cached,
        fromCache: true,
        attempts: [{ step: 'cache', success: true }],
      };
    }
  }

  const isOffline = TRANSLATION_CONFIG?.isOfflineMode;
  const fallbackOrder = isOffline
    ? ['local', 'passthrough']
    : (TRANSLATION_CONFIG?.pipeline?.fallbackOrder || ['cloud', 'local', 'passthrough']);

  for (const step of fallbackOrder) {
    try {
      if (step === 'cloud') {
        const cloudProviderKey = TRANSLATION_CONFIG?.provider;
        if (!cloudProviderKey) continue;

        const result = await translateWithRetry(query, cloudProviderKey);
        attempts.push({ step: 'cloud', ...result, success: true });

        if (result.translation && result.translation !== query) {
          // Cache the result
          if (cache) {
            cache.set(query, cloudProviderKey, result.model, result);
          }
          return { ...result, attempts };
        }
      }
      else if (step === 'local') {
        const { getTransformersTranslator } = await import('./transformers-translator.js');
        const translator = getTransformersTranslator();

        if (!isQuietMode() && LOGGING?.verbose) {
          console.log('[T3] Cloud unavailable, using local model...');
        }

        const result = await translator.translate(query);
        attempts.push({ step: 'local', ...result, success: true });

        if (!result.skipped && result.translation !== query) {
          return {
            translation: result.translation,
            provider: 'local',
            model: result.model,
            latency_ms: result.latency_ms,
            attempts,
          };
        }
      }
      else if (step === 'passthrough') {
        return {
          translation: query,
          provider: 'passthrough',
          latency_ms: 0,
          attempts,
        };
      }
    } catch (err) {
      attempts.push({ step, success: false, error: err.message });

      if (!isQuietMode() && LOGGING?.debug) {
        console.log(`[T3] ${step} failed: ${err.message}`);
      }
    }
  }

  return { translation: query, provider: 'passthrough', latency_ms: 0, attempts };
}

// =============================================================================
// LANGUAGE DETECTION HELPERS
// =============================================================================

/**
 * Check if a query is likely already in English
 * IMPORTANT: Now returns { likely, confidence, reason } for soft checking
 * For backwards compatibility, also works as truthy check
 * @param {string} query - Query to check
 * @returns {{ likely: boolean, confidence: number, reason: string }}
 */
export function isLikelyEnglish(query) {
  return isLikelyEnglishDetector(query);
}

/**
 * Check if translation is needed for this query
 *
 * @param {string} query - Query to check
 * @returns {boolean} True if translation might help
 */
export function needsTranslation(query) {
  if (!query) return false;

  // Use soft English check
  const englishCheck = isLikelyEnglish(query);
  if (englishCheck.likely && englishCheck.confidence > 0.7) return false;

  // Contains code identifiers - might be hybrid, still translate
  const hasIdentifier = /[a-z][A-Z]|[A-Z][a-z]+[A-Z]|_[a-z]/.test(query);
  if (hasIdentifier) {
    // Has identifier but also non-ASCII - translate the non-ASCII parts
    const nonAscii = query.replace(/[\x00-\x7F]/g, '').length;
    return nonAscii > 0;
  }

  return true;
}

// =============================================================================
// LLM TRANSLATOR CLASS
// =============================================================================

/**
 * LLMTranslator class for use in fallback pipeline
 */
export class LLMTranslator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 5000;
    this.skipIfEnglish = options.skipIfEnglish ?? true;
  }

  /**
   * Process a query through LLM translation
   *
   * @param {string} query - Query to translate
   * @returns {Promise<{original: string, translation: string, provider: string, skipped: boolean}>}
   */
  async process(query) {
    const englishCheck = isLikelyEnglish(query);

    // Soft check: only skip if HIGH confidence English
    if (this.skipIfEnglish && englishCheck.likely && englishCheck.confidence > 0.7) {
      return {
        original: query,
        translation: query,
        provider: 'skipped',
        skipped: true,
        reason: englishCheck.reason,
        latency_ms: 0,
      };
    }

    const result = await translateWithLLM(query, {
      timeout: this.timeout,
    });

    return {
      original: query,
      translation: result.translation,
      provider: result.provider,
      skipped: false,
      latency_ms: result.latency_ms,
      attempts: result.attempts,
    };
  }

  /**
   * Translate multiple queries in parallel
   *
   * @param {string[]} queries - Queries to translate
   * @returns {Promise<Array>} Translation results
   */
  async processMany(queries) {
    return Promise.all(queries.map(q => this.process(q)));
  }
}

export default LLMTranslator;
