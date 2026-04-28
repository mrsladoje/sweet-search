//! In-process regex file matching — replaces ripgrep spawns.
//!
//! Functions:
//!   - `native_grep_files_with_matches`: file-level (replaces `rg --files-with-matches`)
//!   - `native_grep_files_with_matches_fixed`: file-level fixed-string AND
//!   - `native_grep_chunk_ranges`: chunk-range verification
//!   - `native_grep_lines`: line-level lean (replaces `rg --json`, returns {file, line})
//!   - `native_grep_full`: line-level full (returns {file, line, column, matchText, content})
//!
//! Eliminates fork/exec/pipe overhead (~3ms per spawn) by running the regex
//! engine directly in the Node.js process. Uses the same `regex` crate as
//! ripgrep, with rayon parallelism across files.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;
use rayon::ThreadPool;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Maximum regex pattern length to prevent DoS via pathological compilation.
/// Generous limit (8 KiB) — real-world patterns rarely exceed a few hundred
/// bytes, but generated patterns (e.g., alternations of many literals) can
/// be larger. regex_literals.rs caps at 4096; this is doubled for build_regex
/// since compiled patterns can legitimately be longer.
const MAX_PATTERN_LENGTH: usize = 8192;

/// mmap is disabled for grep on all platforms. read() is safer — no SIGBUS
/// when files are truncated by concurrent editors. macOS was already disabled
/// (ripgrep does the same); this extends the safety to Linux.
///
/// **Intent**: Index files (sparse_gram.rs, chunk_gram.rs) intentionally use
/// their own mmap for read-only artifacts — those are written atomically and
/// never edited in-place, so SIGBUS is not a concern there. This constant
/// applies only to user-edited source files read during grep.
const MMAP_THRESHOLD: u64 = u64::MAX;

/// Dedicated thread pool for grep operations. Isolates grep parallelism from
/// other rayon consumers (MaxSim scoring, index building) to prevent contention
/// when multiple concurrent queries are in flight.
static GREP_POOL: OnceLock<ThreadPool> = OnceLock::new();

fn grep_pool() -> &'static ThreadPool {
    GREP_POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(0) // default: number of logical CPUs
            .thread_name(|i| format!("sweet-grep-{i}"))
            .build()
            .expect("Failed to create grep thread pool")
    })
}

/// Validate and canonicalize a file path, ensuring it stays within the project root.
/// Returns None if the path escapes the root (path traversal) or doesn't exist.
pub(crate) fn validate_path(root: &std::path::Path, file: &str) -> Option<PathBuf> {
    let path = root.join(file);
    let canonical = path.canonicalize().ok()?;
    let canonical_root = root.canonicalize().ok()?;
    if !canonical.starts_with(&canonical_root) {
        return None;
    }
    Some(canonical)
}

