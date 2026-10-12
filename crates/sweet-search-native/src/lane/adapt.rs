//! The lane's calls into ss-grep-core (the JS ports), behind the signatures the lane's
//! orchestration uses. Every function returns Err(reason) for an input its port does not
//! cover: the call is then declined and the JS tool answers it.

use super::graph_impl::LaneGraph;
use ss_grep_core::enrich::{self, CodeGraph, Hit, SiblingLine, SourceText};
use ss_grep_core::shaping::{self, AllocRule, BodyOpts, DiversityOpts};
use ss_grep_core::types::{FileSummary, GrepRow, SummaryFile};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

pub(crate) use ss_grep_core::shaping::{BodyRow, GrepBody as Body, Hidden};

pub(crate) type R<T> = Result<T, &'static str>;

// ---- args, paths, globs, collation, chain ----

/// The real file system, as core/infrastructure/call-fs.js answers it.
pub(crate) struct Fs;
impl ss_grep_core::paths::PathProbe for Fs {
    fn exists(&self, abs: &str) -> bool {
        !abs.contains('\0') && std::path::Path::new(abs).exists()
    }
    fn realpath(&self, abs: &str) -> Option<String> {
        std::fs::canonicalize(abs).ok().map(|p| p.to_string_lossy().into_owned())
    }
    fn is_file(&self, abs: &str) -> bool {
        std::fs::metadata(abs).map_or(false, |m| m.is_file())
    }
}

/// _ss-argparse.mjs + the start of cmdGrep.
#[derive(Clone, Debug, Default)]
pub(crate) struct Args {
    pub fixed: bool,
    pub k: usize,
    pub before: usize,
    pub after: usize,
    pub in_paths: Vec<String>,
    pub globs: Vec<String>,
    pub regex: String,
}

pub(crate) fn parse_args(args: &[String], cwd: &str, file_root: &str) -> R<Args> {
    let a = ss_grep_core::args::parse_grep_args(args, &Fs, cwd, file_root).map_err(|d| d.0)?;
    Ok(Args {
        fixed: a.fixed_string,
        k: a.k as usize,
        before: a.before as usize,
        after: a.after as usize,
        in_paths: a.in_paths,
        globs: a.globs,
        regex: a.regex,
    })
}

/// cwd-paths.js cwdGrepScope.
pub(crate) fn cwd_grep_scope(cwd: &str, file_root: &str, index_root: &str) -> R<Option<String>> {
    Ok(ss_grep_core::paths::cwd_grep_scope(cwd, file_root, index_root, &Fs))
}

/// grep-output-shaping.js grepFileFilterPredicate.
pub(crate) struct ScopePred(ss_grep_core::paths::GrepFileFilter);
impl ScopePred {
    pub fn matches(&self, file: &str) -> bool {
        self.0.matches(file)
    }
}
pub(crate) fn scope_predicate(filters: &[String], root: &str) -> R<ScopePred> {
    ss_grep_core::paths::grep_file_filter_predicate(filters, Some(root), &Fs).map(ScopePred).map_err(|d| d.0)
}

/// grep-path-globs.js compilePathGlobs (None = no globs).
pub(crate) struct Globs(ss_grep_core::globs::CompiledGlobs);
impl Globs {
    pub fn matches(&self, file: &str) -> bool {
        self.0.matches(file)
    }
    /// `[...pathGlobs.dirsMatched].sort()`: UTF-16 code unit order.
    pub fn dirs_matched(&self) -> Vec<String> {
        let mut d = self.0.dirs_matched();
        d.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        d
    }
}
pub(crate) fn compile_globs(globs: &[String]) -> R<Option<Globs>> {
    ss_grep_core::globs::compile_path_globs(globs).map(|g| g.map(Globs)).map_err(|d| d.0)
}

/// localeCompare (None: a pair the port cannot order exactly as ICU does).
pub(crate) fn locale_compare(a: &str, b: &str) -> Option<Ordering> {
    ss_grep_core::collate::locale_compare(a, b)
}

/// search-pattern-prefilter.js hasCaseInsensitiveRegexFlag.
pub(crate) fn has_ci_flag(regex: &str) -> bool {
    ss_grep_core::args::has_case_insensitive_regex_flag(regex)
}

/// extractLiteralClauses(regex) then prefilterLiteralClauses(...).gram.
pub(crate) fn gram_clauses(regex: &str, ci: bool, native: &dyn Fn(&str) -> Option<Vec<Vec<String>>>) -> R<Vec<Vec<String>>> {
    ss_grep_core::literals::gram_clauses(regex, ci, native).map_err(|d| d.0)
}

