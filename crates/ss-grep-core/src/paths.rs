//! Path handling of the agent tools: Node's `path.posix` functions, the shell-cwd rules of
//! core/search/cwd-paths.js, and the `--in` scope predicate of core/search/grep-output-shaping.js.
//!
//! Every file-system question goes through [`PathProbe`], so the daemon answers from its own
//! view (and the tests from a recorded one). All index arithmetic of the Node path functions is
//! done on UTF-16 code units, as in JS.

use crate::jsstr::len16;

/// The file-system questions the ported JS asks. Every path handed in is absolute (the callers
/// decline otherwise).
pub trait PathProbe {
    /// `fs.existsSync(abs)`: follows symlinks; false for a dangling link, for a file spelled
    /// with a trailing `/`, and for a path holding a NUL character.
    fn exists(&self, abs: &str) -> bool;
    /// `fs.realpathSync.native(abs)`, or None when it throws.
    fn realpath(&self, abs: &str) -> Option<String>;
    /// `fs.statSync(abs).isFile()` (follows symlinks), false when it throws.
    fn is_file(&self, abs: &str) -> bool;
}

/// The JS answers this call itself (usage error, or an input outside what was ported).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decline(pub &'static str);

// ---------------------------------------------------------------------------------------------
// Node path.posix (lib/path.js), on UTF-16 code units.
// ---------------------------------------------------------------------------------------------

const SLASH: u16 = b'/' as u16;
const DOT: u16 = b'.' as u16;

fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

fn from_units(u: &[u16]) -> String {
    String::from_utf16_lossy(u)
}

fn last_index_of(hay: &[u16], needle: u16) -> Option<usize> {
    hay.iter().rposition(|&c| c == needle)
}

// Mirrors: node lib/path.js:normalizeString (posix separator)
fn normalize_string(path: &[u16], allow_above_root: bool) -> Vec<u16> {
    let mut res: Vec<u16> = Vec::new();
    let mut last_segment_length: isize = 0;
    let mut last_slash: isize = -1;
    let mut dots: isize = 0;
    let mut code: u16 = 0;
    let n = path.len();
    let mut i = 0usize;
    while i <= n {
        if i < n {
            code = path[i];
        } else if code == SLASH {
            break;
        } else {
            code = SLASH;
        }
        if code == SLASH {
            if last_slash == i as isize - 1 || dots == 1 {
                // NOOP
            } else if dots == 2 {
                let rl = res.len();
                if rl < 2 || last_segment_length != 2 || res[rl - 1] != DOT || res[rl - 2] != DOT {
                    if rl > 2 {
                        match last_index_of(&res, SLASH) {
                            None => {
                                res.clear();
                                last_segment_length = 0;
                            }
                            Some(idx) => {
                                res.truncate(idx);
                                let l2 = last_index_of(&res, SLASH).map(|x| x as isize).unwrap_or(-1);
                                last_segment_length = res.len() as isize - 1 - l2;
                            }
                        }
                        last_slash = i as isize;
                        dots = 0;
                        i += 1;
                        continue;
                    } else if rl != 0 {
                        res.clear();
                        last_segment_length = 0;
                        last_slash = i as isize;
                        dots = 0;
                        i += 1;
                        continue;
                    }
                }
                if allow_above_root {
                    if !res.is_empty() {
                        res.extend_from_slice(&[SLASH, DOT, DOT]);
                    } else {
                        res.extend_from_slice(&[DOT, DOT]);
                    }
                    last_segment_length = 2;
                }
            } else {
                let seg = &path[(last_slash + 1) as usize..i];
                if !res.is_empty() {
                    res.push(SLASH);
                }
                res.extend_from_slice(seg);
                last_segment_length = i as isize - last_slash - 1;
            }
            last_slash = i as isize;
            dots = 0;
        } else if code == DOT && dots != -1 {
            dots += 1;
        } else {
            dots = -1;
        }
        i += 1;
    }
    res
}

/// `path.isAbsolute(p)` (posix).
// Mirrors: node lib/path.js:posix.isAbsolute
pub fn posix_is_absolute(p: &str) -> bool {
    p.starts_with('/')
}

