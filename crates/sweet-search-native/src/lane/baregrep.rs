//! bareGrep (core/search/search-pattern.js) for the lane: the native search, then the same
//! shaping, in the same order. Every branch the lane does not reproduce is a decline: a zero
//! result (the JS then retries in a regex dialect, greps unindexed files or explains the
//! zero), a sparse delta overlay, a route other than the unified or the direct scoped search.

use super::adapt::{self, Graph, Globs, ScopePred, R};
use super::engine::{EngineResult, LaneIndex, RawMatch};
use super::overlay::Overlay;
use super::state::Manifest;
use ss_grep_core::types::{FileSummary, GrepRow};
use std::cmp::Ordering;

pub(crate) struct GrepOptions {
    pub regex: String,
    /// options.maxMatches (0 = no cut).
    pub max_matches: usize,
    /// options.perFileCap (0 = none).
    pub per_file_cap: u32,
    pub max_files: usize,
    /// grepFileWeight 'sat2' (grepFileOrder is always 'weight' on these calls).
    pub sat2: bool,
    pub line_classes: bool,
    /// _isAgentFormat.
    pub agent: bool,
    /// _siblingLine.
    pub sibling_line: bool,
    pub file_filter: Option<Vec<String>>,
    /// _cwdScope.
    pub cwd_scope: bool,
    pub path_globs: Vec<String>,
}

pub(crate) struct Bare {
    pub rows: Vec<GrepRow>,
    pub summary: Option<FileSummary>,
    pub total: u64,
    pub family: Option<String>,
    pub sibling: Option<ss_grep_core::enrich::SiblingLine>,
    pub glob_dirs: Vec<String>,
}

pub(crate) struct Ctx<'a> {
    pub root: &'a str,
    pub index: &'a LaneIndex,
    /// The sparse delta overlay (prepared for `index`), None when the manifest lists none.
    pub overlay: Option<&'a Overlay>,
    pub manifest: &'a Manifest,
    pub graph: Graph<'a>,
}

// search-pattern-planner.js: an --in scope with at most this many files is grepped whole.
const SCOPE_DIRECT_MAX_FILES: usize = 512;

/// search-pattern-planner.js rootAnchoredScopes.
pub(crate) fn root_anchored_scopes(filters: &[String], root: &str) -> Option<Vec<String>> {
    let scopes: Vec<&String> = filters.iter().filter(|s| !s.is_empty()).collect();
    if scopes.is_empty() || !root.starts_with('/') {
        return None;
    }
    let mut out = Vec::new();
    for raw in scopes {
        let normalized = raw.replace('\\', "/");
        let b = normalized.as_bytes();
        if normalized.starts_with('/') || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'/') {
            return None;
        }
        let segs: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
        if segs.contains(&"..") {
            continue;
        }
        if segs.is_empty() {
            return None;
        }
        let joined = segs.join("/");
        if !std::path::Path::new(root).join(&joined).exists() {
            return None;
        }
        out.push(joined);
    }
    Some(out)
}

fn native_literals(regex: &str) -> Option<Vec<Vec<String>>> {
    crate::regex_literals::extract_regex_literals(regex.to_string()).ok().map(|r| r.clauses)
}

/// getSparseGramAllFilesWithOverlay.
fn all_files<'a>(ctx: &'a Ctx) -> R<&'a [String]> {
    match ctx.overlay {
        Some(o) => o.all_files().map(|a| a.files.as_slice()).ok_or("overlay not prepared"),
        None => Ok(&ctx.index.files),
    }
}

/// getSparseGramFilesUnder.
fn files_under(ctx: &Ctx, rels: &[String]) -> R<Vec<String>> {
    match ctx.overlay {
        Some(o) => o.all_files().map(|a| a.under(rels)).ok_or("overlay not prepared"),
        None => Ok(ctx.index.files_under(rels)),
    }
}

// querySparseGramCandidates' defaults (maxGramCandidateFiles, maxGramCandidateRatio).
const MAX_CANDIDATE_FILES: usize = 100_000;
const MAX_CANDIDATE_RATIO: f64 = 1.0;

