//! ModernBERT late interaction model — LateOn-Code inference via candle.
//!
//! Loads FP32 safetensors weights (backbone + projection) and runs
//! forward inference natively.
//!
//! Pipeline:
//!   input_ids → ModernBERT encoder (22 layers) → projection (768d → 128d)
//!   → L2_normalize per token → per-token 128d vectors
//!
//! The backbone safetensors comes from lightonai/LateOn-Code (model.safetensors)
//! and the projection from 1_Dense/model.safetensors.

use candle_core::{DType, Device, IndexOp, Tensor, D};
use candle_nn::VarBuilder;
use napi::bindgen_prelude::*;
use napi::Task;
use napi_derive::napi;
use std::path::PathBuf;
use std::sync::Arc;

use super::modernbert_sdpa as modernbert;
#[cfg(feature = "coreml")]
use super::coreml_li::{CoremlLi, CoremlLiVariant};
use super::{build_device, metal_lock, optimal_dtype, select_device};

/// Inner state of the LI model. Metal compute is serialized via
/// `super::metal_lock()` — a process-wide mutex shared with the embedding
/// model. See `metal_lock` for why per-model locks aren't enough.
///
/// When the `coreml` feature is enabled AND
/// `NativeLateInteractionModel::load` is invoked with an explicit
/// `coreml_cascade_dir` containing one or more
/// `li_modernbert_b{B}_s{S}_fp16.mlpackage` files, `coreml` holds a
/// cascade of lazy-loaded CPU+NE backends used whenever any variant
/// fits the incoming batch. The candle backbone is kept loaded
/// unconditionally as the fallback for batches exceeding the largest
/// variant.
///
/// As with the embedding model, the cascade dir is passed down from
/// the JS infrastructure layer
/// (`core/infrastructure/native-inference.js` →
/// `getCoremlCascadeResolvedDirs()`). There is no env-var bypass —
/// init/uninstall/docs all see the same contract. See
/// docs/DDD_ARCHITECTURE.md.
struct LiInner {
    model: modernbert::ModernBert,
    projection_weight: Tensor,
    #[cfg(feature = "coreml")]
    coreml: Option<CoremlLi>,
    device: Device,
    backbone_dim: usize,
    token_dim: usize,
}

/// Match `EmbeddingInner::Drop` — dumps LI cascade dispatch stats on
/// shutdown when `SWEET_SEARCH_COREML_STATS=1`. See the matching
/// comment in embedding_model.rs for the rationale.
impl Drop for LiInner {
    fn drop(&mut self) {
        #[cfg(feature = "coreml")]
        if std::env::var_os("SWEET_SEARCH_COREML_STATS").is_some() {
            if let Some(coreml) = &self.coreml {
                eprintln!("{}", coreml.dispatch_report());
            }
        }
    }
}

/// Scan a CoreML LI cascade directory and build a variant list.
/// Called only when the JS caller passes an explicit dir. Variants
/// compile lazily on first dispatch. See the matching comment in
/// `embedding_model.rs::try_load_coreml_embedding_from_dir` for details.
///
/// Expected filename format:
///   li_modernbert_b{BATCH}_s{SEQ}_fp16.mlpackage
#[cfg(feature = "coreml")]
fn try_load_coreml_li_from_dir(dir: &str) -> Option<CoremlLi> {
    let dir_path = std::path::PathBuf::from(dir);

    let entries = match std::fs::read_dir(&dir_path) {
        Ok(it) => it,
        Err(e) => {
            eprintln!(
                "[NativeLI] CoreML cascade dir {} unreadable: {} — falling back to candle",
                dir, e
            );
            return None;
        }
    };

    let mut variants: Vec<CoremlLiVariant> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let fname = match path.file_name().and_then(|n| n.to_str()) {
            Some(s) => s,
            None => continue,
        };
        if let Some((batch, seq)) = parse_li_variant_filename(fname) {
            variants.push(CoremlLiVariant::new(batch, seq, path));
        }
    }

    if variants.is_empty() {
        eprintln!(
            "[NativeLI] CoreML cascade dir {} contained no li_modernbert_b{{B}}_s{{S}}_fp16.mlpackage files — falling back to candle",
            dir,
        );
        return None;
    }

    let cascade = CoremlLi::from_variants(variants);
    let shapes: Vec<String> = cascade
        .variant_shapes()
        .map(|(b, s)| format!("b{}×s{}", b, s))
        .collect();
    eprintln!(
        "[NativeLI] CoreML cascade loaded: {} variants [{}] (lazy — each compiles on first use)",
        cascade.len(),
        shapes.join(", "),
    );
    Some(cascade)
}

