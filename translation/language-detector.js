/**
 * Language Detector
 *
 * Detects the language/script of a query for translation routing.
 * Uses Unicode script ranges and heuristics.
 *
 * @module translation/language-detector
 */

import { normalizeNFC, SCRIPT_RANGES } from '../training/features/unicode-utils.js';

// Defensive import: TRANSLATION_CONFIG may not exist yet (Phase 1 adds it to config.js)
let TRANSLATION_CONFIG = null;
try {
  const configModule = await import('../config.js');
  TRANSLATION_CONFIG = configModule.TRANSLATION_CONFIG || null;
} catch {
  // Config not available or doesn't export TRANSLATION_CONFIG yet
}

// =============================================================================
// LANGUAGE CODES
// =============================================================================

/**
 * ISO 639-1 language codes for supported languages
 */
export const LANGUAGES = {
  en: 'English',
  sr: 'Serbian',
  ru: 'Russian',
  uk: 'Ukrainian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  pt: 'Portuguese',
  it: 'Italian',
  el: 'Greek',
  ar: 'Arabic',
  hi: 'Hindi',
  bn: 'Bengali',
  ta: 'Tamil',
  th: 'Thai',
};

// =============================================================================
// SCRIPT TO LANGUAGE MAPPING
// =============================================================================

/**
 * Map script to likely language(s)
 * Note: Many scripts are used by multiple languages
 */
const SCRIPT_LANGUAGE_MAP = {
  latin: ['en', 'de', 'es', 'fr', 'pt', 'it'],
  cyrillic: ['ru', 'sr', 'uk'],
  greek: ['el'],
  arabic: ['ar'],
  hebrew: ['he'],
  devanagari: ['hi'],
  bengali: ['bn'],
  tamil: ['ta'],
  thai: ['th'],
  hangul: ['ko'],
  cjk: ['zh', 'ja'],
  hiragana: ['ja'],
  katakana: ['ja'],
};

// =============================================================================
// SCRIPT DETECTION
// =============================================================================

/**
 * Detect all scripts present in a text
 *
 * @param {string} text - Text to analyze
 * @returns {Object<string, number>} Map of script name to character count
 */
export function detectScripts(text) {
  if (!text) return {};

  const normalized = normalizeNFC(text);
  const counts = {};

  for (const char of normalized) {
    const code = char.codePointAt(0);

    // Check each script range
    for (const [script, ranges] of Object.entries(SCRIPT_RANGES)) {
      for (const [start, end] of ranges) {
        if (code >= start && code <= end) {
          counts[script] = (counts[script] || 0) + 1;
          break;
        }
      }
    }
  }

  return counts;
}

/**
 * Detect the primary (dominant) script in text
 *
 * @param {string} text - Text to analyze
 * @returns {string} Primary script name
 */
export function detectPrimaryScript(text) {
  const counts = detectScripts(text);

  if (Object.keys(counts).length === 0) {
    return 'latin'; // Default
  }

  // Find script with most characters
  let maxScript = 'latin';
  let maxCount = 0;

  for (const [script, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      maxScript = script;
    }
  }

  return maxScript;
}

// =============================================================================
// CYRILLIC VARIANT DETECTION
// =============================================================================

/**
 * Unique characters that identify specific Cyrillic variants
 */
const CYRILLIC_MARKERS = {
  // Serbian-specific: Ђ, Ћ, Љ, Њ, Џ, Ј
  serbian: /[ЂЋЉЊЏЈђћљњџј]/,

  // Ukrainian-specific: Ґ, Є, І, Ї
  ukrainian: /[ҐЄІЇґєії]/,

  // Russian-specific (not in Serbian): Ы, Ё, Э, Щ
  russian: /[ЫЁЭЩыёэщ]/,

  // Bulgarian-specific: Ъ is more common, some letter combinations
  bulgarian: /ъ[аеиоу]|[аеиоу]ъ/,
};

