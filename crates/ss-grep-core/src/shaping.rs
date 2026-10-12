//! ss-grep's file selection, line allocation and body rows.
//!
//! Mirrors:
//! - core/search/grep-output-shaping.js (pathSegments, applyGrepFileDiversity,
//!   selectGrepFilesByWeight and its heap helpers, the path / blob priors,
//!   allocateGrepLinesSainteLague, allocateGrepBudget, renderGrepBody, renderGrepBodyWeighted,
//!   finishGrepBody),
//! - core/search/grep-allocation-rules.js (all of it),
//! - core/search/grep-line-classes.js (selectGrepLinesByClass, isCommentLine),
//! - core/infrastructure/test-paths.js (isTestLikePath).
//!
//! Every function returns `None` (decline: let JS answer) where the JS would read past its
//! input or print text this port cannot reproduce byte for byte.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use regex::Regex;

use crate::jsstr::{len16, trim_js};
use crate::render::grep_hit_units;
use crate::types::{FileSummary, GrepRow, HiddenFile, SummaryFile};

fn static_re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    // The patterns are constants of this file, not data: a failure is a programming error.
    cell.get_or_init(|| Regex::new(pattern).expect("static regex compiles"))
}

// Mirrors: core/search/grep-output-shaping.js:pathSegments
/// Split a path into whole segments, dropping "" and "." (so "./a//b" -> [a, b]).
pub fn path_segments(value: &str) -> Vec<String> {
    value
        .replace('\\', "/")
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .map(str::to_string)
        .collect()
}

// --- test-paths.js -------------------------------------------------------------------------
//
// JS `/i` without `u` folds ASCII letters only (a non-ASCII char never canonicalizes to an
// ASCII one), so every case-insensitive part runs in `(?i-u)`; `[^/]` stays Unicode (`(?u:..)`)
// so it matches one whole char, which gives the same yes/no as one UTF-16 unit.

/// TEST_DIR_RE and the case-insensitive TEST_FILE_RES, folded into one alternation as
/// TEST_PATH_CI_RE does.
const TEST_PATH_CI: &str = concat!(
    r"(?i-u)",
    r"(?:(^|/)(__tests__|__mocks__|tests?|specs?|testdata|test_data|fixtures?|e2e|mocks?|testing|(?:integration|unit|acceptance)[-_]tests?)(/|$))",
    r"|(?:_test\.[a-z0-9]+$)",
    r"|(?:(^|/)test_(?u:[^/])+\.[a-z0-9]+$)",
    r"|(?:[-_.](test|spec)\.[cm]?[jt]sx?$)",
    r"|(?:_spec\.[a-z0-9]+$)",
    r"|(?:(^|/)conftest\.py$)",
);
/// The one case-sensitive rule (TEST_PATH_CS_RES).
const TEST_PATH_CS: &str = r"Tests?\.(java|kt|kts|scala|cs|swift|m|mm|php)$";

static TEST_PATH_CI_RE: OnceLock<Regex> = OnceLock::new();
static TEST_PATH_CS_RE: OnceLock<Regex> = OnceLock::new();

// Mirrors: core/infrastructure/test-paths.js:isTestLikePath
/// Test, spec, fixture or mock file by path shape only.
pub fn is_test_like_path(file: &str) -> bool {
    if file.is_empty() {
        return false;
    }
    let normalized;
    let p = if file.contains('\\') {
        normalized = file.replace('\\', "/");
        normalized.as_str()
    } else {
        file
    };
    if static_re(&TEST_PATH_CI_RE, TEST_PATH_CI).is_match(p) {
        return true;
    }
    static_re(&TEST_PATH_CS_RE, TEST_PATH_CS).is_match(p)
}

// --- path priors -----------------------------------------------------------------------------

/// GENERATED_PATH_RE: generated, vendored, minified, or a package manager's lockfile.
const GENERATED_PATH: &str = concat!(
    r"(?i-u)",
    r"\.pb\.go$|_pb2\.py$|\.generated\.|(^|/)(vendor|dist|build|node_modules)/|\.min\.js$",
    r"|(^|/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?|Cargo\.lock",
    r"|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock|pdm\.lock|composer\.lock|Gemfile\.lock|Podfile\.lock",
    r"|Package\.resolved|mix\.lock|pubspec\.lock|flake\.lock|gradle\.lockfile|packages\.lock\.json|deno\.lock)$",
);
/// PRIOR_KEYWORD_RE: every test or generated rule needs one of these substrings.
const PRIOR_KEYWORD: &str = r"(?i-u)test|spec|fixture|mock|e2e|pb2?[._]|generated|vendor|dist/|build/|node_modules|\.min\.|lock|shrinkwrap|go\.sum|\.resolved$";

static GENERATED_PATH_RE: OnceLock<Regex> = OnceLock::new();
static PRIOR_KEYWORD_RE: OnceLock<Regex> = OnceLock::new();

/// prior 1
pub const SCALE_SOURCE: f64 = 16.0;
/// prior 0.5
pub const SCALE_TEST: f64 = 4.0;
/// prior 0.25
pub const SCALE_GENERATED: f64 = 1.0;

// Mirrors: core/search/grep-output-shaping.js:priorScale
/// 16 x prior^2 of a path: 16 source, 4 test, 1 generated.
pub fn prior_scale(file: &str) -> f64 {
    if !static_re(&PRIOR_KEYWORD_RE, PRIOR_KEYWORD).is_match(file) {
        return SCALE_SOURCE;
    }
    if static_re(&GENERATED_PATH_RE, GENERATED_PATH).is_match(file) {
        return SCALE_GENERATED;
    }
    if is_test_like_path(file) {
        SCALE_TEST
    } else {
        SCALE_SOURCE
    }
}

