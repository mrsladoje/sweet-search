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
// CoreML not used for LI models — see loadModel() comment for benchmarking rationale.

let lateInteractionPipeline = null;
let loadPromise = null;
let lateInteractionRuntimeConfig = {
  intraOpThreads: null,
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

export function configureLateInteractionRuntime(overrides = {}) {
  lateInteractionRuntimeConfig = {
    ...lateInteractionRuntimeConfig,
    ...overrides,
  };
}

export function resetLateInteractionRuntime() {
  lateInteractionRuntimeConfig = {
    intraOpThreads: null,
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
  // Phase 1a/1c: LI session options benchmarked on Apple Silicon (M3 Max).
  // Findings: graphOptimizationLevel 'all' triggers NchwcTransformer → 14% regression.
  // 'extended' + memArena + memPattern: marginal overhead for no measurable gain.
  // Conclusion: keep LI session lean. Only proven-beneficial options added.
  const { getOptimizedGraphPath } = await import('../infrastructure/onnx-session-utils.js');
  const session = await ort.InferenceSession.create(onnxPath, {
    executionProviders: ['cpu'],
    intraOpNumThreads: lateInteractionRuntimeConfig.intraOpThreads ?? bestIntraOpThreads(),
    interOpNumThreads: 1,
    optimizedModelFilePath: getOptimizedGraphPath(modelConfig.hfId, 'lateon'),
    // Thread spinning keeps ORT worker threads hot between batches — trades idle
    // CPU for lower per-batch latency during sustained indexing runs.
    extra: {
      session: {
        intra_op: { allow_spinning: '1' },
      },
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
