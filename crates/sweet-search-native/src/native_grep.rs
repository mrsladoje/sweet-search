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

use crate::grep_file_cache;

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
#[cfg(test)]
pub(crate) fn validate_path(root: &std::path::Path, file: &str) -> Option<PathBuf> {
    validate_path_under(&GrepRoot::new(root), file)
}

/// A project root with its canonical form resolved once per call, not once per file, and the
/// canonical form of every directory the call's files sit in.
pub(crate) struct GrepRoot<'a> {
    root: &'a std::path::Path,
    canonical: Option<PathBuf>,
    /// `root.join(file).parent()` → its canonical path (None: it does not resolve).
    dirs: std::collections::HashMap<PathBuf, Option<PathBuf>>,
}

impl<'a> GrepRoot<'a> {
    pub(crate) fn new(root: &'a std::path::Path) -> Self {
        GrepRoot { root, canonical: root.canonicalize().ok(), dirs: std::collections::HashMap::new() }
    }

    /// `new`, with the directories of `files` canonicalized up front, in parallel: one
    /// realpath per directory instead of one per file (realpath walks every component, and
    /// it was most of the time a grep of many small files took).
    pub(crate) fn for_files(root: &'a std::path::Path, files: &[String]) -> Self {
        let mut grep_root = GrepRoot::new(root);
        if grep_root.canonical.is_none() {
            return grep_root;
        }
        let mut parents: Vec<PathBuf> = files
            .iter()
            .filter_map(|file| {
                let path = root.join(file);
                path.file_name()?;
                path.parent().map(|p| p.to_path_buf())
            })
            .collect();
        parents.sort_unstable();
        parents.dedup();
        let resolved: Vec<Option<PathBuf>> =
            grep_pool().install(|| parents.par_iter().map(|dir| dir.canonicalize().ok()).collect());
        grep_root.dirs = parents.into_iter().zip(resolved).collect();
        grep_root
    }
}

/// `validate_path` with the root already canonicalized.
fn validate_path_under(root: &GrepRoot<'_>, file: &str) -> Option<PathBuf> {
    let canonical_root = root.canonical.as_ref()?;
    let canonical = root.root.join(file).canonicalize().ok()?;
    if !canonical.starts_with(canonical_root) {
        return None;
    }
    Some(canonical)
}

/// What `read_file_content(validate_path(root, file))` reads, without a realpath per file.
///
/// realpath(dir/name) is realpath(dir)/name whenever `name` is not a symlink. So the file is
/// lstat'ed (and opened without following a final symlink), and the canonical directory
/// (resolved once per directory) plus the name takes the root check. A final symlink, a path
/// that does not end in a plain name, or a directory missing from the table takes the
/// per-file check.
fn read_validated_file(root: &GrepRoot<'_>, file: &str) -> Option<FileContent> {
    read_validated_file_kind(root, file).0
}

/// `read_validated_file`, plus what an lstat of the file found when the path is a plain name:
/// Some(true) a symlink, Some(false) not a symlink; None when not looked at (see
/// `alias_verdicts`).
fn read_validated_file_kind(root: &GrepRoot<'_>, file: &str) -> (Option<FileContent>, Option<bool>) {
    let Some(canonical_root) = root.canonical.as_ref() else { return (None, None) };
    let path = root.root.join(file);
    // `x/`, `x/.`, `x/..` resolve differently under open() than under realpath (macOS realpath
    // accepts `file.txt/`): those keep the per-file check.
    let plain_name = !file.ends_with('/') && !matches!(file.rsplit('/').next(), Some(".") | Some(".."));
    if let (true, Some(parent), Some(name)) = (plain_name, path.parent(), path.file_name()) {
        if let Some(canonical_dir) = root.dirs.get(parent) {
            // the directory does not resolve: neither does the file
            let Some(canonical_dir) = canonical_dir.as_ref() else { return (None, None) };
            let Ok(meta) = std::fs::symlink_metadata(&path) else { return (None, None) };
            if !meta.file_type().is_symlink() {
                if !canonical_dir.join(name).starts_with(canonical_root) {
                    return (None, Some(false));
                }
                let content = read_through(&path, &meta, || {
                    use std::os::unix::fs::OpenOptionsExt;
                    std::fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW).open(&path)
                });
                return (content, Some(false));
            }
            // a symlink: resolve it below
            return (validate_path_under(root, file).and_then(|p| read_file_content(&p)), Some(true));
        }
    }
    (validate_path_under(root, file).and_then(|p| read_file_content(&p)), None)
}

