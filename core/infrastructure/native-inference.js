/**
 * Native Inference — candle-based FP32 embedding + late interaction inference.
 *
 * Provides native model wrappers that serve as drop-in replacements for the
 * ORT inference paths. Uses the napi-rs addon with Metal GPU acceleration on
 * Apple Silicon, CPU fallback elsewhere.
 *
 * Environment:
 *   SWEET_SEARCH_NATIVE_INFERENCE=0|1          — force disable/enable
 *   SWEET_SEARCH_INFERENCE_BACKEND=coreml      — SPIKE-only: route NomicBERT
 *                                                embed_batch through the CoreML
 *                                                Python bridge in scripts/spike-coreml/.
 *                                                Throwaway, NOT a production path.
 *   CANDLE_METAL_COMPUTE_PER_BUFFER=<N>        — candle default 50 (tuned)
 *   CANDLE_METAL_COMMAND_POOL_SIZE=<N>         — candle default 5 (tuned)
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import { resolveNativeAddon } from './native-resolver.js';
import { createTokenizer } from './native-tokenizer.js';
import { getModelCacheDir, fetchModel } from './model-fetcher.js';
import { getModelEntry } from './model-registry.js';

const require = createRequire(import.meta.url);

// ─── State ───

let _addon = null;
let _embeddingModel = null;
let _embeddingModelLoadPromise = null; // race-gate for concurrent first calls
let _liModel = null;
let _liModelLoadPromise = null;
let _embTokenizer = null;
let _embTokenizerLoadPromise = null;
let _liTokenizer = null;
let _liTokenizerLoadPromise = null;
let _available = null;

// ─── Addon Loading ───

function loadAddon() {
  if (_addon) return _addon;
  const addonPath = resolveNativeAddon();
  if (!addonPath) return null;
  try {
    _addon = require(addonPath);
    return _addon;
  } catch {
    return null;
  }
}

// ─── Detection ───

/**
 * Check if native inference is available and not disabled via env var.
 * Caches result after first check.
 */
export function isNativeInferenceAvailable() {
  if (_available !== null) return _available;

  const envFlag = (process.env.SWEET_SEARCH_NATIVE_INFERENCE ?? '').trim().toLowerCase();
  if (envFlag === '0' || envFlag === 'false' || envFlag === 'off') {
    _available = false;
    return false;
  }

  const addon = loadAddon();
  _available = typeof addon?.NativeEmbeddingModel?.load === 'function';
  return _available;
}

// ─── Embedding Model ───

/**
 * Load the native embedding model (CodeRankEmbed FP32 safetensors).
 * Returns the model instance or null if unavailable.
 *
 * Race-gated: concurrent first calls share a single load promise so the
 * underlying napi `addon.NativeEmbeddingModel.load(...)` runs exactly once.
 * Without this gate, multiple parallel queries (e.g. eval runner with
 * --concurrency=N) all see _embeddingModel == null and each load a fresh
 * model copy, wasting Metal memory and printing N "Loaded" lines.
 */
export async function getNativeEmbeddingModel() {
  if (_embeddingModel) return _embeddingModel;
  if (_embeddingModelLoadPromise) return _embeddingModelLoadPromise;

  _embeddingModelLoadPromise = (async () => {
    // ─── SPIKE: CoreML Python bridge override ──────────────────────────────
    // Only active when SWEET_SEARCH_INFERENCE_BACKEND=coreml. Routes the
    // embedding pipeline through scripts/spike-coreml/coreml-embedding-bridge.js
    // so we can measure end-to-end wall-clock against the candle baseline
    // before committing to a real Rust objc2-core-ml integration. Default
    // path (env unset) is unchanged.
    if ((process.env.SWEET_SEARCH_INFERENCE_BACKEND ?? '').toLowerCase() === 'coreml') {
      const t0 = Date.now();
      const { CoremlEmbeddingBridge } = await import('../../scripts/spike-coreml/coreml-embedding-bridge.js');
      _embeddingModel = await CoremlEmbeddingBridge.load();
      console.log(`[NativeInference] CoreML SPIKE bridge loaded in ${Date.now() - t0}ms (dim: ${_embeddingModel.dim})`);
      return _embeddingModel;
    }
    // ─── End spike override ────────────────────────────────────────────────

    const addon = loadAddon();
    if (!addon?.NativeEmbeddingModel) return null;

    await fetchModel('coderankembed-fp32');

    const entry = getModelEntry('coderankembed-fp32');
    const modelDir = getModelCacheDir(entry.hfId);
    const safetensorsPath = join(modelDir, 'model.safetensors');
    const configPath = join(modelDir, 'config.json');

    if (!existsSync(safetensorsPath) || !existsSync(configPath)) return null;

    const t0 = Date.now();
    _embeddingModel = addon.NativeEmbeddingModel.load(safetensorsPath, configPath);
    console.log(`[NativeInference] Embedding model loaded in ${Date.now() - t0}ms (dim: ${_embeddingModel.dim}, device: ${addon.nativeInferenceDevice()})`);

    return _embeddingModel;
  })();

  try {
    return await _embeddingModelLoadPromise;
  } finally {
    // Clear the promise on resolve so a future explicit unload can re-load.
    // Keep it set on success: subsequent calls hit the _embeddingModel cache
    // first and never reach the promise check.
  }
}

