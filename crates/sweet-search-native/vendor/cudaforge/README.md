# CudaForge

<!-- Uncomment these after publishing to crates.io:
[![Crates.io](https://img.shields.io/crates/v/cudaforge.svg)](https://crates.io/crates/cudaforge)
[![Documentation](https://docs.rs/cudaforge/badge.svg)](https://docs.rs/cudaforge)
![License](https://img.shields.io/crates/l/cudaforge.svg)
-->
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT%2FApache--2.0-green)
![CUDA](https://img.shields.io/badge/CUDA-12.x-76B900?logo=nvidia)

Advanced CUDA kernel builder for Rust with **incremental builds**, **auto-detection**, and **external dependency support**.

## Features

- 🚀 **Incremental Builds** - Only recompile modified kernels using content hashing
- 🔍 **Auto-Detection** - Automatically find CUDA toolkit, nvcc, and compute capability
- 🎯 **Per-Kernel Compute Cap** - Override compute capability for specific kernels by filename
- 📦 **External Dependencies** - Built-in CUTLASS support, or fetch any git repo
- ⚡ **Parallel Compilation** - Configurable thread percentage for parallel builds
- 📁 **Flexible Sources** - Directory, glob, files, or exclude patterns

## Installation

Add to your `Cargo.toml`:

```toml
[build-dependencies]
cudaforge = "0.1"
```

## Quick Start

### Building a Static Library

```rust
// build.rs
use cudaforge::{KernelBuilder, Result};

fn main() -> Result<()> {
    let out_dir = std::env::var("OUT_DIR")?;
    
    KernelBuilder::new()
        .source_dir("src/kernels")
        .arg("-O3")
        .arg("-std=c++17")
        .arg("--use_fast_math")
        .build_lib(format!("{}/libkernels.a", out_dir))?;
    
    println!("cargo:rustc-link-search={}", out_dir);
    println!("cargo:rustc-link-lib=kernels");
    println!("cargo:rustc-link-lib=dylib=cudart");
    
    Ok(())
}
```

### Building PTX Files

```rust
use cudaforge::KernelBuilder;

fn main() -> cudaforge::Result<()> {
    let output = KernelBuilder::new()
        .source_glob("src/**/*.cu")
        .build_ptx()?;
    
    // Generate Rust file with const declarations
    output.write("src/kernels.rs")?;
    
    Ok(())
}
```

## Compute Capability

### Auto-Detection

CudaForge automatically detects compute capability in this order:
1. `CUDA_COMPUTE_CAP` environment variable (supports "90", "90a", "100a")
2. `nvidia-smi --query-gpu=compute_cap`

For sm_90+ architectures, the 'a' suffix is automatically added for async features.

### Per-Kernel Override

Override compute capability for specific kernels using filename patterns:

```rust
KernelBuilder::new()
    .source_dir("src")
    .with_compute_override("sm90_*.cu", 90)  // Hopper (auto → sm_90a)
    .with_compute_override("sm80_*.cu", 80)  // Ampere (sm_80)
    .with_compute_override_arch("sm100_*.cu", "100a")  // Explicit arch string
    .build_lib("libkernels.a")?;
```

### String-Based Architecture

For explicit control over GPU architecture including suffix:

```rust
KernelBuilder::new()
    .compute_cap_arch("90a")  // Explicit sm_90a
    .source_dir("src")
    .build_lib("libkernels.a")?;
```

### Numeric (Auto-Suffix)

```rust
KernelBuilder::new()
    .compute_cap(90)  // Auto-selects sm_90a for 90+
    .source_dir("src")
    .build_lib("libkernels.a")?;
```

## Source Selection

### Directory (Recursive)

```rust
KernelBuilder::new()
    .source_dir("src/kernels")  // All .cu files recursively
```

### Glob Pattern

```rust
KernelBuilder::new()
    .source_glob("src/**/*.cu")
```

### Specific Files

```rust
KernelBuilder::new()
    .source_files(vec!["src/kernel1.cu", "src/kernel2.cu"])
```

### With Exclusions

```rust
KernelBuilder::new()
    .source_dir("src/kernels")
    .exclude(&["*_test.cu", "deprecated/*", "wip_*.cu"])
```

### Watch Additional Files

Track header files that should trigger rebuilds:

```rust
KernelBuilder::new()
    .source_dir("src/kernels")
    .watch(vec!["src/common.cuh", "src/utils.cuh"])
```

## External Dependencies

### CUTLASS Integration

```rust
KernelBuilder::new()
    .source_dir("src")
    .with_cutlass(Some("7127592069c2fe01b041e174ba4345ef9b279671"))
    .arg("-DUSE_CUTLASS")
    .arg("-std=c++17")
    .build_lib("libkernels.a")?;
```

### Custom Git Repository

Fetch include directories from any git repository:

```rust
KernelBuilder::new()
    .source_dir("src")
    .with_git_dependency(
        "my_lib",                              // Name
        "https://github.com/org/my_lib.git",   // Repository
        "abc123def456",                        // Commit hash
        vec!["include", "src/include"],        // Include paths
        vec!["src/kernels", "third_party"],    // Extra sparse-checkout paths
        false,                                 // Do not recurse submodules
    )
    .build_lib("libkernels.a")?;
```

`include_paths` are added to nvcc as `-I...` include directories.

`extra_paths` are fetched into the sparse checkout but are not added as include directories automatically. Use them when your build needs additional source trees, generated files, templates, or other repo content beyond headers.

If you need to compile source files from the fetched dependency, you can fetch the checkout root and reference files from there:

```rust
let builder = KernelBuilder::new()
    .source_dir("src")
    .with_git_dependency(
        "my_lib",
        "https://github.com/org/my_lib.git",
        "abc123def456",
        vec!["include"],
        vec!["src/kernels"],
        false,
    );

let my_lib_root = builder.fetch_git_dependency("my_lib")?;
let builder = builder.source_files(vec![my_lib_root.join("src/kernels/my_kernel.cu")]);
```

### Local Include Paths

```rust
KernelBuilder::new()
    .source_dir("src")
    .include_path("third_party/include")
    .include_path("/opt/cuda/samples/common/inc")
    .build_lib("libkernels.a")?;
```

## Parallel Compilation

### Thread Percentage

Use a percentage of available threads:

```rust
KernelBuilder::new()
    .thread_percentage(0.5)  // 50% of available threads
    .source_dir("src")
    .build_lib("libkernels.a")?;
```

### Maximum Threads

Set an absolute limit:

```rust
KernelBuilder::new()
    .max_threads(8)  // Use at most 8 threads
    .source_dir("src")
    .build_lib("libkernels.a")?;
```

### Environment Variables

- `CUDAFORGE_THREADS` - Override thread count
- `RAYON_NUM_THREADS` - Alternative for compatibility

### Pattern-Based Threading

Enable multiple nvcc threads only for specific files (supports globs):

```rust
KernelBuilder::new()
    .nvcc_thread_patterns(&[
        "gemm_*.cu",       // Matches filename (gemm_vp8.cu)
        "**/special/*.cu", // Matches path
        "flash_api",       // Matches substring
    ], 4)  // Use 4 nvcc threads for matching files
    .build_lib("libkernels.a")?;
```

## CUDA Toolkit Detection

CudaForge automatically locates the CUDA toolkit in this order:

1. `NVCC` environment variable
2. `nvcc` in `PATH`
3. `CUDA_HOME/bin/nvcc`
4. `/usr/local/cuda/bin/nvcc`
5. Common installation paths

### Manual Override

```rust
KernelBuilder::new()
    .cuda_root("/opt/cuda-12.1")
```

## Incremental Builds

Incremental builds are enabled by default. CudaForge tracks:
- File content hashes (SHA-256)
- Compute capability used
- Compiler arguments

To disable:

```rust
KernelBuilder::new()
    .no_incremental()
```

## Full Example

```rust
use cudaforge::{KernelBuilder, Result};

fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=CUDA_COMPUTE_CAP");
    
    let out_dir = std::env::var("OUT_DIR")?;
    
    // Build with full feature set
    KernelBuilder::new()
        // Source selection
        .source_dir("src/kernels")
        .exclude(&["*_test.cu", "deprecated/*"])
        .watch(vec!["src/common.cuh"])
        
        // Per-kernel compute cap
        .with_compute_override("sm90_*.cu", 90)
        .with_compute_override("sm80_*.cu", 80)
        
        // External dependencies
        .with_cutlass(None)
        
        // Compiler options
        .arg("--expt-relaxed-constexpr")
        .arg("-std=c++17")
        .arg("-O3")
        .arg("--use_fast_math")
        
        // Parallel build
        .thread_percentage(0.5)
        
        // Build
        .build_lib(format!("{}/libkernels.a", out_dir))?;
    
    println!("cargo:rustc-link-search={}", out_dir);
    println!("cargo:rustc-link-lib=kernels");
    println!("cargo:rustc-link-lib=dylib=cudart");
    
    Ok(())
}
```

## Multiple Builders

Use multiple builders in sequence for different output types or configurations:

```rust
use cudaforge::KernelBuilder;

fn main() -> cudaforge::Result<()> {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR");
    
    // Builder 1: Static library for main kernels
    KernelBuilder::new()
        .source_dir("src/kernels")
        .exclude(&["*_ptx.cu"])
        .compute_cap(90)
        .arg("-O3")
        .build_lib(format!("{}/libkernels.a", out_dir))?;
    
    // Builder 2: PTX files for runtime compilation
    let ptx_output = KernelBuilder::new()
        .source_glob("src/ptx_kernels/*.cu")
        .compute_cap(80)
        .build_ptx()?;
    
    ptx_output.write("src/kernels.rs")?;
    
    // Builder 3: Separate lib with CUTLASS
    KernelBuilder::new()
        .source_dir("src/cutlass_kernels")
        .with_cutlass(None)
        .compute_cap_arch("100a")
        .build_lib(format!("{}/libcutlass.a", out_dir))?;
    
    println!("cargo:rustc-link-search={}", out_dir);
    println!("cargo:rustc-link-lib=kernels");
    println!("cargo:rustc-link-lib=cutlass");
    
    Ok(())
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CUDA_COMPUTE_CAP` | Default compute capability (e.g., `80`, `90`) |
| `NVCC` | Path to nvcc binary |
| `CUDA_HOME` | CUDA installation root |
| `NVCC_CCBIN` | C++ compiler for nvcc |
| `CUDAFORGE_THREADS` | Override thread count |

## Docker Builds

> [!IMPORTANT]
> **GPU is NOT accessible during `docker build`** — only during `docker run --gpus all`.

When building CUDA kernels inside a Dockerfile, `nvidia-smi` cannot be used to auto-detect compute capability. You must explicitly set `CUDA_COMPUTE_CAP`:

### Dockerfile Example

```dockerfile
FROM nvidia/cuda:12.8.0-devel-ubuntu22.04

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

# Set compute capability for the build
ARG CUDA_COMPUTE_CAP=90
ENV CUDA_COMPUTE_CAP=${CUDA_COMPUTE_CAP}

# Build with explicit compute cap
WORKDIR /app
COPY . .
RUN cargo build --release
```

Build for different GPU architectures:

```bash
# Build for Hopper (sm_90)
docker build --build-arg CUDA_COMPUTE_CAP=90 -t myapp:hopper .

# Build for Blackwell (sm_100)
docker build --build-arg CUDA_COMPUTE_CAP=100 -t myapp:blackwell .

# Build for Ampere (sm_80)
docker build --build-arg CUDA_COMPUTE_CAP=80 -t myapp:ampere .
```

### Fail-Fast Mode

For CI/Docker builds, use `require_explicit_compute_cap()` to fail immediately if compute capability is not set:

```rust
KernelBuilder::new()
    .require_explicit_compute_cap()?  // Fails fast if CUDA_COMPUTE_CAP not set
    .source_dir("src/kernels")
    .build_lib("libkernels.a")?;
```

## Migration from bindgen_cuda

| Old API | New API |
|---------|---------|
| `Builder::default()` | `KernelBuilder::new()` |
| `.kernel_paths(vec![...])` | `.source_files(vec![...])` |
| `.kernel_paths_glob("...")` | `.source_glob("...")` |
| `.include_paths(vec![...])` | `.include_path("...")` |
| `Bindings` | `PtxOutput` |

Backward compatibility aliases are available:
- `cudaforge::Builder` → `KernelBuilder`
- `cudaforge::Bindings` → `PtxOutput`

## License

MIT OR Apache-2.0
