//! ss-grep argument parsing: eval/agent-read-workflows/bin/_ss-argparse.mjs and the start of
//! `cmdGrep` in eval/agent-read-workflows/bin/_ss-helpers.mjs (up to buildGrepPattern).
//!
//! Every place the JS fails with a usage error (failUsage / process.exit) returns
//! `Err(Decline)`: the JS answers those calls itself.

use crate::jsstr::trim_js;
use crate::paths::{posix_is_absolute, posix_resolve, resolve_cwd_glob, resolve_cwd_path, Decline, PathProbe};

/// JS line terminators (`.` in a non-`s` regex does not match them).
fn is_lt(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

fn no_lt(s: &str) -> bool {
    !s.chars().any(is_lt)
}

/// `/^\d+$/` (ASCII digits).
fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// `[\w-]` (ASCII).
fn is_word_or_dash(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

/// Largest integer a JS number holds exactly; counts above it decline.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

// --- value-flag parsers (mutate `args`) ------------------------------------------------------

fn index_of(args: &[String], name: &str) -> Option<usize> {
    args.iter().position(|a| a == name)
}

/// Boolean (value-less) flag: remove every occurrence, return whether any was present.
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:parseBoolFlag
pub fn parse_bool_flag(args: &mut Vec<String>, names: &[&str]) -> bool {
    let mut present = false;
    for n in names {
        while let Some(i) = index_of(args, n) {
            args.remove(i);
            present = true;
        }
    }
    present
}

// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:escapeRegex
pub fn escape_regex(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        if matches!(c, '.' | '*' | '+' | '?' | '^' | '$' | '{' | '}' | '(' | ')' | '|' | '[' | ']' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// `/^\(\?[a-z-]*i[a-z-]*[:)]/.test(p)`: the pattern opens with an inline flag group that
/// holds `i`.
pub fn has_leading_inline_i_flag(p: &str) -> bool {
    let b = p.as_bytes();
    if b.len() < 2 || b[0] != b'(' || b[1] != b'?' {
        return false;
    }
    let mut j = 2;
    let mut saw_i = false;
    while j < b.len() && (b[j].is_ascii_lowercase() || b[j] == b'-') {
        saw_i |= b[j] == b'i';
        j += 1;
    }
    saw_i && j < b.len() && (b[j] == b':' || b[j] == b')')
}

/// `/\(\?[a-z-]*i[a-z-]*:?/.test(regex)`: an inline flag group holding `i` anywhere.
// Mirrors: core/search/search-pattern-prefilter.js:hasCaseInsensitiveRegexFlag
pub fn has_case_insensitive_regex_flag(regex: &str) -> bool {
    let b = regex.as_bytes();
    let mut s = 0;
    while s + 1 < b.len() {
        if b[s] == b'(' && b[s + 1] == b'?' {
            let mut j = s + 2;
            while j < b.len() && (b[j].is_ascii_lowercase() || b[j] == b'-') {
                if b[j] == b'i' {
                    return true;
                }
                j += 1;
            }
        }
        s += 1;
    }
    false
}

/// `-F` escapes, `-w` wraps in word boundaries, `-i` prepends `(?i)`. None for a missing
/// pattern (JS `undefined`); Some("") stays "" (JS returns the falsy pattern as is).
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:buildGrepPattern
pub fn build_grep_pattern(pattern: Option<&str>, ignore_case: bool, word_bound: bool, fixed_string: bool) -> Option<String> {
    let pattern = pattern?;
    if pattern.is_empty() {
        return Some(String::new());
    }
    let mut p = if fixed_string { escape_regex(pattern) } else { pattern.to_string() };
    if word_bound {
        p = format!("\\b(?:{p})\\b");
    }
    if ignore_case && !has_leading_inline_i_flag(&p) {
        p = format!("(?i){p}");
    }
    Some(p)
}

const INERT_FLAGS: [&str; 10] = [
    "-n", "--line-number", "-H", "--with-filename", "--no-filename", "-r", "-R", "--recursive", "--color", "--colour",
];

// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:stripInertFlags
pub fn strip_inert_flags(args: &mut Vec<String>) {
    let mut i = args.len();
    while i > 0 {
        i -= 1;
        let a = &args[i];
        if INERT_FLAGS.contains(&a.as_str()) || a.starts_with("--color=") || a.starts_with("--colour=") {
            args.remove(i);
        }
    }
}

const VALUE_SHORTS: [char; 4] = ['k', 'A', 'B', 'C'];
const CONTEXT_SHORTS: [char; 3] = ['A', 'B', 'C'];
const BOOL_SHORTS: [char; 3] = ['i', 'w', 'F'];
const VALUE_LONGS: &[&str] = &[
    "--top", "--regex", "--mode", "--max-tokens", "--in", "--file", "--query", "--hint", "--depth", "--budget",
    "--after-context", "--before-context", "--context", "--glob", "--include", "--exclude", "--exclude-dir",
];

/// `/^(--[A-Za-z][\w-]*)=(.*)$/.exec(tok)` -> (name, value).
fn split_long_eq(tok: &str) -> Option<(&str, &str)> {
    let b = tok.as_bytes();
    if b.len() < 3 || &b[..2] != b"--" || !b[2].is_ascii_alphabetic() {
        return None;
    }
    let mut j = 3;
    while j < b.len() && is_word_or_dash(b[j]) {
        j += 1;
    }
    if j >= b.len() || b[j] != b'=' {
        return None;
    }
    let value = &tok[j + 1..];
    if !no_lt(value) {
        return None;
    }
    Some((&tok[..j], value))
}

/// Make agent-typed forms canonical: `--name=value` for known value flags, `-k5`, `-A3`,
/// bundles `-iw`, `-iwk5`.
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:normalizeArgs
pub fn normalize_args(args: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut positional_only = false;
    for tok in args {
        if positional_only {
            out.push(tok.clone());
            continue;
        }
        if tok == "--" {
            out.push(tok.clone());
            positional_only = true;
            continue;
        }
        if let Some((name, value)) = split_long_eq(tok) {
            if VALUE_LONGS.contains(&name) {
                out.push(name.to_string());
                out.push(value.to_string());
                continue;
            }
        }
        // /^-([A-Za-z])(.+)$/
        let b = tok.as_bytes();
        if b.len() >= 3 && b[0] == b'-' && b[1].is_ascii_alphabetic() && no_lt(&tok[2..]) {
            let first = b[1] as char;
            let rest = &tok[2..];
            if VALUE_SHORTS.contains(&first) {
                if !CONTEXT_SHORTS.contains(&first) || all_digits(rest) {
                    out.push(format!("-{first}"));
                    out.push(rest.to_string());
                    continue;
                }
                out.push(tok.clone());
                continue;
            }
            if BOOL_SHORTS.contains(&first) {
                let chars = &tok[1..];
                let mut expanded: Vec<String> = Vec::new();
                let mut ok = true;
                let mut i = 0usize; // byte index; every char consumed before `val` is ASCII
                while i < chars.len() {
                    let ch = chars[i..].chars().next().unwrap_or('\0');
                    if BOOL_SHORTS.contains(&ch) {
                        expanded.push(format!("-{ch}"));
                        i += 1;
                    } else if VALUE_SHORTS.contains(&ch) {
                        let val = &chars[i + 1..];
                        if CONTEXT_SHORTS.contains(&ch) && !val.is_empty() && !all_digits(val) {
                            ok = false;
                            break;
                        }
                        expanded.push(format!("-{ch}"));
                        if !val.is_empty() {
                            expanded.push(val.to_string());
                        }
                        i = chars.len();
                    } else {
                        ok = false;
                        break;
                    }
                }
                if ok {
                    out.extend(expanded);
                    continue;
                }
            }
        }
        out.push(tok.clone());
    }
    out
}

/// A token that looks like a real CLI option (single short letter, letter bundle, GNU long
/// flag), as opposed to a pattern that merely begins with '-'.
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:looksLikeOption
pub fn looks_like_option(tok: &str) -> bool {
    if tok == "-" || tok == "--" {
        return false;
    }
    let b = tok.as_bytes();
    // /^-[A-Za-z][A-Za-z0-9]*$/
    if b.len() >= 2 && b[0] == b'-' && b[1].is_ascii_alphabetic() && b[2..].iter().all(|c| c.is_ascii_alphanumeric()) {
        return true;
    }
    // /^--[A-Za-z][\w-]*(?:=.*)?$/
    if b.len() >= 3 && &b[..2] == b"--" && b[2].is_ascii_alphabetic() {
        let mut j = 3;
        while j < b.len() && is_word_or_dash(b[j]) {
            j += 1;
        }
        if j == b.len() {
            return true;
        }
        return b[j] == b'=' && no_lt(&tok[j + 1..]);
    }
    false
}

/// The value of the first of `names` present (names order), consumed with its flag.
/// Err = the JS usage error "<flag> requires a value".
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:parseValueFlag
pub fn parse_value_flag(args: &mut Vec<String>, names: &[&str], allow_option_value: bool) -> Result<Option<(String, String)>, Decline> {
    for n in names {
        let i = match index_of(args, n) {
            None => continue,
            Some(i) => i,
        };
        let v = match args.get(i + 1) {
            None => return Err(Decline("flag requires a value")),
            Some(v) => v.clone(),
        };
        if !allow_option_value && looks_like_option(&v) {
            return Err(Decline("flag requires a value"));
        }
        args.drain(i..i + 2);
        return Ok(Some((n.to_string(), v)));
    }
    Ok(None)
}

/// JS `Number(s)` for a string.
// Mirrors: ECMAScript StringToNumber
pub fn js_string_to_number(s: &str) -> f64 {
    let t = trim_js(s);
    if t.is_empty() {
        return 0.0;
    }
    let b = t.as_bytes();
    if b.len() > 2 && b[0] == b'0' {
        let radix = match b[1] {
            b'x' | b'X' => Some(16),
            b'o' | b'O' => Some(8),
            b'b' | b'B' => Some(2),
            _ => None,
        };
        if let Some(radix) = radix {
            let digits = &t[2..];
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            // exact value, rounded once (ties to even), as the spec's MV
            let mut v: u128 = 0;
            for c in digits.chars() {
                let d = c.to_digit(radix).unwrap_or(0) as u128;
                v = match v.checked_mul(radix as u128).and_then(|x| x.checked_add(d)) {
                    Some(x) => x,
                    None => return f64::INFINITY, // past u128: far above any count we accept
                };
            }
            return v as f64;
        }
    }
    // StrDecimalLiteral
    let (sign, body) = match b[0] {
        b'+' => (1.0, &t[1..]),
        b'-' => (-1.0, &t[1..]),
        _ => (1.0, t),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    let bb = body.as_bytes();
    let mut j = 0;
    let mut mant_digits = 0;
    while j < bb.len() && bb[j].is_ascii_digit() {
        j += 1;
        mant_digits += 1;
    }
    if j < bb.len() && bb[j] == b'.' {
        j += 1;
        while j < bb.len() && bb[j].is_ascii_digit() {
            j += 1;
            mant_digits += 1;
        }
    }
    if mant_digits == 0 {
        return f64::NAN;
    }
    if j < bb.len() && (bb[j] == b'e' || bb[j] == b'E') {
        j += 1;
        if j < bb.len() && (bb[j] == b'+' || bb[j] == b'-') {
            j += 1;
        }
        let start = j;
        while j < bb.len() && bb[j].is_ascii_digit() {
            j += 1;
        }
        if j == start {
            return f64::NAN;
        }
    }
    if j != bb.len() {
        return f64::NAN;
    }
    match body.parse::<f64>() {
        Ok(v) => sign * v,
        Err(_) => f64::NAN,
    }
}

/// `Number.isInteger(n) && n >= min`, then the value; counts above 2^53-1 decline.
fn positive_int(v: &str, min: f64) -> Result<u64, Decline> {
    let n = js_string_to_number(v);
    if !n.is_finite() || n.trunc() != n || n < min {
        return Err(Decline("must be an integer >= min"));
    }
    if n > MAX_SAFE_INTEGER {
        return Err(Decline("count above 2^53-1 (not ported)"));
    }
    Ok(n as u64)
}

/// `readPositiveIntFlag`: the value, `fallback` when the flag is absent, Err on a usage error.
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:parsePositiveIntFlag
pub fn parse_positive_int_flag(args: &mut Vec<String>, names: &[&str], fallback: u64) -> Result<u64, Decline> {
    match parse_value_flag(args, names, false)? {
        None => Ok(fallback),
        Some((_, v)) => positive_int(&v, 1.0),
    }
}

/// Repeatable value flag (options end at `--`): every occurrence consumed, in order,
/// de-duplicated. Err = "<flag> requires a value".
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:parseRepeatedValueFlag
pub fn parse_repeated_value_flag(args: &mut Vec<String>, names: &[&str]) -> Result<Vec<String>, Decline> {
    let mut values: Vec<String> = Vec::new();
    loop {
        let option_end = index_of(args, "--").unwrap_or(args.len());
        let mut at: Option<usize> = None;
        for n in names {
            if let Some(i) = index_of(args, n) {
                if i < option_end && at.is_none_or(|a| i < a) {
                    at = Some(i);
                }
            }
        }
        let at = match at {
            None => break,
            Some(a) => a,
        };
        let v = match args.get(at + 1) {
            None => return Err(Decline("flag requires a value")),
            Some(v) => v.clone(),
        };
        if v.is_empty() || v == "--" || looks_like_option(&v) {
            return Err(Decline("flag requires a value"));
        }
        args.drain(at..at + 2);
        if !values.contains(&v) {
            values.push(v);
        }
    }
    Ok(values)
}

/// `/^-g([!*?[{/.].*|.*[*?[{/].*)$/` -> the attached glob.
fn attached_glob(tok: &str) -> Option<&str> {
    let rest = tok.strip_prefix("-g")?;
    if rest.is_empty() || !no_lt(rest) {
        return None;
    }
    let first = rest.as_bytes()[0];
    if b"!*?[{/.".contains(&first) || rest.bytes().any(|c| b"*?[{/".contains(&c)) {
        return Some(rest);
    }
    None
}

/// `/^!?\/*$/`
fn is_empty_glob(g: &str) -> bool {
    g.strip_prefix('!').unwrap_or(g).bytes().all(|c| c == b'/')
}

/// `-g G`, `--glob G`, `--include G`, `--exclude G` (`!G`), `--exclude-dir D` (`!D/`), and
/// the attached `-gG`, in order, de-duplicated; options end at `--`. Err = usage error.
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:parseGlobFlags
pub fn parse_glob_flags(args: &mut Vec<String>) -> Result<Vec<String>, Decline> {
    let mut globs: Vec<String> = Vec::new();
    let add = |globs: &mut Vec<String>, g: String| {
        if !globs.contains(&g) {
            globs.push(g);
        }
    };
    let mut i = 0;
    while i < args.len() {
        let tok = args[i].clone();
        if tok == "--" {
            break;
        }
        if let Some(g) = attached_glob(&tok) {
            add(&mut globs, g.to_string());
            args.remove(i);
            continue;
        }
        let kind = match tok.as_str() {
            "-g" | "--glob" => "glob",
            "--include" => "include",
            "--exclude" => "exclude",
            "--exclude-dir" => "excludeDir",
            _ => {
                i += 1;
                continue;
            }
        };
        let v = match args.get(i + 1) {
            None => return Err(Decline("glob flag requires a value")),
            Some(v) => v.clone(),
        };
        if v.is_empty() || v == "--" || looks_like_option(&v) {
            return Err(Decline("glob flag requires a value"));
        }
        let glob = match kind {
            "exclude" => format!("!{v}"),
            "excludeDir" => {
                let dir = v.trim_end_matches('/');
                if dir.is_empty() || dir == "." {
                    return Err(Decline("--exclude-dir needs a directory name"));
                }
                format!("!{dir}/")
            }
            _ => v,
        };
        if glob == "!" || is_empty_glob(&glob) {
            return Err(Decline("empty glob"));
        }
        add(&mut globs, glob);
        args.drain(i..i + 2);
    }
    Ok(globs)
}

/// Bare positionals beyond the first, once every known flag has been consumed.
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:extraPositionals
pub fn extra_positionals(args: &[String]) -> Vec<String> {
    let scan: &[String] = match index_of(args, "--") {
        None => args,
        Some(sep) => &args[sep + 1..],
    };
    scan.iter().filter(|t| !looks_like_option(t) && t.as_str() != "--").skip(1).cloned().collect()
}

/// grep's -A/-B/-C (and long forms): last of each kind wins, -A/-B win over -C. Returns
/// (before, after). Err = usage error (or a count above 2^53-1, not ported).
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:parseContextFlags
pub fn parse_context_flags(args: &mut Vec<String>) -> Result<(u64, u64), Decline> {
    let (mut after, mut before, mut both): (Option<u64>, Option<u64>, Option<u64>) = (None, None, None);
    let mut i = 0;
    while i < args.len() {
        let tok = args[i].as_str();
        if tok == "--" {
            break;
        }
        let kind = match tok {
            "-A" | "--after-context" => 0,
            "-B" | "--before-context" => 1,
            "-C" | "--context" => 2,
            _ => {
                i += 1;
                continue;
            }
        };
        let v = match args.get(i + 1) {
            Some(v) if all_digits(v) => v.clone(),
            _ => return Err(Decline("context flag requires a line count")),
        };
        let n = js_string_to_number(&v);
        if n > MAX_SAFE_INTEGER {
            return Err(Decline("context count above 2^53-1 (not ported)"));
        }
        let n = n as u64;
        match kind {
            0 => after = Some(n),
            1 => before = Some(n),
            _ => both = Some(n),
        }
        args.drain(i..i + 2);
    }
    Ok((before.or(both).unwrap_or(0), after.or(both).unwrap_or(0)))
}

/// The positional pattern after flags are consumed; Err = an unsupported option-shaped token
/// (`unrecognised option`). Ok(None) = no positional at all.
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:extractPositional
pub fn extract_positional(args: &[String]) -> Result<Option<String>, Decline> {
    if let Some(sep) = index_of(args, "--") {
        if args[..sep].iter().any(|t| looks_like_option(t)) {
            return Err(Decline("unrecognised option"));
        }
        return Ok(args.get(sep + 1).cloned());
    }
    if args.iter().any(|t| looks_like_option(t)) {
        return Err(Decline("unrecognised option"));
    }
    Ok(args.first().cloned())
}

/// Bare positionals after the pattern that name a real path become `--in` scopes.
// Mirrors: eval/agent-read-workflows/bin/_ss-argparse.mjs:absorbPositionalPaths
pub fn absorb_positional_paths(args: &mut Vec<String>, in_paths: &mut Vec<String>, is_path: &dyn Fn(&str) -> bool) {
    let mut seen_pattern = false;
    let mut i = 0;
    while i < args.len() {
        let tok = args[i].clone();
        if tok == "--" || looks_like_option(&tok) {
            i += 1;
            continue;
        }
        if !seen_pattern {
            seen_pattern = true;
            i += 1;
            continue;
        }
        if is_path(&tok) {
            in_paths.push(tok);
            args.remove(i);
            continue;
        }
        i += 1;
    }
}

/// ss-grep's parsed arguments (cmdGrep up to buildGrepPattern).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrepArgs {
    pub ignore_case: bool,
    pub word_bound: bool,
    pub fixed_string: bool,
    pub k: u64,
    pub before: u64,
    pub after: u64,
    /// --in values and absorbed positional scopes, cwd-resolved, de-duplicated, in order.
    pub in_paths: Vec<String>,
    /// -g globs (and --include/--exclude/--exclude-dir), cwd-resolved, de-duplicated.
    pub globs: Vec<String>,
    pub raw_pattern: String,
    pub regex: String,
}

fn dedupe(v: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for x in v {
        if !out.contains(&x) {
            out.push(x);
        }
    }
    out
}

/// The start of `cmdGrep` (not the `fromFind` variant), in the JS order. `cwd` is the agent's
/// shell cwd (process.cwd() of the call) and `file_root` FILE_ROOT; both must be absolute.
// Mirrors: eval/agent-read-workflows/bin/_ss-helpers.mjs:cmdGrep (argument part)
pub fn parse_grep_args(args: &[String], probe: &dyn PathProbe, cwd: &str, file_root: &str) -> Result<GrepArgs, Decline> {
    if !posix_is_absolute(cwd) || !posix_is_absolute(file_root) {
        return Err(Decline("cwd and file root must be absolute"));
    }
    let mut args = normalize_args(args);
    let ignore_case = parse_bool_flag(&mut args, &["-i", "--ignore-case"]);
    let word_bound = parse_bool_flag(&mut args, &["-w", "--word-regexp"]);
    let fixed_string = parse_bool_flag(&mut args, &["-F", "--fixed-strings"]);
    let k = parse_positive_int_flag(&mut args, &["-k", "--top"], 20)?;
    let (before, after) = parse_context_flags(&mut args)?;
    let mut in_paths = parse_repeated_value_flag(&mut args, &["--in"])?;
    let globs = parse_glob_flags(&mut args)?;
    let globs = dedupe(globs.iter().map(|g| resolve_cwd_glob(g, cwd, file_root, probe)).collect());
    strip_inert_flags(&mut args);
    // absorbPositionalPaths with its existsSync predicate through cwdPath
    let is_path = |tok: &str| -> bool {
        if posix_is_absolute(tok) {
            probe.exists(tok)
        } else {
            let rel = resolve_cwd_path(tok, cwd, file_root, probe);
            probe.exists(&posix_resolve(cwd, &[file_root, &rel]))
        }
    };
    absorb_positional_paths(&mut args, &mut in_paths, &is_path);
    // resolveScopePaths
    let in_paths = dedupe(in_paths.iter().map(|p| resolve_cwd_path(p, cwd, file_root, probe)).collect());
    // rejectExtraPositionals
    if !extra_positionals(&args).is_empty() {
        return Err(Decline("arguments not consumed"));
    }
    let raw_pattern = extract_positional(&args)?;
    let regex = build_grep_pattern(raw_pattern.as_deref(), ignore_case, word_bound, fixed_string);
    match (raw_pattern, regex) {
        (Some(raw_pattern), Some(regex)) if !regex.is_empty() => Ok(GrepArgs {
            ignore_case,
            word_bound,
            fixed_string,
            k,
            before,
            after,
            in_paths,
            globs,
            raw_pattern,
            regex,
        }),
        _ => Err(Decline("no pattern (usage)")),
    }
}