/// Read file content as a byte slice.
/// Returns None for binary files (null byte in first 8KB) or empty files.
pub(crate) fn read_file_content(path: &std::path::Path) -> Option<FileContent> {
    let meta = std::fs::metadata(path).ok()?;
    read_through(path, &meta, || std::fs::File::open(path))
}

/// `read_file_content`, plus whether an lstat found `path` itself a symlink (None: missing).
pub(crate) fn read_file_content_kind(path: &std::path::Path) -> (Option<FileContent>, Option<bool>) {
    match std::fs::symlink_metadata(path) {
        Err(_) => (None, None),
        Ok(meta) if meta.file_type().is_symlink() => (read_file_content(path), Some(true)),
        Ok(meta) => (read_through(path, &meta, || std::fs::File::open(path)), Some(false)),
    }
}

/// `read_open_file(open())`, served from grep_file_cache while `before` (a stat of `path`
/// taken now) shows the file unchanged since it was read.
fn read_through(
    path: &std::path::Path,
    before: &std::fs::Metadata,
    open: impl FnOnce() -> std::io::Result<std::fs::File>,
) -> Option<FileContent> {
    if before.is_file() {
        if before.len() == 0 {
            return None;
        }
        if let grep_file_cache::Cached::Hit(bytes) = grep_file_cache::lookup(path, before) {
            return bytes.map(FileContent::Shared);
        }
    }
    let mut file = open().ok()?;
    let opened = file.metadata().ok()?;
    let len = opened.len();
    if len == 0 || len > MMAP_THRESHOLD || !before.is_file() {
        return read_open_file(file);
    }
    let mut bytes = Vec::with_capacity(len as usize);
    std::io::Read::read_to_end(&mut file, &mut bytes).ok()?;
    if memchr::memchr(0, &bytes[..bytes.len().min(8192)]).is_some() {
        grep_file_cache::store(path, before, &opened, None);
        return None;
    }
    let bytes = std::sync::Arc::new(bytes);
    grep_file_cache::store(path, before, &opened, Some(&bytes));
    Some(FileContent::Shared(bytes))
}

/// `read_file_content` of an opened file: one fstat on the handle, then the bytes.
fn read_open_file(mut file: std::fs::File) -> Option<FileContent> {
    let len = file.metadata().ok()?.len();
    if len == 0 {
        return None;
    }

    if len > MMAP_THRESHOLD {
        // Dead path — MMAP_THRESHOLD is u64::MAX so this never executes.
        // Kept for index modules that import read_file_content with their
        // own threshold logic.
        let mmap = unsafe { memmap2::Mmap::map(&file) }.ok()?;
        if memchr::memchr(0, &mmap[..mmap.len().min(8192)]).is_some() {
            return None;
        }
        Some(FileContent::Mmap(mmap))
    } else {
        let mut bytes = Vec::with_capacity(len as usize);
        std::io::Read::read_to_end(&mut file, &mut bytes).ok()?;
        if memchr::memchr(0, &bytes[..bytes.len().min(8192)]).is_some() {
            return None;
        }
        Some(FileContent::Owned(bytes))
    }
}

pub(crate) enum FileContent {
    Mmap(memmap2::Mmap),
    Owned(Vec<u8>),
    Shared(std::sync::Arc<Vec<u8>>),
}

