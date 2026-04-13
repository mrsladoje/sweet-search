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
use super::{metal_lock, optimal_dtype, select_device};

/// Inner state of the embedding model, shared between the napi struct (main
/// thread) and `EmbedBatchTask` (libuv worker thread) via `Arc`.
///
/// Metal compute is serialized via `super::metal_lock()` — a process-wide
/// mutex that covers all Metal operations across both the embedding and LI
/// models. See `metal_lock` for why per-model locks aren't enough.
struct EmbeddingInner {
    model: nomic_bert::NomicBertModel,
    device: candle_core::Device,
    hidden_size: usize,
}

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
    #[napi(factory)]
    pub fn load(safetensors_path: String, config_path: String) -> Result<Self> {
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
            DType::F32 => "f32",
            _ => "other",
        };
        eprintln!(
            "[NativeEmbedding] Loaded NomicBERT ({hidden_size}d, {} layers, device: {device_name}, dtype: {dtype_name})",
            config.n_layer,
        );

        Ok(Self {
            inner: Arc::new(EmbeddingInner { model, device, hidden_size }),
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
    /// A Promise resolving to a 2D array of L2-normalized embedding vectors,
    /// shape [batch, hidden_size].
    #[napi(ts_return_type = "Promise<number[][]>")]
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
    type Output = Vec<Vec<f32>>;
    type JsValue = Vec<Vec<f32>>;

    fn compute(&mut self) -> Result<Self::Output> {
        let inner = &*self.inner;
        let batch_size = self.input_ids.len();
        if batch_size == 0 {
            return Ok(vec![]);
        }
        let seq_len = self.input_ids[0].len();

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

        let result: Vec<Vec<f32>> = {
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

            match normalized.dtype() {
                DType::F32 => normalized.to_vec2::<f32>().map_err(|e| {
                    Error::from_reason(format!("[NativeEmbedding] Output conversion error: {e}"))
                })?,
                _ => normalized
                    .to_dtype(DType::F32)
                    .and_then(|t| t.to_vec2::<f32>())
                    .map_err(|e| {
                        Error::from_reason(format!("[NativeEmbedding] Output conversion error: {e}"))
                    })?,
            }
        };

        Ok(result)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}
