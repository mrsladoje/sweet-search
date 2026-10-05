/**
 * Agent formats seed max(k, AGENT_SEED_POOL_MIN) and keep the k-seed top-1 (final-k.js).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_SEED_POOL_MIN, DEFAULT_SEED_POOL_MIN, pinNarrowTop1, seedPoolSize } from '../../core/search/final-k.js';

const saved = process.env.SWEET_SEARCH_SEED_POOL_MIN;
afterEach(() => {
  if (saved === undefined) delete process.env.SWEET_SEARCH_SEED_POOL_MIN; else process.env.SWEET_SEARCH_SEED_POOL_MIN = saved;
});

describe('seedPoolSize', () => {
  it('agent formats widen to AGENT_SEED_POOL_MIN; other callers keep k', () => {
    delete process.env.SWEET_SEARCH_SEED_POOL_MIN;
    expect(AGENT_SEED_POOL_MIN).toBe(15);
    expect(DEFAULT_SEED_POOL_MIN).toBe(0);
    expect(seedPoolSize(5, { agentFormat: true })).toBe(15);
    expect(seedPoolSize(20, { agentFormat: true })).toBe(20);
    expect(seedPoolSize(5)).toBe(5);
  });
  it('the env value wins for both', () => {
    process.env.SWEET_SEARCH_SEED_POOL_MIN = '0';
    expect(seedPoolSize(5, { agentFormat: true })).toBe(5);
    process.env.SWEET_SEARCH_SEED_POOL_MIN = '10';
    expect(seedPoolSize(5)).toBe(10);
  });
});

describe('pinNarrowTop1', () => {
  const r = (id, seedRank) => ({ id, ...(seedRank == null ? {} : { seedRank }) });
  it('moves the best-ranked k-seed result to the front when the pool was wider', () => {
    const list = [r('wide', 9), r('nbr'), r('seed', 2), r('seed0', 0)];
    expect(pinNarrowTop1(list, 5).map(x => x.id)).toEqual(['seed', 'wide', 'nbr', 'seed0']);
  });
  it('leaves the list alone when the first result is a k-seed, or no seed is past k', () => {
    const a = [r('seed', 1), r('wide', 8)];
    expect(pinNarrowTop1(a, 5)).toBe(a);
    const b = [r('nbr'), r('seed', 3), r('seed', 4)];
    expect(pinNarrowTop1(b, 5)).toBe(b);
  });
});
