//! ss-grep's enrichments, ported from:
//! - core/search/search-pattern.js bareGrep: the `grepLineClasses` block and the gates of the
//!   family manifest and the sibling line (`bare_grep_enrich`);
//! - core/search/agent-pack-completion.js: buildIndexedGrepFamilyManifest,
//!   buildSingletonSiblingLine, buildSameFileSiblingLine and their helpers;
//! - core/search/search-read.js: interfaceCallsInRanges, renderInterfaceImpls (+ helpers);
//! - eval/agent-read-workflows/bin/_ss-helpers.mjs: writeGrepInterfaceHint, grepSiblingLine.
//!
//! Data comes in through `CodeGraph` (one method per CodeGraphRepository method used) and
//! `SourceText` (file reads as the JS does them). Anything the port cannot reproduce exactly
//! returns `Err(Decline)`: the caller lets JS answer.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::classes::{index_of_units, stamp_grep_line_classes, StampIo, StampStats};
use crate::collate::locale_compare;

/// `a.localeCompare(b)` inside a sort comparator: a pair the collator cannot order sets
/// `failed` (the caller then declines) and compares Equal so the sort still terminates.
fn lc(a: &str, b: &str, failed: &std::cell::Cell<bool>) -> std::cmp::Ordering {
    match locale_compare(a, b) {
        Some(o) => o,
        None => {
            failed.set(true);
            std::cmp::Ordering::Equal
        }
    }
}

const COLLATION: Decline = Decline("collation");
use crate::jsstr::{is_js_whitespace, len16, slice16, trim_js};
use crate::types::GrepRow;

// ---------------------------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------------------------

/// A CodeGraphRepository method threw (the JS `catch` branch runs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GraphThrew;

/// The port cannot reproduce this input byte for byte: let JS answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Decline(pub &'static str);

/// An `entities` row as the repository returns it: `{ id, name, type, startLine, endLine,
/// parentClass }` (+ `filePath` from findFamilyCandidates, and on family seeds).
/// `parentClass` is `parent_class || null`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "type", default)]
    pub entity_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default)]
    pub start_line: Option<i64>,
    #[serde(default)]
    pub end_line: Option<i64>,
    #[serde(default)]
    pub parent_class: Option<String>,
}

/// One answer of findEntitiesAtLines / findEntitiesForRanges: `{ enclosing, inRange }`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitiesAtLine {
    pub enclosing: Option<Entity>,
    pub in_range: Vec<Entity>,
}

/// findEntitiesForRanges' range: `{ startLine, endLine, includeInside }`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeQuery {
    pub start_line: i64,
    pub end_line: i64,
    pub include_inside: bool,
}

/// `{ startLine, endLine }` (findInterfaceCallImplementationsInRanges).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRange {
    pub start_line: i64,
    pub end_line: i64,
}

/// findFamilyCandidates' opts `{ filePrefix, types, limit }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyCandidateOpts {
    pub file_prefix: String,
    pub types: Vec<String>,
    pub limit: i64,
}

/// One implementation in an interface-call row: `{ name, owner, filePath, startLine, endLine }`
/// (`owner` = `parent_class || null`, `endLine` = `end_line ?? null`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceImpl {
    pub name: String,
    #[serde(default)]
    pub owner: Option<String>,
    pub file_path: String,
    #[serde(default)]
    pub start_line: Option<i64>,
    #[serde(default)]
    pub end_line: Option<i64>,
}

/// One row of findInterfaceCallImplementations: `{ line, call, target, impls }`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceCallRow {
    pub line: i64,
    pub call: String,
    pub target: String,
    pub impls: Vec<InterfaceImpl>,
}

/// Read access to code-graph.db: one method per core/infrastructure/code-graph-repository.js
/// method the ported code calls, same arguments, same answers (including the values the JS
/// method returns from its own `catch`). `Err(GraphThrew)` = the JS method threw (e.g. its
/// `_open()` failed); the ported callers then run their own `catch` branch.
pub trait CodeGraph {
    /// Mirrors CodeGraphRepository.findEntitiesInFile(filePath, opts) (code-graph-repository.js
    /// :613). `limit` = `opts.limit` (None = `{}`): effective LIMIT is
    /// `min(max(1, limit|0 || 512), 2048)`. Rows `ORDER BY start_line ASC, end_line DESC`.
    fn find_entities_in_file(&self, file_path: &str, limit: Option<i64>) -> Result<Vec<Entity>, GraphThrew>;
    /// Mirrors CodeGraphRepository.findEntitiesInRange(filePath, startLine, endLine) (:517).
    fn find_entities_in_range(&self, file_path: &str, start_line: i64, end_line: i64) -> Result<Vec<Entity>, GraphThrew>;
    /// Mirrors CodeGraphRepository.findEnclosingEntity(filePath, startLine, endLine) (:153).
    fn find_enclosing_entity(&self, file_path: &str, start_line: i64, end_line: i64) -> Result<Option<Entity>, GraphThrew>;
    /// Mirrors CodeGraphRepository.findEntitiesAtLines(filePath, lines) (:664). `Ok(None)` = the
    /// JS returned null (no db, or the scan failed).
    fn find_entities_at_lines(&self, file_path: &str, lines: &[i64]) -> Result<Option<Vec<EntitiesAtLine>>, GraphThrew>;
    /// Mirrors CodeGraphRepository.findEntitiesForRanges(filePath, ranges) (:555).
    fn find_entities_for_ranges(&self, file_path: &str, ranges: &[RangeQuery]) -> Result<Vec<EntitiesAtLine>, GraphThrew>;
    /// Mirrors CodeGraphRepository.findFamilyCandidates(stem, opts) (:835). Rows carry
    /// `file_path`.
    fn find_family_candidates(&self, stem: &str, opts: &FamilyCandidateOpts) -> Result<Vec<Entity>, GraphThrew>;
    /// Mirrors CodeGraphRepository.findInterfaceCallImplementationsInRanges(filePath, ranges)
    /// (:409, with findInterfaceCallImplementations :387, _interfaceCallsSql :436 and
    /// _interfaceCallImplementations :462): one answer per range, in order.
    fn find_interface_call_implementations_in_ranges(&self, file_path: &str, ranges: &[LineRange]) -> Result<Vec<Vec<InterfaceCallRow>>, GraphThrew>;
}

/// File text as the JS reads it.
pub trait SourceText {
    /// Mirrors core/search/search-pattern-chunks.js readFileRange(new Map(), file, startLine,
    /// endLine, projectRoot): None when it returns null (the path resolves outside the project
    /// root — see `read_file_range_path` — or the read throws); else
    /// `js_line_range(readFileSync(resolved, 'utf-8'), startLine, endLine)`. Node decodes
    /// invalid UTF-8 to U+FFFD (as `String::from_utf8_lossy`) and keeps a BOM.
    fn read_file_range(&self, file: &str, start_line: i64, end_line: i64) -> Option<String>;
    /// Mirrors the read in core/search/search-read.js _attachShortImplementationCode:
    /// `readFileSync(path.join(projectRoot, file), 'utf8')`, None when it throws (no root
    /// check there).
    fn read_file_utf8(&self, file: &str) -> Option<String>;
}

/// JS `array.slice(start, end)` bounds for an array of `len` elements.
fn js_slice_bounds(len: usize, start: i64, end: i64) -> (usize, usize) {
    let l = len as i64;
    let s = if start < 0 { (l + start).max(0) } else { start.min(l) };
    let e = if end < 0 { (l + end).max(0) } else { end.min(l) };
    (s as usize, e.max(s) as usize)
}

// Mirrors: core/search/search-pattern-chunks.js:readFileRange (the slice after the read)
/// `text.split('\n').slice((startLine || 1) - 1, endLine || startLine).join('\n')`.
pub fn js_line_range(text: &str, start_line: i64, end_line: i64) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let s = if start_line == 0 { 1 } else { start_line };
    let e = if end_line == 0 { start_line } else { end_line };
    let (a, b) = js_slice_bounds(lines.len(), s - 1, e);
    lines[a..b].join("\n")
}

/// Node `path.resolve` of an absolute POSIX path: '.', '..' and empty segments folded.
fn node_resolve_abs(p: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    format!("/{}", out.join("/"))
}

// Mirrors: core/search/search-pattern-chunks.js:readFileRange (the path check)
/// The absolute path readFileRange reads for `file` under an absolute `project_root`, or None
/// when it returns null without reading (outside the root). None too for a relative root
/// (the JS would resolve it against process.cwd(): not ported).
pub fn read_file_range_path(project_root: &str, file: &str) -> Option<String> {
    if !project_root.starts_with('/') {
        return None;
    }
    let abs = if file.starts_with('/') { file.to_string() } else { format!("{}/{}", project_root, file) };
    let resolved = node_resolve_abs(&abs);
    let resolved_root = node_resolve_abs(project_root);
    let inside = if resolved_root == "/" { resolved.starts_with('/') } else { resolved.starts_with(&format!("{}/", resolved_root)) };
    if !inside && resolved != resolved_root {
        return None;
    }
    Some(resolved)
}

// ---------------------------------------------------------------------------------------------
// String helpers (JS semantics)
// ---------------------------------------------------------------------------------------------

fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// JS `s.toLowerCase()`: exact for ASCII; a non-ASCII character whose lowercase form differs
/// declines (Unicode-version and special-casing differences between ICU and Rust).
pub fn js_to_lower(s: &str) -> Result<String, Decline> {
    if s.is_ascii() {
        return Ok(s.to_ascii_lowercase());
    }
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_ascii() {
            out.push(c.to_ascii_lowercase());
        } else {
            let mut l = c.to_lowercase();
            if l.len() == 1 && l.next() == Some(c) {
                out.push(c);
            } else {
                return Err(Decline("toLowerCase of a cased non-ASCII character"));
            }
        }
    }
    Ok(out)
}

/// Insertion-ordered string set (JS `Set` iteration order).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrderedSet {
    pub items: Vec<String>,
    #[serde(skip)]
    seen: HashSet<String>,
}

