/**
 * Global RSS-budget soft-eviction coordinator (research §4.D items D.3 + D.4).
 *
 * THE PROBLEM: N resident, model-loaded daemons (one search-server + one
 * maintainer per repo) each hold the ORT session resident forever (#25325), so
 * a dev who hops across ~8 repos accrues ~16 GB of resident daemons with no
 * eviction/cap/TTL. D.1 idle-TTL (G4) collapses idle daemons; D.3 here adds a
 * SAFETY CAP keyed on real system memory pressure, so even a fleet of *active*
 * daemons cannot grow past a soft budget.
 *
 * WHAT IT IS (D.3): a coordinator — an unref'd ~30s timer running inside every
 * registered daemon — that sums the RSS of all registered daemons and, when the
 * total crosses `SWEET_SEARCH_RSS_BUDGET_FRACTION * os.totalmem()`, SIGTERMs the
 * single longest-idle daemon (the one whose `lastActivityMs` is oldest). The
 * evicted daemon exits cleanly (G4 SIGTERM handler) and respawns on its next use
 * via the existing O_EXCL launch trigger, so the index is unchanged after
 * respawn — this is a *footprint* policy, not a correctness one.
 *
 * WHAT IT IS NOT: it is **not** a V8 heap cap (`--max-old-space-size`) — that is
 * explicitly forbidden on this hardware (`feedback_no_memory_cap`). The budget
 * is a soft, system-RAM-scaled eviction threshold: 0.60 → ~9.6 GB on a 16 GB
 * laptop, ~76 GB on a 128 GB workstation. No per-machine config; it auto-scales.
 *
 * WHAT IT EXTENDS, NOT DUPLICATES: the longest-idle SELECTION reuses
 * `selectEvictionTargets` from the search daemon-registry (the same convergence-
 * safe "only shed peers less-recently-active than self" rule that backs
 * `SWEET_SEARCH_MAX_DAEMONS`). The LRU *count*-cap (search-server.js) and this
 * RSS *budget*-cap are two thresholds over the same registry-style structure;
 * this module owns only the RSS dimension.
 *
 * D.4 memory-pressure: on Linux we additionally read PSI
 * `/proc/pressure/memory` (`some avg10`); a non-zero stall is an earlier,
 * kernel-supplied "drop idle daemons before the OS OOM-kills" signal than RSS
 * alone. On macOS the equivalent (`DISPATCH_SOURCE_TYPE_MEMORYPRESSURE`) has no
 * confirmed Node binding and needs a C addon — that is a DEFERRED openDecision
 * (research §6); macOS falls back to the pure-JS RSS poller below.
 *
 * DESIGN CONTRACT:
 *   - Tier-aware default. With `SWEET_SEARCH_RSS_BUDGET_FRACTION` unset the
 *     fraction comes from the system-RAM tier (`resolveMaintainerMemoryProfile`):
 *     OFF on roomy hosts (>24 GiB → NO registry write, NO timer, NO eviction —
 *     byte-identical to before), a soft cap on small-RAM hosts (the OOM case).
 *     An explicit env value always overrides: a parseable fraction in (0,1]
 *     enables; '', '0', or garbage disables the coordinator entirely.
 *   - Best-effort and NEVER throws. Every RSS read, PSI read, registry write,
 *     and signal is wrapped; a failure degrades to "do nothing this tick".
 *   - The timer is unref'd: it never keeps a daemon's event loop alive.
 *   - Soft eviction only: it SIGTERMs (graceful) — never SIGKILL, never self.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { selectEvictionTargets } from '../search/daemon-registry.js';
import { resolveMaintainerMemoryProfile } from '../incremental-indexing/domain/interval-autotune.mjs';

const DEFAULT_REGISTRY_FILE = 'sweet-search-rss-daemons.json';
const POLL_INTERVAL_MS = 30_000;

/**
 * Path to the shared RSS registry file. Distinct from the search daemon-registry
 * file (which is the LRU-count surface): this one also tracks maintainers and is
 * RAM-keyed. Override via SWEET_SEARCH_RSS_REGISTRY for tests; otherwise a single
 * shared file under the OS tmp dir so every daemon on the host coordinates.
 */
export function rssRegistryPath(env = process.env) {
  return env.SWEET_SEARCH_RSS_REGISTRY || path.join(os.tmpdir(), DEFAULT_REGISTRY_FILE);
}

/**
 * Parse + validate the budget fraction gate. Returns a number in (0,1] when the
 * coordinator is enabled, or `null` (disabled) for unset/empty/zero/garbage.
 * This is the single source of the default-OFF contract.
 */
