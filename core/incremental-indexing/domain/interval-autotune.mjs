/**
 * Reconcile interval auto-tuning.
 *
 * Plan § 14.2.1 and § 34. Default tick interval is 60 s; we auto-tune
 * within `[15 s, 300 s]` based on:
 *   - dirty-set churn (more dirt → tighter interval),
 *   - last tick's wallclock (>50 % of interval → loosen interval),
 *   - CPU pressure (1-minute load average per core),
 *   - maintenance backlog depth (no point ticking faster than the
 *     watermarks can drain).
 *
 * The tuner is **rate-limited** so the interval never moves by more than
 * 50 % between ticks; otherwise a hash-collision spike could collapse the
 * interval to 15 s permanently and starve the encoder.
 *
 * Pin behaviour: when `SWEET_SEARCH_RECONCILE_INTERVAL` is set explicitly,
 * the tuner is bypassed entirely.
 */

const MIN_MS = 15_000;
const MAX_MS = 300_000;
const NOMINAL_MS = 60_000;

const TARGET_TICK_WALLCLOCK_FRACTION = 0.5;
const MAX_RATIO_CHANGE_PER_TICK = 1.5;

/**
 * Recommend the next interval given the current state.
 *
 * @param {object} input
 * @param {number} input.currentMs          The interval the previous tick used.
 * @param {number} input.lastTickMs         Wallclock of the most recent tick.
 * @param {number} input.dirtyAtTickStart   How many paths were dirty.
 * @param {number} input.cpuLoadAvg         OS 1-minute load average / physicalCores.
 * @param {number} input.maintenanceBacklog Pending jobs in the rebuild queue.
 * @param {number} [input.minMs=15000]
 * @param {number} [input.maxMs=300000]
 * @returns {{nextMs:number, reasons:string[]}}
 */
export function nextInterval(input) {
  const minMs = input.minMs ?? MIN_MS;
  const maxMs = input.maxMs ?? MAX_MS;
  const reasons = [];
  let target = input.currentMs || NOMINAL_MS;

  // 1. Tick wallclock guard: if the last tick used more than
  //    TARGET_TICK_WALLCLOCK_FRACTION of the interval, double the
  //    interval so we don't overrun.
  if (input.lastTickMs > target * TARGET_TICK_WALLCLOCK_FRACTION) {
    target = Math.min(target * 2, maxMs);
    reasons.push('last-tick-wallclock');
  }

  // 2. Dirty-churn: if the dirty set is large, shorten so we drain
  //    faster.
  if (input.dirtyAtTickStart > 50) {
    target = Math.max(target * 0.75, minMs);
    reasons.push('dirty-churn');
  } else if (input.dirtyAtTickStart === 0) {
    target = Math.min(target * 1.25, maxMs);
    reasons.push('idle');
  }

  // 3. CPU pressure: load average per core > 0.8 → loosen.
  if (input.cpuLoadAvg > 0.8) {
    target = Math.min(target * 1.25, maxMs);
    reasons.push('cpu-pressure');
  } else if (input.cpuLoadAvg < 0.2) {
    target = Math.max(target * 0.95, minMs);
    reasons.push('cpu-headroom');
  }

  // 4. Maintenance backlog: don't tick faster than the queue can drain.
  if (input.maintenanceBacklog > 4) {
    target = Math.min(target * 1.5, maxMs);
    reasons.push('maintenance-backlog');
  }

  // Rate-limit first (relative to currentMs), then clamp to [minMs, maxMs].
  // Ordering matters: a value below minMs needs to grow back up to minMs,
  // and the rate-limit alone would pin it near the previous (too-low)
  // value. Clamping AFTER the rate-limit handles the bootstrap case where
  // currentMs is itself outside the allowed band.
  const lo = input.currentMs / MAX_RATIO_CHANGE_PER_TICK;
  const hi = input.currentMs * MAX_RATIO_CHANGE_PER_TICK;
  const limited = Math.min(Math.max(target, lo), hi);
  const clamped = Math.min(Math.max(limited, minMs), maxMs);
  return {
    nextMs: Math.round(clamped),
    reasons,
  };
}

/**
 * Hardware-aware tier table for the startup interval.
 *
 *   low   → CPU-only / low RAM / pre-M3 / no usable GPU             → 60 s
 *   mid   → "strong" machine (M3/M4 base or pro, mid-tier CUDA)     → 30 s
 *   high  → "very strong" workstation (Max/Ultra, strong CUDA + RAM) → 20 s
 *
 * 15 s remains the auto-tune floor (`MIN_MS`); we deliberately keep it OFF
 * the startup table because the soak (eval/results/incremental-soak/REPORT.md)
 * only validated 15 s on this machine and the tuner can drift up to 60 s
 * under CPU pressure anyway.
 */
