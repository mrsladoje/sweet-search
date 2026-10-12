//! Parity tests for src/classes.rs + src/enrich.rs against fixtures recorded from the JS
//! (fixtures-gen/enrich.mjs): every rendered string and stamped row byte-equal, and the same
//! code-graph call sequence (method + arguments) as the JS made.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Value};
use ss_grep_core::classes::{entity_short_name, is_comment_line, name_on_line};
use ss_grep_core::enrich::*;
use ss_grep_core::types::GrepRow;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/enrich")
}

fn load(name: &str) -> Value {
    let text = std::fs::read_to_string(fixture_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
    serde_json::from_str(&text).expect("fixture json")
}

fn repo_fixtures() -> Vec<Value> {
    let mut names: Vec<String> = std::fs::read_dir(fixture_dir())
        .expect("fixture dir")
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.ends_with(".json") && !n.starts_with('_'))
        .collect();
    names.sort();
    assert_eq!(names.len(), 13, "one fixture per bench repo");
    names.iter().map(|n| load(n)).collect()
}

fn opt_str(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

/// Compact entity `[id, name, type, startLine, endLine, parentClass(, filePath)]` or object.
fn entity(v: &Value) -> Entity {
    if let Some(a) = v.as_array() {
        Entity {
            id: opt_str(&a[0]),
            name: opt_str(&a[1]),
            entity_type: opt_str(&a[2]),
            start_line: a[3].as_i64(),
            end_line: a[4].as_i64(),
            parent_class: opt_str(&a[5]),
            file_path: a.get(6).and_then(opt_str),
        }
    } else {
        serde_json::from_value(v.clone()).expect("entity object")
    }
}

fn entities(v: &Value) -> Vec<Entity> {
    v.as_array().map(|a| a.iter().map(entity).collect()).unwrap_or_default()
}

fn at_lines(v: &Value) -> Vec<EntitiesAtLine> {
    v.as_array()
        .expect("array")
        .iter()
        .map(|x| EntitiesAtLine {
            enclosing: if x["enclosing"].is_null() { None } else { Some(entity(&x["enclosing"])) },
            in_range: entities(&x["inRange"]),
        })
        .collect()
}

/// Replays recorded CodeGraphRepository answers and logs the calls the Rust makes.
struct RecordedGraph {
    calls: Vec<(String, Value, Value)>,
    log: RefCell<Vec<(String, Value)>>,
}

impl RecordedGraph {
    fn new(graph: &Value) -> Self {
        let calls = graph
            .as_array()
            .map(|a| a.iter().map(|c| (c[0].as_str().unwrap().to_string(), c[1].clone(), c[2].clone())).collect())
            .unwrap_or_default();
        RecordedGraph { calls, log: RefCell::new(Vec::new()) }
    }
    fn answer(&self, method: &str, args: Value) -> Result<Value, GraphThrew> {
        self.log.borrow_mut().push((method.to_string(), args.clone()));
        let hit = self
            .calls
            .iter()
            .find(|(m, a, _)| m == method && *a == args)
            .unwrap_or_else(|| panic!("graph call not recorded by the JS: {method} {args}"));
        if hit.2.get("throw").is_some() {
            return Err(GraphThrew);
        }
        Ok(hit.2.clone())
    }
    fn assert_same_sequence(&self, ctx: &str) {
        let got: Vec<(String, Value)> = self.log.borrow().clone();
        let want: Vec<(String, Value)> = self.calls.iter().map(|(m, a, _)| (m.clone(), a.clone())).collect();
        assert_eq!(got, want, "{ctx}: graph call sequence");
    }
}

impl CodeGraph for RecordedGraph {
    fn find_entities_in_file(&self, file_path: &str, limit: Option<i64>) -> Result<Vec<Entity>, GraphThrew> {
        let args = match limit {
            Some(l) => json!([file_path, { "limit": l }]),
            None => json!([file_path]),
        };
        Ok(entities(&self.answer("findEntitiesInFile", args)?))
    }
    fn find_entities_in_range(&self, file_path: &str, start_line: i64, end_line: i64) -> Result<Vec<Entity>, GraphThrew> {
        Ok(entities(&self.answer("findEntitiesInRange", json!([file_path, start_line, end_line]))?))
    }
    fn find_enclosing_entity(&self, file_path: &str, start_line: i64, end_line: i64) -> Result<Option<Entity>, GraphThrew> {
        let v = self.answer("findEnclosingEntity", json!([file_path, start_line, end_line]))?;
        Ok(if v.is_null() { None } else { Some(entity(&v)) })
    }
    fn find_entities_at_lines(&self, file_path: &str, lines: &[i64]) -> Result<Option<Vec<EntitiesAtLine>>, GraphThrew> {
        let v = self.answer("findEntitiesAtLines", json!([file_path, lines]))?;
        Ok(if v.is_null() { None } else { Some(at_lines(&v)) })
    }
    fn find_entities_for_ranges(&self, file_path: &str, ranges: &[RangeQuery]) -> Result<Vec<EntitiesAtLine>, GraphThrew> {
        Ok(at_lines(&self.answer("findEntitiesForRanges", json!([file_path, ranges]))?))
    }
    fn find_family_candidates(&self, stem: &str, opts: &FamilyCandidateOpts) -> Result<Vec<Entity>, GraphThrew> {
        Ok(entities(&self.answer("findFamilyCandidates", json!([stem, opts]))?))
    }
    fn find_interface_call_implementations_in_ranges(&self, file_path: &str, ranges: &[LineRange]) -> Result<Vec<Vec<InterfaceCallRow>>, GraphThrew> {
        let v = self.answer("findInterfaceCallImplementationsInRanges", json!([file_path, ranges]))?;
        Ok(serde_json::from_value(v).expect("interface rows"))
    }
}

/// Recorded file texts: `read_file_range(file, 1, 1_000_000)` and `read_file_utf8(file)`.
struct RecordedSource {
    reads: HashMap<String, Option<String>>,
}

impl RecordedSource {
    fn new(v: &Value) -> Self {
        let reads = v.as_object().map(|o| o.iter().map(|(k, t)| (k.clone(), opt_str(t))).collect()).unwrap_or_default();
        RecordedSource { reads }
    }
}

impl SourceText for RecordedSource {
    fn read_file_range(&self, file: &str, start_line: i64, end_line: i64) -> Option<String> {
        let text = self.reads.get(file).unwrap_or_else(|| panic!("file read not recorded: {file}")).as_deref()?;
        Some(js_line_range(text, start_line, end_line))
    }
    fn read_file_utf8(&self, file: &str) -> Option<String> {
        self.reads.get(file).unwrap_or_else(|| panic!("impl read not recorded: {file}")).clone()
    }
}

fn expect_family(v: &Value) -> Option<FamilyManifest> {
    if v.is_null() {
        return None;
    }
    Some(FamilyManifest {
        rendered: v["rendered"].as_str().unwrap().to_string(),
        tokens: v["tokens"].as_i64().unwrap(),
        groups: serde_json::from_value(v["groups"].clone()).unwrap(),
        members: entities(&v["members"]),
    })
}

fn expect_sibling(v: &Value) -> Option<SiblingLine> {
    if v.is_null() {
        None
    } else {
        Some(serde_json::from_value(v.clone()).expect("sibling line"))
    }
}

fn hits(v: &Value) -> Vec<Hit> {
    v.as_array().unwrap().iter().map(|h| Hit { file: h[0].as_str().unwrap().to_string(), line: h[1].as_i64().unwrap() }).collect()
}

#[test]
fn bare_grep_block_matches_js() {
    let mut n = 0;
    let mut stamped_rows = 0;
    let mut nonnull = (0, 0);
    for fx in repo_fixtures() {
        let repo = fx["repo"].as_str().unwrap().to_string();
        for (ci, c) in fx["cases"].as_array().unwrap().iter().enumerate().filter(|(_, c)| c["kind"] == "bare") {
            let ctx = format!("{repo} bare #{ci} (call {})", c["call"]);
            let graph = RecordedGraph::new(&c["graph"]);
            let source = RecordedSource::new(&c["reads"]);
            let fresh: HashMap<String, bool> = serde_json::from_value(c["fresh"].clone()).unwrap();
            let keep: Option<HashMap<String, bool>> = serde_json::from_value(c["opts"]["keepFile"].clone()).unwrap();
            let keep_fn = |f: &str| *keep.as_ref().unwrap().get(f).unwrap_or_else(|| panic!("{ctx}: keepFile not recorded for {f}"));
            let o = &c["opts"];
            let opts = BareGrepEnrichOptions {
                is_agent_format: o["isAgentFormat"].as_bool().unwrap(),
                grep_line_classes: o["grepLineClasses"].as_bool().unwrap(),
                has_file_summary: o["hasFileSummary"].as_bool().unwrap(),
                has_file_filter: o["hasFileFilter"].as_bool().unwrap(),
                cwd_scope: o["cwdScope"].as_bool().unwrap(),
                sibling_line_off: o["siblingLineOff"].as_bool().unwrap(),
                keep_file: if keep.is_some() { Some(&keep_fn) } else { None },
            };
            let mut rows: Vec<GrepRow> = c["rows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| GrepRow {
                    file: r[0].as_str().unwrap().into(),
                    line: r[1].as_u64().unwrap() as u32,
                    content: r[2].as_str().unwrap().into(),
                    ..Default::default()
                })
                .collect();
            let mut is_fresh = |f: &str| *fresh.get(f).unwrap_or_else(|| panic!("freshness not recorded: {f}"));
            let out = bare_grep_enrich(&mut rows, c["regex"].as_str().unwrap(), &opts, Some(&graph), &source, &mut is_fresh)
                .unwrap_or_else(|d| panic!("{ctx}: declined: {d:?}"));
            let want_rows = c["expect"]["rows"].as_array().unwrap();
            for (i, (row, want)) in rows.iter().zip(want_rows).enumerate() {
                assert_eq!(row.line_class, want[0].as_i64(), "{ctx}: row {i} lineClass");
                assert_eq!(row.line_symbol, want[1].as_i64(), "{ctx}: row {i} lineSymbol");
                assert_eq!(row.defines, want[2].as_bool().unwrap(), "{ctx}: row {i} defines");
                if row.line_class.is_some() {
                    stamped_rows += 1;
                }
            }
            let want_stats = &c["expect"]["stats"];
            let got_stats = out.line_class_stats.map(|s| json!({ "files": s.files, "stamped": s.stamped }));
            assert_eq!(got_stats.unwrap_or(Value::Null), *want_stats, "{ctx}: stats");
            assert_eq!(out.family_manifest, expect_family(&c["expect"]["familyManifest"]), "{ctx}: familyManifest");
            assert_eq!(out.sibling_line, expect_sibling(&c["expect"]["siblingLine"]), "{ctx}: siblingLine");
            nonnull.0 += out.family_manifest.is_some() as usize;
            nonnull.1 += out.sibling_line.is_some() as usize;
            graph.assert_same_sequence(&ctx);
            n += 1;
        }
    }
    eprintln!("bare cases: {n}, stamped rows: {stamped_rows}, family manifests: {}, sibling lines: {}", nonnull.0, nonnull.1);
    assert!(n >= 200);
}

