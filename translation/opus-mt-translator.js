/**
 * OPUS-MT Local Translator - Local-first T3 Translation
 *
 * Replaces broken NLLB-200 with verified OPUS-MT family/pair models.
 * Uses Transformers.js ONNX runtime for CPU-only local translation.
 *
 * Features:
 * - Lazy model loading (only loads when needed)
 * - Pipeline caching by model ID
 * - Concurrent load deduplication
 * - Language-to-model routing with family models
 * - Internal mul-en fallback
 * - Identifier protection (preserves code tokens through translation)
 * - Clean download/offline failure handling
 *
 * Model size: ~105-115MB per loaded model (int8 ONNX)
 *
 * @module translation/opus-mt-translator
 */

import { normalizeNFC } from '../training/features/unicode-utils.js';
import { detectLanguage, detectLatinLanguage } from './language-detector.js';
import { isQuietMode, LOGGING } from '../core/config.js';

// =============================================================================
// PHASE 0: VERIFIED MODEL MATRIX
// =============================================================================

/**
 * Verified Xenova OPUS-MT model routes.
 * Maps ISO 639-1 language codes to model IDs.
 * Only includes models verified to exist and load under Transformers.js.
 */
export const OPUS_MODEL_ROUTES = {
  // Romance family (single model for 5 languages)
  es: 'Xenova/opus-mt-ROMANCE-en',
  fr: 'Xenova/opus-mt-ROMANCE-en',
  it: 'Xenova/opus-mt-ROMANCE-en',
  pt: 'Xenova/opus-mt-ROMANCE-en',
  ro: 'Xenova/opus-mt-ROMANCE-en',

  // Individual verified pair models
  ru: 'Xenova/opus-mt-ru-en',
  uk: 'Xenova/opus-mt-uk-en',
  de: 'Xenova/opus-mt-de-en',
  pl: 'Xenova/opus-mt-pl-en',
  cs: 'Xenova/opus-mt-cs-en',
  zh: 'Xenova/opus-mt-zh-en',
  ja: 'Xenova/opus-mt-ja-en',
  ko: 'Xenova/opus-mt-ko-en',
  ar: 'Xenova/opus-mt-ar-en',
  hi: 'Xenova/opus-mt-hi-en',
  th: 'Xenova/opus-mt-th-en',
};

export const OPUS_FALLBACK_MODEL = 'Xenova/opus-mt-mul-en';

// =============================================================================
// SOURCE LANGUAGE PREFIXES (for multi-source Marian models)
// =============================================================================

/**
 * Family/multi-source models need a >>lang<< prefix.
 * Pair models (e.g. ru-en) do not.
 */
// Only mul-en uses the >>lang<< prefix. ROMANCE-en does NOT — the Xenova
// ONNX conversion echoes the prefix into output instead of consuming it.
const OPUS_NEEDS_PREFIX = new Set([
  'Xenova/opus-mt-mul-en',
]);

/** ISO 639-1 to ISO 639-3 mapping for OPUS-MT source prefixes. */
const ISO_639_3_MAP = {
  es: 'spa', fr: 'fra', it: 'ita', pt: 'por', ro: 'ron',
  ru: 'rus', uk: 'ukr', de: 'deu', pl: 'pol', cs: 'ces',
  zh: 'cmn', ja: 'jpn', ko: 'kor', ar: 'ara', hi: 'hin',
  th: 'tha', sr: 'srp', bg: 'bul', he: 'heb', bn: 'ben',
  ta: 'tam', el: 'ell', tr: 'tur', vi: 'vie',
};

function getSourcePrefix(modelId, langCode) {
  if (!OPUS_NEEDS_PREFIX.has(modelId)) return '';
  const code = ISO_639_3_MAP[langCode];
  return code ? `>>${code}<< ` : '';
}

/**
 * NLLB language code → ISO 639-1 for model routing.
 * detectLatinLanguage() returns NLLB codes (e.g. 'spa_Latn');
 * OPUS_MODEL_ROUTES uses ISO 639-1 (e.g. 'es').
 */
const NLLB_TO_ISO = {
  deu_Latn: 'de', spa_Latn: 'es', fra_Latn: 'fr', por_Latn: 'pt',
  pol_Latn: 'pl', ces_Latn: 'cs', ita_Latn: 'it', ron_Latn: 'ro',
};

