//! ss-grep line classes (core/search/grep-line-classes.js), except selectGrepLinesByClass
//! (another module). Classes, from the code-graph entities of a file:
//!   0  declaration: a symbol starts on the line or up to DECL_WINDOW lines earlier, and its
//!      short name is on the line as a whole word
//!   1  inside some symbol's span
//!   2  outside every symbol span
//! Rows also get `lineSymbol` (innermost enclosing symbol, index into the usable entities, or
//! -1) and `defines` (the row declares the pattern's own identifier).
//!
//! All text is measured as JS does: UTF-16 code units (`indexOf`, `charCodeAt`).

use crate::enrich::{Entity, GraphThrew};
use crate::types::GrepRow;

/// Lines above a row a declaration may start and still class the row as 0.
pub const DECL_WINDOW: i64 = 3;

// Mirrors: core/search/grep-line-classes.js:isIdentChar
fn is_ident_char(code: i32) -> bool {
    (48..=57).contains(&code) || (65..=90).contains(&code) || (97..=122).contains(&code) || code == 95
}

/// `haystack.indexOf(needle, from)` over code units (needle non-empty).
pub(crate) fn index_of_units<T: PartialEq>(hay: &[T], needle: &[T], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(from.min(hay.len()));
    }
    if needle.len() > hay.len() {
        return None;
    }
    let last = hay.len() - needle.len();
    let mut i = from;
    while i <= last {
        if hay[i..i + needle.len()] == *needle {
            return Some(i);
        }
        i += 1;
    }
    None
}

// Mirrors: core/search/grep-line-classes.js:entityShortName
/// Last component of a qualified entity name (`Oracle.hasConflict` -> `hasConflict`):
/// `String(name).split(/::|->|[.#]/).filter(Boolean)`, last part, or ''.
pub fn entity_short_name(name: &str) -> String {
    let b = name.as_bytes();
    let mut last: &str = "";
    let mut seg_start = 0usize;
    let mut i = 0usize;
    // Separators are ASCII, so their byte offsets are char boundaries.
    while i < b.len() {
        let sep_len = if i + 1 < b.len() && ((b[i] == b':' && b[i + 1] == b':') || (b[i] == b'-' && b[i + 1] == b'>')) {
            2
        } else if b[i] == b'.' || b[i] == b'#' {
            1
        } else {
            0
        };
        if sep_len > 0 {
            if i > seg_start {
                last = &name[seg_start..i];
            }
            i += sep_len;
            seg_start = i;
        } else {
            i += 1;
        }
    }
    if b.len() > seg_start {
        last = &name[seg_start..];
    }
    last.to_string()
}

// Mirrors: core/search/grep-line-classes.js:nameOnLine
/// True when `name` occurs in `text` with no identifier character on either side.
pub fn name_on_line(name: &str, text: &str) -> bool {
    if name.is_empty() || text.is_empty() {
        return false;
    }
    if name.is_ascii() && text.is_ascii() {
        return name_on_line_units(name.as_bytes(), text.as_bytes());
    }
    let n: Vec<u16> = name.encode_utf16().collect();
    let t: Vec<u16> = text.encode_utf16().collect();
    name_on_line_units(&n, &t)
}

fn name_on_line_units<T: PartialEq + Copy + Into<u32>>(n: &[T], t: &[T]) -> bool {
    let mut from = 0usize;
    while let Some(at) = index_of_units(t, n, from) {
        let before = if at > 0 { t[at - 1].into() as i32 } else { -1 };
        let after = if at + n.len() < t.len() { t[at + n.len()].into() as i32 } else { -1 };
        if !is_ident_char(before) && !is_ident_char(after) {
            return true;
        }
        from = at + 1;
    }
    false
}

const SPACE: u8 = 32;
const TAB: u8 = 9;
const SLASH: u8 = 47;
const STAR: u8 = 42;
const HASH: u8 = 35;

// Mirrors: core/search/grep-line-classes.js:isCommentLine
/// Comment shape by its first characters: `//`, `/*`, `*`, or `#` followed by a space, a tab
/// or the end. Byte-wise is exact: every compared unit is ASCII and leading spaces/tabs are
/// one byte each, so a non-ASCII unit compares unequal either way.
pub fn is_comment_line(text: &str) -> bool {
    let t = text.as_bytes();
    if t.is_empty() {
        return false;
    }
    let mut i = 0usize;
    while i < t.len() && (t[i] == SPACE || t[i] == TAB) {
        i += 1;
    }
    let c: i32 = if i < t.len() { t[i] as i32 } else { -2 }; // JS NaN: equals nothing
    if c == STAR as i32 {
        return true;
    }
    let d: i32 = if i + 1 < t.len() { t[i + 1] as i32 } else { -1 };
    if c == SLASH as i32 {
        return d == SLASH as i32 || d == STAR as i32;
    }
    if c == HASH as i32 {
        return d == -1 || d == SPACE as i32 || d == TAB as i32;
    }
    false
}

/// One row for classify_grep_lines: `{ line, text }`.
#[derive(Clone, Debug)]
pub struct ClassRow<'a> {
    pub line: i64,
    pub text: &'a str,
}

struct ClassEnt {
    start: i64,
    end: i64,
    short: String,
}

