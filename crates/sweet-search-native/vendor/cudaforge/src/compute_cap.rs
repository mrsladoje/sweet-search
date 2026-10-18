//! Compute capability detection and management

use crate::error::{Error, Result};
use std::collections::HashMap;
use std::process::Command;

/// GPU architecture specification
///
/// Supports both numeric (80, 90) and string-based (90a, 100a) formats.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct GpuArch {
    /// Base compute capability number (e.g., 90, 100, 120)
    pub base: usize,
    /// Optional suffix for accelerated variants (e.g., "a" for async)
    pub suffix: Option<String>,
}

impl GpuArch {
    /// Create a new GPU architecture from base number
    pub fn new(base: usize) -> Self {
        Self { base, suffix: None }
    }

    /// Create a new GPU architecture with suffix (e.g., 90a, 100a)
    pub fn with_suffix(base: usize, suffix: &str) -> Self {
        Self {
            base,
            suffix: Some(suffix.to_string()),
        }
    }

    /// Parse from string like "90", "90a", "100a", "sm_90a"
    ///
    /// If no suffix is provided (e.g., "90"), auto-suffix is applied for sm_90+.
    /// To explicitly disable the suffix, use the numeric API directly.
    pub fn parse(s: &str) -> Result<Self> {
        let s = s.trim().to_lowercase();

        // Strip "sm_" prefix if present
        let s = s.strip_prefix("sm_").unwrap_or(&s);

        // Check for suffix (letters at the end)
        let (num_part, explicit_suffix) = if s.ends_with('a') {
            (&s[..s.len() - 1], Some("a".to_string()))
        } else {
            (s.as_ref(), None)
        };

        let base = num_part.parse::<usize>().map_err(|_| {
            Error::ComputeCapDetectionFailed(format!("Invalid compute capability: {}", s))
        })?;

        // Normalize (accept both 80 and 8.0 style)
        let base = if base < 100 && base < 20 {
            base * 10
        } else {
            base
        };

        // If explicit suffix provided, use it; otherwise auto-suffix for >=90
        if explicit_suffix.is_some() {
            Ok(Self {
                base,
                suffix: explicit_suffix,
            })
        } else {
            Ok(Self::auto_suffix(base))
        }
    }

    /// Create GPU arch with auto-detected suffix for newer architectures
    ///
    /// Architectures >= sm_90 generally benefit from the 'a' suffix for
    /// async/accelerated features. This is the recommended default.
    pub fn auto_suffix(base: usize) -> Self {
        match base {
            b if b >= 90 => Self::with_suffix(b, "a"),
            b => Self::new(b),
        }
    }

    /// Get the nvcc --gpu-architecture string (e.g., "sm_90a", "sm_80")
    pub fn to_nvcc_arch(&self) -> String {
        match &self.suffix {
            Some(s) => format!("sm_{}{}", self.base, s),
            None => format!("sm_{}", self.base),
        }
    }

    /// Get the nvcc -gencode argument (e.g., "-gencode=arch=compute_90a,code=sm_90a")
    ///
    /// This format is preferred for fat binary support and explicit architecture targeting.
    pub fn to_gencode_arg(&self) -> String {
        let compute = match &self.suffix {
            Some(s) => format!("compute_{}{}", self.base, s),
            None => format!("compute_{}", self.base),
        };
        let sm = self.to_nvcc_arch();
        format!("-gencode=arch={},code={}", compute, sm)
    }

    /// Get the base compute capability number
    pub fn base(&self) -> usize {
        self.base
    }
}

impl std::fmt::Display for GpuArch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.suffix {
            Some(s) => write!(f, "{}{}", self.base, s),
            None => write!(f, "{}", self.base),
        }
    }
}

impl From<usize> for GpuArch {
    fn from(base: usize) -> Self {
        Self::auto_suffix(base)
    }
}

/// Compute capability configuration
#[derive(Debug, Clone)]
pub struct ComputeCapability {
    /// Default compute cap (auto-detected or manually set)
    default_cap: Option<GpuArch>,
    /// Per-file overrides (filename pattern -> compute cap)
    overrides: HashMap<String, GpuArch>,
}

impl Default for ComputeCapability {
    fn default() -> Self {
        Self {
            default_cap: None,
            overrides: HashMap::new(),
        }
    }
}

impl ComputeCapability {
    /// Create new compute capability config with auto-detection
    pub fn new() -> Self {
        Self::default()
    }

