import { describe, it, expect } from 'vitest';
import { computeCacheHit } from '../core/search-postprocess.js';

describe('computeCacheHit', () => {
  it('uses direct lexical latency for hybrid mode when provided', () => {
    const result = computeCacheHit('hybrid', {
      latency: 40,
      embedLatencyMs: 35,
      directLexMs: 3,
      embeddingSource: 'vocabulary',
      lexicalHitThresholdMs: 5,
    });

    expect(result.lexSubLatency).toBe(3);
    expect(result.lexHit).toBe(true);
    expect(result.semHit).toBe(true);
    expect(result.cacheHit).toBe(true);
  });

  it('falls back to residual lexical latency when direct timing is absent', () => {
    const result = computeCacheHit('hybrid', {
      latency: 30,
      embedLatencyMs: 10,
      directLexMs: null,
      embeddingSource: 'semantic-cache',
      lexicalHitThresholdMs: 5,
    });

    expect(result.lexSubLatency).toBe(20);
    expect(result.lexHit).toBe(false);
    expect(result.semHit).toBe(true);
    expect(result.cacheHit).toBe(false);
  });

  it('computes lexical mode hit solely from latency threshold', () => {
    const result = computeCacheHit('lexical', {
      latency: 4,
      embeddingSource: null,
      lexicalHitThresholdMs: 5,
    });

    expect(result.lexHit).toBe(true);
    expect(result.semHit).toBe(false);
    expect(result.cacheHit).toBe(true);
  });
});