impl OrderedSet {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn add(&mut self, s: String) {
        if self.seen.insert(s.clone()) {
            self.items.push(s);
        }
    }
    pub fn has(&self, s: &str) -> bool {
        self.seen.contains(s)
    }
    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

const EVIDENCE_STOPWORDS: &[&str] = &[
    "a", "an", "and", "are", "can", "could", "did", "do", "does", "for", "from", "how", "in", "into", "is", "it", "its", "not",
    "of", "on", "or", "should", "that", "the", "this", "to", "was", "were", "what", "when", "where", "which", "with",
];

fn ascii_units_lower(u: &[u16]) -> String {
    // Only ASCII alphanumerics reach here.
    u.iter().map(|&c| (c as u8).to_ascii_lowercase() as char).collect()
}

// Mirrors: core/search/query-sufficiency.js:informativeSubtokens
/// Normalized informative subtokens (camelCase / non-alnum split, lowercased, stopword- and
/// length-filtered), in first-seen order.
pub fn informative_subtokens(text: &str) -> OrderedSet {
    let mut out = OrderedSet::new();
    if text.is_empty() {
        return out;
    }
    let s = units(text);
    let n = s.len();
    let mut start: isize = -1;
    let mut has_alpha = false;
    let add = |out: &mut OrderedSet, seg: &[u16]| {
        let norm = ascii_units_lower(seg);
        if !EVIDENCE_STOPWORDS.contains(&norm.as_str()) {
            out.add(norm);
        }
    };
    let mut prev_lower = false;
    let mut prev_upper = false;
    for i in 0..n {
        let c = s[i];
        let is_lower = (97..=122).contains(&c);
        let is_upper = (65..=90).contains(&c);
        let is_digit = (48..=57).contains(&c);
        if is_lower || is_upper || is_digit {
            if start != -1 && is_upper && prev_lower {
                // flush(i)
                if has_alpha && i as isize - start >= 3 {
                    add(&mut out, &s[start as usize..i]);
                }
                start = -1;
                has_alpha = false;
            } else if start != -1 && is_lower && prev_upper && i as isize - start >= 2 {
                let split = i as isize - 1;
                if split - start >= 3 {
                    add(&mut out, &s[start as usize..split as usize]);
                }
                start = split;
                has_alpha = true;
            }
            if start == -1 {
                start = i as isize;
                has_alpha = false;
            }
            if is_lower || is_upper {
                has_alpha = true;
            }
            prev_lower = is_lower || is_digit;
            prev_upper = is_upper;
        } else {
            if start != -1 && has_alpha && i as isize - start >= 3 {
                add(&mut out, &s[start as usize..i]);
            }
            start = -1;
            has_alpha = false;
            prev_lower = false;
            prev_upper = false;
        }
    }
    if start != -1 && has_alpha && n as isize - start >= 3 {
        add(&mut out, &s[start as usize..n]);
    }
    out
}

fn is_word_char_unit(c: u16) -> bool {
    // /[A-Za-z0-9_$]/
    (48..=57).contains(&c) || (65..=90).contains(&c) || (97..=122).contains(&c) || c == 95 || c == 36
}

// Mirrors: core/search/query-sufficiency.js:containsToken
/// Word-boundary substring check (`[A-Za-z0-9_$]` boundaries), optionally case-insensitive.
pub fn contains_token(haystack: &str, token: &str, case_sensitive: bool) -> Result<bool, Decline> {
    if haystack.is_empty() || token.is_empty() {
        return Ok(false);
    }
    let (hay, needle) = if case_sensitive {
        (units(haystack), units(token))
    } else {
        (units(&js_to_lower(haystack)?), units(&js_to_lower(token)?))
    };
    let mut from: i64 = 0;
    while from <= hay.len() as i64 - needle.len() as i64 {
        let idx = match index_of_units(&hay, &needle, from as usize) {
            Some(i) => i,
            None => return Ok(false),
        };
        let before = idx > 0 && is_word_char_unit(hay[idx - 1]);
        let after = idx + needle.len() < hay.len() && is_word_char_unit(hay[idx + needle.len()]);
        if !before && !after {
            return Ok(true);
        }
        from = idx as i64 + 1;
    }
    Ok(false)
}

fn is_regex_sep(c: char) -> bool {
    // /[\^$.|?*+()[\]{}<>=!,\s\u0000]/
    matches!(c, '^' | '$' | '.' | '|' | '?' | '*' | '+' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | '=' | '!' | ',' | '\0')
        || is_js_whitespace(c)
}

// Mirrors: core/search/query-sufficiency.js:regexLiteralRuns
/// Literal runs of a user regex (length >= 3, with a letter); a lowercase word followed by
/// whitespace and more of the same alternative is a qualifier, not a run.
pub fn regex_literal_runs(regex_source: &str) -> Vec<String> {
    if regex_source.is_empty() {
        return Vec::new();
    }
    let c: Vec<char> = regex_source.chars().collect();
    // .replace(/\\s[+*?]?/g, ' ')
    let mut a: Vec<char> = Vec::with_capacity(c.len());
    let mut i = 0;
    while i < c.len() {
        if c[i] == '\\' && i + 1 < c.len() && c[i + 1] == 's' {
            a.push(' ');
            i += 2;
            if i < c.len() && matches!(c[i], '+' | '*' | '?') {
                i += 1;
            }
        } else {
            a.push(c[i]);
            i += 1;
        }
    }
    // .replace(/\\[bBdDSwWAZz]/g, '\u0000')
    let mut b: Vec<char> = Vec::with_capacity(a.len());
    i = 0;
    while i < a.len() {
        if a[i] == '\\' && i + 1 < a.len() && "bBdDSwWAZz".contains(a[i + 1]) {
            b.push('\0');
            i += 2;
        } else {
            b.push(a[i]);
            i += 1;
        }
    }
    // .replace(/\\([^A-Za-z0-9])/g, '$1')
    let mut u: Vec<char> = Vec::with_capacity(b.len());
    i = 0;
    while i < b.len() {
        if b[i] == '\\' && i + 1 < b.len() && !b[i + 1].is_ascii_alphanumeric() {
            u.push(b[i + 1]);
            i += 2;
        } else {
            u.push(b[i]);
            i += 1;
        }
    }
    let n = u.len();
    let mut out = Vec::new();
    i = 0;
    while i < n {
        if is_regex_sep(u[i]) {
            i += 1;
            continue;
        }
        let mut j = i;
        while j < n && !is_regex_sep(u[j]) {
            j += 1;
        }
        let run = &u[i..j];
        let mut k = j;
        while k < n && u[k] != '|' {
            k += 1;
        }
        let rest = &u[j..k];
        let qualifier = !run.is_empty()
            && run.iter().all(|c| c.is_ascii_lowercase())
            && rest.first().is_some_and(|&c| is_js_whitespace(c))
            && rest.iter().any(|&c| !(is_js_whitespace(c) || c == '\0'));
        let mut s = 0;
        let mut e = run.len();
        let trim = |c: char| matches!(c, '-' | ':' | '/' | '\\');
        while s < e && trim(run[s]) {
            s += 1;
        }
        while e > s && trim(run[e - 1]) {
            e -= 1;
        }
        let trimmed: String = run[s..e].iter().collect();
        if !qualifier && len16(&trimmed) >= 3 && trimmed.chars().any(|c| c.is_ascii_alphabetic()) {
            out.push(trimmed);
        }
        i = j;
    }
    out
}

/// extractQueryEvidence's `{ anchors, subtokens }`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QueryEvidence {
    pub anchors: Vec<String>,
    pub subtokens: OrderedSet,
}

// Mirrors: core/search/query-sufficiency.js:extractQueryEvidence
/// Ported for the two shapes the grep paths pass: an empty query (sibling line) and a query
/// equal to the regex (ss-grep). A prose query declines.
pub fn extract_query_evidence(query: &str, regex: &str) -> Result<QueryEvidence, Decline> {
    let mut anchors: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut push = |tok: String, anchors: &mut Vec<String>| {
        if len16(&tok) >= 3 && seen.insert(tok.clone()) {
            anchors.push(tok);
        }
    };
    if !regex.is_empty() && query == regex {
        let runs = regex_literal_runs(regex);
        for run in &runs {
            push(run.clone(), &mut anchors);
        }
        return Ok(QueryEvidence { anchors, subtokens: informative_subtokens(&runs.join(" ")) });
    }
    if !query.is_empty() {
        return Err(Decline("extractQueryEvidence: prose query not ported"));
    }
    for run in regex_literal_runs(regex) {
        push(run, &mut anchors);
    }
    Ok(QueryEvidence { anchors, subtokens: OrderedSet::new() })
}

// Mirrors: core/search/agent-pack-completion.js:identifierMatchesQuery
fn identifier_matches_query(name: &str, evidence: &QueryEvidence) -> Result<bool, Decline> {
    for anchor in &evidence.anchors {
        let case_sensitive = anchor.chars().any(|c| c.is_ascii_uppercase());
        if contains_token(name, anchor, case_sensitive)? || js_to_lower(name)?.contains(js_to_lower(anchor)?.as_str()) {
            return Ok(true);
        }
    }
    let name_tokens = informative_subtokens(name);
    for token in &evidence.subtokens.items {
        if name_tokens.has(token) {
            return Ok(true);
        }
    }
    Ok(false)
}

// ---------------------------------------------------------------------------------------------
// Test-path shapes
// ---------------------------------------------------------------------------------------------

mod test_path_res {
    use regex::Regex;
    use std::sync::OnceLock;

