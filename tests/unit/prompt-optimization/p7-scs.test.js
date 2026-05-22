/**
 * Unit tests for core/prompt-optimization/stats/scs.mjs
 *
 * Covers:
 *  - AC modal-agreement threshold (≥ ceil(5/7 × N) = 5 of 7)
 *  - SS cosine on known vectors
 *  - LS mean-0 guard and normal case
 *  - SCS harmonic mean (guard zeros)
 *  - cwSCS collapses on low minParaphraseAccuracy
 *  - shipGate logic
 *  - computeScsReport async orchestrator (stub inject)
 */

import { describe, it, expect } from 'vitest';
import {
  cosine,
  answerConsistency,
  semanticSimilarity,
  lengthStability,
  scs,
  correctnessWeightedScs,
  shipGate,
  computeScsReport,
} from '../../../core/prompt-optimization/stats/scs.mjs';
import { DEFAULTS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

// ─── cosine ───────────────────────────────────────────────────────────────

describe('cosine', () => {
  it('returns 1 for identical unit vectors', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosine([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 6);
  });

  it('returns 0 for a zero-norm vector', () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosine([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('works on higher-dimensional vectors', () => {
    const a = [1, 2, 3, 4];
    const b = [1, 2, 3, 4];
    expect(cosine(a, b)).toBeCloseTo(1, 6);
  });

  it('throws on length mismatch', () => {
    expect(() => cosine([1, 2], [1, 2, 3])).toThrow(/mismatch/);
  });
});

// ─── answerConsistency ─────────────────────────────────────────────────────

describe('answerConsistency', () => {
  it('returns 1.0 when all probes have 7/7 agreement', () => {
    const perProbeAnswers = [
      ['foo', 'foo', 'foo', 'foo', 'foo', 'foo', 'foo'],
      ['bar', 'bar', 'bar', 'bar', 'bar', 'bar', 'bar'],
    ];
    expect(answerConsistency({ perProbeAnswers })).toBeCloseTo(1.0, 6);
  });

  it('counts probes where exactly 5 of 7 agree (threshold = ceil(5/7×7) = 5)', () => {
    // 5 agree → should count (5 >= 5)
    const perProbeAnswers = [
      ['foo', 'foo', 'foo', 'foo', 'foo', 'bar', 'baz'], // 5 foo → PASS
      ['foo', 'foo', 'foo', 'foo', 'bar', 'bar', 'baz'], // 4 foo → FAIL
    ];
    expect(answerConsistency({ perProbeAnswers })).toBeCloseTo(0.5, 6);
  });

  it('returns 0.0 when no probe reaches modal threshold', () => {
    const perProbeAnswers = [
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'], // each answer unique
    ];
    expect(answerConsistency({ perProbeAnswers })).toBeCloseTo(0.0, 6);
  });

  it('normalises answers (whitespace, case)', () => {
    const perProbeAnswers = [
      ['Foo', '  foo ', 'FOO', 'foo', 'foo', 'foo', 'bar'], // 6 × 'foo' after norm
    ];
    expect(answerConsistency({ perProbeAnswers })).toBeCloseTo(1.0, 6);
  });

  it('respects injected answersAgree function', () => {
    // Custom: agree if first char matches
    const answersAgree = (a, b) => a[0] === b[0];
    const perProbeAnswers = [
      ['foo', 'far', 'fox', 'fun', 'fit', 'bar', 'baz'], // 5 'f*' → should PASS
    ];
    expect(answerConsistency({ perProbeAnswers, answersAgree })).toBeCloseTo(1.0, 6);
  });

  it('sizes the largest agreement cluster, not a single exact-match modal', () => {
    // Every answer is exact-distinct, so an exact-match "modal" is a singleton.
    // But under a semantic agree fn (first-char match here, standing in for a
    // cosine>threshold relation on free-text answers) there is a 5-member
    // cluster of "a*" answers → must PASS. A modal-by-exact-match impl would
    // count agreement against an arbitrary first answer and report 0.
    const answersAgree = (a, b) => a[0] === b[0];
    const perProbeAnswers = [
      ['xyz', 'aaa', 'aab', 'aac', 'aad', 'aae', 'bbb'], // cluster of 5 'a*'
    ];
    expect(answerConsistency({ perProbeAnswers, answersAgree })).toBeCloseTo(1.0, 6);
  });

  it('throws on empty input', () => {
    expect(() => answerConsistency({ perProbeAnswers: [] })).toThrow(/non-empty/);
  });
});

// ─── semanticSimilarity ────────────────────────────────────────────────────

describe('semanticSimilarity', () => {
  it('returns ~1 when all vectors are identical', () => {
    const v = [1, 0, 0];
    const perProbeEmbeddings = [[v, v, v, v, v, v, v]];
    expect(semanticSimilarity({ perProbeEmbeddings })).toBeCloseTo(1, 5);
  });

  it('returns ~0 for orthogonal vector pairs', () => {
    const perProbeEmbeddings = [[[1, 0], [0, 1]]];
    expect(semanticSimilarity({ perProbeEmbeddings })).toBeCloseTo(0, 5);
  });

  it('returns mean pairwise cosine across probes', () => {
    // Probe 1: 2 identical vectors → sim=1
    // Probe 2: 2 orthogonal vectors → sim=0
    // Mean = 0.5
    const perProbeEmbeddings = [
      [[1, 0], [1, 0]],
      [[1, 0], [0, 1]],
    ];
    expect(semanticSimilarity({ perProbeEmbeddings })).toBeCloseTo(0.5, 5);
  });

  it('handles single vector per probe (trivially consistent = 1)', () => {
    const perProbeEmbeddings = [[[1, 2, 3]]];
    expect(semanticSimilarity({ perProbeEmbeddings })).toBeCloseTo(1, 5);
  });

  it('throws on empty input', () => {
    expect(() => semanticSimilarity({ perProbeEmbeddings: [] })).toThrow(/non-empty/);
  });
});

// ─── lengthStability ──────────────────────────────────────────────────────

describe('lengthStability', () => {
  it('returns 1 when all token counts are equal', () => {
    const perProbeTokenCounts = [[100, 100, 100, 100, 100, 100, 100]];
    expect(lengthStability({ perProbeTokenCounts })).toBeCloseTo(1, 6);
  });

  it('returns value < 1 for variable token counts', () => {
    const perProbeTokenCounts = [[50, 100, 150]]; // mean=100, stddev~40.8
    const ls = lengthStability({ perProbeTokenCounts });
    expect(ls).toBeLessThan(1);
    expect(ls).toBeGreaterThan(0);
  });

  it('guards against mean=0 by returning 0 for that probe', () => {
    const perProbeTokenCounts = [[0, 0, 0], [100, 100, 100]];
    // Probe 1: mean=0 → 0; Probe 2: stddev=0 → 1; mean = 0.5
    expect(lengthStability({ perProbeTokenCounts })).toBeCloseTo(0.5, 6);
  });

  it('averages LS over probes', () => {
    // Two probes both fully stable → 1.0
    const perProbeTokenCounts = [[50, 50, 50], [80, 80, 80]];
    expect(lengthStability({ perProbeTokenCounts })).toBeCloseTo(1.0, 6);
  });

  it('throws on empty input', () => {
    expect(() => lengthStability({ perProbeTokenCounts: [] })).toThrow(/non-empty/);
  });
});

// ─── scs (harmonic mean) ──────────────────────────────────────────────────

describe('scs', () => {
  it('computes harmonic mean of three equal values', () => {
    expect(scs({ ac: 0.9, ss: 0.9, ls: 0.9 })).toBeCloseTo(0.9, 5);
  });

  it('harmonic mean is dominated by the minimum component', () => {
    // HM of 1.0, 1.0, 0.5 = 3/(1+1+2) = 3/4 = 0.75
    expect(scs({ ac: 1.0, ss: 1.0, ls: 0.5 })).toBeCloseTo(0.75, 5);
  });

  it('collapses to 0 when any component is zero', () => {
    expect(scs({ ac: 0, ss: 0.9, ls: 0.9 })).toBe(0);
    expect(scs({ ac: 0.9, ss: 0, ls: 0.9 })).toBe(0);
    expect(scs({ ac: 0.9, ss: 0.9, ls: 0 })).toBe(0);
  });

  it('returns 0 when all components are 0', () => {
    expect(scs({ ac: 0, ss: 0, ls: 0 })).toBe(0);
  });
});

// ─── correctnessWeightedScs ───────────────────────────────────────────────

describe('correctnessWeightedScs', () => {
  it('returns scs × minParaphraseAccuracy', () => {
    expect(correctnessWeightedScs({ scs: 0.9, minParaphraseAccuracy: 0.8 })).toBeCloseTo(0.72, 5);
  });

  it('collapses to 0 when minParaphraseAccuracy is 0 (stable wrongness)', () => {
    expect(correctnessWeightedScs({ scs: 0.95, minParaphraseAccuracy: 0 })).toBe(0);
  });

  it('collapses when minParaphraseAccuracy is below threshold', () => {
    // scs=1.0, minAcc=0.3 → cwSCS=0.3 < scsShipGate (0.8)
    const cwSCS = correctnessWeightedScs({ scs: 1.0, minParaphraseAccuracy: 0.3 });
    expect(cwSCS).toBeCloseTo(0.3, 5);
    expect(cwSCS).toBeLessThan(DEFAULTS.scsShipGate);
  });
});

// ─── shipGate ─────────────────────────────────────────────────────────────

describe('shipGate', () => {
  it('returns true when both conditions met', () => {
    expect(
      shipGate({
        cwSCS: DEFAULTS.scsShipGate,
        minParaphraseAccuracy: DEFAULTS.minParaphraseAccuracy,
      }),
    ).toBe(true);
  });

  it('returns false when cwSCS just below threshold', () => {
    expect(
      shipGate({
        cwSCS: DEFAULTS.scsShipGate - 0.001,
        minParaphraseAccuracy: 1.0,
      }),
    ).toBe(false);
  });

  it('returns false when minParaphraseAccuracy below threshold', () => {
    expect(
      shipGate({
        cwSCS: 1.0,
        minParaphraseAccuracy: DEFAULTS.minParaphraseAccuracy - 0.001,
      }),
    ).toBe(false);
  });

  it('returns false when both conditions fail', () => {
    expect(shipGate({ cwSCS: 0.1, minParaphraseAccuracy: 0.1 })).toBe(false);
  });
});

// ─── computeScsReport (async orchestrator) ────────────────────────────────

describe('computeScsReport', () => {
  const makeProbes = (n) =>
    Array.from({ length: n }, (_, i) => ({ id: `probe-${i}` }));

  const makeEvaluate = ({ answers, tokenCounts, correct }) =>
    async (promptText, probe) => {
      const qi = parseInt(promptText, 10);
      const pi = parseInt(probe.id.split('-')[1], 10);
      return {
        answer: answers[pi][qi],
        tokenCount: tokenCounts[pi][qi],
        correct: correct[pi][qi],
      };
    };

  const makeEmbed = (dim) => async (texts) =>
    texts.map((t) => {
      // Deterministic stub: embed as unit vector in dim-d space seeded by string length
      const vec = Array(dim).fill(0);
      vec[t.length % dim] = 1;
      return vec;
    });

  it('computes report fields for perfectly consistent outputs', async () => {
    const nProbes = 3;
    const nPrompts = 7;
    // All prompts give the same answer for each probe, same token count
    const answers = Array.from({ length: nProbes }, (_, pi) =>
      Array.from({ length: nPrompts }, () => `answer-${pi}`),
    );
    const tokenCounts = Array.from({ length: nProbes }, () => Array(nPrompts).fill(100));
    const correct = Array.from({ length: nProbes }, () => Array(nPrompts).fill(true));

    const probes = makeProbes(nProbes);
    const prompts = Array.from({ length: nPrompts }, (_, i) => String(i));

    const report = await computeScsReport({
      probes,
      prompts,
      evaluate: makeEvaluate({ answers, tokenCounts, correct }),
      embed: makeEmbed(4),
    });

    expect(report.ac).toBeCloseTo(1.0, 4);
    expect(report.ls).toBeCloseTo(1.0, 4);
    expect(report.scs).toBeGreaterThan(0);
    expect(report.minParaphraseAccuracy).toBeCloseTo(1.0, 4);
    expect(report.cwSCS).toBeCloseTo(report.scs, 4);
    expect(typeof report.pass).toBe('boolean');
  });

  it('cwSCS collapses when minParaphraseAccuracy is low', async () => {
    const nProbes = 2;
    const nPrompts = 7;
    const answers = Array.from({ length: nProbes }, (_, pi) =>
      Array.from({ length: nPrompts }, () => `answer-${pi}`),
    );
    const tokenCounts = Array.from({ length: nProbes }, () => Array(nPrompts).fill(50));
    // One prompt variant is always wrong → minParaphraseAccuracy < 1
    const correct = Array.from({ length: nProbes }, () =>
      Array.from({ length: nPrompts }, (_, qi) => qi !== 0), // prompt 0 always wrong
    );

    const probes = makeProbes(nProbes);
    const prompts = Array.from({ length: nPrompts }, (_, i) => String(i));

    const report = await computeScsReport({
      probes,
      prompts,
      evaluate: makeEvaluate({ answers, tokenCounts, correct }),
      embed: makeEmbed(4),
    });

    expect(report.minParaphraseAccuracy).toBe(0); // prompt 0 has 0% accuracy
    expect(report.cwSCS).toBeCloseTo(0, 5); // collapses
    expect(report.pass).toBe(false);
  });

  it('throws on empty probes', async () => {
    await expect(
      computeScsReport({
        probes: [],
        prompts: ['p1'],
        evaluate: async () => ({ answer: 'x', tokenCount: 1, correct: true }),
        embed: async (t) => t.map(() => [1, 0]),
      }),
    ).rejects.toThrow(/non-empty/);
  });

  it('throws when evaluate is not a function', async () => {
    await expect(
      computeScsReport({
        probes: [{ id: 'p1' }],
        prompts: ['prompt'],
        evaluate: null,
        embed: async (t) => t.map(() => [1, 0]),
      }),
    ).rejects.toThrow(/evaluate/);
  });
});
