/**
 * Late Interaction Model Singleton — LateOn-Code inference via ONNX Runtime
 *
 * Loads tokenizer from @huggingface/transformers, ONNX model via onnxruntime-node.
 * Projection layers are detected at load time: if the ONNX output is raw backbone
 * dimensions (768d full, 256d edge), projection weights are downloaded from
 * safetensors files and applied after inference. If already baked in, skipped.
 *
 * Encoding asymmetry (critical):
 * - Queries:    [Q] prefix, max 256 tokens, NO skiplist, NO [MASK] padding
 * - Documents:  [D] prefix, max 2048 tokens, skiplist filters punctuation tokens
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { LATE_INTERACTION_CONFIG } from './config.js';

let lateInteractionPipeline = null;
let loadPromise = null;

/**
 * Get the late interaction pipeline singleton (lazy-loaded).
 * Returns null if late interaction is disabled.
 */
export async function getLateInteractionPipeline() {
  if (!LATE_INTERACTION_CONFIG.enabled) return null;
  if (lateInteractionPipeline) return lateInteractionPipeline;
  if (loadPromise) return loadPromise;
  loadPromise = loadModel();
  lateInteractionPipeline = await loadPromise;
  loadPromise = null;
  return lateInteractionPipeline;
}

/** Check if the late interaction model is currently loaded */
export function isLateInteractionModelLoaded() { return lateInteractionPipeline != null; }

/** Release model memory */
export async function unloadLateInteractionModel() {
  if (lateInteractionPipeline?.session) {
    try { await lateInteractionPipeline.session.release(); } catch { /* ignore */ }
  }
  lateInteractionPipeline = null;
  loadPromise = null;
}

// =========================================================================
// Safetensors Parser — extracts Float32 weight matrices
// =========================================================================

/**
 * Parse a safetensors file and extract the first Float32 weight tensor.
 * Safetensors format: 8-byte LE header length + JSON header + raw tensor data.
 * @param {string} filePath - Path to .safetensors file
 * @returns {Float32Array} Weight matrix as flat array
 */
function parseSafetensorsWeight(filePath) {
  const buffer = fs.readFileSync(filePath);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const headerLen = Number(view.getBigUint64(0, true));
  const headerJson = buffer.subarray(8, 8 + headerLen).toString('utf-8');
  const header = JSON.parse(headerJson);

  const dataStart = 8 + headerLen;
  for (const [name, info] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    if (info.dtype === 'F32') {
      const byteOffset = dataStart + info.data_offsets[0];
      const byteLength = info.data_offsets[1] - info.data_offsets[0];
      // Copy to new buffer to avoid alignment issues
      const copy = new Float32Array(byteLength / 4);
      const src = buffer.subarray(byteOffset, byteOffset + byteLength);
      copy.set(new Float32Array(src.buffer, src.byteOffset, src.length / 4));
      return copy;
    }
  }
  throw new Error(`No F32 tensor found in ${filePath}`);
}

// =========================================================================
// Model Loading
// =========================================================================

