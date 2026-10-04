//! The ss-* agent tools as one native multi-call binary.
//!
//! npm links `ss-search`, `ss-grep`, `ss-find`, `ss-read`, `ss-semantic` and `ss-trace`
//! onto the PATH; the install step replaces each of those files with this binary, and it
//! dispatches on the name it was called by. A call is one round trip: the caller's
//! arguments, working directory, environment and pid go to the project's resident daemon
//! (POST /agent-tool), which runs the tool code warm and returns its stdout, stderr and
//! exit code. No node process starts on this path.
//!
//! When the daemon cannot take the call — none can be started, it predates the route
//! (404), it serves another repository (409), it is still loading (503) — the tool runs
//! in a fresh node process instead (core/agent-tools/cli.js), which is the same code with
//! the same output contract. Nothing is printed before that hand-over, so the agent sees
//! exactly one answer either way.
//!
//! Output contract (the old bash wrappers'): stdout always; stderr only on a non-zero
//! exit. stderr carries engine logs and meta lines an agent must not see on success.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{self, Command};

use serde_json::{json, Value};

/// Printed by `sweet-search --agent-tools-protocol`. The JS side reads it out of the
/// binary before it lets the binary stand in for an ss-* command
/// (core/agent-tools/tools.js AGENT_TOOLS_PROTOCOL_MARKER).
pub const PROTOCOL_MARKER: &str = "sweet-search-agent-tools-protocol=1";

/// Command name → subcommand of runAgentTool. Mirrors core/agent-tools/tools.js.
const TOOLS: [(&str, &str); 6] = [
    ("ss-search", "agent-search"),
    ("ss-grep", "grep"),
    ("ss-find", "find"),
    ("ss-read", "read"),
    ("ss-semantic", "semantic"),
    ("ss-trace", "trace"),
];

const INDEX_DB: &str = "codebase.db";

/// The subcommand for a program name (`/usr/local/bin/ss-grep` → `grep`), or None when
/// this binary was not called as an ss-* tool.
pub fn subcommand_for(prog: &str) -> Option<&'static str> {
    TOOLS
        .iter()
        .find(|(name, _)| *name == prog)
        .map(|(_, sub)| *sub)
}

fn has_index(dir: &Path) -> bool {
    dir.join(".sweet-search").join(INDEX_DB).is_file()
}

/// The main checkout of the linked git worktree whose top is `dir`, when `dir/.git` is a
/// linked worktree's `.git` file. Read from `gitdir: …` and the gitdir's `commondir`, the
/// same facts `git rev-parse --git-common-dir` reports, without starting git. A main
/// checkout (`.git` directory) and a submodule (no `commondir`) are not linked worktrees.
fn linked_worktree_main_at(dir: &Path) -> Option<PathBuf> {
    let dot_git = dir.join(".git");
    if !fs::symlink_metadata(&dot_git).ok()?.is_file() {
        return None;
    }
    let text = fs::read_to_string(&dot_git).ok()?;
    let gitdir = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
    let gitdir = dir.join(gitdir);
    let rel = fs::read_to_string(gitdir.join("commondir")).ok()?;
    let common = fs::canonicalize(gitdir.join(rel.trim())).ok()?;
    if fs::canonicalize(&gitdir).ok()? == common {
        return None;
    }
    common.parent().map(Path::to_path_buf)
}

/// The repository whose daemon should take this call: the explicit
/// $SWEET_SEARCH_PROJECT_ROOT, else the first directory at or above `cwd` that decides —
/// one that holds an index, or the top of a linked worktree (its main checkout, when that
/// holds an index). The tool code walks the same way (core/search/worktree-roots.js
/// resolveRoots), so a worktree nested inside its main checkout is still a worktree. None
/// hands the call to the in-process runner, which prints the right refusal. The daemon
/// re-derives the root and refuses (409) a call that is not its own, so a wrong guess here
/// costs speed, never correctness.
fn index_root(cwd: &Path, explicit: Option<&str>) -> Option<PathBuf> {
    if let Some(root) = explicit.filter(|r| !r.is_empty()) {
        return Some(super::canonicalize_path(Path::new(root)));
    }
    for dir in cwd.ancestors() {
        if has_index(dir) {
            return Some(dir.to_path_buf());
        }
        if let Some(main) = linked_worktree_main_at(dir) {
            return Some(main).filter(|m| has_index(m));
        }
    }
    None
}

