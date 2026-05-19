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
  if (!resolvedTier) resolvedTier = 'mid';
  const intervalMs = TIER_TABLE[resolvedTier] ?? NOMINAL_MS;
  return {
    intervalMs,
    pinned: false,
    source: `tier-${resolvedTier}`,
  };
}

export const __testing = {
  MIN_MS, MAX_MS, NOMINAL_MS,
  TARGET_TICK_WALLCLOCK_FRACTION, MAX_RATIO_CHANGE_PER_TICK,
  TIER_TABLE, PROFILE_TABLE,
};
