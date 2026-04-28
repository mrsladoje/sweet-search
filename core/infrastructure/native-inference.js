/**
 * Native Inference — candle-based FP32 embedding + late interaction inference.
 *
 * Provides native model wrappers that serve as drop-in replacements for the
 * ORT inference paths. Uses the napi-rs addon with Metal GPU acceleration on
 * Apple Silicon, CPU fallback elsewhere.
 *
 * On M3+ Apple Silicon, the addon also loads a CoreML variant cascade
 * alongside the candle backbone. This module is the single point where
 * the cascade dirs resolved by `coreml-cascade.js` are handed to the
 * Rust `NativeEmbeddingModel::load` / `NativeLateInteractionModel::load`
 * constructors. Lower hardware, no cache, or
 * `SWEET_SEARCH_COREML_CASCADE=0` collapses to the candle-only path
 * transparently.
 *
 * Environment:
 *   SWEET_SEARCH_NATIVE_INFERENCE=0|1          — force disable/enable
 *   SWEET_SEARCH_COREML_CASCADE=0              — force-disable the cascade
 *                                                even when hardware +
 *                                                cache are both eligible
 *                                                (diagnostic / benchmarking)
 *   SWEET_SEARCH_COREML_STATS=1                — dump per-variant
 *                                                dispatch report on
 *                                                addon shutdown (see
 *                                                coreml_embedding.rs)
 *   SWEET_SEARCH_CUDA=0                        — force-disable CUDA even
 *                                                on an eligible host
 *                                                (diagnostic)
 *   SWEET_SEARCH_CUDA_COMPUTE_CAP=<cc>         — set by this module
 *                                                before addon loads so
 *                                                the Rust dtype policy
 *                                                picks BF16/F16/F32 by
 *                                                compute capability and
 *                                                model family.
 *                                                See mod.rs::optimal_dtype
 *   SWEET_SEARCH_NATIVE_DTYPE=f32|bf16|f16       Global dtype preference.
 *                                                On CUDA, BF16 is used for
 *                                                embeddings on Ampere+ but
 *                                                LI remains F32 for quality.
 *   SWEET_SEARCH_NATIVE_EMBED_DTYPE=f32|bf16|f16 Per-model diagnostic
 *                                                override for embeddings.
 *   SWEET_SEARCH_NATIVE_LI_DTYPE=f32|bf16|f16    Per-model diagnostic
 *                                                override; BF16/F16 LI is
 *                                                known to drift on CUDA.
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
import { getCoremlCascadeResolvedDirs } from './coreml-cascade.js';
import { detectHardwareCapability } from './hardware-capability.js';

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
let _coremlCascadeLogged = false;

// ─── Cascade-dir selection (pure helper, unit-tested) ───

/**
 * Decide whether the Rust addon should load a CoreML cascade for this
 * deviceKind. Only `'metal'` triggers cascade resolution; `'cuda'`, `'cpu'`,
 * and `'auto'` skip cascade (CUDA has no cascade, CPU has no GPU dispatch).
 *
 * Pure function — takes a resolver for the cascade dirs and the override.
 * Returns `undefined` (explicit "no cascade") or a string path.
 *
 * @param {'cpu'|'metal'|'cuda'|'auto'} deviceKind
 * @param {string|undefined} cascadeDirOverride - explicit caller override (wins)
 * @param {() => string|null|undefined} resolveCascadeDir - called only when needed
 */
export function pickCascadeDirForDevice(deviceKind, cascadeDirOverride, resolveCascadeDir) {
  if (cascadeDirOverride !== undefined) return cascadeDirOverride;
  if (deviceKind !== 'metal') return undefined;
  return resolveCascadeDir() || undefined;
}

// ─── CUDA compute-capability env propagation ───

/**
 * Ensure `SWEET_SEARCH_CUDA_COMPUTE_CAP` is set for the current process
 * before the addon loads a CUDA model. The Rust `optimal_dtype` reads
 * this env var to pick BF16 for the embedding model on Ampere+ while
 * keeping ModernBERT LI on F32 unless explicitly overridden.
 *
 * Idempotent: honors an already-set value (useful for forcing a dtype
 * tier in benchmarks) and silently no-ops when there is no NVIDIA GPU.
 */
function propagateCudaComputeCapToAddonEnv() {
  if (process.env.SWEET_SEARCH_CUDA_COMPUTE_CAP) return;
  try {
    const hw = detectHardwareCapability();
    if (hw.nvidiaGpu?.computeCapability) {
      process.env.SWEET_SEARCH_CUDA_COMPUTE_CAP = hw.nvidiaGpu.computeCapability;
    }
  } catch {
    // Hardware detection is advisory. If it fails, the Rust side falls
    // back to F32 which is always correct, if slower.
  }
}

// ─── CoreML cascade resolution ───

/**
 * Resolve which CoreML cascade dirs the Rust addon should try to load.
 * Logged exactly once per process so a mis-configured cascade surfaces
 * at startup instead of silently falling through on every call.
 *
 * Always returns an object — never throws. The returned dirs can be
 * `null`, which the Rust addon treats as "CoreML path disabled" and
 * falls back to candle unconditionally.
 */
