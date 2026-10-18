//! Main kernel builder implementation

use crate::compute_cap::{ComputeCapability, GpuArch};
use crate::dependency::DependencyManager;
use crate::error::{Error, Result};
use crate::hash::{hash_args, BuildCache};
use crate::parallel::ParallelConfig;
use crate::source::SourceSelector;
use crate::toolkit::CudaToolkit;

use rayon::prelude::*;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

/// Main builder for CUDA kernel compilation
#[derive(Debug)]
pub struct KernelBuilder {
    /// CUDA toolkit configuration
    toolkit: Option<CudaToolkit>,
    /// Compute capability configuration
    compute_cap: ComputeCapability,
    /// Source file selection
    sources: SourceSelector,
    /// External dependencies
    dependencies: DependencyManager,
    /// Parallel build configuration
    parallel: ParallelConfig,
    /// Output directory
    out_dir: PathBuf,
    /// Extra nvcc arguments
    extra_args: Vec<String>,
    /// Whether to use incremental builds
    incremental: bool,
}

impl Default for KernelBuilder {
    fn default() -> Self {
        let out_dir = std::env::var("OUT_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("target/debug"));

        Self {
            toolkit: None,
            compute_cap: ComputeCapability::default(),
            sources: SourceSelector::default(),
            dependencies: DependencyManager::default(),
            parallel: ParallelConfig::default(),
            out_dir,
            extra_args: Vec::new(),
            incremental: true,
        }
    }
}

impl KernelBuilder {
    /// Create a new kernel builder with default settings
    pub fn new() -> Self {
        Self::default()
    }

    // ========== Source Selection ==========

    /// Add a directory to search for .cu files (recursive)
    pub fn source_dir<P: AsRef<Path>>(mut self, dir: P) -> Self {
        self.sources = self.sources.add_directory(dir);
        self
    }

    /// Add specific kernel files
    pub fn source_files<I, P>(mut self, files: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        self.sources = self.sources.add_files(files);
        self
    }

    /// Add kernel files matching a glob pattern
    pub fn source_glob(mut self, pattern: &str) -> Self {
        self.sources = self.sources.add_glob(pattern);
        self
    }

    /// Exclude files matching patterns
    pub fn exclude(mut self, patterns: &[&str]) -> Self {
        self.sources = self.sources.exclude(patterns);
        self
    }

    /// Add paths to watch for changes (headers, etc.)
    pub fn watch<I, P>(mut self, paths: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        self.sources = self.sources.watch(paths);
        self
    }

    // ========== Compute Capability ==========

    /// Set the default compute capability (numeric, auto-selects 'a' suffix for sm_90+)
    pub fn compute_cap(mut self, cap: usize) -> Self {
        self.compute_cap = self.compute_cap.with_default(cap);
        self
    }

    /// Set the default compute capability with explicit arch string (e.g., "90a", "100a", "80")
    ///
    /// Use this when you need explicit control over the architecture suffix.
    pub fn compute_cap_arch(mut self, arch: &str) -> Self {
        self.compute_cap = self.compute_cap.with_default_arch(arch);
        self
    }

    /// Set compute cap override for specific kernels (numeric)
    ///
    /// Pattern can use wildcards: "sm90_*.cu", "*_hopper.cu"
    pub fn with_compute_override(mut self, pattern: &str, cap: usize) -> Self {
        self.compute_cap = self.compute_cap.with_override(pattern, cap);
        self
    }

    /// Set compute cap override with explicit arch string (e.g., "90a", "100a")
    pub fn with_compute_override_arch(mut self, pattern: &str, arch: &str) -> Self {
        self.compute_cap = self.compute_cap.with_override_arch(pattern, arch);
        self
    }

    /// Get the current default compute capability (base number only)
    pub fn get_compute_cap(&self) -> Option<usize> {
        self.compute_cap.get_default().ok().map(|a| a.base)
    }

    /// Set compute capability (mutable reference version)
    pub fn set_compute_cap(&mut self, cap: usize) {
        self.compute_cap = ComputeCapability::new().with_default(cap);
    }

