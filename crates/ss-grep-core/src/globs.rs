//! ss-grep / ss-find `-g` path globs: core/search/grep-path-globs.js, with the parts of
//! minimatch 10.2.5 (and brace-expansion 5.0.6) it uses, for its fixed options
//! `{ dot: true, nocomment: true, nonegate: true, platform: 'linux', optimizationLevel: 2 }`.
//!
//! Matching runs on UTF-16 code units, as the JS regexes do (no `u` flag). Glob features that
//! were not ported make the compile DECLINE (the JS answers the call):
//!   - extglobs: any of `!?+*@` directly followed by `(`;
//!   - POSIX classes (`[[:alpha:]]` and friends), which switch the regex to `u` mode;
//!   - an escaped `|` (`\|`): minimatch writes it raw into the regex, where it is alternation;
//!   - a backslash, U+0000 or U+0001 in a glob whose braces expand (brace-expansion's escape
//!     markers);
//!   - brace expansions above 10,000 results or sequences with numbers above 15 digits;
//!   - a character class the JS RegExp parser would reject (it would throw);
//!   - a glob longer than 65,536 code units (minimatch throws).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use crate::paths::{path_segments, Decline};

// ---------------------------------------------------------------------------------------------
// UTF-16 helpers
// ---------------------------------------------------------------------------------------------

type U = Vec<u16>;

fn u(s: &str) -> U {
    s.encode_utf16().collect()
}

fn is_lt(c: u16) -> bool {
    matches!(c, 0x0A | 0x0D | 0x2028 | 0x2029)
}

fn is_js_ws_unit(c: u16) -> bool {
    matches!(
        c,
        0x09 | 0x0A | 0x0B | 0x0C | 0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029
            | 0x202F | 0x205F | 0x3000 | 0xFEFF
    )
}

fn starts_with_at(s: &[u16], needle: &[u16], at: usize) -> bool {
    at <= s.len() && s.len() - at >= needle.len() && &s[at..at + needle.len()] == needle
}

const BS: u16 = b'\\' as u16;
const SL: u16 = b'/' as u16;

// ---------------------------------------------------------------------------------------------
// brace-expansion 5.0.6 (+ balanced-match 4.0.4), without backslash escapes
// ---------------------------------------------------------------------------------------------

const EXPANSION_MAX: usize = 100_000;
const EXPANSION_DECLINE: usize = 10_000;
// Sentinels for brace-expansion's escOpen / escClose markers (opaque, no brace, no comma, not a
// line terminator). The caller declines any pattern holding them.
const ESC_OPEN: char = '\u{1}';
const ESC_CLOSE: char = '\u{0}';

struct Balanced {
    pre: String,
    body: String,
    post: String,
}

fn index_of_from(s: &str, ch: u8, from: usize) -> Option<usize> {
    if from > s.len() {
        return None;
    }
    s.as_bytes()[from..].iter().position(|&b| b == ch).map(|p| p + from)
}

// Mirrors: balanced-match:range (a = '{', b = '}')
fn brace_range(s: &str) -> Option<(usize, usize)> {
    let mut ai: isize = index_of_from(s, b'{', 0).map(|x| x as isize).unwrap_or(-1);
    let mut bi: isize = index_of_from(s, b'}', (ai + 1) as usize).map(|x| x as isize).unwrap_or(-1);
    let mut i = ai;
    let mut result: Option<(usize, usize)> = None;
    if ai >= 0 && bi > 0 {
        let mut begs: Vec<isize> = Vec::new();
        let mut left: isize = s.len() as isize;
        let mut right: Option<isize> = None;
        while i >= 0 && result.is_none() {
            if i == ai {
                begs.push(i);
                ai = index_of_from(s, b'{', (i + 1) as usize).map(|x| x as isize).unwrap_or(-1);
            } else if begs.len() == 1 {
                if let Some(r) = begs.pop() {
                    result = Some((r as usize, bi as usize));
                }
            } else {
                if let Some(beg) = begs.pop() {
                    if beg < left {
                        left = beg;
                        right = Some(bi);
                    }
                }
                bi = index_of_from(s, b'}', (i + 1) as usize).map(|x| x as isize).unwrap_or(-1);
            }
            i = if ai < bi && ai >= 0 { ai } else { bi };
        }
        if !begs.is_empty() {
            if let Some(r) = right {
                result = Some((left as usize, r as usize));
            }
        }
    }
    result
}

// Mirrors: balanced-match:balanced
fn balanced(s: &str) -> Option<Balanced> {
    let (a, b) = brace_range(s)?;
    Some(Balanced { pre: s[..a].to_string(), body: s[a + 1..b].to_string(), post: s[b + 1..].to_string() })
}

// Mirrors: brace-expansion:parseCommaParts
fn parse_comma_parts(s: &str) -> Vec<String> {
    if s.is_empty() {
        return vec![String::new()];
    }
    let m = match balanced(s) {
        None => return s.split(',').map(str::to_string).collect(),
        Some(m) => m,
    };
    let mut p: Vec<String> = m.pre.split(',').map(str::to_string).collect();
    let last = p.len() - 1;
    p[last].push('{');
    p[last].push_str(&m.body);
    p[last].push('}');
    let mut post_parts = parse_comma_parts(&m.post);
    if !m.post.is_empty() {
        let first = post_parts.remove(0);
        let last = p.len() - 1;
        p[last].push_str(&first);
        p.extend(post_parts);
    }
    p
}

/// `/^-?\d+$/` pieces of a sequence body.
fn is_signed_digits(s: &str) -> bool {
    let d = s.strip_prefix('-').unwrap_or(s);
    !d.is_empty() && d.bytes().all(|b| b.is_ascii_digit())
}

/// `/^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/`
fn is_numeric_sequence(body: &str) -> bool {
    let parts: Vec<&str> = body.split("..").collect();
    (parts.len() == 2 || parts.len() == 3) && parts.iter().all(|p| is_signed_digits(p))
}

/// `/^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/`
fn is_alpha_sequence(body: &str) -> bool {
    let parts: Vec<&str> = body.split("..").collect();
    let letter = |p: &str| p.len() == 1 && p.as_bytes()[0].is_ascii_alphabetic();
    match parts.len() {
        2 => letter(parts[0]) && letter(parts[1]),
        3 => letter(parts[0]) && letter(parts[1]) && is_signed_digits(parts[2]),
        _ => false,
    }
}

