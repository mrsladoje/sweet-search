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
/// rg disables mmap on macOS, but our benchmarks show mmap is faster with warm page
/// cache (avoids read() copy-to-heap for large files). Keep mmap enabled.
const MMAP_THRESHOLD: u64 = 64 * 1024;

/// Read file content as a byte slice. Uses read() on macOS (mmap has TLB issues),
/// mmap for large files on other platforms.
/// Returns None for binary files (null byte in first 8KB).
pub(crate) fn read_file_content(path: &std::path::Path) -> Option<FileContent> {
    let file = std::fs::File::open(path).ok()?;
    let meta = file.metadata().ok()?;
    let len = meta.len();
    if len == 0 {
        return None;
    }

    if len > MMAP_THRESHOLD {
        let mmap = unsafe { Mmap::map(&file) }.ok()?;
        if memchr::memchr(0, &mmap[..mmap.len().min(8192)]).is_some() {
            return None;
        }
        Some(FileContent::Mmap(mmap))
    } else {
        let bytes = std::fs::read(path).ok()?;
        if memchr::memchr(0, &bytes[..bytes.len().min(8192)]).is_some() {
            return None;
        }
        Some(FileContent::Owned(bytes))
    }
}

pub(crate) enum FileContent {
    Mmap(Mmap),
    Owned(Vec<u8>),
}

impl FileContent {
    pub(crate) fn as_bytes(&self) -> &[u8] {
        match self {
            FileContent::Mmap(m) => m,
            FileContent::Owned(b) => b,
        }
    }
}

/// Build a bytes-mode regex (operates on &[u8], no UTF-8 boundary checks).
/// Bumped DFA size limits to match ripgrep's configuration — larger lazy DFA
/// cache keeps states warm across files on each rayon thread.
pub(crate) fn build_regex(pattern: &str, case_insensitive: bool) -> Result<regex::bytes::Regex> {
    regex::bytes::RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .multi_line(true) // ^ and $ match line boundaries (same as rg default)
        .unicode(true)
        .size_limit(100 * (1 << 20))    // 100 MiB NFA compile limit (rg default)
        .dfa_size_limit(1 * (1 << 20))  // 1 MiB full DFA state limit (rg default)
        .build()
        .map_err(|e| Error::from_reason(format!("Invalid regex: {e}")))
}

