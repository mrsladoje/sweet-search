/**
 * Embedding Local Model - ONNX-based local embedding inference.
 * Extracted from embedding-service.js for file size compliance (<500 lines).
 */

import crypto from 'crypto';
import { existsSync, readFileSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { EMBEDDING_PROVIDERS } from './config.js';

// =============================================================================
// SEQUENCE LENGTH CONSTANTS (L2: configurable via env)
// =============================================================================

export const INDEXING_MAX_LENGTH = parseInt(process.env.SWEET_SEARCH_INDEXING_MAX_LENGTH || '512', 10);
export const QUERY_MAX_LENGTH = parseInt(process.env.SWEET_SEARCH_QUERY_MAX_LENGTH || '512', 10);

// =============================================================================
// ONNX SESSION HELPERS
// =============================================================================

export function bestIntraOpThreads() {
  const logicalCores = Math.max(1, os.cpus().length);
  const override = Number.parseInt(process.env.SWEET_SEARCH_INTRA_OP_THREADS ?? '', 10);
  if (Number.isFinite(override) && override > 0) {
    return Math.min(override, logicalCores);
  }

  const physicalCores = Math.max(1, Math.ceil(logicalCores / 2));
  const baseline = Math.min(Math.max(1, physicalCores - 1), 8);

  // Avoid single-thread inference bottlenecks on small but multi-core machines.
  if (logicalCores >= 4) return Math.max(2, baseline);
  return baseline;
}

export function isIntelCpu() {
  const model = os.cpus()?.[0]?.model || '';
  return model.toLowerCase().includes('intel');
}

let openVinoProviderAvailable = null;

export function isOpenVinoProviderAvailable() {
  if (openVinoProviderAvailable !== null) return openVinoProviderAvailable;

  const candidateRoots = [
    path.resolve('node_modules/onnxruntime-node/bin'),
    path.resolve('node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin'),
  ];

  const stack = candidateRoots.filter(existsSync);
  while (stack.length > 0) {
    const current = stack.pop();
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (entry.name.toLowerCase().includes('openvino')) {
          openVinoProviderAvailable = true;
          return true;
        }
      }
    } catch {
      // Ignore unreadable directories.
    }
  }

  openVinoProviderAvailable = false;
  return false;
}

export function shouldUseOpenVino(openVinoAvailable = isOpenVinoProviderAvailable()) {
  const raw = (process.env.SWEET_SEARCH_USE_OPENVINO ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  if (!isIntelCpu()) return false;

  const autoMode = raw === '' || raw === 'auto';
  const explicitOn = raw === '1' || raw === 'true' || raw === 'on';
  if (!autoMode && !explicitOn) return false;

  // Enable only when the runtime bundle exposes OpenVINO provider artifacts.
  return openVinoAvailable;
}

/**
 * Resolve which model repo to load based on quantization mode.
 * - quantized=true  → quantizedModel (INT8, ~132 MB, ~2× faster)
 * - quantized=false → model (FP32, ~522 MB, baseline)
 */
export function resolveLocalModelName(quantized) {
  if (quantized && EMBEDDING_PROVIDERS.local.quantizedModel) {
    return EMBEDDING_PROVIDERS.local.quantizedModel;
  }
  return EMBEDDING_PROVIDERS.local.model;
}

/**
 * L3b: Return path for the ORT-optimized model graph cache.
 * Uses the actual model name in the hash so FP32 and INT8 never share a cache file.
 */
export function getOptimizedModelPath(quantLabel = 'q8') {
  const cacheDir = path.join(os.homedir(), '.cache', 'sweet-search');
  mkdirSync(cacheDir, { recursive: true });

  let ortVersion = 'unknown';
  try {
    const ortPkg = JSON.parse(readFileSync(
      path.resolve('node_modules/onnxruntime-node/package.json'), 'utf8'
    ));
    ortVersion = ortPkg.version;
  } catch {
    // ORT pulled in transitively; version unknown is fine
  }

  const isQuantized = quantLabel !== 'fp32';
  const modelName = resolveLocalModelName(isQuantized);
  const modelHash = crypto.createHash('sha256')
    .update(modelName)
    .digest('hex')
    .slice(0, 12);

  return path.join(cacheDir, `coderankembed-optimized-ort${ortVersion}-${quantLabel}-${modelHash}.onnx`);
}

export function getCalibrationFactor() {
  return 4;
}

export function buildLocalSessionOptions(quantLabel = 'q8') {
  const sessionOptions = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: bestIntraOpThreads(),
    interOpNumThreads: 2,
    executionMode: 'parallel',
    enableCpuMemArena: true,
    enableMemPattern: true,
    optimizedModelFilePath: getOptimizedModelPath(quantLabel),
  };

  if (shouldUseOpenVino()) {
    sessionOptions.executionProviders = [
      { name: 'OpenVINOExecutionProvider' },
      'CPUExecutionProvider',
    ];
  }

  return sessionOptions;
}