export function budgetFraction(env = process.env, totalMemBytes = os.totalmem()) {
  const raw = env.SWEET_SEARCH_RSS_BUDGET_FRACTION;
  if (raw != null) {
    // Explicitly set (incl. '' / '0' / garbage → disabled): env wins over tier.
    const f = Number(raw);
    return (Number.isFinite(f) && f > 0 && f <= 1) ? f : null;
  }
  // Unset → auto from the system-RAM tier: small-RAM hosts get a soft cap, roomy
  // hosts get none (null). No per-machine config; it auto-scales with RAM.
  return resolveMaintainerMemoryProfile({ totalMemBytes }).rssBudgetFraction;
}

/** Whether the coordinator is enabled (explicit fraction OR a RAM-tier default). */
export function isEnabled(env = process.env, totalMemBytes = os.totalmem()) {
  return budgetFraction(env, totalMemBytes) !== null;
}

/**
 * The soft budget in bytes: `fraction * totalmem`. Auto-scales with system RAM
 * so there is no per-machine config (4 GB-ish on a 16 GB box at 0.6, ~76 GB on
 * 128 GB). Returns 0 when disabled.
 */
export function budgetBytes(env = process.env, totalMem = os.totalmem()) {
  const f = budgetFraction(env, totalMem);
  if (f === null) return 0;
  return Math.floor(f * totalMem);
}

/** Total RSS over budget? Pure predicate (testable without any I/O). */
export function isOverBudget(totalRssBytes, budgetBytesValue) {
  return (
    Number.isFinite(totalRssBytes) &&
    Number.isFinite(budgetBytesValue) &&
    budgetBytesValue > 0 &&
    totalRssBytes > budgetBytesValue
  );
}

/**
 * Read the resident-set size (bytes) of an arbitrary pid, best-effort and
 * cross-platform. Returns a non-negative integer, or 0 when unknown (dead pid,
 * unsupported platform, permission denied) — an unknown daemon contributes 0 to
 * the sum, so a transient read failure can only UNDER-count (never spuriously
 * evict). For the calling process we prefer the cheap, exact in-process value.
 *
 *   - self: `process.memoryUsage().rss` (no spawn).
 *   - Linux: `/proc/<pid>/statm` field 2 (resident pages) × page size.
 *   - macOS / BSD: `ps -o rss= -p <pid>` (KiB) × 1024.
 *   - Windows / others: 0 (no cheap spawn-free reader; native addon later).
 *
 * @param {number} pid
 * @returns {Promise<number>} RSS in bytes (0 when unknown).
 */
export async function readProcessRss(pid) {
  try {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 0) return 0;
    if (n === process.pid) {
      try { return process.memoryUsage().rss || 0; } catch { return 0; }
    }
    if (process.platform === 'linux') {
      try {
        const raw = await fs.readFile(`/proc/${n}/statm`, 'utf-8');
        const resPages = Number(raw.trim().split(/\s+/)[1]);
        if (!Number.isFinite(resPages) || resPages <= 0) return 0;
        const pageSize = typeof os.constants?.UV_PAGESIZE === 'number'
          ? os.constants.UV_PAGESIZE
          : 4096;
        return resPages * pageSize;
      } catch {
        return 0;
      }
    }
    if (process.platform === 'darwin') {
      // `ps` RSS is in KiB. spawnSync is fine here: coarse 30s cadence, tiny output.
      const r = spawnSync('ps', ['-o', 'rss=', '-p', String(n)], { encoding: 'utf-8', timeout: 2000 });
      if (r.status !== 0 || !r.stdout) return 0;
      const kib = Number(r.stdout.trim());
      return Number.isFinite(kib) && kib > 0 ? kib * 1024 : 0;
    }
    return 0; // Windows + others: no spawn-free reader yet (deferred native addon).
  } catch {
    return 0;
  }
}

/**
 * D.4 Linux memory-pressure reader (PSI). Returns the `some avg10` stall
 * percentage from `/proc/pressure/memory` (0–100), or `null` when unavailable
 * (non-Linux, kernel without PSI, read error). A non-zero `some avg10` means
 * tasks were stalled on memory in the last 10s — an earlier OOM-warning than
 * raw RSS, so the coordinator treats any positive value as "prefer to evict".
 *
 * macOS note: the kernel equivalent is `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE`,
 * which has no confirmed Node binding and needs a C addon (DEFERRED
 * openDecision, research §6). On macOS this returns null and the coordinator
 * relies on the RSS poller alone.
 *
 * @returns {Promise<number|null>} `some avg10` (0–100) or null.
 */