/// `/^-?0\d/`
fn is_padded(el: &str) -> bool {
    let d = el.strip_prefix('-').unwrap_or(el).as_bytes();
    d.len() >= 2 && d[0] == b'0' && d[1].is_ascii_digit()
}

/// `post.match(/,(?!,).*\}/)`
fn post_has_comma_then_close(post: &str) -> bool {
    let p: Vec<u16> = u(post);
    for i in 0..p.len() {
        if p[i] != b',' as u16 {
            continue;
        }
        if i + 1 < p.len() && p[i + 1] == b',' as u16 {
            continue;
        }
        for &c in &p[i + 1..] {
            if c == b'}' as u16 {
                return true;
            }
            if is_lt(c) {
                break;
            }
        }
    }
    false
}

/// `numeric(str)` for a sequence piece: parseInt for digits, else the first char code.
fn seq_numeric(s: &str) -> Result<i64, Decline> {
    if is_signed_digits(s) {
        let digits = s.trim_start_matches('-');
        if digits.len() > 15 {
            return Err(Decline("brace sequence number too long"));
        }
        s.parse::<i64>().map_err(|_| Decline("brace sequence number"))
    } else {
        Ok(s.as_bytes()[0] as i64)
    }
}

// Mirrors: brace-expansion:expand_
fn expand_inner(s: &str, is_top: bool) -> Result<Vec<String>, Decline> {
    let mut expansions: Vec<String> = Vec::new();
    let m = match balanced(s) {
        None => return Ok(vec![s.to_string()]),
        Some(m) => m,
    };
    let pre = m.pre.clone();
    let post = if !m.post.is_empty() { expand_inner(&m.post, false)? } else { vec![String::new()] };
    if post.len() >= EXPANSION_DECLINE {
        return Err(Decline("brace expansion too large"));
    }
    if m.pre.ends_with('$') {
        for p in &post {
            expansions.push(format!("{pre}{{{}}}{p}", m.body));
        }
        return Ok(expansions);
    }
    let numeric_seq = is_numeric_sequence(&m.body);
    let alpha_seq = is_alpha_sequence(&m.body);
    let is_sequence = numeric_seq || alpha_seq;
    let is_options = m.body.contains(',');
    if !is_sequence && !is_options {
        if post_has_comma_then_close(&m.post) {
            let str2 = format!("{}{{{}{}{}", m.pre, m.body, ESC_CLOSE, m.post);
            return expand_inner(&str2, true);
        }
        return Ok(vec![s.to_string()]);
    }
    let mut n: Vec<String>;
    if is_sequence {
        n = m.body.split("..").map(str::to_string).collect();
    } else {
        n = parse_comma_parts(&m.body);
        if n.len() == 1 {
            n = expand_inner(&n[0], false)?.into_iter().map(|x| format!("{{{x}}}")).collect();
            if n.len() == 1 {
                return Ok(post.iter().map(|p| format!("{}{}{p}", m.pre, n[0])).collect());
            }
        }
    }
    let big_n: Vec<String> = if is_sequence {
        let x = seq_numeric(&n[0])?;
        let y = seq_numeric(&n[1])?;
        let width = n[0].len().max(n[1].len());
        let mut incr: i64 = if n.len() == 3 { seq_numeric(&n[2])?.abs().max(1) } else { 1 };
        let reverse = y < x;
        if reverse {
            incr = -incr;
        }
        let pad = n.iter().any(|e| is_padded(e));
        let mut out: Vec<String> = Vec::new();
        let mut i = x;
        while (if reverse { i >= y } else { i <= y }) && out.len() < EXPANSION_MAX {
            if out.len() >= EXPANSION_DECLINE {
                return Err(Decline("brace sequence too long"));
            }
            let c = if alpha_seq {
                let ch = char::from_u32(i as u32).ok_or(Decline("brace alpha sequence"))?;
                if ch == '\\' {
                    String::new()
                } else {
                    ch.to_string()
                }
            } else {
                let mut c = i.to_string();
                if pad {
                    let need = width as isize - c.len() as isize;
                    if need > 0 {
                        let z = "0".repeat(need as usize);
                        c = if i < 0 { format!("-{z}{}", &c[1..]) } else { format!("{z}{c}") };
                    }
                }
                c
            };
            out.push(c);
            i += incr;
        }
        out
    } else {
        let mut out = Vec::new();
        for part in &n {
            out.extend(expand_inner(part, false)?);
            if out.len() >= EXPANSION_DECLINE {
                return Err(Decline("brace expansion too large"));
            }
        }
        out
    };
    for nj in &big_n {
        for p in &post {
            if expansions.len() >= EXPANSION_MAX {
                break;
            }
            let expansion = format!("{pre}{nj}{p}");
            if !is_top || is_sequence || !expansion.is_empty() {
                expansions.push(expansion);
            }
        }
        if expansions.len() >= EXPANSION_DECLINE {
            return Err(Decline("brace expansion too large"));
        }
    }
    Ok(expansions)
}

/// minimatch's `/\{(?:(?!\{).)*\}/.test(pattern)`: a `}` after a `{` with no `{` and no line
/// terminator between them.
fn has_brace_set(p: &[u16]) -> bool {
    for (i, &c) in p.iter().enumerate() {
        if c != b'{' as u16 {
            continue;
        }
        for &d in &p[i + 1..] {
            if d == b'}' as u16 {
                return true;
            }
            if d == b'{' as u16 || is_lt(d) {
                break;
            }
        }
    }
    false
}

// Mirrors: minimatch:braceExpand + brace-expansion:expand
fn brace_expand(pattern: &str) -> Result<Vec<String>, Decline> {
    if !has_brace_set(&u(pattern)) {
        return Ok(vec![pattern.to_string()]);
    }
    if pattern.contains('\\') || pattern.contains(ESC_OPEN) || pattern.contains(ESC_CLOSE) {
        return Err(Decline("escape in a brace-expanded glob"));
    }
    let mut s = pattern.to_string();
    if s.starts_with("{}") {
        // '\\{\\}' + rest, whose escapes become the open/close markers
        s = format!("{ESC_OPEN}{ESC_CLOSE}{}", &s[2..]);
    }
    let out = expand_inner(&s, true)?;
    Ok(out.into_iter().map(|x| x.replace(ESC_OPEN, "{").replace(ESC_CLOSE, "}")).collect())
}