/// Read file content as a byte slice.
/// Returns None for binary files (null byte in first 8KB) or empty files.
pub(crate) fn read_file_content(path: &std::path::Path) -> Option<FileContent> {
    let meta = std::fs::metadata(path).ok()?;
    let len = meta.len();
    if len == 0 {
        return None;
    }

    if len > MMAP_THRESHOLD {
        // Dead path — MMAP_THRESHOLD is u64::MAX so this never executes.
        // Kept for index modules that import read_file_content with their
        // own threshold logic.
        let file = std::fs::File::open(path).ok()?;
        let mmap = unsafe { memmap2::Mmap::map(&file) }.ok()?;
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
    Mmap(memmap2::Mmap),
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
/// Rejects patterns exceeding MAX_PATTERN_LENGTH to prevent DoS via
/// pathological regex compilation that could block the event loop.
/// Bumped DFA size limits to match ripgrep's configuration — larger lazy DFA
/// cache keeps states warm across files on each rayon thread.
pub(crate) fn build_regex(pattern: &str, case_insensitive: bool) -> Result<regex::bytes::Regex> {
    if pattern.len() > MAX_PATTERN_LENGTH {
        return Err(Error::from_reason(format!(
            "Regex pattern too long ({} bytes, max {MAX_PATTERN_LENGTH})",
            pattern.len()
        )));
    }
    regex::bytes::RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .multi_line(true) // ^ and $ match line boundaries (same as rg default)
        .unicode(true)
        .size_limit(100 * (1 << 20)) // 100 MiB NFA compile limit (rg default)
        .dfa_size_limit(1 * (1 << 20)) // 1 MiB full DFA state limit (rg default)
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

/// Read and validate a file for grep. Returns the file content bytes if:
/// - The path stays within the project root (no path traversal)
/// - The file is readable and non-binary
#[inline]
fn read_validated_file(root: &std::path::Path, file: &str) -> Option<FileContent> {
    let path = validate_path(root, file)?;
    read_file_content(&path)
}

// =============================================================================
// Common grep loop — extracts the shared file-read + precheck + line-iterate
// pattern used by both native_grep_lines and native_grep_full.
// =============================================================================

/// Scan files for regex line matches. For each file: validate path, read
/// content, whole-file precheck, then call `on_match` for each matching line.
/// Collects results from all files in parallel via the dedicated grep pool.
fn grep_lines_common<T, F>(
    re: &regex::bytes::Regex,
    root: &std::path::Path,
    files: &[String],
    on_match: F,
) -> Vec<T>
where
    T: Send,
    F: Fn(&str, usize, &[u8], &regex::bytes::Regex) -> Option<T> + Sync,
{
    grep_pool().install(|| {
        files
            .par_iter()
            .flat_map(|file| {
                let content = match read_validated_file(root, file) {
                    Some(c) => c,
                    None => return Vec::new(),
                };
                let bytes = content.as_bytes();
                // Whole-file precheck: one SIMD-accelerated regex scan on the
                // entire buffer. Non-matching files (the majority) bail out
                // instead of iterating hundreds of lines with per-line regex.
                if !re.is_match(bytes) {
                    return Vec::new();
                }
                let mut results = Vec::new();
                for_each_line(bytes, |line_idx, line| {
                    if let Some(item) = on_match(file, line_idx, line, re) {
                        results.push(item);
                    }
                });
                results
            })
            .collect()
    })
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

    let matching: Vec<String> = grep_pool().install(|| {
        files
            .par_iter()
            .filter(|file| match read_validated_file(&root, file) {
                Some(content) => re.is_match(content.as_bytes()),
                None => false,
            })
            .cloned()
            .collect()
    });

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
/// Case-sensitive path uses SIMD-accelerated memchr::memmem.
/// Case-insensitive path uses byte-level ASCII case folding with a thread-local
/// scratch buffer — avoids per-file String::to_lowercase() allocation. Matches
/// ripgrep's ASCII case folding behavior.
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

    // Pre-lowercase literals as bytes for case-insensitive matching (done once).
    let lowered: Vec<Vec<u8>> = if ci {
        literals
            .iter()
            .map(|l| {
                l.as_bytes()
                    .iter()
                    .map(|b| b.to_ascii_lowercase())
                    .collect()
            })
            .collect()
    } else {
        Vec::new()
    };

    // Pre-build memchr finders for case-sensitive path (SIMD-accelerated).
    let finders: Vec<memchr::memmem::Finder<'_>> = if !ci {
        literals
            .iter()
            .map(|l| memchr::memmem::Finder::new(l.as_bytes()))
            .collect()
    } else {
        Vec::new()
    };

    let matching: Vec<String> = grep_pool().install(|| {
        files
            .par_iter()
            .filter(|file| {
                let content = match read_validated_file(&root, file) {
                    Some(c) => c,
                    None => return false,
                };
                let bytes = content.as_bytes();
                if ci {
                    // Case-insensitive: ASCII-lowercase bytes in a thread-local
                    // reusable buffer — avoids String allocation per file.
                    thread_local! {
                        static LOWER_BUF: std::cell::RefCell<Vec<u8>> = std::cell::RefCell::new(Vec::new());
                    }
                    LOWER_BUF.with(|buf| {
                        let mut buf = buf.borrow_mut();
                        buf.clear();
                        buf.reserve(bytes.len());
                        buf.extend(bytes.iter().map(|b| b.to_ascii_lowercase()));
                        lowered.iter().all(|lit| memchr::memmem::find(&buf, lit).is_some())
                    })
                } else {
                    // Case-sensitive: SIMD-accelerated byte search (memchr::memmem).
                    finders.iter().all(|f| f.find(bytes).is_some())
                }
            })
            .cloned()
            .collect()
    });

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

// =============================================================================
// Line-level matching (replaces rg --json for narrowed queries)
// =============================================================================

/// Scan `files` for regex matches, returning {file, line} for every match.
/// Uses the extracted `grep_lines_common` loop — validates paths, prechecks
/// whole-file, then iterates lines.
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

    let matches = grep_lines_common(&re, &root, &files, |file, line_idx, line, re| {
        if re.is_match(line) {
            Some(NativeGrepMatch {
                file: file.to_owned(),
                line: (line_idx + 1) as u32,
            })
        } else {
            None
        }
    });

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

    let matches = grep_lines_common(&re, &root, &files, |file, line_idx, line, re| {
        re.find(line).map(|m| {
            let match_bytes = &line[m.start()..m.end()];
            let match_text = String::from_utf8_lossy(match_bytes).into_owned();
            // Trim trailing whitespace from line content.
            let trimmed = match line
                .iter()
                .rposition(|&b| b != b' ' && b != b'\t' && b != b'\r')
            {
                Some(pos) => &line[..=pos],
                None => line,
            };
            let content = String::from_utf8_lossy(trimmed).into_owned();
            NativeGrepFullMatch {
                file: file.to_owned(),
                line: (line_idx + 1) as u32,
                column: (m.start() + 1) as u32,
                match_text,
                content,
            }
        })
    });

    Ok(NativeGrepFullResult {
        matches,
        scanned_files: scanned,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn create_test_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("hello.txt"),
            "Hello World\nfoo bar\nHello Again\n",
        )
        .unwrap();
        fs::write(dir.path().join("empty.txt"), "").unwrap();
        fs::write(dir.path().join("binary.bin"), b"\x00binary content").unwrap();
        fs::write(dir.path().join("case.txt"), "FooBar\nfoobar\nFOOBAR\nbaz\n").unwrap();
        fs::create_dir_all(dir.path().join("sub")).unwrap();
        fs::write(
            dir.path().join("sub/nested.txt"),
            "nested line\nanother line\n",
        )
        .unwrap();
        dir
    }

    // --- build_regex tests ---

    #[test]
    fn build_regex_rejects_overlong_pattern() {
        let long = "a".repeat(MAX_PATTERN_LENGTH + 1);
        let err = build_regex(&long, false).unwrap_err();
        assert!(err.to_string().contains("too long"));
    }

    #[test]
    fn build_regex_accepts_max_length() {
        assert!(build_regex(&"a".repeat(MAX_PATTERN_LENGTH), false).is_ok());
    }

    #[test]
    fn build_regex_case_insensitive() {
        let re = build_regex("hello", true).unwrap();
        assert!(re.is_match(b"HELLO world"));
        assert!(re.is_match(b"hello world"));
        assert!(re.is_match(b"HeLLo world"));
    }

    #[test]
    fn build_regex_multiline() {
        let re = build_regex("^foo$", false).unwrap();
        assert!(re.is_match(b"bar\nfoo\nbaz"));
    }

    #[test]
    fn build_regex_invalid_pattern() {
        assert!(build_regex("[unclosed", false).is_err());
        assert!(build_regex("(?P<dup>a)(?P<dup>b)", false).is_err());
    }

    // --- for_each_line tests ---

    #[test]
    fn for_each_line_basic() {
        let mut lines = Vec::new();
        for_each_line(b"line1\nline2\nline3", |idx, line| {
            lines.push((idx, String::from_utf8_lossy(line).to_string()));
        });
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], (0, "line1".to_string()));
        assert_eq!(lines[1], (1, "line2".to_string()));
        assert_eq!(lines[2], (2, "line3".to_string()));
    }

    #[test]
    fn for_each_line_trailing_newline() {
        let mut count = 0;
        for_each_line(b"a\nb\n", |_, _| count += 1);
        assert_eq!(count, 2);
    }

    #[test]
    fn for_each_line_empty() {
        let mut count = 0;
        for_each_line(b"", |_, _| count += 1);
        assert_eq!(count, 0);
    }

    #[test]
    fn for_each_line_single_no_newline() {
        let mut lines = Vec::new();
        for_each_line(b"only", |_, line| lines.push(line.to_vec()));
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], b"only");
    }

    // --- read_file_content tests ---

    #[test]
    fn read_file_content_skips_binary() {
        let dir = create_test_dir();
        assert!(read_file_content(&dir.path().join("binary.bin")).is_none());
    }

    #[test]
    fn read_file_content_skips_empty() {
        let dir = create_test_dir();
        assert!(read_file_content(&dir.path().join("empty.txt")).is_none());
    }

    #[test]
    fn read_file_content_reads_text() {
        let dir = create_test_dir();
        let content = read_file_content(&dir.path().join("hello.txt")).unwrap();
        assert!(content.as_bytes().starts_with(b"Hello"));
    }

    #[test]
    fn read_file_content_nonexistent() {
        assert!(read_file_content(std::path::Path::new("/nonexistent/file.txt")).is_none());
    }

    // --- validate_path tests ---

    #[test]
    fn validate_path_blocks_traversal() {
        let dir = create_test_dir();
        assert!(validate_path(dir.path(), "../../../etc/passwd").is_none());
    }

    #[test]
    fn validate_path_blocks_absolute_escape() {
        let dir = create_test_dir();
        assert!(validate_path(dir.path(), "/etc/passwd").is_none());
    }

    #[test]
    fn validate_path_allows_valid() {
        let dir = create_test_dir();
        assert!(validate_path(dir.path(), "hello.txt").is_some());
    }

    #[test]
    fn validate_path_allows_nested() {
        let dir = create_test_dir();
        assert!(validate_path(dir.path(), "sub/nested.txt").is_some());
    }

    #[test]
    fn validate_path_nonexistent() {
        let dir = create_test_dir();
        assert!(validate_path(dir.path(), "does_not_exist.txt").is_none());
    }

    // --- grep_lines_common tests ---

    #[test]
    fn grep_lines_common_matches_correctly() {
        let dir = create_test_dir();
        let re = build_regex("Hello", false).unwrap();
        let files = vec!["hello.txt".to_string()];

        let matches: Vec<(String, u32)> =
            grep_lines_common(&re, dir.path(), &files, |file, line_idx, line, re| {
                if re.is_match(line) {
                    Some((file.to_owned(), (line_idx + 1) as u32))
                } else {
                    None
                }
            });

        assert_eq!(matches.len(), 2); // "Hello World" and "Hello Again"
        assert!(matches.iter().any(|(_, l)| *l == 1));
        assert!(matches.iter().any(|(_, l)| *l == 3));
    }

    #[test]
    fn grep_lines_common_skips_nonmatching_files() {
        let dir = create_test_dir();
        let re = build_regex("nonexistent_xyz_pattern", false).unwrap();
        let files = vec!["hello.txt".to_string()];

        let matches: Vec<u32> =
            grep_lines_common(&re, dir.path(), &files, |_, line_idx, line, re| {
                if re.is_match(line) {
                    Some((line_idx + 1) as u32)
                } else {
                    None
                }
            });

        assert!(matches.is_empty());
    }

    #[test]
    fn grep_lines_common_skips_binary() {
        let dir = create_test_dir();
        let re = build_regex("binary", false).unwrap();
        let files = vec!["binary.bin".to_string()];

        let matches: Vec<u32> = grep_lines_common(&re, dir.path(), &files, |_, li, line, re| {
            if re.is_match(line) {
                Some((li + 1) as u32)
            } else {
                None
            }
        });

        assert!(matches.is_empty());
    }

    #[test]
    fn grep_lines_common_multiple_files() {
        let dir = create_test_dir();
        let re = build_regex("line", false).unwrap();
        let files = vec!["sub/nested.txt".to_string()];

        let matches: Vec<(String, u32)> =
            grep_lines_common(&re, dir.path(), &files, |file, li, line, re| {
                if re.is_match(line) {
                    Some((file.to_owned(), (li + 1) as u32))
                } else {
                    None
                }
            });

        assert_eq!(matches.len(), 2); // "nested line" and "another line"
    }

    // --- grep pool tests ---

    #[test]
    fn grep_pool_is_isolated() {
        let pool = grep_pool();
        assert!(pool.current_num_threads() > 0);
        // Calling again returns the same pool (OnceLock)
        let pool2 = grep_pool();
        assert_eq!(pool.current_num_threads(), pool2.current_num_threads());
    }
}