function resolveCoremlCascadeForAddon() {
  const resolved = getCoremlCascadeResolvedDirs();
  if (!_coremlCascadeLogged) {
    _coremlCascadeLogged = true;
    const hw = detectHardwareCapability();
    // Log a single line so every subsequent `[NativeInference]` message
    // can be correlated with the cascade decision made here.
    if (resolved.embedDir || resolved.liDir) {
      process.stderr.write(
        `[NativeInference] CoreML cascade: ${resolved.status}` +
        ` (embed=${resolved.embedDir ? 'yes' : 'no'}, li=${resolved.liDir ? 'yes' : 'no'},` +
        ` chip=${hw.brandString || 'unknown'})\n`
      );
    } else if (hw.coremlCascadeEligible) {
      process.stderr.write(
        `[NativeInference] CoreML cascade: ${resolved.status} —` +
        ` hardware eligible but cache missing. Run \`node scripts/build-coreml-cascade.js\`` +
        ` to enable the 18% speedup on ${hw.brandString}\n`
      );
    }
    // Ineligible hardware: silent. The user has no action to take and
    // we already log the candle device via the existing "Loaded"
    // line below.
  }
  return resolved;
}

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
    const addon = loadAddon();
    if (!addon?.NativeEmbeddingModel) return null;

    await fetchModel('coderankembed-fp32');

    const entry = getModelEntry('coderankembed-fp32');
    const modelDir = getModelCacheDir(entry.hfId);
    const safetensorsPath = join(modelDir, 'model.safetensors');
    const configPath = join(modelDir, 'config.json');

    if (!existsSync(safetensorsPath) || !existsSync(configPath)) return null;

    // Resolve the CoreML cascade dir for NomicBERT embeddings. Returns
    // null on ineligible hardware, empty cache, or explicit opt-out
    // (SWEET_SEARCH_COREML_CASCADE=0). The Rust addon's constructor
    // runs a parity check against the smallest variant before arming
    // the dispatch path; failure there falls back to candle.
    const cascade = resolveCoremlCascadeForAddon();

    const t0 = Date.now();
    _embeddingModel = addon.NativeEmbeddingModel.load(
      safetensorsPath,
      configPath,
      cascade.embedDir || undefined,
    );
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
  // see the comment on embed_batch in embedding_model.rs. Use `.subarray()`
  // to return zero-copy views over the shared backing buffer (2026-04-15 perf
  // fix — previous `.slice()` was a per-row memcpy for no reason).
  //
  // Callers MUST treat each view as read-only. Mutation audit (2026-04-15):
  //   - callLocalModelGpu at core/embedding/embedding-local-model.js:547
  //     returns the array unchanged to its caller
  //   - downstream embedding-service paths call truncateForHNSW, which
  //     allocates a fresh Float32Array per row (quantization.js)
  //   - SQLite persistence paths take a BLOB copy via better-sqlite3
  //   - no grep hit for `embeddings[i][j] = ` or `.set(` on the returned rows
  // Any future consumer that writes through a returned view will silently
  // corrupt neighbouring rows in the shared buffer. If you need to mutate,
  // copy first with `new Float32Array(view)` or `view.slice()`.
  const flat = await model.embedBatch(inputIds, attentionMask);
  const dim = model.dim;

  const embeddings = new Array(batchSize);
  for (let i = 0; i < batchSize; i++) {
    embeddings[i] = flat.subarray(i * dim, (i + 1) * dim);
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

    // Resolve the CoreML cascade dir for ModernBERT LI. Same contract
    // as the embedding model above — see that comment.
    const cascade = resolveCoremlCascadeForAddon();

    const t0 = Date.now();
    _liModel = addon.NativeLateInteractionModel.load(
      backbonePath,
      projPath,
      configPath,
      cascade.liDir || undefined,
    );
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
  // li_model.rs. Use `.subarray()` to return zero-copy views over the shared
  // backing buffer (2026-04-15 perf fix — previous `.slice()` was a per-token
  // memcpy for no reason).
  //
  // LI token views are READ-ONLY. Mutation audit (2026-04-15):
  //   - nativeLiEncodeTokenized is called from late-interaction-model.js:387
  //     (encodeDocumentsGpu) which pushes views into a JS array and hands
  //     them to indexer-ann.js::finalizeBatchResults
  //   - finalizeBatchResults calls liIndex.add which at
  //     late-interaction-index.js:429-430 does
  //     `tokens.slice(...).map(emb => emb.slice(0, tokenDim))` — the inner
  //     `.slice()` creates a fresh Float32Array per token (copy)
  //   - poolTokens at late-interaction-model.js:619 does
  //     `new Float32Array(clusterInput[i])` (copy via constructor)
  //   - persistence goes through _writeSegmentFile which copies bytes into
  //     a pre-allocated Buffer
  // Any future consumer that writes through a returned view will corrupt
  // the underlying batch buffer and neighbouring tokens. Copy before mutating.
  const flat = result.vectors;

  const allVectors = new Array(batchSize);
  let offset = 0;
  for (let b = 0; b < batchSize; b++) {
    const count = result.tokenCounts[b];
    const docVectors = new Array(count);
    for (let t = 0; t < count; t++) {
      docVectors[t] = flat.subarray(offset + t * dim, offset + (t + 1) * dim);
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

// ─── Model state queries ───

export function isNativeEmbeddingModelLoaded() {
  return _embeddingModel != null;
}

export function isNativeLiModelLoaded() {
  return _liModel != null;
}

// ─── Device-explicit loading ───

/**
 * Load the native embedding model on a specific device ("cpu" | "metal" | "auto").
 * Used by model-pool.js to arm GPU models for indexing. Sets the module-scope
 * singleton so subsequent nativeEmbed() calls use this instance.
 */
export async function loadNativeEmbeddingModelWithDevice(deviceKind, cascadeDirOverride) {
  if (_embeddingModel) return _embeddingModel;
  if (_embeddingModelLoadPromise) return _embeddingModelLoadPromise;

  _embeddingModelLoadPromise = (async () => {
    const addon = loadAddon();
    if (!addon?.NativeEmbeddingModel?.loadWithDevice) return null;

    // CUDA needs the compute-capability env set BEFORE the Rust load
    // path picks a dtype. No-op on non-CUDA kinds and already-set envs.
    if (deviceKind === 'cuda') propagateCudaComputeCapToAddonEnv();

    await fetchModel('coderankembed-fp32');

    const entry = getModelEntry('coderankembed-fp32');
    const modelDir = getModelCacheDir(entry.hfId);
    const safetensorsPath = join(modelDir, 'model.safetensors');
    const configPath = join(modelDir, 'config.json');

    if (!existsSync(safetensorsPath) || !existsSync(configPath)) return null;

    // Cascade is a CoreML-specific concept. CUDA has no cascade — the Rust
    // addon JITs CUDA kernels per forward pass; there is no `.mlpackage`
    // equivalent to prefetch. Skip cascade resolution entirely on CUDA so
    // we don't log "cascade missing" warnings on a Linux+NVIDIA host.
    const cascadeDir = pickCascadeDirForDevice(
      deviceKind,
      cascadeDirOverride,
      () => resolveCoremlCascadeForAddon().embedDir,
    );

    const t0 = Date.now();
    _embeddingModel = addon.NativeEmbeddingModel.loadWithDevice(
      safetensorsPath,
      configPath,
      cascadeDir,
      deviceKind,
    );
    console.log(`[NativeInference] Embedding model loaded in ${Date.now() - t0}ms (dim: ${_embeddingModel.dim}, device: ${deviceKind})`);

    return _embeddingModel;
  })();

  try {
    return await _embeddingModelLoadPromise;
  } finally {
    // Keep promise set on success; clear only on re-load.
  }
}

/**
 * Load the native LI model on a specific device.
 */
export async function loadNativeLiModelWithDevice(deviceKind, cascadeDirOverride) {
  if (_liModel) return _liModel;
  if (_liModelLoadPromise) return _liModelLoadPromise;

  _liModelLoadPromise = (async () => {
    const addon = loadAddon();
    if (!addon?.NativeLateInteractionModel?.loadWithDevice) return null;

    // See loadNativeEmbeddingModelWithDevice for why this is CUDA-only.
    if (deviceKind === 'cuda') propagateCudaComputeCapToAddonEnv();

    await fetchModel('lateon-code-fp32');

    const entry = getModelEntry('lateon-code-fp32');
    const modelDir = getModelCacheDir(entry.hfId);
    const backbonePath = join(modelDir, 'model.safetensors');
    const projPath = join(modelDir, '1_Dense', 'model.safetensors');
    const configPath = join(modelDir, 'config.json');

    if (!existsSync(backbonePath) || !existsSync(projPath) || !existsSync(configPath)) return null;

    // CUDA has no cascade — see the matching comment in
    // loadNativeEmbeddingModelWithDevice.
    const cascadeDir = pickCascadeDirForDevice(
      deviceKind,
      cascadeDirOverride,
      () => resolveCoremlCascadeForAddon().liDir,
    );

    const t0 = Date.now();
    _liModel = addon.NativeLateInteractionModel.loadWithDevice(
      backbonePath,
      projPath,
      configPath,
      cascadeDir,
      deviceKind,
    );
    console.log(`[NativeInference] LI model loaded in ${Date.now() - t0}ms (dim: ${_liModel.dim}, device: ${deviceKind})`);

    return _liModel;
  })();

  return _liModelLoadPromise;
}

// ─── Warmup primitives ───

export async function warmupNativeEmbeddingModel() {
  if (!_embeddingModel?.warmupForward) return;
  const t0 = Date.now();
  await _embeddingModel.warmupForward();
  console.log(`[NativeInference] Embedding warmup forward in ${Date.now() - t0}ms`);
}

export async function warmupNativeLiModel() {
  if (!_liModel?.warmupForward) return;
  const t0 = Date.now();
  await _liModel.warmupForward();
  console.log(`[NativeInference] LI warmup forward in ${Date.now() - t0}ms`);
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
  _coremlCascadeLogged = false;
}
