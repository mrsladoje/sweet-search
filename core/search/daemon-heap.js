/**
 * The JS heap ceiling of the resident search daemon.
 *
 * V8 stops the heap near 4 GiB on 64-bit hosts whatever the RAM, and a daemon that
 * reaches it aborts (SIGABRT in node::OOMErrorHandler), dropping every call in
 * flight. r282 Codex grdb (2026-10-03): the r3-grdb index holds 341k chunks and
 * 2 GB of JSON sidecars; three concurrent first searches took the daemon past 4 GiB
 * and all three agents got "daemon closed the connection". The same abort is in
 * three earlier crash reports of `sweet-search-daemon`.
 *
 * The daemon gets a quarter of physical memory instead (never less than V8's own
 * default). It is a ceiling, not a reservation: a small repo's daemon stays small.
 * crates/sweet-search-cli/src/main.rs (daemon_heap_mb) uses the same formula.
 */

import os from 'node:os';

export const DAEMON_HEAP_MIN_MB = 4096;

export function daemonHeapMb(totalBytes = os.totalmem()) {
  return Math.max(DAEMON_HEAP_MIN_MB, Math.floor(totalBytes / 4 / (1024 * 1024)));
}

/** node flags for a daemon process: `spawn(process.execPath, [...daemonNodeArgs(), entry, '--serve'])`. */
export function daemonNodeArgs(totalBytes) {
  return [`--max-old-space-size=${daemonHeapMb(totalBytes)}`];
}
