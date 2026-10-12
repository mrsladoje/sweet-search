//! src/globs.rs against fixtures-gen/globs.mjs.
mod common;

use std::collections::HashMap;

use common::{fixture_names, load, strs};
use serde_json::Value;
use ss_grep_core::globs::*;

fn hex_bits(h: &str, n: usize) -> Vec<bool> {
    let mut out = Vec::new();
    for ch in h.chars() {
        let v = ch.to_digit(16).unwrap();
        for j in (0..4).rev() {
            out.push((v >> j) & 1 == 1);
        }
    }
    out.truncate(n);
    out
}

#[test]
fn minimatch_matches_js() {
    let fx = load("globs", "minimatch");
    let paths = strs(&fx["paths"]);
    let (mut ok, mut declined) = (0, 0);
    let mut declined_patterns = Vec::new();
    for c in fx["cases"].as_array().unwrap() {
        let p = c[0].as_str().unwrap();
        let want = c[1].as_str().unwrap();
        let mm = match Minimatch::new(p) {
            Ok(m) => m,
            Err(_) => {
                declined += 1;
                declined_patterns.push(p.to_string());
                continue;
            }
        };
        assert_ne!(want, "throw", "JS throws on {p:?} but the port compiled it");
        let bits = hex_bits(want, paths.len());
        for (i, f) in paths.iter().enumerate() {
            assert_eq!(mm.matches(f), bits[i], "minimatch({f:?}, {p:?})");
        }
        ok += 1;
    }
    eprintln!("minimatch: {ok} patterns equal on {} paths, {declined} declined", paths.len());
    eprintln!("declined patterns (first 40): {:?}", &declined_patterns[..declined_patterns.len().min(40)]);
}

#[test]
fn compiled_globs_match_js() {
    let mut checks = 0;
    for name in fixture_names("globs") {
        if name == "minimatch" {
            continue;
        }
        let fx = load("globs", &name);
        let files = strs(&fx["files"]);
        let corpus = name.starts_with("corpus_");
        for c in fx["cases"].as_array().unwrap() {
            let list = strs(&c[0]);
            if c[1].as_str() == Some("throw") {
                assert!(compile_path_globs(&list).is_err(), "{name}: JS throws on {list:?}");
                continue;
            }
            let compiled = compile_path_globs(&list).unwrap_or_else(|e| panic!("{name}: {list:?} declined: {e:?}"));
            match (&compiled, &c[1]) {
                (None, Value::Null) => continue,
                (Some(_), Value::Null) | (None, _) => panic!("{name}: {list:?} compiled-ness differs"),
                _ => {}
            }
            let compiled = compiled.unwrap();
            let want: Vec<bool> = if corpus {
                hex_bits(c[1].as_str().unwrap(), files.len())
            } else {
                c[1].as_array().unwrap().iter().map(|b| b.as_bool().unwrap()).collect()
            };
            for (i, f) in files.iter().enumerate() {
                assert_eq!(compiled.matches(f), want[i], "{name}: globs {list:?} file {f:?}");
                checks += 1;
            }
            assert_eq!(compiled.dirs_matched(), strs(&c[2]), "{name}: dirsMatched of {list:?}");
        }
    }
    eprintln!("compiled globs: {checks} file checks");
}

#[test]
fn filter_matches_counts_match_js() {
    let fx = load("globs", "synthetic");
    let matches = strs(&fx["matches"]);
    let totals: HashMap<String, u64> =
        fx["totals"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_u64().unwrap())).collect();
    let idx: Vec<usize> = (0..matches.len()).collect();
    for c in fx["filterCases"].as_array().unwrap() {
        let list = strs(&c[0]);
        let compiled = compile_path_globs(&list).unwrap();
        let a = filter_matches_by_path_globs(&idx, |i| matches[*i].as_str(), compiled.as_ref(), None);
        let want_a: Vec<usize> = c[1].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as usize).collect();
        assert_eq!(a.kept, want_a, "kept {list:?}");
        assert_eq!(a.excluded_matches, c[2].as_u64().unwrap(), "excludedMatches {list:?}");
        assert_eq!(a.excluded_files, c[3].as_u64().unwrap(), "excludedFiles {list:?}");
        let compiled = compile_path_globs(&list).unwrap();
        let b = filter_matches_by_path_globs(&idx, |i| matches[*i].as_str(), compiled.as_ref(), Some(&totals));
        let want_b: Vec<usize> = c[4].as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as usize).collect();
        assert_eq!(b.kept, want_b, "kept with totals {list:?}");
        assert_eq!(b.excluded_matches, c[5].as_u64().unwrap(), "excludedMatches with totals {list:?}");
        assert_eq!(b.excluded_files, c[6].as_u64().unwrap(), "excludedFiles with totals {list:?}");
    }
    for c in fx["hasCases"].as_array().unwrap() {
        assert_eq!(has_path_globs(&strs(&c[0])), c[1].as_bool().unwrap());
    }
}