#[test]
fn family_manifest_matches_js() {
    let (mut n, mut some) = (0, 0);
    for fx in repo_fixtures() {
        let repo = fx["repo"].as_str().unwrap().to_string();
        for (ci, c) in fx["cases"].as_array().unwrap().iter().enumerate().filter(|(_, c)| c["kind"] == "family") {
            let ctx = format!("{repo} family #{ci}");
            let graph = RecordedGraph::new(&c["graph"]);
            let got = build_indexed_grep_family_manifest(&hits(&c["hits"]), Some(&graph), None).unwrap_or_else(|d| panic!("{ctx}: {d:?}"));
            assert_eq!(got, expect_family(&c["expect"]), "{ctx}");
            graph.assert_same_sequence(&ctx);
            some += got.is_some() as usize;
            n += 1;
        }
    }
    eprintln!("family cases: {n} ({some} with a manifest)");
    assert!(n >= 200 && some >= 20);
}

#[test]
fn sibling_line_matches_js() {
    let (mut n, mut some, mut grep_some) = (0, 0, 0);
    for fx in repo_fixtures() {
        let repo = fx["repo"].as_str().unwrap().to_string();
        for (ci, c) in fx["cases"].as_array().unwrap().iter().enumerate().filter(|(_, c)| c["kind"] == "sibling") {
            let ctx = format!("{repo} sibling #{ci}");
            let graph = RecordedGraph::new(&c["graph"]);
            let source = RecordedSource::new(&c["reads"]);
            let got = build_singleton_sibling_line(&hits(&c["hits"]), Some(&graph), c["regex"].as_str().unwrap(), &source)
                .unwrap_or_else(|d| panic!("{ctx}: {d:?}"));
            assert_eq!(got, expect_sibling(&c["expect"]), "{ctx}");
            graph.assert_same_sequence(&ctx);
            let g = &c["grep"];
            let printed: Vec<i64> = serde_json::from_value(g["rows"].clone()).unwrap();
            let line = grep_sibling_line(got.as_ref(), &printed, g["before"].as_i64().unwrap(), g["after"].as_i64().unwrap());
            assert_eq!(line, opt_str(&g["expect"]), "{ctx}: grepSiblingLine");
            some += got.is_some() as usize;
            grep_some += line.is_some() as usize;
            n += 1;
        }
    }
    eprintln!("sibling cases: {n} ({some} with a line, {grep_some} printed)");
    assert!(n >= 100 && some >= 15);
}

