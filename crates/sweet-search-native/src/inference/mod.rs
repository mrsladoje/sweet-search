//! Native model inference via candle (HuggingFace Rust ML framework).
//!
//! Provides NomicBERT embedding and ModernBERT late-interaction inference
//! with optional Metal GPU acceleration on Apple Silicon and optional CUDA
//! acceleration on NVIDIA Linux hosts.
//!
//! Weight format: FP32 safetensors (not ONNX).
//! Backend: CPU (all platforms), Metal GPU (macOS ARM64, via `metal` feature),
//! or CUDA GPU (Linux, via `cuda` feature; requires libcuda.so at load time).

mod embedding_model;
mod li_model;
mod modernbert_sdpa;
mod nomic_bert_sdpa;

// Variable-length packing helpers for candle-flash-attn. Compiled in only
// when the `flash-attn` Cargo feature is enabled (CUDA Ampere+ builds).
#[cfg(feature = "flash-attn")]
mod varlen;

// CoreML FFI: thin Objective-C shim for loading .mlpackage files and
// running inference on CPU_AND_NE. Gated behind the `coreml` Cargo
// feature which is macOS-only (requires metal). The shim itself lives
// in src/inference/coreml_shim.m; the Rust side is coreml_shim.rs.
//
// coreml_embedding / coreml_li are production wrappers over the shim
// that expose a candle-compatible embed/encode interface so
// embedding_model.rs and li_model.rs can dispatch to CoreML when the
// opt-in env vars are set and fall back to candle otherwise.
#[cfg(feature = "coreml")]
mod coreml_embedding;
#[cfg(feature = "coreml")]
mod coreml_li;
#[cfg(feature = "coreml")]
mod coreml_shim;
#[cfg(feature = "coreml")]
mod coreml_smoke;

pub use embedding_model::NativeEmbeddingModel;
pub use li_model::NativeLateInteractionModel;

use candle_core::{DType, Device};
use napi_derive::napi;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ModelKind {
    Embedding,
    LateInteraction,
}

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

/// Process-wide mutex that serializes CUDA weight loads across models.
///
/// Unlike Metal, CUDA forward passes are thread-safe — candle's CUDA backend
/// uses per-device cudarc streams and concurrent `cuLaunchKernel` calls are
/// serialized safely at the driver level. The race is specifically in
/// `VarBuilder::from_mmaped_safetensors` → `NomicBertModel::load`: candle
/// 0.10 has a known H2D-copy race where concurrent weight uploads on the
/// default stream can interleave and corrupt tensors.
///
/// The lock is load-only. It wraps the model-construction section in
/// `embedding_model.rs::load_on_device` and `li_model.rs::load_on_device`
/// but NOT `forward()` — dropping per-forward serialization is the whole
/// point of using CUDA over Metal for concurrent embed + LI dispatch.
#[cfg(feature = "cuda")]
pub(crate) fn cuda_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Check if native GPU-accelerated inference is available.
///
/// Returns true when a GPU device successfully initializes:
///   - macOS ARM64  → Metal via `Device::new_metal(0)`
///   - Linux + NVIDIA → CUDA via `Device::new_cuda(0)` (requires the
///     `cuda` feature AND a working libcuda.so at runtime)
///
/// Returns false on CPU-only platforms (native inference still works,
/// just on CPU).
#[napi]
pub fn native_inference_available() -> bool {
    #[cfg(feature = "metal")]
    {
        if Device::new_metal(0).is_ok() {
            return true;
        }
    }
    #[cfg(feature = "cuda")]
    {
        if Device::new_cuda(0).is_ok() {
            return true;
        }
    }
    false
}

