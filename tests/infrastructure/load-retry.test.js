/**
 * A failed lazy load is not kept for the life of the process (core/infrastructure/load-retry.js;
 * docs/STATE_MACHINES.md, "Lazy model load").
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../core/infrastructure/model-fetcher.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: vi.fn(),
}));

import { LOAD_RETRY_MS, forgetFailedLoad } from '../../core/infrastructure/load-retry.js';
import { fetchModel } from '../../core/infrastructure/model-fetcher.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('forgetFailedLoad', () => {
  it('forgets a failed load after the delay, not before', async () => {
    const forget = vi.fn();
    const failed = Promise.reject(new Error('network down'));
    forgetFailedLoad(failed, forget);
    await expect(failed).rejects.toThrow('network down'); // the caller still gets the error
    vi.advanceTimersByTime(LOAD_RETRY_MS - 1);
    expect(forget).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('keeps a load that succeeded', async () => {
    const forget = vi.fn();
    await forgetFailedLoad(Promise.resolve('model'), forget);
    vi.advanceTimersByTime(LOAD_RETRY_MS * 2);
    expect(forget).not.toHaveBeenCalled();
  });

  it('raises no unhandled rejection of its own', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const failed = Promise.reject(new Error('x'));
      failed.catch(() => {}); // the caller's own handling
      forgetFailedLoad(failed, () => {});
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

// The query-model server keeps one process for every worktree: a download that failed once
// (network down) failed every later query there, because the rejected load promise stayed.
describe('getLocalPipeline — a failed load is tried again', () => {
  it('answers with the same error during the retry delay, then loads again', async () => {
    const { getLocalPipeline } = await import('../../core/embedding/embedding-local-model.js');
    fetchModel
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('second attempt'));

    await expect(getLocalPipeline()).rejects.toThrow('network down');
    await expect(getLocalPipeline()).rejects.toThrow('network down');
    expect(fetchModel).toHaveBeenCalledTimes(1); // no storm of loads inside the delay

    vi.advanceTimersByTime(LOAD_RETRY_MS);
    await expect(getLocalPipeline()).rejects.toThrow('second attempt');
    expect(fetchModel).toHaveBeenCalledTimes(2);
  });
});

// `promise.finally(cleanup)` returns a promise that rejects with the same reason, and nothing
// handled it: a failed query embedding was also an unhandled rejection, which ends the process.
describe('queryDeduplicator — a failed in-flight embedding', () => {
  it('is removed from the in-flight map without an unhandled rejection', async () => {
    vi.useRealTimers();
    const { queryDeduplicator } = await import('../../core/embedding/embedding-cache.js');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const failing = Promise.reject(new Error('encoder process exited'));
      failing.catch(() => {}); // getEmbedding awaits the original promise itself
      queryDeduplicator.set('q', failing.then((embedding) => ({ embedding })));
      expect(queryDeduplicator.has('q')).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(queryDeduplicator.has('q')).toBe(false);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
