//! The code-graph reads of the grep path, with the SQL of
//! core/infrastructure/code-graph-repository.js (same statements, same visibility clauses,
//! same parameters), so SQLite returns the same rows in the same order. Each method returns
//! Err(()) where the JS method's try/catch would return its fallback; callers decide what the
//! JS caller did then.

use super::sqlite::{Arg, Db, Val};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GEntity {
    pub id: String,
    pub name: String,
    pub type_: String,
    pub file_path: Option<String>,
    pub start_line: Option<i64>,
    pub end_line: Option<i64>,
    pub parent_class: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct GImpl {
    pub name: String,
    pub owner: Option<String>,
    pub file_path: String,
    pub start_line: Option<i64>,
    pub end_line: Option<i64>,
}

#[derive(Clone, Debug)]
pub(crate) struct GInterfaceCall {
    pub line: Option<i64>,
    pub call: String,
    pub target: String,
    pub impls: Vec<GImpl>,
}

pub(crate) struct GraphDb<'a> {
    pub db: &'a mut Db,
    pub epoch: Option<i64>,
    ent_epoch: bool,
    rel_epoch: bool,
    cache: &'a mut GraphCache,
}

/// CodeGraphRepository._fileEntitiesCache: findEntitiesInFile answers and findEntitiesAtLines
/// scans, kept while the database (PRAGMA data_version), the pinned epoch and the file are the
/// same, exactly as the JS keeps them.
#[derive(Default)]
pub(crate) struct GraphCache {
    version: String,
    entities: std::collections::HashMap<(String, i64), Vec<GEntity>>,
    scans: std::collections::HashMap<String, Vec<GEntity>>,
}

const INTERFACE_ENTITY_TYPES: [&str; 3] = ["interface", "protocol", "trait"];

fn has_columns(db: &mut Db, table: &str, cols: &[&str]) -> bool {
    let Some(rows) = db.query(&format!("PRAGMA table_info({table})"), &[]) else { return false };
    let names: Vec<String> = rows.iter().filter_map(|r| r.get(1).and_then(|v| v.text()).map(str::to_string)).collect();
    cols.iter().all(|c| names.iter().any(|n| n == c))
}

fn prefix(alias: &str) -> String {
    if alias.is_empty() {
        String::new()
    } else {
        format!("{}.", alias.trim_end_matches('.'))
    }
}

fn opt_text(v: Option<&Val>) -> Option<String> {
    v.and_then(|v| v.text()).map(str::to_string)
}

fn entity_row(r: &[Val]) -> Result<GEntity, ()> {
    // id, name, type, start_line, end_line, parent_class
    Ok(GEntity {
        id: match r.first() {
            Some(Val::Text(s)) => s.clone(),
            Some(Val::Int(i)) => i.to_string(),
            _ => return Err(()),
        },
        name: opt_text(r.get(1)).unwrap_or_default(),
        type_: opt_text(r.get(2)).unwrap_or_default(),
        file_path: None,
        start_line: r.get(3).and_then(Val::int),
        end_line: r.get(4).and_then(Val::int),
        // `row.parent_class || null`: an empty string is null.
        parent_class: opt_text(r.get(5)).filter(|s| !s.is_empty()),
    })
}

impl<'a> GraphDb<'a> {
    pub fn new(db: &'a mut Db, epoch: Option<i64>, db_path: &str, cache: &'a mut GraphCache) -> Self {
        let ent_epoch = has_columns(db, "entities", &["epoch_written", "epoch_retired"]);
        let rel_epoch = has_columns(db, "relationships", &["epoch_written", "epoch_retired"]);
        // Read once per call, as the JS reads it once per ss-* call.
        let data_version = db.scalar("PRAGMA data_version", &[]).and_then(|v| v.int());
        let version = format!("{db_path}\0{epoch:?}\0{data_version:?}");
        if data_version.is_none() || cache.version != version {
            cache.entities.clear();
            cache.scans.clear();
            cache.version = if data_version.is_some() { version } else { String::new() };
        }
        GraphDb { db, epoch, ent_epoch, rel_epoch, cache }
    }

