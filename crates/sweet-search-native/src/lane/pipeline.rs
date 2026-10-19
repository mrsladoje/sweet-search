//! cmdGrep (eval/agent-read-workflows/bin/_ss-helpers.mjs) for the lane, with the product
//! defaults every declined switch leaves in place: Bundle A on (grep retry, weighted
//! allocation, full hit lines, line classes and spread, the guarantee rule, sat2 weights),
//! grepOrder off. Output lines are assembled exactly as the JS writes them to stdout.

use super::adapt::{self, BodyRow, ListingCtx, R};
use super::baregrep::{self, Ctx, GrepOptions};
use super::gate::Call;
use ss_grep_core::jsstr::len16;
use std::path::Path;

const OUTSIDE_SCOPE_MAX_FILES: usize = 20;

pub(crate) struct Answer {
    pub stdout: String,
    /// recordAgentToolCall's query/regex: Some(regex) unless -F (then the receipt has neither).
    pub receipt_regex: Option<String>,
}

/// typedFiles: the --in scopes that are files.
fn typed_files(in_paths: &[String], file_root: &str) -> Vec<String> {
    in_paths
        .iter()
        .filter(|p| !p.is_empty() && std::fs::metadata(Path::new(file_root).join(p)).map_or(false, |m| m.is_file()))
        .cloned()
        .collect()
}

/// missingScopes.
fn missing_scopes(in_paths: &[String], file_root: &str) -> bool {
    in_paths.iter().any(|p| {
        !p.is_empty() && {
            let abs = if p.starts_with('/') { std::path::PathBuf::from(p) } else { Path::new(file_root).join(p) };
            !abs.exists()
        }
    })
}

/// globDirNote.
fn glob_dir_note(dirs: &[String]) -> Option<String> {
    if dirs.is_empty() {
        return None;
    }
    let shown = dirs.iter().take(3).map(|d| format!("{d}/")).collect::<Vec<_>>().join(", ");
    let more = if dirs.len() > 3 { format!(" +{} more", dirs.len() - 3) } else { String::new() };
    let word = if dirs.len() == 1 { "directory" } else { "directories" };
    Some(format!("# -g also matched {word} {shown}{more} — searched the files below"))
}

