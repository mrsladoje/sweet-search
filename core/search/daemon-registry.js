/**
 * Best-effort resident search-daemon registry (footprint cap support).
 *
 * Backs the optional SWEET_SEARCH_MAX_DAEMONS cap (Part 2 of the daemon
 * footprint work). Each warm search daemon, WHEN the cap is opted into,
 * upserts a single entry describing itself into one shared JSON file and
 * refreshes it on a coarse timer. A daemon enforcing the cap reads the file,
 * prunes entries whose process is gone or whose socket no longer answers, and
 * (when more daemons are resident than the cap allows) sends /stop to the
 * least-recently-active peers — never itself, never the most-recently-active.
 *
 * Properties:
 *   - ONLY search daemons ever call this module. The index maintainer
 *     (core/indexing/*) never imports it, so a maintainer can never be
 *     enumerated, listed, or signalled through the registry.
 *   - Every operation is best-effort: a redundant eviction is harmless and a
 *     read/write race resolves to "do nothing this tick". All I/O is
 *     try/caught; writes are atomic (tmp + rename) so a crash mid-write never
 *     leaves a torn file.
 *   - lastActivityMs stores REAL query activity (the daemon's /search and
 *     /read-semantic wall-clock), so "least-recently-active" == least-recently
 *     queried. The actively-used repo's daemon is never evicted by an
 *     equally-or-less-recently-active peer; the one residual race is a
 *     newly-STARTED peer, which is freshest-by-construction (its startedAt
 *     seeds lastActivityMs) and may evict a recently-active-but-stale-stamped
 *     peer within one registry-refresh interval, because the registry reflects
 *     activity only as of each daemon's coarse registryTouchSelf tick.
 */

