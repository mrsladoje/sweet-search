//! The native ss-grep lane: the daemon answers `ss-grep` from a Rust thread, without running
//! the JS tool, when it can print exactly the bytes the JS tool would
//! (eval/agent-read-workflows/bin/_ss-helpers.mjs cmdGrep). Anything else is DECLINED and the
//! native client sends the call to the JS route (POST /agent-tool) as before. That includes
//! every call while the maintainer's reindex queue holds files (state.rs reindex_pending).
//!
//! Wire (Unix socket `<daemon socket>.grep`, one call per connection):
//!   request   u32 BE length, then the /agent-tool JSON payload {v, tool, args, cwd, env, pid}
//!   reply     b'D' (declined: ask the JS route), or b'H', i32 BE exit code, u32 BE length,
//!             stdout bytes (stderr is empty on every answered call).
//!
//! Receipts: an answered call owes the shown-span ledger (JS, core/search/agent-span-ledger.js)
//! the `observe` the JS tool sends (recordAgentToolCall). The lane queues it; the daemon drains
//! the queue before it handles any other ss-* call, so the ledger sees calls in order.

mod adapt;
mod baregrep;
mod engine;
mod gate;
mod graph;
mod graph_impl;
mod overlay;
mod pipeline;
mod server;
mod sqlite;
mod state;

use napi_derive::napi;
use std::sync::{Arc, Mutex, OnceLock};

/// What the JS tool's recordAgentToolCall would send for an answered call.
#[napi(object)]
#[derive(Clone, Debug)]
pub struct LaneReceipt {
    pub session_id: String,
    pub query: Option<String>,
    pub regex: Option<String>,
}

#[napi(object)]
pub struct LaneOptions {
    /// The lane's socket (the daemon's socket path + ".grep").
    pub socket_path: String,
    /// The repository root the daemon serves (canonical).
    pub project_root: String,
    /// The index state dir (`<root>/.sweet-search`).
    pub state_dir: String,
}

#[napi(object)]
pub struct LaneReply {
    pub handled: bool,
    pub code: i32,
    pub stdout: String,
    /// Why the call was declined (diagnostics; empty when handled).
    pub reason: String,
}

#[napi(object)]
pub struct LaneStats {
    pub running: bool,
    pub handled: u32,
    pub declined: u32,
}

pub(crate) struct LaneConfig {
    pub project_root: String,
    pub state_dir: String,
}

pub(crate) enum Outcome {
    Answer { code: i32, stdout: String, receipt: Option<LaneReceipt> },
    Decline(&'static str),
}

#[derive(Default)]
pub(crate) struct Counters {
    pub handled: u32,
    pub declined: u32,
}

pub(crate) struct Lane {
    pub config: LaneConfig,
    pub counters: Mutex<Counters>,
    /// The index and graph the lane has loaded (one call at a time uses them).
    pub loaded: Mutex<state::Loaded>,
    /// The manifest as last parsed, with its file's stat signature.
    pub manifest: Mutex<Option<(String, state::Manifest)>>,
}

impl Lane {
    /// The reconcile manifest, parsed again only when its file changed (it is replaced by a
    /// rename on every publish).
    fn manifest(&self) -> state::Manifest {
        let path = format!("{}/reconcile-manifest.json", self.config.state_dir.trim_end_matches('/'));
        let Some(sig) = engine::file_signature(&path) else { return state::Manifest::default() };
        if let Ok(mut slot) = self.manifest.lock() {
            if let Some((s, m)) = slot.as_ref() {
                if *s == sig {
                    return m.clone();
                }
            }
            let m = state::read_manifest(&self.config.state_dir);
            if m.present {
                *slot = Some((sig, m.clone()));
            }
            return m;
        }
        state::read_manifest(&self.config.state_dir)
    }
}

static RECEIPTS: OnceLock<Mutex<Vec<LaneReceipt>>> = OnceLock::new();

fn receipts() -> &'static Mutex<Vec<LaneReceipt>> {
    RECEIPTS.get_or_init(|| Mutex::new(Vec::new()))
}

