/**
 * Text Segmenter for CJK and Thai Languages
 *
 * Provides proper word segmentation for languages that don't use spaces:
 * - Chinese (zh): No spaces between characters
 * - Japanese (ja): Mix of kanji, hiragana, katakana
 * - Korean (ko): Uses spaces but syllable blocks can be segmented
 * - Thai (th): No spaces between words
 *
 * Uses Intl.Segmenter (Node 16+) with fallback for older environments.
 *
 * P0 Fix: Added to support multilingual tokenization for training data
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
 */

import { normalizeNFC, detectScripts, SCRIPT_RANGES } from './unicode-utils.js';

/**
 * Check if Intl.Segmenter is available
 */
const HAS_SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

/**
 * Cache for segmenters by locale
 */
const segmenterCache = new Map();

/**
 * Get or create a word segmenter for a locale
 *
 * @param {string} locale - BCP 47 locale code (e.g., 'zh', 'ja', 'ko', 'th')
 * @returns {Intl.Segmenter|null} - Segmenter or null if not available
 */
function getSegmenter(locale) {
  if (!HAS_SEGMENTER) return null;

  if (!segmenterCache.has(locale)) {
    try {
      segmenterCache.set(locale, new Intl.Segmenter(locale, { granularity: 'word' }));
    } catch (e) {
      // Locale not supported
      segmenterCache.set(locale, null);
    }
  }

  return segmenterCache.get(locale);
}

/**
 * Segment text into words using Intl.Segmenter
 *
 * @param {string} text - Text to segment
 * @param {string} locale - BCP 47 locale code
 * @returns {string[]} - Array of word segments
 */
function segmentWithIntl(text, locale) {
  const segmenter = getSegmenter(locale);
  if (!segmenter) return null;

  const segments = [];
  for (const segment of segmenter.segment(text)) {
    // Only include word-like segments (skip punctuation, whitespace)
    if (segment.isWordLike) {
      segments.push(segment.segment);
    }
  }
  return segments;
}

/**
 * Fallback segmentation for CJK when Intl.Segmenter is not available
 *
 * Uses character-based segmentation for CJK ideographs.
 * This is a simple fallback - not linguistically accurate but functional.
 *
 * @param {string} text - Text to segment
 * @returns {string[]} - Array of character segments
 */
function fallbackCJKSegment(text) {
  const segments = [];
  let currentRun = '';
  let currentType = null; // 'cjk', 'hangul', 'other'

  for (let i = 0; i < text.length;) {
    const codePoint = text.codePointAt(i);
    const charLen = codePoint > 0xFFFF ? 2 : 1;
    const char = text.substring(i, i + charLen);

    let type = 'other';

    // Check CJK ideographs
    for (const [start, end] of SCRIPT_RANGES.cjk) {
      if (codePoint >= start && codePoint <= end) {
        type = 'cjk';
        break;
      }
    }

    // Check Hangul
    if (type === 'other') {
      for (const [start, end] of SCRIPT_RANGES.hangul) {
        if (codePoint >= start && codePoint <= end) {
          type = 'hangul';
          break;
        }
      }
    }

    // Check hiragana/katakana
    if (type === 'other') {
      for (const [start, end] of SCRIPT_RANGES.hiragana || []) {
        if (codePoint >= start && codePoint <= end) {
          type = 'cjk'; // Treat as CJK for segmentation
          break;
        }
      }
      for (const [start, end] of SCRIPT_RANGES.katakana || []) {
        if (codePoint >= start && codePoint <= end) {
          type = 'cjk'; // Treat as CJK for segmentation
          break;
        }
      }
    }

    // Segment on type change
    if (type !== currentType && currentRun) {
      if (currentType === 'cjk') {
        // Split CJK into individual characters
        segments.push(...currentRun.split(''));
      } else if (currentRun.trim()) {
        segments.push(currentRun.trim());
      }
      currentRun = '';
    }

    currentType = type;

    // Skip whitespace
    if (/\s/.test(char)) {
      if (currentRun.trim()) {
        if (currentType === 'cjk') {
          segments.push(...currentRun.split(''));
        } else {
          segments.push(currentRun.trim());
        }
        currentRun = '';
      }
    } else {
      currentRun += char;
    }

    i += charLen;
  }

  // Handle remaining run
  if (currentRun.trim()) {
    if (currentType === 'cjk') {
      segments.push(...currentRun.split(''));
    } else {
      segments.push(currentRun.trim());
    }
  }

  return segments.filter(s => s.length > 0);
}