fn falsey(v: &str) -> bool {
    matches!(
        v.trim().to_ascii_lowercase().as_str(),
        "0" | "false" | "off" | "no"
    )
}

// ---------------------------------------------------------------------------------------
// Chained calls. One shell command that runs two or more ss-* tools prints, before each
// later tool's output, one boundary line (the tool's own code prints it; this client only
// decides the position). Same rule, same registry files as core/agent-tools/chain.js:
// key = the shell process (pid + start time) — the parent when the parent is a shell,
// else this process itself (a shell execs the last command of `-c`, so that tool IS the
// shell; its parent is the long-lived harness and must never be the key). The first tool
// of a shell creates /tmp/sweet-search-chain-<uid>/<key>; a later one finds it.
// ---------------------------------------------------------------------------------------

const CHAIN_LATER_ENV: &str = "SWEET_SEARCH_CHAIN_LATER";
const CHAIN_PID_ENV: &str = "SWEET_SEARCH_CHAIN_PID";
const CHAIN_TTL_SECS: u64 = 30 * 60;
const SHELLS: [&str; 11] = [
    "sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "fish", "tcsh", "csh", "busybox",
];

struct ProcInfo {
    ppid: i32,
    comm: String,
    start: String,
}

fn is_shell_name(comm: &str) -> bool {
    let base = comm.trim().rsplit('/').next().unwrap_or("");
    SHELLS.contains(&base.trim_start_matches('-'))
}

#[cfg(target_os = "macos")]
fn proc_info(pid: i32) -> Option<ProcInfo> {
    if pid < 1 {
        return None;
    }
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
    let n = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut info as *mut libc::proc_bsdinfo as *mut libc::c_void,
            size,
        )
    };
    if n != size {
        return None;
    }
    let comm: Vec<u8> = info
        .pbi_comm
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
    Some(ProcInfo {
        ppid: info.pbi_ppid as i32,
        comm: String::from_utf8_lossy(&comm).into_owned(),
        start: info.pbi_start_tvsec.to_string(),
    })
}

#[cfg(target_os = "linux")]
fn proc_info(pid: i32) -> Option<ProcInfo> {
    if pid < 1 {
        return None;
    }
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    let fields: Vec<&str> = stat.get(close + 2..)?.split(' ').collect();
    Some(ProcInfo {
        ppid: fields.get(1)?.parse().ok()?,
        comm: stat[open + 1..close].to_string(),
        start: fields.get(19)?.to_string(),
    })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn proc_info(_pid: i32) -> Option<ProcInfo> {
    None
}

fn chain_key(self_pid: i32, info: &dyn Fn(i32) -> Option<ProcInfo>) -> Option<String> {
    let me = info(self_pid)?;
    if me.ppid > 1 {
        if let Some(parent) = info(me.ppid) {
            if is_shell_name(&parent.comm) {
                return Some(format!("{}-{}", me.ppid, parent.start));
            }
        }
    }
    Some(format!("{}-{}", self_pid, me.start))
}

fn chain_dir() -> PathBuf {
    let uid = unsafe { libc::getuid() };
    PathBuf::from(format!("/tmp/sweet-search-chain-{uid}"))
}

fn age_secs(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    Some(
        std::time::SystemTime::now()
            .duration_since(modified)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    )
}

/// True when an earlier call of the same shell registered first.
fn register_chain_call(dir: &Path, key: &str) -> bool {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    if fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .is_err()
    {
        return false;
    }
    let file = dir.join(key);
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&file)
    {
        Ok(_) => {
            if let Ok(entries) = fs::read_dir(dir) {
                for e in entries.flatten() {
                    if age_secs(&e.path()).map_or(false, |a| a > CHAIN_TTL_SECS) {
                        let _ = fs::remove_file(e.path());
                    }
                }
            }
            false
        }
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
            let fresh = age_secs(&file).map_or(false, |a| a <= CHAIN_TTL_SECS);
            let _ = fs::File::options()
                .write(true)
                .open(&file)
                .and_then(|f| f.set_modified(std::time::SystemTime::now()));
            fresh
        }
        Err(_) => false,
    }
}

