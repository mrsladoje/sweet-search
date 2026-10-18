//! Parallel build configuration

use glob::Pattern;
use std::path::Path;
use std::str::FromStr;

/// Parallel build configuration
#[derive(Debug, Clone)]
pub struct ParallelConfig {
    /// Percentage of available threads to use (0.0 - 1.0)
    thread_percentage: f32,
    /// Maximum threads (overrides percentage if set)
    max_threads: Option<usize>,
    /// Minimum threads (floor)
    min_threads: usize,
    /// Patterns for files that should use nvcc threads
    nvcc_thread_file_patterns: Vec<String>,
    /// Number of threads for nvcc --threads argument (None = disabled)
    num_nvcc_threads: Option<usize>,
}

impl Default for ParallelConfig {
    fn default() -> Self {
        Self {
            thread_percentage: 0.5, // 50% by default
            max_threads: None,
            min_threads: 1,
            nvcc_thread_file_patterns: vec!["flash_api".to_string(), "cutlass".to_string()],
            num_nvcc_threads: Some(2),
        }
    }
}

impl ParallelConfig {
    /// Create a new parallel config with default settings
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the percentage of available threads to use
    ///
    /// Value should be between 0.0 and 1.0
    pub fn with_percentage(mut self, percentage: f32) -> Self {
        self.thread_percentage = percentage.clamp(0.0, 1.0);
        self
    }

    /// Set the maximum number of threads
    pub fn with_max_threads(mut self, max: usize) -> Self {
        self.max_threads = Some(max.max(1));
        self
    }

    /// Set the minimum number of threads
    pub fn with_min_threads(mut self, min: usize) -> Self {
        self.min_threads = min.max(1);
        self
    }

    /// Set patterns for files that should use nvcc threads
    ///
    /// This replaces the default patterns ("flash_api", "cutlass").
    /// `num_nvcc_threads` controls the `--threads=N` argument passed to nvcc.
    pub fn with_nvcc_thread_patterns<S: AsRef<str>>(
        mut self,
        patterns: &[S],
        num_nvcc_threads: usize,
    ) -> Self {
        self.nvcc_thread_file_patterns = patterns.iter().map(|s| s.as_ref().to_string()).collect();
        self.num_nvcc_threads = if num_nvcc_threads > 0 {
            Some(num_nvcc_threads)
        } else {
            None
        };
        self
    }

    /// Check if a file matches any of the thread patterns
    ///
    /// Supports glob patterns (e.g. "gemm_*.cu") and substring matching
    /// Check if a file matches any of the thread patterns
    ///
    /// Supports glob patterns (e.g. "gemm_*.cu") and substring matching
    pub fn should_use_nvcc_threads(&self, path_str: &str) -> bool {
        let path = Path::new(path_str);
        let filename_component = path.file_name().and_then(|s| s.to_str()).unwrap_or("");

        self.nvcc_thread_file_patterns.iter().any(|pattern| {
            // Check if it looks like a glob pattern
            if pattern.contains('*') || pattern.contains('?') || pattern.contains('[') {
                if let Ok(compiled) = Pattern::new(pattern) {
                    // 1. Try matching against the filename component (if pattern has no path separators)
                    if !pattern.contains('/') && !pattern.contains('\\') {
                        if compiled.matches(filename_component) {
                            return true;
                        }
                    }

                    // 2. Try matching against the full path
                    if compiled.matches(path_str) {
                        return true;
                    }
                }
            }
            // Fallback to substring matching (preserve backward compatibility)
            path_str.contains(pattern)
        })
    }

    /// Calculate the number of threads to use
    pub fn thread_count(&self) -> usize {
        // Check environment variable first
        if let Ok(env_threads) = std::env::var("CUDAFORGE_THREADS") {
            if let Ok(n) = usize::from_str(&env_threads) {
                return n.max(1);
            }
        }

        // Also check RAYON_NUM_THREADS for compatibility
        if let Ok(env_threads) = std::env::var("RAYON_NUM_THREADS") {
            if let Ok(n) = usize::from_str(&env_threads) {
                return n.max(1);
            }
        }

        let available = self.detect_available_threads();

        let calculated = if let Some(max) = self.max_threads {
            max.min(available)
        } else {
            (available as f32 * self.thread_percentage).ceil() as usize
        };

        calculated.max(self.min_threads).min(available)
    }

    /// Initialize the rayon thread pool with configured settings
    pub fn init_thread_pool(&self) -> Result<(), rayon::ThreadPoolBuildError> {
        let thread_count = self.thread_count();

        rayon::ThreadPoolBuilder::new()
            .num_threads(thread_count)
            .build_global()
    }

    /// Get thread count for nvcc --threads argument
    pub fn nvcc_threads(&self) -> Option<usize> {
        self.num_nvcc_threads
    }

    fn detect_available_threads(&self) -> usize {
        // Try std::thread::available_parallelism first
        if let Ok(parallelism) = std::thread::available_parallelism() {
            return parallelism.get();
        }

        // Fallback to num_cpus crate for physical cores
        num_cpus::get_physical()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = ParallelConfig::default();
        assert_eq!(config.thread_percentage, 0.5);
        assert!(config.max_threads.is_none());
    }

    #[test]
    fn test_percentage_clamping() {
        let config = ParallelConfig::new().with_percentage(1.5);
        assert_eq!(config.thread_percentage, 1.0);

        let config = ParallelConfig::new().with_percentage(-0.5);
        assert_eq!(config.thread_percentage, 0.0);
    }

    #[test]
    fn test_thread_patterns() {
        let config = ParallelConfig::default();
        // Default substring matching
        assert!(config.should_use_nvcc_threads("flash_api.cu"));
        assert!(config.should_use_nvcc_threads("src/flash_api_v2.cu"));
        assert!(config.should_use_nvcc_threads("cutlass_gemm.cu"));
        assert!(!config.should_use_nvcc_threads("simple.cu"));

        // Custom glob patterns
        let config = ParallelConfig::new().with_nvcc_thread_patterns(&["gemm_*.cu", "special"], 4);
        assert!(config.should_use_nvcc_threads("gemm_fp16.cu"));
        assert!(config.should_use_nvcc_threads("src/gemm_int8.cu")); // glob matches full string? check glob usage
        assert!(config.should_use_nvcc_threads("special_kernel.cu")); // substring fallback
        assert!(!config.should_use_nvcc_threads("flash_api.cu"));
    }

    #[test]
    fn test_glob_vs_substring() {
        let config = ParallelConfig::new().with_nvcc_thread_patterns(&["*gemm*.cu"], 2);
        assert!(config.should_use_nvcc_threads("/path/to/my_gemm_kernel.cu"));
        assert!(!config.should_use_nvcc_threads("/path/to/other.cu"));
    }
}
