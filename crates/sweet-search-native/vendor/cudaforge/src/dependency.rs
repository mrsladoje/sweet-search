//! External dependency management (CUTLASS, custom git repos)

use crate::error::{Error, Result};
use fs2::FileExt;
use std::fs::File;
use std::path::PathBuf;
use std::process::Command;

/// Well-known CUTLASS repository configuration
const CUTLASS_REPO: &str = "https://github.com/NVIDIA/cutlass.git";
const CUTLASS_DEFAULT_COMMIT: &str = "7127592069c2fe01b041e174ba4345ef9b279671";
const CUTLASS_INCLUDE_PATHS: &[&str] = &["include", "tools/util/include"];

/// External dependency configuration
#[derive(Debug, Clone)]
pub struct ExternalDependency {
    /// Name of the dependency
    pub name: String,
    /// Git repository URL
    pub repo_url: String,
    /// Commit hash to checkout
    pub commit: String,
    /// Include paths within the repo (relative to repo root)
    pub include_paths: Vec<String>,
    /// Additional sparse-checkout paths to fetch alongside includes.
    pub extra_paths: Vec<String>,
    /// Whether to allow git submodule recursion (false adds --no-recurse-submodules)
    pub recurse_submodules: bool,
}

impl ExternalDependency {
    /// Create a CUTLASS dependency with default or custom commit
    pub fn cutlass(commit: Option<&str>) -> Self {
        Self {
            name: "cutlass".to_string(),
            repo_url: CUTLASS_REPO.to_string(),
            commit: commit.unwrap_or(CUTLASS_DEFAULT_COMMIT).to_string(),
            include_paths: CUTLASS_INCLUDE_PATHS
                .iter()
                .map(|s| s.to_string())
                .collect(),
            extra_paths: Vec::new(),
            recurse_submodules: true,
        }
    }

    /// Create a custom git dependency
    /// If `recurse_submodules` is false, clone/fetch adds --no-recurse-submodules.
    pub fn git(
        name: &str,
        repo_url: &str,
        commit: &str,
        include_paths: Vec<&str>,
        extra_paths: Vec<&str>,
        recurse_submodules: bool,
    ) -> Self {
        Self {
            name: name.to_string(),
            repo_url: repo_url.to_string(),
            commit: commit.to_string(),
            include_paths: include_paths.iter().map(|s| s.to_string()).collect(),
            extra_paths: extra_paths.iter().map(|s| s.to_string()).collect(),
            recurse_submodules,
        }
    }

    fn sparse_paths(&self) -> Vec<&str> {
        let mut paths = Vec::with_capacity(self.include_paths.len() + self.extra_paths.len());
        for path in &self.include_paths {
            paths.push(path.as_str());
        }
        for path in &self.extra_paths {
            if !self.include_paths.iter().any(|p| p == path) {
                paths.push(path.as_str());
            }
        }
        paths
    }

    /// Fetch the dependency to a global cache directory
    ///
    /// Uses sparse checkout to only fetch include directories.
    /// Caches dependencies at `~/.cudaforge/git/checkouts/{name}-{commit_prefix}/`
    /// to avoid re-cloning on subsequent builds.
    ///
    /// Uses file locking to prevent concurrent builds from conflicting.
    pub fn fetch(&self, out_dir: &PathBuf) -> Result<PathBuf> {
        // Use global cache directory, with out_dir as fallback
        let cache_dir = cudaforge_git_cache_dir(out_dir)?;

        // Generate cache key: {name}-{commit_prefix}
        let commit_prefix = &self.commit[..16.min(self.commit.len())];
        let cache_key = format!("{}-{}", self.name, commit_prefix);
        let dep_dir = cache_dir.join(&cache_key);

        // Create a lock file for this specific dependency
        let lock_path = cache_dir.join(format!("{}.lock", cache_key));
        let lock_file = File::create(&lock_path)
            .map_err(|e| Error::GitOperationFailed(format!("Failed to create lock file: {}", e)))?;

        // Acquire exclusive lock - this will block if another process holds the lock
        lock_file
            .lock_exclusive()
            .map_err(|e| Error::GitOperationFailed(format!("Failed to acquire lock: {}", e)))?;

        // Now we have exclusive access - check if already at correct commit
        let result = self.fetch_with_lock(&dep_dir);

        // Release lock (automatically happens when lock_file is dropped, but be explicit)
        let _ = lock_file.unlock();

        result
    }

    /// Internal fetch logic, called while holding the lock
    fn fetch_with_lock(&self, dep_dir: &PathBuf) -> Result<PathBuf> {
        // Check if already at correct commit
        if dep_dir.join("include").exists() {
            if let Ok(current_commit) = self.get_current_commit(dep_dir) {
                if current_commit == self.commit {
                    println!(
                        "cargo:warning=Using cached {} at {}",
                        self.name,
                        dep_dir.display()
                    );
                    return Ok(dep_dir.clone());
                }
            }
        }

        // Clone if not exists
        if !dep_dir.exists() {
            self.clone_repo(dep_dir)?;
        }

        // Setup sparse checkout
        self.setup_sparse_checkout(dep_dir)?;

        // Fetch and checkout specific commit
        self.checkout_commit(dep_dir)?;

        println!(
            "cargo:warning=Cached {} at {}",
            self.name,
            dep_dir.display()
        );

        Ok(dep_dir.clone())
    }