/// querySparseGramCandidates: Some(files) when eligible, None otherwise.
fn gram_candidates(ctx: &Ctx, gram: &[Vec<String>]) -> R<Option<Vec<String>>> {
    if gram.is_empty() {
        return Ok(None);
    }
    let live = ctx.overlay.map_or(0, |o| o.live_count());
    let mut combined: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = Default::default();
    let mut total_files: u64 = 0;
    for clause in gram {
        if clause.is_empty() {
            return Ok(None);
        }
        let Ok(r) = ctx.index.index.query_literals(clause.clone(), Some(0), Some(0)) else { return Ok(None) };
        if !r.eligible {
            return Ok(None);
        }
        total_files = total_files.max(r.total_files as u64);
        let clause_files = match ctx.overlay {
            Some(o) => o.apply(&r.files, Some(clause), ctx.index)?,
            None => r.files,
        };
        let clause_total = r.total_files as u64 + live as u64;
        total_files = total_files.max(clause_total);
        if clause_files.len() > MAX_CANDIDATE_FILES || (clause_total > 0 && clause_files.len() as f64 / clause_total as f64 > MAX_CANDIDATE_RATIO) {
            return Ok(None);
        }
        for f in clause_files {
            if seen.insert(f.clone()) {
                combined.push(f);
            }
        }
    }
    if combined.len() > MAX_CANDIDATE_FILES || (total_files > 0 && combined.len() as f64 / total_files as f64 > MAX_CANDIDATE_RATIO) {
        return Ok(None);
    }
    Ok(Some(combined))
}

/// The planner's multi-step route: the gram candidates (in scope), else every indexed file
/// (in scope).
fn planner_files(ctx: &Ctx, gram: &[Vec<String>], pred: Option<&ScopePred>) -> R<Vec<String>> {
    let keep = |files: Vec<String>| -> Vec<String> {
        match pred {
            Some(p) => files.into_iter().filter(|f| p.matches(f)).collect(),
            None => files,
        }
    };
    if let Some(files) = gram_candidates(ctx, gram)? {
        return Ok(keep(files));
    }
    Ok(keep(all_files(ctx)?.to_vec()))
}

/// collectRegexMatches + dropSymlinkAliasMatches.
fn search(ctx: &Ctx, opts: &GrepOptions, pred: Option<&ScopePred>, cap: u32) -> R<EngineResult> {
    let ci = adapt::has_ci_flag(&opts.regex);
    let gram = adapt::gram_clauses(&opts.regex, ci, &native_literals)?;
    let files: Vec<String> = match pred {
        None if ctx.overlay.is_none() => {
            if ctx.index.grams_prove_no_match(&gram) {
                return Err("zero hits");
            }
            return ctx.index.unified(ctx.root, &gram, &opts.regex, ci, cap).ok_or("native search failed");
        }
        None => planner_files(ctx, &gram, None)?,
        Some(pred) => {
            // A small --in scope: its indexed files, read whole.
            let filters = opts.file_filter.as_deref().unwrap_or(&[]);
            let pool: Vec<String> = match root_anchored_scopes(filters, ctx.root) {
                Some(anchored) => files_under(ctx, &anchored)?,
                None => all_files(ctx)?.to_vec(),
            };
            let in_scope: Vec<String> = pool.into_iter().filter(|f| pred.matches(f)).collect();
            if !in_scope.is_empty() && in_scope.len() <= SCOPE_DIRECT_MAX_FILES {
                in_scope
            } else {
                planner_files(ctx, &gram, Some(pred))?
            }
        }
    };
    if files.is_empty() {
        return Err("zero hits");
    }
    ctx.index.grep_files(ctx.root, &files, &opts.regex, ci, cap).ok_or("native search failed")
}

fn to_row(m: RawMatch) -> GrepRow {
    GrepRow {
        file: m.file,
        line: m.line,
        column: if m.column == 0 { 1 } else { m.column },
        match_text: m.match_text,
        content: m.content,
        ..Default::default()
    }
}

