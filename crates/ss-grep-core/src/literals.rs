//! Literal clauses for the grep prefilters: core/search/search-pattern-prefilter.js
//! (extractLiteralClauses and everything it calls, prefilterLiteralClauses).
//!
//! The native extractor (`addon.extractRegexLiterals(regex).clauses`) comes in as a callback:
//! `None` = it threw (or the addon is missing); its clauses otherwise. It alone is not sound for
//! alternations (`a.b|cde` gives [["cde"]]), so the alternation guard here must match the JS.
//!
//! Every parser works on UTF-16 code units, as the JS does. DECLINES (Err) instead of guessing:
//!   - groups nested deeper than 200 (the JS recursion is unbounded; Rust's stack is not);
//!   - an alternative or a literal that would hold a lone surrogate half (the JS cuts an
//!     astral char in two when a quantifier follows it: `😀?`).

use crate::paths::Decline;

type U = Vec<u16>;

const MAX_DEPTH: usize = 200;

/// Cap on expanded alternatives (MAX_ALTERNATIVES).
pub const MAX_ALTERNATIVES: usize = 32;

fn u(s: &str) -> U {
    s.encode_utf16().collect()
}

fn to_string(v: &[u16]) -> Result<String, Decline> {
    String::from_utf16(v).map_err(|_| Decline("lone surrogate in a literal or alternative"))
}

const fn c(ch: char) -> u16 {
    ch as u16
}

/// JS `\s` on one code unit.
fn is_js_ws_unit(x: u16) -> bool {
    matches!(
        x,
        0x09 | 0x0A | 0x0B | 0x0C | 0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029
            | 0x202F | 0x205F | 0x3000 | 0xFEFF
    )
}

fn is_digit(x: u16) -> bool {
    (c('0')..=c('9')).contains(&x)
}

fn is_ascii_alpha(x: u16) -> bool {
    (c('a')..=c('z')).contains(&x) || (c('A')..=c('Z')).contains(&x)
}

fn is_ascii_alnum(x: u16) -> bool {
    is_ascii_alpha(x) || is_digit(x)
}

fn is_hex(x: u16) -> bool {
    is_digit(x) || (c('a')..=c('f')).contains(&x) || (c('A')..=c('F')).contains(&x)
}

fn is_word(x: u16) -> bool {
    is_ascii_alnum(x) || x == c('_')
}

fn index_of(s: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() || from > s.len() {
        return None;
    }
    (from..=s.len().saturating_sub(needle.len())).find(|&p| s.len() >= p + needle.len() && &s[p..p + needle.len()] == needle)
}

// ---------------------------------------------------------------------------------------------
// extractRequiredLiteralsHeuristic
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Item {
    Break,
    Ch(u16),
}

enum HErr {
    Unsure,
    Deep,
}

/// A quantifier bound, as the JS compares it (=== 0, === 1, other, Infinity).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Bound {
    Zero,
    One,
    Other,
    Inf,
}

fn bound_of(digits: &[u16]) -> Bound {
    let nz: Vec<u16> = digits.iter().copied().skip_while(|&d| d == c('0')).collect();
    match nz.as_slice() {
        [] => Bound::Zero,
        [d] if *d == c('1') => Bound::One,
        _ => Bound::Other,
    }
}

struct Heuristic<'a> {
    s: &'a [u16],
    i: usize,
}