pub(crate) fn grep(call: &Call, file_root: &str, ctx: &mut Ctx) -> R<Answer> {
    let mut out = String::new();
    // runAgentTool: a later call of a chained command opens with its boundary line.
    if call.env("SWEET_SEARCH_CHAIN_LATER") == Some("1") {
        out.push_str(&adapt::chain_boundary(&call.args)?);
    }
    let a = adapt::parse_args(&call.args, &call.cwd, file_root)?;
    if a.regex.is_empty() {
        return Err("usage");
    }
    if a.files_with_matches || a.count || a.only_matching {
        out.push_str(&output_mode(call, &a, file_root, ctx)?);
        return Ok(Answer { stdout: out.replace('\u{FEFF}', ""), receipt_regex: (!a.fixed).then(|| a.regex.clone()) });
    }
    let with_context = a.before > 0 || a.after > 0;
    let typed = typed_files(&a.in_paths, file_root);
    let missing = missing_scopes(&a.in_paths, file_root);
    let dir_scoped = !a.in_paths.is_empty() && !missing && typed.len() < a.in_paths.len();
    let receipt_regex = if a.fixed { None } else { Some(a.regex.clone()) };

    if !a.in_paths.is_empty() && !dir_scoped {
        // Scoped: flat output, depth up to k across the named scopes.
        if missing {
            return Err("missing scope");
        }
        let bare = baregrep::bare_grep(ctx, &GrepOptions {
            regex: a.regex.clone(),
            max_matches: a.k,
            per_file_cap: 0,
            max_files: 0,
            sat2: false,
            line_classes: false,
            agent: !a.fixed,
            sibling_line: true,
            file_filter: Some(a.in_paths.clone()),
            cwd_scope: false,
            path_globs: a.globs.clone(),
        })?;
        let total = bare.total;
        let hit_max = adapt::grep_broad_hit_max(total);
        let mut shown: Vec<BodyRow> = Vec::with_capacity(bare.rows.len());
        for r in &bare.rows {
            shown.push(BodyRow { file: r.file.clone(), line: r.line, text: adapt::grep_hit_text(r, hit_max)?, more: 0 });
        }
        let listing = adapt::render_listing(&shown, &ListingCtx {
            before: a.before,
            after: a.after,
            context_root: with_context.then_some(file_root),
            match_rows: &bare.rows,
            typed: &typed,
        })?;
        for l in listing {
            out.push_str(&l);
            out.push('\n');
        }
        if let Some(note) = glob_dir_note(&bare.glob_dirs) {
            out.push_str(&note);
            out.push('\n');
        }
        if let Some(h) = adapt::interface_hint(total, &shown, &ctx.graph, ctx.root)? {
            out.push_str(&h);
        }
        let cut = total as i64 - bare.rows.len() as i64;
        if cut > 0 {
            out.push_str(&format!("# +{cut} more {} (raise -k)\n", if cut == 1 { "hit" } else { "hits" }));
        }
        // File scopes only (typedFiles(inPaths).length === inPaths.length here).
        if typed.len() == a.in_paths.len() {
            if let Some(line) = outside_scope_line(ctx, &a.regex, total, &a.in_paths, &a.globs)? {
                out.push_str(&line);
                out.push('\n');
            }
        }
        return Ok(Answer { stdout: out.replace('\u{FEFF}', ""), receipt_regex });
    }

    // Unscoped (or a directory scope): the weighted listing.
    let cwd_scope = adapt::cwd_grep_scope(&call.cwd, file_root, file_root)?;
    let (file_filter, is_cwd_scope) = if dir_scoped {
        (Some(a.in_paths.clone()), false)
    } else if let Some(s) = cwd_scope {
        (Some(vec![s]), true)
    } else {
        (None, false)
    };
    let bare = baregrep::bare_grep(ctx, &GrepOptions {
        regex: a.regex.clone(),
        max_matches: 0,
        per_file_cap: a.k.min(100) as u32,
        max_files: a.k,
        sat2: true,
        line_classes: true,
        agent: !a.fixed,
        sibling_line: true,
        file_filter,
        cwd_scope: is_cwd_scope,
        path_globs: a.globs.clone(),
    })?;
    let total = bare.total;
    let summary = bare.summary.clone().unwrap_or_default();
    let hit_max = adapt::grep_broad_hit_max(total);
    let body = adapt::render_body(&bare.rows, &summary, a.k, hit_max)?;
    let listing = adapt::render_listing(&body.rows, &ListingCtx {
        before: a.before,
        after: a.after,
        context_root: with_context.then_some(file_root),
        match_rows: &bare.rows,
        typed: &typed,
    })?;
    for l in listing {
        out.push_str(&l);
        out.push('\n');
    }
    if let Some(f) = &bare.family {
        out.push_str(f);
        out.push('\n');
    }
    if let Some(s) = adapt::grep_sibling_line(bare.sibling.as_ref(), &body.rows, a.before, a.after) {
        out.push_str(&s);
        out.push('\n');
    }
    if let Some(note) = glob_dir_note(&bare.glob_dirs) {
        out.push_str(&note);
        out.push('\n');
    }
    if let Some(h) = adapt::interface_hint(total, &body.rows, &ctx.graph, ctx.root)? {
        out.push_str(&h);
    }
    let hidden_files = adapt::render_hidden_files(body.hidden.as_ref());
    if let Some(h) = &hidden_files {
        out.push_str(h);
        out.push('\n');
    }
    if body.truncated_file_count > 0 || hidden_files.is_some() {
        out.push_str(adapt::GREP_HIDDEN_HINT);
        out.push('\n');
    }
    if body.shown_matches == 0 {
        return Err("zero shown");
    }
    Ok(Answer { stdout: out.replace('\u{FEFF}', ""), receipt_regex })
}

// -l and -c list at most this many files from the engine before the k cut (all of them).
const GREP_FILE_MODE_MAX_FILES: usize = 100_000;

