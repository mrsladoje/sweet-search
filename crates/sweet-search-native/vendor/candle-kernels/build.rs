use cudaforge::{KernelBuilder, Result};
use std::env;
use std::path::PathBuf;

fn main() -> Result<()> {
    println!("cargo::rerun-if-changed=build.rs");
    println!("cargo::rerun-if-changed=src/compatibility.cuh");
    println!("cargo::rerun-if-changed=src/cuda_utils.cuh");
    println!("cargo::rerun-if-changed=src/binary_op_macros.cuh");

    // sweet-search patch: two PTX sets (see PATCHES.md). PTX only
    // JIT-compiles forward, so one set built for CUDA_COMPUTE_CAP (80 in the
    // x86-64 release) cannot load on Volta/Turing. The LOW set targets
    // compute_70 (bf16 / fp8 kernels compile out behind their __CUDA_ARCH__
    // guards); the HIGH set targets CUDA_COMPUTE_CAP. lib.rs picks the set
    // per process from the device's compute capability.
    println!("cargo::rerun-if-env-changed=CUDA_COMPUTE_CAP");
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let high_arch = env::var("CUDA_COMPUTE_CAP").expect("CUDA_COMPUTE_CAP must be set (the release builds use 80 on x86-64, 87 on arm64)");
    let high_cap: usize = high_arch
        .trim_end_matches(|c: char| c.is_ascii_alphabetic())
        .parse()
        .expect("CUDA_COMPUTE_CAP must start with digits, e.g. 80 or 90a");
    const LOW_CAP: usize = 70;
    let ptx_set = |cap: usize, sub: &str| -> Result<Vec<PathBuf>> {
        let dir = out_dir.join(sub);
        std::fs::create_dir_all(&dir)?;
        let built = KernelBuilder::new()
            .source_dir("src") // Scan src/ for .cu files
            .exclude(&["moe_*.cu"]) // Exclude moe kernels for ptx build
            .compute_cap(cap)
            .out_dir(&dir)
            .arg("--expt-relaxed-constexpr")
            .arg("-std=c++17")
            .arg("-O3")
            .build_ptx()?;
        Ok(built.paths().to_vec())
    };
    let high = ptx_set(high_cap, "ptx_high")?;
    ptx_set(LOW_CAP.min(high_cap), "ptx_low")?;
    let mut rs = format!(
        "pub const HIGH_PTX_CAP: u32 = {high_cap};\npub const LOW_PTX_CAP: u32 = {};\n",
        LOW_CAP.min(high_cap)
    );
    for kernel in &high {
        let stem = kernel.file_stem().and_then(|s| s.to_str()).unwrap();
        let cst = stem.to_uppercase().replace(['.', '-'], "_");
        rs += &format!(
            "pub const {cst}: &str = include_str!(concat!(env!(\"OUT_DIR\"), \"/ptx_high/{stem}.ptx\"));\n\
             pub const {cst}_LOW: &str = include_str!(concat!(env!(\"OUT_DIR\"), \"/ptx_low/{stem}.ptx\"));\n"
        );
    }
    std::fs::write(out_dir.join("ptx.rs"), rs)?;

    let mut moe_builder = KernelBuilder::default()
        .source_files(vec![
            "src/moe/moe_gguf.cu",
            "src/moe/moe_wmma.cu",
            "src/moe/moe_wmma_gguf.cu",
        ])
        .arg("--expt-relaxed-constexpr")
        .arg("-std=c++17")
        .arg("-O3");

    // Disable bf16 WMMA kernels on GPUs older than sm_80 (Ampere).
    // bf16 WMMA fragments require compute capability >= 8.0.
    let compute_cap = cudaforge::detect_compute_cap()
        .map(|arch| arch.base())
        .unwrap_or(80);
    if compute_cap < 80 {
        moe_builder = moe_builder.arg("-DNO_BF16_KERNEL");
    }

    let mut is_target_msvc = false;
    if let Ok(target) = std::env::var("TARGET") {
        if target.contains("msvc") {
            is_target_msvc = true;
            moe_builder = moe_builder.arg("-D_USE_MATH_DEFINES");
        }
    }

    if !is_target_msvc {
        moe_builder = moe_builder.arg("-Xcompiler").arg("-fPIC");
    }

    moe_builder.build_lib(out_dir.join("libmoe.a"))?;
    println!("cargo:rustc-link-search={}", out_dir.display());
    println!("cargo:rustc-link-lib=moe");
    println!("cargo:rustc-link-lib=dylib=cudart");
    if !is_target_msvc {
        println!("cargo:rustc-link-lib=stdc++");
    }
    Ok(())
}