impl Heuristic<'_> {
    fn at(&self, k: usize) -> Option<u16> {
        self.s.get(k).copied()
    }

    /// MAYBE_COUNTED = /^\{\s*[\d,]/ at k.
    fn maybe_counted(&self, k: usize) -> bool {
        if self.at(k) != Some(c('{')) {
            return false;
        }
        let mut j = k + 1;
        while j < self.s.len() && is_js_ws_unit(self.s[j]) {
            j += 1;
        }
        matches!(self.at(j), Some(x) if is_digit(x) || x == c(','))
    }

    /// ESCAPE_ARGUMENT[e].exec(s.slice(i)): the length of the argument, or None.
    fn escape_argument(&self, e: u16) -> Option<usize> {
        let s = &self.s[self.i.min(self.s.len())..];
        let braced_hex = |s: &[u16]| -> Option<usize> {
            if s.first() != Some(&c('{')) {
                return None;
            }
            let n = s[1..].iter().take_while(|&&x| is_hex(x)).count();
            if n > 0 && s.get(1 + n) == Some(&c('}')) {
                Some(n + 2)
            } else {
                None
            }
        };
        let fixed_hex = |s: &[u16], n: usize| -> Option<usize> {
            if s.len() >= n && s[..n].iter().all(|&x| is_hex(x)) {
                Some(n)
            } else {
                None
            }
        };
        if e == c('b') {
            for form in ["{start}", "{end}", "{start-half}", "{end-half}"] {
                let f = u(form);
                if s.len() >= f.len() && s[..f.len()] == f[..] {
                    return Some(f.len());
                }
            }
            None
        } else if e == c('p') || e == c('P') {
            if s.first() == Some(&c('{')) {
                let close = s[1..].iter().position(|&x| x == c('}'))?;
                return Some(close + 2);
            }
            match s.first() {
                Some(&x) if is_ascii_alpha(x) => Some(1),
                _ => None,
            }
        } else if e == c('x') {
            braced_hex(s).or_else(|| fixed_hex(s, 2))
        } else if e == c('u') {
            braced_hex(s).or_else(|| fixed_hex(s, 4))
        } else if e == c('U') {
            braced_hex(s).or_else(|| fixed_hex(s, 8))
        } else {
            None
        }
    }

    /// A quantifier at i: (min, max), or None when none follows.
    fn quantifier(&mut self) -> Result<Option<(Bound, Bound)>, HErr> {
        let ch = self.at(self.i);
        let mut q = match ch {
            Some(x) if x == c('?') => Some((Bound::Zero, Bound::One)),
            Some(x) if x == c('*') => Some((Bound::Zero, Bound::Inf)),
            Some(x) if x == c('+') => Some((Bound::One, Bound::Inf)),
            _ => None,
        };
        if q.is_some() {
            self.i += 1;
        } else if ch == Some(c('{')) {
            // /^\{(\d+)(,(\d*))?\}/
            let s = self.s;
            let mut j = self.i + 1;
            let d1s = j;
            while j < s.len() && is_digit(s[j]) {
                j += 1;
            }
            let d1 = &s[d1s..j];
            let mut parsed = None;
            if !d1.is_empty() {
                if s.get(j) == Some(&c('}')) {
                    let b = bound_of(d1);
                    parsed = Some(((b, b), j + 1));
                } else if s.get(j) == Some(&c(',')) {
                    let mut k = j + 1;
                    let d3s = k;
                    while k < s.len() && is_digit(s[k]) {
                        k += 1;
                    }
                    if s.get(k) == Some(&c('}')) {
                        let d3 = &s[d3s..k];
                        let max = if d3.is_empty() { Bound::Inf } else { bound_of(d3) };
                        parsed = Some(((bound_of(d1), max), k + 1));
                    }
                }
            }
            if let Some((b, end)) = parsed {
                q = Some(b);
                self.i = end;
            } else if self.maybe_counted(self.i) {
                return Err(HErr::Unsure);
            }
        }
        if q.is_some() && matches!(self.at(self.i), Some(x) if x == c('?') || x == c('+')) {
            self.i += 1;
        }
        if q.is_some() && matches!(self.at(self.i), Some(x) if x == c('?') || x == c('*') || x == c('+')) {
            return Err(HErr::Unsure);
        }
        Ok(q)
    }

    fn skip_class(&mut self) -> Result<(), HErr> {
        let s = self.s;
        let mut depth = 0i64;
        let mut first = true;
        while self.i < s.len() {
            let ch = s[self.i];
            if ch == c('\\') {
                self.i += 2;
                first = false;
                continue;
            }
            if ch == c('[') {
                if depth > 0 && self.at(self.i + 1) == Some(c(':')) {
                    match index_of(s, &u(":]"), self.i + 2) {
                        None => return Err(HErr::Unsure),
                        Some(close) => {
                            self.i = close + 2;
                            first = false;
                            continue;
                        }
                    }
                }
                depth += 1;
                self.i += 1;
                if self.at(self.i) == Some(c('^')) {
                    self.i += 1;
                }
                first = true;
                continue;
            }
            if ch == c(']') && !first {
                depth -= 1;
                self.i += 1;
                if depth == 0 {
                    return Ok(());
                }
                continue;
            }
            first = false;
            self.i += 1;
        }
        Err(HErr::Unsure)
    }

    // (the two `unsure` branches mirror the JS branch structure)
    #[allow(clippy::if_same_then_else)]
    fn sequence(&mut self, depth: usize) -> Result<(Vec<Item>, bool), HErr> {
        if depth > MAX_DEPTH {
            return Err(HErr::Deep);
        }
        let s = self.s;
        let mut items: Vec<Item> = Vec::new();
        let mut alternated = false;
        while self.i < s.len() {
            let ch = s[self.i];
            if ch == c(')') {
                if depth == 0 {
                    return Err(HErr::Unsure);
                }
                break;
            }
            if ch == c('|') {
                alternated = true;
                self.i += 1;
                items.push(Item::Break);
                continue;
            }
            let atom: Vec<Item>;
            if ch == c('\\') {
                let e = match self.at(self.i + 1) {
                    None => return Err(HErr::Unsure),
                    Some(e) => e,
                };
                self.i += 2;
                if e == c('<') || e == c('>') {
                    atom = vec![Item::Break];
                } else if is_ascii_alnum(e) {
                    if let Some(n) = self.escape_argument(e) {
                        self.i += n;
                    } else if e == c('b') && self.at(self.i) == Some(c('{')) {
                        return Err(HErr::Unsure);
                    } else if !is_class_escape(e) || (e == c('B') && self.at(self.i) == Some(c('{'))) {
                        return Err(HErr::Unsure);
                    }
                    atom = vec![Item::Break];
                } else {
                    atom = vec![Item::Ch(e)];
                }
            } else if ch == c('[') {
                self.skip_class()?;
                atom = vec![Item::Break];
            } else if ch == c('(') {
                self.i += 1;
                let mut skip = false;
                if self.at(self.i) == Some(c('?')) {
                    // /^\?([a-zA-Z-]*)([:)])/
                    let mut j = self.i + 1;
                    while j < s.len() && (is_ascii_alpha(s[j]) || s[j] == c('-')) {
                        j += 1;
                    }
                    let flags = &s[self.i + 1..j];
                    let term = self.at(j);
                    let after_q = self.at(self.i + 1);
                    if matches!(term, Some(t) if t == c(':') || t == c(')')) {
                        let before_dash: Vec<u16> = flags.iter().copied().take_while(|&x| x != c('-')).collect();
                        if before_dash.contains(&c('x')) {
                            return Err(HErr::Unsure);
                        }
                        self.i = j + 1;
                        if term == Some(c(')')) {
                            items.push(Item::Break);
                            continue;
                        }
                    } else if matches!(after_q, Some(x) if x == c('=') || x == c('!'))
                        || (after_q == Some(c('<')) && matches!(self.at(self.i + 2), Some(x) if x == c('=') || x == c('!')))
                    {
                        skip = true;
                        self.i += if after_q == Some(c('<')) { 3 } else { 2 };
                    } else if self.named_group_open() {
                        let gt = index_of(s, &[c('>')], self.i).unwrap_or(usize::MAX);
                        self.i = gt.wrapping_add(1);
                    } else {
                        return Err(HErr::Unsure);
                    }
                }
                let (inner, inner_alt) = self.sequence(depth + 1)?;
                if self.at(self.i) != Some(c(')')) {
                    return Err(HErr::Unsure);
                }
                self.i += 1;
                atom = if skip || inner_alt {
                    vec![Item::Break]
                } else {
                    let mut a = vec![Item::Break];
                    a.extend(inner);
                    a.push(Item::Break);
                    a
                };
            } else if ch == c('*') || ch == c('+') || ch == c('?') || (ch == c('{') && self.maybe_counted(self.i)) {
                return Err(HErr::Unsure);
            } else {
                self.i += 1;
                atom = if ch == c('.') || ch == c('^') || ch == c('$') || is_js_ws_unit(ch) {
                    vec![Item::Break]
                } else {
                    vec![Item::Ch(ch)]
                };
            }
            match self.quantifier()? {
                None | Some((Bound::One, Bound::One)) => items.extend(atom),
                Some((Bound::Zero, _)) => items.push(Item::Break),
                Some(_) => {
                    items.push(Item::Break);
                    items.extend(atom);
                    items.push(Item::Break);
                }
            }
        }
        Ok((items, alternated))
    }

    /// /^\?P?<[A-Za-z_]\w*>/ at i.
    fn named_group_open(&self) -> bool {
        let s = self.s;
        let mut j = self.i;
        if s.get(j) != Some(&c('?')) {
            return false;
        }
        j += 1;
        if s.get(j) == Some(&c('P')) {
            j += 1;
        }
        if s.get(j) != Some(&c('<')) {
            return false;
        }
        j += 1;
        match s.get(j) {
            Some(&x) if is_ascii_alpha(x) || x == c('_') => {}
            _ => return false,
        }
        j += 1;
        while j < s.len() && is_word(s[j]) {
            j += 1;
        }
        s.get(j) == Some(&c('>'))
    }
}

