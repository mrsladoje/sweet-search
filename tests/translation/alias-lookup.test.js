/**
 * Unit Tests for Alias Lookup (T2)
 */

import { describe, test, expect, beforeAll } from 'vitest';
import {
  AliasLookup,
  loadDictionary,
  buildReverseIndex,
  lookupTerm,
  lookupQuery,
  expandToEnglish,
  getTranslations,
} from '../../translation/alias-lookup.js';

// =============================================================================
// DICTIONARY LOADING TESTS
// =============================================================================

describe('Dictionary Loading', () => {
  test('loads dictionary successfully', () => {
    const dict = loadDictionary();

    expect(dict).toHaveProperty('version');
    expect(dict).toHaveProperty('identifiers');
    expect(dict).toHaveProperty('concepts');
  });

  test('dictionary has expected identifiers', () => {
    const dict = loadDictionary();

    expect(dict.identifiers).toHaveProperty('AuthService');
    expect(dict.identifiers).toHaveProperty('UserService');
    expect(dict.identifiers).toHaveProperty('EmployeeService');
  });

  test('dictionary has expected concepts', () => {
    const dict = loadDictionary();

    expect(dict.concepts).toHaveProperty('authentication');
    expect(dict.concepts).toHaveProperty('employee');
    expect(dict.concepts).toHaveProperty('session');
  });

  test('dictionary has Serbian translations', () => {
    const dict = loadDictionary();

    expect(dict.identifiers.AuthService.sr).toBeDefined();
    expect(dict.concepts.authentication.sr).toBeDefined();
  });
});

// =============================================================================
// REVERSE INDEX TESTS
// =============================================================================

describe('Reverse Index Building', () => {
  test('builds reverse index from dictionary', () => {
    const dict = loadDictionary();
    const reverse = buildReverseIndex(dict);

    expect(reverse).toBeInstanceOf(Map);
    expect(reverse.size).toBeGreaterThan(0);
  });

  test('reverse index contains Serbian terms', () => {
    const dict = loadDictionary();
    const reverse = buildReverseIndex(dict);

    // Check that Serbian authentication term is indexed
    expect(reverse.has('аутентификација')).toBe(true);
  });

  test('reverse index maps to correct English', () => {
    const dict = loadDictionary();
    const reverse = buildReverseIndex(dict);

    const matches = reverse.get('аутентификација');
    expect(matches).toBeDefined();
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some(m => m.english === 'authentication')).toBe(true);
  });
});

// =============================================================================
// TERM LOOKUP TESTS
// =============================================================================

describe('Term Lookup', () => {
  test('looks up Serbian authentication', () => {
    const matches = lookupTerm('аутентификација');

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].english).toBe('authentication');
    expect(matches[0].type).toBe('concept');
    expect(matches[0].lang).toBe('sr');
  });

  test('looks up Russian authentication', () => {
    const matches = lookupTerm('аутентификация');

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].english).toBe('authentication');
    expect(matches[0].lang).toBe('ru');
  });

  test('looks up Chinese authentication', () => {
    const matches = lookupTerm('认证');

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].english).toBe('authentication');
    expect(matches[0].lang).toBe('zh');
  });

  test('looks up identifier alias', () => {
    const matches = lookupTerm('АутСервис');

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].english).toBe('AuthService');
    expect(matches[0].type).toBe('identifier');
  });

  test('returns empty for unknown term', () => {
    const matches = lookupTerm('неизвестный');
    expect(matches).toEqual([]);
  });

  test('handles case insensitivity', () => {
    const upper = lookupTerm('АУТЕНТИФИКАЦИЈА');
    const lower = lookupTerm('аутентификација');

    expect(upper.length).toBe(lower.length);
  });
});

// =============================================================================
// QUERY LOOKUP TESTS
// =============================================================================

