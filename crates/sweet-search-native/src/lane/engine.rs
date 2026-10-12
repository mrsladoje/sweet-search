//! The lane's search engine: the same native code bareGrep calls through JS
//! (core/search/search-pattern-planner.js collectRegexMatches), called directly.
//!
//! Routes:
//!   unified   no scope, no delta overlay: gram narrowing + grep in one pass (searchFullPacked)
//!   files     every other route the planner takes: grep a file list (nativeGrepFull with
//!             indexPaths; the two-pass route's nativeGrepFullWithFilesPacked stores the same
//!             matches) — a scope's files, the gram candidates, or every indexed file
//! A regex the native engine refuses is a decline.

use crate::native_grep::{alias_verdicts, build_regex, grep_matching_files_with_mode, pack_file_matches, FilePack};
use crate::sparse_gram::NativeSparseGramIndex;
use std::collections::HashSet;
use std::path::Path;

/// One stored match, as bareGrep's normalized native match.
#[derive(Clone, Debug)]
pub(crate) struct RawMatch {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub match_text: String,
    pub content: String,
}

/// Matches (grouped per file, files in engine order) and, for a capped search, every
/// matching file's full count in the same order (bareGrep's `fileTotals`).
pub(crate) struct EngineResult {
    pub matches: Vec<RawMatch>,
    pub totals: Option<Vec<(String, u64)>>,
}

pub(crate) struct LaneIndex {
    pub path: String,
    signature: String,
    pub index: NativeSparseGramIndex,
    /// Every indexed path, index order (getAllFiles).
    pub files: Vec<String>,
    sorted: Vec<String>,
    set: HashSet<String>,
    /// sparseGramPathFilter: every extension key of the index's paths, plus "" (this addon
    /// reads "" as "no extension"), so the extension filter keeps every indexed path.
    extensions: Vec<String>,
}

pub(crate) fn file_signature(path: &str) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let m = std::fs::metadata(path).ok()?;
    Some(format!("{}:{}:{}:{}", m.ino(), m.len(), m.mtime(), m.mtime_nsec()))
}

impl LaneIndex {
    pub fn load(path: &str) -> Option<LaneIndex> {
        let signature = file_signature(path)?;
        let index = NativeSparseGramIndex::load(path.to_string()).ok()?;
        let files = index.get_all_files();
        let mut keys: Vec<String> = Vec::new();
        let mut seen = HashSet::new();
        for f in &files {
            if let Some(dot) = f.rfind('.') {
                if dot + 1 < f.len() {
                    let key = f[dot + 1..].to_ascii_lowercase();
                    if seen.insert(key.clone()) {
                        keys.push(key);
                    }
                }
            }
        }
        keys.push(String::new());
        let mut sorted = files.clone();
        // JS `[...files].sort()`: UTF-16 code unit order.
        sorted.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        let set = files.iter().cloned().collect();
        Some(LaneIndex { path: path.to_string(), signature, index, files, sorted, set, extensions: keys })
    }

    pub fn signature(&self) -> &str {
        &self.signature
    }

    pub fn is_current(&self, path: &str) -> bool {
        self.path == path && file_signature(path).as_deref() == Some(self.signature.as_str())
    }

    /// gramsProveNoMatch (search-pattern-sparse-overlay.js).
    pub fn grams_prove_no_match(&self, clauses: &[Vec<String>]) -> bool {
        if clauses.is_empty() {
            return false;
        }
        clauses.iter().all(|clause| {
            if clause.is_empty() {
                return false;
            }
            match self.index.query_literals(clause.clone(), Some(0), Some(0)) {
                Ok(r) => r.eligible && r.files.is_empty(),
                Err(_) => false,
            }
        })
    }

    /// queryLiterals(clause, cap, 0): Some((eligible, files)).
    pub fn query_literals(&self, clause: &[String], cap: u32) -> Option<(bool, Vec<String>)> {
        self.index.query_literals(clause.to_vec(), Some(cap), Some(0)).ok().map(|r| (r.eligible, r.files))
    }