static BLOB_RUN_RE: OnceLock<Regex> = OnceLock::new();

// Mirrors: core/search/grep-output-shaping.js:isBlobLine
/// A hit line that is mostly one machine token (hash, base64 or hex blob of 40+ chars).
pub fn is_blob_line(text: &str) -> bool {
    let t = trim_js(text);
    let t_len = len16(t);
    if t_len < 40 {
        return false;
    }
    // BLOB_RUN_RE = /[A-Za-z0-9+/=_-]{40,}/g; the first strictly longest run.
    let mut longest = "";
    for m in static_re(&BLOB_RUN_RE, r"[A-Za-z0-9+/=_\-]{40,}").find_iter(t) {
        if m.as_str().len() > longest.len() {
            longest = m.as_str();
        }
    }
    // The run is ASCII: bytes = UTF-16 units.
    if longest.len() * 2 < t_len {
        return false;
    }
    let digits = longest.bytes().filter(u8::is_ascii_digit).count();
    // `[a-z]{7,}` runs, any with a letter in g-z.
    let mut wordy = false;
    let bytes = longest.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_lowercase() {
            let s = i;
            let mut late = false;
            while i < bytes.len() && bytes[i].is_ascii_lowercase() {
                if bytes[i] >= b'g' {
                    late = true;
                }
                i += 1;
            }
            if i - s >= 7 && late {
                wordy = true;
                break;
            }
        } else {
            i += 1;
        }
    }
    digits * 10 >= longest.len() && bytes.iter().any(u8::is_ascii_alphabetic) && !wordy
}

/// The fewest hits that make a file a blob file.
pub const BLOB_MIN_HITS: u64 = 3;

// Mirrors: core/search/grep-output-shaping.js:groupScale
/// The scale of the group matches[start..end): its path prior, or the generated prior when it
/// has BLOB_MIN_HITS hits or more, every one a blob line, and every hit seen (`total`).
pub fn group_scale(file: &str, matches: &[GrepRow], start: usize, end: usize, total: Option<u64>) -> f64 {
    let scale = prior_scale(file);
    if scale == SCALE_GENERATED {
        return scale;
    }
    let mut n: u64 = 0;
    let mut j = start;
    while j < end {
        let Some(m) = matches.get(j) else { break };
        if m.file != file {
            break;
        }
        // `m.content ?? m.matchText`: rows always carry `content` (see GrepRow).
        if !is_blob_line(&m.content) {
            return scale;
        }
        n += 1;
        j += 1;
    }
    if n >= BLOB_MIN_HITS && total.is_none_or(|t| n >= t) {
        SCALE_GENERATED
    } else {
        scale
    }
}

// Mirrors: core/search/grep-output-shaping.js:grepFilePrior (the scale -> prior step, also inline
// in selectGrepFilesByWeight's drain)
fn prior_of_scale(scale: f64) -> f64 {
    if scale == SCALE_SOURCE {
        1.0
    } else if scale == SCALE_TEST {
        0.5
    } else {
        0.25
    }
}

// Mirrors: core/search/grep-output-shaping.js:grepFilePrior
/// The file-type prior of a match path: 1 source, 0.5 test/spec/fixture, 0.25 generated.
pub fn grep_file_prior(file: &str) -> f64 {
    prior_of_scale(prior_scale(file))
}

// --- grep-allocation-rules.js ----------------------------------------------------------------

// Mirrors: core/search/grep-allocation-rules.js:GREP_WEIGHTS
/// The SS_FIX_GREP_WEIGHT values.
pub const GREP_WEIGHTS: [&str; 2] = ["sqrt", "sat2"];
// Mirrors: core/search/grep-allocation-rules.js:GREP_ALLOC_RULES
/// The SS_FIX_GREP_ALLOC_RULE values.
pub const GREP_ALLOC_RULES: [&str; 3] = ["sl", "guarantee", "hh"];

// Mirrors: core/search/grep-allocation-rules.js:grepWeightKey
/// 16 x weight^2 of a file with `hits` matches and prior scale `scale`; `sat2` = hits/(hits+2).
pub fn grep_weight_key(hits: f64, scale: f64, sat2: bool) -> f64 {
    if sat2 {
        return (scale * hits * hits) / ((hits + 2.0) * (hits + 2.0));
    }
    hits * scale
}

/// SS_FIX_GREP_ALLOC_RULE values that take the first-line pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AllocRule {
    /// one line per kept file first, then Sainte-Laguë
    Guarantee,
    /// one line per kept file first, then Huntington-Hill
    Hh,
}