// ---------------------------------------------------------------------------------------------
// minimatch 10.2.5: one path portion
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum Tok {
    /// `[^/]*?`
    Star,
    /// `[^/]+?`
    StarNoEmpty,
    /// `[^/]`
    Qmark,
    /// A literal code unit.
    Lit(u16),
    /// A JS character class (non-u): negated?, ranges of code units.
    Class(bool, Vec<(u16, u16)>),
    /// `$.`: never matches.
    Never,
}

#[derive(Debug, Clone)]
enum Fast {
    StarDot,
    StarDotExt(U),
    Qmarks { len: usize, ext: U },
    StarDotStarDot,
    DotStar,
}

#[derive(Debug, Clone)]
enum Part {
    Globstar,
    Literal(U),
    Re { no_trav: bool, toks: Vec<Tok>, fast: Option<Fast> },
}

const RE_SPECIALS: &str = "().*{}+?[]^$\\!";

fn is_re_special(c: u16) -> bool {
    c < 128 && RE_SPECIALS.as_bytes().contains(&(c as u8))
}

/// regExpEscape: `s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')` for one unit.
fn push_reg_exp_escape(out: &mut U, c: u16) {
    let special = (c < 128 && b"-[]{}()*+?.,\\^$|#".contains(&(c as u8))) || is_js_ws_unit(c);
    if special {
        out.push(BS);
    }
    out.push(c);
}

/// braceEscape: `s.replace(/[[\]\\-]/g, '\\$&')`
fn push_brace_escape(out: &mut U, c: u16) {
    if c < 128 && b"[]\\-".contains(&(c as u8)) {
        out.push(BS);
    }
    out.push(c);
}

const POSIX_CLASSES: [&str; 14] = [
    "[:alnum:]", "[:alpha:]", "[:ascii:]", "[:blank:]", "[:cntrl:]", "[:digit:]", "[:graph:]",
    "[:lower:]", "[:print:]", "[:punct:]", "[:space:]", "[:upper:]", "[:word:]", "[:xdigit:]",
];

/// Parse the body of a JS (non-u) regex character class `[...]` built by parseClass. Its only
/// escapes are braceEscape's identity escapes. Declines where JS would throw.
fn parse_js_class(src: &[u16]) -> Result<Tok, Decline> {
    // src = '[' '^'? atoms ']'
    let mut i = 1;
    let negate = src.get(1) == Some(&(b'^' as u16));
    if negate {
        i = 2;
    }
    let end = src.len() - 1; // the closing ']'
    let atom = |i: &mut usize| -> Result<u16, Decline> {
        let c = src[*i];
        if c == BS {
            let n = *src.get(*i + 1).ok_or(Decline("class escape"))?;
            if !(n == b'[' as u16 || n == b']' as u16 || n == BS || n == b'-' as u16) {
                return Err(Decline("class escape"));
            }
            *i += 2;
            Ok(n)
        } else if c == b']' as u16 {
            Err(Decline("class end"))
        } else {
            *i += 1;
            Ok(c)
        }
    };
    let mut ranges = Vec::new();
    while i < end {
        let a = atom(&mut i)?;
        if i < end && src[i] == b'-' as u16 && i + 1 < end {
            i += 1;
            let b = atom(&mut i)?;
            if a > b {
                return Err(Decline("class range out of order"));
            }
            ranges.push((a, b));
        } else {
            ranges.push((a, a));
        }
    }
    if i != end {
        return Err(Decline("class parse"));
    }
    Ok(Tok::Class(negate, ranges))
}

/// minimatch parseClass. Returns (src, token, consumed, magic); consumed 0 = not a class.
// Mirrors: minimatch/dist/esm/brace-expressions.js:parseClass
fn parse_class(glob: &[u16], pos: usize) -> Result<(U, Option<Tok>, usize, bool), Decline> {
    let mut ranges: Vec<U> = Vec::new();
    let mut i = pos + 1;
    let mut saw_start = false;
    let mut escaping = false;
    let mut negate = false;
    let mut end_pos = pos;
    let mut range_start: Option<u16> = None;
    while i < glob.len() {
        let c = glob[i];
        if (c == b'!' as u16 || c == b'^' as u16) && i == pos + 1 {
            negate = true;
            i += 1;
            continue;
        }
        if c == b']' as u16 && saw_start && !escaping {
            end_pos = i + 1;
            break;
        }
        saw_start = true;
        if c == BS && !escaping {
            escaping = true;
            i += 1;
            continue;
        }
        if c == b'[' as u16 && !escaping {
            for cls in POSIX_CLASSES {
                if starts_with_at(glob, &u(cls), i) {
                    return Err(Decline("posix class"));
                }
            }
        }
        escaping = false;
        if let Some(rs) = range_start {
            if c > rs {
                let mut r = U::new();
                push_brace_escape(&mut r, rs);
                r.push(b'-' as u16);
                push_brace_escape(&mut r, c);
                ranges.push(r);
            } else if c == rs {
                let mut r = U::new();
                push_brace_escape(&mut r, c);
                ranges.push(r);
            }
            range_start = None;
            i += 1;
            continue;
        }
        if starts_with_at(glob, &u("-]"), i + 1) {
            let mut r = U::new();
            push_brace_escape(&mut r, c);
            push_brace_escape(&mut r, b'-' as u16);
            ranges.push(r);
            i += 2;
            continue;
        }
        if starts_with_at(glob, &u("-"), i + 1) {
            range_start = Some(c);
            i += 2;
            continue;
        }
        let mut r = U::new();
        push_brace_escape(&mut r, c);
        ranges.push(r);
        i += 1;
    }
    if end_pos < i {
        return Ok((U::new(), None, 0, false));
    }
    if ranges.is_empty() {
        return Ok((u("$."), Some(Tok::Never), glob.len() - pos, true));
    }
    // /^\\?.$/ : one unit, or a backslash and one unit (`.` excludes line terminators)
    let single = ranges.len() == 1 && {
        let r = &ranges[0];
        (r.len() == 1 && !is_lt(r[0])) || (r.len() == 2 && r[0] == BS && !is_lt(r[1]))
    };
    if single && !negate {
        let r = *ranges[0].last().unwrap_or(&0);
        let mut src = U::new();
        push_reg_exp_escape(&mut src, r);
        return Ok((src, Some(Tok::Lit(r)), end_pos - pos, false));
    }
    let mut src: U = vec![b'[' as u16];
    if negate {
        src.push(b'^' as u16);
    }
    for r in &ranges {
        src.extend_from_slice(r);
    }
    src.push(b']' as u16);
    let tok = parse_js_class(&src)?;
    Ok((src, Some(tok), end_pos - pos, true))
}

