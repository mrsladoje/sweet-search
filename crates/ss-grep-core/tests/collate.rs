//! src/collate.rs against V8 localeCompare (fixtures-gen/collate.mjs).
#![allow(clippy::manual_is_multiple_of)] // mirrors the JS `x % n === 0` of the generator
mod common;

use std::cmp::Ordering;
use std::path::Path;
use std::process::Command;

use common::{fnv1a, load, Mulberry32};
use ss_grep_core::collate::{locale_compare, sort_locale};

const REPOS_DIR: &str = "/Users/admin/.ss-eval/grep-e2e-bench/repos";

fn unpack(h: &str, n: usize) -> Vec<Ordering> {
    let mut out = Vec::with_capacity(n + 1);
    for ch in h.chars() {
        let d = ch.to_digit(16).unwrap();
        for s in [d / 3, d % 3] {
            out.push(match s {
                0 => Ordering::Less,
                1 => Ordering::Equal,
                _ => Ordering::Greater,
            });
        }
    }
    out.truncate(n);
    out
}

const PUNCT: &[u8] = b" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const CONTROLS: [u8; 6] = [0, 1, 9, 10, 13, 127];
const INSERT: [u8; 8] = [0, 1, 8, 14, 31, 127, 9, 32];

fn gen_string(r: &mut Mulberry32) -> String {
    let len = r.next_u32() % 7;
    let mut s = Vec::new();
    for _ in 0..len {
        let k = r.next_u32() % 10;
        let c: u8 = if k < 3 {
            97 + (r.next_u32() % 26) as u8
        } else if k < 5 {
            65 + (r.next_u32() % 26) as u8
        } else if k < 6 {
            48 + (r.next_u32() % 10) as u8
        } else if k < 8 {
            PUNCT[(r.next_u32() as usize) % PUNCT.len()]
        } else if k < 9 {
            (r.next_u32() % 128) as u8
        } else {
            CONTROLS[(r.next_u32() as usize) % CONTROLS.len()]
        };
        s.push(c);
    }
    String::from_utf8(s).unwrap()
}

fn variant(a: &str, r: &mut Mulberry32) -> String {
    let mut s: Vec<u8> = Vec::new();
    for &c in a.as_bytes() {
        let letter = c.is_ascii_alphabetic();
        if letter && r.next_u32() % 4 == 0 {
            s.push(c ^ 32);
        } else {
            s.push(c);
        }
    }
    if r.next_u32() % 2 == 0 {
        let pos = (r.next_u32() as usize) % (s.len() + 1);
        let ins = INSERT[(r.next_u32() as usize) % INSERT.len()];
        s.insert(pos, ins);
    }
    String::from_utf8(s).unwrap()
}

#[test]
fn every_single_char_pair() {
    let fx = load("collate", "collate");
    let want = unpack(fx["singles"].as_str().unwrap(), 128 * 128);
    for a in 0u8..128 {
        for b in 0u8..128 {
            let (sa, sb) = ((a as char).to_string(), (b as char).to_string());
            assert_eq!(locale_compare(&sa, &sb), Some(want[a as usize * 128 + b as usize]), "{a:#x} vs {b:#x}");
        }
    }
}

#[test]
fn random_ascii_pairs() {
    let fx = load("collate", "collate");
    let n = fx["n"].as_u64().unwrap() as usize;
    let want = unpack(fx["synSigns"].as_str().unwrap(), n);
    let mut r = Mulberry32::new(2026);
    let mut all: Vec<String> = Vec::with_capacity(2 * n);
    let mut mismatches = Vec::new();
    for (i, w) in want.iter().enumerate() {
        let a = gen_string(&mut r);
        let b = if r.next_u32() % 3 == 0 { variant(&a, &mut r) } else { gen_string(&mut r) };
        if locale_compare(&a, &b) != Some(*w) && mismatches.len() < 10 {
            mismatches.push(format!("#{i} {a:?} vs {b:?}: js {w:?}, rust {:?}", locale_compare(&a, &b)));
        }
        all.push(a);
        all.push(b);
    }
    assert_eq!(fnv1a(&all.join("\u{1}|")), fx["synHash"].as_str().unwrap(), "the PRNG strings differ from the JS ones");
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
    eprintln!("collate: {n} random pairs equal");
}

fn ls_files(repo: &str) -> Option<Vec<String>> {
    let root = Path::new(REPOS_DIR).join(repo);
    if !root.exists() {
        return None;
    }
    let out = Command::new("git").arg("-C").arg(&root).args(["ls-files", "-z"]).output().ok()?;
    let text = String::from_utf8(out.stdout).ok()?;
    Some(text.split('\0').filter(|s| !s.is_empty()).map(str::to_string).collect())
}

#[test]
fn real_repo_paths() {
    let fx = load("collate", "collate");
    let mut sorted_files = 0;
    for r in fx["repos"].as_array().unwrap() {
        let repo = r["repo"].as_str().unwrap();
        let files = match ls_files(repo) {
            Some(f) => f,
            None => panic!("bench repo {repo} missing under {REPOS_DIR}"),
        };
        assert_eq!(fnv1a(&files.join("\n")), r["listHash"].as_str().unwrap(), "{repo}: git ls-files changed since the fixture");
        for f in files.iter().filter(|f| !f.is_ascii()) {
            assert_eq!(locale_compare(f, "a"), None, "{repo}: non-ASCII {f:?} must decline");
        }
        let mut ascii: Vec<String> = files.iter().filter(|f| f.is_ascii()).cloned().collect();
        assert_eq!(ascii.len() as u64, r["ascii"].as_u64().unwrap());
        // random pairs, same PRNG walk as the generator
        let want = unpack(r["pairSigns"].as_str().unwrap(), 15000);
        let mut rr = Mulberry32::new(31);
        for (i, w) in want.iter().enumerate() {
            let ia = (rr.next_u32() as usize) % ascii.len();
            let j = if rr.next_u32() % 2 == 0 {
                (rr.next_u32() as usize) % ascii.len()
            } else {
                (ia + 1 + (rr.next_u32() % 3) as usize).min(ascii.len() - 1)
            };
            assert_eq!(locale_compare(&ascii[ia], &ascii[j]), Some(*w), "{repo} pair #{i}: {:?} vs {:?}", ascii[ia], ascii[j]);
        }
        // the whole list, sorted
        sort_locale(&mut ascii).expect("ascii");
        assert_eq!(fnv1a(&ascii.join("\n")), r["sortedHash"].as_str().unwrap(), "{repo}: sorted order differs from V8");
        sorted_files += ascii.len();
    }
    eprintln!("collate: {sorted_files} real paths sorted as V8 sorts them");
}