// Mirrors: core/search/grep-allocation-rules.js:allocateGrepLinesWithFirstLine
/// Each file with stored matches gets one line in input order until the budget runs out; the
/// rest go by the rule's divisor. PRECONDITION: files in weight order; `keys`, `totals` and
/// `caps` have one entry per file (same length).
pub fn allocate_grep_lines_with_first_line(keys: &[f64], totals: &[f64], caps: &[i64], budget: i64, rule: AllocRule) -> Vec<i64> {
    let n = keys.len();
    let mut alloc = vec![0i64; n];
    let mut remaining = budget.max(0);
    let mut heap: Vec<usize> = Vec::new();
    let mut f = 0;
    while f < n && remaining > 0 {
        if caps[f] > 0 {
            alloc[f] = 1;
            remaining -= 1;
            if caps[f] > 1 {
                heap.push(f);
            }
        }
        f += 1;
    }
    let mut size = heap.len();
    if remaining == 0 || size == 0 {
        return alloc;
    }
    let hh = rule == AllocRule::Hh;
    let d2 = |a: i64| -> f64 {
        let a = a as f64;
        if hh {
            a * (a + 1.0)
        } else {
            (2.0 * a + 1.0) * (2.0 * a + 1.0)
        }
    };
    let better = |alloc: &[i64], a: usize, b: usize| -> bool {
        let lhs = keys[a] * d2(alloc[b]);
        let rhs = keys[b] * d2(alloc[a]);
        lhs > rhs || (lhs == rhs && (totals[a] > totals[b] || (totals[a] == totals[b] && a < b)))
    };
    let sift_down = |heap: &mut [usize], size: usize, alloc: &[i64], mut pos: usize| {
        let f = heap[pos];
        loop {
            let mut child = 2 * pos + 1;
            if child >= size {
                break;
            }
            if child + 1 < size && better(alloc, heap[child + 1], heap[child]) {
                child += 1;
            }
            if !better(alloc, heap[child], f) {
                break;
            }
            heap[pos] = heap[child];
            pos = child;
        }
        heap[pos] = f;
    };
    let mut pos = (size >> 1) as isize - 1;
    while pos >= 0 {
        sift_down(&mut heap, size, &alloc, pos as usize);
        pos -= 1;
    }
    while remaining > 0 && size > 0 {
        let f = heap[0];
        alloc[f] += 1;
        remaining -= 1;
        if alloc[f] < caps[f] {
            sift_down(&mut heap, size, &alloc, 0);
        } else {
            size -= 1;
            heap[0] = heap[size];
            if size > 0 {
                sift_down(&mut heap, size, &alloc, 0);
            }
        }
    }
    alloc
}

// Mirrors: core/search/grep-output-shaping.js:allocateGrepLinesSainteLague
/// Sainte-Laguë: each next line to the file with the largest weight / (2 x lines + 1), never
/// beyond `caps`. PRECONDITION: files in weight order (key desc, hits desc, path asc); `keys`,
/// `totals` and `caps` have one entry per file (same length).
pub fn allocate_grep_lines_sainte_lague(keys: &[f64], totals: &[f64], caps: &[i64], budget: i64) -> Vec<i64> {
    let n = keys.len();
    let mut alloc = vec![0i64; n];
    let mut remaining = budget.max(0);
    if n == 0 || remaining == 0 {
        return alloc;
    }
    let mut heap: Vec<usize> = vec![0; n.min(remaining as usize) + 1];
    let mut size = 0usize;
    let mut next = 0usize;
    // q_a > q_b <=> keys[a] (2 alloc[b] + 1)^2 > keys[b] (2 alloc[a] + 1)^2
    let better = |alloc: &[i64], a: usize, b: usize| -> bool {
        let da = 2.0 * alloc[a] as f64 + 1.0;
        let db = 2.0 * alloc[b] as f64 + 1.0;
        let lhs = keys[a] * db * db;
        let rhs = keys[b] * da * da;
        lhs > rhs || (lhs == rhs && (totals[a] > totals[b] || (totals[a] == totals[b] && a < b)))
    };
    let sift_up = |heap: &mut [usize], alloc: &[i64], mut pos: usize| {
        let f = heap[pos];
        while pos > 0 {
            let parent = (pos - 1) >> 1;
            if !better(alloc, f, heap[parent]) {
                break;
            }
            heap[pos] = heap[parent];
            pos = parent;
        }
        heap[pos] = f;
    };
    let sift_down = |heap: &mut [usize], size: usize, alloc: &[i64], mut pos: usize| {
        let f = heap[pos];
        loop {
            let mut child = 2 * pos + 1;
            if child >= size {
                break;
            }
            if child + 1 < size && better(alloc, heap[child + 1], heap[child]) {
                child += 1;
            }
            if !better(alloc, heap[child], f) {
                break;
            }
            heap[pos] = heap[child];
            pos = child;
        }
        heap[pos] = f;
    };
    let push_frontier = |heap: &mut Vec<usize>, size: &mut usize, next: &mut usize, alloc: &[i64]| {
        while *next < n && caps[*next] <= 0 {
            *next += 1;
        }
        if *next < n {
            if *size >= heap.len() {
                heap.push(0);
            }
            heap[*size] = *next;
            *next += 1;
            sift_up(heap, alloc, *size);
            *size += 1;
        }
    };
    push_frontier(&mut heap, &mut size, &mut next, &alloc);
    while remaining > 0 && size > 0 {
        let f = heap[0];
        let first = alloc[f] == 0;
        alloc[f] += 1;
        remaining -= 1;
        if alloc[f] < caps[f] {
            sift_down(&mut heap, size, &alloc, 0);
        } else {
            size -= 1;
            heap[0] = heap[size];
            if size > 0 {
                sift_down(&mut heap, size, &alloc, 0);
            }
        }
        if first {
            push_frontier(&mut heap, &mut size, &mut next, &alloc);
        }
    }
    alloc
}

// Mirrors: core/search/grep-output-shaping.js:allocateGrepBudget
/// Breadth-first round robin: one line per file per round, in the given order.
pub fn allocate_grep_budget(counts: &[i64], budget: i64) -> Vec<i64> {
    let mut alloc = vec![0i64; counts.len()];
    let mut remaining = budget.max(0);
    let mut progressed = true;
    while remaining > 0 && progressed {
        progressed = false;
        let mut i = 0;
        while i < counts.len() && remaining > 0 {
            if alloc[i] < counts[i] {
                alloc[i] += 1;
                remaining -= 1;
                progressed = true;
            }
            i += 1;
        }
    }
    alloc
}

