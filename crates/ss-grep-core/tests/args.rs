//! src/args.rs against fixtures-gen/args.mjs (cmdGrep's argument part run from the real JS).
mod common;

use common::{fixture_names, load, strs, FakeProbe};
use serde_json::Value;
use ss_grep_core::args::*;

#[test]
fn grep_args_match_js() {
    let mut total = 0;
    let mut declined = 0;
    let mut failures: Vec<String> = Vec::new();
    for name in fixture_names("args") {
        if name == "pure" {
            continue;
        }
        let fx = load("args", &name);
        let probe = FakeProbe::from_fixture(&fx["probe"]);
        let default_root = fx["R"].as_str().expect("R").to_string();
        for case in fx["cases"].as_array().expect("cases") {
            total += 1;
            let args = strs(&case[0]);
            let cwd = case[1].as_str().expect("cwd");
            let root = case.get(3).and_then(Value::as_str).unwrap_or(&default_root);
            let got = parse_grep_args(&args, &probe, cwd, root);
            let expect = &case[2];
            let ok = match (&got, expect) {
                (Err(_), Value::String(_)) => {
                    declined += 1;
                    true
                }
                (Ok(g), Value::Array(e)) => {
                    g.ignore_case == e[0].as_bool().unwrap()
                        && g.word_bound == e[1].as_bool().unwrap()
                        && g.fixed_string == e[2].as_bool().unwrap()
                        && g.k as f64 == e[3].as_f64().unwrap()
                        && g.before as f64 == e[4].as_f64().unwrap()
                        && g.after as f64 == e[5].as_f64().unwrap()
                        && g.in_paths == strs(&e[6])
                        && g.globs == strs(&e[7])
                        && g.raw_pattern == raw_pattern_of(&e[8], &args)
                        && g.regex == if e[9] == Value::Bool(true) { raw_pattern_of(&e[8], &args) } else { e[9].as_str().unwrap().to_string() }
                }
                _ => false,
            };
            if !ok && failures.len() < 20 {
                failures.push(format!("{name}: args={args:?} cwd={cwd} root={root}\n  js={expect}\n  rs={got:?}"));
            }
        }
        let unknown = probe.unknown.borrow();
        assert!(unknown.is_empty(), "{name}: probes the JS never made: {:?}", unknown.iter().take(10).collect::<Vec<_>>());
    }
    assert!(failures.is_empty(), "{} mismatches, first:\n{}", failures.len(), failures.join("\n"));
    eprintln!("args: {total} cases, {declined} declined as the JS did");
    assert!(total > 5000);
}

/// The fixture stores rawPattern as the index of the argument it equals, or as a string.
fn raw_pattern_of(v: &Value, args: &[String]) -> String {
    match v {
        Value::Number(n) => args[n.as_u64().unwrap() as usize].clone(),
        v => v.as_str().unwrap().to_string(),
    }
}

fn js_number_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n == 0.0 && n.is_sign_negative() {
        "-0".into()
    } else {
        format!("{n}")
    }
}

#[test]
fn pure_helpers_match_js() {
    let fx = load("args", "pure");
    let toks = strs(&fx["toks"]);
    for (i, t) in toks.iter().enumerate() {
        assert_eq!(looks_like_option(t), fx["looksLikeOption"][i].as_bool().unwrap(), "looksLikeOption {t:?}");
        assert_eq!(has_leading_inline_i_flag(t), fx["inlineI"][i].as_bool().unwrap(), "inline i {t:?}");
        assert_eq!(has_case_insensitive_regex_flag(t), fx["hasCaseInsensitiveRegexFlag"][i].as_bool().unwrap(), "ci flag {t:?}");
        assert_eq!(escape_regex(t), fx["escapeRegex"][i].as_str().unwrap(), "escapeRegex {t:?}");
    }
    for (i, list) in fx["argLists"].as_array().unwrap().iter().enumerate() {
        let args = strs(list);
        assert_eq!(normalize_args(&args), strs(&fx["normalizeArgs"][i]), "normalizeArgs {args:?}");
    }
    for (i, s) in strs(&fx["nums"]).iter().enumerate() {
        let want = fx["numbers"][i].as_str().unwrap();
        let got = js_string_to_number(s);
        let same = match want {
            "NaN" => got.is_nan(),
            "-0" => got == 0.0 && got.is_sign_negative(),
            "Infinity" => got == f64::INFINITY,
            "-Infinity" => got == f64::NEG_INFINITY,
            w => w.parse::<f64>().map(|x| x == got && !(got == 0.0 && got.is_sign_negative())).unwrap_or(false),
        };
        assert!(same, "Number({s:?}): js {want}, rust {}", js_number_string(got));
    }
}
