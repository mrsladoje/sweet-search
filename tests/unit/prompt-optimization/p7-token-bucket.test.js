/**
 * Unit tests for core/prompt-optimization/sweep/p7-token-bucket.mjs (§7.7).
 *
 * Covers:
 *   - maxCallsPerMin: TPM binds at GPT-5.5 T1 (expected result = 2)
 *   - maxConcurrent: basic arithmetic
 *   - createTokenBucket: blocks when TPM would be exceeded (injected clock)
 *   - RATE_LIMITS: structure validation
 *   - recommendConcurrency: provider/tier combinations
 */

import { describe, it, expect } from 'vitest';

import {
  maxCallsPerMin,
  maxConcurrent,
  createTokenBucket,
  recommendConcurrency,
  RATE_LIMITS,
} from '../../../core/prompt-optimization/sweep/p7-token-bucket.mjs';

// ─── maxCallsPerMin ───────────────────────────────────────────────────────────

describe('maxCallsPerMin', () => {
  it('TPM binds at GPT-5.5 T1: min(500, 30000/12000) = 2', () => {
    // GPT-5.5 Tier 1: rpm=500, tpm=30_000
    // With estIn=12_000: floor(min(500, 30000/12000)) = floor(min(500, 2.5)) = 2
    expect(maxCallsPerMin({ rpm: 500, itpm: 30_000, estIn: 12_000 })).toBe(2);
  });

  it('RPM binds when itpm/estIn >> rpm', () => {
    // rpm=10, itpm=1_000_000, estIn=100 → min(10, 10000) = 10
    expect(maxCallsPerMin({ rpm: 10, itpm: 1_000_000, estIn: 100 })).toBe(10);
  });

  it('OTPM binds when output tokens are the bottleneck', () => {
    // rpm=1000, itpm=1_000_000, otpm=1000, estIn=100, estOut=500
    // floor(min(1000, 10000, 1000/500)) = floor(min(1000, 10000, 2)) = 2
    expect(maxCallsPerMin({ rpm: 1_000, itpm: 1_000_000, otpm: 1_000, estIn: 100, estOut: 500 })).toBe(2);
  });

  it('ignores otpm when otpm is undefined', () => {
    expect(maxCallsPerMin({ rpm: 5, itpm: 10_000, estIn: 1_000 })).toBe(5);
  });

  it('ignores otpm when estOut is not provided', () => {
    expect(maxCallsPerMin({ rpm: 5, itpm: 10_000, otpm: 100, estIn: 1_000 })).toBe(5);
  });

  it('Anthropic Sonnet T1: floor(min(50, 30000/12000, 8000/2000)) = 2', () => {
    // §14.1 Tier 1: rpm=50, itpm=30_000, otpm=8_000
    expect(maxCallsPerMin({ rpm: 50, itpm: 30_000, otpm: 8_000, estIn: 12_000, estOut: 2_000 })).toBe(2);
  });

  it('Anthropic Sonnet T2: ITPM binds', () => {
    // §14.1 Tier 2: rpm=1000, itpm=450_000, otpm=90_000
    // min(1000, 450000/12000, 90000/2000) = min(1000, 37.5, 45) = 37
    expect(maxCallsPerMin({ rpm: 1_000, itpm: 450_000, otpm: 90_000, estIn: 12_000, estOut: 2_000 })).toBe(37);
  });

  it('throws when estIn is zero or missing', () => {
    expect(() => maxCallsPerMin({ rpm: 100, itpm: 10_000, estIn: 0 })).toThrow();
  });
});

// ─── maxConcurrent ────────────────────────────────────────────────────────────

describe('maxConcurrent', () => {
  it('ceil(2 * 15 / 60) = 1 for GPT-5.5 T1 scenario', () => {
    expect(maxConcurrent({ callsPerMin: 2, avgCallSeconds: 15 })).toBe(1);
  });

  it('ceil(37 * 15 / 60) = 10 for Sonnet T2 scenario', () => {
    expect(maxConcurrent({ callsPerMin: 37, avgCallSeconds: 15 })).toBe(10);
  });

  it('at least 1 concurrent call even for very slow throughput', () => {
    expect(maxConcurrent({ callsPerMin: 1, avgCallSeconds: 30 })).toBe(1);
  });

  it('rounds up fractional concurrency', () => {
    // ceil(5 * 10 / 60) = ceil(0.833) = 1
    expect(maxConcurrent({ callsPerMin: 5, avgCallSeconds: 10 })).toBe(1);
    // ceil(10 * 7 / 60) = ceil(1.167) = 2
    expect(maxConcurrent({ callsPerMin: 10, avgCallSeconds: 7 })).toBe(2);
  });
});