/// minimatch unescape (magicalBraces, no windowsPathsNoEscape).
// Mirrors: minimatch/dist/esm/unescape.js:unescape
fn mm_unescape(s: &[u16]) -> U {
    // .replace(/((?!\\).|^)\[([^/\\])\]/g, '$1$2')
    let mut a = U::with_capacity(s.len());
    let mut p = 0;
    let lb = b'[' as u16;
    let rb = b']' as u16;
    let ok_mid = |c: u16| c != SL && c != BS;
    while p < s.len() {
        if s[p] != BS && !is_lt(s[p]) && p + 3 < s.len() && s[p + 1] == lb && ok_mid(s[p + 2]) && s[p + 3] == rb {
            a.push(s[p]);
            a.push(s[p + 2]);
            p += 4;
            continue;
        }
        if p == 0 && s.len() >= 3 && s[0] == lb && ok_mid(s[1]) && s[2] == rb {
            a.push(s[1]);
            p += 3;
            continue;
        }
        a.push(s[p]);
        p += 1;
    }
    // .replace(/\\([^/])/g, '$1')
    let mut b = U::with_capacity(a.len());
    let mut p = 0;
    while p < a.len() {
        if a[p] == BS && p + 1 < a.len() && a[p + 1] != SL {
            b.push(a[p + 1]);
            p += 2;
            continue;
        }
        b.push(a[p]);
        p += 1;
    }
    b
}

/// AST.#parseGlob for a root portion with no extglob. Returns (src, toks, magic).
// Mirrors: minimatch/dist/esm/ast.js:AST.#parseGlob
fn parse_glob(glob: &[u16], no_empty: bool) -> Result<(U, Vec<Tok>, bool), Decline> {
    let mut escaping = false;
    let mut re = U::new();
    let mut toks = Vec::new();
    let mut has_magic = false;
    let mut in_star = false;
    let all_stars = !glob.is_empty() && glob.iter().all(|&c| c == b'*' as u16);
    let mut i = 0;
    while i < glob.len() {
        let c = glob[i];
        if escaping {
            escaping = false;
            if c == b'|' as u16 {
                return Err(Decline("escaped | in a glob"));
            }
            if is_re_special(c) {
                re.push(BS);
            }
            re.push(c);
            toks.push(Tok::Lit(c));
            i += 1;
            continue;
        }
        if c == b'*' as u16 {
            if in_star {
                i += 1;
                continue;
            }
            in_star = true;
            if no_empty && all_stars {
                re.extend(u("[^/]+?"));
                toks.push(Tok::StarNoEmpty);
            } else {
                re.extend(u("[^/]*?"));
                toks.push(Tok::Star);
            }
            has_magic = true;
            i += 1;
            continue;
        } else {
            in_star = false;
        }
        if c == BS {
            if i == glob.len() - 1 {
                re.extend([BS, BS]);
                toks.push(Tok::Lit(BS));
            } else {
                escaping = true;
            }
            i += 1;
            continue;
        }
        if c == b'[' as u16 {
            let (src, tok, consumed, magic) = parse_class(glob, i)?;
            if consumed > 0 {
                re.extend(src);
                if let Some(t) = tok {
                    toks.push(t);
                }
                i += consumed - 1;
                has_magic = has_magic || magic;
                i += 1;
                continue;
            }
        }
        if c == b'?' as u16 {
            re.extend(u("[^/]"));
            toks.push(Tok::Qmark);
            has_magic = true;
            i += 1;
            continue;
        }
        push_reg_exp_escape(&mut re, c);
        toks.push(Tok::Lit(c));
        i += 1;
    }
    Ok((re, toks, has_magic))
}

/// `/^\*+([^+@!?*[(]*)$/` etc.: the fast tests minimatch puts in place of the regex.
fn fast_test_for(p: &[u16]) -> Option<Fast> {
    let star = b'*' as u16;
    let q = b'?' as u16;
    let not_ext = |c: u16| c < 128 && b"+@!?*[(".contains(&(c as u8));
    let lead_stars = p.iter().take_while(|&&c| c == star).count();
    // starRE
    if lead_stars == p.len() && lead_stars > 0 {
        return Some(Fast::StarDot);
    }
    // starDotExtRE
    if lead_stars > 0 && p[lead_stars..].iter().all(|&c| !not_ext(c)) {
        return Some(Fast::StarDotExt(p[lead_stars..].to_vec()));
    }
    // qmarksRE
    let lead_q = p.iter().take_while(|&&c| c == q).count();
    if lead_q > 0 && p[lead_q..].iter().all(|&c| !not_ext(c)) {
        return Some(Fast::Qmarks { len: p.len(), ext: p[lead_q..].to_vec() });
    }
    // starDotStarRE /^\*+\.\*+$/
    if lead_stars > 0 && p.get(lead_stars) == Some(&(b'.' as u16)) {
        let rest = &p[lead_stars + 1..];
        if !rest.is_empty() && rest.iter().all(|&c| c == star) {
            return Some(Fast::StarDotStarDot);
        }
    }
    // dotStarRE /^\.\*+$/
    if p.len() >= 2 && p[0] == b'.' as u16 && p[1..].iter().all(|&c| c == star) {
        return Some(Fast::DotStar);
    }
    None
}

fn has_extglob(p: &[u16]) -> bool {
    p.windows(2).any(|w| w[1] == b'(' as u16 && w[0] < 128 && b"!?+*@".contains(&(w[0] as u8)))
}