    /// getSparseGramFilesUnder: the indexed files equal to or under each of `rels`.
    pub fn files_under(&self, rels: &[String]) -> Vec<String> {
        super::overlay::files_under(&self.sorted, &self.set, rels)
    }

    /// The unified search (searchFull with the gram clauses), aliases dropped.
    pub fn unified(&self, root: &str, clauses: &[Vec<String>], regex: &str, case_insensitive: bool, per_file_cap: u32) -> Option<EngineResult> {
        let (_, per_file) = self
            .index
            .search_full_with(
                clauses.to_vec(),
                regex.to_string(),
                root.to_string(),
                Some(0),
                Some(0),
                Some(case_insensitive),
                self.extensions.clone(),
                Some(100_000),
                Some(1.0),
                |_, bytes, re, kind| pack_file_matches(bytes, re, per_file_cap).with_final_kind(kind),
            )
            .ok()?;
        Some(finish(root, per_file.into_iter().map(|(f, p)| (f.to_string(), p)).collect(), per_file_cap))
    }

    /// nativeGrepFull(regex, root, files, ci, { perFileCap, indexPaths: true }), aliases dropped.
    pub fn grep_files(&self, root: &str, files: &[String], regex: &str, case_insensitive: bool, per_file_cap: u32) -> Option<EngineResult> {
        grep_files(root, files, regex, case_insensitive, per_file_cap)
    }
}

pub(crate) fn grep_files(root: &str, files: &[String], regex: &str, case_insensitive: bool, per_file_cap: u32) -> Option<EngineResult> {
    let re = build_regex(regex, case_insensitive).ok()?;
    let rootp = Path::new(root);
    let per_file = grep_matching_files_with_mode(&re, rootp, files, true, |_, bytes, re, kind| {
        pack_file_matches(bytes, re, per_file_cap).with_final_kind(kind)
    });
    Some(finish(root, per_file.into_iter().map(|(f, p)| (f.clone(), p)).collect(), per_file_cap))
}

/// nativeGrepFull's per-file totals as the probe reads them: every file with a stored match,
/// with no symlink-alias drop (grep-outside-probe.js uses the raw result).
pub(crate) fn grep_files_raw(root: &str, files: &[String], regex: &str, case_insensitive: bool, per_file_cap: u32) -> Option<Vec<(String, u64)>> {
    let re = build_regex(regex, case_insensitive).ok()?;
    let per_file = grep_matching_files_with_mode(&re, Path::new(root), files, true, |_, bytes, re, kind| {
        pack_file_matches(bytes, re, per_file_cap).with_final_kind(kind)
    });
    Some(per_file.into_iter().filter(|(_, p)| !p.decode().is_empty()).map(|(f, p)| (f.clone(), p.total() as u64)).collect())
}

/// merge_file_packs + unpackFullResult + dropSymlinkAliasMatches: files with a stored match,
/// their matches, their totals (capped search), minus files reached through a symlink.
fn finish(root: &str, per_file: Vec<(String, FilePack)>, per_file_cap: u32) -> EngineResult {
    let kept: Vec<(String, Option<bool>, u64, Vec<(u32, u32, String, String)>)> = per_file
        .into_iter()
        .filter_map(|(f, p)| {
            let stored = p.decode();
            (!stored.is_empty()).then(|| (f, p.final_kind(), p.total() as u64, stored))
        })
        .collect();
    let walks: Vec<(&str, Option<bool>)> = kept.iter().map(|(f, kind, _, _)| (f.as_str(), *kind)).collect();
    let alias = alias_verdicts(Path::new(root), &walks);
    let mut matches = Vec::new();
    let mut totals = Vec::new();
    for (i, (file, _, total, stored)) in kept.into_iter().enumerate() {
        if alias[i] {
            continue;
        }
        for (line, column, match_text, content) in stored {
            matches.push(RawMatch { file: file.clone(), line, column, match_text, content });
        }
        totals.push((file, total));
    }
    EngineResult { matches, totals: if per_file_cap > 0 { Some(totals) } else { None } }
}
