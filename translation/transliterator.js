/**
 * Transliterator - T1 Translation Tier
 *
 * Converts non-Latin scripts to Latin equivalents for fuzzy matching.
 *
 * Supports:
 * - Serbian Cyrillic → Latin (priority for Sloth project)
 * - Russian Cyrillic → Latin
 * - Ukrainian Cyrillic → Latin
 * - Greek → Latin
 * - Diacritics → ASCII (é→e, ü→u, ñ→n)
 *
 * Performance: <1ms per query (character-by-character mapping)
 *
 * @module translation/transliterator
 */

import { normalizeNFC, detectPrimaryScript } from '../training/features/unicode-utils.js';

// =============================================================================
// TRANSLITERATION MAPS
// =============================================================================

/**
 * Serbian Cyrillic to Latin
 * Uses official Serbian latinica (not phonetic transliteration)
 * Key differences from Russian: Ђ, Ћ, Љ, Њ, Џ, Ј
 */
export const SERBIAN_CYRILLIC = {
  // Uppercase
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D',
  'Ђ': 'Đ', 'Е': 'E', 'Ж': 'Ž', 'З': 'Z', 'И': 'I',
  'Ј': 'J', 'К': 'K', 'Л': 'L', 'Љ': 'Lj', 'М': 'M',
  'Н': 'N', 'Њ': 'Nj', 'О': 'O', 'П': 'P', 'Р': 'R',
  'С': 'S', 'Т': 'T', 'Ћ': 'Ć', 'У': 'U', 'Ф': 'F',
  'Х': 'H', 'Ц': 'C', 'Ч': 'Č', 'Џ': 'Dž', 'Ш': 'Š',
  // Lowercase
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
  'ђ': 'đ', 'е': 'e', 'ж': 'ž', 'з': 'z', 'и': 'i',
  'ј': 'j', 'к': 'k', 'л': 'l', 'љ': 'lj', 'м': 'm',
  'н': 'n', 'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r',
  'с': 's', 'т': 't', 'ћ': 'ć', 'у': 'u', 'ф': 'f',
  'х': 'h', 'ц': 'c', 'ч': 'č', 'џ': 'dž', 'ш': 'š',
};

/**
 * Russian Cyrillic to Latin (ISO 9 / GOST 7.79)
 * Key differences from Serbian: Ы, Ё, Э, Ю, Я, Щ, Ъ, Ь
 */
export const RUSSIAN_CYRILLIC = {
  // Uppercase
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D',
  'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh', 'З': 'Z', 'И': 'I',
  'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N',
  'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T',
  'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch',
  'Ш': 'Sh', 'Щ': 'Shch', 'Ъ': '', 'Ы': 'Y', 'Ь': '',
  'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
  // Lowercase
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
  'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i',
  'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
  'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
  'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch',
  'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '',
  'э': 'e', 'ю': 'yu', 'я': 'ya',
};

/**
 * Ukrainian Cyrillic to Latin
 * Key differences: Ґ, Є, І, Ї
 */
export const UKRAINIAN_CYRILLIC = {
  // Uppercase
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'H', 'Ґ': 'G',
  'Д': 'D', 'Е': 'E', 'Є': 'Ye', 'Ж': 'Zh', 'З': 'Z',
  'И': 'Y', 'І': 'I', 'Ї': 'Yi', 'Й': 'Y', 'К': 'K',
  'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P',
  'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F',
  'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
  'Ь': '', 'Ю': 'Yu', 'Я': 'Ya',
  // Lowercase
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g',
  'д': 'd', 'е': 'e', 'є': 'ye', 'ж': 'zh', 'з': 'z',
  'и': 'y', 'і': 'i', 'ї': 'yi', 'й': 'y', 'к': 'k',
  'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p',
  'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
  'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
  'ь': '', 'ю': 'yu', 'я': 'ya',
};

/**
 * Greek to Latin (simplified phonetic)
 */
export const GREEK = {
  // Uppercase
  'Α': 'A', 'Β': 'B', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E',
  'Ζ': 'Z', 'Η': 'I', 'Θ': 'Th', 'Ι': 'I', 'Κ': 'K',
  'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'X', 'Ο': 'O',
  'Π': 'P', 'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y',
  'Φ': 'Ph', 'Χ': 'Ch', 'Ψ': 'Ps', 'Ω': 'O',
  // Lowercase
  'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e',
  'ζ': 'z', 'η': 'i', 'θ': 'th', 'ι': 'i', 'κ': 'k',
  'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o',
  'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't',
  'υ': 'y', 'φ': 'ph', 'χ': 'ch', 'ψ': 'ps', 'ω': 'o',
};

// =============================================================================
// SCRIPT DETECTION
// =============================================================================

/**
 * Detect which Cyrillic variant is most likely based on unique characters
 *
 * @param {string} text - Text to analyze
 * @returns {'serbian'|'russian'|'ukrainian'|'cyrillic'} Detected variant
 */
