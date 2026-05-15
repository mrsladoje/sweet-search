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
 * Compute the starting interval from a fresh process. Honours
 * `SWEET_SEARCH_RECONCILE_INTERVAL` (in seconds; legacy semantics) when
 * set; otherwise picks the hardware-tier default from the table in plan
 * § 34.2.
 *
 * @param {{tier:'low'|'mid'|'high', env?:NodeJS.ProcessEnv}} options
 * @returns {{intervalMs:number, pinned:boolean, source:string}}
 */
export function startupInterval({ tier, env = process.env }) {
  const raw = env.SWEET_SEARCH_RECONCILE_INTERVAL;
  if (raw !== undefined && raw !== '') {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) {
      return {
        intervalMs: Math.min(Math.max(seconds * 1000, MIN_MS), MAX_MS),
        pinned: true,
        source: 'env-override',
      };
    }
  }
  const table = { low: 180_000, mid: 60_000, high: 30_000 };
  return {
    intervalMs: table[tier] ?? NOMINAL_MS,
    pinned: false,
    source: `tier-${tier ?? 'mid'}`,
  };
}

export const __testing = { MIN_MS, MAX_MS, NOMINAL_MS, TARGET_TICK_WALLCLOCK_FRACTION, MAX_RATIO_CHANGE_PER_TICK };
