/**
 * Unit Tests for OPUS-MT Local Translator
 *
 * Tests routing, fallback, identifier protection, lazy-loading,
 * and concurrent deduplication.
 *
 * Reference: docs/TRANSLATION_FIX_PLAN.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OpusMTTranslator,
  OPUS_MODEL_ROUTES,
  OPUS_FALLBACK_MODEL,
  protectIdentifiers,
  restoreIdentifiers,
} from '../../translation/opus-mt-translator.js';

// =============================================================================
// MODEL ROUTING
// =============================================================================

describe('OPUS Model Routing', () => {
  it('routes Romance languages to ROMANCE-en', () => {
    const romance = ['es', 'fr', 'it', 'pt', 'ro'];
    for (const lang of romance) {
      expect(OPUS_MODEL_ROUTES[lang]).toBe('Xenova/opus-mt-ROMANCE-en');
    }
  });

  it('routes individual languages to pair models', () => {
    expect(OPUS_MODEL_ROUTES.ru).toBe('Xenova/opus-mt-ru-en');
    expect(OPUS_MODEL_ROUTES.uk).toBe('Xenova/opus-mt-uk-en');
    expect(OPUS_MODEL_ROUTES.de).toBe('Xenova/opus-mt-de-en');
    expect(OPUS_MODEL_ROUTES.pl).toBe('Xenova/opus-mt-pl-en');
    expect(OPUS_MODEL_ROUTES.cs).toBe('Xenova/opus-mt-cs-en');
    expect(OPUS_MODEL_ROUTES.zh).toBe('Xenova/opus-mt-zh-en');
    expect(OPUS_MODEL_ROUTES.ja).toBe('Xenova/opus-mt-ja-en');
    expect(OPUS_MODEL_ROUTES.ko).toBe('Xenova/opus-mt-ko-en');
    expect(OPUS_MODEL_ROUTES.ar).toBe('Xenova/opus-mt-ar-en');
    expect(OPUS_MODEL_ROUTES.hi).toBe('Xenova/opus-mt-hi-en');
    expect(OPUS_MODEL_ROUTES.th).toBe('Xenova/opus-mt-th-en');
  });

  it('returns undefined for unsupported languages (route to mul-en)', () => {
    expect(OPUS_MODEL_ROUTES.bg).toBeUndefined();
    expect(OPUS_MODEL_ROUTES.he).toBeUndefined();
    expect(OPUS_MODEL_ROUTES.bn).toBeUndefined();
    expect(OPUS_MODEL_ROUTES.ta).toBeUndefined();
    expect(OPUS_MODEL_ROUTES.sr).toBeUndefined();
    expect(OPUS_MODEL_ROUTES.el).toBeUndefined();
  });

  it('has correct fallback model', () => {
    expect(OPUS_FALLBACK_MODEL).toBe('Xenova/opus-mt-mul-en');
  });

  it('covers exactly 16 verified language routes', () => {
    expect(Object.keys(OPUS_MODEL_ROUTES)).toHaveLength(16);
  });

  it('uses exactly 12 unique models (11 pairs + 1 family)', () => {
    const uniqueModels = new Set(Object.values(OPUS_MODEL_ROUTES));
    expect(uniqueModels.size).toBe(12);
  });
});

// =============================================================================
// IDENTIFIER PROTECTION
// =============================================================================

describe('Identifier Protection (strip-based)', () => {
  it('strips PascalCase identifiers from text', () => {
    const { nlText, identifiers } = protectIdentifiers('аутентификация AuthService');
    expect(nlText).toBe('аутентификация');
    expect(identifiers).toEqual(['AuthService']);
  });

  it('strips camelCase identifiers', () => {
    const { nlText, identifiers } = protectIdentifiers('метод getUserById');
    expect(nlText).toBe('метод');
    expect(identifiers).toEqual(['getUserById']);
  });

  it('strips snake_case identifiers', () => {
    const { identifiers } = protectIdentifiers('функция auth_service');
    expect(identifiers).toEqual(['auth_service']);
  });

  it('strips SCREAMING_CASE identifiers', () => {
    const { identifiers } = protectIdentifiers('константа AUTH_SERVICE');
    expect(identifiers).toEqual(['AUTH_SERVICE']);
  });

  it('strips dotted paths', () => {
    const { identifiers } = protectIdentifiers('файл config.js');
    expect(identifiers).toEqual(['config.js']);
  });

  it('strips multiple identifiers', () => {
    const { nlText, identifiers } = protectIdentifiers('аутентификация AuthService getUserById');
    expect(nlText).toBe('аутентификация');
    expect(identifiers).toEqual(['AuthService', 'getUserById']);
  });

  it('keeps non-ASCII tokens as natural language', () => {
    const { nlText, identifiers } = protectIdentifiers('аутентификация сервис');
    expect(identifiers).toHaveLength(0);
    expect(nlText).toBe('аутентификация сервис');
  });

  it('strips UPPER+lower identifiers like XMLParser', () => {
    expect(protectIdentifiers('парсер XMLParser').identifiers).toEqual(['XMLParser']);
    expect(protectIdentifiers('элемент HTMLElement').identifiers).toEqual(['HTMLElement']);
    expect(protectIdentifiers('ответ JSONResponse').identifiers).toEqual(['JSONResponse']);
  });

  it('does not strip short tokens', () => {
    const { identifiers } = protectIdentifiers('a b c');
    expect(identifiers).toHaveLength(0);
  });

  it('handles empty input', () => {
    const { nlText, identifiers } = protectIdentifiers('');
    expect(nlText).toBe('');
    expect(identifiers).toHaveLength(0);
  });
});

describe('Identifier Restoration (append-based)', () => {
  it('appends identifiers to translated text', () => {
    const result = restoreIdentifiers('authentication', ['AuthService']);
    expect(result).toBe('authentication AuthService');
  });

  it('appends multiple identifiers', () => {
    const result = restoreIdentifiers('authentication', ['AuthService', 'getUserById']);
    expect(result).toBe('authentication AuthService getUserById');
  });

  it('returns text unchanged when no identifiers', () => {
    expect(restoreIdentifiers('no identifiers here', [])).toBe('no identifiers here');
  });

  it('returns identifiers alone when NL is empty', () => {
    expect(restoreIdentifiers('', ['AuthService'])).toBe('AuthService');
  });

  it('roundtrips protect → translate → restore', () => {
    const { nlText, identifiers } = protectIdentifiers('аутентификация AuthService getUserById config.js');
    // Simulate translation of NL portion only
    const translated = nlText.replace('аутентификация', 'authentication');
    const restored = restoreIdentifiers(translated, identifiers);
    expect(restored).toBe('authentication AuthService getUserById config.js');
  });
});

// =============================================================================
// TRANSLATOR CLASS (with mocked pipelines)
// =============================================================================

describe('OpusMTTranslator', () => {
  let translator;

  beforeEach(() => {
    translator = new OpusMTTranslator();
  });

  afterEach(() => {
    translator.unloadAll();
  });

  it('resolves known languages to correct models', () => {
    expect(translator._resolveModel('ru')).toBe('Xenova/opus-mt-ru-en');
    expect(translator._resolveModel('fr')).toBe('Xenova/opus-mt-ROMANCE-en');
    expect(translator._resolveModel('zh')).toBe('Xenova/opus-mt-zh-en');
  });

  it('returns null for unsupported languages', () => {
    expect(translator._resolveModel('bg')).toBeNull();
    expect(translator._resolveModel('sr')).toBeNull();
    expect(translator._resolveModel('he')).toBeNull();
  });

  it('skips empty text', async () => {
    const result = await translator.translate('');
    expect(result.skipped).toBe(true);
    expect(result.latency_ms).toBe(0);
    expect(result.provider).toBe('opus-mt');
  });

  it('skips null text', async () => {
    const result = await translator.translate(null);
    expect(result.skipped).toBe(true);
  });

  it('skips high-confidence English text', async () => {
    const result = await translator.translate('authentication service');
    expect(result.skipped).toBe(true);
    expect(result.srcLang).toBe('en');
  });

  it('detects pure ASCII German via franc trigram and routes to de-en', async () => {
    // "Mitarbeiter" has no diacritics but franc detects 'deu' → de → de-en
    const dePipeline = vi.fn(async () => [{ translation_text: 'employee' }]);
    translator._pipelines.set('Xenova/opus-mt-de-en', dePipeline);

    const result = await translator.translate('Mitarbeiter');
    expect(result.skipped).toBe(false);
    expect(result.model).toBe('Xenova/opus-mt-de-en');
  });

  it('routes Latin-script text with unique diacritics to pair model', async () => {
    // "español" has ñ → spa_Latn → es → ROMANCE-en
    const romancePipeline = vi.fn(async () => [{ translation_text: 'spanish' }]);
    translator._pipelines.set('Xenova/opus-mt-ROMANCE-en', romancePipeline);

    const result = await translator.translate('español');
    expect(result.skipped).toBe(false);
    expect(result.model).toBe('Xenova/opus-mt-ROMANCE-en');
  });

  it('routes Latin text with non-unique diacritics to mul-en', async () => {
    // "autenticación" has ó which is not in any specific language pattern,
    // but IS non-ASCII → detected as non-English Latin → routes to mul-en
    const mulPipeline = vi.fn(async () => [{ translation_text: 'authentication' }]);
    translator._pipelines.set('Xenova/opus-mt-mul-en', mulPipeline);

    const result = await translator.translate('autenticación');
    expect(result.skipped).toBe(false);
    expect(result.model).toBe('Xenova/opus-mt-mul-en');
  });

  it('routes Italian with non-unique diacritics to mul-en', async () => {
    // "ripristino stato iniziale" is pure ASCII → skipped (known limitation)
    // But "perché" has é → non-ASCII → mul-en
    const mulPipeline = vi.fn(async () => [{ translation_text: 'because' }]);
    translator._pipelines.set('Xenova/opus-mt-mul-en', mulPipeline);

    const result = await translator.translate('perché');
    expect(result.skipped).toBe(false);
    expect(result.model).toBe('Xenova/opus-mt-mul-en');
  });

  it('detects German diacritics and routes to de-en', async () => {
    const dePipeline = vi.fn(async () => [{ translation_text: 'size' }]);
    translator._pipelines.set('Xenova/opus-mt-de-en', dePipeline);

    // "Größe" has ö → deu_Latn → de → de-en
    const result = await translator.translate('Größe');
    expect(result.skipped).toBe(false);
    expect(result.model).toBe('Xenova/opus-mt-de-en');
  });

  it('detects French diacritics and routes to ROMANCE-en', async () => {
    const romancePipeline = vi.fn(async () => [{ translation_text: 'boy' }]);
    translator._pipelines.set('Xenova/opus-mt-ROMANCE-en', romancePipeline);

    // "garçon" has ç → fra_Latn → fr → ROMANCE-en
    const result = await translator.translate('garçon');
    expect(result.skipped).toBe(false);
    expect(result.model).toBe('Xenova/opus-mt-ROMANCE-en');
  });

  it('skips actual English text (pure ASCII → stays en)', async () => {
    const result = await translator.translate('authentication');
    expect(result.skipped).toBe(true);
    expect(result.srcLang).toBe('en');
  });

  it('detects pure ASCII Italian via franc trigram and routes to ROMANCE-en', async () => {
    // "ripristino stato iniziale" — franc detects 'ita' → it → ROMANCE-en
    const romancePipeline = vi.fn(async () => [{ translation_text: 'restore initial state' }]);
    translator._pipelines.set('Xenova/opus-mt-ROMANCE-en', romancePipeline);

    const result = await translator.translate('ripristino stato iniziale');
    expect(result.skipped).toBe(false);
    expect(result.model).toBe('Xenova/opus-mt-ROMANCE-en');
  });

  it('skips very short pure ASCII (franc returns und)', async () => {
    // "auth" is 4 chars — too short for trigram detection → stays en → skipped
    const result = await translator.translate('auth');
    expect(result.skipped).toBe(true);
  });

  it('skips ambiguous English phrases (franc gap too small)', async () => {
    // These are English phrases that franc misclassifies as other languages
    // with near-tied scores. The confidence gate rejects them.
    for (const q of ['state reset', 'initial state restore', 'hello world']) {
      const result = await translator.translate(q);
      expect(result.skipped).toBe(true);
    }
  });

  it('skips "controller auth service" (franc false positive for French)', async () => {
    const result = await translator.translate('controller auth service');
    expect(result.skipped).toBe(true);
  });

  it('starts with empty stats', () => {
    const stats = translator.getStats();
    expect(stats.translations).toBe(0);
    expect(stats.fallbacks).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.loadedModels).toHaveLength(0);
    expect(stats.loadingModels).toHaveLength(0);
  });

  it('unloadAll clears all state', () => {
    // Manually insert a fake entry to verify clearing
    translator._pipelines.set('fake-model', {});
    expect(translator._pipelines.size).toBe(1);
    translator.unloadAll();
    expect(translator._pipelines.size).toBe(0);
  });

  it('unload removes specific model', () => {
    translator._pipelines.set('model-a', {});
    translator._pipelines.set('model-b', {});
    translator.unload('model-a');
    expect(translator._pipelines.has('model-a')).toBe(false);
    expect(translator._pipelines.has('model-b')).toBe(true);
  });

  it('process() returns correct shape', async () => {
    const result = await translator.process('hello world');
    expect(result).toHaveProperty('original', 'hello world');
    expect(result).toHaveProperty('translation');
    expect(result).toHaveProperty('provider');
    expect(result).toHaveProperty('skipped');
    expect(result).toHaveProperty('latency_ms');
    expect(result).toHaveProperty('srcLang');
  });
});

// =============================================================================
// PIPELINE LOADING (mocked Transformers.js)
// =============================================================================

describe('OpusMTTranslator pipeline loading', () => {
  let translator;
  let mockPipeline;

  beforeEach(() => {
    translator = new OpusMTTranslator();
    mockPipeline = vi.fn(async () => [{ translation_text: 'translated text' }]);
  });

  afterEach(() => {
    translator.unloadAll();
  });

  it('caches loaded pipelines', async () => {
    // Manually inject a pipeline
    translator._pipelines.set('Xenova/opus-mt-ru-en', mockPipeline);

    const pipe = await translator._loadPipeline('Xenova/opus-mt-ru-en');
    expect(pipe).toBe(mockPipeline);
  });

  it('deduplicates concurrent loads for same model', async () => {
    // Create a slow loading promise
    let resolveLoad;
    const slowLoad = new Promise(resolve => { resolveLoad = resolve; });
    translator._loading.set('test-model', slowLoad);

    // Both calls should resolve to the same value
    const p1 = translator._loadPipeline('test-model');
    const p2 = translator._loadPipeline('test-model');

    resolveLoad(mockPipeline);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it('translates non-English text using cached pipeline', async () => {
    // Inject mock pipeline for Russian
    translator._pipelines.set('Xenova/opus-mt-ru-en', mockPipeline);

    const result = await translator.translate('привет мир');
    expect(result.skipped).toBe(false);
    expect(result.translation).toBe('translated text');
    expect(result.model).toBe('Xenova/opus-mt-ru-en');
    expect(result.provider).toBe('opus-mt');
    expect(result.srcLang).toBe('ru');
  });

  it('does NOT add prefix for pair models (e.g. ru-en)', async () => {
    translator._pipelines.set('Xenova/opus-mt-ru-en', mockPipeline);

    await translator.translate('привет мир');
    // Pair model: text should be passed WITHOUT >>rus<< prefix
    const calledWith = mockPipeline.mock.calls[0][0];
    expect(calledWith).not.toContain('>>');
    expect(calledWith).toContain('привет мир');
  });

  it('does NOT add prefix for ROMANCE-en (Xenova model echoes it)', async () => {
    const capturePipeline = vi.fn(async (text) => [{ translation_text: 'translated' }]);
    translator._pipelines.set('Xenova/opus-mt-ROMANCE-en', capturePipeline);

    await translator.translate('servicio de autenticación', { srcLang: 'es' });
    const calledWith = capturePipeline.mock.calls[0][0];
    expect(calledWith).not.toContain('>>');
  });

  it('adds >>lang<< prefix for mul-en fallback', async () => {
    const capturePipeline = vi.fn(async (text) => [{ translation_text: 'translated' }]);
    translator._pipelines.set('Xenova/opus-mt-mul-en', capturePipeline);

    // Greek → no pair model → mul-en with >>ell<< prefix
    await translator.translate('γεια σου κόσμε');
    const calledWith = capturePipeline.mock.calls[0][0];
    expect(calledWith).toMatch(/^>>ell<< /);
  });

  it('falls back to mul-en when primary model fails', async () => {
    const failPipeline = vi.fn(async () => { throw new Error('model not found'); });
    const mulPipeline = vi.fn(async () => [{ translation_text: 'mul fallback' }]);

    translator._pipelines.set('Xenova/opus-mt-ru-en', failPipeline);
    translator._pipelines.set('Xenova/opus-mt-mul-en', mulPipeline);

    const result = await translator.translate('привет мир');
    expect(result.translation).toBe('mul fallback');
    expect(result.model).toBe('Xenova/opus-mt-mul-en');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].success).toBe(false);
    expect(result.attempts[1].success).toBe(true);
  });

  it('returns original when all models fail', async () => {
    const failPipeline = vi.fn(async () => { throw new Error('model not found'); });

    translator._pipelines.set('Xenova/opus-mt-ru-en', failPipeline);
    translator._pipelines.set('Xenova/opus-mt-mul-en', failPipeline);

    const result = await translator.translate('привет мир');
    expect(result.translation).toBe('привет мир');
    expect(result.skipped).toBe(true);
    expect(result.error).toContain('All OPUS-MT models failed');
  });

  it('unsupported language goes directly to mul-en', async () => {
    const mulPipeline = vi.fn(async () => [{ translation_text: 'greek translated' }]);
    translator._pipelines.set('Xenova/opus-mt-mul-en', mulPipeline);

    // Greek is not in OPUS_MODEL_ROUTES, should go to mul-en
    const result = await translator.translate('γεια σου κόσμε');
    expect(result.model).toBe('Xenova/opus-mt-mul-en');
    expect(result.attempts).toHaveLength(1);
  });

  it('preserves identifiers by stripping before MT and appending after', async () => {
    const mockTranslate = vi.fn(async (text) => {
      // Model only sees the NL portion (identifiers are stripped)
      expect(text).not.toContain('AuthService');
      return [{ translation_text: 'authentication' }];
    });
    translator._pipelines.set('Xenova/opus-mt-ru-en', mockTranslate);

    const result = await translator.translate('аутентификация AuthService');
    expect(result.translation).toContain('AuthService');
    expect(result.translation).toContain('authentication');
  });

  it('tracks translation stats', async () => {
    translator._pipelines.set('Xenova/opus-mt-ru-en', mockPipeline);

    await translator.translate('привет');
    await translator.translate('мир');

    const stats = translator.getStats();
    expect(stats.translations).toBe(2);
  });

  it('tracks fallback stats', async () => {
    const failPipeline = vi.fn(async () => { throw new Error('fail'); });
    translator._pipelines.set('Xenova/opus-mt-ru-en', failPipeline);
    translator._pipelines.set('Xenova/opus-mt-mul-en', mockPipeline);

    await translator.translate('привет');

    const stats = translator.getStats();
    expect(stats.fallbacks).toBe(1);
    expect(stats.errors).toBe(1);
  });
});

// =============================================================================
// SINGLETON
// =============================================================================

describe('Singleton exports', () => {
  it('getOpusMTTranslator returns same instance', async () => {
    const { getOpusMTTranslator, unloadOpusMT } = await import('../../translation/opus-mt-translator.js');
    const t1 = getOpusMTTranslator();
    const t2 = getOpusMTTranslator();
    expect(t1).toBe(t2);
    unloadOpusMT();
  });

  it('isOpusMTLoaded reflects state', async () => {
    const { getOpusMTTranslator, isOpusMTLoaded, unloadOpusMT } = await import('../../translation/opus-mt-translator.js');
    unloadOpusMT();
    expect(isOpusMTLoaded()).toBe(false);
    const translator = getOpusMTTranslator();
    // Still false - no models loaded yet
    expect(isOpusMTLoaded()).toBe(false);
    // Manually load a fake pipeline
    translator._pipelines.set('fake', {});
    expect(isOpusMTLoaded()).toBe(true);
    unloadOpusMT();
    expect(isOpusMTLoaded()).toBe(false);
  });
});

// =============================================================================
// LOCAL RESULT CACHING (via translateWithLLM)
// =============================================================================

describe('Local translation caching', () => {
  it('caches local result and returns from cache on second call', async () => {
    vi.resetModules();

    // Use a unique query to avoid collisions with disk cache from prior runs
    const uniqueQuery = `тест_кэша_${Date.now()}`;

    // Mock opus-mt-translator to return a predictable result
    vi.doMock('../../translation/opus-mt-translator.js', () => {
      const callCount = { n: 0 };
      const mockTranslator = {
        translate: vi.fn(async () => {
          callCount.n++;
          return {
            translation: 'cached-translation-result',
            latency_ms: 100,
            srcLang: 'ru',
            skipped: false,
            provider: 'opus-mt',
            model: 'Xenova/opus-mt-ru-en',
            attempts: [{ model: 'Xenova/opus-mt-ru-en', success: true }],
          };
        }),
      };
      return {
        getOpusMTTranslator: () => mockTranslator,
        _callCount: callCount,
      };
    });

    const { translateWithLLM } = await import('../../translation/llm-translator.js');
    const { _callCount } = await import('../../translation/opus-mt-translator.js');

    // First call: should hit the translator (unique query, never cached)
    const r1 = await translateWithLLM(uniqueQuery);
    expect(r1.translation).toBe('cached-translation-result');
    expect(r1.provider).toBe('local');
    expect(_callCount.n).toBe(1);

    // Second call: should come from cache (translator NOT called again)
    const r2 = await translateWithLLM(uniqueQuery);
    expect(r2.translation).toBe('cached-translation-result');
    expect(r2.fromCache).toBe(true);
    expect(_callCount.n).toBe(1); // Still 1 — cache hit, no second inference

    vi.doUnmock('../../translation/opus-mt-translator.js');
  });
});

// =============================================================================
// GLOBAL DISABLE
// =============================================================================

describe('SWEET_SEARCH_TRANSLATE=false disables translation', () => {
  it('TRANSLATION_CONFIG.isDisabled reflects env var', async () => {
    vi.resetModules();
    process.env.SWEET_SEARCH_TRANSLATE = 'false';
    const { TRANSLATION_CONFIG } = await import('../../core/config.js');
    expect(TRANSLATION_CONFIG.isDisabled).toBe(true);
    delete process.env.SWEET_SEARCH_TRANSLATE;
  });

  it('TRANSLATION_CONFIG.isDisabled is false by default', async () => {
    vi.resetModules();
    delete process.env.SWEET_SEARCH_TRANSLATE;
    const { TRANSLATION_CONFIG } = await import('../../core/config.js');
    expect(TRANSLATION_CONFIG.isDisabled).toBe(false);
  });
});
