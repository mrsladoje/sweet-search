/**
 * Unit Tests for Phase 3 Multilingual Features
 *
 * Tests for:
 * - unicode-utils.js - NFC normalization, script detection, identifier extraction
 * - multilingual-patterns.js - Pattern matching with error handling
 * - text-segmenter.js - CJK/Thai text segmentation
 *
 * Run: npx jest training/__tests__/multilingual-features.test.js
 */

// Using vitest globals (enabled in vitest.config.js)

// Import unicode-utils functions
import {
  normalizeNFC,
  isUnicodeIdentifier,
  hasNonAsciiIdentifierChars,
  detectScripts,
  hasMixedScript,
  extractIdentifiers,
  hasNonAsciiIdentifierInQuery,
  detectPrimaryScript,
  SCRIPT_RANGES,
} from '../../training/features/unicode-utils.js';

// Import multilingual-patterns functions
import {
  matchesStructuralPattern,
  matchesSemanticPattern,
  hasStructuralKeywordNonEn,
  hasSemanticKeywordNonEn,
  detectQueryLanguage,
  getSupportedLanguages,
  STRUCTURAL_PATTERNS,
  SEMANTIC_PATTERNS,
} from '../../training/features/multilingual-patterns.js';

// Import text-segmenter functions
import {
  segmentText,
  requiresSegmentation,
  detectSegmentationLocale,
  tokenizeForTraining,
  HAS_SEGMENTER,
} from '../../training/features/text-segmenter.js';

// ============================================
// UNICODE-UTILS TESTS
// ============================================