/// "1" when this call is a later call of a chained command, else "0". An answer already
/// in the environment (a launcher decided) stands.
fn chain_position() -> &'static str {
    match env::var(CHAIN_LATER_ENV).as_deref() {
        Ok("1") => return "1",
        Ok("0") => return "0",
        _ => {}
    }
    let pid = env::var(CHAIN_PID_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<i32>().ok())
        .filter(|p| *p > 1)
        .unwrap_or(process::id() as i32);
    match chain_key(pid, &proc_info) {
        Some(key) if register_chain_call(&chain_dir(), &key) => "1",
        _ => "0",
    }
}

/// Run the tool in a fresh node process (core/agent-tools/cli.js). Never returns.
fn run_in_process(sub: &str, args: &[String], chain: &str) -> ! {
    let script = super::find_package_file(&Path::new("core").join("agent-tools").join("cli.js"));
    let script = match script {
        Some(s) => s,
        None => {
            // A shim left behind after `npm uninstall -g sweet-search` (npm 7+ runs no
            // uninstall script), or a project whose package predates the ss-* commands.
            let me = env::current_exe()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| "this command".into());
            eprintln!(
                "[ss-*] sweet-search is not installed here (no node_modules/sweet-search above this directory, no sweet-search on PATH): run npm i -g sweet-search, or remove {me}"
            );
            process::exit(127);
        }
    };
    let err = Command::new("node")
        .arg(script)
        .arg(sub)
        .args(args)
        .env(CHAIN_LATER_ENV, chain)
        .exec();
    eprintln!("[ss-*] failed to start node: {err}");
    process::exit(1);
}

fn write_out(bytes: &[u8], stderr: bool) {
    // A closed pipe (`ss-grep … | head`) is not an error worth reporting.
    let _ = if stderr {
        let mut e = io::stderr().lock();
        e.write_all(bytes).and_then(|_| e.flush())
    } else {
        let mut o = io::stdout().lock();
        o.write_all(bytes).and_then(|_| o.flush())
    };
}

