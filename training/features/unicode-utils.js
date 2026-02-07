/**
 * Unicode Utilities for Query Router
 *
 * Provides UAX #31 compliant identifier detection using @babel/helper-validator-identifier.
 * Supports 15+ Unicode scripts for multilingual code search.
 *
 * P0 Fix: All string comparisons now use NFC normalization to handle:
 * - Composed vs decomposed characters (e.g., é vs e + ́)
 * - Visually identical but byte-different strings
 *
 * @see https://www.unicode.org/reports/tr31/ - Unicode Identifier and Pattern Syntax
 * @see https://unicode.org/reports/tr15/ - Unicode Normalization Forms
 */

import {
  isIdentifierStart,
  isIdentifierChar,
  isIdentifierName
} from '@babel/helper-validator-identifier';

/**
 * Normalize string to NFC (Canonical Decomposition, followed by Canonical Composition)
 * This ensures that visually identical strings compare as equal.
 *
 * @param {string} s - String to normalize
 * @returns {string} - NFC normalized string
 *
 * @example
 * normalizeNFC('café')  // same output whether composed or decomposed input
 * normalizeNFC('наслеђе') // Serbian with composed/decomposed chars
 */
export function normalizeNFC(s) {
  if (!s || typeof s !== 'string') return s;
  return s.normalize('NFC');
}

/**
 * Unicode script ranges for detection
 * Based on Unicode 15.0 character blocks
 */
export const SCRIPT_RANGES = {
  latin: [
    [0x0041, 0x005A], // A-Z
    [0x0061, 0x007A], // a-z
    [0x00C0, 0x00FF], // Latin Extended-A (accented chars)
    [0x0100, 0x017F], // Latin Extended-B
    [0x0180, 0x024F], // Latin Extended-B continued
  ],
  cyrillic: [
    [0x0400, 0x04FF], // Cyrillic
    [0x0500, 0x052F], // Cyrillic Supplement
  ],
  greek: [
    [0x0370, 0x03FF], // Greek and Coptic
  ],
  arabic: [
    [0x0600, 0x06FF], // Arabic
    [0x0750, 0x077F], // Arabic Supplement
  ],
  hebrew: [
    [0x0590, 0x05FF], // Hebrew
  ],
  devanagari: [
    [0x0900, 0x097F], // Devanagari (Hindi, Sanskrit, Marathi)
  ],
  // P1 Fix: Added missing Indian scripts (500M+ speakers)
  bengali: [
    [0x0980, 0x09FF], // Bengali (Bengali, Assamese)
  ],
  tamil: [
    [0x0B80, 0x0BFF], // Tamil
  ],
  telugu: [
    [0x0C00, 0x0C7F], // Telugu
  ],
  kannada: [
    [0x0C80, 0x0CFF], // Kannada
  ],
  malayalam: [
    [0x0D00, 0x0D7F], // Malayalam
  ],
  gujarati: [
    [0x0A80, 0x0AFF], // Gujarati
  ],
  thai: [
    [0x0E00, 0x0E7F], // Thai
  ],
  hangul: [
    [0xAC00, 0xD7AF], // Hangul Syllables
    [0x1100, 0x11FF], // Hangul Jamo
    [0x3130, 0x318F], // Hangul Compatibility Jamo
  ],
  cjk: [
    [0x4E00, 0x9FFF], // CJK Unified Ideographs
    [0x3400, 0x4DBF], // CJK Extension A
    [0x20000, 0x2A6DF], // CJK Extension B
    // P1 Fix: Added CJK Extensions C-F (Unicode 13.0+)
    [0x2A700, 0x2B73F], // CJK Extension C
    [0x2B740, 0x2B81F], // CJK Extension D
    [0x2B820, 0x2CEAF], // CJK Extension E
    [0x2CEB0, 0x2EBEF], // CJK Extension F
    [0x30000, 0x3134F], // CJK Extension G (Unicode 13.0)
    [0x31350, 0x323AF], // CJK Extension H (Unicode 15.0)
  ],
  hiragana: [
    [0x3040, 0x309F], // Hiragana
  ],
  katakana: [
    [0x30A0, 0x30FF], // Katakana
    [0x31F0, 0x31FF], // Katakana Phonetic Extensions
  ],
  vietnamese: [
    // Vietnamese uses Latin with diacritics, covered by Latin Extended
    [0x1EA0, 0x1EF9], // Vietnamese-specific Latin Extended Additional
  ],
};

