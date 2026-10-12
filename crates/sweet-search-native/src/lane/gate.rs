//! What decides whether the lane may answer a call at all, before any search: the call's
//! environment (every switch that changes ss-grep's output or receipts means a decline), its
//! roots (eval/agent-read-workflows/bin/_ss-helpers.mjs top of runAgentTool,
//! core/search/worktree-roots.js resolveRoots), and its session key
//! (core/search/agent-span-ledger.js resolveAgentSessionId).

use serde_json::{Map, Value};
use std::path::Path;

pub(crate) struct Call {
    pub args: Vec<String>,
    pub cwd: String,
    pub env: Map<String, Value>,
    pub pid: i64,
}

impl Call {
    pub fn env(&self, key: &str) -> Option<&str> {
        self.env.get(key).and_then(Value::as_str)
    }
}

pub(crate) fn parse_call(payload: &[u8]) -> Result<Call, &'static str> {
    let v: Value = serde_json::from_slice(payload).map_err(|_| "bad payload")?;
    if v.get("v").and_then(Value::as_i64) != Some(1) {
        return Err("bad payload");
    }
    if v.get("tool").and_then(Value::as_str) != Some("grep") {
        return Err("not grep");
    }
    let args = v
        .get("args")
        .and_then(Value::as_array)
        .ok_or("bad payload")?
        .iter()
        .map(|a| a.as_str().map(str::to_string))
        .collect::<Option<Vec<_>>>()
        .ok_or("bad payload")?;
    let cwd = v.get("cwd").and_then(Value::as_str).ok_or("bad payload")?.to_string();
    if !cwd.starts_with('/') {
        return Err("bad payload");
    }
    let env = v.get("env").and_then(Value::as_object).cloned().ok_or("bad payload")?;
    if !env.values().all(Value::is_string) {
        return Err("bad payload");
    }
    let pid = v.get("pid").and_then(Value::as_i64).filter(|p| *p >= 1).ok_or("bad payload")?;
    Ok(Call { args, cwd, env, pid })
}

// Switches outside the SS_ family that change what an ss-grep call prints or records.
const OUTPUT_SWITCHES: [&str; 6] = [
    "SWEET_SEARCH_COMPACT_OUTPUT",
    "SWEET_SEARCH_EXACT_REREAD_OMISSION",
    "SWEET_SEARCH_SHOWN_SPAN_TRAILER",
    "SWEET_SEARCH_ROUTE_META_DEBUG",
    "SWEET_SEARCH_GUTTER",
    "SWEET_SEARCH_LINE_GUTTER",
];
// worktree-roots.js GIT_LOCATION_VARS: with any of them set only git knows the roots.
const GIT_LOCATION_VARS: [&str; 5] = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_CEILING_DIRECTORIES", "GIT_DISCOVERY_ACROSS_FILESYSTEM"];

/// The SS_* switches the grep path reads (agent-output-fixes.js readFixFlags, _ss-helpers.mjs
/// SS_SIBLING_LINE / SS_GREP_OUTSIDE_SCOPE / SS_VARIANT_*). Other SS_* variables (bench
/// drivers, other tools' switches) do not change an ss-grep answer.
fn is_grep_switch(k: &str) -> bool {
    k.starts_with("SS_FIX_") || k.starts_with("SS_GREP_") || k.starts_with("SS_VARIANT_") || k == "SS_SIBLING_LINE"
}

/// Grep switches, the output switches and git location variables decline.
pub(crate) fn env_allows(call: &Call) -> Result<(), &'static str> {
    if call.env.keys().any(|k| is_grep_switch(k)) {
        return Err("SS_ switch");
    }
    if OUTPUT_SWITCHES.iter().any(|k| call.env.contains_key(*k)) {
        return Err("output switch");
    }
    if GIT_LOCATION_VARS.iter().any(|k| call.env(k).map_or(false, |v| !v.is_empty())) {
        return Err("git location env");
    }
    if call.env("SWEET_SEARCH_CHAIN_LATER").map_or(false, |v| v != "0" && v != "1") {
        return Err("chain position");
    }
    Ok(())
}

