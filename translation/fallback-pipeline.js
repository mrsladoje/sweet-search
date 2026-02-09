/**
 * Translation Fallback Pipeline
 *
 * Orchestrates the three-tier translation fallback:
 * - T1: Transliteration (Cyrillic→Latin, diacritics) - <1ms
 * - T2: Alias Dictionary lookup - <1ms
 * - T3: LLM Translation (Cerebras/Ollama) - 50-500ms
 *
 * Trigger Conditions:
 * 1. Search returns 0 results OR low relevance (score < 0.3)
 * 2. Query contains non-ASCII characters
 * 3. User explicitly requests translation (?translate=true)
 *
 * @module translation/fallback-pipeline
 */

import { Transliterator, toAscii, wouldTransliterate } from './transliterator.js';
import { AliasLookup, lookupQuery, expandToEnglish } from './alias-lookup.js';
import { LLMTranslator, needsTranslation } from './llm-translator.js';
import { isLikelyEnglish } from './language-detector.js';
import { normalizeNFC, detectPrimaryScript } from '../training/features/unicode-utils.js';
import { TRANSLATION_CONFIG, isQuietMode, LOGGING } from '../core/config.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Minimum score threshold to skip fallback
  minResultScore: 0.3,

  // Minimum results to skip fallback
  minResultCount: 1,

  // Enable/disable individual tiers
  enableT1: true,
  enableT2: true,
  enableT3: true,

  // T3 timeout
  llmTimeout: 5000,

  // Maximum retries per query
  maxRetries: 2,
};

// =============================================================================
// SCRIPT DETECTION
// =============================================================================

/**
 * Check if query contains non-ASCII characters
 */
function hasNonAscii(query) {
  if (!query) return false;
  return /[^\x00-\x7F]/.test(query);
}

/**
 * Check if query looks like a code identifier (camelCase, PascalCase, snake_case)
 * These are almost certainly English and shouldn't trigger translation
 */
function isCodeIdentifier(query) {
  if (!query) return false;
  // PascalCase: AuthService, EmployeeController
  // camelCase: authService, employeeController
  // snake_case: auth_service, employee_controller
  // SCREAMING_CASE: AUTH_SERVICE
  return /^[A-Z][a-z]+[A-Z]|^[a-z]+[A-Z]|^[a-z]+_[a-z]+|^[A-Z]+_[A-Z]+/.test(query);
}

/**
 * Detect the primary script of a query
 */
function detectScript(query) {
  if (!query) return 'latin';

  // Check for specific scripts
  if (/[\u0400-\u04FF]/.test(query)) return 'cyrillic';
  if (/[\u4e00-\u9fff]/.test(query)) return 'cjk';
  if (/[\u3040-\u30ff]/.test(query)) return 'japanese';
  if (/[\uac00-\ud7af]/.test(query)) return 'korean';
  if (/[\u0370-\u03FF]/.test(query)) return 'greek';
  if (/[\u0600-\u06FF]/.test(query)) return 'arabic';
  if (/[\u0900-\u097F]/.test(query)) return 'devanagari';

  return 'latin';
}

// =============================================================================
// TRANSLATION FALLBACK CLASS
// =============================================================================

/**
 * TranslationFallback - Orchestrates T1→T2→T3 translation pipeline
 */
