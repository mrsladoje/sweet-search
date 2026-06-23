/**
 * G4 daemon-lifecycle tests: OS priority (A.1), autotune-consume (A.4),
 * idle-TTL bookkeeping (D.1), and the backstop-walk cadence resolver
 * (interval-autotune.mjs, for G6).
 *
 * These exercise the PURE, exported decision helpers in
 * `core/indexing/index-maintainer.mjs` (and `interval-autotune.mjs`) — the
 * load-bearing logic of the daemon sleep loop — without spinning up the full
 * daemon. The integration loop itself is covered by
 * tests/integration/index-maintainer.integration.test.js and
 * maintainer-lifecycle-fix.test.js.
 *
 * Source design: docs/INDEX_MAINTAINER_EFFICIENCY_IMPLEMENTATION_PLAN.md § G4.
 */

import { describe, it, expect } from 'vitest';
import os from 'node:os';

import {
  reconcileAutotuneEnabled,
  computeNextIntervalMs,
  maintainerIdleTtlMs,
  recordIdleTick,
  idleTtlExceeded,
} from '../../core/indexing/index-maintainer.mjs';
import { backstopWalkIntervalMs, __testing } from '../../core/incremental-indexing/domain/interval-autotune.mjs';

// ---- A.1 priority-set smoke ------------------------------------------------

describe('A.1 / os.setPriority background demotion smoke', () => {
  it('os.setPriority(PRIORITY_LOW) never throws (or is caught) on this platform', () => {
    // Mirror the exact call the daemon makes at the top of main(). On macOS the
    // demotion may require privileges for some niceness values; PRIORITY_LOW is
    // the safe one, and the daemon wraps it in try/catch regardless. This test
    // asserts the wrapped form is a no-throw.
    expect(() => {
      try { os.setPriority(os.constants.priority.PRIORITY_LOW); } catch { /* best-effort */ }
    }).not.toThrow();
  });

  it('os.constants.priority.PRIORITY_LOW is a defined integer', () => {
    expect(typeof os.constants.priority.PRIORITY_LOW).toBe('number');
  });
});

// ---- A.4 autotune-consume --------------------------------------------------

describe('A.4 / reconcileAutotuneEnabled gate (DEFAULT-ON)', () => {
  it('is ON by default (flag absent/empty)', () => {
    // DEFAULT-ON: only an explicit '0' disables it.
    expect(reconcileAutotuneEnabled({})).toBe(true);
    expect(reconcileAutotuneEnabled({ SWEET_SEARCH_RECONCILE_AUTOTUNE: '' })).toBe(true);
  });
  it('only the explicit "0" token disables it', () => {
    expect(reconcileAutotuneEnabled({ SWEET_SEARCH_RECONCILE_AUTOTUNE: '1' })).toBe(true);
    expect(reconcileAutotuneEnabled({ SWEET_SEARCH_RECONCILE_AUTOTUNE: 'true' })).toBe(true);
    expect(reconcileAutotuneEnabled({ SWEET_SEARCH_RECONCILE_AUTOTUNE: 'on' })).toBe(true);
    expect(reconcileAutotuneEnabled({ SWEET_SEARCH_RECONCILE_AUTOTUNE: '0' })).toBe(false);
  });
});