const TIER_TABLE = Object.freeze({ low: 60_000, mid: 30_000, high: 20_000 });

/**
 * Memory-tier table for the footprint levers (idle-TTL / RSS-budget soft cap) —
 * the lever-D analogue of TIER_TABLE. Detect once at startup from system RAM:
 * small-RAM hosts (laptops / constrained CI — the ~16 GB cross-repo OOM case in
 * `project_ss_daemon_footprint_safety`) auto-enable the footprint levers; roomy
 * hosts keep them OFF (no footprint pressure, and idle-TTL's respawn latency
 * would only cost them with nothing to reclaim). The env overrides
 * (`SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS`, `SWEET_SEARCH_RSS_BUDGET_FRACTION`)
 * always win over the tier default.
 *
 *   tight    (≤12 GiB) → idle-TTL 10 min, RSS soft cap 0.55
 *   moderate (≤24 GiB) → idle-TTL 30 min, RSS soft cap 0.60
 *   roomy    (>24 GiB) → idle-TTL OFF (0), no RSS cap (null)
 *
 * Pure: the caller injects `totalMemBytes` (os.totalmem()); a non-finite/absent
 * value resolves to `roomy` — the safe, no-surprise default (levers stay off if
 * detection ever fails).
 */
const MEMORY_TIER_TABLE = Object.freeze({
  tight: { maxGiB: 12, idleTtlMs: 600_000, rssBudgetFraction: 0.55 },
  moderate: { maxGiB: 24, idleTtlMs: 1_800_000, rssBudgetFraction: 0.60 },
  // `roomy` used to mean idleTtlMs 0 — the maintainer for a repository NEVER
  // expired. Combined with the fact that maintainers are not enumerated by the
  // daemon count cap (daemon-registry.js is search-daemons-only) and that the
  // RSS fleet budget is null here, that made the resident maintainer set
  // unbounded: one process per repository ever searched, each free to grow to
  // its 8 GiB recycle ceiling, none of them ever leaving. The tier starts at
  // just over 24 GiB, so a 32 GiB laptop got the same "no limits at all"
  // treatment as a 128 GiB workstation and reached memory pressure far sooner.
  //
  // An hour of finding nothing to index now retires it. That was NOT safe to do
  // before: with nothing to restart the maintainer, expiry meant the index
  // silently froze. Supervision (runSupervisionTick in maintainer-launcher.mjs)
  // is what changed — a repository being queried gets its maintainer back, so
  // expiry now costs at most the first query after a long absence, and only
  // repositories nobody has returned to stay retired.
  //
  // A TTL bounds the STEADY state, not the PEAK: nothing retires until its hour
  // is up, so visiting nine repositories inside that hour holds nine
  // maintainers at once. At roughly 2.7 GB each that is ~24 GB — survivable on
  // 128 GiB, not on the 32 GiB machine that also lands in this band. The band
  // is therefore split, and the marginal half keeps the moderate tier's 30 min.
  //
  // This does NOT fully bound the peak; only a fleet cap would. The RSS budget
  // coordinator is the mechanism for that and is deliberately left off here —
  // it evicts by SIGTERMing peers, and turning that on for a new class of host
  // is a change that has to be soaked across several repositories under real
  // memory pressure before it can be trusted.
  generous: { maxGiB: 64, idleTtlMs: 1_800_000, rssBudgetFraction: null },
  roomy: { maxGiB: Infinity, idleTtlMs: 3_600_000, rssBudgetFraction: null },
});

/**
 * @param {{ totalMemBytes?: number }} [options]  totalMemBytes = os.totalmem(), injected by the caller
 * @returns {{ tier:'tight'|'moderate'|'roomy', totalGiB:number, idleTtlMs:number, rssBudgetFraction:(number|null) }}
 */
export function resolveMaintainerMemoryProfile({ totalMemBytes } = {}) {
  const giB = Number.isFinite(totalMemBytes) ? totalMemBytes / (1024 ** 3) : Infinity;
  let tier = 'roomy';
  if (giB <= MEMORY_TIER_TABLE.tight.maxGiB) tier = 'tight';
  else if (giB <= MEMORY_TIER_TABLE.moderate.maxGiB) tier = 'moderate';
  else if (giB <= MEMORY_TIER_TABLE.generous.maxGiB) tier = 'generous';
  const p = MEMORY_TIER_TABLE[tier];
  return {
    tier,
    totalGiB: Number.isFinite(giB) ? Math.round(giB * 10) / 10 : Infinity,
    idleTtlMs: p.idleTtlMs,
    rssBudgetFraction: p.rssBudgetFraction,
  };
}

