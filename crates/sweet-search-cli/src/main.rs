// sweet-search CLI — native launcher (~2-5ms warm path)
//
// Port of ss-fast/ss-fast.c. Connects to the warm server via Unix socket.
// Auto-starts the Node server on cold start (matching ss.sh behavior).
//
// Compile: cargo build --release

use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{self, Command, Stdio};
use std::thread;
use std::time::Duration;

const BUFFER_SIZE: usize = 16384;

/// FNV-1a 64-bit of a string's UTF-8 bytes → 16 lowercase hex chars.
/// MUST match core/search/server-identity.js::fnv1a64Hex so the native CLI and
/// the JS server derive the SAME per-project socket (C3 isolation).
fn fnv1a64_hex(s: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325; // FNV offset basis
    for byte in s.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3); // FNV prime
    }
    format!("{hash:016x}")
}

/// Pure socket derivation: an explicit override wins; otherwise a per-project
/// hashed path. Kept side-effect-free for unit tests.
fn derive_socket(explicit_override: Option<&str>, project_root: &str) -> String {
    match explicit_override {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => format!("/tmp/sweet-search-{}.sock", fnv1a64_hex(project_root)),
    }
}

/// Canonicalise a path (resolve symlinks, e.g. macOS /tmp → /private/tmp).
/// Falls back to a lexical absolute path when the path does not exist yet.
fn canonicalize_path(p: &Path) -> PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| {
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            env::current_dir()
                .map(|c| c.join(p))
                .unwrap_or_else(|_| p.to_path_buf())
        }
    })
}

/// Canonical project root: nearest ancestor of cwd (or $SWEET_SEARCH_PROJECT_ROOT)
/// holding a `.sweet-search/` state dir, else the canonical base. Mirrors
/// core/search/server-identity.js::resolveProjectRoot.
fn resolve_project_root() -> PathBuf {
    let base = match env::var("SWEET_SEARCH_PROJECT_ROOT") {
        Ok(v) if !v.is_empty() => canonicalize_path(Path::new(&v)),
        _ => canonicalize_path(&env::current_dir().unwrap_or_else(|_| PathBuf::from("."))),
    };
    let mut dir = base.clone();
    loop {
        if dir.join(".sweet-search").exists() {
            return dir;
        }
        match dir.parent() {
            Some(parent) if parent != dir => dir = parent.to_path_buf(),
            _ => break,
        }
    }
    base
}

/// Per-project socket path (or the explicit $SWEET_SEARCH_SOCKET_PATH override).
/// No legacy `/tmp/search.sock` fallback — that was the C3 cross-project leak.
fn socket_path() -> String {
    let ovr = env::var("SWEET_SEARCH_SOCKET_PATH").ok();
    derive_socket(ovr.as_deref(), &resolve_project_root().to_string_lossy())
}

// ANSI color codes (matching ss-fast.c)
const D1: &str = "\x1b[48;5;17m";
const D2: &str = "\x1b[48;5;24m";
const FA: &str = "\x1b[1;38;5;104m";
const FW: &str = "\x1b[1;38;5;231m";
const FG: &str = "\x1b[38;5;114m";
const FY: &str = "\x1b[38;5;220m";
const R: &str = "\x1b[0m";

// Pixel art header
const L1: &str = "█▀▀ █ █ █ █▀▀ █▀▀ ▀█▀  █▀▀ █▀▀ ▄▀▄ █▀▄ █▀▀ █▄█";
const L2: &str = "▄▄█ ▀▄█▄▀ ██▄ ██▄  █   ▄▄█ ██▄ █▀█ ██▄ █▄▄ █▀█";

/// ANSI palette that collapses to empty strings when color is disabled, so the
/// same format strings render either colored or plain.
struct Ansi {
    d1: &'static str,
    d2: &'static str,
    fa: &'static str,
    fw: &'static str,
    fg: &'static str,
    fy: &'static str,
    r: &'static str,
}

const ANSI_ON: Ansi = Ansi {
    d1: D1,
    d2: D2,
    fa: FA,
    fw: FW,
    fg: FG,
    fy: FY,
    r: R,
};
const ANSI_OFF: Ansi = Ansi {
    d1: "",
    d2: "",
    fa: "",
    fw: "",
    fg: "",
    fy: "",
    r: "",
};

fn ansi(color: bool) -> &'static Ansi {
    if color {
        &ANSI_ON
    } else {
        &ANSI_OFF
    }
}

// =============================================================================
// Output-decoration policy (mirror of core/search/output-policy.js)
//
// Decorate whenever it is free; never decorate when doing so would add captured
// output tokens. Decoration is NEVER routed to stderr.
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecorationMode {
    Auto,
    Always,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DecorationStream {
    Stdout,
    Tty,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputMode {
    HumanTerminal,
    ClaudeTtySidechannel,
    CapturedPlain,
    MachineReadable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AgentEnv {
    codex: bool,
    claude_code: bool,
    other_agent: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OutputPolicy {
    mode: OutputMode,
    decoration_stream: DecorationStream,
    color_enabled: bool,
    banner_enabled: bool,
    machine_readable: bool,
    agent_format: bool,
    reason: &'static str,
}

/// A non-empty value that is not a recognized "false" token is truthy.
fn env_truthy(v: &str) -> bool {
    let s = v.trim().to_ascii_lowercase();
    !s.is_empty() && s != "0" && s != "false" && s != "off" && s != "no"
}

/// Classify the harness from environment variables. `get` resolves a single key;
/// `all_keys` is the full set of variable names (for prefix detection). Pure so
/// it can be unit-tested without touching the real process environment.
fn detect_agent_env(get: &dyn Fn(&str) -> Option<String>, all_keys: &[String]) -> AgentEnv {
    let codex = all_keys.iter().any(|k| k.starts_with("CODEX_"));
    let claude_code = get("CLAUDECODE").map(|v| env_truthy(&v)).unwrap_or(false)
        || get("CLAUDE_CODE").map(|v| env_truthy(&v)).unwrap_or(false);
    let other_agent = ["CURSOR_TRACE_ID", "CLINE_ACTIVE", "GEMINI_CLI", "OPENCODE"]
        .iter()
        .any(|k| get(k).map(|v| env_truthy(&v)).unwrap_or(false))
        || all_keys.iter().any(|k| k.starts_with("CURSOR_"));
    AgentEnv {
        codex,
        claude_code,
        other_agent,
    }
}

fn has_no_color(get: &dyn Fn(&str) -> Option<String>) -> bool {
    get("NO_COLOR").map(|v| !v.is_empty()).unwrap_or(false)
}

fn decoration_mode(get: &dyn Fn(&str) -> Option<String>) -> DecorationMode {
    match get("SWEET_SEARCH_DECORATION")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "always" => DecorationMode::Always,
        "never" => DecorationMode::Never,
        _ => DecorationMode::Auto,
    }
}

/// Pure policy decision. `tty_available` is the result of probing /dev/tty and is
/// only consulted for the Claude Code side-channel (Tier 2).
#[allow(clippy::too_many_arguments)]
fn detect_output_policy(
    json: bool,
    plain: bool,
    no_banner: bool,
    no_color: bool,
    is_tty: bool,
    agent: AgentEnv,
    decoration: DecorationMode,
    tty_available: bool,
) -> OutputPolicy {
    let mut p = OutputPolicy {
        mode: OutputMode::CapturedPlain,
        decoration_stream: DecorationStream::None,
        color_enabled: false,
        banner_enabled: false,
        machine_readable: false,
        agent_format: !json && !plain && (agent.codex || agent.claude_code || agent.other_agent),
        reason: "captured-plain",
    };

    // Tier 4: machine-readable wins outright (even over DECORATION=always).
    if json {
        p.mode = OutputMode::MachineReadable;
        p.machine_readable = true;
        p.reason = "json";
        return p;
    }

    match decoration {
        DecorationMode::Never => {
            p.reason = "decoration-never";
        }
        DecorationMode::Always => {
            p.mode = OutputMode::HumanTerminal;
            p.decoration_stream = DecorationStream::Stdout;
            p.banner_enabled = true;
            p.color_enabled = true;
            p.reason = "decoration-always";
        }
        DecorationMode::Auto => {
            let suppress = agent.codex || agent.other_agent;
            if is_tty && !suppress {
                p.mode = OutputMode::HumanTerminal;
                p.decoration_stream = DecorationStream::Stdout;
                p.banner_enabled = true;
                p.color_enabled = true;
                p.reason = "human-terminal";
            } else if !is_tty && !suppress && agent.claude_code {
                // Claude Code positively detected: the controlling terminal is
                // reachable via /dev/tty without entering captured stdout.
                if tty_available {
                    p.mode = OutputMode::ClaudeTtySidechannel;
                    p.decoration_stream = DecorationStream::Tty;
                    p.banner_enabled = true;
                    p.color_enabled = true;
                    p.reason = "claude-code-tty";
                } else {
                    p.reason = "claude-no-tty";
                }
            } else if agent.codex {
                p.reason = "codex-detected";
            } else if agent.other_agent {
                p.reason = "agent-detected";
            } else if is_tty {
                p.reason = "captured-plain";
            } else {
                p.reason = "captured-no-claude";
            }
        }
    }

    // Tier 4: explicit opt-outs only ever reduce decoration.
    if no_color {
        p.color_enabled = false;
    }
    if no_banner {
        p.banner_enabled = false;
    }
    if plain {
        p.banner_enabled = false;
        p.color_enabled = false;
    }

    p
}

/// Build a policy from the real process environment + stdout TTY state.
fn resolve_output_policy(json: bool, plain: bool, no_banner: bool) -> OutputPolicy {
    use std::io::IsTerminal;
    let get = |k: &str| env::var(k).ok();
    let all_keys: Vec<String> = env::vars().map(|(k, _)| k).collect();
    let agent = detect_agent_env(&get, &all_keys);
    let no_color = has_no_color(&get);
    let mode = decoration_mode(&get);
    let is_tty = std::io::stdout().is_terminal();
    // Only probe /dev/tty when Claude Code is detected and stdout is captured —
    // the only case the side-channel is consulted. Best-effort; never fatal.
    let tty_available = if !is_tty && agent.claude_code && mode == DecorationMode::Auto {
        probe_tty()
    } else {
        false
    };
    detect_output_policy(
        json,
        plain,
        no_banner,
        no_color,
        is_tty,
        agent,
        mode,
        tty_available,
    )
}

/// Best-effort probe: can we open the controlling terminal for writing? No bytes
/// are emitted. Any error means unavailable.
fn probe_tty() -> bool {
    fs::OpenOptions::new().write(true).open("/dev/tty").is_ok()
}

/// Whether incidental stdout/stderr text (usage, status, errors) may use color:
/// only when decoration would go to stdout (a real terminal / DECORATION=always)
/// and NO_COLOR is not set. Captured pipes and side-channels stay plain.
fn incidental_color() -> bool {
    let p = resolve_output_policy(false, false, false);
    p.color_enabled && p.decoration_stream == DecorationStream::Stdout
}

/// Whether the usage/help banner art may be shown: only when a banner would go
/// to stdout (real terminal / DECORATION=always). Used before opts are parsed.
fn incidental_banner() -> bool {
    let p = resolve_output_policy(false, false, false);
    p.banner_enabled && p.decoration_stream == DecorationStream::Stdout
}

struct Options {
    query: Option<String>,
    mode: String,
    fusion: String,
    top_k: u32,
    summary: bool,
    mid: bool,
    json: bool,
    no_expand: bool,
    no_rerank: bool,
    no_late_interaction: bool,
    stop: bool,
    verbose: bool,
    help: bool,
    plain: bool,
    no_banner: bool,
    // grep / pattern modes
    grep: bool,
    regex: Option<String>,
    max_matches: u32,
    context_lines: u32,
    fixed_string: bool,
    symbol_type: Option<String>,
    globs: Vec<String>,
}

#[derive(Debug)]
struct ReadSemanticOptions {
    file: Option<String>,
    query: Option<String>,
    top_k: Option<u32>,
    threshold: Option<String>,
    context_lines: Option<u32>,
    max_chars: Option<u32>,
    max_tokens: Option<u32>,
    json: bool,
    plain: bool,
    no_banner: bool,
    verbose: bool,
    help: bool,
}

#[derive(Debug, Default)]
struct TraceOptions {
    symbol: Option<String>,
    file: Option<String>,
    hint: Option<String>,
    depth: Option<u32>,
    budget: Option<u32>,
    json: bool,
    plain: bool,
    no_banner: bool,
    help: bool,
}

#[derive(Debug)]
struct ReadOptions {
    paths: Vec<String>,
    format: String,
    start_line: Option<u32>,
    end_line: Option<u32>,
    include_metadata: bool,
    plain: bool,
    no_banner: bool,
    force: bool,
    help: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            query: None,
            mode: "auto".into(),
            fusion: "cc".into(),
            top_k: 10,
            summary: false,
            mid: false,
            json: false,
            no_expand: false,
            no_rerank: false,
            no_late_interaction: false,
            stop: false,
            verbose: false,
            help: false,
            plain: false,
            no_banner: false,
            grep: false,
            regex: None,
            max_matches: 0,
            context_lines: 0,
            fixed_string: false,
            symbol_type: None,
            globs: Vec::new(),
        }
    }
}

impl Default for ReadSemanticOptions {
    fn default() -> Self {
        Self {
            file: None,
            query: None,
            top_k: None,
            threshold: None,
            context_lines: None,
            max_chars: None,
            max_tokens: None,
            json: false,
            plain: false,
            no_banner: false,
            verbose: false,
            help: false,
        }
    }
}

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push_str("%20"),
            _ => {
                out.push('%');
                out.push(char::from(b"0123456789ABCDEF"[(byte >> 4) as usize]));
                out.push(char::from(b"0123456789ABCDEF"[(byte & 0x0F) as usize]));
            }
        }
    }
    out
}