/// chain.js chainBoundary(subcommand 'grep', args) for a later call.
pub(crate) fn chain_boundary(args: &[String]) -> R<String> {
    let mut env = HashMap::new();
    env.insert("SWEET_SEARCH_CHAIN_LATER".to_string(), "1".to_string());
    ss_grep_core::chain::chain_boundary("grep", args, &env).ok_or("chain")
}

// ---- shaping / render (grep-output-shaping.js, agent-output-fixes.js) ----

/// applyGrepFileDiversity(matches, { perFileCap, maxFiles, totals, order: 'weight', weight }).
pub(crate) fn select_by_weight(matches: &[GrepRow], per_file_cap: u32, max_files: usize, totals: Option<&[(String, u64)]>, sat2: bool) -> R<(Vec<GrepRow>, FileSummary)> {
    let totals: Option<HashMap<String, u64>> = totals.map(|t| t.iter().cloned().collect());
    let d = shaping::apply_grep_file_diversity(matches, &DiversityOpts {
        per_file_cap: per_file_cap as i64,
        max_files: max_files as i64,
        hidden_sample_size: None,
        order_weight: true,
        weight_sat2: sat2,
        totals: totals.as_ref(),
    })
    .ok_or("diversity")?;
    Ok((d.kept.iter().map(|&i| matches[i].clone()).collect(), d.file_summary))
}

pub(crate) fn grep_broad_hit_max(total: u64) -> Option<usize> {
    ss_grep_core::render::grep_broad_hit_max(total)
}

/// grepHitText(row, { fullLine: true, max }).
pub(crate) fn grep_hit_text(row: &GrepRow, hit_max: Option<usize>) -> R<String> {
    Ok(ss_grep_core::render::grep_hit_text(row, true, hit_max))
}

/// renderGrepBody(kept, fileSummary, k, {alloc weight, sat2, guarantee, lineClasses, lineSpread, fullLine, hitMax}).
pub(crate) fn render_body(kept: &[GrepRow], summary: &FileSummary, k: usize, hit_max: Option<usize>) -> R<Body> {
    shaping::render_grep_body(kept, summary, k as i64, &BodyOpts {
        alloc_weight: true,
        weight_sat2: true,
        rule: Some(AllocRule::Guarantee),
        line_classes: true,
        line_spread: true,
        full_line: true,
        drop_repeated_text: false,
        hit_max,
    })
    .ok_or("body")
}

pub(crate) struct ListingCtx<'a> {
    pub before: usize,
    pub after: usize,
    /// The project file root -A/-B/-C read lines from (None: no context).
    pub context_root: Option<&'a str>,
    /// Per file, every fetched hit line.
    pub match_rows: &'a [GrepRow],
    pub typed: &'a [String],
}

/// grepContextLineReader: a file's lines as readFileSync(...).split('\n'), a last '' dropped.
fn read_lines(file_root: &str, file: &str) -> Option<Vec<String>> {
    let abs = if file.starts_with('/') { std::path::PathBuf::from(file) } else { std::path::Path::new(file_root).join(file) };
    let bytes = std::fs::read(abs).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<String> = text.split('\n').map(str::to_string).collect();
    if lines.last().map_or(false, |l| l.is_empty()) {
        lines.pop();
    }
    Some(lines)
}

pub(crate) fn render_listing(rows: &[BodyRow], ctx: &ListingCtx) -> R<Vec<String>> {
    let mut cache: HashMap<String, Option<Arc<Vec<String>>>> = HashMap::new();
    let match_lines: Option<HashMap<String, HashSet<u32>>> = ctx.context_root.map(|_| {
        let mut m: HashMap<String, HashSet<u32>> = HashMap::new();
        for r in ctx.match_rows {
            m.entry(r.file.clone()).or_default().insert(r.line);
        }
        m
    });
    let mut get = |file: &str| -> Option<Arc<Vec<String>>> {
        let root = ctx.context_root?;
        cache.entry(file.to_string()).or_insert_with(|| read_lines(root, file).map(Arc::new)).clone()
    };
    let opts = ss_grep_core::render::ListingOpts {
        before: ctx.before as i64,
        after: ctx.after as i64,
        get_lines: if ctx.context_root.is_some() { Some(&mut get) } else { None },
        match_lines: match_lines.as_ref(),
        drop_text: false,
        typed: ctx.typed,
    };
    Ok(ss_grep_core::render::render_grep_listing(rows, opts))
}

pub(crate) fn render_hidden_files(hidden: Option<&Hidden>) -> Option<String> {
    ss_grep_core::render::render_grep_hidden_files(hidden)
}

pub(crate) const GREP_HIDDEN_HINT: &str = ss_grep_core::render::GREP_HIDDEN_HINT;