// --- grep-line-classes.js ----------------------------------------------------------------------

// Mirrors: core/search/grep-line-classes.js:isCommentLine
/// Comment shape by its first characters: `//`, `/*`, `*`, or `#` + space / tab / end.
pub fn is_comment_line(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    let mut chars = text.chars().skip_while(|&c| c == ' ' || c == '\t');
    let Some(c) = chars.next() else { return false };
    if c == '*' {
        return true;
    }
    let d = chars.next();
    if c == '/' {
        return d == Some('/') || d == Some('*');
    }
    if c == '#' {
        return d.is_none() || d == Some(' ') || d == Some('\t');
    }
    false
}

// Mirrors: core/search/grep-line-classes.js:selectGrepLinesByClass
/// Indices into `ms` of the `a` matches a file shows: lowest (class, line) first, returned in
/// line order. None when `a >= ms.len()` or any row lacks a class (keep the prefix).
pub fn select_grep_lines_by_class(ms: &[GrepRow], a: usize, spread: bool) -> Option<Vec<usize>> {
    let refs: Vec<&GrepRow> = ms.iter().collect();
    select_lines_by_class_refs(&refs, a, spread)
}

pub(crate) fn select_lines_by_class_refs(ms: &[&GrepRow], a: usize, spread: bool) -> Option<Vec<usize>> {
    if a >= ms.len() {
        return None;
    }
    let mut symbols = spread;
    for m in ms {
        m.line_class?;
        if symbols && m.line_symbol.is_none() {
            symbols = false;
        }
    }
    let class = |j: usize| ms[j].line_class.unwrap_or(0);
    let mut idx: Vec<usize> = (0..ms.len()).collect();
    idx.sort_by(|&x, &y| class(x).cmp(&class(y)).then(ms[x].line.cmp(&ms[y].line)).then(x.cmp(&y)));
    let mut picked: Vec<usize>;
    if symbols {
        picked = Vec::new();
        let mut picked_symbols: HashSet<i64> = HashSet::new();
        let mut picked_rows = vec![false; ms.len()];
        let mut t = 0;
        while t < idx.len() && picked.len() < a {
            let j = idx[t];
            t += 1;
            let sym = ms[j].line_symbol.unwrap_or(-1);
            if class(j) > 1 || sym < 0 {
                continue;
            }
            if picked_symbols.contains(&sym) {
                continue;
            }
            // `ms[j].content ?? ms[j].text`: rows always carry `content`.
            if is_comment_line(&ms[j].content) {
                continue;
            }
            picked_symbols.insert(sym);
            picked_rows[j] = true;
            picked.push(j);
        }
        let mut t = 0;
        while t < idx.len() && picked.len() < a {
            if !picked_rows[idx[t]] {
                picked.push(idx[t]);
            }
            t += 1;
        }
    } else {
        picked = idx[..a].to_vec();
    }
    picked.sort_by(|&x, &y| ms[x].line.cmp(&ms[y].line).then(x.cmp(&y)));
    Some(picked)
}

// --- file selection ------------------------------------------------------------------------

/// Options of applyGrepFileDiversity / selectGrepFilesByWeight.
#[derive(Clone, Debug, Default)]
pub struct DiversityOpts<'a> {
    /// `perFileCap` (at least 1 is used).
    pub per_file_cap: i64,
    /// `maxFiles`; 0 or less = unbounded (JS Infinity).
    pub max_files: i64,
    /// `hiddenSampleSize`; None = 3.
    pub hidden_sample_size: Option<usize>,
    /// `order: 'weight'`.
    pub order_weight: bool,
    /// `weight: 'sat2'`.
    pub weight_sat2: bool,
    /// `totals`: each file's full match count (lookups only, so map order never matters).
    pub totals: Option<&'a HashMap<String, u64>>,
}

/// `{ kept, fileSummary }`; `kept` = indices into the input `matches`, in output order.
#[derive(Clone, Debug, PartialEq)]
pub struct Diversity {
    pub kept: Vec<usize>,
    pub file_summary: FileSummary,
}