fn is_class_escape(e: u16) -> bool {
    "bBdDwWsSAzZnrtfv".encode_utf16().any(|x| x == e)
}

/// Substrings that EVERY match of `regex` must contain ([] when the parse is not fully
/// understood). Err = declined (see the module comment).
// Mirrors: core/search/search-pattern-prefilter.js:extractRequiredLiteralsHeuristic
pub fn extract_required_literals_heuristic(regex: &str) -> Result<Vec<String>, Decline> {
    if regex.is_empty() {
        return Ok(Vec::new());
    }
    let s = u(regex);
    let mut h = Heuristic { s: &s, i: 0 };
    let (items, alternated) = match h.sequence(0) {
        Ok(p) => p,
        Err(HErr::Unsure) => return Ok(Vec::new()),
        Err(HErr::Deep) => return Err(Decline("regex groups nested too deep")),
    };
    if h.i != s.len() {
        return Ok(Vec::new());
    }
    if alternated {
        return Ok(Vec::new());
    }
    let mut literals: Vec<U> = Vec::new();
    let mut current: U = Vec::new();
    for item in items.iter().chain(std::iter::once(&Item::Break)) {
        match item {
            Item::Break => {
                if current.len() >= 3 && !literals.contains(&current) {
                    literals.push(current.clone());
                }
                current.clear();
            }
            Item::Ch(x) => current.push(*x),
        }
    }
    literals.iter().map(|l| to_string(l)).collect()
}