/**
 * Backstop full-walk cadence for the event-driven watcher (lever C / group G6).
 *
 * When the `@parcel/watcher` event stream is the primary dirty-set producer,
 * the full `scanDirtyAndEnqueue` stat-walk is demoted to a periodic backstop
 * (it still runs on the first tick, on watcher overflow, and on a forced walk).
 * This resolver returns that cadence in milliseconds, clamped to [5min, 15min]
 * — the window the design (§4.C) accepts as the worst-case convergence latency
 * for a gitignore/exclude change that produced no file event. G4 owns this file;
 * G6 consumes the resolved value from the maintainer loop.
 *
 * Precedence (highest first):
 *   1. `SWEET_SEARCH_MAINTAINER_BACKSTOP_WALK_MS` (milliseconds)
 *   2. default 10 min
 *
 * Values are clamped into [BACKSTOP_MIN_MS, BACKSTOP_MAX_MS]; a non-finite or
 * non-positive override falls back to the default.
 */
const BACKSTOP_MIN_MS = 300_000;   // 5 min
const BACKSTOP_MAX_MS = 900_000;   // 15 min
const BACKSTOP_DEFAULT_MS = 600_000; // 10 min

/**
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ intervalMs:number, source:'env-override-ms'|'default' }}
 */
export function backstopWalkIntervalMs({ env = process.env } = {}) {
  const raw = env.SWEET_SEARCH_MAINTAINER_BACKSTOP_WALK_MS;
  if (raw !== undefined && raw !== '') {
    const ms = Number(raw);
    if (Number.isFinite(ms) && ms > 0) {
      return {
        intervalMs: Math.min(Math.max(ms, BACKSTOP_MIN_MS), BACKSTOP_MAX_MS),
        source: 'env-override-ms',
      };
    }
  }
  return { intervalMs: BACKSTOP_DEFAULT_MS, source: 'default' };
}

/**
 * `SWEET_SEARCH_RECONCILE_PROFILE` lets operators pin the startup interval
 * by intent rather than by tier. `balanced` is a no-op (falls through to
 * the hardware-tier table); `fresh` and `conservative` pin like an env
 * override would.
 */
const PROFILE_TABLE = Object.freeze({
  fresh: 20_000,
  balanced: null,
  conservative: 60_000,
});

function clampInterval(ms) {
  return Math.min(Math.max(ms, MIN_MS), MAX_MS);
}

/**
 * Map a `core/infrastructure/hardware-capability.js` descriptor to a
 * reconcile-interval tier. Conservative: we only escalate to `high` when
 * we have specific evidence (Max/Ultra Apple Silicon or a 16 GB+ CUDA
 * card); everything else collapses to `mid` (strong) or `low` (CPU-only
 * / unknown).
 *
 * @param {object|null} hw  detectHardwareCapability() output
 * @returns {'low'|'mid'|'high'}
 */
export function tierForHardware(hw) {
  if (!hw) return 'low';
  if (hw.appleSilicon) {
    const variant = (hw.appleSilicon.variant || '').toLowerCase();
    const generation = hw.appleSilicon.generation || 0;
    if (variant === 'max' || variant === 'ultra') return 'high';
    if (generation >= 3) return 'mid';
    if (variant === 'pro') return 'mid';
    return 'low';
  }
  if (hw.cudaAvailable && hw.nvidiaGpu) {
    const vramMb = Number(hw.nvidiaGpu.memoryMB) || 0;
    if (vramMb >= 16_384) return 'high';
    return 'mid';
  }
  const totalMemGB = Number(hw.totalMemGB) || 0;
  const cores = Number(hw.logicalCores) || 0;
  if (totalMemGB >= 32 && cores >= 12) return 'mid';
  return 'low';
}

