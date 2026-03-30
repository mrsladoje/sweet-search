/**
 * Native tokenizer wrapper — uses Rust `tokenizers` crate via napi-rs addon.
 *
 * Usage:
 *   import { createTokenizer } from './native-tokenizer.js';
 *   const tokenizer = await createTokenizer(tokenizerJsonPath);
 *   const result = tokenizer(text, { padding: true, truncation: true, max_length: 256 });
 *   // result.input_ids.data  → BigInt64Array
 *   // result.input_ids.dims  → [1, seq_len]
 *   // result.attention_mask.data → BigInt64Array
 */

import { existsSync } from 'fs';
import { resolveNativeAddon } from './native-resolver.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let _addon = null;
let _addonLoaded = false;

function loadAddon() {
  if (_addonLoaded) return _addon;
  _addonLoaded = true;
  try {
    const addonPath = resolveNativeAddon();
    if (addonPath) {
      const mod = require(addonPath);
      if (typeof mod.NativeTokenizer?.fromFile === 'function') {
        _addon = mod;
      }
    }
  } catch {
    // Native addon not available
  }
  return _addon;
}

/**
 * Create a tokenizer from a local tokenizer.json file via the native napi-rs addon.
 *
 * Throws if the native addon is unavailable or tokenizer.json is missing.
 * Callers (getLocalPipeline, FlashRank.init, LocalReranker._doInit) catch this
 * and fall back to API-based providers or keyword scoring. This is the intended
 * fallback behavior: local model paths require the native addon; platforms
 * without it degrade to remote inference.
 *
 * @param {string} tokenizerJsonPath - Absolute path to tokenizer.json
 * @returns {Function} Callable tokenizer: (text, opts) → { input_ids, attention_mask }
 * @throws {Error} If native addon is unavailable or tokenizer.json is missing
 */
export async function createTokenizer(tokenizerJsonPath) {
  if (!tokenizerJsonPath || !existsSync(tokenizerJsonPath)) {
    throw new Error(
      `[NativeTokenizer] tokenizer.json not found: ${tokenizerJsonPath || '(not provided)'}\n` +
      `  Run \`sweet-search init\` to download model files.`
    );
  }

  const addon = loadAddon();
  if (!addon) {
    throw new Error(
      `[NativeTokenizer] Native addon (@sweet-search/native-*) not available for this platform.\n` +
      `  Local model inference requires the native addon.\n` +
      `  Supported: darwin-arm64, darwin-x64, linux-x64-gnu, linux-arm64-gnu.\n` +
      `  Sweet Search will fall back to API-based providers.`
    );
  }

  try {
    const native = addon.NativeTokenizer.fromFile(tokenizerJsonPath);
    return createNativeWrapper(native);
  } catch (err) {
    throw new Error(
      `[NativeTokenizer] Failed to load tokenizer from ${tokenizerJsonPath}: ${err.message}`
    );
  }
}

/**
 * Wrap a NativeTokenizer instance to match the HF AutoTokenizer callable API.
 * HF tokenizer is called as: tokenizer(text, { padding, truncation, max_length, add_special_tokens })
 * Returns: { input_ids: { data: BigInt64Array, dims: [batch, seq] }, attention_mask: ... }
 */
function createNativeWrapper(native) {
  const wrapper = function tokenizer(textOrTexts, opts = {}) {
    const {
      padding = false,
      truncation = false,
      max_length = 512,
      add_special_tokens = true,
      text_pair,
    } = opts;

    const maxLen = truncation ? max_length : 1_000_000;

    // Pair encoding (cross-encoder reranker)
    if (text_pair !== undefined) {
      const texts = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
      const pairs = Array.isArray(text_pair) ? text_pair : [text_pair];
      // For now, handle single pair (reranker uses this pattern)
      const result = native.encodePair(texts[0], pairs[0], maxLen);
      return formatResult(result);
    }

    // Batch encoding
    if (Array.isArray(textOrTexts)) {
      const result = native.encodeBatch(textOrTexts, maxLen, add_special_tokens);
      return formatResult(result);
    }

    // Single encoding
    const result = native.encode(textOrTexts, maxLen, add_special_tokens);
    return formatResult(result);
  };

  // Expose underlying native tokenizer for direct access (e.g. tokenToId)
  wrapper._native = native;
  wrapper.isNative = true;

  return wrapper;
}

/**
 * Convert native TokenizeResult to HF-compatible format.
 * HF returns BigInt64Array data with .dims property.
 */
function formatResult(result) {
  const ids = BigInt64Array.from(result.inputIds.map(BigInt));
  const mask = BigInt64Array.from(result.attentionMask.map(BigInt));
  const typeIds = BigInt64Array.from(result.tokenTypeIds.map(BigInt));
  const dims = Array.from(result.dims);

  return {
    input_ids: { data: ids, dims, size: ids.length },
    attention_mask: { data: mask, dims, size: mask.length },
    token_type_ids: { data: typeIds, dims, size: typeIds.length },
  };
}
