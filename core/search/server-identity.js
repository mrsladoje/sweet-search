/**
 * Project-scoped warm-server identity (release-gate C3).
 *
 * The warm search server was discovered via a single GLOBAL Unix socket
 * (`/tmp/sweet-search.sock`) + a global legacy symlink (`/tmp/search.sock`) and
 * an unconditional TCP port (9876). With more than one project on a machine
 * this silently routed project B's queries to project A's server, and a second
 * project's server crashed on `EADDRINUSE`.
 *
 * The fix derives a per-project socket/pidfile from the canonical project root,
 * so each project gets its own server and can never answer another project's
 * queries. The native Rust CLI re-implements the SAME derivation (FNV-1a/64 of
 * the canonical root → `/tmp/sweet-search-<hash16>.sock`) so both sides agree.
 *
 * Why a hashed `/tmp` path and not `<root>/.sweet-search/search.sock`:
 * `sockaddr_un.sun_path` is capped (~104 bytes on macOS); a deep project path
 * would overflow it. The hashed `/tmp` path is always short and collision-safe.
 *
 * Overrides:
 *   - `SWEET_SEARCH_SOCKET_PATH` — explicit socket; when set, NO legacy fallback.
 *   - `SWEET_SEARCH_PID_FILE`    — explicit pidfile.
 *   - `SWEET_SEARCH_TCP_PORT`    — opt-in TCP (off by default; see search-server).
 */

import { realpathSync, existsSync } from 'node:fs';
import path from 'node:path';

const FNV_OFFSET = 14695981039346656037n; // 0xcbf29ce484222325
const FNV_PRIME = 1099511628211n;         // 0x100000001b3
const U64_MASK = (1n << 64n) - 1n;

/** FNV-1a 64-bit of a string's UTF-8 bytes → 16 lowercase hex chars. */
export function fnv1a64Hex(str) {
  let hash = FNV_OFFSET;
  const bytes = Buffer.from(String(str), 'utf8');
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV_PRIME) & U64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Canonicalise a path (resolve symlinks, e.g. macOS /tmp → /private/tmp). */
function canonicalize(p) {
  const abs = path.resolve(p);
  try {
    return realpathSync.native(abs);
  } catch {
    return abs; // path may not exist yet (pre-index cold start) — use lexical.
  }
}

/**
 * Resolve the canonical project root for socket derivation. Honors an explicit
 * `SWEET_SEARCH_PROJECT_ROOT`; otherwise walks up from `cwd` to the nearest
 * ancestor containing a `.sweet-search/` state dir (so queries from a
 * subdirectory map to the same server), falling back to the canonical `cwd`.
 */
export function resolveProjectRoot(env = process.env, cwd = process.cwd()) {
  const base = canonicalize(env.SWEET_SEARCH_PROJECT_ROOT || cwd);
  let dir = base;
  while (true) {
    if (existsSync(path.join(dir, '.sweet-search'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return base;
}

/** Project-scoped socket path (or the explicit override). */
export function projectSocketPath(env = process.env, cwd = process.cwd()) {
  if (env.SWEET_SEARCH_SOCKET_PATH) return env.SWEET_SEARCH_SOCKET_PATH;
  return `/tmp/sweet-search-${fnv1a64Hex(resolveProjectRoot(env, cwd))}.sock`;
}

/** Project-scoped server pidfile (or the explicit override). */
export function projectPidFile(env = process.env, cwd = process.cwd()) {
  if (env.SWEET_SEARCH_PID_FILE) return env.SWEET_SEARCH_PID_FILE;
  return `/tmp/sweet-search-${fnv1a64Hex(resolveProjectRoot(env, cwd))}.pid`;
}

/**
 * Opt-in TCP port. Off by default — TCP on a single global port is the
 * multi-project collision source (EADDRINUSE) and a cross-project leak vector.
 * Returns a finite port number, or null when TCP should not be bound.
 */
export function tcpPort(env = process.env) {
  const raw = env.SWEET_SEARCH_TCP_PORT;
  if (raw == null || raw === '') return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}