/// Parse `li_modernbert_b{BATCH}_s{SEQ}_fp16.mlpackage` into `(batch, seq)`.
#[cfg(feature = "coreml")]
fn parse_li_variant_filename(fname: &str) -> Option<(usize, usize)> {
    let rest = fname.strip_prefix("li_modernbert_b")?;
    let rest = rest.strip_suffix("_fp16.mlpackage")?;
    let (batch_str, seq_part) = rest.split_once("_s")?;
    let batch: usize = batch_str.parse().ok()?;
    let seq: usize = seq_part.parse().ok()?;
    Some((batch, seq))
}

/// Startup parity check between candle and CoreML for LI. Runs one
/// synthetic batch through both backends and returns the mean cosine
/// similarity across active-token pairs. Because both backends emit
/// per-token L2-normalised vectors, each per-token cosine is the dot
/// product of the two 128-d outputs.
///
/// Uses the same vocab-safe fixture as the embedding parity check —
/// 64 active positions with [CLS]+common-subword-ids+[SEP] — so the
/// per-token FP16/BF16 rounding noise has the same budget on both
/// checks. See `embedding_parity_cosine` for the rationale behind the
/// fixture shape.
#[cfg(feature = "coreml")]
fn li_parity_cosine(
    candle_model: &modernbert::ModernBert,
    projection_weight: &Tensor,
    device: &Device,
    backbone_dim: usize,
    token_dim: usize,
    coreml: &CoremlLi,
) -> std::result::Result<f32, String> {
    const ACTIVE: usize = 64;
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

    // Candle forward + projection + per-token normalize. Mirrors
    // LiEncodeTask::compute but without the Float32Array packaging and
    // active-token slicing — we just need the [ACTIVE, token_dim]
    // slice of normalised per-token vectors to compare against CoreML.
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
        .forward(&ids_tensor, &mask_u8)
        .map_err(|e| format!("candle forward: {e}"))?;
    let proj_t = projection_weight
        .t()
        .map_err(|e| format!("projection transpose: {e}"))?;
    let hidden_2d = hidden
        .reshape((seq_len, backbone_dim))
        .map_err(|e| format!("hidden reshape: {e}"))?;
    let projected = hidden_2d
        .matmul(&proj_t)
        .and_then(|t| t.reshape((1, seq_len, token_dim)))
        .map_err(|e| format!("projection matmul: {e}"))?;
    let norm = projected
        .sqr()
        .and_then(|t| t.sum_keepdim(D::Minus1))
        .and_then(|t| (t + 1e-12f64))
        .and_then(|t| t.sqrt())
        .map_err(|e| format!("norm compute: {e}"))?;
    let normalized = projected
        .broadcast_div(&norm)
        .and_then(|t| t.to_dtype(DType::F32))
        .map_err(|e| format!("normalize: {e}"))?;

    // Active tokens only — first ACTIVE rows, flat.
    let candle_active: Vec<f32> = normalized
        .i(0)
        .and_then(|t| t.narrow(0, 0, ACTIVE))
        .and_then(|t| t.reshape((ACTIVE * token_dim,)))
        .and_then(|t| t.to_vec1::<f32>())
        .map_err(|e| format!("candle extract: {e}"))?;
    drop(_guard);

    // CoreML forward — returns (flat active tokens, counts).
    let coreml_input_ids = vec![ids_row];
    let coreml_mask = vec![mask_row];
    let (coreml_active, counts) = coreml.encode(&coreml_input_ids, &coreml_mask)?;
    if counts.len() != 1 || counts[0] as usize != ACTIVE {
        return Err(format!(
            "unexpected CoreML active count: expected 1 batch of {}, got counts={:?}",
            ACTIVE, counts
        ));
    }
    if candle_active.len() != coreml_active.len() {
        return Err(format!(
            "length mismatch: candle={} coreml={}",
            candle_active.len(),
            coreml_active.len()
        ));
    }

    // Mean per-token cosine across the ACTIVE positions. Each 128-d
    // slice is already L2-normalised so per-token cosine = dot product.
    let mut sum = 0.0f32;
    for t in 0..ACTIVE {
        let base = t * token_dim;
        let mut dot = 0.0f32;
        for k in 0..token_dim {
            dot += candle_active[base + k] * coreml_active[base + k];
        }
        sum += dot;
    }
    Ok(sum / ACTIVE as f32)
}

