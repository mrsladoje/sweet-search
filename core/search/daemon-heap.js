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
 * The daemon gets a quarter of its memory limit, never less than V8's own default and never
 * more than 75% of the limit. The limit is the container's (cgroup, from
 * process.constrainedMemory()) when one applies, else physical RAM: a ceiling above a
 * container's limit would end in a silent kernel OOM kill instead of V8's error. It is a
 * ceiling, not a reservation: a small repo's daemon stays small.
 * crates/sweet-search-cli/src/main.rs (daemon_heap_mb) uses the same formula.
 */

import os from 'node:os';

export const DAEMON_HEAP_MIN_MB = 4096;

/** The memory the daemon may use: the cgroup limit when it is below physical RAM. */
export function memoryLimitBytes({ constrained = process.constrainedMemory?.() ?? 0, total = os.totalmem() } = {}) {
  return constrained > 0 && constrained < total ? constrained : total;
}

export function daemonHeapMb(limitBytes = memoryLimitBytes()) {
  const mb = limitBytes / (1024 * 1024);
  return Math.floor(Math.min(Math.max(DAEMON_HEAP_MIN_MB, mb / 4), mb * 0.75));
}

/** node flags for a daemon process: `spawn(process.execPath, [...daemonNodeArgs(), entry, '--serve'])`. */
export function daemonNodeArgs(limitBytes) {
  return [`--max-old-space-size=${daemonHeapMb(limitBytes)}`];
}
