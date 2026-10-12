//! ss_grep_core::enrich::CodeGraph over the lane's SQLite reads (graph.rs): each method returns
//! what its CodeGraphRepository namesake returns, including the values of its own `catch`.

use super::graph::{GEntity, GInterfaceCall, GraphDb};
use ss_grep_core::enrich::{CodeGraph, EntitiesAtLine, Entity, FamilyCandidateOpts, GraphThrew, InterfaceCallRow, InterfaceImpl, LineRange, RangeQuery};
use std::cell::RefCell;

pub(crate) struct LaneGraph<'a> {
    /// None: no code-graph database (every JS method returns its empty answer).
    pub g: Option<RefCell<GraphDb<'a>>>,
}

fn ent(e: GEntity) -> Entity {
    Entity {
        id: Some(e.id),
        name: Some(e.name),
        entity_type: Some(e.type_),
        file_path: e.file_path,
        start_line: e.start_line,
        end_line: e.end_line,
        parent_class: e.parent_class,
    }
}

fn icall(c: GInterfaceCall) -> Option<InterfaceCallRow> {
    Some(InterfaceCallRow {
        line: c.line?,
        call: c.call,
        target: c.target,
        impls: c
            .impls
            .into_iter()
            .map(|i| InterfaceImpl { name: i.name, owner: i.owner, file_path: i.file_path, start_line: i.start_line, end_line: i.end_line })
            .collect(),
    })
}

fn family_stem_ok(stem: &str) -> bool {
    let b = stem.as_bytes();
    (3..=64).contains(&b.len()) && b[0].is_ascii_alphabetic() && b.iter().all(|c| c.is_ascii_alphanumeric())
}

fn type_ok(t: &str) -> bool {
    let b = t.as_bytes();
    (1..=32).contains(&b.len()) && b[0].is_ascii_alphabetic() && b[1..].iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'-')
}

fn path_is_unsafe(v: &str) -> bool {
    v.starts_with('/') || v == ".." || v.starts_with("../") || v.contains("/../")
}

impl CodeGraph for LaneGraph<'_> {
    fn find_entities_in_file(&self, file_path: &str, limit: Option<i64>) -> Result<Vec<Entity>, GraphThrew> {
        let Some(g) = &self.g else { return Ok(Vec::new()) };
        if file_path.is_empty() {
            return Ok(Vec::new());
        }
        // `Math.min(Math.max(1, opts.limit | 0 || 512), 2048)`
        let l = limit.map(|v| v as i32 as i64).filter(|v| *v != 0).unwrap_or(512);
        let l = l.max(1).min(2048);
        Ok(g.borrow_mut().find_entities_in_file(file_path, l).map(|v| v.into_iter().map(ent).collect()).unwrap_or_default())
    }

    fn find_entities_in_range(&self, file_path: &str, start_line: i64, end_line: i64) -> Result<Vec<Entity>, GraphThrew> {
        let Some(g) = &self.g else { return Ok(Vec::new()) };
        Ok(g.borrow_mut().find_entities_in_range(file_path, start_line, end_line).map(|v| v.into_iter().map(ent).collect()).unwrap_or_default())
    }

    fn find_enclosing_entity(&self, file_path: &str, start_line: i64, end_line: i64) -> Result<Option<Entity>, GraphThrew> {
        let Some(g) = &self.g else { return Ok(None) };
        Ok(g.borrow_mut().find_enclosing_entity(file_path, start_line, end_line).ok().flatten().map(ent))
    }

    fn find_entities_at_lines(&self, file_path: &str, lines: &[i64]) -> Result<Option<Vec<EntitiesAtLine>>, GraphThrew> {
        let Some(g) = &self.g else { return Ok(None) };
        if file_path.is_empty() {
            return Ok(None);
        }
        let Ok(table) = g.borrow_mut().file_entity_scan(file_path) else { return Ok(None) };
        Ok(Some(
            lines
                .iter()
                .map(|&line| {
                    let mut in_range = Vec::new();
                    let mut enclosing: Option<&GEntity> = None;
                    for row in &table {
                        let Some(s) = row.start_line else { continue };
                        if s == line && in_range.len() < 64 {
                            in_range.push(ent(row.clone()));
                        }
                        if let Some(e) = row.end_line {
                            if s <= line && e >= line {
                                let better = match enclosing {
                                    None => true,
                                    Some(cur) => (e - s) < (cur.end_line.unwrap_or(0) - cur.start_line.unwrap_or(0)),
                                };
                                if better {
                                    enclosing = Some(row);
                                }
                            }
                        }
                    }
                    EntitiesAtLine { enclosing: enclosing.cloned().map(ent), in_range }
                })
                .collect(),
        ))
    }

    fn find_entities_for_ranges(&self, file_path: &str, ranges: &[RangeQuery]) -> Result<Vec<EntitiesAtLine>, GraphThrew> {
        let Some(g) = &self.g else { return Ok(Vec::new()) };
        if file_path.is_empty() || ranges.is_empty() {
            return Ok(Vec::new());
        }
        let r: Vec<(i64, i64, bool)> = ranges.iter().map(|q| (q.start_line, q.end_line, q.include_inside)).collect();
        Ok(g.borrow_mut()
            .find_entities_for_ranges(file_path, &r)
            .map(|v| v.into_iter().map(|(e, ins)| EntitiesAtLine { enclosing: e.map(ent), in_range: ins.into_iter().map(ent).collect() }).collect())
            .unwrap_or_default())
    }

    fn find_family_candidates(&self, stem: &str, opts: &FamilyCandidateOpts) -> Result<Vec<Entity>, GraphThrew> {
        let Some(g) = &self.g else { return Ok(Vec::new()) };
        if !family_stem_ok(stem) {
            return Ok(Vec::new());
        }
        let mut prefix = opts.file_prefix.replace('\\', "/");
        if let Some(p) = prefix.strip_prefix("./") {
            prefix = p.to_string();
        }
        if let Some(p) = prefix.strip_suffix('/') {
            prefix = p.to_string();
        }
        if prefix.is_empty() || prefix == "." || path_is_unsafe(&prefix) {
            return Ok(Vec::new());
        }
        let mut types: Vec<String> = Vec::new();
        for t in &opts.types {
            if type_ok(t) && !types.contains(t) {
                types.push(t.clone());
            }
        }
        types.truncate(16);
        let limit = opts.limit.clamp(1, 128);
        Ok(g.borrow_mut().find_family_candidates(stem, &prefix, &types, limit).map(|v| v.into_iter().map(ent).collect()).unwrap_or_default())
    }

    fn find_interface_call_implementations_in_ranges(&self, file_path: &str, ranges: &[LineRange]) -> Result<Vec<Vec<InterfaceCallRow>>, GraphThrew> {
        let Some(g) = &self.g else { return Ok(ranges.iter().map(|_| Vec::new()).collect()) };
        let r: Vec<(i64, i64)> = ranges.iter().map(|q| (q.start_line, q.end_line)).collect();
        let per = g.borrow_mut().find_interface_call_implementations_in_ranges(file_path, &r);
        Ok(per.into_iter().map(|calls| calls.into_iter().filter_map(icall).collect()).collect())
    }
}
