//! ModernBERT late interaction model — LateOn-Code inference via candle.
//!
//! Loads FP32 safetensors weights (backbone + N-stage projection) and
//! runs forward inference natively. Two model variants are supported:
//!
//! | Variant            | Backbone | Projection         | Output |
//! |--------------------|----------|--------------------|--------|
//! | `lateon-code`      | 768d×22L | 1 stage (768→128)  | 128d   |
//! | `lateon-code-edge` | 256d×7L  | 2 stage (256→512→48) | 48d  |
//!
//! Pipeline (general):
//!   input_ids → ModernBERT encoder → projection chain → L2_normalize
//!   per token → per-token `token_dim` vectors
//!
//! Backbone dim, layer count, etc. are read dynamically from the
//! supplied `config.json` so a single struct serves both variants.
//! The list of projection paths and their expected output dims is
//! supplied by the JS caller (see
//! `core/infrastructure/native-inference.js::resolveNativeLiVariant`)
//! so Rust validates shapes against a manifest rather than hardcoding
//! a single (out_dim, in_dim) pair.

use candle_core::{DType, Device, IndexOp, Tensor, D};
use candle_nn::VarBuilder;
use napi::bindgen_prelude::*;
use napi::Task;
use napi_derive::napi;
use std::path::PathBuf;
use std::sync::Arc;

#[cfg(feature = "coreml")]
use super::coreml_li::{CoremlLi, CoremlLiVariant};
#[cfg(feature = "cuda")]
use super::cuda_lock;
use super::modernbert_sdpa as modernbert;
use super::{build_device, metal_lock, optimal_dtype, select_device, ModelKind};

/// Inner state of the LI model. Metal compute is serialized via
/// `super::metal_lock()` — a process-wide mutex shared with the embedding
/// model. See `metal_lock` for why per-model locks aren't enough.
///
/// `projection_weights` is the projection chain applied after the
/// backbone — one tensor per stage. The standard `lateon-code` variant
/// has one stage (768→128); the `lateon-code-edge` variant has two
/// (256→512→48). Forward applies them in order via fold; `token_dim`
/// is the out-dim of the final stage.
///
/// When the `coreml` feature is enabled AND
/// `NativeLateInteractionModel::load` is invoked with an explicit
/// `coreml_cascade_dir` containing one or more
/// `li_modernbert_b{B}_s{S}_fp16.mlpackage` (standard) or
/// `li_modernbert_edge_b{B}_s{S}_fp16.mlpackage` (edge) files,
/// `coreml` holds a cascade of lazy-loaded CPU+NE backends used
/// whenever any variant fits the incoming batch. The candle backbone
/// is kept loaded unconditionally as the fallback for batches
/// exceeding the largest variant.
///
/// As with the embedding model, the cascade dir is passed down from
/// the JS infrastructure layer
/// (`core/infrastructure/native-inference.js` →
/// `getCoremlCascadeResolvedDirs()`). There is no env-var bypass —
/// init/uninstall/docs all see the same contract. See
/// docs/DDD_ARCHITECTURE.md.
struct LiInner {
    model: modernbert::ModernBert,
    projection_weights: Vec<Tensor>,
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
/// Expected filename formats:
///   `li_modernbert_b{BATCH}_s{SEQ}_fp16.mlpackage`        — standard 128d
///   `li_modernbert_edge_b{BATCH}_s{SEQ}_fp16.mlpackage`   — edge 48d
///
/// `expected_token_dim` is the active model's per-token output dim
/// (from JS `LATE_INTERACTION_CONFIG`). Variants whose filename
/// implies a different `token_dim` are ignored — JS always points us
/// at a per-variant subdir (`coreml-cascade/li/` vs `li-edge/`) so any
/// mismatch is a packaging bug worth flagging without faulting.
#[cfg(feature = "coreml")]
fn try_load_coreml_li_from_dir(dir: &str, expected_token_dim: usize) -> Option<CoremlLi> {
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
    let mut skipped_wrong_dim = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        let fname = match path.file_name().and_then(|n| n.to_str()) {
            Some(s) => s,
            None => continue,
        };
        if let Some((batch, seq, dim)) = parse_li_variant_filename(fname) {
            if dim != expected_token_dim {
                skipped_wrong_dim += 1;
                continue;
            }
            variants.push(CoremlLiVariant::new(batch, seq, dim, path));
        }
    }