// Mirrors: minimatch:Minimatch.parse (+ AST.fromGlob(..).toMMPattern() for a root portion)
fn parse_part(p: &str) -> Result<Part, Decline> {
    if p == "**" {
        return Ok(Part::Globstar);
    }
    if p.is_empty() {
        return Ok(Part::Literal(U::new()));
    }
    let pu = u(p);
    if has_extglob(&pu) {
        return Err(Decline("extglob"));
    }
    let fast = fast_test_for(&pu);
    let (src, toks, magic) = parse_glob(&pu, true)?;
    if !magic {
        return Ok(Part::Literal(mm_unescape(&src)));
    }
    // start: '.' and '..' cannot match unless the pattern is that exactly (dot: true)
    let dot_trav_allowed = p == "." || p == "..";
    let aps = |c: Option<&u16>| matches!(c, Some(&x) if x == b'[' as u16 || x == b'.' as u16);
    let no_trav = !dot_trav_allowed
        && (aps(src.first())
            || (starts_with_at(&src, &u("\\."), 0) && aps(src.get(2)))
            || (starts_with_at(&src, &u("\\.\\."), 0) && aps(src.get(4))));
    Ok(Part::Re { no_trav, toks, fast })
}

fn ends_with(f: &[u16], ext: &[u16]) -> bool {
    f.len() >= ext.len() && &f[f.len() - ext.len()..] == ext
}

fn is_dot_or_dotdot(f: &[u16]) -> bool {
    f == [b'.' as u16] || f == [b'.' as u16, b'.' as u16]
}

fn toks_match(toks: &[Tok], f: &[u16]) -> bool {
    // dp[t][p]: toks[t..] match f[p..] entirely
    let n = toks.len();
    let m = f.len();
    let mut next = vec![false; m + 1];
    next[m] = true; // no tokens left: only the end matches
    for t in (0..n).rev() {
        let mut cur = vec![false; m + 1];
        for p in (0..=m).rev() {
            cur[p] = match &toks[t] {
                Tok::Star => next[p] || (p < m && f[p] != SL && cur[p + 1]),
                Tok::StarNoEmpty => p < m && f[p] != SL && (next[p + 1] || cur[p + 1]),
                Tok::Qmark => p < m && f[p] != SL && next[p + 1],
                Tok::Lit(c) => p < m && f[p] == *c && next[p + 1],
                Tok::Class(neg, ranges) => {
                    p < m && {
                        let x = f[p];
                        let inside = ranges.iter().any(|&(a, b)| x >= a && x <= b);
                        inside != *neg
                    } && next[p + 1]
                }
                Tok::Never => false,
            };
        }
        next = cur;
    }
    next[0]
}

impl Part {
    fn test(&self, f: &[u16]) -> bool {
        match self {
            Part::Globstar => false,
            Part::Literal(s) => s.as_slice() == f,
            Part::Re { no_trav, toks, fast } => match fast {
                Some(Fast::StarDot) => !f.is_empty() && !is_dot_or_dotdot(f),
                Some(Fast::StarDotExt(ext)) => ends_with(f, ext),
                Some(Fast::Qmarks { len, ext }) => {
                    f.len() == *len && !is_dot_or_dotdot(f) && (ext.is_empty() || ends_with(f, ext))
                }
                Some(Fast::StarDotStarDot) => !is_dot_or_dotdot(f) && f.contains(&(b'.' as u16)),
                Some(Fast::DotStar) => !is_dot_or_dotdot(f) && f.first() == Some(&(b'.' as u16)),
                None => {
                    if *no_trav && is_dot_or_dotdot(f) {
                        return false;
                    }
                    toks_match(toks, f)
                }
            },
        }
    }
}

// ---------------------------------------------------------------------------------------------
// minimatch 10.2.5: pattern sets, preprocessing and matching
// ---------------------------------------------------------------------------------------------

fn index_of_str(parts: &[String], needle: &str, from: isize) -> isize {
    let from = from.max(0) as usize;
    if from >= parts.len() {
        return -1;
    }
    parts[from..].iter().position(|p| p == needle).map(|x| (x + from) as isize).unwrap_or(-1)
}

/// `p.split(/\/+/)`
fn slash_split(p: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut prev_slash = false;
    for ch in p.chars() {
        if ch == '/' {
            if !prev_slash {
                out.push(std::mem::take(&mut cur));
            }
            prev_slash = true;
        } else {
            prev_slash = false;
            cur.push(ch);
        }
    }
    out.push(cur);
    out
}

// Mirrors: minimatch:Minimatch.firstPhasePreProcess
fn first_phase_pre_process(mut glob_parts: Vec<Vec<String>>) -> Vec<Vec<String>> {
    loop {
        let mut did_something = false;
        let mut idx = 0;
        while idx < glob_parts.len() {
            // <pre>/**/../<p>/<p>/<rest> -> {<pre>/../<p>/<p>/<rest>,<pre>/**/<p>/<p>/<rest>}
            let mut gs: isize = -1;
            loop {
                gs = index_of_str(&glob_parts[idx], "**", gs + 1);
                if gs == -1 {
                    break;
                }
                let parts = &mut glob_parts[idx];
                let g = gs as usize;
                let mut gss = g;
                while parts.get(gss + 1).map(String::as_str) == Some("**") {
                    gss += 1;
                }
                if gss > g {
                    parts.drain(g + 1..gss + 1);
                }
                let next = parts.get(g + 1).cloned();
                let p = parts.get(g + 2).cloned();
                let p2 = parts.get(g + 3).cloned();
                if next.as_deref() != Some("..") {
                    continue;
                }
                let bad = |x: &Option<String>| matches!(x.as_deref(), None | Some("") | Some(".") | Some(".."));
                if bad(&p) || bad(&p2) {
                    continue;
                }
                did_something = true;
                parts.remove(g);
                let mut other = parts.clone();
                other[g] = "**".to_string();
                glob_parts.push(other);
                gs -= 1;
            }
            let parts = &mut glob_parts[idx];
            // <pre>/<e>/<rest> -> <pre>/<rest>
            let mut i = 1usize;
            while !parts.is_empty() && i < parts.len().saturating_sub(1) {
                let p = parts[i].clone();
                if i == 1 && p.is_empty() && parts[0].is_empty() {
                    i += 1;
                    continue;
                }
                if p == "." || p.is_empty() {
                    did_something = true;
                    parts.remove(i);
                    continue; // i-- then i++
                }
                i += 1;
            }
            if parts.first().map(String::as_str) == Some(".")
                && parts.len() == 2
                && (parts[1] == "." || parts[1].is_empty())
            {
                did_something = true;
                parts.pop();
            }
            // <pre>/<p>/../<rest> -> <pre>/<rest>
            let mut dd: isize = 0;
            loop {
                dd = index_of_str(parts, "..", dd + 1);
                if dd == -1 {
                    break;
                }
                let d = dd as usize;
                let p = parts[d - 1].clone();
                if !p.is_empty() && p != "." && p != ".." && p != "**" {
                    did_something = true;
                    let need_dot = d == 1 && parts.get(d + 1).map(String::as_str) == Some("**");
                    parts.drain(d - 1..d + 1);
                    if need_dot {
                        parts.insert(d - 1, ".".to_string());
                    }
                    if parts.is_empty() {
                        parts.push(String::new());
                    }
                    dd -= 2;
                }
            }
            idx += 1;
        }
        if !did_something {
            break;
        }
    }
    glob_parts
}