/// Parity threshold for LI. Spike measured 0.9999 mean per-token cosine
/// between candle BF16 and CoreML CPU_AND_NE on real sentences, so
/// 0.998 leaves ~2e-3 room for runtime drift while still catching
/// actual breakage.
#[cfg(feature = "coreml")]
const COREML_LI_PARITY_THRESHOLD: f32 = 0.998;

/// Native ModernBERT late interaction model for LateOn-Code inference.
///
/// Constructed once via `NativeLateInteractionModel.load()`, reused for all
/// encode calls. Produces per-token 128d L2-normalized vectors.
///
/// Encoding is exposed as an `AsyncTask` so Metal GPU work runs on a libuv
/// worker thread instead of blocking the JS event loop. Multiple concurrent
/// encodes on the same model share the same inner state via `Arc`.
#[napi]
pub struct NativeLateInteractionModel {
    inner: Arc<LiInner>,
}

#[napi]
impl NativeLateInteractionModel {
    /// Load a ModernBERT late interaction model from FP32 safetensors weights.
    ///
    /// # Arguments
    /// * `backbone_path` - Path to model.safetensors (FP32 backbone weights)
    /// * `projection_path` - Path to 1_Dense/model.safetensors (projection weights)
    /// * `config_path` - Path to config.json (model architecture config)
    /// * `coreml_cascade_dir` - Optional path to a directory containing
    ///   `li_modernbert_b{B}_s{S}_fp16.mlpackage` files. Same contract
    ///   as `NativeEmbeddingModel::load` — see its doc comment for the
    ///   full rationale. `None` disables the CoreML path entirely.
    #[napi(factory)]
    pub fn load(
        backbone_path: String,
        projection_path: String,
        config_path: String,
        coreml_cascade_dir: Option<String>,
    ) -> Result<Self> {
        let device = select_device()
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Device init error: {e}"
            )))?;
        Self::load_on_device(backbone_path, projection_path, config_path, coreml_cascade_dir, device)
    }

    /// Load with an explicit device kind ("cpu", "metal", or "auto").
    #[napi(factory)]
    pub fn load_with_device(
        backbone_path: String,
        projection_path: String,
        config_path: String,
        coreml_cascade_dir: Option<String>,
        device_kind: String,
    ) -> Result<Self> {
        let device = build_device(&device_kind)
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Device init error for '{device_kind}': {e}"
            )))?;
        Self::load_on_device(backbone_path, projection_path, config_path, coreml_cascade_dir, device)
    }

    fn load_on_device(
        backbone_path: String,
        projection_path: String,
        config_path: String,
        coreml_cascade_dir: Option<String>,
        device: Device,
    ) -> Result<Self> {
        #[cfg(not(feature = "coreml"))]
        {
            let _ = &coreml_cascade_dir;
        }

        let config_str = std::fs::read_to_string(&config_path)
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Failed to read config at {config_path}: {e}"
            )))?;

        let config: modernbert::Config = serde_json::from_str(&config_str)
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Config parse error: {e}"
            )))?;

        let backbone_dim = config.hidden_size;

        let dtype = optimal_dtype(&device);
        let bb_path = PathBuf::from(&backbone_path);
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[bb_path], dtype, &device)
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Failed to load backbone from {backbone_path}: {e}"
                )))?
        };

        let vb = vb.rename_f(|name| {
            name.strip_prefix("model.")
                .unwrap_or(name)
                .to_string()
        });

        let model = modernbert::ModernBert::load(vb, &config)
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Backbone load error: {e}"
            )))?;

        let proj_path = PathBuf::from(&projection_path);
        let proj_vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[proj_path], dtype, &device)
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Failed to load projection from {projection_path}: {e}"
                )))?
        };

        let projection_weight = proj_vb.get((128, backbone_dim), "linear.weight")
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Projection weight load error: {e}"
            )))?;

        let token_dim = 128;

        let device_name = match &device {
            Device::Cpu => "cpu",
            #[cfg(feature = "metal")]
            Device::Metal(_) => "metal",
            _ => "unknown",
        };
        let dtype_name = match dtype {
            DType::F16 => "f16",
            DType::BF16 => "bf16",
            DType::F32 => "f32",
            _ => "other",
        };
        eprintln!(
            "[NativeLI] Loaded ModernBERT ({backbone_dim}d → {token_dim}d, {} layers, device: {device_name}, dtype: {dtype_name})",
            config.num_hidden_layers,
        );

        #[cfg(feature = "coreml")]
        let coreml = match coreml_cascade_dir.as_deref().and_then(try_load_coreml_li_from_dir) {
            None => None,
            Some(c) => match li_parity_cosine(
                &model,
                &projection_weight,
                &device,
                backbone_dim,
                token_dim,
                &c,
            ) {
                Ok(cos) if cos >= COREML_LI_PARITY_THRESHOLD => {
                    eprintln!(
                        "[NativeLI] CoreML parity OK (mean cosine {:.6} ≥ {:.3})",
                        cos, COREML_LI_PARITY_THRESHOLD
                    );
                    Some(c)
                }
                Ok(cos) => {
                    eprintln!(
                        "[NativeLI] CoreML parity FAILED (mean cosine {:.6} < {:.3}) — dropping CoreML backend",
                        cos, COREML_LI_PARITY_THRESHOLD
                    );
                    None
                }
                Err(e) => {
                    eprintln!(
                        "[NativeLI] CoreML parity check errored: {} — dropping CoreML backend",
                        e
                    );
                    None
                }
            },
        };

        Ok(Self {
            inner: Arc::new(LiInner {
                model,
                projection_weight,
                #[cfg(feature = "coreml")]
                coreml,
                device,
                backbone_dim,
                token_dim,
            }),
        })
    }

    /// Return the per-token embedding dimension (128 for LateOn-Code).
    #[napi(getter)]
    pub fn dim(&self) -> u32 {
        self.inner.token_dim as u32
    }

    /// Encode a batch of pre-tokenized inputs into per-token vectors.
    ///
    /// Returns an `AsyncTask` so the forward pass runs on a libuv worker
    /// thread: the JS event loop is released during Metal compute, letting
    /// tokenization of batch N+1 and sqlite writes of batch N-1 overlap
    /// with GPU execution of batch N.
    ///
    /// # Arguments
    /// * `input_ids` - 2D array of token IDs, shape [batch, seq_len]
    /// * `attention_mask` - 2D array of 0/1 mask values, shape [batch, seq_len]
    ///
    /// # Returns
    /// A Promise resolving to `LiEncodingResult { vectors, tokenCounts }`,
    /// where `vectors` is a flat `Float32Array` of all per-token vectors
    /// concatenated across batch items, and `tokenCounts` is the active
    /// token count per batch item. Callers slice via
    /// `vectors.slice(offset, offset + count * dim)` per item.
    ///
    /// We return a `Float32Array` instead of a flat `Vec<f64>` (or a JSON
    /// string) because napi-rs would otherwise serialise the vec by calling
    /// `napi_set_element` once per element — for a typical batch of
    /// 32 × ~256 active tokens × 128 dims that is over 1,000,000 napi
    /// crossings per batch, which dominated wall clock at ~10s/batch of
    /// pure napi overhead at indexer-realistic shapes. A `Float32Array` is
    /// constructed in a single napi call with one memcpy of the underlying
    /// buffer (~tens of ms even for 30 MB).
    #[napi(ts_return_type = "Promise<LiEncodingResult>")]
    pub fn encode_batch(
        &self,
        input_ids: Vec<Vec<i64>>,
        attention_mask: Vec<Vec<i64>>,
    ) -> AsyncTask<LiEncodeTask> {
        AsyncTask::new(LiEncodeTask {
            inner: self.inner.clone(),
            input_ids,
            attention_mask,
        })
    }

    /// Run a single dummy forward pass to warm Metal pipelines and BLAS
    /// thread pools. Call once after `load_with_device` before starting
    /// a batch indexing run.
    #[napi(ts_return_type = "Promise<void>")]
    pub fn warmup_forward(&self) -> AsyncTask<LiWarmupTask> {
        AsyncTask::new(LiWarmupTask {
            inner: self.inner.clone(),
        })
    }
}

