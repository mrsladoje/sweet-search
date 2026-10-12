//! The sparse delta overlay (core/search/search-pattern-sparse-overlay.js and
//! core/infrastructure/sparse-gram-delta-reader.js): files the maintainer re-indexed since the
//! base index was built. Their latest records hide the base entries; live ones join the file
//! lists, filtered by gram postings.
//!
//! The JS daemon reads the segments incrementally (a cursor); a full read gives the same
//! latest-record map (the reader's contract), so the lane reads every segment again whenever
//! one of them changed.

use super::engine::LaneIndex;
use std::collections::{HashMap, HashSet};

/// One live record: its path and its postings slot (-1: no grams, passes every gram filter).
struct Live {
    file: String,
    slot: i64,
}

pub(crate) struct Overlay {
    /// The segment files and their stat signatures this overlay was read from.
    signature: String,
    pub hidden: HashSet<String>,
    live: Vec<Live>,
    postings: HashMap<String, Vec<u32>>,
    /// getSparseGramAllFilesWithOverlay for the base index it was built over (index signature).
    all: Option<(String, AllFiles)>,
}

pub(crate) struct AllFiles {
    pub files: Vec<String>,
    sorted: Vec<String>,
    set: HashSet<String>,
}

impl AllFiles {
    fn new(files: Vec<String>) -> AllFiles {
        let mut sorted = files.clone();
        sorted.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        let set = files.iter().cloned().collect();
        AllFiles { files, sorted, set }
    }

    /// getSparseGramFilesUnder: the files equal to or under each of `rels`.
    pub fn under(&self, rels: &[String]) -> Vec<String> {
        files_under(&self.sorted, &self.set, rels)
    }
}

pub(crate) fn files_under(sorted: &[String], set: &HashSet<String>, rels: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for rel in rels {
        if set.contains(rel) && seen.insert(rel.as_str()) {
            out.push(rel.clone());
        }
        let prefix = format!("{rel}/");
        let p16: Vec<u16> = prefix.encode_utf16().collect();
        let lo = sorted.partition_point(|f| f.encode_utf16().cmp(p16.iter().copied()) == std::cmp::Ordering::Less);
        for f in &sorted[lo..] {
            if !f.starts_with(&prefix) {
                break;
            }
            if seen.insert(f.as_str()) {
                out.push(f.clone());
            }
        }
    }
    out
}

/// normalizeDeltaPath: Ok(None) = no path (dropped); Err = a path form the lane does not
/// resolve (absolute: the JS maps it through realpaths).
fn normalize_path(p: &str) -> Result<Option<String>, &'static str> {
    if p.is_empty() {
        return Ok(None);
    }
    let b = p.as_bytes();
    if b[0] != b'/' && b[0] != b'.' && !p.contains('\\') {
        return Ok(Some(p.to_string()));
    }
    if b[0] == b'/' {
        return Err("absolute delta path");
    }
    let n = p.replace('\\', "/");
    let n = n.strip_prefix("./").map(str::to_string).unwrap_or(n);
    Ok((!n.is_empty() && !n.starts_with("../")).then_some(n))
}