    /// Get include path arguments for nvcc
    pub fn include_args(&self, base_dir: &PathBuf) -> Vec<String> {
        let mut args = Vec::new();

        // Add root directory
        args.push(format!("-I{}", base_dir.display()));

        // Add all include paths
        for include_path in &self.include_paths {
            let full_path = base_dir.join(include_path);
            if full_path.exists() {
                args.push(format!("-I{}", full_path.display()));
            }
        }

        args
    }

    fn get_current_commit(&self, dir: &PathBuf) -> Result<String> {
        let output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(dir)
            .output()
            .map_err(|e| Error::GitOperationFailed(format!("git rev-parse failed: {}", e)))?;

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn clone_repo(&self, target_dir: &PathBuf) -> Result<()> {
        println!("cargo:warning=Cloning {} from {}", self.name, self.repo_url);

        let target_dir_str = target_dir
            .to_str()
            .ok_or_else(|| Error::GitOperationFailed("Invalid path encoding".to_string()))?;

        let mut cmd = Command::new("git");
        cmd.args(["clone", "--depth", "1", "--filter=blob:none", "--sparse"]);
        if !self.recurse_submodules {
            cmd.arg("--no-recurse-submodules");
        }
        let status = cmd
            .arg(&self.repo_url)
            .arg(target_dir_str)
            .status()
            .map_err(|e| Error::GitOperationFailed(format!("git clone failed: {}", e)))?;

        if !status.success() {
            return Err(Error::GitOperationFailed(format!(
                "git clone failed with status: {}",
                status
            )));
        }

        Ok(())
    }

    fn setup_sparse_checkout(&self, dir: &PathBuf) -> Result<()> {
        // Set sparse checkout paths
        let mut args = vec!["sparse-checkout", "set"];
        for path in self.sparse_paths() {
            args.push(path);
        }

        let status = Command::new("git")
            .args(&args)
            .current_dir(dir)
            .status()
            .map_err(|e| Error::GitOperationFailed(format!("git sparse-checkout failed: {}", e)))?;

        if !status.success() {
            return Err(Error::GitOperationFailed(format!(
                "git sparse-checkout failed with status: {}",
                status
            )));
        }

        Ok(())
    }

    fn checkout_commit(&self, dir: &PathBuf) -> Result<()> {
        // Clean up any stale git lock files that may have been left by interrupted operations
        self.cleanup_git_locks(dir);

        println!(
            "cargo:warning=Fetching {} commit {}",
            self.name, self.commit
        );

        // Fetch the specific commit
        let mut cmd = Command::new("git");
        cmd.arg("fetch");
        if !self.recurse_submodules {
            cmd.arg("--no-recurse-submodules");
        }
        let status = cmd
            .args(["origin", &self.commit])
            .current_dir(dir)
            .status()
            .map_err(|e| Error::GitOperationFailed(format!("git fetch failed: {}", e)))?;

        if !status.success() {
            return Err(Error::GitOperationFailed(format!(
                "git fetch failed with status: {}",
                status
            )));
        }

        // Checkout the commit
        let status = Command::new("git")
            .args(["checkout", &self.commit])
            .current_dir(dir)
            .status()
            .map_err(|e| Error::GitOperationFailed(format!("git checkout failed: {}", e)))?;

        if !status.success() {
            return Err(Error::GitOperationFailed(format!(
                "git checkout failed with status: {}",
                status
            )));
        }

        Ok(())
    }

    /// Clean up stale git lock files that may cause "index.lock exists" errors
    ///
    /// This can happen when:
    /// - A previous git operation was interrupted
    /// - Multiple parallel builds try to access the same cached repo
    fn cleanup_git_locks(&self, dir: &PathBuf) {
        let git_dir = dir.join(".git");
        let lock_files = [
            git_dir.join("index.lock"),
            git_dir.join("HEAD.lock"),
            git_dir.join("config.lock"),
        ];

        for lock_file in &lock_files {
            if lock_file.exists() {
                // Check if lock file is stale (older than 10 minutes)
                if let Ok(metadata) = lock_file.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        if let Ok(elapsed) = modified.elapsed() {
                            // If lock file is older than 10 minutes, it's likely stale
                            if elapsed.as_secs() > 600 {
                                println!(
                                    "cargo:warning=Removing stale git lock file: {}",
                                    lock_file.display()
                                );
                                let _ = std::fs::remove_file(lock_file);
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Dependency manager for handling multiple external dependencies
#[derive(Debug, Clone, Default)]
pub struct DependencyManager {
    dependencies: Vec<ExternalDependency>,
    local_includes: Vec<PathBuf>,
}

impl DependencyManager {
    /// Create a new dependency manager
    pub fn new() -> Self {
        Self::default()
    }

    /// Add CUTLASS dependency
    pub fn with_cutlass(mut self, commit: Option<&str>) -> Self {
        self.dependencies.push(ExternalDependency::cutlass(commit));
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
        self.dependencies.push(ExternalDependency::git(
            name,
            repo,
            commit,
            include_paths,
            extra_paths,
            recurse_submodules,
        ));
        self
    }

    /// Add a local include path
    pub fn with_local_include<P: Into<PathBuf>>(mut self, path: P) -> Self {
        self.local_includes.push(path.into());
        self
    }

    /// Fetch all dependencies and return include arguments
    pub fn fetch_all(&self, out_dir: &PathBuf) -> Result<Vec<String>> {
        let mut include_args = Vec::new();

        // Add local includes first
        for local in &self.local_includes {
            if local.exists() {
                include_args.push(format!("-I{}", local.display()));
            }
        }

        // Fetch and add external dependencies
        for dep in &self.dependencies {
            let dep_dir = dep.fetch(out_dir)?;
            include_args.extend(dep.include_args(&dep_dir));
        }

        Ok(include_args)
    }

    /// Fetch a specific dependency and return its checkout root.
    pub fn fetch_dependency(&self, name: &str, out_dir: &PathBuf) -> Result<PathBuf> {
        let dep = self
            .dependencies
            .iter()
            .find(|d| d.name == name)
            .ok_or_else(|| Error::GitOperationFailed(format!("Unknown dependency: {name}")))?;
        dep.fetch(out_dir)
    }

    /// Check if CUTLASS is enabled
    pub fn has_cutlass(&self) -> bool {
        self.dependencies.iter().any(|d| d.name == "cutlass")
    }
}

/// Try to resolve CUTLASS from cargo checkouts directory
pub fn resolve_cutlass_from_cargo_checkouts() -> Option<PathBuf> {
    let checkouts_dir = cargo_git_checkouts_dir().ok()?;

    // Look for candle-flash-attn or cutlass checkouts
    let search_patterns = ["candle-flash-attn-*", "cutlass-*"];

    for pattern in search_patterns {
        let full_pattern = format!("{}/{}", checkouts_dir.display(), pattern);
        if let Ok(entries) = glob::glob(&full_pattern) {
            for entry in entries.flatten() {
                // Check subdirectories for cutlass
                for subdir in ["cutlass", ""] {
                    let cutlass_path = if subdir.is_empty() {
                        entry.clone()
                    } else {
                        entry.join(subdir)
                    };

                    if cutlass_path.join("include").exists() {
                        return Some(cutlass_path);
                    }

                    // Check hash subdirectories
                    if let Ok(subdirs) = std::fs::read_dir(&entry) {
                        for subentry in subdirs.flatten() {
                            let check_path = if subdir.is_empty() {
                                subentry.path()
                            } else {
                                subentry.path().join(subdir)
                            };

                            if check_path.join("include").exists() {
                                return Some(check_path);
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

/// Get the global cache directory for cudaforge git checkouts
///
/// Priority:
/// 1. `$CUDAFORGE_HOME/git/checkouts/` if CUDAFORGE_HOME is set
/// 2. `~/.cudaforge/git/checkouts/` if HOME is set
/// 3. `~/.cargo/git/checkouts/` as fallback (reuses Cargo's cache)
///
/// Creates the directory if it doesn't exist.
fn cudaforge_git_cache_dir(fallback_dir: &PathBuf) -> Result<PathBuf> {
    let cache_dir = if let Ok(cudaforge_home) = std::env::var("CUDAFORGE_HOME") {
        PathBuf::from(cudaforge_home).join("git").join("checkouts")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home)
            .join(".cudaforge")
            .join("git")
            .join("checkouts")
    } else if let Ok(cargo_home) = std::env::var("CARGO_HOME") {
        // Fallback to Cargo's cache directory
        PathBuf::from(cargo_home).join("git").join("checkouts")
    } else {
        // Last resort: use the provided output directory
        fallback_dir.join("git_cache")
    };

    // Ensure the cache directory exists
    std::fs::create_dir_all(&cache_dir).map_err(|e| {
        Error::GitOperationFailed(format!(
            "Failed to create cache dir {}: {}",
            cache_dir.display(),
            e
        ))
    })?;

    Ok(cache_dir)
}

fn cargo_git_checkouts_dir() -> Result<PathBuf> {
    if let Ok(cargo_home) = std::env::var("CARGO_HOME") {
        return Ok(PathBuf::from(cargo_home).join("git").join("checkouts"));
    }

    if let Ok(home) = std::env::var("HOME") {
        return Ok(PathBuf::from(home)
            .join(".cargo")
            .join("git")
            .join("checkouts"));
    }

    Err(Error::InvalidConfig(
        "Neither CARGO_HOME nor HOME is set".to_string(),
    ))
}