    if variants.is_empty() {
        if skipped_wrong_dim > 0 {
            eprintln!(
                "[NativeLI] CoreML cascade dir {} contained {} variants but all had wrong token_dim (expected {}d) — falling back to candle",
                dir, skipped_wrong_dim, expected_token_dim,
            );
        } else {
            eprintln!(
                "[NativeLI] CoreML cascade dir {} contained no recognised li_modernbert*_b{{B}}_s{{S}}_fp16.mlpackage files — falling back to candle",
                dir,
            );
        }
        return None;
    }

    let cascade = match CoremlLi::from_variants(variants) {
        Some(c) => c,
        None => {
            eprintln!(
                "[NativeLI] CoreML cascade dir {} produced inconsistent variants — falling back to candle",
                dir,
            );
            return None;
        }
    };
    let shapes: Vec<String> = cascade
        .variant_shapes()
        .map(|(b, s)| format!("b{}×s{}", b, s))
        .collect();
    eprintln!(
        "[NativeLI] CoreML cascade loaded: {} variants @{}d [{}] (lazy — each compiles on first use)",
        cascade.len(),
        cascade.token_dim(),
        shapes.join(", "),
    );
    Some(cascade)
}

/// Parse a CoreML LI variant filename into `(batch, seq, token_dim)`.
///
/// Recognises:
///   `li_modernbert_b{B}_s{S}_fp16.mlpackage`        → token_dim=128
///   `li_modernbert_edge_b{B}_s{S}_fp16.mlpackage`   → token_dim=48
///
/// Returns `None` for unrecognised filenames.
#[cfg(feature = "coreml")]
fn parse_li_variant_filename(fname: &str) -> Option<(usize, usize, usize)> {
    let rest = fname.strip_suffix("_fp16.mlpackage")?;
    // Order matters: try the longer "edge" prefix first so we don't
    // accidentally match it as the standard prefix + "edge_b…" leftover.
    let (token_dim, body) = if let Some(r) = rest.strip_prefix("li_modernbert_edge_b") {
        (48usize, r)
    } else if let Some(r) = rest.strip_prefix("li_modernbert_b") {
        (128usize, r)
    } else {
        return None;
    };
    let (batch_str, seq_part) = body.split_once("_s")?;
    let batch: usize = batch_str.parse().ok()?;
    let seq: usize = seq_part.parse().ok()?;
    Some((batch, seq, token_dim))
}

