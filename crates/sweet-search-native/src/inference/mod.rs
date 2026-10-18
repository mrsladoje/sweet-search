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
pub(crate) mod parity;

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
        if new_cuda_device().is_ok() {
            return true;
        }
    }
    false
}

/// CUDA readiness probe exposed to JS. Returns `Some(true)` when the
/// addon was built with the `cuda` feature, CUDA device 0 initialises and
/// its compute capability is at or above this build's kernel floor
/// (`cuda_kernel_floor`). Returns `None` on CPU-only builds.
/// `native_cuda_device_info` gives the reason when this is false.
#[napi]
#[allow(unreachable_code)]
pub fn native_cuda_available() -> Option<bool> {
    #[cfg(feature = "cuda")]
    {
        return Some(new_cuda_device().is_ok());
    }
    None
}

/// CUDA device 0 as the addon sees it. Device 0 is the first device CUDA
/// enumerates (fastest first unless CUDA_DEVICE_ORDER=PCI_BUS_ID, after
/// CUDA_VISIBLE_DEVICES), which is not always the first `nvidia-smi` line,
/// so the JS layer must use this record, not `nvidia-smi`, to decide
/// whether and how to run on CUDA.
#[napi(object)]
pub struct NativeCudaDevice {
    pub name: String,
    /// "major.minor", e.g. "8.6". Empty when the device did not initialise.
    pub compute_capability: String,
    pub total_memory_mb: u32,
    /// Lowest compute capability this build's kernels run on, e.g. "8.0".
    pub kernel_floor: String,
    /// True when the device initialised and meets the kernel floor.
    pub supported: bool,
    /// Why `supported` is false.
    pub reason: Option<String>,
}

#[napi]
#[allow(unreachable_code)]
pub fn native_cuda_device_info() -> Option<NativeCudaDevice> {
    #[cfg(feature = "cuda")]
    {
        let floor = cuda_kernel_floor();
        let mut info = NativeCudaDevice {
            name: String::new(),
            compute_capability: String::new(),
            total_memory_mb: 0,
            kernel_floor: format!("{floor:.1}"),
            supported: false,
            reason: None,
        };
        match Device::new_cuda(0) {
            Err(e) => info.reason = Some(format!("CUDA device 0 did not initialise: {e}")),
            Ok(Device::Cuda(dev)) => {
                let ctx = dev.cuda_stream().context().clone();
                info.name = ctx.name().unwrap_or_default();
                info.total_memory_mb = (ctx.total_mem().unwrap_or(0) >> 20) as u32;
                match ctx.compute_capability() {
                    Err(e) => info.reason = Some(format!("cannot read compute capability: {e}")),
                    Ok((major, minor)) => {
                        info.compute_capability = format!("{major}.{minor}");
                        info.reason = check_cuda_kernel_floor(&info.name, major, minor).err();
                        info.supported = info.reason.is_none();
                    }
                }
            }
            Ok(_) => info.reason = Some("Device::new_cuda returned a non-CUDA device".into()),
        }
        return Some(info);
    }
    None
}

/// Lowest compute capability the CUDA kernels in this build can run on.
///
/// candle's kernels are PTX, and PTX only JIT-compiles forward. The
/// vendored candle-kernels (vendor/candle-kernels/PATCHES.md) ships two
/// sets: compute_70 (Volta and newer, no bf16 / fp8 kernels) and the build
/// target CUDA_COMPUTE_CAP (80 on x86-64, 87 on arm64). The floor is the
/// LOW set's target, 7.0.
#[cfg(feature = "cuda")]
pub(crate) fn cuda_kernel_floor() -> f32 {
    candle_kernels::LOW_PTX_CAP as f32 / 10.0
}

/// True when this process loads candle's compute_70 PTX set (device below
/// the build target, or SWEET_SEARCH_CUDA_PTX=low). That set has no bf16
/// kernels, so the dtype policy must not pick BF16.
#[cfg(feature = "cuda")]
pub(crate) fn cuda_low_ptx() -> bool {
    candle_kernels::uses_low_ptx()
}