async function loadModel() {
  const modelConfig = LATE_INTERACTION_CONFIG.activeModel;
  if (!modelConfig) throw new Error(`[LateInteraction] Unknown model: ${LATE_INTERACTION_CONFIG.model}`);

  const start = Date.now();
  console.log(`[LateInteraction] Loading ${LATE_INTERACTION_CONFIG.model} (${modelConfig.tokenDimension}d)...`);

  // Load tokenizer from transformers.js
  const { AutoTokenizer } = await import('@huggingface/transformers');
  const tokenizer = await AutoTokenizer.from_pretrained(modelConfig.hfId);

  // Build skiplist token IDs from the 32 punctuation chars
  const skiplistTokenIds = new Set();
  for (const ch of LATE_INTERACTION_CONFIG.skiplistChars) {
    const enc = tokenizer(ch, { add_special_tokens: false });
    const ids = Array.from(enc.input_ids.data);
    if (ids.length === 1) skiplistTokenIds.add(Number(ids[0]));
  }

  // Download ONNX model if not cached
  const onnxPath = await downloadHfFile(modelConfig.hfId, modelConfig.onnxFile);

  // Create ORT session
  const ort = await import('onnxruntime-node');
  const session = await ort.InferenceSession.create(onnxPath, {
    executionProviders: ['cpu'],
  });

  // Probe: run a single inference to check output dimension
  const probeTokenized = tokenizer('[Q] probe', { padding: true, truncation: true, max_length: 8 });
  const probeHidden = await runRawInference(session, probeTokenized, ort);
  const outputDim = probeHidden.dims[2];

  // Determine if we need manual projection
  let projectionStages = [];
  const projectionBakedIn = outputDim === modelConfig.tokenDimension;
  const projectionNeeded = outputDim === modelConfig.backboneDim;

  if (projectionBakedIn) {
    console.log(`[LateInteraction] ONNX output is ${outputDim}d — projection baked in`);
  } else if (projectionNeeded) {
    console.log(`[LateInteraction] ONNX output is raw ${outputDim}d backbone — loading projection weights...`);

    // Load each projection weight and derive dims from weight.length + known input dim.
    // Stage 1 input dim = backbone dim. Each subsequent stage input = previous output.
    let currentInDim = modelConfig.backboneDim;
    for (let i = 0; i < modelConfig.projectionPaths.length; i++) {
      const weightPath = await downloadHfFile(modelConfig.hfId, modelConfig.projectionPaths[i]);
      const weight = parseSafetensorsWeight(weightPath);
      // weight is [outDim, inDim] row-major → outDim = weight.length / inDim
      if (weight.length % currentInDim !== 0) {
        throw new Error(`[LateInteraction] Projection ${i + 1}: weight length ${weight.length} not divisible by input dim ${currentInDim}`);
      }
      const outDim = weight.length / currentInDim;
      console.log(`[LateInteraction]   Stage ${i + 1}: ${currentInDim}d → ${outDim}d (${weight.length} weights)`);
      projectionStages.push({ weight, inDim: currentInDim, outDim });
      currentInDim = outDim;
    }

    // Verify final output matches expected token dimension
    if (currentInDim !== modelConfig.tokenDimension) {
      throw new Error(`[LateInteraction] Final projection output ${currentInDim}d !== expected ${modelConfig.tokenDimension}d`);
    }
    console.log(`[LateInteraction] Loaded ${projectionStages.length} projection stage(s): ${modelConfig.backboneDim}d → ${modelConfig.tokenDimension}d`);
  } else {
    throw new Error(`[LateInteraction] Unexpected ONNX output dim ${outputDim} (expected ${modelConfig.tokenDimension} or ${modelConfig.backboneDim})`);
  }

  const elapsed = Date.now() - start;
  console.log(`[LateInteraction] Loaded ${LATE_INTERACTION_CONFIG.model} in ${elapsed}ms (${modelConfig.tokenDimension}d, skiplist: ${skiplistTokenIds.size} IDs, projection: ${projectionBakedIn ? 'baked' : 'manual'})`);

  return { tokenizer, session, modelConfig, skiplistTokenIds, ort, projectionStages };
}

// =========================================================================
// Encode API
// =========================================================================

/**
 * Encode a query into per-token vectors.
 * - Prepends [Q] prefix
 * - Max 256 tokens
 * - NO skiplist filtering (keeps ALL tokens)
 * - NO [MASK] padding
 *
 * @param {string} text - Raw query text (without prefix)
 * @returns {Float32Array[]} Array of L2-normalized token vectors
 */
export async function encodeQuery(text) {
  const pipeline = await getLateInteractionPipeline();
  if (!pipeline) return [];

  const { tokenizer, session, modelConfig, ort, projectionStages } = pipeline;
  const prefixed = modelConfig.queryPrefix + text;
  const tokenized = tokenizer(prefixed, {
    padding: true, truncation: true, max_length: modelConfig.maxQueryLength,
  });

  const hidden = await runRawInference(session, tokenized, ort);
  return projectAndNormalize(hidden, projectionStages);
}

/**
 * Encode documents into per-token vectors.
 * - Prepends [D] prefix to each
 * - Max 2048 tokens per doc
 * - Skiplist filtering applied (removes punctuation token embeddings)
 * - Optional token pooling (reduces token count by pool_factor)
 * - Optional extended skiplist (additional code-noise tokens)
 *
 * @param {string[]} texts - Array of raw document texts (without prefix)
 * @param {object} [options] - Encoding options
 * @param {number} [options.poolFactor=1] - Token pooling factor (1=no pooling, 2=halve tokens, etc.)
 * @param {boolean} [options.extendedSkiplist=false] - Use code-extended skiplist
 * @returns {Float32Array[][]} Array of (array of token vectors) per document
 */