/// napi `Task` running LI encoding on a libuv worker thread.
pub struct LiEncodeTask {
    inner: Arc<LiInner>,
    input_ids: Vec<Vec<i64>>,
    attention_mask: Vec<Vec<i64>>,
}

impl Task for LiEncodeTask {
    type Output = LiEncodingResult;
    type JsValue = LiEncodingResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let inner = &*self.inner;
        let batch_size = self.input_ids.len();
        if batch_size == 0 {
            return Ok(LiEncodingResult {
                vectors: Float32Array::new(Vec::new()),
                token_counts: vec![],
            });
        }
        let seq_len = self.input_ids[0].len();

        // Shape-distribution logging for choosing CoreML traced shapes.
        // Gated behind SWEET_SEARCH_LOG_NATIVE_SHAPES. Same rationale as
        // the matching block in embedding_model.rs — see that comment.
        if std::env::var_os("SWEET_SEARCH_LOG_NATIVE_SHAPES").is_some() {
            let max_active = self
                .attention_mask
                .iter()
                .map(|row| row.iter().filter(|&&v| v != 0).count())
                .max()
                .unwrap_or(0);
            eprintln!(
                "[SHAPE_STATS li] batch={} seq_padded={} max_active={}",
                batch_size, seq_len, max_active,
            );
        }