    fn cache_on(&self) -> bool {
        !self.cache.version.is_empty()
    }

    fn ent_sql(&self, alias: &str) -> String {
        let p = prefix(alias);
        if !self.ent_epoch {
            return format!("{p}stale_since IS NULL");
        }
        if self.epoch.is_some() {
            return format!(
                "({p}epoch_written IS NULL OR {p}epoch_written <= ?)\n        AND ({p}epoch_retired IS NULL OR {p}epoch_retired > ?)\n        AND ({p}stale_since IS NULL OR ({p}epoch_retired IS NOT NULL AND {p}epoch_retired > ?))"
            );
        }
        format!("{p}stale_since IS NULL AND {p}epoch_retired IS NULL")
    }

    fn ent_params(&self) -> Vec<i64> {
        match (self.ent_epoch, self.epoch) {
            (true, Some(e)) => vec![e, e, e],
            _ => vec![],
        }
    }

    fn rel_sql(&self, alias: &str) -> String {
        if !self.rel_epoch {
            return "1=1".to_string();
        }
        let p = prefix(alias);
        if self.epoch.is_some() {
            return format!("({p}epoch_written IS NULL OR {p}epoch_written <= ?)\n        AND ({p}epoch_retired IS NULL OR {p}epoch_retired > ?)");
        }
        format!("{p}epoch_retired IS NULL")
    }

    fn rel_params(&self) -> Vec<i64> {
        match (self.rel_epoch, self.epoch) {
            (true, Some(e)) => vec![e, e],
            _ => vec![],
        }
    }

    /// findEntitiesInFile(filePath, { limit }).
    pub fn find_entities_in_file(&mut self, file_path: &str, limit: i64) -> Result<Vec<GEntity>, ()> {
        let limit = limit.clamp(1, 2048);
        let key = (file_path.to_string(), limit);
        if let Some(hit) = self.cache.entities.get(&key) {
            return Ok(hit.clone());
        }
        let out = self.find_entities_in_file_uncached(file_path, limit)?;
        if self.cache_on() {
            if self.cache.entities.len() >= 1024 {
                self.cache.entities.clear();
            }
            self.cache.entities.insert(key, out.clone());
        }
        Ok(out)
    }

    fn find_entities_in_file_uncached(&mut self, file_path: &str, limit: i64) -> Result<Vec<GEntity>, ()> {
        let sql = format!(
            "\n        SELECT id, name, type, start_line, end_line, parent_class\n        FROM entities\n        WHERE file_path = ?\n          AND name IS NOT NULL AND name != ''\n          AND start_line IS NOT NULL AND end_line IS NOT NULL\n          AND {}\n        ORDER BY start_line ASC, end_line DESC\n        LIMIT ?\n      ",
            self.ent_sql("")
        );
        let mut args = vec![Arg::Text(file_path)];
        args.extend(self.ent_params().into_iter().map(Arg::Int));
        args.push(Arg::Int(limit));
        let rows = self.db.query(&sql, &args).ok_or(())?;
        rows.iter().map(|r| entity_row(r)).collect()
    }

    /// findEntitiesInRange(filePath, startLine, endLine).
    pub fn find_entities_in_range(&mut self, file_path: &str, start: i64, end: i64) -> Result<Vec<GEntity>, ()> {
        let sql = format!(
            "\n        SELECT id, name, type, start_line, end_line, parent_class\n        FROM entities\n        WHERE file_path = ?\n          AND start_line >= ?\n          AND start_line <= ?\n          AND {}\n        ORDER BY start_line ASC\n        LIMIT 64\n      ",
            self.ent_sql("")
        );
        let mut args = vec![Arg::Text(file_path), Arg::Int(start), Arg::Int(end)];
        args.extend(self.ent_params().into_iter().map(Arg::Int));
        let rows = self.db.query(&sql, &args).ok_or(())?;
        rows.iter().map(|r| entity_row(r)).collect()
    }

