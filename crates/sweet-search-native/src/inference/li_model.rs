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
use super::{optimal_dtype, select_device};

/// Inner state of the LI model, shared between the napi struct (main thread)
/// and `LiEncodeTask` (libuv worker thread) via `Arc`. All fields are
/// Send+Sync in candle 0.10.2 (Device::Metal via PR #3164, Tensors via
/// internal Arc, ModernBert via candle's immutable forward pass).
struct LiInner {
    model: modernbert::ModernBert,
    projection_weight: Tensor,
    device: Device,
    backbone_dim: usize,
    token_dim: usize,
}

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
    #[napi(factory)]
    pub fn load(
        backbone_path: String,
        projection_path: String,
        config_path: String,
    ) -> Result<Self> {
        let config_str = std::fs::read_to_string(&config_path)
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Failed to read config at {config_path}: {e}"
            )))?;

        let config: modernbert::Config = serde_json::from_str(&config_str)
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Config parse error: {e}"
            )))?;

        let backbone_dim = config.hidden_size;

        let device = select_device()
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Device init error: {e}"
            )))?;

        // F16 on Metal, F32 on CPU. The vendored modernbert_sdpa.rs now passes
        // the model dtype through prepare_4d_attention_mask and
        // get_local_attention_mask (fix mirrors upstream candle PR #2872 for
        // bert.rs; never ported to modernbert.rs upstream).
        let dtype = optimal_dtype(&device);
        let bb_path = PathBuf::from(&backbone_path);
        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[bb_path], dtype, &device)
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Failed to load backbone from {backbone_path}: {e}"
                )))?
        };

        // candle's ModernBert::load() internally uses pp("model.embeddings...") etc.,
        // but LateOn-Code safetensors has unprefixed names (e.g. "embeddings.tok_embeddings.weight").
        // Strip the "model." prefix that candle prepends so lookups match the safetensors keys.
        let vb = vb.rename_f(|name| {
            name.strip_prefix("model.")
                .unwrap_or(name)
                .to_string()
        });

        let model = modernbert::ModernBert::load(vb, &config)
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Backbone load error: {e}"
            )))?;

        // Load projection weights from separate safetensors (same dtype as backbone)
        let proj_path = PathBuf::from(&projection_path);
        let proj_vb = unsafe {
            VarBuilder::from_mmaped_safetensors(&[proj_path], dtype, &device)
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Failed to load projection from {projection_path}: {e}"
                )))?
        };

        // Extract projection weight: "linear.weight" [128, 768]
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
            DType::F32 => "f32",
            _ => "other",
        };
        eprintln!(
            "[NativeLI] Loaded ModernBERT ({backbone_dim}d → {token_dim}d, {} layers, device: {device_name}, dtype: {dtype_name})",
            config.num_hidden_layers,
        );

        Ok(Self {
            inner: Arc::new(LiInner {
                model,
                projection_weight,
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
    /// A Promise resolving to `LiEncodingResult { vectors, token_counts }`.
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
                vectors: vec![],
                token_counts: vec![],
            });
        }
        let seq_len = self.input_ids[0].len();

        // Build input_ids tensor [batch, seq_len] as u32
        let flat_ids: Vec<u32> = self.input_ids.iter()
            .flatten()
            .map(|&x| x as u32)
            .collect();
        let ids_tensor = Tensor::new(flat_ids.as_slice(), &inner.device)
            .and_then(|t| t.reshape((batch_size, seq_len)))
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] input_ids tensor error: {e}"
            )))?;

        // Build attention_mask as U8 for forward pass
        let flat_mask_u8: Vec<u8> = self.attention_mask.iter()
            .flatten()
            .map(|&x| x as u8)
            .collect();
        let mask_u8 = Tensor::new(flat_mask_u8.as_slice(), &inner.device)
            .and_then(|t| t.reshape((batch_size, seq_len)))
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] attention_mask tensor error: {e}"
            )))?;

        // Forward pass → [batch, seq_len, backbone_dim]
        let hidden = inner.model.forward(&ids_tensor, &mask_u8)
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Forward pass error: {e}"
            )))?;

        // Projection: [batch*seq, 768] @ [768, 128] → reshape to [batch, seq, 128]
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

        // L2 normalize per token
        let norm = projected.sqr()
            .and_then(|t| t.sum_keepdim(D::Minus1))
            .and_then(|t| (t + 1e-12f64))
            .and_then(|t| t.sqrt())
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Norm computation error: {e}"
            )))?;
        // Cast to F32 before extraction (model may run in F16 on Metal)
        let normalized = projected.broadcast_div(&norm)
            .and_then(|t| t.to_dtype(DType::F32))
            .map_err(|e| Error::from_reason(format!(
                "[NativeLI] Normalize error: {e}"
            )))?;

        // Extract per-batch-item token vectors (only active tokens)
        // Flatten all batch items into a single Vec<f32> with offsets
        let mut all_vectors: Vec<f64> = Vec::new();
        let mut token_counts: Vec<u32> = Vec::with_capacity(batch_size);

        for b in 0..batch_size {
            let active = self.attention_mask[b].iter().filter(|&&v| v != 0).count();
            token_counts.push(active as u32);

            let batch_vecs = normalized.i(b)
                .and_then(|t| t.narrow(0, 0, active))
                .and_then(|t| t.reshape((active * inner.token_dim,)))
                .and_then(|t| t.to_vec1::<f32>())
                .map_err(|e| Error::from_reason(format!(
                    "[NativeLI] Vector extraction error for batch {b}: {e}"
                )))?;

            all_vectors.extend(batch_vecs.iter().map(|&v| v as f64));
        }

        Ok(LiEncodingResult {
            vectors: all_vectors,
            token_counts,
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Result of late interaction encoding.
/// All batch items' token vectors are concatenated into a single flat array.
/// Use `token_counts` and `dim` (128) to slice per-item vectors.
#[napi(object)]
pub struct LiEncodingResult {
    /// Flat concatenated per-token vectors for all batch items (f64 for JS compat).
    /// Length = sum(token_counts) × dim. Slice at offsets = cumsum(token_counts) × dim.
    pub vectors: Vec<f64>,
    /// Number of active (non-padding) tokens per batch item.
    pub token_counts: Vec<u32>,
}
