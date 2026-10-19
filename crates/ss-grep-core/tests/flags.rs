//! grep's agent forms (src/args.rs, src/render.rs) against fixtures-gen/flags.mjs.
mod common;

use common::{load, strs};
use serde_json::Value;
use ss_grep_core::args::*;
use ss_grep_core::render::*;
use ss_grep_core::types::SummaryFile;

#[test]
fn bre_alternation_matches_js() {
    let fx = load("flags", "pure");
    let cases = fx["translate"].as_array().expect("translate");
    let mut bad = Vec::new();
    for c in cases {
        let p = c[0].as_str().unwrap();
        let want = c[1].as_str().map(str::to_string);
        let got = translate_bre_alternation(p);
        if got != want && bad.len() < 10 {
            bad.push(format!("{p:?}: js={want:?} rs={got:?}"));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
    assert!(cases.len() > 3000);
}

#[test]
fn grep_bundles_and_unsupported_match_js() {
    let fx = load("flags", "pure");
    for c in fx["normalize"].as_array().unwrap() {
        let args = strs(&c[0]);
        assert_eq!(normalize_args_with(&args, &GREP_BOOL_SHORTS), strs(&c[1]), "grep {args:?}");
        assert_eq!(normalize_args(&args), strs(&c[2]), "default {args:?}");
    }
    for c in fx["unsupported"].as_array().unwrap() {
        let args = strs(&c[0]);
        assert_eq!(unsupported_grep_option(&args), c[1].as_str(), "{args:?}");
    }
}

#[test]
fn mode_renderers_match_js() {
    let fx = load("flags", "pure");
    for c in fx["lists"].as_array().unwrap() {
        let files: Vec<SummaryFile> = serde_json::from_value(c[0].clone()).unwrap();
        let (k, n) = (c[1].as_u64().unwrap() as usize, c[2].as_u64().unwrap() as usize);
        assert_eq!(render_grep_file_list(&files, k, n), strs(&c[3]), "-l {files:?} k={k} n={n}");
        assert_eq!(render_grep_file_counts(&files, k, n), strs(&c[4]), "-c {files:?} k={k} n={n}");
    }
    for c in fx["only"].as_array().unwrap() {
        let rows: Vec<(String, u32, Vec<String>)> = c[0]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| (r[0].as_str().unwrap().to_string(), r[1].as_u64().unwrap() as u32, strs(&r[2])))
            .collect();
        let typed = strs(&c[1]);
        assert_eq!(render_grep_only_matching(&rows, &typed), strs(&c[2]), "-o {rows:?} typed={typed:?}");
    }
    let _ = Value::Null;
}
