//! JS string semantics. A JS string is UTF-16: `.length`, `.slice`, `.indexOf` and friends
//! count UTF-16 code units, and a slice may cut a surrogate pair. Node writes a lone surrogate
//! to UTF-8 as U+FFFD (EF BF BD). Every port that measures or cuts text uses these helpers, never
//! `str::len` / byte slicing, so the printed bytes match.

/// `s.length` in JS.
pub fn len16(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// `s.slice(start, end)` in JS, for in-range non-negative `start <= end` (code units), with
/// the text a cut surrogate pair leaves as Node would print it (U+FFFD for the lone half).
pub fn slice16(s: &str, start: usize, end: usize) -> String {
    if start >= end {
        return String::new();
    }
    if s.is_ascii() {
        let e = end.min(s.len());
        let b = start.min(e);
        return s[b..e].to_string();
    }
    let units: Vec<u16> = s.encode_utf16().collect();
    let e = end.min(units.len());
    let b = start.min(e);
    String::from_utf16_lossy(&units[b..e])
}

/// `s.slice(start)` in JS.
pub fn slice16_from(s: &str, start: usize) -> String {
    slice16(s, start, usize::MAX)
}

/// JS `String.prototype.trim()`: strips JS whitespace (WhiteSpace + LineTerminator), which is
/// wider than ASCII but not identical to Rust's `char::is_whitespace`.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}' | '\u{000A}' | '\u{000B}' | '\u{000C}' | '\u{000D}' | '\u{0020}' | '\u{00A0}'
            | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}'
            | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

pub fn trim_js(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

pub fn trim_start_js(s: &str) -> &str {
    s.trim_start_matches(is_js_whitespace)
}

pub fn trim_end_js(s: &str) -> &str {
    s.trim_end_matches(is_js_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn utf16_semantics() {
        assert_eq!(len16("abc"), 3);
        assert_eq!(len16("é"), 1);
        assert_eq!(len16("😀"), 2);
        assert_eq!(slice16("a😀b", 0, 2), "a\u{FFFD}");
        assert_eq!(slice16("a😀b", 1, 3), "😀");
        assert_eq!(slice16_from("héllo", 1), "éllo");
        assert_eq!(trim_js("\u{00A0} x \u{FEFF}"), "x");
    }
}