/**
 * Get the Unicode script of a code point
 * @param {number} codePoint - The Unicode code point
 * @returns {string|null} - Script name or null if not in known ranges
 */
export function getScript(codePoint) {
  for (const [script, ranges] of Object.entries(SCRIPT_RANGES)) {
    for (const [start, end] of ranges) {
      if (codePoint >= start && codePoint <= end) {
        return script;
      }
    }
  }
  return null;
}

/**
 * Check if a string is a valid Unicode identifier (UAX #31 compliant)
 *
 * @param {string} s - String to check
 * @returns {boolean} - True if valid identifier
 *
 * @example
 * isUnicodeIdentifier('AuthService')     // true (ASCII)
 * isUnicodeIdentifier('КорисникСервис')  // true (Cyrillic)
 * isUnicodeIdentifier('用户服务')         // true (CJK)
 * isUnicodeIdentifier('hello world')     // false (contains space)
 */
export function isUnicodeIdentifier(s) {
  if (!s || typeof s !== 'string' || s.length < 1) return false;

  // P0 Fix: Normalize to NFC before validation
  const normalized = normalizeNFC(s);

  // Fast path: use Babel's isIdentifierName for full validation
  return isIdentifierName(normalized);
}

/**
 * Check if string contains valid Unicode identifier characters (not just ASCII)
 *
 * @param {string} s - String to check
 * @returns {boolean} - True if contains non-ASCII identifier characters
 *
 * @example
 * hasNonAsciiIdentifierChars('AuthService')     // false
 * hasNonAsciiIdentifierChars('КорисникСервис')  // true
 * hasNonAsciiIdentifierChars('用户服务')         // true
 * hasNonAsciiIdentifierChars('AuthСервис')      // true (mixed)
 */
export function hasNonAsciiIdentifierChars(s) {
  if (!s || typeof s !== 'string') return false;

  // P0 Fix: Normalize to NFC before checking
  const normalized = normalizeNFC(s);

  for (let i = 0; i < normalized.length; ) {
    const codePoint = normalized.codePointAt(i);
    // Non-ASCII identifier character (above 0x7F and valid identifier char)
    if (codePoint > 0x7F && isIdentifierChar(codePoint)) {
      return true;
    }
    i += codePoint > 0xFFFF ? 2 : 1;
  }
  return false;
}

/**
 * Detect all scripts present in a string
 *
 * @param {string} s - String to analyze
 * @returns {Set<string>} - Set of script names found
 *
 * @example
 * detectScripts('AuthService')      // Set(['latin'])
 * detectScripts('КорисникСервис')   // Set(['cyrillic'])
 * detectScripts('用户Service')      // Set(['cjk', 'latin'])
 */
export function detectScripts(s) {
  if (!s || typeof s !== 'string') return new Set();

  // P0 Fix: Normalize to NFC before analyzing
  const normalized = normalizeNFC(s);
  const scripts = new Set();

  for (let i = 0; i < normalized.length; ) {
    const codePoint = normalized.codePointAt(i);
    const script = getScript(codePoint);
    if (script) {
      scripts.add(script);
    }
    i += codePoint > 0xFFFF ? 2 : 1;
  }

  return scripts;
}

/**
 * Check if string contains mixed scripts (code-switching)
 *
 * @param {string} s - String to check
 * @returns {boolean} - True if contains multiple scripts
 *
 * @example
 * hasMixedScript('AuthService')      // false (Latin only)
 * hasMixedScript('КорисникСервис')   // false (Cyrillic only)
 * hasMixedScript('用户Service')      // true (CJK + Latin)
 * hasMixedScript('AuthСервис')       // true (Latin + Cyrillic)
 */
export function hasMixedScript(s) {
  const scripts = detectScripts(s);
  return scripts.size > 1;
}

/**
 * Check if string is primarily non-Latin
 *
 * @param {string} s - String to check
 * @returns {boolean} - True if majority of chars are non-Latin
 */
