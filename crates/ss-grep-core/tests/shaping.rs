//! Parity tests for src/shaping.rs and src/render.rs against fixtures written by
//! fixtures-gen/shaping.mjs (the JS functions run on recorded bareGrep calls and synthetic cases).
//!
//! The committed fixtures are a sample. `SHAPING_FIXTURES_FULL=<dir>` adds a full-corpus set made
//! by `node fixtures-gen/shaping.mjs --full <dir>`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};
use ss_grep_core::render::*;
use ss_grep_core::shaping::*;
use ss_grep_core::types::{FileSummary, GrepRow, SummaryFile};

// --- fixture plumbing --------------------------------------------------------------------------

fn fixture_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/shaping")];
    if let Ok(full) = std::env::var("SHAPING_FIXTURES_FULL") {
        dirs.push(PathBuf::from(full));
    }
    dirs
}

/// Every fixture file whose name starts with `prefix`, parsed.
fn load(prefix: &str) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    for dir in fixture_dirs() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let mut names: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
        names.sort();
        for p in names {
            let name = p.file_name().unwrap().to_string_lossy().to_string();
            if !name.starts_with(prefix) || !name.ends_with(".json") {
                continue;
            }
            let text = std::fs::read_to_string(&p).unwrap();
            out.push((p.display().to_string(), serde_json::from_str(&text).unwrap()));
        }
    }
    assert!(!out.is_empty(), "no fixtures for {prefix}");
    out
}

/// Numbers compared as f64 (JS writes 1 for 1.0).
fn norm(v: &Value) -> Value {
    match v {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(norm).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), norm(v))).collect()),
        other => other.clone(),
    }
}

struct Checker {
    name: &'static str,
    checks: usize,
    failures: Vec<String>,
}

impl Checker {
    fn new(name: &'static str) -> Self {
        Checker { name, checks: 0, failures: Vec::new() }
    }
    fn eq(&mut self, what: impl FnOnce() -> String, got: &Value, want: &Value) {
        self.checks += 1;
        if norm(got) != norm(want) {
            if self.failures.len() < 12 {
                self.failures.push(format!("{}\n  got:  {}\n  want: {}", what(), got, want));
            } else {
                self.failures.push(String::new());
            }
        }
    }
    fn finish(self) {
        eprintln!("{}: {} checks, {} failures", self.name, self.checks, self.failures.len());
        if !self.failures.is_empty() {
            let shown: Vec<&String> = self.failures.iter().filter(|f| !f.is_empty()).collect();
            panic!("{}: {} of {} checks failed:\n{}", self.name, self.failures.len(), self.checks, shown.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n"));
        }
    }
}

fn rows_of(v: &Value) -> Vec<GrepRow> {
    serde_json::from_value(v.clone()).unwrap()
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().map(|s| s.as_str().unwrap().to_string()).collect()).unwrap_or_default()
}

fn opt_i64(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(Value::as_i64)
}

fn body_opts(v: &Value) -> BodyOpts {
    if v.is_null() {
        return BodyOpts::default();
    }
    let b = |k: &str| v.get(k).and_then(Value::as_bool) == Some(true);
    let s = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    BodyOpts {
        alloc_weight: s("alloc").as_deref() == Some("weight"),
        weight_sat2: s("weight").as_deref() == Some("sat2"),
        rule: match s("rule").as_deref() {
            Some("guarantee") => Some(AllocRule::Guarantee),
            Some("hh") => Some(AllocRule::Hh),
            _ => None,
        },
        line_classes: b("lineClasses"),
        line_spread: b("lineSpread"),
        full_line: b("fullLine"),
        drop_repeated_text: b("dropRepeatedText"),
        hit_max: v.get("hitMax").and_then(Value::as_u64).map(|x| x as usize),
    }
}

fn body_json(b: &GrepBody, with_lines: bool) -> Value {
    json!({
        "lines": if with_lines { json!(b.lines) } else { Value::Null },
        "rows": b.rows.iter().map(|r| json!({"file": r.file, "line": r.line, "text": r.text, "more": r.more})).collect::<Vec<_>>(),
        "shownMatches": b.shown_matches,
        "matchedFileCount": b.matched_file_count,
        "truncatedFileCount": b.truncated_file_count,
        "hiddenLine": b.hidden_line,
        "hidden": b.hidden.as_ref().map(|h| json!({"files": h.files, "matches": h.matches, "sample": h.sample})),
    })
}

