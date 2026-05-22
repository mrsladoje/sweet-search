/**
 * EAS — Efficiency-Adjusted Scoring for GEPA (Phase 7).
 *
 * Pure scoring math — no I/O. All formulas reference §3.7.1 of docs/PHASE7.md.
 *
 * Key design choices:
 *  - `efficiencyFactor` aggregates per-target factors with `min` (Maximin-consistent).
 *    A variant cannot hide GPT-5.5 reckless early-stops behind Sonnet's clean
 *    call distribution.
 *  - Evidence-adequacy penalty is NEVER applied to 'no-match' strata — the agent
 *    is expected to confirm the negative without necessarily reading/grepping.
 *  - `paretoAdmissible` compares against the DISPLACED INCUMBENT, not per-target
 *    Pareto maxima (anti-utopia-point fix per GPT-5.5 review §C1).
 */

import { callWindowFor, clip, DEFAULTS } from './p7-shared.mjs';

// ─── task score ───────────────────────────────────────────────────────────────

/**
 * Variant-level task score: weighted mean of per-probe Maximin scores.
 * §3.7.1 step 3.
 *
 * @param {object} args
 * @param {number[]} args.perProbeMaximin — per-probe joint (Maximin) scores
 * @param {number[]} [args.weights]       — optional; uniform if omitted
 * @returns {number}
 */
export function taskScore({ perProbeMaximin, weights }) {
  if (!Array.isArray(perProbeMaximin) || perProbeMaximin.length === 0) {
    throw new TypeError('taskScore: perProbeMaximin must be a non-empty array');
  }
  const w = weights ?? perProbeMaximin.map(() => 1);
  if (!Array.isArray(w) || w.length !== perProbeMaximin.length) {
    throw new RangeError('taskScore: weights length must match perProbeMaximin length');
  }
  let sumW = 0;
  let sumWM = 0;
  for (let i = 0; i < perProbeMaximin.length; i++) {
    if (typeof perProbeMaximin[i] !== 'number' || !Number.isFinite(perProbeMaximin[i])) {
      throw new TypeError(`taskScore: perProbeMaximin[${i}] must be a finite number`);
    }
    if (typeof w[i] !== 'number' || !Number.isFinite(w[i]) || w[i] < 0) {
      throw new RangeError(`taskScore: weights[${i}] must be a non-negative finite number`);
    }
    sumW += w[i];
    sumWM += w[i] * perProbeMaximin[i];
  }
  if (sumW === 0) throw new RangeError('taskScore: sum of weights must be positive');
  return sumWM / sumW;
}

// ─── efficiency factor ────────────────────────────────────────────────────────

/**
 * Per-run penalties: call-deviation and evidence-adequacy.
 * @private
 */
function _runPenalties(run) {
  const [lo, hi] = callWindowFor(run);
  const under = Math.max(0, lo - run.calls);
  const over = Math.max(0, run.calls - hi);
  const callDevPenalty = DEFAULTS.callDeviationPenaltyPerCall * (under + over);
  // Evidence-adequacy: penalise unsupported final answers ONLY on non-trivial strata.
  // 'no-match' probes are expected to conclude without reading files — no penalty.
  const evidencePenalty =
    run.finalAnswerEmitted && !run.usedReadOrGrep && run.stratum !== 'no-match'
      ? DEFAULTS.evidenceAdequacyPenalty
      : 0;
  return { lo, hi, under, over, callDevPenalty, evidencePenalty };
}

/**
 * Efficiency-Adjusted Scoring factor (EAS).
 * §3.7.1 step 4.
 *
 * Per target, per stratum:
 *   call_deviation_penalty = 0.02 × (max(0, lo−calls) + max(0, calls−hi))
 *   evidence_adequacy_penalty = 0.10 when finalAnswerEmitted && !usedReadOrGrep && stratum≠'no-match'
 *   per_target_factor = 1 − mean(call_dev) − mean(evidence)
 *
 * The overall factor = min across targets (Maximin-consistent — a variant cannot
 * exploit Sonnet's good behaviour to mask GPT-5.5 under-exploration).
 *
 * @typedef {{ stratum: string, calls: number, finalAnswerEmitted: boolean,
 *             usedReadOrGrep: boolean, expected_call_window?: [number,number] }} ProbeRun
 *
 * @param {object} args
 * @param {{ sonnet?: ProbeRun[], gpt5_5?: ProbeRun[], [key: string]: ProbeRun[] }} args.perTarget
 * @returns {{ factor: number, perTargetFactor: Record<string,number>, breakdown: object }}
 */
