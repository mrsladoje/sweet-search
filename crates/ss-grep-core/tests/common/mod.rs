//! Shared by the fixture tests: fixture loading (with the `$R` / `$T` root placeholders put
//! back), the FakeProbe that replays the file-system answers the JS got, the PRNG and hash
//! shared with fixtures-gen/_common.mjs.
#![allow(dead_code)]

use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

use serde_json::Value;
use ss_grep_core::paths::PathProbe;

pub fn fixture_dir(module: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join(module)
}

/// Every `<name>.json` of a module, sorted by name.
pub fn fixture_names(module: &str) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(fixture_dir(module))
        .expect("fixture dir")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".json"))
        .map(|n| n.trim_end_matches(".json").to_string())
        .collect();
    names.sort();
    names
}

/// Load a fixture and replace `$R` / `$T` in every string (keys too) by the fixture's R / T.
pub fn load(module: &str, name: &str) -> Value {
    let text = std::fs::read_to_string(fixture_dir(module).join(format!("{name}.json"))).expect("fixture");
    let v: Value = serde_json::from_str(&text).expect("json");
    let mut roots: Vec<(String, String)> = Vec::new();
    for k in ["R", "T"] {
        if let Some(r) = v.get(k).and_then(Value::as_str) {
            roots.push((format!("${k}"), r.to_string()));
        }
    }
    unsub(v, &roots)
}

fn unsub(v: Value, roots: &[(String, String)]) -> Value {
    match v {
        Value::String(s) => Value::String(unsub_str(&s, roots)),
        Value::Array(a) => Value::Array(a.into_iter().map(|x| unsub(x, roots)).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, x)| (unsub_str(&k, roots), unsub(x, roots))).collect()),
        x => x,
    }
}

fn unsub_str(s: &str, roots: &[(String, String)]) -> String {
    let mut out = s.to_string();
    for (tok, r) in roots {
        out = out.replace(tok.as_str(), r);
    }
    out
}

pub fn strs(v: &Value) -> Vec<String> {
    v.as_array().expect("array").iter().map(|x| x.as_str().expect("string").to_string()).collect()
}

/// Replays the recorded answers; a question the JS never asked panics (the port probed
/// something the JS did not, which is a divergence to look at).
pub struct FakeProbe {
    exists: HashMap<String, bool>,
    realpath: HashMap<String, Option<String>>,
    is_file: HashMap<String, bool>,
    pub unknown: RefCell<BTreeSet<String>>,
}

impl FakeProbe {
    pub fn from_fixture(probe: &Value) -> FakeProbe {
        let mut exists = HashMap::new();
        let mut realpath = HashMap::new();
        let mut is_file = HashMap::new();
        if let Some(o) = probe.get("exists").and_then(Value::as_object) {
            for (k, v) in o {
                exists.insert(k.clone(), v.as_bool().unwrap_or(false));
            }
        }
        if let Some(o) = probe.get("realpath").and_then(Value::as_object) {
            for (k, v) in o {
                realpath.insert(k.clone(), v.as_str().map(str::to_string));
            }
        }
        if let Some(o) = probe.get("isFile").and_then(Value::as_object) {
            for (k, v) in o {
                is_file.insert(k.clone(), v.as_bool().unwrap_or(false));
            }
        }
        FakeProbe { exists, realpath, is_file, unknown: RefCell::new(BTreeSet::new()) }
    }
}

impl PathProbe for FakeProbe {
    fn exists(&self, abs: &str) -> bool {
        match self.exists.get(abs) {
            Some(v) => *v,
            None => {
                self.unknown.borrow_mut().insert(format!("exists {abs}"));
                false
            }
        }
    }
    fn realpath(&self, abs: &str) -> Option<String> {
        match self.realpath.get(abs) {
            Some(v) => v.clone(),
            None => {
                self.unknown.borrow_mut().insert(format!("realpath {abs}"));
                None
            }
        }
    }
    fn is_file(&self, abs: &str) -> bool {
        match self.is_file.get(abs) {
            Some(v) => *v,
            None => {
                self.unknown.borrow_mut().insert(format!("isFile {abs}"));
                false
            }
        }
    }
}

/// mulberry32 (fixtures-gen/_common.mjs).
pub struct Mulberry32(u32);

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Mulberry32(seed)
    }
    pub fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6D2B_79F5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }
}

/// FNV-1a 64 over UTF-8 bytes, hex.
pub fn fnv1a(s: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}
