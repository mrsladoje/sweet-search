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

/// Run the tool in a fresh node process (core/agent-tools/cli.js). Never returns.
fn run_in_process(sub: &str, args: &[String]) -> ! {
    let script = super::find_package_file(&Path::new("core").join("agent-tools").join("cli.js"));
    let script = match script {
        Some(s) => s,
        None => {
            eprintln!("[ss-*] cannot find core/agent-tools/cli.js next to this binary or under node_modules/sweet-search");
            process::exit(1);
        }
    };
    let err = Command::new("node").arg(script).arg(sub).args(args).exec();
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
    if env::var("SWEET_SEARCH_AGENT_TOOLS_VIA_DAEMON").map_or(false, |v| falsey(&v)) {
        run_in_process(sub, args);
    }
    let cwd = match env::current_dir() {
        Ok(c) => c,
        Err(_) => run_in_process(sub, args),
    };
    let explicit = env::var("SWEET_SEARCH_PROJECT_ROOT").ok();
    let root = match index_root(&cwd, explicit.as_deref()) {
        Some(r) => super::project_root_from(r),
        None => run_in_process(sub, args),
    };
    let socket = match super::find_socket_for(&root).or_else(|| super::auto_start_server_for(&root, true)) {
        Some(s) => s,
        None => run_in_process(sub, args),
    };

    let env_map: serde_json::Map<String, Value> = env::vars_os()
        .map(|(k, v)| {
            (
                k.to_string_lossy().into_owned(),
                Value::String(v.to_string_lossy().into_owned()),
            )
        })
        .collect();
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
        Err(_) => run_in_process(sub, args),
    };

    // Any transport failure means the daemon did not answer this call (or died with it,
    // taking its per-session state along); run it here instead.
    let (status, reply) = match super::http_transport::post_json(&socket, "/agent-tool", &body) {
        Ok(r) => r,
        Err(_) => run_in_process(sub, args),
    };
    if status != 200 {
        // 404 (a daemon from before this route), 409 (another repository), 503 (still
        // loading), 4xx (a request it refused): the tool did not run.
        if status < 500 || status == 503 {
            run_in_process(sub, args);
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
}