export async function encodeDocuments(texts, options = {}) {
  const { poolFactor = 1, extendedSkiplist = false } = options;
  const pipeline = await getLateInteractionPipeline();
  if (!pipeline) return texts.map(() => []);

  const { tokenizer, session, modelConfig, skiplistTokenIds, ort, projectionStages } = pipeline;

  // Build effective skiplist (base + optional extended for code)
  let effectiveSkiplist = skiplistTokenIds;
  if (extendedSkiplist) {
    effectiveSkiplist = buildExtendedSkiplist(tokenizer, skiplistTokenIds);
  }

  const results = new Array(texts.length);

  for (let t = 0; t < texts.length; t++) {
    const prefixed = modelConfig.docPrefix + texts[t];
    const tokenized = tokenizer(prefixed, {
      padding: true, truncation: true, max_length: modelConfig.maxDocLength,
    });

    const hidden = await runRawInference(session, tokenized, ort);
    const allVectors = projectAndNormalize(hidden, projectionStages);
    const inputIds = Array.from(tokenized.input_ids.data).map(Number);

    // Apply skiplist filter (documents only, not queries)
    const vectors = [];
    for (let i = 0; i < allVectors.length; i++) {
      if (!effectiveSkiplist.has(inputIds[i])) {
        vectors.push(allVectors[i]);
      }
    }

    // Apply token pooling if requested (document-only, never queries)
    results[t] = poolFactor > 1 ? poolTokens(vectors, poolFactor) : vectors;
  }

  return results;
}

// =========================================================================
// Projection + L2 Normalization
// =========================================================================

/**
 * Apply projection stages (if any) and L2-normalize per token.
 * @param {object} hiddenTensor - ORT output tensor with .dims and .data
 * @param {Array<{weight: Float32Array, inDim: number, outDim: number}>} projectionStages
 * @returns {Float32Array[]} Array of L2-normalized token vectors
 */
function projectAndNormalize(hiddenTensor, projectionStages) {
  const [batch, seqLen, hiddenDim] = hiddenTensor.dims;
  let data = new Float32Array(hiddenTensor.data);
  let currentDim = hiddenDim;

  // Apply sequential projection stages
  for (const { weight, inDim, outDim } of projectionStages) {
    const projected = new Float32Array(batch * seqLen * outDim);
    for (let b = 0; b < batch; b++) {
      for (let s = 0; s < seqLen; s++) {
        const srcOff = (b * seqLen + s) * currentDim;
        const dstOff = (b * seqLen + s) * outDim;
        for (let o = 0; o < outDim; o++) {
          let sum = 0;
          for (let i = 0; i < currentDim; i++) sum += weight[o * currentDim + i] * data[srcOff + i];
          projected[dstOff + o] = sum;
        }
      }
    }
    data = projected;
    currentDim = outDim;
  }

  // L2 normalize per token, return as array of Float32Array vectors
  const vectors = new Array(seqLen);
  for (let s = 0; s < seqLen; s++) {
    const offset = s * currentDim;
    let norm = 0;
    for (let d = 0; d < currentDim; d++) norm += data[offset + d] * data[offset + d];
    norm = Math.sqrt(norm) + 1e-12;
    const vec = new Float32Array(currentDim);
    for (let d = 0; d < currentDim; d++) vec[d] = data[offset + d] / norm;
    vectors[s] = vec;
  }

  return vectors;
}

// =========================================================================
// Token Pooling (Phase 7.1)
// =========================================================================

/**
 * Hierarchical token pooling — reduces N tokens to ~N/poolFactor tokens.
 * Groups consecutive tokens and averages their vectors.
 * First token always preserved (protected_tokens=1, following PyLate convention).
 *
 * @param {Float32Array[]} tokens - L2-normalized token vectors
 * @param {number} poolFactor - Pooling factor (2 = halve, 3 = third, etc.)
 * @returns {Float32Array[]} Pooled and re-normalized token vectors
 */