fn flag_enabled_by_default(value: Option<&str>) -> bool {
    !matches!(
        value.map(|v| v.trim().to_ascii_lowercase()).as_deref(),
        Some("0" | "false" | "off" | "no")
    )
}

fn env_flag_enabled_by_default(name: &str) -> bool {
    let value = env::var(name).ok();
    flag_enabled_by_default(value.as_deref())
}

fn agent_session_id() -> Option<String> {
    [
        "SWEET_SEARCH_SESSION_ID",
        "CODEX_THREAD_ID",
        "CLAUDE_SESSION_ID",
    ]
    .iter()
    .filter_map(|name| env::var(name).ok())
    .find(|value| !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control))
}

fn append_agent_span_params_with(
    url: &mut String,
    agent_output: bool,
    feature_enabled: bool,
    session_id: Option<&str>,
) {
    if !agent_output || !feature_enabled {
        return;
    }
    if let Some(session_id) = session_id {
        url.push_str("&exactRereadOmission=true&agentSessionId=");
        url.push_str(&url_encode(session_id));
    }
}

fn append_agent_span_params(url: &mut String, agent_output: bool) {
    let session_id = agent_session_id();
    append_agent_span_params_with(
        url,
        agent_output,
        env_flag_enabled_by_default("SWEET_SEARCH_EXACT_REREAD_OMISSION"),
        session_id.as_deref(),
    );
}

/// Render the 3 banner lines (leading blank + 2 art lines). The mode tag makes
/// the search-family variant (lexical/semantic/hybrid/pattern) self-identifying.
fn render_header(query: &str, mode: &str, a: &Ansi) -> Vec<String> {
    let right = if mode != "auto" {
        format!("[{mode}] \"{query}\"")
    } else {
        format!("\"{query}\"")
    };
    let right_len = right.chars().count();
    let padding = if right_len < 32 { 32 - right_len } else { 0 };
    vec![
        String::new(),
        format!("{}  {}{}{}{}{:>32}{}", a.d1, a.fa, L1, a.r, a.d1, "", a.r),
        format!(
            "{}  {}{}{}{}{:>pad$}{}{}{}{}  {}",
            a.d1,
            a.fa,
            L2,
            a.r,
            a.d2,
            "",
            a.fw,
            right,
            a.r,
            a.d1,
            a.r,
            pad = padding
        ),
    ]
}

/// Emit the banner on the channel the policy selected. Stdout uses normal
/// println; the Claude side-channel writes to /dev/tty best-effort (never fatal,
/// never falls back to stdout/stderr — that would defeat the token savings).
fn emit_header(query: &str, mode: &str, policy: &OutputPolicy) {
    if !policy.banner_enabled {
        return;
    }
    let lines = render_header(query, mode, ansi(policy.color_enabled));
    match policy.decoration_stream {
        DecorationStream::Stdout => {
            for line in &lines {
                println!("{line}");
            }
        }
        DecorationStream::Tty => {
            if let Ok(mut tty) = fs::OpenOptions::new().write(true).open("/dev/tty") {
                let _ = tty.write_all(lines.join("\n").as_bytes());
                let _ = tty.write_all(b"\n");
            }
        }
        DecorationStream::None => {}
    }
}

fn print_usage(prog: &str, a: &Ansi, show_banner: bool) {
    let (fa, fw, fg, fy, r) = (a.fa, a.fw, a.fg, a.fy, a.r);
    // The pixel-art header is decoration: only emit it when the policy allows a
    // banner. Otherwise (captured agent output, --no-banner, etc.) print just
    // the usage text so --help / parse errors stay token-minimal.
    if show_banner {
        println!("{fa}{L1}\n{L2}{r}\n");
    }
    println!("{fw}Usage:{r} {prog} \"query\" [options]");
    println!("       {prog} grep \"pattern\" [options]\n");
    println!("{fw}Options:{r}");
    println!("  -k, --top <n>       Number of results (default: 10)");
    println!("  -m, --mode <mode>   Search mode: auto, lexical, semantic, hybrid");
    println!("  -e, --regex <pat>   Regex pattern (pattern mode: regex + semantic rank)");
    println!("      --type <kind>   Filter to symbol kind: function|class|method|...");
    println!("  -C, --context <n>   Lines of context around grep matches");
    println!("      --max-matches <n>  Cap grep matches");
    println!("  -F, --fixed-strings Treat pattern as a literal string");
    println!("      --glob <g>      Restrict to matching paths (repeatable)");
    println!("  -s, --summary       Summary-first output {fy}(10x token reduction){r}");
    println!("      --mid           Middle-res output {fy}(5x token reduction){r}");
    println!("  -j, --json          JSON output");
    println!("      --format <fmt>  Output format: text (default), plain, json");
    println!("      --no-banner     Suppress the decorative banner");
    println!("      --no-expand     Disable graph expansion");
    println!("      --no-rerank     Disable reranking");
    println!("  -f, --fusion <type> Fusion method: cc (default) or rrf");
    println!("      --no-late-interaction  Disable late interaction {fy}(enabled by default){r}");
    println!("      --stop          Stop the search server");
    println!("  -v, --verbose       Verbose output");
    println!("  -h, --help          Show this help");
    println!("\n{fw}Decoration:{r} auto by default. SWEET_SEARCH_DECORATION=never forces plain;");
    println!(
        "  =always forces the banner onto stdout even when captured {fy}(you accept the token cost){r}."
    );
    println!("\n{fw}Examples:{r}");
    println!("  {prog} \"AuthService\"                    {fg}# Lexical search{r}");
    println!("  {prog} \"how does auth work\" -s          {fg}# Semantic + summary{r}");
    println!("  {prog} grep \"class\\\\s+Auth\\\\w+\"          {fg}# Bare regex grep{r}");
    println!("  {prog} -e \"fn.*sort\" \"sorting\"          {fg}# Pattern: regex + semantic{r}");
    println!("  {prog} --stop                            {fg}# Stop server{r}");
}

fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut opts = Options::default();
    let mut i = 0;
    // `grep` subcommand: bare lexical pattern search (no semantic rerank). The
    // first positional after it is the pattern. Mirrors the JS `grep` command.
    if args.first().map(|s| s.as_str()) == Some("grep") {
        opts.grep = true;
        opts.mode = "grep".into();
        opts.no_expand = true;
        opts.no_rerank = true;
        i = 1;
    }
    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-k" | "--top" => {
                i += 1;
                opts.top_k = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(10);
                if opts.top_k == 0 {
                    opts.top_k = 10;
                }
            }
            "-m" | "--mode" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    opts.mode = v.clone();
                }
            }
            "-s" | "--summary" => opts.summary = true,
            "--mid" => opts.mid = true,
            "-j" | "--json" => opts.json = true,
            "--no-banner" => opts.no_banner = true,
            "--format" => {
                i += 1;
                match args.get(i).map(|s| s.as_str()) {
                    Some("json") => opts.json = true,
                    Some("plain") => opts.plain = true,
                    Some("text") => {}
                    Some(other) => return Err(format!("unknown --format value: {other}")),
                    None => return Err("--format requires a value".into()),
                }
            }
            "--no-expand" => opts.no_expand = true,
            "--no-rerank" => opts.no_rerank = true,
            "-e" | "--regex" => {
                i += 1;
                match args.get(i) {
                    Some(v) => {
                        opts.regex = Some(v.clone());
                        if !opts.grep {
                            opts.mode = "pattern".into();
                        }
                    }
                    None => return Err("--regex requires a value".into()),
                }
            }
            "-C" | "--context" => {
                i += 1;
                opts.context_lines = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(0);
            }
            "--max-matches" => {
                i += 1;
                opts.max_matches = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(0);
            }
            "-F" | "--fixed-strings" => opts.fixed_string = true,
            "--type" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    opts.symbol_type = Some(v.clone());
                }
            }
            "--glob" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    opts.globs.push(v.clone());
                }
            }
            "-f" | "--fusion" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    opts.fusion = v.clone();
                }
            }
            "--no-late-interaction" | "--no-colbert" => opts.no_late_interaction = true,
            "--stop" => opts.stop = true,
            "-v" | "--verbose" => opts.verbose = true,
            "-h" | "--help" => opts.help = true,
            other => {
                if let Some(v) = other.strip_prefix("--format=") {
                    match v {
                        "json" => opts.json = true,
                        "plain" => opts.plain = true,
                        "text" => {}
                        _ => return Err(format!("unknown --format value: {v}")),
                    }
                } else if other.starts_with('-') {
                    return Err(format!("Unknown option: {other}"));
                } else if opts.query.is_none() {
                    opts.query = Some(other.to_string());
                }
            }
        }
        i += 1;
    }
    Ok(opts)
}

fn print_read_semantic_usage(prog: &str, a: &Ansi) {
    println!(
        "{}Usage:{} {prog} read-semantic <file> \"query\" [options]\n",
        a.fw, a.r
    );
    println!("{}Options:{}", a.fw, a.r);
    println!("  -k, --top <n>       Max ranked spans before merging (default: 5)");
    println!("      --threshold <f> MaxSim score floor when LI runs (default: 0.4)");
    println!("      --context <n>   Lines of pre/post context per selected span (default: 2)");
    println!("      --max-chars <n> Hard cap on returned text (default: 8000)");
    println!("      --max-tokens <n> Convenience cap (~chars/4)");
    println!("  -j, --json          Emit JSON");
    println!("      --format <fmt>  json | agent | plain");
    println!("      --no-banner     Suppress the identity line");
    println!("  -v, --verbose       Include timings + per-signal scores");
    println!("  -h, --help          Show this help");
}

fn parse_read_semantic_args(args: &[String]) -> Result<ReadSemanticOptions, String> {
    let mut opts = ReadSemanticOptions::default();
    let mut positional: Vec<String> = Vec::new();
    let mut i = 0;

    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-k" | "--top" | "--top-k" => {
                i += 1;
                opts.top_k = Some(
                    args.get(i)
                        .ok_or_else(|| format!("{arg} requires a value"))?
                        .parse()
                        .map_err(|_| format!("{arg} requires an integer"))?,
                );
            }
            "--threshold" => {
                i += 1;
                opts.threshold = Some(
                    args.get(i)
                        .ok_or_else(|| "--threshold requires a value".to_string())?
                        .clone(),
                );
            }
            "--context" => {
                i += 1;
                opts.context_lines = Some(
                    args.get(i)
                        .ok_or_else(|| "--context requires a value".to_string())?
                        .parse()
                        .map_err(|_| "--context requires an integer".to_string())?,
                );
            }
            "--max-chars" => {
                i += 1;
                opts.max_chars = Some(
                    args.get(i)
                        .ok_or_else(|| "--max-chars requires a value".to_string())?
                        .parse()
                        .map_err(|_| "--max-chars requires an integer".to_string())?,
                );
            }
            "--max-tokens" => {
                i += 1;
                opts.max_tokens = Some(
                    args.get(i)
                        .ok_or_else(|| "--max-tokens requires a value".to_string())?
                        .parse()
                        .map_err(|_| "--max-tokens requires an integer".to_string())?,
                );
            }
            "-j" | "--json" => opts.json = true,
            "--agent" => {}
            "--no-banner" => opts.no_banner = true,
            "--format" => {
                i += 1;
                match args.get(i).map(|s| s.as_str()) {
                    Some("json") => opts.json = true,
                    Some("agent") => {}
                    Some("plain") => opts.plain = true,
                    Some(other) => return Err(format!("unknown --format value: {other}")),
                    None => return Err("--format requires a value".into()),
                }
            }
            "-v" | "--verbose" => opts.verbose = true,
            "-h" | "--help" => opts.help = true,
            other => {
                if let Some(v) = other.strip_prefix("--format=") {
                    match v {
                        "json" => opts.json = true,
                        "agent" => {}
                        "plain" => opts.plain = true,
                        _ => return Err(format!("unknown --format value: {v}")),
                    }
                } else if other.starts_with('-') {
                    return Err(format!("Unknown option: {other}"));
                } else {
                    positional.push(other.to_string());
                }
            }
        }
        i += 1;
    }

    if let Some(first) = positional.first() {
        opts.file = Some(first.clone());
    }
    if positional.len() >= 2 {
        opts.query = Some(positional[1..].join(" "));
    }
    Ok(opts)
}

fn build_url(
    opts: &Options,
    body_color: bool,
    body_decoration: bool,
    agent_format: bool,
) -> String {
    let query = opts.query.as_deref().unwrap_or("");
    let encoded = url_encode(query);
    let format = if opts.json { "json" } else { "text" };

    let mut url = format!("/search?q={encoded}&k={}&format={format}", opts.top_k);

    // Suppress server-side ANSI in the result body whenever our result stream is
    // captured (agent pipe / Claude side-channel). JSON is always uncolored.
    if !body_color {
        url.push_str("&color=false");
    }
    // Drop the decorative status prelude (mode | ms ●) unless the banner is going
    // to stdout — keeps captured / side-channel bodies results-only.
    if !body_decoration {
        url.push_str("&decorate=false");
    }
    if agent_format {
        url.push_str("&agent=true");
    }

    if opts.mode != "auto" {
        url.push_str(&format!("&mode={}", opts.mode));
    }
    if opts.summary {
        url.push_str("&summary=true");
    }
    if opts.mid {
        url.push_str("&mid=true");
    }
    if opts.no_expand {
        url.push_str("&expand=false");
    }
    if opts.no_rerank {
        url.push_str("&rerank=false");
    }
    if opts.fusion != "cc" {
        url.push_str(&format!("&fusion={}", opts.fusion));
    }
    if opts.no_late_interaction {
        url.push_str("&late-interaction=false");
    }

    // Pattern / grep params. For `grep`, the positional IS the pattern, so the
    // regex defaults to the query (matches the JS `grep` command). For `-e`
    // pattern mode, the explicit regex is sent alongside the semantic query.
    let regex = match (opts.grep, &opts.regex) {
        (_, Some(rx)) => Some(rx.clone()),
        (true, None) => Some(query.to_string()),
        (false, None) => None,
    };
    if let Some(rx) = regex {
        if !rx.is_empty() {
            url.push_str(&format!("&regex={}", url_encode(&rx)));
        }
    }
    if opts.max_matches > 0 {
        url.push_str(&format!("&maxMatches={}", opts.max_matches));
    }
    if opts.context_lines > 0 {
        url.push_str(&format!("&contextLines={}", opts.context_lines));
    }
    if opts.fixed_string {
        url.push_str("&fixedString=true");
    }
    if let Some(t) = &opts.symbol_type {
        url.push_str(&format!("&type={}", url_encode(t)));
    }
    for g in &opts.globs {
        url.push_str(&format!("&glob={}", url_encode(g)));
    }

    append_agent_span_params(&mut url, !opts.json);

    url
}

fn print_read_usage(prog: &str, a: &Ansi) {
    println!(
        "{}sweet-search read{} — filesystem-grounded file reader\n",
        a.fw, a.r
    );
    println!("{}Usage:{}", a.fw, a.r);
    println!("  {prog} read <path> [...path]   Read 1-20 files");
    println!("  {prog} read <path> --lines 45-92\n");
    println!("{}Options:{}", a.fw, a.r);
    println!("  --lines <a-b>     1-based inclusive range. \"45-\" open end, \"45\" one line.");
    println!("  --json            Emit JSON");
    println!("  --raw             Emit raw text only (no fences/headers)");
    println!("  --agent           Default — markdown fenced block + symbol hints");
    println!("  --format <fmt>    json | raw | agent | plain");
    println!("  --no-banner       Suppress the identity line");
    println!("  --no-metadata     Skip index metadata attachment");
    println!("  --force           Retry the exact read named by an omission");
    println!("  -h, --help        Show this help");
}

