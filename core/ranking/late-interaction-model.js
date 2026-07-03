/**
 * Late Interaction Model Singleton — LateOn-Code inference via ONNX Runtime
 *
 * Loads tokenizer via native-tokenizer.js, ONNX model via onnxruntime-node.
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
import { join } from 'path';
import { LATE_INTERACTION_CONFIG } from '../infrastructure/config/index.js';
import { fetchModelFile, getModelCacheDir, resolveModelFile } from '../infrastructure/model-fetcher.js';
import { getModelEntry } from '../infrastructure/model-registry.js';
import { createTokenizer } from '../infrastructure/native-tokenizer.js';
import { isNativeInferenceAvailable, isNativeLiModelLoaded, nativeLiEncode, nativeLiEncodeTokenized } from '../infrastructure/native-inference.js';
// CoreML not used for LI models — see loadModel() comment for benchmarking rationale.

let lateInteractionPipeline = null;
let loadPromise = null;
let lateInteractionRuntimeConfig = {
  intraOpThreads: null,
  // G3-LI: background/maintainer ORT profile for the LI session. When truthy,
  // the session is created with the CPU mem arena OFF and force_spinning_stop
  // instead of allow_spinning — the same profile buildLocalSessionOptions
  // applies to the dense session. ORT never returns arena memory once grown
  // (#25325), and per-file reconcile encodes produce highly variable batch
  // shapes, so an arena-ON LI session in the resident maintainer accrues
  // monotonic RSS in 128MB arena-extension steps (measured: 354×128MB ≈ 34GB
  // after one heavy edit day). Must be set BEFORE the first encode — the
  // session singleton is built once; configuring after is a silent no-op.
  // Default null/off everywhere else (search/query path keeps the foreground
  // arena+spinning profile for latency).
  background: null,
};

// Lightweight timing accumulators for profiling (Phase 6a).
// Cleared on read via getLateInteractionTimings().
const _timings = { tokenize_us: 0, inference_us: 0, calls: 0 };

/** Read and reset accumulated tokenizer/inference timings. */
export function getLateInteractionTimings() {
  const snap = { ..._timings };
  _timings.tokenize_us = 0;
  _timings.inference_us = 0;
  _timings.calls = 0;
  return snap;
}

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

// Lightweight tokenizer + skiplist cache for native inference path
// (avoids loading the full ORT pipeline just for tokenization)
let _nativeLiTokenizer = null;
let _nativeLiSkiplist = null;

async function getNativeLiTokenizerAndSkiplist() {
  if (_nativeLiTokenizer) return { tokenizer: _nativeLiTokenizer, skiplistTokenIds: _nativeLiSkiplist };

  const modelConfig = LATE_INTERACTION_CONFIG.activeModel;
  const tokenizerPath = join(getModelCacheDir(modelConfig.hfId), 'tokenizer.json');
  _nativeLiTokenizer = await createTokenizer(tokenizerPath);

  _nativeLiSkiplist = new Set();
  for (const ch of LATE_INTERACTION_CONFIG.skiplistChars) {
    const enc = _nativeLiTokenizer(ch, { add_special_tokens: false });
    const ids = Array.from(enc.input_ids.data);
    if (ids.length === 1) _nativeLiSkiplist.add(Number(ids[0]));
  }

  return { tokenizer: _nativeLiTokenizer, skiplistTokenIds: _nativeLiSkiplist };
}

export function configureLateInteractionRuntime(overrides = {}) {
  lateInteractionRuntimeConfig = {
    ...lateInteractionRuntimeConfig,
    ...overrides,
  };
}

export function resetLateInteractionRuntime() {
  lateInteractionRuntimeConfig = {
    intraOpThreads: null,
    background: null,
  };
}

