/**
 * Unit tests for core/prompt-optimization/sweep/eas.mjs (Phase 7 EAS scoring).
 * Pure deterministic math — no network / I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  taskScore,
  efficiencyFactor,
  accuracyDesirability,
  assertNativeBaselineCoverage,
  minimizeRelativeDesirability,
  nativeRelativeScore,
  normalizeNativeBaselineByTarget,
  lengthPenalty,
  finalScore,
  probeWeight,
  paretoAdmissible,
  costUsd,
  estLatencySeconds,
  realizedCostUsd,
} from '../../../core/prompt-optimization/sweep/eas.mjs';
import { DEFAULTS } from '../../../core/prompt-optimization/sweep/p7-shared.mjs';

// ─── taskScore ────────────────────────────────────────────────────────────────

describe('taskScore', () => {
  it('returns uniform weighted mean when no weights provided', () => {
    // (0.8 + 0.6 + 0.4) / 3 = 0.6
    expect(taskScore({ perProbeMaximin: [0.8, 0.6, 0.4] })).toBeCloseTo(0.6, 10);
  });

  it('computes weighted mean correctly with explicit weights', () => {
    // (2×0.9 + 1×0.3) / 3 = 2.1/3 = 0.7
    expect(taskScore({ perProbeMaximin: [0.9, 0.3], weights: [2, 1] })).toBeCloseTo(0.7, 10);
  });

  it('single probe returns that probe score', () => {
    expect(taskScore({ perProbeMaximin: [0.72] })).toBeCloseTo(0.72, 10);
  });

  it('throws TypeError on non-array perProbeMaximin', () => {
    expect(() => taskScore({ perProbeMaximin: null })).toThrow(TypeError);
  });

  it('throws TypeError on empty array', () => {
    expect(() => taskScore({ perProbeMaximin: [] })).toThrow(TypeError);
  });

  it('throws RangeError when weights length does not match', () => {
    expect(() => taskScore({ perProbeMaximin: [0.5, 0.6], weights: [1] })).toThrow(RangeError);
  });

  it('throws RangeError when all weights are zero', () => {
    expect(() => taskScore({ perProbeMaximin: [0.5, 0.6], weights: [0, 0] })).toThrow(RangeError);
  });
});

// ─── efficiencyFactor — call-window per stratum ───────────────────────────────

describe('efficiencyFactor — call windows per stratum', () => {
  it('applies no call-deviation penalty when calls are within literal-lookup window [1,3]', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'literal-lookup', calls: 2, finalAnswerEmitted: false, usedReadOrGrep: true }],
      },
    });
    expect(result.breakdown.sonnet.meanCallDev).toBe(0);
    expect(result.perTargetFactor.sonnet).toBeCloseTo(1.0, 10);
  });

  it('penalises over-call on literal-lookup (calls=5 → over=2 → 0.04)', () => {
    // literal-lookup window [1,3]; calls=5 → over=2, penalty=0.02×2=0.04
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'literal-lookup', calls: 5, finalAnswerEmitted: false, usedReadOrGrep: true }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].over).toBe(2);
    expect(result.breakdown.sonnet.runs[0].callDevPenalty).toBeCloseTo(0.04, 10);
  });

  it('penalises under-call on multi-file-flow (calls=1, window [3,6] → under=2 → 0.04)', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'multi-file-flow', calls: 1, finalAnswerEmitted: false, usedReadOrGrep: true }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].under).toBe(2);
    expect(result.breakdown.sonnet.runs[0].callDevPenalty).toBeCloseTo(0.04, 10);
  });

  it('uses no-match window [2,5]', () => {
    // no-match window [2,5]; calls=1 → under=1, penalty=0.02
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'no-match', calls: 1, finalAnswerEmitted: true, usedReadOrGrep: false }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].lo).toBe(2);
    expect(result.breakdown.sonnet.runs[0].hi).toBe(5);
    expect(result.breakdown.sonnet.runs[0].callDevPenalty).toBeCloseTo(0.02, 10);
  });

  it('uses probe-level expected_call_window override', () => {
    // Override window to [2,2]; calls=5 → over=3, penalty=0.06
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{
          stratum: 'literal-lookup',
          calls: 5,
          finalAnswerEmitted: false,
          usedReadOrGrep: true,
          expected_call_window: [2, 2],
        }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].over).toBe(3);
    expect(result.breakdown.sonnet.runs[0].callDevPenalty).toBeCloseTo(0.06, 10);
  });
});

// ─── efficiencyFactor — evidence-adequacy penalty ─────────────────────────────

describe('efficiencyFactor — evidence-adequacy penalty', () => {
  it('applies evidence penalty when finalAnswerEmitted && !usedReadOrGrep on behavioral', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'behavioral', calls: 4, finalAnswerEmitted: true, usedReadOrGrep: false }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].evidencePenalty).toBeCloseTo(DEFAULTS.evidenceAdequacyPenalty, 10);
  });

  it('does NOT apply evidence penalty when usedReadOrGrep=true', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'behavioral', calls: 4, finalAnswerEmitted: true, usedReadOrGrep: true }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].evidencePenalty).toBe(0);
  });

  it('does NOT apply evidence penalty when finalAnswerEmitted=false', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'behavioral', calls: 4, finalAnswerEmitted: false, usedReadOrGrep: false }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].evidencePenalty).toBe(0);
  });

  it('does NOT apply evidence penalty on no-match stratum even with finalAnswerEmitted && !usedReadOrGrep', () => {
    // 'no-match' probes confirm absence — grepping is not required
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'no-match', calls: 3, finalAnswerEmitted: true, usedReadOrGrep: false }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].evidencePenalty).toBe(0);
  });

  it('mean-averages evidence penalty across multiple runs', () => {
    // 2 runs: one with penalty (0.10), one without (0.00) → mean = 0.05
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [
          { stratum: 'behavioral', calls: 4, finalAnswerEmitted: true, usedReadOrGrep: false },
          { stratum: 'literal-lookup', calls: 2, finalAnswerEmitted: true, usedReadOrGrep: true },
        ],
      },
    });
    expect(result.breakdown.sonnet.meanEvidence).toBeCloseTo(0.05, 10);
  });
});

// ─── efficiencyFactor — native-search contamination penalty (§4.5) ────────────

describe('efficiencyFactor — native-search penalty', () => {
  it('applies the native-search penalty when usedNativeSearch=true', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'literal-lookup', calls: 2, finalAnswerEmitted: true, usedReadOrGrep: true, usedNativeSearch: true }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].nativeSearchPenalty).toBeCloseTo(DEFAULTS.nativeSearchPenalty, 10);
    expect(result.breakdown.sonnet.meanNativeSearch).toBeCloseTo(DEFAULTS.nativeSearchPenalty, 10);
    expect(result.breakdown.sonnet.factor).toBeCloseTo(1 - DEFAULTS.nativeSearchPenalty, 10);
  });

  it('does NOT apply the native-search penalty when usedNativeSearch is absent/false (back-compat)', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'literal-lookup', calls: 2, finalAnswerEmitted: true, usedReadOrGrep: true }],
      },
    });
    expect(result.breakdown.sonnet.runs[0].nativeSearchPenalty).toBe(0);
    expect(result.breakdown.sonnet.meanNativeSearch).toBe(0);
    expect(result.breakdown.sonnet.factor).toBe(1);
  });

  it('stacks with the evidence penalty (native grep + unsupported answer)', () => {
    // ss never used, native grep used, then a final answer with no ss evidence.
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'behavioral', calls: 4, finalAnswerEmitted: true, usedReadOrGrep: false, usedNativeSearch: true }],
      },
    });
    const run = result.breakdown.sonnet.runs[0];
    expect(run.evidencePenalty).toBeCloseTo(DEFAULTS.evidenceAdequacyPenalty, 10);
    expect(run.nativeSearchPenalty).toBeCloseTo(DEFAULTS.nativeSearchPenalty, 10);
    expect(result.breakdown.sonnet.factor).toBeCloseTo(1 - DEFAULTS.evidenceAdequacyPenalty - DEFAULTS.nativeSearchPenalty, 10);
  });
});

// ─── efficiencyFactor — min-aggregation across targets ────────────────────────

describe('efficiencyFactor — min aggregation', () => {
  it('returns min of per-target factors', () => {
    // sonnet: perfect calls, no evidence penalty → factor = 1.0
    // gpt5_5: under-call on multi-file-flow → evidence penalty + call dev
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [
          { stratum: 'literal-lookup', calls: 2, finalAnswerEmitted: false, usedReadOrGrep: true },
        ],
        gpt5_5: [
          // multi-file-flow [3,6], calls=1 → under=2, callDev=0.04; finalAnswer unsupported
          { stratum: 'multi-file-flow', calls: 1, finalAnswerEmitted: true, usedReadOrGrep: false },
        ],
      },
    });
    expect(result.perTargetFactor.sonnet).toBeCloseTo(1.0, 10);
    // gpt5_5: 1 - 0.04 - 0.10 = 0.86
    expect(result.perTargetFactor.gpt5_5).toBeCloseTo(0.86, 10);
    // factor = min(1.0, 0.86) = 0.86
    expect(result.factor).toBeCloseTo(0.86, 10);
  });

  it('factor equals the weaker target', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'behavioral', calls: 4, finalAnswerEmitted: false, usedReadOrGrep: true }],
        gpt5_5: [{ stratum: 'behavioral', calls: 10, finalAnswerEmitted: false, usedReadOrGrep: true }],
      },
    });
    // gpt5_5: behavioral [3,6], over=4, callDev=0.08 → factor = 0.92
    // sonnet: behavioral [3,6], calls=4 within window → factor = 1.0
    expect(result.factor).toBeLessThan(result.perTargetFactor.sonnet);
    expect(result.factor).toBeCloseTo(result.perTargetFactor.gpt5_5, 10);
  });

  it('throws RangeError when perTarget is empty', () => {
    expect(() => efficiencyFactor({ perTarget: {} })).toThrow(RangeError);
  });

  it('throws TypeError when a target array is empty', () => {
    expect(() =>
      efficiencyFactor({ perTarget: { sonnet: [] } }),
    ).toThrow(TypeError);
  });
});

// ─── native-relative desirability ────────────────────────────────────────────

describe('native-relative desirability', () => {
  it('rewards beating native call count and penalizes worse-than-native call count', () => {
    expect(minimizeRelativeDesirability({
      value: 2,
      nativeValue: 4,
      targetRatio: DEFAULTS.nativeCallTargetRatio,
      failRatio: DEFAULTS.nativeCallFailRatio,
      minTarget: 1,
    })).toBe(1);
    expect(minimizeRelativeDesirability({
      value: 4,
      nativeValue: 4,
      targetRatio: DEFAULTS.nativeCallTargetRatio,
      failRatio: DEFAULTS.nativeCallFailRatio,
      minTarget: 1,
    })).toBeCloseTo(0.5, 10);
    expect(minimizeRelativeDesirability({
      value: 6,
      nativeValue: 4,
      targetRatio: DEFAULTS.nativeCallTargetRatio,
      failRatio: DEFAULTS.nativeCallFailRatio,
      minTarget: 1,
    })).toBe(0);
  });

  it('sets accuracy desirability against a native floor and target', () => {
    expect(accuracyDesirability({ accuracy: 0.86, nativeAccuracy: 0.9 })).toBe(0);
    expect(accuracyDesirability({ accuracy: 0.95, nativeAccuracy: 0.9 })).toBe(1);
    expect(accuracyDesirability({ accuracy: 0.91, nativeAccuracy: 0.9 })).toBeGreaterThan(0);
  });

  it('normalizes row baselines and gives max score when all three objectives beat native', () => {
    const baseline = normalizeNativeBaselineByTarget({
      baselines: [
        { target: 'sonnet', probe_id: 'p1', accuracy: 0.9, tool_calls: 4, agent_tokens: 1000 },
        { target: 'gpt-5.5', probe_id: 'p1', accuracy: 0.9, tool_calls: 4, agent_tokens: 1000 },
      ],
    });
    const r = nativeRelativeScore({
      baselineByTarget: baseline,
      perTarget: {
        sonnet: [{ probeId: 'p1', score: 0.95, calls: 2, tokens: 650 }],
        gpt5_5: [{ probeId: 'p1', score: 0.96, calls: 1, tokens: 500 }],
      },
    });
    expect(r.factor).toBeCloseTo(1, 10);
    // `overall` is efficiency-only (calls × cost); accuracy is a decoupled axis.
    expect(r.breakdown.sonnet.runs[0].desirability).toMatchObject({ accuracy: 1, calls: 1, cost: 1, overall: 1 });
  });

  it('scores cost savings on overhead-adjusted work input when baseline overhead is supplied', () => {
    const r = nativeRelativeScore({
      baselineByTarget: {
        gpt5_5: {
          p1: { score: 0.95, calls: 4, tokens: 12000, overhead_tokens: 10000 },
        },
      },
      perTarget: {
        gpt5_5: [{ probeId: 'p1', score: 0.97, calls: 4, tokens: 11300 }],
      },
      efficiencyWeights: { cost: 1, calls: 0 },
    });
    const row = r.breakdown.gpt5_5.runs[0];
    expect(row.overheadTokens).toBe(10000);
    // gpt5_5 input price = $5/1M; work input = tokens − overhead (output unknown → 0).
    expect(row.nativeCostUsd).toBeCloseTo(5 * 2000 / 1e6, 12); // (12000 − 10000)
    expect(row.costUsd).toBeCloseTo(5 * 1300 / 1e6, 12);       // (11300 − 10000) → 0.65× native
    expect(row.desirability.cost).toBe(1);
    expect(r.factor).toBe(1); // accuracy 0.97 ≥ target → gate 1; cost des 1 → 1×1
  });

  // Regression (2026-05-26): one bad run with null/0 tokens used to crash the
  // entire candidate's score. The API runners initialise usage to all-zero and
  // only accumulate on successful responses, so retry-exhausted (probe×target)
  // runs surface as `tokens=null` from agentTokenCount. At 1330 runs/gen-1
  // this fired in real life (gpt5_5.csharp-008) and torched 5 completed seeds.
  // Behaviour must now be: fall back to baseline (= neutral efficiency
  // desirability), record `missingMeasurement` in the row, never throw.
  it('falls back to baseline (no crash) when a run cost breakdown is null/zero/non-finite', () => {
    const baseline = {
      sonnet: { p1: { score: 0.9, calls: 4, tokens: 1000 } },
      gpt5_5: { p1: { score: 0.9, calls: 4, tokens: 1000 } },
    };
    for (const bad of [null, undefined, 0, NaN, -Infinity, '7']) {
      const r = nativeRelativeScore({
        baselineByTarget: baseline,
        perTarget: {
          sonnet: [{ probeId: 'p1', score: 0.95, calls: 2, tokens: 650 }],
          gpt5_5: [{ probeId: 'p1', score: 0, calls: 0, tokens: bad }],   // errored run
        },
      });
      expect(Number.isFinite(r.factor)).toBe(true);
      const row = r.breakdown.gpt5_5.runs[0];
      expect(row.costUsd).toBe(row.nativeCostUsd);       // fell back to baseline cost
      expect(row.missingMeasurement?.cost).toBe(true);   // and surfaced the flag
    }
  });

  it('falls back to baseline for calls too (defensive — same edge-case class)', () => {
    const baseline = {
      sonnet: { p1: { score: 0.9, calls: 4, tokens: 1000 } },
      gpt5_5: { p1: { score: 0.9, calls: 4, tokens: 1000 } },
    };
    const r = nativeRelativeScore({
      baselineByTarget: baseline,
      perTarget: {
        sonnet: [{ probeId: 'p1', score: 0.95, calls: 2, tokens: 650 }],
        gpt5_5: [{ probeId: 'p1', score: 0, calls: null, tokens: 100 }],
      },
    });
    expect(Number.isFinite(r.factor)).toBe(true);
    const row = r.breakdown.gpt5_5.runs[0];
    expect(row.calls).toBe(4);
    expect(row.missingMeasurement?.calls).toBe(true);
  });

  it('requires a complete baseline for every scored target/probe', () => {
    expect(() =>
      nativeRelativeScore({
        baselineByTarget: { sonnet: { p1: { score: 0.9, calls: 4, tokens: 1000 } } },
        perTarget: { sonnet: [{ probeId: 'p2', score: 0.95, calls: 2, tokens: 650 }] },
      }),
    ).toThrow(RangeError);
  });

  it('checks full baseline coverage before a paid run starts', () => {
    const baseline = {
      sonnet: { p1: { score: 0.9, calls: 4, tokens: 1000 } },
      gpt5_5: { p1: { score: 0.9, calls: 4, tokens: 1000 } },
    };
    expect(assertNativeBaselineCoverage({ baselineByTarget: baseline, probes: [{ id: 'p1' }] })).toBeTruthy();
    expect(() =>
      assertNativeBaselineCoverage({ baselineByTarget: baseline, probes: [{ id: 'p1' }, { id: 'p2' }] }),
    ).toThrow(/missing 2 row/);
  });
});

// ─── lengthPenalty ────────────────────────────────────────────────────────────

describe('lengthPenalty', () => {
  it('computes penalty = lengthPenaltyPer1000 × tokens / 1000', () => {
    // DEFAULTS.lengthPenaltyPer1000 = 0.05; tokens=1000 → 0.05
    expect(lengthPenalty(1000)).toBeCloseTo(0.05, 10);
    // tokens=2000 → 0.10
    expect(lengthPenalty(2000)).toBeCloseTo(0.10, 10);
    // tokens=500 → 0.025
    expect(lengthPenalty(500)).toBeCloseTo(0.025, 10);
  });

  it('returns 0 for zero tokens', () => {
    expect(lengthPenalty(0)).toBe(0);
  });

  it('throws RangeError on negative token count', () => {
    expect(() => lengthPenalty(-1)).toThrow(RangeError);
  });

  it('throws RangeError on non-finite token count', () => {
    expect(() => lengthPenalty(Infinity)).toThrow(RangeError);
    expect(() => lengthPenalty(NaN)).toThrow(RangeError);
  });
});

// ─── finalScore ───────────────────────────────────────────────────────────────

describe('finalScore', () => {
  it('computes taskScore × efficiencyFactor − lengthPenalty', () => {
    // 0.8 × 0.9 − 0.05 = 0.72 − 0.05 = 0.67
    expect(finalScore({ taskScore: 0.8, efficiencyFactor: 0.9, lengthPenalty: 0.05 })).toBeCloseTo(0.67, 10);
  });

  it('returns taskScore when efficiencyFactor=1 and lengthPenalty=0', () => {
    expect(finalScore({ taskScore: 0.75, efficiencyFactor: 1, lengthPenalty: 0 })).toBeCloseTo(0.75, 10);
  });

  it('throws TypeError on non-numeric input', () => {
    expect(() => finalScore({ taskScore: '0.5', efficiencyFactor: 1, lengthPenalty: 0 })).toThrow(TypeError);
    expect(() => finalScore({ taskScore: 0.5, efficiencyFactor: null, lengthPenalty: 0 })).toThrow(TypeError);
    expect(() => finalScore({ taskScore: 0.5, efficiencyFactor: 1, lengthPenalty: undefined })).toThrow(TypeError);
  });
});

// ─── probeWeight ──────────────────────────────────────────────────────────────

describe('probeWeight', () => {
  it('returns 1.0 before varianceStabilityRounds threshold (round 0)', () => {
    expect(probeWeight({ variance: 0.9, roundsEvaluated: 0 })).toBe(1.0);
  });

  it('returns 1.0 before varianceStabilityRounds threshold (round 1)', () => {
    // varianceStabilityRounds = 2; round 1 < 2 → uniform
    expect(probeWeight({ variance: 0.9, roundsEvaluated: 1 })).toBe(1.0);
  });

  it('applies clip and noise floor at stability threshold', () => {
    // roundsEvaluated = 2 (= varianceStabilityRounds) → use variance
    // variance=0.5 → max(0.5, 0.05)=0.5 → clip(0.5, 0.1, 2.0)=0.5
    expect(probeWeight({ variance: 0.5, roundsEvaluated: 2 })).toBeCloseTo(0.5, 10);
  });

  it('clamps low-variance probes to noise floor then to clip low (0.1)', () => {
    // variance=0.01 < judgeNoiseFloor=0.05 → max(0.01,0.05)=0.05 → clip(0.05,0.1,2.0)=0.1
    expect(probeWeight({ variance: 0.01, roundsEvaluated: 3 })).toBeCloseTo(0.1, 10);
  });

  it('clamps high-variance probes to clip high (2.0)', () => {
    // variance=5.0 → max(5.0,0.05)=5.0 → clip(5.0,0.1,2.0)=2.0
    expect(probeWeight({ variance: 5.0, roundsEvaluated: 3 })).toBeCloseTo(2.0, 10);
  });

  it('applies noise floor even when variance is exactly 0', () => {
    // variance=0 → max(0,0.05)=0.05 → clip(0.05,0.1,2.0)=0.1
    expect(probeWeight({ variance: 0, roundsEvaluated: 2 })).toBeCloseTo(0.1, 10);
  });

  it('throws TypeError on non-finite variance', () => {
    expect(() => probeWeight({ variance: NaN, roundsEvaluated: 2 })).toThrow(TypeError);
    expect(() => probeWeight({ variance: Infinity, roundsEvaluated: 2 })).toThrow(TypeError);
  });

  it('throws RangeError on non-integer roundsEvaluated', () => {
    expect(() => probeWeight({ variance: 0.5, roundsEvaluated: 1.5 })).toThrow(RangeError);
    expect(() => probeWeight({ variance: 0.5, roundsEvaluated: -1 })).toThrow(RangeError);
  });
});

// ─── paretoAdmissible ─────────────────────────────────────────────────────────

describe('paretoAdmissible', () => {
  it('admits a candidate that does not degrade either target', () => {
    const r = paretoAdmissible({
      candidate: { score_sonnet: 0.8, score_gpt5_5: 0.8 },
      baseline: { score_sonnet: 0.7, score_gpt5_5: 0.7 },
    });
    expect(r.ok).toBe(true);
    expect(r.target_degraded).toHaveLength(0);
    // drops are negative (candidate is better)
    expect(r.drop.sonnet).toBeCloseTo(-0.1, 10);
    expect(r.drop.gpt5_5).toBeCloseTo(-0.1, 10);
  });

  it('admits when drop is exactly at the cap (boundary)', () => {
    // drop = 0.15 exactly; ≤ cap → ADMIT
    const r = paretoAdmissible({
      candidate: { score_sonnet: 0.75, score_gpt5_5: 0.55 },
      baseline: { score_sonnet: 0.75, score_gpt5_5: 0.70 },
    });
    expect(r.ok).toBe(true);
    expect(r.drop.gpt5_5).toBeCloseTo(0.15, 10);
  });

  it('rejects when sonnet drop exceeds cap', () => {
    // drop_sonnet = 0.7 − 0.50 = 0.20 > 0.15
    const r = paretoAdmissible({
      candidate: { score_sonnet: 0.50, score_gpt5_5: 0.80 },
      baseline: { score_sonnet: 0.70, score_gpt5_5: 0.80 },
    });
    expect(r.ok).toBe(false);
    expect(r.target_degraded).toContain('sonnet');
    expect(r.target_degraded).not.toContain('gpt5_5');
  });

  it('rejects when gpt5_5 drop exceeds cap', () => {
    // drop_gpt5_5 = 0.9 − 0.7 = 0.20 > 0.15
    const r = paretoAdmissible({
      candidate: { score_sonnet: 0.90, score_gpt5_5: 0.70 },
      baseline: { score_sonnet: 0.85, score_gpt5_5: 0.90 },
    });
    expect(r.ok).toBe(false);
    expect(r.target_degraded).toContain('gpt5_5');
  });

  it('rejects when BOTH targets degrade beyond cap', () => {
    const r = paretoAdmissible({
      candidate: { score_sonnet: 0.40, score_gpt5_5: 0.40 },
      baseline: { score_sonnet: 0.80, score_gpt5_5: 0.80 },
    });
    expect(r.ok).toBe(false);
    expect(r.target_degraded).toContain('sonnet');
    expect(r.target_degraded).toContain('gpt5_5');
  });

  /**
   * UTOPIA-POINT WORKED EXAMPLE (§3.7.1 step 9, GPT-5.5 review §C1)
   *
   * Pareto front has specialist incumbents:
   *   V_S = (Sonnet 0.91, GPT-5.5 0.50)
   *   V_G = (Sonnet 0.50, GPT-5.5 0.91)
   *
   * New candidate V_C = (Sonnet 0.75, GPT-5.5 0.85) would displace V_G.
   *
   * CORRECT baseline = displaced incumbent V_G = (0.50, 0.91):
   *   drop_sonnet = 0.50 − 0.75 = −0.25 → better → no violation
   *   drop_gpt5_5 = 0.91 − 0.85 =  0.06 → 0.06 ≤ 0.15 → ADMIT ✓
   *
   * WRONG baseline = per-target maxima (utopia point) = (0.91, 0.91):
   *   drop_sonnet = 0.91 − 0.75 = 0.16 > 0.15 → would REJECT — incorrectly!
   */
  it('admits V_C against displaced incumbent V_G (utopia baseline would wrongly reject)', () => {
    const candidate = { score_sonnet: 0.75, score_gpt5_5: 0.85 };

    // CORRECT: compare to displaced incumbent V_G
    const correct = paretoAdmissible({
      candidate,
      baseline: { score_sonnet: 0.50, score_gpt5_5: 0.91 },
    });
    expect(correct.ok).toBe(true);
    expect(correct.drop.sonnet).toBeCloseTo(-0.25, 5);   // candidate is better on sonnet
    expect(correct.drop.gpt5_5).toBeCloseTo(0.06, 5);   // 0.06 ≤ 0.15 cap → passes

    // WRONG: compare to utopia point (0.91, 0.91) — demonstrates the bug
    const utopia = paretoAdmissible({
      candidate,
      baseline: { score_sonnet: 0.91, score_gpt5_5: 0.91 },
    });
    expect(utopia.ok).toBe(false);
    expect(utopia.target_degraded).toContain('sonnet'); // 0.91−0.75=0.16>0.15
  });

  it('supports custom cap', () => {
    // cap=0.05: drop_gpt5_5=0.06 would now exceed it
    const r = paretoAdmissible({
      candidate: { score_sonnet: 0.75, score_gpt5_5: 0.85 },
      baseline: { score_sonnet: 0.50, score_gpt5_5: 0.91 },
      cap: 0.05,
    });
    expect(r.ok).toBe(false);
    expect(r.target_degraded).toContain('gpt5_5');
  });

  it('throws TypeError on missing candidate/baseline', () => {
    expect(() => paretoAdmissible({ candidate: null, baseline: { score_sonnet: 0.5, score_gpt5_5: 0.5 } })).toThrow(TypeError);
    expect(() => paretoAdmissible({ candidate: { score_sonnet: 0.5, score_gpt5_5: 0.5 }, baseline: null })).toThrow(TypeError);
  });

  it('throws TypeError on non-numeric scores', () => {
    expect(() =>
      paretoAdmissible({
        candidate: { score_sonnet: '0.5', score_gpt5_5: 0.5 },
        baseline: { score_sonnet: 0.5, score_gpt5_5: 0.5 },
      }),
    ).toThrow(TypeError);
  });
});