export class TranslationFallback {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };

    // Initialize tier handlers
    this.transliterator = new Transliterator(options.transliterator || {});
    this.aliasLookup = new AliasLookup(options.aliasLookup || {});
    this.llmTranslator = new LLMTranslator({
      timeout: this.config.llmTimeout,
      ...options.llmTranslator,
    });

    this.initialized = false;
  }

  /**
   * Initialize the fallback pipeline
   */
  async init() {
    if (this.initialized) return;

    await this.aliasLookup.init();
    this.initialized = true;
  }

  /**
   * Check if translation fallback should be triggered
   *
   * @param {Array} results - Search results
   * @param {string} query - Original query
   * @param {Object} options - Options from search call
   * @returns {boolean} True if fallback should be triggered
   */
  shouldTriggerFallback(results, query, options = {}) {
    // Explicit override: translate=true forces translation (even for ASCII)
    if (options.translate === 'true' || options.translate === true) {
      return true;  // Force translation regardless of query type
    }
    if (options.translate === 'false' || options.translate === false) {
      return false;
    }

    // OPTIMIZATION: Check for good results FIRST (most common case)
    // This avoids expensive language detection when we don't need it
    const minResults = TRANSLATION_CONFIG?.pipeline?.softEnglishMinResults ?? 3;
    const minScore = TRANSLATION_CONFIG?.pipeline?.softEnglishMinScore ?? 0.3;

    const hasGoodResults = results &&
      results.length >= minResults &&
      (results[0]?.score ?? results[0]?.rerankScore ?? 0) >= minScore &&
      results.some(r =>
        (r.file && typeof r.file === 'string' && r.file.length > 0) ||
        (r.name && typeof r.name === 'string' && r.name.length > 0)
      );

    // Skip translation for GOOD results - regardless of query language
    // This is the fast path: ~1-5µs (no language detection needed)
    if (hasGoodResults) {
      return false;
    }

    // From here: results are POOR or MISSING
    // Now we need language detection (slower path, but rare)

    const softEnglishCheck = TRANSLATION_CONFIG?.pipeline?.softEnglishCheck ?? true;

    if (softEnglishCheck) {
      // Non-ASCII queries (Cyrillic, CJK, etc.) - always translate when results are poor
      // Fast check: single regex, ~0.5µs
      if (hasNonAscii(query)) {
        return true;
      }

      // Code identifiers (PascalCase, camelCase, snake_case) are English
      // Fast check: single regex, ~0.5µs
      if (isCodeIdentifier(query)) {
        return false;
      }

      // LAZY: Only now do we call isLikelyEnglish() for pure ASCII non-identifiers
      // This is the slowest check (~5-20µs) but rare: only for ASCII + poor results + non-identifier
      const englishCheck = isLikelyEnglish(query);
      if (!englishCheck.likely || englishCheck.confidence <= 0.7) {
        // Low confidence ASCII + poor results → trigger T3 LLM translation
        return true;
      }

      // ASCII + HIGH confidence English + poor results → no translation
      return false;
    } else {
      // Old behavior: hard stop on likely English
      const englishCheck = isLikelyEnglish(query);
      if (englishCheck.likely) {
        return false;
      }
    }

    // Fallback conditions (softEnglishCheck=false path)

    // Condition 1: No results with non-ASCII
    if (!results || results.length === 0) {
      return hasNonAscii(query);
    }

    // Condition 2: Low relevance with non-ASCII
    const topScore = results[0]?.score ?? results[0]?.rerankScore ?? 0;
    if (topScore < this.config.minResultScore && hasNonAscii(query)) {
      return true;
    }

    // Condition 3: Few results with non-ASCII query
    if (hasNonAscii(query) && results.length < 3) {
      return true;
    }

    // Condition 4: Non-ASCII query with results but no valid file names
    if (hasNonAscii(query)) {
      const hasValidResults = results.some(r =>
        (r.file && typeof r.file === 'string' && r.file.length > 0) ||
        (r.name && typeof r.name === 'string' && r.name.length > 0)
      );
      if (!hasValidResults) {
        return true;
      }
    }

    return false;
  }

  /**
   * Perform translation using the tiered fallback chain
   *
   * @param {string} query - Query to translate
   * @returns {Promise<TranslationResult>}
   */
  async translate(query) {
    const result = {
      original: query,
      attempts: [],
      bestTranslation: null,
      tier: null,
      totalLatency_ms: 0,
    };

    const normalized = normalizeNFC(query);
    const script = detectScript(normalized);
    result.detectedScript = script;

    const startTime = performance.now();

    // =========================================================================
    // T1: Transliteration
    // =========================================================================
    if (this.config.enableT1 && wouldTransliterate(normalized)) {
      const t1Result = this.transliterator.process(normalized);

      if (t1Result.changed) {
        result.attempts.push({
          tier: 'T1',
          method: 'transliteration',
          input: normalized,
          output: t1Result.transliterated,
          script: t1Result.script,
          latency_ms: 0,
        });
      }
    }

    // =========================================================================
    // T2: Alias Dictionary Lookup
    // =========================================================================
    if (this.config.enableT2) {
      const t2Result = this.aliasLookup.process(normalized);

      if (t2Result.hasMatches) {
        const searchQueries = this.aliasLookup.generateSearchQueries(normalized);

        result.attempts.push({
          tier: 'T2',
          method: 'alias_lookup',
          input: normalized,
          output: searchQueries[0],
          expanded: t2Result.expanded,
          matches: t2Result.matches.length,
          searchQueries,
          latency_ms: 0,
        });

        // T2 is often the best result for identifier matches
        if (t2Result.matches.some(m => m.type === 'identifier')) {
          result.bestTranslation = searchQueries[0];
          result.tier = 'T2';
        }
      }
    }

    // =========================================================================
    // T3: LLM Translation (only if T1/T2 didn't produce good results)
    // =========================================================================
    if (this.config.enableT3 && this.shouldUseLLM(result)) {
      const t3Result = await this.llmTranslator.process(normalized);

      result.attempts.push({
        tier: 'T3',
        method: 'llm',
        input: normalized,
        output: t3Result.translation,
        provider: t3Result.provider,
        skipped: t3Result.skipped,
        latency_ms: t3Result.latency_ms,
      });

      if (!t3Result.skipped && t3Result.translation !== normalized) {
        // LLM translation successful
        if (!result.bestTranslation) {
          result.bestTranslation = t3Result.translation;
          result.tier = 'T3';
        }
      }
    }

    // =========================================================================
    // Select best translation
    // =========================================================================
    if (!result.bestTranslation) {
      result.bestTranslation = this.selectBestTranslation(result.attempts, normalized);
      result.tier = result.bestTranslation !== normalized
        ? this.getTierForTranslation(result.attempts, result.bestTranslation)
        : null;
    }

    result.totalLatency_ms = Math.round(performance.now() - startTime);
    result.changed = result.bestTranslation !== query;

    return result;
  }

  /**
   * Determine if LLM translation should be attempted
   */
  shouldUseLLM(result) {
    // Skip if T2 found identifier matches (high confidence)
    const t2Attempt = result.attempts.find(a => a.tier === 'T2');
    if (t2Attempt && t2Attempt.matches > 0) {
      // Check if any identifier matches
      const aliasResult = this.aliasLookup.process(result.original);
      if (aliasResult.matches.some(m => m.type === 'identifier')) {
        return false;
      }
    }

    // Use LLM for complex queries or when T1/T2 didn't help
    return true;
  }

  /**
   * Select the best translation from all attempts
   */
  selectBestTranslation(attempts, original) {
    // Priority: T2 identifier matches > T3 LLM > T2 concepts > T1

    // 1. T2 with identifier matches
    const t2 = attempts.find(a => a.tier === 'T2');
    if (t2 && t2.searchQueries?.length > 0) {
      return t2.searchQueries[0];
    }

    // 2. T3 LLM (if successful)
    const t3 = attempts.find(a => a.tier === 'T3' && !a.skipped);
    if (t3 && t3.output && t3.output !== original) {
      return t3.output;
    }

    // 3. T1 transliteration
    const t1 = attempts.find(a => a.tier === 'T1');
    if (t1 && t1.output) {
      return t1.output;
    }

    // Fallback to original
    return original;
  }

  /**
   * Get the tier that produced a translation
   */
  getTierForTranslation(attempts, translation) {
    for (const attempt of attempts) {
      if (attempt.output === translation) {
        return attempt.tier;
      }
      if (attempt.searchQueries?.includes(translation)) {
        return attempt.tier;
      }
    }
    return null;
  }

  /**
   * Get all search queries to try (for retry logic)
   *
   * @param {TranslationResult} result - Translation result
   * @returns {string[]} Array of queries to try in order
   */
  getSearchQueries(result) {
    const queries = new Set();

    // Add best translation first
    if (result.bestTranslation && result.bestTranslation !== result.original) {
      queries.add(result.bestTranslation);
    }

    // Add T2 search queries
    const t2 = result.attempts.find(a => a.tier === 'T2');
    if (t2?.searchQueries) {
      for (const q of t2.searchQueries) {
        queries.add(q);
      }
    }

    // Add T3 translation
    const t3 = result.attempts.find(a => a.tier === 'T3' && !a.skipped);
    if (t3?.output && t3.output !== result.original) {
      queries.add(t3.output);
    }

    // Add T1 transliteration
    const t1 = result.attempts.find(a => a.tier === 'T1');
    if (t1?.output) {
      queries.add(t1.output);
    }

    return [...queries];
  }

  /**
   * Format translation result for display
   */
  formatForDisplay(result) {
    if (!result.changed) {
      return null;
    }

    const parts = [];
    parts.push(`Translated: "${result.bestTranslation}"`);
    parts.push(`Method: ${result.tier || 'none'}`);

    if (result.attempts.length > 0) {
      const methods = result.attempts.map(a => `${a.tier}:${a.method}`).join(' → ');
      parts.push(`Chain: ${methods}`);
    }

    if (result.totalLatency_ms > 0) {
      parts.push(`Latency: ${result.totalLatency_ms}ms`);
    }

    return parts.join(' | ');
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Quick translation check - does this query need translation?
 */
export function queryNeedsTranslation(query) {
  const englishCheck = isLikelyEnglish(query);
  return hasNonAscii(query) && !englishCheck.likely;
}

/**
 * Create a pre-configured fallback pipeline
 */
export function createFallbackPipeline(options = {}) {
  const pipeline = new TranslationFallback(options);
  return pipeline;
}

export default TranslationFallback;