    /// Require explicit compute capability (fail fast if not set)
    ///
    /// Use this for Docker builds or CI environments where nvidia-smi is unavailable.
    /// The build will fail immediately if CUDA_COMPUTE_CAP is not set and no
    /// compute capability was explicitly configured via `.compute_cap()`.
    ///
    /// # Example
    /// ```no_run
    /// use cudaforge::KernelBuilder;
    ///
    /// // For Docker builds, require explicit compute cap
    /// KernelBuilder::new()
    ///     .require_explicit_compute_cap()?  // Fails if CUDA_COMPUTE_CAP not set
    ///     .source_dir("src/kernels")
    ///     .build_lib("libkernels.a")?;
    /// # Ok::<(), cudaforge::Error>(())
    /// ```
    pub fn require_explicit_compute_cap(self) -> Result<Self> {
        // Check if compute cap is already set
        if self.compute_cap.get_default().is_ok() {
            return Ok(self);
        }

        // Check environment variable
        if std::env::var("CUDA_COMPUTE_CAP").is_ok() {
            return Ok(self);
        }

        Err(Error::ComputeCapDetectionFailed(
            "Explicit compute capability required but not set. \
            Either call .compute_cap(N) on the builder or set CUDA_COMPUTE_CAP environment variable. \
            This is required for Docker builds where nvidia-smi is unavailable.".to_string()
        ))
    }

    // ========== External Dependencies ==========

    /// Add CUTLASS dependency
    pub fn with_cutlass(mut self, commit: Option<&str>) -> Self {
        self.dependencies = self.dependencies.with_cutlass(commit);
        self
    }

    /// Add a custom git dependency
    /// If `recurse_submodules` is false, clone/fetch adds --no-recurse-submodules.
    pub fn with_git_dependency(
        mut self,
        name: &str,
        repo: &str,
        commit: &str,
        include_paths: Vec<&str>,
        extra_paths: Vec<&str>,
        recurse_submodules: bool,
    ) -> Self {
        self.dependencies = self.dependencies.with_git_dependency(
            name,
            repo,
            commit,
            include_paths,
            extra_paths,
            recurse_submodules,
        );
        self
    }

    /// Fetch a configured git dependency and return its checkout root.
    pub fn fetch_git_dependency(&self, name: &str) -> Result<PathBuf> {
        self.dependencies.fetch_dependency(name, &self.out_dir)
    }

    /// Add a local include path
    pub fn include_path<P: Into<PathBuf>>(mut self, path: P) -> Self {
        self.dependencies = self.dependencies.with_local_include(path);
        self
    }

    // ========== Parallel Configuration ==========

    /// Set the percentage of available threads to use (0.0 - 1.0)
    pub fn thread_percentage(mut self, percentage: f32) -> Self {
        self.parallel = self.parallel.with_percentage(percentage);
        self
    }

    /// Set the maximum number of threads
    pub fn max_threads(mut self, max: usize) -> Self {
        self.parallel = self.parallel.with_max_threads(max);
        self
    }

    /// Set patterns for files that should use nvcc threads
    ///
    /// This replaces the default patterns ("flash_api", "cutlass").
    /// `num_nvcc_threads` controls the `--threads=N` argument passed to nvcc for matching files.
    pub fn nvcc_thread_patterns<S: AsRef<str>>(
        mut self,
        patterns: &[S],
        num_nvcc_threads: usize,
    ) -> Self {
        self.parallel = self
            .parallel
            .with_nvcc_thread_patterns(patterns, num_nvcc_threads);
        self
    }

    // ========== Build Configuration ==========

    /// Set the output directory
    pub fn out_dir<P: Into<PathBuf>>(mut self, dir: P) -> Self {
        self.out_dir = dir.into();
        self
    }

    /// Add an extra nvcc argument
    pub fn arg(mut self, arg: &str) -> Self {
        self.extra_args.push(arg.to_string());
        self
    }

    /// Add multiple extra nvcc arguments
    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        for arg in args {
            self.extra_args.push(arg.as_ref().to_string());
        }
        self
    }

    /// Disable incremental builds
    pub fn no_incremental(mut self) -> Self {
        self.incremental = false;
        self
    }

