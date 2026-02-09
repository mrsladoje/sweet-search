/**
 * Unit Tests for Translation Config
 *
 * These tests validate the translation configuration system including
 * TRANSLATION_CONFIG, TRANSLATION_PROVIDERS, and TRANSLATION_LOCAL_MODELS.
 *
 * Reference: docs/TRANSLATION.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Translation Config', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clean up env vars
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.TRANSLATION_PROVIDER;
    delete process.env.TRANSLATION_LOCAL_MODEL;
    delete process.env.TRANSLATION_OFFLINE;
  });

  it('loads default config with no env vars', async () => {
    const { TRANSLATION_CONFIG, TRANSLATION_PROVIDERS, TRANSLATION_LOCAL_MODELS } = await import('../../core/config.js');

    expect(TRANSLATION_CONFIG).toBeDefined();
    expect(TRANSLATION_PROVIDERS).toBeDefined();
    expect(TRANSLATION_LOCAL_MODELS).toBeDefined();
    expect(TRANSLATION_CONFIG.prompts?.short).toContain('{query}');
    expect(TRANSLATION_CONFIG.cleaning?.enabled).toBe(true);
  });

  it('validates provider exists', async () => {
    const { getTranslationProvider } = await import('../../core/config.js');

    expect(getTranslationProvider('invalid')).toBeNull();
    expect(getTranslationProvider('cerebras')).toBeDefined();
  });

  it('validates local model exists', async () => {
    const { getTranslationLocalModel } = await import('../../core/config.js');

    expect(getTranslationLocalModel('invalid')).toBeNull();
    expect(getTranslationLocalModel('nllb-200')).toBeDefined();
  });

  it('has correct provider structure', async () => {
    const { TRANSLATION_PROVIDERS } = await import('../../core/config.js');

    // Check Cerebras provider
    expect(TRANSLATION_PROVIDERS.cerebras).toBeDefined();
    expect(TRANSLATION_PROVIDERS.cerebras.baseUrl).toBe('https://api.cerebras.ai/v1');
    expect(TRANSLATION_PROVIDERS.cerebras.endpoint).toBe('/chat/completions');

    // Check Groq provider
    expect(TRANSLATION_PROVIDERS.groq).toBeDefined();
    expect(TRANSLATION_PROVIDERS.groq.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('has correct local model structure', async () => {
    const { TRANSLATION_LOCAL_MODELS } = await import('../../core/config.js');

    expect(TRANSLATION_LOCAL_MODELS['nllb-200']).toBeDefined();
    expect(TRANSLATION_LOCAL_MODELS['nllb-200'].model).toBe('Xenova/nllb-200-distilled-600M');
    expect(TRANSLATION_LOCAL_MODELS['opus-mt']).toBeDefined();
  });

  it('isTranslationAvailable returns correct value', async () => {
    const { isTranslationAvailable } = await import('../../core/config.js');

    // Should be available because local models are always available
    expect(isTranslationAvailable()).toBe(true);
  });
});
