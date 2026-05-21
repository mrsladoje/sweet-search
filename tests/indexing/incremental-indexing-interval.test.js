/**
 * Tests for core/incremental-indexing/domain/interval-autotune.mjs
 *
 * Plan § 14.2.1 + § 34 + hardware-aware startup defaults
 * (eval/results/incremental-soak/REPORT.md § 7).
 */

import { describe, it, expect } from 'vitest';
import {
  nextInterval,
  startupInterval,
  tierForHardware,
  reconcileEnablement,
  __testing,
} from '../../core/incremental-indexing/domain/interval-autotune.mjs';

describe('interval / startupInterval / env precedence', () => {
  it('honours SWEET_SEARCH_RECONCILE_INTERVAL_MS first', () => {
    const out = startupInterval({
      tier: 'low',
      env: {
        SWEET_SEARCH_RECONCILE_INTERVAL_MS: '45000',
        SWEET_SEARCH_RECONCILE_INTERVAL: '120',
        SWEET_SEARCH_RECONCILE_PROFILE: 'fresh',
      },
    });
    expect(out.intervalMs).toBe(45_000);
    expect(out.pinned).toBe(true);
    expect(out.source).toBe('env-override-ms');
  });

  it('falls back to SWEET_SEARCH_RECONCILE_INTERVAL (seconds) when _MS absent', () => {
    const out = startupInterval({
      tier: 'low',
      env: {
        SWEET_SEARCH_RECONCILE_INTERVAL: '120',
        SWEET_SEARCH_RECONCILE_PROFILE: 'fresh',
      },
    });
    expect(out.intervalMs).toBe(120_000);
    expect(out.pinned).toBe(true);
    expect(out.source).toBe('env-override');
  });

  it('clamps _MS / SECONDS overrides into [15s, 300s]', () => {
    expect(startupInterval({ tier: 'mid', env: { SWEET_SEARCH_RECONCILE_INTERVAL_MS: '500' } }).intervalMs)
      .toBe(15_000);
    expect(startupInterval({ tier: 'mid', env: { SWEET_SEARCH_RECONCILE_INTERVAL_MS: '999999' } }).intervalMs)
      .toBe(300_000);
    expect(startupInterval({ tier: 'mid', env: { SWEET_SEARCH_RECONCILE_INTERVAL: '5' } }).intervalMs)
      .toBe(15_000);
    expect(startupInterval({ tier: 'mid', env: { SWEET_SEARCH_RECONCILE_INTERVAL: '600' } }).intervalMs)
      .toBe(300_000);
  });

  it('ignores invalid env values and falls back to tier table', () => {
    const out = startupInterval({
      tier: 'mid',
      env: {
        SWEET_SEARCH_RECONCILE_INTERVAL: 'banana',
        SWEET_SEARCH_RECONCILE_INTERVAL_MS: 'forever',
      },
    });
    expect(out.pinned).toBe(false);
    expect(out.intervalMs).toBe(30_000);
  });
});

describe('interval / startupInterval / profile env', () => {
  it('pins to 20s when SWEET_SEARCH_RECONCILE_PROFILE=fresh', () => {
    const out = startupInterval({ tier: 'low', env: { SWEET_SEARCH_RECONCILE_PROFILE: 'fresh' } });
    expect(out.intervalMs).toBe(20_000);
    expect(out.pinned).toBe(true);
    expect(out.source).toBe('profile-fresh');
  });

  it('pins to 60s when SWEET_SEARCH_RECONCILE_PROFILE=conservative', () => {
    const out = startupInterval({ tier: 'high', env: { SWEET_SEARCH_RECONCILE_PROFILE: 'conservative' } });
    expect(out.intervalMs).toBe(60_000);
    expect(out.pinned).toBe(true);
    expect(out.source).toBe('profile-conservative');
  });

  it('balanced profile falls through to the tier table', () => {
    const out = startupInterval({ tier: 'mid', env: { SWEET_SEARCH_RECONCILE_PROFILE: 'balanced' } });
    expect(out.pinned).toBe(false);
    expect(out.intervalMs).toBe(30_000);
    expect(out.source).toBe('tier-mid');
  });

  it('unknown profile is ignored and tier table wins', () => {
    const out = startupInterval({ tier: 'low', env: { SWEET_SEARCH_RECONCILE_PROFILE: 'flaming-hot' } });
    expect(out.pinned).toBe(false);
    expect(out.intervalMs).toBe(60_000);
  });
});