    fn re(cell: &'static OnceLock<Regex>, src: &str) -> &'static Regex {
        cell.get_or_init(|| Regex::new(src).expect("static regex"))
    }

    // core/infrastructure/test-paths.js. The `/i` rules run on the ASCII-lowercased path with
    // lowercase patterns: JS non-unicode `/i` folds an ASCII letter only with an ASCII letter.
    pub fn test_paths_ci() -> &'static regex::Regex {
        static C: OnceLock<Regex> = OnceLock::new();
        re(
            &C,
            concat!(
                r"(?:(^|/)(__tests__|__mocks__|tests?|specs?|testdata|test_data|fixtures?|e2e|mocks?|testing|(?:integration|unit|acceptance)[-_]tests?)(/|$))",
                r"|(?:_test\.[a-z0-9]+$)",
                r"|(?:(^|/)test_[^/]+\.[a-z0-9]+$)",
                r"|(?:[-_.](test|spec)\.[cm]?[jt]sx?$)",
                r"|(?:_spec\.[a-z0-9]+$)",
                r"|(?:(^|/)conftest\.py$)",
            ),
        )
    }
    pub fn test_paths_cs() -> &'static regex::Regex {
        static C: OnceLock<Regex> = OnceLock::new();
        re(&C, r"Tests?\.(java|kt|kts|scala|cs|swift|m|mm|php)$")
    }
    // core/graph/relationship-resolver.js isTestPath
    pub fn rr_dir_ci() -> &'static regex::Regex {
        static C: OnceLock<Regex> = OnceLock::new();
        re(&C, r"(?:^|/)(?:tests?|spec|specs|__tests__|testing|mocks?|fixtures?)/")
    }
    pub fn rr_file_ci() -> &'static regex::Regex {
        static C: OnceLock<Regex> = OnceLock::new();
        re(&C, r"(?:[_.-](?:test|tests|spec))\.[^/.]+$|(?:^|/)(?:test_[^/]*\.py|conftest\.py)$")
    }
    pub fn rr_camel_cs() -> &'static regex::Regex {
        static C: OnceLock<Regex> = OnceLock::new();
        re(&C, r"(?:^|/|[a-z0-9])(?:Tests?|Specs?)\.[^/.]+$")
    }
    // core/search/search-read.js TEST_ROOT_DIR_RE
    pub fn root_dir_ci() -> &'static regex::Regex {
        static C: OnceLock<Regex> = OnceLock::new();
        re(&C, r"(?:^|/)(?:unit|acceptance|integration|e2e|functional)(?:[-_]?tests?)?/")
    }
}

// Mirrors: core/infrastructure/test-paths.js:isTestLikePath
/// Test, spec, fixture or mock file by path shape (ss-grep weighting, family seeds).
pub fn is_test_like_path(file: &str) -> bool {
    if file.is_empty() {
        return false;
    }
    let p = file.replace('\\', "/");
    if test_path_res::test_paths_ci().is_match(&p.to_ascii_lowercase()) {
        return true;
    }
    test_path_res::test_paths_cs().is_match(&p)
}

// Mirrors: core/graph/relationship-resolver.js:isTestPath
pub fn is_test_path(file: &str) -> bool {
    let lower = file.to_ascii_lowercase();
    test_path_res::rr_dir_ci().is_match(&lower)
        || test_path_res::rr_file_ci().is_match(&lower)
        || test_path_res::rr_camel_cs().is_match(file)
}

// Mirrors: core/search/search-read.js:isTestLikePath (the read trailer's own rule)
pub fn read_is_test_like_path(file: &str) -> bool {
    is_test_path(file) || test_path_res::root_dir_ci().is_match(&file.to_ascii_lowercase())
}

// ---------------------------------------------------------------------------------------------
// Indexed family manifest
// ---------------------------------------------------------------------------------------------

const MAX_FAMILY_SEEDS: usize = 24;
const MAX_FAMILY_STEMS: usize = 3;
const MAX_FAMILY_CANDIDATES: i64 = 64;

/// `Math.ceil(text.length / 3.5)` (defaultEstimateTokens).
fn default_estimate_tokens(text: &str) -> i64 {
    if text.is_empty() {
        0
    } else {
        (len16(text) as f64 / 3.5).ceil() as i64
    }
}

// Mirrors: core/search/agent-pack-completion.js:identifierParts
/// `name.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|[A-Z]+|\d+/g) || []`, hand-coded (the
/// lookahead).
fn identifier_parts(name: &str) -> Vec<String> {
    let c: Vec<char> = name.chars().collect();
    let n = c.len();
    let up = |i: usize| i < n && c[i].is_ascii_uppercase();
    let low = |i: usize| i < n && c[i].is_ascii_lowercase();
    let dig = |i: usize| i < n && c[i].is_ascii_digit();
    let mut out = Vec::new();
    let mut p = 0usize;
    while p < n {
        if up(p) {
            let mut l = 0;
            while up(p + l) {
                l += 1;
            }
            let mut found = None;
            for len in (1..=l).rev() {
                let q = p + len;
                if (up(q) && low(q + 1)) || dig(q) || q == n {
                    found = Some(len);
                    break;
                }
            }
            if let Some(len) = found {
                out.push(c[p..p + len].iter().collect());
                p += len;
                continue;
            }
            if low(p + 1) {
                let mut e = p + 1;
                while low(e) {
                    e += 1;
                }
                out.push(c[p..e].iter().collect());
                p = e;
                continue;
            }
            let mut e = p;
            while up(e) {
                e += 1;
            }
            out.push(c[p..e].iter().collect());
            p = e;
            continue;
        }
        if low(p) {
            let mut e = p;
            while low(e) {
                e += 1;
            }
            out.push(c[p..e].iter().collect());
            p = e;
            continue;
        }
        if dig(p) {
            let mut e = p;
            while dig(e) {
                e += 1;
            }
            out.push(c[p..e].iter().collect());
            p = e;
            continue;
        }
        p += 1;
    }
    out
}

// Mirrors: core/search/agent-pack-completion.js:familyStem
/// The longest alphabetic (3+ letters) part of an identifier, lowercased (ties: localeCompare).
pub fn family_stem(name: &str) -> Result<Option<String>, Decline> {
    let mut alpha: Vec<String> = identifier_parts(name)
        .into_iter()
        .filter(|p| p.len() >= 3 && p.chars().all(|c| c.is_ascii_alphabetic()))
        .collect();
    if alpha.is_empty() {
        return Ok(None);
    }
    let failed = std::cell::Cell::new(false);
    alpha.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| lc(a, b, &failed)));
    if failed.get() {
        return Err(COLLATION);
    }
    Ok(Some(alpha[0].to_ascii_lowercase()))
}

fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `name.match(/^(.*?)(\d+)([^\d]*)$/)` → (prefix, numeric, suffix).
fn numeric_slot(name: &str) -> Option<(String, String, String)> {
    let c: Vec<char> = name.chars().collect();
    let last = c.iter().rposition(|ch| ch.is_ascii_digit())?;
    let mut start = last;
    while start > 0 && c[start - 1].is_ascii_digit() {
        start -= 1;
    }
    if c[..start].iter().any(|&ch| is_line_terminator(ch)) {
        return None;
    }
    Some((c[..start].iter().collect(), c[start..=last].iter().collect(), c[last + 1..].iter().collect()))
}

/// buildIndexedFamilyManifest's answer.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FamilyManifest {
    pub rendered: String,
    pub tokens: i64,
    pub groups: Vec<String>,
    pub members: Vec<Entity>,
}

fn js_number_cmp(a: f64, b: f64) -> std::cmp::Ordering {
    let d = a - b;
    if d.is_nan() || d == 0.0 {
        std::cmp::Ordering::Equal
    } else if d < 0.0 {
        std::cmp::Ordering::Less
    } else {
        std::cmp::Ordering::Greater
    }
}

// Mirrors: core/search/agent-pack-completion.js:compareNumericLabels
fn compare_numeric_labels(a: &str, b: &str, failed: &std::cell::Cell<bool>) -> std::cmp::Ordering {
    let strip = |s: &str| -> String {
        // /^0+(?=\d)/: leading zeros, keeping the last digit
        let c: Vec<char> = s.chars().collect();
        let mut i = 0;
        while i + 1 < c.len() && c[i] == '0' && c[i + 1].is_ascii_digit() {
            i += 1;
        }
        c[i..].iter().collect()
    };
    let na = strip(a);
    let nb = strip(b);
    len16(&na)
        .cmp(&len16(&nb))
        .then_with(|| lc(&na, &nb, failed))
        .then_with(|| len16(a).cmp(&len16(b)))
        .then_with(|| lc(a, b, failed))
}

struct FamilyGroup {
    prefix: String,
    suffix: String,
    values: Vec<(String, Entity)>,
}

