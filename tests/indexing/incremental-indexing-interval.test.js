/**
 * Tests for core/incremental-indexing/domain/interval-autotune.mjs
 *
 * Plan § 14.2.1 + § 34.
 */

import { describe, it, expect } from 'vitest';
import {
  nextInterval,
  startupInterval,
  __testing,
} from '../../core/incremental-indexing/domain/interval-autotune.mjs';

describe('interval / startupInterval', () => {
  it('reads SWEET_SEARCH_RECONCILE_INTERVAL as seconds', () => {
    const out = startupInterval({ tier: 'mid', env: { SWEET_SEARCH_RECONCILE_INTERVAL: '120' } });
    expect(out.intervalMs).toBe(120_000);
    expect(out.pinned).toBe(true);
    expect(out.source).toBe('env-override');
  });

  it('falls back to the tier table', () => {
    expect(startupInterval({ tier: 'low', env: {} }).intervalMs).toBe(180_000);
    expect(startupInterval({ tier: 'mid', env: {} }).intervalMs).toBe(60_000);
    expect(startupInterval({ tier: 'high', env: {} }).intervalMs).toBe(30_000);
  });

  it('clamps the env override into [15s, 300s]', () => {
    expect(startupInterval({ tier: 'mid', env: { SWEET_SEARCH_RECONCILE_INTERVAL: '5' } }).intervalMs)
      .toBe(15_000);
    expect(startupInterval({ tier: 'mid', env: { SWEET_SEARCH_RECONCILE_INTERVAL: '600' } }).intervalMs)
      .toBe(300_000);
  });

  it('ignores invalid env values', () => {
    const out = startupInterval({ tier: 'mid', env: { SWEET_SEARCH_RECONCILE_INTERVAL: 'banana' } });
    expect(out.pinned).toBe(false);
    expect(out.intervalMs).toBe(60_000);
  });
});

describe('interval / nextInterval', () => {
  it('idle + cheap last tick + headroom → grow interval', () => {
    const out = nextInterval({
      currentMs: 60_000,
      lastTickMs: 200,
      dirtyAtTickStart: 0,
      cpuLoadAvg: 0.1,
      maintenanceBacklog: 0,
    });
    expect(out.nextMs).toBeGreaterThanOrEqual(60_000);
    expect(out.reasons).toContain('idle');
  });

  it('busy dirty set → shrink', () => {
    const out = nextInterval({
      currentMs: 60_000,
      lastTickMs: 200,
      dirtyAtTickStart: 200,
      cpuLoadAvg: 0.1,
      maintenanceBacklog: 0,
    });
    expect(out.nextMs).toBeLessThan(60_000);
    expect(out.reasons).toContain('dirty-churn');
  });

  it('overran tick wallclock → grow', () => {
    const out = nextInterval({
      currentMs: 60_000,
      lastTickMs: 50_000, // 83 % of interval
      dirtyAtTickStart: 5,
      cpuLoadAvg: 0.5,
      maintenanceBacklog: 0,
    });
    expect(out.reasons).toContain('last-tick-wallclock');
    expect(out.nextMs).toBeGreaterThan(60_000);
  });

  it('respects the 1.5x rate-limit even on extreme signals', () => {
    const out = nextInterval({
      currentMs: 60_000,
      lastTickMs: 59_999,
      dirtyAtTickStart: 1000,
      cpuLoadAvg: 5,
      maintenanceBacklog: 100,
    });
    expect(out.nextMs).toBeLessThanOrEqual(60_000 * __testing.MAX_RATIO_CHANGE_PER_TICK);
    expect(out.nextMs).toBeGreaterThanOrEqual(60_000 / __testing.MAX_RATIO_CHANGE_PER_TICK);
  });

  it('clamps to [15s, 300s]', () => {
    const out = nextInterval({
      currentMs: 100,
      lastTickMs: 50,
      dirtyAtTickStart: 0,
      cpuLoadAvg: 0.5,
      maintenanceBacklog: 0,
    });
    expect(out.nextMs).toBeGreaterThanOrEqual(__testing.MIN_MS);
  });
});
