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
            env::current_dir().map(|c| c.join(p)).unwrap_or_else(|_| p.to_path_buf())
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

fn print_header(query: &str) {
    let query_display_len = query.chars().count() + 2; // +2 for quotes
    let padding = if query_display_len < 32 { 32 - query_display_len } else { 0 };
    println!();
    println!("{D1}  {FA}{L1}{R}{D1}{:>32}{R}", "");
    println!(
        "{D1}  {FA}{L2}{R}{D2}{:>pad$}{FW}\"{query}\"{R}{D1}  {R}",
        "",
        pad = padding
    );
}

fn print_usage(prog: &str) {
    println!("{FA}{L1}\n{L2}{R}\n");
    println!("{FW}Usage:{R} {prog} \"query\" [options]\n");
    println!("{FW}Options:{R}");
    println!("  -k, --top <n>       Number of results (default: 10)");
    println!("  -m, --mode <mode>   Search mode: auto, lexical, semantic, hybrid");
    println!("  -s, --summary       Summary-first output {FY}(10x token reduction){R}");
    println!("      --mid           Middle-res output {FY}(5x token reduction){R}");
    println!("  -j, --json          JSON output");
    println!("      --no-expand     Disable graph expansion");
    println!("      --no-rerank     Disable reranking");
    println!("  -f, --fusion <type> Fusion method: cc (default) or rrf");
    println!("      --no-late-interaction  Disable late interaction {FY}(enabled by default){R}");
    println!("      --stop          Stop the search server");
    println!("  -v, --verbose       Verbose output");
    println!("  -h, --help          Show this help");
    println!("\n{FW}Examples:{R}");
    println!("  {prog} \"AuthService\"                    {FG}# Lexical search{R}");
    println!("  {prog} \"how does auth work\" -s          {FG}# Semantic + summary{R}");
    println!("  {prog} \"BotDetection\" -k 5 -m lexical   {FG}# 5 results, force lexical{R}");
    println!("  {prog} \"employee\" --mid                 {FG}# Middle-res view{R}");
    println!("  {prog} --stop                            {FG}# Stop server{R}");
}

fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut opts = Options::default();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        match arg.as_str() {
            "-k" | "--top" => {
                i += 1;
                opts.top_k = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(10);
                if opts.top_k == 0 { opts.top_k = 10; }
            }
            "-m" | "--mode" => {
                i += 1;
                if let Some(v) = args.get(i) { opts.mode = v.clone(); }
            }
            "-s" | "--summary" => opts.summary = true,
            "--mid" => opts.mid = true,
            "-j" | "--json" => opts.json = true,
            "--no-expand" => opts.no_expand = true,
            "--no-rerank" => opts.no_rerank = true,
            "-f" | "--fusion" => {
                i += 1;
                if let Some(v) = args.get(i) { opts.fusion = v.clone(); }
            }
            "--no-late-interaction" | "--no-colbert" => opts.no_late_interaction = true,
            "--stop" => opts.stop = true,
            "-v" | "--verbose" => opts.verbose = true,
            "-h" | "--help" => opts.help = true,
            other => {
                if other.starts_with('-') {
                    return Err(format!("Unknown option: {other}"));
                }
                if opts.query.is_none() {
                    opts.query = Some(other.to_string());
                }
            }
        }
        i += 1;
    }
    Ok(opts)
}

fn build_url(opts: &Options) -> String {
    let query = opts.query.as_deref().unwrap_or("");
    let encoded = url_encode(query);
    let format = if opts.json { "json" } else { "text" };

    let mut url = format!("/search?q={encoded}&k={}&format={format}", opts.top_k);

    if opts.mode != "auto" {
        url.push_str(&format!("&mode={}", opts.mode));
    }
    if opts.summary { url.push_str("&summary=true"); }
    if opts.mid { url.push_str("&mid=true"); }
    if opts.no_expand { url.push_str("&expand=false"); }
    if opts.no_rerank { url.push_str("&rerank=false"); }
    if opts.fusion != "cc" {
        url.push_str(&format!("&fusion={}", opts.fusion));
    }
    if opts.no_late_interaction { url.push_str("&late-interaction=false"); }

    url
}

fn find_socket() -> Option<String> {
    // Only this project's socket (explicit override or per-project derived). No
    // global legacy `/tmp/search.sock` fallback — it routed project B's queries
    // to project A's server (C3).
    let primary = socket_path();
    if Path::new(&primary).exists() {
        Some(primary)
    } else {
        None
    }
}