    /// findEnclosingEntity(filePath, startLine, endLine).
    pub fn find_enclosing_entity(&mut self, file_path: &str, start: i64, end: i64) -> Result<Option<GEntity>, ()> {
        let sql = format!(
            "\n        SELECT id, name, type, start_line, end_line, parent_class\n        FROM entities\n        WHERE file_path = ?\n          AND start_line <= ?\n          AND end_line >= ?\n          AND {}\n        ORDER BY (end_line - start_line) ASC\n        LIMIT 1\n      ",
            self.ent_sql("")
        );
        let mut args = vec![Arg::Text(file_path), Arg::Int(start), Arg::Int(end)];
        args.extend(self.ent_params().into_iter().map(Arg::Int));
        let rows = self.db.query(&sql, &args).ok_or(())?;
        match rows.first() {
            Some(r) => entity_row(r).map(Some),
            None => Ok(None),
        }
    }

    /// The visible rows of a file in table order (findEntitiesAtLines's scan).
    pub fn file_entity_scan(&mut self, file_path: &str) -> Result<Vec<GEntity>, ()> {
        if let Some(hit) = self.cache.scans.get(file_path) {
            return Ok(hit.clone());
        }
        let out = self.file_entity_scan_uncached(file_path)?;
        if self.cache_on() {
            if self.cache.scans.len() >= 1024 {
                self.cache.scans.clear();
            }
            self.cache.scans.insert(file_path.to_string(), out.clone());
        }
        Ok(out)
    }

    fn file_entity_scan_uncached(&mut self, file_path: &str) -> Result<Vec<GEntity>, ()> {
        let sql = format!(
            "\n          SELECT id, name, type, start_line, end_line, parent_class\n          FROM entities\n          WHERE file_path = ? AND {}\n        ",
            self.ent_sql("")
        );
        let mut args = vec![Arg::Text(file_path)];
        args.extend(self.ent_params().into_iter().map(Arg::Int));
        let rows = self.db.query(&sql, &args).ok_or(())?;
        rows.iter().map(|r| entity_row(r)).collect()
    }