    /// Set default compute capability (numeric, auto-selects suffix)
    pub fn with_default(mut self, cap: usize) -> Self {
        self.default_cap = Some(GpuArch::auto_suffix(cap));
        self
    }

    /// Set default compute capability with explicit arch string (e.g., "90a", "100a")
    pub fn with_default_arch(mut self, arch: &str) -> Self {
        if let Ok(gpu_arch) = GpuArch::parse(arch) {
            self.default_cap = Some(gpu_arch);
        }
        self
    }

    /// Add compute cap override for files matching pattern (numeric)
    ///
    /// Pattern can be:
    /// - Exact filename: "my_kernel.cu"
    /// - Glob pattern: "sm90_*.cu", "*_hopper.cu"
    pub fn with_override(mut self, pattern: &str, cap: usize) -> Self {
        self.overrides
            .insert(pattern.to_string(), GpuArch::auto_suffix(cap));
        self
    }

    /// Add compute cap override with explicit arch string (e.g., "90a", "100a")
    pub fn with_override_arch(mut self, pattern: &str, arch: &str) -> Self {
        if let Ok(gpu_arch) = GpuArch::parse(arch) {
            self.overrides.insert(pattern.to_string(), gpu_arch);
        }
        self
    }

    /// Get GPU arch for a specific file
    ///
    /// Priority:
    /// 1. Per-file override matching pattern
    /// 2. Default compute cap
    /// 3. Auto-detected from nvidia-smi
    /// 4. CUDA_COMPUTE_CAP environment variable
    pub fn get_for_file(&self, filename: &str) -> Result<GpuArch> {
        // Check overrides first
        for (pattern, arch) in &self.overrides {
            if matches_pattern(filename, pattern) {
                return Ok(arch.clone());
            }
        }

        // Use default if set
        if let Some(arch) = &self.default_cap {
            return Ok(arch.clone());
        }

        // Auto-detect
        detect_compute_cap()
    }

    /// Get the default GPU architecture
    pub fn get_default(&self) -> Result<GpuArch> {
        if let Some(arch) = &self.default_cap {
            return Ok(arch.clone());
        }
        detect_compute_cap()
    }

    /// Check if any overrides are configured
    pub fn has_overrides(&self) -> bool {
        !self.overrides.is_empty()
    }
}

/// Detect compute capability from system
///
/// Priority:
/// 1. CUDA_COMPUTE_CAP environment variable (supports "90", "90a", "100a")
/// 2. nvidia-smi query
pub fn detect_compute_cap() -> Result<GpuArch> {
    // Check environment variable first
    if let Ok(cap_str) = std::env::var("CUDA_COMPUTE_CAP") {
        return GpuArch::parse(&cap_str);
    }

    // Try nvidia-smi
    detect_from_nvidia_smi()
}

/// Detect compute capability using nvidia-smi
fn detect_from_nvidia_smi() -> Result<GpuArch> {
    let output = Command::new("nvidia-smi")
        .args(["--query-gpu=compute_cap", "--format=csv"])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_nvidia_smi_output(&stdout)
        }
        Ok(output) => Err(Error::ComputeCapDetectionFailed(format!(
            "nvidia-smi failed: {}. \
            If building in Docker, set CUDA_COMPUTE_CAP environment variable (e.g., CUDA_COMPUTE_CAP=90).",
            String::from_utf8_lossy(&output.stderr)
        ))),
        Err(e) => Err(Error::ComputeCapDetectionFailed(format!(
            "Failed to run nvidia-smi: {}. \
            If building in Docker, set CUDA_COMPUTE_CAP environment variable (e.g., CUDA_COMPUTE_CAP=90). \
            GPU is not accessible during 'docker build' - only during 'docker run --gpus all'.",
            e
        ))),
    }
}

/// Parse nvidia-smi output for compute capability
fn parse_nvidia_smi_output(output: &str) -> Result<GpuArch> {
    let line = output.lines().nth(1).ok_or_else(|| {
        Error::ComputeCapDetectionFailed("Unexpected nvidia-smi output".to_string())
    })?;

    let cap = line.trim().parse::<f32>().map_err(|_| {
        Error::ComputeCapDetectionFailed(format!("Failed to parse compute_cap: {}", line))
    })?;

    let base = (cap * 10.0) as usize;
    Ok(GpuArch::auto_suffix(base))
}