// Mirrors: minimatch:Minimatch.partsMatch (emptyGSMatch = true, dot = true)
fn parts_match(a: &[String], b: &[String]) -> Option<Vec<String>> {
    let (mut ai, mut bi) = (0usize, 0usize);
    let mut result: Vec<String> = Vec::new();
    let mut which = ' ';
    while ai < a.len() && bi < b.len() {
        if a[ai] == b[bi] {
            result.push(if which == 'b' { b[bi].clone() } else { a[ai].clone() });
            ai += 1;
            bi += 1;
        } else if a[ai] == "**" && a.get(ai + 1) == Some(&b[bi]) {
            result.push(a[ai].clone());
            ai += 1;
        } else if b[bi] == "**" && b.get(bi + 1) == Some(&a[ai]) {
            result.push(b[bi].clone());
            bi += 1;
        } else if a[ai] == "*" && !b[bi].is_empty() && b[bi] != "**" {
            if which == 'b' {
                return None;
            }
            which = 'a';
            result.push(a[ai].clone());
            ai += 1;
            bi += 1;
        } else if b[bi] == "*" && !a[ai].is_empty() && a[ai] != "**" {
            if which == 'a' {
                return None;
            }
            which = 'b';
            result.push(b[bi].clone());
            ai += 1;
            bi += 1;
        } else {
            return None;
        }
    }
    if a.len() == b.len() {
        Some(result)
    } else {
        None
    }
}

// Mirrors: minimatch:Minimatch.secondPhasePreProcess
fn second_phase_pre_process(mut glob_parts: Vec<Vec<String>>) -> Vec<Vec<String>> {
    let n = glob_parts.len();
    let mut i = 0;
    while i + 1 < n {
        for j in i + 1..n {
            if let Some(matched) = parts_match(&glob_parts[i], &glob_parts[j]) {
                glob_parts[i] = Vec::new();
                glob_parts[j] = matched;
                break;
            }
        }
        i += 1;
    }
    glob_parts.into_iter().filter(|g| !g.is_empty()).collect()
}

// Mirrors: minimatch:Minimatch.levelTwoFileOptimize
fn level_two_file_optimize(mut parts: Vec<String>) -> Vec<String> {
    loop {
        let mut did_something = false;
        let mut i = 1usize;
        while i < parts.len().saturating_sub(1) {
            let p = &parts[i];
            if i == 1 && p.is_empty() && parts[0].is_empty() {
                i += 1;
                continue;
            }
            if p == "." || p.is_empty() {
                did_something = true;
                parts.remove(i);
                continue;
            }
            i += 1;
        }
        if parts.first().map(String::as_str) == Some(".") && parts.len() == 2 && (parts[1] == "." || parts[1].is_empty())
        {
            did_something = true;
            parts.pop();
        }
        let mut dd: isize = 0;
        loop {
            dd = index_of_str(&parts, "..", dd + 1);
            if dd == -1 {
                break;
            }
            let d = dd as usize;
            let p = &parts[d - 1];
            if !p.is_empty() && p != "." && p != ".." && p != "**" {
                did_something = true;
                parts.drain(d - 1..d + 1);
                dd -= 2;
            }
        }
        if !did_something {
            break;
        }
    }
    if parts.is_empty() {
        vec![String::new()]
    } else {
        parts
    }
}

/// One compiled minimatch pattern (the fixed path-glob options).
#[derive(Debug, Clone)]
pub struct Minimatch {
    set: Vec<Vec<Part>>,
}

enum Tri {
    True,
    False,
    Null,
}

impl Minimatch {
    // Mirrors: minimatch:Minimatch.constructor + make
    pub fn new(pattern: &str) -> Result<Minimatch, Decline> {
        if crate::jsstr::len16(pattern) > 1024 * 64 {
            return Err(Decline("glob too long"));
        }
        if pattern.is_empty() {
            return Err(Decline("empty minimatch pattern"));
        }
        let mut glob_set: Vec<String> = Vec::new();
        for g in brace_expand(pattern)? {
            if !glob_set.contains(&g) {
                glob_set.push(g);
            }
        }
        let raw: Vec<Vec<String>> = glob_set.iter().map(|s| slash_split(s)).collect();
        let parts = second_phase_pre_process(first_phase_pre_process(raw));
        let mut set = Vec::new();
        for s in &parts {
            let compiled: Vec<Part> = s.iter().map(|p| parse_part(p)).collect::<Result<_, _>>()?;
            if compiled.iter().filter(|p| matches!(p, Part::Globstar)).count() >= 150 {
                return Err(Decline("too many globstars"));
            }
            set.push(compiled);
        }
        Ok(Minimatch { set })
    }

    // Mirrors: minimatch:Minimatch.match (partial = false)
    pub fn matches(&self, f: &str) -> bool {
        let ff = slash_split(f);
        let file = level_two_file_optimize(ff);
        let file: Vec<U> = file.iter().map(|s| u(s)).collect();
        for pattern in &self.set {
            let hit = if pattern.iter().any(|p| matches!(p, Part::Globstar)) {
                self.match_globstar(&file, pattern)
            } else {
                match_one(&file, pattern, 0, 0)
            };
            if hit {
                return true;
            }
        }
        false
    }