    /// findEntitiesForRanges(filePath, ranges): per range (enclosing, inRange), via the same
    /// JSON SQL; `ranges` = (startLine, endLine, includeInside).
    pub fn find_entities_for_ranges(&mut self, file_path: &str, ranges: &[(i64, i64, bool)]) -> Result<Vec<(Option<GEntity>, Vec<GEntity>)>, ()> {
        let vis = self.ent_sql("");
        let entity_json = "json_object(\n        'id', id, 'name', name, 'type', type,\n        'startLine', start_line, 'endLine', end_line, 'parentClass', parent_class\n      )";
        let sql = format!(
            "\n        WITH ranges AS MATERIALIZED (\n          SELECT key,\n            json_extract(value, '$[0]') AS range_start,\n            json_extract(value, '$[1]') AS range_end,\n            json_extract(value, '$[2]') AS include_inside\n          FROM json_each(?)\n        ), visible_entities AS MATERIALIZED (\n          SELECT id, name, type, start_line, end_line, parent_class FROM entities\n          WHERE file_path = ? AND {vis}\n        )\n        SELECT\n          (SELECT {entity_json} FROM visible_entities\n            WHERE start_line <= ranges.range_start AND end_line >= ranges.range_end\n            ORDER BY (end_line - start_line) ASC LIMIT 1) AS enclosing,\n          CASE WHEN ranges.include_inside THEN\n            (SELECT json_group_array({entity_json}) FROM (\n              SELECT id, name, type, start_line, end_line, parent_class FROM visible_entities\n              WHERE start_line >= ranges.range_start AND start_line <= ranges.range_end\n              ORDER BY start_line ASC LIMIT 64\n            ))\n          ELSE '[]' END AS in_range\n        FROM ranges ORDER BY key ASC\n      "
        );
        let json = serde_json::to_string(&ranges.iter().map(|(s, e, i)| vec![*s, *e, if *i { 1 } else { 0 }]).collect::<Vec<_>>()).map_err(|_| ())?;
        let mut args = vec![Arg::Text(&json), Arg::Text(file_path)];
        args.extend(self.ent_params().into_iter().map(Arg::Int));
        let rows = self.db.query(&sql, &args).ok_or(())?;
        let parse = |v: &serde_json::Value| -> Result<GEntity, ()> {
            Ok(GEntity {
                id: match v.get("id") {
                    Some(serde_json::Value::String(s)) => s.clone(),
                    Some(serde_json::Value::Number(n)) => n.to_string(),
                    _ => return Err(()),
                },
                name: v.get("name").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                type_: v.get("type").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                file_path: None,
                start_line: v.get("startLine").and_then(|x| x.as_i64()),
                end_line: v.get("endLine").and_then(|x| x.as_i64()),
                parent_class: v.get("parentClass").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).map(str::to_string),
            })
        };
        let mut out = Vec::new();
        for r in rows {
            let enclosing = match r.first() {
                Some(Val::Text(t)) => Some(parse(&serde_json::from_str(t).map_err(|_| ())?)?),
                _ => None,
            };
            let in_range = match r.get(1) {
                Some(Val::Text(t)) => {
                    let v: serde_json::Value = serde_json::from_str(t).map_err(|_| ())?;
                    v.as_array().ok_or(())?.iter().map(&parse).collect::<Result<Vec<_>, ()>>()?
                }
                _ => return Err(()),
            };
            out.push((enclosing, in_range));
        }
        Ok(out)
    }

    /// findFamilyCandidates(stem, { filePrefix, types, limit }) for an already validated stem,
    /// prefix and type list (the caller ports the JS checks).
    pub fn find_family_candidates(&mut self, stem: &str, prefix_path: &str, types: &[String], limit: i64) -> Result<Vec<GEntity>, ()> {
        let escape_like = |v: &str| -> String {
            let mut o = String::with_capacity(v.len());
            for c in v.chars() {
                if c == '\\' || c == '%' || c == '_' {
                    o.push('\\');
                }
                o.push(c);
            }
            o
        };
        let type_sql = if types.is_empty() {
            String::new()
        } else {
            format!("AND +type IN ({})", types.iter().map(|_| "?").collect::<Vec<_>>().join(","))
        };
        let sql = format!(
            "\n        SELECT id, name, type, file_path, start_line, end_line, parent_class\n        FROM entities\n        WHERE rowid IN (\n            SELECT rowid FROM entities\n            WHERE name LIKE ? ESCAPE '\\'\n              AND file_path LIKE ? ESCAPE '\\'\n              {type_sql}\n          )\n          AND {}\n        ORDER BY name ASC, file_path ASC, start_line ASC\n        LIMIT ?\n      ",
            self.ent_sql("")
        );
        let name_like = format!("%{}%", escape_like(stem));
        let path_like = format!("{}/%", escape_like(prefix_path));
        let mut args = vec![Arg::Text(&name_like), Arg::Text(&path_like)];
        for t in types {
            args.push(Arg::Text(t));
        }
        args.extend(self.ent_params().into_iter().map(Arg::Int));
        args.push(Arg::Int(limit));
        let rows = self.db.query(&sql, &args).ok_or(())?;
        rows.iter()
            .map(|r| {
                Ok(GEntity {
                    id: match r.first() {
                        Some(Val::Text(s)) => s.clone(),
                        Some(Val::Int(i)) => i.to_string(),
                        _ => return Err(()),
                    },
                    name: opt_text(r.get(1)).unwrap_or_default(),
                    type_: opt_text(r.get(2)).unwrap_or_default(),
                    file_path: opt_text(r.get(3)),
                    start_line: r.get(4).and_then(Val::int),
                    end_line: r.get(5).and_then(Val::int),
                    parent_class: opt_text(r.get(6)).filter(|s| !s.is_empty()),
                })
            })
            .collect()
    }

    fn interface_calls_sql(&self, limit: &str) -> String {
        format!(
            "\n        SELECT r.context_line AS line, r.target_name AS call, t.id AS tid, t.name AS tname,\n               p.name AS pname, p.type AS ptype\n        FROM relationships r\n        JOIN entities s ON s.id = r.source_id\n        JOIN entities t ON t.id = r.target_id\n        LEFT JOIN entities p ON p.id = t.parent_id\n        WHERE s.file_path = ?\n          AND r.type = 'calls'\n          AND r.context_line >= ? AND r.context_line <= ?\n          AND {}\n          AND {}\n          AND {}\n        ORDER BY r.context_line ASC\n        LIMIT {limit}\n      ",
            self.rel_sql("r"),
            self.ent_sql("s"),
            self.ent_sql("t")
        )
    }

    fn interface_call_params(&self) -> Vec<i64> {
        let ent = self.ent_params();
        let mut p = self.rel_params();
        p.extend(ent.iter().copied());
        p.extend(ent.iter().copied());
        p
    }

    fn calls_rows(&mut self, sql: &str, file_path: &str, start: i64, end: i64, extra_limit: Option<i64>) -> Result<Vec<CallRow>, ()> {
        let params = self.interface_call_params();
        let mut args = vec![Arg::Text(file_path), Arg::Int(start), Arg::Int(end)];
        args.extend(params.into_iter().map(Arg::Int));
        if let Some(l) = extra_limit {
            args.push(Arg::Int(l));
        }
        let rows = self.db.query(sql, &args).ok_or(())?;
        Ok(rows
            .iter()
            .map(|r| CallRow {
                line: r.first().and_then(Val::int),
                call: opt_text(r.get(1)).unwrap_or_default(),
                tid: match r.get(2) {
                    Some(Val::Text(s)) => Some(s.clone()),
                    Some(Val::Int(i)) => Some(i.to_string()),
                    _ => None,
                },
                tname: opt_text(r.get(3)),
                pname: opt_text(r.get(4)),
                ptype: opt_text(r.get(5)),
            })
            .collect())
    }

    /// findInterfaceCallImplementations(filePath, startLine, endLine).
    pub fn find_interface_call_implementations(&mut self, file_path: &str, start: i64, end: i64) -> Result<Vec<GInterfaceCall>, ()> {
        let sql = self.interface_calls_sql("64");
        let calls = self.calls_rows(&sql, file_path, start, end, None)?;
        let mut cache = Default::default();
        self.interface_call_implementations(&calls, &mut cache)
    }

    /// findInterfaceCallImplementationsInRanges(filePath, ranges): per range, or Err when the
    /// JS would fall back to per-range queries on a span failure (then each range's own query).
    pub fn find_interface_call_implementations_in_ranges(&mut self, file_path: &str, ranges: &[(i64, i64)]) -> Vec<Vec<GInterfaceCall>> {
        if ranges.len() <= 1 {
            return ranges.iter().map(|(s, e)| self.find_interface_call_implementations(file_path, *s, *e).unwrap_or_default()).collect();
        }
        let lo = ranges.iter().map(|r| r.0).min().unwrap_or(0);
        let hi = ranges.iter().map(|r| r.1).max().unwrap_or(0);
        let sql = self.interface_calls_sql("?");
        let span = match self.calls_rows(&sql, file_path, lo, hi, Some(-1)) {
            Ok(s) => s,
            Err(()) => {
                return ranges.iter().map(|(s, e)| self.find_interface_call_implementations(file_path, *s, *e).unwrap_or_default()).collect();
            }
        };
        let mut cache = Default::default();
        ranges
            .iter()
            .map(|(s, e)| {
                let calls: Vec<CallRow> = span.iter().filter(|c| c.line.map_or(false, |l| l >= *s && l <= *e)).take(64).cloned().collect();
                self.interface_call_implementations(&calls, &mut cache).unwrap_or_default()
            })
            .collect()
    }

    fn interface_call_implementations(&mut self, calls: &[CallRow], cache: &mut IfaceCache) -> Result<Vec<GInterfaceCall>, ()> {
        if calls.is_empty() {
            return Ok(Vec::new());
        }
        let interface_of = format!(
            "\n        SELECT im.id AS id, im.name AS name, ip.name AS pname\n        FROM relationships o\n        JOIN entities im ON im.id = o.target_id\n        JOIN entities ip ON ip.id = im.parent_id\n        WHERE o.type = 'overrides'\n          AND o.source_id = ?\n          AND ip.type IN ('interface', 'protocol', 'trait')\n          AND {}\n          AND {}\n        LIMIT 1\n      ",
            self.rel_sql("o"),
            self.ent_sql("im")
        );
        let impls_of = format!(
            "\n        SELECT i.name, i.parent_class, i.file_path, i.start_line, i.end_line\n        FROM relationships o\n        JOIN entities i ON i.id = o.source_id\n        WHERE o.type = 'overrides'\n          AND o.target_id = ?\n          AND {}\n          AND {}\n        ORDER BY i.file_path ASC, i.start_line ASC\n        LIMIT 64\n      ",
            self.rel_sql("o"),
            self.ent_sql("i")
        );
        let rel = self.rel_params();
        let ent = self.ent_params();
        let mut out = Vec::new();
        for c in calls {
            let iface: Option<(String, Option<String>, Option<String>)> = if c.ptype.as_deref().map_or(false, |t| INTERFACE_ENTITY_TYPES.contains(&t)) {
                Some((c.tid.clone().unwrap_or_default(), c.tname.clone(), c.pname.clone()))
            } else {
                let key = format!("if:{}", c.tid.clone().unwrap_or_else(|| "null".into()));
                if !cache.iface.contains_key(&key) {
                    let mut args: Vec<Arg> = vec![match &c.tid {
                        Some(t) => Arg::Text(t),
                        None => return Err(()),
                    }];
                    args.extend(rel.iter().map(|v| Arg::Int(*v)));
                    args.extend(ent.iter().map(|v| Arg::Int(*v)));
                    let row = self.db.query(&interface_of, &args).ok_or(())?.into_iter().next();
                    let v = row.map(|r| {
                        (
                            match r.first() {
                                Some(Val::Text(s)) => s.clone(),
                                Some(Val::Int(i)) => i.to_string(),
                                _ => String::new(),
                            },
                            opt_text(r.get(1)),
                            opt_text(r.get(2)),
                        )
                    });
                    cache.iface.insert(key.clone(), v);
                }
                cache.iface[&key].clone()
            };
            let Some((iid, iname, ipname)) = iface else { continue };
            let key = format!("im:{iid}");
            if !cache.impls.contains_key(&key) {
                let mut args: Vec<Arg> = vec![Arg::Text(&iid)];
                args.extend(rel.iter().map(|v| Arg::Int(*v)));
                args.extend(ent.iter().map(|v| Arg::Int(*v)));
                let rows = self.db.query(&impls_of, &args).ok_or(())?;
                let impls = rows
                    .iter()
                    .map(|r| GImpl {
                        name: opt_text(r.first()).unwrap_or_default(),
                        owner: opt_text(r.get(1)).filter(|s| !s.is_empty()),
                        file_path: opt_text(r.get(2)).unwrap_or_default(),
                        start_line: r.get(3).and_then(Val::int),
                        end_line: r.get(4).and_then(Val::int),
                    })
                    .collect();
                cache.impls.insert(key.clone(), impls);
            }
            let name = iname.unwrap_or_default();
            let target = match ipname.filter(|p| !p.is_empty()) {
                Some(p) => format!("{p}.{name}"),
                None => name,
            };
            out.push(GInterfaceCall { line: c.line, call: c.call.clone(), target, impls: cache.impls[&key].clone() });
        }
        Ok(out)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CallRow {
    pub line: Option<i64>,
    pub call: String,
    pub tid: Option<String>,
    pub tname: Option<String>,
    pub pname: Option<String>,
    pub ptype: Option<String>,
}

#[derive(Default)]
pub(crate) struct IfaceCache {
    iface: std::collections::HashMap<String, Option<(String, Option<String>, Option<String>)>>,
    impls: std::collections::HashMap<String, Vec<GImpl>>,
}
