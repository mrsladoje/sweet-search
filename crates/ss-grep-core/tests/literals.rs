//! src/literals.rs against fixtures-gen/literals.mjs; the native extractor is replayed from the
//! answers it gave the JS.
mod common;

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};

use common::{load, strs};
use serde_json::Value;
use ss_grep_core::args::{build_grep_pattern, has_case_insensitive_regex_flag};
use ss_grep_core::literals::*;

fn clauses_of(v: &Value) -> Vec<Vec<String>> {
    v.as_array().unwrap().iter().map(strs).collect()
}

struct Replay {
    answers: HashMap<String, Value>,
    unknown: RefCell<BTreeSet<String>>,
}

impl Replay {
    fn call(&self, s: &str) -> Option<Vec<Vec<String>>> {
        match self.answers.get(s) {
            None => {
                self.unknown.borrow_mut().insert(s.to_string());
                None
            }
            Some(Value::Number(n)) if n.as_u64() == Some(0) => Some(vec![]),
            Some(Value::Number(_)) => Some(vec![vec![s.to_string()]]),
            Some(Value::String(_)) => None, // threw
            Some(Value::Null) => Some(vec![]),
            Some(v) => Some(clauses_of(v)),
        }
    }
}

fn check_plan(
    regex: &str,
    opts: LiteralOptions,
    want: &Value,
    native: NativeExtractor,
    declines: &mut Vec<String>,
    ctx: &str,
) {
    let got = extract_literal_clauses(regex, opts, native);
    if want.as_array().map(|a| a.len()) == Some(1) {
        assert!(got.is_err(), "{ctx}: JS threw on {regex:?}, the port did not decline");
        return;
    }
    let plan = match got {
        Ok(p) => p,
        Err(e) => {
            declines.push(format!("{regex:?} {opts:?}: {e:?}"));
            return;
        }
    };
    let want_clauses = clauses_of(&want[0]);
    assert_eq!(plan.clauses, want_clauses, "{ctx}: clauses of {regex:?} {opts:?}");
    assert_eq!(plan.source, want[1].as_str().unwrap(), "{ctx}: source of {regex:?} {opts:?}");
    let pre = prefilter_literal_clauses(&plan.clauses, has_case_insensitive_regex_flag(regex));
    let want_ascii = if want[2] == 1 { want_clauses.clone() } else { clauses_of(&want[2]) };
    let want_gram = if want[3] == 1 { want_ascii.clone() } else { clauses_of(&want[3]) };
    assert_eq!(pre.rg, want_clauses, "{ctx}: rg of {regex:?}");
    assert_eq!(pre.ascii, want_ascii, "{ctx}: ascii of {regex:?}");
    assert_eq!(pre.gram, want_gram, "{ctx}: gram of {regex:?}");
}

#[test]
fn literal_clauses_match_js() {
    let fx = load("literals", "literals");
    let replay = Replay {
        answers: fx["native"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        unknown: RefCell::new(BTreeSet::new()),
    };
    let native = |s: &str| replay.call(s);
    let mut declines: Vec<String> = Vec::new();
    let mut checked = 0;
    let rows = fx["cases"].as_array().unwrap();
    for row in rows {
        let p = row[0].as_str().unwrap();
        let variants: Vec<(Option<String>, LiteralOptions)> = vec![
            (build_grep_pattern(Some(p), false, false, false), LiteralOptions::default()),
            (build_grep_pattern(Some(p), true, false, false), LiteralOptions::default()),
            (build_grep_pattern(Some(p), false, true, false), LiteralOptions::default()),
            (build_grep_pattern(Some(p), false, false, true), LiteralOptions::default()),
            (Some(p.to_string()), LiteralOptions { fixed_string: true, force_heuristic: false }),
            (Some(p.to_string()), LiteralOptions { fixed_string: false, force_heuristic: true }),
        ];
        for (k, (regex, opts)) in variants.iter().enumerate() {
            let mut want = &row[k + 1];
            while let Some(idx) = want.as_u64() {
                want = &row[idx as usize + 1];
            }
            check_plan(regex.as_deref().unwrap(), *opts, want, &native, &mut declines, &format!("pattern {p:?} variant {k}"));
            checked += 1;
        }
    }
    let unknown = replay.unknown.borrow();
    assert!(unknown.is_empty(), "native calls the JS never made: {:?}", unknown.iter().take(10).collect::<Vec<_>>());
    eprintln!("literals: {checked} plans over {} patterns, {} declined: {:?}", rows.len(), declines.len(), declines);
    assert!(declines.len() <= 4, "too many declines");
}

/// gram_clauses (the lane's entry point) on the raw and -i forms of every pattern.
#[test]
fn gram_clauses_match_js() {
    let fx = load("literals", "literals");
    let replay = Replay {
        answers: fx["native"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        unknown: RefCell::new(BTreeSet::new()),
    };
    let native = |s: &str| replay.call(s);
    let mut n = 0;
    for row in fx["cases"].as_array().unwrap() {
        let p = row[0].as_str().unwrap();
        for (k, ic) in [(0usize, false), (1, true)] {
            let regex = build_grep_pattern(Some(p), ic, false, false).unwrap();
            let mut want = &row[k + 1];
            while let Some(idx) = want.as_u64() {
                want = &row[idx as usize + 1];
            }
            let got = gram_clauses(&regex, has_case_insensitive_regex_flag(&regex), &native);
            if want.as_array().map(|a| a.len()) == Some(1) {
                assert!(got.is_err(), "{regex:?} must decline");
                continue;
            }
            let rg = clauses_of(&want[0]);
            let ascii = if want[2] == 1 { rg } else { clauses_of(&want[2]) };
            let gram = if want[3] == 1 { ascii } else { clauses_of(&want[3]) };
            assert_eq!(got.unwrap(), gram, "gram_clauses({regex:?})");
            n += 1;
        }
    }
    assert!(replay.unknown.borrow().is_empty());
    eprintln!("gram_clauses: {n} patterns equal");
}

#[test]
fn literal_helpers_match_js() {
    let fx = load("literals", "literals");
    let mut n = 0;
    for d in fx["direct"].as_array().unwrap() {
        let s = d[0].as_str().unwrap();
        assert_eq!(has_alternation(s), d[1].as_bool().unwrap(), "hasAlternation({s:?})");
        // "lone" = the JS result holds a lone surrogate half: the port must decline
        if d[2] == "lone" {
            assert!(expand_alternatives(s, MAX_ALTERNATIVES).is_err(), "expandAlternatives({s:?}) must decline");
        } else {
            let want = if d[2].is_null() { None } else { Some(strs(&d[2])) };
            assert_eq!(expand_alternatives(s, MAX_ALTERNATIVES).unwrap(), want, "expandAlternatives({s:?})");
        }
        if d[3] == "lone" {
            assert!(extract_required_literals_heuristic(s).is_err(), "heuristic({s:?}) must decline");
        } else {
            assert_eq!(extract_required_literals_heuristic(s).unwrap(), strs(&d[3]), "extractRequiredLiteralsHeuristic({s:?})");
        }
        let pre = &d[4];
        if pre.is_null() {
            continue;
        }
        let plan_rg = clauses_of(&pre["rg"]);
        let got = prefilter_literal_clauses(&plan_rg, true);
        assert_eq!(got.ascii, clauses_of(&pre["ascii"]), "ascii split of {s:?}");
        assert_eq!(got.gram, clauses_of(&pre["gram"]), "gram split of {s:?}");
        n += 1;
    }
    eprintln!("literal helpers: {n} synthetic patterns");
}