/**
 * Resolve quantization mode from env var.
 * Returns { quantized: bool, label: string }
 */
export function resolveQuantizationMode() {
  const raw = (process.env.SWEET_SEARCH_LOCAL_QUANTIZED ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false') return { quantized: false, label: 'fp32' };
  return { quantized: true, label: 'q8' };
}

export async function createLocalPipeline(pipelineFactory, sessionOptions) {
  const { quantized, label } = resolveQuantizationMode();
  const modelName = resolveLocalModelName(quantized);
  const keyCandidates = ['session_options', 'sessionOptions'];
  let lastError = null;

  for (const key of keyCandidates) {
    try {
      const opts = { quantized, [key]: sessionOptions };
      const candidate = await pipelineFactory('feature-extraction', modelName, opts);
      candidate.__sweetSessionKey = key;
      candidate.__sweetQuantized = label;
      return candidate;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to create local embedding pipeline');
}

// =============================================================================
// POOLING AND NORMALIZATION
// =============================================================================

export function maskIsActive(maskValue) {
  return typeof maskValue === 'bigint' ? maskValue !== 0n : maskValue !== 0;
}

export function l2NormalizeRowsInPlace(data, rows, cols) {
  for (let r = 0; r < rows; r++) {
    const offset = r * cols;
    let normSq = 0;
    for (let c = 0; c < cols; c++) {
      const v = data[offset + c];
      normSq += v * v;
    }

    const norm = Math.sqrt(normSq);
    if (norm > 0) {
      const inv = 1 / norm;
      for (let c = 0; c < cols; c++) {
        data[offset + c] *= inv;
      }
    }
  }
}

export function meanPoolWithAttentionMask(tokenEmbeddings, attentionMask, normalize = true) {
  const dims = tokenEmbeddings?.dims || [];
  if (dims.length !== 3) {
    throw new Error(`[L1] Expected dims [batch, seq, hidden], got [${dims.join(', ')}]`);
  }

  const [batchSize, seqLength, hiddenSize] = dims;
  const pooled = new Float32Array(batchSize * hiddenSize);
  const tokenData = tokenEmbeddings.data;
  const maskData = attentionMask?.data || null;

  for (let b = 0; b < batchSize; b++) {
    const rowOffset = b * hiddenSize;
    let validTokens = 0;

    for (let t = 0; t < seqLength; t++) {
      const maskOffset = b * seqLength + t;
      if (maskData && !maskIsActive(maskData[maskOffset])) continue;

      validTokens++;
      const tokenOffset = (b * seqLength + t) * hiddenSize;
      for (let h = 0; h < hiddenSize; h++) {
        pooled[rowOffset + h] += tokenData[tokenOffset + h];
      }
    }

    const denom = validTokens > 0 ? validTokens : 1;
    const inv = 1 / denom;
    for (let h = 0; h < hiddenSize; h++) {
      pooled[rowOffset + h] *= inv;
    }
  }

  if (normalize) {
    l2NormalizeRowsInPlace(pooled, batchSize, hiddenSize);
  }

  return {
    data: pooled,
    batchSize,
    dim: hiddenSize,
  };
}

export function extractPooledEmbeddings(outputs, attentionMask, normalize = true) {
  const candidate = outputs?.last_hidden_state || outputs?.logits || outputs?.token_embeddings;
  if (!candidate?.dims || !candidate?.data) {
    throw new Error('[L1] Model output missing tensor data for feature extraction');
  }

  if (candidate.dims.length === 3) {
    return meanPoolWithAttentionMask(candidate, attentionMask, normalize);
  }

  if (candidate.dims.length === 2) {
    const [batchSize, dim] = candidate.dims;
    const data = new Float32Array(candidate.data.length);
    data.set(candidate.data);
    if (normalize) {
      l2NormalizeRowsInPlace(data, batchSize, dim);
    }
    return { data, batchSize, dim };
  }

  throw new Error(`[L1] Unsupported tensor shape: [${candidate.dims.join(', ')}]`);
}

// =============================================================================
// PIPELINE SINGLETON
// =============================================================================

let localPipeline = null;
let isLoadingLocal = false;
let loadPromise = null;

const DIRECT_ORT_ENABLED = (process.env.SWEET_SEARCH_DIRECT_ORT ?? '1') !== '0';
let directOrtFailed = false;

export async function getLocalPipeline() {
  if (localPipeline) return localPipeline;
  if (isLoadingLocal && loadPromise) return loadPromise;

  isLoadingLocal = true;
  loadPromise = (async () => {
    const start = Date.now();
    const { quantized: isQuantized } = resolveQuantizationMode();
    console.log(`Loading local model: ${resolveLocalModelName(isQuantized)}...`);
    let pipeline;
    try {
      ({ pipeline } = await import('@huggingface/transformers'));
    } catch {
      ({ pipeline } = await import('@xenova/transformers'));
    }

    const { label: quantLabel } = resolveQuantizationMode();

    const sessionOptions = buildLocalSessionOptions(quantLabel);
    let backend = sessionOptions.executionProviders ? 'openvino+cpu' : 'cpu';

    try {
      localPipeline = await createLocalPipeline(pipeline, sessionOptions);
    } catch (err) {
      if (sessionOptions.executionProviders) {
        console.warn(`[L5] OpenVINO session init failed (${err.message}), retrying with CPUExecutionProvider only`);
        const cpuOnlyOptions = buildLocalSessionOptions(quantLabel);
        delete cpuOnlyOptions.executionProviders;
        localPipeline = await createLocalPipeline(pipeline, cpuOnlyOptions);
        backend = 'cpu';
      } else {
        throw err;
      }
    }

    await localPipeline(["warmup"], { pooling: 'mean', normalize: true, truncation: true, max_length: 64 });

    if (DIRECT_ORT_ENABLED) {
      const ortSession = localPipeline.model?.sessions?.['model'];
      if (ortSession?.run && ortSession?.inputNames) {
        console.log(`[L7] Direct ORT: inputs=[${ortSession.inputNames}], outputs=[${ortSession.outputNames}]`);
      }
    }

    const optimizedPath = getOptimizedModelPath(quantLabel);
    if (!existsSync(optimizedPath)) {
      console.warn(`[L3b] Optimized model file was not materialized at ${optimizedPath}. Session options may not be fully forwarded.`);
    }

    console.log(`Local model loaded in ${Date.now() - start}ms (threads: ${bestIntraOpThreads()}, backend: ${backend}, quantized: ${localPipeline.__sweetQuantized ?? true}, sessionKey: ${localPipeline.__sweetSessionKey || 'unknown'})`);
    isLoadingLocal = false;
    return localPipeline;
  })();

  return loadPromise;
}

// =============================================================================
// L7: DIRECT ORT SESSION BYPASS
// =============================================================================

/**
 * L7: Direct ORT session bypass — skip HuggingFace pipeline wrapper overhead.
 * Uses the same ORT session and tokenized inputs for bit-identical output.
 */
async function runDirectOrt(pipeline, modelInputs) {
  const session = pipeline.model.sessions['model'];
  const feed = {};

  for (const name of session.inputNames) {
    const hfTensor = modelInputs[name];
    if (hfTensor?.ort_tensor) {
      feed[name] = hfTensor.ort_tensor;
    } else if (name === 'token_type_ids') {
      // Replicate encoderForward's zeros_like(input_ids) for models expecting token_type_ids
      const ref = modelInputs.input_ids.ort_tensor;
      const size = ref.dims.reduce((a, b) => a * b, 1);
      feed[name] = new ref.constructor('int64', new BigInt64Array(size), ref.dims);
    } else {
      throw new Error(`[L7] Missing model input: ${name}`);
    }
  }

  return session.run(feed);
}

// =============================================================================
// CORE INFERENCE FUNCTIONS
// =============================================================================

/**
 * L1: True batch inference for local model.
 * Returns Float32Array subarray views from a per-batch pool (zero-copy downstream).
 */
export async function callLocalModel(texts, options = {}) {
  if (!texts || texts.length === 0) return [];

  const pipeline = await getLocalPipeline();
  const { maxLength = INDEXING_MAX_LENGTH } = options;

  const modelInputs = pipeline.tokenizer(texts, {
    padding: true,
    truncation: true,
    max_length: maxLength,
  });

  let outputs;
  if (DIRECT_ORT_ENABLED && !directOrtFailed && pipeline.model?.sessions?.['model']) {
    try {
      outputs = await runDirectOrt(pipeline, modelInputs);
    } catch (err) {
      directOrtFailed = true;
      console.warn(`[L7] Direct ORT failed, falling back to pipeline: ${err.message}`);
      outputs = await pipeline.model(modelInputs);
    }
  } else {
    outputs = await pipeline.model(modelInputs);
  }

  const pooled = extractPooledEmbeddings(outputs, modelInputs.attention_mask, true);
  const { data, batchSize, dim } = pooled;

  if (batchSize !== texts.length) {
    throw new Error(`[L1] Output count mismatch: got ${batchSize} embeddings for ${texts.length} texts`);
  }

  const expectedDim = EMBEDDING_PROVIDERS.local.dimensions.full;
  if (dim !== expectedDim) {
    console.warn(`[L1] Local embedding dim mismatch: expected ${expectedDim}, got ${dim}`);
  }

  const pool = new Float32Array(batchSize * dim);
  pool.set(data);

  const embeddings = new Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    embeddings[i] = pool.subarray(i * dim, (i + 1) * dim);
  }
  if (process.env.NODE_ENV !== 'production') Object.freeze(embeddings);
  return embeddings;
}

/**
 * L0: Length-sorted bucketing for local model batch inference.
 */
export async function callLocalModelBucketed(texts, options = {}) {
  const maxLength = options.maxLength ?? INDEXING_MAX_LENGTH;

  const charPerToken = getCalibrationFactor();
  const batchingSafety = options.batchingSafety
    ?? Number(process.env.SWEET_SEARCH_BATCHING_SAFETY ?? 1.15);
  const indexed = texts.map((text, i) => {
    const est = Math.ceil((text.length / charPerToken) * batchingSafety);
    const estTokens = Math.max(1, Math.min(est, maxLength));
    return { text, origIdx: i, estTokens };
  });
  indexed.sort((a, b) => a.estTokens - b.estTokens);

  const embeddings = new Array(texts.length);
  let i = 0;

  while (i < indexed.length) {
    const tokenBudget = 16384;
    const baseHardCap = options.hardCap ?? (maxLength <= 256 ? 128 : 64);
    const resolveHardCap = options.resolveHardCap ?? (() => baseHardCap);
    const memCapBytes = 512 * 1024 * 1024;
    const memGuardHighWatermark = 0.85;

    let batchSize = 1;
    while (i + batchSize < indexed.length) {
      const rawEst = indexed[i + batchSize].estTokens;
      const candidateLongest = Math.min(rawEst, maxLength);
      const candidateCount = batchSize + 1;
      const candidateHardCap = resolveHardCap(candidateLongest);
      if (candidateCount > candidateHardCap) break;
      if (candidateLongest * candidateCount > tokenBudget) break;
      batchSize = candidateCount;
    }

    const rss = process.memoryUsage().rss;
    if (
      !process.env.SWEET_SEARCH_DISABLE_MEM_GUARD &&
      rss > memCapBytes * memGuardHighWatermark
    ) {
      batchSize = Math.max(1, Math.floor(batchSize / 2));
    }

    const batch = indexed.slice(i, i + batchSize);
    const batchTexts = batch.map(b => b.text);
    const batchEmbeddings = await callLocalModel(batchTexts, { maxLength });

    for (let j = 0; j < batch.length; j++) {
      embeddings[batch[j].origIdx] = batchEmbeddings[j];
    }
    i += batchSize;
  }

  return embeddings;
}

// =============================================================================
// QUERY PREFIX
// =============================================================================

export function applyLocalQueryPrefix(text) {
  const prefix = EMBEDDING_PROVIDERS.local?.queryPrefix || '';
  if (prefix && !text.startsWith(prefix)) {
    return prefix + text;
  }
  return text;
}

// =============================================================================
// LIFECYCLE
// =============================================================================

export function unloadLocalModel() {
  localPipeline = null;
  isLoadingLocal = false;
  loadPromise = null;
  directOrtFailed = false;
}

export function isLocalModelLoaded() {
  return localPipeline !== null;
}