// Mirrors: core/search/agent-pack-completion.js:buildIndexedFamilyManifest
/// Compact exact indexed names by their final numeric slot.
pub fn build_indexed_family_manifest(candidates: &[Entity], seed_names: &[String]) -> Result<Option<FamilyManifest>, Decline> {
    if candidates.len() < 2 {
        return Ok(None);
    }
    let mut seed_stems: HashSet<String> = HashSet::new();
    for n in seed_names {
        if let Some(st) = family_stem(n)? {
            seed_stems.insert(st);
        }
    }
    let mut by_name: Vec<(String, &Entity)> = Vec::new();
    let mut names_seen: HashSet<&str> = HashSet::new();
    for candidate in candidates {
        let name = match candidate.name.as_deref() {
            Some(n) => n,
            None => continue,
        };
        if !name.chars().any(|c| c.is_ascii_alphabetic()) || !name.chars().any(|c| c.is_ascii_digit()) {
            continue;
        }
        let stem = match family_stem(name)? {
            Some(s) => s,
            None => continue,
        };
        if !seed_stems.is_empty() && !seed_stems.contains(&stem) {
            continue;
        }
        if names_seen.insert(name) {
            by_name.push((name.to_string(), candidate));
        }
    }

    let mut groups: Vec<FamilyGroup> = Vec::new();
    let mut group_index: HashMap<(String, String), usize> = HashMap::new();
    for (name, candidate) in &by_name {
        let (prefix, numeric, suffix) = match numeric_slot(name) {
            Some(m) => m,
            None => continue,
        };
        if prefix.is_empty() || !prefix.chars().any(|c| c.is_ascii_alphabetic()) {
            continue;
        }
        let key = (prefix.clone(), suffix.clone());
        let gi = *group_index.entry(key).or_insert_with(|| {
            groups.push(FamilyGroup { prefix, suffix, values: Vec::new() });
            groups.len() - 1
        });
        let g = &mut groups[gi];
        if let Some(slot) = g.values.iter_mut().find(|(v, _)| *v == numeric) {
            slot.1 = (*candidate).clone();
        } else {
            g.values.push((numeric, (*candidate).clone()));
        }
    }

    struct Keyed {
        width: f64,
        alpha: String,
        prefix_lower: String,
        gi: usize,
    }
    let mut compact: Vec<Keyed> = Vec::new();
    for (gi, g) in groups.iter().enumerate() {
        if g.values.len() < 2 {
            continue;
        }
        // groupSortKey
        let pc: Vec<char> = g.prefix.chars().collect();
        let width = match pc.iter().position(|c| c.is_ascii_digit()) {
            Some(s) => {
                let mut e = s;
                while e < pc.len() && pc[e].is_ascii_digit() {
                    e += 1;
                }
                let digits: String = pc[s..e].iter().collect();
                digits.parse::<f64>().unwrap_or(f64::NAN)
            }
            None => 0.0,
        };
        let alpha_raw: String = g.prefix.chars().filter(|c| !c.is_ascii_digit()).collect();
        compact.push(Keyed { width, alpha: js_to_lower(&alpha_raw)?, prefix_lower: js_to_lower(&g.prefix)?, gi });
    }
    let failed = std::cell::Cell::new(false);
    compact.sort_by(|a, b| {
        js_number_cmp(a.width, b.width)
            .then_with(|| lc(&a.alpha, &b.alpha, &failed))
            .then_with(|| lc(&a.prefix_lower, &b.prefix_lower, &failed))
    });
    if failed.get() {
        return Err(COLLATION);
    }
    if compact.is_empty() {
        return Ok(None);
    }
    let mut labels = Vec::new();
    let mut members = Vec::new();
    for k in &compact {
        let g = &groups[k.gi];
        let mut values: Vec<&(String, Entity)> = g.values.iter().collect();
        values.sort_by(|a, b| compare_numeric_labels(&a.0, &b.0, &failed));
        if failed.get() {
            return Err(COLLATION);
        }
        let joined: Vec<&str> = values.iter().map(|v| v.0.as_str()).collect();
        labels.push(format!("{}{{{}}}{}", g.prefix, joined.join(","), g.suffix));
        for v in values {
            members.push(v.1.clone());
        }
    }
    let rendered = format!("# indexed family: {}", labels.join(" · "));
    Ok(Some(FamilyManifest { tokens: default_estimate_tokens(&rendered), rendered, groups: labels, members }))
}

/// Node `path.posix.dirname`.
fn posix_dirname(p: &str) -> String {
    let b = p.as_bytes();
    if b.is_empty() {
        return ".".into();
    }
    let has_root = b[0] == b'/';
    let mut end: isize = -1;
    let mut matched_slash = true;
    let mut i = b.len() as isize - 1;
    while i >= 1 {
        if b[i as usize] == b'/' {
            if !matched_slash {
                end = i;
                break;
            }
        } else {
            matched_slash = false;
        }
        i -= 1;
    }
    if end == -1 {
        return if has_root { "/".into() } else { ".".into() };
    }
    if has_root && end == 1 {
        return "//".into();
    }
    p[..end as usize].to_string()
}

// Mirrors: core/search/agent-pack-completion.js:commonDirectory
fn common_directory(file_paths: &[&str]) -> Option<String> {
    let dirs: Vec<String> = file_paths.iter().filter(|f| !f.is_empty()).map(|f| posix_dirname(&f.replace('\\', "/"))).collect();
    if dirs.is_empty() {
        return None;
    }
    let parts: Vec<Vec<&str>> = dirs.iter().map(|d| d.split('/').filter(|s| !s.is_empty()).collect()).collect();
    let min = parts.iter().map(|p| p.len()).min().unwrap_or(0);
    let mut common: Vec<&str> = Vec::new();
    for i in 0..min {
        if !parts.iter().all(|e| e[i] == parts[0][i]) {
            break;
        }
        common.push(parts[0][i]);
    }
    let mut prefix = common.join("/");
    if prefix.is_empty() || prefix == "." {
        return None;
    }
    let unique: HashSet<&String> = dirs.iter().collect();
    // path.posix.basename(prefix): prefix has no trailing slash.
    let base = prefix.rsplit('/').next().unwrap_or("");
    if unique.len() == 1 && base.chars().any(|c| c.is_ascii_digit()) {
        let parent = posix_dirname(&prefix);
        if !parent.is_empty() && parent != "." {
            prefix = parent;
        }
    }
    Some(prefix)
}

// Mirrors: core/search/agent-pack-completion.js:findIndexedFamily
fn find_indexed_family(
    indexed_seeds: &[Entity],
    graph: &dyn CodeGraph,
    keep_file: Option<&dyn Fn(Option<&str>) -> bool>,
) -> Result<Option<FamilyManifest>, Decline> {
    let seed_stem: Vec<Option<String>> =
        indexed_seeds.iter().map(|s| family_stem(s.name.as_deref().unwrap_or(""))).collect::<Result<_, _>>()?;
    let mut stems: Vec<String> = Vec::new();
    for s in seed_stem.iter().flatten() {
        if !stems.contains(s) {
            stems.push(s.clone());
        }
    }
    stems.truncate(MAX_FAMILY_STEMS);
    let mut best: Option<FamilyManifest> = None;
    for stem in &stems {
        let seeds: Vec<&Entity> = indexed_seeds.iter().zip(&seed_stem).filter(|(_, st)| st.as_deref() == Some(stem.as_str())).map(|(s, _)| s).collect();
        let paths: Vec<&str> = seeds.iter().filter_map(|s| s.file_path.as_deref()).collect();
        let file_prefix = match common_directory(&paths) {
            Some(p) => p,
            None => continue,
        };
        let mut types: Vec<String> = Vec::new();
        for s in &seeds {
            if let Some(t) = s.entity_type.as_deref() {
                if !t.is_empty() && !types.iter().any(|x| x == t) {
                    types.push(t.to_string());
                }
            }
        }
        let opts = FamilyCandidateOpts { file_prefix, types, limit: MAX_FAMILY_CANDIDATES };
        let mut candidates = match graph.find_family_candidates(stem, &opts) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if let Some(keep) = keep_file {
            candidates.retain(|c| keep(c.file_path.as_deref()));
        }
        let seed_names: Vec<String> = seeds.iter().map(|s| s.name.clone().unwrap_or_default()).collect();
        let manifest = build_indexed_family_manifest(&candidates, &seed_names)?;
        if let Some(m) = manifest {
            if best.as_ref().is_none_or(|b| m.members.len() > b.members.len()) {
                best = Some(m);
            }
        }
    }
    Ok(best)
}

/// A hit `{ file, line }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hit {
    pub file: String,
    pub line: i64,
}

// Mirrors: core/search/agent-pack-completion.js:entitiesAtHitLines
/// One findEntitiesAtLines (else findEntitiesForRanges) per file for every hit, keyed by
/// (line, file); None (the caller asks per hit) when a batch fails or does not fit.
fn entities_at_hit_lines(hits: &[&Hit], graph: &dyn CodeGraph) -> Option<HashMap<(i64, String), EntitiesAtLine>> {
    let mut lines_by_file: Vec<(String, Vec<i64>)> = Vec::new();
    for hit in hits {
        let entry = match lines_by_file.iter_mut().find(|(f, _)| *f == hit.file) {
            Some(e) => e,
            None => {
                lines_by_file.push((hit.file.clone(), Vec::new()));
                lines_by_file.last_mut()?
            }
        };
        if !entry.1.contains(&hit.line) {
            entry.1.push(hit.line);
        }
    }
    let mut out = HashMap::new();
    for (file, lines) in lines_by_file {
        let rows = match graph.find_entities_at_lines(&file, &lines) {
            Err(_) => return None,
            Ok(Some(r)) => r,
            Ok(None) => {
                let ranges: Vec<RangeQuery> = lines.iter().map(|&l| RangeQuery { start_line: l, end_line: l, include_inside: true }).collect();
                match graph.find_entities_for_ranges(&file, &ranges) {
                    Err(_) => return None,
                    Ok(r) => r,
                }
            }
        };
        if rows.len() != lines.len() {
            return None;
        }
        for (line, row) in lines.into_iter().zip(rows) {
            out.insert((line, file.clone()), row);
        }
    }
    Some(out)
}

// Mirrors: core/search/agent-pack-completion.js:buildIndexedGrepFamilyManifest
/// Grep family closure from symbols indexed at exact match lines (test files seed nothing).
/// `keep_file` gets each candidate's `filePath` (ss-grep `-g` globs).
pub fn build_indexed_grep_family_manifest(
    results: &[Hit],
    graph: Option<&dyn CodeGraph>,
    keep_file: Option<&dyn Fn(Option<&str>) -> bool>,
) -> Result<Option<FamilyManifest>, Decline> {
    let graph = match graph {
        Some(g) if results.len() >= 2 => g,
        _ => return Ok(None),
    };
    let mut seeds: Vec<Entity> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let hits: Vec<&Hit> = results.iter().filter(|r| !is_test_like_path(&r.file)).take(MAX_FAMILY_SEEDS).collect();
    let batched = entities_at_hit_lines(&hits, graph);
    for result in &hits {
        let row = batched.as_ref().and_then(|b| b.get(&(result.line, result.file.clone())));
        let entities: Vec<Entity> = if let Some(row) = row {
            if !row.in_range.is_empty() {
                row.in_range.clone()
            } else {
                row.enclosing.iter().cloned().collect()
            }
        } else {
            let mut e = graph.find_entities_in_range(&result.file, result.line, result.line).unwrap_or_default();
            if e.is_empty() {
                e = match graph.find_enclosing_entity(&result.file, result.line, result.line) {
                    Ok(Some(x)) => vec![x],
                    _ => Vec::new(),
                };
            }
            e
        };
        for entity in entities {
            let name = match entity.name.as_deref() {
                Some(n) => n.to_string(),
                None => continue,
            };
            if !name.chars().any(|c| c.is_ascii_digit()) || seen.contains(&name) {
                continue;
            }
            seen.insert(name);
            seeds.push(Entity { file_path: Some(result.file.clone()), ..entity });
        }
    }
    if seeds.len() < 2 {
        return Ok(None);
    }
    find_indexed_family(&seeds, graph, keep_file)
}