fn div_json(d: &Option<Diversity>) -> Value {
    match d {
        None => Value::Null,
        Some(d) => json!({"kept": d.kept, "fileSummary": serde_json::to_value(&d.file_summary).unwrap()}),
    }
}

fn totals_of(fs: &FileSummary) -> HashMap<String, u64> {
    let mut m = HashMap::new();
    for f in &fs.files {
        m.insert(f.file.clone(), f.total);
    }
    m
}

fn div_opts<'a>(o: &Value, totals: Option<&'a HashMap<String, u64>>) -> DiversityOpts<'a> {
    DiversityOpts {
        per_file_cap: opt_i64(o, "perFileCap").unwrap_or(0),
        max_files: opt_i64(o, "maxFiles").unwrap_or(0),
        hidden_sample_size: o.get("hiddenSampleSize").and_then(Value::as_u64).map(|x| x as usize),
        order_weight: o.get("order").and_then(Value::as_str) == Some("weight"),
        weight_sat2: o.get("weight").and_then(Value::as_str) == Some("sat2"),
        totals,
    }
}

/// A listing case: `files` = sparse file lines ({ len, lines: { n: text } } or null per file).
fn run_listing(rows: &[BodyRow], case: &Value) -> Vec<String> {
    let before = opt_i64(case, "before").unwrap_or(0);
    let after = opt_i64(case, "after").unwrap_or(0);
    let typed = strings(&case["typed"]);
    let drop_text = case["dropText"].as_bool().unwrap_or(false);
    let match_lines: Option<HashMap<String, HashSet<u32>>> = case["matchLines"].as_object().map(|o| {
        o.iter().map(|(f, l)| (f.clone(), l.as_array().unwrap().iter().map(|n| n.as_u64().unwrap() as u32).collect())).collect()
    });
    let store = case["files"].as_object().cloned();
    let mut reader = move |file: &str| -> Option<Arc<Vec<String>>> {
        let e = store.as_ref()?.get(file)?;
        if e.is_null() {
            return None;
        }
        let len = e["len"].as_u64().unwrap() as usize;
        let mut v = vec![String::new(); len];
        for (n, t) in e["lines"].as_object().unwrap() {
            v[n.parse::<usize>().unwrap() - 1] = t.as_str().unwrap().to_string();
        }
        Some(Arc::new(v))
    };
    let has_files = !case["files"].is_null();
    let opts = ListingOpts {
        before,
        after,
        get_lines: if has_files { Some(&mut reader) } else { None },
        match_lines: match_lines.as_ref(),
        drop_text,
        typed: &typed,
    };
    render_grep_listing(rows, opts)
}

fn body_rows_json(v: &Value) -> Vec<BodyRow> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|r| BodyRow {
            file: r["file"].as_str().unwrap().to_string(),
            line: r["line"].as_u64().unwrap() as u32,
            text: r["text"].as_str().unwrap_or("").to_string(),
            more: r["more"].as_u64().unwrap_or(0),
        })
        .collect()
}

// --- tests -------------------------------------------------------------------------------------

#[test]
fn paths_test_like_and_prior() {
    let mut c = Checker::new("paths");
    for (_, fx) in load("paths") {
        for case in fx.as_array().unwrap() {
            let p = case["path"].as_str().unwrap();
            c.eq(|| format!("isTestLikePath({p:?})"), &json!(is_test_like_path(p)), &case["isTest"]);
            c.eq(|| format!("grepFilePrior({p:?})"), &json!(grep_file_prior(p)), &case["prior"]);
            c.eq(|| format!("isOutsideScopeSourceFile({p:?})"), &json!(is_outside_scope_source_file(p, None)), &case["outsideSource"]);
        }
    }
    c.finish();
}

#[test]
fn hit_text() {
    let mut c = Checker::new("hit_text");
    for (_, fx) in load("hit_text") {
        let maxes: Vec<Option<usize>> = fx["maxes"].as_array().unwrap().iter().map(|m| m.as_u64().map(|x| x as usize)).collect();
        for case in fx["cases"].as_array().unwrap() {
            let row: GrepRow = serde_json::from_value(case["row"].clone()).unwrap();
            for (i, max) in maxes.iter().enumerate() {
                c.eq(|| format!("grepHitText(full, max {max:?}) {:?}", row), &json!(grep_hit_text(&row, true, *max)), &case["full"][i]);
            }
            c.eq(|| format!("grepHitText(plain) {:?}", row), &json!(grep_hit_text(&row, false, None)), &case["plain"]);
        }
    }
    c.finish();
}