// Mirrors search-read.js _parseLineRange: "45-92"/"45:92" range, "45-" open end,
// "45" single line.
fn parse_line_range(spec: &str) -> Result<(Option<u32>, Option<u32>), String> {
    if spec.is_empty() {
        return Ok((None, None));
    }
    let has_sep = spec.contains('-') || spec.contains(':');
    let parts: Vec<&str> = spec.splitn(2, |c| c == '-' || c == ':').collect();
    let start: u32 = parts[0]
        .parse()
        .map_err(|_| format!("invalid --lines spec: {spec}"))?;
    let end = if parts.len() == 2 {
        if parts[1].is_empty() {
            None
        } else {
            Some(
                parts[1]
                    .parse::<u32>()
                    .map_err(|_| format!("invalid --lines spec: {spec}"))?,
            )
        }
    } else if has_sep {
        None
    } else {
        Some(start)
    };
    Ok((Some(start), end))
}

// Mirrors search-read.js _parseArgs exactly.
fn parse_read_args(args: &[String]) -> Result<ReadOptions, String> {
    let mut opts = ReadOptions {
        paths: Vec::new(),
        format: "agent".to_string(),
        start_line: None,
        end_line: None,
        include_metadata: true,
        plain: false,
        no_banner: false,
        force: false,
        help: false,
    };
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "--json" => opts.format = "json".to_string(),
            "--raw" => opts.format = "raw".to_string(),
            "--agent" => opts.format = "agent".to_string(),
            "--no-metadata" => opts.include_metadata = false,
            "--no-banner" => opts.no_banner = true,
            "--force" => opts.force = true,
            "--lines" => {
                i += 1;
                let spec = args
                    .get(i)
                    .ok_or_else(|| "--lines requires a value".to_string())?;
                let (s, e) = parse_line_range(spec)?;
                opts.start_line = s;
                opts.end_line = e;
            }
            "-h" | "--help" => {
                opts.help = true;
                return Ok(opts);
            }
            "--format" => {
                i += 1;
                match args.get(i).map(|s| s.as_str()) {
                    Some("json") => opts.format = "json".to_string(),
                    Some("raw") => opts.format = "raw".to_string(),
                    Some("agent") => opts.format = "agent".to_string(),
                    Some("plain") => opts.plain = true,
                    Some(other) => return Err(format!("unknown --format value: {other}")),
                    None => return Err("--format requires a value".into()),
                }
            }
            other => {
                if let Some(v) = other.strip_prefix("--format=") {
                    match v {
                        "json" => opts.format = "json".to_string(),
                        "raw" => opts.format = "raw".to_string(),
                        "agent" => opts.format = "agent".to_string(),
                        "plain" => opts.plain = true,
                        _ => return Err(format!("unknown --format value: {v}")),
                    }
                } else if other.starts_with("--") {
                    return Err(format!("unknown flag: {other}"));
                } else {
                    opts.paths.push(other.to_string());
                }
            }
        }
        i += 1;
    }
    Ok(opts)
}

fn build_read_url(opts: &ReadOptions) -> String {
    let project_root = resolve_project_root().to_string_lossy().into_owned();
    let mut url = format!(
        "/read?projectRoot={}&format={}",
        url_encode(&project_root),
        opts.format,
    );
    if !opts.include_metadata {
        url.push_str("&metadata=false");
    }
    if opts.force {
        url.push_str("&force=true");
    }
    append_agent_span_params(&mut url, opts.format == "agent");
    if let Some(s) = opts.start_line {
        url.push_str(&format!("&startLine={s}"));
    }
    if let Some(e) = opts.end_line {
        url.push_str(&format!("&endLine={e}"));
    }
    for p in &opts.paths {
        url.push_str(&format!("&path={}", url_encode(p)));
    }
    url
}

fn print_trace_usage(prog: &str, a: &Ansi) {
    println!("{}Usage:{} {prog} trace <symbol> [options]\n", a.fw, a.r);
    println!("{}Options:{}", a.fw, a.r);
    println!("  --in <file>       Disambiguate symbols by indexed file path");
    println!("  --query <hint>    Natural-language hint used only for structural ranking");
    println!("  --depth <n>       Impact depth, 1-4 (default: 3)");
    println!("  --budget <n>      Token budget, 1000-16000 (default: adaptive)");
    println!("      --json        Emit JSON");
    println!("      --format <fmt> json | agent | plain");
    println!("      --no-banner   Suppress the identity line");
    println!("  -h, --help        Show this help");
}

// Mirrors search-trace.js parseArgs exactly: first positional = symbol, any
// later positional or --query/--hint appends to the structural hint.
fn parse_trace_args(args: &[String]) -> Result<TraceOptions, String> {
    let mut opts = TraceOptions::default();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "--in" | "--file" => {
                i += 1;
                opts.file = Some(
                    args.get(i)
                        .ok_or_else(|| format!("{arg} requires a value"))?
                        .clone(),
                );
            }
            "--query" | "--hint" => {
                i += 1;
                let v = args
                    .get(i)
                    .ok_or_else(|| format!("{arg} requires a value"))?
                    .clone();
                opts.hint = Some(match opts.hint.take() {
                    Some(h) => format!("{h} {v}"),
                    None => v,
                });
            }
            "--depth" => {
                i += 1;
                opts.depth = Some(
                    args.get(i)
                        .ok_or_else(|| "--depth requires a value".to_string())?
                        .parse()
                        .map_err(|_| "--depth requires an integer".to_string())?,
                );
            }
            "--budget" => {
                i += 1;
                opts.budget = Some(
                    args.get(i)
                        .ok_or_else(|| "--budget requires a value".to_string())?
                        .parse()
                        .map_err(|_| "--budget requires an integer".to_string())?,
                );
            }
            "--json" => opts.json = true,
            "--no-banner" => opts.no_banner = true,
            "--format" => {
                i += 1;
                match args.get(i).map(|s| s.as_str()) {
                    Some("json") => opts.json = true,
                    Some("agent") => {}
                    Some("plain") => opts.plain = true,
                    Some(other) => return Err(format!("unknown --format value: {other}")),
                    None => return Err("--format requires a value".into()),
                }
            }
            "-h" | "--help" => opts.help = true,
            other => {
                if let Some(v) = other.strip_prefix("--format=") {
                    match v {
                        "json" => opts.json = true,
                        "agent" => {}
                        "plain" => opts.plain = true,
                        _ => return Err(format!("unknown --format value: {v}")),
                    }
                } else if other.starts_with('-') {
                    return Err(format!("Unknown option: {other}"));
                } else if opts.symbol.is_none() {
                    opts.symbol = Some(other.to_string());
                } else {
                    let v = other.to_string();
                    opts.hint = Some(match opts.hint.take() {
                        Some(h) => format!("{h} {v}"),
                        None => v,
                    });
                }
            }
        }
        i += 1;
    }
    Ok(opts)
}

fn build_trace_url(opts: &TraceOptions) -> String {
    let symbol = opts.symbol.as_deref().unwrap_or("");
    let project_root = resolve_project_root().to_string_lossy().into_owned();
    let format = if opts.json { "json" } else { "agent" };
    let mut url = format!(
        "/trace?symbol={}&projectRoot={}&format={format}",
        url_encode(symbol),
        url_encode(&project_root),
    );
    if let Some(file) = &opts.file {
        url.push_str(&format!("&file={}", url_encode(file)));
    }
    if let Some(hint) = &opts.hint {
        if !hint.is_empty() {
            url.push_str(&format!("&hint={}", url_encode(hint)));
        }
    }
    if let Some(depth) = opts.depth {
        url.push_str(&format!("&depth={depth}"));
    }
    if let Some(budget) = opts.budget {
        url.push_str(&format!("&budget={budget}"));
    }
    append_agent_span_params(&mut url, !opts.json);
    url
}

fn build_read_semantic_url(opts: &ReadSemanticOptions) -> String {
    let file = opts.file.as_deref().unwrap_or("");
    let query = opts.query.as_deref().unwrap_or("");
    let project_root = resolve_project_root().to_string_lossy().into_owned();
    let format = if opts.json { "json" } else { "agent" };

    let mut url = format!(
        "/read-semantic?path={}&q={}&projectRoot={}&format={format}",
        url_encode(file),
        url_encode(query),
        url_encode(&project_root),
    );
    if let Some(k) = opts.top_k {
        url.push_str(&format!("&k={k}"));
    }
    if let Some(threshold) = &opts.threshold {
        url.push_str(&format!("&threshold={}", url_encode(threshold)));
    }
    if let Some(context) = opts.context_lines {
        url.push_str(&format!("&contextLines={context}"));
    }
    if let Some(max_chars) = opts.max_chars {
        url.push_str(&format!("&maxChars={max_chars}"));
    }
    if let Some(max_tokens) = opts.max_tokens {
        url.push_str(&format!("&maxTokens={max_tokens}"));
    }
    if opts.verbose {
        url.push_str("&verbose=true");
    }
    append_agent_span_params(&mut url, !opts.json);
    url
}

fn emit_tool_identity(tool: &str, detail: &str, policy: &OutputPolicy) {
    if !policy.banner_enabled {
        return;
    }
    let icon = match tool {
        "read-semantic" => "🧠",
        "read" => "📄",
        "trace" => "🔗",
        _ => "✦",
    };
    let a = ansi(policy.color_enabled);
    let sep = format!("{}·{}", a.fg, a.r);
    let line = format!(
        "  {icon} {}sweet-search{} {sep} {}{tool}{} {sep} {}{}{}",
        a.fw, a.r, a.fw, a.r, a.fg, detail, a.r,
    );
    match policy.decoration_stream {
        DecorationStream::Stdout => {
            println!();
            println!("{line}");
        }
        DecorationStream::Tty => {
            if let Ok(mut tty) = fs::OpenOptions::new().write(true).open("/dev/tty") {
                let _ = tty.write_all(b"\n");
                let _ = tty.write_all(line.as_bytes());
                let _ = tty.write_all(b"\n");
            }
        }
        DecorationStream::None => {}
    }
}