/// One ss-* call. Never returns.
pub fn run(sub: &str, args: &[String]) -> ! {
    // Decided once, before either path runs the tool: the in-process runner gets it in its
    // environment and must not register the call a second time.
    let chain = chain_position();
    if env::var("SWEET_SEARCH_AGENT_TOOLS_VIA_DAEMON").map_or(false, |v| falsey(&v)) {
        run_in_process(sub, args, chain);
    }
    let cwd = match env::current_dir() {
        Ok(c) => c,
        Err(_) => run_in_process(sub, args, chain),
    };
    let explicit = env::var("SWEET_SEARCH_PROJECT_ROOT").ok();
    let root = match index_root(&cwd, explicit.as_deref()) {
        Some(r) => super::project_root_from(r),
        None => run_in_process(sub, args, chain),
    };
    // The call goes straight to the socket: no connect-and-drop probe first (each connection
    // costs the daemon an accept). A missing or refused socket starts the daemon, once.
    let socket = super::socket_path_for(&root);

    let mut env_map: serde_json::Map<String, Value> = env::vars_os()
        .map(|(k, v)| {
            (
                k.to_string_lossy().into_owned(),
                Value::String(v.to_string_lossy().into_owned()),
            )
        })
        .collect();
    env_map.insert(CHAIN_LATER_ENV.into(), Value::String(chain.into()));
    let payload = json!({
        "v": 1,
        "tool": sub,
        "args": args,
        "cwd": cwd.to_string_lossy(),
        "env": env_map,
        "pid": process::id(),
    });
    let body = match serde_json::to_vec(&payload) {
        Ok(b) => b,
        Err(_) => run_in_process(sub, args, chain),
    };

    // Any transport failure means the daemon did not answer this call (or died with it,
    // taking its per-session state along); run it here instead.
    let mut started = false;
    let (status, reply) = loop {
        match super::http_transport::post_json(&socket, "/agent-tool", &body) {
            Ok(r) => break r,
            Err(e) if !started
                && matches!(e.kind(), io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused) =>
            {
                started = true;
                if super::auto_start_server_for(&root, true).is_none() {
                    run_in_process(sub, args, chain);
                }
            }
            Err(_) => run_in_process(sub, args, chain),
        }
    };
    if status != 200 {
        // 404 (a daemon from before this route), 409 (another repository), 503 (still
        // loading), 4xx (a request it refused): the tool did not run.
        if status < 500 || status == 503 {
            run_in_process(sub, args, chain);
        }
        // 500: the tool started and failed inside the daemon. Do not run it twice.
        write_out(&reply, true);
        write_out(b"\n", true);
        process::exit(1);
    }
    let reply: Value = match serde_json::from_slice(&reply) {
        Ok(v) => v,
        Err(_) => {
            eprintln!("[ss-*] invalid reply from the Sweet Search daemon");
            process::exit(1);
        }
    };
    let code = reply.get("code").and_then(Value::as_i64).unwrap_or(1) as i32;
    if let Some(out) = reply.get("stdout").and_then(Value::as_str) {
        write_out(out.as_bytes(), false);
    }
    if code != 0 {
        if let Some(err) = reply.get("stderr").and_then(Value::as_str) {
            write_out(err.as_bytes(), true);
        }
    }
    process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static N: AtomicU64 = AtomicU64::new(0);

    fn temp_dir(label: &str) -> PathBuf {
        let d = env::temp_dir().join(format!(
            "ss-agent-tools-{label}-{}-{}",
            process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&d).unwrap();
        fs::canonicalize(d).unwrap()
    }

    fn index(dir: &Path) {
        fs::create_dir_all(dir.join(".sweet-search")).unwrap();
        fs::write(dir.join(".sweet-search").join(INDEX_DB), b"").unwrap();
    }

    #[test]
    fn maps_every_tool_name_and_nothing_else() {
        assert_eq!(subcommand_for("ss-search"), Some("agent-search"));
        assert_eq!(subcommand_for("ss-grep"), Some("grep"));
        assert_eq!(subcommand_for("ss-find"), Some("find"));
        assert_eq!(subcommand_for("ss-read"), Some("read"));
        assert_eq!(subcommand_for("ss-semantic"), Some("semantic"));
        assert_eq!(subcommand_for("ss-trace"), Some("trace"));
        assert_eq!(subcommand_for("sweet-search"), None);
        assert_eq!(subcommand_for("ss-batch"), None);
        assert_eq!(subcommand_for("grep"), None);
    }

    #[test]
    fn root_is_the_nearest_indexed_ancestor() {
        let repo = temp_dir("repo");
        index(&repo);
        let sub = repo.join("src").join("deep");
        fs::create_dir_all(&sub).unwrap();
        assert_eq!(index_root(&repo, None), Some(repo.clone()));
        assert_eq!(index_root(&sub, None), Some(repo.clone()));
        fs::remove_dir_all(repo).unwrap();
    }

    #[test]
    fn explicit_root_wins_and_no_index_means_none() {
        let bare = temp_dir("bare");
        assert_eq!(index_root(&bare, None), None);
        let other = temp_dir("other");
        assert_eq!(index_root(&bare, Some(other.to_str().unwrap())), Some(other.clone()));
        assert_eq!(index_root(&bare, Some("")), None);
        fs::remove_dir_all(bare).unwrap();
        fs::remove_dir_all(other).unwrap();
    }

    #[test]
    fn linked_worktree_resolves_to_the_indexed_main_checkout() {
        let main = temp_dir("main");
        index(&main);
        let gitdir = main.join(".git").join("worktrees").join("wt1");
        fs::create_dir_all(&gitdir).unwrap();
        fs::write(gitdir.join("commondir"), "../..\n").unwrap();
        let wt = temp_dir("wt");
        fs::write(wt.join(".git"), format!("gitdir: {}\n", gitdir.display())).unwrap();
        let inside = wt.join("pkg");
        fs::create_dir_all(&inside).unwrap();
        assert_eq!(linked_worktree_main_at(&wt), Some(main.clone()));
        assert_eq!(linked_worktree_main_at(&inside), None);
        assert_eq!(index_root(&inside, None), Some(main.clone()));
        // The main checkout itself is not a linked worktree.
        fs::write(main.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(linked_worktree_main_at(&main), None);
        fs::remove_dir_all(wt).unwrap();
        fs::remove_dir_all(main).unwrap();
    }

    #[test]
    fn worktree_nested_in_its_indexed_main_is_still_a_worktree() {
        // <repo>/.claude/worktrees/x: the worktree's top decides before <repo> does.
        let main = temp_dir("main-nested");
        index(&main);
        let gitdir = main.join(".git").join("worktrees").join("x");
        fs::create_dir_all(&gitdir).unwrap();
        fs::write(gitdir.join("commondir"), "../..\n").unwrap();
        let wt = main.join(".claude").join("worktrees").join("x");
        fs::create_dir_all(wt.join("src")).unwrap();
        fs::write(wt.join(".git"), format!("gitdir: {}\n", gitdir.display())).unwrap();
        assert_eq!(index_root(&wt.join("src"), None), Some(main.clone()));
        // A worktree of another, unindexed repository inside an indexed directory has no
        // root: the outer index does not describe its files.
        let other = temp_dir("other-main");
        let other_gitdir = other.join(".git").join("worktrees").join("y");
        fs::create_dir_all(&other_gitdir).unwrap();
        fs::write(other_gitdir.join("commondir"), "../..\n").unwrap();
        let foreign = main.join("vendor").join("y");
        fs::create_dir_all(&foreign).unwrap();
        fs::write(foreign.join(".git"), format!("gitdir: {}\n", other_gitdir.display())).unwrap();
        assert_eq!(index_root(&foreign, None), None);
        // A submodule (.git file, no commondir) does not decide: the index above serves.
        let modules = main.join(".git").join("modules").join("sub");
        fs::create_dir_all(&modules).unwrap();
        let sub = main.join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join(".git"), format!("gitdir: {}\n", modules.display())).unwrap();
        assert_eq!(index_root(&sub, None), Some(main.clone()));
        fs::remove_dir_all(main).unwrap();
        fs::remove_dir_all(other).unwrap();
    }

    #[test]
    fn worktree_without_an_indexed_main_has_no_root() {
        let main = temp_dir("main-noindex");
        let gitdir = main.join(".git").join("worktrees").join("wt");
        fs::create_dir_all(&gitdir).unwrap();
        fs::write(gitdir.join("commondir"), "../..\n").unwrap();
        let wt = temp_dir("wt-noindex");
        fs::write(wt.join(".git"), format!("gitdir: {}\n", gitdir.display())).unwrap();
        assert_eq!(index_root(&wt, None), None);
        fs::remove_dir_all(wt).unwrap();
        fs::remove_dir_all(main).unwrap();
    }

    #[test]
    fn falsey_matches_the_js_switch() {
        for v in ["0", "false", "OFF", " no "] {
            assert!(falsey(v));
        }
        for v in ["", "1", "true", "yes"] {
            assert!(!falsey(v));
        }
    }

    #[test]
    fn shell_names_match_the_js_rule() {
        for c in ["zsh", "/bin/zsh", "-bash", "bash", "sh", "/usr/bin/dash", "fish"] {
            assert!(is_shell_name(c), "{c}");
        }
        for c in ["node", "claude", "codex", "opencode", "", "bashful", "ss-read"] {
            assert!(!is_shell_name(c), "{c}");
        }
    }

    fn fake(table: Vec<(i32, i32, &'static str, &'static str)>) -> impl Fn(i32) -> Option<ProcInfo> {
        move |pid| {
            table.iter().find(|r| r.0 == pid).map(|r| ProcInfo {
                ppid: r.1,
                comm: r.2.to_string(),
                start: r.3.to_string(),
            })
        }
    }

    #[test]
    fn chain_key_is_the_shell_parent_or_the_execd_shell_itself() {
        // `ss-a; ss-b` under zsh -c: ss-a is a child of the shell (100), ss-b was exec'd
        // by it (pid 100, parent = the harness 7). Both get the shell's key.
        let info = fake(vec![
            (7, 1, "claude", "50"),
            (100, 7, "zsh", "60"),
            (101, 100, "sweet-search", "61"),
        ]);
        assert_eq!(chain_key(101, &info).as_deref(), Some("100-60"));
        let execd = fake(vec![(7, 1, "claude", "50"), (100, 7, "sweet-search", "60")]);
        assert_eq!(chain_key(100, &execd).as_deref(), Some("100-60"));
        // Two single-command calls of one harness never share a key.
        let other = fake(vec![(7, 1, "claude", "50"), (200, 7, "sweet-search", "90")]);
        assert_eq!(chain_key(200, &other).as_deref(), Some("200-90"));
        assert_eq!(chain_key(999, &info), None);
    }

    #[test]
    fn registry_marks_only_later_calls_of_one_shell() {
        let dir = temp_dir("chain");
        assert!(!register_chain_call(&dir, "100-60"));
        assert!(register_chain_call(&dir, "100-60"));
        assert!(register_chain_call(&dir, "100-60"));
        assert!(!register_chain_call(&dir, "100-61"), "a reused pid has another start time");
        fs::remove_dir_all(dir).unwrap();
    }
}
