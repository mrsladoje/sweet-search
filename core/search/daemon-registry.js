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
 *     queried. The actively-used repo's daemon always has the freshest stamp
 *     and is therefore never an eviction target.
 */

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const DEFAULT_REGISTRY_PATH = '/tmp/sweet-search-daemons.json';

/** Path to the shared registry file (override via SWEET_SEARCH_DAEMON_REGISTRY for tests). */
export function registryPath(env = process.env) {
  return env.SWEET_SEARCH_DAEMON_REGISTRY || DEFAULT_REGISTRY_PATH;
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
    const raw = await fs.readFile(registryPath(env), 'utf-8');
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
 * repo's daemon (freshest lastActivityMs) is therefore never evicted, and the
 * cap converges without over-shooting below it.
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
