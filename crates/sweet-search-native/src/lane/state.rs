//! What the lane reads from the index state dir per call: the reconcile manifest, the gram
//! index it names, and the code graph database. Each is re-read only when its file changed.

use super::engine::{file_signature, LaneIndex};
use super::sqlite::Db;
use serde_json::Value;

/// The fields of reconcile-manifest.json the grep path reads.
#[derive(Clone, Debug, Default)]
pub(crate) struct Manifest {
    pub epoch: Option<i64>,
    /// sweet-search.js _manifestArtifactPaths: sparseGram.base, resolved against the state dir.
    pub sparse_base: Option<String>,
    /// sparseGram.deltas (its string entries): the delta overlay's segments.
    pub deltas: Vec<String>,
    /// sparseGram.weightsId (a string), the weights every delta record must carry.
    pub weights_id: Option<String>,
    /// code-graph-visibility.js resolveManifestCodeGraphPath: codeGraph.path || codeGraph.dbPath.
    pub code_graph: Option<String>,
    /// Date.parse(publishedAt) in ms (index-freshness.js), when it parses.
    pub published_ms: Option<f64>,
    /// The manifest exists (a missing one is a decline: the JS reads defaults then).
    pub present: bool,
}

fn resolve_state_path(state_dir: &str, p: &str) -> String {
    if p.starts_with('/') {
        p.to_string()
    } else {
        format!("{}/{}", state_dir.trim_end_matches('/'), p)
    }
}

/// JS `Date.parse` for the ISO form the maintainer writes (`YYYY-MM-DDTHH:MM:SS(.sss)Z`).
pub(crate) fn parse_iso_ms(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || *b.last()? != b'Z' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> { std::str::from_utf8(&b[r]).ok()?.parse::<i64>().ok() };
    let (y, mo, d, h, mi, se) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    let mut ms = 0i64;
    let rest = &s[19..s.len() - 1];
    if !rest.is_empty() {
        let frac = rest.strip_prefix('.')?;
        if frac.is_empty() || frac.len() > 9 || !frac.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        // Date.parse keeps milliseconds (the first three digits).
        let three = format!("{:0<3}", &frac[..frac.len().min(3)]);
        ms = three.parse().ok()?;
    }
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 59 {
        return None;
    }
    // Days from 1970-01-01 (proleptic Gregorian).
    let days = {
        let (y, m) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let doy = (153 * m + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    };
    Some(((days * 86_400 + h * 3600 + mi * 60 + se) * 1000 + ms) as f64)
}

pub(crate) fn read_manifest(state_dir: &str) -> Manifest {
    let path = format!("{}/reconcile-manifest.json", state_dir.trim_end_matches('/'));
    let Ok(text) = std::fs::read_to_string(&path) else { return Manifest::default() };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return Manifest::default() };
    let s = |p: &Value| p.as_str().map(str::to_string);
    let sparse = v.get("sparseGram");
    let graph = v.get("codeGraph");
    Manifest {
        present: true,
        epoch: v.get("epoch").and_then(Value::as_i64).filter(|_| v.get("epoch").map_or(false, |e| e.is_i64() || e.is_u64())),
        sparse_base: sparse.and_then(|g| g.get("base")).and_then(s).map(|p| resolve_state_path(state_dir, &p)),
        deltas: sparse
            .and_then(|g| g.get("deltas"))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|e| e.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
        weights_id: sparse.and_then(|g| g.get("weightsId")).and_then(Value::as_str).map(str::to_string),
        code_graph: graph
            .and_then(|g| g.get("path").and_then(s).or_else(|| g.get("dbPath").and_then(s)))
            .map(|p| resolve_state_path(state_dir, &p)),
        published_ms: v.get("publishedAt").and_then(Value::as_str).and_then(parse_iso_ms),
    }
}

/// The lane's loaded artifacts, kept across calls while their files stay the same.
#[derive(Default)]
pub(crate) struct Loaded {
    pub index: Option<LaneIndex>,
    pub graph: Option<(String, String, Db, super::graph::GraphCache)>, // (path, signature, connection, cache)
    pub overlay: Option<super::overlay::Overlay>,
}

impl Loaded {
    pub fn index(&mut self, path: &str) -> Option<&LaneIndex> {
        let fresh = self.index.as_ref().map_or(false, |i| i.is_current(path));
        if !fresh {
            self.index = LaneIndex::load(path);
        }
        self.index.as_ref()
    }

}

/// The code graph connection for `path` (reopened when the file was replaced).
pub(crate) fn open_graph<'a>(slot: &'a mut Option<(String, String, Db, super::graph::GraphCache)>, path: &str) -> Option<(&'a mut Db, &'a mut super::graph::GraphCache)> {
    let sig = file_signature(path)?;
    let fresh = slot.as_ref().map_or(false, |(p, s, _, _)| p == path && *s == sig);
    if !fresh {
        *slot = Db::open_readonly(path).map(|db| (path.to_string(), sig, db, Default::default()));
    }
    slot.as_mut().map(|(_, _, db, cache)| (db, cache))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn iso_dates_parse_like_date_parse() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00.000Z"), Some(0.0));
        assert_eq!(parse_iso_ms("2026-10-12T20:52:04.658Z"), Some(1_791_838_324_658.0));
        assert_eq!(parse_iso_ms("2000-02-29T12:00:00Z"), Some(951_825_600_000.0));
        assert_eq!(parse_iso_ms("garbage"), None);
    }
}