// ─── RATE_LIMITS ──────────────────────────────────────────────────────────────

describe('RATE_LIMITS', () => {
  it('has Anthropic Sonnet 4.6 tiers 1-4', () => {
    const a = RATE_LIMITS.anthropic_sonnet_4_6;
    expect(a[1]).toMatchObject({ rpm: 50,    itpm: 30_000,    otpm: 8_000 });
    expect(a[2]).toMatchObject({ rpm: 1_000, itpm: 450_000,   otpm: 90_000 });
    expect(a[3]).toMatchObject({ rpm: 2_000, itpm: 800_000,   otpm: 160_000 });
    expect(a[4]).toMatchObject({ rpm: 4_000, itpm: 2_000_000, otpm: 400_000 });
  });

  it('has OpenAI GPT-5.5 tiers 1-5', () => {
    const o = RATE_LIMITS.openai_gpt5_5;
    expect(o[1]).toMatchObject({ rpm: 500,    tpm: 30_000 });
    expect(o[2]).toMatchObject({ rpm: 5_000,  tpm: 450_000 });
    expect(o[3]).toMatchObject({ rpm: 5_000,  tpm: 800_000 });
    expect(o[4]).toMatchObject({ rpm: 10_000, tpm: 2_000_000 });
    expect(o[5]).toMatchObject({ rpm: 10_000, tpm: 30_000_000 });
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(RATE_LIMITS)).toBe(true);
    expect(Object.isFrozen(RATE_LIMITS.anthropic_sonnet_4_6)).toBe(true);
    expect(Object.isFrozen(RATE_LIMITS.openai_gpt5_5)).toBe(true);
  });
});

// ─── createTokenBucket (injected clock) ──────────────────────────────────────

describe('createTokenBucket', () => {
  it('allows calls below the TPM ceiling without waiting', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ itpm: 1_000, estIn: 100, now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    // 10 calls × 100 tokens = 1000 tokens = itpm; all should succeed without throttle
    // (use 9 calls to stay safely below the ceiling)
    for (let i = 0; i < 9; i++) {
      await bucket.acquire({ inTokens: 100, outTokens: 0 });
    }
    const s = bucket.stats();
    expect(s.throttledMs).toBe(0);
    expect(s.windowInTokens).toBe(900);
  });

  it('blocks when ITPM would be exceeded (injected clock advances on sleep)', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ itpm: 100, estIn: 100, now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    // First call: 100 tokens used — at the ceiling
    await bucket.acquire({ inTokens: 100, outTokens: 0 });
    // Second call: needs another 100 but window is full → must wait
    await bucket.acquire({ inTokens: 100, outTokens: 0 });

    const s = bucket.stats();
    expect(s.throttledMs).toBeGreaterThan(0);
    // After throttle the fake clock advanced past the 1-min window
    expect(fakeNow).toBeGreaterThan(0);
  });

  it('emits onThrottle callback with wait_ms when blocked', async () => {
    let fakeNow = 0;
    const events = [];
    const bucket = createTokenBucket({
      itpm: 50,
      estIn: 50,
      now: () => fakeNow,
      onThrottle: (ev) => events.push(ev),
    });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    await bucket.acquire({ inTokens: 50, outTokens: 0 });   // ok
    await bucket.acquire({ inTokens: 50, outTokens: 0, target: 'sonnet' });  // throttled

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]._kind).toBe('rate-limit-throttled');
    expect(events[0].wait_ms).toBeGreaterThan(0);
    expect(events[0].target).toBe('sonnet');
  });

  it('blocks when RPM ceiling is hit', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ rpm: 2, now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    // Calls 1 and 2 succeed; call 3 must wait
    await bucket.acquire({ inTokens: 0, outTokens: 0 });
    await bucket.acquire({ inTokens: 0, outTokens: 0 });
    await bucket.acquire({ inTokens: 0, outTokens: 0 });

    expect(bucket.stats().throttledMs).toBeGreaterThan(0);
  });

  it('stats reflect consumed tokens in rolling window', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    await bucket.acquire({ inTokens: 1_000, outTokens: 200 });
    await bucket.acquire({ inTokens: 2_000, outTokens: 400 });

    const s = bucket.stats();
    expect(s.windowInTokens).toBe(3_000);
    expect(s.windowOutTokens).toBe(600);
    expect(s.windowRequests).toBe(2);
  });

  it('does not deadlock on an oversized single call (inTokens > itpm)', async () => {
    let fakeNow = 0;
    let sleeps = 0;
    const bucket = createTokenBucket({ itpm: 1_000, estIn: 1_000, now: () => fakeNow });
    bucket._setSleep(async (ms) => { sleeps++; fakeNow += ms; });

    // A single call asking for more tokens than the entire per-minute budget
    // can never fit any window — the bucket must proceed instead of hanging.
    await bucket.acquire({ inTokens: 5_000, outTokens: 0 });

    expect(sleeps).toBe(0); // proceeded immediately, no infinite wait loop
    expect(bucket.stats().windowInTokens).toBe(5_000); // call was still recorded
  });

  it('clears old entries after window expires (fake clock advance)', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ itpm: 500, estIn: 500, now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    await bucket.acquire({ inTokens: 500, outTokens: 0 });  // fills window
    // Advance clock 61 seconds — entry rolls out of window
    fakeNow = 61_000;
    await bucket.acquire({ inTokens: 500, outTokens: 0 });  // should succeed without throttle

    const s = bucket.stats();
    // throttledMs should be 0 because the advance was manual (not via sleep)
    expect(s.windowRequests).toBe(1);   // only the recent entry in window
  });
});