// Mirrors: core/search/grep-line-classes.js:classifyGrepLines
/// Class of each row (rows sorted by line; entities sorted by startLine, then endLine
/// descending). `symbols_out`, when given, receives per row the index (into the usable
/// entities) of the innermost symbol whose span holds the line, or -1.
pub fn classify_grep_lines(rows: &[ClassRow<'_>], entities: &[Entity], mut symbols_out: Option<&mut Vec<i64>>) -> Vec<i64> {
    let ents: Vec<ClassEnt> = entities
        .iter()
        .filter_map(|e| match (e.start_line, e.end_line) {
            (Some(s), Some(en)) => Some(ClassEnt {
                start: s,
                end: s.max(en),
                short: entity_short_name(e.name.as_deref().unwrap_or("")),
            }),
            _ => None,
        })
        .collect();
    let mut out = vec![0i64; rows.len()];
    if let Some(so) = symbols_out.as_deref_mut() {
        so.clear();
        so.resize(rows.len(), -1);
    }
    let mut next = 0usize; // first entity not yet started at the current line
    let mut max_end: i64 = -1; // largest end among entities started so far
    // Started symbols, innermost on top.
    let track = symbols_out.is_some();
    let mut open: Vec<usize> = Vec::new();
    for (r, row) in rows.iter().enumerate() {
        let line = row.line;
        while next < ents.len() && ents[next].start <= line {
            if ents[next].end > max_end {
                max_end = ents[next].end;
            }
            if track {
                open.push(next);
            }
            next += 1;
        }
        if let Some(so) = symbols_out.as_deref_mut() {
            while let Some(&top) = open.last() {
                if ents[top].end < line {
                    open.pop();
                } else {
                    break;
                }
            }
            so[r] = open.last().map(|&t| t as i64).unwrap_or(-1);
        }
        let mut cls = if max_end >= line { 1 } else { 2 };
        let text = row.text;
        let mut e = next as i64 - 1;
        while e >= 0 && ents[e as usize].start >= line - DECL_WINDOW {
            if name_on_line(&ents[e as usize].short, text) {
                cls = 0;
                break;
            }
            e -= 1;
        }
        out[r] = cls;
    }
    out
}

/// The io stampGrepLineClasses reads through: `entitiesInFile` (Err = it threw),
/// `isFresh`, and the pattern's own identifier (`definedName`).
pub struct StampIo<'a> {
    pub entities_in_file: &'a mut dyn FnMut(&str) -> Result<std::sync::Arc<Vec<Entity>>, GraphThrew>,
    pub is_fresh: &'a mut dyn FnMut(&str) -> bool,
    pub defined_name: Option<&'a str>,
}

/// stampGrepLineClasses' return value (stats.lineClassFiles / lineClassStamped).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StampStats {
    pub files: u64,
    pub stamped: u64,
}

// Mirrors: core/search/grep-line-classes.js:stampDefinitionRows
/// `defines: true` on a row where a symbol named exactly `name` starts (on the line or up to
/// DECL_WINDOW lines above, the name on the line).
fn stamp_definition_rows(results: &mut [GrepRow], start: usize, end: usize, name: &str, io: &mut StampIo<'_>) {
    let file = results[start].file.clone();
    let mut rows: Option<Vec<usize>> = None;
    for (r, row) in results.iter().enumerate().take(end).skip(start) {
        if name_on_line(name, &row.content) {
            rows.get_or_insert_with(Vec::new).push(r);
        }
    }
    let rows = match rows {
        Some(r) => r,
        None => return,
    };
    if !(io.is_fresh)(&file) {
        return;
    }
    let entities = (io.entities_in_file)(&file).unwrap_or_default();
    let starts: Vec<Option<i64>> = entities
        .iter()
        .filter(|e| entity_short_name(e.name.as_deref().unwrap_or("")) == name)
        .map(|e| e.start_line)
        .collect();
    for r in rows {
        let line = results[r].line as i64;
        if starts.iter().any(|s| matches!(s, Some(s) if *s <= line && *s >= line - DECL_WINDOW)) {
            results[r].defines = true;
        }
    }
}

// Mirrors: core/search/grep-line-classes.js:stampGrepLineClasses
/// Stamp `lineClass` and `lineSymbol` on bare-grep rows of every fresh, indexed file with more
/// than one row (rows grouped per file); other rows stay unstamped. With a defined name, rows
/// that define it get `defines`.
pub fn stamp_grep_line_classes(results: &mut [GrepRow], io: &mut StampIo<'_>) -> StampStats {
    let mut files = 0u64;
    let mut stamped = 0u64;
    let mut i = 0usize;
    while i < results.len() {
        let start = i;
        let file = results[i].file.clone();
        while i < results.len() && results[i].file == file {
            i += 1;
        }
        if let Some(name) = io.defined_name {
            stamp_definition_rows(results, start, i, name, io);
        }
        if i - start < 2 {
            continue;
        }
        files += 1;
        if !(io.is_fresh)(&file) {
            continue;
        }
        let entities = (io.entities_in_file)(&file).unwrap_or_default();
        if entities.is_empty() {
            continue;
        }
        let mut group: Vec<(i64, usize)> = (start..i).map(|r| (results[r].line as i64, r - start)).collect();
        group.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
        let class_rows: Vec<ClassRow<'_>> = group
            .iter()
            .map(|&(line, idx)| ClassRow { line, text: results[start + idx].content.as_str() })
            .collect();
        let mut symbols = Vec::new();
        let classes = classify_grep_lines(&class_rows, &entities, Some(&mut symbols));
        drop(class_rows);
        for (g, &(_, idx)) in group.iter().enumerate() {
            let row = &mut results[start + idx];
            row.line_class = Some(classes[g]);
            row.line_symbol = Some(symbols[g]);
        }
        stamped += 1;
    }
    StampStats { files, stamped }
}
