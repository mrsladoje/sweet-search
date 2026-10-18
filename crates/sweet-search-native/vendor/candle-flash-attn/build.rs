// Build script to run nvcc and generate the C glue code for launching the flash-attention kernel.
// The cuda build time is very long so one can set the CANDLE_FLASH_ATTN_BUILD_DIR environment
// variable in order to cache the compiled artifacts and avoid recompiling too often.
use cudaforge::{KernelBuilder, Result};
use std::path::PathBuf;
const CUTLASS_COMMIT: &str = "7d49e6c7e2f8896c47f586706e67e1fb215529dc";

// sweet-search patch: only the kernels the product runs (head dim 64,
// not causal: NomicBERT, ModernBERT and the edge model all use 64-wide
// heads with bidirectional / sliding-window attention). run_mha returns
// cudaErrorInvalidValue for any other shape. See PATCHES.md.
const KERNEL_FILES: [&str; 3] = [
    "kernels/flash_api.cu",
    "kernels/flash_fwd_hdim64_fp16_sm80.cu",
    "kernels/flash_fwd_hdim64_bf16_sm80.cu",
];

fn main() -> Result<()> {
    println!("cargo::rerun-if-changed=build.rs");
    for kernel_file in KERNEL_FILES.iter() {
        println!("cargo::rerun-if-changed={kernel_file}");
    }
    println!("cargo::rerun-if-changed=kernels/flash_fwd_kernel.h");
    println!("cargo::rerun-if-changed=kernels/flash_fwd_launch_template.h");
    println!("cargo::rerun-if-changed=kernels/flash.h");
    println!("cargo::rerun-if-changed=kernels/philox.cuh");
    println!("cargo::rerun-if-changed=kernels/softmax.h");
    println!("cargo::rerun-if-changed=kernels/utils.h");
    println!("cargo::rerun-if-changed=kernels/kernel_traits.h");
    println!("cargo::rerun-if-changed=kernels/block_info.h");
    println!("cargo::rerun-if-changed=kernels/static_switch.h");
    println!("cargo::rerun-if-changed=kernels/hardware_info.h");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR not set"));
    let build_dir = match std::env::var("CANDLE_FLASH_ATTN_BUILD_DIR") {
        Err(_) =>
        {
            #[allow(clippy::redundant_clone)]
            out_dir.clone()
        }
        Ok(build_dir) => {
            let path = PathBuf::from(build_dir);
            path.canonicalize().expect(&format!(
                "Directory doesn't exists: {} (the current directory is {})",
                &path.display(),
                std::env::current_dir()?.display()
            ))
        }
    };

    let kernels: Vec<_> = KERNEL_FILES.iter().collect();
    let mut builder = KernelBuilder::new()
        .source_files(kernels)
        .out_dir(&build_dir)
        .with_cutlass(Some(CUTLASS_COMMIT)) // ✅ Auto-fetch and include CUTLASS from GitHub
        .arg("-std=c++17")
        .arg("-O3")
        .arg("-U__CUDA_NO_HALF_OPERATORS__")
        .arg("-U__CUDA_NO_HALF_CONVERSIONS__")
        .arg("-U__CUDA_NO_HALF2_OPERATORS__")
        .arg("-U__CUDA_NO_BFLOAT16_CONVERSIONS__")
        .arg("--expt-relaxed-constexpr")
        .arg("--expt-extended-lambda")
        .arg("--use_fast_math")
        .arg("--verbose")
        .thread_percentage(0.5); // Use up to 50% of available threads

    // sweet-search patch: the FlashAttention-2 kernels also run on Hopper
    // and Blackwell when compiled for them. Besides the CUDA_COMPUTE_CAP
    // SASS (sm_80 / sm_87), add sm_90 SASS and compute_90 PTX, which the
    // driver JIT-compiles on 10.x / 12.x (CUDA 12.2 has no sm_100 / sm_120
    // target).
    let base: usize = std::env::var("CUDA_COMPUTE_CAP")
        .ok()
        .and_then(|v| v.trim_end_matches(|c: char| c.is_ascii_alphabetic()).parse().ok())
        .unwrap_or(80);
    println!("cargo::rerun-if-env-changed=CUDA_COMPUTE_CAP");
    if base < 90 {
        builder = builder
            .arg("-gencode=arch=compute_90,code=sm_90")
            .arg("-gencode=arch=compute_90,code=compute_90");
    }

    let mut is_target_msvc = false;
    if let Ok(target) = std::env::var("TARGET") {
        if target.contains("msvc") {
            is_target_msvc = true;
            builder = builder.arg("-D_USE_MATH_DEFINES");
        }
    }

    if !is_target_msvc {
        builder = builder.arg("-Xcompiler").arg("-fPIC");
    }

    let out_file = build_dir.join("libflashattention.a");
    builder.build_lib(out_file)?;

    println!("cargo::rustc-link-search={}", build_dir.display());
    println!("cargo::rustc-link-lib=flashattention");
    println!("cargo::rustc-link-lib=dylib=cudart");
    if !is_target_msvc {
        println!("cargo::rustc-link-lib=dylib=stdc++");
    }
    Ok(())
}
