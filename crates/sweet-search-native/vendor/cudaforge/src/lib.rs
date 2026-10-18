//! # CudaForge
//!
//! Advanced CUDA kernel builder for Rust with incremental builds, auto-detection,
//! and external dependency support.
//!
//! ## Features
//!
//! - **Compute Capability Detection**: Auto-detect from nvidia-smi or environment,
//!   with per-file overrides for mixed architectures
//! - **Incremental Builds**: Only recompile modified kernels using content hashing
//! - **CUDA Toolkit Auto-Detection**: Automatically find nvcc and include paths
//! - **External Dependencies**: Built-in CUTLASS support, or fetch any git repo
//! - **Parallel Compilation**: Configurable thread percentage for parallel builds
//! - **Flexible Source Selection**: Directory, glob, files, or exclude patterns
//!
//! ## Quick Start
//!
//! ```no_run
//! use cudaforge::KernelBuilder;
//!
//! fn main() {
//!     let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR must be set");
//!     
//!     KernelBuilder::new()
//!         .source_dir("src/kernels")
//!         .exclude(&["*_test.cu"])
//!         .arg("-O3")
//!         .arg("-std=c++17")
//!         .thread_percentage(0.5)
//!         .build_lib(format!("{}/libkernels.a", out_dir))
//!         .expect("CUDA compilation failed");
//!     
//!     println!("cargo:rustc-link-search={}", out_dir);
//!     println!("cargo:rustc-link-lib=kernels");
//! }
//! ```
//!
//! ## Per-Kernel Compute Capability
//!
//! ```no_run
//! use cudaforge::KernelBuilder;
//!
//! # fn main() -> cudaforge::Result<()> {
//! KernelBuilder::new()
//!     .source_glob("src/**/*.cu")
//!     .with_compute_override("sm90_*.cu", 90)  // Hopper kernels
//!     .with_compute_override("sm80_*.cu", 80)  // Ampere kernels
//!     .build_lib("libkernels.a")?;
//! # Ok(())
//! # }
//! ```
//!
//! ## With CUTLASS
//!
//! ```no_run
//! use cudaforge::KernelBuilder;
//!
//! # fn main() -> cudaforge::Result<()> {
//! KernelBuilder::new()
//!     .source_dir("src/kernels")
//!     .with_cutlass(Some("7127592069c2fe01b041e174ba4345ef9b279671"))
//!     .arg("-DUSE_CUTLASS")
//!     .build_lib("libkernels.a")?;
//! # Ok(())
//! # }
//! ```
//!
//! ## PTX Generation
//!
//! ```no_run
//! use cudaforge::KernelBuilder;
//!
//! # fn main() -> cudaforge::Result<()> {
//! let output = KernelBuilder::new()
//!     .source_glob("src/**/*.cu")
//!     .build_ptx()?;
//!
//! output.write("src/kernels.rs")?;
//! # Ok(())
//! # }
//! ```

#![deny(missing_docs)]

mod builder;
mod compute_cap;
mod dependency;
mod error;
mod hash;
mod parallel;
mod source;
mod toolkit;

// Re-export main types
pub use builder::{KernelBuilder, PtxOutput};
pub use compute_cap::{detect_compute_cap, get_gpu_arch_string, ComputeCapability, GpuArch};
pub use dependency::{resolve_cutlass_from_cargo_checkouts, DependencyManager, ExternalDependency};
pub use error::{Error, Result};
pub use hash::BuildCache;
pub use parallel::ParallelConfig;
pub use source::{collect_headers, SourceSelector};
pub use toolkit::CudaToolkit;

/// Convenience alias for the main builder type
pub type Builder = KernelBuilder;

/// Convenience alias for PTX output
pub type Bindings = PtxOutput;
