//! NomicBERT embedding model — CodeRankEmbed inference via candle.
//!
//! Loads FP32 safetensors weights from jalipalo/CodeRankEmbed and runs
//! forward inference natively (no ONNX Runtime dependency).
//!
//! Pipeline:
//!   input_ids → NomicBERT encoder → mean_pool(hidden, mask) → L2_normalize
//!   Output: 768-dimensional L2-normalized embedding vectors.

use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use napi::bindgen_prelude::*;
use napi::Task;
use napi_derive::napi;
use std::path::PathBuf;
use std::sync::Arc;

use super::nomic_bert_sdpa as nomic_bert;
#[cfg(feature = "coreml")]
use super::coreml_embedding::{CoremlEmbedding, CoremlEmbeddingVariant};
use super::{metal_lock, optimal_dtype, select_device};

/// Inner state of the embedding model, shared between the napi struct (main
/// thread) and `EmbedBatchTask` (libuv worker thread) via `Arc`.
///
/// Metal compute is serialized via `super::metal_lock()` — a process-wide
/// mutex that covers all Metal operations across both the embedding and LI
/// models. See `metal_lock` for why per-model locks aren't enough.
///
/// When the `coreml` feature is enabled AND `NativeEmbeddingModel::load`
/// is invoked with a `coreml_cascade_dir` that contains one or more
/// `nomic_bert_b{B}_s{S}_fp16.mlpackage` files, `coreml` holds an extra
/// CPU+NE backend dispatched whenever any cascade variant fits the
/// batch. The candle backbone is kept loaded unconditionally as the
/// fallback path for oversized batches (`pick() → None`).
///
/// The cascade dir is passed down from the JS layer
/// (`core/infrastructure/native-inference.js`) which resolves it via
/// `core/infrastructure/coreml-cascade.js::getCoremlCascadeResolvedDirs`.
/// There is no env-var bypass — all config flows through the JS
/// infrastructure layer so init/uninstall see a consistent picture of
/// what the addon is actually using. See docs/DDD_ARCHITECTURE.md for
/// the rationale on config routing through the infrastructure domain.
struct EmbeddingInner {
    model: nomic_bert::NomicBertModel,
    #[cfg(feature = "coreml")]
    coreml: Option<CoremlEmbedding>,
    device: candle_core::Device,
    hidden_size: usize,
}

/// When the process shuts down (or the addon drops the last Arc
/// handle to the model), dump a CoreML dispatch summary if the
/// caller asked for it via `SWEET_SEARCH_COREML_STATS=1`. The
/// summary answers two questions the 18% speedup headline number
/// on its own cannot:
///   1. Which variants actually fired in production?
///   2. How many calls fell through to candle because no variant fit?
///
/// Quiet by default to avoid polluting normal runs.
impl Drop for EmbeddingInner {
    fn drop(&mut self) {
        #[cfg(feature = "coreml")]
        if std::env::var_os("SWEET_SEARCH_COREML_STATS").is_some() {
            if let Some(coreml) = &self.coreml {
                eprintln!("{}", coreml.dispatch_report());
            }
        }
    }
}

/// Scan a CoreML cascade directory and build a variant list. Called
/// only when the JS caller has passed an explicit `coreml_cascade_dir`.
///
/// Construction is cheap — individual variants compile lazily on first
/// use, so we don't pay the per-variant ~15-30s mlpackage compile at
/// startup.
///
/// Expected filename format:
///   nomic_bert_b{BATCH}_s{SEQ}_fp16.mlpackage
///
/// Anything that doesn't match the regex is silently skipped (lets
/// the directory carry unrelated artifacts without aborting). Logs a
/// single line with the total variant count and the full shape set so
/// a mis-configured cascade surfaces at startup instead of silently
/// falling through to candle on every batch.
#[cfg(feature = "coreml")]
fn try_load_coreml_embedding_from_dir(dir: &str) -> Option<CoremlEmbedding> {
    let dir_path = std::path::PathBuf::from(dir);

    let entries = match std::fs::read_dir(&dir_path) {
        Ok(it) => it,
        Err(e) => {
            eprintln!(
                "[NativeEmbedding] CoreML cascade dir {} unreadable: {} — falling back to candle",
                dir, e
            );
            return None;
        }
    };

    let mut variants: Vec<CoremlEmbeddingVariant> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let fname = match path.file_name().and_then(|n| n.to_str()) {
            Some(s) => s,
            None => continue,
        };
        if let Some((batch, seq)) = parse_embed_variant_filename(fname) {
            variants.push(CoremlEmbeddingVariant::new(batch, seq, path));
        }
    }

    if variants.is_empty() {
        eprintln!(
            "[NativeEmbedding] CoreML cascade dir {} contained no nomic_bert_b{{B}}_s{{S}}_fp16.mlpackage files — falling back to candle",
            dir,
        );
        return None;
    }

    let cascade = CoremlEmbedding::from_variants(variants);
    let shapes: Vec<String> = cascade
        .variant_shapes()
        .map(|(b, s)| format!("b{}×s{}", b, s))
        .collect();
    eprintln!(
        "[NativeEmbedding] CoreML cascade loaded: {} variants [{}] (lazy — each compiles on first use)",
        cascade.len(),
        shapes.join(", "),
    );
    Some(cascade)
}

