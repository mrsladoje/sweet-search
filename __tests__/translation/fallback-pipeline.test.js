/**
 * Unit Tests for Translation Fallback Pipeline
 */

import { describe, test, expect, beforeAll } from 'vitest';
import {
  TranslationFallback,
  createFallbackPipeline,
  queryNeedsTranslation,
} from '../../translation/fallback-pipeline.js';

// =============================================================================
// UTILITY FUNCTION TESTS
// =============================================================================

describe('queryNeedsTranslation', () => {
  test('returns true for Cyrillic', () => {
    expect(queryNeedsTranslation('аутентификација')).toBe(true);
    expect(queryNeedsTranslation('сервис за аутентификацију')).toBe(true);
  });

  test('returns true for CJK', () => {
    expect(queryNeedsTranslation('认证服务')).toBe(true);
    expect(queryNeedsTranslation('認証の仕組み')).toBe(true);
  });

  test('returns false for English', () => {
    expect(queryNeedsTranslation('AuthService')).toBe(false);
    expect(queryNeedsTranslation('how does authentication work')).toBe(false);
  });

  test('returns false for mixed with identifier', () => {
    // Queries with ASCII identifiers might not need full translation
    expect(queryNeedsTranslation('AuthService')).toBe(false);
  });

  test('returns false for empty', () => {
    expect(queryNeedsTranslation('')).toBe(false);
    expect(queryNeedsTranslation(null)).toBe(false);
  });
});

// =============================================================================
// FALLBACK TRIGGER CONDITIONS
// =============================================================================

describe('Fallback Trigger Conditions', () => {
  let pipeline;

  beforeAll(async () => {
    pipeline = createFallbackPipeline();
    await pipeline.init();
  });

  test('triggers on empty results with non-ASCII query', () => {
    const results = [];
    const query = 'аутентификација';

    const shouldTrigger = pipeline.shouldTriggerFallback(results, query);
    expect(shouldTrigger).toBe(true);
  });

  test('triggers on low score with non-ASCII query', () => {
    const results = [{ score: 0.2 }];
    const query = 'аутентификација';

    const shouldTrigger = pipeline.shouldTriggerFallback(results, query);
    expect(shouldTrigger).toBe(true);
  });

  test('does not trigger on English query', () => {
    const results = [];
    const query = 'AuthService';

    const shouldTrigger = pipeline.shouldTriggerFallback(results, query);
    expect(shouldTrigger).toBe(false);
  });

  test('does not trigger with good results', () => {
    const results = [
      { score: 0.8, file: 'AuthService.java' },
      { score: 0.7, file: 'SecurityConfig.java' },
      { score: 0.6, file: 'LoginController.java' },
    ];
    const query = 'аутентификација';

    const shouldTrigger = pipeline.shouldTriggerFallback(results, query);
    expect(shouldTrigger).toBe(false);
  });

  test('triggers with results that have no valid file names', () => {
    // This catches garbage results from semantic search that have high scores
    // but no actual file/name attached (e.g., numerically similar embeddings)
    const results = [{ score: 0.8 }, { score: 0.7 }, { score: 0.6 }];
    const query = 'аутентификација';

    const shouldTrigger = pipeline.shouldTriggerFallback(results, query);
    expect(shouldTrigger).toBe(true);
  });

  test('respects translate=false option', () => {
    const results = [];
    const query = 'аутентификација';

    const shouldTrigger = pipeline.shouldTriggerFallback(results, query, { translate: 'false' });
    expect(shouldTrigger).toBe(false);
  });

  test('forces with translate=true option', () => {
    const results = [{ score: 0.9 }];
    const query = 'аутентификација';

    const shouldTrigger = pipeline.shouldTriggerFallback(results, query, { translate: 'true' });
    expect(shouldTrigger).toBe(true);
  });
});

// =============================================================================
// TRANSLATION PIPELINE TESTS
// =============================================================================