/**
 * Get or create the embedding tokenizer. Race-gated like getNativeEmbeddingModel.
 * Uses the INT8 model's tokenizer (same vocab as FP32).
 */
async function getEmbTokenizer() {
  if (_embTokenizer) return _embTokenizer;
  if (_embTokenizerLoadPromise) return _embTokenizerLoadPromise;
  _embTokenizerLoadPromise = (async () => {
    const entry = getModelEntry('coderankembed-int8');
    const tokenizerPath = join(getModelCacheDir(entry.hfId), 'tokenizer.json');
    _embTokenizer = await createTokenizer(tokenizerPath);
    return _embTokenizer;
  })();
  return _embTokenizerLoadPromise;
}

/**
 * Tokenize texts for the native model, returning napi-compatible arrays.
 */
function tokenizedToNapi(tokenized, batchSize, seqLen) {
  const inputIds = new Array(batchSize);
  const attentionMask = new Array(batchSize);
  for (let b = 0; b < batchSize; b++) {
    const ids = new Array(seqLen);
    const mask = new Array(seqLen);
    const base = b * seqLen;
    for (let s = 0; s < seqLen; s++) {
      ids[s] = Number(tokenized.input_ids.data[base + s]);
      mask[s] = Number(tokenized.attention_mask.data[base + s]);
    }
    inputIds[b] = ids;
    attentionMask[b] = mask;
  }
  return { inputIds, attentionMask };
}

/**
 * Native embedding inference — drop-in replacement for callLocalModel().
 *
 * @param {string[]} texts - Array of texts to embed
 * @param {object} [options]
 * @param {number} [options.maxLength=512] - Max sequence length
 * @returns {Float32Array[]} Array of L2-normalized embedding vectors (768d)
 */
export async function nativeEmbed(texts, options = {}) {
  const { maxLength = 512 } = options;
  const model = await getNativeEmbeddingModel();
  if (!model) throw new Error('[NativeInference] Embedding model not loaded');

  const tokenizer = await getEmbTokenizer();
  const tokenized = tokenizer(texts, { padding: true, truncation: true, max_length: maxLength });
  const batchSize = texts.length;
  const seqLen = tokenized.input_ids.dims[1];

  const { inputIds, attentionMask } = tokenizedToNapi(tokenized, batchSize, seqLen);
  // The native addon returns a flat `Float32Array` of length batch * dim —
  // see the comment on embed_batch in embedding_model.rs. Slice via
  // `.slice(i*dim, (i+1)*dim)` for per-batch typed arrays (each .slice call
  // copies dim floats into a fresh Float32Array, matching the old contract
  // where each per-batch vector is independent).
  const flat = await model.embedBatch(inputIds, attentionMask);
  const dim = model.dim;

  const embeddings = new Array(batchSize);
  for (let i = 0; i < batchSize; i++) {
    embeddings[i] = flat.slice(i * dim, (i + 1) * dim);
  }
  return embeddings;
}

// ─── Late Interaction Model ───

/**
 * Load the native LI model (LateOn-Code FP32 safetensors + projection).
 * Returns the model instance or null if unavailable. Race-gated.
 */