/// `path.posix.normalize(p)`.
// Mirrors: node lib/path.js:posix.normalize
pub fn posix_normalize(p: &str) -> String {
    let u = units(p);
    if u.is_empty() {
        return ".".to_string();
    }
    let is_absolute = u[0] == SLASH;
    let trailing_separator = u[u.len() - 1] == SLASH;
    let mut out = normalize_string(&u, !is_absolute);
    if out.is_empty() {
        if is_absolute {
            return "/".to_string();
        }
        return if trailing_separator { "./".to_string() } else { ".".to_string() };
    }
    if trailing_separator {
        out.push(SLASH);
    }
    let s = from_units(&out);
    if is_absolute {
        format!("/{s}")
    } else {
        s
    }
}

/// `path.posix.join(...parts)`.
// Mirrors: node lib/path.js:posix.join
pub fn posix_join(parts: &[&str]) -> String {
    let kept: Vec<&str> = parts.iter().copied().filter(|a| !a.is_empty()).collect();
    if kept.is_empty() {
        return ".".to_string();
    }
    posix_normalize(&kept.join("/"))
}

/// `path.posix.resolve(...parts)`, with `process_cwd` standing for `process.cwd()`.
// Mirrors: node lib/path.js:posix.resolve
pub fn posix_resolve(process_cwd: &str, parts: &[&str]) -> String {
    let mut resolved: Vec<u16> = Vec::new();
    let mut resolved_absolute = false;
    let mut i = parts.len() as isize - 1;
    while i >= -1 && !resolved_absolute {
        let p = if i >= 0 { parts[i as usize] } else { process_cwd };
        i -= 1;
        if p.is_empty() {
            continue;
        }
        let mut next = units(p);
        next.push(SLASH);
        next.extend_from_slice(&resolved);
        resolved = next;
        resolved_absolute = p.starts_with('/');
    }
    let norm = normalize_string(&resolved, !resolved_absolute);
    if resolved_absolute {
        return format!("/{}", from_units(&norm));
    }
    if norm.is_empty() {
        ".".to_string()
    } else {
        from_units(&norm)
    }
}

/// `path.posix.relative(from, to)`.
// Mirrors: node lib/path.js:posix.relative
pub fn posix_relative(process_cwd: &str, from: &str, to: &str) -> String {
    if from == to {
        return String::new();
    }
    let from = units(&posix_resolve(process_cwd, &[from]));
    let to = units(&posix_resolve(process_cwd, &[to]));
    if from == to {
        return String::new();
    }
    let from_start = 1usize;
    let from_end = from.len();
    let from_len = from_end - from_start;
    let to_start = 1usize;
    let to_len = to.len() - to_start;
    let length = from_len.min(to_len);
    let mut last_common_sep: isize = -1;
    let mut i = 0usize;
    while i < length {
        let from_code = from[from_start + i];
        if from_code != to[to_start + i] {
            break;
        } else if from_code == SLASH {
            last_common_sep = i as isize;
        }
        i += 1;
    }
    if i == length {
        if to_len > length {
            if to[to_start + i] == SLASH {
                return from_units(&to[to_start + i + 1..]);
            }
            if i == 0 {
                return from_units(&to[to_start + i..]);
            }
        } else if from_len > length {
            if from[from_start + i] == SLASH {
                last_common_sep = i as isize;
            } else if i == 0 {
                last_common_sep = 0;
            }
        }
    }
    let mut out: Vec<u16> = Vec::new();
    let mut j = (from_start as isize + last_common_sep + 1) as usize;
    while j <= from_end {
        if j == from_end || from[j] == SLASH {
            if out.is_empty() {
                out.extend_from_slice(&[DOT, DOT]);
            } else {
                out.extend_from_slice(&[SLASH, DOT, DOT]);
            }
        }
        j += 1;
    }
    let tail_start = (to_start as isize + last_common_sep) as usize;
    out.extend_from_slice(&to[tail_start..]);
    from_units(&out)
}

/// `s.replace(/\\/g, '/')`.
fn backslashes_to_slashes(s: &str) -> String {
    s.replace('\\', "/")
}

/// `s.replace(/\/+$/, '')`.
fn strip_trailing_slashes(s: &str) -> &str {
    s.trim_end_matches('/')
}

// ---------------------------------------------------------------------------------------------
// core/search/cwd-paths.js
// ---------------------------------------------------------------------------------------------