/// Parse `nomic_bert_b{BATCH}_s{SEQ}_fp16.mlpackage` into `(batch, seq)`.
/// Returns None for any filename that doesn't match — caller skips those
/// entries instead of failing the whole cascade load.
#[cfg(feature = "coreml")]
fn parse_embed_variant_filename(fname: &str) -> Option<(usize, usize)> {
    let rest = fname.strip_prefix("nomic_bert_b")?;
    let rest = rest.strip_suffix("_fp16.mlpackage")?;
    let (batch_str, seq_part) = rest.split_once("_s")?;
    let batch: usize = batch_str.parse().ok()?;
    let seq: usize = seq_part.parse().ok()?;
    Some((batch, seq))
}

/// Startup parity check between candle and CoreML on a single synthetic
/// batch item. Returns the cosine similarity between the two 768-d output
/// vectors; because both backends emit L2-normalised outputs, the cosine
/// is just the dot product.
///
/// We use a deterministic vocab-safe fixture: [CLS] + 62 common subword
/// IDs + [SEP] (64 active positions total). Starting from id=1000 avoids
/// the 100-byte range (which overlaps the BERT special-token codes
/// [CLS]=101 / [SEP]=102 / [UNK]=100 and produced out-of-distribution
/// activations on NomicBERT). 64 active tokens is enough for the mean
/// pool to average out per-position FP16 rounding noise between the
/// CoreML weights (stored FP16) and candle's BF16 Metal weights — the
/// shorter 16-token fixture previously used amplified the rounding to
/// ~0.996 cosine, triggering false-negative parity failures even though
/// the spike measured 0.9998 on real sentences.
///
/// We run the check against the LARGEST cascade variant only. All
/// smaller variants are traced from the same PyTorch model (see
/// scripts/spike-coreml/trace_cascade.py:TracedNomicBert), so a
/// cosine mismatch on the largest variant would equally break every
/// smaller one; running the check on each variant would waste ~20 s
/// of startup (one mlpackage compile per variant) with no extra
/// coverage.
#[cfg(feature = "coreml")]
fn embedding_parity_cosine(
    candle_model: &nomic_bert::NomicBertModel,
    device: &Device,
    coreml: &CoremlEmbedding,
    hidden_size: usize,
) -> std::result::Result<f32, String> {
    const ACTIVE: usize = 64;
    // Run the parity check at the shape `pick()` will return for a
    // single-row fixture. With the cascade sorted ascending by
    // (batch, seq), that's `variants.first()` — the smallest-batch
    // (largest-seq in our design) variant. `parity_variant()` names
    // this and returns None only if the cascade is empty, which is
    // already ruled out at the call site.
    let parity = coreml
        .parity_variant()
        .ok_or_else(|| "cascade is empty".to_string())?;
    let seq_len = parity.seq.max(ACTIVE);

    let mut ids_row = vec![0i64; seq_len];
    let mut mask_row = vec![0i64; seq_len];
    ids_row[0] = 101; // [CLS]
    mask_row[0] = 1;
    for i in 1..(ACTIVE - 1) {
        ids_row[i] = 1000 + i as i64;
        mask_row[i] = 1;
    }
    ids_row[ACTIVE - 1] = 102; // [SEP]
    mask_row[ACTIVE - 1] = 1;

    // Candle forward on the same fixture. Mirrors the compute() pipeline
    // but without the Float32Array packaging — we just need the raw
    // L2-normalised vector to compare against CoreML.
    let flat_ids: Vec<u32> = ids_row.iter().map(|&x| x as u32).collect();
    let flat_mask_u8: Vec<u8> = mask_row.iter().map(|&x| x as u8).collect();

    let _guard = if matches!(device, Device::Metal(_)) {
        Some(
            metal_lock()
                .lock()
                .map_err(|e| format!("metal lock poisoned: {e}"))?,
        )
    } else {
        None
    };

    let ids_tensor = Tensor::new(flat_ids.as_slice(), device)
        .and_then(|t| t.reshape((1, seq_len)))
        .map_err(|e| format!("ids tensor: {e}"))?;
    let mask_u8 = Tensor::new(flat_mask_u8.as_slice(), device)
        .and_then(|t| t.reshape((1, seq_len)))
        .map_err(|e| format!("mask tensor: {e}"))?;

    let hidden = candle_model
        .forward(&ids_tensor, None, Some(&mask_u8))
        .map_err(|e| format!("candle forward: {e}"))?;
    let mask_float = mask_u8
        .to_dtype(hidden.dtype())
        .map_err(|e| format!("mask dtype: {e}"))?;
    let pooled = nomic_bert::mean_pooling(&hidden, &mask_float)
        .map_err(|e| format!("mean pool: {e}"))?;
    let normalized = nomic_bert::l2_normalize(&pooled)
        .map_err(|e| format!("l2 normalize: {e}"))?;

    let candle_vec: Vec<f32> = normalized
        .to_dtype(DType::F32)
        .and_then(|t| t.reshape((hidden_size,)))
        .and_then(|t| t.to_vec1::<f32>())
        .map_err(|e| format!("candle output extract: {e}"))?;
    drop(_guard);

    // CoreML forward on the same fixture. The Rust wrapper already pads
    // a single-row batch up to the fixed shape and truncates the output
    // back down to `batch_size * hidden_size`.
    let coreml_input_ids = vec![ids_row];
    let coreml_mask = vec![mask_row];
    let coreml_vec = coreml.embed(&coreml_input_ids, &coreml_mask)?;

    if candle_vec.len() != coreml_vec.len() {
        return Err(format!(
            "length mismatch: candle={} coreml={}",
            candle_vec.len(),
            coreml_vec.len()
        ));
    }

    let dot: f32 = candle_vec
        .iter()
        .zip(coreml_vec.iter())
        .map(|(&a, &b)| a * b)
        .sum();
    Ok(dot)
}