pub(crate) fn is_outside_scope_source_file(file: &str) -> bool {
    ss_grep_core::render::is_outside_scope_source_file(file, None)
}

/// OUTSIDE_SCOPE_NAMED_MAX: the files the outside-scope lines name.
const OUTSIDE_NAMED_MAX: usize = 3;

pub(crate) fn render_outside_scope_probe_line(files: &[String], limit: usize, complete: bool, scoped_total: u64, scopes: &[String]) -> R<Option<String>> {
    Ok(ss_grep_core::render::render_outside_scope_probe_line(files, limit as i64, complete, scoped_total as i64, scopes, OUTSIDE_NAMED_MAX))
}

pub(crate) fn render_outside_scope_line(files: &[SummaryFile], hidden_files: u64, outside_total: i64, scoped_total: u64, scopes: &[String]) -> R<Option<String>> {
    Ok(ss_grep_core::render::render_outside_scope_line(files, hidden_files as i64, outside_total, scoped_total as i64, scopes, OUTSIDE_NAMED_MAX))
}

// ---- enrichment (grep-line-classes.js, agent-pack-completion.js, search-read.js) ----

pub(crate) type Graph<'a> = LaneGraph<'a>;

/// File text as the JS reads it (readFileRange under the project root; search-read.js's
/// readFileSync(path.join(root, file))).
pub(crate) struct Source<'a> {
    pub root: &'a str,
}
impl SourceText for Source<'_> {
    fn read_file_range(&self, file: &str, start_line: i64, end_line: i64) -> Option<String> {
        let abs = enrich::read_file_range_path(self.root, file)?;
        let bytes = std::fs::read(abs).ok()?;
        Some(enrich::js_line_range(&String::from_utf8_lossy(&bytes), start_line, end_line))
    }
    fn read_file_utf8(&self, file: &str) -> Option<String> {
        let bytes = std::fs::read(std::path::Path::new(self.root).join(file)).ok()?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }
}

pub(crate) struct Enriched {
    pub family: Option<String>,
    pub sibling: Option<SiblingLine>,
}

pub(crate) struct EnrichOpts<'a> {
    pub agent: bool,
    pub line_classes: bool,
    pub has_file_summary: bool,
    pub has_file_filter: bool,
    pub cwd_scope: bool,
    pub sibling_line: bool,
    pub keep_file: Option<&'a dyn Fn(&str) -> bool>,
}

/// bareGrep's line classes, family manifest and sibling line.
pub(crate) fn enrich(rows: &mut [GrepRow], regex: &str, o: &EnrichOpts, graph: &Graph, root: &str, published_ms: Option<f64>) -> R<Enriched> {
    let mut is_fresh = |file: &str| -> bool {
        use std::os::unix::fs::MetadataExt;
        let mtime = std::fs::metadata(std::path::Path::new(root).join(file)).ok().map(|m| enrich::node_mtime_ms(m.mtime(), m.mtime_nsec()));
        let f = enrich::index_freshness(published_ms, mtime);
        f.known && !f.stale
    };
    let e = enrich::bare_grep_enrich(
        rows,
        regex,
        &enrich::BareGrepEnrichOptions {
            is_agent_format: o.agent,
            grep_line_classes: o.line_classes,
            has_file_summary: o.has_file_summary,
            has_file_filter: o.has_file_filter,
            cwd_scope: o.cwd_scope,
            sibling_line_off: !o.sibling_line,
            keep_file: o.keep_file,
        },
        Some(graph as &dyn CodeGraph),
        &Source { root },
        &mut is_fresh,
    )
    .map_err(|d| d.0)?;
    Ok(Enriched {
        family: e.family_manifest.map(|f| f.rendered).filter(|r| !r.is_empty()),
        sibling: e.sibling_line,
    })
}

/// _ss-helpers.mjs grepSiblingLine.
pub(crate) fn grep_sibling_line(sibling: Option<&SiblingLine>, rows: &[BodyRow], before: usize, after: usize) -> Option<String> {
    let lines: Vec<i64> = rows.iter().map(|r| r.line as i64).collect();
    enrich::grep_sibling_line(sibling, &lines, before as i64, after as i64)
}

/// writeGrepInterfaceHint(total, rows): the bytes it writes (with the newline), or None.
pub(crate) fn interface_hint(total: u64, rows: &[BodyRow], graph: &Graph, root: &str) -> R<Option<String>> {
    let hits: Vec<Hit> = rows.iter().map(|r| Hit { file: r.file.clone(), line: r.line as i64 }).collect();
    enrich::grep_interface_hint(total as i64, &hits, Some(graph as &dyn CodeGraph), &Source { root }).map_err(|d| d.0)
}