// Mirrors: core/search/search-pattern-prefilter.js:extractLiteralClausesHeuristic
pub fn extract_literal_clauses_heuristic(regex: &str) -> Result<Vec<Vec<String>>, Decline> {
    let literals = extract_required_literals_heuristic(regex)?;
    Ok(if literals.is_empty() { Vec::new() } else { vec![literals] })
}

/// Trim (JS whitespace), drop literals under 3 UTF-16 units and duplicates, drop empty and
/// repeated clauses.
// Mirrors: core/search/search-pattern-prefilter.js:normalizeLiteralClauses
pub fn normalize_literal_clauses(clauses: &[Vec<String>]) -> Vec<Vec<String>> {
    let mut normalized: Vec<Vec<String>> = Vec::new();
    for clause in clauses {
        let mut deduped: Vec<String> = Vec::new();
        for literal in clause {
            let trimmed = crate::jsstr::trim_js(literal);
            if crate::jsstr::len16(trimmed) < 3 || deduped.iter().any(|d| d == trimmed) {
                continue;
            }
            deduped.push(trimmed.to_string());
        }
        if deduped.is_empty() {
            continue;
        }
        if !normalized.contains(&deduped) {
            normalized.push(deduped);
        }
    }
    normalized
}

// ---------------------------------------------------------------------------------------------
// Alternation soundness guard
// ---------------------------------------------------------------------------------------------

fn has_alternation_units(s: &[u16]) -> bool {
    let mut in_class = false;
    let mut i = 0;
    while i < s.len() {
        let ch = s[i];
        if ch == c('\\') {
            i += 2;
            continue;
        }
        if in_class {
            if ch == c(']') {
                in_class = false;
            }
            i += 1;
            continue;
        }
        if ch == c('[') {
            in_class = true;
            i += 1;
            continue;
        }
        if ch == c('|') {
            return true;
        }
        i += 1;
    }
    false
}

/// True when the pattern holds an alternation operator outside classes and escapes.
// Mirrors: core/search/search-pattern-prefilter.js:hasAlternation
pub fn has_alternation(regex: &str) -> bool {
    has_alternation_units(&u(regex))
}

struct Expander<'a> {
    s: &'a [u16],
    i: usize,
    bailed: bool,
    deep: bool,
    max: usize,
}

