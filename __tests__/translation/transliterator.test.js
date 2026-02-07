/**
 * Unit Tests for Transliterator (T1)
 */

import { describe, test, expect } from 'vitest';
import {
  Transliterator,
  transliterate,
  removeDiacritics,
  toAscii,
  wouldTransliterate,
  detectCyrillicVariant,
  SERBIAN_CYRILLIC,
  RUSSIAN_CYRILLIC,
} from '../../translation/transliterator.js';

// =============================================================================
// SERBIAN CYRILLIC TESTS
// =============================================================================

describe('Serbian Cyrillic Transliteration', () => {
  test('transliterates basic Serbian words', () => {
    expect(transliterate('КорисникСервис', 'serbian')).toBe('KorisnikServis');
    expect(transliterate('аутентификација', 'serbian')).toBe('autentifikacija');
    expect(transliterate('пријава', 'serbian')).toBe('prijava');
  });

  test('transliterates Serbian-specific letters', () => {
    expect(transliterate('Ђ', 'serbian')).toBe('Đ');
    expect(transliterate('Ћ', 'serbian')).toBe('Ć');
    expect(transliterate('Љ', 'serbian')).toBe('Lj');
    expect(transliterate('Њ', 'serbian')).toBe('Nj');
    expect(transliterate('Џ', 'serbian')).toBe('Dž');
    expect(transliterate('Ј', 'serbian')).toBe('J');
  });

  test('transliterates lowercase Serbian letters', () => {
    expect(transliterate('ђ', 'serbian')).toBe('đ');
    expect(transliterate('ћ', 'serbian')).toBe('ć');
    expect(transliterate('љ', 'serbian')).toBe('lj');
    expect(transliterate('њ', 'serbian')).toBe('nj');
    expect(transliterate('џ', 'serbian')).toBe('dž');
  });

  test('handles Serbian programming terms', () => {
    expect(transliterate('СервисАутентификације', 'serbian')).toBe('ServisAutentifikacije');
    expect(transliterate('КонтролерКорисника', 'serbian')).toBe('KontrolerKorisnika');
    expect(transliterate('пројекат', 'serbian')).toBe('projekat');
  });

  test('preserves non-Cyrillic characters', () => {
    expect(transliterate('AuthService аутентификација', 'serbian')).toBe('AuthService autentifikacija');
    expect(transliterate('123 тест', 'serbian')).toBe('123 test');
  });
});

// =============================================================================
// RUSSIAN CYRILLIC TESTS
// =============================================================================

describe('Russian Cyrillic Transliteration', () => {
  test('transliterates basic Russian words', () => {
    expect(transliterate('аутентификация', 'russian')).toBe('autentifikatsiya');
    expect(transliterate('пользователь', 'russian')).toBe('polzovatel');
    expect(transliterate('сервис', 'russian')).toBe('servis');
  });

  test('transliterates Russian-specific letters', () => {
    expect(transliterate('Ы', 'russian')).toBe('Y');
    expect(transliterate('Ё', 'russian')).toBe('Yo');
    expect(transliterate('Э', 'russian')).toBe('E');
    expect(transliterate('Щ', 'russian')).toBe('Shch');
    expect(transliterate('Ю', 'russian')).toBe('Yu');
    expect(transliterate('Я', 'russian')).toBe('Ya');
  });

  test('handles soft and hard signs', () => {
    expect(transliterate('Ъ', 'russian')).toBe('');
    expect(transliterate('Ь', 'russian')).toBe('');
    expect(transliterate('объект', 'russian')).toBe('obekt');
  });

  test('transliterates Russian programming terms', () => {
    expect(transliterate('СервисАутентификации', 'russian')).toBe('ServisAutentifikatsii');
    expect(transliterate('КонтроллерПользователя', 'russian')).toBe('KontrollerPolzovatelya');
  });
});

// =============================================================================
// AUTO-DETECTION TESTS
// =============================================================================

describe('Cyrillic Variant Detection', () => {
  test('detects Serbian by unique characters', () => {
    expect(detectCyrillicVariant('Ђорђе')).toBe('serbian');
    expect(detectCyrillicVariant('Ћирилица')).toBe('serbian');
    expect(detectCyrillicVariant('љубав')).toBe('serbian');
    expect(detectCyrillicVariant('наслеђе')).toBe('serbian');
  });

  test('detects Russian by unique characters', () => {
    // Russian-unique: Ы, Ё, Э, Щ (not ъ alone)
    expect(detectCyrillicVariant('язык')).toBe('russian'); // contains я
    expect(detectCyrillicVariant('ёлка')).toBe('russian'); // contains ё
    expect(detectCyrillicVariant('щука')).toBe('russian'); // contains щ
    expect(detectCyrillicVariant('объект')).toBe('cyrillic'); // ъ alone is not unique marker
  });

  test('returns generic cyrillic for ambiguous text', () => {
    expect(detectCyrillicVariant('сервис')).toBe('cyrillic');
    expect(detectCyrillicVariant('тест')).toBe('cyrillic');
  });

  test('auto-detection in transliterate', () => {
    // Serbian-specific
    expect(transliterate('Ђорђе', 'auto')).toBe('Đorđe');
    // Russian-specific
    expect(transliterate('язык', 'auto')).toBe('yazyk');
  });
});

