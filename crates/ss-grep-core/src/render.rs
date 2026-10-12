//! ss-grep's printed text: hit text, the grouped listing, the hidden-files and outside-scope
//! lines, and the flood-mode line lists.
//!
//! Mirrors:
//! - core/search/agent-output-fixes.js (grepHitText, sliceWhole, grepBroadHitMax,
//!   matchTextIsRepeated, renderGrepLineLists, testFileQuota, typedPathLabel and the constants),
//! - core/search/grep-output-shaping.js (renderGrepListing, renderGrepFileBody,
//!   renderGrepHiddenFiles, GREP_HIDDEN_HINT, DOC_PATH_RE, fileInScopes,
//!   isOutsideScopeSourceFile, renderOutsideScopeProbeLine, renderOutsideScopeLine).
//!
//! Text is measured and cut in UTF-16 code units, as JS does.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

use regex::Regex;

use crate::shaping::{grep_file_prior, is_test_like_path, BodyRow, Hidden};
use crate::types::{GrepRow, SummaryFile};

pub const GREP_HIT_TEXT_MAX: usize = 140;
pub const GREP_BROAD_MIN_HITS: u64 = 50;
pub const GREP_BROAD_HIT_CHARS: usize = 80;
pub const GREP_COUNTS_THRESHOLD: u64 = 50;
pub const GREP_LINES_PER_FILE: usize = 3;
pub const GREP_TEST_FILE_SHARE: f64 = 0.3;
/// Chars of the line kept before the match when a long line is cut on the left.
const GREP_HIT_LEAD: i64 = 40;
const ELLIPSIS: u16 = 0x2026;

/// The one line that says how to see hidden hits (GREP_HIDDEN_HINT).
pub const GREP_HIDDEN_HINT: &str = "# hidden hits: raise -k or use --in <file>";

// --- UTF-16 helpers ----------------------------------------------------------------------------