// ─── reconcile (M3 — actuals reconciliation) ─────────────────────────────────

describe('createTokenBucket.reconcile (M3)', () => {
  it('swaps the last entry estimate for a larger measured actual in the window', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ itpm: 30_000, estIn: 12_000, now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    // acquire charges the static estimate (12_000 in / 2_000 out)
    await bucket.acquire({ inTokens: 12_000, outTokens: 2_000, target: 'sonnet' });
    expect(bucket.stats().windowInTokens).toBe(12_000);
    expect(bucket.stats().windowOutTokens).toBe(2_000);

    // Heavy multi-file probe actually consumed more than estimated.
    bucket.reconcile({ inTokens: 20_000, outTokens: 3_000 });

    const s = bucket.stats();
    expect(s.windowInTokens).toBe(20_000); // actual, not the 12_000 estimate
    expect(s.windowOutTokens).toBe(3_000);
    expect(s.windowRequests).toBe(1);      // still a single request
  });

  it('subsequent acquire is throttled given the corrected (larger) load', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ itpm: 30_000, estIn: 12_000, now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    // Estimate (12K) would have left room for a second 12K call (24K <= 30K),
    // but the real call burned 25K. After reconcile, a second 12K call (25+12
    // = 37K > 30K) must throttle.
    await bucket.acquire({ inTokens: 12_000, outTokens: 0 });
    bucket.reconcile({ inTokens: 25_000 });

    await bucket.acquire({ inTokens: 12_000, outTokens: 0 });
    expect(bucket.stats().throttledMs).toBeGreaterThan(0);
  });

  it('reconcile leaves out unspecified dimension unchanged', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    await bucket.acquire({ inTokens: 12_000, outTokens: 2_000 });
    bucket.reconcile({ inTokens: 18_000 }); // only correct input

    const s = bucket.stats();
    expect(s.windowInTokens).toBe(18_000);
    expect(s.windowOutTokens).toBe(2_000); // untouched
  });

  it('reconcile only adjusts the MOST-RECENT entry', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    await bucket.acquire({ inTokens: 1_000, outTokens: 100 });
    await bucket.acquire({ inTokens: 2_000, outTokens: 200 });
    bucket.reconcile({ inTokens: 9_000, outTokens: 900 });

    const s = bucket.stats();
    // first entry untouched (1_000/100), second corrected (9_000/900)
    expect(s.windowInTokens).toBe(10_000);
    expect(s.windowOutTokens).toBe(1_000);
  });

  it('reconcile without a prior acquire is a guarded no-op (no throw, returns null)', () => {
    const bucket = createTokenBucket({ itpm: 30_000, estIn: 12_000, now: () => 0 });
    let result;
    expect(() => { result = bucket.reconcile({ inTokens: 5_000, outTokens: 500 }); }).not.toThrow();
    expect(result).toBeNull();
    const s = bucket.stats();
    expect(s.windowInTokens).toBe(0);
    expect(s.windowRequests).toBe(0);
  });

  it('reconcile() with no args is a no-op-ish (entry unchanged)', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });
    await bucket.acquire({ inTokens: 5_000, outTokens: 500 });
    expect(() => bucket.reconcile()).not.toThrow();
    const s = bucket.stats();
    expect(s.windowInTokens).toBe(5_000);
    expect(s.windowOutTokens).toBe(500);
  });

  it('acquire returns the recorded entry handle', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });
    const handle = await bucket.acquire({ inTokens: 7_000, outTokens: 700 });
    expect(handle).toMatchObject({ requests: 1, inTokens: 7_000, outTokens: 700 });
    expect(typeof handle.ts).toBe('number');
  });
});