// Mirrors: core/search/grep-output-shaping.js:applyGrepFileDiversity
/// Streaming per-file diversification of a file-grouped match list (legacy walk), or the
/// weighted selection with `order_weight`. PRECONDITION: matches grouped by file.
pub fn apply_grep_file_diversity(matches: &[GrepRow], opts: &DiversityOpts) -> Option<Diversity> {
    if opts.order_weight {
        return select_grep_files_by_weight(matches, opts);
    }
    let per_file_cap = opts.per_file_cap.max(1);
    let max_files: Option<usize> = if opts.max_files > 0 { Some(opts.max_files as usize) } else { None };
    let hidden_sample_size = opts.hidden_sample_size.unwrap_or(3);

    // (file, total, kept) with kept -1 = hidden file (count only).
    struct Cur {
        file: String,
        total: u64,
        kept: i64,
    }
    let mut kept: Vec<usize> = Vec::new();
    let mut files: Vec<Cur> = Vec::new();
    // Where `current` lives: Some((true, i)) = files[i], Some((false, i)) = hidden[i].
    let mut hidden: Vec<Cur> = Vec::new();
    let mut hidden_sample: Vec<usize> = Vec::new(); // indices into `hidden`
    let mut hidden_file_count: u64 = 0;
    let mut hidden_match_count: u64 = 0;
    let totals = opts.totals;
    let mut current: Option<(bool, usize)> = None;
    for (mi, m) in matches.iter().enumerate() {
        let same = match current {
            Some((true, i)) => files[i].file == m.file,
            Some((false, i)) => hidden[i].file == m.file,
            None => false,
        };
        if !same {
            if max_files.is_none_or(|mf| files.len() < mf) {
                files.push(Cur { file: m.file.clone(), total: 0, kept: 0 });
                current = Some((true, files.len() - 1));
            } else {
                hidden.push(Cur { file: m.file.clone(), total: 0, kept: -1 });
                current = Some((false, hidden.len() - 1));
                hidden_file_count += 1;
                if hidden_sample.len() < hidden_sample_size {
                    hidden_sample.push(hidden.len() - 1);
                }
            }
            if let Some(t) = totals {
                let c = match current {
                    Some((true, i)) => &mut files[i],
                    Some((false, i)) => &mut hidden[i],
                    None => return None,
                };
                c.total = t.get(&m.file).copied().unwrap_or(0);
                if c.kept < 0 {
                    hidden_match_count += c.total;
                }
            }
        }
        let c = match current {
            Some((true, i)) => &mut files[i],
            Some((false, i)) => &mut hidden[i],
            None => return None,
        };
        if totals.is_none() {
            c.total += 1;
        }
        if c.kept >= 0 && c.kept < per_file_cap {
            kept.push(mi);
            c.kept += 1;
        } else if c.kept < 0 && totals.is_none() {
            hidden_match_count += 1;
        }
    }
    Some(Diversity {
        kept,
        file_summary: FileSummary {
            files: files
                .iter()
                .map(|c| SummaryFile { file: c.file.clone(), total: c.total, kept: c.kept.max(0) as u64, prior: None })
                .collect(),
            hidden_file_count,
            hidden_match_count,
            hidden_sample: hidden_sample
                .iter()
                .map(|&h| HiddenFile { file: hidden[h].file.clone(), total: hidden[h].total })
                .collect(),
            order: None,
            weight: None,
        },
    })
}

/// One file of the selection heap / hidden sample: (key, hits, start offset).
#[derive(Clone, Copy, Debug, Default)]
struct Slot {
    key: f64,
    tot: u64,
    ord: usize,
}

// Mirrors: core/search/grep-output-shaping.js:betterFile
/// a better than b: larger key, then more hits, then earlier in path order.
fn better_file(a: Slot, b: Slot) -> bool {
    a.key > b.key || (a.key == b.key && (a.tot > b.tot || (a.tot == b.tot && a.ord < b.ord)))
}

// Mirrors: core/search/grep-output-shaping.js:fileHeapSiftDown
fn file_heap_sift_down(h: &mut [Slot], size: usize, mut pos: usize) {
    let item = h[pos];
    loop {
        let mut c = 2 * pos + 1;
        if c >= size {
            break;
        }
        if c + 1 < size && better_file(h[c], h[c + 1]) {
            c += 1;
        }
        if !better_file(item, h[c]) {
            break;
        }
        h[pos] = h[c];
        pos = c;
    }
    h[pos] = item;
}

// Mirrors: core/search/grep-output-shaping.js:fileHeapPush
fn file_heap_push(h: &mut Vec<Slot>, size: usize, item: Slot) {
    if h.len() <= size {
        h.resize(size + 1, Slot::default());
    }
    let mut pos = size;
    while pos > 0 {
        let p = (pos - 1) >> 1;
        if !better_file(h[p], item) {
            break;
        }
        h[pos] = h[p];
        pos = p;
    }
    h[pos] = item;
}

// Mirrors: core/search/grep-output-shaping.js:sampleInsert
/// Insert into the best-first hidden sample `s` (at most `max` files); returns the new length.
fn sample_insert(s: &mut [Slot], len: usize, max: usize, item: Slot) -> usize {
    if max == 0 {
        return len;
    }
    let mut pos = if len < max { len } else { max - 1 };
    if len == max && !better_file(item, s[pos]) {
        return len;
    }
    while pos > 0 && better_file(item, s[pos - 1]) {
        s[pos] = s[pos - 1];
        pos -= 1;
    }
    s[pos] = item;
    if len < max {
        len + 1
    } else {
        len
    }
}