/// Minimal CUDA readiness probe exposed to JS. Returns `Some(true)` when
/// the addon was built with the `cuda` feature AND `Device::new_cuda(0)`
/// succeeds at runtime (i.e., libcuda.so loaded + device 0 initialized).
/// Returns `None` on CPU-only builds.
///
/// This is deliberately a boolean rather than a structured
/// `{ name, compute_capability, memory }` record: digging into cudarc's
/// device attributes through candle 0.10 requires an internal re-export
/// path that has drifted across candle versions, whereas the JS layer's
/// `nvidia-smi` probe already provides name + compute_cap + memory +
/// driver reliably on every NVIDIA-enabled Linux host. The two signals
/// combine as: "native probe confirms the addon is cuda-capable;
/// nvidia-smi confirms which GPU is installed."
///
/// The compute-capability gate (SM ≥ 7.0) + dtype choice
/// (BF16/F16/F32) lives on the JS side for exactly this reason: it
/// reads the `nvidia-smi` output and passes a resolved `deviceKind`
/// back in via `loadWithDevice`, keeping the Rust layer simple.
#[napi]
#[allow(unreachable_code)]
pub fn native_cuda_available() -> Option<bool> {
    #[cfg(feature = "cuda")]
    {
        return Some(Device::new_cuda(0).is_ok());
    }
    None
}

/// Environment-overridable compute-capability hint used by `optimal_dtype`
/// to pick BF16 / F16 / F32 on CUDA AND by the SDPA gate in
/// `{nomic_bert,modernbert}_sdpa.rs` to runtime-filter flash-attn dispatch
/// on Ampere+ (SM 8.0+) only. Set by
/// `core/infrastructure/native-inference.js` from the `nvidia-smi` probe
/// result before loading models. Falls back to 0.0 when unset, which the
/// dtype policy treats as "unknown → F32" and the SDPA gate treats as
/// "pre-Ampere → skip flash-attn".
///
/// Made `pub(crate)` so the SDPA files can runtime-gate flash-attn
/// dispatch without duplicating the env-parsing. Keeping the hint in env
/// avoids adding candle-version-specific cudarc imports on the Rust side
/// (see `native_cuda_available` comment).
///
/// Recognised values: `"8.6"`, `"8.0"`, `"7.5"`, `"7.0"` — anything
/// parseable as a float. Unknown / missing → treated as 0.0.
#[cfg(feature = "cuda")]
pub(crate) fn cuda_compute_capability_from_env() -> f32 {
    std::env::var("SWEET_SEARCH_CUDA_COMPUTE_CAP")
        .ok()
        .and_then(|s| s.parse::<f32>().ok())
        .unwrap_or(0.0)
}

/// Select the optimal weight dtype for the active device and model family.
///
/// Metal defaults to BF16. Verified against gencodesearchnet 500q same-session:
///   F32 balanced MRR 93.14% → BF16 balanced MRR 93.07% (Δ -0.07pp)
///   F32 full MRR 97.97% → BF16 full MRR 97.90% (Δ -0.07pp)
///   Indexing speedup: 1.32x balanced, 1.36x full
///
/// BF16 keeps F32's 8-bit exponent (same dynamic range) while storing
/// weights/activations in 2 bytes, which halves memory bandwidth on the
/// linear-layer matmuls that dominate Metal wall time. The MLX steel
/// GEMM/attention kernels vendored into candle-metal-kernels run their
/// accumulators in F32 regardless of input dtype, so the output precision is
/// preserved — the only precision loss is in storage, not compute, and it
/// comes out below the MRR noise floor.
///
/// F16 is still gated off because it destroys retrieval on this model:
/// gencodesearchnet MRR collapses 82% → 64% (python 93.1% → 63.3%) purely
/// from residual F16 noise compounding across 12 transformer layers. The
/// per-token cosine against the FP32 reference is still ~0.9999 at F16, but
/// small errors accumulate in the residual stream and flip enough top-K
/// rankings to break retrieval. BF16 avoids this because it has F32's
/// exponent range — rounding errors stay bounded.
///
/// CUDA is model-specific:
///   - NomicBERT embedding defaults to BF16 on Ampere+ (SM >= 8.0). Verified
///     pooled cosine stays in the retrieval-safe band while indexing gets the
///     Tensor Core / memory-bandwidth win.
///   - ModernBERT late interaction stays F32 by default, even when
///     SWEET_SEARCH_NATIVE_DTYPE=bf16 is set. BF16 LI per-token parity on RTX
///     4090 is not retrieval-safe (min ~0.70, mean ~0.974 against F32 CPU).
///     Those vectors feed MaxSim directly, so mean-pooling cannot mask the
///     drift as it does for embeddings.
///
/// Overrides:
///   SWEET_SEARCH_NATIVE_DTYPE=f32      — force global F32 reference precision
///   SWEET_SEARCH_NATIVE_DTYPE=bf16     — prefer BF16 where it is validated
///   SWEET_SEARCH_NATIVE_EMBED_DTYPE=*  — force embedding dtype for diagnostics
///   SWEET_SEARCH_NATIVE_LI_DTYPE=*     — force LI dtype for diagnostics
pub(crate) fn optimal_dtype(device: &Device, model_kind: ModelKind) -> DType {
    let global_dtype = std::env::var("SWEET_SEARCH_NATIVE_DTYPE")
        .map(|v| v.to_lowercase())
        .unwrap_or_default();
    let model_dtype = match model_kind {
        ModelKind::Embedding => std::env::var("SWEET_SEARCH_NATIVE_EMBED_DTYPE"),
        ModelKind::LateInteraction => std::env::var("SWEET_SEARCH_NATIVE_LI_DTYPE"),
    }
    .map(|v| v.to_lowercase())
    .ok();

    let parse_dtype = |value: &str| match value {
        "bf16" | "bfloat16" => Some(DType::BF16),
        "f16" | "fp16" | "float16" => Some(DType::F16),
        "f32" | "fp32" | "float32" => Some(DType::F32),
        _ => None,
    };

    if let Some(dtype) = model_dtype.as_deref().and_then(parse_dtype) {
        return dtype;
    }

    if matches!(global_dtype.as_str(), "f32" | "fp32" | "float32") {
        return DType::F32;
    }

    match device {
        #[cfg(feature = "metal")]
        Device::Metal(_) => match global_dtype.as_str() {
            "f16" | "fp16" | "float16" => DType::F16,
            _ => DType::BF16,
        },
        #[cfg(feature = "cuda")]
        Device::Cuda(_) => match model_kind {
            ModelKind::Embedding => match global_dtype.as_str() {
                "f16" | "fp16" | "float16" => DType::F16,
                "bf16" | "bfloat16" => DType::BF16,
                _ if cuda_compute_capability_from_env() >= 8.0 => DType::BF16,
                _ => DType::F32,
            },
            ModelKind::LateInteraction => DType::F32,
        },
        _ => {
            let _ = global_dtype;
            DType::F32
        }
    }
}