fn do_request(socket_path: &str, path: &str, show_header: bool, query: Option<&str>) -> io::Result<()> {
    if show_header {
        if let Some(q) = query {
            print_header(q);
        }
    }

    let mut stream = UnixStream::connect(socket_path)?;

    let request = format!("GET {path} HTTP/1.0\r\nHost: l\r\n\r\n");
    stream.write_all(request.as_bytes())?;
    // Do NOT shutdown(Write) — breaks async responses (summary mode). HTTP/1.0 EOF signals end.

    let stdout = io::stdout();
    let mut out = stdout.lock();
    let mut buf = [0u8; BUFFER_SIZE];
    let mut headers_done = false;

    loop {
        let n = stream.read(&mut buf)?;
        if n == 0 { break; }

        if !headers_done {
            // Scan for \r\n\r\n header terminator
            if let Some(pos) = find_header_end(&buf[..n]) {
                headers_done = true;
                let body_start = pos + 4;
                if body_start < n {
                    out.write_all(&buf[body_start..n])?;
                }
            }
        } else {
            out.write_all(&buf[..n])?;
        }
    }

    out.flush()?;
    Ok(())
}

fn find_header_end(data: &[u8]) -> Option<usize> {
    data.windows(4).position(|w| w == b"\r\n\r\n")
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
        eprintln!("{FA}Error:{R} Failed to start server: {e}");
        return None;
    }

    // Poll for socket (100ms intervals, max 50 attempts = 5s)
    for _ in 0..50 {
        thread::sleep(Duration::from_millis(100));
        if let Some(path) = find_socket() {
            return Some(path);
        }
    }

    eprintln!("{FA}Error:{R} Server did not start within 5 seconds");
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
        let candidate = ancestor.join("node_modules").join("sweet-search").join(&rel);
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
                if ancestor.file_name().map(|n| n == "node_modules").unwrap_or(false) {
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
            eprintln!("{FA}Error:{R} Cannot find core/start-server.js. Tried:");
            for t in &tried {
                eprintln!("  - {}", t.display());
            }
            eprintln!(
                "Set $SWEET_SEARCH_SERVER_ENTRY to the path of start-server.js to override."
            );
            None
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let prog = args.first().map(|s| {
        Path::new(s).file_name().unwrap_or_default().to_string_lossy().into_owned()
    }).unwrap_or_else(|| "sweet-search".into());

    let cli_args: Vec<String> = args.into_iter().skip(1).collect();

    let opts = match parse_args(&cli_args) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("{FA}Error:{R} {e}");
            print_usage(&prog);
            process::exit(1);
        }
    };

    if opts.help {
        print_usage(&prog);
        return;
    }

    if opts.stop {
        let socket = match find_socket() {
            Some(s) => s,
            None => {
                eprintln!("{FA}Error:{R} No server running (socket not found)");
                process::exit(1);
            }
        };
        println!("{FA}Stopping server...{R}");
        if let Err(e) = do_request(&socket, "/stop", false, None) {
            eprintln!("{FA}Error:{R} {e}");
            process::exit(1);
        }
        return;
    }

    let query = match &opts.query {
        Some(q) if !q.is_empty() => q.clone(),
        _ => {
            print_usage(&prog);
            return;
        }
    };

    if opts.verbose {
        println!("{FG}Query:{R} {query}");
        println!("{FG}Mode:{R} {}", opts.mode);
        println!("{FG}Top K:{R} {}", opts.top_k);
        if opts.summary { println!("{FG}Format:{R} summary"); }
        if opts.mid { println!("{FG}Format:{R} mid"); }
        if opts.no_expand { println!("{FG}Graph expansion:{R} disabled"); }
        if opts.no_rerank { println!("{FG}Reranking:{R} disabled"); }
        if opts.no_late_interaction { println!("{FG}Late Interaction:{R} disabled"); }
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

    let url = build_url(&opts);
    let show_header = !opts.json;

    if let Err(e) = do_request(&socket, &url, show_header, Some(&query)) {
        eprintln!("{FA}Error:{R} {e}");
        process::exit(1);
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
        let (found, _) =
            resolve_server_script(Path::new("/repo"), None, None, &exists);
        assert_eq!(found, Some(PathBuf::from("/repo/core/start-server.js")));
    }

    #[test]
    fn npm_install_resolves_from_cwd_upward() {
        // Invoked from a subdir of a project that installed the package.
        let target = "/proj/node_modules/sweet-search/core/start-server.js";
        let exists = exists_set(&[target]);
        let (found, _) = resolve_server_script(
            Path::new("/proj/src/deep"),
            None,
            None,
            &exists,
        );
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
        assert!(tried.iter().any(|p| p
            == &PathBuf::from("/proj/node_modules/sweet-search/core/start-server.js")));
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
    fn derived_socket_is_stable_for_same_root() {
        assert_eq!(
            derive_socket(None, "/private/tmp/projA"),
            derive_socket(None, "/private/tmp/projA")
        );
    }
}