impl FileContent {
    pub(crate) fn as_bytes(&self) -> &[u8] {
        match self {
            FileContent::Mmap(m) => m,
            FileContent::Owned(b) => b,
            FileContent::Shared(b) => b,
        }
    }
}

/// Build a bytes-mode regex (operates on &[u8], no UTF-8 boundary checks).
/// Rejects patterns exceeding MAX_PATTERN_LENGTH to prevent DoS via
/// pathological regex compilation that could block the event loop.
/// Bumped DFA size limits to match ripgrep's configuration — larger lazy DFA
/// cache keeps states warm across files on each rayon thread.
pub(crate) fn build_regex(pattern: &str, case_insensitive: bool) -> Result<regex::bytes::Regex> {
    // One ss-grep call compiles its pattern several times (gram search, residual paths, the
    // retries), and a `\w` pattern compiles the whole Unicode word class (~1 ms). A Regex is
    // immutable and its clone shares the compiled program, so compiled ones are kept.
    static COMPILED: OnceLock<std::sync::Mutex<std::collections::HashMap<(String, bool), regex::bytes::Regex>>> =
        OnceLock::new();
    let compiled = COMPILED.get_or_init(Default::default);
    let key = (pattern.to_owned(), case_insensitive);
    if let Some(re) = compiled.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return Ok(re.clone());
    }
    let re = compile_regex(pattern, case_insensitive)?;
    let mut map = compiled.lock().unwrap_or_else(|e| e.into_inner());
    if map.len() >= 256 {
        map.clear();
    }
    map.insert(key, re.clone());
    Ok(re)
}

fn compile_regex(pattern: &str, case_insensitive: bool) -> Result<regex::bytes::Regex> {
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
    grep_matching_files_common(re, root, files, on_match)
        .into_iter()
        .flat_map(|(_, results)| results)
        .collect()
}

