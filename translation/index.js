/**
 * Translation Module - Phase 4 Translation Fallback
 *
 * Enables users to search in their native language when the codebase
 * uses English identifiers.
 *
 * Three-Tier Architecture:
 * - T1: Transliteration (Cyrillic→Latin, diacritics) - <1ms
 * - T2: Alias Dictionary lookup - <1ms
 * - T3: LLM Translation (Cerebras/Ollama) - 50-500ms
 *
 * @module translation
 */

// T1: Transliteration
export {
  Transliterator,
  transliterate,
  removeDiacritics,
  toAscii,
  wouldTransliterate,
  detectCyrillicVariant,
  SERBIAN_CYRILLIC,
  RUSSIAN_CYRILLIC,
  UKRAINIAN_CYRILLIC,
  GREEK,
} from './transliterator.js';

// T2: Alias Dictionary
export {
  AliasLookup,
  loadDictionary,
  buildReverseIndex,
  getReverseIndex,
  lookupTerm,
  lookupQuery,
  expandToEnglish,
  getTranslations,
} from './alias-lookup.js';

// T3: LLM Translation
export {
  LLMTranslator,
  translateWithLLM,
  isLikelyEnglish,
  needsTranslation as llmNeedsTranslation,
} from './llm-translator.js';

// Language Detection
export {
  detectLanguage,
  detectScripts,
  detectPrimaryScript,
  detectCyrillicVariant as detectCyrillicVariantFromLanguage,
  detectCJKLanguage,
  isLanguage,
  needsTranslation,
  LANGUAGES,
} from './language-detector.js';

// Fallback Pipeline
export {
  TranslationFallback,
  createFallbackPipeline,
  queryNeedsTranslation,
} from './fallback-pipeline.js';

// Default export: the main pipeline class
export { TranslationFallback as default } from './fallback-pipeline.js';