describe('A.4 / computeNextIntervalMs (the doubly-dead-trap guard)', () => {
  const flagOn = { SWEET_SEARCH_RECONCILE_AUTOTUNE: '1' };

  it('returns currentMs unchanged when the flag is explicitly OFF (=0, legacy behavior)', () => {
    // Autotune is DEFAULT-ON, so the legacy fixed-interval path is exercised by
    // explicitly disabling it with '0'.
    const out = computeNextIntervalMs({
      currentMs: 60_000,
      counters: { tick_ms: 200, dirty_paths_seen: 500 },
      maintenanceBacklog: 50,
      env: { SWEET_SEARCH_RECONCILE_AUTOTUNE: '0' },
      loadavg: () => [4, 4, 4],
      cpuCount: () => 4,
    });
    expect(out.nextMs).toBe(60_000);
    expect(out.tuned).toBe(false);
  });

  it('a busy dirty set SHRINKS the interval when the flag is ON (interval actually moves)', () => {
    const out = computeNextIntervalMs({
      currentMs: 60_000,
      counters: { tick_ms: 200, dirty_paths_seen: 200 },
      maintenanceBacklog: 0,
      env: flagOn,
      loadavg: () => [0.2, 0.2, 0.2],
      cpuCount: () => 8,
    });
    // This is the key assertion: the tuned interval is actually different from
    // the one the daemon slept on (proving the consume half is wired, not dead).
    expect(out.tuned).toBe(true);
    expect(out.nextMs).toBeLessThan(60_000);
    expect(out.reasons).toContain('dirty-churn');
  });

  it('an overran tick GROWS the interval when the flag is ON', () => {
    const out = computeNextIntervalMs({
      currentMs: 60_000,
      counters: { tick_ms: 50_000, dirty_paths_seen: 5 }, // 83% of interval
      maintenanceBacklog: 0,
      env: flagOn,
      loadavg: () => [0.5, 0.5, 0.5],
      cpuCount: () => 4,
    });
    expect(out.tuned).toBe(true);
    expect(out.nextMs).toBeGreaterThan(60_000);
    expect(out.reasons).toContain('last-tick-wallclock');
  });

  it('high CPU load loosens the interval (load-per-core signal)', () => {
    const out = computeNextIntervalMs({
      currentMs: 60_000,
      counters: { tick_ms: 200, dirty_paths_seen: 5 },
      maintenanceBacklog: 0,
      env: flagOn,
      loadavg: () => [16, 16, 16], // 16 / 4 cores = 4.0 per core (> 0.8)
      cpuCount: () => 4,
    });
    expect(out.reasons).toContain('cpu-pressure');
    expect(out.nextMs).toBeGreaterThan(60_000);
  });

  it('Windows fallback: os.loadavg() === [0,0,0] does NOT trip the loosen-under-load signal', () => {
    const out = computeNextIntervalMs({
      currentMs: 60_000,
      counters: { tick_ms: 200, dirty_paths_seen: 5 },
      maintenanceBacklog: 0,
      env: flagOn,
      loadavg: () => [0, 0, 0], // Windows reports a flat zero load average
      cpuCount: () => 8,
    });
    // 0/8 = 0 per core → no 'cpu-pressure' loosen. (cpu-headroom may nudge down
    // by 0.95 but the loosen-under-load path the doc warns about is skipped.)
    expect(out.reasons).not.toContain('cpu-pressure');
  });

  it('a skipped (dormant/paused) tick leaves the interval untouched even with the flag on', () => {
    const out = computeNextIntervalMs({
      currentMs: 45_000,
      counters: { skipped: true },
      maintenanceBacklog: 0,
      env: flagOn,
      loadavg: () => [0, 0, 0],
      cpuCount: () => 8,
    });
    expect(out.tuned).toBe(false);
    expect(out.nextMs).toBe(45_000);
  });

  it('a null counters payload leaves the interval untouched', () => {
    const out = computeNextIntervalMs({
      currentMs: 30_000,
      counters: null,
      maintenanceBacklog: 0,
      env: flagOn,
    });
    expect(out.tuned).toBe(false);
    expect(out.nextMs).toBe(30_000);
  });

  it('never throws when os accessors throw (best-effort load read)', () => {
    expect(() => computeNextIntervalMs({
      currentMs: 60_000,
      counters: { tick_ms: 200, dirty_paths_seen: 5 },
      maintenanceBacklog: 0,
      env: flagOn,
      loadavg: () => { throw new Error('no loadavg'); },
      cpuCount: () => { throw new Error('no cpus'); },
    })).not.toThrow();
  });
});

// ---- D.1 idle-TTL ----------------------------------------------------------

describe('D.1 / maintainerIdleTtlMs', () => {
  it('is 0/disabled by default and on invalid values', () => {
    expect(maintainerIdleTtlMs({})).toBe(0);
    expect(maintainerIdleTtlMs({ SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS: '' })).toBe(0);
    expect(maintainerIdleTtlMs({ SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS: 'banana' })).toBe(0);
    expect(maintainerIdleTtlMs({ SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS: '-5' })).toBe(0);
    expect(maintainerIdleTtlMs({ SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS: '0' })).toBe(0);
  });
  it('honours a positive ms value', () => {
    expect(maintainerIdleTtlMs({ SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS: '1200000' })).toBe(1_200_000);
  });
});

