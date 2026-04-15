/**
 * Regression test for N2 — `initEmbeddingPool` concurrent-call race.
 *
 * Pre-fix: two concurrent callers both saw `existing = null`, both
 * constructed pools, both awaited `pool.init()`. First setter won; second
 * setter overwrote the slot — the first pool's workers were leaked.
 *
 * Post-fix: an in-flight promise is stashed synchronously before the first
 * `await`, so concurrent callers share it. Exactly one pool is constructed
 * and initialized per race window.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EmbeddingPool,
  initEmbeddingPool,
  shutdownEmbeddingPool,
  getEmbeddingPool,
} from '../../core/indexing/indexer-pool.js';

describe('initEmbeddingPool (N2 regression — concurrent race gate)', () => {
  beforeEach(async () => {
    // Start every test from a clean slot so prior runs don't interfere.
    await shutdownEmbeddingPool();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await shutdownEmbeddingPool();
  });

  it('3 concurrent callers construct exactly ONE pool and init ONCE', async () => {
    let initCalls = 0;
    // Mock pool.init so we don't actually spawn worker_threads. A 50ms delay
    // is enough to guarantee all three calls enter the race window before
    // the first one resolves.
    vi.spyOn(EmbeddingPool.prototype, 'init').mockImplementation(async function mockInit() {
      initCalls++;
      await new Promise(r => setTimeout(r, 50));
      this._ready = true;
    });
    // Neutralize shutdown so the fake pool doesn't try to terminate real workers
    vi.spyOn(EmbeddingPool.prototype, 'shutdown').mockImplementation(async function mockShutdown() {
      this._ready = false;
      this.workers = [];
    });

    const [p1, p2, p3] = await Promise.all([
      initEmbeddingPool({ workers: 1, threadsPerWorker: 1 }),
      initEmbeddingPool({ workers: 1, threadsPerWorker: 1 }),
      initEmbeddingPool({ workers: 1, threadsPerWorker: 1 }),
    ]);

    // All three callers receive the SAME pool instance
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    // init() ran exactly once — the fix's core invariant
    expect(initCalls).toBe(1);
    // The slot now points at the same shared pool
    expect(getEmbeddingPool()).toBe(p1);
  });

  it('a second call after successful init returns the cached pool without re-init', async () => {
    let initCalls = 0;
    vi.spyOn(EmbeddingPool.prototype, 'init').mockImplementation(async function mockInit() {
      initCalls++;
      this._ready = true;
    });
    vi.spyOn(EmbeddingPool.prototype, 'shutdown').mockImplementation(async function mockShutdown() {
      this._ready = false;
      this.workers = [];
    });

    const first = await initEmbeddingPool({ workers: 1, threadsPerWorker: 1 });
    const second = await initEmbeddingPool({ workers: 1, threadsPerWorker: 1 });

    expect(first).toBe(second);
    expect(initCalls).toBe(1);
  });

  it('after a failed init, the next call can retry (promise is cleared)', async () => {
    let initCalls = 0;
    const initSpy = vi
      .spyOn(EmbeddingPool.prototype, 'init')
      .mockImplementation(async function mockInit() {
        initCalls++;
        // First call rejects, subsequent calls succeed
        if (initCalls === 1) {
          throw new Error('simulated worker spawn failure');
        }
        this._ready = true;
      });
    vi.spyOn(EmbeddingPool.prototype, 'shutdown').mockImplementation(async function mockShutdown() {
      this._ready = false;
      this.workers = [];
    });

    await expect(initEmbeddingPool({ workers: 1, threadsPerWorker: 1 })).rejects.toThrow(
      'simulated worker spawn failure'
    );
    // A second call after failure must be able to retry (the in-flight
    // promise must have been cleared in the `finally`).
    const retried = await initEmbeddingPool({ workers: 1, threadsPerWorker: 1 });
    expect(retried).toBeDefined();
    expect(initCalls).toBe(2);
    expect(initSpy).toHaveBeenCalledTimes(2);
  });
});