/**
 * Compute the starting interval from a fresh process.
 *
 * Precedence (highest first):
 *   1. `SWEET_SEARCH_RECONCILE_INTERVAL_MS` (milliseconds)
 *   2. `SWEET_SEARCH_RECONCILE_INTERVAL`    (seconds — legacy semantics)
 *   3. `SWEET_SEARCH_RECONCILE_PROFILE` ∈ {fresh, balanced, conservative}
 *   4. `tier` argument (low/mid/high) OR `hardware` descriptor resolved
 *      via `tierForHardware()`
 *
 * Values are clamped into `[MIN_MS, MAX_MS]`. 15 s stays the auto-tune
 * floor only; the startup table never picks it.
 *
 * @param {{
 *   tier?: 'low'|'mid'|'high',
 *   env?: NodeJS.ProcessEnv,
 *   hardware?: object|null,
 * }} options
 * @returns {{intervalMs:number, pinned:boolean, source:string}}
 */
export function startupInterval({ tier, env = process.env, hardware = null } = {}) {
  const rawMs = env.SWEET_SEARCH_RECONCILE_INTERVAL_MS;
  if (rawMs !== undefined && rawMs !== '') {
    const ms = Number(rawMs);
    if (Number.isFinite(ms) && ms > 0) {
      return { intervalMs: clampInterval(ms), pinned: true, source: 'env-override-ms' };
    }
  }
  const rawSec = env.SWEET_SEARCH_RECONCILE_INTERVAL;
  if (rawSec !== undefined && rawSec !== '') {
    const seconds = Number(rawSec);
    if (Number.isFinite(seconds) && seconds > 0) {
      return { intervalMs: clampInterval(seconds * 1000), pinned: true, source: 'env-override' };
    }
  }
  const rawProfile = env.SWEET_SEARCH_RECONCILE_PROFILE;
  if (rawProfile !== undefined && rawProfile !== '') {
    const profile = String(rawProfile).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PROFILE_TABLE, profile)) {
      const pinnedMs = PROFILE_TABLE[profile];
      if (pinnedMs != null) {
        return { intervalMs: clampInterval(pinnedMs), pinned: true, source: `profile-${profile}` };
      }
      // `balanced` falls through to the hardware-tier table by design.
    }
  }
  let resolvedTier = tier;
  if (!resolvedTier && hardware) resolvedTier = tierForHardware(hardware);
  // Unknown / detection-failed hardware → the conservative `low` (60 s) tier.
  // In production `resolveReconcileV2Interval` always threads a detected
  // descriptor, so this fallback only fires when detection threw or a caller
  // passes neither tier nor hardware; 60 s is the safe default for a machine
  // we know nothing about.
  if (!resolvedTier) resolvedTier = 'low';
  const intervalMs = TIER_TABLE[resolvedTier] ?? NOMINAL_MS;
  return {
    intervalMs,
    pinned: false,
    source: `tier-${resolvedTier}`,
  };
}

/**
 * Whether reconcile-v2 incremental indexing should run, given the process
 * environment. This is the single source of truth for the `default-on`
 * rollout policy; the index-maintainer daemon and the operator `status`
 * surface both delegate here so they can never disagree.
 *
 * Policy:
 *   - missing / empty `SWEET_SEARCH_RECONCILE_V2`  → enabled  (source `default-on`)
 *   - `0` / `false` / `off`                        → disabled (source `env-disabled`)
 *   - `1` / `true` / `on`                          → enabled  (source `env-enabled`)
 *   - any other non-empty value                    → enabled  (source `env-enabled-permissive`)
 *
 * The permissive branch matches the historical behaviour (anything not an
 * explicit off-token enabled v2); callers may surface a warning so a typo'd
 * value isn't silently treated as enabled.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{enabled:boolean, source:'default-on'|'env-disabled'|'env-enabled'|'env-enabled-permissive', raw:string|null}}
 */
export function reconcileEnablement(env = process.env) {
  const raw = env.SWEET_SEARCH_RECONCILE_V2;
  if (raw == null || raw === '') {
    return { enabled: true, source: 'default-on', raw: null };
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'off') {
    return { enabled: false, source: 'env-disabled', raw: String(raw) };
  }
  if (normalized === '1' || normalized === 'true' || normalized === 'on') {
    return { enabled: true, source: 'env-enabled', raw: String(raw) };
  }
  return { enabled: true, source: 'env-enabled-permissive', raw: String(raw) };
}

export const __testing = {
  MIN_MS, MAX_MS, NOMINAL_MS,
  TARGET_TICK_WALLCLOCK_FRACTION, MAX_RATIO_CHANGE_PER_TICK,
  TIER_TABLE, PROFILE_TABLE, MEMORY_TIER_TABLE,
  BACKSTOP_MIN_MS, BACKSTOP_MAX_MS, BACKSTOP_DEFAULT_MS,
};