describe('interval / startupInterval / tier table', () => {
  it('low=60s, mid=30s, high=20s (hardware-aware defaults)', () => {
    expect(startupInterval({ tier: 'low', env: {} }).intervalMs).toBe(60_000);
    expect(startupInterval({ tier: 'mid', env: {} }).intervalMs).toBe(30_000);
    expect(startupInterval({ tier: 'high', env: {} }).intervalMs).toBe(20_000);
  });

  it('defaults to the conservative low tier (60s) when neither tier nor hardware is supplied', () => {
    // Unknown / detection-failed hardware → 60s, not 30s. In production
    // resolveReconcileV2Interval always threads a detected descriptor; this
    // bootstrap fallback only fires when detection threw or a caller passes
    // nothing, and 60s is the safe default for an unknown machine.
    const out = startupInterval({ env: {} });
    expect(out.intervalMs).toBe(60_000);
    expect(out.source).toBe('tier-low');
  });

  it('resolves tier from hardware descriptor when explicit tier absent', () => {
    const out = startupInterval({
      env: {},
      hardware: { appleSilicon: { generation: 4, variant: 'ultra' }, totalMemGB: 192 },
    });
    expect(out.intervalMs).toBe(20_000);
    expect(out.source).toBe('tier-high');
  });
});

describe('interval / tierForHardware', () => {
  it('Apple Max/Ultra → high', () => {
    expect(tierForHardware({ appleSilicon: { generation: 3, variant: 'max' } })).toBe('high');
    expect(tierForHardware({ appleSilicon: { generation: 4, variant: 'ultra' } })).toBe('high');
  });

  it('Apple M3+ base or any Pro variant → mid', () => {
    expect(tierForHardware({ appleSilicon: { generation: 3, variant: 'base' } })).toBe('mid');
    expect(tierForHardware({ appleSilicon: { generation: 2, variant: 'pro' } })).toBe('mid');
    expect(tierForHardware({ appleSilicon: { generation: 4, variant: 'base' } })).toBe('mid');
  });

  it('pre-M3 base Apple Silicon → low', () => {
    expect(tierForHardware({ appleSilicon: { generation: 1, variant: 'base' } })).toBe('low');
    expect(tierForHardware({ appleSilicon: { generation: 2, variant: 'base' } })).toBe('low');
  });

  it('CUDA: 16 GB+ VRAM → high, else mid', () => {
    expect(tierForHardware({ cudaAvailable: true, nvidiaGpu: { memoryMB: 24_576 } })).toBe('high');
    expect(tierForHardware({ cudaAvailable: true, nvidiaGpu: { memoryMB: 8_192 } })).toBe('mid');
  });

  it('Plain CPU with >=32GB RAM + >=12 cores → mid, else low', () => {
    expect(tierForHardware({ totalMemGB: 64, logicalCores: 16 })).toBe('mid');
    expect(tierForHardware({ totalMemGB: 16, logicalCores: 8 })).toBe('low');
  });

  it('null/undefined hardware → low (conservative default)', () => {
    expect(tierForHardware(null)).toBe('low');
    expect(tierForHardware(undefined)).toBe('low');
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

describe('reconcileEnablement (default-on rollout policy)', () => {
  it('is enabled by default when SWEET_SEARCH_RECONCILE_V2 is absent', () => {
    const out = reconcileEnablement({});
    expect(out.enabled).toBe(true);
    expect(out.source).toBe('default-on');
    expect(out.raw).toBeNull();
  });

  it('is enabled by default when SWEET_SEARCH_RECONCILE_V2 is empty', () => {
    const out = reconcileEnablement({ SWEET_SEARCH_RECONCILE_V2: '' });
    expect(out.enabled).toBe(true);
    expect(out.source).toBe('default-on');
  });

  it('is disabled by the explicit off-tokens 0 / false / off (case-insensitive)', () => {
    for (const v of ['0', 'false', 'off', 'FALSE', 'Off', ' off ']) {
      const out = reconcileEnablement({ SWEET_SEARCH_RECONCILE_V2: v });
      expect(out.enabled).toBe(false);
      expect(out.source).toBe('env-disabled');
      expect(out.raw).toBe(v);
    }
  });

  it('is enabled by the explicit on-tokens 1 / true / on (case-insensitive)', () => {
    for (const v of ['1', 'true', 'on', 'TRUE', 'On']) {
      const out = reconcileEnablement({ SWEET_SEARCH_RECONCILE_V2: v });
      expect(out.enabled).toBe(true);
      expect(out.source).toBe('env-enabled');
    }
  });

  it('treats any other non-empty value as permissive-enabled (back-compat)', () => {
    const out = reconcileEnablement({ SWEET_SEARCH_RECONCILE_V2: 'yes-please' });
    expect(out.enabled).toBe(true);
    expect(out.source).toBe('env-enabled-permissive');
    expect(out.raw).toBe('yes-please');
  });
});