export function isPrimarilyNonLatin(s) {
  if (!s || typeof s !== 'string') return false;

  let latinCount = 0;
  let nonLatinCount = 0;

  for (let i = 0; i < s.length; ) {
    const codePoint = s.codePointAt(i);
    const script = getScript(codePoint);

    if (script === 'latin') {
      latinCount++;
    } else if (script) {
      nonLatinCount++;
    }

    i += codePoint > 0xFFFF ? 2 : 1;
  }

  return nonLatinCount > latinCount;
}

/**
 * Extract potential identifiers from a query string
 *
 * P0 Fix: Now uses proper text segmentation for CJK/Thai languages
 * that don't use spaces between words.
 *
 * @param {string} query - Query string to parse
 * @returns {string[]} - Array of potential identifiers
 *
 * @example
 * extractIdentifiers('what calls AuthService')  // ['AuthService']
 * extractIdentifiers('КорисникСервис methods')  // ['КорисникСервис']
 * extractIdentifiers('用户服务 implementation')  // ['用户服务']
 */
export function extractIdentifiers(query) {
  if (!query || typeof query !== 'string') return [];

  // P0 Fix: Normalize to NFC before splitting
  const normalized = normalizeNFC(query);

  // Detect if CJK/Thai - these need special segmentation
  const scripts = detectScripts(normalized);
  const needsSegmentation = scripts.has('cjk') ||
    scripts.has('hiragana') ||
    scripts.has('katakana') ||
    scripts.has('hangul') ||
    scripts.has('thai');

  let tokens;

  if (needsSegmentation) {
    // P0 Fix: Use Intl.Segmenter for CJK/Thai if available
    // Dynamic import would be async, so we use inline segmentation
    const locale = scripts.has('thai') ? 'th' :
      (scripts.has('hiragana') || scripts.has('katakana')) ? 'ja' :
      scripts.has('hangul') ? 'ko' : 'zh';

    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      try {
        const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
        tokens = [...segmenter.segment(normalized)]
          .filter(s => s.isWordLike)
          .map(s => s.segment);
      } catch (e) {
        // Fallback if segmenter fails
        tokens = normalized.split(/[\s,;:!?()[\]{}'"]+/);
      }
    } else {
      // Fallback: split on whitespace and punctuation
      tokens = normalized.split(/[\s,;:!?()[\]{}'"]+/);
    }
  } else {
    // Split on whitespace and punctuation (keeping Unicode chars)
    tokens = normalized.split(/[\s,;:!?()[\]{}'"]+/);
  }

  return tokens.filter(token => {
    if (!token || token.length < 2) return false;
    return isUnicodeIdentifier(token);
  });
}

/**
 * Check if query contains a Unicode identifier (for feature 25)
 *
 * @param {string} query - Query to check
 * @returns {boolean} - True if contains at least one identifier
 */
export function hasIdentifierInQuery(query) {
  const identifiers = extractIdentifiers(query);
  return identifiers.length > 0;
}

/**
 * Check if query contains a non-ASCII Unicode identifier (for feature 25 enhancement)
 *
 * @param {string} query - Query to check
 * @returns {boolean} - True if contains at least one non-ASCII identifier
 */
export function hasNonAsciiIdentifierInQuery(query) {
  const identifiers = extractIdentifiers(query);
  return identifiers.some(id => hasNonAsciiIdentifierChars(id));
}

/**
 * Detect the primary language/script of a query
 *
 * @param {string} query - Query to analyze
 * @returns {{script: string, confidence: number}} - Primary script and confidence
 */
export function detectPrimaryScript(query) {
  const scripts = detectScripts(query);

  if (scripts.size === 0) {
    return { script: 'unknown', confidence: 0 };
  }

  if (scripts.size === 1) {
    return { script: [...scripts][0], confidence: 1.0 };
  }

  // Count characters per script
  const counts = {};
  for (let i = 0; i < query.length; ) {
    const codePoint = query.codePointAt(i);
    const script = getScript(codePoint);
    if (script) {
      counts[script] = (counts[script] || 0) + 1;
    }
    i += codePoint > 0xFFFF ? 2 : 1;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const [primaryScript, count] = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])[0];

  return {
    script: primaryScript,
    confidence: count / total
  };
}

// Re-export Babel functions for direct access if needed
export { isIdentifierStart, isIdentifierChar, isIdentifierName };