/// Build a compute device from an explicit kind string.
/// Accepts "cpu", "metal", "cuda", or "auto" (delegates to `select_device`).
///
/// Unknown kinds (including "metal" on a non-metal build or "cuda" on a
/// non-cuda build) silently degrade to CPU rather than erroring — the JS
/// layer is the authoritative backend selector; the Rust side should
/// never block model loading on a misconfigured deviceKind string.
pub(crate) fn build_device(kind: &str) -> candle_core::Result<Device> {
    match kind {
        "cpu" => Ok(Device::Cpu),
        #[cfg(feature = "metal")]
        "metal" => Device::new_metal(0),
        #[cfg(not(feature = "metal"))]
        "metal" => Ok(Device::Cpu),
        #[cfg(feature = "cuda")]
        "cuda" => Device::new_cuda(0),
        #[cfg(not(feature = "cuda"))]
        "cuda" => Ok(Device::Cpu),
        _ => select_device(),
    }
}

/// Select the best available compute device.
/// Order of preference: Metal (macOS) → CUDA (Linux+NVIDIA) → CPU. Because
/// the `metal` and `cuda` cfg-gates are mutually exclusive at build time
/// for our shipped packages (Metal = macOS, CUDA = Linux), only one real
/// probe fires per platform.
///
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
            Err(_) => { /* fall through to next GPU backend / CPU */ }
        }
    }
    #[cfg(feature = "cuda")]
    {
        match Device::new_cuda(0) {
            Ok(device) => return Ok(device),
            Err(_) => { /* fall through to CPU */ }
        }
    }
    Ok(Device::Cpu)
}

/// Return the name of the active compute device ("metal", "cuda", or "cpu").
#[napi]
pub fn native_inference_device() -> String {
    match select_device() {
        Ok(Device::Cpu) => "cpu".to_string(),
        #[cfg(feature = "metal")]
        Ok(Device::Metal(_)) => "metal".to_string(),
        #[cfg(feature = "cuda")]
        Ok(Device::Cuda(_)) => "cuda".to_string(),
        _ => "cpu".to_string(),
    }
}