        // CoreML fast path — runs on CPU+NE, bypasses the candle Metal
        // lock entirely. Fits check prevents batches/sequences larger
        // than the traced fixed shape from dispatching here; those fall
        // through to the candle path below. CoremlLi::encode serialises
        // concurrent callers through its internal per-model mutex.
        #[cfg(feature = "coreml")]
        if let Some(coreml) = &inner.coreml {
            if coreml.fits(batch_size, seq_len) {
                return coreml
                    .encode(&self.input_ids, &self.attention_mask)
                    .map(|(vectors, token_counts)| LiEncodingResult {
                        vectors: Float32Array::new(vectors),
                        token_counts,
                    })
                    .map_err(|e| {
                        Error::from_reason(format!("[NativeLI] CoreML: {e}"))
                    });
            }
            // Fell through because no variant fit — record it so the
            // cascade report accurately reflects call patterns.
            coreml.record_fallthrough();
        }

        // Entire Metal pipeline is serialized under the model mutex. Candle's
        // Metal backend can't safely accept concurrent submissions against the
        // same model instance (command buffers interleave and corrupt outputs).
        // This was catastrophic for LI specifically: at concurrency=12 the
        // gencodesearchnet MRR collapsed from ~98% to ~25%. Serializing the
        // entire compute block — tensor creation, forward, projection, norm,
        // AND extraction — fixes it. Tokenization and JS-side result copies
        // still run in parallel because AsyncTask hops onto libuv worker
        // threads; only the Metal section is one-at-a-time.
        let flat_ids: Vec<u32> = self.input_ids.iter()
            .flatten()
            .map(|&x| x as u32)
            .collect();
        let flat_mask_u8: Vec<u8> = self.attention_mask.iter()
            .flatten()
            .map(|&x| x as u8)
            .collect();
        let active_counts: Vec<usize> = self.attention_mask.iter()
            .map(|row| row.iter().filter(|&&v| v != 0).count())
            .collect();

        // Metal-only lock: CPU path skips the mutex (CPU backend is
        // thread-safe via Accelerate BLAS). Holding the lock on CPU would
        // prevent CPU embed from running in parallel with Metal LI, which is
        // the whole point of the CPU+GPU split.
        let _guard = if matches!(inner.device, Device::Metal(_)) {
            Some(metal_lock().lock()
                .map_err(|e| Error::from_reason(format!("[NativeLI] metal lock poisoned: {e}")))?)
        } else {
            None
        };