// Mirrors: core/search/grep-output-shaping.js:selectGrepFilesByWeight
/// Streaming top-maxFiles file selection by weight over a file-grouped match list. Files come
/// back best first, each with its prior; kept grouped per file in that order.
pub fn select_grep_files_by_weight(matches: &[GrepRow], opts: &DiversityOpts) -> Option<Diversity> {
    let sat = opts.weight_sat2;
    let per_file_cap = opts.per_file_cap.max(1) as u64;
    let max_files: Option<usize> = if opts.max_files > 0 { Some(opts.max_files as usize) } else { None };
    let sample_size = opts.hidden_sample_size.unwrap_or(3);
    let n = matches.len();
    let key_of = |total: u64, scale: f64| -> f64 {
        if sat {
            grep_weight_key(total as f64, scale, true)
        } else {
            total as f64 * scale
        }
    };

    let mut heap: Vec<Slot> = Vec::new();
    let mut size = 0usize;
    let mut sample = vec![Slot::default(); sample_size.max(1)];
    let mut sample_len = 0usize;
    let mut hidden_file_count: u64 = 0;
    let mut hidden_match_count: u64 = 0;
    let totals = opts.totals;

    let mut i = 0usize;
    while i < n {
        let start = i;
        let file = matches[i].file.as_str();
        i += 1;
        while i < n && matches[i].file == file {
            i += 1;
        }
        let total: u64 = match totals {
            Some(t) => t.get(file).copied().unwrap_or(0),
            None => (i - start) as u64,
        };
        let bound = key_of(total, SCALE_SOURCE);
        if max_files == Some(size) && bound <= heap[0].key {
            // Cannot beat the worst kept file.
            hidden_file_count += 1;
            hidden_match_count += total;
            if sample_len < sample_size || (sample_size > 0 && bound > sample[sample_size - 1].key) {
                let scale = group_scale(file, matches, start, i, Some(total));
                sample_len = sample_insert(&mut sample, sample_len, sample_size, Slot { key: key_of(total, scale), tot: total, ord: start });
            }
            continue;
        }
        let file_scale = group_scale(file, matches, start, i, Some(total));
        let entry = Slot { key: key_of(total, file_scale), tot: total, ord: start };
        if max_files.is_none_or(|mf| size < mf) {
            file_heap_push(&mut heap, size, entry);
            size += 1;
            continue;
        }
        hidden_file_count += 1;
        if better_file(entry, heap[0]) {
            let out = heap[0];
            heap[0] = entry;
            file_heap_sift_down(&mut heap, size, 0);
            hidden_match_count += out.tot;
            sample_len = sample_insert(&mut sample, sample_len, sample_size, out);
        } else {
            hidden_match_count += total;
            sample_len = sample_insert(&mut sample, sample_len, sample_size, entry);
        }
    }

    // Drain the heap worst-first into the tail: files[] ends up best first.
    let mut files: Vec<SummaryFile> = vec![SummaryFile::default(); size];
    let mut ords: Vec<usize> = vec![0; size];
    while size > 0 {
        let last = size - 1;
        let top = heap[0];
        heap[0] = heap[last];
        size = last;
        if size > 0 {
            file_heap_sift_down(&mut heap, size, 0);
        }
        ords[last] = top.ord;
        let file = &matches.get(top.ord)?.file;
        let scale = if sat {
            group_scale(file, matches, top.ord, top.ord.saturating_add(top.tot as usize), Some(top.tot))
        } else {
            top.key / top.tot as f64
        };
        files[last] = SummaryFile { file: file.clone(), total: top.tot, kept: top.tot.min(per_file_cap), prior: Some(prior_of_scale(scale)) };
    }
    let mut kept: Vec<usize> = Vec::new();
    for (f, sf) in files.iter().enumerate() {
        let end = ords[f] + sf.kept as usize;
        for j in ords[f]..end {
            // The input must hold at least the kept rows of each file (the JS would read the
            // next file's rows): decline.
            if matches.get(j).map(|m| &m.file) != Some(&sf.file) {
                return None;
            }
            kept.push(j);
        }
    }
    let mut hidden_sample = Vec::with_capacity(sample_len);
    for s in &sample[..sample_len] {
        hidden_sample.push(HiddenFile { file: matches.get(s.ord)?.file.clone(), total: s.tot });
    }
    Some(Diversity {
        kept,
        file_summary: FileSummary {
            files,
            hidden_file_count,
            hidden_match_count,
            hidden_sample,
            order: Some("weight".to_string()),
            weight: if sat { Some("sat2".to_string()) } else { None },
        },
    })
}

// --- body ------------------------------------------------------------------------------------

/// renderGrepBody options (all absent = the original format).
#[derive(Clone, Debug, Default)]
pub struct BodyOpts {
    /// `alloc: 'weight'`
    pub alloc_weight: bool,
    /// `weight: 'sat2'`
    pub weight_sat2: bool,
    /// `rule: 'guarantee' | 'hh'`; None = Sainte-Laguë.
    pub rule: Option<AllocRule>,
    /// `lineClasses: true`
    pub line_classes: bool,
    /// `lineSpread: true`
    pub line_spread: bool,
    /// `fullLine: true`
    pub full_line: bool,
    /// `dropRepeatedText: true`
    pub drop_repeated_text: bool,
    /// `hitMax` (grepBroadHitMax); None or Some(0) = the default window.
    pub hit_max: Option<usize>,
}

/// One printed hit: `{ file, line, text, more }`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct BodyRow {
    pub file: String,
    pub line: u32,
    pub text: String,
    /// Hits of the file not shown, on its last shown row (0 elsewhere).
    pub more: u64,
}

/// `{ files, matches, sample }` of the hidden files.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Hidden {
    pub files: u64,
    pub matches: u64,
    pub sample: Vec<String>,
}

/// renderGrepBody's result.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GrepBody {
    /// The pre-2026-10-04 flat form `file:line: text (+N more in this file)`.
    pub lines: Vec<String>,
    pub rows: Vec<BodyRow>,
    pub shown_matches: u64,
    pub matched_file_count: u64,
    pub truncated_file_count: u64,
    /// The flat-form hidden line.
    pub hidden_line: Option<String>,
    pub hidden: Option<Hidden>,
}

/// One file of the weighted order: `{ file, total, kept, prior }`.
#[derive(Clone, Debug)]
struct OrderFile {
    file: String,
    total: u64,
    kept: u64,
    prior: Option<f64>,
}

// Mirrors: core/search/grep-output-shaping.js:renderGrepBody (its `groups` Map)
/// File -> its rows (indices into `kept`), in first-appearance order (a JS Map).
struct Groups {
    order: Vec<(String, Vec<usize>)>,
    index: HashMap<String, usize>,
}

impl Groups {
    fn build(kept: &[GrepRow]) -> Groups {
        let mut g = Groups { order: Vec::new(), index: HashMap::new() };
        for (i, m) in kept.iter().enumerate() {
            match g.index.get(&m.file) {
                Some(&at) => g.order[at].1.push(i),
                None => {
                    g.index.insert(m.file.clone(), g.order.len());
                    g.order.push((m.file.clone(), vec![i]));
                }
            }
        }
        g
    }
    fn get(&self, file: &str) -> Option<&Vec<usize>> {
        self.index.get(file).map(|&i| &self.order[i].1)
    }
}