    // Mirrors: minimatch:Minimatch.#matchGlobstar (partial = false)
    fn match_globstar(&self, file: &[U], pattern: &[Part]) -> bool {
        let firstgs = pattern.iter().position(|p| matches!(p, Part::Globstar)).unwrap_or(0);
        let lastgs = pattern.iter().rposition(|p| matches!(p, Part::Globstar)).unwrap_or(0);
        let head = &pattern[..firstgs];
        let body: &[Part] = if lastgs > firstgs { &pattern[firstgs + 1..lastgs] } else { &[] };
        let tail = &pattern[lastgs + 1..];
        let mut file_index = 0usize;
        if !head.is_empty() {
            let end = head.len().min(file.len());
            let file_head = &file[0..end];
            if !match_one(file_head, head, 0, 0) {
                return false;
            }
            file_index += head.len();
        }
        let mut file_tail_match = 0usize;
        if !tail.is_empty() {
            if tail.len() + file_index > file.len() {
                return false;
            }
            let mut tail_start = file.len() - tail.len();
            if match_one(file, tail, tail_start, 0) {
                file_tail_match = tail.len();
            } else {
                if !file[file.len() - 1].is_empty() || file_index + tail.len() == file.len() {
                    return false;
                }
                tail_start -= 1;
                if !match_one(file, tail, tail_start, 0) {
                    return false;
                }
                file_tail_match = tail.len() + 1;
            }
        }
        if body.is_empty() {
            let mut saw_some = file_tail_match > 0;
            let mut i = file_index;
            while i + file_tail_match < file.len() {
                saw_some = true;
                if is_dot_or_dotdot(&file[i]) {
                    return false;
                }
                i += 1;
            }
            return saw_some;
        }
        // body sections between globstars, each with the last index it may start at
        let mut sections: Vec<(Vec<Part>, isize)> = vec![(Vec::new(), 0)];
        let mut non_gs_parts = 0usize;
        let mut non_gs_sums = vec![0usize];
        for b in body {
            if matches!(b, Part::Globstar) {
                non_gs_sums.push(non_gs_parts);
                sections.push((Vec::new(), 0));
            } else {
                if let Some(s) = sections.last_mut() {
                    s.0.push(b.clone());
                }
                non_gs_parts += 1;
            }
        }
        let file_length = file.len() as isize - file_tail_match as isize;
        let mut i = sections.len() as isize - 1;
        for s in sections.iter_mut() {
            s.1 = file_length - (non_gs_sums[i as usize] + s.0.len()) as isize;
            i -= 1;
        }
        matches!(self.match_body_sections(file, &sections, file_index, 0, 0, file_tail_match > 0), Tri::True)
    }

    // Mirrors: minimatch:Minimatch.#matchGlobStarBodySections (partial = false)
    fn match_body_sections(
        &self,
        file: &[U],
        sections: &[(Vec<Part>, isize)],
        mut file_index: usize,
        body_index: usize,
        depth: usize,
        mut saw_tail: bool,
    ) -> Tri {
        let bs = match sections.get(body_index) {
            None => {
                for f in file.iter().skip(file_index) {
                    saw_tail = true;
                    if is_dot_or_dotdot(f) {
                        return Tri::False;
                    }
                }
                return if saw_tail { Tri::True } else { Tri::False };
            }
            Some(b) => b,
        };
        let (body, after) = bs;
        while (file_index as isize) <= *after {
            let end = (file_index + body.len()).min(file.len());
            let m = match_one(&file[..end], body, file_index, 0);
            if m && depth < 200 {
                let sub = self.match_body_sections(file, sections, file_index + body.len(), body_index + 1, depth + 1, saw_tail);
                if !matches!(sub, Tri::False) {
                    return sub;
                }
            }
            match file.get(file_index) {
                Some(f) if is_dot_or_dotdot(f) => return Tri::False,
                _ => {}
            }
            file_index += 1;
        }
        Tri::Null
    }
}

// Mirrors: minimatch:Minimatch.#matchOne (partial = false)
fn match_one(file: &[U], pattern: &[Part], file_index: usize, pattern_index: usize) -> bool {
    let (mut fi, mut pi) = (file_index, pattern_index);
    let (fl, pl) = (file.len(), pattern.len());
    while fi < fl && pi < pl {
        let p = &pattern[pi];
        if matches!(p, Part::Globstar) {
            return false;
        }
        if !p.test(&file[fi]) {
            return false;
        }
        fi += 1;
        pi += 1;
    }
    if fi == fl && pi == pl {
        true
    } else if fi == fl {
        false
    } else if pi == pl {
        fi == fl - 1 && file[fi].is_empty()
    } else {
        false
    }
}

// ---------------------------------------------------------------------------------------------
// core/search/grep-path-globs.js
// ---------------------------------------------------------------------------------------------

/// One rg-style glob, compiled.
#[derive(Debug, Clone)]
pub struct PathGlob {
    pub raw: String,
    pub exclude: bool,
    pub dir_only: bool,
    pub anchored: bool,
    /// Deviation 0: an include whose last segment has no `.` also takes the files below a
    /// directory it matches.
    pub covers_dirs: bool,
    mm: Minimatch,
}

impl PathGlob {
    /// `match(path, name)`: the whole repo-relative path when anchored, else its last segment.
    pub fn matches(&self, path: &str, name: &str) -> bool {
        self.mm.matches(if self.anchored { path } else { name })
    }
}

/// Parse one rg-style glob; Ok(None) for an empty body (`!`, `/`, `''`).
// Mirrors: core/search/grep-path-globs.js:compilePathGlob
pub fn compile_path_glob(raw: &str) -> Result<Option<PathGlob>, Decline> {
    let mut body = raw;
    let exclude = body.starts_with('!');
    if exclude {
        body = &body[1..];
    }
    let dir_only = body.ends_with('/');
    body = body.trim_end_matches('/');
    let mut anchored = false;
    loop {
        if let Some(b) = body.strip_prefix("./") {
            anchored = true;
            body = b;
        } else if let Some(b) = body.strip_prefix('/') {
            anchored = true;
            body = b;
        } else {
            break;
        }
    }
    if body.is_empty() || body == "." {
        return Ok(None);
    }
    if body.contains('/') {
        anchored = true;
    }
    let mm = Minimatch::new(body)?;
    let last_segment = match body.rfind('/') {
        Some(i) => &body[i + 1..],
        None => body,
    };
    Ok(Some(PathGlob {
        raw: raw.to_string(),
        exclude,
        dir_only,
        anchored,
        covers_dirs: !exclude && !last_segment.contains('.'),
        mm,
    }))
}