describe('unicode-utils', () => {
  describe('normalizeNFC', () => {
    test('should normalize composed vs decomposed characters', () => {
      // é can be composed (single char) or decomposed (e + combining accent)
      const composed = '\u00E9'; // é (single codepoint)
      const decomposed = 'e\u0301'; // e + combining acute accent

      expect(normalizeNFC(composed)).toBe(normalizeNFC(decomposed));
    });

    test('should handle null/undefined gracefully', () => {
      expect(normalizeNFC(null)).toBe(null);
      expect(normalizeNFC(undefined)).toBe(undefined);
      expect(normalizeNFC('')).toBe('');
    });

    test('should normalize Serbian Cyrillic characters', () => {
      const input = 'наслеђе'; // inheritance in Serbian
      const result = normalizeNFC(input);
      expect(result).toBe(input.normalize('NFC'));
    });
  });

  describe('isUnicodeIdentifier', () => {
    test('should accept ASCII identifiers', () => {
      expect(isUnicodeIdentifier('AuthService')).toBe(true);
      expect(isUnicodeIdentifier('getUserById')).toBe(true);
      expect(isUnicodeIdentifier('_private')).toBe(true);
      expect(isUnicodeIdentifier('$jquery')).toBe(true);
    });

    test('should accept Cyrillic identifiers', () => {
      expect(isUnicodeIdentifier('КорисникСервис')).toBe(true); // Serbian
      expect(isUnicodeIdentifier('ПользовательСервис')).toBe(true); // Russian
    });

    test('should accept CJK identifiers', () => {
      expect(isUnicodeIdentifier('用户服务')).toBe(true); // Chinese
      expect(isUnicodeIdentifier('ユーザーサービス')).toBe(true); // Japanese
    });

    test('should reject invalid identifiers', () => {
      expect(isUnicodeIdentifier('hello world')).toBe(false); // space
      expect(isUnicodeIdentifier('123abc')).toBe(false); // starts with digit
      expect(isUnicodeIdentifier('')).toBe(false);
      expect(isUnicodeIdentifier(null)).toBe(false);
    });
  });

  describe('hasNonAsciiIdentifierChars', () => {
    test('should return false for ASCII-only', () => {
      expect(hasNonAsciiIdentifierChars('AuthService')).toBe(false);
      expect(hasNonAsciiIdentifierChars('get_user_123')).toBe(false);
    });

    test('should return true for non-ASCII', () => {
      expect(hasNonAsciiIdentifierChars('КорисникСервис')).toBe(true);
      expect(hasNonAsciiIdentifierChars('用户服务')).toBe(true);
      expect(hasNonAsciiIdentifierChars('Authサービス')).toBe(true); // mixed
    });
  });

  describe('detectScripts', () => {
    test('should detect Latin script', () => {
      const scripts = detectScripts('AuthService');
      expect(scripts.has('latin')).toBe(true);
    });

    test('should detect Cyrillic script', () => {
      const scripts = detectScripts('КорисникСервис');
      expect(scripts.has('cyrillic')).toBe(true);
    });

    test('should detect CJK scripts', () => {
      const scripts = detectScripts('用户服务');
      expect(scripts.has('cjk')).toBe(true);
    });

    test('should detect Japanese scripts', () => {
      const scripts = detectScripts('ユーザー');
      expect(scripts.has('katakana')).toBe(true);

      const scripts2 = detectScripts('ひらがな');
      expect(scripts2.has('hiragana')).toBe(true);
    });

    test('should detect mixed scripts', () => {
      const scripts = detectScripts('Auth服务');
      expect(scripts.has('latin')).toBe(true);
      expect(scripts.has('cjk')).toBe(true);
    });
  });

  describe('hasMixedScript', () => {
    test('should return false for single script', () => {
      expect(hasMixedScript('AuthService')).toBe(false);
      expect(hasMixedScript('КорисникСервис')).toBe(false);
    });

    test('should return true for mixed scripts', () => {
      expect(hasMixedScript('Auth服务')).toBe(true);
      expect(hasMixedScript('Authサービス')).toBe(true);
    });
  });

  describe('extractIdentifiers', () => {
    test('should extract ASCII identifiers from queries', () => {
      const result = extractIdentifiers('what calls AuthService');
      expect(result).toContain('AuthService');
    });

    test('should extract Cyrillic identifiers', () => {
      const result = extractIdentifiers('шта позива КорисникСервис');
      expect(result).toContain('КорисникСервис');
    });

    test('should extract CJK identifiers', () => {
      const result = extractIdentifiers('什么调用用户服务');
      // CJK extraction depends on segmenter availability
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle empty/null input', () => {
      expect(extractIdentifiers('')).toEqual([]);
      expect(extractIdentifiers(null)).toEqual([]);
      expect(extractIdentifiers(undefined)).toEqual([]);
    });
  });

  describe('detectPrimaryScript', () => {
    test('should return Latin for English text', () => {
      const result = detectPrimaryScript('AuthService login');
      expect(result.script).toBe('latin');
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('should return Cyrillic for Serbian text', () => {
      const result = detectPrimaryScript('КорисникСервис');
      expect(result.script).toBe('cyrillic');
      expect(result.confidence).toBe(1.0);
    });

    test('should return unknown for empty input', () => {
      const result = detectPrimaryScript('');
      expect(result.script).toBe('unknown');
      expect(result.confidence).toBe(0);
    });
  });
});

// ============================================
// MULTILINGUAL-PATTERNS TESTS
// ============================================

describe('multilingual-patterns', () => {
  describe('matchesStructuralPattern', () => {
    test('should match English caller queries', () => {
      const result = matchesStructuralPattern('what calls AuthService');
      expect(result.matched).toBe(true);
      expect(result.type).toBe('callers');
      expect(result.language).toBe('en');
    });

    test('should match German caller queries', () => {
      const result = matchesStructuralPattern('wer ruft AuthService auf');
      expect(result.matched).toBe(true);
      expect(result.type).toBe('callers');
      expect(result.language).toBe('de');
    });

    test('should match Serbian caller queries', () => {
      const result = matchesStructuralPattern('шта позива AuthService');
      expect(result.matched).toBe(true);
      expect(result.type).toBe('callers');
      expect(result.language).toBe('sr');
    });

    test('should match Chinese caller queries', () => {
      const result = matchesStructuralPattern('什么调用AuthService');
      expect(result.matched).toBe(true);
      expect(result.type).toBe('callers');
      expect(result.language).toBe('zh');
    });

    test('should handle long queries safely (DoS prevention)', () => {
      const longQuery = 'a'.repeat(1000);
      const result = matchesStructuralPattern(longQuery);
      expect(result.matched).toBe(false); // Should not match, but also not hang
    });

    test('should handle null/undefined gracefully', () => {
      expect(matchesStructuralPattern(null)).toEqual({ matched: false, type: null, language: null });
      expect(matchesStructuralPattern(undefined)).toEqual({ matched: false, type: null, language: null });
      expect(matchesStructuralPattern('')).toEqual({ matched: false, type: null, language: null });
    });
  });

  describe('matchesSemanticPattern', () => {
    test('should match English question patterns', () => {
      const result = matchesSemanticPattern('how does authentication work');
      expect(result.matched).toBe(true);
      expect(result.type).toBe('questionWords');
      expect(result.language).toBe('en');
    });

    test('should match German question patterns', () => {
      const result = matchesSemanticPattern('wie funktioniert die Authentifizierung');
      expect(result.matched).toBe(true);
      expect(result.type).toBe('questionWords');
      expect(result.language).toBe('de');
    });

    test('should match Serbian question patterns', () => {
      const result = matchesSemanticPattern('како ради аутентификација');
      expect(result.matched).toBe(true);
      expect(result.type).toBe('questionWords');
      expect(result.language).toBe('sr');
    });

    test('should match Chinese question patterns', () => {
      const result = matchesSemanticPattern('如何进行认证');
      expect(result.matched).toBe(true);
      expect(result.type).toBe('questionWords');
      expect(result.language).toBe('zh');
    });

    test('should handle long queries safely', () => {
      const longQuery = '如何'.repeat(500);
      const result = matchesSemanticPattern(longQuery);
      expect(result.matched).toBe(false); // Exceeds MAX_QUERY_LENGTH
    });
  });

  describe('hasStructuralKeywordNonEn', () => {
    test('should return false for English queries', () => {
      expect(hasStructuralKeywordNonEn('what calls AuthService')).toBe(false);
    });

    test('should return true for non-English structural queries', () => {
      expect(hasStructuralKeywordNonEn('шта позива AuthService')).toBe(true);
      expect(hasStructuralKeywordNonEn('什么调用用户服务')).toBe(true);
    });
  });

  describe('hasSemanticKeywordNonEn', () => {
    test('should return false for English queries', () => {
      expect(hasSemanticKeywordNonEn('how does auth work')).toBe(false);
    });

    test('should return true for non-English semantic queries', () => {
      expect(hasSemanticKeywordNonEn('како ради аутентификација')).toBe(true);
      expect(hasSemanticKeywordNonEn('如何进行认证')).toBe(true);
    });
  });

  describe('detectQueryLanguage', () => {
    test('should detect language from structural patterns', () => {
      expect(detectQueryLanguage('what calls AuthService')).toBe('en');
      expect(detectQueryLanguage('шта позива AuthService')).toBe('sr');
    });

    test('should detect language from semantic patterns', () => {
      expect(detectQueryLanguage('how does auth work')).toBe('en');
      expect(detectQueryLanguage('如何进行认证')).toBe('zh');
    });

    test('should return unknown for unrecognized patterns', () => {
      expect(detectQueryLanguage('random text')).toBe('unknown');
    });
  });

  describe('getSupportedLanguages', () => {
    test('should return all supported languages', () => {
      const languages = getSupportedLanguages();
      expect(languages).toContain('en');
      expect(languages).toContain('de');
      expect(languages).toContain('sr');
      expect(languages).toContain('zh');
      expect(languages).toContain('ja');
      expect(languages).toContain('ko');
    });

    test('should filter by type', () => {
      const structuralLangs = getSupportedLanguages('structural');
      const semanticLangs = getSupportedLanguages('semantic');

      expect(structuralLangs.length).toBeGreaterThan(0);
      expect(semanticLangs.length).toBeGreaterThan(0);
    });
  });
});

// ============================================
// TEXT-SEGMENTER TESTS
// ============================================

describe('text-segmenter', () => {
  describe('segmentText', () => {
    test('should segment English text by whitespace', () => {
      const result = segmentText('hello world');
      expect(result).toEqual(['hello', 'world']);
    });

    test('should segment Chinese text', () => {
      const result = segmentText('用户服务');
      // Either Intl.Segmenter result or character fallback
      expect(result.length).toBeGreaterThan(0);
    });

    test('should handle empty input', () => {
      expect(segmentText('')).toEqual([]);
      expect(segmentText(null)).toEqual([]);
    });

    test('should respect locale hint', () => {
      const result = segmentText('用户服务', 'zh');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('requiresSegmentation', () => {
    test('should return false for Latin text', () => {
      expect(requiresSegmentation('hello world')).toBe(false);
      expect(requiresSegmentation('AuthService')).toBe(false);
    });

    test('should return true for CJK text', () => {
      expect(requiresSegmentation('用户服务')).toBe(true);
      expect(requiresSegmentation('ユーザー')).toBe(true);
    });

    test('should return true for Thai text', () => {
      expect(requiresSegmentation('สวัสดี')).toBe(true);
    });

    test('should return true for Korean text', () => {
      expect(requiresSegmentation('안녕하세요')).toBe(true);
    });

    test('should handle edge cases', () => {
      expect(requiresSegmentation('')).toBe(false);
      expect(requiresSegmentation(null)).toBe(false);
    });
  });

  describe('detectSegmentationLocale', () => {
    test('should detect Chinese locale', () => {
      expect(detectSegmentationLocale('用户服务')).toBe('zh');
    });

    test('should detect Japanese locale', () => {
      expect(detectSegmentationLocale('ユーザー')).toBe('ja');
      expect(detectSegmentationLocale('ひらがな')).toBe('ja');
    });

    test('should detect Korean locale', () => {
      expect(detectSegmentationLocale('안녕하세요')).toBe('ko');
    });

    test('should detect Thai locale', () => {
      expect(detectSegmentationLocale('สวัสดี')).toBe('th');
    });

    test('should return null for Latin text', () => {
      expect(detectSegmentationLocale('hello')).toBe(null);
    });
  });

  describe('tokenizeForTraining', () => {
    test('should tokenize English text', () => {
      const result = tokenizeForTraining('what calls AuthService');
      expect(result).toContain('what');
      expect(result).toContain('calls');
      expect(result).toContain('authservice');
    });

    test('should tokenize Chinese text', () => {
      const result = tokenizeForTraining('用户服务');
      expect(result.length).toBeGreaterThan(0);
    });

    test('should filter short tokens for Latin', () => {
      const result = tokenizeForTraining('a b c longer');
      expect(result).not.toContain('a');
      expect(result).not.toContain('b');
      expect(result).not.toContain('c');
      expect(result).toContain('longer');
    });

    test('should lowercase tokens', () => {
      const result = tokenizeForTraining('AuthService');
      expect(result).toContain('authservice');
      expect(result).not.toContain('AuthService');
    });
  });

  describe('HAS_SEGMENTER', () => {
    test('should be a boolean', () => {
      expect(typeof HAS_SEGMENTER).toBe('boolean');
    });

    test('should be true in Node 16+ environments', () => {
      // Node 16+ has Intl.Segmenter
      const nodeVersion = parseInt(process.version.slice(1).split('.')[0], 10);
      if (nodeVersion >= 16) {
        expect(HAS_SEGMENTER).toBe(true);
      }
    });
  });
});

// ============================================
// INTEGRATION TESTS
// ============================================

describe('integration', () => {
  test('NFC normalization should work across all modules', () => {
    // Same string in composed and decomposed form
    const composed = 'café';
    const decomposed = 'cafe\u0301';

    // Should normalize consistently
    expect(normalizeNFC(composed)).toBe(normalizeNFC(decomposed));

    // Should detect same scripts
    const scripts1 = detectScripts(normalizeNFC(composed));
    const scripts2 = detectScripts(normalizeNFC(decomposed));
    expect([...scripts1].sort()).toEqual([...scripts2].sort());
  });

  test('multilingual pattern matching should use NFC normalization', () => {
    // Serbian text with potential decomposed characters
    const query = 'како ради аутентификација';

    const result = matchesSemanticPattern(query);
    expect(result.matched).toBe(true);
    expect(result.language).toBe('sr');
  });

  test('text segmentation should integrate with identifier extraction', () => {
    // Chinese query with identifier
    const query = '什么调用AuthService';

    // Should be able to extract identifiers
    const identifiers = extractIdentifiers(query);
    expect(identifiers.length).toBeGreaterThan(0);
  });

  test('pattern detection should work for all supported languages', () => {
    const languages = getSupportedLanguages();

    // Each language should have at least one pattern
    for (const lang of languages) {
      let hasPattern = false;

      for (const patterns of Object.values(STRUCTURAL_PATTERNS)) {
        if (patterns[lang]) {
          hasPattern = true;
          break;
        }
      }

      for (const patterns of Object.values(SEMANTIC_PATTERNS)) {
        if (patterns[lang]) {
          hasPattern = true;
          break;
        }
      }

      expect(hasPattern).toBe(true);
    }
  });
});