export async function readLinuxMemoryPressure() {
  try {
    if (process.platform !== 'linux') return null;
    const raw = await fs.readFile('/proc/pressure/memory', 'utf-8');
    // Format: "some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull ..."
    for (const line of raw.split('\n')) {
      if (!line.startsWith('some ')) continue;
      const m = line.match(/avg10=([\d.]+)/);
      if (m) {
        const v = Number(m[1]);
        return Number.isFinite(v) ? v : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// --- shared-registry I/O (best-effort, atomic; mirrors daemon-registry.js) ---

async function readRssRegistry(env = process.env) {
  try {
    const raw = await fs.readFile(rssRegistryPath(env), 'utf-8');
    const parsed = JSON.parse(raw);
    const daemons = parsed && typeof parsed === 'object' ? parsed.daemons : null;
    return daemons && typeof daemons === 'object' ? daemons : {};
  } catch {
    return {};
  }
}

async function writeRssRegistryAtomic(daemons, env = process.env) {
  const target = rssRegistryPath(env);
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

/** Is a pid alive right now? `kill -0`; EPERM (other-user) counts as alive. */
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return !!(err && err.code === 'EPERM');
  }
}

/**
 * Drop registry entries whose process is gone (the only liveness gate this
 * coordinator needs — unlike the search registry it does not socket-probe, since
 * maintainers have no health socket), persist if anything changed, and return
 * the surviving entries.
 */
async function pruneRegistry(env = process.env, alive = pidAlive) {
  const daemons = await readRssRegistry(env);
  const live = [];
  const liveMap = {};
  for (const [key, entry] of Object.entries(daemons)) {
    if (!entry || typeof entry !== 'object') continue;
    if (alive(entry.pid)) {
      live.push(entry);
      liveMap[key] = entry;
    }
  }
  if (Object.keys(liveMap).length !== Object.keys(daemons).length) {
    await writeRssRegistryAtomic(liveMap, env);
  }
  return live;
}

/**
 * One coordinator tick (exported for tests; takes injectable readers so the
 * eviction decision is testable with zero real processes/signals/files):
 *
 *   1. prune dead entries, list the live ones;
 *   2. read each daemon's RSS, sum it, and stamp each entry with its rss;
 *   3. read Linux PSI (if any) — a positive `some avg10` is an early pressure
 *      signal that forces an eviction pass even slightly under the RSS budget;
 *   4. if over budget (or under pressure with >1 daemon), pick the single
 *      longest-idle peer via `selectEvictionTargets` (self-safe convergence)
 *      and SIGTERM it.
 *
 * Returns a small diagnostic record. Best-effort: never throws.
 *
 * @param {object} deps
 * @param {object} [deps.env]
 * @param {number} [deps.selfPid]
 * @param {(pid:number)=>Promise<number>} [deps.rssReader]
 * @param {()=>Promise<number|null>} [deps.pressureReader]
 * @param {(pid:number)=>void} [deps.signal]  Eviction action (default SIGTERM).
 * @param {number} [deps.totalMem]  System RAM (default os.totalmem()); injectable
 *   so the budget is deterministic in tests regardless of the host's real RAM.
 * @param {(pid:number)=>boolean} [deps.aliveProbe]  Liveness probe (default
 *   `kill -0`); injectable so tests can mark seeded fake pids as live.
 */
export async function runEvictionTick({
  env = process.env,
  selfPid = process.pid,
  rssReader = readProcessRss,
  pressureReader = readLinuxMemoryPressure,
  signal = (pid) => { try { process.kill(pid, 'SIGTERM'); } catch { /* best-effort */ } },
  totalMem = os.totalmem(),
  aliveProbe = pidAlive,
} = {}) {
  const result = { enabled: false, totalRss: 0, budget: 0, over: false, pressure: null, evicted: null, liveCount: 0 };
  try {
    if (!isEnabled(env)) return result;
    result.enabled = true;
    result.budget = budgetBytes(env, totalMem);

    const live = await pruneRegistry(env, aliveProbe);
    result.liveCount = live.length;

    // Sum RSS, stamping each entry so selectEvictionTargets sees fresh data.
    let total = 0;
    for (const entry of live) {
      const rss = await rssReader(entry.pid);
      entry.rss = rss;
      total += rss;
    }
    result.totalRss = total;
    result.pressure = await pressureReader();

    const over = isOverBudget(total, result.budget);
    // PSI: any positive `some avg10` stall is an early OOM-warning. Only act on
    // it when more than one daemon is resident (evicting the sole daemon would
    // just trigger a respawn for no footprint relief) AND we are at least
    // approaching the budget (≥80%), so a momentary system-wide stall unrelated
    // to our daemons cannot churn the fleet.
    const underPressure =
      Number.isFinite(result.pressure) && result.pressure > 0 &&
      live.length > 1 && result.budget > 0 && total >= 0.8 * result.budget;
    result.over = over;

    if (!over && !underPressure) return result;

    // Pick the single longest-idle peer. selectEvictionTargets sorts oldest
    // lastActivityMs first and only returns peers strictly older than self, so
    // every daemon running this tick converges on the same victim set without
    // over-evicting (identical convergence proof to the LRU count-cap).
    const targets = selectEvictionTargets(live, selfPid, 1);
    if (targets.length === 0) return result;
    const victim = targets[0];
    signal(victim.pid);
    result.evicted = victim.pid;
    return result;
  } catch {
    return result; // never throw — best-effort coordinator
  }
}

// --- public registration API (the seam G4 wired in index-maintainer.mjs) ---

/** Module-level coordinator handle so multiple registrations share ONE timer. */
let coordinatorTimer = null;
let registeredCount = 0;

/**
 * Register THIS daemon with the RSS-budget coordinator. Matches the seam G4
 * wired into index-maintainer.mjs:
 *
 *     const mod = await import('./rss-budget.mjs');
 *     rssRegistration = await mod.registerDaemon({ pid, stateDir, kind });
 *     // ... later, on shutdown:
 *     await rssRegistration.unregister();
 *
 * Upserts an entry into the shared RSS registry and, on the first registration
 * in this process, starts the unref'd ~30s coordinator timer. Returns an
 * `{ unregister }` handle (and `{ touch }` so a daemon can refresh its real
 * activity timestamp — used by search-server-style query routes; the maintainer
 * leaves lastActivityMs at registration time, which is correct: an idle
 * maintainer is exactly what we want to evict first).
 *
 * Best-effort: with the gate off this is a no-op returning a harmless handle, so
 * the caller's teardown (`rssRegistration?.unregister?.()`) is always safe.
 *
 * @param {object} opts
 * @param {number} opts.pid
 * @param {string} [opts.stateDir]
 * @param {string} [opts.kind]  'maintainer' | 'search' | etc. (diagnostic only)
 * @param {object} [opts.env]
 * @returns {Promise<{ unregister: () => Promise<void>, touch: (ms?: number) => Promise<void> }>}
 */
export async function registerDaemon({ pid = process.pid, stateDir = null, kind = 'unknown', env = process.env } = {}) {
  const noop = { unregister: async () => {}, touch: async () => {} };
  try {
    if (!isEnabled(env)) return noop;

    const now = Date.now();
    const entry = { pid, stateDir, kind, startedAt: now, lastActivityMs: now, rss: 0 };
    try {
      const daemons = await readRssRegistry(env);
      daemons[String(pid)] = entry;
      await writeRssRegistryAtomic(daemons, env);
    } catch { /* best-effort: a failed write just means we aren't counted */ }

    registeredCount += 1;
    if (!coordinatorTimer) {
      coordinatorTimer = setInterval(() => {
        runEvictionTick({ env, selfPid: pid }).catch(() => {});
      }, POLL_INTERVAL_MS);
      if (coordinatorTimer.unref) coordinatorTimer.unref();
    }

    const unregister = async () => {
      try {
        const daemons = await readRssRegistry(env);
        if (String(pid) in daemons) {
          delete daemons[String(pid)];
          await writeRssRegistryAtomic(daemons, env);
        }
      } catch { /* best-effort */ }
      registeredCount = Math.max(0, registeredCount - 1);
      if (registeredCount === 0 && coordinatorTimer) {
        clearInterval(coordinatorTimer);
        coordinatorTimer = null;
      }
    };

    const touch = async (ms = Date.now()) => {
      try {
        const daemons = await readRssRegistry(env);
        if (daemons[String(pid)]) {
          daemons[String(pid)].lastActivityMs = ms;
          await writeRssRegistryAtomic(daemons, env);
        }
      } catch { /* best-effort */ }
    };

    return { unregister, touch };
  } catch {
    return noop; // never throw — a registration failure must not break startup
  }
}

/** Test-only: read the live RSS registry map. */
export async function _readRegistryForTest(env = process.env) {
  return readRssRegistry(env);
}