/**
 * ISO 639-3 → ISO 639-1 for franc-min trigram detection results.
 * franc returns 3-letter codes; OPUS_MODEL_ROUTES uses 2-letter codes.
 */
const ISO_639_3_TO_1 = {
  deu: 'de', spa: 'es', fra: 'fr', por: 'pt', ita: 'it', ron: 'ro',
  rus: 'ru', ukr: 'uk', pol: 'pl', ces: 'cs', zho: 'zh', jpn: 'ja',
  kor: 'ko', ara: 'ar', hin: 'hi', tha: 'th', ell: 'el', heb: 'he',
  bul: 'bg', srp: 'sr', tur: 'tr', vie: 'vi', nld: 'nl', swe: 'sv',
  dan: 'da', nor: 'no', fin: 'fi', hun: 'hu', cat: 'ca', ind: 'id',
};

/**
 * Lazy-loaded franc-min trigram detector for pure ASCII language identification.
 * Uses francAll() with a confidence gate: only accepts the result when the
 * top language has a clear margin over the runner-up (gap > 0.25).
 * This prevents false positives on short English phrases like "state reset"
 * where franc incorrectly guesses Dutch/Romanian with near-tied scores.
 * Returns null if franc-min is not installed (optional dependency).
 */
const FRANC_MIN_GAP = 0.25;
let _francAllFn = undefined; // undefined = not yet attempted
async function detectWithFranc(text) {
  if (_francAllFn === null) return null; // previously failed to load
  if (_francAllFn === undefined) {
    try {
      const mod = await import('franc-min');
      _francAllFn = mod.francAll;
    } catch {
      _francAllFn = null; // not installed — degrade gracefully
      return null;
    }
  }
  const results = _francAllFn(text);
  if (!results || results.length < 2) return null;

  const [topLang, topScore] = results[0];
  const [, runnerUpScore] = results[1];

  // Reject if top result is undetermined.
  // English is also rejected implicitly because `eng` is not mapped below.
  if (!topLang || topLang === 'und') return null;

  // Confidence gate: require clear margin between #1 and #2.
  // Low gap = ambiguous (short English phrases get near-tied scores).
  // High gap = confident (actual non-English text stands out clearly).
  const gap = topScore - runnerUpScore;
  if (gap < FRANC_MIN_GAP) return null;

  return ISO_639_3_TO_1[topLang] || null;
}

// =============================================================================
// IDENTIFIER PROTECTION
// =============================================================================

/**
 * Check if a whitespace-delimited token looks like a code identifier.
 * Must be ASCII-only and match a naming convention pattern.
 */
function looksLikeCodeIdentifier(token) {
  if (!token || token.length < 2) return false;
  // Non-ASCII tokens aren't code identifiers
  if (/[^\x20-\x7E]/.test(token)) return false;
  // PascalCase or camelCase (letter case transition)
  if (/[a-z][A-Z]/.test(token)) return true;
  if (/^[A-Z][a-z]+[A-Z]/.test(token)) return true;
  // UPPER+lower like XMLParser, HTMLElement, JSONResponse
  if (/^[A-Z]{2,}[a-z]/.test(token)) return true;
  // snake_case or SCREAMING_CASE (underscore between word chars)
  if (/\w_\w/.test(token)) return true;
  // Dotted path (config.js, path.to.module)
  if (/\w\.\w/.test(token)) return true;
  return false;
}

/**
 * Separate code identifiers from natural language text.
 * Identifiers are STRIPPED (not replaced with placeholders) because
 * Marian tokenizers destroy placeholder formats like __ID_0__.
 * After translation, identifiers are appended back to the result.
 *
 * @param {string} text
 * @returns {{ nlText: string, identifiers: string[] }}
 */
export function protectIdentifiers(text) {
  const tokens = text.split(/(\s+)/);
  const nlParts = [];
  const identifiers = [];

  for (const token of tokens) {
    if (looksLikeCodeIdentifier(token)) {
      identifiers.push(token);
    } else {
      nlParts.push(token);
    }
  }

  return { nlText: nlParts.join('').trim(), identifiers };
}

/**
 * Combine translated natural language text with preserved identifiers.
 * @param {string} translatedNL - Translated natural language portion
 * @param {string[]} identifiers - Original code identifiers
 * @returns {string}
 */
export function restoreIdentifiers(translatedNL, identifiers) {
  if (identifiers.length === 0) return translatedNL;
  if (!translatedNL) return identifiers.join(' ');
  return [translatedNL, ...identifiers].join(' ');
}