// ─── hardening / edge cases (scoring-opus verification) ───────────────────────

describe('taskScore — hardening', () => {
  it('throws RangeError on a negative weight', () => {
    expect(() => taskScore({ perProbeMaximin: [0.5, 0.6], weights: [1, -1] })).toThrow(RangeError);
  });

  it('throws TypeError on a non-finite probe score', () => {
    expect(() => taskScore({ perProbeMaximin: [0.5, NaN] })).toThrow(TypeError);
    expect(() => taskScore({ perProbeMaximin: [0.5, Infinity] })).toThrow(TypeError);
  });
});

describe('efficiencyFactor — hardening', () => {
  it('throws TypeError when perTarget is null', () => {
    expect(() => efficiencyFactor({ perTarget: null })).toThrow(TypeError);
  });

  it('throws TypeError when perTarget is an array', () => {
    expect(() => efficiencyFactor({ perTarget: [] })).toThrow(TypeError);
  });

  it('throws TypeError on a non-finite run.calls', () => {
    expect(() =>
      efficiencyFactor({
        perTarget: { sonnet: [{ stratum: 'literal-lookup', calls: NaN, finalAnswerEmitted: false, usedReadOrGrep: true }] },
      }),
    ).toThrow(TypeError);
  });

  it('throws RangeError when a run has neither stratum nor expected_call_window', () => {
    expect(() =>
      efficiencyFactor({
        perTarget: { sonnet: [{ calls: 2, finalAnswerEmitted: false, usedReadOrGrep: true }] },
      }),
    ).toThrow(RangeError);
  });

  it('means call-deviation penalty across multiple runs (0.04 + 0 over 2 runs → 0.02)', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [
          { stratum: 'literal-lookup', calls: 5, finalAnswerEmitted: false, usedReadOrGrep: true }, // over=2 → 0.04
          { stratum: 'literal-lookup', calls: 2, finalAnswerEmitted: false, usedReadOrGrep: true }, // within → 0
        ],
      },
    });
    expect(result.breakdown.sonnet.meanCallDev).toBeCloseTo(0.02, 10);
    expect(result.perTargetFactor.sonnet).toBeCloseTo(0.98, 10);
  });

  it('min aggregation picks the weaker of two multi-run targets', () => {
    const result = efficiencyFactor({
      perTarget: {
        sonnet: [{ stratum: 'literal-lookup', calls: 2, finalAnswerEmitted: false, usedReadOrGrep: true }], // 1.0
        gpt5_5: [
          { stratum: 'behavioral', calls: 10, finalAnswerEmitted: false, usedReadOrGrep: true }, // over=4 → 0.08
          { stratum: 'behavioral', calls: 4, finalAnswerEmitted: false, usedReadOrGrep: true }, // within → 0
        ], // meanCallDev=0.04 → factor 0.96
      },
    });
    expect(result.perTargetFactor.sonnet).toBeCloseTo(1.0, 10);
    expect(result.perTargetFactor.gpt5_5).toBeCloseTo(0.96, 10);
    expect(result.factor).toBeCloseTo(0.96, 10);
  });

  it('combines call-deviation AND evidence penalties within one run', () => {
    // behavioral [3,6], calls=1 → under=2 → callDev 0.04; final unsupported → evidence 0.10
    const result = efficiencyFactor({
      perTarget: { sonnet: [{ stratum: 'behavioral', calls: 1, finalAnswerEmitted: true, usedReadOrGrep: false }] },
    });
    expect(result.breakdown.sonnet.meanCallDev).toBeCloseTo(0.04, 10);
    expect(result.breakdown.sonnet.meanEvidence).toBeCloseTo(0.10, 10);
    expect(result.perTargetFactor.sonnet).toBeCloseTo(0.86, 10);
  });
});

