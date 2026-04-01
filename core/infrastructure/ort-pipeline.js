/**
 * Direct ORT Pipeline — loads an ONNX session + tokenizer without HuggingFace wrappers.
 *
 * Replaces pipeline() and AutoModel.from_pretrained() by loading onnxruntime-node
 * sessions directly from managed-cache ONNX files.
 */

import { createTokenizer } from './native-tokenizer.js';

/**
 * Eagerly resolved onnxruntime-node module.
 * Call initOrt() once at startup; after that, getOrt() is synchronous.
 */
let _ort = null;

export async function initOrt() {
  if (!_ort) _ort = await import('onnxruntime-node');
  return _ort;
}

export function getOrt() {
  if (!_ort) throw new Error('[ort-pipeline] ORT not initialized. Call initOrt() first.');
  return _ort;
}

/**
 * Convert tokenizer output (BigInt64Array with dims) to ORT Tensor feed dict.
 *
 * SYNCHRONOUS — must call initOrt() before first use.
 *
 * @param {object} tokenized - Tokenizer output with input_ids, attention_mask, etc.
 * @param {string[]} inputNames - Session input names to populate
 * @returns {object} Feed dict mapping input names to ORT Tensors
 */
export function buildFeed(tokenized, inputNames) {
  const ort = getOrt();
  const feed = {};

  for (const name of inputNames) {
    const field = tokenized[name];

    if (field?.data && field?.dims) {
      const data = field.data instanceof BigInt64Array
        ? field.data
        : new BigInt64Array(Array.from(field.data).map(BigInt));
      feed[name] = new ort.Tensor('int64', data, field.dims);
      continue;
    }

    // token_type_ids not in tokenizer output — generate zeros matching input_ids shape
    if (name === 'token_type_ids') {
      const ref = feed.input_ids;
      if (ref?.dims) {
        const size = ref.dims.reduce((a, b) => a * b, 1);
        feed[name] = new ort.Tensor('int64', new BigInt64Array(size), Array.from(ref.dims));
      }
      continue;
    }

    // Skip unknown optional inputs silently
  }

  return feed;
}

/**
 * Create a direct ORT pipeline from local ONNX + tokenizer.json files.
 *
 * @param {string} onnxPath - Absolute path to the ONNX model file
 * @param {string} tokenizerPath - Absolute path to tokenizer.json
 * @param {object} [sessionOptions] - ORT session options (from buildSessionOptions)
 * @returns {{ session, tokenizer, run, dispose }}
 */
export async function createOrtPipeline(onnxPath, tokenizerPath, sessionOptions = {}) {
  const ort = await initOrt();

  const session = await ort.InferenceSession.create(onnxPath, sessionOptions);
  const tokenizer = await createTokenizer(tokenizerPath);

  /**
   * Tokenize texts and run inference.
   *
   * @param {string|string[]} texts - Input text(s)
   * @param {object} [opts] - Tokenizer options (padding, truncation, max_length, text_pair)
   * @returns {object} Raw ORT output tensors
   */
  async function run(texts, opts = {}) {
    const {
      padding = true,
      truncation = true,
      max_length = 512,
      text_pair,
    } = opts;

    const tokenized = tokenizer(texts, { padding, truncation, max_length, text_pair });
    const feed = buildFeed(tokenized, session.inputNames);
    return session.run(feed);
  }

  async function dispose() {
    try { await session.release(); } catch { /* ORT session.release() can throw */ }
  }

  return { session, tokenizer, run, dispose };
}
