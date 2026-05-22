/**
 * Unit tests for core/prompt-optimization/sweep/tare.mjs (Phase 7 TARE gate).
 * Pure deterministic math + async injection — no network / I/O.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  sharpness,
  sharpnessObjective,
  wouldEnterParetoByTaskScore,
  paretoGatedTare,
} from '../../../core/prompt-optimization/sweep/tare.mjs';
import { DEFAULTS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

// ─── sharpness ─────────────────────────────────────────────────────────────────

describe('sharpness', () => {
  it('computes max − min', () => {
    // max=0.9, min=0.5 → 0.4
    expect(sharpness([0.9, 0.7, 0.5, 0.8])).toBeCloseTo(0.4, 10);
  });

  it('returns 0 for a single score', () => {
    expect(sharpness([0.75])).toBe(0);
  });

  it('returns 0 when all scores are identical', () => {
    expect(sharpness([0.6, 0.6, 0.6])).toBeCloseTo(0, 10);
  });

  it('handles extreme scores', () => {
    expect(sharpness([0, 1])).toBeCloseTo(1, 10);
  });

  it('throws TypeError on non-array input', () => {
    expect(() => sharpness(0.5)).toThrow(TypeError);
  });

  it('throws TypeError on empty array', () => {
    expect(() => sharpness([])).toThrow(TypeError);
  });

  it('throws TypeError when a score is not a number', () => {
    expect(() => sharpness([0.5, 'bad', 0.7])).toThrow(TypeError);
  });
});

// ─── sharpnessObjective ────────────────────────────────────────────────────────

describe('sharpnessObjective', () => {
  it('returns 1 − sharpness', () => {
    expect(sharpnessObjective(0.3)).toBeCloseTo(0.7, 10);
    expect(sharpnessObjective(0)).toBeCloseTo(1, 10);
    expect(sharpnessObjective(1)).toBeCloseTo(0, 10);
  });

  it('throws TypeError on non-numeric input', () => {
    expect(() => sharpnessObjective('0.3')).toThrow(TypeError);
    expect(() => sharpnessObjective(NaN)).toThrow(TypeError);
  });
});

// ─── wouldEnterParetoByTaskScore ──────────────────────────────────────────────

describe('wouldEnterParetoByTaskScore', () => {
  it('returns true when candidate strictly beats at least one incumbent', () => {
    const front = [{ taskScore: 0.5 }, { taskScore: 0.7 }];
    // 0.6 > 0.5 → true
    expect(wouldEnterParetoByTaskScore({ candidateTaskScore: 0.6, front })).toBe(true);
  });

  it('returns false when candidate does not beat any incumbent', () => {
    const front = [{ taskScore: 0.8 }, { taskScore: 0.9 }];
    expect(wouldEnterParetoByTaskScore({ candidateTaskScore: 0.7, front })).toBe(false);
  });

  it('returns false when candidate equals the lowest incumbent (not strictly greater)', () => {
    const front = [{ taskScore: 0.7 }];
    expect(wouldEnterParetoByTaskScore({ candidateTaskScore: 0.7, front })).toBe(false);
  });

  it('returns true for an empty front (no incumbents to displace)', () => {
    expect(wouldEnterParetoByTaskScore({ candidateTaskScore: 0.5, front: [] })).toBe(true);
  });

  it('returns true when candidate beats only the weakest incumbent in a large front', () => {
    const front = [{ taskScore: 0.9 }, { taskScore: 0.85 }, { taskScore: 0.4 }];
    expect(wouldEnterParetoByTaskScore({ candidateTaskScore: 0.5, front })).toBe(true);
  });

  it('throws TypeError on non-numeric candidateTaskScore', () => {
    expect(() => wouldEnterParetoByTaskScore({ candidateTaskScore: '0.5', front: [] })).toThrow(TypeError);
    expect(() => wouldEnterParetoByTaskScore({ candidateTaskScore: NaN, front: [] })).toThrow(TypeError);
  });

  it('throws TypeError when front is not an array', () => {
    expect(() => wouldEnterParetoByTaskScore({ candidateTaskScore: 0.5, front: null })).toThrow(TypeError);
  });
});

// ─── paretoGatedTare ─────────────────────────────────────────────────────────

describe('paretoGatedTare', () => {
  it('returns {ran:false} when candidate would not enter the front', async () => {
    const front = [{ taskScore: 0.8 }, { taskScore: 0.9 }];
    const result = await paretoGatedTare({
      candidate: { prompt: 'test prompt', taskScore: 0.5 },
      front,
      generateParaphrases: async () => { throw new Error('should not be called'); },
      evaluate: async () => 0.5,
    });
    expect(result.ran).toBe(false);
  });

  it('does NOT call generateParaphrases when candidate would not enter front', async () => {
    const generateParaphrases = vi.fn();
    const front = [{ taskScore: 0.9 }, { taskScore: 0.95 }];

    const result = await paretoGatedTare({
      candidate: { prompt: 'weak prompt', taskScore: 0.3 },
      front,
      generateParaphrases,
      evaluate: vi.fn(),
    });

    expect(result.ran).toBe(false);
    expect(generateParaphrases).not.toHaveBeenCalled();
  });

  it('generates paraphrases and evaluates when candidate would enter front', async () => {
    const paraphrases = ['para1', 'para2', 'para3'];
    const generateParaphrases = vi.fn().mockResolvedValue(paraphrases);
    const scores = [0.8, 0.7, 0.6, 0.5];
    let idx = 0;
    const evaluate = vi.fn().mockImplementation(async () => scores[idx++]);

    const result = await paretoGatedTare({
      candidate: { prompt: 'original', taskScore: 0.8 },
      front: [{ taskScore: 0.5 }],
      generateParaphrases,
      evaluate,
    });

    expect(result.ran).toBe(true);
    // generateParaphrases called with (prompt, K=3)
    expect(generateParaphrases).toHaveBeenCalledWith('original', DEFAULTS.tareParaphrases);
    // original + 3 paraphrases = 4 evaluations
    expect(result.evaluations).toHaveLength(4);
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it('computes sharpness = max − min over all evaluations', async () => {
    const scores = [0.8, 0.6, 0.7, 0.5]; // max=0.8, min=0.5 → sharpness=0.3
    let idx = 0;
    const result = await paretoGatedTare({
      candidate: { prompt: 'original', taskScore: 0.9 },
      front: [{ taskScore: 0.4 }],
      generateParaphrases: async () => ['p1', 'p2', 'p3'],
      evaluate: async () => scores[idx++],
    });

    expect(result.ran).toBe(true);
    expect(result.sharpness).toBeCloseTo(0.3, 10);
    expect(result.sharpnessScore).toBeCloseTo(0.7, 10);
  });

  it('returns evaluations including the original prompt and paraphrases', async () => {
    const result = await paretoGatedTare({
      candidate: { prompt: 'my prompt', taskScore: 0.8 },
      front: [{ taskScore: 0.5 }],
      generateParaphrases: async (prompt, k) => Array.from({ length: k }, (_, i) => `para${i}`),
      evaluate: async (prompt) => (prompt === 'my prompt' ? 0.8 : 0.7),
    });

    expect(result.ran).toBe(true);
    expect(result.evaluations[0].prompt).toBe('my prompt');
    expect(result.evaluations[0].score).toBeCloseTo(0.8, 10);
    // 3 paraphrases follow
    expect(result.evaluations).toHaveLength(1 + DEFAULTS.tareParaphrases);
  });

  it('returns {ran:true} and evaluations when front is empty (always enters)', async () => {
    let evalCount = 0;
    const result = await paretoGatedTare({
      candidate: { prompt: 'any', taskScore: 0.1 },
      front: [],
      generateParaphrases: async () => ['p1', 'p2', 'p3'],
      evaluate: async () => { evalCount++; return 0.5; },
    });
    expect(result.ran).toBe(true);
    expect(evalCount).toBe(4); // original + 3 paraphrases
  });

  it('throws TypeError on invalid candidate', async () => {
    await expect(
      paretoGatedTare({ candidate: null, front: [], generateParaphrases: vi.fn(), evaluate: vi.fn() }),
    ).rejects.toThrow(TypeError);
  });

  it('throws TypeError when candidate.prompt is missing', async () => {
    await expect(
      paretoGatedTare({
        candidate: { taskScore: 0.8 },
        front: [],
        generateParaphrases: vi.fn(),
        evaluate: vi.fn(),
      }),
    ).rejects.toThrow(TypeError);
  });
});

// ─── paretoGatedTare — hardening (scoring-opus verification) ───────────────────

describe('paretoGatedTare — hardening', () => {
  it('throws TypeError when generateParaphrases is not a function', async () => {
    await expect(
      paretoGatedTare({
        candidate: { prompt: 'p', taskScore: 0.8 },
        front: [],
        generateParaphrases: 42,
        evaluate: vi.fn(),
      }),
    ).rejects.toThrow(TypeError);
  });

  it('throws TypeError when evaluate is not a function', async () => {
    await expect(
      paretoGatedTare({
        candidate: { prompt: 'p', taskScore: 0.8 },
        front: [],
        generateParaphrases: vi.fn(),
        evaluate: null,
      }),
    ).rejects.toThrow(TypeError);
  });

  it('throws TypeError when candidate.taskScore is non-finite', async () => {
    await expect(
      paretoGatedTare({
        candidate: { prompt: 'p', taskScore: NaN },
        front: [],
        generateParaphrases: vi.fn(),
        evaluate: vi.fn(),
      }),
    ).rejects.toThrow(TypeError);
  });

  it('throws TypeError when generateParaphrases returns a non-array (after gate passes)', async () => {
    await expect(
      paretoGatedTare({
        candidate: { prompt: 'p', taskScore: 0.9 },
        front: [], // empty → always enters → generation runs
        generateParaphrases: async () => 'not-an-array',
        evaluate: async () => 0.5,
      }),
    ).rejects.toThrow(TypeError);
  });

  it('never calls evaluate (not just generateParaphrases) when gated out', async () => {
    const generateParaphrases = vi.fn();
    const evaluate = vi.fn();
    const result = await paretoGatedTare({
      candidate: { prompt: 'p', taskScore: 0.1 },
      front: [{ taskScore: 0.9 }],
      generateParaphrases,
      evaluate,
    });
    expect(result.ran).toBe(false);
    expect(generateParaphrases).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });
});