// =============================================================================
// DIACRITICS REMOVAL TESTS
// =============================================================================

describe('Diacritics Removal', () => {
  test('removes common diacritics', () => {
    expect(removeDiacritics('café')).toBe('cafe');
    expect(removeDiacritics('naïve')).toBe('naive');
    expect(removeDiacritics('résumé')).toBe('resume');
  });

  test('removes German umlauts', () => {
    expect(removeDiacritics('Überprüfung')).toBe('Uberprufung');
    expect(removeDiacritics('Größe')).toBe('Große'); // ß is not a diacritic
  });

  test('removes Spanish characters', () => {
    expect(removeDiacritics('señor')).toBe('senor');
    expect(removeDiacritics('niño')).toBe('nino');
  });

  test('handles empty and null input', () => {
    expect(removeDiacritics('')).toBe('');
    expect(removeDiacritics(null)).toBe(null);
    expect(removeDiacritics(undefined)).toBe(undefined);
  });
});

// =============================================================================
// FULL ASCII CONVERSION TESTS
// =============================================================================

describe('Full ASCII Conversion (toAscii)', () => {
  test('converts Cyrillic + removes diacritics', () => {
    // Note: Serbian Đ/đ is preserved (it's a distinct Latin letter, not a diacritic)
    expect(toAscii('наслеђе')).toBe('nasleđe'); // đ preserved
    expect(toAscii('КорисникСервис')).toBe('KorisnikServis');
    expect(toAscii('café')).toBe('cafe'); // accent removed
  });

  test('handles mixed scripts', () => {
    expect(toAscii('AuthService аутентификација')).toBe('AuthService autentifikacija');
    expect(toAscii('café тест')).toBe('cafe test');
  });
});

// =============================================================================
// UTILITY FUNCTION TESTS
// =============================================================================

describe('Utility Functions', () => {
  test('wouldTransliterate returns true for Cyrillic', () => {
    expect(wouldTransliterate('сервис')).toBe(true);
    expect(wouldTransliterate('КорисникСервис')).toBe(true);
  });

  test('wouldTransliterate returns false for Latin', () => {
    expect(wouldTransliterate('AuthService')).toBe(false);
    expect(wouldTransliterate('hello world')).toBe(false);
  });

  test('wouldTransliterate returns false for empty', () => {
    expect(wouldTransliterate('')).toBe(false);
    expect(wouldTransliterate(null)).toBe(false);
  });
});

// =============================================================================
// TRANSLITERATOR CLASS TESTS
// =============================================================================

describe('Transliterator Class', () => {
  test('process returns correct structure', () => {
    const t = new Transliterator();
    const result = t.process('аутентификација');

    expect(result).toHaveProperty('original', 'аутентификација');
    expect(result).toHaveProperty('transliterated');
    expect(result).toHaveProperty('script');
    expect(result).toHaveProperty('changed', true);
  });

  test('process detects script', () => {
    const t = new Transliterator();

    const serbian = t.process('Ђорђе');
    expect(serbian.script).toBe('serbian');

    const russian = t.process('язык');
    expect(russian.script).toBe('russian');
  });

  test('process handles Latin input', () => {
    const t = new Transliterator();
    const result = t.process('AuthService');

    expect(result.transliterated).toBe('AuthService');
    expect(result.changed).toBe(false);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  test('handles Unicode normalization', () => {
    // Composed vs decomposed forms should give same result
    const composed = 'café'; // é as single character
    const decomposed = 'café'; // e + combining acute

    expect(removeDiacritics(composed)).toBe(removeDiacritics(decomposed));
  });

  test('handles very long strings', () => {
    const longString = 'тест '.repeat(1000);
    const result = transliterate(longString);
    expect(result.length).toBe(longString.length);
  });

  test('handles special characters mixed with Cyrillic', () => {
    expect(transliterate('тест@email.com')).toBe('test@email.com');
    expect(transliterate('сервис (версия 1.0)')).toBe('servis (versiya 1.0)');
  });
});