// Mirrors: core/search/cwd-paths.js:realOrResolved
fn real_or_resolved(p: &str, probe: &dyn PathProbe, process_cwd: &str) -> String {
    match probe.realpath(p) {
        Some(r) => r,
        None => posix_resolve(process_cwd, &[p]),
    }
}

/// Where `cwd` sits inside `root`, as a POSIX root-relative path: `Some("")` at the root, None
/// when cwd is outside the root (or either is empty). `cwd` and `root` are absolute (the
/// argument parser declines otherwise), so the `process.cwd()` of path.resolve is never read.
// Mirrors: core/search/cwd-paths.js:cwdOffset
pub fn cwd_offset(cwd: &str, root: &str, probe: &dyn PathProbe) -> Option<String> {
    if root.is_empty() || cwd.is_empty() {
        return None;
    }
    let rel = posix_relative(cwd, &real_or_resolved(root, probe, cwd), &real_or_resolved(cwd, probe, cwd));
    if rel.is_empty() {
        return Some(String::new());
    }
    if rel == ".." || rel.starts_with("../") || posix_is_absolute(&rel) {
        return None;
    }
    // rel.split(path.sep).join('/') is the identity on posix.
    Some(rel)
}

/// Resolve one path argument cwd-first: the root-relative spelling when the cwd reading
/// applies, else `p` unchanged.
// Mirrors: core/search/cwd-paths.js:resolveCwdPath
pub fn resolve_cwd_path(p: &str, cwd: &str, root: &str, probe: &dyn PathProbe) -> String {
    if p.is_empty() || posix_is_absolute(p) {
        return p.to_string();
    }
    let offset = match cwd_offset(cwd, root, probe) {
        Some(o) if !o.is_empty() => o,
        _ => return p.to_string(), // at the root or outside it: unchanged
    };
    let candidate = posix_normalize(&posix_join(&[&offset, &backslashes_to_slashes(p)]));
    if candidate == ".." || candidate.starts_with("../") {
        return p.to_string(); // escapes the repository
    }
    let found = probe.exists(&posix_join(&[root, &candidate]));
    if found {
        candidate
    } else {
        p.to_string()
    }
}

/// `/[*?[\]{}\\]/`
fn has_glob_meta(seg: &str) -> bool {
    seg.chars().any(|c| matches!(c, '*' | '?' | '[' | ']' | '{' | '}' | '\\'))
}

/// Re-anchor one `-g` glob typed from the shell's cwd (see the JS for the rules).
// Mirrors: core/search/cwd-paths.js:resolveCwdGlob
pub fn resolve_cwd_glob(glob: &str, cwd: &str, root: &str, probe: &dyn PathProbe) -> String {
    if glob.is_empty() {
        return glob.to_string();
    }
    let neg = if glob.starts_with('!') { "!" } else { "" };
    let body = &glob[neg.len()..];
    // An absolute filesystem path under the root (pasted from a tool's absolute output).
    if body.starts_with('/') && !root.is_empty() {
        let mut roots: Vec<String> = Vec::new();
        for r in [posix_resolve(cwd, &[root]), real_or_resolved(root, probe, cwd)] {
            if !roots.contains(&r) {
                roots.push(r);
            }
        }
        for r in &roots {
            let prefix = strip_trailing_slashes(r);
            if body == prefix || body.starts_with(&format!("{prefix}/")) {
                let rest = body[prefix.len()..].trim_start_matches('/');
                return if !rest.is_empty() { format!("{neg}/{rest}") } else { glob.to_string() };
            }
        }
    }
    let offset = match cwd_offset(cwd, root, probe) {
        Some(o) if !o.is_empty() => o,
        _ => return glob.to_string(), // at the root or outside it
    };
    let trimmed = strip_trailing_slashes(body);
    if body.starts_with("**") {
        return glob.to_string(); // any depth already
    }
    let explicit_here = body.starts_with("./") || body.starts_with('/');
    if !explicit_here && !trimmed.contains('/') {
        return glob.to_string(); // basename glob, any depth
    }
    // body.replace(/^(?:\.\/|\/)+/, '')
    let mut rel = body;
    loop {
        if let Some(r) = rel.strip_prefix("./") {
            rel = r;
        } else if let Some(r) = rel.strip_prefix('/') {
            rel = r;
        } else {
            break;
        }
    }
    let joined = posix_normalize(&format!("{offset}/{rel}"));
    if joined == ".." || joined.starts_with("../") {
        return glob.to_string();
    }
    let cwd_anchored = format!("{neg}/{joined}");
    if explicit_here {
        return cwd_anchored;
    }
    // The literal leading path (segments before the first glob metacharacter).
    let mut literal: Vec<&str> = Vec::new();
    for seg in rel.split('/') {
        if seg.is_empty() || has_glob_meta(seg) {
            break;
        }
        literal.push(seg);
    }
    if literal.is_empty() || literal.contains(&"..") || literal.contains(&".") {
        return cwd_anchored;
    }
    let mut here: Vec<&str> = vec![root, &offset];
    here.extend(literal.iter().copied());
    if probe.exists(&posix_join(&here)) {
        return cwd_anchored;
    }
    let mut at_root: Vec<&str> = vec![root];
    at_root.extend(literal.iter().copied());
    if probe.exists(&posix_join(&at_root)) {
        return glob.to_string(); // root-relative, as typed
    }
    cwd_anchored // neither exists: rg's reading
}

