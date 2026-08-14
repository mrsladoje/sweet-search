/**
 * Unit tests for the global RSS-budget soft-eviction coordinator (G7, D.3/D.4).
 *
 * Pure logic + injected readers — NO real daemons, signals, or model loads. The
 * eviction decision is exercised through `runEvictionTick` with fake RSS /
 * pressure readers and a fake `signal` so we can assert exactly which pid would
 * be SIGTERM'd. Each test points the registry at a throwaway /tmp file via
 * SWEET_SEARCH_RSS_REGISTRY and builds its own `env` so the default-OFF gate and
 * the shared host path are never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import os from 'node:os';

import {
  rssRegistryPath,
  budgetFraction,
  isEnabled,
  budgetBytes,
  isOverBudget,
  readProcessRss,
  readLinuxMemoryPressure,
  registerDaemon,
  runEvictionTick,
  MAINTAINER_RSS_RESIDENT_FLOOR_BYTES,
  _readRegistryForTest,
} from '../../core/indexing/rss-budget.mjs';

let dir;
let registryFile;
/** env with the coordinator ENABLED at a given fraction, pointed at a temp registry. */
function onEnv(fraction = '0.6') {
  return { SWEET_SEARCH_RSS_REGISTRY: registryFile, SWEET_SEARCH_RSS_BUDGET_FRACTION: String(fraction) };
}
/**
 * env with the coordinator EXPLICITLY DISABLED, pointed at the temp file.
 * Sets the fraction to '' (→ null regardless of host RAM). Leaving it UNSET would
 * fall through to the RAM-tier default, which auto-enables on ≤24 GiB hosts — making
 * these "no-op when disabled" tests pass on 128 GB dev boxes but fail on small CI runners.
 */
function offEnv() {
  return { SWEET_SEARCH_RSS_REGISTRY: registryFile, SWEET_SEARCH_RSS_BUDGET_FRACTION: '' };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ss-rss-budget-'));
  registryFile = join(dir, 'rss-daemons.json');
});

afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** Seed the registry file directly with a daemon map (bypasses registerDaemon). */
function seedRegistry(entries) {
  const daemons = {};
  for (const e of entries) daemons[String(e.pid)] = e;
  writeFileSync(registryFile, JSON.stringify({ daemons }), 'utf-8');
}

describe('budgetFraction / isEnabled (the explicit env gate)', () => {
  const ROOMY = 64 * 1024 ** 3; // >24 GiB → tier default OFF, so unset == null here

  it('is null/disabled when explicitly empty, zero, out-of-range, or garbage', () => {
    expect(budgetFraction({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '' })).toBe(null);
    expect(budgetFraction({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '0' })).toBe(null);
    expect(budgetFraction({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '-0.5' })).toBe(null);
    expect(budgetFraction({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '1.5' })).toBe(null);
    expect(budgetFraction({ SWEET_SEARCH_RSS_BUDGET_FRACTION: 'abc' })).toBe(null);
    // unset on a roomy host → tier default is OFF
    expect(budgetFraction({}, ROOMY)).toBe(null);
    expect(isEnabled({}, ROOMY)).toBe(false);
  });

  it('is a number in (0,1] when a valid fraction is set (explicit wins regardless of RAM)', () => {
    expect(budgetFraction({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '0.6' }, ROOMY)).toBe(0.6);
    expect(budgetFraction({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '1' }, ROOMY)).toBe(1);
    expect(isEnabled({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '0.6' }, ROOMY)).toBe(true);
  });

  it('auto-enables a soft cap from the system-RAM tier when unset (small-RAM hosts)', () => {
    expect(budgetFraction({}, 8 * 1024 ** 3)).toBe(0.55);  // tight (≤12 GiB)
    expect(budgetFraction({}, 20 * 1024 ** 3)).toBe(0.60); // moderate (≤24 GiB)
    expect(budgetFraction({}, 64 * 1024 ** 3)).toBe(null); // roomy (>24 GiB)
    expect(isEnabled({}, 8 * 1024 ** 3)).toBe(true);
    expect(isEnabled({}, 64 * 1024 ** 3)).toBe(false);
    // explicit env always overrides the tier, both directions
    expect(budgetFraction({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '0' }, 8 * 1024 ** 3)).toBe(null);
    expect(budgetFraction({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '0.6' }, 64 * 1024 ** 3)).toBe(0.6);
  });
});