/// A list of rg-style globs compiled into one file predicate (`compilePathGlobs`).
#[derive(Debug)]
pub struct CompiledGlobs {
    pub includes: Vec<PathGlob>,
    pub excludes: Vec<PathGlob>,
    dir_includes: Vec<usize>,
    memo: RefCell<HashMap<String, bool>>,
    dir_memo: RefCell<HashMap<String, bool>>,
    dirs_matched: RefCell<(Vec<String>, HashSet<String>)>,
}

/// Ok(None) when there is nothing to apply (no globs, or only empty ones).
// Mirrors: core/search/grep-path-globs.js:compilePathGlobs
pub fn compile_path_globs(globs: &[String]) -> Result<Option<CompiledGlobs>, Decline> {
    let mut list = Vec::new();
    for g in globs {
        if let Some(c) = compile_path_glob(g)? {
            list.push(c);
        }
    }
    if list.is_empty() {
        return Ok(None);
    }
    let includes: Vec<PathGlob> = list.iter().filter(|g| !g.exclude).cloned().collect();
    let excludes: Vec<PathGlob> = list.iter().filter(|g| g.exclude).cloned().collect();
    let dir_includes = includes.iter().enumerate().filter(|(_, g)| g.covers_dirs).map(|(i, _)| i).collect();
    Ok(Some(CompiledGlobs {
        includes,
        excludes,
        dir_includes,
        memo: RefCell::new(HashMap::new()),
        dir_memo: RefCell::new(HashMap::new()),
        dirs_matched: RefCell::new((Vec::new(), HashSet::new())),
    }))
}

impl CompiledGlobs {
    /// Directories that brought files in through deviation 0, in first-match order.
    pub fn dirs_matched(&self) -> Vec<String> {
        self.dirs_matched.borrow().0.clone()
    }

    fn dir_excluded(&self, segs: &[String], n: usize) -> bool {
        if n == 0 || self.excludes.is_empty() {
            return false;
        }
        let dir = segs[..n].join("/");
        if let Some(v) = self.dir_memo.borrow().get(&dir) {
            return *v;
        }
        let v = self.dir_excluded(segs, n - 1) || self.excludes.iter().any(|g| g.matches(&dir, &segs[n - 1]));
        self.dir_memo.borrow_mut().insert(dir, v);
        v
    }

    fn decide(&self, file: &str) -> bool {
        let segs = path_segments(file);
        if segs.is_empty() {
            return false;
        }
        let full = segs.join("/");
        let name = &segs[segs.len() - 1];
        // Exclusion wins (deviation 1): the file, or any directory above it.
        if self.excludes.iter().any(|g| !g.dir_only && g.matches(&full, name)) {
            return false;
        }
        if self.dir_excluded(&segs, segs.len() - 1) {
            return false;
        }
        if self.includes.is_empty() {
            return true;
        }
        if self.includes.iter().any(|g| !g.dir_only && g.matches(&full, name)) {
            return true;
        }
        let mut n = 1;
        while n < segs.len() && !self.dir_includes.is_empty() {
            let dir = segs[..n].join("/");
            if self.dir_includes.iter().any(|&i| self.includes[i].matches(&dir, &segs[n - 1])) {
                let mut dm = self.dirs_matched.borrow_mut();
                if dm.1.insert(dir.clone()) {
                    dm.0.push(dir);
                }
                return true;
            }
            n += 1;
        }
        false
    }

    /// `matches(file)`, memoised per file.
    pub fn matches(&self, file: &str) -> bool {
        if let Some(v) = self.memo.borrow().get(file) {
            return *v;
        }
        let v = self.decide(file);
        self.memo.borrow_mut().insert(file.to_string(), v);
        v
    }
}

/// `filterMatchesByPathGlobs` result.
#[derive(Debug, Clone, PartialEq)]
pub struct GlobFiltered<T> {
    pub kept: Vec<T>,
    pub excluded_matches: u64,
    pub excluded_files: u64,
}

/// Keep the matches whose file passes the globs, and count what the globs removed. `totals`
/// (a capped list): each excluded file then counts all its matches (`totals.get(file) ?? 0`).
// Mirrors: core/search/grep-path-globs.js:filterMatchesByPathGlobs
pub fn filter_matches_by_path_globs<T: Clone, S: AsRef<str>>(
    matches: &[T],
    file_of: impl Fn(&T) -> S,
    compiled: Option<&CompiledGlobs>,
    totals: Option<&HashMap<String, u64>>,
) -> GlobFiltered<T> {
    let compiled = match compiled {
        None => return GlobFiltered { kept: matches.to_vec(), excluded_matches: 0, excluded_files: 0 },
        Some(c) => c,
    };
    let mut kept = Vec::new();
    let mut dropped: Vec<String> = Vec::new();
    let mut dropped_set: HashSet<String> = HashSet::new();
    let mut excluded_matches = 0u64;
    for m in matches {
        let f = file_of(m);
        let f = f.as_ref();
        if compiled.matches(f) {
            kept.push(m.clone());
        } else {
            excluded_matches += 1;
            if dropped_set.insert(f.to_string()) {
                dropped.push(f.to_string());
            }
        }
    }
    if let Some(t) = totals {
        excluded_matches = dropped.iter().map(|f| t.get(f).copied().unwrap_or(0)).sum();
    }
    GlobFiltered { kept, excluded_matches, excluded_files: dropped.len() as u64 }
}

/// True when any glob in the list is non-empty.
// Mirrors: core/search/grep-path-globs.js:hasPathGlobs
pub fn has_path_globs(globs: &[String]) -> bool {
    globs.iter().any(|g| !g.is_empty())
}