// =============================================================================
// OPUS-MT TRANSLATOR CLASS
// =============================================================================

export class OpusMTTranslator {
  constructor() {
    /** @type {Map<string, object>} Loaded pipelines keyed by model ID */
    this._pipelines = new Map();
    /** @type {Map<string, Promise>} In-flight load promises for deduplication */
    this._loading = new Map();
    this._stats = {
      translations: 0,
      fallbacks: 0,
      errors: 0,
      firstLoadLatencies: {},
    };
  }

  /**
   * Resolve a language code to a verified OPUS model ID.
   * @param {string} langCode - ISO 639-1 code
   * @returns {string|null} Model ID or null if unsupported
   */
  _resolveModel(langCode) {
    return OPUS_MODEL_ROUTES[langCode] || null;
  }

  /**
   * Lazy-load a translation pipeline with concurrent deduplication.
   * @param {string} modelId - HuggingFace model identifier
   * @returns {Promise<object>} Loaded pipeline
   */
  async _loadPipeline(modelId) {
    if (this._pipelines.has(modelId)) {
      return this._pipelines.get(modelId);
    }

    // Deduplicate concurrent loads for the same model
    if (this._loading.has(modelId)) {
      return this._loading.get(modelId);
    }

    const loadPromise = (async () => {
      const start = performance.now();
      try {
        let transformersModule;
        try {
          transformersModule = await import('@huggingface/transformers');
        } catch {
          transformersModule = await import('@xenova/transformers');
        }
        const { pipeline: createPipeline } = transformersModule;

        const pipe = await createPipeline('translation', modelId, {
          device: 'cpu',
          dtype: 'q8',
        });

        this._pipelines.set(modelId, pipe);
        const latency = Math.round(performance.now() - start);
        this._stats.firstLoadLatencies[modelId] = latency;

        if (!isQuietMode() && LOGGING?.verbose) {
          process.stderr.write(`[OpusMT] Loaded ${modelId} in ${latency}ms\n`);
        }

        return pipe;
      } catch (err) {
        if (!isQuietMode() && LOGGING?.debug) {
          process.stderr.write(`[OpusMT] Failed to load ${modelId}: ${err.message}\n`);
        }
        throw err;
      } finally {
        this._loading.delete(modelId);
      }
    })();

    this._loading.set(modelId, loadPromise);
    return loadPromise;
  }