#[test]
fn interface_hint_matches_js() {
    let (mut n, mut some) = (0, 0);
    for fx in repo_fixtures() {
        let repo = fx["repo"].as_str().unwrap().to_string();
        for (ci, c) in fx["cases"].as_array().unwrap().iter().enumerate().filter(|(_, c)| c["kind"] == "hint") {
            let ctx = format!("{repo} hint #{ci}");
            let graph = RecordedGraph::new(&c["graph"]);
            let source = RecordedSource::new(&c["reads"]);
            let got = grep_interface_hint(c["total"].as_i64().unwrap(), &hits(&c["rows"]), Some(&graph), &source)
                .unwrap_or_else(|d| panic!("{ctx}: {d:?}"));
            assert_eq!(got, opt_str(&c["expect"]), "{ctx}");
            graph.assert_same_sequence(&ctx);
            some += got.is_some() as usize;
            n += 1;
        }
    }
    // No bench repo's graph has interface overrides: the corpus never prints the trailer.
    // Synthetic call tables through the same JS path cover it.
    let h = load("_helpers.json");
    for (ci, c) in h["ifaceHints"].as_array().unwrap().iter().enumerate() {
        let ctx = format!("synthetic hint #{ci}");
        let graph = RecordedGraph::new(&c["graph"]);
        let source = RecordedSource::new(&c["reads"]);
        let got = grep_interface_hint(c["total"].as_i64().unwrap(), &hits(&c["rows"]), Some(&graph), &source)
            .unwrap_or_else(|d| panic!("{ctx}: {d:?}"));
        assert_eq!(got, opt_str(&c["expect"]), "{ctx}");
        graph.assert_same_sequence(&ctx);
        some += got.is_some() as usize;
        n += 1;
    }
    eprintln!("interface-hint cases: {n} ({some} print a trailer)");
    assert!(n >= 200 && some >= 8);
}