export function poolTokens(tokens, poolFactor) {
  if (!tokens || tokens.length === 0 || poolFactor <= 1) return tokens;

  const dim = tokens[0].length;
  const pooled = [];

  // First token always preserved (protected)
  pooled.push(tokens[0]);

  // Pool remaining tokens in groups of poolFactor
  for (let i = 1; i < tokens.length; i += poolFactor) {
    const groupEnd = Math.min(i + poolFactor, tokens.length);
    const groupSize = groupEnd - i;
    const avg = new Float32Array(dim);

    for (let j = i; j < groupEnd; j++) {
      for (let d = 0; d < dim; d++) {
        avg[d] += tokens[j][d];
      }
    }

    // Average + L2 re-normalize
    let norm = 0;
    for (let d = 0; d < dim; d++) {
      avg[d] /= groupSize;
      norm += avg[d] * avg[d];
    }
    norm = Math.sqrt(norm) + 1e-12;
    for (let d = 0; d < dim; d++) avg[d] /= norm;

    pooled.push(avg);
  }

  return pooled;
}

// =========================================================================
// Extended Skiplist for Code (Phase 7.2)
// =========================================================================

/**
 * Additional single-char tokens that are pure syntax noise in code.
 * NOT IDF-based — explicitly curated to avoid removing meaningful tokens.
 * Common tokens like `return`, `function`, `class` are NOT included.
 */
const CODE_EXTENDED_SKIPLIST_CHARS = [
  '\t', '\n', '\r',
  ';', ',',
  '\\', '`',
];

let _extendedSkiplistCache = null;

/**
 * Build extended skiplist = base punctuation + code-specific noise tokens.
 * Cached after first build (tokenizer is deterministic).
 */
export function buildExtendedSkiplist(tokenizer, baseSkiplist) {
  if (_extendedSkiplistCache) return _extendedSkiplistCache;

  const extended = new Set(baseSkiplist);
  for (const ch of CODE_EXTENDED_SKIPLIST_CHARS) {
    const enc = tokenizer(ch, { add_special_tokens: false });
    const ids = Array.from(enc.input_ids.data);
    if (ids.length === 1) extended.add(Number(ids[0]));
  }

  _extendedSkiplistCache = extended;
  return extended;
}

/** Reset extended skiplist cache (for testing) */
export function _resetExtendedSkiplistCache() { _extendedSkiplistCache = null; }

// =========================================================================
// ORT Inference (raw — no projection)
// =========================================================================

async function runRawInference(session, tokenized, ort) {
  const idData = tokenized.input_ids.data instanceof BigInt64Array
    ? tokenized.input_ids.data
    : new BigInt64Array(Array.from(tokenized.input_ids.data).map(BigInt));
  const maskData = tokenized.attention_mask.data instanceof BigInt64Array
    ? tokenized.attention_mask.data
    : new BigInt64Array(Array.from(tokenized.attention_mask.data).map(BigInt));

  const feeds = {
    input_ids: new ort.Tensor('int64', idData, tokenized.input_ids.dims),
    attention_mask: new ort.Tensor('int64', maskData, tokenized.attention_mask.dims),
  };

  const result = await session.run(feeds);
  return result[session.outputNames[0]];
}

// =========================================================================
// HuggingFace File Download + Cache
// =========================================================================

function getCachePath(hfId, filename) {
  const cacheDir = path.join(os.homedir(), '.cache', 'sweet-search', 'lateon-models',
    hfId.replace('/', '--'));
  fs.mkdirSync(cacheDir, { recursive: true });
  return path.join(cacheDir, filename.replace(/\//g, '--'));
}

async function downloadHfFile(hfId, filename) {
  const cachePath = getCachePath(hfId, filename);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
    return cachePath;
  }

  const url = `https://huggingface.co/${hfId}/resolve/main/${filename}`;
  console.log(`[LateInteraction] Downloading ${filename} from ${hfId}...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`[LateInteraction] HTTP ${resp.status} downloading ${url}`);
  const buffer = await resp.arrayBuffer();
  fs.writeFileSync(cachePath, Buffer.from(buffer));
  console.log(`[LateInteraction] Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB → ${cachePath}`);
  return cachePath;
}