/// Parity threshold below which the CoreML backend is dropped. The spike
/// measured 0.9998 on gencodesearchnet-style inputs (see
/// scripts/spike-coreml/test_coreml_parity.py), so 0.998 leaves ~2e-4
/// room for runtime drift while still catching actual breakage.
#[cfg(feature = "coreml")]
const COREML_EMBED_PARITY_THRESHOLD: f32 = 0.998;

/// Native NomicBERT embedding model for CodeRankEmbed inference.
///
/// Constructed once via `NativeEmbeddingModel.load()`, then reused for all
/// embedding calls. Inference is exposed as an `AsyncTask` so Metal GPU
/// work runs on a libuv worker thread, freeing the JS event loop to overlap
/// tokenization and sqlite writes with GPU compute.
#[napi]
pub struct NativeEmbeddingModel {
    inner: Arc<EmbeddingInner>,
}

#[napi]
impl NativeEmbeddingModel {
    /// Load a NomicBERT embedding model from FP32 safetensors weights.
    ///
    /// # Arguments
    /// * `safetensors_path` - Path to model.safetensors (FP32 weights)
    /// * `config_path` - Path to config.json (model architecture config)
    /// * `coreml_cascade_dir` - Optional path to a directory containing
    ///   `nomic_bert_b{B}_s{S}_fp16.mlpackage` files. When present and
    ///   the `coreml` Cargo feature is on, a variant cascade is loaded
    ///   and passes a startup parity check before being admitted for
    ///   dispatch. The JS caller
    ///   (`core/infrastructure/native-inference.js`) resolves this
    ///   path via `getCoremlCascadeResolvedDirs()` in
    ///   `core/infrastructure/coreml-cascade.js`. Passing `None`
    ///   disables the CoreML path completely — the model runs candle
    ///   only. Linux/Windows callers always pass `None`.
    #[napi(factory)]
    pub fn load(
        safetensors_path: String,
        config_path: String,
        coreml_cascade_dir: Option<String>,
    ) -> Result<Self> {
        // Non-coreml builds (Linux, darwin without `coreml` feature)
        // accept the argument on the JS side for API stability but
        // ignore it here. Tagged with an explicit drop so the compiler
        // sees the parameter as "used" and doesn't emit a warning.
        #[cfg(not(feature = "coreml"))]
        {
            let _ = &coreml_cascade_dir;
        }

        let config_str = std::fs::read_to_string(&config_path)
            .map_err(|e| Error::from_reason(format!(
                "[NativeEmbedding] Failed to read config at {config_path}: {e}"
            )))?;

        let config: nomic_bert::Config = serde_json::from_str(&config_str)
            .map_err(|e| Error::from_reason(format!(
                "[NativeEmbedding] Config parse error: {e}"
            )))?;

        let hidden_size = config.n_embd;

        let device = select_device()
            .map_err(|e| Error::from_reason(format!(
                "[NativeEmbedding] Device init error: {e}"
            )))?;

        let dtype = optimal_dtype(&device);
        let path = PathBuf::from(&safetensors_path);
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[path], dtype, &device)
                .map_err(|e| Error::from_reason(format!(
                    "[NativeEmbedding] Failed to load safetensors from {safetensors_path}: {e}"
                )))?
        };

        let model = nomic_bert::NomicBertModel::load(vb, &config)
            .map_err(|e| Error::from_reason(format!(
                "[NativeEmbedding] Model construction error: {e}"
            )))?;

        let device_name = match &device {
            candle_core::Device::Cpu => "cpu",
            #[cfg(feature = "metal")]
            candle_core::Device::Metal(_) => "metal",
            _ => "unknown",
        };
        let dtype_name = match dtype {
            DType::F16 => "f16",
            DType::BF16 => "bf16",
            DType::F32 => "f32",
            _ => "other",
        };
        eprintln!(
            "[NativeEmbedding] Loaded NomicBERT ({hidden_size}d, {} layers, device: {device_name}, dtype: {dtype_name})",
            config.n_layer,
        );

        // Load the CoreML backend if the JS caller passed an explicit
        // cascade dir, then verify its output matches candle on a
        // synthetic fixture before admitting it for dispatch. Any
        // failure along the way drops the CoreML backend — embed_batch
        // falls through to the candle path for every call in that
        // case, identical to the pre-CoreML behavior.
        //
        // Non-macOS builds and darwin builds where the JS caller
        // decided not to dispatch CoreML (e.g. M1/M2 hardware, or
        // SWEET_SEARCH_COREML_CASCADE=0) both hit the `None` branch
        // here — the `coreml_cascade_dir` parameter is the single
        // decision point.
        #[cfg(feature = "coreml")]
        let coreml = match coreml_cascade_dir.as_deref().and_then(try_load_coreml_embedding_from_dir) {
            None => None,
            Some(c) => match embedding_parity_cosine(&model, &device, &c, hidden_size) {
                Ok(cos) if cos >= COREML_EMBED_PARITY_THRESHOLD => {
                    eprintln!(
                        "[NativeEmbedding] CoreML parity OK (cosine {:.6} ≥ {:.3})",
                        cos, COREML_EMBED_PARITY_THRESHOLD
                    );
                    Some(c)
                }
                Ok(cos) => {
                    eprintln!(
                        "[NativeEmbedding] CoreML parity FAILED (cosine {:.6} < {:.3}) — dropping CoreML backend",
                        cos, COREML_EMBED_PARITY_THRESHOLD
                    );
                    None
                }
                Err(e) => {
                    eprintln!(
                        "[NativeEmbedding] CoreML parity check errored: {} — dropping CoreML backend",
                        e
                    );
                    None
                }
            },
        };

        Ok(Self {
            inner: Arc::new(EmbeddingInner {
                model,
                #[cfg(feature = "coreml")]
                coreml,
                device,
                hidden_size,
            }),
        })
    }

    /// Return the embedding dimension (768 for CodeRankEmbed).
    #[napi(getter)]
    pub fn dim(&self) -> u32 {
        self.inner.hidden_size as u32
    }

    /// Run embedding inference on a batch of pre-tokenized inputs.
    ///
    /// Returns an `AsyncTask` so the forward pass runs on a libuv worker
    /// thread — the JS event loop is released during Metal compute.
    ///
    /// # Arguments
    /// * `input_ids` - 2D array of token IDs, shape [batch, seq_len]
    /// * `attention_mask` - 2D array of 0/1 mask values, shape [batch, seq_len]
    ///
    /// # Returns
    /// A Promise resolving to a flat `Float32Array` of length
    /// `batch_size * hidden_size`, holding the L2-normalised embedding
    /// vectors row-major. Callers should slice via
    /// `result.slice(i * dim, (i + 1) * dim)` to obtain per-batch vectors.
    ///
    /// We return a typed array instead of a native `Vec<Vec<f32>>` because
    /// napi-rs would otherwise serialise that nested vec by calling
    /// `napi_set_element` once per element — for b32×s512 that is 24,576
    /// napi crossings per batch. A `Float32Array` is constructed in a
    /// single napi call with one memcpy of the underlying buffer (~tens of
    /// μs at this size), which beats both the per-element napi path AND the
    /// JSON encode + parse path the embedding model previously used.
    #[napi(ts_return_type = "Promise<Float32Array>")]
    pub fn embed_batch(
        &self,
        input_ids: Vec<Vec<i64>>,
        attention_mask: Vec<Vec<i64>>,
    ) -> AsyncTask<EmbedBatchTask> {
        AsyncTask::new(EmbedBatchTask {
            inner: self.inner.clone(),
            input_ids,
            attention_mask,
        })
    }

}