describe('paretoAdmissible — hardening', () => {
  it('uses DEFAULTS.paretoAdmissionCap (0.15) when cap omitted', () => {
    expect(DEFAULTS.paretoAdmissionCap).toBeCloseTo(0.15, 10);
    // drop_sonnet = 0.75 − 0.59 = 0.16 > 0.15 → reject under the default cap
    const r = paretoAdmissible({
      candidate: { score_sonnet: 0.59, score_gpt5_5: 0.8 },
      baseline: { score_sonnet: 0.75, score_gpt5_5: 0.8 },
    });
    expect(r.ok).toBe(false);
    expect(r.target_degraded).toContain('sonnet');
  });

  it('throws RangeError on a negative cap', () => {
    expect(() =>
      paretoAdmissible({
        candidate: { score_sonnet: 0.5, score_gpt5_5: 0.5 },
        baseline: { score_sonnet: 0.5, score_gpt5_5: 0.5 },
        cap: -0.1,
      }),
    ).toThrow(RangeError);
  });

  it('throws TypeError on a non-numeric baseline score', () => {
    expect(() =>
      paretoAdmissible({
        candidate: { score_sonnet: 0.5, score_gpt5_5: 0.5 },
        baseline: { score_sonnet: 0.5, score_gpt5_5: 'x' },
      }),
    ).toThrow(TypeError);
  });

  it('admits a candidate strictly better on both targets (negative drops)', () => {
    const r = paretoAdmissible({
      candidate: { score_sonnet: 0.95, score_gpt5_5: 0.95 },
      baseline: { score_sonnet: 0.5, score_gpt5_5: 0.5 },
    });
    expect(r.ok).toBe(true);
    expect(r.drop.sonnet).toBeLessThan(0);
    expect(r.drop.gpt5_5).toBeLessThan(0);
  });
});