pub(crate) fn push_receipt(r: LaneReceipt) {
    if let Ok(mut q) = receipts().lock() {
        q.push(r);
    }
}

/// One call: the answer, or why the lane declines it. Never panics out: a panic is a decline.
pub(crate) fn run_call(lane: &Lane, payload: &[u8]) -> Outcome {
    let out = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| call(lane, payload)));
    out.unwrap_or(Outcome::Decline("panic"))
}

fn call(lane: &Lane, payload: &[u8]) -> Outcome {
    let call = match gate::parse_call(payload) {
        Ok(c) => c,
        Err(why) => return Outcome::Decline(why),
    };
    if let Err(why) = gate::env_allows(&call) {
        return Outcome::Decline(why);
    }
    let file_root = match gate::resolve_roots(&call, &lane.config.project_root) {
        Ok(r) => r,
        Err(why) => return Outcome::Decline(why),
    };
    let session = match gate::session_id(&call) {
        Ok(s) => s,
        Err(why) => return Outcome::Decline(why),
    };
    let manifest = lane.manifest();
    if !manifest.present {
        return Outcome::Decline("no manifest");
    }
    if state::reindex_pending(&lane.config.state_dir) {
        return Outcome::Decline("reindex pending");
    }
    let Ok(mut guard) = lane.loaded.lock() else { return Outcome::Decline("lane lock") };
    let paths = match prepare(lane, &manifest, &mut guard) {
        Ok(p) => p,
        Err(why) => return Outcome::Decline(why),
    };
    let state::Loaded { index, graph, overlay } = &mut *guard;
    let Some(index) = index.as_ref() else { return Outcome::Decline("no index") };
    let Some((db, cache)) = state::open_graph(graph, &paths.graph) else { return Outcome::Decline("no graph") };
    let mut ctx = baregrep::Ctx {
        root: &lane.config.project_root,
        index,
        overlay: overlay.as_ref(),
        manifest: &manifest,
        graph: graph_impl::LaneGraph { g: Some(std::cell::RefCell::new(graph::GraphDb::new(db, manifest.epoch, &paths.graph, cache))) },
    };
    match pipeline::grep(&call, &file_root, &mut ctx) {
        Ok(answer) => {
            let receipt = session.map(|session_id| LaneReceipt {
                session_id,
                query: answer.receipt_regex.as_deref().and_then(pipeline::bounded),
                regex: answer.receipt_regex.as_deref().and_then(pipeline::bounded),
            });
            Outcome::Answer { code: 0, stdout: answer.stdout, receipt }
        }
        Err(why) => Outcome::Decline(why),
    }
}

struct Paths {
    graph: String,
}

/// Loads (or keeps, when their files did not change) what a call reads: the gram index the
/// manifest names, its delta overlay and the code graph connection.
fn prepare(lane: &Lane, manifest: &state::Manifest, loaded: &mut state::Loaded) -> Result<Paths, &'static str> {
    let state_dir = lane.config.state_dir.trim_end_matches('/');
    let index_path = manifest.sparse_base.clone().unwrap_or_else(|| format!("{state_dir}/codebase-sparse-grams.idx"));
    let graph_path = manifest.code_graph.clone().unwrap_or_else(|| format!("{state_dir}/code-graph.db"));
    if loaded.index(&index_path).is_none() {
        return Err("no index");
    }
    let state::Loaded { index, graph, overlay } = loaded;
    let index = index.as_ref().ok_or("no index")?;
    *overlay = if manifest.deltas.is_empty() {
        None
    } else {
        overlay::Overlay::load(&index_path, state_dir, &manifest.deltas, manifest.epoch, manifest.weights_id.as_deref(), overlay.take())?
    };
    if let Some(o) = overlay.as_mut() {
        o.prepare(index)?;
    }
    // Every indexed repository has a code graph; without one the JS reads differ (no line
    // classes, no family), so the JS answers.
    if state::open_graph(graph, &graph_path).is_none() {
        return Err("no graph");
    }
    Ok(Paths { graph: graph_path })
}