describe('Translation Pipeline', () => {
  let pipeline;

  beforeAll(async () => {
    pipeline = createFallbackPipeline({
      enableT3: false, // Disable LLM for unit tests
    });
    await pipeline.init();
  });

  test('translates Serbian concept via T1+T2', async () => {
    const result = await pipeline.translate('аутентификација');

    expect(result).toHaveProperty('original', 'аутентификација');
    expect(result).toHaveProperty('bestTranslation');
    expect(result).toHaveProperty('tier');
    expect(result).toHaveProperty('attempts');
    expect(result.changed).toBe(true);
  });

  test('uses T2 for known terms', async () => {
    const result = await pipeline.translate('аутентификација');

    // Should find via T2 alias lookup
    const t2Attempt = result.attempts.find(a => a.tier === 'T2');
    expect(t2Attempt).toBeDefined();
    expect(t2Attempt.output).toContain('authentication');
  });

  test('uses T1 for transliteration', async () => {
    const result = await pipeline.translate('КорисникСервис');

    // Should have T1 attempt
    const t1Attempt = result.attempts.find(a => a.tier === 'T1');
    expect(t1Attempt).toBeDefined();
    expect(t1Attempt.output).toBe('KorisnikServis');
  });

  test('generates search queries', async () => {
    const translationResult = await pipeline.translate('аутентификација');
    const queries = pipeline.getSearchQueries(translationResult);

    expect(Array.isArray(queries)).toBe(true);
    expect(queries.length).toBeGreaterThan(0);
  });

  test('handles unknown query gracefully', async () => {
    const result = await pipeline.translate('completely unknown text in english');

    expect(result.original).toBe('completely unknown text in english');
    // Should not change English text
    expect(result.changed).toBe(false);
  });
});

// =============================================================================
// T1 (TRANSLITERATION) TESTS
// =============================================================================

describe('T1 Transliteration in Pipeline', () => {
  let pipeline;

  beforeAll(async () => {
    pipeline = createFallbackPipeline({ enableT3: false });
    await pipeline.init();
  });

  test('T1 catches Serbian Cyrillic', async () => {
    const result = await pipeline.translate('КорисникСервис');

    const t1 = result.attempts.find(a => a.tier === 'T1');
    expect(t1).toBeDefined();
    expect(t1.output).toBe('KorisnikServis');
  });

  test('T1 catches Russian Cyrillic', async () => {
    const result = await pipeline.translate('СервисПользователя');

    const t1 = result.attempts.find(a => a.tier === 'T1');
    expect(t1).toBeDefined();
    expect(t1.output).toContain('Servis');
  });

  test('T1 skipped for Latin text', async () => {
    const result = await pipeline.translate('AuthService');

    const t1 = result.attempts.find(a => a.tier === 'T1');
    expect(t1).toBeUndefined();
  });
});

// =============================================================================
// T2 (ALIAS LOOKUP) TESTS
// =============================================================================