// ─── costUsd — cache-naive dollar cost (2026-05-29 scoring overhaul) ────────

describe('costUsd', () => {
  const sonnet = { inPerM: 3, outPerM: 15 };
  const gpt5_5 = { inPerM: 5, outPerM: 30 };

  it('prices processedInput at the input rate and output at the output rate', () => {
    // (10000×3 + 2000×15) / 1e6 = (30000 + 30000)/1e6 = 0.06
    expect(costUsd({ processedInput: 10000, output: 2000, prices: sonnet })).toBeCloseTo(0.06, 10);
    // (10000×5 + 2000×30) / 1e6 = (50000 + 60000)/1e6 = 0.11
    expect(costUsd({ processedInput: 10000, output: 2000, prices: gpt5_5 })).toBeCloseTo(0.11, 10);
  });

  it('weights output above input (a generation token costs more than a context token)', () => {
    const inputHeavy = costUsd({ processedInput: 12000, output: 0, prices: sonnet });
    const outputHeavy = costUsd({ processedInput: 0, output: 12000, prices: sonnet });
    expect(outputHeavy).toBeGreaterThan(inputHeavy);
    expect(outputHeavy / inputHeavy).toBeCloseTo(5, 10); // 15/3
  });

  it('is a pure function of processed tokens (cache-naive): no cache-state input', () => {
    expect(costUsd({ processedInput: 66000, output: 2000, prices: sonnet }))
      .toBeCloseTo((66000 * 3 + 2000 * 15) / 1e6, 12);
  });

  it('throws on missing/negative prices or tokens', () => {
    expect(() => costUsd({ processedInput: 1, output: 1, prices: { inPerM: 3 } })).toThrow();
    expect(() => costUsd({ processedInput: -1, output: 1, prices: sonnet })).toThrow();
  });
});

