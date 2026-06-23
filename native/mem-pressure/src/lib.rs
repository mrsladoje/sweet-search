//! sweet-search-mem-pressure — optional napi-rs addon SCAFFOLD (research §4.D D.4).
//!
//! GOAL (not yet implemented): a macOS `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE`
//! dispatch source that fires `WARN` / `CRITICAL` callbacks into JS so the RSS
//! coordinator (`core/indexing/rss-budget.mjs`, owned by G7) can evict the
//! longest-idle daemon *reactively* instead of polling RSS every 30 s.
//!
//! STATUS: **scaffold only.** The research doc flags this as an open decision —
//! "no confirmed Node binding for DISPATCH_SOURCE_TYPE_MEMORYPRESSURE; needs a C
//! addon" (§4.D, §6). A correct implementation requires:
//!   1. `dispatch_source_create(DISPATCH_SOURCE_TYPE_MEMORYPRESSURE, 0,
//!      DISPATCH_MEMORYPRESSURE_WARN | DISPATCH_MEMORYPRESSURE_CRITICAL, queue)`
//!      on a dedicated dispatch queue,
//!   2. a `dispatch_source_set_event_handler_f` whose handler reads
//!      `dispatch_source_get_data` and forwards WARN/CRITICAL into JS via a
//!      napi `ThreadsafeFunction`,
//!   3. keeping the source + queue alive for the process lifetime and a clean
//!      `dispatch_source_cancel` on teardown.
//! That run-loop + threadsafe-callback wiring across the FFI boundary is the
//! "C-addon openDecision" referenced in the plan, and is intentionally deferred.
//!
//! Until it lands, `startMemoryPressureMonitor()` returns `false`
//! ("not supported"), so callers MUST keep G7's pure-JS RSS poller as the active
//! macOS path. The function is infallible and never throws.
//
// TODO(D.4): implement the dispatch-source memory-pressure monitor above and
// switch `start_memory_pressure_monitor` to register a napi ThreadsafeFunction
// callback. Until then this stays a no-op so the JS RSS poller remains active.

use napi_derive::napi;

/// Start the native macOS memory-pressure monitor.
///
/// SCAFFOLD: always returns `false` (not supported yet). When `false`, the
/// caller must fall back to G7's pure-JS RSS poller. Never throws.
///
/// The `_threshold_fraction` argument is accepted now so the JS call site can
/// be wired stably; it is ignored until the dispatch source is implemented.
#[napi]
pub fn start_memory_pressure_monitor(_threshold_fraction: f64) -> bool {
    // Not yet implemented — see module TODO(D.4). JS RSS poller stays active.
    false
}

/// Whether this build provides a working native memory-pressure source.
/// Always `false` in the scaffold.
#[napi]
pub fn is_supported() -> bool {
    false
}
