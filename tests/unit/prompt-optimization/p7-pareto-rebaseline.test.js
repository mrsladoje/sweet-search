/**
 * Unit tests for core/prompt-optimization/sweep/pareto-rebaseline.mjs
 * (Phase 7 Pareto-front re-baselining after probe rotation).
 * Pure async math — no network / I/O.
 */

import { describe, it, expect, vi } from 'vitest';
import { rebaselineFront } from '../../../core/prompt-optimization/sweep/pareto-rebaseline.mjs';

// ─── basic mechanics ──────────────────────────────────────────────────────────

describe('rebaselineFront', () => {
  it('evaluates every incumbent × every new probe (runCount = |front| × |newProbes|)', async () => {
    const front = [
      { id: 'v1', scores: {} },
      { id: 'v2', scores: {} },
      { id: 'v3', scores: {} },
    ];
    const newProbes = [
      { id: 'p1' },
      { id: 'p2' },
      { id: 'p3' },
      { id: 'p4' },
      { id: 'p5' },
    ];
    const evaluate = vi.fn().mockResolvedValue(0.7);

    const { runCount, scoresAdded } = await rebaselineFront({ front, newProbes, evaluate });

    // 3 incumbents × 5 new probes = 15 calls
    expect(runCount).toBe(15);
    expect(scoresAdded).toBe(15);
    expect(evaluate).toHaveBeenCalledTimes(15);
  });

  it('all incumbents in updatedFront have scores for all new probes (identical probe coverage)', async () => {
    const front = [
      { id: 'v1', scores: { existing: 0.8 } },
      { id: 'v2', scores: { existing: 0.6 } },
    ];
    const newProbes = [{ id: 'p-new-1' }, { id: 'p-new-2' }];
    let callIndex = 0;
    const scoreMap = [0.9, 0.8, 0.7, 0.6];
    const evaluate = vi.fn().mockImplementation(async () => scoreMap[callIndex++]);

    const { updatedFront } = await rebaselineFront({ front, newProbes, evaluate });

    // Both incumbents must have scores for both new probes
    for (const incumbent of updatedFront) {
      expect(incumbent.scores).toHaveProperty('p-new-1');
      expect(incumbent.scores).toHaveProperty('p-new-2');
      // Existing scores must be preserved
      expect(incumbent.scores).toHaveProperty('existing');
    }
  });

  it('does not mutate original front entries', async () => {
    const v1 = { id: 'v1', scores: { old: 0.5 } };
    const front = [v1];
    const newProbes = [{ id: 'pnew' }];

    await rebaselineFront({ front, newProbes, evaluate: async () => 0.7 });

    // Original object must be unchanged
    expect(v1.scores).not.toHaveProperty('pnew');
  });

  it('passes the correct (variant, probe) pair to evaluate', async () => {
    const front = [{ id: 'variantA' }];
    const newProbes = [{ id: 'probeX', stratum: 'behavioral' }];
    let capturedArgs = [];
    const evaluate = vi.fn().mockImplementation(async (variant, probe) => {
      capturedArgs.push({ variant, probe });
      return 0.5;
    });

    await rebaselineFront({ front, newProbes, evaluate });

    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0].variant.id).toBe('variantA');
    expect(capturedArgs[0].probe.id).toBe('probeX');
  });

  it('stores evaluate return value under probe.id in incumbent scores', async () => {
    const front = [{ id: 'v1', scores: {} }];
    const newProbes = [{ id: 'p-alpha' }, { id: 'p-beta' }];
    const scoreByProbe = { 'p-alpha': 0.82, 'p-beta': 0.67 };
    const evaluate = async (_v, probe) => scoreByProbe[probe.id];

    const { updatedFront } = await rebaselineFront({ front, newProbes, evaluate });

    expect(updatedFront[0].scores['p-alpha']).toBeCloseTo(0.82, 10);
    expect(updatedFront[0].scores['p-beta']).toBeCloseTo(0.67, 10);
  });

  it('returns runCount=0 and unchanged front for empty front', async () => {
    const evaluate = vi.fn();
    const { updatedFront, runCount, scoresAdded } = await rebaselineFront({
      front: [],
      newProbes: [{ id: 'p1' }],
      evaluate,
    });
    expect(runCount).toBe(0);
    expect(scoresAdded).toBe(0);
    expect(updatedFront).toHaveLength(0);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('returns runCount=0 and unchanged front for empty newProbes', async () => {
    const front = [{ id: 'v1', scores: {} }];
    const evaluate = vi.fn();
    const { updatedFront, runCount } = await rebaselineFront({
      front,
      newProbes: [],
      evaluate,
    });
    expect(runCount).toBe(0);
    expect(updatedFront).toHaveLength(1);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('throws TypeError on non-array front', async () => {
    await expect(
      rebaselineFront({ front: null, newProbes: [], evaluate: vi.fn() }),
    ).rejects.toThrow(TypeError);
  });

  it('throws TypeError on non-array newProbes', async () => {
    await expect(
      rebaselineFront({ front: [], newProbes: null, evaluate: vi.fn() }),
    ).rejects.toThrow(TypeError);
  });

  it('throws TypeError when evaluate is not a function', async () => {
    await expect(
      rebaselineFront({ front: [{ id: 'v1' }], newProbes: [{ id: 'p1' }], evaluate: 42 }),
    ).rejects.toThrow(TypeError);
  });

  it('scoresAdded equals runCount (one new score per evaluate call)', async () => {
    const front = [{ id: 'a' }, { id: 'b' }];
    const newProbes = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    const { scoresAdded, runCount } = await rebaselineFront({
      front,
      newProbes,
      evaluate: async () => 0.5,
    });
    expect(scoresAdded).toBe(runCount);
    expect(runCount).toBe(front.length * newProbes.length);
  });

  it('incumbents without existing scores still receive all new probe scores', async () => {
    // Incumbent has no `scores` property at all
    const front = [{ id: 'bare-variant' }];
    const newProbes = [{ id: 'p1' }, { id: 'p2' }];

    const { updatedFront } = await rebaselineFront({
      front,
      newProbes,
      evaluate: async (_v, probe) => (probe.id === 'p1' ? 0.9 : 0.75),
    });

    expect(updatedFront[0].scores['p1']).toBeCloseTo(0.9, 10);
    expect(updatedFront[0].scores['p2']).toBeCloseTo(0.75, 10);
  });
});

// ─── hardening / fail-fast validation (scoring-opus verification) ──────────────

describe('rebaselineFront — hardening', () => {
  it('fail-fast: throws TypeError on a probe lacking a string id BEFORE any evaluate call', async () => {
    const evaluate = vi.fn().mockResolvedValue(0.5);
    await expect(
      rebaselineFront({ front: [{ id: 'v1', scores: {} }], newProbes: [{ id: 'p1' }, {}], evaluate }),
    ).rejects.toThrow(TypeError);
    // No evaluate call must leak through for the valid probe — validation is at the boundary
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('throws TypeError when a new probe is null (fail-fast, no evaluate)', async () => {
    const evaluate = vi.fn();
    await expect(
      rebaselineFront({ front: [{ id: 'v1' }], newProbes: [null], evaluate }),
    ).rejects.toThrow(TypeError);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('preserves non-score incumbent fields (id, strategy) on updatedFront', async () => {
    const front = [{ id: 'v1', strategy: 'hybrid', scores: {} }];
    const { updatedFront } = await rebaselineFront({
      front,
      newProbes: [{ id: 'p1' }],
      evaluate: async () => 0.7,
    });
    expect(updatedFront[0].id).toBe('v1');
    expect(updatedFront[0].strategy).toBe('hybrid');
    expect(updatedFront[0].scores.p1).toBeCloseTo(0.7, 10);
  });
});