/// bareGrep(query, routing, options) without the outside-scope probe.
pub(crate) fn bare_grep(ctx: &mut Ctx, opts: &GrepOptions) -> R<Bare> {
    let pred = match &opts.file_filter {
        Some(f) => Some(adapt::scope_predicate(f, ctx.root)?),
        None => None,
    };
    let globs: Option<Globs> = if opts.path_globs.is_empty() { None } else { adapt::compile_globs(&opts.path_globs)? };
    let cap = opts.per_file_cap;
    let result = search(ctx, opts, pred.as_ref(), cap)?;

    // shapeBareGrepMatches: --in, then -g (whole files, so a capped list's totals follow).
    let mut matches = result.matches;
    let mut totals = result.totals;
    if let Some(p) = &pred {
        matches.retain(|m| p.matches(&m.file));
        if let Some(t) = totals.as_mut() {
            t.retain(|(f, _)| p.matches(f));
        }
    }
    if let Some(g) = &globs {
        matches.retain(|m| g.matches(&m.file));
        if let Some(t) = totals.as_mut() {
            t.retain(|(f, _)| g.matches(f));
        }
    }
    if matches.is_empty() {
        return Err("zero hits");
    }
    // matches.sort: localeCompare(file) || line || column.
    let mut failed = false;
    matches.sort_by(|a, b| {
        if failed {
            return Ordering::Equal;
        }
        let c = if a.file == b.file {
            Ordering::Equal
        } else {
            match adapt::locale_compare(&a.file, &b.file) {
                Some(c) => c,
                None => {
                    failed = true;
                    Ordering::Equal
                }
            }
        };
        c.then(a.line.cmp(&b.line)).then(a.column.cmp(&b.column))
    });
    if failed {
        return Err("collation");
    }
    if totals.is_some() {
        // hasCollatingNeighbours: two different paths that compare equal.
        for w in matches.windows(2) {
            if w[0].file != w[1].file && adapt::locale_compare(&w[0].file, &w[1].file) == Some(Ordering::Equal) {
                return Err("collating neighbours");
            }
        }
    }
    let total: u64 = match &totals {
        Some(t) => t.iter().map(|(_, n)| *n).sum(),
        None => matches.len() as u64,
    };
    let mut rows: Vec<GrepRow> = matches.into_iter().map(to_row).collect();
    let mut summary = None;
    if opts.per_file_cap > 0 {
        let (kept, s) = adapt::select_by_weight(&rows, opts.per_file_cap, opts.max_files, totals.as_deref(), opts.sat2)?;
        rows = kept;
        summary = Some(s);
    }
    if opts.max_matches > 0 && rows.len() > opts.max_matches {
        rows.truncate(opts.max_matches);
    }
    let keep = globs.as_ref().map(|g| move |f: &str| g.matches(f));
    let enriched = adapt::enrich(
        &mut rows,
        &opts.regex,
        &adapt::EnrichOpts {
            agent: opts.agent,
            line_classes: opts.line_classes,
            has_file_summary: summary.is_some(),
            has_file_filter: opts.file_filter.is_some(),
            cwd_scope: opts.cwd_scope,
            sibling_line: opts.sibling_line,
            keep_file: keep.as_ref().map(|k| k as &dyn Fn(&str) -> bool),
        },
        &ctx.graph,
        ctx.root,
        ctx.manifest.published_ms,
    )?;
    let glob_dirs = globs.as_ref().map(|g| g.dirs_matched()).unwrap_or_default();
    Ok(Bare { rows, summary, total, family: enriched.family, sibling: enriched.sibling, glob_dirs })
}

// grep-outside-probe.js
const OUTSIDE_PROBE_EXACT_MAX_CANDIDATES: usize = 800;
const OUTSIDE_PROBE_READ_BUDGET: usize = 512;
const OUTSIDE_PROBE_READ_BUDGET_EMPTY_SCOPE: usize = 2048;
const OUTSIDE_PROBE_BATCH: usize = 64;

pub(crate) struct Probe {
    pub files: Vec<String>,
    pub limit: usize,
    pub complete: bool,
}