describe('budgetBytes (auto-scales with system RAM, no per-machine config)', () => {
  it('is fraction * totalMem when enabled, 0 when disabled', () => {
    const totalMem = 16 * 1024 ** 3; // 16 GiB
    expect(budgetBytes({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '0.6' }, totalMem)).toBe(Math.floor(0.6 * totalMem));
    // Larger RAM → proportionally larger budget (scales, not capped).
    const big = 128 * 1024 ** 3;
    expect(budgetBytes({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '0.6' }, big)).toBe(Math.floor(0.6 * big));
    // Explicitly disabled → 0 (unset is now RAM-tier-driven; see the gate tests).
    expect(budgetBytes({ SWEET_SEARCH_RSS_BUDGET_FRACTION: '0' }, totalMem)).toBe(0);
  });
});

describe('isOverBudget', () => {
  it('is true only when total strictly exceeds a positive budget', () => {
    expect(isOverBudget(100, 50)).toBe(true);
    expect(isOverBudget(50, 50)).toBe(false);
    expect(isOverBudget(10, 50)).toBe(false);
    expect(isOverBudget(100, 0)).toBe(false);   // disabled budget never trips
    expect(isOverBudget(NaN, 50)).toBe(false);
  });
});

describe('rssRegistryPath', () => {
  it('honors SWEET_SEARCH_RSS_REGISTRY and defaults to a PRIVATE per-user dir', () => {
    expect(rssRegistryPath(onEnv())).toBe(registryFile);
    // Was `os.tmpdir()`, which is `/tmp` on Linux. Every entry in this file is
    // a pid the coordinator will SIGTERM, and the coordinator is default-ON at
    // 24 GiB and below — so a world-writable default let any local user choose
    // which of the user's processes sweet-search terminated.
    expect(rssRegistryPath({})).toBe(join(os.homedir(), '.cache', 'sweet-search', 'sweet-search-rss-daemons.json'));
    expect(rssRegistryPath({}).startsWith(os.tmpdir())).toBe(false);
  });
});

describe('runEvictionTick — no-op when disabled', () => {
  it('does nothing and signals nobody when the gate is unset', async () => {
    seedRegistry([
      { pid: 11, kind: 'm', startedAt: Date.now(), lastActivityMs: 100, rss: 0 },
      { pid: 12, kind: 'm', startedAt: Date.now(), lastActivityMs: 200, rss: 0 },
    ]);
    const signalled = [];
    const r = await runEvictionTick({
      env: offEnv(),
      selfPid: 12,
      rssReader: async () => 999 * 1024 ** 3, // absurdly high — would trip if enabled
      pressureReader: async () => null,
      aliveProbe: () => true, // seeded fake pids aren't real processes
      signal: (pid) => signalled.push(pid),
    });
    expect(r.enabled).toBe(false);
    expect(r.evicted).toBe(null);
    expect(signalled).toEqual([]);
  });
});

