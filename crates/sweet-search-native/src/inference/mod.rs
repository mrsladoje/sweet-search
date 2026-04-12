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
/// Metal: F16 (dedicated half-precision ALUs, 2x FP32 throughput).
/// CPU: F32 (F16 emulation is slower on x86/ARM NEON).
pub(crate) fn optimal_dtype(device: &Device) -> DType {
    match device {
        #[cfg(feature = "metal")]
        Device::Metal(_) => DType::F16,
        _ => DType::F32,
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
