//! Source file selection and filtering

use crate::error::{Error, Result};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Source file selection configuration
#[derive(Debug, Clone)]
pub struct SourceSelector {
    /// Included files/directories
    includes: Vec<SourcePath>,
    /// Exclusion patterns
    excludes: Vec<String>,
    /// Watch paths (trigger rebuild but don't compile)
    watch_paths: Vec<PathBuf>,
}

/// A source path can be a file, directory, or glob pattern
#[derive(Debug, Clone)]
enum SourcePath {
    File(PathBuf),
    Directory(PathBuf),
    Glob(String),
}

impl Default for SourceSelector {
    fn default() -> Self {
        Self {
            includes: Vec::new(),
            excludes: Vec::new(),
            watch_paths: Vec::new(),
        }
    }
}

impl SourceSelector {
    /// Create a new empty source selector
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a directory to search for .cu files (recursive)
    pub fn add_directory<P: AsRef<Path>>(mut self, dir: P) -> Self {
        self.includes
            .push(SourcePath::Directory(dir.as_ref().to_path_buf()));
        self
    }

    /// Add specific files
    pub fn add_files<I, P>(mut self, files: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        for file in files {
            self.includes
                .push(SourcePath::File(file.as_ref().to_path_buf()));
        }
        self
    }

    /// Add files matching a glob pattern
    pub fn add_glob(mut self, pattern: &str) -> Self {
        self.includes.push(SourcePath::Glob(pattern.to_string()));
        self
    }

    /// Exclude files matching patterns
    ///
    /// Patterns can be:
    /// - "*_test.cu" - files ending with _test.cu
    /// - "deprecated/*" - files in deprecated directory
    /// - "test_*.cu" - files starting with test_
    pub fn exclude(mut self, patterns: &[&str]) -> Self {
        for pattern in patterns {
            self.excludes.push(pattern.to_string());
        }
        self
    }

    /// Add paths to watch for changes (headers, etc.)
    pub fn watch<I, P>(mut self, paths: I) -> Self
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        for path in paths {
            self.watch_paths.push(path.as_ref().to_path_buf());
        }
        self
    }

    /// Resolve all sources to a list of kernel files
    pub fn resolve(&self) -> Result<Vec<PathBuf>> {
        let mut files = Vec::new();

        // Use default sources if none specified
        if self.includes.is_empty() {
            // Default: look for src/**/*.cu
            if let Ok(entries) = glob::glob("src/**/*.cu") {
                for entry in entries.flatten() {
                    if !self.is_excluded(&entry) {
                        files.push(entry);
                    }
                }
            }
        } else {
            for source in &self.includes {
                match source {
                    SourcePath::File(path) => {
                        if !path.exists() {
                            return Err(Error::SourcePathNotFound(path.clone()));
                        }
                        if !self.is_excluded(path) {
                            files.push(path.clone());
                        }
                    }
                    SourcePath::Directory(dir) => {
                        if !dir.exists() {
                            return Err(Error::SourcePathNotFound(dir.clone()));
                        }
                        self.collect_from_directory(dir, &mut files)?;
                    }
                    SourcePath::Glob(pattern) => {
                        if let Ok(entries) = glob::glob(pattern) {
                            for entry in entries.flatten() {
                                if entry.extension().map_or(false, |e| e == "cu")
                                    && !self.is_excluded(&entry)
                                {
                                    files.push(entry);
                                }
                            }
                        }
                    }
                }
            }
        }

        files.sort();
        files.dedup();
        Ok(files)
    }

    /// Get watch paths
    pub fn watch_paths(&self) -> &[PathBuf] {
        &self.watch_paths
    }

    /// Collect .cu files from a directory recursively
    fn collect_from_directory(&self, dir: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
        for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |e| e == "cu") {
                if !self.is_excluded(path) {
                    files.push(path.to_path_buf());
                }
            }
        }
        Ok(())
    }

    /// Check if a file should be excluded
    fn is_excluded(&self, path: &Path) -> bool {
        let filename = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let path_str = path.to_string_lossy();

        for pattern in &self.excludes {
            if matches_exclusion_pattern(filename, &path_str, pattern) {
                return true;
            }
        }
        false
    }
}

/// Match a file against an exclusion pattern
fn matches_exclusion_pattern(filename: &str, path_str: &str, pattern: &str) -> bool {
    // Handle directory patterns like "deprecated/*"
    if pattern.contains('/') {
        let pattern_parts: Vec<&str> = pattern.split('/').collect();
        if pattern_parts.len() == 2 && pattern_parts[1] == "*" {
            // Check if path contains the directory
            return path_str.contains(&format!("/{}/", pattern_parts[0]))
                || path_str.contains(&format!("\\{}\\", pattern_parts[0]));
        }
    }

    // Handle file patterns with wildcards
    if pattern.contains('*') {
        let parts: Vec<&str> = pattern.split('*').collect();
        if parts.len() == 2 {
            let (prefix, suffix) = (parts[0], parts[1]);
            return filename.starts_with(prefix) && filename.ends_with(suffix);
        }
        if pattern.starts_with('*') {
            return filename.ends_with(&pattern[1..]);
        }
        if pattern.ends_with('*') {
            return filename.starts_with(&pattern[..pattern.len() - 1]);
        }
    }

    // Exact match
    filename == pattern
}

/// Collect header files (.cuh) from directories
pub fn collect_headers<P: AsRef<Path>>(dirs: &[P]) -> Vec<PathBuf> {
    let mut headers = Vec::new();

    for dir in dirs {
        if let Ok(entries) = glob::glob(&format!("{}/**/*.cuh", dir.as_ref().display())) {
            for entry in entries.flatten() {
                headers.push(entry);
            }
        }
    }

    headers.sort();
    headers.dedup();
    headers
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exclusion_patterns() {
        assert!(matches_exclusion_pattern(
            "test_kernel.cu",
            "src/test_kernel.cu",
            "test_*.cu"
        ));
        assert!(matches_exclusion_pattern(
            "kernel_test.cu",
            "src/kernel_test.cu",
            "*_test.cu"
        ));
        assert!(!matches_exclusion_pattern(
            "kernel.cu",
            "src/kernel.cu",
            "*_test.cu"
        ));
    }
}