export async function getNativeLiModel() {
  if (_liModel) return _liModel;
  if (_liModelLoadPromise) return _liModelLoadPromise;
  _liModelLoadPromise = (async () => {
    const addon = loadAddon();
    if (!addon?.NativeLateInteractionModel) return null;

    await fetchModel('lateon-code-fp32');

    const entry = getModelEntry('lateon-code-fp32');
    const modelDir = getModelCacheDir(entry.hfId);
    const backbonePath = join(modelDir, 'model.safetensors');
    const projPath = join(modelDir, '1_Dense', 'model.safetensors');
    const configPath = join(modelDir, 'config.json');

    if (!existsSync(backbonePath) || !existsSync(projPath) || !existsSync(configPath)) return null;

    const t0 = Date.now();
    _liModel = addon.NativeLateInteractionModel.load(backbonePath, projPath, configPath);
    console.log(`[NativeInference] LI model loaded in ${Date.now() - t0}ms (dim: ${_liModel.dim}, device: ${addon.nativeInferenceDevice()})`);

    return _liModel;
  })();
  return _liModelLoadPromise;
}

/**
 * Get or create the LI tokenizer. Race-gated.
 */
async function getLiTokenizer() {
  if (_liTokenizer) return _liTokenizer;
  if (_liTokenizerLoadPromise) return _liTokenizerLoadPromise;
  _liTokenizerLoadPromise = (async () => {
    const entry = getModelEntry('lateon-code');
    const tokenizerPath = join(getModelCacheDir(entry.hfId), 'tokenizer.json');
    _liTokenizer = await createTokenizer(tokenizerPath);
    return _liTokenizer;
  })();
  return _liTokenizerLoadPromise;
}

/**
 * Native LI encoding from a pre-tokenized batch. Avoids re-tokenizing when
 * the caller already has the tokenizer output (e.g. because it needs
 * input_ids for skiplist filtering). Accepts the object returned by the
 * native tokenizer: `{ input_ids: { data, dims }, attention_mask: { data, dims } }`.
 *
 * @param {object} tokenized - Pre-tokenized batch from native tokenizer
 * @returns {Float32Array[][]} Per-document arrays of Float32Array token vectors
 */
export async function nativeLiEncodeTokenized(tokenized) {
  const model = await getNativeLiModel();
  if (!model) throw new Error('[NativeInference] LI model not loaded');

  const [batchSize, seqLen] = tokenized.input_ids.dims;
  const { inputIds, attentionMask } = tokenizedToNapi(tokenized, batchSize, seqLen);
  const result = await model.encodeBatch(inputIds, attentionMask);
  const dim = model.dim;

  // The native addon returns `vectors` as a flat `Float32Array` (zero-copy
  // from the Rust Vec<f32> via napi typed array) — see encode_batch in
  // li_model.rs. Slice per token via `.slice()`, which copies `dim` floats
  // into a fresh Float32Array per token, preserving the old contract where
  // each per-token vector is an independent Float32Array.
  const flat = result.vectors;

  const allVectors = new Array(batchSize);
  let offset = 0;
  for (let b = 0; b < batchSize; b++) {
    const count = result.tokenCounts[b];
    const docVectors = new Array(count);
    for (let t = 0; t < count; t++) {
      docVectors[t] = flat.slice(offset + t * dim, offset + (t + 1) * dim);
    }
    allVectors[b] = docVectors;
    offset += count * dim;
  }

  return allVectors;
}

/**
 * Native LI encoding — returns per-token L2-normalized 128d vectors.
 *
 * @param {string[]} texts - Texts to encode (already prefixed with [Q]/[D])
 * @param {object} [options]
 * @param {number} [options.maxLength=2048] - Max sequence length
 * @returns {Float32Array[][]} Per-document arrays of Float32Array token vectors
 */
export async function nativeLiEncode(texts, options = {}) {
  const { maxLength = 2048 } = options;
  const tokenizer = await getLiTokenizer();
  const tokenized = tokenizer(texts, { padding: true, truncation: true, max_length: maxLength });
  return nativeLiEncodeTokenized(tokenized);
}

// ─── Cleanup ───

export function unloadNativeModels() {
  _embeddingModel = null;
  _embeddingModelLoadPromise = null;
  _liModel = null;
  _liModelLoadPromise = null;
  _embTokenizer = null;
  _embTokenizerLoadPromise = null;
  _liTokenizer = null;
  _liTokenizerLoadPromise = null;
  _addon = null;
  _available = null;
}