/// Iterate lines using memchr (SIMD-accelerated newline finding).
/// Yields (line_number_0indexed, line_bytes) without UTF-8 validation.
#[inline]
pub(crate) fn for_each_line<F: FnMut(usize, &[u8])>(bytes: &[u8], mut f: F) {
    let mut line_idx = 0usize;
    let mut start = 0usize;
    while let Some(pos) = memchr::memchr(b'\n', &bytes[start..]) {
        let end = start + pos;
        f(line_idx, &bytes[start..end]);
        line_idx += 1;
        start = end + 1;
    }
    // Last line (no trailing newline)
    if start < bytes.len() {
        f(line_idx, &bytes[start..]);
    }
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
/// Large files use mmap to avoid allocation.
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
                Some(content) => re.is_match(content.as_bytes()),
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

/// In-process fixed-string literal prefilter with AND semantics.
///
/// Returns files that contain ALL given literals (AND). Replaces the sequential
/// `rg -F --files-with-matches` spawns in the literal prefilter path.
///
/// Uses `str::contains()` (case-sensitive) or lowercased search
/// (case-insensitive) — no regex compilation overhead.
#[napi]
pub fn native_grep_files_with_matches_fixed(
    literals: Vec<String>,
    project_root: String,
    files: Vec<String>,
    case_insensitive: Option<bool>,
) -> Result<NativeGrepResult> {
    let start = std::time::Instant::now();
    let ci = case_insensitive.unwrap_or(false);
    let root = PathBuf::from(&project_root);
    let scanned = files.len() as u32;

    // Pre-lowercase literals for case-insensitive matching (done once, not per file).
    let lowered: Vec<String> = if ci {
        literals.iter().map(|l| l.to_lowercase()).collect()
    } else {
        Vec::new()
    };

    // Pre-build memchr finders for case-sensitive path (SIMD-accelerated).
    let finders: Vec<memchr::memmem::Finder<'_>> = if !ci {
        literals.iter().map(|l| memchr::memmem::Finder::new(l.as_bytes())).collect()
    } else {
        Vec::new()
    };

    let matching: Vec<String> = files
        .par_iter()
        .filter(|file| {
            let path = root.join(file);
            let content = match read_file_content(&path) {
                Some(c) => c,
                None => return false,
            };
            let bytes = content.as_bytes();
            if ci {
                // Case-insensitive: must convert to string for lowercase comparison.
                let text = std::str::from_utf8(bytes).unwrap_or("");
                let lower = text.to_lowercase();
                lowered.iter().all(|lit| lower.contains(lit.as_str()))
            } else {
                // Case-sensitive: SIMD-accelerated byte search (memchr::memmem).
                finders.iter().all(|f| f.find(bytes).is_some())
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
// =============================================================================
// Chunk-range verification (verifies regex only within chunk line ranges)
// =============================================================================

#[napi(object)]
pub struct ChunkRangeInput {
    /// Relative file path.
    pub file: String,
    /// 1-indexed start line.
    pub start_line: u32,
    /// 1-indexed end line (inclusive).
    pub end_line: u32,
    /// Opaque chunk ID passed through for mapping.
    pub chunk_id: u32,
}

#[napi(object)]
pub struct VerifiedChunk {
    /// Relative file path.
    pub file: String,
    /// 1-indexed start line.
    pub start_line: u32,
    /// 1-indexed end line (inclusive).
    pub end_line: u32,
    /// Opaque chunk ID (passed through from input).
    pub chunk_id: u32,
    /// Number of matching lines within this chunk's range.
    pub match_count: u32,
}

#[napi(object)]
pub struct ChunkRangeVerifyResult {
    /// Chunks that have at least one regex match.
    pub verified: Vec<VerifiedChunk>,
    /// Number of unique files read.
    pub files_read: u32,
    /// Total chunks checked.
    pub chunks_checked: u32,
    /// Wall-clock time in microseconds.
    pub elapsed_us: u32,
}

/// Verify regex matches within specific chunk line ranges.
///
/// Groups chunks by file, reads each file once (mmap for large files),
/// then scans only the specified line ranges. Returns only chunks that
/// have at least one regex match, with per-chunk match counts.
///
/// Line matching is LINE BY LINE (same as `native_grep_lines` and rg
/// default) — each line is tested independently.
#[napi]
pub fn native_grep_chunk_ranges(
    pattern: String,
    project_root: String,
    chunks: Vec<ChunkRangeInput>,
    case_insensitive: Option<bool>,
) -> Result<ChunkRangeVerifyResult> {
    let start = std::time::Instant::now();
    let re = build_regex(&pattern, case_insensitive.unwrap_or(false))?;
    let root = PathBuf::from(&project_root);
    let total_chunks = chunks.len() as u32;

    // Group chunks by file path for single-read-per-file.
    let mut file_chunks: std::collections::HashMap<&str, Vec<&ChunkRangeInput>> =
        std::collections::HashMap::new();
    for chunk in &chunks {
        file_chunks.entry(&chunk.file).or_default().push(chunk);
    }

    // Collect into a Vec for rayon parallel iteration.
    let file_groups: Vec<(&str, Vec<&ChunkRangeInput>)> =
        file_chunks.into_iter().collect();
    let files_read = file_groups.len() as u32;

    let verified: Vec<VerifiedChunk> = file_groups
        .par_iter()
        .flat_map(|(file, file_chunk_list)| {
            let path = root.join(file);
            let content = match read_file_content(&path) {
                Some(c) => c,
                None => return Vec::new(),
            };
            let bytes = content.as_bytes();
            // Build line offset table using memchr (SIMD newline finding).
            let mut line_starts: Vec<usize> = vec![0];
            let mut pos = 0;
            while let Some(nl) = memchr::memchr(b'\n', &bytes[pos..]) {
                let abs = pos + nl + 1;
                if abs < bytes.len() {
                    line_starts.push(abs);
                }
                pos = abs;
            }
            let total_lines = line_starts.len();

            let mut results = Vec::new();
            for chunk in file_chunk_list {
                let start_idx = (chunk.start_line.saturating_sub(1)) as usize;
                let end_idx = (chunk.end_line as usize).min(total_lines);
                if start_idx >= total_lines || start_idx >= end_idx {
                    continue;
                }

                let mut match_count = 0u32;
                for li in start_idx..end_idx {
                    let ls = line_starts[li];
                    let le = if li + 1 < line_starts.len() {
                        // Trim trailing \n
                        line_starts[li + 1].saturating_sub(1)
                    } else {
                        bytes.len()
                    };
                    if ls < le && re.is_match(&bytes[ls..le]) {
                        match_count += 1;
                    }
                }

                if match_count > 0 {
                    results.push(VerifiedChunk {
                        file: file.to_string(),
                        start_line: chunk.start_line,
                        end_line: chunk.end_line,
                        chunk_id: chunk.chunk_id,
                        match_count,
                    });
                }
            }
            results
        })
        .collect();

    Ok(ChunkRangeVerifyResult {
        verified,
        files_read,
        chunks_checked: total_chunks,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

// =============================================================================
// Line-level matching (replaces rg --json for narrowed queries)
// =============================================================================

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
            let bytes = content.as_bytes();
            // Whole-file precheck: one SIMD-accelerated regex scan on the
            // entire buffer. Non-matching files (the majority) bail out here
            // instead of iterating hundreds of lines with per-line regex calls.
            if !re.is_match(bytes) {
                return Vec::new();
            }
            let mut results = Vec::new();
            for_each_line(bytes, |line_idx, line| {
                if re.is_match(line) {
                    results.push(NativeGrepMatch {
                        file: file.clone(),
                        line: (line_idx + 1) as u32,
                    });
                }
            });
            results
        })
        .collect();

    Ok(NativeGrepLinesResult {
        matches,
        scanned_files: scanned,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

// =============================================================================
// Full line-level matching (replaces rg --json for bareGrep queries)
// =============================================================================

/// Full match result with column, matched text, and line content.
/// Matches the fields produced by rg --json parsing in search-pattern-ripgrep.js.
#[napi(object)]
pub struct NativeGrepFullMatch {
    /// Relative file path.
    pub file: String,
    /// 1-indexed line number.
    pub line: u32,
    /// 1-indexed byte offset of the first match on this line (matches rg submatches[0].start + 1).
    pub column: u32,
    /// Text of the first regex match on this line (matches rg submatches[0].match.text).
    pub match_text: String,
    /// Full line content, trailing whitespace trimmed (matches rg data.lines.text.trimEnd()).
    pub content: String,
}

#[napi(object)]
pub struct NativeGrepFullResult {
    /// All matches with full field data.
    pub matches: Vec<NativeGrepFullMatch>,
    /// Number of files scanned.
    pub scanned_files: u32,
    /// Wall-clock time in microseconds.
    pub elapsed_us: u32,
}

/// Line-level matching with full match fields: file, line, column, matchText, content.
///
/// Same as `native_grep_lines` but uses `re.find()` to capture match offsets and text.
/// Designed for `bareGrep` callers that need display-quality output fields.
/// Returns 1-indexed line numbers and byte-offset columns matching rg conventions.
#[napi]
pub fn native_grep_full(
    pattern: String,
    project_root: String,
    files: Vec<String>,
    case_insensitive: Option<bool>,
) -> Result<NativeGrepFullResult> {
    let start = std::time::Instant::now();
    let re = build_regex(&pattern, case_insensitive.unwrap_or(false))?;
    let root = PathBuf::from(&project_root);
    let scanned = files.len() as u32;

    let matches: Vec<NativeGrepFullMatch> = files
        .par_iter()
        .flat_map(|file| {
            let path = root.join(file);
            let content = match read_file_content(&path) {
                Some(c) => c,
                None => return Vec::new(),
            };
            let bytes = content.as_bytes();
            if !re.is_match(bytes) {
                return Vec::new();
            }
            let mut results = Vec::new();
            for_each_line(bytes, |line_idx, line| {
                if let Some(m) = re.find(line) {
                    let match_bytes = &line[m.start()..m.end()];
                    let match_text = String::from_utf8_lossy(match_bytes).into_owned();
                    // Trim trailing whitespace from line content.
                    let trimmed = match line.iter().rposition(|&b| b != b' ' && b != b'\t' && b != b'\r') {
                        Some(pos) => &line[..=pos],
                        None => line,
                    };
                    let content_str = String::from_utf8_lossy(trimmed).into_owned();
                    results.push(NativeGrepFullMatch {
                        file: file.clone(),
                        line: (line_idx + 1) as u32,
                        column: (m.start() + 1) as u32,
                        match_text,
                        content: content_str,
                    });
                }
            });
            results
        })
        .collect();

    Ok(NativeGrepFullResult {
        matches,
        scanned_files: scanned,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

