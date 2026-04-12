/**
 * Embedding Local Model - ONNX-based local embedding inference.
 * Extracted from embedding-service.js for file size compliance (<500 lines).
 */

import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { join } from 'path';
import os from 'os';
import { EMBEDDING_PROVIDERS } from '../infrastructure/config/index.js';
import { fetchModel, getModelCacheDir } from '../infrastructure/model-fetcher.js';
import { getModelEntry } from '../infrastructure/model-registry.js';
import { isAppleSilicon, isCoreMLProviderAvailable, shouldUseCoreML, getCoreMLExecutionProviders } from '../infrastructure/coreml-provider.js';
import { createTokenizer } from '../infrastructure/native-tokenizer.js';
import { initOrt, buildFeed } from '../infrastructure/ort-pipeline.js';
import { isNativeInferenceAvailable, nativeEmbed } from '../infrastructure/native-inference.js';

// =============================================================================
// SEQUENCE LENGTH CONSTANTS (L2: configurable via env)
// =============================================================================

export const INDEXING_MAX_LENGTH = parseInt(process.env.SWEET_SEARCH_INDEXING_MAX_LENGTH || '512', 10);
export const QUERY_MAX_LENGTH = parseInt(process.env.SWEET_SEARCH_QUERY_MAX_LENGTH || '512', 10);

// =============================================================================
// ONNX SESSION HELPERS
// =============================================================================

// Import + re-export from infrastructure (canonical location)
import { bestIntraOpThreads, defaultOrtExecutionMode } from '../infrastructure/onnx-session-utils.js';
export { bestIntraOpThreads };

export function isIntelCpu() {
  const model = os.cpus()?.[0]?.model || '';
  return model.toLowerCase().includes('intel');
}

let openVinoProviderAvailable = null;
let localModelRuntimeConfig = {
  intraOpThreads: null,
  interOpThreads: null,
  executionMode: null,
};

export function configureLocalModelRuntime(overrides = {}) {
  localModelRuntimeConfig = {
    ...localModelRuntimeConfig,
    ...overrides,
  };
}

export function resetLocalModelRuntime() {
  localModelRuntimeConfig = {
    intraOpThreads: null,
    interOpThreads: null,
    executionMode: null,
  };
}

