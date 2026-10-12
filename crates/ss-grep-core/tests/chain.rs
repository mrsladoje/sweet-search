//! src/chain.rs against fixtures-gen/chain.mjs.
mod common;

use std::collections::HashMap;

use common::{load, strs};
use ss_grep_core::chain::*;

#[test]
fn chain_boundary_matches_js() {
    let fx = load("chain", "boundary");
    let subs = strs(&fx["subs"]);
    let later: HashMap<String, String> = [(CHAIN_LATER_ENV.to_string(), "1".to_string())].into_iter().collect();
    let first: HashMap<String, String> = [(CHAIN_LATER_ENV.to_string(), "0".to_string())].into_iter().collect();
    let none: HashMap<String, String> = HashMap::new();
    let cases = fx["cases"].as_array().unwrap();
    for c in cases {
        let args = strs(&c[0]);
        for (i, sub) in subs.iter().enumerate() {
            assert_eq!(chain_boundary_line(sub, &args).as_deref(), c[i + 1].as_str(), "chainBoundaryLine({sub}, {args:?})");
        }
        let n = subs.len();
        assert_eq!(chain_boundary("grep", &args, &later).as_deref(), c[n + 1].as_str(), "later {args:?}");
        assert_eq!(chain_boundary("read", &args, &first).as_deref(), c[n + 2].as_str(), "first {args:?}");
        assert_eq!(chain_boundary("trace", &args, &none).as_deref(), c[n + 3].as_str(), "unset {args:?}");
    }
    assert_eq!(chain_boundary_line("constructor", &[]), None);
    eprintln!("chain: {} argument lists x {} tools", cases.len(), subs.len());
}