#[test]
fn calls_selection_body_listing() {
    let mut c = Checker::new("calls");
    for (src, fx) in load("calls") {
        for case in fx.as_array().unwrap() {
            let id = format!("{src}:{}", case["id"].as_str().unwrap_or("?"));
            let rows = rows_of(&case["rows"]);
            let fs: FileSummary = serde_json::from_value(case["fileSummary"].clone()).unwrap();
            let totals = totals_of(&fs);

            // Selection over the path-grouped rows.
            let grouped: Vec<GrepRow> = case["grouped"].as_array().unwrap().iter().map(|i| rows[i.as_u64().unwrap() as usize].clone()).collect();
            for sel in case["selections"].as_array().unwrap() {
                let with_totals = sel["withTotals"].as_bool().unwrap();
                let opts = div_opts(&sel["opts"], if with_totals { Some(&totals) } else { None });
                let got = apply_grep_file_diversity(&grouped, &opts);
                c.eq(|| format!("{id} select {} totals={with_totals}", sel["opts"]), &div_json(&got), &sel["out"]);
            }
            // Synthetic: the raw rows too.
            if let Some(raw) = case.get("raw") {
                let raw = rows_of(raw);
                for sel in case["rawSelections"].as_array().unwrap() {
                    let got = apply_grep_file_diversity(&raw, &div_opts(&sel["opts"], None));
                    c.eq(|| format!("{id} raw select {}", sel["opts"]), &div_json(&got), &sel["out"]);
                }
                let big: HashMap<String, u64> = case["rawTotals"].as_object().unwrap().iter().map(|(k, v)| (k.clone(), v.as_u64().unwrap())).collect();
                for sel in case["rawSelectionsTotals"].as_array().unwrap() {
                    let got = apply_grep_file_diversity(&raw, &div_opts(&sel["opts"], Some(&big)));
                    c.eq(|| format!("{id} raw select totals {}", sel["opts"]), &div_json(&got), &sel["out"]);
                }
            }

            // Bodies.
            let mut no_order = fs.clone();
            no_order.order = None;
            no_order.weight = None;
            let mut default_body: Option<GrepBody> = None;
            for b in case["bodies"].as_array().unwrap() {
                let k = b["k"].as_i64().unwrap();
                let opts = body_opts(&b["opts"]);
                let summary = if b["summary"] == "noorder" { &no_order } else { &fs };
                let got = render_grep_body(&rows, summary, k, &opts);
                let with_lines = b["out"].get("lines").is_some_and(|l| !l.is_null());
                let got_json = got.as_ref().map_or(Value::Null, |g| body_json(g, with_lines));
                c.eq(|| format!("{id} body {} k={k}", b["name"]), &got_json, &b["out"]);
                if b["name"] == "default" && k == 20 {
                    default_body = got;
                }
            }

            // Listings of the default k=20 body.
            if let Some(body) = &default_body {
                for l in case["listings"].as_array().unwrap() {
                    let got = run_listing(&body.rows, l);
                    c.eq(|| format!("{id} listing before={} after={} typed={} drop={}", l["before"], l["after"], l["typed"], l["dropText"]), &json!(got), &l["out"]);
                }
                if let Some(h) = case.get("hiddenLine") {
                    c.eq(|| format!("{id} hidden line"), &json!(render_grep_hidden_files(body.hidden.as_ref())), h);
                }
            }

            // Flood-mode line lists and the repeated-text check.
            let lines_by_file: HashMap<String, Vec<u64>> = case["linesByFile"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(f, l)| (f.clone(), l.as_array().unwrap().iter().map(|n| n.as_u64().unwrap()).collect()))
                .collect();
            for ll in case["lineLists"].as_array().unwrap() {
                let k = ll["k"].as_i64().unwrap();
                c.eq(|| format!("{id} lineLists k={k}"), &json!(render_grep_line_lists(&fs.files, &lines_by_file, k)), &ll["out"]);
            }
            c.eq(|| format!("{id} repeated"), &json!([match_text_is_repeated(&rows, false), match_text_is_repeated(&rows, true)]), &case["repeated"]);
        }
    }
    c.finish();
}

#[test]
fn synthetic_listings() {
    let mut c = Checker::new("listings");
    for (_, fx) in load("listings") {
        for case in fx.as_array().unwrap() {
            let rows = body_rows_json(&case["rows"]);
            let got = run_listing(&rows, case);
            c.eq(|| format!("listing {}", serde_json::to_string(case).unwrap().chars().take(300).collect::<String>()), &json!(got), &case["out"]);
        }
    }
    c.finish();
}

