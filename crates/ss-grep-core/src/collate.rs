//! V8 `a.localeCompare(b)` (ICU root collation as `en-US`, default options: tertiary strength,
//! non-ignorable punctuation, no numeric ordering, caseFirst off) for ASCII strings.
//!
//! The weights were read off V8 itself (node 24.18, ICU 78.3), not off a UCA table: every
//! ASCII character was sorted with localeCompare and the primary classes split with a
//! `sensitivity: 'base'` collator (see fixtures-gen/collate.mjs, which re-verifies the table).
//!
//!   - completely ignorable (no weight at any level): U+0000-U+0008, U+000E-U+001F, U+007F;
//!   - primary order: TAB LF VT FF CR SPACE _ - , ; : ! ? . ' " ( ) [ ] { } @ * / \ & # % ` ^ + < = > | ~ $
//!     0-9, then a/A .. z/Z (a letter and its capital share one primary);
//!   - secondary: equal for every weighted ASCII character;
//!   - tertiary: a capital letter sorts after its small letter; all else equal.
//!
//! Comparison is UCA: all primary weights first, then (equal) secondary, then tertiary.
//! Any non-ASCII character returns None: the caller declines.
//!
//! LIMIT: this is the collation of the `en-US` (root) default locale. A daemon running under
//! a locale with tailoring (da, sv, ...) sorts differently; the native lane must decline
//! unless `Intl.Collator().resolvedOptions().locale` of the JS process is `en-US`.

use std::cmp::Ordering;

/// The primary order of the weighted ASCII characters (letters as lower case).
const PRIMARY_ORDER: &[u8] =
    b"\t\n\x0B\x0C\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz";

/// Primary weight per ASCII byte; 0 = completely ignorable.
const fn primary_table() -> [u8; 128] {
    let mut t = [0u8; 128];
    let mut i = 0;
    while i < PRIMARY_ORDER.len() {
        let c = PRIMARY_ORDER[i];
        t[c as usize] = (i + 1) as u8;
        if c >= b'a' && c <= b'z' {
            t[(c - 32) as usize] = (i + 1) as u8;
        }
        i += 1;
    }
    t
}

static PRIMARY: [u8; 128] = primary_table();

fn tertiary(c: u8) -> u8 {
    u8::from(c.is_ascii_uppercase())
}

/// `a.localeCompare(b)` as an Ordering, or None when either string holds a non-ASCII char.
// Mirrors: V8 String.prototype.localeCompare (ICU root collation, ASCII only)
pub fn locale_compare(a: &str, b: &str) -> Option<Ordering> {
    if !a.is_ascii() || !b.is_ascii() {
        return None;
    }
    let wa = a.bytes().filter(|&c| PRIMARY[c as usize] != 0);
    let wb = b.bytes().filter(|&c| PRIMARY[c as usize] != 0);
    let primary = wa.clone().map(|c| PRIMARY[c as usize]).cmp(wb.clone().map(|c| PRIMARY[c as usize]));
    if primary != Ordering::Equal {
        return Some(primary);
    }
    // Equal primaries: the same number of weighted characters, equal secondaries.
    Some(wa.map(tertiary).cmp(wb.map(tertiary)))
}

/// Stable sort by localeCompare (JS `arr.sort((a, b) => a.localeCompare(b))`). None (and the
/// slice untouched) when any string is outside what is ported.
pub fn sort_locale(items: &mut [String]) -> Option<()> {
    if !items.iter().all(|s| s.is_ascii()) {
        return None;
    }
    items.sort_by(|a, b| locale_compare(a, b).unwrap_or(Ordering::Equal));
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn basics() {
        assert_eq!(locale_compare("a", "B"), Some(Ordering::Less));
        assert_eq!(locale_compare("a", "A"), Some(Ordering::Less));
        assert_eq!(locale_compare("ab", "Aa"), Some(Ordering::Greater));
        assert_eq!(locale_compare("a\u{1}", "a"), Some(Ordering::Equal));
        assert_eq!(locale_compare("_x", "-x"), Some(Ordering::Less));
        assert_eq!(locale_compare("é", "e"), None);
    }
}