impl Expander<'_> {
    fn at(&self, k: usize) -> Option<u16> {
        self.s.get(k).copied()
    }

    fn parse_alternation(&mut self, depth: usize) -> Option<Vec<U>> {
        if depth > MAX_DEPTH {
            self.deep = true;
            self.bailed = true;
            return None;
        }
        let mut branches: Vec<U> = Vec::new();
        let current = self.parse_branch(depth);
        if self.bailed {
            return None;
        }
        branches.extend(current.unwrap_or_default());
        while self.i < self.s.len() && self.s[self.i] == c('|') {
            self.i += 1;
            let current = self.parse_branch(depth);
            if self.bailed {
                return None;
            }
            branches.extend(current.unwrap_or_default());
            if branches.len() > self.max {
                self.bailed = true;
                return None;
            }
        }
        Some(branches)
    }

    fn parse_branch(&mut self, depth: usize) -> Option<Vec<U>> {
        let mut out: Vec<U> = vec![U::new()];
        while self.i < self.s.len() && self.s[self.i] != c('|') && !(depth > 0 && self.s[self.i] == c(')')) {
            let options = self.parse_atom(depth);
            if self.bailed {
                return None;
            }
            let options = options.unwrap_or_default();
            let mut next: Vec<U> = Vec::new();
            for prefix in &out {
                for opt in &options {
                    let mut x = prefix.clone();
                    x.extend_from_slice(opt);
                    next.push(x);
                }
            }
            if next.len() > self.max {
                self.bailed = true;
                return None;
            }
            out = next;
        }
        Some(out)
    }

    fn parse_atom(&mut self, depth: usize) -> Option<Vec<U>> {
        let s = self.s;
        let ch = s[self.i];
        if ch == c('\\') {
            let end = (self.i + 2).min(s.len());
            let mut lit = s[self.i..end].to_vec();
            self.i += 2;
            lit.extend(self.take_quantifier());
            return Some(vec![lit]);
        }
        if ch == c('[') {
            let start = self.i;
            self.i += 1;
            if self.at(self.i) == Some(c('^')) {
                self.i += 1;
            }
            if self.at(self.i) == Some(c(']')) {
                self.i += 1;
            }
            while self.i < s.len() && s[self.i] != c(']') {
                if s[self.i] == c('\\') {
                    self.i += 1;
                }
                self.i += 1;
            }
            if self.i >= s.len() {
                self.bailed = true;
                return None;
            }
            self.i += 1;
            let mut lit = s[start..self.i].to_vec();
            lit.extend(self.take_quantifier());
            return Some(vec![lit]);
        }
        if ch == c('(') {
            let start = self.i;
            self.i += 1;
            let mut prefix: U = u("(");
            let mut expandable = true;
            if self.at(self.i) == Some(c('?')) {
                if self.at(self.i + 1) == Some(c(':')) {
                    self.i += 2;
                    prefix = u("(?:");
                } else {
                    expandable = false;
                }
            }
            if !expandable {
                let end = match skip_group(s, start) {
                    None => {
                        self.bailed = true;
                        return None;
                    }
                    Some(e) => e,
                };
                let mut body = s[start..end].to_vec();
                self.i = end;
                if has_alternation_units(&body[1..body.len() - 1]) {
                    self.bailed = true;
                    return None;
                }
                body.extend(self.take_quantifier());
                return Some(vec![body]);
            }
            let inner = self.parse_alternation(depth + 1);
            if self.bailed {
                return None;
            }
            let inner = inner.unwrap_or_default();
            if self.at(self.i) != Some(c(')')) {
                self.bailed = true;
                return None;
            }
            self.i += 1;
            let quant = self.take_quantifier();
            if !quant.is_empty() && inner.len() > 1 {
                self.bailed = true;
                return None;
            }
            if quant.is_empty() {
                return Some(inner);
            }
            return Some(
                inner
                    .into_iter()
                    .map(|x| {
                        let mut o = prefix.clone();
                        o.extend(x);
                        o.push(c(')'));
                        o.extend_from_slice(&quant);
                        o
                    })
                    .collect(),
            );
        }
        if ch == c(')') {
            self.bailed = true;
            return None;
        }
        self.i += 1;
        let mut lit = vec![ch];
        lit.extend(self.take_quantifier());
        Some(vec![lit])
    }

    fn take_quantifier(&mut self) -> U {
        let s = self.s;
        if self.i >= s.len() {
            return U::new();
        }
        let ch = s[self.i];
        let mut q = U::new();
        if ch == c('*') || ch == c('+') || ch == c('?') {
            q.push(ch);
            self.i += 1;
        } else if ch == c('{') {
            let close = match index_of(s, &[c('}')], self.i) {
                None => return U::new(),
                Some(x) => x,
            };
            let body = &s[self.i + 1..close];
            // /^\d+(,\d*)?$/
            let d1 = body.iter().take_while(|&&x| is_digit(x)).count();
            let ok = d1 > 0
                && (d1 == body.len() || (body[d1] == c(',') && body[d1 + 1..].iter().all(|&x| is_digit(x))));
            if !ok {
                return U::new();
            }
            q = s[self.i..close + 1].to_vec();
            self.i = close + 1;
        }
        if !q.is_empty() && matches!(self.at(self.i), Some(x) if x == c('?') || x == c('+')) {
            q.push(s[self.i]);
            self.i += 1;
        }
        q
    }
}