/// napi `Task` running NomicBERT embedding on a libuv worker thread.
pub struct EmbedBatchTask {
    inner: Arc<EmbeddingInner>,
    input_ids: Vec<Vec<i64>>,
    attention_mask: Vec<Vec<i64>>,
}

impl Task for EmbedBatchTask {
    type Output = Float32Array;
    type JsValue = Float32Array;

    fn compute(&mut self) -> Result<Self::Output> {
        let inner = &*self.inner;
        let batch_size = self.input_ids.len();
        if batch_size == 0 {
            return Ok(Float32Array::new(Vec::new()));
        }
        let seq_len = self.input_ids[0].len();

        // Shape-distribution logging for choosing CoreML traced shapes.
        // Gated behind SWEET_SEARCH_LOG_NATIVE_SHAPES so every future
        // sweet-search run does not pay the iteration cost. Emits the
        // padded shape (what the indexer handed us) and the true max
        // active-token count (what a shape-aware backend would need to
        // run); the gap between the two is exactly the flops a fixed-
        // shape CoreML .mlpackage would burn on padding.
        if std::env::var_os("SWEET_SEARCH_LOG_NATIVE_SHAPES").is_some() {
            let max_active = self
                .attention_mask
                .iter()
                .map(|row| row.iter().filter(|&&v| v != 0).count())
                .max()
                .unwrap_or(0);
            eprintln!(
                "[SHAPE_STATS embed] batch={} seq_padded={} max_active={}",
                batch_size, seq_len, max_active,
            );
        }

        // CoreML fast path — runs on CPU+NE, bypasses the candle Metal
        // lock entirely. CoremlEmbedding::embed serialises concurrent
        // callers through an internal per-model mutex (MLModel sync
        // predict is not thread-safe), and CPU+NE does not share a
        // command queue with candle's Metal backend, so it can run in
        // parallel with Metal LI. We only dispatch when the batch fits
        // the fixed traced shape; anything larger falls through to the
        // candle path below.
        #[cfg(feature = "coreml")]
        if let Some(coreml) = &inner.coreml {
            if coreml.fits(batch_size, seq_len) {
                return coreml
                    .embed(&self.input_ids, &self.attention_mask)
                    .map(Float32Array::new)
                    .map_err(|e| {
                        Error::from_reason(format!("[NativeEmbedding] CoreML: {e}"))
                    });
            }
            // Call did not fit any variant — record it in the dispatch
            // stats so the report can tell the user whether the cascade
            // needs more upper-range variants. This is the counterpart
            // to the per-variant dispatch_count increment inside embed().
            coreml.record_fallthrough();
        }

        // Entire Metal pipeline is serialized under the model mutex — tensor
        // creation, forward, pool, normalize, AND device→host copy all run
        // one-at-a-time. Candle Metal can't safely accept concurrent command
        // submissions against a shared model, and the issue also applies to
        // Tensor::new / to_vec2 on Metal. At concurrency=12 without this,
        // gencodesearchnet MRR collapses (93%→52% for embedding, 98%→25% for
        // LI). Tokenization and JS-side copies still run in parallel because
        // AsyncTask hops onto libuv worker threads.
        let flat_ids: Vec<u32> = self.input_ids.iter()
            .flatten()
            .map(|&x| x as u32)
            .collect();
        let flat_mask_u8: Vec<u8> = self.attention_mask.iter()
            .flatten()
            .map(|&x| x as u8)
            .collect();

        // Metal compute must be serialized across all candle models sharing
        // the GPU; CPU inference is already thread-safe (Accelerate BLAS +
        // candle CPU backend). Holding the lock on the CPU path would
        // needlessly serialize CPU embed against Metal LI, defeating the
        // CPU+GPU parallel pipeline.
        let _guard = if matches!(inner.device, Device::Metal(_)) {
            Some(metal_lock().lock()
                .map_err(|e| Error::from_reason(format!("[NativeEmbedding] metal lock poisoned: {e}")))?)
        } else {
            None
        };

        let result: Vec<f32> = {
            let ids_tensor = Tensor::new(flat_ids.as_slice(), &inner.device)
                .and_then(|t| t.reshape((batch_size, seq_len)))
                .map_err(|e| Error::from_reason(format!(
                    "[NativeEmbedding] input_ids tensor error: {e}"
                )))?;
            let mask_u8 = Tensor::new(flat_mask_u8.as_slice(), &inner.device)
                .and_then(|t| t.reshape((batch_size, seq_len)))
                .map_err(|e| Error::from_reason(format!(
                    "[NativeEmbedding] attention_mask tensor error: {e}"
                )))?;

            let hidden = inner.model.forward(&ids_tensor, None, Some(&mask_u8))
                .map_err(|e| Error::from_reason(format!(
                    "[NativeEmbedding] Forward pass error: {e}"
                )))?;
            let mask_float = mask_u8.to_dtype(hidden.dtype())
                .map_err(|e| Error::from_reason(format!(
                    "[NativeEmbedding] Mask dtype conversion error: {e}"
                )))?;
            let pooled = nomic_bert::mean_pooling(&hidden, &mask_float)
                .map_err(|e| Error::from_reason(format!(
                    "[NativeEmbedding] Mean pooling error: {e}"
                )))?;
            let normalized = nomic_bert::l2_normalize(&pooled)
                .map_err(|e| Error::from_reason(format!(
                    "[NativeEmbedding] L2 normalize error: {e}"
                )))?;

            // Use to_vec1 with a flat reshape rather than to_vec2 so we
            // avoid building the intermediate Vec<Vec<f32>> just to flatten
            // it again into the Float32Array.
            let flat_shape = (batch_size * inner.hidden_size,);
            match normalized.dtype() {
                DType::F32 => normalized
                    .reshape(flat_shape)
                    .and_then(|t| t.to_vec1::<f32>())
                    .map_err(|e| {
                        Error::from_reason(format!("[NativeEmbedding] Output conversion error: {e}"))
                    })?,
                _ => normalized
                    .to_dtype(DType::F32)
                    .and_then(|t| t.reshape(flat_shape))
                    .and_then(|t| t.to_vec1::<f32>())
                    .map_err(|e| {
                        Error::from_reason(format!("[NativeEmbedding] Output conversion error: {e}"))
                    })?,
            }
        };

        // The l2_normalize fix in nomic_bert_sdpa.rs guarantees no NaN/Inf
        // in the normalised output even for fully-padded rows. We could
        // still scrub the buffer here for defence-in-depth, but the cost is
        // a per-element scan of every output and Float32Array does not
        // forbid NaN the way JSON does, so we trust the upstream fix.
        Ok(Float32Array::new(result))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}
