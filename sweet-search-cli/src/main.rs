// sweet-search CLI — native launcher (~2-5ms warm path)
//
// Port of ss-fast/ss-fast.c. Connects to the warm server via Unix socket.
// Auto-starts the Node server on cold start (matching ss.sh behavior).
//
// Compile: cargo build --release

use std::env;
use std::io::{self, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{self, Command, Stdio};
use std::thread;
use std::time::Duration;

const DEFAULT_SOCKET_PATH: &str = "/tmp/sweet-search.sock";
const SOCKET_PATH_LEGACY: &str = "/tmp/search.sock";
const BUFFER_SIZE: usize = 16384;

/// Return the socket path from $SWEET_SEARCH_SOCKET_PATH or the default.
fn socket_path() -> String {
    env::var("SWEET_SEARCH_SOCKET_PATH").unwrap_or_else(|_| DEFAULT_SOCKET_PATH.to_string())
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
    let primary = socket_path();
    if Path::new(&primary).exists() {
        Some(primary)
    } else if Path::new(SOCKET_PATH_LEGACY).exists() {
        Some(SOCKET_PATH_LEGACY.to_string())
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
        Some(s) => s.as_str(),
        None => {
            eprintln!("{FA}Error:{R} Cannot find core/start-server.js");
            eprintln!("Start server manually: node core/start-server.js");
            return None;
        }
    };

    // Spawn server in background.
    // Inherit env so SWEET_SEARCH_SOCKET_PATH passes through to the Node server.
    let spawn_result = Command::new("node")
        .arg(script)
        .arg("--serve")
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

fn find_server_script() -> Option<String> {
    // Use core/start-server.js — a minimal entry point that avoids the circular
    // import in sweet-search.js which causes Node's "unsettled top-level await" exit.
    let script_name = "core/start-server.js";

    // Try relative to current working directory
    let cwd_script = Path::new(script_name);
    if cwd_script.exists() {
        if let Ok(abs) = cwd_script.canonicalize() {
            return Some(abs.to_string_lossy().into_owned());
        }
        return Some(cwd_script.to_string_lossy().into_owned());
    }

    // Try relative to the binary location
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Binary might be in sweet-search-cli/target/release/ or repo root
            for ancestor in dir.ancestors() {
                let candidate = ancestor.join(script_name);
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().into_owned());
                }
            }
        }
    }

    None
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
