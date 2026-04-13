//! Native model inference via candle (HuggingFace Rust ML framework).
//!
//! Provides NomicBERT embedding and ModernBERT late-interaction inference
//! with optional Metal GPU acceleration on Apple Silicon.
//!
//! Weight format: FP32 safetensors (not ONNX).
//! Backend: CPU (all platforms) or Metal GPU (macOS ARM64, via `metal` feature).

mod embedding_model;
mod li_model;
mod modernbert_sdpa;
mod nomic_bert_sdpa;

pub use embedding_model::NativeEmbeddingModel;
pub use li_model::NativeLateInteractionModel;

use candle_core::{DType, Device};
use napi_derive::napi;
use std::sync::{Mutex, OnceLock};

/// Process-wide mutex that serializes all Metal compute across models.
///
/// Candle's Metal backend can't safely accept concurrent `MTLCommandBuffer`
/// submissions against the same GPU — even when the submissions target
/// different `NomicBertModel`/`ModernBert` instances, the underlying
/// command queue is shared through candle's global Metal device cache and
/// interleaved submissions silently corrupt outputs. Per-model mutexes are
/// insufficient because queries hit both the embedding and LI models
/// concurrently at `--concurrency=12`. A single process-wide mutex around
/// every Metal compute section keeps latency reasonable (GPU work is
/// sub-10ms per call) while eliminating the race entirely.
pub(crate) fn metal_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Check if native GPU-accelerated inference is available.
/// Returns true on macOS ARM64 when Metal device initializes successfully.
/// Returns false on CPU-only platforms (native inference still works, just on CPU).
#[napi]
pub fn native_inference_available() -> bool {
    #[cfg(feature = "metal")]
    {
        return Device::new_metal(0).is_ok();
    }
    #[cfg(not(feature = "metal"))]
    {
        false
    }
}

/// Select the optimal weight dtype for the active device.
///
/// Metal defaults to F32 because F16 precision loss catastrophically degrades
/// retrieval quality on this CodeRankEmbed model — gencodesearchnet MRR
/// dropped from 82% to 64% (python queries 93.1% → 63.3%) purely from F16
/// accumulation over 12 transformer layers. Per-token cosine against the
/// FP32 reference is ~0.9999, but the residual noise flips enough top-K
/// rankings to destroy retrieval. Set SWEET_SEARCH_NATIVE_DTYPE=f16 to opt
/// back into F16 (faster inference, worse quality).
pub(crate) fn optimal_dtype(device: &Device) -> DType {
    let force_f16 = std::env::var("SWEET_SEARCH_NATIVE_DTYPE")
        .map(|v| v.to_lowercase() == "f16")
        .unwrap_or(false);
    match device {
        #[cfg(feature = "metal")]
        Device::Metal(_) if force_f16 => DType::F16,
        _ => {
            let _ = force_f16; // suppress unused warning on non-metal builds
            DType::F32
        }
    }
}

/// Select the best available compute device.
/// Tries Metal first (macOS + `metal` feature), falls back to CPU.
/// Set env SWEET_SEARCH_NATIVE_DEVICE=cpu to force CPU fallback for testing.
pub(crate) fn select_device() -> candle_core::Result<Device> {
    if std::env::var("SWEET_SEARCH_NATIVE_DEVICE")
        .map(|v| v.to_lowercase() == "cpu")
        .unwrap_or(false)
    {
        return Ok(Device::Cpu);
    }
    #[cfg(feature = "metal")]
    {
        match Device::new_metal(0) {
            Ok(device) => return Ok(device),
            Err(_) => { /* fall through to CPU */ }
        }
    }
    Ok(Device::Cpu)
}

/// Return the name of the active compute device ("metal" or "cpu").
#[napi]
pub fn native_inference_device() -> String {
    match select_device() {
        Ok(Device::Cpu) => "cpu".to_string(),
        #[cfg(feature = "metal")]
        Ok(Device::Metal(_)) => "metal".to_string(),
        _ => "cpu".to_string(),
    }
}