fn realpath(p: &str) -> Option<String> {
    std::fs::canonicalize(p).ok().map(|p| p.to_string_lossy().into_owned())
}

fn has_index(dir: &Path) -> bool {
    dir.join(".sweet-search").join("codebase.db").exists()
}

/// The roots the JS tool would use: Some(file_root) when they are the lane's own repository
/// with no worktree split, else a decline. `root` is the lane's canonical root.
pub(crate) fn resolve_roots(call: &Call, root: &str) -> Result<String, &'static str> {
    if let Some(explicit) = call.env("SWEET_SEARCH_PROJECT_ROOT").filter(|s| !s.is_empty()) {
        // resolveRoots takes an explicit root as given; it must be this repository.
        return if realpath(explicit).as_deref() == Some(root) { Ok(explicit.to_string()) } else { Err("explicit root") };
    }
    let here = Path::new(&call.cwd);
    if has_index(here) {
        return if realpath(&call.cwd).as_deref() == Some(root) { Ok(call.cwd.clone()) } else { Err("other index") };
    }
    let real = realpath(&call.cwd).ok_or("cwd")?;
    if real != root && !real.starts_with(&format!("{root}/")) {
        return Err("outside root");
    }
    // Directories between the cwd and the root: a nested index or any .git (a submodule, a
    // linked worktree, a nested repository) is the JS's to resolve.
    let mut dir = Path::new(&real).to_path_buf();
    while dir.to_string_lossy() != root {
        if has_index(&dir) || std::fs::symlink_metadata(dir.join(".git")).is_ok() {
            return Err("nested checkout");
        }
        if !dir.pop() {
            return Err("outside root");
        }
    }
    if std::fs::symlink_metadata(Path::new(root).join(".git")).map_or(false, |m| !m.is_dir()) {
        return Err("root is a linked worktree");
    }
    Ok(root.to_string())
}

/// agent-span-ledger.js validAgentSessionId.
pub(crate) fn valid_session_id(v: &str) -> bool {
    let units = v.encode_utf16().count();
    units > 0 && units <= 256 && !v.chars().any(|c| (c as u32) < 0x20 || c as u32 == 0x7f)
}