#[test]
fn freshness_matches_node() {
    let mut n = 0;
    for fx in repo_fixtures() {
        let published = manifest_published_ms(fx["manifest"].as_str()).expect("manifest");
        for f in fx["freshness"].as_array().unwrap() {
            let ms = node_mtime_ms(f[1].as_i64().unwrap(), f[2].as_i64().unwrap());
            // Stored as Node's decimal string: serde_json's default float parse is not exact.
            let want: f64 = f[3].as_str().unwrap().parse().unwrap();
            assert_eq!(ms, want, "mtimeMs of {}", f[0]);
            let fr = index_freshness(published, Some(ms));
            assert_eq!((fr.known, fr.stale), (f[4].as_bool().unwrap(), f[5].as_bool().unwrap()), "freshness of {}", f[0]);
            n += 1;
        }
    }
    assert!(n >= 50, "{n}");
    let h = load("_helpers.json");
    for d in h["dates"].as_array().unwrap() {
        let got = date_parse_iso(d[0].as_str().unwrap()).expect("toISOString shape");
        assert_eq!(got, d[1].as_f64(), "Date.parse({})", d[0]);
    }
    assert!(date_parse_iso("2026-10-12").is_err());
    assert!(date_parse_iso("2026-10-12T10:07:20").is_err());
    assert_eq!(manifest_published_ms(None), Ok(None));
    assert_eq!(manifest_published_ms(Some("{\"publishedAt\":\"2026-10-12T10:07:20.681Z\"}")), Ok(None));
    assert_eq!(manifest_published_ms(Some("{\"epoch\":1.5,\"publishedAt\":\"2026-10-12T10:07:20.681Z\"}")), Ok(None));
    assert_eq!(manifest_published_ms(Some("{\"epoch\":2}")), Ok(None));
    assert!(manifest_published_ms(Some("{\"epoch\":2,\"publishedAt\":5}")).is_err());
    assert_eq!(index_freshness(None, Some(1.0)), Freshness { known: false, stale: false });
    assert_eq!(index_freshness(Some(5.0), None), Freshness { known: false, stale: false });
}

