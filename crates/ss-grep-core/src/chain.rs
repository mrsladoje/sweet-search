//! The chained-call boundary line (core/agent-tools/chain.js): a later ss-* call of one shell
//! command opens its output with `# <tool> <start of its first argument>`.
//!
//! Only the pure text is ported; whether a call is a later call of a chain is read from
//! `SWEET_SEARCH_CHAIN_LATER` in the env map (whoever decided wrote it there).

use std::collections::HashMap;

use crate::jsstr::is_js_whitespace;

pub const CHAIN_LATER_ENV: &str = "SWEET_SEARCH_CHAIN_LATER";

const ARG_CHARS: usize = 10;
const READ_NAME_CHARS: usize = 40;

/// AGENT_TOOLS reversed (core/agent-tools/tools.js). Other subcommands are not ported (the JS
/// looks them up on a plain object, where names such as `constructor` hit its prototype).
fn tool_name(subcommand: &str) -> Option<&'static str> {
    Some(match subcommand {
        "agent-search" => "ss-search",
        "grep" => "ss-grep",
        "find" => "ss-find",
        "read" => "ss-read",
        "semantic" => "ss-semantic",
        "trace" => "ss-trace",
        _ => return None,
    })
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// `a.startsWith('-') && a.length > 1`
fn is_flag(a: &str) -> bool {
    a.starts_with('-') && a.len() > 1
}

/// The argument that names the call: the first one that is not a flag or a flag's number.
// Mirrors: core/agent-tools/chain.js:namingArg
fn naming_arg(args: &[String]) -> String {
    for (i, a) in args.iter().enumerate() {
        if is_flag(a) {
            continue;
        }
        if i > 0 && all_digits(a) && args[i - 1].starts_with('-') {
            continue;
        }
        return a.clone();
    }
    String::new()
}

/// The file a read-like call names: the value of --in / --file, else the naming argument.
// Mirrors: core/agent-tools/chain.js:fileArg
fn file_arg(args: &[String]) -> String {
    for (i, a) in args.iter().enumerate() {
        if (a == "--in" || a == "--file") && i + 1 < args.len() {
            return args[i + 1].clone();
        }
        // /^--(?:in|file)=(.+)$/ (`.` stops at line terminators)
        for prefix in ["--in=", "--file="] {
            if let Some(v) = a.strip_prefix(prefix) {
                if !v.is_empty() && !v.chars().any(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')) {
                    return v.to_string();
                }
            }
        }
    }
    naming_arg(args)
}

const TRACE_VALUE_FLAGS: [&str; 7] = ["--in", "--file", "--query", "--hint", "--depth", "--budget", "-k"];
const TRACE_MODE_WORDS: [&str; 3] = ["callers", "callees", "impact"];

/// `w.toLowerCase()` is one of the mode words. Only ASCII letters lower-case to ASCII here
/// (U+212A KELVIN SIGN -> `k` is the one non-ASCII case, and no mode word holds a `k`).
fn is_mode_word(w: &str) -> bool {
    w.is_ascii() && TRACE_MODE_WORDS.contains(&w.to_ascii_lowercase().as_str())
}

/// The first `max` code points plus `…` when longer.
fn cut_chars(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n > max {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    } else {
        s.to_string()
    }
}

// Mirrors: core/agent-tools/chain.js:traceBoundaryArg
fn trace_boundary_arg(args: &[String]) -> String {
    let mut positionals: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if TRACE_VALUE_FLAGS.contains(&a) {
            i += 2;
            continue;
        }
        if is_flag(a) {
            i += 1;
            continue;
        }
        positionals.push(a);
        i += 1;
    }
    let symbol = positionals.first().copied().unwrap_or("");
    let mode = positionals.iter().skip(1).find(|w| is_mode_word(w));
    let name = cut_chars(symbol, READ_NAME_CHARS);
    let mut parts: Vec<&str> = Vec::new();
    if !name.is_empty() {
        parts.push(&name);
    }
    if let Some(m) = mode {
        if !m.is_empty() {
            parts.push(m);
        }
    }
    parts.join(" ")
}

/// `s.replace(/\s+/g, ' ').trim()` (JS `\s` = JS whitespace + line terminators).
fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_ws = false;
    for c in s.chars() {
        if is_js_whitespace(c) {
            if !in_ws {
                out.push(' ');
            }
            in_ws = true;
        } else {
            out.push(c);
            in_ws = false;
        }
    }
    out.trim_matches(' ').to_string()
}

/// `# ss-search Elasticsea…` / `# ss-read timed_queue.rb` / `# ss-trace proceed callers` (no
/// newline). None for a subcommand outside the six agent tools.
// Mirrors: core/agent-tools/chain.js:chainBoundaryLine
pub fn chain_boundary_line(subcommand: &str, args: &[String]) -> Option<String> {
    let tool = tool_name(subcommand)?;
    if subcommand == "trace" {
        let arg = trace_boundary_arg(args);
        return Some(if arg.is_empty() { format!("# {tool}") } else { format!("# {tool} {arg}") });
    }
    let is_read = subcommand == "read" || subcommand == "semantic";
    let mut arg = collapse_ws(&if is_read { file_arg(args) } else { naming_arg(args) });
    if arg.is_empty() {
        return Some(format!("# {tool}"));
    }
    if is_read {
        let last = arg.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
        if !last.is_empty() {
            arg = last;
        }
    }
    let max = if is_read { READ_NAME_CHARS } else { ARG_CHARS };
    Some(format!("# {tool} {}", cut_chars(&arg, max)))
}

/// The boundary line + newline for a later call of a chain, else ''. None = not ported (a
/// subcommand outside the six agent tools on a later call).
// Mirrors: core/agent-tools/chain.js:chainBoundary
pub fn chain_boundary(subcommand: &str, args: &[String], env: &HashMap<String, String>) -> Option<String> {
    if env.get(CHAIN_LATER_ENV).map(String::as_str) == Some("1") {
        Some(format!("{}\n", chain_boundary_line(subcommand, args)?))
    } else {
        Some(String::new())
    }
}
