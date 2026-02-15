import { describe, it, expect } from 'vitest';
import { checkNativeBackend, requireNativeAnn } from '../../core/hnsw-index.js';

describe('checkNativeBackend', () => {
  it('returns correct shape', async () => {
    const result = await checkNativeBackend();

    expect(result).toHaveProperty('available');
    expect(result).toHaveProperty('engine');
    expect(typeof result.available).toBe('boolean');
    expect(typeof result.engine).toBe('string');
  });

  it('engine is usearch or js-fallback', async () => {
    const result = await checkNativeBackend();
    expect(['usearch', 'js-fallback']).toContain(result.engine);
  });

  it('includes error field when unavailable', async () => {
    const result = await checkNativeBackend();
    if (!result.available) {
      expect(result).toHaveProperty('error');
      expect(typeof result.error).toBe('string');
    }
  });

  it('is idempotent', async () => {
    const result1 = await checkNativeBackend();
    const result2 = await checkNativeBackend();
    expect(result1).toEqual(result2);
  });
});

describe('requireNativeAnn', () => {
  it('resolves or rejects based on availability', async () => {
    const backend = await checkNativeBackend();

    if (backend.available) {
      const result = await requireNativeAnn();
      expect(result).toEqual({ available: true, engine: 'usearch' });
    } else {
      await expect(requireNativeAnn()).rejects.toThrow('Native ANN backend');
    }
  });

  it('rejection message mentions usearch', async () => {
    const backend = await checkNativeBackend();
    if (!backend.available) {
      await expect(requireNativeAnn()).rejects.toThrow('usearch');
    }
  });
});