/** Release model memory */
export async function unloadLateInteractionModel() {
  if (lateInteractionPipeline) {
    // Release ORT session. Note: ORT has a known native memory leak in
    // session.release() (microsoft/onnxruntime#25325) — avoid frequent
    // load/unload cycles. Prefer singleton reuse.
    if (lateInteractionPipeline.session) {
      try { await lateInteractionPipeline.session.release(); } catch { /* ignore */ }
    }
    // Release projection weight buffers
    if (lateInteractionPipeline.projectionStages) {
      for (const stage of lateInteractionPipeline.projectionStages) {
        stage.weight = null;
      }
    }
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

  // Load tokenizer from managed cache (native Rust → JS fallback)
  const tokenizerPath = join(getModelCacheDir(modelConfig.hfId), 'tokenizer.json');
  const tokenizer = await createTokenizer(tokenizerPath);

  // Build skiplist token IDs from the 32 punctuation chars
  const skiplistTokenIds = new Set();
  for (const ch of LATE_INTERACTION_CONFIG.skiplistChars) {
    const enc = tokenizer(ch, { add_special_tokens: false });
    const ids = Array.from(enc.input_ids.data);
    if (ids.length === 1) skiplistTokenIds.add(Number(ids[0]));
  }

  // Download ONNX model if not cached
  const registryKey = LATE_INTERACTION_CONFIG.model;
  const onnxPath = await resolveOrFetchFile(modelConfig.hfId, modelConfig.onnxFile, registryKey);

  // Create ORT session
  const ort = await import('onnxruntime-node');
  const { bestIntraOpThreads } = await import('../infrastructure/onnx-session-utils.js');

  // CoreML is not used for late-interaction models. Benchmarking shows the
  // LateOn-Code model partitions poorly onto CoreML (1343/2327 ops), causing
  // constant CPU↔CoreML data transfer that makes inference ~18x slower.
  // The MLProgram format fails entirely; NeuralNetwork loads but regresses.
  //
  // Phase 1a: harmonized session options with embedding path — adds graph
  // optimization, memory arena, mem pattern, and optimized graph caching.
  // executionMode defaults to 'sequential' (BERT encoder, no branch parallelism).
  // Phase 1a/1c: LI session options benchmarked across hosts.
  // Findings: graphOptimizationLevel 'all' triggers NchwcTransformer → 14% regression.
  // 'extended' + memArena + memPattern: marginal overhead for no measurable gain.
  // Conclusion: keep LI session lean. Only proven-beneficial options added.
  const { getOptimizedGraphPath } = await import('../infrastructure/onnx-session-utils.js');
  const liBackground = !!lateInteractionRuntimeConfig.background;
  const session = await ort.InferenceSession.create(onnxPath, {
    executionProviders: ['cpu'],
    logSeverityLevel: 3, // ERROR — silence ORT's expected "optimized model is machine-specific" warning
    intraOpNumThreads: lateInteractionRuntimeConfig.intraOpThreads ?? bestIntraOpThreads(),
    interOpNumThreads: 1,
    optimizedModelFilePath: getOptimizedGraphPath(modelConfig.hfId, 'lateon'),
    // G3-LI: background (maintainer) profile disables the CPU mem arena — ORT
    // never returns arena memory once grown (#25325), and variable-shaped
    // per-file reconcile batches make the arena extend monotonically (128MB
    // steps) in a resident daemon. Foreground keeps the arena for throughput.
    enableCpuMemArena: !liBackground,
    // Thread spinning keeps ORT worker threads hot between batches — trades idle
    // CPU for lower per-batch latency during sustained indexing runs. The
    // background profile parks workers after the last Run() instead (the
    // maintainer sits idle 20-60s between ticks; ~14% re-spin latency cost).
    extra: {
      session: liBackground
        ? { force_spinning_stop: '1' }
        : { intra_op: { allow_spinning: '1' } },
    },
  });
  const coremlActive = false;

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
      const weightPath = await resolveOrFetchFile(modelConfig.hfId, modelConfig.projectionPaths[i], registryKey);
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

  // Warmup: ORT needs 10+ inference passes to stabilize JIT compilation,
  // memory pool sizing, and thread pool scheduling. Warm up at batch sizes
  // matching production document encoding traffic (single docs of varying
  // lengths). Without this, the first ~10 real batches pay JIT + allocation
  // costs and throughput appears to degrade.
  const warmupDocs = [
    '[D] function add(a, b) { return a + b; }',
    '[D] export class AuthService { constructor(private jwtProvider) {} async login(credentials) { const user = await this.userRepo.findByEmail(credentials.email); if (!user) throw new UnauthorizedException(); return { token: this.jwtProvider.sign({ sub: user.id }) }; } }',
    '[D] /**\n * SearchEngine handles full-text and vector search across indexed code.\n * Pipeline: tokenize → embed → HNSW ANN → rerank → filter.\n */\nexport class SearchEngine {\n  constructor(private hnsw, private liIndex, private reranker) {}\n  async search(query, options = {}) {\n    const embedding = await this.embed(query);\n    const candidates = await this.hnsw.search(embedding, options.topK || 100);\n    const reranked = await this.reranker.rerank(query, candidates);\n    return reranked.slice(0, options.limit || 10);\n  }\n}',
  ];
  for (let pass = 0; pass < 10; pass++) {
    const doc = warmupDocs[pass % warmupDocs.length];
    const warmupTokenized = tokenizer(doc, { padding: true, truncation: true, max_length: modelConfig.maxDocLength });
    await runRawInference(session, warmupTokenized, ort);
  }

  const elapsed = Date.now() - start;
  const epLabel = coremlActive ? 'coreml+cpu' : 'cpu';
  console.log(`[LateInteraction] Loaded ${LATE_INTERACTION_CONFIG.model} in ${elapsed}ms (${modelConfig.tokenDimension}d, ep: ${epLabel}, skiplist: ${skiplistTokenIds.size} IDs, projection: ${projectionBakedIn ? 'baked' : 'manual'})`);

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
  if (!LATE_INTERACTION_CONFIG.enabled) return [];

  // Native inference path: candle FP32 with Metal GPU
  if (isNativeInferenceAvailable() && isNativeLiModelLoaded()) {
    const modelConfig = LATE_INTERACTION_CONFIG.activeModel;
    if (!modelConfig) return [];
    const prefixed = modelConfig.queryPrefix + text;
    const t0 = performance.now();
    const result = await nativeLiEncode([prefixed], { maxLength: modelConfig.maxQueryLength });
    const t1 = performance.now();
    _timings.inference_us += Math.round((t1 - t0) * 1000);
    _timings.calls++;
    return result[0]; // Float32Array[] — one per token
  }

  // ORT fallback path
  const pipeline = await getLateInteractionPipeline();
  if (!pipeline) return [];

  const { tokenizer, session, modelConfig, ort, projectionStages } = pipeline;
  const prefixed = modelConfig.queryPrefix + text;

  const t0 = performance.now();
  const tokenized = tokenizer(prefixed, {
    padding: true, truncation: true, max_length: modelConfig.maxQueryLength,
  });
  const t1 = performance.now();
  const hidden = await runRawInference(session, tokenized, ort);
  const t2 = performance.now();

  _timings.tokenize_us += Math.round((t1 - t0) * 1000);
  _timings.inference_us += Math.round((t2 - t1) * 1000);
  _timings.calls++;

  return projectAndNormalizeBatch(hidden, projectionStages, tokenized.attention_mask)[0];
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
  // Default dispatcher: pick the best path that's available. Hybrid CPU+GPU
  // dispatching is done at the indexer level (indexer-ann.js LI loop) which
  // calls encodeDocumentsGpu and encodeDocumentsCpu directly in parallel.
  //
  // SWEET_SEARCH_LI_USE_CPU=1 forces the ORT INT8 CPU path even when the
  // native Metal addon is available. Use this when running in parallel with
  // the embedding phase: embed gets exclusive Metal access, LI gets exclusive
  // CPU access — eliminating Metal queue contention that otherwise starves
  // the LI GPU encoder when embed is feeding it a continuous stream of
  // small batches.
  const forceCpu = process.env.SWEET_SEARCH_LI_USE_CPU === '1';
  if (!forceCpu && isNativeInferenceAvailable() && isNativeLiModelLoaded()) {
    return encodeDocumentsGpu(texts, options);
  }
  return encodeDocumentsCpu(texts, options);
}

/**
 * Encode documents using the native Metal GPU path (candle + Metal SDPA).
 * Throws if the native addon is not available — the caller is expected to
 * have verified availability before routing batches here.
 */
export async function encodeDocumentsGpu(texts, options = {}) {
  const { poolFactor = 1, extendedSkiplist = false } = options;

  const modelConfig = LATE_INTERACTION_CONFIG.activeModel;
  if (!modelConfig) return texts.map(() => []);

  // Lightweight tokenizer + skiplist (no ORT session needed)
  const { tokenizer, skiplistTokenIds } = await getNativeLiTokenizerAndSkiplist();

  let effectiveSkiplist = skiplistTokenIds;
  if (extendedSkiplist) {
    effectiveSkiplist = buildExtendedSkiplist(tokenizer, skiplistTokenIds);
  }

  const prefixedTexts = texts.map((text) => modelConfig.docPrefix + text);

  // Tokenize once; reuse the same batch for both skiplist lookup and model
  // inference. `nativeLiEncodeTokenized` accepts the already-tokenized batch
  // directly so we don't double-tokenize.
  const t0 = performance.now();
  const tokenized = tokenizer(prefixedTexts, {
    padding: true, truncation: true, max_length: modelConfig.maxDocLength,
  });
  const t1 = performance.now();

  // Native inference — returns Float32Array[][] already projected + normalized
  const allVectorsByDoc = await nativeLiEncodeTokenized(tokenized);
  const t2 = performance.now();

  _timings.tokenize_us += Math.round((t1 - t0) * 1000);
  _timings.inference_us += Math.round((t2 - t1) * 1000);
  _timings.calls++;

  // Apply skiplist filtering
  const { data: inputIdsData, dims: inputIdDims } = tokenized.input_ids;
  const seqLen = inputIdDims[1];
  const results = new Array(texts.length);

  for (let docIdx = 0; docIdx < texts.length; docIdx++) {
    const allVectors = allVectorsByDoc[docIdx];
    const vectors = [];
    for (let tokenIdx = 0; tokenIdx < allVectors.length; tokenIdx++) {
      const rawId = inputIdsData[docIdx * seqLen + tokenIdx];
      const inputId = typeof rawId === 'bigint' ? Number(rawId) : rawId;
      if (!effectiveSkiplist.has(inputId)) {
        vectors.push(allVectors[tokenIdx]);
      }
    }
    results[docIdx] = poolFactor > 1 ? poolTokens(vectors, poolFactor) : vectors;
  }

  return results;
}

/**
 * Encode documents using the ORT INT8 CPU path (onnxruntime-node, accelerated
 * by the platform BLAS — Accelerate/AMX on Apple Silicon, MKL on x86, etc).
 * Returns the SAME shape as the GPU path so the caller can mix results from
 * both pipelines transparently.
 *
 * Used by the opt-in hybrid dispatcher (SWEET_SEARCH_LI_HYBRID=1) and as the
 * default fallback when the native GPU addon isn't available on the host.
 */
export async function encodeDocumentsCpu(texts, options = {}) {
  const { poolFactor = 1, extendedSkiplist = false } = options;

  const pipeline = await getLateInteractionPipeline();
  if (!pipeline) return texts.map(() => []);

  const { tokenizer, session, modelConfig, skiplistTokenIds, ort, projectionStages } = pipeline;

  // Build effective skiplist (base + optional extended for code)
  let effectiveSkiplist = skiplistTokenIds;
  if (extendedSkiplist) {
    effectiveSkiplist = buildExtendedSkiplist(tokenizer, skiplistTokenIds);
  }

  const prefixedTexts = texts.map((text) => modelConfig.docPrefix + text);
  const t0 = performance.now();
  const tokenized = tokenizer(prefixedTexts, {
    padding: true,
    truncation: true,
    max_length: modelConfig.maxDocLength,
  });
  const t1 = performance.now();
  const hidden = await runRawInference(session, tokenized, ort);
  const t2 = performance.now();

  _timings.tokenize_us += Math.round((t1 - t0) * 1000);
  _timings.inference_us += Math.round((t2 - t1) * 1000);
  _timings.calls++;

  const allVectorsByDoc = projectAndNormalizeBatch(hidden, projectionStages, tokenized.attention_mask);
  const { data: inputIdsData, dims: inputIdDims } = tokenized.input_ids;
  const seqLen = inputIdDims[1];
  const results = new Array(texts.length);

  for (let docIdx = 0; docIdx < texts.length; docIdx++) {
    const allVectors = allVectorsByDoc[docIdx];
    const vectors = [];
    const keptPreNorms = [];
    const srcPreNorms = allVectors.preNorms;
    for (let tokenIdx = 0; tokenIdx < allVectors.length; tokenIdx++) {
      const rawId = inputIdsData[docIdx * seqLen + tokenIdx];
      const inputId = typeof rawId === 'bigint' ? Number(rawId) : rawId;
      if (!effectiveSkiplist.has(inputId)) {
        vectors.push(allVectors[tokenIdx]);
        if (srcPreNorms) keptPreNorms.push(srcPreNorms[tokenIdx]);
      }
    }
    if (srcPreNorms) vectors.preNorms = new Float32Array(keptPreNorms);

    results[docIdx] = poolFactor > 1 ? poolTokens(vectors, poolFactor) : vectors;
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
function projectAndNormalizeBatch(hiddenTensor, projectionStages, attentionMask = null) {
  const [batch, seqLen, hiddenDim] = hiddenTensor.dims;
  let data = new Float32Array(hiddenTensor.data);
  let currentDim = hiddenDim;
  const maskData = attentionMask?.data || null;

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

  // L2 normalize per token, grouped by batch item.
  // Also record pre-normalization norms — these measure how much the model
  // "activated" for each token. Low pre-norm = low information content.
  // Stored on each per-document array for optional norm-based pruning.
  const results = new Array(batch);
  for (let b = 0; b < batch; b++) {
    const vectors = [];
    const preNorms = [];
    for (let s = 0; s < seqLen; s++) {
      if (maskData) {
        const maskValue = maskData[b * seqLen + s];
        if (typeof maskValue === 'bigint' ? maskValue === 0n : maskValue === 0) continue;
      }

      const offset = (b * seqLen + s) * currentDim;
      let norm = 0;
      for (let d = 0; d < currentDim; d++) norm += data[offset + d] * data[offset + d];
      norm = Math.sqrt(norm) + 1e-12;
      preNorms.push(norm);
      const vec = new Float32Array(currentDim);
      for (let d = 0; d < currentDim; d++) vec[d] = data[offset + d] / norm;
      vectors.push(vec);
    }
    vectors.preNorms = new Float32Array(preNorms);
    results[b] = vectors;
  }
  return results;
}

// =========================================================================
// Token Pooling (Phase 7.1)
// =========================================================================

/**
 * Hierarchical token pooling — reduces N tokens to ~N/poolFactor tokens.
 * Uses agglomerative clustering (Ward-like, cosine distance) to merge the
 * most similar tokens first, preserving semantic information far better than
 * consecutive-pair averaging.
 *
 * CRA-1: Replaces naive consecutive-pair pooling with similarity-based
 * hierarchical pooling per LIR'26 Workshop findings (arXiv 2603.22434).
 *
 * First token always preserved (protected_tokens=1, following PyLate convention).
 *
 * @param {Float32Array[]} tokens - L2-normalized token vectors
 * @param {number} poolFactor - Pooling factor (2 = halve, 3 = third, etc.)
 * @returns {Float32Array[]} Pooled and re-normalized token vectors
 */
export function poolTokens(tokens, poolFactor) {
  if (!tokens || tokens.length === 0 || poolFactor <= 1) return tokens;

  const dim = tokens[0].length;

  // Protect first token
  const protectedToken = tokens[0];
  const rest = tokens.length - 1;
  if (rest === 0) return [protectedToken];

  const targetCount = Math.ceil(rest / poolFactor);

  // For very small inputs (≤2 non-protected tokens) or targetCount >= rest,
  // skip clustering overhead.
  if (targetCount >= rest) {
    return tokens;
  }

  // Cap clustering input at 64 non-protected tokens to avoid O(n^3) blowup.
  // If more tokens exist, pre-reduce with consecutive-pair averaging first.
  const CLUSTER_CAP = 64;
  let clusterInput = tokens.slice(1); // non-protected tokens
  if (clusterInput.length > CLUSTER_CAP) {
    const prePoolFactor = Math.ceil(clusterInput.length / CLUSTER_CAP);
    const prePooled = [];
    for (let i = 0; i < clusterInput.length; i += prePoolFactor) {
      const groupEnd = Math.min(i + prePoolFactor, clusterInput.length);
      const groupSize = groupEnd - i;
      const avg = new Float32Array(dim);
      for (let j = i; j < groupEnd; j++) {
        for (let d = 0; d < dim; d++) avg[d] += clusterInput[j][d];
      }
      let norm = 0;
      for (let d = 0; d < dim; d++) { avg[d] /= groupSize; norm += avg[d] * avg[d]; }
      norm = Math.sqrt(norm) + 1e-12;
      for (let d = 0; d < dim; d++) avg[d] /= norm;
      prePooled.push(avg);
    }
    clusterInput = prePooled;
  }

  // Recompute target for the (possibly pre-reduced) input
  const clusterTarget = Math.max(1, Math.min(targetCount, clusterInput.length - 1));
  if (clusterTarget >= clusterInput.length) {
    return [protectedToken, ...clusterInput];
  }
  const restN = clusterInput.length;

  // ---- Agglomerative clustering (average-link, cosine distance) ----
  // Each cluster starts as a single token. We maintain cluster centroids
  // (sum vectors + size) and a condensed distance matrix.

  // Cluster state: indices 0..restN-1 map to clusterInput[0..restN-1]
  const clusterSum = new Array(restN);
  const clusterSize = new Uint16Array(restN);
  const alive = new Uint8Array(restN); // 1 = active cluster

  for (let i = 0; i < restN; i++) {
    clusterSum[i] = new Float32Array(clusterInput[i]);
    clusterSize[i] = 1;
    alive[i] = 1;
  }

  // Condensed upper-triangular cosine distance matrix.
  // For L2-normalized vectors, cosine_distance = 1 - dot(a, b).
  const nPairs = (restN * (restN - 1)) >> 1;
  const dist = new Float32Array(nPairs);

  for (let i = 0; i < restN; i++) {
    const vi = clusterInput[i];
    for (let j = i + 1; j < restN; j++) {
      const vj = clusterInput[j];
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += vi[d] * vj[d];
      dist[i * restN - ((i * (i + 1)) >> 1) + j - i - 1] = 1 - dot;
    }
  }

  let numClusters = restN;

  // Merge until we reach clusterTarget
  while (numClusters > clusterTarget) {
    let minDist = Infinity;
    let mi = -1, mj = -1;

    for (let i = 0; i < restN; i++) {
      if (!alive[i]) continue;
      for (let j = i + 1; j < restN; j++) {
        if (!alive[j]) continue;
        const idx = i * restN - ((i * (i + 1)) >> 1) + j - i - 1;
        if (dist[idx] < minDist) {
          minDist = dist[idx];
          mi = i;
          mj = j;
        }
      }
    }

    if (mi < 0) break;

    const sizeI = clusterSize[mi];
    const sizeJ = clusterSize[mj];
    const newSize = sizeI + sizeJ;

    for (let d = 0; d < dim; d++) {
      clusterSum[mi][d] += clusterSum[mj][d];
    }
    clusterSize[mi] = newSize;
    alive[mj] = 0;
    numClusters--;

    // Update distances from mi to all other alive clusters.
    const centroid = new Float32Array(dim);
    let cNorm = 0;
    for (let d = 0; d < dim; d++) {
      centroid[d] = clusterSum[mi][d] / newSize;
      cNorm += centroid[d] * centroid[d];
    }
    cNorm = Math.sqrt(cNorm) + 1e-12;
    for (let d = 0; d < dim; d++) centroid[d] /= cNorm;

    for (let k = 0; k < restN; k++) {
      if (!alive[k] || k === mi) continue;
      const sk = clusterSize[k];
      let dot = 0;
      for (let d = 0; d < dim; d++) {
        dot += centroid[d] * (clusterSum[k][d] / sk);
      }
      let kNorm = 0;
      for (let d = 0; d < dim; d++) {
        const v = clusterSum[k][d] / sk;
        kNorm += v * v;
      }
      kNorm = Math.sqrt(kNorm) + 1e-12;

      const newDist = 1 - dot / kNorm;
      const lo = Math.min(mi, k);
      const hi = Math.max(mi, k);
      const idx = lo * restN - ((lo * (lo + 1)) >> 1) + hi - lo - 1;
      dist[idx] = newDist;
    }
  }

  // ---- Extract pooled tokens ----
  const pooled = [protectedToken];

  for (let i = 0; i < restN; i++) {
    if (!alive[i]) continue;
    const avg = new Float32Array(dim);
    const s = clusterSize[i];
    for (let d = 0; d < dim; d++) avg[d] = clusterSum[i][d] / s;

    // L2 re-normalize
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += avg[d] * avg[d];
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
  // Fast path: native tokenizer always produces BigInt64Array via formatResult.
  // Fallback uses Uint32Array overlay to avoid BigInt() heap allocations.
  let idData = tokenized.input_ids.data;
  if (!(idData instanceof BigInt64Array)) {
    const src = tokenized.input_ids.data;
    idData = new BigInt64Array(src.length);
    const u32 = new Uint32Array(idData.buffer);
    for (let i = 0; i < src.length; i++) u32[i * 2] = Number(src[i]);
  }
  let maskData = tokenized.attention_mask.data;
  if (!(maskData instanceof BigInt64Array)) {
    const src = tokenized.attention_mask.data;
    maskData = new BigInt64Array(src.length);
    const u32 = new Uint32Array(maskData.buffer);
    for (let i = 0; i < src.length; i++) u32[i * 2] = Number(src[i]);
  }

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

/**
 * Resolve or download a model file from HuggingFace using the managed model fetcher.
 * Checks local cache first (with checksum validation for LFS files).
 * Respects MODEL_DELIVERY_CONFIG.allowRuntimeModelDownload.
 */
async function resolveOrFetchFile(hfId, filePath, registryKey) {
  const entry = getModelEntry(registryKey);
  const fileInfo = entry?.files.find(f => f.path === filePath);

  const destDir = getModelCacheDir(hfId);
  return fetchModelFile(hfId, filePath, destDir, {
    sha256: fileInfo?.sha256 || undefined,
    expectedSize: fileInfo?.sizeBytes || undefined,
  });
}