describe('runEvictionTick — eviction picks the longest-idle daemon', () => {
  it('over budget: SIGTERMs the oldest-lastActivityMs peer (not self, not newest)', async () => {
    // Three daemons; self is the newest (300). RSS reader reports 5 GiB each =
    // 15 GiB total, well over a 0.6 * 16 GiB ≈ 9.6 GiB budget.
    seedRegistry([
      { pid: 11, kind: 'm', startedAt: Date.now(), lastActivityMs: 100, rss: 0 }, // oldest → victim
      { pid: 12, kind: 'm', startedAt: Date.now(), lastActivityMs: 200, rss: 0 },
      { pid: 13, kind: 's', startedAt: Date.now(), lastActivityMs: 300, rss: 0 }, // self
    ]);
    const signalled = [];
    const r = await runEvictionTick({
      env: { ...onEnv('0.6') },
      selfPid: 13,
      totalMem: 16 * 1024 ** 3,           // pin a 16 GiB host: budget ≈ 9.6 GiB
      rssReader: async () => 5 * 1024 ** 3, // 5 GiB each → 15 GiB total
      pressureReader: async () => null,
      aliveProbe: () => true, // seeded fake pids aren't real processes
      signal: (pid) => signalled.push(pid),
    });
    expect(r.enabled).toBe(true);
    expect(r.over).toBe(true);
    expect(r.totalRss).toBe(15 * 1024 ** 3);
    expect(r.evicted).toBe(11);     // longest-idle
    expect(signalled).toEqual([11]); // exactly one SIGTERM, to the oldest peer
  });

  it('respects the fraction: same fleet UNDER a higher budget evicts nobody', async () => {
    seedRegistry([
      { pid: 11, kind: 'm', startedAt: Date.now(), lastActivityMs: 100, rss: 0 },
      { pid: 12, kind: 'm', startedAt: Date.now(), lastActivityMs: 200, rss: 0 },
      { pid: 13, kind: 's', startedAt: Date.now(), lastActivityMs: 300, rss: 0 },
    ]);
    const signalled = [];
    // Same 15 GiB fleet, same 16 GiB host — but a 0.99 fraction lifts the budget
    // to ~15.8 GiB, just above the 15 GiB sum. The fraction alone decides.
    const r = await runEvictionTick({
      env: onEnv('0.99'),
      selfPid: 13,
      totalMem: 16 * 1024 ** 3,
      rssReader: async () => 5 * 1024 ** 3, // 15 GiB total < 15.8 GiB budget
      pressureReader: async () => null,
      aliveProbe: () => true, // seeded fake pids aren't real processes
      signal: (pid) => signalled.push(pid),
    });
    expect(r.enabled).toBe(true);
    expect(r.over).toBe(false);
    expect(r.evicted).toBe(null);
    expect(signalled).toEqual([]);
  });

  it('the oldest daemon never evicts a newer peer (concurrency convergence)', async () => {
    // Same over-budget fleet, but self IS the oldest (11). It must shed nobody,
    // so the fleet converges on a single victim chosen by the newest daemon.
    seedRegistry([
      { pid: 11, kind: 'm', startedAt: Date.now(), lastActivityMs: 100, rss: 0 }, // self, oldest
      { pid: 12, kind: 'm', startedAt: Date.now(), lastActivityMs: 200, rss: 0 },
      { pid: 13, kind: 's', startedAt: Date.now(), lastActivityMs: 300, rss: 0 },
    ]);
    const signalled = [];
    const r = await runEvictionTick({
      env: onEnv('0.6'),
      selfPid: 11,
      totalMem: 16 * 1024 ** 3,
      rssReader: async () => 5 * 1024 ** 3,
      pressureReader: async () => null,
      aliveProbe: () => true, // seeded fake pids aren't real processes
      signal: (pid) => signalled.push(pid),
    });
    expect(r.over).toBe(true);
    expect(r.evicted).toBe(null);   // oldest sheds nobody
    expect(signalled).toEqual([]);
  });
});

describe('runEvictionTick — D.4 Linux memory-pressure', () => {
  it('a positive PSI stall near (≥80%) budget forces an eviction even under the RSS cap', async () => {
    seedRegistry([
      { pid: 11, kind: 'm', startedAt: Date.now(), lastActivityMs: 100, rss: 0 },
      { pid: 12, kind: 'm', startedAt: Date.now(), lastActivityMs: 200, rss: 0 },
      { pid: 13, kind: 's', startedAt: Date.now(), lastActivityMs: 300, rss: 0 },
    ]);
    const totalMem = 16 * 1024 ** 3;
    const budget = budgetBytes(onEnv('0.6'), totalMem);
    // 0.9 * budget split across 3 daemons → over 80%, under 100%.
    const perDaemon = Math.floor((0.9 * budget) / 3);
    const signalled = [];
    const r = await runEvictionTick({
      env: onEnv('0.6'),
      selfPid: 13,
      totalMem,
      rssReader: async () => perDaemon,
      pressureReader: async () => 12.5, // some avg10 = 12.5% stall
      aliveProbe: () => true, // seeded fake pids aren't real processes
      signal: (pid) => signalled.push(pid),
    });
    expect(r.over).toBe(false);       // strictly under the RSS cap
    expect(r.pressure).toBe(12.5);
    expect(r.evicted).toBe(11);       // PSI still forced the longest-idle eviction
    expect(signalled).toEqual([11]);
  });

  it('PSI is ignored well under budget (a system-wide stall unrelated to us)', async () => {
    seedRegistry([
      { pid: 11, kind: 'm', startedAt: Date.now(), lastActivityMs: 100, rss: 0 },
      { pid: 12, kind: 's', startedAt: Date.now(), lastActivityMs: 200, rss: 0 },
    ]);
    const signalled = [];
    const r = await runEvictionTick({
      env: onEnv('0.6'),
      selfPid: 12,
      rssReader: async () => 1024, // negligible → far under 80% of budget
      pressureReader: async () => 50,
      aliveProbe: () => true, // seeded fake pids aren't real processes
      signal: (pid) => signalled.push(pid),
    });
    expect(r.over).toBe(false);
    expect(r.evicted).toBe(null);
    expect(signalled).toEqual([]);
  });
});