fn find_socket_path_with(
    primary: &str,
    exists: &dyn Fn(&Path) -> bool,
    connectable: &dyn Fn(&str) -> bool,
) -> Option<String> {
    // Only this project's socket (explicit override or per-project derived). No
    // global legacy `/tmp/search.sock` fallback — it routed project B's queries
    // to project A's server (C3).
    if exists(Path::new(primary)) && connectable(primary) {
        Some(primary.to_string())
    } else {
        None
    }
}

fn find_socket() -> Option<String> {
    let primary = socket_path();
    find_socket_path_with(&primary, &|p| p.exists(), &|p| {
        UnixStream::connect(p).is_ok()
    })
}

fn do_request(socket_path: &str, path: &str) -> io::Result<()> {
    do_request_with_status(socket_path, path).map(|_| ())
}

fn do_request_with_status(socket_path: &str, path: &str) -> io::Result<u16> {
    let mut stream = UnixStream::connect(socket_path)?;

    let request = format!("GET {path} HTTP/1.0\r\nHost: l\r\n\r\n");
    stream.write_all(request.as_bytes())?;
    // Do NOT shutdown(Write) — breaks async responses (summary mode). HTTP/1.0 EOF signals end.

    let stdout = io::stdout();
    let mut out = stdout.lock();
    let mut buf = [0u8; BUFFER_SIZE];
    let mut headers_done = false;
    let mut header_buf: Vec<u8> = Vec::new();
    let mut status_code = 0u16;

    loop {
        let n = stream.read(&mut buf)?;
        if n == 0 {
            break;
        }

        if !headers_done {
            header_buf.extend_from_slice(&buf[..n]);
            // Scan for \r\n\r\n header terminator
            if let Some(pos) = find_header_end(&header_buf) {
                headers_done = true;
                status_code = parse_http_status(&header_buf[..pos]).unwrap_or(0);
                let body_start = pos + 4;
                if body_start < header_buf.len() {
                    out.write_all(&header_buf[body_start..])?;
                }
                header_buf.clear();
            }
        } else {
            out.write_all(&buf[..n])?;
        }
    }

    out.flush()?;
    Ok(status_code)
}