#[test]
fn line_classes() {
    let mut c = Checker::new("line_classes");
    for (_, fx) in load("line_classes") {
        for case in fx.as_array().unwrap() {
            let ms = rows_of(&case["ms"]);
            for p in case["picks"].as_array().unwrap() {
                let a = p["a"].as_u64().unwrap() as usize;
                let spread = p["spread"].as_bool().unwrap();
                c.eq(|| format!("selectGrepLinesByClass(a={a}, spread={spread}) {:?}", ms.iter().map(|m| (m.line, m.line_class, m.line_symbol)).collect::<Vec<_>>()), &json!(select_grep_lines_by_class(&ms, a, spread)), &p["out"]);
            }
        }
    }
    c.finish();
}

#[test]
fn misc_lines_and_allocation() {
    let mut c = Checker::new("misc");
    for (_, fx) in load("misc") {
        c.eq(|| "GREP_HIDDEN_HINT".into(), &json!(GREP_HIDDEN_HINT), &fx["hiddenHint"]);
        for h in fx["hiddenCases"].as_array().unwrap() {
            let hidden = if h["hidden"].is_null() {
                None
            } else {
                Some(Hidden { files: h["hidden"]["files"].as_u64().unwrap(), matches: h["hidden"]["matches"].as_u64().unwrap(), sample: strings(&h["hidden"]["sample"]) })
            };
            c.eq(|| format!("renderGrepHiddenFiles {}", h["hidden"]), &json!(render_grep_hidden_files(hidden.as_ref())), &h["out"]);
        }
        for o in fx["outsideCases"].as_array().unwrap() {
            let files: Vec<SummaryFile> = serde_json::from_value(o["files"].clone()).unwrap();
            let got = render_outside_scope_line(
                &files,
                o["hiddenFiles"].as_i64().unwrap_or(0),
                o["outsideTotal"].as_i64().unwrap(),
                o["scopedTotal"].as_i64().unwrap(),
                &strings(&o["scopes"]),
                o["max"].as_u64().unwrap_or(3) as usize,
            );
            c.eq(|| format!("renderOutsideScopeLine scopes={} total={} scoped={}", o["scopes"], o["outsideTotal"], o["scopedTotal"]), &json!(got), &o["out"]);
        }
        for o in fx["probeCases"].as_array().unwrap() {
            let got = render_outside_scope_probe_line(
                &strings(&o["files"]),
                o["limit"].as_i64().unwrap(),
                o["complete"].as_bool().unwrap_or(false),
                o["scopedTotal"].as_i64().unwrap(),
                &strings(&o["scopes"]),
                o["max"].as_u64().unwrap_or(3) as usize,
            );
            c.eq(|| format!("renderOutsideScopeProbeLine {}", o), &json!(got), &o["out"]);
        }
        for o in fx["scopeCases"].as_array().unwrap() {
            let f = o["file"].as_str().unwrap();
            c.eq(|| format!("fileInScopes({f:?}, {})", o["scopes"]), &json!(file_in_scopes(f, &strings(&o["scopes"]))), &o["out"]);
        }
        for o in fx["typedCases"].as_array().unwrap() {
            let f = o["file"].as_str().unwrap();
            c.eq(|| format!("typedPathLabel({f:?}, {})", o["others"]), &json!(typed_path_label(f, &strings(&o["others"]))), &o["out"]);
        }
        for o in fx["allocCases"].as_array().unwrap() {
            let f64s = |k: &str| o[k].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect::<Vec<f64>>();
            let keys = f64s("keys");
            let totals = f64s("totals");
            let caps: Vec<i64> = o["caps"].as_array().unwrap().iter().map(|x| x.as_i64().unwrap()).collect();
            let budget = o["budget"].as_i64().unwrap();
            let what = || format!("keys={} totals={} caps={} budget={budget}", o["keys"], o["totals"], o["caps"]);
            c.eq(|| format!("SL {}", what()), &json!(allocate_grep_lines_sainte_lague(&keys, &totals, &caps, budget)), &o["sl"]);
            c.eq(|| format!("guarantee {}", what()), &json!(allocate_grep_lines_with_first_line(&keys, &totals, &caps, budget, AllocRule::Guarantee)), &o["guarantee"]);
            c.eq(|| format!("hh {}", what()), &json!(allocate_grep_lines_with_first_line(&keys, &totals, &caps, budget, AllocRule::Hh)), &o["hh"]);
            c.eq(|| format!("budget {}", what()), &json!(allocate_grep_budget(&caps, budget)), &o["budgetRR"]);
        }
        for o in fx["weightKeyCases"].as_array().unwrap() {
            let hits = o["hits"].as_f64().unwrap();
            let scale = o["scale"].as_f64().unwrap();
            // Bit-exact: compare the f64s, not their JSON text.
            c.eq(|| format!("grepWeightKey({hits}, {scale}, sat2)"), &json!(grep_weight_key(hits, scale, true).to_bits()), &json!(o["sat2"].as_f64().unwrap().to_bits()));
            c.eq(|| format!("grepWeightKey({hits}, {scale})"), &json!(grep_weight_key(hits, scale, false).to_bits()), &json!(o["sqrt"].as_f64().unwrap().to_bits()));
        }
        for o in fx["quotaCases"].as_array().unwrap() {
            let got = test_file_quota(o["src"].as_u64().unwrap() as usize, o["test"].as_u64().unwrap() as usize, o["k"].as_i64().unwrap());
            c.eq(|| format!("testFileQuota {o}"), &json!(got), &o["out"]);
        }
        for o in fx["commentCases"].as_array().unwrap() {
            let t = o["text"].as_str().unwrap();
            c.eq(|| format!("isCommentLine({t:?})"), &json!(is_comment_line(t)), &o["out"]);
        }
        for o in fx["broadCases"].as_array().unwrap() {
            let t = o["total"].as_u64().unwrap();
            c.eq(|| format!("grepBroadHitMax({t})"), &json!(grep_broad_hit_max(t)), &o["out"]);
        }
    }
    c.finish();
}