/// The implicit search scope of a grep run from a subdirectory (absolute, under the REAL
/// index root), or None at the root / outside it.
// Mirrors: core/search/cwd-paths.js:cwdGrepScope
pub fn cwd_grep_scope(cwd: &str, file_root: &str, index_root: &str, probe: &dyn PathProbe) -> Option<String> {
    let offset = cwd_offset(cwd, file_root, probe)?;
    if offset.is_empty() || index_root.is_empty() {
        return None;
    }
    let real = real_or_resolved(index_root, probe, cwd);
    let mut parts: Vec<&str> = vec![&real];
    parts.extend(offset.split('/'));
    Some(posix_join(&parts))
}

// ---------------------------------------------------------------------------------------------
// core/search/grep-output-shaping.js: the --in scope predicate
// ---------------------------------------------------------------------------------------------

/// Split a path into whole segments, dropping "" and "." (so "./a//b" -> [a, b]).
// Mirrors: core/search/grep-output-shaping.js:pathSegments
pub fn path_segments(value: &str) -> Vec<String> {
    backslashes_to_slashes(value)
        .split('/')
        .filter(|s| !s.is_empty() && *s != ".")
        .map(str::to_string)
        .collect()
}

/// POSIX, drive-letter, and UNC spellings after slash normalization.
// Mirrors: core/search/grep-output-shaping.js:isAbsolutePath
pub fn is_absolute_path(value: &str) -> bool {
    let n = backslashes_to_slashes(value);
    let b = n.as_bytes();
    n.starts_with('/') || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'/')
}

/// Segments of the root's real path, or None when it does not resolve.
// Mirrors: core/search/grep-output-shaping.js:canonicalRootSegments
pub fn canonical_root_segments(project_root: &str, probe: &dyn PathProbe) -> Option<Vec<String>> {
    probe.realpath(project_root).map(|r| path_segments(&r))
}

#[derive(Debug, Clone)]
enum ScopeRule {
    /// Every repo-relative path.
    All,
    /// The scope's segments start the target's segments.
    Anchored(Vec<String>),
    /// The scope's segments appear as a contiguous run anywhere in the target's segments.
    Run(Vec<String>),
}

#[derive(Debug, Clone)]
struct ScopeTest {
    needle: String,
    rule: ScopeRule,
}

fn run_at(hay: &[String], needle: &[String], start: usize) -> bool {
    needle.iter().enumerate().all(|(i, n)| hay.get(start + i) == Some(n))
}

impl ScopeTest {
    fn matches(&self, target: &[String]) -> bool {
        match &self.rule {
            ScopeRule::All => true,
            ScopeRule::Anchored(scope) => scope.len() <= target.len() && run_at(target, scope, 0),
            ScopeRule::Run(scope) => {
                if scope.len() > target.len() {
                    return false;
                }
                let mut start = 0;
                while start + scope.len() <= target.len() {
                    if run_at(target, scope, start) {
                        return true;
                    }
                    start += 1;
                }
                false
            }
        }
    }
}