#[test]
fn helpers_match_js() {
    let h = load("_helpers.json");
    let mut declined = 0;
    for p in h["paths"].as_array().unwrap() {
        let f = p[0].as_str().unwrap();
        assert_eq!(is_test_like_path(f), p[1].as_bool().unwrap(), "test-paths.js isTestLikePath({f:?})");
        assert_eq!(is_test_path(f), p[2].as_bool().unwrap(), "isTestPath({f:?})");
        assert_eq!(read_is_test_like_path(f), p[3].as_bool().unwrap(), "search-read isTestLikePath({f:?})");
    }
    for d in h["definedName"].as_array().unwrap() {
        assert_eq!(defined_name_from_regex(d[0].as_str().unwrap()), opt_str(&d[1]), "definedName({})", d[0]);
    }
    for d in h["literalRuns"].as_array().unwrap() {
        let want: Vec<String> = serde_json::from_value(d[1].clone()).unwrap();
        assert_eq!(regex_literal_runs(d[0].as_str().unwrap()), want, "regexLiteralRuns({})", d[0]);
    }
    for d in h["evidence"].as_array().unwrap() {
        let rx = d[0].as_str().unwrap();
        let e1 = extract_query_evidence("", rx).unwrap();
        assert_eq!(json!(e1.anchors), d[1], "evidence('', {rx:?}) anchors");
        assert_eq!(json!(e1.subtokens.items), d[2], "evidence('', {rx:?}) subtokens");
        let e2 = extract_query_evidence(rx, rx).unwrap();
        assert_eq!(json!(e2.anchors), d[3], "evidence(rx, {rx:?}) anchors");
        assert_eq!(json!(e2.subtokens.items), d[4], "evidence(rx, {rx:?}) subtokens");
    }
    for d in h["subtokens"].as_array().unwrap() {
        assert_eq!(json!(informative_subtokens(d[0].as_str().unwrap()).items), d[1], "informativeSubtokens({})", d[0]);
    }
    for d in h["contains"].as_array().unwrap() {
        match contains_token(d[0].as_str().unwrap(), d[1].as_str().unwrap(), d[2].as_bool().unwrap()) {
            Ok(v) => assert_eq!(v, d[3].as_bool().unwrap(), "containsToken({d})"),
            Err(_) => declined += 1,
        }
    }
    for d in h["shortName"].as_array().unwrap() {
        assert_eq!(entity_short_name(d[0].as_str().unwrap()), d[1].as_str().unwrap(), "entityShortName({})", d[0]);
    }
    for d in h["nameOnLine"].as_array().unwrap() {
        assert_eq!(name_on_line(d[0].as_str().unwrap(), d[1].as_str().unwrap()), d[2].as_bool().unwrap(), "nameOnLine({d})");
    }
    for d in h["commentLine"].as_array().unwrap() {
        assert_eq!(is_comment_line(d[0].as_str().unwrap()), d[1].as_bool().unwrap(), "isCommentLine({})", d[0]);
    }
    for d in h["family"].as_array().unwrap() {
        let seeds: Vec<String> = serde_json::from_value(d[1].clone()).unwrap();
        let got = build_indexed_family_manifest(&entities(&d[0]), &seeds).unwrap();
        assert_eq!(got, expect_family(&d[2]), "buildIndexedFamilyManifest({})", d[0]);
    }
    for d in h["accessor"].as_array().unwrap() {
        let code = d[0].as_str().unwrap();
        assert_eq!(is_accessor_body(Some(code), d[1].as_str().unwrap()), d[2].as_bool().unwrap(), "isAccessorBody({code:?}, {})", d[1]);
    }
    for d in h["iface"].as_array().unwrap() {
        let file = d["file"].as_str().unwrap();
        let ranges = [LineRange { start_line: 1, end_line: 1 }];
        let graph = RecordedGraph {
            calls: vec![("findInterfaceCallImplementationsInRanges".into(), json!([file, ranges]), json!([d["rows"]]))],
            log: RefCell::new(Vec::new()),
        };
        let source = RecordedSource { reads: HashMap::new() };
        let got = interface_calls_in_ranges(Some(&graph), &source, file, &ranges);
        let want: Vec<InterfaceCall> = serde_json::from_value(d["select"].clone()).unwrap();
        assert_eq!(got[0], want, "selectInterfaceCalls({})", d["rows"]);
        assert_eq!(render_interface_impls(&got[0]), d["render"].as_str().unwrap(), "renderInterfaceImpls({})", d["select"]);
    }
    for (i, d) in h["sibling"].as_array().unwrap().iter().enumerate() {
        assert!(d["error"].is_null());
        let graph = RecordedGraph::new(&d["graph"]);
        let source = RecordedSource::new(&d["reads"]);
        let got = build_same_file_sibling_line(&hits(&d["hits"]), Some(&graph), d["regex"].as_str().unwrap(), &source);
        match got {
            Ok(v) => {
                assert_eq!(v, expect_sibling(&d["expect"]), "synthetic sibling #{i}");
                graph.assert_same_sequence(&format!("synthetic sibling #{i}"));
            }
            Err(_) => declined += 1,
        }
    }
    let r = &h["ranges"];
    let text = r["text"].as_str().unwrap();
    for c in r["cases"].as_array().unwrap() {
        assert_eq!(Some(js_line_range(text, c[0].as_i64().unwrap(), c[1].as_i64().unwrap())), opt_str(&c[2]), "readFileRange {c}");
    }
    for c in r["traversal"].as_array().unwrap() {
        let null = read_file_range_path("/x/y/.range-tmp", c[0].as_str().unwrap()).is_none();
        assert_eq!(null, c[1].as_bool().unwrap(), "readFileRange path check {c}");
    }
    eprintln!("helpers: {declined} declined (non-ASCII case folding)");
    assert!(declined <= 3, "{declined}");
}