/// Index just past the group opening at `from`, honouring classes and escapes.
fn skip_group(s: &[u16], from: usize) -> Option<usize> {
    let mut depth = 0i64;
    let mut in_class = false;
    let mut j = from;
    while j < s.len() {
        let ch = s[j];
        if ch == c('\\') {
            j += 2;
            continue;
        }
        if in_class {
            if ch == c(']') {
                in_class = false;
            }
            j += 1;
            continue;
        }
        if ch == c('[') {
            in_class = true;
            j += 1;
            continue;
        }
        if ch == c('(') {
            depth += 1;
        } else if ch == c(')') {
            depth -= 1;
            if depth == 0 {
                return Some(j + 1);
            }
        }
        j += 1;
    }
    None
}

/// The alternatives a regex's alternations stand for, the matched language preserved; Ok(None)
/// = cannot be done safely (do not prefilter). Err = declined.
// Mirrors: core/search/search-pattern-prefilter.js:expandAlternatives
pub fn expand_alternatives(regex: &str, max: usize) -> Result<Option<Vec<String>>, Decline> {
    let s = u(regex);
    let mut e = Expander { s: &s, i: 0, bailed: false, deep: false, max };
    let alts = e.parse_alternation(0);
    if e.deep {
        return Err(Decline("regex groups nested too deep"));
    }
    let alts = match alts {
        Some(a) if !e.bailed && e.i == s.len() => a,
        _ => return Ok(None),
    };
    if alts.is_empty() || alts.len() > max {
        return Ok(None);
    }
    Ok(Some(alts.iter().map(|a| to_string(a)).collect::<Result<_, _>>()?))
}

// ---------------------------------------------------------------------------------------------
// extractLiteralClauses
// ---------------------------------------------------------------------------------------------

/// `{ fixedString, forceHeuristic }` of extractLiteralClauses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LiteralOptions {
    pub fixed_string: bool,
    pub force_heuristic: bool,
}

/// `{ clauses, source }`: OR-clauses of AND-literals; source is one of "native", "heuristic",
/// "fixed-string", "none", "unsafe-alternation".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiteralPlan {
    pub clauses: Vec<Vec<String>>,
    pub source: &'static str,
}

/// `addon.extractRegexLiterals(regex).clauses`; None = it threw (or there is no addon).
pub type NativeExtractor<'a> = &'a dyn Fn(&str) -> Option<Vec<Vec<String>>>;

// Mirrors: core/search/search-pattern-prefilter.js:extractClausesDirect
fn extract_clauses_direct(regex: &str, options: LiteralOptions, native: NativeExtractor) -> Result<LiteralPlan, Decline> {
    if !options.force_heuristic {
        if let Some(clauses) = native(regex) {
            let n = normalize_literal_clauses(&clauses);
            if !n.is_empty() {
                return Ok(LiteralPlan { clauses: n, source: "native" });
            }
        }
    }
    let h = extract_literal_clauses_heuristic(regex)?;
    if !h.is_empty() {
        return Ok(LiteralPlan { clauses: h, source: "heuristic" });
    }
    Ok(LiteralPlan { clauses: Vec::new(), source: "none" })
}