#[cfg(feature = "cuda")]
fn check_cuda_kernel_floor(name: &str, major: i32, minor: i32) -> Result<(), String> {
    let floor = cuda_kernel_floor();
    let cc = major as f32 + minor as f32 / 10.0;
    // Compare in tenths to avoid float noise ("8.6" vs 8.6).
    if (cc * 10.0).round() < (floor * 10.0).round() {
        return Err(format!(
            "{name} has compute capability {major}.{minor}; this build's CUDA kernels need {floor:.1} or newer"
        ));
    }
    Ok(())
}

/// `Device::new_cuda(0)` plus the kernel-floor check, so an unsupported GPU
/// fails here with a clear reason instead of at the first kernel load. Also
/// picks candle's PTX set for this device before any kernel loads.
/// `SWEET_SEARCH_CUDA_PTX=low` forces the compute_70 set (diagnostics: it
/// lets a newer GPU run the Volta/Turing kernels).
#[cfg(feature = "cuda")]
pub(crate) fn new_cuda_device() -> candle_core::Result<Device> {
    let device = Device::new_cuda(0)?;
    if let Device::Cuda(dev) = &device {
        let ctx = dev.cuda_stream().context().clone();
        let (major, minor) = ctx.compute_capability().map_err(|e| candle_core::Error::Msg(e.to_string()))?;
        check_cuda_kernel_floor(&ctx.name().unwrap_or_default(), major, minor).map_err(candle_core::Error::Msg)?;
        let force_low = std::env::var("SWEET_SEARCH_CUDA_PTX").map(|v| v.eq_ignore_ascii_case("low")).unwrap_or(false);
        let cap = if force_low { candle_kernels::LOW_PTX_CAP } else { (major * 10 + minor) as u32 };
        candle_kernels::select_compute_capability(cap);
    }
    Ok(device)
}

/// Compute capability of the CUDA device the tensors live on, as
/// major + minor / 10 (8.6 for sm_86). Used by `optimal_dtype` and the
/// flash-attn gates. Non-CUDA devices and query errors give 0.0, which the
/// dtype policy treats as F32 and the gates as "no flash-attn".
///
/// `SWEET_SEARCH_CUDA_COMPUTE_CAP` overrides the value, for diagnostics
/// only. Earlier code took the value from the first `nvidia-smi` line
/// through this variable, which on a mixed-GPU host can describe a
/// different GPU than CUDA device 0.
#[cfg(feature = "cuda")]
pub(crate) fn cuda_compute_capability(device: &Device) -> f32 {
    if let Some(cc) = std::env::var("SWEET_SEARCH_CUDA_COMPUTE_CAP").ok().and_then(|s| s.parse::<f32>().ok()) {
        return cc;
    }
    match device {
        Device::Cuda(dev) => dev
            .cuda_stream()
            .context()
            .compute_capability()
            .map(|(major, minor)| major as f32 + minor as f32 / 10.0)
            .unwrap_or(0.0),
        _ => 0.0,
    }
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
///     SWEET_SEARCH_NATIVE_DTYPE=bf16 is set. The measurement that pinned it
///     (RTX 4090 BF16 per-token min ~0.70, mean ~0.974 against F32 CPU) was
///     the rotary-position bug fixed in 01aed96d, not a BF16 limit; BF16 LI
///     is unmeasured on CUDA since. Those vectors feed MaxSim directly, so
///     mean-pooling cannot mask drift as it does for embeddings.
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

    #[cfg(feature = "cuda")]
    if matches!(device, Device::Cuda(_)) && cuda_low_ptx() {
        // The compute_70 kernel set has no bf16 kernels: F16 if asked for,
        // otherwise F32.
        let asked = model_dtype.as_deref().and_then(parse_dtype).or_else(|| parse_dtype(&global_dtype));
        return if asked == Some(DType::F16) { DType::F16 } else { DType::F32 };
    }

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
                _ if cuda_compute_capability(device) >= 8.0 => DType::BF16,
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
        "cuda" => new_cuda_device(),
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
        match new_cuda_device() {
            Ok(device) => return Ok(device),
            Err(e) => eprintln!("[NativeInference] CUDA not used: {e}"),
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
