extern crate napi_build;

fn main() {
    napi_build::setup();

    // CUDA: the kernel target must be explicit. cudaforge compiles candle's
    // high PTX set (and flash-attn's base SASS) for CUDA_COMPUTE_CAP;
    // without it, it probes the build machine's GPU, so the same source
    // gives different binaries on different hosts.
    if std::env::var_os("CARGO_FEATURE_CUDA").is_some() {
        println!("cargo:rerun-if-env-changed=CUDA_COMPUTE_CAP");
        let cap = std::env::var("CUDA_COMPUTE_CAP").unwrap_or_default();
        let digits = cap.trim_end_matches(|c: char| c.is_ascii_alphabetic());
        if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
            panic!(
                "CUDA builds need CUDA_COMPUTE_CAP set explicitly (the release builds use 80 on x86-64, 87 on arm64); got {cap:?}"
            );
        }
    }

    // CoreML shim: compile the Objective-C wrapper and link against the
    // CoreML + Foundation frameworks. Only active when the `coreml`
    // Cargo feature is enabled, which itself is gated to macOS via
    // `metal`. On other platforms this whole block is skipped and the
    // addon builds without any CoreML symbols.
    #[cfg(feature = "coreml")]
    {
        let shim_path = "src/inference/coreml_shim.m";
        println!("cargo:rerun-if-changed={}", shim_path);

        cc::Build::new()
            .file(shim_path)
            .flag("-fobjc-arc") // ARC for Obj-C ref counting inside the shim
            .flag("-fmodules") // allows `#import <CoreML/CoreML.h>`
            .flag("-Wall")
            .flag("-Wno-unused-parameter") // harmless in shim scaffolding
            .compile("sweet_coreml_shim");

        // Link against Apple's CoreML and Foundation frameworks. cc crate
        // doesn't auto-link Apple frameworks — we have to tell the linker
        // explicitly. These emit `-framework CoreML -framework Foundation`
        // into the final addon binary's link command.
        println!("cargo:rustc-link-lib=framework=CoreML");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
}