#[test]
fn path_segments_and_blob_lines() {
    // pathSegments is not exported by the JS; these are its documented answers.
    assert_eq!(path_segments("./a//b"), vec!["a", "b"]);
    assert_eq!(path_segments("a\\b\\.\\c/"), vec!["a", "b", "c"]);
    assert!(path_segments("").is_empty());
    assert!(path_segments("/").is_empty());
    // isBlobLine is reached through the selection fixtures (syn-ties-blobs); spot checks here.
    assert!(is_blob_line("sha512-Zm9vYmFyMTIzNDU2Nzg5MGFiY2RlZjEyMzQ1Njc4OTBhYmNkZWYx0123456789=="));
    assert!(!is_blob_line("parseConfigurationFile2024parseConfigurationFile2024parse"));
    assert!(!is_blob_line("short1234"));
    assert!(!is_blob_line(&"a".repeat(60)));
}

/// End to end: the default ss-grep body (alloc weight, sat2, guarantee, line classes + spread,
/// full lines, the broad-hit window) printed as the listing and the hidden-files line must
/// appear in the RECORDED stdout of the unscoped calls (no --in, no context).
#[test]
fn recorded_stdout() {
    let mut c = Checker::new("stdout");
    for (src, fx) in load("stdout") {
        for case in fx.as_array().unwrap() {
            let id = format!("{src}:{}", case["id"].as_str().unwrap_or("?"));
            let rows = rows_of(&case["rows"]);
            let fs: FileSummary = serde_json::from_value(case["fileSummary"].clone()).unwrap();
            let total = case["total"].as_u64().unwrap();
            let opts = BodyOpts {
                alloc_weight: true,
                weight_sat2: true,
                rule: Some(AllocRule::Guarantee),
                line_classes: true,
                line_spread: true,
                full_line: true,
                drop_repeated_text: false,
                hit_max: grep_broad_hit_max(total),
            };
            let stdout = case["stdout"].as_str().unwrap();
            let Some(body) = render_grep_body(&rows, &fs, case["k"].as_i64().unwrap(), &opts) else {
                c.eq(|| format!("{id} declined"), &json!("declined"), &json!("a body"));
                continue;
            };
            let listing = render_grep_listing(&body.rows, ListingOpts::default());
            if !listing.is_empty() {
                let want = format!("{}\n", listing.join("\n"));
                c.eq(|| format!("{id} listing in stdout:\n{want}\n--- stdout:\n{stdout}"), &json!(stdout.contains(&want)), &json!(true));
            }
            if let Some(h) = render_grep_hidden_files(body.hidden.as_ref()) {
                c.eq(|| format!("{id} hidden line {h:?} in stdout"), &json!(stdout.contains(&format!("{h}\n"))), &json!(true));
            }
        }
    }
    c.finish();
}