/// probeOutsideScope: Ok(None) = run the exact search.
pub(crate) fn probe_outside_scope(ctx: &Ctx, regex: &str, scopes: &[String], globs: &[String], scoped_total: u64, limit: usize) -> R<Option<Probe>> {
    if limit == 0 || scopes.is_empty() {
        return Ok(None);
    }
    let ci = adapt::has_ci_flag(regex);
    let gram = adapt::gram_clauses(regex, ci, &native_literals)?;
    // cappedCandidates
    let capped: Option<(Vec<String>, bool)> = if gram.is_empty() {
        None
    } else {
        let cap = (OUTSIDE_PROBE_EXACT_MAX_CANDIDATES + 1) as u32;
        let mut files: Vec<String> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut over = false;
        let mut ok = true;
        for clause in &gram {
            match ctx.index.query_literals(clause, cap) {
                Some((true, list)) => {
                    if list.len() >= cap as usize {
                        over = true;
                    }
                    for f in list {
                        if seen.insert(f.clone()) {
                            files.push(f);
                        }
                    }
                }
                _ => {
                    ok = false;
                    break;
                }
            }
        }
        if ok {
            let over = over || files.len() > OUTSIDE_PROBE_EXACT_MAX_CANDIDATES;
            Some((files, over))
        } else {
            None
        }
    };
    if let Some((_, false)) = &capped {
        return Ok(None);
    }
    let pool: Vec<String> = match &capped {
        Some((files, _)) => files.clone(),
        None => all_files(ctx)?.to_vec(),
    };
    if pool.len() <= OUTSIDE_PROBE_EXACT_MAX_CANDIDATES {
        return Ok(None);
    }
    let in_scope = adapt::scope_predicate(scopes, ctx.root)?;
    let globs = if globs.is_empty() { None } else { adapt::compile_globs(globs)? };
    let mut source = Vec::new();
    let mut other = Vec::new();
    for file in pool {
        if in_scope.matches(&file) || globs.as_ref().map_or(false, |g| !g.matches(&file)) {
            continue;
        }
        if adapt::is_outside_scope_source_file(&file) {
            source.push(file);
        } else {
            other.push(file);
        }
    }
    let scope_answered = scoped_total != 0;
    let source_len = source.len();
    let ordered: Vec<String> = source.into_iter().chain(other).collect();
    let budget = if scope_answered { OUTSIDE_PROBE_READ_BUDGET } else { OUTSIDE_PROBE_READ_BUDGET_EMPTY_SCOPE };
    let to_read = ordered.len().min(budget);
    let mut found: Vec<String> = Vec::new();
    let mut hits: std::collections::HashMap<String, u64> = Default::default();
    let mut read = 0usize;
    while read < to_read && found.len() < limit {
        if scope_answered && read >= source_len && found.is_empty() {
            break;
        }
        let size = if read == 0 || found.len() as f64 >= limit as f64 / 4.0 { OUTSIDE_PROBE_BATCH } else { OUTSIDE_PROBE_BATCH * 4 };
        let batch = &ordered[read..(read + size).min(to_read)];
        read += batch.len();
        // nativeGrepFull with perFileCap 1, no alias drop (the probe reads the raw result).
        let r = super::engine::grep_files_raw(ctx.root, batch, regex, ci, 1).ok_or("native search failed")?;
        let hit: std::collections::HashSet<&str> = r.iter().map(|(f, _)| f.as_str()).collect();
        for (f, n) in &r {
            hits.insert(f.clone(), *n);
        }
        for file in batch {
            if hit.contains(file.as_str()) && found.len() < limit {
                found.push(file.clone());
            }
        }
    }
    // Source files first, then most hits; the earlier found breaks ties.
    let order: std::collections::HashMap<String, usize> = found.iter().enumerate().map(|(i, f)| (f.clone(), i)).collect();
    let mut found_sorted = found.clone();
    found_sorted.sort_by(|a, b| {
        let sa = adapt::is_outside_scope_source_file(a) as i32;
        let sb = adapt::is_outside_scope_source_file(b) as i32;
        (sb - sa)
            .cmp(&0)
            .then((*hits.get(b).unwrap_or(&1) as i64 - *hits.get(a).unwrap_or(&1) as i64).cmp(&0))
            .then(order[a].cmp(&order[b]))
    });
    let complete = !capped.as_ref().map_or(false, |(_, over)| *over) && read == ordered.len() && found_sorted.len() < limit;
    if scope_answered && !found_sorted.is_empty() && !adapt::is_outside_scope_source_file(&found_sorted[0]) {
        return Ok(Some(Probe { files: Vec::new(), limit, complete }));
    }
    Ok(Some(Probe { files: found_sorted, limit, complete }))
}
