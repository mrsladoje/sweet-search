//! src/paths.rs against fixtures-gen/paths.mjs.
mod common;

use common::{fixture_names, load, strs, FakeProbe};
use serde_json::Value;
use ss_grep_core::paths::*;

/// A probe for pure path functions: any question is a test failure.
struct NoProbe;
impl PathProbe for NoProbe {
    fn exists(&self, abs: &str) -> bool {
        panic!("unexpected exists({abs})")
    }
    fn realpath(&self, abs: &str) -> Option<String> {
        panic!("unexpected realpath({abs})")
    }
    fn is_file(&self, abs: &str) -> bool {
        panic!("unexpected is_file({abs})")
    }
}

fn opt_str(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

#[test]
fn node_path_posix_matches_js() {
    let fx = load("paths", "nodepath");
    let cwd = fx["cwd"].as_str().unwrap();
    let cases = fx["cases"].as_array().unwrap();
    for c in cases {
        let (a, b, cc) = (c[0].as_str().unwrap(), c[1].as_str().unwrap(), c[2].as_str().unwrap());
        assert_eq!(posix_normalize(a), c[3].as_str().unwrap(), "normalize({a:?})");
        assert_eq!(posix_join(&[a, b, cc]), c[4].as_str().unwrap(), "join({a:?}, {b:?}, {cc:?})");
        assert_eq!(posix_resolve(cwd, &[a, b]), c[5].as_str().unwrap(), "resolve({a:?}, {b:?})");
        assert_eq!(posix_relative(cwd, a, b), c[6].as_str().unwrap(), "relative({a:?}, {b:?})");
        assert_eq!(posix_is_absolute(a), c[7].as_bool().unwrap(), "isAbsolute({a:?})");
    }
    eprintln!("nodepath: {} cases", cases.len());
    let _ = NoProbe;
}

#[test]
fn cwd_paths_match_js() {
    let fx = load("paths", "cwd_synthetic");
    let probe = FakeProbe::from_fixture(&fx["probe"]);
    let ps = strs(&fx["ps"]);
    let globs = strs(&fx["globs"]);
    let t = fx["T"].as_str().unwrap();
    let mut n = 0;
    for c in fx["cases"].as_array().unwrap() {
        let cwd = c[0].as_str().unwrap();
        let root = c[1].as_str().unwrap();
        assert_eq!(cwd_offset(cwd, root, &probe), opt_str(&c[2]), "cwdOffset({cwd:?}, {root:?})");
        assert_eq!(cwd_grep_scope(cwd, root, root, &probe), opt_str(&c[3]), "cwdGrepScope({cwd:?}, {root:?})");
        assert_eq!(cwd_grep_scope(cwd, root, t, &probe), opt_str(&c[4]), "cwdGrepScope({cwd:?}, {root:?}, T)");
        for (i, p) in ps.iter().enumerate() {
            assert_eq!(resolve_cwd_path(p, cwd, root, &probe), c[5][i].as_str().unwrap(), "resolveCwdPath({p:?}, {cwd:?}, {root:?})");
            n += 1;
        }
        for (i, g) in globs.iter().enumerate() {
            assert_eq!(resolve_cwd_glob(g, cwd, root, &probe), c[6][i].as_str().unwrap(), "resolveCwdGlob({g:?}, {cwd:?}, {root:?})");
            n += 1;
        }
    }
    let unknown = probe.unknown.borrow();
    assert!(unknown.is_empty(), "probes the JS never made: {:?}", unknown.iter().take(10).collect::<Vec<_>>());
    eprintln!("cwd paths: {n} resolutions");
}

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

fn filter_of(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.clone()],
        Value::Array(_) => strs(v),
        _ => vec![],
    }
}

#[test]
fn grep_file_filter_matches_js() {
    let mut checks = 0;
    let mut declined = 0;
    for name in fixture_names("paths") {
        if !name.starts_with("filter_") {
            continue;
        }
        let fx = load("paths", &name);
        let probe = FakeProbe::from_fixture(&fx["probe"]);
        let files = strs(&fx["files"]);
        let corpus = name != "filter_synthetic";
        for c in fx["cases"].as_array().unwrap() {
            let filter = filter_of(&c[0]);
            let root: Option<String> = if corpus { Some(fx["R"].as_str().unwrap().to_string()) } else { opt_str(&c[1]) };
            let want: Vec<bool> = if corpus {
                hex_bits(c[1].as_str().unwrap(), files.len())
            } else {
                c[2].as_array().unwrap().iter().map(|b| b.as_bool().unwrap()).collect()
            };
            let pred = match grep_file_filter_predicate(&filter, root.as_deref(), &probe) {
                Ok(p) => p,
                Err(_) => {
                    declined += 1;
                    continue;
                }
            };
            for (i, f) in files.iter().enumerate() {
                assert_eq!(pred.matches(f), want[i], "{name}: filter {filter:?} root {root:?} file {f:?}");
                assert_eq!(matches_grep_file_filter(f, &filter, root.as_deref(), &probe).unwrap(), want[i]);
                checks += 1;
            }
        }
        let unknown = probe.unknown.borrow();
        assert!(unknown.is_empty(), "{name}: probes the JS never made: {:?}", unknown.iter().take(10).collect::<Vec<_>>());
    }
    eprintln!("grep file filter: {checks} file checks, {declined} filters declined");
    assert_eq!(declined, 0);
}