describe('T2 Alias Lookup in Pipeline', () => {
  let pipeline;

  beforeAll(async () => {
    pipeline = createFallbackPipeline({ enableT3: false });
    await pipeline.init();
  });

  test('T2 expands known concepts', async () => {
    const result = await pipeline.translate('аутентификација');

    const t2 = result.attempts.find(a => a.tier === 'T2');
    expect(t2).toBeDefined();
    expect(t2.expanded).toContain('authentication');
  });

  test('T2 expands known identifiers', async () => {
    const result = await pipeline.translate('АутСервис');

    const t2 = result.attempts.find(a => a.tier === 'T2');
    expect(t2).toBeDefined();
    expect(t2.expanded).toContain('AuthService');
  });

  test('T2 provides multiple search queries', async () => {
    const result = await pipeline.translate('аутентификација');

    const t2 = result.attempts.find(a => a.tier === 'T2');
    expect(t2?.searchQueries?.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// TIER SELECTION TESTS
// =============================================================================

describe('Best Translation Selection', () => {
  let pipeline;

  beforeAll(async () => {
    pipeline = createFallbackPipeline({ enableT3: false });
    await pipeline.init();
  });

  test('prefers T2 identifier matches', async () => {
    const result = await pipeline.translate('АутСервис');

    expect(result.tier).toBe('T2');
    expect(result.bestTranslation).toBe('AuthService');
  });

  test('uses T2 for concepts', async () => {
    const result = await pipeline.translate('аутентификација');

    expect(result.tier).toBe('T2');
    expect(result.bestTranslation).toContain('authentication');
  });

  test('falls back to T1 when T2 has no matches', async () => {
    // Use a term that only transliterates, not in dictionary
    const result = await pipeline.translate('НепознатаРеч');

    // Should have T1 transliteration
    const t1 = result.attempts.find(a => a.tier === 'T1');
    expect(t1).toBeDefined();
  });
});

// =============================================================================
// DISPLAY FORMATTING TESTS
// =============================================================================

describe('Display Formatting', () => {
  let pipeline;

  beforeAll(async () => {
    pipeline = createFallbackPipeline({ enableT3: false });
    await pipeline.init();
  });

  test('formatForDisplay returns null when unchanged', async () => {
    const result = await pipeline.translate('AuthService');

    const display = pipeline.formatForDisplay(result);
    expect(display).toBe(null);
  });

  test('formatForDisplay returns string when changed', async () => {
    const result = await pipeline.translate('аутентификација');

    const display = pipeline.formatForDisplay(result);
    expect(typeof display).toBe('string');
    expect(display).toContain('Translated');
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  let pipeline;

  beforeAll(async () => {
    pipeline = createFallbackPipeline({ enableT3: false });
    await pipeline.init();
  });

  test('handles mixed scripts', async () => {
    const result = await pipeline.translate('AuthService аутентификација');

    expect(result.changed).toBe(true);
    // Should preserve AuthService and translate the Cyrillic part
  });

  test('handles empty string', async () => {
    const result = await pipeline.translate('');

    expect(result.original).toBe('');
    expect(result.changed).toBe(false);
  });

  test('handles very long query', async () => {
    const longQuery = 'аутентификација '.repeat(50);
    const result = await pipeline.translate(longQuery);

    expect(result).toHaveProperty('original');
    expect(result).toHaveProperty('attempts');
  });

  test('handles special characters', async () => {
    const result = await pipeline.translate('аутентификација (тест)');

    expect(result.changed).toBe(true);
  });
});

// =============================================================================
// SOFT ENGLISH CHECK - CRITICAL BUG FIX
// =============================================================================

describe('Soft English Check - CRITICAL BUG FIX', () => {
  let pipeline;

  beforeAll(async () => {
    pipeline = createFallbackPipeline({ enableT3: false });
    await pipeline.init();
  });

  // CRITICAL TEST: This tests THE BUG FIX
  // ASCII queries with LOW confidence (could be German/French/etc.) + POOR results → trigger T3 LLM
  test('triggers translation for low-confidence ASCII when results are poor', () => {
    const query = 'Mitarbeiter';  // Pure ASCII German, isLikelyEnglish returns confidence=0.5
    const poorResults = [
      { file: 'unrelated.js', score: 0.1 },  // Low score, not enough results
    ];

    const shouldTranslate = pipeline.shouldTriggerFallback(poorResults, query);

    // With softEnglishCheck=true AND low confidence (0.5) AND poor results
    // → allow LLM to attempt translation (LLM can detect source language)
    expect(shouldTranslate).toBe(true);  // THE BUG FIX: now triggers!
  });

  test('skips translation for ASCII when results are good', () => {
    const query = 'authentication';  // English
    const goodResults = [
      { file: 'AuthService.java', score: 0.9 },
      { file: 'AuthController.java', score: 0.85 },
      { file: 'AuthConfig.java', score: 0.8 },
    ];

    const shouldTranslate = pipeline.shouldTriggerFallback(goodResults, query);
    expect(shouldTranslate).toBe(false);  // Good results skip translation
  });

  test('skips translation for non-ASCII when results are good', () => {
    const query = 'аутентификација';  // Serbian Cyrillic
    const goodResults = [
      { file: 'AuthService.java', score: 0.9 },
      { file: 'AuthController.java', score: 0.85 },
      { file: 'AuthConfig.java', score: 0.8 },
    ];

    const shouldTranslate = pipeline.shouldTriggerFallback(goodResults, query);
    // Good results skip translation - we found what we need
    expect(shouldTranslate).toBe(false);
  });

  test('triggers translation for low-confidence ASCII with poor results (German example)', () => {
    const query = 'Grosse';  // German "Größe" without umlaut, confidence=0.5
    const poorResults = [
      { file: 'unrelated.js', score: 0.1 },
    ];

    // Low confidence ASCII + poor results → trigger LLM translation
    const shouldTranslate = pipeline.shouldTriggerFallback(poorResults, query);
    expect(shouldTranslate).toBe(true);  // THE BUG FIX: now triggers!
  });

  test('triggers translation for Cyrillic with no results', () => {
    const query = 'аутентификација';
    const noResults = [];

    const shouldTranslate = pipeline.shouldTriggerFallback(noResults, query);
    expect(shouldTranslate).toBe(true);
  });

  test('triggers translation for CJK with no results', () => {
    const query = '認証サービス';
    const noResults = [];

    const shouldTranslate = pipeline.shouldTriggerFallback(noResults, query);
    expect(shouldTranslate).toBe(true);
  });

  test('forces translation with translate=true option (even for ASCII)', () => {
    const query = 'AuthService';  // Pure English ASCII
    const goodResults = [
      { file: 'AuthService.java', score: 0.9 },
    ];

    const shouldTranslate = pipeline.shouldTriggerFallback(goodResults, query, { translate: 'true' });
    expect(shouldTranslate).toBe(true);  // Force flag overrides all conditions
  });
});
