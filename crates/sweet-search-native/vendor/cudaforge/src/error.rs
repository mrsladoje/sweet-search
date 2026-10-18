//! Error types for CudaForge

use std::path::PathBuf;
use thiserror::Error;

/// Result type alias for CudaForge operations
pub type Result<T> = std::result::Result<T, Error>;

/// Errors that can occur during CUDA kernel building
#[derive(Debug, Error)]
pub enum Error {
    /// nvcc binary not found
    #[error("nvcc not found: {0}. Set NVCC environment variable or ensure nvcc is in PATH")]
    NvccNotFound(String),

    /// CUDA toolkit not found
    #[error("CUDA toolkit not found at {0}")]
    CudaToolkitNotFound(PathBuf),

    /// Compute capability detection failed
    #[error("Failed to detect compute capability: {0}")]
    ComputeCapDetectionFailed(String),

    /// Kernel compilation failed
    #[error("Kernel compilation failed for {path}: {message}")]
    CompilationFailed {
        /// Path to the kernel file that failed
        path: PathBuf,
        /// Error message from nvcc
        message: String,
    },

    /// Linking failed
    #[error("Linking failed: {0}")]
    LinkingFailed(String),

    /// Invalid source path
    #[error("Source path does not exist: {0}")]
    SourcePathNotFound(PathBuf),

    /// Git operation failed
    #[error("Git operation failed: {0}")]
    GitOperationFailed(String),

    /// IO error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Cache error
    #[error("Cache error: {0}")]
    CacheError(String),

    /// Invalid configuration
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}