/**
 * Detect which Cyrillic variant is most likely
 *
 * @param {string} text - Cyrillic text
 * @returns {'serbian'|'russian'|'ukrainian'|'bulgarian'|'cyrillic'} Variant
 */
export function detectCyrillicVariant(text) {
  if (!text) return 'cyrillic';

  const normalized = normalizeNFC(text);

  // Check for unique markers
  if (CYRILLIC_MARKERS.serbian.test(normalized)) return 'serbian';
  if (CYRILLIC_MARKERS.ukrainian.test(normalized)) return 'ukrainian';
  if (CYRILLIC_MARKERS.russian.test(normalized)) return 'russian';
  if (CYRILLIC_MARKERS.bulgarian.test(normalized)) return 'bulgarian';

  return 'cyrillic'; // Generic
}

// =============================================================================
// CJK LANGUAGE DETECTION
// =============================================================================

/**
 * CJK-specific character ranges
 */
const CJK_MARKERS = {
  // Japanese Hiragana: ぁ-ゟ
  hiragana: /[\u3040-\u309F]/,

  // Japanese Katakana: ァ-ヿ
  katakana: /[\u30A0-\u30FF]/,

  // Korean Hangul
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
};

/**
 * Detect CJK language variant
 *
 * @param {string} text - CJK text
 * @returns {'zh'|'ja'|'ko'|'cjk'} Language code
 */
export function detectCJKLanguage(text) {
  if (!text) return 'cjk';

  // Japanese: has hiragana or katakana
  if (CJK_MARKERS.hiragana.test(text) || CJK_MARKERS.katakana.test(text)) {
    return 'ja';
  }

  // Korean: has hangul
  if (CJK_MARKERS.hangul.test(text)) {
    return 'ko';
  }

  // Default to Chinese for pure Han characters
  return 'zh';
}

// =============================================================================
// MAIN DETECTION FUNCTION
// =============================================================================

/**
 * Detect the most likely language of a text
 *
 * @param {string} text - Text to analyze
 * @returns {{ language: string, script: string, confidence: number }}
 */
export function detectLanguage(text) {
  if (!text) {
    return { language: 'en', script: 'latin', confidence: 0.5 };
  }

  const normalized = normalizeNFC(text);

  // Check for CJK/Japanese/Korean directly (SCRIPT_RANGES doesn't have these)
  // Japanese: check for hiragana or katakana first (more specific than CJK)
  if (CJK_MARKERS.hiragana.test(normalized) || CJK_MARKERS.katakana.test(normalized)) {
    return { language: 'ja', script: 'japanese', confidence: 0.95 };
  }

  // Korean: check for hangul
  if (CJK_MARKERS.hangul.test(normalized)) {
    return { language: 'ko', script: 'hangul', confidence: 0.95 };
  }

  // Chinese: CJK ideographs without Japanese/Korean markers
  if (/[\u4e00-\u9fff]/.test(normalized)) {
    return { language: 'zh', script: 'cjk', confidence: 0.85 };
  }

  // Check for Cyrillic
  if (/[\u0400-\u04FF]/.test(normalized)) {
    const variant = detectCyrillicVariant(normalized);
    const langMap = { serbian: 'sr', russian: 'ru', ukrainian: 'uk', bulgarian: 'bg' };
    return {
      language: langMap[variant] || 'ru',
      script: 'cyrillic',
      variant,
      confidence: variant !== 'cyrillic' ? 0.9 : 0.6,
    };
  }

  // Use detectPrimaryScript for other scripts (Greek, Arabic, etc.)
  const primaryScript = detectPrimaryScript(normalized);

  // Map other scripts to languages
  const langMap = {
    greek: 'el',
    arabic: 'ar',
    hebrew: 'he',
    devanagari: 'hi',
    bengali: 'bn',
    tamil: 'ta',
    thai: 'th',
  };

  if (langMap[primaryScript]) {
    return {
      language: langMap[primaryScript],
      script: primaryScript,
      confidence: 0.8,
    };
  }

  // Latin script - could be many languages
  return {
    language: 'en', // Default to English
    script: 'latin',
    confidence: 0.5,
  };
}