    /// Set explicit CUDA toolkit path
    pub fn cuda_root<P: AsRef<Path>>(mut self, path: P) -> Self {
        if let Ok(toolkit) = CudaToolkit::from_nvcc_path(path.as_ref().join("bin").join("nvcc")) {
            self.toolkit = Some(toolkit);
        }
        self
    }

    // ========== Build Methods ==========

    /// Build a static library from all kernel sources
    pub fn build_lib<P: Into<PathBuf>>(&self, out_file: P) -> Result<()> {
        let out_file = out_file.into();

        // Detect toolkit if not set
        let toolkit = match &self.toolkit {
            Some(t) => t.clone(),
            None => CudaToolkit::detect()?,
        };

        // Initialize thread pool
        let _ = self.parallel.init_thread_pool();

        println!(
            "cargo:warning=Using {} threads for compilation",
            self.parallel.thread_count()
        );

        // Create output directory
        std::fs::create_dir_all(&self.out_dir)?;

        // Resolve source files
        let kernel_files = self.sources.resolve()?;
        if kernel_files.is_empty() {
            println!("cargo:warning=No kernel files found");
            return Ok(());
        }

        // Emit cargo:rerun-if-changed directives
        for file in &kernel_files {
            println!("cargo:rerun-if-changed={}", file.display());
        }
        for path in self.sources.watch_paths() {
            println!("cargo:rerun-if-changed={}", path.display());
        }
        println!("cargo:rerun-if-env-changed=CUDA_COMPUTE_CAP");
        println!("cargo:rerun-if-env-changed=NVCC");
        println!("cargo:rerun-if-env-changed=NVCC_CCBIN");

        // Fetch external dependencies
        let dep_args = self.dependencies.fetch_all(&self.out_dir)?;

        // Load build cache
        let mut cache = if self.incremental {
            BuildCache::load(&self.out_dir)
        } else {
            BuildCache::default()
        };

        // Calculate args hash for cache
        let mut all_args = self.extra_args.clone();
        all_args.extend(dep_args.clone());
        let args_hash = hash_args(&all_args);

        // Determine which files need compilation
        let mut compile_jobs: Vec<(PathBuf, PathBuf, GpuArch)> = Vec::new();
        let mut all_obj_files: Vec<PathBuf> = Vec::new();

        for kernel_file in &kernel_files {
            let filename = kernel_file
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            let gpu_arch = self.compute_cap.get_for_file(filename)?;

            // Generate unique object file name
            let obj_file = self.object_file_path(kernel_file);
            all_obj_files.push(obj_file.clone());

            if self.incremental
                && !cache.needs_rebuild(
                    kernel_file,
                    &obj_file,
                    &gpu_arch.to_nvcc_arch(),
                    &args_hash,
                )
            {
                continue;
            }

            compile_jobs.push((kernel_file.clone(), obj_file, gpu_arch));
        }

        if compile_jobs.is_empty() && out_file.exists() {
            println!("cargo:warning=All kernels up-to-date, skipping compilation");
            return Ok(());
        }

        println!(
            "cargo:warning=Compiling {} of {} kernels",
            compile_jobs.len(),
            kernel_files.len()
        );

        // Get target info
        let target = std::env::var("TARGET").ok();
        let is_msvc = target.as_ref().map_or(false, |t| t.contains("msvc"));
        let ccbin_env = std::env::var("NVCC_CCBIN").ok();
        let nvcc_threads = self.parallel.nvcc_threads();

        // Compile in parallel
        let had_error = AtomicBool::new(false);

        compile_jobs.par_iter().try_for_each(
            |(kernel_file, obj_file, gpu_arch)| -> Result<()> {
                if had_error.load(Ordering::Relaxed) {
                    return Ok(());
                }

                let gencode_arg = gpu_arch.to_gencode_arg();

                let mut command = Command::new(&toolkit.nvcc_path);
                command
                    .arg(&gencode_arg)
                    .arg("-c")
                    .arg("-o")
                    .arg(obj_file)
                    .args(["--default-stream", "per-thread"]);

                // Add extra args
                for arg in &self.extra_args {
                    command.arg(arg);
                }

                // Add dependency includes
                for arg in &dep_args {
                    command.arg(arg);
                }

                // Add CUTLASS define if using cutlass
                if self.dependencies.has_cutlass() {
                    command.arg("-DUSE_CUTLASS");
                }

                // Add ccbin if set
                if let Some(ccbin) = &ccbin_env {
                    command
                        .arg("-allow-unsupported-compiler")
                        .args(["-ccbin", ccbin]);
                }

                // Add PIC flag for non-MSVC
                if !is_msvc {
                    command.arg("-Xcompiler").arg("-fPIC");
                } else {
                    command.arg("-D_USE_MATH_DEFINES");
                }

                // Add nvcc threads for certain files
                if let Some(threads) = nvcc_threads {
                    let filename = kernel_file.to_string_lossy();
                    if self.parallel.should_use_nvcc_threads(&filename) {
                        command.arg(format!("--threads={}", threads));
                    }
                }

                command.arg(kernel_file);

                let output = command
                    .spawn()
                    .map_err(|e| Error::NvccNotFound(format!("Failed to spawn nvcc: {}", e)))?
                    .wait_with_output()
                    .map_err(|e| Error::CompilationFailed {
                        path: kernel_file.clone(),
                        message: e.to_string(),
                    })?;

                if !output.status.success() {
                    had_error.store(true, Ordering::Relaxed);
                    return Err(Error::CompilationFailed {
                        path: kernel_file.clone(),
                        message: format!(
                            "nvcc error:\n{}\n{}",
                            String::from_utf8_lossy(&output.stdout),
                            String::from_utf8_lossy(&output.stderr)
                        ),
                    });
                }

                Ok(())
            },
        )?;

        // Update cache for compiled files
        if self.incremental {
            for (kernel_file, obj_file, gpu_arch) in &compile_jobs {
                cache.update(kernel_file, obj_file, &gpu_arch.to_nvcc_arch(), &args_hash)?;
            }
            cache.save(&self.out_dir)?;
        }

        // Link into static library
        let mut command = Command::new(&toolkit.nvcc_path);
        command
            .arg("--lib")
            .arg("-o")
            .arg(&out_file)
            .args(&all_obj_files);

        let output = command
            .spawn()
            .map_err(|e| Error::NvccNotFound(format!("Failed to spawn nvcc for linking: {}", e)))?
            .wait_with_output()
            .map_err(|e| Error::LinkingFailed(e.to_string()))?;

        if !output.status.success() {
            return Err(Error::LinkingFailed(format!(
                "nvcc linking error:\n{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        Ok(())
    }

    /// Build PTX files from all kernel sources
    pub fn build_ptx(&self) -> Result<PtxOutput> {
        let toolkit = match &self.toolkit {
            Some(t) => t.clone(),
            None => CudaToolkit::detect()?,
        };

        let _ = self.parallel.init_thread_pool();
        std::fs::create_dir_all(&self.out_dir)?;

        let kernel_files = self.sources.resolve()?;

        // Set CUDA include dir
        println!(
            "cargo:rustc-env=CUDA_INCLUDE_DIR={}",
            toolkit.include_dir.display()
        );

        // Emit cargo:rerun-if-changed
        for file in &kernel_files {
            println!("cargo:rerun-if-changed={}", file.display());
        }
        for path in self.sources.watch_paths() {
            println!("cargo:rerun-if-changed={}", path.display());
        }
        println!("cargo:rerun-if-env-changed=CUDA_COMPUTE_CAP");
        println!("cargo:rerun-if-env-changed=NVCC_CCBIN");

        let dep_args = self.dependencies.fetch_all(&self.out_dir)?;
        let ccbin_env = std::env::var("NVCC_CCBIN").ok();
        let nvcc_threads = self.parallel.nvcc_threads();

        kernel_files
            .par_iter()
            .try_for_each(|kernel_file| -> Result<()> {
                let filename = kernel_file
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                let gpu_arch = self.compute_cap.get_for_file(filename)?;

                let output_file = self
                    .out_dir
                    .join(kernel_file.with_extension("ptx").file_name().unwrap());

                let gencode_arg = gpu_arch.to_gencode_arg();

                // sweet-search patch: the PTX is current only if it is newer
                // than its source AND was built for the same target. Upstream
                // checked mtime only, so changing CUDA_COMPUTE_CAP reran this
                // script in the same OUT_DIR and kept PTX for the old target.
                let stamp_file = output_file.with_extension("ptx.target");
                let stamp = format!("{gencode_arg}\n{}\n", self.extra_args.join(" "));
                if output_file.exists()
                    && std::fs::read_to_string(&stamp_file).ok().as_deref() == Some(stamp.as_str())
                {
                    if let (Ok(out_meta), Ok(in_meta)) =
                        (output_file.metadata(), kernel_file.metadata())
                    {
                        if let (Ok(out_time), Ok(in_time)) =
                            (out_meta.modified(), in_meta.modified())
                        {
                            if out_time.duration_since(in_time).is_ok() {
                                return Ok(());
                            }
                        }
                    }
                }
                let _ = std::fs::remove_file(&stamp_file);

                let mut command = Command::new(&toolkit.nvcc_path);
                command
                    .arg(&gencode_arg)
                    .arg("--ptx")
                    .args(["--default-stream", "per-thread"])
                    .args(["--output-directory", &self.out_dir.to_string_lossy()]);

                for arg in &self.extra_args {
                    command.arg(arg);
                }
                for arg in &dep_args {
                    command.arg(arg);
                }
                if let Some(ccbin) = &ccbin_env {
                    command
                        .arg("-allow-unsupported-compiler")
                        .args(["-ccbin", ccbin]);
                }

                // Add nvcc threads for certain files
                if let Some(threads) = nvcc_threads {
                    let file_path = kernel_file.to_string_lossy();
                    if self.parallel.should_use_nvcc_threads(&file_path) {
                        command.arg(format!("--threads={}", threads));
                    }
                }

                command.arg(kernel_file);

                let output = command
                    .spawn()
                    .map_err(|e| Error::NvccNotFound(format!("Failed to spawn nvcc: {}", e)))?
                    .wait_with_output()
                    .map_err(|e| Error::CompilationFailed {
                        path: kernel_file.clone(),
                        message: e.to_string(),
                    })?;

                if !output.status.success() {
                    return Err(Error::CompilationFailed {
                        path: kernel_file.clone(),
                        message: format!(
                            "nvcc error:\n{}\n{}",
                            String::from_utf8_lossy(&output.stdout),
                            String::from_utf8_lossy(&output.stderr)
                        ),
                    });
                }
                std::fs::write(&stamp_file, &stamp)?;

                Ok(())
            })?;

        Ok(PtxOutput {
            paths: kernel_files,
            out_dir: self.out_dir.clone(),
        })
    }

    /// Generate unique object file path for a kernel
    fn object_file_path(&self, kernel_file: &Path) -> PathBuf {
        let mut hasher = DefaultHasher::new();
        kernel_file.display().to_string().hash(&mut hasher);
        let hash = hasher.finish();

        let stem = kernel_file
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("kernel");

        self.out_dir.join(format!("{}-{:x}.o", stem, hash))
    }
}

/// Output from PTX compilation
pub struct PtxOutput {
    paths: Vec<PathBuf>,
    #[allow(dead_code)]
    out_dir: PathBuf,
}

impl PtxOutput {
    /// sweet-search patch: the kernel sources this output was built from,
    /// for build scripts that write their own bindings.
    pub fn paths(&self) -> &[PathBuf] {
        &self.paths
    }

    /// Write a Rust source file with `const` declarations for each PTX file
    pub fn write<P: AsRef<Path>>(&self, out: P) -> Result<()> {
        let mut file = std::fs::File::create(out.as_ref())?;

        for kernel_path in &self.paths {
            let name = kernel_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("KERNEL");

            writeln!(
                file,
                r#"pub const {}: &str = include_str!(concat!(env!("OUT_DIR"), "/{}.ptx"));"#,
                name.to_uppercase().replace(['.', '-'], "_"),
                name
            )?;
        }

        Ok(())
    }
}