// ─── serialize / restore / primeForResume (M2 — resume) ──────────────────────

describe('createTokenBucket serialize/restore (M2)', () => {
  it('serialize returns a JSON-safe snapshot of the active window', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ itpm: 100_000, estIn: 10_000, now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    await bucket.acquire({ inTokens: 10_000, outTokens: 1_000 });
    await bucket.acquire({ inTokens: 20_000, outTokens: 2_000 });

    const snap = bucket.serialize();
    // round-trips through JSON unchanged
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(snap.entries).toHaveLength(2);
    expect(snap.entries[0]).toMatchObject({ requests: 1, inTokens: 10_000, outTokens: 1_000 });
    expect(typeof snap.throttledMs).toBe('number');
  });

  it('a NEW bucket restored from a snapshot reflects the restored window load', async () => {
    let fakeNow = 0;
    const src = createTokenBucket({ itpm: 100_000, estIn: 10_000, now: () => fakeNow });
    src._setSleep(async (ms) => { fakeNow += ms; });
    await src.acquire({ inTokens: 10_000, outTokens: 1_000 });
    await src.acquire({ inTokens: 20_000, outTokens: 2_000 });
    const snap = src.serialize();

    // Fresh bucket on the same clock
    const dst = createTokenBucket({ itpm: 100_000, estIn: 10_000, now: () => fakeNow });
    dst._setSleep(async (ms) => { fakeNow += ms; });
    expect(dst.stats().windowInTokens).toBe(0); // empty before restore

    dst.restore(snap);
    const s = dst.stats();
    expect(s.windowRequests).toBe(2);
    expect(s.windowInTokens).toBe(30_000);
    expect(s.windowOutTokens).toBe(3_000);
  });

  it('restore prunes entries already aged out of the window relative to now()', () => {
    // Snapshot recorded at ts=0; we resume at fakeNow well past WINDOW_MS for one entry.
    let fakeNow = 0;
    const snap = {
      entries: [
        { ts: 0,      requests: 1, inTokens: 10_000, outTokens: 1_000 }, // aged out at now=61_000
        { ts: 30_000, requests: 1, inTokens: 20_000, outTokens: 2_000 }, // still inside (61_000-60_000=1_000 < 30_000)
      ],
      throttledMs: 1234,
    };
    fakeNow = 61_000;
    const bucket = createTokenBucket({ itpm: 100_000, estIn: 10_000, now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });
    bucket.restore(snap);

    const s = bucket.stats();
    expect(s.windowRequests).toBe(1);       // only the ts=30_000 entry survives
    expect(s.windowInTokens).toBe(20_000);
    expect(s.throttledMs).toBe(1234);       // throttledMs carried over
  });

  it('restore tolerates a missing/partial snapshot without throwing', () => {
    const bucket = createTokenBucket({ itpm: 100_000, estIn: 10_000, now: () => 0 });
    expect(() => bucket.restore(undefined)).not.toThrow();
    expect(() => bucket.restore({})).not.toThrow();
    expect(bucket.stats().windowRequests).toBe(0);
  });

  it('primeForResume forces the very next acquire to block for ~WINDOW_MS', async () => {
    let fakeNow = 0;
    let waited = 0;
    const bucket = createTokenBucket({ rpm: 2, itpm: 30_000, estIn: 12_000, now: () => fakeNow });
    bucket._setSleep(async (ms) => { waited += ms; fakeNow += ms; });

    bucket.primeForResume();
    // The synthetic max load saturates the window — next acquire must wait.
    await bucket.acquire({ inTokens: 12_000, outTokens: 2_000 });

    expect(bucket.stats().throttledMs).toBeGreaterThan(0);
    // It blocked for approximately one full window (~60s).
    expect(waited).toBeGreaterThanOrEqual(59_000);
    expect(waited).toBeLessThanOrEqual(61_000);
  });

  it('primeForResume cooldown clears after the window so traffic resumes', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ rpm: 2, itpm: 30_000, estIn: 12_000, now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });

    bucket.primeForResume();
    // Advance past the window manually; the synthetic load should age out.
    fakeNow = 61_000;
    await bucket.acquire({ inTokens: 12_000, outTokens: 2_000 });
    expect(bucket.stats().throttledMs).toBe(0); // no wait needed once primed load expired
  });

  it('serialize/restore + acquire/reconcile coexist with no API regression', async () => {
    let fakeNow = 0;
    const bucket = createTokenBucket({ now: () => fakeNow });
    bucket._setSleep(async (ms) => { fakeNow += ms; });
    // existing methods still present and behaving
    expect(typeof bucket.acquire).toBe('function');
    expect(typeof bucket.stats).toBe('function');
    expect(typeof bucket._setSleep).toBe('function');
    expect(typeof bucket.reconcile).toBe('function');
    expect(typeof bucket.serialize).toBe('function');
    expect(typeof bucket.restore).toBe('function');
    expect(typeof bucket.primeForResume).toBe('function');
  });
});