describe('Query Lookup', () => {
  test('expands full query', () => {
    const result = lookupQuery('сервис аутентификације');

    expect(result.expanded.length).toBeGreaterThan(0);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  test('handles mixed query with unchanged words', () => {
    const result = lookupQuery('аутентификација test');

    expect(result.expanded).toContain('authentication');
    expect(result.unchanged).toContain('test');
  });

  test('returns unchanged for unknown query', () => {
    const result = lookupQuery('completely unknown text');

    expect(result.expanded).toEqual([]);
    expect(result.unchanged.length).toBeGreaterThan(0);
  });

  test('handles empty query', () => {
    const result = lookupQuery('');

    expect(result.expanded).toEqual([]);
    expect(result.matches).toEqual([]);
    expect(result.unchanged).toEqual([]);
  });
});

// =============================================================================
// EXPAND TO ENGLISH TESTS
// =============================================================================

describe('Expand to English', () => {
  test('expands Serbian concept to English', () => {
    const result = expandToEnglish('аутентификација');
    expect(result).toBe('authentication');
  });

  test('expands Serbian identifier to English', () => {
    const result = expandToEnglish('АутСервис');
    expect(result).toBe('AuthService');
  });

  test('returns null for unknown term', () => {
    const result = expandToEnglish('unknown');
    expect(result).toBe(null);
  });

  test('combines multiple terms', () => {
    const result = expandToEnglish('сервис аутентификације');

    expect(result).toBeDefined();
    expect(result).not.toBe(null);
  });
});

// =============================================================================
// GET TRANSLATIONS TESTS
// =============================================================================

describe('Get Translations', () => {
  test('gets translations for authentication', () => {
    const translations = getTranslations('authentication');

    expect(translations.sr).toBeDefined();
    expect(translations.ru).toBeDefined();
    expect(translations.zh).toBeDefined();
    expect(translations.ja).toBeDefined();
  });

  test('gets translations for identifier', () => {
    const translations = getTranslations('AuthService', 'identifier');

    expect(translations.sr).toBeDefined();
    expect(Array.isArray(translations.sr)).toBe(true);
  });

  test('returns empty for unknown term', () => {
    const translations = getTranslations('UnknownService');
    expect(Object.keys(translations).length).toBe(0);
  });
});

// =============================================================================
// ALIAS LOOKUP CLASS TESTS
// =============================================================================

describe('AliasLookup Class', () => {
  let lookup;

  beforeAll(async () => {
    lookup = new AliasLookup();
    await lookup.init();
  });

  test('processes query correctly', () => {
    const result = lookup.process('аутентификација');

    expect(result).toHaveProperty('original', 'аутентификација');
    expect(result).toHaveProperty('expanded');
    expect(result).toHaveProperty('hasMatches', true);
    expect(result).toHaveProperty('matches');
  });

  test('generates search queries', () => {
    const queries = lookup.generateSearchQueries('аутентификација');

    expect(Array.isArray(queries)).toBe(true);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0]).toContain('authentication');
  });

  test('prefers identifiers when configured', () => {
    const lookupPreferIdent = new AliasLookup({ preferIdentifiers: true });
    const result = lookupPreferIdent.process('АутСервис');

    // First match should be identifier
    if (result.matches.length > 0) {
      expect(result.matches[0].type).toBe('identifier');
    }
  });

  test('handles query with no matches', () => {
    const result = lookup.process('completely unknown text');

    expect(result.hasMatches).toBe(false);
    expect(result.expanded).toEqual([]);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  test('handles null and undefined', () => {
    expect(lookupTerm(null)).toEqual([]);
    expect(lookupTerm(undefined)).toEqual([]);
    expect(lookupQuery(null)).toEqual({ expanded: [], matches: [], unchanged: [] });
  });

  test('handles special characters', () => {
    const result = lookupTerm('аутентификација!');
    // Should not find exact match due to punctuation
    expect(result.length).toBe(0);
  });

  test('handles multi-word concepts', () => {
    const matches = lookupTerm('праћење времена');

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].english).toBe('time tracking');
  });
});