describe('readProcessRss', () => {
  it('returns the in-process RSS for self and 0 for an invalid/dead pid', async () => {
    const self = await readProcessRss(process.pid);
    expect(self).toBeGreaterThan(0); // our own process has real RSS
    expect(await readProcessRss(0)).toBe(0);
    expect(await readProcessRss(-1)).toBe(0);
    expect(await readProcessRss('nope')).toBe(0);
    expect(await readProcessRss(0x3fffffff)).toBe(0); // almost-certainly-dead pid
  });
});

describe('readLinuxMemoryPressure', () => {
  it('returns null on non-Linux, and a finite number or null on Linux', async () => {
    const v = await readLinuxMemoryPressure();
    if (process.platform !== 'linux') {
      expect(v).toBe(null); // macOS: deferred C-addon path, RSS poller only
    } else {
      expect(v === null || Number.isFinite(v)).toBe(true);
    }
  });
});

describe('registerDaemon (the index-maintainer.mjs seam)', () => {
  it('is a no-op returning a safe handle when disabled', async () => {
    const handle = await registerDaemon({ pid: 4242, stateDir: dir, kind: 'maintainer', env: offEnv() });
    expect(typeof handle.unregister).toBe('function');
    expect(typeof handle.touch).toBe('function');
    // No registry written.
    expect(await _readRegistryForTest(offEnv())).toEqual({});
    await expect(handle.unregister()).resolves.toBeUndefined(); // safe to call
  });

  it('when enabled: upserts an entry, then unregister removes it', async () => {
    const env = onEnv('0.6');
    const handle = await registerDaemon({ pid: 4242, stateDir: dir, kind: 'maintainer', env });
    const reg = await _readRegistryForTest(env);
    expect(reg['4242']).toMatchObject({ pid: 4242, kind: 'maintainer', stateDir: dir });
    expect(typeof reg['4242'].lastActivityMs).toBe('number');

    // On-disk file is valid JSON.
    expect(() => JSON.parse(readFileSync(registryFile, 'utf-8'))).not.toThrow();

    await handle.unregister();
    expect((await _readRegistryForTest(env))['4242']).toBeUndefined();
  });

  it('touch refreshes lastActivityMs for the registered entry', async () => {
    const env = onEnv('0.6');
    const handle = await registerDaemon({ pid: 4243, stateDir: dir, kind: 'search', env });
    await handle.touch(999999);
    expect((await _readRegistryForTest(env))['4243'].lastActivityMs).toBe(999999);
    await handle.unregister();
  });
});

// =============================================================================
// D.5: per-process maintainer RSS recycle ceiling
// =============================================================================

import {
  maintainerRssCeilingBytes,
  maintainerRssMinUptimeMs,
  shouldRecycleForRss,
} from '../../core/indexing/rss-budget.mjs';

const GiB = 1024 ** 3;

