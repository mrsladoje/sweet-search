/**
 * Native Inference — candle-based FP32 embedding + late interaction inference.
 *
 * Provides native model wrappers that serve as drop-in replacements for the
 * ORT inference paths. Uses the napi-rs addon with Metal GPU acceleration on
 * Apple Silicon, CPU fallback elsewhere.
 *
 * Environment:
 *   SWEET_SEARCH_NATIVE_INFERENCE=0|1          — force disable/enable
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
let _liModel = null;
let _embTokenizer = null;
let _liTokenizer = null;
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
 */
export async function getNativeEmbeddingModel() {
  if (_embeddingModel) return _embeddingModel;

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
}

/**
 * Get or create the embedding tokenizer.
 * Uses the INT8 model's tokenizer (same vocab as FP32).
 */
async function getEmbTokenizer() {
  if (_embTokenizer) return _embTokenizer;
  const entry = getModelEntry('coderankembed-int8');
  const tokenizerPath = join(getModelCacheDir(entry.hfId), 'tokenizer.json');
  _embTokenizer = await createTokenizer(tokenizerPath);
  return _embTokenizer;
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
  const result = await model.embedBatch(inputIds, attentionMask);

  // Convert Vec<Vec<f32>> → Float32Array[] for API compatibility
  const embeddings = new Array(batchSize);
  for (let i = 0; i < batchSize; i++) {
    embeddings[i] = new Float32Array(result[i]);
  }
  return embeddings;
}

// ─── Late Interaction Model ───

/**
 * Load the native LI model (LateOn-Code FP32 safetensors + projection).
 * Returns the model instance or null if unavailable.
 */
export async function getNativeLiModel() {
  if (_liModel) return _liModel;

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
}

/**
 * Get or create the LI tokenizer.
 */
async function getLiTokenizer() {
  if (_liTokenizer) return _liTokenizer;
  const entry = getModelEntry('lateon-code');
  const tokenizerPath = join(getModelCacheDir(entry.hfId), 'tokenizer.json');
  _liTokenizer = await createTokenizer(tokenizerPath);
  return _liTokenizer;
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

  // Convert flat vectors + token_counts → Float32Array[][] per document
  const allVectors = new Array(batchSize);
  let offset = 0;
  for (let b = 0; b < batchSize; b++) {
    const count = result.tokenCounts[b];
    const docVectors = new Array(count);
    for (let t = 0; t < count; t++) {
      const vec = new Float32Array(dim);
      for (let d = 0; d < dim; d++) {
        vec[d] = result.vectors[offset + t * dim + d];
      }
      docVectors[t] = vec;
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
  _liModel = null;
  _embTokenizer = null;
  _liTokenizer = null;
  _addon = null;
  _available = null;
}