/// The literal clauses every match of `regex` contains (see the JS for the rules).
// Mirrors: core/search/search-pattern-prefilter.js:extractLiteralClauses (+ extractLiteralClausesUncached)
pub fn extract_literal_clauses(regex: &str, options: LiteralOptions, native: NativeExtractor) -> Result<LiteralPlan, Decline> {
    if regex.is_empty() {
        return Ok(LiteralPlan { clauses: Vec::new(), source: "none" });
    }
    if options.fixed_string {
        if regex.contains('\r') || regex.contains('\n') {
            return Ok(LiteralPlan { clauses: Vec::new(), source: "none" });
        }
        let clauses = normalize_literal_clauses(&[vec![regex.to_string()]]);
        let source = if clauses.is_empty() { "none" } else { "fixed-string" };
        return Ok(LiteralPlan { clauses, source });
    }
    if has_alternation(regex) {
        let alternatives = match expand_alternatives(regex, MAX_ALTERNATIVES)? {
            None => return Ok(LiteralPlan { clauses: Vec::new(), source: "unsafe-alternation" }),
            Some(a) => a,
        };
        let mut union: Vec<Vec<String>> = Vec::new();
        let mut source = "native";
        for alt in &alternatives {
            let got = extract_clauses_direct(alt, options, native)?;
            if got.clauses.is_empty() {
                return Ok(LiteralPlan { clauses: Vec::new(), source: "unsafe-alternation" });
            }
            if got.source == "heuristic" {
                source = "heuristic";
            }
            union.extend(got.clauses);
        }
        let clauses = normalize_literal_clauses(&union);
        return Ok(if clauses.is_empty() {
            LiteralPlan { clauses: Vec::new(), source: "unsafe-alternation" }
        } else {
            LiteralPlan { clauses, source }
        });
    }
    extract_clauses_direct(regex, options, native)
}

// ---------------------------------------------------------------------------------------------
// prefilterLiteralClauses
// ---------------------------------------------------------------------------------------------

/// The clauses each prefilter can use soundly: ripgrep, the ASCII-folding native fixed-string
/// grep, the sparse gram index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrefilterClauses {
    pub rg: Vec<Vec<String>>,
    pub ascii: Vec<Vec<String>>,
    pub gram: Vec<Vec<String>>,
}

/// `/[ks]|[^\x00-\x7F]/iu`: k, K, s, S (with U+212A and U+017F, which fold to them) and every
/// other non-ASCII code point.
fn is_ci_cut(ch: char) -> bool {
    matches!(ch, 'k' | 'K' | 's' | 'S') || !ch.is_ascii()
}

/// `/[^A-Za-z0-9_./:-]/` (a non-ASCII char is a cut either way).
fn is_gram_cut(ch: char) -> bool {
    !(ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '/' | ':' | '-'))
}

// Mirrors: core/search/search-pattern-prefilter.js:splitClauses
fn split_clauses(clauses: &[Vec<String>], at: fn(char) -> bool) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    for clause in clauses {
        let parts: Vec<String> = clause
            .iter()
            .flat_map(|literal| literal.split(at).map(str::to_string).collect::<Vec<_>>())
            .filter(|part| crate::jsstr::len16(part) >= 3)
            .collect();
        if parts.is_empty() {
            return Vec::new();
        }
        out.push(parts);
    }
    normalize_literal_clauses(&out)
}

// Mirrors: core/search/search-pattern-prefilter.js:prefilterLiteralClauses
pub fn prefilter_literal_clauses(clauses: &[Vec<String>], case_insensitive: bool) -> PrefilterClauses {
    let ascii = if case_insensitive { split_clauses(clauses, is_ci_cut) } else { clauses.to_vec() };
    let gram = split_clauses(&ascii, is_gram_cut);
    PrefilterClauses { rg: clauses.to_vec(), ascii, gram }
}

/// The clause list the JS hands to the sparse-gram query: `extractLiteralClauses(regex)` (default
/// options) then `prefilterLiteralClauses(clauses, { caseInsensitive: ci }).gram`. `native` is
/// `addon.extractRegexLiterals(s).clauses` for every string the JS asks it about (None = threw).
/// Err = not covered (see the module comment); the lane then lets the JS answer.
// Mirrors: core/search/search-pattern-prefilter.js:extractLiteralClauses + prefilterLiteralClauses(..).gram
pub fn gram_clauses(
    regex: &str,
    ci: bool,
    native: &dyn Fn(&str) -> Option<Vec<Vec<String>>>,
) -> Result<Vec<Vec<String>>, Decline> {
    let plan = extract_literal_clauses(regex, LiteralOptions::default(), native)?;
    Ok(prefilter_literal_clauses(&plan.clauses, ci).gram)
}