/// JS `\s` on one code unit (WhiteSpace + LineTerminator; all BMP, never a surrogate).
fn is_ws_unit(u: u16) -> bool {
    matches!(u, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}

fn is_low_surrogate(u: u16) -> bool {
    (0xDC00..=0xDFFF).contains(&u)
}

/// `s.replace(/\s+/g, ' ')`
fn collapse_ws(s: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(s.len());
    let mut in_ws = false;
    for &u in s {
        if is_ws_unit(u) {
            if !in_ws {
                out.push(0x20);
            }
            in_ws = true;
        } else {
            out.push(u);
            in_ws = false;
        }
    }
    out
}

/// `s.trim()`
fn trim_units(s: &[u16]) -> &[u16] {
    let mut a = 0;
    let mut b = s.len();
    while a < b && is_ws_unit(s[a]) {
        a += 1;
    }
    while b > a && is_ws_unit(s[b - 1]) {
        b -= 1;
    }
    &s[a..b]
}

/// `s.slice(start, end)` with JS index rules (negative counts from the end, clamped).
fn js_slice(s: &[u16], start: i64, end: i64) -> Vec<u16> {
    let len = s.len() as i64;
    let norm = |x: i64| if x < 0 { (len + x).max(0) } else { x.min(len) };
    let (a, b) = (norm(start), norm(end));
    if a >= b {
        return Vec::new();
    }
    s[a as usize..b as usize].to_vec()
}

/// `s.charCodeAt(i)`, None for NaN (out of range).
fn code_at(s: &[u16], i: i64) -> Option<u16> {
    if i < 0 {
        return None;
    }
    s.get(i as usize).copied()
}

// Mirrors: core/search/agent-output-fixes.js:sliceWhole
/// line.slice(from, to) that never cuts a surrogate pair in half.
fn slice_whole(line: &[u16], mut from: i64, mut to: i64) -> Vec<u16> {
    if code_at(line, from).is_some_and(is_low_surrogate) {
        from += 1;
    }
    if to < line.len() as i64 && code_at(line, to).is_some_and(is_low_surrogate) {
        to -= 1;
    }
    js_slice(line, from, to)
}

fn index_of(hay: &[u16], needle: &[u16]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    if needle.len() > hay.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

// --- hit text ----------------------------------------------------------------------------------

// Mirrors: core/search/agent-output-fixes.js:grepBroadHitMax
/// The grepHitText `max` for a grep with `total` matches (None = the default window).
pub fn grep_broad_hit_max(total: u64) -> Option<usize> {
    grep_broad_hit_max_with(total, GREP_BROAD_MIN_HITS, GREP_BROAD_HIT_CHARS)
}

/// grepBroadHitMax with explicit thresholds.
pub fn grep_broad_hit_max_with(total: u64, min_hits: u64, chars: usize) -> Option<usize> {
    if total >= min_hits {
        Some(chars)
    } else {
        None
    }
}

#[allow(clippy::int_plus_one)] // `end <= max - 1` as the JS writes it
// Mirrors: core/search/agent-output-fixes.js:grepHitText
/// The text ss-grep prints for one hit, as UTF-16 units (exactly the JS string, which may end
/// in a lone surrogate when the 140-unit cut of the matched text splits an astral char).
pub(crate) fn grep_hit_units(m: &GrepRow, full_line: bool, max: i64) -> Vec<u16> {
    let mt_units: Vec<u16> = m.match_text.encode_utf16().collect();
    let matched = js_slice(trim_units(&collapse_ws(&mt_units)), 0, GREP_HIT_TEXT_MAX as i64);
    // `typeof content === 'string'`: rows always carry `content` (see GrepRow).
    let raw: Vec<u16> = if full_line { m.content.encode_utf16().collect() } else { Vec::new() };
    if trim_units(&raw).is_empty() {
        return matched;
    }
    let line: Vec<u16> = trim_units(&collapse_ws(&raw)).to_vec();
    // Where raw unit i lands in `line` (through it, for a whitespace unit), leading whitespace
    // dropped: the collapsed length of raw.slice(0, i or i + 1).
    let at = |i: i64| -> i64 {
        let ws_here = code_at(&raw, i).is_some_and(is_ws_unit);
        let p = if ws_here { i + 1 } else { i };
        let p = p.clamp(0, raw.len() as i64) as usize;
        let mut n: i64 = 0;
        let mut in_ws = false;
        for &u in &raw[..p] {
            if is_ws_unit(u) {
                if !in_ws {
                    n += 1;
                }
                in_ws = true;
            } else {
                n += 1;
                in_ws = false;
            }
        }
        if p > 0 && is_ws_unit(raw[0]) {
            n - 1
        } else {
            n
        }
    };
    let line_len = line.len() as i64;
    if line_len <= max {
        return line;
    }
    let head = || {
        let mut s = slice_whole(&line, 0, max - 1);
        s.push(ELLIPSIS);
        s
    };
    // The match in the raw line: at its column when the text is there, else its first occurrence.
    let mt_full: Vec<u16> = m.match_text.encode_utf16().collect();
    let mut mt_end = mt_full.len();
    while mt_end > 0 && is_ws_unit(mt_full[mt_end - 1]) {
        mt_end -= 1;
    }
    let mt = &mt_full[..mt_end];
    let col = m.column as i64 - 1;
    let raw_start: i64 = if !mt.is_empty() && col >= 0 && (col as usize) + mt.len() <= raw.len() && &raw[col as usize..col as usize + mt.len()] == mt {
        col
    } else if !mt.is_empty() {
        index_of(&raw, mt).map_or(-1, |p| p as i64)
    } else {
        -1
    };
    if raw_start < 0 {
        return head();
    }
    let start = at(raw_start).min(line_len);
    let end = start.max((at(raw_start + mt.len() as i64 - 1) + 1).min(line_len));
    if end <= max - 1 {
        return head();
    }
    let tail_room = max - 1;
    if line_len - tail_room <= start {
        let mut s = vec![ELLIPSIS];
        s.extend(slice_whole(&line, line_len - tail_room, line_len));
        return s;
    }
    let room = max - 2;
    let from = start.min((start - GREP_HIT_LEAD).max(end - room));
    if from == 0 {
        return head();
    }
    let mut s = vec![ELLIPSIS];
    s.extend(slice_whole(&line, from, from + room));
    s.push(ELLIPSIS);
    s
}

// Mirrors: core/search/agent-output-fixes.js:grepHitText
/// The text ss-grep prints after `LINE:` for one hit. `max` None = GREP_HIT_TEXT_MAX. A lone
/// surrogate (see grep_hit_units) prints as U+FFFD, as Node writes it.
pub fn grep_hit_text(m: &GrepRow, full_line: bool, max: Option<usize>) -> String {
    let max = max.unwrap_or(GREP_HIT_TEXT_MAX) as i64;
    String::from_utf16_lossy(&grep_hit_units(m, full_line, max))
}

// Mirrors: core/search/agent-output-fixes.js:matchTextIsRepeated
/// True when more than one hit is shown and every hit prints the same text (default window:
/// the JS ignores a `max` passed in its options).
pub fn match_text_is_repeated(matches: &[GrepRow], full_line: bool) -> bool {
    if matches.len() < 2 {
        return false;
    }
    let max = GREP_HIT_TEXT_MAX as i64;
    let first = grep_hit_units(&matches[0], full_line, max);
    matches.iter().all(|m| grep_hit_units(m, full_line, max) == first)
}

// --- paths -------------------------------------------------------------------------------------

// Mirrors: core/search/agent-output-fixes.js:typedPathLabel
/// A typed file's shortest suffix that no other path of the output ends with; else the path.
pub fn typed_path_label(file: &str, others: &[String]) -> String {
    let parts: Vec<&str> = file.split('/').collect();
    for n in 1..parts.len() {
        let suffix = parts[parts.len() - n..].join("/");
        let slash_suffix = format!("/{suffix}");
        if others.iter().all(|o| o == file || !(*o == suffix || o.ends_with(&slash_suffix))) {
            return suffix;
        }
    }
    file.to_string()
}

// --- listing -----------------------------------------------------------------------------------

/// renderGrepListing's getLines: a file's lines, None when unreadable.
pub type GetLines<'a> = &'a mut dyn FnMut(&str) -> Option<Arc<Vec<String>>>;

/// renderGrepListing options.
#[derive(Default)]
pub struct ListingOpts<'a> {
    /// -B
    pub before: i64,
    /// -A
    pub after: i64,
    /// A file's lines (1-based line i = element i-1, without the trailing empty element of a
    /// final newline, as `readFileSync(utf8).split('\n')` + pop), None when unreadable.
    /// Called once per listed file, only with context.
    pub get_lines: Option<GetLines<'a>>,
    /// file -> every line the regex matched in it (grepMatchLines).
    pub match_lines: Option<&'a HashMap<String, HashSet<u32>>>,
    /// Print `LINE` only.
    pub drop_text: bool,
    /// The --in files the agent typed.
    pub typed: &'a [String],
}

/// `/^\d+[:-]/` removed.
fn strip_line_number(l: &str) -> &str {
    let digits = l.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 && matches!(l.as_bytes().get(digits), Some(b':') | Some(b'-')) {
        &l[digits + 1..]
    } else {
        l
    }
}

// Mirrors: core/search/grep-output-shaping.js:renderGrepListing
/// The ss-grep listing grouped by file (`rg --heading`), with grep's context shape under -A/-B/-C.
pub fn render_grep_listing(rows: &[BodyRow], mut opts: ListingOpts) -> Vec<String> {
    // Groups in first-appearance order.
    let mut order: Vec<(&str, Vec<&BodyRow>, u64)> = Vec::new();
    let mut index: HashMap<&str, usize> = HashMap::new();
    for row in rows {
        let at = match index.get(row.file.as_str()) {
            Some(&at) => at,
            None => {
                index.insert(row.file.as_str(), order.len());
                order.push((row.file.as_str(), Vec::new(), 0));
                order.len() - 1
            }
        };
        order[at].1.push(row);
        order[at].2 += row.more;
    }
    let with_context = opts.before > 0 || opts.after > 0;
    let mut out: Vec<String> = Vec::new();
    let typed_set: HashSet<&str> = opts.typed.iter().map(String::as_str).collect();
    let files: Vec<String> = order.iter().map(|(f, _, _)| f.to_string()).collect();
    let mut bodies: HashMap<String, String> = HashMap::new();
    for (file, hits, more) in &order {
        let head: String = if !typed_set.contains(file) {
            file.to_string()
        } else if files.len() > 1 {
            typed_path_label(file, &files)
        } else {
            String::new()
        };
        let mut body: Vec<String> = Vec::new();
        let lines = if with_context {
            opts.get_lines.as_mut().and_then(|g| g(file))
        } else {
            None
        };
        render_grep_file_body(&mut body, file, hits, *more, opts.before, opts.after, lines.as_deref(), opts.match_lines, opts.drop_text);
        // The text without line numbers: a mirror is often shifted.
        let base = match file.rfind('/') {
            Some(p) => &file[p + 1..],
            None => file,
        };
        let mut key = String::from(base);
        key.push('\n');
        key.push_str(&body.iter().map(|l| strip_line_number(l)).collect::<Vec<_>>().join("\n"));
        let whole = !body.iter().any(|l| l.contains('…'));
        let twin = if !head.is_empty() && !opts.drop_text && *more == 0 && whole && body.len() > 1 {
            bodies.get(&key).cloned()
        } else {
            None
        };
        if let Some(twin) = twin {
            let mut at: Vec<u32> = hits.iter().map(|h| h.line).collect();
            at.sort_unstable();
            let at: Vec<String> = at.iter().map(u32::to_string).collect();
            out.push(format!("{head} (same matching lines as {twin}, at {})", at.join(", ")));
            continue;
        }
        if !head.is_empty() && *more == 0 && whole && !bodies.contains_key(&key) {
            bodies.insert(key, head.clone());
        }
        if !head.is_empty() {
            out.push(head);
        }
        out.extend(body);
    }
    out
}

enum Window {
    Plain(String),
    Span { start: i64, end: i64, hits: HashSet<i64> },
}

// Mirrors: core/search/grep-output-shaping.js:renderGrepFileBody
/// One file's lines of a grep listing (hits, or context windows), appended to `out`.
#[allow(clippy::too_many_arguments)]
fn render_grep_file_body(
    out: &mut Vec<String>,
    file: &str,
    hits: &[&BodyRow],
    more: u64,
    before: i64,
    after: i64,
    lines: Option<&Vec<String>>,
    match_lines: Option<&HashMap<String, HashSet<u32>>>,
    drop_text: bool,
) {
    let more_line = if more > 0 { Some(format!("(+{more} more)")) } else { None };
    let plain = |row: &BodyRow| if drop_text { row.line.to_string() } else { format!("{}:{}", row.line, row.text) };
    let Some(lines) = lines else {
        for row in hits {
            out.push(plain(row));
        }
        if let Some(m) = more_line {
            out.push(m);
        }
        return;
    };
    let len = lines.len() as i64;
    let mut sorted: Vec<&BodyRow> = hits.to_vec();
    sorted.sort_by_key(|r| r.line); // stable, as Array.prototype.sort
    let mut windows: Vec<Window> = Vec::new();
    for row in sorted {
        let line = row.line as i64;
        if line < 1 || line > len {
            windows.push(Window::Plain(plain(row))); // stale: the hit alone
            continue;
        }
        let start = 1i64.max(line - before);
        let end = len.min(line + after);
        if let Some(Window::Span { end: cur_end, hits, .. }) = windows.last_mut() {
            if start <= *cur_end + 1 {
                *cur_end = (*cur_end).max(end);
                hits.insert(line);
                continue;
            }
        }
        windows.push(Window::Span { start, end, hits: HashSet::from([line]) });
    }
    let matched = match_lines.and_then(|m| m.get(file));
    for (i, w) in windows.iter().enumerate() {
        if i > 0 {
            out.push("--".to_string());
        }
        match w {
            Window::Plain(p) => out.push(p.clone()),
            Window::Span { start, end, hits } => {
                let mut n = *start;
                while n <= *end {
                    let text = lines.get((n - 1) as usize).map(String::as_str).unwrap_or("");
                    let text = text.strip_suffix('\r').unwrap_or(text);
                    let hit = hits.contains(&n) || matched.is_some_and(|s| u32::try_from(n).is_ok_and(|x| s.contains(&x)));
                    out.push(format!("{n}{}{text}", if hit { ':' } else { '-' }));
                    n += 1;
                }
            }
        }
    }
    if let Some(m) = more_line {
        out.push(m);
    }
}

// Mirrors: core/search/grep-output-shaping.js:plural
fn plural(n: u64, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

// Mirrors: core/search/grep-output-shaping.js:renderGrepHiddenFiles
/// `# +6 more files with 10 hits: a.go, b.go, c.go`; None when every matching file shows.
pub fn render_grep_hidden_files(hidden: Option<&Hidden>) -> Option<String> {
    let hidden = hidden?;
    if hidden.files == 0 {
        return None;
    }
    let sample = if hidden.sample.is_empty() { String::new() } else { format!(": {}", hidden.sample.join(", ")) };
    Some(format!(
        "# +{} with {}{sample}",
        plural(hidden.files, "more file", "more files"),
        plural(hidden.matches, "hit", "hits")
    ))
}

// --- outside-scope lines -----------------------------------------------------------------------

/// DOC_PATH_RE: prose and examples.
const DOC_PATH: &str = r"(?i-u)\.(?:md|mdx|markdown|txt|rst|adoc|rdoc)$|(?:^|/)(?:docs?|examples?|samples?|demos?|CHANGELOG|CHANGES|NEWS|HISTORY)(?:/|\.|$)";
static DOC_PATH_RE: OnceLock<Regex> = OnceLock::new();

// Mirrors: core/search/grep-output-shaping.js:DOC_PATH_RE
/// DOC_PATH_RE.test(file)
pub fn is_doc_path(file: &str) -> bool {
    DOC_PATH_RE.get_or_init(|| Regex::new(DOC_PATH).expect("static regex compiles")).is_match(file)
}

// Mirrors: core/search/grep-output-shaping.js:fileInScopes
/// Whether `file` lies inside one of the --in scopes (a file path or a directory).
pub fn file_in_scopes(file: &str, scopes: &[String]) -> bool {
    for raw in scopes {
        let s = raw.trim_end_matches('/');
        if s.is_empty() || s == "." {
            return true;
        }
        if file == s || (file.starts_with(s) && file[s.len()..].starts_with('/')) {
            return true;
        }
    }
    false
}

// Mirrors: core/search/grep-output-shaping.js:isOutsideScopeSourceFile
/// A source file for the outside-scope line: source prior (None = grepFilePrior), no prose.
pub fn is_outside_scope_source_file(file: &str, prior: Option<f64>) -> bool {
    let prior = prior.unwrap_or_else(|| grep_file_prior(file));
    prior == 1.0 && !is_doc_path(file)
}

// Mirrors: core/search/grep-output-shaping.js:renderOutsideScopeProbeLine
/// `# also 20+ files outside --in: a, b, c` from the cost-bounded probe. None = print nothing.
pub fn render_outside_scope_probe_line(files: &[String], limit: i64, complete: bool, scoped_total: i64, scopes: &[String], max: usize) -> Option<String> {
    let outside: Vec<&String> = files.iter().filter(|f| !file_in_scopes(f, scopes)).collect();
    if outside.is_empty() {
        return None;
    }
    if !is_outside_scope_source_file(outside[0], None) && scoped_total > 0 {
        return None;
    }
    let n = (outside.len() as i64).min(limit);
    let more = if !complete || outside.len() as i64 >= limit { "+" } else { "" };
    let word = if n == 1 && more.is_empty() { "file" } else { "files" };
    let named: Vec<&str> = outside.iter().take(max).map(|s| s.as_str()).collect();
    Some(format!("# also {n}{more} {word} outside --in: {}", named.join(", ")))
}

// Mirrors: core/search/grep-output-shaping.js:renderOutsideScopeLine
/// `# also N hits outside --in: a, b (+M more files)` from an unscoped search's files (weight
/// order). None = print nothing.
pub fn render_outside_scope_line(files: &[SummaryFile], hidden_files: i64, outside_total: i64, scoped_total: i64, scopes: &[String], max: usize) -> Option<String> {
    if outside_total <= 0 {
        return None;
    }
    let outside: Vec<usize> = (0..files.len()).filter(|&i| !file_in_scopes(&files[i].file, scopes)).collect();
    if outside.is_empty() {
        return None;
    }
    let source: Vec<usize> = outside.iter().copied().filter(|&i| is_outside_scope_source_file(&files[i].file, files[i].prior)).collect();
    if source.is_empty() && scoped_total > 0 {
        return None;
    }
    let named: Vec<&str> = source
        .iter()
        .copied()
        .chain(outside.iter().copied().filter(|i| !source.contains(i)))
        .take(max)
        .map(|i| files[i].file.as_str())
        .collect();
    let rest = outside.len() as i64 - named.len() as i64 + hidden_files.max(0);
    let more_files = if rest > 0 { format!(" (+{rest} more files)") } else { String::new() };
    let what = plural(outside_total as u64, "hit", "hits");
    Some(format!("# also {what} outside --in: {}{more_files}", named.join(", ")))
}

// --- flood mode (B7) ---------------------------------------------------------------------------

/// `Math.round(x)` for x >= 0: halves round up.
fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

// Mirrors: core/search/agent-output-fixes.js:testFileQuota
/// How many of `k` file rows go to test files (0 when everything fits or one class is empty).
pub fn test_file_quota(src_count: usize, test_count: usize, k: i64) -> usize {
    if k <= 0 || test_count == 0 || src_count == 0 || (src_count + test_count) as i64 <= k {
        return 0;
    }
    let q = js_round(k as f64 * GREP_TEST_FILE_SHARE).max(1.0) as usize;
    test_count.min(q)
}

/// JS `a < b` on strings: UTF-16 code unit order.
fn cmp_js(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

// Mirrors: core/search/agent-output-fixes.js:renderGrepLineLists
/// Flood mode: one row per file with its first hit lines; non-test files first (most hits
/// first), then a quota of test files; files beyond k in one tail line per class.
/// `k` <= 0 = 20 (JS: a non-integer or non-positive k).
pub fn render_grep_line_lists(files: &[SummaryFile], lines_by_file: &HashMap<String, Vec<u64>>, k: i64) -> Vec<String> {
    let by_count_desc = |a: &&SummaryFile, b: &&SummaryFile| b.total.cmp(&a.total).then_with(|| cmp_js(&a.file, &b.file));
    let mut src: Vec<&SummaryFile> = files.iter().filter(|f| !is_test_like_path(&f.file)).collect();
    src.sort_by(by_count_desc);
    let mut tst: Vec<&SummaryFile> = files.iter().filter(|f| is_test_like_path(&f.file)).collect();
    tst.sort_by(by_count_desc);
    let plural_m = |n: u64| format!("{n} {}", if n == 1 { "match" } else { "matches" });
    let rows: i64 = if k > 0 { k } else { 20 };
    let q = test_file_quota(src.len(), tst.len(), rows) as i64;
    let src_n = if q > 0 { (src.len() as i64).min(rows - q) } else { (src.len() as i64).min(rows) }.max(0) as usize;
    let tst_n = (tst.len() as i64).min(rows - src_n as i64).max(0) as usize;
    let row = |f: &SummaryFile| -> String {
        let lines: Vec<u64> = lines_by_file.get(&f.file).map(|l| l.iter().take(GREP_LINES_PER_FILE).copied().collect()).unwrap_or_default();
        if lines.is_empty() {
            return format!("{} ({})", f.file, plural_m(f.total));
        }
        let more = f.total as i64 - lines.len() as i64;
        let list: Vec<String> = lines.iter().map(u64::to_string).collect();
        format!("{}: lines {}{}", f.file, list.join(", "), if more > 0 { format!(" (+{more} more)") } else { String::new() })
    };
    let tail = |list: &[&SummaryFile], label: &str| -> Option<String> {
        if list.is_empty() {
            return None;
        }
        let sum: u64 = list.iter().map(|f| f.total).sum();
        let names: Vec<&str> = list.iter().take(3).map(|f| f.file.as_str()).collect();
        Some(format!(
            "# +{} more {label} file(s) with {sum} match(es): {}{}",
            list.len(),
            names.join(", "),
            if list.len() > 3 { ", ..." } else { "" }
        ))
    };
    let mut out: Vec<String> = Vec::new();
    out.extend(src[..src_n].iter().map(|f| row(f)));
    out.extend(tst[..tst_n].iter().map(|f| row(f)));
    out.extend(tail(&src[src_n..], "non-test"));
    out.extend(tail(&tst[tst_n..], "test/spec/fixture"));
    out
}