// ─── recommendConcurrency ────────────────────────────────────────────────────

describe('recommendConcurrency', () => {
  it('returns expected concurrency for Anthropic Tier 1', () => {
    const r = recommendConcurrency({ provider: 'anthropic', tier: 1 });
    // floor(min(50, 30000/12000, 8000/2000)) = floor(min(50, 2.5, 4)) = 2
    expect(r.callsPerMin).toBe(2);
    expect(r.concurrent).toBe(Math.ceil(2 * 15 / 60));  // 1
  });

  it('returns expected concurrency for Anthropic Tier 2', () => {
    const r = recommendConcurrency({ provider: 'anthropic', tier: 2 });
    // floor(min(1000, 450000/12000, 90000/2000)) = floor(min(1000, 37.5, 45)) = 37
    expect(r.callsPerMin).toBe(37);
    expect(r.concurrent).toBeGreaterThan(5);
  });

  it('returns expected concurrency for OpenAI Tier 1', () => {
    const r = recommendConcurrency({ provider: 'openai', tier: 1 });
    // floor(min(500, 30000/12000)) = floor(min(500, 2.5)) = 2
    expect(r.callsPerMin).toBe(2);
  });

  it('returns expected concurrency for OpenAI Tier 2', () => {
    const r = recommendConcurrency({ provider: 'openai', tier: 2 });
    // floor(min(5000, 450000/12000)) = floor(min(5000, 37.5)) = 37
    expect(r.callsPerMin).toBe(37);
  });

  it('accepts custom estIn/estOut/avgCallSeconds', () => {
    const r = recommendConcurrency({
      provider: 'anthropic',
      tier: 2,
      estIn: 5_000,
      estOut: 1_000,
      avgCallSeconds: 30,
    });
    // floor(min(1000, 450000/5000, 90000/1000)) = floor(min(1000, 90, 90)) = 90
    expect(r.callsPerMin).toBe(90);
    expect(r.concurrent).toBe(Math.ceil(90 * 30 / 60));  // 45
  });

  it('throws for unknown provider', () => {
    expect(() => recommendConcurrency({ provider: 'unknown', tier: 1 })).toThrow();
  });

  it('throws for unknown tier', () => {
    expect(() => recommendConcurrency({ provider: 'anthropic', tier: 99 })).toThrow();
  });
});