/**
 * Check if text is in a specific language
 *
 * @param {string} text - Text to check
 * @param {string} lang - Language code to check for
 * @returns {boolean} True if text appears to be in the specified language
 */
export function isLanguage(text, lang) {
  const detected = detectLanguage(text);
  return detected.language === lang;
}

/**
 * Check if text needs translation (is not English)
 *
 * @param {string} text - Text to check
 * @returns {boolean} True if text is likely not English
 */
export function needsTranslation(text) {
  const detected = detectLanguage(text);
  return detected.language !== 'en' && detected.confidence > 0.6;
}

// =============================================================================
// LATIN-SCRIPT LANGUAGE DETECTION (NEW)
// =============================================================================

/**
 * Detect Latin-script language using diacritic patterns
 * @param {string} text - Text to analyze
 * @returns {string|null} NLLB language code or null if unknown
 */
export function detectLatinLanguage(text) {
  if (!text) return null;

  // Defensive: check if config is loaded
  const latinDetection = TRANSLATION_CONFIG?.latinDetection;
  if (!latinDetection?.enabled || !latinDetection?.patterns) return null;

  const patterns = latinDetection.patterns;
  for (const [langCode, rules] of Object.entries(patterns)) {
    if (rules.diacritics && rules.diacritics.test(text)) {
      return langCode;
    }
    if (rules.compoundWord && rules.compoundWord.test(text)) {
      return langCode;
    }
  }
  return null;
}

/**
 * Check if text is likely English
 * IMPORTANT: This is a SOFT hint, not a hard stop.
 * Returns { likely: boolean, confidence: number, reason: string }
 *
 * @param {string} text - Text to check
 * @returns {{ likely: boolean, confidence: number, reason: string }}
 */
export function isLikelyEnglish(text) {
  if (!text) {
    return { likely: true, confidence: 0.5, reason: 'empty' };
  }

  // Check for non-ASCII scripts (Cyrillic, CJK, etc.)
  if (/[\u0400-\u04FF]/.test(text)) {
    return { likely: false, confidence: 0.95, reason: 'cyrillic' };
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return { likely: false, confidence: 0.95, reason: 'cjk' };
  }
  if (/[\u3040-\u30ff]/.test(text)) {
    return { likely: false, confidence: 0.95, reason: 'japanese' };
  }
  if (/[\uac00-\ud7af]/.test(text)) {
    return { likely: false, confidence: 0.95, reason: 'korean' };
  }

  // Check for Latin-script non-English
  const latinLang = detectLatinLanguage(text);
  if (latinLang) {
    return { likely: false, confidence: 0.8, reason: `latin:${latinLang}` };
  }

  // Count non-ASCII ratio
  const nonAscii = text.replace(/[\x00-\x7F]/g, '').length;
  const total = text.replace(/\s/g, '').length;

  if (total > 0 && nonAscii / total > 0.2) {
    return { likely: false, confidence: 0.7, reason: 'high_non_ascii' };
  }

  // Likely English (but LOW confidence for pure ASCII - this is the bug fix!)
  return { likely: true, confidence: 0.5, reason: 'ascii' };
}

/**
 * Convert language code to NLLB format
 * @param {string} langCode - ISO 639-1 or detected language
 * @returns {string} NLLB language code
 */
export function toNLLBCode(langCode) {
  const map = {
    sr: 'srp_Cyrl',
    ru: 'rus_Cyrl',
    uk: 'ukr_Cyrl',
    zh: 'zho_Hans',
    ja: 'jpn_Jpan',
    ko: 'kor_Hang',
    de: 'deu_Latn',
    es: 'spa_Latn',
    fr: 'fra_Latn',
    pt: 'por_Latn',
    pl: 'pol_Latn',
    cs: 'ces_Latn',
    en: 'eng_Latn',
  };
  return map[langCode] || langCode;
}

export default detectLanguage;