/// grepHitText as an exact JS string; None when it holds a lone surrogate (a 140-unit cut of
/// the matched text through an astral char): Node prints it as U+FFFD, but two such texts can
/// compare unequal in JS and equal here, so the body declines.
fn hit_text_exact(m: &GrepRow, full_line: bool, hit_max: Option<usize>) -> Option<String> {
    let max = match hit_max {
        Some(x) if x > 0 => x as i64,
        _ => crate::render::GREP_HIT_TEXT_MAX as i64,
    };
    let units = grep_hit_units(m, full_line, max);
    String::from_utf16(&units).ok()
}

// Mirrors: core/search/grep-output-shaping.js:renderGrepBody
/// The diversified body: rows per file, `more` on the last shown row of a truncated file, and
/// the hidden files. PRECONDITION: `kept` grouped by file (engine order). None = decline.
pub fn render_grep_body(kept: &[GrepRow], file_summary: &FileSummary, k: i64, opts: &BodyOpts) -> Option<GrepBody> {
    if opts.alloc_weight {
        return render_grep_body_weighted(kept, file_summary, k, opts);
    }
    let groups = Groups::build(kept);
    // new Map(files.map(f => [f.file, f.total])): a later duplicate wins.
    let mut totals: HashMap<&str, u64> = HashMap::new();
    for f in &file_summary.files {
        totals.insert(f.file.as_str(), f.total);
    }
    let counts: Vec<i64> = groups.order.iter().map(|(_, ms)| ms.len() as i64).collect();
    let alloc = allocate_grep_budget(&counts, k);

    let mut rows = Vec::new();
    let mut shown_matches = 0u64;
    let mut truncated_file_count = 0u64;
    let mut unallocated: Vec<(String, u64)> = Vec::new();
    for (i, (file, ms)) in groups.order.iter().enumerate() {
        let total = totals.get(file.as_str()).copied().unwrap_or(ms.len() as u64);
        if alloc[i] == 0 {
            unallocated.push((file.clone(), total));
            continue;
        }
        let a = alloc[i] as u64;
        for j in 0..alloc[i] as usize {
            let m = &kept[ms[j]];
            let text = hit_text_exact(m, opts.full_line, opts.hit_max)?;
            let mut more = 0;
            if j as u64 == a - 1 && total > a {
                more = total - a;
                truncated_file_count += 1;
            }
            rows.push(BodyRow { file: file.clone(), line: m.line, text, more });
            shown_matches += 1;
        }
    }
    Some(finish_grep_body(rows, unallocated, file_summary, shown_matches, truncated_file_count, opts))
}