/// Startup parity check between candle and CoreML for LI. Runs one
/// synthetic batch through both backends and returns the mean cosine
/// similarity across active-token pairs. Because both backends emit
/// per-token L2-normalised vectors, each per-token cosine is the dot
/// product of the two `token_dim`-dim outputs.
///
/// Works for any number of projection stages — applies them in a fold
/// matching `LiEncodeTask::compute`, so this verifies both the
/// standard 1-stage `lateon-code` and 2-stage `lateon-code-edge`
/// chains against their respective traced CoreML outputs.
///
/// Uses the same vocab-safe fixture as the embedding parity check —
/// 64 active positions with [CLS]+common-subword-ids+[SEP] — so the
/// per-token FP16/BF16 rounding noise has the same budget on both
/// checks. See `embedding_parity_cosine` for the rationale behind the
/// fixture shape.
#[cfg(feature = "coreml")]
fn li_parity_cosine(
    candle_model: &modernbert::ModernBert,
    projection_weights: &[Tensor],
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

    // Candle forward + projection chain + per-token normalize. Mirrors
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
    let mut projected = hidden
        .reshape((seq_len, backbone_dim))
        .map_err(|e| format!("hidden reshape: {e}"))?;
    for (i, w) in projection_weights.iter().enumerate() {
        let w_t = w
            .t()
            .map_err(|e| format!("projection {} transpose: {e}", i))?;
        projected = projected
            .matmul(&w_t)
            .map_err(|e| format!("projection {} matmul: {e}", i))?;
    }
    let projected = projected
        .reshape((1, seq_len, token_dim))
        .map_err(|e| format!("projection reshape: {e}"))?;
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
    /// * `projection_paths` - Ordered list of projection-stage paths.
    ///   Standard `lateon-code` passes `[".../1_Dense/model.safetensors"]`;
    ///   `lateon-code-edge` passes
    ///   `[".../1_Dense/model.safetensors", ".../2_Dense/model.safetensors"]`.
    ///   Must be non-empty.
    /// * `projection_dims` - Expected per-stage output dim (`out_features`),
    ///   one per `projection_paths` entry. Standard: `[128]`; edge: `[512, 48]`.
    ///   Length must equal `projection_paths.len()`. Each stage's input dim
    ///   is taken from the previous stage's output (or `config.hidden_size`
    ///   for stage 0); shape mismatches against the safetensors content
    ///   surface immediately at load.
    /// * `config_path` - Path to config.json (model architecture config)
    /// * `coreml_cascade_dir` - Optional path to a directory containing
    ///   `li_modernbert_b{B}_s{S}_fp16.mlpackage` (standard) or
    ///   `li_modernbert_edge_b{B}_s{S}_fp16.mlpackage` (edge) files.
    ///   The cascade's `token_dim` must match the final projection dim
    ///   or the cascade is rejected. Same contract as
    ///   `NativeEmbeddingModel::load` — see its doc comment for the
    ///   full rationale. `None` disables the CoreML path entirely.
    #[napi(factory)]
    pub fn load(
        backbone_path: String,
        projection_paths: Vec<String>,
        projection_dims: Vec<u32>,
        config_path: String,
        coreml_cascade_dir: Option<String>,
    ) -> Result<Self> {
        let device = select_device()
            .map_err(|e| Error::from_reason(format!("[NativeLI] Device init error: {e}")))?;
        Self::load_on_device(
            backbone_path,
            projection_paths,
            projection_dims,
            config_path,
            coreml_cascade_dir,
            device,
        )
    }

    /// Load with an explicit device kind ("cpu", "metal", or "auto").
    #[napi(factory)]
    pub fn load_with_device(
        backbone_path: String,
        projection_paths: Vec<String>,
        projection_dims: Vec<u32>,
        config_path: String,
        coreml_cascade_dir: Option<String>,
        device_kind: String,
    ) -> Result<Self> {
        let device = build_device(&device_kind).map_err(|e| {
            Error::from_reason(format!(
                "[NativeLI] Device init error for '{device_kind}': {e}"
            ))
        })?;
        Self::load_on_device(
            backbone_path,
            projection_paths,
            projection_dims,
            config_path,
            coreml_cascade_dir,
            device,
        )
    }

    fn load_on_device(
        backbone_path: String,
        projection_paths: Vec<String>,
        projection_dims: Vec<u32>,
        config_path: String,
        coreml_cascade_dir: Option<String>,
        device: Device,
    ) -> Result<Self> {
        #[cfg(not(feature = "coreml"))]
        {
            let _ = &coreml_cascade_dir;
        }

        if projection_paths.is_empty() {
            return Err(Error::from_reason(
                "[NativeLI] projection_paths must contain at least one stage".to_string(),
            ));
        }
        if projection_paths.len() != projection_dims.len() {
            return Err(Error::from_reason(format!(
                "[NativeLI] projection_paths.len()={} != projection_dims.len()={}",
                projection_paths.len(),
                projection_dims.len(),
            )));
        }

        let config_str = std::fs::read_to_string(&config_path).map_err(|e| {
            Error::from_reason(format!(
                "[NativeLI] Failed to read config at {config_path}: {e}"
            ))
        })?;

        let config: modernbert::Config = serde_json::from_str(&config_str)
            .map_err(|e| Error::from_reason(format!("[NativeLI] Config parse error: {e}")))?;

        let backbone_dim = config.hidden_size;

        let dtype = optimal_dtype(&device, ModelKind::LateInteraction);
        let bb_path = PathBuf::from(&backbone_path);

        // Load-time CUDA serialization — see embedding_model.rs::load_on_device
        // for the rationale. Forward passes remain lock-free.
        #[cfg(feature = "cuda")]
        let _cuda_load_guard =
            if matches!(device, Device::Cuda(_)) {
                Some(cuda_lock().lock().map_err(|e| {
                    Error::from_reason(format!("[NativeLI] cuda lock poisoned: {e}"))
                })?)
            } else {
                None
            };

        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[bb_path], dtype, &device).map_err(|e| {
                Error::from_reason(format!(
                    "[NativeLI] Failed to load backbone from {backbone_path}: {e}"
                ))
            })?
        };

        let vb = vb.rename_f(|name| name.strip_prefix("model.").unwrap_or(name).to_string());

        let model = modernbert::ModernBert::load(vb, &config)
            .map_err(|e| Error::from_reason(format!("[NativeLI] Backbone load error: {e}")))?;

        // Load each projection stage in order. Each stage's expected
        // input dim is the previous stage's output dim (or backbone_dim
        // for the first), and the expected output dim comes from the
        // JS-supplied projection_dims manifest. Shape mismatches against
        // the safetensors are caught here.
        let mut projection_weights: Vec<Tensor> = Vec::with_capacity(projection_paths.len());
        let mut current_in_dim = backbone_dim;
        for (i, path_str) in projection_paths.iter().enumerate() {
            let proj_path = PathBuf::from(path_str);
            let proj_vb = unsafe {
                VarBuilder::from_mmaped_safetensors(&[proj_path], dtype, &device).map_err(|e| {
                    Error::from_reason(format!(
                        "[NativeLI] Failed to load projection stage {i} from {path_str}: {e}"
                    ))
                })?
            };
            let out_dim = projection_dims[i] as usize;
            let weight = proj_vb
                .get((out_dim, current_in_dim), "linear.weight")
                .map_err(|e| {
                    Error::from_reason(format!(
                        "[NativeLI] Projection stage {i} weight load error \
                         (expected shape ({out_dim}, {current_in_dim})): {e}"
                    ))
                })?;
            projection_weights.push(weight);
            current_in_dim = out_dim;
        }
        let token_dim = current_in_dim;

        #[cfg(feature = "cuda")]
        drop(_cuda_load_guard);

        let device_name = match &device {
            Device::Cpu => "cpu",
            #[cfg(feature = "metal")]
            Device::Metal(_) => "metal",
            #[cfg(feature = "cuda")]
            Device::Cuda(_) => "cuda",
            _ => "unknown",
        };
        let dtype_name = match dtype {
            DType::F16 => "f16",
            DType::BF16 => "bf16",
            DType::F32 => "f32",
            _ => "other",
        };
        let stage_chain = std::iter::once(backbone_dim)
            .chain(projection_dims.iter().map(|&d| d as usize))
            .map(|d| format!("{d}d"))
            .collect::<Vec<_>>()
            .join(" → ");
        eprintln!(
            "[NativeLI] Loaded ModernBERT ({stage_chain}, {} layers, {} projection stage(s), device: {device_name}, dtype: {dtype_name})",
            config.num_hidden_layers,
            projection_weights.len(),
        );

        #[cfg(feature = "coreml")]
        let coreml = match coreml_cascade_dir
            .as_deref()
            .and_then(|d| try_load_coreml_li_from_dir(d, token_dim))
        {
            None => None,
            Some(c) => match li_parity_cosine(
                &model,
                &projection_weights,
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
                projection_weights,
                #[cfg(feature = "coreml")]
                coreml,
                device,
                backbone_dim,
                token_dim,
            }),
        })
    }

    /// Return the per-token embedding dimension after the final
    /// projection stage (128 for LateOn-Code, 48 for LateOn-Code-edge).
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
                    .map_err(|e| Error::from_reason(format!("[NativeLI] CoreML: {e}")));
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
        let flat_ids: Vec<u32> = self.input_ids.iter().flatten().map(|&x| x as u32).collect();
        let flat_mask_u8: Vec<u8> = self
            .attention_mask
            .iter()
            .flatten()
            .map(|&x| x as u8)
            .collect();
        let active_counts: Vec<usize> = self
            .attention_mask
            .iter()
            .map(|row| row.iter().filter(|&&v| v != 0).count())
            .collect();

        // Metal-only lock: CPU path skips the mutex (CPU backend is
        // thread-safe via Accelerate BLAS). Holding the lock on CPU would
        // prevent CPU embed from running in parallel with Metal LI, which is
        // the whole point of the CPU+GPU split.
        let _guard =
            if matches!(inner.device, Device::Metal(_)) {
                Some(metal_lock().lock().map_err(|e| {
                    Error::from_reason(format!("[NativeLI] metal lock poisoned: {e}"))
                })?)
            } else {
                None
            };

        let (all_vectors, token_counts) = {
            let ids_tensor = Tensor::new(flat_ids.as_slice(), &inner.device)
                .and_then(|t| t.reshape((batch_size, seq_len)))
                .map_err(|e| {
                    Error::from_reason(format!("[NativeLI] input_ids tensor error: {e}"))
                })?;
            let mask_u8 = Tensor::new(flat_mask_u8.as_slice(), &inner.device)
                .and_then(|t| t.reshape((batch_size, seq_len)))
                .map_err(|e| {
                    Error::from_reason(format!("[NativeLI] attention_mask tensor error: {e}"))
                })?;

            let hidden = inner
                .model
                .forward(&ids_tensor, &mask_u8)
                .map_err(|e| Error::from_reason(format!("[NativeLI] Forward pass error: {e}")))?;

            // Apply projection chain. Standard `lateon-code` has one
            // stage; `lateon-code-edge` has two. We carry the running
            // 2D tensor across stages and reshape to 3D once after the
            // chain — saves one reshape per stage and matches the fold
            // structure used by the parity check above.
            let mut projected = hidden
                .reshape((batch_size * seq_len, inner.backbone_dim))
                .map_err(|e| Error::from_reason(format!("[NativeLI] Hidden reshape error: {e}")))?;
            for (i, w) in inner.projection_weights.iter().enumerate() {
                let w_t = w.t().map_err(|e| {
                    Error::from_reason(format!(
                        "[NativeLI] Projection stage {i} transpose error: {e}"
                    ))
                })?;
                projected = projected.matmul(&w_t).map_err(|e| {
                    Error::from_reason(format!(
                        "[NativeLI] Projection stage {i} matmul error: {e}"
                    ))
                })?;
            }
            let projected = projected
                .reshape((batch_size, seq_len, inner.token_dim))
                .map_err(|e| {
                    Error::from_reason(format!("[NativeLI] Projection reshape error: {e}"))
                })?;

            let norm = projected
                .sqr()
                .and_then(|t| t.sum_keepdim(D::Minus1))
                .and_then(|t| (t + 1e-12f64))
                .and_then(|t| t.sqrt())
                .map_err(|e| {
                    Error::from_reason(format!("[NativeLI] Norm computation error: {e}"))
                })?;
            let normalized = projected
                .broadcast_div(&norm)
                .and_then(|t| t.to_dtype(DType::F32))
                .map_err(|e| Error::from_reason(format!("[NativeLI] Normalize error: {e}")))?;

            // Extract per-batch-item active token vectors inside the lock so
            // the device→host copies don't race with another worker's forward.
            // Keep them as f32 (no longer widening to f64) — JSON encoding
            // works fine on f32 and we save 50% on the encode-side string
            // length.
            let mut all_vectors: Vec<f32> = Vec::new();
            let mut token_counts: Vec<u32> = Vec::with_capacity(batch_size);
            for (b, &active) in active_counts.iter().enumerate() {
                token_counts.push(active as u32);
                if active == 0 {
                    continue;
                }
                let batch_vecs = normalized
                    .i(b)
                    .and_then(|t| t.narrow(0, 0, active))
                    .and_then(|t| t.reshape((active * inner.token_dim,)))
                    .and_then(|t| t.to_vec1::<f32>())
                    .map_err(|e| {
                        Error::from_reason(format!(
                            "[NativeLI] Vector extraction error for batch {b}: {e}"
                        ))
                    })?;
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

#[cfg(all(test, feature = "coreml"))]
mod tests {
    use super::*;

    #[test]
    fn parse_standard_variant_filename() {
        assert_eq!(
            parse_li_variant_filename("li_modernbert_b128_s48_fp16.mlpackage"),
            Some((128, 48, 128))
        );
        assert_eq!(
            parse_li_variant_filename("li_modernbert_b32_s512_fp16.mlpackage"),
            Some((32, 512, 128))
        );
    }

    #[test]
    fn parse_edge_variant_filename() {
        assert_eq!(
            parse_li_variant_filename("li_modernbert_edge_b128_s48_fp16.mlpackage"),
            Some((128, 48, 48))
        );
        assert_eq!(
            parse_li_variant_filename("li_modernbert_edge_b1_s2048_fp16.mlpackage"),
            Some((1, 2048, 48))
        );
    }

    #[test]
    fn parse_rejects_unrelated_filenames() {
        assert_eq!(parse_li_variant_filename("nomic_bert_b64_s96_fp16.mlpackage"), None);
        assert_eq!(parse_li_variant_filename("li_modernbert_b128_s48.mlpackage"), None);
        assert_eq!(parse_li_variant_filename("readme.md"), None);
        // The "edge" prefix is matched as a unit — partial matches are rejected.
        assert_eq!(parse_li_variant_filename("li_modernbert_edge.mlpackage"), None);
    }

    #[test]
    fn parse_prefix_order_matters() {
        // The longer "edge" prefix MUST be tried first. If we
        // accidentally matched "li_modernbert_b" first, this would
        // parse the literal token "edge_b128" as a (failing) integer
        // and the standard branch would also reject it — so this test
        // also catches the silent "everything fails" regression.
        let result = parse_li_variant_filename("li_modernbert_edge_b16_s256_fp16.mlpackage");
        assert_eq!(result, Some((16, 256, 48)), "edge prefix must be detected before standard prefix");
    }
}