export function efficiencyFactor({ perTarget }) {
  if (perTarget == null || typeof perTarget !== 'object' || Array.isArray(perTarget)) {
    throw new TypeError('efficiencyFactor: perTarget must be a plain object');
  }
  const entries = Object.entries(perTarget);
  if (entries.length === 0) {
    throw new RangeError('efficiencyFactor: perTarget must have at least one target');
  }

  const perTargetFactor = {};
  const breakdown = {};

  for (const [target, runs] of entries) {
    if (!Array.isArray(runs) || runs.length === 0) {
      throw new TypeError(`efficiencyFactor: perTarget.${target} must be a non-empty array`);
    }
    let totalCallDev = 0;
    let totalEvidence = 0;
    const runDetails = [];

    for (const run of runs) {
      if (typeof run.calls !== 'number' || !Number.isFinite(run.calls)) {
        throw new TypeError(`efficiencyFactor: each run.calls must be a finite number`);
      }
      const { lo, hi, under, over, callDevPenalty, evidencePenalty } = _runPenalties(run);
      totalCallDev += callDevPenalty;
      totalEvidence += evidencePenalty;
      runDetails.push({ stratum: run.stratum, calls: run.calls, lo, hi, under, over, callDevPenalty, evidencePenalty });
    }

    const meanCallDev = totalCallDev / runs.length;
    const meanEvidence = totalEvidence / runs.length;
    const factor = 1 - meanCallDev - meanEvidence;
    perTargetFactor[target] = factor;
    breakdown[target] = { meanCallDev, meanEvidence, factor, runs: runDetails };
  }

  const factor = Math.min(...Object.values(perTargetFactor));

  return { factor, perTargetFactor, breakdown };
}

// ─── length penalty ───────────────────────────────────────────────────────────

/**
 * Prompt length penalty.
 * §3.7.1 step 5: length_penalty = DEFAULTS.lengthPenaltyPer1000 × tokenCount / 1000
 *
 * @param {number} tokenCount
 * @returns {number}
 */
export function lengthPenalty(tokenCount) {
  if (typeof tokenCount !== 'number' || !Number.isFinite(tokenCount) || tokenCount < 0) {
    throw new RangeError('lengthPenalty: tokenCount must be a non-negative finite number');
  }
  return DEFAULTS.lengthPenaltyPer1000 * tokenCount / 1000;
}

// ─── final score ──────────────────────────────────────────────────────────────

/**
 * Combined final score.
 * §3.7.1 step 6: final_score = taskScore × efficiencyFactor − lengthPenalty
 *
 * @param {object} args
 * @param {number} args.taskScore
 * @param {number} args.efficiencyFactor
 * @param {number} args.lengthPenalty
 * @returns {number}
 */
export function finalScore({ taskScore: ts, efficiencyFactor: ef, lengthPenalty: lp }) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) throw new TypeError('finalScore: taskScore must be a finite number');
  if (typeof ef !== 'number' || !Number.isFinite(ef)) throw new TypeError('finalScore: efficiencyFactor must be a finite number');
  if (typeof lp !== 'number' || !Number.isFinite(lp)) throw new TypeError('finalScore: lengthPenalty must be a finite number');
  return ts * ef - lp;
}

// ─── probe weight ─────────────────────────────────────────────────────────────

/**
 * Dynamic hard-negative probe weight.
 * §3.1: below varianceStabilityRounds → uniform weight 1.0.
 * Above threshold: clip(max(variance, judgeNoiseFloor), 0.1, 2.0).
 *
 * @param {object} args
 * @param {number} args.variance         — observed score variance across rounds
 * @param {number} args.roundsEvaluated  — how many rounds this probe has been scored
 * @returns {number}
 */
