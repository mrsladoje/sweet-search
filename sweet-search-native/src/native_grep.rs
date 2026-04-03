//! In-process regex file matching — replaces ripgrep spawns.
//!
//! Two functions:
//!   - `native_grep_files_with_matches`: file-level (replaces `rg --files-with-matches`)
//!   - `native_grep_lines`: line-level (replaces `rg --json`, returns {file, line} tuples)
//!
//! Eliminates fork/exec/pipe overhead (~3ms per spawn) by running the regex
//! engine directly in the Node.js process. Uses the same `regex` crate as
//! ripgrep, with rayon parallelism across files and mmap for large files.

use memmap2::Mmap;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;
use std::path::PathBuf;

/// Threshold above which we mmap instead of read (avoids allocation for large files).
const MMAP_THRESHOLD: u64 = 64 * 1024;

/// Read file content as a UTF-8 string slice, using mmap for large files.
/// Returns None for binary files (null byte in first 8KB) or non-UTF-8 files.
fn read_file_content(path: &std::path::Path) -> Option<FileContent> {
    let file = std::fs::File::open(path).ok()?;
    let meta = file.metadata().ok()?;
    let len = meta.len();
    if len == 0 {
        return None;
    }

    if len > MMAP_THRESHOLD {
        let mmap = unsafe { Mmap::map(&file) }.ok()?;
        // Binary detection: null byte in first 8KB
        if mmap[..mmap.len().min(8192)].contains(&0) {
            return None;
        }
        // Verify UTF-8
        std::str::from_utf8(&mmap).ok()?;
        Some(FileContent::Mmap(mmap))
    } else {
        let bytes = std::fs::read(path).ok()?;
        if bytes[..bytes.len().min(8192)].contains(&0) {
            return None;
        }
        let text = String::from_utf8(bytes).ok()?;
        Some(FileContent::Owned(text))
    }
}

enum FileContent {
    Mmap(Mmap),
    Owned(String),
}

impl FileContent {
    fn as_str(&self) -> &str {
        match self {
            FileContent::Mmap(m) => unsafe { std::str::from_utf8_unchecked(m) },
            FileContent::Owned(s) => s,
        }
    }
}

fn build_regex(pattern: &str, case_insensitive: bool) -> Result<regex::Regex> {
    regex::RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .multi_line(true) // ^ and $ match line boundaries (same as rg default)
        .unicode(true)
        .build()
        .map_err(|e| Error::from_reason(format!("Invalid regex: {e}")))
}

// =============================================================================
// File-level matching (replaces rg --files-with-matches)
// =============================================================================

#[napi(object)]
pub struct NativeGrepResult {
    /// Relative paths of files that match the regex.
    pub matching_files: Vec<String>,
    /// Number of files scanned.
    pub scanned_files: u32,
    /// Wall-clock time in microseconds.
    pub elapsed_us: u32,
}

/// Scan `files` for regex matches, returning only matching file paths.
///
/// Equivalent to `rg --files-with-matches <pattern> -- <files...>` but runs
/// in-process with rayon parallelism — no fork/exec/pipe overhead.
///
/// Binary files (null byte in first 8KB) are skipped, matching rg behavior.
/// Non-UTF-8 files are skipped. Large files use mmap to avoid allocation.
#[napi]
pub fn native_grep_files_with_matches(
    pattern: String,
    project_root: String,
    files: Vec<String>,
    case_insensitive: Option<bool>,
) -> Result<NativeGrepResult> {
    let start = std::time::Instant::now();
    let re = build_regex(&pattern, case_insensitive.unwrap_or(false))?;
    let root = PathBuf::from(&project_root);
    let scanned = files.len() as u32;

    let matching: Vec<String> = files
        .par_iter()
        .filter(|file| {
            let path = root.join(file);
            match read_file_content(&path) {
                Some(content) => re.is_match(content.as_str()),
                None => false,
            }
        })
        .cloned()
        .collect();

    Ok(NativeGrepResult {
        matching_files: matching,
        scanned_files: scanned,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

// =============================================================================
// Line-level matching (replaces rg --json for narrowed queries)
// =============================================================================

#[napi(object)]
pub struct NativeGrepMatch {
    /// Relative file path.
    pub file: String,
    /// 1-indexed line number.
    pub line: u32,
}

#[napi(object)]
pub struct NativeGrepLinesResult {
    /// All matches: {file, line} tuples.
    pub matches: Vec<NativeGrepMatch>,
    /// Number of files scanned.
    pub scanned_files: u32,
    /// Wall-clock time in microseconds.
    pub elapsed_us: u32,
}

/// Scan `files` for regex matches, returning {file, line} for every match.
///
/// Equivalent to `rg --json <pattern> -- <files...>` but runs in-process
/// with rayon + mmap — no fork/exec/pipe/JSON-parse overhead.
///
/// Returns 1-indexed line numbers matching rg convention.
#[napi]
pub fn native_grep_lines(
    pattern: String,
    project_root: String,
    files: Vec<String>,
    case_insensitive: Option<bool>,
) -> Result<NativeGrepLinesResult> {
    let start = std::time::Instant::now();
    let re = build_regex(&pattern, case_insensitive.unwrap_or(false))?;
    let root = PathBuf::from(&project_root);
    let scanned = files.len() as u32;

    // Parallel scan: each file produces a Vec<NativeGrepMatch>, collected flat.
    // Matches LINE BY LINE (same as rg default) — each line is tested
    // independently so \s+ cannot match \n across line boundaries.
    let matches: Vec<NativeGrepMatch> = files
        .par_iter()
        .flat_map(|file| {
            let path = root.join(file);
            let content = match read_file_content(&path) {
                Some(c) => c,
                None => return Vec::new(),
            };
            let text = content.as_str();

            let mut results = Vec::new();
            for (line_idx, line) in text.lines().enumerate() {
                if re.is_match(line) {
                    results.push(NativeGrepMatch {
                        file: file.clone(),
                        line: (line_idx + 1) as u32, // 1-indexed like rg
                    });
                }
            }
            results
        })
        .collect();

    Ok(NativeGrepLinesResult {
        matches,
        scanned_files: scanned,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}