/// The longest segment (UTF-16 length, first wins on ties), '' when there is none.
// Mirrors: core/search/grep-output-shaping.js:withNeedle
fn with_needle(scope: &[String], rule: ScopeRule) -> ScopeTest {
    let mut longest = "";
    for seg in scope {
        if len16(seg) > len16(longest) {
            longest = seg;
        }
    }
    ScopeTest { needle: longest.to_string(), rule }
}

/// `grepFileFilterPredicate(filter, projectRoot)`: each scope resolved once.
#[derive(Debug, Clone)]
pub struct GrepFileFilter {
    tests: Vec<ScopeTest>,
}

impl GrepFileFilter {
    /// The JS predicate `(file) => boolean`.
    pub fn matches(&self, file: &str) -> bool {
        if file.is_empty() {
            return false;
        }
        if !self.tests.iter().any(|t| file.contains(t.needle.as_str())) {
            return false;
        }
        let target = path_segments(file);
        if target.is_empty() {
            return false;
        }
        self.tests.iter().any(|t| file.contains(t.needle.as_str()) && t.matches(&target))
    }
}

/// Build the scope predicate. `filter` is the JS value as an array (a single string `s` is
/// `[s]`; null, '' and [] all give a predicate that is always false). Declines when
/// `project_root` counts as absolute for isAbsolutePath but does not start with `/` (a
/// drive-letter or `\\` root would make the JS probe a path relative to its process cwd).
// Mirrors: core/search/grep-output-shaping.js:grepFileFilterPredicate
pub fn grep_file_filter_predicate(
    filter: &[String],
    project_root: Option<&str>,
    probe: &dyn PathProbe,
) -> Result<GrepFileFilter, Decline> {
    let project_root = project_root.filter(|r| !r.is_empty());
    if let Some(r) = project_root {
        if is_absolute_path(r) && !r.starts_with('/') {
            return Err(Decline("non-posix project root"));
        }
    }
    let root = project_root.map(path_segments);
    let mut tests = Vec::new();
    for raw in filter {
        if raw.is_empty() {
            continue;
        }
        let mut scope = path_segments(raw);
        if scope.iter().any(|s| s == "..") {
            continue;
        }
        // WHOLE-REPO scope: `.` and `./`.
        if scope.is_empty() && !is_absolute_path(raw) {
            tests.push(with_needle(&[], ScopeRule::All));
            continue;
        }
        // ABSOLUTE scope: meaningful only relative to the repository root.
        if is_absolute_path(raw) {
            let (root, project_root) = match (&root, project_root) {
                (Some(r), Some(pr)) if is_absolute_path(pr) => (r, pr),
                _ => continue,
            };
            let real_root = canonical_root_segments(project_root, probe);
            let anchor = if scope.len() >= root.len() && run_at(&scope, root, 0) {
                Some(root.clone())
            } else {
                match &real_root {
                    Some(rr) if scope.len() >= rr.len() && run_at(&scope, rr, 0) => Some(rr.clone()),
                    _ => None,
                }
            };
            let anchor = match anchor {
                Some(a) => a,
                None => continue,
            };
            scope = scope[anchor.len()..].to_vec();
            if scope.is_empty() {
                tests.push(with_needle(&[], ScopeRule::All));
                continue;
            }
            tests.push(with_needle(&scope, ScopeRule::Anchored(scope.clone())));
            continue;
        }
        // ROOT-ANCHORED: the scope names a path at the repository root.
        let mut at_root = false;
        if let Some(pr) = project_root {
            if is_absolute_path(pr) {
                let mut parts: Vec<&str> = vec![pr];
                parts.extend(scope.iter().map(String::as_str));
                at_root = probe.exists(&posix_join(&parts));
            }
        }
        if at_root {
            tests.push(with_needle(&scope, ScopeRule::Anchored(scope.clone())));
            continue;
        }
        tests.push(with_needle(&scope, ScopeRule::Run(scope.clone())));
    }
    Ok(GrepFileFilter { tests })
}

/// `matchesGrepFileFilter(file, filter, projectRoot)`.
// Mirrors: core/search/grep-output-shaping.js:matchesGrepFileFilter
pub fn matches_grep_file_filter(
    file: &str,
    filter: &[String],
    project_root: Option<&str>,
    probe: &dyn PathProbe,
) -> Result<bool, Decline> {
    Ok(grep_file_filter_predicate(filter, project_root, probe)?.matches(file))
}