describe('D.1 / recordIdleTick + idleTtlExceeded (consecutive-empty-tick signal)', () => {
  it('counts consecutive empty ticks and anchors the wall clock once', () => {
    const state = { idleTicks: 0, idleSinceMs: null };
    const r1 = recordIdleTick(state, { dirtyAtTickStart: 0, maintenanceBacklog: 0, nowMs: 1000 });
    expect(r1.idle).toBe(true);
    expect(state.idleTicks).toBe(1);
    expect(state.idleSinceMs).toBe(1000); // anchored at the FIRST idle tick

    const r2 = recordIdleTick(state, { dirtyAtTickStart: 0, maintenanceBacklog: 0, nowMs: 2000 });
    expect(r2.idle).toBe(true);
    expect(state.idleTicks).toBe(2);
    expect(state.idleSinceMs).toBe(1000); // NOT re-anchored
  });

  it('an indexed change (dirty) RESETS the idle counter and clock', () => {
    const state = { idleTicks: 3, idleSinceMs: 1000 };
    const r = recordIdleTick(state, { dirtyAtTickStart: 5, maintenanceBacklog: 0, nowMs: 5000 });
    expect(r.idle).toBe(false);
    expect(state.idleTicks).toBe(0);
    expect(state.idleSinceMs).toBeNull();
  });

  it('a non-empty maintenance queue counts as activity (resets)', () => {
    const state = { idleTicks: 2, idleSinceMs: 1000 };
    const r = recordIdleTick(state, { dirtyAtTickStart: 0, maintenanceBacklog: 3, nowMs: 5000 });
    expect(r.idle).toBe(false);
    expect(state.idleTicks).toBe(0);
    expect(state.idleSinceMs).toBeNull();
  });

  it('a skipped (dormant baseline) tick is treated as idle, not activity', () => {
    const state = { idleTicks: 0, idleSinceMs: null };
    const r = recordIdleTick(state, { dirtyAtTickStart: 0, maintenanceBacklog: 0, skipped: true, nowMs: 100 });
    expect(r.idle).toBe(true);
    expect(state.idleTicks).toBe(1);
  });

  it('idleTtlExceeded fires only after the wall-clock budget elapses across idle ticks', () => {
    const ttl = 1_200_000; // 20 min
    const state = { idleTicks: 0, idleSinceMs: null };
    recordIdleTick(state, { dirtyAtTickStart: 0, maintenanceBacklog: 0, nowMs: 0 });
    // Just one idle tick at t=0; not yet exceeded a moment later.
    expect(idleTtlExceeded(state, ttl, 60_000)).toBe(false);
    // After the full TTL of continuous idleness → exceeded.
    expect(idleTtlExceeded(state, ttl, ttl)).toBe(true);
    expect(idleTtlExceeded(state, ttl, ttl + 1)).toBe(true);
  });

  it('idleTtlExceeded is never true when disabled (ttl<=0) or never-idle', () => {
    const idle = { idleTicks: 5, idleSinceMs: 0 };
    expect(idleTtlExceeded(idle, 0, 10_000_000)).toBe(false);
    expect(idleTtlExceeded(idle, -1, 10_000_000)).toBe(false);
    const fresh = { idleTicks: 0, idleSinceMs: null };
    expect(idleTtlExceeded(fresh, 1000, 10_000_000)).toBe(false);
  });

  it('a busy tick after an idle streak makes idleTtlExceeded false again (reset path)', () => {
    const ttl = 100;
    const state = { idleTicks: 0, idleSinceMs: null };
    recordIdleTick(state, { dirtyAtTickStart: 0, maintenanceBacklog: 0, nowMs: 0 });
    expect(idleTtlExceeded(state, ttl, 200)).toBe(true);
    // A busy tick lands — the daemon would NOT have shut down because the idle
    // timer only sets shutdownRequested while idle; once reset, no shutdown.
    recordIdleTick(state, { dirtyAtTickStart: 1, maintenanceBacklog: 0, nowMs: 300 });
    expect(idleTtlExceeded(state, ttl, 500)).toBe(false);
  });
});

// ---- backstopWalkIntervalMs (G6 resolver, owned here) ----------------------

describe('backstopWalkIntervalMs (G6 backstop cadence resolver)', () => {
  it('defaults to 10 min', () => {
    const out = backstopWalkIntervalMs({ env: {} });
    expect(out.intervalMs).toBe(__testing.BACKSTOP_DEFAULT_MS);
    expect(out.intervalMs).toBe(600_000);
    expect(out.source).toBe('default');
  });

  it('honours an explicit ms override clamped to [5min, 15min]', () => {
    expect(backstopWalkIntervalMs({ env: { SWEET_SEARCH_MAINTAINER_BACKSTOP_WALK_MS: '420000' } }).intervalMs).toBe(420_000);
    // Below the floor clamps up to 5 min; above the ceiling clamps to 15 min.
    expect(backstopWalkIntervalMs({ env: { SWEET_SEARCH_MAINTAINER_BACKSTOP_WALK_MS: '1000' } }).intervalMs).toBe(__testing.BACKSTOP_MIN_MS);
    expect(backstopWalkIntervalMs({ env: { SWEET_SEARCH_MAINTAINER_BACKSTOP_WALK_MS: '99999999' } }).intervalMs).toBe(__testing.BACKSTOP_MAX_MS);
  });

  it('ignores invalid overrides and falls back to default', () => {
    expect(backstopWalkIntervalMs({ env: { SWEET_SEARCH_MAINTAINER_BACKSTOP_WALK_MS: 'banana' } }).intervalMs).toBe(600_000);
    expect(backstopWalkIntervalMs({ env: { SWEET_SEARCH_MAINTAINER_BACKSTOP_WALK_MS: '-5' } }).source).toBe('default');
  });
});