/// grep's output modes: -l (files, selector order), -c (path:count, path order), -o (every match
/// on the first k hit lines, path order). No context, no enrichment.
// Mirrors: eval/agent-read-workflows/bin/_ss-helpers.mjs:cmdGrep (the -l / -c / -o block)
fn output_mode(call: &Call, a: &adapt::Args, file_root: &str, ctx: &mut Ctx) -> R<String> {
    if missing_scopes(&a.in_paths, file_root) {
        return Err("missing scope");
    }
    let (file_filter, is_cwd_scope) = if !a.in_paths.is_empty() {
        (Some(a.in_paths.clone()), false)
    } else {
        match adapt::cwd_grep_scope(&call.cwd, file_root, file_root)? {
            Some(s) => (Some(vec![s]), true),
            None => (None, false),
        }
    };
    let file_mode = a.files_with_matches || a.count;
    let bare = baregrep::bare_grep(ctx, &GrepOptions {
        regex: a.regex.clone(),
        max_matches: if file_mode { 0 } else { a.k },
        per_file_cap: if file_mode { 1 } else { 0 },
        max_files: if file_mode { GREP_FILE_MODE_MAX_FILES } else { 0 },
        sat2: file_mode,
        line_classes: false,
        agent: false,
        sibling_line: false,
        file_filter,
        cwd_scope: is_cwd_scope,
        path_globs: a.globs.clone(),
    })?;
    let lines = if file_mode {
        let summary = bare.summary.ok_or("no file summary")?;
        let file_count = summary.files.len() + summary.hidden_file_count as usize;
        if a.files_with_matches {
            ss_grep_core::render::render_grep_file_list(&summary.files, a.k, file_count)
        } else {
            // [...files].sort((a, b) => a.file.localeCompare(b.file)) (stable, as V8's sort)
            let mut files = summary.files.clone();
            let mut failed = false;
            files.sort_by(|x, y| {
                adapt::locale_compare(&x.file, &y.file).unwrap_or_else(|| {
                    failed = true;
                    std::cmp::Ordering::Equal
                })
            });
            if failed {
                return Err("collation");
            }
            ss_grep_core::render::render_grep_file_counts(&files, a.k, file_count)
        }
    } else {
        // grepOnlyMatchingTexts: the addon's grepOnlyMatching on each hit line.
        let re = crate::native_grep::build_regex(&a.regex, adapt::has_ci_flag(&a.regex)).map_err(|_| "regex")?;
        let rows: Vec<(String, u32, Vec<String>)> =
            bare.rows.iter().map(|r| (r.file.clone(), r.line, crate::native_grep::only_matching(&re, &r.content))).collect();
        let mut lines = ss_grep_core::render::render_grep_only_matching(&rows, &typed_files(&a.in_paths, file_root));
        let cut = bare.total as i64 - bare.rows.len() as i64;
        if cut > 0 {
            lines.push(format!("# +{cut} more {} (raise -k)", if cut == 1 { "hit" } else { "hits" }));
        }
        lines
    };
    let mut out = String::new();
    for l in lines {
        out.push_str(&l);
        out.push('\n');
    }
    Ok(out)
}

/// outsideScopeLine: the probe, else the exact unscoped search (files by weight, one hit kept
/// per file). Any error is no line (the JS catches and prints nothing).
fn outside_scope_line(ctx: &mut Ctx, regex: &str, scoped_total: u64, scopes: &[String], globs: &[String]) -> R<Option<String>> {
    if let Some(p) = baregrep::probe_outside_scope(ctx, regex, scopes, globs, scoped_total, OUTSIDE_SCOPE_MAX_FILES)? {
        return adapt::render_outside_scope_probe_line(&p.files, p.limit, p.complete, scoped_total, scopes);
    }
    let bare = baregrep::bare_grep(ctx, &GrepOptions {
        regex: regex.to_string(),
        max_matches: 0,
        per_file_cap: 1,
        max_files: OUTSIDE_SCOPE_MAX_FILES,
        sat2: false,
        line_classes: false,
        agent: false,
        sibling_line: false,
        file_filter: None,
        cwd_scope: false,
        path_globs: globs.to_vec(),
    })?;
    let summary = bare.summary.unwrap_or_default();
    adapt::render_outside_scope_line(&summary.files, summary.hidden_file_count, bare.total as i64 - scoped_total as i64, scoped_total, scopes)
}

/// buildAgentSpanRequestPayload's query bound.
pub(crate) fn bounded(q: &str) -> Option<String> {
    (len16(q) <= 2000).then(|| q.to_string())
}