// ─── estLatencySeconds — deterministic latency diagnostic ───────────────────

describe('estLatencySeconds', () => {
  const sonnet = { ttftSec: 0.8, throughputTokPerSec: 55 };

  it('combines round-trip TTFT with serial generation time (reasoning IS output)', () => {
    // 4 turns × 0.8 + 2000/55
    expect(estLatencySeconds({ turns: 4, output: 2000, latency: sonnet })).toBeCloseTo(3.2 + 2000 / 55, 10);
  });

  it('more reasoning (output) → more latency, holding turns fixed', () => {
    const a = estLatencySeconds({ turns: 3, output: 500, latency: sonnet });
    const b = estLatencySeconds({ turns: 3, output: 5000, latency: sonnet });
    expect(b).toBeGreaterThan(a);
  });

  it('throws on non-positive throughput', () => {
    expect(() => estLatencySeconds({ turns: 1, output: 100, latency: { ttftSec: 1, throughputTokPerSec: 0 } })).toThrow();
  });
});

// ─── realizedCostUsd — cache-AWARE deployment figure (reported, not optimized) ─

describe('realizedCostUsd', () => {
  const sonnet = { inPerM: 3, outPerM: 15, cacheReadPerM: 0.30, cacheWritePerM: 3.75 };
  const gpt5_5 = { inPerM: 5, outPerM: 30, cacheReadPerM: 0.50, cacheWritePerM: 5 };

  it('Anthropic: fresh input + cache_read@read-rate + cache_creation@write-rate + output', () => {
    // (5000×3 + 60000×0.30 + 1000×3.75 + 2000×15)/1e6 = (15000+18000+3750+30000)/1e6
    const r = realizedCostUsd({ agent: { input_tokens: 5000, output_tokens: 2000, cache_read_tokens: 60000, cache_creation_tokens: 1000 }, prices: sonnet });
    expect(r).toBeCloseTo(66750 / 1e6, 12);
  });

  it('OpenAI: cached reads are a subset of input → fresh = input − cached', () => {
    // fresh=10000: (10000×5 + 60000×0.5 + 0 + 2000×30)/1e6 = (50000+30000+60000)/1e6
    const r = realizedCostUsd({ agent: { input_tokens: 70000, output_tokens: 2000, cached_input_tokens: 60000 }, prices: gpt5_5 });
    expect(r).toBeCloseTo(140000 / 1e6, 12);
  });

  it('is ≤ the cache-naive cost (caching only ever discounts the bill)', () => {
    const agent = { input_tokens: 5000, output_tokens: 2000, cache_read_tokens: 60000, cache_creation_tokens: 1000 };
    const realized = realizedCostUsd({ agent, prices: sonnet });
    const naive = costUsd({ processedInput: 66000, output: 2000, prices: sonnet });
    expect(realized).toBeLessThan(naive);
  });

  it('returns null when no agent usage present', () => {
    expect(realizedCostUsd({ agent: null, prices: sonnet })).toBeNull();
  });
});