/// Loads the index, overlay and graph before the first call (a session's first ss-grep then
/// finds them warm). Best effort: a call loads whatever this did not.
fn warm(lane: &Lane) {
    let manifest = lane.manifest();
    if !manifest.present {
        return;
    }
    if let Ok(mut guard) = lane.loaded.lock() {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| prepare(lane, &manifest, &mut guard)));
    }
}

static RUNNING: OnceLock<Mutex<Option<server::Handle>>> = OnceLock::new();

fn running() -> &'static Mutex<Option<server::Handle>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// Start serving `opts.socket_path` (replacing a lane already running in this process).
#[napi]
pub fn grep_lane_start(opts: LaneOptions) -> napi::Result<bool> {
    let lane = Arc::new(Lane {
        config: LaneConfig { project_root: opts.project_root, state_dir: opts.state_dir },
        counters: Mutex::new(Counters::default()),
        loaded: Mutex::new(state::Loaded::default()),
        manifest: Mutex::new(None),
    });
    let mut slot = running().lock().map_err(|_| napi::Error::from_reason("lane lock"))?;
    // An old lane goes first: its stop removes its socket file, which may be the same path.
    if let Some(old) = slot.take() {
        old.stop();
    }
    let warm_lane = Arc::clone(&lane);
    let handle = server::start(&opts.socket_path, lane).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let _ = std::thread::Builder::new().name("ss-grep-lane-warm".into()).spawn(move || warm(&warm_lane));
    *slot = Some(handle);
    Ok(true)
}

/// Stop the lane and remove its socket.
#[napi]
pub fn grep_lane_stop() {
    if let Ok(mut slot) = running().lock() {
        if let Some(old) = slot.take() {
            old.stop();
        }
    }
}

/// The receipts of answered calls, oldest first, removed from the queue.
#[napi]
pub fn grep_lane_drain_receipts() -> Vec<LaneReceipt> {
    receipts().lock().map(|mut q| std::mem::take(&mut *q)).unwrap_or_default()
}

/// Run one call as the socket would, without queuing its receipt (shadow checks, tests).
#[napi]
pub fn grep_lane_call(payload_json: String, project_root: String, state_dir: String) -> LaneReply {
    let lane = shadow_lane(&project_root, &state_dir);
    match run_call(&lane, payload_json.as_bytes()) {
        Outcome::Answer { code, stdout, .. } => LaneReply { handled: true, code, stdout, reason: String::new() },
        Outcome::Decline(reason) => LaneReply { handled: false, code: 0, stdout: String::new(), reason: reason.to_string() },
    }
}

/// The lane the shadow checks run on: one per (root, state dir), kept warm like the real one.
fn shadow_lane(project_root: &str, state_dir: &str) -> Arc<Lane> {
    static SHADOW: OnceLock<Mutex<Option<Arc<Lane>>>> = OnceLock::new();
    let slot = SHADOW.get_or_init(|| Mutex::new(None));
    let mut g = slot.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(l) = g.as_ref() {
        if l.config.project_root == project_root && l.config.state_dir == state_dir {
            return l.clone();
        }
    }
    let l = Arc::new(Lane {
        config: LaneConfig { project_root: project_root.to_string(), state_dir: state_dir.to_string() },
        counters: Mutex::new(Counters::default()),
        loaded: Mutex::new(state::Loaded::default()),
        manifest: Mutex::new(None),
    });
    *g = Some(l.clone());
    l
}

#[napi]
pub fn grep_lane_stats() -> LaneStats {
    let slot = running().lock().ok();
    match slot.as_ref().and_then(|s| s.as_ref()) {
        Some(h) => {
            let c = h.lane.counters.lock().map(|c| (c.handled, c.declined)).unwrap_or((0, 0));
            LaneStats { running: true, handled: c.0, declined: c.1 }
        }
        None => LaneStats { running: false, handled: 0, declined: 0 },
    }
}