fn find_header_end(data: &[u8]) -> Option<usize> {
    data.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_http_status(headers: &[u8]) -> Option<u16> {
    let text = std::str::from_utf8(headers).ok()?;
    let first = text.lines().next()?;
    let mut parts = first.split_whitespace();
    let _http = parts.next()?;
    parts.next()?.parse().ok()
}

/// Auto-start the Node server and wait for the socket to appear.
/// Matches ss.sh lines 19-25: spawn in background, poll 100ms intervals, max 5s.
fn auto_start_server() -> Option<String> {
    // Find the core/start-server.js relative to the binary or cwd
    let server_script = find_server_script();
    let script = match &server_script {
        // find_server_script() prints a detailed "tried these locations"
        // diagnostic on failure, so we just bail here.
        Some(s) => s.as_str(),
        None => return None,
    };

    // Spawn server in background. Inherit env (so SWEET_SEARCH_SOCKET_PATH passes
    // through) and pin SWEET_SEARCH_PROJECT_ROOT to our canonical root so the JS
    // server derives the SAME per-project socket we'll connect to, and the
    // maintainer targets the right project (C3 + canonical /tmp vs /private/tmp).
    let project_root = resolve_project_root();
    let spawn_result = Command::new("node")
        .arg(script)
        .arg("--serve")
        .env("SWEET_SEARCH_PROJECT_ROOT", &project_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    if let Err(e) = spawn_result {
        let a = ansi(incidental_color());
        eprintln!("{}Error:{} Failed to start server: {e}", a.fa, a.r);
        return None;
    }

    // Poll for socket (100ms intervals, max 50 attempts = 5s)
    for _ in 0..50 {
        thread::sleep(Duration::from_millis(100));
        if let Some(path) = find_socket() {
            return Some(path);
        }
    }

    let a = ansi(incidental_color());
    eprintln!(
        "{}Error:{} Server did not start within 5 seconds",
        a.fa, a.r
    );
    eprintln!("Start server manually: node core/start-server.js");
    None
}

/// Pure resolver for `core/start-server.js`. Given the cwd, the binary path, an
/// optional explicit override, and an existence predicate, return the first
/// candidate that exists plus the ordered list of locations tried (used for the
/// failure diagnostic). Side-effect-free so it can be unit-tested without the
/// real filesystem. The server entry is a minimal module that avoids the
/// circular import in sweet-search.js (Node "unsettled top-level await" exit).
///
/// Lookup order:
///   0. `$SWEET_SEARCH_SERVER_ENTRY` (explicit override, same env the JS
///      prewarm hook honors).
///   1. `<cwd>/core/start-server.js` — dev repo run from its own root.
///   2. `<cwd ancestor>/node_modules/sweet-search/core/start-server.js` — npm
///      install, invoked anywhere inside the consuming project.
///   3a. `<binary ancestor>/core/start-server.js` — dev binary in
///      `crates/sweet-search-cli/target/release/`.
///   3b. when a binary ancestor is `node_modules` (the published binary lives in
///      `node_modules/@sweet-search/native-*/`), its sibling
///      `node_modules/sweet-search/core/start-server.js`.
fn resolve_server_script(
    cwd: &Path,
    exe: Option<&Path>,
    server_entry_override: Option<&str>,
    exists: &dyn Fn(&Path) -> bool,
) -> (Option<PathBuf>, Vec<PathBuf>) {
    let rel = Path::new("core").join("start-server.js");
    let mut tried: Vec<PathBuf> = Vec::new();

    // 0. Explicit override.
    if let Some(entry) = server_entry_override {
        if !entry.is_empty() {
            let p = PathBuf::from(entry);
            if exists(&p) {
                return (Some(p), tried);
            }
            tried.push(p);
        }
    }

    // 1. cwd-relative (dev repo run from its root).
    let cwd_script = cwd.join(&rel);
    if exists(&cwd_script) {
        return (Some(cwd_script), tried);
    }
    tried.push(cwd_script);

    // 2. cwd upward: <ancestor>/node_modules/sweet-search/core/start-server.js.
    for ancestor in cwd.ancestors() {
        let candidate = ancestor
            .join("node_modules")
            .join("sweet-search")
            .join(&rel);
        if exists(&candidate) {
            return (Some(candidate), tried);
        }
        tried.push(candidate);
    }

    // 3. binary path upward.
    if let Some(exe) = exe {
        if let Some(dir) = exe.parent() {
            for ancestor in dir.ancestors() {
                // 3a. repo-relative (dev: crates/sweet-search-cli/target/release).
                let candidate = ancestor.join(&rel);
                if exists(&candidate) {
                    return (Some(candidate), tried);
                }
                tried.push(candidate);

                // 3b. npm sibling: the published binary sits in
                // node_modules/@sweet-search/native-*/, and the same node_modules
                // also holds the `sweet-search` package with the JS server entry.
                if ancestor
                    .file_name()
                    .map(|n| n == "node_modules")
                    .unwrap_or(false)
                {
                    let sibling = ancestor.join("sweet-search").join(&rel);
                    if exists(&sibling) {
                        return (Some(sibling), tried);
                    }
                    tried.push(sibling);
                }
            }
        }
    }

    (None, tried)
}

fn find_server_script() -> Option<String> {
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let exe = env::current_exe().ok();
    let override_env = env::var("SWEET_SEARCH_SERVER_ENTRY").ok();
    let exists = |p: &Path| p.exists();

    let (found, tried) =
        resolve_server_script(&cwd, exe.as_deref(), override_env.as_deref(), &exists);

    match found {
        Some(p) => {
            // Canonicalize for a stable absolute path; fall back to the raw path.
            let resolved = p.canonicalize().unwrap_or(p);
            Some(resolved.to_string_lossy().into_owned())
        }
        None => {
            let a = ansi(incidental_color());
            eprintln!(
                "{}Error:{} Cannot find core/start-server.js. Tried:",
                a.fa, a.r
            );
            for t in &tried {
                eprintln!("  - {}", t.display());
            }
            eprintln!("Set $SWEET_SEARCH_SERVER_ENTRY to the path of start-server.js to override.");
            None
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let prog = args
        .first()
        .map(|s| {
            Path::new(s)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        })
        .unwrap_or_else(|| "sweet-search".into());

    let cli_args: Vec<String> = args.into_iter().skip(1).collect();

    // Color for messages emitted before the full policy is known (parse errors).
    let ea = ansi(incidental_color());

    if cli_args.first().map(|s| s.as_str()) == Some("read-semantic") {
        let rs_opts = match parse_read_semantic_args(&cli_args[1..]) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("{}Error:{} {e}", ea.fa, ea.r);
                print_read_semantic_usage(&prog, ea);
                process::exit(2);
            }
        };
        if rs_opts.help {
            print_read_semantic_usage(&prog, ea);
            return;
        }
        let file = match rs_opts.file.as_deref() {
            Some(v) if !v.is_empty() => v,
            _ => {
                print_read_semantic_usage(&prog, ea);
                process::exit(2);
            }
        };
        let query = match rs_opts.query.as_deref() {
            Some(v) if !v.is_empty() => v,
            _ => {
                print_read_semantic_usage(&prog, ea);
                process::exit(2);
            }
        };

        let policy = resolve_output_policy(rs_opts.json, rs_opts.plain, rs_opts.no_banner);
        let socket = match find_socket() {
            Some(s) => s,
            None => match auto_start_server() {
                Some(s) => s,
                None => process::exit(1),
            },
        };
        if !rs_opts.json {
            let detail = format!("{file} · \"{query}\"");
            emit_tool_identity("read-semantic", &detail, &policy);
        }
        let url = build_read_semantic_url(&rs_opts);
        match do_request_with_status(&socket, &url) {
            Ok(status) if status >= 400 => process::exit(1),
            Ok(_) => return,
            Err(e) => {
                eprintln!("{}Error:{} {e}", ea.fa, ea.r);
                process::exit(1);
            }
        }
    }

    if cli_args.first().map(|s| s.as_str()) == Some("trace") {
        let t_opts = match parse_trace_args(&cli_args[1..]) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("{}Error:{} {e}", ea.fa, ea.r);
                print_trace_usage(&prog, ea);
                process::exit(2);
            }
        };
        if t_opts.help {
            print_trace_usage(&prog, ea);
            return;
        }
        let symbol = match t_opts.symbol.as_deref() {
            Some(v) if !v.is_empty() => v,
            _ => {
                print_trace_usage(&prog, ea);
                process::exit(2);
            }
        };
        let policy = resolve_output_policy(t_opts.json, t_opts.plain, t_opts.no_banner);
        let socket = match find_socket() {
            Some(s) => s,
            None => match auto_start_server() {
                Some(s) => s,
                None => process::exit(1),
            },
        };
        if !t_opts.json {
            emit_tool_identity("trace", symbol, &policy);
        }
        let url = build_trace_url(&t_opts);
        match do_request_with_status(&socket, &url) {
            Ok(status) if status >= 400 => process::exit(1),
            Ok(_) => return,
            Err(e) => {
                eprintln!("{}Error:{} {e}", ea.fa, ea.r);
                process::exit(1);
            }
        }
    }

    if cli_args.first().map(|s| s.as_str()) == Some("read") {
        let r_opts = match parse_read_args(&cli_args[1..]) {
            Ok(o) => o,
            Err(e) => {
                eprintln!("{}Error:{} {e}", ea.fa, ea.r);
                print_read_usage(&prog, ea);
                process::exit(2);
            }
        };
        if r_opts.help {
            print_read_usage(&prog, ea);
            return;
        }
        if r_opts.paths.is_empty() {
            print_read_usage(&prog, ea);
            process::exit(2);
        }
        let wants_range = r_opts.start_line.is_some() || r_opts.end_line.is_some();
        if wants_range && r_opts.paths.len() > 1 {
            eprintln!("{}Error:{} --lines requires exactly one path", ea.fa, ea.r);
            process::exit(2);
        }
        let json = r_opts.format == "json";
        let policy = resolve_output_policy(json, r_opts.plain, r_opts.no_banner);
        let socket = match find_socket() {
            Some(s) => s,
            None => match auto_start_server() {
                Some(s) => s,
                None => process::exit(1),
            },
        };
        if !json {
            let detail = if r_opts.paths.len() == 1 {
                r_opts.paths[0].clone()
            } else {
                format!("{} files", r_opts.paths.len())
            };
            emit_tool_identity("read", &detail, &policy);
        }
        let url = build_read_url(&r_opts);
        match do_request_with_status(&socket, &url) {
            Ok(status) if status >= 400 => process::exit(1),
            Ok(_) => return,
            Err(e) => {
                eprintln!("{}Error:{} {e}", ea.fa, ea.r);
                process::exit(1);
            }
        }
    }

    let opts = match parse_args(&cli_args) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("{}Error:{} {e}", ea.fa, ea.r);
            print_usage(&prog, ea, incidental_banner());
            process::exit(1);
        }
    };

    // Resolve the output policy once. `sa` colors incidental stdout text only
    // when decoration is going to stdout (a real terminal / DECORATION=always),
    // so a captured pipe or a /dev/tty side-channel keeps stdout plain.
    let policy = resolve_output_policy(opts.json, opts.plain, opts.no_banner);
    let stdout_color = policy.color_enabled && policy.decoration_stream == DecorationStream::Stdout;
    let stdout_banner =
        policy.banner_enabled && policy.decoration_stream == DecorationStream::Stdout;
    let sa = ansi(stdout_color);

    if opts.help {
        print_usage(&prog, sa, stdout_banner);
        return;
    }

    if opts.stop {
        let socket = match find_socket() {
            Some(s) => s,
            None => {
                eprintln!(
                    "{}Error:{} No server running (socket not found)",
                    ea.fa, ea.r
                );
                process::exit(1);
            }
        };
        println!("{}Stopping server...{}", sa.fa, sa.r);
        if let Err(e) = do_request(&socket, "/stop") {
            eprintln!("{}Error:{} {e}", ea.fa, ea.r);
            process::exit(1);
        }
        return;
    }

    let query = match &opts.query {
        Some(q) if !q.is_empty() => q.clone(),
        _ => {
            print_usage(&prog, sa, stdout_banner);
            return;
        }
    };

    if opts.verbose {
        println!("{}Query:{} {query}", sa.fg, sa.r);
        println!("{}Mode:{} {}", sa.fg, sa.r, opts.mode);
        println!("{}Top K:{} {}", sa.fg, sa.r, opts.top_k);
        if opts.summary {
            println!("{}Format:{} summary", sa.fg, sa.r);
        }
        if opts.mid {
            println!("{}Format:{} mid", sa.fg, sa.r);
        }
        if opts.no_expand {
            println!("{}Graph expansion:{} disabled", sa.fg, sa.r);
        }
        if opts.no_rerank {
            println!("{}Reranking:{} disabled", sa.fg, sa.r);
        }
        if opts.no_late_interaction {
            println!("{}Late Interaction:{} disabled", sa.fg, sa.r);
        }
        println!();
    }

    // Find or start server
    let socket = match find_socket() {
        Some(s) => s,
        None => match auto_start_server() {
            Some(s) => s,
            None => process::exit(1),
        },
    };

    // Result body is colored / prefaced with the stats line only when it streams
    // to a real terminal; a captured pipe or /dev/tty side-channel keeps the body
    // plain and results-only.
    let url = build_url(&opts, stdout_color, stdout_banner, policy.agent_format);
    // Banner goes to the policy-selected channel (stdout / /dev/tty / nowhere);
    // results always stream to stdout below.
    emit_header(&query, &opts.mode, &policy);

    // Status-aware, matching the read / read-semantic / trace paths above. The
    // daemon answers an unusable project (no index, failed init) with a 5xx and
    // a JSON error body; streaming that body while exiting 0 made every failed
    // search look successful to `&&` chains and CI.
    match do_request_with_status(&socket, &url) {
        Ok(status) if status >= 400 => process::exit(1),
        Ok(_) => {}
        Err(e) => {
            eprintln!("{}Error:{} {e}", ea.fa, ea.r);
            process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Build an existence predicate that returns true only for the given paths.
    fn exists_set(paths: &[&str]) -> impl Fn(&Path) -> bool {
        let set: HashSet<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |p: &Path| set.contains(p)
    }

    #[test]
    fn override_env_wins_when_it_exists() {
        let exists = exists_set(&["/custom/start-server.js"]);
        let (found, _) = resolve_server_script(
            Path::new("/proj"),
            Some(Path::new("/proj/node_modules/.bin/sweet-search")),
            Some("/custom/start-server.js"),
            &exists,
        );
        assert_eq!(found, Some(PathBuf::from("/custom/start-server.js")));
    }

    #[test]
    fn dev_repo_cwd_relative_resolves() {
        let exists = exists_set(&["/repo/core/start-server.js"]);
        let (found, _) = resolve_server_script(Path::new("/repo"), None, None, &exists);
        assert_eq!(found, Some(PathBuf::from("/repo/core/start-server.js")));
    }

    #[test]
    fn npm_install_resolves_from_cwd_upward() {
        // Invoked from a subdir of a project that installed the package.
        let target = "/proj/node_modules/sweet-search/core/start-server.js";
        let exists = exists_set(&[target]);
        let (found, _) = resolve_server_script(Path::new("/proj/src/deep"), None, None, &exists);
        assert_eq!(found, Some(PathBuf::from(target)));
    }

    #[test]
    fn npm_published_binary_resolves_sibling_package() {
        // The published binary lives in node_modules/@sweet-search/native-*/.
        // cwd is unrelated so the cwd-upward branch can't find it; resolution
        // must come from walking up the binary path to node_modules.
        let target = "/proj/node_modules/sweet-search/core/start-server.js";
        let exists = exists_set(&[target]);
        let (found, _) = resolve_server_script(
            Path::new("/somewhere/else"),
            Some(Path::new(
                "/proj/node_modules/@sweet-search/native-darwin-arm64/sweet-search",
            )),
            None,
            &exists,
        );
        assert_eq!(found, Some(PathBuf::from(target)));
    }

    #[test]
    fn missing_everywhere_returns_none_with_tried_locations() {
        let exists = exists_set(&[]);
        let (found, tried) = resolve_server_script(
            Path::new("/proj"),
            Some(Path::new(
                "/proj/node_modules/@sweet-search/native-darwin-arm64/sweet-search",
            )),
            None,
            &exists,
        );
        assert_eq!(found, None);
        assert!(!tried.is_empty());
        // The npm sibling location must be among the attempted paths.
        assert!(tried
            .iter()
            .any(|p| p == &PathBuf::from("/proj/node_modules/sweet-search/core/start-server.js")));
    }

    // --- C3: project-scoped socket derivation -----------------------------

    #[test]
    fn fnv1a64_matches_known_vectors() {
        // Canonical FNV-1a/64 of "abc"; the empty string is the offset basis.
        assert_eq!(fnv1a64_hex(""), "cbf29ce484222325");
        assert_eq!(fnv1a64_hex("abc"), "e71fa2190541574b");
    }

    #[test]
    fn fnv1a64_agrees_with_js_for_project_roots() {
        // These MUST equal core/search/server-identity.js::fnv1a64Hex output
        // (see its test) so the native CLI and JS server agree on the socket.
        assert_eq!(fnv1a64_hex("/private/tmp/projA"), "16fc53080a86469a");
        assert_eq!(fnv1a64_hex("/private/tmp/projB"), "16fc52080a8644e7");
    }

    #[test]
    fn explicit_override_wins_over_derived_socket() {
        assert_eq!(
            derive_socket(Some("/tmp/custom.sock"), "/private/tmp/projA"),
            "/tmp/custom.sock"
        );
        // Empty override is ignored (falls back to derived).
        assert!(derive_socket(Some(""), "/private/tmp/projA").starts_with("/tmp/sweet-search-"));
    }

    #[test]
    fn two_projects_get_different_sockets() {
        let a = derive_socket(None, "/private/tmp/projA");
        let b = derive_socket(None, "/private/tmp/projB");
        assert_ne!(a, b);
        assert_eq!(a, "/tmp/sweet-search-16fc53080a86469a.sock");
        assert_eq!(b, "/tmp/sweet-search-16fc52080a8644e7.sock");
    }

    #[test]
    fn socket_discovery_requires_a_live_listener() {
        let exists = exists_set(&[
            "/tmp/sweet-search-live.sock",
            "/tmp/sweet-search-stale.sock",
        ]);
        let connectable = |p: &str| p == "/tmp/sweet-search-live.sock";

        assert_eq!(
            find_socket_path_with("/tmp/sweet-search-live.sock", &exists, &connectable),
            Some("/tmp/sweet-search-live.sock".to_string())
        );
        assert_eq!(
            find_socket_path_with("/tmp/sweet-search-stale.sock", &exists, &connectable),
            None
        );
        assert_eq!(
            find_socket_path_with("/tmp/sweet-search-missing.sock", &exists, &connectable),
            None
        );
    }

    #[test]
    fn read_semantic_subcommand_parses_file_query_and_flags() {
        let args = vec![
            "src/a.js".to_string(),
            "how".to_string(),
            "auth".to_string(),
            "works".to_string(),
            "--top".to_string(),
            "3".to_string(),
            "--threshold".to_string(),
            "0.25".to_string(),
            "--max-tokens".to_string(),
            "600".to_string(),
            "--format=plain".to_string(),
        ];
        let opts = parse_read_semantic_args(&args).expect("parse");
        assert_eq!(opts.file.as_deref(), Some("src/a.js"));
        assert_eq!(opts.query.as_deref(), Some("how auth works"));
        assert_eq!(opts.top_k, Some(3));
        assert_eq!(opts.threshold.as_deref(), Some("0.25"));
        assert_eq!(opts.max_tokens, Some(600));
        assert!(opts.plain);
        assert!(!opts.json);
    }

    #[test]
    fn read_semantic_subcommand_rejects_missing_flag_values() {
        let args = vec![
            "src/a.js".to_string(),
            "q".to_string(),
            "--max-tokens".to_string(),
        ];
        let err = parse_read_semantic_args(&args).unwrap_err();
        assert_eq!(err, "--max-tokens requires a value");
    }

    #[test]
    fn trace_subcommand_parses_symbol_and_flags() {
        let args = vec![
            "processOrder".to_string(),
            "--in".to_string(),
            "lib/x.js".to_string(),
            "--query".to_string(),
            "request order".to_string(),
            "--depth".to_string(),
            "2".to_string(),
            "--budget".to_string(),
            "8000".to_string(),
            "--json".to_string(),
        ];
        let opts = parse_trace_args(&args).expect("parse");
        assert_eq!(opts.symbol.as_deref(), Some("processOrder"));
        assert_eq!(opts.file.as_deref(), Some("lib/x.js"));
        assert_eq!(opts.hint.as_deref(), Some("request order"));
        assert_eq!(opts.depth, Some(2));
        assert_eq!(opts.budget, Some(8000));
        assert!(opts.json);
    }

    #[test]
    fn trace_subcommand_appends_extra_positionals_to_hint() {
        let args = vec![
            "validate".to_string(),
            "request".to_string(),
            "validation".to_string(),
        ];
        let opts = parse_trace_args(&args).expect("parse");
        assert_eq!(opts.symbol.as_deref(), Some("validate"));
        assert_eq!(opts.hint.as_deref(), Some("request validation"));
    }

    #[test]
    fn build_trace_url_encodes_symbol_root_and_flags() {
        let opts = TraceOptions {
            symbol: Some("processOrder".to_string()),
            depth: Some(2),
            json: true,
            ..Default::default()
        };
        let url = build_trace_url(&opts);
        assert!(url.starts_with("/trace?symbol=processOrder"));
        assert!(url.contains("&projectRoot="));
        assert!(url.contains("&format=json"));
        assert!(url.contains("&depth=2"));
    }

    #[test]
    fn agent_span_params_are_agent_only_and_url_encoded() {
        let mut enabled = "/search?q=x&format=text".to_string();
        append_agent_span_params_with(&mut enabled, true, true, Some("thread / 1"));
        assert!(enabled.contains("&exactRereadOmission=true"));
        assert!(enabled.contains("&agentSessionId=thread%20%2F%201"));

        let mut json = "/search?q=x&format=json".to_string();
        append_agent_span_params_with(&mut json, false, true, Some("thread"));
        assert_eq!(json, "/search?q=x&format=json");

        let mut disabled = "/trace?symbol=x".to_string();
        append_agent_span_params_with(&mut disabled, true, false, Some("thread"));
        assert_eq!(disabled, "/trace?symbol=x");
    }

    #[test]
    fn agent_span_feature_defaults_on_with_explicit_opt_out() {
        assert!(flag_enabled_by_default(None));
        assert!(flag_enabled_by_default(Some("1")));
        assert!(flag_enabled_by_default(Some("yes")));
        for value in ["0", "false", "off", "no", " FALSE "] {
            assert!(!flag_enabled_by_default(Some(value)));
        }
    }

    #[test]
    fn read_subcommand_parses_paths_lines_and_format() {
        let args = vec![
            "a.py".to_string(),
            "--lines".to_string(),
            "3-12".to_string(),
            "--raw".to_string(),
            "--no-metadata".to_string(),
            "--force".to_string(),
        ];
        let opts = parse_read_args(&args).expect("parse");
        assert_eq!(opts.paths, vec!["a.py".to_string()]);
        assert_eq!(opts.start_line, Some(3));
        assert_eq!(opts.end_line, Some(12));
        assert_eq!(opts.format, "raw");
        assert!(!opts.include_metadata);
        assert!(opts.force);
    }

    #[test]
    fn read_subcommand_collects_multiple_paths() {
        let args = vec!["a.py".to_string(), "b.py".to_string(), "--json".to_string()];
        let opts = parse_read_args(&args).expect("parse");
        assert_eq!(opts.paths, vec!["a.py".to_string(), "b.py".to_string()]);
        assert_eq!(opts.format, "json");
    }

    #[test]
    fn parse_line_range_handles_range_open_and_single() {
        assert_eq!(parse_line_range("45-92").unwrap(), (Some(45), Some(92)));
        assert_eq!(parse_line_range("45-").unwrap(), (Some(45), None));
        assert_eq!(parse_line_range("45").unwrap(), (Some(45), Some(45)));
        assert_eq!(parse_line_range("45:92").unwrap(), (Some(45), Some(92)));
        assert!(parse_line_range("abc").is_err());
    }

    #[test]
    fn build_read_url_emits_repeated_path_params() {
        let opts = ReadOptions {
            paths: vec!["a.py".to_string(), "b.py".to_string()],
            format: "agent".to_string(),
            start_line: None,
            end_line: None,
            include_metadata: true,
            plain: false,
            no_banner: false,
            force: true,
            help: false,
        };
        let url = build_read_url(&opts);
        assert!(url.contains("&path=a.py"));
        assert!(url.contains("&path=b.py"));
        assert!(url.contains("&format=agent"));
        assert!(url.contains("&force=true"));
        assert!(!url.contains("metadata=false"));
    }

    #[test]
    fn derived_socket_is_stable_for_same_root() {
        assert_eq!(
            derive_socket(None, "/private/tmp/projA"),
            derive_socket(None, "/private/tmp/projA")
        );
    }

    // --- Output-decoration policy (mirror of output-policy.test.js) --------

    fn agent(codex: bool, claude: bool, other: bool) -> AgentEnv {
        AgentEnv {
            codex,
            claude_code: claude,
            other_agent: other,
        }
    }
    const NONE: AgentEnv = AgentEnv {
        codex: false,
        claude_code: false,
        other_agent: false,
    };

    /// Build a getter + key list from (key, value) pairs for env classification.
    fn env_of(pairs: &[(&str, &str)]) -> (Box<dyn Fn(&str) -> Option<String>>, Vec<String>) {
        let owned: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let keys: Vec<String> = owned.iter().map(|(k, _)| k.clone()).collect();
        let lookup = owned.clone();
        let get = move |k: &str| {
            lookup
                .iter()
                .find(|(kk, _)| kk == k)
                .map(|(_, v)| v.clone())
        };
        (Box::new(get), keys)
    }

    #[test]
    fn env_truthy_rules() {
        assert!(env_truthy("1"));
        assert!(env_truthy("seatbelt"));
        assert!(!env_truthy(""));
        assert!(!env_truthy("0"));
        assert!(!env_truthy("false"));
    }

    #[test]
    fn detect_agent_env_classifies_markers() {
        let (g, k) = env_of(&[("CODEX_SANDBOX", "1")]);
        assert!(detect_agent_env(&g, &k).codex);

        let (g, k) = env_of(&[("CLAUDECODE", "1")]);
        assert!(detect_agent_env(&g, &k).claude_code);
        let (g, k) = env_of(&[("CLAUDECODE", "0")]);
        assert!(!detect_agent_env(&g, &k).claude_code);

        let (g, k) = env_of(&[("CURSOR_TRACE_ID", "x")]);
        assert!(detect_agent_env(&g, &k).other_agent);
        let (g, k) = env_of(&[("CLINE_ACTIVE", "1")]);
        assert!(detect_agent_env(&g, &k).other_agent);

        let (g, k) = env_of(&[("PATH", "/usr/bin")]);
        assert_eq!(detect_agent_env(&g, &k), NONE);
    }

    #[test]
    fn no_color_and_decoration_mode() {
        let (g, _) = env_of(&[("NO_COLOR", "1")]);
        assert!(has_no_color(&g));
        let (g, _) = env_of(&[("NO_COLOR", "")]);
        assert!(!has_no_color(&g));

        let (g, _) = env_of(&[("SWEET_SEARCH_DECORATION", "never")]);
        assert_eq!(decoration_mode(&g), DecorationMode::Never);
        let (g, _) = env_of(&[("SWEET_SEARCH_DECORATION", "ALWAYS")]);
        assert_eq!(decoration_mode(&g), DecorationMode::Always);
        let (g, _) = env_of(&[("SWEET_SEARCH_DECORATION", "wat")]);
        assert_eq!(decoration_mode(&g), DecorationMode::Auto);
    }

    #[test]
    fn json_is_machine_readable_and_undecorated() {
        let p = detect_output_policy(
            true,
            false,
            false,
            false,
            true,
            NONE,
            DecorationMode::Auto,
            true,
        );
        assert_eq!(p.mode, OutputMode::MachineReadable);
        assert!(p.machine_readable);
        assert!(!p.agent_format);
        assert!(!p.banner_enabled);
        assert_eq!(p.decoration_stream, DecorationStream::None);
    }

    #[test]
    fn tty_human_terminal_decorates_on_stdout() {
        let p = detect_output_policy(
            false,
            false,
            false,
            false,
            true,
            NONE,
            DecorationMode::Auto,
            false,
        );
        assert_eq!(p.mode, OutputMode::HumanTerminal);
        assert_eq!(p.decoration_stream, DecorationStream::Stdout);
        assert!(p.banner_enabled);
        assert!(p.color_enabled);
        assert!(!p.agent_format);
    }

    #[test]
    fn plain_and_no_banner_and_no_color_overrides() {
        let plain = detect_output_policy(
            false,
            true,
            false,
            false,
            true,
            NONE,
            DecorationMode::Auto,
            false,
        );
        assert!(!plain.banner_enabled);
        assert!(!plain.color_enabled);
        assert!(!plain.agent_format);

        let nob = detect_output_policy(
            false,
            false,
            true,
            false,
            true,
            NONE,
            DecorationMode::Auto,
            false,
        );
        assert!(!nob.banner_enabled);
        assert!(nob.color_enabled);

        let noc = detect_output_policy(
            false,
            false,
            false,
            true,
            true,
            NONE,
            DecorationMode::Auto,
            false,
        );
        assert!(!noc.color_enabled);
        assert!(noc.banner_enabled);
    }

    #[test]
    fn captured_without_claude_is_plain_even_if_tty_probe_available() {
        // Non-TTY, no Claude marker: a writable /dev/tty must NOT unlock the
        // side-channel (a PTY harness would capture it).
        let p = detect_output_policy(
            false,
            false,
            false,
            false,
            false,
            NONE,
            DecorationMode::Auto,
            true,
        );
        assert_eq!(p.mode, OutputMode::CapturedPlain);
        assert_eq!(p.decoration_stream, DecorationStream::None);
        assert!(!p.banner_enabled);
        assert_eq!(p.reason, "captured-no-claude");
    }

    #[test]
    fn claude_sidechannel_only_with_writable_tty() {
        let claude = agent(false, true, false);
        let ok = detect_output_policy(
            false,
            false,
            false,
            false,
            false,
            claude,
            DecorationMode::Auto,
            true,
        );
        assert_eq!(ok.mode, OutputMode::ClaudeTtySidechannel);
        assert_eq!(ok.decoration_stream, DecorationStream::Tty);
        assert!(ok.banner_enabled);
        assert!(ok.agent_format);
        assert_eq!(ok.reason, "claude-code-tty");

        let no_tty = detect_output_policy(
            false,
            false,
            false,
            false,
            false,
            claude,
            DecorationMode::Auto,
            false,
        );
        assert_eq!(no_tty.mode, OutputMode::CapturedPlain);
        assert!(!no_tty.banner_enabled);
        assert!(no_tty.agent_format);
        assert_eq!(no_tty.reason, "claude-no-tty");
    }

    #[test]
    fn codex_suppresses_even_with_tty_and_probe() {
        let codex = agent(true, false, false);
        let p = detect_output_policy(
            false,
            false,
            false,
            false,
            true,
            codex,
            DecorationMode::Auto,
            true,
        );
        assert_eq!(p.mode, OutputMode::CapturedPlain);
        assert_eq!(p.decoration_stream, DecorationStream::None);
        assert!(!p.banner_enabled);
        assert!(p.agent_format);
        assert_eq!(p.reason, "codex-detected");
    }

    #[test]
    fn other_agent_suppresses() {
        let cursor = agent(false, false, true);
        let p = detect_output_policy(
            false,
            false,
            false,
            false,
            true,
            cursor,
            DecorationMode::Auto,
            true,
        );
        assert!(!p.banner_enabled);
        assert_eq!(p.reason, "agent-detected");
    }

    #[test]
    fn decoration_never_and_always() {
        let never = detect_output_policy(
            false,
            false,
            false,
            false,
            true,
            NONE,
            DecorationMode::Never,
            false,
        );
        assert!(!never.banner_enabled);
        assert_eq!(never.reason, "decoration-never");

        // 'always' decorates even on a captured pipe.
        let always = detect_output_policy(
            false,
            false,
            false,
            false,
            false,
            NONE,
            DecorationMode::Always,
            false,
        );
        assert_eq!(always.mode, OutputMode::HumanTerminal);
        assert_eq!(always.decoration_stream, DecorationStream::Stdout);
        assert!(always.banner_enabled);

        // json still wins over always.
        let json = detect_output_policy(
            true,
            false,
            false,
            false,
            false,
            NONE,
            DecorationMode::Always,
            false,
        );
        assert!(json.machine_readable);
        assert!(!json.banner_enabled);
    }

    #[test]
    fn never_routes_decoration_to_a_non_stdout_non_tty_channel() {
        for json in [true, false] {
            for is_tty in [true, false] {
                for ag in [NONE, agent(true, false, false), agent(false, true, false)] {
                    let p = detect_output_policy(
                        json,
                        false,
                        false,
                        false,
                        is_tty,
                        ag,
                        DecorationMode::Auto,
                        true,
                    );
                    assert!(matches!(
                        p.decoration_stream,
                        DecorationStream::Stdout | DecorationStream::Tty | DecorationStream::None
                    ));
                }
            }
        }
    }

    #[test]
    fn render_header_plain_has_no_ansi_and_includes_query_and_mode() {
        let lines = render_header("myquery", "pattern", ansi(false));
        let joined = lines.join("\n");
        assert!(!joined.contains('\x1b'));
        assert!(joined.contains('█'));
        assert!(joined.contains("myquery"));
        assert!(joined.contains("[pattern]"));
    }

    #[test]
    fn render_header_colored_emits_ansi() {
        let lines = render_header("q", "auto", ansi(true));
        assert!(lines.join("\n").contains('\x1b'));
    }

    #[test]
    fn build_url_requests_no_color_and_no_decorate_when_captured() {
        let mut opts = Options::default();
        opts.query = Some("x".into());
        let captured = build_url(&opts, false, false, false);
        assert!(captured.contains("&color=false"));
        assert!(captured.contains("&decorate=false"));
        let human = build_url(&opts, true, true, false);
        assert!(!human.contains("color=false"));
        assert!(!human.contains("decorate=false"));
    }

    #[test]
    fn grep_subcommand_parses_pattern_and_mode() {
        let args: Vec<String> = ["grep", "searchLines"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let opts = parse_args(&args).unwrap();
        assert!(opts.grep);
        assert_eq!(opts.mode, "grep");
        assert!(opts.no_expand && opts.no_rerank);
        assert_eq!(opts.query.as_deref(), Some("searchLines"));
        // grep sends the pattern as both q and regex, with rerank/expand off.
        let url = build_url(&opts, false, false, true);
        assert!(url.contains("&agent=true"));
        assert!(url.contains("mode=grep"));
        assert!(url.contains("regex=searchLines"));
        assert!(url.contains("expand=false"));
        assert!(url.contains("rerank=false"));
    }

    #[test]
    fn dash_e_sets_pattern_mode_and_regex() {
        let args: Vec<String> = ["-e", "fn.*sort", "sorting"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let opts = parse_args(&args).unwrap();
        assert!(!opts.grep);
        assert_eq!(opts.mode, "pattern");
        assert_eq!(opts.regex.as_deref(), Some("fn.*sort"));
        assert_eq!(opts.query.as_deref(), Some("sorting"));
        let url = build_url(&opts, true, true, false);
        assert!(url.contains("mode=pattern"));
        assert!(url.contains("regex=fn.%2Asort")); // '*' percent-encoded
        assert!(url.contains("q=sorting"));
    }

    #[test]
    fn grep_flags_thread_through_to_url() {
        let args: Vec<String> = [
            "grep",
            "TODO",
            "--type",
            "function",
            "-C",
            "2",
            "--max-matches",
            "5",
            "-F",
            "--glob",
            "*.rs",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let opts = parse_args(&args).unwrap();
        let url = build_url(&opts, false, false, false);
        assert!(url.contains("type=function"));
        assert!(url.contains("contextLines=2"));
        assert!(url.contains("maxMatches=5"));
        assert!(url.contains("fixedString=true"));
        assert!(url.contains("glob="));
    }
}
