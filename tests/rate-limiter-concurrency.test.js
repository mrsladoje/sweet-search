/**
 * rate-limiter-concurrency.test.js
 *
 * Tests TimeWindowRateLimiter under concurrent (Promise.all) load.
 * Asserts that no 60-second sliding window ever exceeds configured RPM.
 * Uses vi.useFakeTimers() for speed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimeWindowRateLimiter } from '../core/embedding-service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count how many timestamps fall within any 60-second window.
 * Slides a 60s window across all timestamps and returns the max count.
 */
function maxInAnyWindow(timestamps, windowMs = 60_000) {
  if (timestamps.length === 0) return 0;
  let maxCount = 0;
  for (let i = 0; i < timestamps.length; i++) {
    const windowEnd = timestamps[i] + windowMs;
    let count = 0;
    for (let j = i; j < timestamps.length && timestamps[j] < windowEnd; j++) {
      count++;
    }
    maxCount = Math.max(maxCount, count);
  }
  return maxCount;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimeWindowRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should be importable and constructible', () => {
    const limiter = new TimeWindowRateLimiter(10);
    expect(limiter).toBeDefined();
    expect(limiter.maxInWindow).toBe(10);
    expect(limiter.windowMs).toBe(60_000);
  });

  it('should allow requests up to RPM limit', async () => {
    const RPM = 5;
    const limiter = new TimeWindowRateLimiter(RPM, { maxPerSecond: RPM }); // no per-second throttle
    const acquired = [];

    for (let i = 0; i < RPM; i++) {
      await limiter.acquire();
      acquired.push(Date.now());
    }

    expect(acquired).toHaveLength(RPM);
  });

  it('should serialize concurrent acquire() calls via mutex', async () => {
    const RPM = 5;
    const limiter = new TimeWindowRateLimiter(RPM, { maxPerSecond: RPM });
    const acquired = [];

    // Fire RPM requests concurrently — all should succeed without exceeding limit
    const promises = Array.from({ length: RPM }, () =>
      limiter.acquire().then(() => acquired.push(Date.now()))
    );

    // Advance time enough for all to dispatch
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(promises);

    expect(acquired).toHaveLength(RPM);
    expect(maxInAnyWindow(acquired.sort((a, b) => a - b))).toBeLessThanOrEqual(RPM);
  });

  it('should block when RPM is exhausted and release after window expires', async () => {
    const RPM = 3;
    const limiter = new TimeWindowRateLimiter(RPM, { maxPerSecond: RPM });
    const acquired = [];

    // Exhaust RPM
    for (let i = 0; i < RPM; i++) {
      await limiter.acquire();
      acquired.push(Date.now());
    }

    expect(acquired).toHaveLength(RPM);

    // Next acquire should block
    let resolved = false;
    const blockedPromise = limiter.acquire().then(() => {
      resolved = true;
      acquired.push(Date.now());
    });

    // Advance 30s — still within window, should still be blocked
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resolved).toBe(false);

    // Advance past 60s window — should unblock
    await vi.advanceTimersByTimeAsync(31_000);
    await blockedPromise;
    expect(resolved).toBe(true);
    expect(acquired).toHaveLength(RPM + 1);
  });

  it('should never exceed RPM in any 60-second window under concurrent load', async () => {
    const RPM = 10;
    const TOTAL_REQUESTS = 25;
    const limiter = new TimeWindowRateLimiter(RPM, { maxPerSecond: RPM });
    const timestamps = [];

    // Fire all requests concurrently
    const promises = Array.from({ length: TOTAL_REQUESTS }, () =>
      limiter.acquire().then(() => timestamps.push(Date.now()))
    );

    // Advance time in steps to let blocked requests proceed
    for (let t = 0; t < 180_000; t += 1_000) {
      await vi.advanceTimersByTimeAsync(1_000);
      // Check if all done
      if (timestamps.length >= TOTAL_REQUESTS) break;
    }

    await Promise.all(promises);

    expect(timestamps).toHaveLength(TOTAL_REQUESTS);

    // THE CRITICAL INVARIANT: no 60s window exceeds RPM
    const sorted = timestamps.sort((a, b) => a - b);
    const maxInWindow = maxInAnyWindow(sorted);
    expect(maxInWindow).toBeLessThanOrEqual(RPM);
  });

  it('should enforce per-second microburst limit', async () => {
    const RPM = 60;
    const MAX_PER_SECOND = 2;
    const limiter = new TimeWindowRateLimiter(RPM, { maxPerSecond: MAX_PER_SECOND });
    const timestamps = [];

    // Fire 6 requests concurrently — should be spread across seconds
    const promises = Array.from({ length: 6 }, () =>
      limiter.acquire().then(() => timestamps.push(Date.now()))
    );

    // Advance time to let them all through
    for (let t = 0; t < 10_000; t += 100) {
      await vi.advanceTimersByTimeAsync(100);
      if (timestamps.length >= 6) break;
    }

    await Promise.all(promises);
    expect(timestamps).toHaveLength(6);

    // Check per-second invariant
    const sorted = timestamps.sort((a, b) => a - b);
    const maxPerSecond = maxInAnyWindow(sorted, 1_000);
    expect(maxPerSecond).toBeLessThanOrEqual(MAX_PER_SECOND);
  });

  it('should prune old timestamps correctly', async () => {
    const limiter = new TimeWindowRateLimiter(5, { maxPerSecond: 5 });

    // Acquire 3
    for (let i = 0; i < 3; i++) {
      await limiter.acquire();
    }
    expect(limiter.timestamps).toHaveLength(3);

    // Advance past window
    await vi.advanceTimersByTimeAsync(61_000);
    limiter._pruneWindows();

    expect(limiter.timestamps).toHaveLength(0);
    expect(limiter.secondTimestamps).toHaveLength(0);
  });

  it('should handle RPM=1 correctly', async () => {
    const limiter = new TimeWindowRateLimiter(1, { maxPerSecond: 1 });
    const timestamps = [];

    // Fire 3 requests concurrently
    const promises = Array.from({ length: 3 }, () =>
      limiter.acquire().then(() => timestamps.push(Date.now()))
    );

    // Need to advance enough time for all 3 to complete (each needs its own 60s window)
    for (let t = 0; t < 180_000; t += 1_000) {
      await vi.advanceTimersByTimeAsync(1_000);
      if (timestamps.length >= 3) break;
    }

    await Promise.all(promises);
    expect(timestamps).toHaveLength(3);

    const sorted = timestamps.sort((a, b) => a - b);
    const maxInWindow = maxInAnyWindow(sorted);
    expect(maxInWindow).toBeLessThanOrEqual(1);
  });

  it('should not deadlock with rapid sequential acquire/release', async () => {
    const limiter = new TimeWindowRateLimiter(100, { maxPerSecond: 100 });

    // Rapidly acquire 50 permits sequentially
    for (let i = 0; i < 50; i++) {
      await limiter.acquire();
    }

    expect(limiter.timestamps).toHaveLength(50);
  });
});