export function detectCyrillicVariant(text) {
  // Serbian-specific letters: Ђ, Ћ, Љ, Њ, Џ, Ј
  const serbianUnique = /[ЂЋЉЊЏЈђћљњџј]/;

  // Ukrainian-specific letters: Ґ, Є, І, Ї
  const ukrainianUnique = /[ҐЄІЇґєії]/;

  // Russian-specific letters: Ы, Ё, Э, Щ (not in Serbian)
  const russianUnique = /[ЫЁЭЩыёэщ]/;

  if (serbianUnique.test(text)) return 'serbian';
  if (ukrainianUnique.test(text)) return 'ukrainian';
  if (russianUnique.test(text)) return 'russian';

  return 'cyrillic'; // Generic fallback
}

/**
 * Detect if text contains Greek characters
 */
export function hasGreek(text) {
  return /[\u0370-\u03FF]/.test(text);
}

// =============================================================================
// TRANSLITERATION FUNCTIONS
// =============================================================================

/**
 * Transliterate text from source script to Latin
 *
 * @param {string} text - Text to transliterate
 * @param {string} [script='auto'] - Script type: 'auto', 'serbian', 'russian', 'ukrainian', 'greek'
 * @returns {string} Transliterated text
 *
 * @example
 * transliterate('КорисникСервис')           // "KorisnikServis" (auto-detect Serbian)
 * transliterate('аутентификација')          // "autentifikacija"
 * transliterate('пользователь', 'russian')  // "polzovatel"
 */
export function transliterate(text, script = 'auto') {
  if (!text || typeof text !== 'string') return text;

  // Normalize to NFC first
  const normalized = normalizeNFC(text);

  // Auto-detect script
  let detectedScript = script;
  if (script === 'auto') {
    if (hasGreek(normalized)) {
      detectedScript = 'greek';
    } else {
      detectedScript = detectCyrillicVariant(normalized);
    }
  }

  // Select transliteration map
  let map;
  switch (detectedScript) {
    case 'serbian':
      map = SERBIAN_CYRILLIC;
      break;
    case 'russian':
      map = RUSSIAN_CYRILLIC;
      break;
    case 'ukrainian':
      map = UKRAINIAN_CYRILLIC;
      break;
    case 'greek':
      map = GREEK;
      break;
    case 'cyrillic':
    default:
      // Combined map with Serbian taking priority (for Sloth project)
      map = { ...RUSSIAN_CYRILLIC, ...SERBIAN_CYRILLIC };
      break;
  }

  // Character-by-character transliteration
  let result = '';
  for (const char of normalized) {
    result += map[char] ?? char;
  }

  return result;
}

/**
 * Remove diacritics (accents, umlauts, etc.) from text
 * Uses Unicode NFD decomposition to separate base + combining marks
 *
 * @param {string} text - Text to process
 * @returns {string} Text with diacritics removed
 *
 * @example
 * removeDiacritics('café')        // "cafe"
 * removeDiacritics('naïve')       // "naive"
 * removeDiacritics('Überprüfung') // "Uberprufung"
 * removeDiacritics('señor')       // "senor"
 */
export function removeDiacritics(text) {
  if (!text || typeof text !== 'string') return text;

  // NFD decomposition separates base character + combining diacritical marks
  // Then we remove the combining marks (U+0300 to U+036F)
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Full ASCII normalization: transliterate + remove diacritics
 *
 * @param {string} text - Text to normalize
 * @param {string} [script='auto'] - Script hint
 * @returns {string} ASCII-normalized text
 *
 * @example
 * toAscii('Überprüfung')   // "Uberprufung"
 * toAscii('КорисникСервис') // "KorisnikServis"
 * toAscii('наслеђе')        // "nasledje"
 */
export function toAscii(text, script = 'auto') {
  if (!text) return text;

  // First transliterate non-Latin scripts
  let result = transliterate(text, script);

  // Then remove remaining diacritics
  result = removeDiacritics(result);

  return result;
}

/**
 * Check if transliteration would produce a different result
 * Useful for deciding whether to include transliterated variant in search
 *
 * @param {string} text - Text to check
 * @returns {boolean} True if transliteration would change the text
 */
export function wouldTransliterate(text) {
  if (!text) return false;

  const result = transliterate(text);
  return result !== text;
}

// =============================================================================
// TRANSLITERATOR CLASS
// =============================================================================

/**
 * Transliterator class for use in fallback pipeline
 */
export class Transliterator {
  constructor(options = {}) {
    this.defaultScript = options.script || 'auto';
    this.includeAscii = options.includeAscii ?? true;
  }

  /**
   * Transliterate a query
   *
   * @param {string} query - Query to transliterate
   * @returns {{ original: string, transliterated: string, script: string, changed: boolean }}
   */
  process(query) {
    const normalized = normalizeNFC(query);
    let script = this.defaultScript;

    if (script === 'auto') {
      if (hasGreek(normalized)) {
        script = 'greek';
      } else {
        script = detectCyrillicVariant(normalized);
      }
    }

    let transliterated = transliterate(normalized, script);

    if (this.includeAscii) {
      transliterated = removeDiacritics(transliterated);
    }

    return {
      original: query,
      transliterated,
      script,
      changed: transliterated !== query,
    };
  }
}

export default Transliterator;