/// listSparseGramDeltaSegments(indexPath, { maxEpoch, segments }) for the manifest's entries
/// (resolveDeltaSegments): existing segment files under `<index>.deltas/`, by (epoch, seq).
fn list_segments(index_path: &str, state_dir: &str, entries: &[String], max_epoch: Option<i64>) -> Vec<String> {
    let base_dir = std::path::Path::new(index_path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let delta_root = format!("{index_path}.deltas");
    let mut found: Vec<(i64, i64, String)> = Vec::new();
    let mut seen = HashSet::new();
    for entry in entries {
        let candidates: Vec<String> = if entry.starts_with('/') {
            vec![entry.clone()]
        } else {
            vec![format!("{}/{}", state_dir.trim_end_matches('/'), entry), format!("{}/{}", base_dir.trim_end_matches('/'), entry)]
        };
        for c in candidates {
            if !c.ends_with(".ssgrmdelta") {
                continue;
            }
            let normalized = resolve_abs(&c);
            if !normalized.starts_with(&format!("{delta_root}/")) {
                continue;
            }
            let name = normalized.rsplit('/').next().unwrap_or("");
            let Some(stem) = name.strip_suffix(".ssgrmdelta") else { continue };
            let Some((e, s)) = stem.split_once('-') else { continue };
            if e.is_empty() || s.is_empty() || !e.bytes().all(|b| b.is_ascii_digit()) || !s.bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            let (Ok(epoch), Ok(seq)) = (e.parse::<i64>(), s.parse::<i64>()) else { continue };
            if max_epoch.map_or(false, |m| epoch > m) || !std::path::Path::new(&normalized).exists() {
                continue;
            }
            if seen.insert(normalized.clone()) {
                found.push((epoch, seq, normalized));
            }
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    found.into_iter().map(|(_, _, p)| p).collect()
}

/// path.resolve of an absolute POSIX path.
fn resolve_abs(p: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    format!("/{}", out.join("/"))
}

fn segments_signature(segments: &[String]) -> Option<String> {
    let mut sig = String::new();
    for s in segments {
        sig.push_str(s);
        sig.push('\0');
        sig.push_str(&super::engine::file_signature(s)?);
        sig.push('\n');
    }
    Some(sig)
}

/// The JS Map key of a record's `fileId` (1 and "1" are different keys).
fn file_id_key(v: &serde_json::Value) -> Option<String> {
    use serde_json::Value;
    match v {
        Value::Null | Value::Bool(false) => None,
        Value::String(s) if s.is_empty() => None,
        Value::Number(n) if n.as_f64() == Some(0.0) => None,
        Value::Array(_) | Value::Object(_) => None, // never written; a JS object key is by identity
        other => Some(other.to_string()),
    }
}

/// JS truthiness of a JSON value.
fn truthy(v: Option<&serde_json::Value>) -> bool {
    use serde_json::Value;
    match v {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Number(n)) => n.as_f64().map_or(true, |f| f != 0.0 && !f.is_nan()),
        _ => true,
    }
}

enum Entry {
    /// deltaEntry returned null (wrong weights id, no path).
    Null,
    Deleted(String),
    Live(String, i64),
}

impl Overlay {
    /// loadSparseDeltaOverlay: Ok(None) = no overlay (no segments, or no record that counts).
    pub fn load(index_path: &str, state_dir: &str, entries: &[String], max_epoch: Option<i64>, weights_id: Option<&str>, prev: Option<Overlay>) -> Result<Option<Overlay>, &'static str> {
        let segments = list_segments(index_path, state_dir, entries, max_epoch);
        if segments.is_empty() {
            return Ok(None);
        }
        let signature = format!("{max_epoch:?}\0{weights_id:?}\0{}", segments_signature(&segments).ok_or("delta segment vanished")?);
        if let Some(p) = prev {
            if p.signature == signature {
                return Ok(Some(p));
            }
        }
        let mut order: Vec<String> = Vec::new();
        let mut entries_map: HashMap<String, Entry> = HashMap::new();
        let mut postings: HashMap<String, Vec<u32>> = HashMap::new();
        let mut next_slot: u32 = 0;
        for seg in &segments {
            let bytes = match std::fs::read(seg) {
                Ok(b) => b,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return Err("delta read"),
            };
            let text = String::from_utf8_lossy(&bytes);
            for line in text.split('\n') {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(record) = serde_json::from_str::<serde_json::Value>(trimmed) else { continue };
                let Some(key) = record.get("fileId").and_then(file_id_key) else { continue };
                let entry = if weights_id.map_or(false, |w| !w.is_empty()) && record.get("weightsId").and_then(|v| v.as_str()) != weights_id {
                    Entry::Null
                } else {
                    match record.get("filePath").and_then(|v| v.as_str()) {
                        None => Entry::Null,
                        Some(p) => match normalize_path(p)? {
                            None => Entry::Null,
                            Some(path) if truthy(record.get("deleted")) => Entry::Deleted(path),
                            Some(path) => {
                                let mut slot: i64 = -1;
                                if let Some(grams) = record.get("grams").and_then(|g| g.as_array()) {
                                    for g in grams {
                                        let gram = match g {
                                            serde_json::Value::Array(a) => a.first().and_then(|x| x.as_str()),
                                            other => other.as_str(),
                                        };
                                        let Some(gram) = gram.filter(|s| !s.is_empty()) else { continue };
                                        if slot < 0 {
                                            slot = next_slot as i64;
                                            next_slot += 1;
                                        }
                                        let list = postings.entry(gram.to_string()).or_default();
                                        if list.last() != Some(&(slot as u32)) {
                                            list.push(slot as u32);
                                        }
                                    }
                                }
                                Entry::Live(path, slot)
                            }
                        },
                    }
                };
                if !entries_map.contains_key(&key) {
                    order.push(key.clone());
                }
                entries_map.insert(key, entry);
            }
        }
        // buildOverlay
        let mut hidden = HashSet::new();
        let mut live = Vec::new();
        for key in &order {
            match &entries_map[key] {
                Entry::Null => {}
                Entry::Deleted(p) => {
                    hidden.insert(p.clone());
                }
                Entry::Live(p, slot) => {
                    hidden.insert(p.clone());
                    live.push(Live { file: p.clone(), slot: *slot });
                }
            }
        }
        if hidden.is_empty() && live.is_empty() {
            return Ok(None);
        }
        Ok(Some(Overlay { signature, hidden, live, postings, all: None }))
    }

    /// clauseSlotMatcher: the slots holding every gram the clause requires (None: all pass).
    fn clause_slots(&self, clause: &[String], index: &LaneIndex) -> Option<HashSet<u32>> {
        let required = index.index.extract_literal_covering_grams(clause.to_vec());
        if !required.eligible {
            return Some(HashSet::new());
        }
        let mut grams: Vec<String> = required.grams;
        grams.sort();
        grams.dedup();
        if grams.is_empty() {
            return Some(HashSet::new());
        }
        let mut lists: Vec<&Vec<u32>> = Vec::with_capacity(grams.len());
        for g in &grams {
            match self.postings.get(g) {
                Some(l) => lists.push(l),
                None => return Some(HashSet::new()),
            }
        }
        lists.sort_by_key(|l| l.len());
        let mut matched: HashSet<u32> = lists[0].iter().copied().collect();
        for l in &lists[1..] {
            if matched.is_empty() {
                break;
            }
            matched = l.iter().copied().filter(|s| matched.contains(s)).collect();
        }
        Some(matched)
    }

    /// liveOverlayFiles(overlay, 0, clause?, index).
    pub fn live_files(&self, clause: Option<&[String]>, index: &LaneIndex) -> Vec<String> {
        let mut slots: Option<Option<HashSet<u32>>> = None;
        let mut out = Vec::new();
        for r in &self.live {
            if let Some(c) = clause {
                if r.slot >= 0 {
                    let s = slots.get_or_insert_with(|| self.clause_slots(c, index));
                    if let Some(set) = s {
                        if !set.contains(&(r.slot as u32)) {
                            continue;
                        }
                    }
                }
            }
            out.push(r.file.clone());
        }
        out
    }

    pub fn live_count(&self) -> usize {
        self.live.len()
    }

    /// applySparseDeltaOverlay(files, overlay, 0, root, clause?, index).
    pub fn apply(&self, files: &[String], clause: Option<&[String]>, index: &LaneIndex) -> Result<Vec<String>, &'static str> {
        let mut seen: HashSet<String> = HashSet::new();
        let mut out = Vec::new();
        for f in files {
            if let Some(n) = normalize_path(f)? {
                if !self.hidden.contains(&n) && seen.insert(n.clone()) {
                    out.push(n);
                }
            }
        }
        for f in self.live_files(clause, index) {
            if seen.insert(f.clone()) {
                out.push(f);
            }
        }
        Ok(out)
    }

    /// Builds getSparseGramAllFilesWithOverlay for `index` (kept until the overlay or the
    /// index changes); `all_files` then reads it.
    pub fn prepare(&mut self, index: &LaneIndex) -> Result<(), &'static str> {
        let key = index.signature().to_string();
        if self.all.as_ref().map_or(true, |(k, _)| *k != key) {
            let files = self.apply(&index.files, None, index)?;
            self.all = Some((key, AllFiles::new(files)));
        }
        Ok(())
    }

    pub fn all_files(&self) -> Option<&AllFiles> {
        self.all.as_ref().map(|(_, a)| a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delta_paths_normalize_like_normalize_delta_path() {
        assert_eq!(normalize_path("a/b.go"), Ok(Some("a/b.go".into())));
        assert_eq!(normalize_path(".github/x.yml"), Ok(Some(".github/x.yml".into())));
        assert_eq!(normalize_path("./a/b"), Ok(Some("a/b".into())));
        assert_eq!(normalize_path("a\\b"), Ok(Some("a/b".into())));
        assert_eq!(normalize_path("../a"), Ok(None));
        assert_eq!(normalize_path(""), Ok(None));
        assert!(normalize_path("/abs/a").is_err());
    }

    #[test]
    fn latest_record_per_file_id_keeps_first_position() {
        let dir = std::env::temp_dir().join(format!("lane-overlay-{}", std::process::id()));
        let deltas = dir.join("idx.deltas");
        std::fs::create_dir_all(&deltas).unwrap();
        let index = dir.join("idx");
        let rec = |id: &str, path: &str, deleted: bool, w: &str, grams: &str| {
            format!(r#"{{"fileId":"{id}","filePath":"{path}","deleted":{deleted},"weightsId":"{w}","grams":{grams}}}"#)
        };
        std::fs::write(
            deltas.join("2-0.ssgrmdelta"),
            [
                rec("f1", "a.go", false, "w", r#"[["abc",1]]"#),
                rec("f2", "b.go", false, "w", "[]"),
                "not json".to_string(),
                rec("f3", "c.go", false, "other", r#"["xyz"]"#),
                rec("f1", "a2.go", false, "w", r#"["def"]"#),
            ]
            .join("\n"),
        )
        .unwrap();
        std::fs::write(deltas.join("3-0.ssgrmdelta"), format!("{}\n", rec("f2", "b.go", true, "w", "[]"))).unwrap();
        std::fs::write(deltas.join("9-0.ssgrmdelta"), format!("{}\n", rec("f9", "z.go", false, "w", "[]"))).unwrap();
        let entries: Vec<String> = ["idx.deltas/3-0.ssgrmdelta", "idx.deltas/2-0.ssgrmdelta", "idx.deltas/9-0.ssgrmdelta"].iter().map(|s| s.to_string()).collect();
        let state = dir.to_string_lossy().into_owned();
        let o = Overlay::load(&index.to_string_lossy(), &state, &entries, Some(3), Some("w"), None).unwrap().unwrap();
        // f1 keeps its first position with its latest path; f2's delete hides b.go; f3 (other
        // weights) is a null entry; epoch 9 is past the manifest's epoch.
        let live: Vec<&str> = o.live.iter().map(|l| l.file.as_str()).collect();
        assert_eq!(live, vec!["a2.go"]);
        let mut hidden: Vec<&String> = o.hidden.iter().collect();
        hidden.sort();
        assert_eq!(hidden, vec!["a2.go", "b.go"]);
        assert_eq!(o.postings.get("def"), Some(&vec![1]));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