import fs from 'node:fs/promises';
import { readFileSync, lstatSync, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const REGISTRY_FILENAME = 'daemons.json';

/**
 * A PRIVATE, per-user directory for daemon registries.
 *
 * These files used to sit at a fixed path in a world-writable directory
 * (`/tmp/sweet-search-daemons.json`, and `os.tmpdir()` for the RSS registry,
 * which is `/tmp` on Linux). Any other local user could create that file first
 * and then own its contents, and the contents are ACTED ON: the count cap sends
 * `/stop` to each listed socket path, and the RSS coordinator sends SIGTERM to
 * each listed pid. A file an attacker controls therefore turns our own daemon
 * into the thing that stops the user's processes — and the RSS coordinator is
 * default-ON for hosts of 24 GiB or less, so this was reachable without anyone
 * opting into anything.
 *
 * `~/.cache/sweet-search` is created 0700 and is already where this project
 * keeps other per-user runtime state.
 */
export function privateRuntimeDir(env = process.env) {
  if (env.SWEET_SEARCH_RUNTIME_DIR) {
    try { mkdirSync(env.SWEET_SEARCH_RUNTIME_DIR, { recursive: true, mode: 0o700 }); } catch { /* validated later */ }
    return env.SWEET_SEARCH_RUNTIME_DIR;
  }

  const preferred = path.join(os.homedir(), '.cache', 'sweet-search');
  try {
    mkdirSync(preferred, { recursive: true, mode: 0o700 });
    if (dirTrustworthy(preferred)) return preferred;
  } catch { /* fall through */ }

  // A container or service account can have HOME missing, pointing at /, or
  // read-only. Returning the unusable path anyway would make every read fail
  // the trust check and every write refuse — so the footprint controls would
  // switch themselves off SILENTLY while still appearing configured. Fall back
  // to a per-user directory we create ourselves inside the temp dir: a
  // 0700 directory owned by us passes the same trust check that plain /tmp
  // fails, which is the whole point.
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'nouid';
  const fallback = path.join(os.tmpdir(), `sweet-search-${uid}`);
  try { mkdirSync(fallback, { recursive: true, mode: 0o700 }); } catch { /* validated by the caller */ }
  return fallback;
}

/**
 * Is this path safe to read instructions from?
 *
 * Fail CLOSED. Anything unexpected — a symlink, another user's file, a file
 * others can write, a directory — means we treat the registry as empty and
 * decline to write. An empty registry costs at most an un-enforced cap; a
 * trusted hostile one costs the user their running processes.
 */
export function registryTrustworthy(filePath) {
  let st;
  try {
    st = lstatSync(filePath);
  } catch {
    // Absent is fine: we are about to create it ourselves.
    return dirTrustworthy(path.dirname(filePath));
  }
  if (!st.isFile()) return false;                       // symlink, fifo, directory
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
  if ((st.mode & 0o022) !== 0) return false;            // group- or world-writable
  return dirTrustworthy(path.dirname(filePath));
}

/** The containing directory must be ours and not writable by anyone else. */
function dirTrustworthy(dirPath) {
  try {
    const st = statSync(dirPath);
    if (!st.isDirectory()) return false;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false;
    // A world-writable directory lets an attacker REPLACE our file by rename,
    // whatever the file's own mode says. The sticky bit on /tmp stops deleting
    // someone else's file but not creating one that does not exist yet.
    if ((st.mode & 0o022) !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

/** Path to the shared registry file (override via SWEET_SEARCH_DAEMON_REGISTRY for tests). */
export function registryPath(env = process.env) {
  return env.SWEET_SEARCH_DAEMON_REGISTRY || path.join(privateRuntimeDir(env), REGISTRY_FILENAME);
}

/**
 * Was this entry written before the machine last booted?
 *
 * These registries used to live in a temp directory that the OS clears on
 * reboot, so a stale entry could not outlive the processes it described. They
 * now live in `~/.cache`, which persists — and that turns PID REUSE from a
 * curiosity into a real hazard: an entry from a previous boot names a pid that
 * some unrelated process (an editor, a database) now holds, `kill(pid, 0)`
 * accepts it as ours, and its ancient `lastActivityMs` makes it the FIRST
 * choice when something has to be stopped. We would then send SIGTERM, or an
 * HTTP `/stop`, to a process we have never had anything to do with.
 *
 * Ownership and mode on the FILE cannot help here: the file is genuinely ours.
 * Only the age of the entry can, so anything older than boot is discarded.
 */
export function entryPredatesBoot(entry, nowMs = Date.now(), uptimeSec = os.uptime()) {
  const startedAt = Number(entry?.startedAt);
  if (!Number.isFinite(startedAt)) return true;   // unattributable → do not act on it
  if (!Number.isFinite(uptimeSec) || uptimeSec < 0) return false;
  // One minute of slack absorbs clock adjustments around boot.
  return startedAt < (nowMs - uptimeSec * 1000 - 60_000);
}

/**
 * Is a process with this pid alive right now? Treats EPERM (process owned by
 * another user) as alive — standard `kill -0` probe.
 */
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

/** Read + parse the registry, returning a { "<pid>": entry } map ({} on any error). */
export async function readRegistry(env = process.env) {
  try {
    const target = registryPath(env);
    // Refuse to take instructions from a file we cannot vouch for. Empty is the
    // safe answer: it disables eviction rather than acting on hostile entries.
    if (!registryTrustworthy(target)) return {};
    const raw = await fs.readFile(target, 'utf-8');
    const parsed = JSON.parse(raw);
    const daemons = parsed && typeof parsed === 'object' ? parsed.daemons : null;
    return daemons && typeof daemons === 'object' ? daemons : {};
  } catch {
    return {};
  }
}

/** Atomically persist the daemon map (tmp + rename). Best-effort: swallows errors. */
async function writeRegistryAtomic(daemons, env = process.env) {
  const target = registryPath(env);
  // Never write into a location we would not read from — publishing our socket
  // path and pid into a file another user controls is the same exposure in the
  // other direction.
  if (!registryTrustworthy(target)) return false;
  // Per-pid tmp suffix so two daemons writing concurrently never collide on the
  // tmp file; the rename is atomic so the reader always sees a whole document.
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify({ daemons }), { mode: 0o600 });
    await fs.rename(tmp, target);
    return true;
  } catch {
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    return false;
  }
}

/** Insert/replace this daemon's entry. */
export async function upsertSelf(entry, env = process.env) {
  const daemons = await readRegistry(env);
  daemons[String(entry.pid)] = { ...entry };
  return writeRegistryAtomic(daemons, env);
}

/** Refresh this daemon's lastActivityMs (no-op if its entry vanished). */
export async function touchSelf(pid, lastActivityMs, env = process.env) {
  const daemons = await readRegistry(env);
  const key = String(pid);
  if (!daemons[key]) return false;
  daemons[key].lastActivityMs = lastActivityMs;
  return writeRegistryAtomic(daemons, env);
}

/** Remove this daemon's entry (called on graceful shutdown). */
export async function removeSelf(pid, env = process.env) {
  const daemons = await readRegistry(env);
  const key = String(pid);
  if (!(key in daemons)) return false;
  delete daemons[key];
  return writeRegistryAtomic(daemons, env);
}

/**
 * GET /health over an explicit unix socket. Resolves true on a 200, false
 * otherwise (unreachable, non-200, timeout). Mirrors getServerHealth's probe
 * but parameterised by socket so we can check peers, not just our own.
 */
export function socketHealthy(socketPath, timeoutMs = 500) {
  return new Promise((resolve) => {
    try {
      const req = http.request({ socketPath, path: '/health', method: 'GET' }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode === 200));
      });
      req.on('error', () => resolve(false));
      req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Prune entries whose process is gone OR whose socket no longer answers
 * /health, persist the pruned map, and return the surviving (live) entries.
 *
 * `probe` lets tests inject a synchronous/async liveness override; by default
 * the registry uses pidAlive + socketHealthy. Best-effort throughout.
 */
export async function pruneAndList({ env = process.env, probe = null, timeoutMs = 500 } = {}) {
  const daemons = await readRegistry(env);
  const live = [];
  const liveMap = {};
  for (const [key, entry] of Object.entries(daemons)) {
    if (!entry || typeof entry !== 'object') continue;
    // Drop pre-boot entries before probing: their pid may now belong to an
    // unrelated process, and probing is what would mistake it for ours.
    if (entryPredatesBoot(entry)) continue;
    let ok;
    if (probe) {
      ok = await probe(entry);
    } else {
      ok = pidAlive(entry.pid) && await socketHealthy(entry.socketPath, timeoutMs);
    }
    if (ok) {
      live.push(entry);
      liveMap[key] = entry;
    }
  }
  if (Object.keys(liveMap).length !== Object.keys(daemons).length) {
    await writeRegistryAtomic(liveMap, env);
  }
  return live;
}

/**
 * Pick up to `count` eviction targets: the least-recently-active peers that are
 * NOT self AND strictly less-recently-active than self, sorted oldest-first.
 *
 * The "older than self" gate is what makes CONCURRENT enforcement safe: every
 * resident daemon runs this independently, but a daemon only ever sheds peers
 * less active than itself — never itself, never a more-recently-active peer. So
 * the union of all daemons' evictions is exactly the surplus (the oldest
 * live.length-cap daemons): the newest daemon alone already targets precisely
 * that set, and every other daemon targets a subset of it. The actively-used
 * repo's daemon (freshest lastActivityMs) is therefore never evicted by an
 * equally-or-less-recently-active peer — though a newly-started peer, freshest
 * by construction, may evict it within one registry-refresh interval before
 * its next registryTouchSelf tick re-stamps it. The cap converges without
 * over-shooting below it.
 *
 * When self is absent from the list (e.g. an unregistered caller, or tests),
 * the gate falls back to "any non-self", i.e. plain least-recently-active.
 */
export function selectEvictionTargets(liveEntries, selfPid, count) {
  if (!Array.isArray(liveEntries) || count <= 0) return [];
  const selfKey = String(selfPid);
  const self = liveEntries.find((e) => e && String(e.pid) === selfKey);
  const cutoff = self ? (self.lastActivityMs ?? 0) : Infinity;
  return liveEntries
    .filter((e) => e && String(e.pid) !== selfKey && (e.lastActivityMs ?? 0) < cutoff)
    .sort((a, b) => (a.lastActivityMs ?? 0) - (b.lastActivityMs ?? 0))
    .slice(0, count);
}

/** Synchronous registry read (used only by diagnostics/tests). */
export function readRegistrySync(env = process.env) {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(env), 'utf-8'));
    const daemons = parsed && typeof parsed === 'object' ? parsed.daemons : null;
    return daemons && typeof daemons === 'object' ? daemons : {};
  } catch {
    return {};
  }
}