// ---------------------------------------------------------------------------------------------
// Same-file sibling line
// ---------------------------------------------------------------------------------------------

const MAX_SIBLING_SITES: usize = 4;
const MAX_SIBLING_HITS: usize = 3;
const MAX_SIBLING_ENTITIES: usize = 3;
const SIBLING_LINE_MAX_CHARS: usize = 90;
const BODY_REFERENCE_GENERIC_TOKENS: &[&str] = &["get", "set", "has", "can", "could", "should", "needed", "result", "value", "data", "info"];
const STATE_ENTITY_TYPES: &[&str] = &["field", "property", "variable", "constant", "const", "static", "enum_constant"];

// Mirrors: core/search/agent-pack-completion.js:siblingTokens
fn sibling_tokens(name: &str) -> Vec<String> {
    informative_subtokens(name).items.into_iter().filter(|t| !BODY_REFERENCE_GENERIC_TOKENS.contains(&t.as_str())).collect()
}

// Mirrors: core/search/agent-pack-completion.js:compactSourceLine
/// Whitespace runs to one space, trimmed, cut to 90 UTF-16 units with `…`.
pub fn compact_source_line(text: &str) -> String {
    let mut collapsed = String::with_capacity(text.len());
    let mut in_ws = false;
    for c in text.chars() {
        if is_js_whitespace(c) {
            if !in_ws {
                collapsed.push(' ');
            }
            in_ws = true;
        } else {
            collapsed.push(c);
            in_ws = false;
        }
    }
    let one_line = trim_js(&collapsed);
    if len16(one_line) > SIBLING_LINE_MAX_CHARS {
        format!("{}…", slice16(one_line, 0, SIBLING_LINE_MAX_CHARS - 1))
    } else {
        one_line.to_string()
    }
}

fn starts_with_units(t: &[u16], at: usize, p: &[u16]) -> bool {
    at + p.len() <= t.len() && t[at..at + p.len()] == *p
}

/// `/(?:^|[^A-Za-z0-9_$.])(?:this\.|self\.|@)?NAME\s*=[^=]/.test(text)`.
fn assignment_matches(t: &[u16], name: &[u16]) -> bool {
    const PREFIXES: [&[u16]; 4] = [
        &[116, 104, 105, 115, 46], // this.
        &[115, 101, 108, 102, 46], // self.
        &[64],                     // @
        &[],
    ];
    let n = t.len();
    for r in 0..=n {
        if r > 0 {
            let c = t[r - 1];
            if is_word_char_unit(c) || c == 46 {
                continue;
            }
        }
        for pre in PREFIXES {
            if !starts_with_units(t, r, pre) {
                continue;
            }
            let p = r + pre.len();
            if !starts_with_units(t, p, name) {
                continue;
            }
            let mut q = p + name.len();
            while q < n && char::from_u32(t[q] as u32).is_some_and(is_js_whitespace) {
                q += 1;
            }
            if q + 1 < n && t[q] == 61 && t[q + 1] != 61 {
                return true;
            }
        }
    }
    false
}

/// `/(?:^|[^A-Za-z0-9_$])NAME(?![A-Za-z0-9_$])/.test(text)`.
fn referenced_in(t: &[u16], name: &[u16]) -> bool {
    let mut from = 0;
    while let Some(at) = index_of_units(t, name, from) {
        let before_ok = at == 0 || !is_word_char_unit(t[at - 1]);
        let after_ok = at + name.len() >= t.len() || !is_word_char_unit(t[at + name.len()]);
        if before_ok && after_ok {
            return true;
        }
        from = at + 1;
    }
    false
}

// Mirrors: core/search/agent-pack-completion.js:findAssignmentLine
/// First line assigning `name` outside the enclosing entities and the declaration.
fn find_assignment_line(lines: &[&str], name: &str, declaration_line: i64, exclude_ranges: &[(i64, i64)]) -> Option<i64> {
    let nu = units(name);
    for (i, text) in lines.iter().enumerate() {
        let line = i as i64 + 1;
        if line == declaration_line || exclude_ranges.iter().any(|&(s, e)| line >= s && line <= e) {
            continue;
        }
        if assignment_matches(&units(text), &nu) {
            return Some(line);
        }
    }
    None
}

/// One site of the sibling line: `{ line, kind, name, text }`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiblingSite {
    pub line: i64,
    pub kind: String,
    pub name: Option<String>,
    pub text: String,
}

/// buildSameFileSiblingLine's answer `{ rendered, tokens, enclosing, sites }`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiblingLine {
    pub rendered: String,
    pub tokens: i64,
    pub enclosing: String,
    pub sites: Vec<SiblingSite>,
}

struct Scored {
    entity: Entity,
    score: i64,
    is_state: bool,
    distance: i64,
}

