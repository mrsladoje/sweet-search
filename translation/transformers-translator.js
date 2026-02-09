/**
 * Transformers.js Local Translator - T3 Last Resort Fallback
 *
 * Uses NLLB-200 for local CPU translation without API keys.
 * LAZY-LOADED: Only initializes when actually needed (Cerebras + Ollama unavailable).
 *
 * Performance:
 * - First load: ~1-3s (model download + init) - happens ONLY when needed
 * - Warm inference: ~100-500ms (CPU via WASM)
 * - Memory: ~300-600MB for model weights (loaded on demand)
 *
 * Strategy:
 * - T1 (transliteration) and T2 (dictionary) handle 95%+ of queries in <0.1ms
 * - Cerebras (cloud) handles most T3 cases in 50-100ms
 * - Ollama (local) is second T3 choice at 200-500ms
 * - Transformers.js is LAST RESORT when Cerebras/Ollama unavailable
 * - Once loaded, stays warm for subsequent translations
 *
 * Model: Xenova/nllb-200-distilled-600M (ONNX quantized)
 * Languages: 200+ including Serbian, Russian, Chinese, Japanese, German
 *
 * @module translation/transformers-translator
 */

import { normalizeNFC } from '../training/features/unicode-utils.js';
import {
  TRANSLATION_CONFIG,
  getTranslationLocalModel,
  isQuietMode,
  LOGGING,
} from '../core/config.js';
import { detectLanguage, toNLLBCode, detectLatinLanguage } from './language-detector.js';

/**
 * TransformersTranslator - Local translation using Transformers.js
 */
export class TransformersTranslator {
  constructor(options = {}) {
    // Get model config from TRANSLATION_CONFIG or fallback to defaults
    const modelConfig = getTranslationLocalModel?.(options.modelKey) || {
      model: 'Xenova/nllb-200-distilled-600M',
      device: 'cpu',
      quantized: true,
      type: 'translation',
    };

    this.modelKey = options.modelKey || TRANSLATION_CONFIG?.localModel || 'nllb-200';
    this.model = options.model || modelConfig.model || 'Xenova/nllb-200-distilled-600M';
    this.device = options.device || modelConfig.device || 'cpu';
    this.quantized = options.quantized ?? modelConfig.quantized ?? true;
    this.pipelineType = modelConfig.type || 'translation';

    this.pipeline = null;
    this.loading = null;
    this.initialized = false;
    this.initLatency = 0;
  }

  /**
   * Initialize the translation pipeline
   * Call this at session start to preheat
   */
  async init() {
    if (this.initialized) return;
    if (this.loading) return this.loading;

    const start = performance.now();

    this.loading = (async () => {
      try {
        let transformersModule;
        try {
          transformersModule = await import('@huggingface/transformers');
        } catch {
          transformersModule = await import('@xenova/transformers');
        }
        const { pipeline } = transformersModule;

        this.pipeline = await pipeline(this.pipelineType, this.model, {
          device: this.device,
          dtype: this.quantized ? 'q8' : 'fp32',
        });

        this.initLatency = Math.round(performance.now() - start);
        this.initialized = true;

        if (!isQuietMode() && LOGGING?.verbose) {
          console.log(`[TransformersTranslator] Loaded ${this.model} in ${this.initLatency}ms`);
        }
      } catch (err) {
        if (!isQuietMode()) {
          console.error(`[TransformersTranslator] Failed to load: ${err.message}`);
        }
        throw err;
      }
    })();

    return this.loading;
  }

  /**
   * Check if the translator is ready
   */
  isReady() {
    return this.initialized && this.pipeline !== null;
  }

  /**
   * Detect source language from text
   * Uses detectLatinLanguage() first for Latin-script languages with diacritics,
   * then falls back to detectLanguage() for other scripts.
   */
  detectSourceLanguage(text) {
    if (!text) return 'eng_Latn';

    // First: try Latin-script language detection via diacritics
    // This catches German (ä,ö,ü,ß), French (ç,è,ê), Spanish (ñ,¿,¡), etc.
    const latinLang = detectLatinLanguage(text);
    if (latinLang) {
      return latinLang;  // Already in NLLB format (e.g., 'deu_Latn')
    }

    // Fallback: use general script detection
    const result = detectLanguage(text);
    return toNLLBCode(result.language);
  }

  /**
   * Translate text to English
   *
   * @param {string} text - Text to translate
   * @param {string} [srcLang] - Source language code (auto-detected if not provided)
   * @returns {Promise<{translation: string, latency_ms: number, srcLang: string}>}
   */
  async translate(text, srcLang = null) {
    if (!this.initialized) {
      await this.init();
    }

    if (!text || text.trim().length === 0) {
      return {
        translation: text,
        latency_ms: 0,
        srcLang: 'eng_Latn',
        skipped: true,
      };
    }

    const detectedLang = srcLang || this.detectSourceLanguage(text);

    // Skip if already English
    if (detectedLang === 'eng_Latn') {
      return {
        translation: text,
        latency_ms: 0,
        srcLang: 'eng_Latn',
        skipped: true,
      };
    }

    const start = performance.now();

    try {
      const result = await this.pipeline(text, {
        src_lang: detectedLang,
        tgt_lang: 'eng_Latn',
        max_length: 100,
      });

      const translation = result[0]?.translation_text || text;
      const latency_ms = Math.round(performance.now() - start);

      return {
        translation: normalizeNFC(translation),
        latency_ms,
        srcLang: detectedLang,
        skipped: false,
        provider: 'transformers.js',
        model: this.model,
      };
    } catch (err) {
      if (!isQuietMode()) {
        console.error(`[TransformersTranslator] Translation error: ${err.message}`);
      }
      return {
        translation: text,
        latency_ms: Math.round(performance.now() - start),
        srcLang: detectedLang,
        error: err.message,
        skipped: true,
      };
    }
  }

  /**
   * Process for pipeline integration
   */
  async process(query) {
    const result = await this.translate(query);
    return {
      original: query,
      translation: result.translation,
      provider: result.provider || 'transformers.js',
      skipped: result.skipped || false,
      latency_ms: result.latency_ms,
      srcLang: result.srcLang,
    };
  }

  /**
   * Get initialization stats
   */
  getStats() {
    return {
      initialized: this.initialized,
      model: this.model,
      device: this.device,
      quantized: this.quantized,
      initLatency: this.initLatency,
    };
  }
}

/**
 * Singleton instance - lazy loaded, stays warm once used
 */
let sharedInstance = null;

/**
 * Get or create shared translator instance
 * Does NOT initialize - call translate() to trigger lazy init
 */
export function getTransformersTranslator(options = {}) {
  if (!sharedInstance) {
    sharedInstance = new TransformersTranslator(options);
  }
  return sharedInstance;
}

/**
 * Check if translator is loaded (for conditional use)
 */
export function isTransformersLoaded() {
  return sharedInstance?.isReady() ?? false;
}

/**
 * Unload model to free memory (optional cleanup)
 */
export function unloadTransformers() {
  if (sharedInstance) {
    sharedInstance.pipeline = null;
    sharedInstance.initialized = false;
    sharedInstance = null;
    if (!isQuietMode() && LOGGING?.verbose) {
      console.log('[TransformersTranslator] Model unloaded, memory freed');
    }
  }
}

export default TransformersTranslator;