/// `grep_lines_common` per file: `(file, its line results)` for every file whose whole
/// text matches the regex (the files `native_grep_files_with_matches` returns), in input
/// order, from one read of each file.
fn grep_matching_files_common<'f, T, F>(
    re: &regex::bytes::Regex,
    root: &std::path::Path,
    files: &'f [String],
    on_match: F,
) -> Vec<(&'f String, Vec<T>)>
where
    T: Send,
    F: Fn(&str, usize, &[u8], &regex::bytes::Regex) -> Option<T> + Sync,
{
    grep_matching_files_with(re, root, files, |file, bytes, re, _| {
        let mut results = Vec::new();
        for_each_line(bytes, |line_idx, line| {
            if let Some(item) = on_match(file, line_idx, line, re) {
                results.push(item);
            }
        });
        results
    })
}

/// `(file, per_file(file, its bytes, re, final kind))` for every file whose whole text matches
/// the regex, in input order (final kind: see `read_validated_file_kind`). Non-matching files
/// (the majority) bail out after one SIMD-accelerated scan of the whole buffer instead of a
/// per-line regex over hundreds of lines.
fn grep_matching_files_with<'f, T, F>(
    re: &regex::bytes::Regex,
    root: &std::path::Path,
    files: &'f [String],
    per_file: F,
) -> Vec<(&'f String, T)>
where
    T: Send,
    F: Fn(&str, &[u8], &regex::bytes::Regex, Option<bool>) -> T + Sync,
{
    let root = GrepRoot::for_files(root, files);
    let root = &root;
    grep_pool().install(|| {
        files
            .par_iter()
            .filter_map(|file| {
                let (content, kind) = read_validated_file_kind(root, file);
                let content = content?;
                let bytes = content.as_bytes();
                if !re.is_match(bytes) {
                    return None;
                }
                Some((file, per_file(file, bytes, re, kind)))
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
    let root = GrepRoot::for_files(&root, &files);
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
    let root = GrepRoot::for_files(&root, &files);
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

    let matches = grep_lines_common(&re, &root, &files, line_match);

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

    let matches = grep_lines_common(&re, &root, &files, full_match);

    Ok(NativeGrepFullResult {
        matches,
        scanned_files: scanned,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

fn line_match(file: &str, line_idx: usize, line: &[u8], re: &regex::bytes::Regex) -> Option<NativeGrepMatch> {
    if re.is_match(line) {
        Some(NativeGrepMatch {
            file: file.to_owned(),
            line: (line_idx + 1) as u32,
        })
    } else {
        None
    }
}

/// The line without its trailing spaces, tabs and CRs; a line of only those is kept whole.
#[inline]
pub(crate) fn trim_line_end(line: &[u8]) -> &[u8] {
    match line.iter().rposition(|&b| b != b' ' && b != b'\t' && b != b'\r') {
        Some(pos) => &line[..=pos],
        None => line,
    }
}

fn full_match(file: &str, line_idx: usize, line: &[u8], re: &regex::bytes::Regex) -> Option<NativeGrepFullMatch> {
    re.find(line).map(|m| {
        let match_bytes = &line[m.start()..m.end()];
        let match_text = String::from_utf8_lossy(match_bytes).into_owned();
        let content = String::from_utf8_lossy(trim_line_end(line)).into_owned();
        NativeGrepFullMatch {
            file: file.to_owned(),
            line: (line_idx + 1) as u32,
            column: (m.start() + 1) as u32,
            match_text,
            content,
        }
    })
}

// =============================================================================
// Files plus their line matches, from one read (the planner's two-pass route)
// =============================================================================

#[napi(object)]
pub struct NativeGrepFullFilesResult {
    /// What `native_grep_files_with_matches` returns for the same input.
    pub matching_files: Vec<String>,
    /// What `native_grep_full` returns for `matching_files`.
    pub matches: Vec<NativeGrepFullMatch>,
    pub scanned_files: u32,
    pub elapsed_us: u32,
}

#[napi(object)]
pub struct NativeGrepLinesFilesResult {
    /// What `native_grep_files_with_matches` returns for the same input.
    pub matching_files: Vec<String>,
    /// What `native_grep_lines` returns for `matching_files`.
    pub matches: Vec<NativeGrepMatch>,
    pub scanned_files: u32,
    pub elapsed_us: u32,
}

/// `native_grep_files_with_matches` followed by `native_grep_full` on its files, with each
/// file read once instead of twice.
#[napi]
pub fn native_grep_full_with_files(
    pattern: String,
    project_root: String,
    files: Vec<String>,
    case_insensitive: Option<bool>,
) -> Result<NativeGrepFullFilesResult> {
    let start = std::time::Instant::now();
    let re = build_regex(&pattern, case_insensitive.unwrap_or(false))?;
    let root = PathBuf::from(&project_root);
    let (matching_files, matches) = split_file_results(grep_matching_files_common(&re, &root, &files, full_match));
    Ok(NativeGrepFullFilesResult {
        matching_files,
        matches,
        scanned_files: files.len() as u32,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

/// `native_grep_files_with_matches` followed by `native_grep_lines` on its files, with each
/// file read once instead of twice.
#[napi]
pub fn native_grep_lines_with_files(
    pattern: String,
    project_root: String,
    files: Vec<String>,
    case_insensitive: Option<bool>,
) -> Result<NativeGrepLinesFilesResult> {
    let start = std::time::Instant::now();
    let re = build_regex(&pattern, case_insensitive.unwrap_or(false))?;
    let root = PathBuf::from(&project_root);
    let (matching_files, matches) = split_file_results(grep_matching_files_common(&re, &root, &files, line_match));
    Ok(NativeGrepLinesFilesResult {
        matching_files,
        matches,
        scanned_files: files.len() as u32,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

// =============================================================================
// Packed full matches: the same data as Vec<NativeGrepFullMatch>, in a form that
// crosses into JS without one object (five properties) per match
// =============================================================================

/// `NativeGrepFullMatch` list, column by column. Match `i` is
/// `{ file: files[file_index[i]], line: line[i], column: column[i], matchText, content }`.
/// matchText and content are consecutive pieces of `text` (`in_wide[i] == 0`) or of `wide`
/// (`in_wide[i] == 1`): they end at the UTF-16 offsets `ends[2i]` and `ends[2i + 1]`, and the
/// first starts where the previous match in the same string ended.
///
/// ASCII pieces go to `text`, which JS receives as a one-byte string by plain copy; the rest
/// go to `wide`, received as UTF-16. One UTF-8 string for everything cost V8 a slow decode of
/// the whole of it as soon as one piece was not ASCII.
#[napi(object, object_from_js = false)]
pub struct PackedFullMatches {
    pub files: Vec<String>,
    pub file_index: Uint32Array,
    pub line: Uint32Array,
    pub column: Uint32Array,
    pub text: AsciiText,
    pub wide: Utf16Text,
    pub in_wide: Uint8Array,
    pub ends: Uint32Array,
    /// Per entry of `files`: its matching lines, including those a per-file cap left out.
    pub file_totals: Uint32Array,
    /// Per entry of `files`: 1 when it is a symlink or sits under a symlinked directory below
    /// the root, as `isSymlinkedRelUnder` (admission-policy.js) answers.
    pub file_alias: Uint8Array,
}

/// The prefixes `isSymlinkedRelUnder` lstats for `rel`, in order (None: it stops there and
/// answers false, at a `..`). Empty when it answers false without looking.
fn symlink_check_prefixes(rel: &str) -> Vec<Option<String>> {
    let r = rel.replace('\\', "/");
    let r = r.strip_prefix("./").unwrap_or(&r);
    let mut out = Vec::new();
    if r.is_empty() || r.starts_with('/') {
        return out;
    }
    let mut prefix = String::new();
    for part in r.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            out.push(None);
            return out;
        }
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(part);
        out.push(Some(prefix.clone()));
    }
    out
}

/// `isSymlinkedRelUnder(root, rel)` for each `(rel, final kind)`: walk the prefixes in order;
/// a missing one answers false, a symlink answers true. Each distinct directory prefix is
/// lstat'ed once. The file itself takes its final kind (the lstat its read already made) when
/// the walk's last prefix is `rel` itself, so both looked at the same path; otherwise it is
/// lstat'ed here too.
pub(crate) fn alias_verdicts(root: &std::path::Path, rels: &[(&str, Option<bool>)]) -> Vec<bool> {
    use std::collections::HashMap;
    let walks: Vec<Vec<Option<String>>> = rels.iter().map(|(rel, _)| symlink_check_prefixes(rel)).collect();
    let known = |i: usize| -> Option<bool> {
        let (rel, kind) = rels[i];
        match walks[i].last() {
            Some(Some(last)) if last == rel => kind,
            _ => None,
        }
    };
    let mut needed: Vec<&str> = Vec::new();
    for (i, walk) in walks.iter().enumerate() {
        let skip_last = known(i).is_some();
        let n = walk.len();
        for (j, step) in walk.iter().enumerate() {
            if let Some(p) = step {
                if !(skip_last && j + 1 == n) {
                    needed.push(p.as_str());
                }
            }
        }
    }
    needed.sort_unstable();
    needed.dedup();
    // Some(true) symlink, Some(false) present and not a symlink, None missing.
    let kinds: Vec<Option<bool>> = grep_pool().install(|| {
        needed
            .par_iter()
            .map(|p| std::fs::symlink_metadata(root.join(p)).ok().map(|m| m.file_type().is_symlink()))
            .collect()
    });
    let table: HashMap<&str, Option<bool>> = needed.iter().copied().zip(kinds).collect();
    walks
        .iter()
        .enumerate()
        .map(|(i, walk)| {
            let last_known = known(i);
            let n = walk.len();
            for (j, step) in walk.iter().enumerate() {
                let kind = match step {
                    None => return false,
                    Some(p) => match (j + 1 == n, last_known) {
                        (true, Some(k)) => Some(k),
                        _ => table[p.as_str()],
                    },
                };
                match kind {
                    None => return false,
                    Some(true) => return true,
                    Some(false) => {}
                }
            }
            false
        })
        .collect()
}

/// ASCII bytes, handed to JS as a one-byte string (napi_create_string_latin1: a copy, no UTF-8
/// decode). ASCII is Latin-1 with the same characters.
pub struct AsciiText(Vec<u8>);

impl TypeName for AsciiText {
    fn type_name() -> &'static str {
        "String"
    }

    fn value_type() -> ValueType {
        ValueType::String
    }
}

impl ToNapiValue for AsciiText {
    unsafe fn to_napi_value(env: napi::sys::napi_env, val: AsciiText) -> Result<napi::sys::napi_value> {
        debug_assert!(val.0.is_ascii());
        let mut out = std::ptr::null_mut();
        check_status!(
            unsafe { napi::sys::napi_create_string_latin1(env, val.0.as_ptr() as *const _, val.0.len(), &mut out) },
            "Failed to create an ASCII string"
        )?;
        Ok(out)
    }
}

/// UTF-16 code units, handed to JS as a string by plain copy.
pub struct Utf16Text(Vec<u16>);

impl TypeName for Utf16Text {
    fn type_name() -> &'static str {
        "String"
    }

    fn value_type() -> ValueType {
        ValueType::String
    }
}

impl ToNapiValue for Utf16Text {
    unsafe fn to_napi_value(env: napi::sys::napi_env, val: Utf16Text) -> Result<napi::sys::napi_value> {
        let mut out = std::ptr::null_mut();
        check_status!(
            unsafe { napi::sys::napi_create_string_utf16(env, val.0.as_ptr(), val.0.len(), &mut out) },
            "Failed to create a UTF-16 string"
        )?;
        Ok(out)
    }
}

/// One file's `full_match` results, packed; `ends` are offsets into this file's own text.
#[derive(Default)]
pub(crate) struct FilePack {
    /// What an lstat of the file found (see `alias_verdicts`).
    final_kind: Option<bool>,
    /// Matching lines, stored or not.
    total: u32,
    lines: Vec<u32>,
    columns: Vec<u32>,
    in_wide: Vec<u8>,
    ends: Vec<u32>,
    ascii: Vec<u8>,
    wide: Vec<u16>,
}

impl FilePack {
    pub(crate) fn with_final_kind(mut self, kind: Option<bool>) -> Self {
        self.final_kind = kind;
        self
    }
}

/// `full_match` on every line of `bytes`, packed: the same matches, with no String per match.
/// Runs on the grep worker threads, so the main thread only concatenates. With `cap > 0` only
/// the first `cap` matches are stored; `total` still counts every matching line.
pub(crate) fn pack_file_matches(bytes: &[u8], re: &regex::bytes::Regex, cap: u32) -> FilePack {
    let mut p = FilePack::default();
    for_each_line(bytes, |line_idx, line| {
        if cap > 0 && p.total >= cap {
            if re.is_match(line) {
                p.total += 1;
            }
            return;
        }
        if let Some(m) = re.find(line) {
            p.total += 1;
            let match_bytes = &line[m.start()..m.end()];
            let trimmed = trim_line_end(line);
            p.lines.push((line_idx + 1) as u32);
            p.columns.push((m.start() + 1) as u32);
            if match_bytes.is_ascii() && trimmed.is_ascii() {
                p.in_wide.push(0);
                p.ascii.extend_from_slice(match_bytes);
                p.ends.push(p.ascii.len() as u32);
                p.ascii.extend_from_slice(trimmed);
                p.ends.push(p.ascii.len() as u32);
            } else {
                p.in_wide.push(1);
                p.wide.extend(String::from_utf8_lossy(match_bytes).encode_utf16());
                p.ends.push(p.wide.len() as u32);
                p.wide.extend(String::from_utf8_lossy(trimmed).encode_utf16());
                p.ends.push(p.wide.len() as u32);
            }
        }
    });
    p
}

/// The packs of several files, in order, as one PackedFullMatches. Files without a match are
/// left out of `files`. `root`: what the files are relative to, for `file_alias`.
pub(crate) fn merge_file_packs<'a, I>(root: &std::path::Path, per_file: I) -> PackedFullMatches
where
    I: IntoIterator<Item = (&'a str, FilePack)>,
{
    let mut files = Vec::new();
    let mut final_kinds = Vec::new();
    let (mut file_index, mut line, mut column, mut in_wide, mut ends) = (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let (mut text, mut wide): (Vec<u8>, Vec<u16>) = (Vec::new(), Vec::new());
    let mut file_totals = Vec::new();
    for (file, p) in per_file {
        if p.lines.is_empty() {
            continue;
        }
        let idx = files.len() as u32;
        files.push(file.to_owned());
        final_kinds.push(p.final_kind);
        file_totals.push(p.total);
        let (text_base, wide_base) = (text.len() as u32, wide.len() as u32);
        for (i, &w) in p.in_wide.iter().enumerate() {
            let base = if w == 1 { wide_base } else { text_base };
            ends.push(p.ends[2 * i] + base);
            ends.push(p.ends[2 * i + 1] + base);
        }
        file_index.extend(std::iter::repeat(idx).take(p.lines.len()));
        line.extend_from_slice(&p.lines);
        column.extend_from_slice(&p.columns);
        in_wide.extend_from_slice(&p.in_wide);
        text.extend_from_slice(&p.ascii);
        wide.extend_from_slice(&p.wide);
    }
    let walks: Vec<(&str, Option<bool>)> = files.iter().map(|f| f.as_str()).zip(final_kinds).collect();
    let file_alias = alias_verdicts(root, &walks).into_iter().map(u8::from).collect();
    PackedFullMatches {
        files,
        file_alias: Uint8Array::new(file_alias),
        file_index: Uint32Array::new(file_index),
        line: Uint32Array::new(line),
        column: Uint32Array::new(column),
        text: AsciiText(text),
        wide: Utf16Text(wide),
        in_wide: Uint8Array::new(in_wide),
        ends: Uint32Array::new(ends),
        file_totals: Uint32Array::new(file_totals),
    }
}

#[napi(object, object_from_js = false)]
pub struct NativeGrepFullPackedResult {
    pub packed: PackedFullMatches,
    pub scanned_files: u32,
    pub elapsed_us: u32,
}

#[napi(object, object_from_js = false)]
pub struct NativeGrepFullFilesPackedResult {
    pub matching_files: Vec<String>,
    pub packed: PackedFullMatches,
    pub scanned_files: u32,
    pub elapsed_us: u32,
}

/// `native_grep_full`, with the matches packed; `per_file_cap > 0` stores at most that many
/// matches per file (`file_totals` still counts them all).
#[napi]
pub fn native_grep_full_packed(
    pattern: String,
    project_root: String,
    files: Vec<String>,
    case_insensitive: Option<bool>,
    per_file_cap: Option<u32>,
) -> Result<NativeGrepFullPackedResult> {
    let start = std::time::Instant::now();
    let re = build_regex(&pattern, case_insensitive.unwrap_or(false))?;
    let root = PathBuf::from(&project_root);
    let per_file = grep_matching_files_with(&re, &root, &files, |_, bytes, re, kind| pack_file_matches(bytes, re, per_file_cap.unwrap_or(0)).with_final_kind(kind));
    let packed = merge_file_packs(&root, per_file.into_iter().map(|(f, p)| (f.as_str(), p)));
    Ok(NativeGrepFullPackedResult {
        packed,
        scanned_files: files.len() as u32,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

/// `native_grep_full_with_files`, with the matches packed; `per_file_cap` as in
/// `native_grep_full_packed`.
#[napi]
pub fn native_grep_full_with_files_packed(
    pattern: String,
    project_root: String,
    files: Vec<String>,
    case_insensitive: Option<bool>,
    per_file_cap: Option<u32>,
) -> Result<NativeGrepFullFilesPackedResult> {
    let start = std::time::Instant::now();
    let re = build_regex(&pattern, case_insensitive.unwrap_or(false))?;
    let root = PathBuf::from(&project_root);
    let per_file = grep_matching_files_with(&re, &root, &files, |_, bytes, re, kind| pack_file_matches(bytes, re, per_file_cap.unwrap_or(0)).with_final_kind(kind));
    let matching_files = per_file.iter().map(|(f, _)| (*f).clone()).collect();
    let packed = merge_file_packs(&root, per_file.into_iter().map(|(f, p)| (f.as_str(), p)));
    Ok(NativeGrepFullFilesPackedResult {
        matching_files,
        packed,
        scanned_files: files.len() as u32,
        elapsed_us: start.elapsed().as_micros() as u32,
    })
}

fn split_file_results<T>(per_file: Vec<(&String, Vec<T>)>) -> (Vec<String>, Vec<T>) {
    let mut files = Vec::with_capacity(per_file.len());
    let mut matches = Vec::new();
    for (file, results) in per_file {
        files.push(file.clone());
        matches.extend(results);
    }
    (files, matches)
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

    // --- speed paths answer as the slow ones ---

    #[test]
    fn packed_cap_keeps_first_matches_and_counts_all() {
        let re = build_regex("x", false).unwrap();
        let bytes = b"x1\nno\nx2\nx3 \t\nx\xc3\xa9\n";
        let all = pack_file_matches(bytes, &re, 0);
        assert_eq!(all.total, 4);
        assert_eq!(all.lines, vec![1, 3, 4, 5]);
        let capped = pack_file_matches(bytes, &re, 2);
        assert_eq!(capped.total, 4);
        assert_eq!(capped.lines, vec![1, 3]);
        // ASCII pieces in `ascii`, the line with é in `wide`; content is trimmed as full_match trims
        assert_eq!(all.in_wide, vec![0, 0, 0, 1]);
        assert_eq!(std::str::from_utf8(&all.ascii).unwrap(), "xx1xx2xx3");
        assert_eq!(String::from_utf16(&all.wide).unwrap(), "xx\u{e9}");
    }

    #[test]
    fn validated_read_matches_the_per_file_check() {
        let dir = create_test_dir();
        let root = GrepRoot::for_files(dir.path(), &["hello.txt".into(), "hello.txt/".into(), "sub/nested.txt".into()]);
        for file in ["hello.txt", "hello.txt/", "sub/nested.txt", "sub/../hello.txt", "missing.txt", "../x", "sub"] {
            let fast = read_validated_file(&root, file).map(|c| c.as_bytes().to_vec());
            let slow = validate_path(dir.path(), file).and_then(|p| read_file_content(&p)).map(|c| c.as_bytes().to_vec());
            assert_eq!(fast, slow, "{file}");
        }
    }

    #[test]
    fn alias_verdicts_follow_the_js_walk() {
        let dir = create_test_dir();
        std::os::unix::fs::symlink("sub", dir.path().join("sublink")).unwrap();
        std::os::unix::fs::symlink("hello.txt", dir.path().join("hlink.txt")).unwrap();
        let rels = [
            ("hello.txt", Some(false)),
            ("sublink/nested.txt", Some(false)), // the directory above is the symlink
            ("hlink.txt", Some(true)),
            ("hlink.txt", None),                 // not looked at by the read: lstat'ed here
            ("./sub/nested.txt", Some(true)),    // not plain: the given kind is not used
            ("missing/x.txt", None),
            ("../hello.txt", None),
        ];
        assert_eq!(alias_verdicts(dir.path(), &rels), vec![false, true, true, true, false, false, false]);
    }
}