// Mirrors: core/search/agent-pack-completion.js:buildSameFileSiblingLine
/// Same-file identifier family for one to three hits in ONE file. `regex` is the grep pattern;
/// the file is read through `source.read_file_range(file, 1, 1_000_000)`.
pub fn build_same_file_sibling_line(
    hits: &[Hit],
    graph: Option<&dyn CodeGraph>,
    regex: &str,
    source: &dyn SourceText,
) -> Result<Option<SiblingLine>, Decline> {
    if hits.is_empty() || hits.len() > MAX_SIBLING_HITS {
        return Ok(None);
    }
    let graph = match graph {
        Some(g) => g,
        None => return Ok(None),
    };
    let file = hits[0].file.as_str();
    if file.is_empty() || hits.iter().any(|h| h.file != file) {
        return Ok(None);
    }

    let mut enclosings: Vec<Entity> = Vec::new();
    let mut seen_enclosing: HashSet<(String, i64)> = HashSet::new();
    for hit in hits {
        let enclosing = graph.find_enclosing_entity(file, hit.line, hit.line).ok().flatten();
        let enc = match enclosing {
            Some(e) => e,
            None => continue,
        };
        let (name, s) = match (enc.name.as_deref(), enc.start_line, enc.end_line) {
            (Some(n), Some(s), Some(_)) if !n.is_empty() => (n.to_string(), s),
            _ => continue,
        };
        if !seen_enclosing.insert((name, s)) {
            continue;
        }
        enclosings.push(enc);
    }
    if enclosings.is_empty() {
        return Ok(None);
    }
    let entities = graph.find_entities_in_file(file, None).unwrap_or_default();
    if entities.is_empty() {
        return Ok(None);
    }

    let evidence = extract_query_evidence("", regex)?;
    let mut own_tokens = OrderedSet::new();
    for e in &enclosings {
        for t in sibling_tokens(e.name.as_deref().unwrap_or("")) {
            own_tokens.add(t);
        }
    }
    let file_text = source.read_file_range(file, 1, 1_000_000);
    let lines: Vec<&str> = match file_text.as_deref() {
        Some(t) if !t.is_empty() => t.split('\n').collect(),
        _ => Vec::new(),
    };
    let body = enclosings
        .iter()
        .map(|e| {
            let (a, b) = js_slice_bounds(lines.len(), e.start_line.unwrap_or(0) - 1, e.end_line.unwrap_or(0));
            lines[a..b].join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n");
    let body_units = units(&body);
    let hit_lines: Vec<i64> = hits.iter().map(|h| h.line).collect();
    let is_enclosing_or_kin = |entity: &Entity| {
        enclosings.iter().any(|own| {
            (entity.id.is_some() && entity.id == own.id)
                || (entity.name == own.name && entity.start_line == own.start_line)
                || match (entity.start_line, entity.end_line, own.start_line, own.end_line) {
                    (Some(es), Some(ee), Some(os), Some(oe)) => es >= os && ee <= oe,
                    _ => false,
                }
        })
    };

    let mut scored: Vec<Scored> = Vec::new();
    for entity in &entities {
        let (name, es, ee) = match (entity.name.as_deref(), entity.start_line, entity.end_line) {
            (Some(n), Some(s), Some(e)) if !n.is_empty() => (n, s, e),
            _ => continue,
        };
        // Parents (the class around the hit) and children (closures inside it) are already in
        // view or are the hit itself; only true siblings count.
        if hit_lines.iter().any(|&l| es <= l && ee >= l) {
            continue;
        }
        if is_enclosing_or_kin(entity) {
            continue;
        }
        let tokens = sibling_tokens(name);
        let overlap = tokens.iter().filter(|t| own_tokens.has(t)).count();
        // Family: >=2 shared subtokens, or every subtoken of a short enclosing name.
        let family = overlap >= 2 || (overlap >= 1 && overlap == own_tokens.len());
        let is_state = STATE_ENTITY_TYPES.contains(&js_to_lower(entity.entity_type.as_deref().unwrap_or(""))?.as_str());
        let referenced = is_state && !body.is_empty() && referenced_in(&body_units, &units(name));
        let query_hit = identifier_matches_query(name, &evidence)?;
        let mut score = 0i64;
        if family {
            score += 20 + overlap as i64 * 10;
        }
        if referenced {
            score += 30;
        }
        if query_hit {
            score += 15;
        }
        if score == 0 {
            continue;
        }
        if is_state {
            score += 5; // state first: it is what a method-local read cannot show
        }
        let distance = hit_lines.iter().map(|&l| (es - l).abs()).min().unwrap_or(i64::MAX);
        scored.push(Scored { entity: entity.clone(), score, is_state, distance });
    }
    if scored.is_empty() {
        return Ok(None);
    }
    scored.sort_by(|a, b| {
        b.score.cmp(&a.score).then(a.distance.cmp(&b.distance)).then(a.entity.start_line.cmp(&b.entity.start_line))
    });

    let mut sites: Vec<SiblingSite> = Vec::new();
    let mut seen_lines: HashSet<i64> = HashSet::new();
    let mut push_site = |sites: &mut Vec<SiblingSite>, line: Option<i64>, kind: &str, entity_name: Option<&str>| {
        let line = match line {
            Some(l) => l,
            None => return,
        };
        if seen_lines.contains(&line) || sites.len() >= MAX_SIBLING_SITES {
            return;
        }
        let text = if line >= 1 && ((line - 1) as usize) < lines.len() { lines[(line - 1) as usize] } else { return };
        if trim_js(text).is_empty() {
            return;
        }
        seen_lines.insert(line);
        sites.push(SiblingSite {
            line,
            kind: kind.to_string(),
            name: if kind == "assignment" { None } else { entity_name.map(str::to_string) },
            text: compact_source_line(text),
        });
    };
    let inside: Vec<(i64, i64)> = enclosings.iter().map(|o| (o.start_line.unwrap_or(0), o.end_line.unwrap_or(0))).collect();
    for s in scored.iter().take(MAX_SIBLING_ENTITIES) {
        let kind = match s.entity.entity_type.as_deref() {
            Some(t) if !t.is_empty() => t,
            _ => "symbol",
        };
        push_site(&mut sites, s.entity.start_line, kind, s.entity.name.as_deref());
        if s.is_state && !lines.is_empty() {
            let name = s.entity.name.as_deref().unwrap_or("");
            let decl = s.entity.start_line.unwrap_or(i64::MIN);
            push_site(&mut sites, find_assignment_line(&lines, name, decl, &inside), "assignment", None);
        }
    }
    if sites.is_empty() {
        return Ok(None);
    }
    sites.sort_by_key(|s| s.line);
    let label = enclosings.iter().map(|e| e.name.as_deref().unwrap_or("")).collect::<Vec<_>>().join(", ");
    let rendered = format!(
        "# same file (siblings of {}): {}",
        label,
        sites.iter().map(|s| format!("{}: {}", s.line, s.text)).collect::<Vec<_>>().join(" · ")
    );
    Ok(Some(SiblingLine { tokens: default_estimate_tokens(&rendered), rendered, enclosing: label, sites }))
}

// Mirrors: core/search/agent-pack-completion.js:buildSingletonSiblingLine
/// Grep form: 1-3 bare grep results, all in one file.
pub fn build_singleton_sibling_line(
    results: &[Hit],
    graph: Option<&dyn CodeGraph>,
    regex: &str,
    source: &dyn SourceText,
) -> Result<Option<SiblingLine>, Decline> {
    if results.is_empty() || results.len() > MAX_SIBLING_HITS {
        return Ok(None);
    }
    build_same_file_sibling_line(results, graph, regex, source)
}

// Mirrors: eval/agent-read-workflows/bin/_ss-helpers.mjs:grepSiblingLine
/// `# siblings: ...` without the sites that already print as a hit or inside a -B/-A window.
/// `rows` are the printed hit lines.
pub fn grep_sibling_line(sibling_line: Option<&SiblingLine>, rows: &[i64], before: i64, after: i64) -> Option<String> {
    let s = sibling_line?;
    if s.rendered.is_empty() {
        return None;
    }
    let shown = |line: i64| rows.iter().any(|&r| line >= r - before && line <= r + after);
    let kept: Vec<String> = s.sites.iter().filter(|site| !shown(site.line)).map(|site| format!("{}: {}", site.line, site.text)).collect();
    if kept.is_empty() {
        return None;
    }
    Some(format!("# siblings: {}", kept.join(" · ")))
}

// ---------------------------------------------------------------------------------------------
// Interface-call trailer
// ---------------------------------------------------------------------------------------------

const INTERFACE_IMPLS_MAX: usize = 2;
const INTERFACE_CLASSES_MAX: usize = 5;
const INTERFACE_CALL_LINES_MAX: usize = 3;
const ACCESSOR_BODY_MAX_CHARS: usize = 60;
const ACCESSOR_MAX_LINES: i64 = 12;

/// An interface call picked for the trailer (selectInterfaceCalls).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceCall {
    pub line: i64,
    pub call: String,
    pub target: String,
    pub impls: Vec<InterfaceImpl>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub many: bool,
}

fn is_w(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// `text.search(/=>|\)\s*(?::\s*[\w?.\\<>\[\]|]+\s*)?=(?!=)/)` over chars (all ASCII
/// patterns, so char positions map to the same match as code units; returns a char index).
fn arrow_search(c: &[char]) -> Option<usize> {
    let n = c.len();
    let ws = |i: usize| i < n && is_js_whitespace(c[i]);
    let class = |i: usize| i < n && (is_w(c[i]) || matches!(c[i], '?' | '.' | '\\' | '<' | '>' | '[' | ']' | '|'));
    let eq_not_eq = |i: usize| i < n && c[i] == '=' && !(i + 1 < n && c[i + 1] == '=');
    for p in 0..n {
        if c[p] == '=' && p + 1 < n && c[p + 1] == '>' {
            return Some(p);
        }
        if c[p] == ')' {
            let mut q = p + 1;
            while ws(q) {
                q += 1;
            }
            if q < n && c[q] == ':' {
                let mut r = q + 1;
                while ws(r) {
                    r += 1;
                }
                if class(r) {
                    while class(r) {
                        r += 1;
                    }
                    while ws(r) {
                        r += 1;
                    }
                    if eq_not_eq(r) {
                        return Some(p);
                    }
                }
            } else if eq_not_eq(q) {
                return Some(p);
            }
        }
    }
    None
}

fn is_lt(c: char) -> bool {
    is_line_terminator(c)
}

/// `body.replace(/\/\*[\s\S]*?\*\//g, ' ')`
fn strip_block_comments(c: &[char]) -> Vec<char> {
    let n = c.len();
    let mut out = Vec::with_capacity(n);
    let mut i = 0;
    while i < n {
        if c[i] == '/' && i + 1 < n && c[i + 1] == '*' {
            let mut j = i + 2;
            let mut end = None;
            while j + 1 < n {
                if c[j] == '*' && c[j + 1] == '/' {
                    end = Some(j + 2);
                    break;
                }
                j += 1;
            }
            if let Some(e) = end {
                out.push(' ');
                i = e;
                continue;
            }
        }
        out.push(c[i]);
        i += 1;
    }
    out
}

/// `.replace(/(^|[^:])\/\/.*$/gm, '$1')`
fn strip_line_comments(c: &[char]) -> Vec<char> {
    let n = c.len();
    let mut out = Vec::with_capacity(n);
    let line_start = |s: usize| s == 0 || is_lt(c[s - 1]);
    let eol = |mut s: usize| {
        while s < n && !is_lt(c[s]) {
            s += 1;
        }
        s
    };
    let mut i = 0;
    while i < n {
        if line_start(i) && i + 1 < n && c[i] == '/' && c[i + 1] == '/' {
            i = eol(i + 2);
            continue;
        }
        if c[i] != ':' && i + 2 < n && c[i + 1] == '/' && c[i + 2] == '/' {
            out.push(c[i]);
            i = eol(i + 3);
            continue;
        }
        out.push(c[i]);
        i += 1;
    }
    out
}

/// `.replace(/^\s*#.*$/gm, ' ')`
fn strip_hash_lines(c: &[char]) -> Vec<char> {
    let n = c.len();
    let mut out = Vec::with_capacity(n);
    let mut i = 0;
    while i < n {
        if i == 0 || is_lt(c[i - 1]) {
            let mut j = i;
            while j < n && is_js_whitespace(c[j]) {
                j += 1;
            }
            if j < n && c[j] == '#' {
                let mut e = j + 1;
                while e < n && !is_lt(c[e]) {
                    e += 1;
                }
                out.push(' ');
                i = e;
                continue;
            }
        }
        out.push(c[i]);
        i += 1;
    }
    out
}

// Mirrors: core/search/search-read.js:accessorShaped
fn accessor_shaped(body: &[char], name: &str) -> bool {
    let a = strip_block_comments(body);
    let b = strip_line_comments(&a);
    let c = strip_hash_lines(&b);
    let stripped: Vec<char> = c.into_iter().filter(|&ch| !is_js_whitespace(ch)).collect();
    let no_braces: String = stripped.iter().filter(|&&ch| ch != '{' && ch != '}').collect();
    if len16(&no_braces) > ACCESSOR_BODY_MAX_CHARS {
        return false;
    }
    // .replace(/^\(|\breturn\(/g, '')
    let n = stripped.len();
    let ret: Vec<char> = "return(".chars().collect();
    let mut s2: Vec<char> = Vec::with_capacity(n);
    let mut i = 0;
    while i < n {
        if i == 0 && stripped[0] == '(' {
            i += 1;
            continue;
        }
        let boundary = (i > 0 && is_w(stripped[i - 1])) != is_w(stripped[i]);
        if boundary && i + ret.len() <= n && stripped[i..i + ret.len()] == ret[..] {
            i += ret.len();
            continue;
        }
        s2.push(stripped[i]);
        i += 1;
    }
    // .matchAll(/([A-Za-z_$][\w$]*)!?\(/g)
    let m = s2.len();
    let start_c = |ch: char| ch.is_ascii_alphabetic() || ch == '_' || ch == '$';
    let word_c = |ch: char| is_w(ch) || ch == '$';
    let mut p = 0;
    while p < m {
        if start_c(s2[p]) {
            let mut e = p + 1;
            while e < m && word_c(s2[e]) {
                e += 1;
            }
            let mut q = e;
            if q < m && s2[q] == '!' {
                q += 1;
            }
            if q < m && s2[q] == '(' {
                let ident: String = s2[p..e].iter().collect();
                if ident != name {
                    return false;
                }
                p = q + 1;
                continue;
            }
        }
        p += 1;
    }
    true
}

// Mirrors: core/search/search-read.js:isAccessorBody
/// A body that only hands back or stores state, or forwards to its own name.
pub fn is_accessor_body(code: Option<&str>, name: &str) -> bool {
    let text = code.unwrap_or("");
    if text.is_empty() {
        return false;
    }
    let c: Vec<char> = text.chars().collect();
    let brace = c.iter().position(|&ch| ch == '{');
    let arrow = arrow_search(&c);
    let start: Option<usize> = match (brace, arrow) {
        (Some(b), a) if a.is_none_or(|a| b < a) => Some(b + 1),
        (_, Some(a)) => Some(a + 2),
        _ => None,
    };
    match start {
        None => {
            let nl = match c.iter().position(|&ch| ch == '\n') {
                Some(i) => i,
                None => return false,
            };
            accessor_shaped(&c[nl + 1..], name)
        }
        Some(s) => accessor_shaped(&c[s.min(c.len())..], name),
    }
}

// Mirrors: core/search/search-read.js:selectInterfaceCalls
/// The interface calls worth a trailer line among one window's graph rows. `codes[r][i]` is
/// the attached implementation code of `rows[r].impls[i]` (_attachShortImplementationCode).
fn select_interface_calls(rows: &[InterfaceCallRow], codes: &[Vec<Option<String>>], file_path_rel: &str) -> Vec<InterfaceCall> {
    if rows.is_empty() || read_is_test_like_path(file_path_rel) {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for (r, row) in rows.iter().enumerate() {
        if seen.contains(row.target.as_str()) {
            continue;
        }
        let mut by_method: Vec<(String, usize)> = Vec::new();
        for (i, imp) in row.impls.iter().enumerate() {
            if read_is_test_like_path(&imp.file_path) {
                continue;
            }
            let key = format!("{}.{}", imp.owner.as_deref().unwrap_or(""), imp.name);
            if !by_method.iter().any(|(k, _)| *k == key) {
                by_method.push((key, i));
            }
        }
        let impls: Vec<usize> = by_method.into_iter().map(|(_, i)| i).collect();
        if impls.is_empty() || impls.len() > INTERFACE_CLASSES_MAX {
            continue;
        }
        if impls.iter().all(|&i| is_accessor_body(codes[r][i].as_deref(), &row.impls[i].name)) {
            continue;
        }
        let many = impls.len() > INTERFACE_IMPLS_MAX;
        if !many && impls.iter().any(|&i| row.impls[i].file_path == file_path_rel) {
            continue;
        }
        seen.insert(row.target.as_str());
        out.push(InterfaceCall {
            line: row.line,
            call: row.call.clone(),
            target: row.target.clone(),
            impls: impls.iter().map(|&i| row.impls[i].clone()).collect(),
            many,
        });
        if out.len() >= INTERFACE_CALL_LINES_MAX {
            break;
        }
    }
    out
}

// Mirrors: core/search/search-read.js:_attachShortImplementationCode
/// The code of every implementation of at most ACCESSOR_MAX_LINES + 1 lines (None = not read).
fn attach_short_implementation_code(rows: &[InterfaceCallRow], source: &dyn SourceText) -> Vec<Vec<Option<String>>> {
    let mut files: HashMap<&str, Option<Vec<String>>> = HashMap::new();
    rows.iter()
        .map(|row| {
            row.impls
                .iter()
                .map(|imp| {
                    let (s, e) = match (imp.start_line, imp.end_line) {
                        (Some(s), Some(e)) if !imp.file_path.is_empty() && s > 0 && e >= s => (s, e),
                        _ => return None,
                    };
                    if e - s > ACCESSOR_MAX_LINES {
                        return None;
                    }
                    let lines = files
                        .entry(imp.file_path.as_str())
                        .or_insert_with(|| source.read_file_utf8(&imp.file_path).map(|t| t.split('\n').map(str::to_string).collect()));
                    let lines = lines.as_ref()?;
                    let (a, b) = js_slice_bounds(lines.len(), s - 1, e);
                    Some(lines[a..b].join("\n"))
                })
                .collect()
        })
        .collect()
}

// Mirrors: core/search/search-read.js:interfaceCallsInRanges
/// interfaceCallsInRange for many ranges of one file: one graph query for all of them.
/// `graph` None = no code graph for the project (every range answers []).
pub fn interface_calls_in_ranges(graph: Option<&dyn CodeGraph>, source: &dyn SourceText, file_path_rel: &str, ranges: &[LineRange]) -> Vec<Vec<InterfaceCall>> {
    let graph = match graph {
        Some(g) => g,
        None => return ranges.iter().map(|_| Vec::new()).collect(),
    };
    let rows_per_range = graph
        .find_interface_call_implementations_in_ranges(file_path_rel, ranges)
        .unwrap_or_else(|_| ranges.iter().map(|_| Vec::new()).collect());
    rows_per_range
        .iter()
        .map(|rows| {
            let codes = attach_short_implementation_code(rows, source);
            select_interface_calls(rows, &codes, file_path_rel)
        })
        .collect()
}

fn js_opt_int(v: Option<i64>) -> String {
    v.map(|x| x.to_string()).unwrap_or_else(|| "null".into())
}

fn truthy(s: &Option<String>) -> Option<&str> {
    s.as_deref().filter(|x| !x.is_empty())
}

// Mirrors: core/search/search-read.js:renderInterfaceImpls
/// The interface-call trailer lines ('' when none).
pub fn render_interface_impls(calls: &[InterfaceCall]) -> String {
    if calls.is_empty() {
        return String::new();
    }
    struct Group {
        owner: String,
        names: Vec<String>,
        calls: Vec<usize>,
    }
    let mut groups: Vec<Group> = Vec::new();
    let mut keys: Vec<String> = Vec::new();
    for (ci, c) in calls.iter().enumerate() {
        if !c.many {
            continue;
        }
        let owner = match c.target.rfind('.') {
            Some(i) => c.target[..i].to_string(),
            None => c.target.clone(),
        };
        let names: Vec<String> = c
            .impls
            .iter()
            .map(|i| match truthy(&i.owner) {
                Some(o) => o.to_string(),
                None => format!("{} ({}:{})", i.name, i.file_path, js_opt_int(i.start_line)),
            })
            .collect();
        let key = format!("{}\u{0}{}", owner, names.join(","));
        match keys.iter().position(|k| *k == key) {
            Some(gi) => groups[gi].calls.push(ci),
            None => {
                keys.push(key);
                groups.push(Group { owner, names, calls: vec![ci] });
            }
        }
    }
    let mut printed: HashSet<usize> = HashSet::new();
    let mut lines: Vec<String> = Vec::new();
    for (ci, c) in calls.iter().enumerate() {
        if c.many {
            let gi = match groups.iter().position(|g| g.calls.contains(&ci)) {
                Some(g) => g,
                None => continue,
            };
            if !printed.insert(gi) {
                continue;
            }
            let g = &groups[gi];
            if g.calls.len() == 1 {
                lines.push(format!(
                    "line {} {} calls interface {}, implemented by {} classes: {}",
                    c.line,
                    c.call,
                    c.target,
                    g.names.len(),
                    g.names.join(", ")
                ));
            } else {
                lines.push(format!(
                    "lines {} {} call interface {}, implemented by {} classes: {}",
                    g.calls.iter().map(|&k| calls[k].line.to_string()).collect::<Vec<_>>().join(", "),
                    g.calls.iter().map(|&k| calls[k].call.as_str()).collect::<Vec<_>>().join(", "),
                    g.owner,
                    g.names.len(),
                    g.names.join(", ")
                ));
            }
            continue;
        }
        let impls = c
            .impls
            .iter()
            .map(|i| {
                let owner = truthy(&i.owner).map(|o| format!("{}.", o)).unwrap_or_default();
                format!("{}{} ({}:{})", owner, i.name, i.file_path, js_opt_int(i.start_line))
            })
            .collect::<Vec<_>>()
            .join(", ");
        let line = format!("line {} {} calls interface {}, implemented by {}", c.line, c.call, c.target, impls);
        if !line.is_empty() {
            lines.push(line);
        }
    }
    lines.join("\n")
}

const GREP_IMPL_HINT_MAX_MATCHES: i64 = 8;
const GREP_IMPL_HINT_LINES_AFTER: i64 = 3;
const GREP_IMPL_HINT_MAX_LINES: usize = 3;

// Mirrors: eval/agent-read-workflows/bin/_ss-helpers.mjs:writeGrepInterfaceHint
/// The bytes writeGrepInterfaceHint prints (hint + "\n"), or None when it prints nothing.
/// `total` = stats.totalMatches; `rows` = the printed hit rows, in print order. Declines
/// where the JS would throw (a graph answer with fewer windows than asked).
pub fn grep_interface_hint(total: i64, rows: &[Hit], graph: Option<&dyn CodeGraph>, source: &dyn SourceText) -> Result<Option<String>, Decline> {
    if !(total > 0 && total <= GREP_IMPL_HINT_MAX_MATCHES) {
        return Ok(None);
    }
    // One graph query per file, not per hit.
    let mut by_file: Vec<(&str, Vec<usize>)> = Vec::new();
    for (i, r) in rows.iter().enumerate() {
        match by_file.iter_mut().find(|(f, _)| *f == r.file) {
            Some(e) => e.1.push(i),
            None => by_file.push((r.file.as_str(), vec![i])),
        }
    }
    let mut calls_of: Vec<Vec<InterfaceCall>> = vec![Vec::new(); rows.len()];
    for (file, idx) in &by_file {
        let ranges: Vec<LineRange> = idx.iter().map(|&i| LineRange { start_line: rows[i].line, end_line: rows[i].line + GREP_IMPL_HINT_LINES_AFTER }).collect();
        let found = interface_calls_in_ranges(graph, source, file, &ranges);
        if found.len() < idx.len() {
            return Err(Decline("interface-call answer has fewer windows than hits"));
        }
        for (k, &i) in idx.iter().enumerate() {
            calls_of[i] = found[k].clone();
        }
    }
    let mut calls: Vec<InterfaceCall> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for cs in &calls_of {
        for c in cs {
            if seen.insert(c.target.clone()) {
                calls.push(c.clone());
            }
        }
    }
    calls.truncate(GREP_IMPL_HINT_MAX_LINES);
    let hint = render_interface_impls(&calls);
    Ok(if hint.is_empty() { None } else { Some(format!("{}\n", hint)) })
}

// ---------------------------------------------------------------------------------------------
// bareGrep (core/search/search-pattern.js)
// ---------------------------------------------------------------------------------------------

/// findEntitiesInFile's own maximum (code-graph-repository.js).
pub const GREP_LINE_CLASS_ENTITY_CAP: usize = 2048;

// Mirrors: core/search/search-pattern.js:bareGrep (definedName)
/// The identifier a pattern is (`safeParse`, `\bsafeParse\b`, `safeParse\(`, `-w`'s
/// `\b(?:safeParse)\b`), else None.
pub fn defined_name_from_regex(regex: &str) -> Option<String> {
    // String(regex).replace(/^\\b\(\?:(.*)\)\\b$/, '$1'): `.` stops at line terminators.
    let bare: &str = match regex.strip_prefix("\\b(?:").and_then(|r| r.strip_suffix(")\\b")) {
        Some(inner) if !inner.chars().any(is_line_terminator) => inner,
        _ => regex,
    };
    // /^(?:\\b)?([A-Za-z_$][\w$]*)(?:\\b|\\\(|\\s\*\\\()?$/
    let mut s = bare.strip_prefix("\\b").unwrap_or(bare);
    // The optional leading `\b` is greedy, but a backtrack cannot help: `\` is no identifier
    // start, so without it the identifier cannot match.
    let b = s.as_bytes();
    if b.is_empty() || !(b[0].is_ascii_alphabetic() || b[0] == b'_' || b[0] == b'$') {
        return None;
    }
    let mut e = 1;
    while e < b.len() && (b[e].is_ascii_alphanumeric() || b[e] == b'_' || b[e] == b'$') {
        e += 1;
    }
    let ident = &s[..e];
    s = &s[e..];
    if s.is_empty() || s == "\\b" || s == "\\(" || s == "\\s*\\(" {
        Some(ident.to_string())
    } else {
        None
    }
}

/// The bareGrep options the enrichments read.
pub struct BareGrepEnrichOptions<'a> {
    /// `options._isAgentFormat === true`
    pub is_agent_format: bool,
    /// `options.grepLineClasses === true`
    pub grep_line_classes: bool,
    /// bareGrep built a fileSummary (`options.perFileCap > 0`)
    pub has_file_summary: bool,
    /// `options.fileFilter` is truthy (an `--in` scope)
    pub has_file_filter: bool,
    /// `options._cwdScope === true`
    pub cwd_scope: bool,
    /// `options._siblingLine === false` (SS_SIBLING_LINE=0)
    pub sibling_line_off: bool,
    /// `pathGlobs.matches(file)` when `-g` globs were given (keepFile of the family manifest);
    /// gets `c.filePath` (the JS wrapper returns false for a non-string).
    pub keep_file: Option<&'a dyn Fn(&str) -> bool>,
}

/// What bareGrep adds to its answer.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BareGrepEnrichment {
    /// stats.lineClassFiles / lineClassStamped (None = the block did not run).
    pub line_class_stats: Option<StampStats>,
    pub family_manifest: Option<FamilyManifest>,
    pub sibling_line: Option<SiblingLine>,
}

// Mirrors: core/search/search-pattern.js:bareGrep (line classes, familyManifest, siblingLine)
/// Stamps line classes on `results` (in place) and builds the family manifest and the sibling
/// line, under bareGrep's gates. `is_fresh(file)` = `indexFreshness(path.resolve(searchDir,
/// file), manifest)` known and not stale (see `index_freshness`).
pub fn bare_grep_enrich(
    results: &mut [GrepRow],
    regex: &str,
    opts: &BareGrepEnrichOptions<'_>,
    graph: Option<&dyn CodeGraph>,
    source: &dyn SourceText,
    is_fresh: &mut dyn FnMut(&str) -> bool,
) -> Result<BareGrepEnrichment, Decline> {
    let mut out = BareGrepEnrichment::default();
    if opts.is_agent_format && opts.grep_line_classes && opts.has_file_summary {
        if let Some(g) = graph {
            let defined_name = defined_name_from_regex(regex);
            // A capped entity list would class every line past the cap's last span as
            // "outside every symbol": a file that fills the cap keeps the prefix instead.
            let mut entities_in_file = |file: &str| -> Result<Vec<Entity>, GraphThrew> {
                let entities = g.find_entities_in_file(file, Some(GREP_LINE_CLASS_ENTITY_CAP as i64))?;
                Ok(if entities.len() >= GREP_LINE_CLASS_ENTITY_CAP { Vec::new() } else { entities })
            };
            let mut io = StampIo { entities_in_file: &mut entities_in_file, is_fresh, defined_name: defined_name.as_deref() };
            out.line_class_stats = Some(stamp_grep_line_classes(results, &mut io));
        }
    }
    let unscoped_shape = !opts.has_file_filter || opts.cwd_scope;
    let hits: Vec<Hit> = results.iter().map(|r| Hit { file: r.file.clone(), line: r.line as i64 }).collect();
    if opts.is_agent_format && unscoped_shape {
        let keep = opts.keep_file.map(|k| move |f: Option<&str>| f.is_some_and(k));
        let keep_ref: Option<&dyn Fn(Option<&str>) -> bool> = keep.as_ref().map(|k| k as &dyn Fn(Option<&str>) -> bool);
        out.family_manifest = build_indexed_grep_family_manifest(&hits, graph, keep_ref)?;
    }
    if opts.is_agent_format
        && unscoped_shape
        && !opts.sibling_line_off
        && !results.is_empty()
        && results.len() <= 3
        && results.iter().all(|r| r.file == results[0].file)
    {
        out.sibling_line = build_singleton_sibling_line(&hits, graph, regex, source)?;
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Freshness (core/search/index-freshness.js)
// ---------------------------------------------------------------------------------------------

/// indexFreshness' `{ known, stale }`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Freshness {
    pub known: bool,
    pub stale: bool,
}

// Mirrors: core/search/index-freshness.js:indexFreshness
/// `published_ms` = Date.parse(manifest.publishedAt) when finite; `mtime_ms` = the stat's
/// mtimeMs (None = cannot be stat'ed).
pub fn index_freshness(published_ms: Option<f64>, mtime_ms: Option<f64>) -> Freshness {
    let published = match published_ms {
        Some(p) if p.is_finite() => p,
        _ => return Freshness { known: false, stale: false },
    };
    match mtime_ms {
        None => Freshness { known: false, stale: false },
        Some(m) => Freshness { known: true, stale: m > published },
    }
}

/// Node's `stats.mtimeMs` from the timespec: `sec * 1e3 + nsec / 1e6`.
pub fn node_mtime_ms(sec: i64, nsec: i64) -> f64 {
    sec as f64 * 1e3 + nsec as f64 / 1e6
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// `Date.parse(s)` for `YYYY-MM-DDTHH:mm:ss(.sss)?(Z|±HH:mm)` (what `toISOString` writes):
/// Ok(None) = NaN (empty string); any other shape declines (V8's fallback parser).
pub fn date_parse_iso(s: &str) -> Result<Option<f64>, Decline> {
    if s.is_empty() {
        return Ok(None);
    }
    let b = s.as_bytes();
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        if r.end > b.len() || !b[r.clone()].iter().all(u8::is_ascii_digit) {
            return None;
        }
        std::str::from_utf8(&b[r]).ok()?.parse().ok()
    };
    let decline = Decline("Date.parse: not a toISOString shape");
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return Err(decline);
    }
    let (y, mo, d, h, mi, se) = match (num(0..4), num(5..7), num(8..10), num(11..13), num(14..16), num(17..19)) {
        (Some(y), Some(mo), Some(d), Some(h), Some(mi), Some(se)) => (y, mo, d, h, mi, se),
        _ => return Err(decline),
    };
    let mut i = 19;
    let mut ms = 0i64;
    if b[i] == b'.' {
        if b.len() < i + 4 {
            return Err(decline);
        }
        ms = num(i + 1..i + 4).ok_or(decline.clone())?;
        i += 4;
    }
    let offset_min = if b.len() == i + 1 && b[i] == b'Z' {
        0
    } else if b.len() == i + 6 && (b[i] == b'+' || b[i] == b'-') && b[i + 3] == b':' {
        let oh = num(i + 1..i + 3).ok_or(decline.clone())?;
        let om = num(i + 4..i + 6).ok_or(decline.clone())?;
        if oh > 23 || om > 59 {
            return Err(decline);
        }
        let sign = if b[i] == b'+' { 1 } else { -1 };
        sign * (oh * 60 + om)
    } else {
        return Err(decline);
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let dim = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if !(1..=12).contains(&mo) || d < 1 || d > dim[(mo - 1) as usize] || h > 23 || mi > 59 || se > 59 {
        return Err(decline);
    }
    let days = days_from_civil(y, mo, d);
    let t = days * 86_400_000 + h * 3_600_000 + mi * 60_000 + se * 1000 + ms - offset_min * 60_000;
    Ok(Some(t as f64))
}

/// The publish time ss-grep's freshness gate reads: `_readReconcileManifest()` (JSON with an
/// integer `epoch`, else null) then `Date.parse(manifest?.publishedAt || '')`. `manifest_json`
/// None = the file is missing or unreadable. Ok(None) = not finite (every file unknown).
pub fn manifest_published_ms(manifest_json: Option<&str>) -> Result<Option<f64>, Decline> {
    let v: serde_json::Value = match manifest_json.and_then(|t| serde_json::from_str(t).ok()) {
        Some(v) => v,
        None => return Ok(None),
    };
    let epoch_is_integer = match v.get("epoch") {
        Some(serde_json::Value::Number(n)) => n.is_i64() || n.is_u64() || n.as_f64().is_some_and(|f| f.is_finite() && f.fract() == 0.0),
        _ => false,
    };
    if !epoch_is_integer {
        return Ok(None);
    }
    match v.get("publishedAt") {
        None | Some(serde_json::Value::Null) | Some(serde_json::Value::Bool(false)) => Ok(None),
        Some(serde_json::Value::String(s)) => date_parse_iso(s),
        Some(serde_json::Value::Number(n)) if n.as_f64() == Some(0.0) => Ok(None),
        Some(_) => Err(Decline("publishedAt is not a string")),
    }
}