#[test]
fn edge_cases() {
    // Unicode: JS lowercases É; the port declines rather than guess.
    assert!(contains_token("ÉCLAIR", "éclair", false).is_err());
    assert_eq!(contains_token("ÉCLAIR", "ÉCLAIR", true), Ok(true));
    // A surrogate pair cut at 89 units prints U+FFFD, as Node writes a lone surrogate.
    let line = format!("{}😀tail{}", "a".repeat(88), "b".repeat(10));
    let c = compact_source_line(&line);
    assert!(c.ends_with("\u{FFFD}…"), "{c}");
    assert_eq!(compact_source_line("  a \t\u{a0} b  "), "a b");
    // definedName shapes.
    assert_eq!(defined_name_from_regex("\\b(?:safeParse)\\b").as_deref(), Some("safeParse"));
    assert_eq!(defined_name_from_regex("safeParse\\s*\\(").as_deref(), Some("safeParse"));
    assert_eq!(defined_name_from_regex("safe.Parse"), None);
    // grepSiblingLine: every site printed -> nothing.
    let s = SiblingLine {
        rendered: "# same file (siblings of f): 3: x".into(),
        tokens: 9,
        enclosing: "f".into(),
        sites: vec![SiblingSite { line: 3, kind: "field".into(), name: Some("x".into()), text: "x".into() }],
    };
    assert_eq!(grep_sibling_line(Some(&s), &[2], 0, 1), None);
    assert_eq!(grep_sibling_line(Some(&s), &[9], 0, 0).as_deref(), Some("# siblings: 3: x"));
    // No graph: no enrichment, no calls.
    let src = RecordedSource { reads: HashMap::new() };
    assert_eq!(build_singleton_sibling_line(&[Hit { file: "a".into(), line: 1 }], None, "x", &src), Ok(None));
    assert_eq!(grep_interface_hint(9, &[Hit { file: "a".into(), line: 1 }], None, &src), Ok(None));
}