        let (all_vectors, token_counts) = {
            let ids_tensor = Tensor::new(flat_ids.as_slice(), &inner.device)
                .and_then(|t| t.reshape((batch_size, seq_len)))
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] input_ids tensor error: {e}"
                )))?;
            let mask_u8 = Tensor::new(flat_mask_u8.as_slice(), &inner.device)
                .and_then(|t| t.reshape((batch_size, seq_len)))
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] attention_mask tensor error: {e}"
                )))?;

            let hidden = inner.model.forward(&ids_tensor, &mask_u8)
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Forward pass error: {e}"
                )))?;

            let proj_t = inner.projection_weight.t()
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Projection transpose error: {e}"
                )))?;
            let hidden_2d = hidden.reshape((batch_size * seq_len, inner.backbone_dim))
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Hidden reshape error: {e}"
                )))?;
            let projected = hidden_2d.matmul(&proj_t)
                .and_then(|t| t.reshape((batch_size, seq_len, inner.token_dim)))
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Projection matmul error: {e}"
                )))?;

            let norm = projected.sqr()
                .and_then(|t| t.sum_keepdim(D::Minus1))
                .and_then(|t| (t + 1e-12f64))
                .and_then(|t| t.sqrt())
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Norm computation error: {e}"
                )))?;
            let normalized = projected.broadcast_div(&norm)
                .and_then(|t| t.to_dtype(DType::F32))
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Normalize error: {e}"
                )))?;

            // Extract per-batch-item active token vectors inside the lock so
            // the device→host copies don't race with another worker's forward.
            // Keep them as f32 (no longer widening to f64) — JSON encoding
            // works fine on f32 and we save 50% on the encode-side string
            // length.
            let mut all_vectors: Vec<f32> = Vec::new();
            let mut token_counts: Vec<u32> = Vec::with_capacity(batch_size);
            for (b, &active) in active_counts.iter().enumerate() {
                token_counts.push(active as u32);
                if active == 0 { continue; }
                let batch_vecs = normalized.i(b)
                    .and_then(|t| t.narrow(0, 0, active))
                    .and_then(|t| t.reshape((active * inner.token_dim,)))
                    .and_then(|t| t.to_vec1::<f32>())
                    .map_err(|e| Error::from_reason(format!(
                        "[NativeLI] Vector extraction error for batch {b}: {e}"
                    )))?;
                all_vectors.extend(batch_vecs);
            }
            (all_vectors, token_counts)
        };

        // Move the whole f32 buffer into a Float32Array in a single napi
        // call. The Vec<f32> is consumed by Float32Array::new and the
        // underlying memory is handed to V8 as a typed array. No
        // per-element conversion, no JSON round-trip.
        Ok(LiEncodingResult {
            vectors: Float32Array::new(all_vectors),
            token_counts,
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Result of late interaction encoding.
///
/// `vectors` is a flat `Float32Array` of all per-token vectors for all
/// batch items concatenated. Length = sum(token_counts) × dim. Slice via
/// `vectors.slice(offset, offset + count * dim)` at cumulative offsets to
/// recover per-batch-item per-token vectors.
///
/// We return a typed array instead of a nested `Vec<Vec<f64>>` (or a JSON
/// string) to avoid per-element `napi_set_element` round-trips — see the
/// comment on `encode_batch` above.
#[napi(object)]
pub struct LiEncodingResult {
    pub vectors: Float32Array,
    /// Number of active (non-padding) tokens per batch item.
    pub token_counts: Vec<u32>,
}

/// Warmup task: runs a single dummy forward pass to arm Metal pipelines
/// and BLAS thread pools. Reuses the full LiEncodeTask code path so
/// CoreML variants are also compiled during warmup.
pub struct LiWarmupTask {
    inner: Arc<LiInner>,
}

impl Task for LiWarmupTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        let seq_len = 64;
        let mut task = LiEncodeTask {
            inner: self.inner.clone(),
            input_ids: vec![vec![1i64; seq_len]],
            attention_mask: vec![vec![1i64; seq_len]],
        };
        let _ = task.compute()?;
        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}