// Mirrors: core/search/grep-output-shaping.js:renderGrepBodyWeighted
fn render_grep_body_weighted(kept: &[GrepRow], file_summary: &FileSummary, k: i64, opts: &BodyOpts) -> Option<GrepBody> {
    let summary_files = &file_summary.files;
    let weight_sat2 = opts.weight_sat2;
    let summary_weight_matches = match &file_summary.weight {
        Some(w) => weight_sat2 && w == "sat2",
        None => !weight_sat2,
    };
    // Fast path: the engine already handed files in this weight's order, kept contiguous per file.
    let mut order: Option<Vec<OrderFile>> = None;
    let mut groups: Option<Groups> = None;
    if file_summary.order.as_deref() == Some("weight") && summary_weight_matches {
        let mut off = 0usize;
        let mut contiguous = true;
        for f in summary_files {
            if f.kept > 0 && kept.get(off).map(|m| &m.file) != Some(&f.file) {
                contiguous = false;
                break;
            }
            off += f.kept as usize;
        }
        if contiguous && off == kept.len() {
            order = Some(
                summary_files
                    .iter()
                    .map(|f| OrderFile { file: f.file.clone(), total: f.total, kept: f.kept, prior: f.prior })
                    .collect(),
            );
        }
    }
    let mut order = match order {
        Some(o) => o,
        None => {
            // Anything else: group, weigh, sort.
            let g = Groups::build(kept);
            let listed: HashSet<&str> = summary_files.iter().map(|f| f.file.as_str()).collect();
            let mut pool: Vec<(OrderFile, usize)> = summary_files
                .iter()
                .enumerate()
                .map(|(idx, f)| {
                    let kept_n = g.get(&f.file).map_or(0, |ms| ms.len() as u64);
                    (OrderFile { file: f.file.clone(), total: f.total, kept: kept_n, prior: None }, idx)
                })
                .collect();
            for (file, ms) in &g.order {
                if !listed.contains(file.as_str()) {
                    let idx = pool.len();
                    pool.push((OrderFile { file: file.clone(), total: ms.len() as u64, kept: ms.len() as u64, prior: None }, idx));
                }
            }
            for (f, _) in pool.iter_mut() {
                f.prior = Some(grep_file_prior(&f.file));
            }
            let key_of = |f: &OrderFile| {
                let p = f.prior.unwrap_or(1.0);
                grep_weight_key(f.total as f64, p * p * SCALE_SOURCE, weight_sat2)
            };
            // keyOf(b) - keyOf(a) || b.total - a.total || a.idx - b.idx
            pool.sort_by(|(a, ai), (b, bi)| {
                let d = key_of(b) - key_of(a);
                if d != 0.0 && !d.is_nan() {
                    return if d < 0.0 { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
                }
                let t = b.total as f64 - a.total as f64;
                if t != 0.0 {
                    return if t < 0.0 { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
                }
                ai.cmp(bi)
            });
            groups = Some(g);
            pool.into_iter().map(|(f, _)| f).collect()
        }
    };
    // Files with a row that defines the pattern's identifier list first.
    let mut defining: HashSet<&str> = HashSet::new();
    for m in kept {
        if m.defines {
            defining.insert(m.file.as_str());
        }
    }
    if !defining.is_empty() {
        if groups.is_none() {
            groups = Some(Groups::build(kept));
        }
        let (mut first, rest): (Vec<OrderFile>, Vec<OrderFile>) =
            order.into_iter().partition(|f| defining.contains(f.file.as_str()));
        first.extend(rest);
        order = first;
    }

    let n = order.len();
    let mut keys = vec![0f64; n];
    let mut totals = vec![0f64; n];
    let mut caps = vec![0i64; n];
    for f in 0..n {
        let p = order[f].prior.unwrap_or(1.0);
        totals[f] = order[f].total as f64;
        keys[f] = grep_weight_key(order[f].total as f64, p * p * SCALE_SOURCE, weight_sat2);
        caps[f] = order[f].kept as i64;
    }
    if !defining.is_empty() {
        let mut top = 0f64;
        for &key in &keys {
            if key > top {
                top = key;
            }
        }
        for f in 0..n {
            if defining.contains(order[f].file.as_str()) {
                keys[f] = top + 1.0;
            }
        }
    }
    let alloc = match opts.rule {
        Some(rule) => allocate_grep_lines_with_first_line(&keys, &totals, &caps, k, rule),
        None => allocate_grep_lines_sainte_lague(&keys, &totals, &caps, k),
    };

    let mut rows = Vec::new();
    let mut shown_matches = 0u64;
    let mut truncated_file_count = 0u64;
    let mut off = 0usize;
    let mut unallocated: Vec<(String, u64)> = Vec::new();
    for f in 0..n {
        let file = &order[f].file;
        let total = order[f].total;
        let ms: Option<&Vec<usize>> = groups.as_ref().and_then(|g| g.get(file));
        let base = off;
        off += caps[f].max(0) as usize;
        let a = alloc[f];
        if a == 0 {
            unallocated.push((file.clone(), total));
            continue;
        }
        let a = a as usize;
        // The rows the file can show: its group, or its slice of `kept` (JS slice clamps).
        let cands: Vec<&GrepRow> = match ms {
            Some(ms) => ms.iter().map(|&i| &kept[i]).collect(),
            None => {
                let end = (base + caps[f].max(0) as usize).min(kept.len());
                kept.get(base.min(end)..end).map(|s| s.iter().collect()).unwrap_or_default()
            }
        };
        let picks = if opts.line_classes && (a as i64) < caps[f] {
            select_lines_by_class_refs(&cands, a, opts.line_spread)
        } else {
            None
        };
        for j in 0..a {
            let at = match &picks {
                Some(p) => p[j],
                None => j,
            };
            // A row past the input is a JS TypeError: decline.
            let m: &GrepRow = cands.get(at)?;
            let text = hit_text_exact(m, opts.full_line, opts.hit_max)?;
            let mut more = 0;
            if j == a - 1 && total > a as u64 {
                more = total - a as u64;
                truncated_file_count += 1;
            }
            rows.push(BodyRow { file: file.clone(), line: m.line, text, more });
            shown_matches += 1;
        }
    }
    Some(finish_grep_body(rows, unallocated, file_summary, shown_matches, truncated_file_count, opts))
}

// Mirrors: core/search/grep-output-shaping.js:finishGrepBody
fn finish_grep_body(
    rows: Vec<BodyRow>,
    unallocated: Vec<(String, u64)>,
    file_summary: &FileSummary,
    shown_matches: u64,
    truncated_file_count: u64,
    opts: &BodyOpts,
) -> GrepBody {
    let drop_text = opts.drop_repeated_text && rows.len() > 1 && rows.iter().all(|r| r.text == rows[0].text);
    let lines = rows
        .iter()
        .map(|row| {
            let mut line = if drop_text {
                format!("{}:{}", row.file, row.line)
            } else {
                format!("{}:{}: {}", row.file, row.line, row.text)
            };
            if row.more > 0 {
                line.push_str(&format!(" (+{} more in this file)", row.more));
            }
            line
        })
        .collect();
    let hidden_files = unallocated.len() as u64 + file_summary.hidden_file_count;
    let hidden_matches = unallocated.iter().map(|(_, t)| *t).sum::<u64>() + file_summary.hidden_match_count;
    let sample: Vec<String> = unallocated
        .iter()
        .map(|(f, _)| f.clone())
        .chain(file_summary.hidden_sample.iter().map(|h| h.file.clone()))
        .take(3)
        .collect();
    let mut hidden_line = None;
    let mut hidden = None;
    if hidden_files > 0 {
        let eg = if sample.is_empty() { String::new() } else { format!(" — e.g. {}", sample.join(", ")) };
        hidden_line = Some(format!(
            "# +{hidden_files} more file(s) with {hidden_matches} match(es){eg}; narrow the regex, raise -k, or drill in with --in <file>"
        ));
        hidden = Some(Hidden { files: hidden_files, matches: hidden_matches, sample });
    }
    GrepBody {
        lines,
        rows,
        shown_matches,
        matched_file_count: file_summary.files.len() as u64 + file_summary.hidden_file_count,
        truncated_file_count,
        hidden_line,
        hidden,
    }
}
