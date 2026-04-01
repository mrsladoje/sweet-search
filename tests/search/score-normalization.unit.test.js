import { describe, it, expect } from 'vitest';
import { minMaxNormalize } from '../../core/search/search-postprocess.js';

// =============================================================================
// Unit Tests: minMaxNormalize
// =============================================================================

describe('minMaxNormalize', () => {
  it('normalizes basic values to [0, 1]', () => {
    const result = minMaxNormalize([0.2, 0.5, 0.8]);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(0.0, 10);
    expect(result[1]).toBeCloseTo(0.5, 10);
    expect(result[2]).toBeCloseTo(1.0, 10);
  });

  it('returns 0.5 for all values when all are equal', () => {
    const result = minMaxNormalize([0.5, 0.5, 0.5]);
    expect(result).toEqual([0.5, 0.5, 0.5]);
  });

  it('returns [0.5] for a single value', () => {
    const result = minMaxNormalize([0.7]);
    expect(result).toEqual([0.5]);
  });

  it('returns empty array for empty input', () => {
    const result = minMaxNormalize([]);
    expect(result).toEqual([]);
  });

  it('handles negative values correctly', () => {
    // [-0.3, 0.0, 0.7] → range 1.0, min=-0.3
    // (-0.3 - -0.3)/1.0 = 0, (0 - -0.3)/1.0 = 0.3, (0.7 - -0.3)/1.0 = 1.0
    const result = minMaxNormalize([-0.3, 0.0, 0.7]);
    expect(result[0]).toBeCloseTo(0.0, 10);
    expect(result[1]).toBeCloseTo(0.3, 10);
    expect(result[2]).toBeCloseTo(1.0, 10);
  });

  it('normalizes two values to [0, 1]', () => {
    const result = minMaxNormalize([3, 7]);
    expect(result[0]).toBeCloseTo(0.0, 10);
    expect(result[1]).toBeCloseTo(1.0, 10);
  });

  it('preserves relative ordering', () => {
    const input = [0.3, 0.1, 0.9, 0.5];
    const result = minMaxNormalize(input);
    // 0.1 < 0.3 < 0.5 < 0.9 → normalized ordering preserved
    expect(result[1]).toBeLessThan(result[0]); // 0.1 < 0.3
    expect(result[0]).toBeLessThan(result[3]); // 0.3 < 0.5
    expect(result[3]).toBeLessThan(result[2]); // 0.5 < 0.9
  });

  it('handles very small range (RRF-like scores)', () => {
    // RRF scores are in [0, ~0.016]
    const result = minMaxNormalize([0.016, 0.012, 0.008]);
    expect(result[0]).toBeCloseTo(1.0, 10);
    expect(result[1]).toBeCloseTo(0.5, 10);
    expect(result[2]).toBeCloseTo(0.0, 10);
  });

  it('handles values larger than 1 (graph-expanded scores)', () => {
    const result = minMaxNormalize([0.5, 1.2, 1.8]);
    expect(result[0]).toBeCloseTo(0.0, 10);
    expect(result[2]).toBeCloseTo(1.0, 10);
    // Middle value: (1.2 - 0.5) / (1.8 - 0.5) = 0.7/1.3 ≈ 0.5385
    expect(result[1]).toBeCloseTo(0.7 / 1.3, 10);
  });

  it('maps min to 0 and max to 1 exactly', () => {
    const input = [42, 100, 7, 88];
    const result = minMaxNormalize(input);
    const minIdx = input.indexOf(Math.min(...input));
    const maxIdx = input.indexOf(Math.max(...input));
    expect(result[minIdx]).toBe(0);
    expect(result[maxIdx]).toBe(1);
  });

  it('produces all values in [0, 1]', () => {
    const input = [-5, 0, 3.7, 100, 0.001];
    const result = minMaxNormalize(input);
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