describe('maintainerRssCeilingBytes (D.5 config resolution)', () => {
  it('explicit env MB wins over the tier default', () => {
    expect(maintainerRssCeilingBytes({ SWEET_SEARCH_MAINTAINER_RSS_MAX_MB: '1500' }, 128 * GiB))
      .toBe(1500 * 1024 * 1024);
  });

  it('an explicit value BELOW the resident floor is honoured verbatim, never silently raised', () => {
    // The operator's number is the operator's decision: on a memory-constrained
    // host a hard 1.5 GB cap plus frequent recycles can be exactly what they
    // want, and silently substituting 4 GiB could push that host into OOM. The
    // arming site warns instead; the recycle chain is bounded by minUptime.
    expect(maintainerRssCeilingBytes({ SWEET_SEARCH_MAINTAINER_RSS_MAX_MB: '900' }, 8 * GiB))
      .toBe(900 * 1024 * 1024);
    expect(MAINTAINER_RSS_RESIDENT_FLOOR_BYTES).toBe(4 * GiB);
  });

  it('0 / negative / garbage env disables (returns 0)', () => {
    expect(maintainerRssCeilingBytes({ SWEET_SEARCH_MAINTAINER_RSS_MAX_MB: '0' }, 128 * GiB)).toBe(0);
    expect(maintainerRssCeilingBytes({ SWEET_SEARCH_MAINTAINER_RSS_MAX_MB: '-5' }, 128 * GiB)).toBe(0);
    expect(maintainerRssCeilingBytes({ SWEET_SEARCH_MAINTAINER_RSS_MAX_MB: 'abc' }, 128 * GiB)).toBe(0);
  });

  it('unset → clamp(25% of RAM, 4 GiB, 8 GiB)', () => {
    expect(maintainerRssCeilingBytes({}, 8 * GiB)).toBe(4 * GiB);    // 25% = 2 GiB → floor 4 GiB
    expect(maintainerRssCeilingBytes({}, 16 * GiB)).toBe(4 * GiB);   // 25% = 4 GiB → at floor
    expect(maintainerRssCeilingBytes({}, 24 * GiB)).toBe(6 * GiB);   // 25% = 6 GiB → in band
    expect(maintainerRssCeilingBytes({}, 32 * GiB)).toBe(8 * GiB);   // 25% = 8 GiB → at cap
    expect(maintainerRssCeilingBytes({}, 128 * GiB)).toBe(8 * GiB);  // 25% = 32 GiB → cap 8 GiB
  });

  it('empty-string env falls through to the tier default (matches fleet-gate convention)', () => {
    expect(maintainerRssCeilingBytes({ SWEET_SEARCH_MAINTAINER_RSS_MAX_MB: '' }, 128 * GiB)).toBe(8 * GiB);
  });
});

describe('maintainerRssMinUptimeMs', () => {
  it('defaults to 10 minutes', () => {
    expect(maintainerRssMinUptimeMs({})).toBe(600_000);
  });
  it('honours the env override, including 0', () => {
    expect(maintainerRssMinUptimeMs({ SWEET_SEARCH_MAINTAINER_RSS_MIN_UPTIME_MS: '60000' })).toBe(60_000);
    expect(maintainerRssMinUptimeMs({ SWEET_SEARCH_MAINTAINER_RSS_MIN_UPTIME_MS: '0' })).toBe(0);
    expect(maintainerRssMinUptimeMs({ SWEET_SEARCH_MAINTAINER_RSS_MIN_UPTIME_MS: 'junk' })).toBe(600_000);
  });
});

describe('shouldRecycleForRss (pure decision)', () => {
  const base = {
    rssBytes: 9 * GiB,
    ceilingBytes: 8 * GiB,
    uptimeMs: 3_600_000,
    minUptimeMs: 600_000,
    ticksCompleted: 5,
  };

  it('recycles when over ceiling with a completed tick and min uptime', () => {
    expect(shouldRecycleForRss(base)).toEqual({ recycle: true, reason: 'over-ceiling' });
  });

  it('never recycles when disabled (ceiling 0 / NaN)', () => {
    expect(shouldRecycleForRss({ ...base, ceilingBytes: 0 }).recycle).toBe(false);
    expect(shouldRecycleForRss({ ...base, ceilingBytes: NaN }).recycle).toBe(false);
  });

  it('never recycles under or at the ceiling', () => {
    expect(shouldRecycleForRss({ ...base, rssBytes: 8 * GiB }).recycle).toBe(false);
    expect(shouldRecycleForRss({ ...base, rssBytes: 1 * GiB }).recycle).toBe(false);
    expect(shouldRecycleForRss({ ...base, rssBytes: NaN }).recycle).toBe(false);
  });

  it('waits for the first completed tick (never aborts startup work)', () => {
    expect(shouldRecycleForRss({ ...base, ticksCompleted: 0 })).toEqual({ recycle: false, reason: 'no-completed-tick' });
    expect(shouldRecycleForRss({ ...base, ticksCompleted: undefined }).recycle).toBe(false);
  });

  it('respects the minimum-uptime thrash guard', () => {
    expect(shouldRecycleForRss({ ...base, uptimeMs: 599_999 })).toEqual({ recycle: false, reason: 'min-uptime' });
    expect(shouldRecycleForRss({ ...base, uptimeMs: 600_000 }).recycle).toBe(true);
  });
});