/// resolveAgentSessionId for this call: Ok(None) = no key (no receipt), Err = the JS would walk
/// the process tree, which the lane does not.
pub(crate) fn session_id(call: &Call) -> Result<Option<String>, &'static str> {
    for k in ["SWEET_SEARCH_SESSION_ID", "CODEX_THREAD_ID", "CLAUDE_CODE_SESSION_ID"] {
        if let Some(v) = call.env(k) {
            if valid_session_id(v) {
                return Ok(Some(v.to_string()));
            }
        }
    }
    // The native client's stamp (agent_tools.rs harness_stamp), checked as the JS checks it.
    let stand = call.env("SWEET_SEARCH_CHAIN_PID").and_then(|v| v.trim().parse::<i64>().ok()).filter(|p| *p > 1);
    if call.env("SWEET_SEARCH_CHAIN_PID").is_some() && stand.is_none() {
        return Err("chain pid");
    }
    let self_pid = stand.unwrap_or(call.pid);
    let oc = call.env("OPENCODE_PID").unwrap_or("");
    let oc_field = if !oc.is_empty() && oc.bytes().all(|b| b.is_ascii_digit()) { oc } else { "" };
    let stamp = call.env("SWEET_SEARCH_HARNESS_KEY").ok_or("no harness stamp")?;
    let mut parts = stamp.splitn(3, ':');
    let (Some(p), Some(o), Some(key)) = (parts.next(), parts.next(), parts.next()) else { return Err("bad stamp") };
    if !p.bytes().all(|b| b.is_ascii_digit()) || p.is_empty() || !o.bytes().all(|b| b.is_ascii_digit()) {
        return Err("bad stamp");
    }
    if p.parse::<i64>().ok() != Some(self_pid) || o != oc_field {
        return Err("stamp for other inputs");
    }
    Ok((!key.is_empty() && valid_session_id(key)).then(|| key.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(env: &[(&str, &str)], pid: i64) -> Call {
        Call {
            args: vec![],
            cwd: "/x".into(),
            env: env.iter().map(|(k, v)| (k.to_string(), Value::String(v.to_string()))).collect(),
            pid,
        }
    }

    #[test]
    fn switches_decline() {
        assert!(env_allows(&call(&[], 1)).is_ok());
        assert!(env_allows(&call(&[("SS_FIX_GREP_ALLOC", "0")], 1)).is_err());
        assert!(env_allows(&call(&[("SWEET_SEARCH_COMPACT_OUTPUT", "1")], 1)).is_err());
        assert!(env_allows(&call(&[("GIT_DIR", "/g")], 1)).is_err());
        assert!(env_allows(&call(&[("GIT_DIR", "")], 1)).is_ok());
        assert!(env_allows(&call(&[("SWEET_SEARCH_CHAIN_LATER", "1")], 1)).is_ok());
    }

    #[test]
    fn only_grep_switches_decline() {
        assert!(env_allows(&call(&[("SS_BIN", "/x"), ("SS_READ_WINDOW", "40")], 7)).is_ok());
        for k in ["SS_FIX_A", "SS_FIX_GREP_ALLOC", "SS_SIBLING_LINE", "SS_GREP_OUTSIDE_SCOPE", "SS_VARIANT_SENTINEL"] {
            assert!(env_allows(&call(&[(k, "0")], 7)).is_err(), "{k}");
        }
        assert!(env_allows(&call(&[("SWEET_SEARCH_CHAIN_LATER", "2")], 7)).is_err());
    }

    #[test]
    fn session_ids_follow_resolve_agent_session_id() {
        assert_eq!(session_id(&call(&[("CLAUDE_CODE_SESSION_ID", "c")], 7)).unwrap().as_deref(), Some("c"));
        assert_eq!(session_id(&call(&[("CODEX_THREAD_ID", "t"), ("CLAUDE_CODE_SESSION_ID", "c")], 7)).unwrap().as_deref(), Some("t"));
        assert_eq!(session_id(&call(&[("CLAUDE_CODE_SESSION_ID", "a\nb"), ("SWEET_SEARCH_HARNESS_KEY", "7::proc-1-2")], 7)).unwrap().as_deref(), Some("proc-1-2"));
        assert_eq!(session_id(&call(&[("SWEET_SEARCH_HARNESS_KEY", "7::")], 7)).unwrap(), None);
        assert!(session_id(&call(&[("SWEET_SEARCH_HARNESS_KEY", "8::proc-1-2")], 7)).is_err());
        assert!(session_id(&call(&[], 7)).is_err());
        assert_eq!(session_id(&call(&[("OPENCODE_PID", "90"), ("SWEET_SEARCH_HARNESS_KEY", "7:90:proc-90-5")], 7)).unwrap().as_deref(), Some("proc-90-5"));
        assert!(session_id(&call(&[("OPENCODE_PID", "90"), ("SWEET_SEARCH_HARNESS_KEY", "7::proc-90-5")], 7)).is_err());
        assert_eq!(session_id(&call(&[("SWEET_SEARCH_CHAIN_PID", "6"), ("SWEET_SEARCH_HARNESS_KEY", "6::k")], 7)).unwrap().as_deref(), Some("k"));
        assert!(session_id(&call(&[("SWEET_SEARCH_CHAIN_PID", "1"), ("SWEET_SEARCH_HARNESS_KEY", "7::k")], 7)).is_err());
    }
}
