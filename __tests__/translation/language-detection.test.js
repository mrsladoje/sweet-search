/**
 * Unit Tests for Language Detection - CRITICAL for bug fix validation
 *
 * These tests validate the enhanced language detection system that fixes
 * the bug where Latin-script languages (German, French, Spanish) were
 * incorrectly detected as English.
 *
 * Tests: isLikelyEnglish (soft check), detectLatinLanguage, toNLLBCode
 * Reference: docs/TRANSLATION.md
 */
import { describe, it, expect } from 'vitest';
import {
  isLikelyEnglish,
  detectLatinLanguage,
  detectLanguage,
  toNLLBCode,
} from '../../translation/language-detector.js';

describe('Language Detection', () => {
  describe('isLikelyEnglish', () => {
    it('returns likely=false for Cyrillic text', () => {
      const result = isLikelyEnglish('аутентификација');
      expect(result.likely).toBe(false);
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.reason).toBe('cyrillic');
    });

    it('returns likely=false for CJK text', () => {
      const result = isLikelyEnglish('認証サービス');
      expect(result.likely).toBe(false);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('returns likely=false for Korean text', () => {
      const result = isLikelyEnglish('인증 서비스');
      expect(result.likely).toBe(false);
      expect(result.reason).toBe('korean');
    });

    it('returns likely=false for German with diacritics', () => {
      const result = isLikelyEnglish('Größe');
      expect(result.likely).toBe(false);
      expect(result.reason).toContain('latin:deu');
    });

    it('returns likely=false for French with diacritics', () => {
      const result = isLikelyEnglish('français');
      expect(result.likely).toBe(false);
      expect(result.reason).toContain('latin:fra');
    });

    it('returns likely=false for Spanish with diacritics', () => {
      const result = isLikelyEnglish('¿Cómo estás?');
      expect(result.likely).toBe(false);
      expect(result.reason).toContain('latin:spa');
    });

    // CRITICAL TEST: This is THE BUG we're fixing
    it('returns likely=true with LOW confidence for pure ASCII (German word)', () => {
      const result = isLikelyEnglish('Mitarbeiter');  // German word, pure ASCII
      expect(result.likely).toBe(true);
      expect(result.confidence).toBeLessThanOrEqual(0.5);  // LOW confidence!
      expect(result.reason).toBe('ascii');
    });

    it('returns likely=true for obvious English', () => {
      const result = isLikelyEnglish('authentication service');
      expect(result.likely).toBe(true);
    });

    it('returns likely=true for code identifiers', () => {
      const result = isLikelyEnglish('AuthenticationService');
      expect(result.likely).toBe(true);
    });

    it('handles empty input', () => {
      const result = isLikelyEnglish('');
      expect(result.likely).toBe(true);
      expect(result.reason).toBe('empty');
    });

    it('handles null input', () => {
      const result = isLikelyEnglish(null);
      expect(result.likely).toBe(true);
    });
  });

  describe('detectLatinLanguage', () => {
    it('detects German from ä, ö, ü, ß', () => {
      expect(detectLatinLanguage('Größe')).toBe('deu_Latn');
      expect(detectLatinLanguage('Mitarbeiter')).toBeNull();  // No diacritics
    });

    it('does not detect from pure ASCII compound words (removed - too aggressive)', () => {
      // Compound word detection was removed because it matched English identifiers
      expect(detectLatinLanguage('Arbeitnehmeruberlassung')).toBeNull();
    });

    it('detects Spanish from ñ, ¿, ¡', () => {
      expect(detectLatinLanguage('español')).toBe('spa_Latn');
      expect(detectLatinLanguage('¿Qué?')).toBe('spa_Latn');
    });

    it('detects French from à, ç, è, ê, etc.', () => {
      expect(detectLatinLanguage('français')).toBe('fra_Latn');
      // Note: 'café' only has é which is ambiguous (Spanish/French), returns null
      expect(detectLatinLanguage('café')).toBeNull();
      // Use unambiguous French chars:
      expect(detectLatinLanguage('garçon')).toBe('fra_Latn');
    });

    it('detects Polish from ą, ć, ę, ł, etc.', () => {
      expect(detectLatinLanguage('źródło')).toBe('pol_Latn');
    });

    it('returns null for pure ASCII', () => {
      expect(detectLatinLanguage('hello world')).toBeNull();
    });

    it('handles empty input', () => {
      expect(detectLatinLanguage('')).toBeNull();
      expect(detectLatinLanguage(null)).toBeNull();
    });
  });

  describe('detectLanguage (full detection)', () => {
    it('detects Serbian Cyrillic', () => {
      const result = detectLanguage('Ђорђе');
      expect(result.language).toBe('sr');
    });

    it('detects Russian Cyrillic', () => {
      const result = detectLanguage('привет');
      expect(['ru', 'sr']).toContain(result.language);  // Could be either without specific markers
    });

    it('detects Japanese', () => {
      const result = detectLanguage('認証サービス');
      expect(result.language).toBe('ja');
    });

    it('detects Chinese', () => {
      const result = detectLanguage('认证服务');
      expect(result.language).toBe('zh');
    });

    it('detects Korean', () => {
      const result = detectLanguage('인증');
      expect(result.language).toBe('ko');
    });
  });

  describe('toNLLBCode', () => {
    it('converts ISO codes to NLLB format', () => {
      expect(toNLLBCode('sr')).toBe('srp_Cyrl');
      expect(toNLLBCode('de')).toBe('deu_Latn');
      expect(toNLLBCode('en')).toBe('eng_Latn');
      expect(toNLLBCode('zh')).toBe('zho_Hans');
    });

    it('passes through already-NLLB codes', () => {
      expect(toNLLBCode('deu_Latn')).toBe('deu_Latn');
    });
  });
});