/**
 * Fallback segmentation for Thai when Intl.Segmenter is not available
 *
 * Thai is complex - without proper dictionary-based segmentation,
 * we can only split on spaces and punctuation.
 *
 * @param {string} text - Text to segment
 * @returns {string[]} - Array of segments (basic fallback)
 */
function fallbackThaiSegment(text) {
  // Thai range: 0x0E00-0x0E7F
  // Without proper dictionary, we can only do basic splitting
  // This is a simplified fallback - production should use Intl.Segmenter
  return text
    .split(/[\s\u0E2F\u0E5A\u0E5B]+/) // Split on spaces and Thai punctuation
    .filter(s => s.length > 0);
}

/**
 * Segment text into words, handling CJK and Thai languages
 *
 * @param {string} text - Text to segment
 * @param {string} [locale] - Optional locale hint (auto-detected if not provided)
 * @returns {string[]} - Array of word segments
 *
 * @example
 * segmentText('用户服务')          // ['用', '户', '服', '务'] (fallback) or ['用户', '服务'] (Intl)
 * segmentText('hello world')       // ['hello', 'world']
 * segmentText('สวัสดีครับ', 'th')  // Proper Thai segmentation if Intl.Segmenter available
 */
export function segmentText(text, locale) {
  if (!text || typeof text !== 'string') return [];

  // Normalize to NFC
  const normalized = normalizeNFC(text);

  // Detect scripts if locale not provided
  if (!locale) {
    const scripts = detectScripts(normalized);

    if (scripts.has('thai')) {
      locale = 'th';
    } else if (scripts.has('cjk') || scripts.has('hiragana') || scripts.has('katakana')) {
      // Prefer Japanese if we see hiragana/katakana
      if (scripts.has('hiragana') || scripts.has('katakana')) {
        locale = 'ja';
      } else {
        locale = 'zh';
      }
    } else if (scripts.has('hangul')) {
      locale = 'ko';
    } else {
      // Default: simple whitespace split for Latin scripts
      return normalized.split(/\s+/).filter(s => s.length > 0);
    }
  }

  // Try Intl.Segmenter first
  const intlResult = segmentWithIntl(normalized, locale);
  if (intlResult) {
    return intlResult;
  }

  // Fallback based on locale
  switch (locale) {
    case 'zh':
    case 'ja':
      return fallbackCJKSegment(normalized);
    case 'th':
      return fallbackThaiSegment(normalized);
    case 'ko':
      // Korean uses spaces, so simple split works
      return normalized.split(/\s+/).filter(s => s.length > 0);
    default:
      return normalized.split(/\s+/).filter(s => s.length > 0);
  }
}

/**
 * Check if text requires special segmentation (CJK/Thai)
 *
 * @param {string} text - Text to check
 * @returns {boolean} - True if text contains CJK or Thai characters
 */
export function requiresSegmentation(text) {
  if (!text || typeof text !== 'string') return false;

  const scripts = detectScripts(text);
  return scripts.has('cjk') ||
    scripts.has('hiragana') ||
    scripts.has('katakana') ||
    scripts.has('hangul') ||
    scripts.has('thai');
}

/**
 * Get the best locale for segmentation based on text content
 *
 * @param {string} text - Text to analyze
 * @returns {string|null} - Locale code or null if not CJK/Thai
 */
export function detectSegmentationLocale(text) {
  if (!text || typeof text !== 'string') return null;

  const scripts = detectScripts(text);

  if (scripts.has('thai')) return 'th';
  if (scripts.has('hiragana') || scripts.has('katakana')) return 'ja';
  if (scripts.has('hangul')) return 'ko';
  if (scripts.has('cjk')) return 'zh';

  return null;
}

/**
 * Tokenize text for training data, properly handling all languages
 *
 * @param {string} text - Text to tokenize
 * @returns {string[]} - Array of tokens
 */
export function tokenizeForTraining(text) {
  if (!text || typeof text !== 'string') return [];

  const normalized = normalizeNFC(text.toLowerCase());

  if (requiresSegmentation(normalized)) {
    return segmentText(normalized);
  }

  // For non-CJK/Thai: split on whitespace and punctuation, keep meaningful tokens
  return normalized
    .split(/[\s,;:!?()[\]{}"']+/)
    .filter(s => s.length >= 2); // Skip single chars for Latin scripts
}

export { HAS_SEGMENTER };
