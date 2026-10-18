//! CUDA toolkit auto-detection

use crate::error::{Error, Result};
use std::path::PathBuf;
use std::process::Command;

/// Standard CUDA installation paths to search
const CUDA_SEARCH_PATHS: &[&str] = &[
    "/usr/local/cuda",
    "/opt/cuda",
    "/usr/lib/cuda",
    "/usr",
    "C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA",
    "C:/CUDA",
];

/// CUDA toolkit information
#[derive(Debug, Clone)]
pub struct CudaToolkit {
    /// Path to nvcc binary
    pub nvcc_path: PathBuf,
    /// CUDA include directory
    pub include_dir: PathBuf,
    /// CUDA lib directory
    pub lib_dir: PathBuf,
    /// CUDA version (if detected)
    pub version: Option<String>,
}

impl CudaToolkit {
    /// Auto-detect CUDA toolkit installation
    ///
    /// Search order:
    /// 1. NVCC environment variable
    /// 2. which nvcc (PATH lookup)
    /// 3. CUDA_HOME/bin/nvcc
    /// 4. Common installation paths
    pub fn detect() -> Result<Self> {
        let nvcc_path = find_nvcc()?;

        // Derive include and lib directories from nvcc location
        let cuda_root = nvcc_path
            .parent()
            .and_then(|p| p.parent())
            .ok_or_else(|| Error::CudaToolkitNotFound(nvcc_path.clone()))?;

        let include_dir = cuda_root.join("include");
        let lib_dir = if cfg!(target_os = "windows") {
            cuda_root.join("lib").join("x64")
        } else {
            cuda_root.join("lib64")
        };

        let version = detect_cuda_version(&nvcc_path);

        Ok(Self {
            nvcc_path,
            include_dir,
            lib_dir,
            version,
        })
    }

    /// Create toolkit from explicit nvcc path
    pub fn from_nvcc_path(nvcc_path: PathBuf) -> Result<Self> {
        if !nvcc_path.exists() {
            return Err(Error::NvccNotFound(nvcc_path.display().to_string()));
        }

        let cuda_root = nvcc_path
            .parent()
            .and_then(|p| p.parent())
            .ok_or_else(|| Error::CudaToolkitNotFound(nvcc_path.clone()))?;

        let include_dir = cuda_root.join("include");
        let lib_dir = if cfg!(target_os = "windows") {
            cuda_root.join("lib").join("x64")
        } else {
            cuda_root.join("lib64")
        };

        let version = detect_cuda_version(&nvcc_path);

        Ok(Self {
            nvcc_path,
            include_dir,
            lib_dir,
            version,
        })
    }

    /// Get supported GPU architectures from nvcc
    pub fn supported_architectures(&self) -> Vec<usize> {
        let output = Command::new(&self.nvcc_path)
            .arg("--list-gpu-code")
            .output();

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_gpu_codes(&stdout)
        } else {
            Vec::new()
        }
    }
}

/// Find nvcc binary following search order
fn find_nvcc() -> Result<PathBuf> {
    // 1. Check NVCC environment variable
    if let Ok(nvcc) = std::env::var("NVCC") {
        let path = PathBuf::from(&nvcc);
        if path.exists() {
            return Ok(path);
        }
    }

    // 2. Try which::which for PATH lookup
    if let Ok(path) = which::which("nvcc") {
        return Ok(path);
    }

    // 3. Check CUDA_HOME
    if let Ok(cuda_home) = std::env::var("CUDA_HOME") {
        let nvcc = PathBuf::from(&cuda_home).join("bin").join("nvcc");
        if nvcc.exists() {
            return Ok(nvcc);
        }
    }

    // 4. Check CUDA_PATH (Windows)
    if let Ok(cuda_path) = std::env::var("CUDA_PATH") {
        let nvcc = PathBuf::from(&cuda_path).join("bin").join("nvcc.exe");
        if nvcc.exists() {
            return Ok(nvcc);
        }
    }

    // 5. Search common installation paths
    for base_path in CUDA_SEARCH_PATHS {
        let base = PathBuf::from(base_path);

        // Try direct path
        let nvcc = base.join("bin").join(if cfg!(target_os = "windows") {
            "nvcc.exe"
        } else {
            "nvcc"
        });
        if nvcc.exists() {
            return Ok(nvcc);
        }

        // On Windows, search versioned subdirectories
        if cfg!(target_os = "windows") && base.exists() {
            if let Ok(entries) = std::fs::read_dir(&base) {
                for entry in entries.flatten() {
                    let nvcc = entry.path().join("bin").join("nvcc.exe");
                    if nvcc.exists() {
                        return Ok(nvcc);
                    }
                }
            }
        }
    }

    Err(Error::NvccNotFound(
        "No nvcc found in PATH or standard locations".to_string(),
    ))
}

/// Parse GPU codes from nvcc --list-gpu-code output
fn parse_gpu_codes(output: &str) -> Vec<usize> {
    let mut codes = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('_').collect();
        if parts.len() >= 2 && parts.contains(&"sm") {
            if let Ok(code) = parts[1].parse::<usize>() {
                codes.push(code);
            }
        }
    }
    codes.sort();
    codes.dedup();
    codes
}

/// Detect CUDA version from nvcc
fn detect_cuda_version(nvcc_path: &PathBuf) -> Option<String> {
    let output = Command::new(nvcc_path).arg("--version").output().ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse version from output like "release 12.1, V12.1.105"
    for line in stdout.lines() {
        if line.contains("release") {
            if let Some(version_part) = line.split("release").nth(1) {
                let version = version_part.trim().split(',').next()?;
                return Some(version.trim().to_string());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_gpu_codes() {
        let output = "sm_52\nsm_60\nsm_70\nsm_75\nsm_80\nsm_86\nsm_89\nsm_90";
        let codes = parse_gpu_codes(output);
        assert!(codes.contains(&80));
        assert!(codes.contains(&90));
    }
}