export function probeWeight({ variance, roundsEvaluated }) {
  if (typeof variance !== 'number' || !Number.isFinite(variance)) {
    throw new TypeError('probeWeight: variance must be a finite number');
  }
  if (!Number.isInteger(roundsEvaluated) || roundsEvaluated < 0) {
    throw new RangeError('probeWeight: roundsEvaluated must be a non-negative integer');
  }
  if (roundsEvaluated < DEFAULTS.varianceStabilityRounds) {
    return 1.0;
  }
  const [lo, hi] = DEFAULTS.varianceWeightClip;
  return clip(Math.max(variance, DEFAULTS.judgeNoiseFloor), lo, hi);
}

// ─── Pareto admission ─────────────────────────────────────────────────────────

/**
 * Pareto admission hard constraint.
 * §3.7.1 step 9 (anti-utopia-point fix per GPT-5.5 review §C1).
 *
 * Baseline MUST be the DISPLACED INCUMBENT (or current joint-best when not
 * displacing), NOT per-target Pareto maxima. Comparing to per-target maxima
 * creates a "utopia point" that wrongly rejects genuine joint improvements.
 *
 * Worked example (see §3.7.1 step 9 for full derivation):
 *
 *   Pareto front contains specialist incumbents:
 *     V_S = (Sonnet 0.91, GPT-5.5 0.50)
 *     V_G = (Sonnet 0.50, GPT-5.5 0.91)
 *   New candidate V_C = (Sonnet 0.75, GPT-5.5 0.85).
 *   V_C would displace V_G (lower GPT score, lower Sonnet).
 *
 *   CORRECT — compare to displaced incumbent V_G = (0.50, 0.91):
 *     drop_sonnet = 0.50 − 0.75 = −0.25 → candidate is BETTER → no violation
 *     drop_gpt5_5 = 0.91 − 0.85 =  0.06 → 0.06 ≤ 0.15 → ADMIT ✓
 *
 *   WRONG — compare to utopia point (0.91, 0.91):
 *     drop_sonnet = 0.91 − 0.75 = 0.16 > 0.15 → would REJECT — incorrectly!
 *
 * @param {object} args
 * @param {{ score_sonnet: number, score_gpt5_5: number }} args.candidate
 * @param {{ score_sonnet: number, score_gpt5_5: number }} args.baseline  — displaced incumbent
 * @param {number} [args.cap]
 * @returns {{ ok: boolean, drop: { sonnet: number, gpt5_5: number }, target_degraded: string[] }}
 */
export function paretoAdmissible({ candidate, baseline, cap = DEFAULTS.paretoAdmissionCap }) {
  if (candidate == null || typeof candidate !== 'object') {
    throw new TypeError('paretoAdmissible: candidate must be an object');
  }
  if (baseline == null || typeof baseline !== 'object') {
    throw new TypeError('paretoAdmissible: baseline must be an object');
  }
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) {
    throw new RangeError('paretoAdmissible: cap must be a non-negative finite number');
  }
  if (typeof candidate.score_sonnet !== 'number') throw new TypeError('paretoAdmissible: candidate.score_sonnet must be a number');
  if (typeof candidate.score_gpt5_5 !== 'number') throw new TypeError('paretoAdmissible: candidate.score_gpt5_5 must be a number');
  if (typeof baseline.score_sonnet !== 'number') throw new TypeError('paretoAdmissible: baseline.score_sonnet must be a number');
  if (typeof baseline.score_gpt5_5 !== 'number') throw new TypeError('paretoAdmissible: baseline.score_gpt5_5 must be a number');

  const dropSonnet = baseline.score_sonnet - candidate.score_sonnet;
  const dropGpt5_5 = baseline.score_gpt5_5 - candidate.score_gpt5_5;

  const target_degraded = [];
  if (dropSonnet > cap) target_degraded.push('sonnet');
  if (dropGpt5_5 > cap) target_degraded.push('gpt5_5');

  return {
    ok: target_degraded.length === 0,
    drop: { sonnet: dropSonnet, gpt5_5: dropGpt5_5 },
    target_degraded,
  };
}