/// Match filename against pattern (simple glob matching)
fn matches_pattern(filename: &str, pattern: &str) -> bool {
    // Handle exact match
    if filename == pattern {
        return true;
    }

    // Simple glob matching for * wildcard
    if pattern.contains('*') {
        let parts: Vec<&str> = pattern.split('*').collect();

        if parts.len() == 2 {
            let (prefix, suffix) = (parts[0], parts[1]);
            return filename.starts_with(prefix) && filename.ends_with(suffix);
        }

        // Handle single * at start or end
        if pattern.starts_with('*') {
            return filename.ends_with(&pattern[1..]);
        }
        if pattern.ends_with('*') {
            return filename.starts_with(&pattern[..pattern.len() - 1]);
        }
    }

    false
}

/// Get GPU architecture string for nvcc (e.g., "sm_90a" or "sm_80")
///
/// This is a convenience function. For more control, use GpuArch directly.
pub fn get_gpu_arch_string(compute_cap: usize) -> String {
    GpuArch::auto_suffix(compute_cap).to_nvcc_arch()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_pattern() {
        assert!(matches_pattern("kernel.cu", "kernel.cu"));
        assert!(matches_pattern("sm90_kernel.cu", "sm90_*.cu"));
        assert!(matches_pattern("kernel_hopper.cu", "*_hopper.cu"));
        assert!(matches_pattern("prefix_middle_suffix.cu", "prefix_*.cu"));
        assert!(!matches_pattern("other.cu", "sm90_*.cu"));
    }

    #[test]
    fn test_gpu_arch_string() {
        assert_eq!(get_gpu_arch_string(80), "sm_80");
        assert_eq!(get_gpu_arch_string(90), "sm_90a");
        assert_eq!(get_gpu_arch_string(100), "sm_100a");
        assert_eq!(get_gpu_arch_string(120), "sm_120a");
    }

    #[test]
    fn test_gpu_arch_parse() {
        let arch = GpuArch::parse("90a").unwrap();
        assert_eq!(arch.base, 90);
        assert_eq!(arch.suffix, Some("a".to_string()));
        assert_eq!(arch.to_nvcc_arch(), "sm_90a");

        let arch = GpuArch::parse("100a").unwrap();
        assert_eq!(arch.base, 100);
        assert_eq!(arch.to_nvcc_arch(), "sm_100a");

        let arch = GpuArch::parse("sm_120a").unwrap();
        assert_eq!(arch.base, 120);
        assert_eq!(arch.to_nvcc_arch(), "sm_120a");

        let arch = GpuArch::parse("80").unwrap();
        assert_eq!(arch.base, 80);
        assert_eq!(arch.suffix, None);
        assert_eq!(arch.to_nvcc_arch(), "sm_80");
    }

    #[test]
    fn test_gpu_arch_auto_suffix() {
        assert_eq!(GpuArch::auto_suffix(80).to_nvcc_arch(), "sm_80");
        assert_eq!(GpuArch::auto_suffix(89).to_nvcc_arch(), "sm_89");
        assert_eq!(GpuArch::auto_suffix(90).to_nvcc_arch(), "sm_90a");
        assert_eq!(GpuArch::auto_suffix(100).to_nvcc_arch(), "sm_100a");
    }

    #[test]
    fn test_gpu_arch_gencode() {
        // Pre-Hopper architectures (no suffix)
        assert_eq!(
            GpuArch::auto_suffix(75).to_gencode_arg(),
            "-gencode=arch=compute_75,code=sm_75"
        );
        assert_eq!(
            GpuArch::auto_suffix(80).to_gencode_arg(),
            "-gencode=arch=compute_80,code=sm_80"
        );
        assert_eq!(
            GpuArch::auto_suffix(89).to_gencode_arg(),
            "-gencode=arch=compute_89,code=sm_89"
        );

        // Hopper+ architectures (with 'a' suffix)
        assert_eq!(
            GpuArch::auto_suffix(90).to_gencode_arg(),
            "-gencode=arch=compute_90a,code=sm_90a"
        );
        assert_eq!(
            GpuArch::auto_suffix(100).to_gencode_arg(),
            "-gencode=arch=compute_100a,code=sm_100a"
        );
        assert_eq!(
            GpuArch::auto_suffix(120).to_gencode_arg(),
            "-gencode=arch=compute_120a,code=sm_120a"
        );
    }
}