  /**
   * Translate text to English using OPUS-MT models.
   *
   * Routing: pair/family model -> mul-en -> fail
   * Identifiers are protected before translation and restored after.
   *
   * @param {string} text - Text to translate
   * @param {Object} [options]
   * @param {string} [options.srcLang] - Override source language detection
   * @returns {Promise<{translation: string, latency_ms: number, srcLang: string, skipped: boolean, provider: string, model?: string, attempts: Array}>}
   */
  async translate(text, options = {}) {
    if (!text || text.trim().length === 0) {
      return {
        translation: text, latency_ms: 0, skipped: true,
        provider: 'opus-mt', attempts: [],
      };
    }

    const start = performance.now();

    // Detect language — detectLanguage() returns 'en' for ALL Latin-script text.
    // Four-step Latin refinement:
    //  1. detectLatinLanguage() tries unique diacritics (ñ → es, ö → de, ç → fr)
    //  2. If no specific match but text has non-ASCII chars (ó, é, à) → mul-en
    //  3. Pure ASCII: franc-min trigram detection (Mitarbeiter → deu, ripristino → ita)
    //  4. If franc also returns und/eng → treat as English
    const detection = detectLanguage(text);
    let langCode = options.srcLang || detection.language;

    if (langCode === 'en' && detection.script === 'latin') {
      // Step 1: unique diacritics → specific language
      const latinLang = detectLatinLanguage(text);
      if (latinLang) {
        langCode = NLLB_TO_ISO[latinLang] || langCode;
      } else if (/[^\x00-\x7F]/.test(text)) {
        // Step 2: non-ASCII Latin chars → route to mul-en
        langCode = 'und';
      } else {
        // Step 3: pure ASCII — use franc-min trigram detection
        const francLang = await detectWithFranc(text);
        if (francLang && francLang !== 'en') {
          langCode = francLang;
        }
      }
    }

    // Skip if still English after all refinement steps.
    if (langCode === 'en') {
      return {
        translation: text, latency_ms: 0, srcLang: 'en',
        skipped: true, provider: 'opus-mt', attempts: [],
      };
    }

    // Strip code identifiers before MT (Marian tokenizers destroy placeholders).
    // Identifiers are appended back after translation.
    const { nlText, identifiers } = protectIdentifiers(text);

    // If the query is ALL identifiers (no natural language to translate), skip
    if (!nlText) {
      return {
        translation: text, latency_ms: Math.round(performance.now() - start),
        srcLang: langCode, skipped: true, provider: 'opus-mt', attempts: [],
      };
    }

    // Build model fallback chain: routed model -> mul-en
    const routedModel = this._resolveModel(langCode);
    const modelsToTry = routedModel
      ? [routedModel, OPUS_FALLBACK_MODEL]
      : [OPUS_FALLBACK_MODEL];

    // Deduplicate if routed model IS mul-en
    const uniqueModels = [...new Set(modelsToTry)];
    const attempts = [];

    for (const modelId of uniqueModels) {
      try {
        const pipe = await this._loadPipeline(modelId);

        // Add source language prefix for family/multi-source models
        const prefix = getSourcePrefix(modelId, langCode);
        const inputText = prefix + nlText;

        const result = await pipe(inputText, { max_length: 200 });
        const translated = result[0]?.translation_text || nlText;
        const restored = restoreIdentifiers(translated.trim(), identifiers);
        const latency_ms = Math.round(performance.now() - start);

        this._stats.translations++;
        if (modelId === OPUS_FALLBACK_MODEL && routedModel && routedModel !== OPUS_FALLBACK_MODEL) {
          this._stats.fallbacks++;
        }

        attempts.push({ model: modelId, success: true });

        return {
          translation: normalizeNFC(restored),
          latency_ms,
          srcLang: langCode,
          skipped: false,
          provider: 'opus-mt',
          model: modelId,
          attempts,
        };
      } catch (err) {
        attempts.push({ model: modelId, success: false, error: err.message });
        this._stats.errors++;

        if (!isQuietMode() && LOGGING?.debug) {
          process.stderr.write(`[OpusMT] ${modelId} failed: ${err.message}\n`);
        }
      }
    }

    // All models failed - return original text
    return {
      translation: text,
      latency_ms: Math.round(performance.now() - start),
      srcLang: langCode,
      skipped: true,
      error: 'All OPUS-MT models failed',
      provider: 'opus-mt',
      attempts,
    };
  }

  /**
   * Pipeline-compatible process method.
   * Matches TransformersTranslator.process() interface.
   */
  async process(query) {
    const result = await this.translate(query);
    return {
      original: query,
      translation: result.translation,
      provider: result.provider || 'opus-mt',
      skipped: result.skipped || false,
      latency_ms: result.latency_ms,
      srcLang: result.srcLang,
      model: result.model,
    };
  }

  /** Unload a specific model to free memory. */
  unload(modelId) {
    if (this._pipelines.has(modelId)) {
      this._pipelines.delete(modelId);
      if (!isQuietMode() && LOGGING?.verbose) {
        process.stderr.write(`[OpusMT] Unloaded ${modelId}\n`);
      }
    }
  }

  /** Unload all models to free memory. */
  unloadAll() {
    const count = this._pipelines.size;
    this._pipelines.clear();
    this._loading.clear();
    if (!isQuietMode() && LOGGING?.verbose) {
      process.stderr.write(`[OpusMT] Unloaded ${count} models\n`);
    }
  }

  /** Get translator statistics. */
  getStats() {
    return {
      ...this._stats,
      loadedModels: [...this._pipelines.keys()],
      loadingModels: [...this._loading.keys()],
    };
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let sharedInstance = null;

/** Get or create shared OpusMTTranslator instance. */
export function getOpusMTTranslator() {
  if (!sharedInstance) {
    sharedInstance = new OpusMTTranslator();
  }
  return sharedInstance;
}

/** Check if any OPUS-MT model is currently loaded. */
export function isOpusMTLoaded() {
  return sharedInstance !== null && sharedInstance._pipelines.size > 0;
}

/** Unload all models and destroy singleton. */
export function unloadOpusMT() {
  if (sharedInstance) {
    sharedInstance.unloadAll();
    sharedInstance = null;
  }
}

export default OpusMTTranslator;
