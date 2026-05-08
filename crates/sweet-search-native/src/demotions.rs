//! Native batch matchers for the file-kind demotion sub-rules.
//!
//! Strictly opt-in. JS callers fall back to V8 regex when the addon is
//! absent. The patterns mirror the literal regexes in
//! `core/ranking/file-kind-ranking.js` byte-for-byte; the parity script at
//! `scripts/parity-demotions.js` asserts they produce identical verdicts on
//! a fixed corpus before any commit can flip the default.

use std::sync::OnceLock;

use napi_derive::napi;
use regex::Regex;

/// Same alternation as `TEST_CHUNK_BODY_RE` in file-kind-ranking.js. The
/// `(?m)` mode flag matches the JS `/m` flag — `^` matches start of any
/// line. Captures changed to non-capturing `(?:…)` because the JS callsite
/// uses only `.test()`; capture groups don't affect a boolean match.
fn test_chunk_body_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?m)^\s*(?:#\[(?:cfg\s*\(\s*test\s*\)|test)\]|func\s+Test[A-Z]|def\s+test_|(?:it|test|describe)\s*\(\s*['"])"#,
        )
        .expect("test_chunk_body_re: pattern compile")
    })
}

/// Batch counterpart to a per-chunk `TEST_CHUNK_BODY_RE.test(text)` call.
/// Returns one boolean per input string in the same order. Empty strings
/// always return false (matches V8 behavior — `^\s*` requires line start).
#[napi]
pub fn test_chunk_body_match_batch(texts: Vec<String>) -> Vec<bool> {
    let re = test_chunk_body_re();
    texts.iter().map(|t| re.is_match(t)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_strings_never_match() {
        let out = test_chunk_body_match_batch(vec!["".into(), "   ".into()]);
        assert_eq!(out, vec![false, false]);
    }

    #[test]
    fn matches_rust_test_attr() {
        let out = test_chunk_body_match_batch(vec![
            "#[cfg(test)]\nfn x() {}".into(),
            "#[test]\nfn x() {}".into(),
            "  #[test]\n".into(),
        ]);
        assert_eq!(out, vec![true, true, true]);
    }

    #[test]
    fn matches_go_test() {
        let out = test_chunk_body_match_batch(vec![
            "func TestFoo(t *testing.T) {}".into(),
            "func testfoo() {}".into(),  // lowercase 'test' shouldn't match
        ]);
        assert_eq!(out, vec![true, false]);
    }

    #[test]
    fn matches_python_test() {
        let out = test_chunk_body_match_batch(vec![
            "def test_foo():".into(),
            "    def test_bar():".into(),
            "def TestFoo():".into(),  // capital T shouldn't match python pattern
        ]);
        assert_eq!(out, vec![true, true, false]);
    }

    #[test]
    fn matches_js_suite() {
        let out = test_chunk_body_match_batch(vec![
            "it(\"foo\", () => {})".into(),
            "describe('suite', () => {})".into(),
            "test(\"bar\", () => {})".into(),
            "myit(\"x\")".into(),  // not at start, no leading whitespace
        ]);
        assert_eq!(out, vec![true, true, true, false]);
    }

    #[test]
    fn multiline_matches_anywhere_at_line_start() {
        // The /m flag in JS = (?m) in Rust — ^ matches at any line start.
        let text = "// comment\nfn helper() {}\n#[test]\nfn t() {}";
        let out = test_chunk_body_match_batch(vec![text.into()]);
        assert_eq!(out, vec![true]);
    }
}