export function isOpenVinoProviderAvailable() {
  if (openVinoProviderAvailable !== null) return openVinoProviderAvailable;

  const candidateRoots = [
    path.resolve('node_modules/onnxruntime-node/bin'),
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

export function buildLocalSessionOptions(quantLabel = 'q8', coremlAvailable = false, runtimeConfig = {}) {
  const executionMode = runtimeConfig.executionMode
    ?? localModelRuntimeConfig.executionMode
    ?? process.env.SWEET_SEARCH_ORT_EXEC_MODE
    ?? defaultOrtExecutionMode();
  const interOpThreads = runtimeConfig.interOpThreads
    ?? localModelRuntimeConfig.interOpThreads
    ?? parseInt(process.env.SWEET_SEARCH_ORT_INTER_OP_THREADS || '1', 10);
  const intraOpThreads = runtimeConfig.intraOpThreads
    ?? localModelRuntimeConfig.intraOpThreads
    ?? bestIntraOpThreads(runtimeConfig);

  const sessionOptions = {
    graphOptimizationLevel: 'all',
    intraOpNumThreads: intraOpThreads,
    interOpNumThreads: interOpThreads,
    executionMode,
    enableCpuMemArena: true,
    enableMemPattern: true,
    optimizedModelFilePath: getOptimizedModelPath(quantLabel),
  };

  // Thread spinning keeps ORT worker threads hot-looping for work instead of
  // sleeping on OS primitives. Trades idle CPU for lower per-batch latency.
  sessionOptions.extra = {
    session: {
      intra_op: { allow_spinning: '1' },
    },
  };

  if (shouldUseOpenVino()) {
    // Note: OpenVINO EP is not bundled in onnxruntime-node 1.24 for macOS.
    // On Intel Linux builds where it is bundled, the lowercase name is required.
    sessionOptions.executionProviders = [
      { name: 'openvino' },
      'cpu',
    ];
  } else if (shouldUseCoreML(coremlAvailable)) {
    sessionOptions.executionProviders = getCoreMLExecutionProviders();
  }

  return sessionOptions;
}

/**
 * Resolve quantization mode from env var.
 * Returns { quantized: bool, label: string }
 *
 * Note: FP32 mode (SWEET_SEARCH_LOCAL_QUANTIZED=0) is not supported with the
 * managed model cache — the FP32 model (jalipalo/CodeRankEmbed-onnx) is not
 * in the registry. If explicitly set to false, warn and fall back to INT8.
 */
export function resolveQuantizationMode() {
  const raw = (process.env.SWEET_SEARCH_LOCAL_QUANTIZED ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false') {
    console.warn('[L1] SWEET_SEARCH_LOCAL_QUANTIZED=false requested but FP32 model is not in managed cache. Using INT8.');
  }
  return { quantized: true, label: 'q8' };
}

/** Registry key for the managed embedding model. */
const EMBEDDING_REGISTRY_KEY = 'coderankembed-int8';

/**
 * Resolve the ONNX model file path from the managed model cache.
 */
function resolveOnnxModelPath() {
  const entry = getModelEntry(EMBEDDING_REGISTRY_KEY);
  const onnxFile = entry.files.find(f => f.path.endsWith('.onnx'));
  return join(getModelCacheDir(entry.hfId), onnxFile.path);
}

/**
 * Resolve the tokenizer.json path from the managed model cache.
 */
function resolveTokenizerPath() {
  const entry = getModelEntry(EMBEDDING_REGISTRY_KEY);
  return join(getModelCacheDir(entry.hfId), 'tokenizer.json');
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
// TIMING INSTRUMENTATION (Phase 0 — per-batch profiling)
// =============================================================================

const _embeddingTimings = { tokenize_us: 0, inference_us: 0, pool_us: 0, calls: 0, totalTexts: 0 };

/** Read and reset accumulated embedding timings. */
export function getEmbeddingTimings() {
  const snap = { ..._embeddingTimings };
  _embeddingTimings.tokenize_us = 0;
  _embeddingTimings.inference_us = 0;
  _embeddingTimings.pool_us = 0;
  _embeddingTimings.calls = 0;
  _embeddingTimings.totalTexts = 0;
  return snap;
}

// =============================================================================
// WORKER POOL LIFECYCLE (Phase 2 — parallel ORT inference via worker_threads)
// =============================================================================

let _embeddingPool = null;

/** Initialize the embedding worker pool for parallel inference during indexing. */
export async function initEmbeddingPool(options = {}) {
  if (_embeddingPool) return _embeddingPool;
  const { EmbeddingPool } = await import('../indexing/indexer-pool.js');
  _embeddingPool = new EmbeddingPool(options);
  await _embeddingPool.init();
  return _embeddingPool;
}

/** Shutdown the embedding worker pool. */
export async function shutdownEmbeddingPool() {
  if (_embeddingPool) {
    await _embeddingPool.shutdown();
    _embeddingPool = null;
  }
}

/** Get the active pool (null if not initialized). */
export function getEmbeddingPool() { return _embeddingPool; }

async function embedBatchesWithPool(pool, batches, maxLength) {
  const results = new Array(batches.length);
  const waveSize = Math.max(1, Math.min(pool.numWorkers || 1, batches.length));
  for (let i = 0; i < batches.length; i += waveSize) {
    const wave = batches.slice(i, i + waveSize);
    const waveResults = await Promise.all(
      wave.map(batch => pool.embed(batch.map(item => item.text), { maxLength }))
    );
    for (let j = 0; j < wave.length; j++) {
      results[i + j] = waveResults[j];
    }
  }
  return results;
}

// =============================================================================
// PIPELINE SINGLETON
// =============================================================================

let localPipeline = null;
let isLoadingLocal = false;
let loadPromise = null;

export async function getLocalPipeline() {
  if (localPipeline) return localPipeline;
  if (isLoadingLocal && loadPromise) return loadPromise;

  isLoadingLocal = true;
  loadPromise = (async () => {
    const start = Date.now();
    const { quantized: isQuantized, label: quantLabel } = resolveQuantizationMode();
    console.log(`Loading local model: ${resolveLocalModelName(isQuantized)}...`);

    // Fetch model files to managed cache (verifies checksums, respects allowRuntimeModelDownload)
    await fetchModel('coderankembed-int8');

    const ort = await initOrt();
    const onnxPath = resolveOnnxModelPath();
    const tokenizerPath = resolveTokenizerPath();

    // Phase 1d: CoreML detection with persistent failure cache.
    // ORT 1.24.3 can't serialize models with CoreML compiled nodes, causing a
    // ~12s cold-start penalty from 3 failed session attempts. Cache the failure
    // so subsequent loads skip CoreML probing entirely.
    const coremlFlagPath = path.join(os.homedir(), '.cache', 'sweet-search', '.coreml-embedding-failed');
    let coremlAvailable = false;
    if (isAppleSilicon() && !existsSync(coremlFlagPath)) {
      coremlAvailable = await isCoreMLProviderAvailable();
    }
    const sessionOptions = buildLocalSessionOptions(quantLabel, coremlAvailable);
    let backend = 'cpu';
    if (sessionOptions.executionProviders) {
      const names = sessionOptions.executionProviders.map(ep => typeof ep === 'string' ? ep : ep.name);
      backend = names.includes('coreml') ? 'coreml+cpu' : 'openvino+cpu';
    }

    let session;
    try {
      session = await ort.InferenceSession.create(onnxPath, sessionOptions);
    } catch (err) {
      if (sessionOptions.executionProviders) {
        const epName = backend.split('+')[0];
        if (epName === 'coreml') {
          console.warn(`[L5] CoreML MLProgram failed (${err.message}), trying NeuralNetwork format`);
          try {
            const nnOptions = buildLocalSessionOptions(quantLabel);
            nnOptions.executionProviders = getCoreMLExecutionProviders(false);
            session = await ort.InferenceSession.create(onnxPath, nnOptions);
            backend = 'coreml-nn+cpu';
          } catch {
            console.warn('[L5] CoreML NeuralNetwork also failed, falling back to CPU only');
            // Cache the failure to avoid ~12s cold-start penalty next time
            try { mkdirSync(path.dirname(coremlFlagPath), { recursive: true }); } catch { /* ok */ }
            try { writeFileSync(coremlFlagPath, new Date().toISOString()); } catch { /* best effort */ }
            const cpuOnlyOptions = buildLocalSessionOptions(quantLabel);
            delete cpuOnlyOptions.executionProviders;
            session = await ort.InferenceSession.create(onnxPath, cpuOnlyOptions);
            backend = 'cpu';
          }
        } else {
          console.warn(`[L5] ${epName} session init failed (${err.message}), retrying with CPU only`);
          const cpuOnlyOptions = buildLocalSessionOptions(quantLabel);
          delete cpuOnlyOptions.executionProviders;
          session = await ort.InferenceSession.create(onnxPath, cpuOnlyOptions);
          backend = 'cpu';
        }
      } else {
        throw err;
      }
    }

    const tokenizer = await createTokenizer(tokenizerPath);

    // Warmup: ORT needs 10+ inference passes to stabilize JIT compilation,
    // memory pool sizing, and thread pool scheduling. Warmup at production
    // batch sizes so ORT's memory planner pre-allocates the right arenas.
    // Short texts (batch 16) + medium texts (batch 8) + long texts (batch 4).
    const warmupShort = Array.from({ length: 16 }, (_, i) =>
      `function f${i}() { return ${i}; }`);
    const warmupMedium = Array.from({ length: 8 }, (_, i) =>
      `export class Service${i} { constructor(private db) {} async find(id) { const row = await this.db.query("SELECT * FROM t WHERE id = ?", [id]); return row; } async update(id, data) { await this.db.run("UPDATE t SET v = ? WHERE id = ?", [data, id]); } }`);
    const warmupLong = Array.from({ length: 4 }, (_, i) =>
      `/**\n * Module ${i}: handles complex business logic including validation,\n * transformation, caching, and event emission across multiple\n * bounded contexts. Each method delegates to specialized services\n * and aggregates results before returning to the caller.\n */\nexport class ComplexModule${i} {\n  constructor(private svc, private cache, private events) {}\n  async process(input) {\n    const validated = this.svc.validate(input);\n    const cached = await this.cache.get(validated.key);\n    if (cached) return cached;\n    const result = await this.svc.transform(validated);\n    await this.cache.set(validated.key, result);\n    this.events.emit('processed', { module: ${i}, key: validated.key });\n    return result;\n  }\n}`);
    const warmupSets = [warmupShort, warmupMedium, warmupLong];
    for (let pass = 0; pass < 10; pass++) {
      const texts = warmupSets[pass % warmupSets.length];
      const warmupTokenized = tokenizer(texts, { padding: true, truncation: true, max_length: INDEXING_MAX_LENGTH });
      const warmupFeed = buildFeed(warmupTokenized, session.inputNames);
      await session.run(warmupFeed);
    }

    console.log(`[ORT] Direct session: inputs=[${session.inputNames}], outputs=[${session.outputNames}]`);

    const optimizedPath = getOptimizedModelPath(quantLabel);
    if (!existsSync(optimizedPath)) {
      console.warn(`[L3b] Optimized model file was not materialized at ${optimizedPath}. Session options may not be fully forwarded.`);
    }

    localPipeline = { session, tokenizer, quantLabel, backend };

    console.log(`Local model loaded in ${Date.now() - start}ms (threads: ${sessionOptions.intraOpNumThreads}, backend: ${backend}, quantized: ${quantLabel})`);
    isLoadingLocal = false;
    return localPipeline;
  })();

  return loadPromise;
}

// =============================================================================
// CORE INFERENCE FUNCTIONS
// =============================================================================

/**
 * L1: True batch inference for local model.
 * Uses native candle inference (FP32, Metal GPU) when available,
 * falls back to ORT INT8 session.
 * Returns Float32Array subarray views from a per-batch pool (zero-copy downstream).
 */
export async function callLocalModel(texts, options = {}) {
  // Default dispatcher: pick the best path. Hybrid CPU+GPU dispatching is
  // done at callLocalModelBucketed (which sees the full batch list and can
  // run both encoders in parallel).
  if (!texts || texts.length === 0) return [];
  if (isNativeInferenceAvailable()) {
    return callLocalModelGpu(texts, options);
  }
  return callLocalModelCpu(texts, options);
}

/**
 * Native Metal GPU embedding (candle + Metal SDPA, F16). Throws if the
 * native addon isn't loaded — caller is expected to verify availability.
 */
export async function callLocalModelGpu(texts, options = {}) {
  if (!texts || texts.length === 0) return [];
  const { maxLength = INDEXING_MAX_LENGTH } = options;
  const t0 = performance.now();
  const embeddings = await nativeEmbed(texts, { maxLength });
  const t1 = performance.now();
  _embeddingTimings.inference_us += Math.round((t1 - t0) * 1000);
  _embeddingTimings.calls++;
  _embeddingTimings.totalTexts += texts.length;
  return embeddings;
}

/**
 * ORT INT8 CPU embedding (onnxruntime-node, accelerated by the platform BLAS).
 * Returns the same shape as the GPU path so callers can mix results
 * transparently from a hybrid dispatcher, and serves as the default fallback
 * when the native GPU addon isn't available on the host.
 */
export async function callLocalModelCpu(texts, options = {}) {
  if (!texts || texts.length === 0) return [];
  const { maxLength = INDEXING_MAX_LENGTH } = options;

  const { session, tokenizer } = await getLocalPipeline();

  const t0 = performance.now();
  const tokenized = tokenizer(texts, {
    padding: true,
    truncation: true,
    max_length: maxLength,
  });

  const t1 = performance.now();
  const feed = buildFeed(tokenized, session.inputNames);
  const outputs = await session.run(feed);
  const t2 = performance.now();

  const pooled = extractPooledEmbeddings(outputs, tokenized.attention_mask, true);
  const t3 = performance.now();

  _embeddingTimings.tokenize_us += Math.round((t1 - t0) * 1000);
  _embeddingTimings.inference_us += Math.round((t2 - t1) * 1000);
  _embeddingTimings.pool_us += Math.round((t3 - t2) * 1000);
  _embeddingTimings.calls++;
  _embeddingTimings.totalTexts += texts.length;
  const { data, batchSize, dim } = pooled;

  if (batchSize !== texts.length) {
    throw new Error(`[L1] Output count mismatch: got ${batchSize} embeddings for ${texts.length} texts`);
  }

  const expectedDim = EMBEDDING_PROVIDERS.local.dimensions.full;
  if (dim !== expectedDim) {
    console.warn(`[L1] Local embedding dim mismatch: expected ${expectedDim}, got ${dim}`);
  }

  // data is already a fresh Float32Array from extractPooledEmbeddings — subarray
  // directly instead of allocating + copying into yet another buffer.
  const embeddings = new Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    embeddings[i] = data.subarray(i * dim, (i + 1) * dim);
  }
  if (process.env.NODE_ENV !== 'production') Object.freeze(embeddings);
  return embeddings;
}

/**
 * L0: Length-sorted bucketing for local model batch inference.
 * When the embedding worker pool is active, dispatches all batches concurrently
 * across workers for true CPU parallelism (Phase 2 integration).
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

  // Phase 3: Adaptive memory guard
  const totalMemGB = os.totalmem() / 1024 / 1024 / 1024;
  const adaptiveMemCapBytes = totalMemGB > 32
    ? Infinity
    : totalMemGB > 8
      ? 2 * 1024 * 1024 * 1024
      : 512 * 1024 * 1024;
  const memGuardHighWatermark = 0.85;
  const memGuardActive = !process.env.SWEET_SEARCH_DISABLE_MEM_GUARD && adaptiveMemCapBytes !== Infinity;

  // Pre-compute all batch boundaries
  const batches = [];
  let i = 0;
  // Attention budget: caps per-batch compute work (seq² × batch) on top of the
  // token budget (which only caps memory). Attention is O(seq²), so a tail
  // batch of 64 × 512 tokens does ~50× more compute than a head batch of
  // 128 × 50 tokens at the same token budget. Shrinking long-chunk batches
  // flattens per-batch wall-time and also keeps hidden-state size inside L3.
  // Default: floor(hardCap/2) × maxLength² (batch ≈ hardCap/2 at seq=maxLength).
  // Override via SWEET_SEARCH_EMBED_ATTENTION_BUDGET; set to 0 to disable.
  const envEmbedAttnBudget = parseInt(
    process.env.SWEET_SEARCH_EMBED_ATTENTION_BUDGET || '',
    10,
  );
  while (i < indexed.length) {
    const tokenBudget = 16384;
    const baseHardCap = options.hardCap ?? (maxLength <= 256 ? 128 : 64);
    const resolveHardCap = options.resolveHardCap ?? (() => baseHardCap);
    let attentionBudget;
    if (envEmbedAttnBudget === 0) {
      attentionBudget = Infinity;
    } else if (Number.isFinite(envEmbedAttnBudget) && envEmbedAttnBudget > 0) {
      attentionBudget = envEmbedAttnBudget;
    } else {
      attentionBudget = Math.max(1, Math.floor(baseHardCap / 2)) * maxLength * maxLength;
    }

    let batchSize = 1;
    while (i + batchSize < indexed.length) {
      const rawEst = indexed[i + batchSize].estTokens;
      const candidateLongest = Math.min(rawEst, maxLength);
      const candidateCount = batchSize + 1;
      const candidateHardCap = resolveHardCap(candidateLongest);
      if (candidateCount > candidateHardCap) break;
      // Memory cap — linear in seq_len
      if (candidateLongest * candidateCount > tokenBudget) break;
      // Compute cap — quadratic in seq_len
      if (candidateLongest * candidateLongest * candidateCount > attentionBudget) break;
      batchSize = candidateCount;
    }
    batches.push(indexed.slice(i, i + batchSize));
    i += batchSize;
  }

  // Phase 2: If pool is active and memory guard is off, dispatch concurrently
  // across workers. The pool round-robins batches so workers run in parallel.
  const pool = getEmbeddingPool();
  if (pool && !memGuardActive) {
    const batchResults = await embedBatchesWithPool(pool, batches, maxLength);
    for (let b = 0; b < batches.length; b++) {
      for (let j = 0; j < batches[b].length; j++) {
        embeddings[batches[b][j].origIdx] = batchResults[b][j];
      }
    }
    return embeddings;
  }

  // ── Hybrid CPU+GPU dispatch (OPT-IN, experimental) ──
  //
  // Default routes through whichever single encoder is available (native GPU
  // preferred when present, ORT INT8 CPU fallback otherwise).
  //
  // Enable explicitly via SWEET_SEARCH_EMBED_HYBRID=1 to run the GPU and CPU
  // encoders in parallel via a 2-worker shared-counter queue. Both paths
  // produce the same shape vectors so results are mixed transparently.
  //
  // Why opt-in: in the default pipeline (parallel embed + LI phases) the
  // GPU device queue is shared, and on unified-memory systems both encoders
  // contend for the same DRAM bandwidth. The contention overhead usually
  // erases the parallelism win. Hybrid is mainly useful in standalone
  // embedding benchmarks or on hardware with separate CPU and GPU memory
  // pools.
  const onProgress = options.onProgress;
  let completed = 0;

  const embedHybridEnv = (process.env.SWEET_SEARCH_EMBED_HYBRID ?? '').trim().toLowerCase();
  const embedHybridEnabled = embedHybridEnv === '1' || embedHybridEnv === 'true' || embedHybridEnv === 'on';
  let useHybrid = false;
  if (embedHybridEnabled && !pool && isNativeInferenceAvailable()) {
    // Probe ORT availability — getLocalPipeline returns the loaded pipeline
    // or throws/returns null if onnxruntime-node + model files aren't ready.
    try {
      const ortPipeline = await getLocalPipeline();
      if (ortPipeline?.session) {
        useHybrid = true;
        console.log('[Embedding] hybrid CPU+GPU dispatch enabled (smart routing)');
      }
    } catch {
      useHybrid = false;
    }
  }

  if (useHybrid) {
    // Smart bidirectional routing — see indexer-ann.js for the full rationale.
    // The bucketer sorts batches ascending by token length. GPU pulls from
    // the END (longest, where its compute advantage dominates kernel-launch
    // overhead) and CPU pulls from the BEGINNING (shortest, where the BLAS-
    // accelerated ORT INT8 path is competitive with or faster than the GPU's
    // fixed dispatch cost). They meet in the middle, dynamically self-balancing.
    let front = 0;
    let back = batches.length - 1;
    const runGpu = async () => {
      while (true) {
        if (back < front) break;
        const myIdx = back--;
        const batch = batches[myIdx];
        const batchTexts = batch.map((b) => b.text);
        const batchEmbeddings = await callLocalModelGpu(batchTexts, { maxLength });
        for (let j = 0; j < batch.length; j++) {
          embeddings[batch[j].origIdx] = batchEmbeddings[j];
        }
        completed += batch.length;
        if (onProgress) onProgress(completed, texts.length);
      }
    };
    const runCpu = async () => {
      while (true) {
        if (front > back) break;
        const myIdx = front++;
        const batch = batches[myIdx];
        const batchTexts = batch.map((b) => b.text);
        const batchEmbeddings = await callLocalModelCpu(batchTexts, { maxLength });
        for (let j = 0; j < batch.length; j++) {
          embeddings[batch[j].origIdx] = batchEmbeddings[j];
        }
        completed += batch.length;
        if (onProgress) onProgress(completed, texts.length);
      }
    };
    await Promise.all([runGpu(), runCpu()]);
    return embeddings;
  }

  // Sequential path: process each pre-computed batch one at a time.
  // Uses pool if available (still benefits from dedicated ORT sessions),
  // otherwise falls back to in-process callLocalModel.
  const infer = pool ? (t, o) => pool.embed(t, o) : callLocalModel;
  for (const batch of batches) {
    const batchTexts = batch.map(b => b.text);
    const batchEmbeddings = await infer(batchTexts, { maxLength });
    for (let j = 0; j < batch.length; j++) {
      embeddings[batch[j].origIdx] = batchEmbeddings[j];
    }
    completed += batch.length;
    if (onProgress) onProgress(completed, texts.length);
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

export async function unloadLocalModel() {
  if (localPipeline?.session) {
    // Note: ORT has a known native memory leak in session.release()
    // (microsoft/onnxruntime#25325) — avoid frequent load/unload cycles.
    try { await localPipeline.session.release(); } catch { /* best-effort cleanup */ }
  }
  localPipeline = null;
  isLoadingLocal = false;
  loadPromise = null;
}

export function isLocalModelLoaded() {
  return localPipeline !== null;
}
