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

import { callWindowFor, clip, DEFAULTS, normalizeTarget, TARGET_LIST } from './p7-shared.mjs';

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
  // Native-search contamination (§4.5): reaching for native grep/rg on the
  // fully-indexed eval corpus bypasses the ss-* retrieval being optimized.
  const nativeSearchPenalty = run.usedNativeSearch ? DEFAULTS.nativeSearchPenalty : 0;
  return { lo, hi, under, over, callDevPenalty, evidencePenalty, nativeSearchPenalty };
}

/**
 * Efficiency-Adjusted Scoring factor (EAS).
 * §3.7.1 step 4.
 *
 * Per target, per stratum:
 *   call_deviation_penalty = 0.02 × (max(0, lo−calls) + max(0, calls−hi))
 *   evidence_adequacy_penalty = 0.10 when finalAnswerEmitted && !usedReadOrGrep && stratum≠'no-match'
 *   native_search_penalty = 0.10 when usedNativeSearch (§4.5 contamination)
 *   per_target_factor = 1 − mean(call_dev) − mean(evidence) − mean(native_search)
 *
 * The overall factor = min across targets (Maximin-consistent — a variant cannot
 * exploit Sonnet's good behaviour to mask GPT-5.5 under-exploration).
 *
 * @typedef {{ stratum: string, calls: number, finalAnswerEmitted: boolean,
 *             usedReadOrGrep: boolean, usedNativeSearch?: boolean,
 *             expected_call_window?: [number,number] }} ProbeRun
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
    let totalNativeSearch = 0;
    const runDetails = [];

    for (const run of runs) {
      if (typeof run.calls !== 'number' || !Number.isFinite(run.calls)) {
        throw new TypeError(`efficiencyFactor: each run.calls must be a finite number`);
      }
      const { lo, hi, under, over, callDevPenalty, evidencePenalty, nativeSearchPenalty } = _runPenalties(run);
      totalCallDev += callDevPenalty;
      totalEvidence += evidencePenalty;
      totalNativeSearch += nativeSearchPenalty;
      runDetails.push({ stratum: run.stratum, calls: run.calls, lo, hi, under, over, callDevPenalty, evidencePenalty, nativeSearchPenalty });
    }

    const meanCallDev = totalCallDev / runs.length;
    const meanEvidence = totalEvidence / runs.length;
    const meanNativeSearch = totalNativeSearch / runs.length;
    const factor = 1 - meanCallDev - meanEvidence - meanNativeSearch;
    perTargetFactor[target] = factor;
    breakdown[target] = { meanCallDev, meanEvidence, meanNativeSearch, factor, runs: runDetails };
  }

  const factor = Math.min(...Object.values(perTargetFactor));

  return { factor, perTargetFactor, breakdown };
}

// ─── native-relative desirability scoring ───────────────────────────────────

function _finiteNumber(name, value, { min = -Infinity, max = Infinity, minExclusive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  if ((minExclusive ? value <= min : value < min) || value > max) {
    throw new RangeError(`${name} must be in range`);
  }
  return value;
}

function _metric(obj, keys) {
  for (const key of keys) {
    if (obj && typeof obj[key] === 'number' && Number.isFinite(obj[key])) return obj[key];
  }
  return undefined;
}

function _baselineMetrics(row, label) {
  const score = _metric(row, ['score', 'accuracy']);
  const calls = _metric(row, ['calls', 'toolCalls', 'tool_calls']);
  const tokens = _metric(row, ['tokens', 'agentTokens', 'agent_tokens', 'totalTokens', 'total_tokens']);
  const overheadTokens = _metric(row, ['overheadTokens', 'overhead_tokens', 'fixedTokens', 'fixed_tokens', 'tokenFloor', 'token_floor']);
  const out = {
    score: _finiteNumber(`${label}.score`, score, { min: 0, max: 1 }),
    calls: _finiteNumber(`${label}.calls`, calls, { min: 0, minExclusive: true }),
    tokens: _finiteNumber(`${label}.tokens`, tokens, { min: 0, minExclusive: true }),
  };
  if (overheadTokens !== undefined) {
    out.overheadTokens = _finiteNumber(`${label}.overheadTokens`, overheadTokens, { min: 0 });
  }
  return out;
}

function _workTokens(totalTokens, overheadTokens = 0) {
  return Math.max(1, totalTokens - overheadTokens);
}

function _effectiveTokenPair({ runTokens, base }) {
  const overheadTokens = typeof base.overheadTokens === 'number' ? base.overheadTokens : 0;
  return {
    overheadTokens,
    tokensForScoring: _workTokens(runTokens, overheadTokens),
    nativeTokensForScoring: _workTokens(base.tokens, overheadTokens),
  };
}

function _normalizeBaselineRows(rows) {
  const out = {};
  rows.forEach((row, i) => {
    const target = normalizeTarget(row.target ?? row.model ?? row.provider ?? '');
    const probeId = row.probeId ?? row.probe_id ?? row.id;
    if (typeof probeId !== 'string' || probeId.length === 0) {
      throw new TypeError(`native baseline row ${i}: probeId/probe_id is required`);
    }
    out[target] ??= {};
    out[target][probeId] = _baselineMetrics(row, `native baseline ${target}.${probeId}`);
  });
  return out;
}

function _normalizeBaselineObject(source) {
  if (source == null || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('native baseline must be an object or row array');
  }
  const out = {};
  for (const [rawTarget, targetRows] of Object.entries(source)) {
    const target = normalizeTarget(rawTarget);
    out[target] ??= {};
    if (Array.isArray(targetRows)) {
      targetRows.forEach((row, i) => {
        const probeId = row.probeId ?? row.probe_id ?? row.id;
        if (typeof probeId !== 'string' || probeId.length === 0) {
          throw new TypeError(`native baseline ${target}[${i}]: probeId/probe_id is required`);
        }
        out[target][probeId] = _baselineMetrics(row, `native baseline ${target}.${probeId}`);
      });
      continue;
    }
    if (targetRows == null || typeof targetRows !== 'object') {
      throw new TypeError(`native baseline ${target} must be an object or array`);
    }
    for (const [probeId, row] of Object.entries(targetRows)) {
      out[target][probeId] = _baselineMetrics(row, `native baseline ${target}.${probeId}`);
    }
  }
  return out;
}

/**
 * Normalize supported native-baseline JSON shapes into:
 *   { sonnet: { [probeId]: { score, calls, tokens } }, gpt5_5: { ... } }
 *
 * Supported input:
 *   - { nativeBaselineByTarget: { sonnet: { p1: {...} } } }
 *   - { baselineByTarget: { sonnet: [{ probeId:'p1', ... }] } }
 *   - { baselines: [{ target:'sonnet', probe_id:'p1', ... }] }
 *   - [{ target:'sonnet', probeId:'p1', ... }]
 */
export function normalizeNativeBaselineByTarget(doc) {
  if (Array.isArray(doc)) return _normalizeBaselineRows(doc);
  if (doc == null || typeof doc !== 'object') {
    throw new TypeError('native baseline document must be an object or array');
  }
  if (doc.nativeBaselineByTarget) return _normalizeBaselineObject(doc.nativeBaselineByTarget);
  if (doc.baselineByTarget) return _normalizeBaselineObject(doc.baselineByTarget);
  if (doc.baselines) {
    if (!Array.isArray(doc.baselines)) throw new TypeError('native baseline baselines must be an array');
    return _normalizeBaselineRows(doc.baselines);
  }
  return _normalizeBaselineObject(doc);
}

/**
 * Fail fast before spending agent calls if a native-relative GEPA run does not
 * have complete baseline rows for every scored (target, probe).
 */
export function assertNativeBaselineCoverage({ baselineByTarget, probes, targets = TARGET_LIST }) {
  const baseline = normalizeNativeBaselineByTarget(baselineByTarget);
  const missing = [];
  for (const rawTarget of targets) {
    const target = normalizeTarget(rawTarget);
    for (const probe of probes || []) {
      const probeId = probe?.id;
      if (typeof probeId !== 'string' || probeId.length === 0) {
        throw new TypeError('assertNativeBaselineCoverage: every probe must have an id');
      }
      if (!baseline[target]?.[probeId]) missing.push(`${target}.${probeId}`);
    }
  }
  if (missing.length > 0) {
    const suffix = missing.length > 5 ? `, ... +${missing.length - 5} more` : '';
    throw new RangeError(`native baseline missing ${missing.length} row(s): ${missing.slice(0, 5).join(', ')}${suffix}`);
  }
  return baseline;
}

/**
 * Accuracy desirability: 0 below the acceptable floor, 1 at/above target.
 * The floor is max(absolute floor, native accuracy - slack); target is
 * max(target floor, native accuracy + lift), capped at 1.
 */
export function accuracyDesirability({ accuracy, nativeAccuracy }) {
  const a = _finiteNumber('accuracyDesirability.accuracy', accuracy, { min: 0, max: 1 });
  const base = _finiteNumber('accuracyDesirability.nativeAccuracy', nativeAccuracy, { min: 0, max: 1 });
  const floor = Math.max(DEFAULTS.nativeAccuracyFloor, base - DEFAULTS.nativeAccuracySlack);
  const target = Math.min(1, Math.max(DEFAULTS.nativeAccuracyTargetFloor, base + DEFAULTS.nativeAccuracyTargetLift));
  if (a <= floor) return 0;
  if (a >= target) return 1;
  return clip((a - floor) / (target - floor), 0, 1);
}

/**
 * Minimize-one-metric desirability relative to native rg+Read. Scores 1 once
 * the candidate reaches the target ratio, 0 at/above the fail ratio.
 */
export function minimizeRelativeDesirability({ value, nativeValue, targetRatio, failRatio, minTarget = 0 }) {
  const v = _finiteNumber('minimizeRelativeDesirability.value', value, { min: 0 });
  const base = _finiteNumber('minimizeRelativeDesirability.nativeValue', nativeValue, { min: 0, minExclusive: true });
  const target = Math.max(minTarget, base * targetRatio);
  const fail = base * failRatio;
  if (fail <= target) throw new RangeError('minimizeRelativeDesirability: fail threshold must be greater than target');
  if (v <= target) return 1;
  if (v >= fail) return 0;
  return clip((fail - v) / (fail - target), 0, 1);
}

function _weightedGeomean(parts, weights) {
  let total = 0;
  let sum = 0;
  for (const [key, d] of Object.entries(parts)) {
    const w = weights[key] ?? 0;
    if (w <= 0) continue;
    const v = clip(_finiteNumber(`desirability.${key}`, d, { min: 0, max: 1 }), 0, 1);
    if (v === 0) return 0;
    total += w;
    sum += w * Math.log(v);
  }
  if (total <= 0) throw new RangeError('nativeRelativeScore: desirability weights must have positive sum');
  return Math.exp(sum / total);
}

/**
 * Native-relative scalar score for GEPA. Per run, accuracy/calls/tokens are
 * transformed to desirabilities and combined with a weighted geometric mean.
 * If a baseline row carries overheadTokens/overhead_tokens, token desirability
 * is computed on max(1, totalTokens - overheadTokens) for both the candidate
 * and native baseline. Raw total tokens are still reported in the breakdown.
 * Per-target factors are the mean of probe-level desirabilities; final factor
 * is min across targets to keep the joint Maximin discipline.
 *
 * @typedef {{ probeId:string, score:number, calls:number, tokens:number }} NativeProbeRun
 * @param {object} args
 * @param {{ [target:string]: NativeProbeRun[] }} args.perTarget
 * @param {{ [target:string]: { [probeId:string]: { score:number, calls:number, tokens:number } } }} args.baselineByTarget
 * @param {{ accuracy?:number, calls?:number, tokens?:number }} [args.weights]
 */
export function nativeRelativeScore({ perTarget, baselineByTarget, weights = DEFAULTS.nativeRelativeWeights }) {
  if (perTarget == null || typeof perTarget !== 'object' || Array.isArray(perTarget)) {
    throw new TypeError('nativeRelativeScore: perTarget must be a plain object');
  }
  const baseline = normalizeNativeBaselineByTarget(baselineByTarget);
  const perTargetFactor = {};
  const breakdown = {};

  for (const [target, runs] of Object.entries(perTarget)) {
    if (!Array.isArray(runs) || runs.length === 0) {
      throw new TypeError(`nativeRelativeScore: perTarget.${target} must be a non-empty array`);
    }
    const targetBaseline = baseline[normalizeTarget(target)];
    if (!targetBaseline) throw new RangeError(`nativeRelativeScore: missing native baseline for target ${target}`);
    let total = 0;
    const details = [];
    for (const run of runs) {
      const probeId = run.probeId ?? run.id;
      if (typeof probeId !== 'string' || probeId.length === 0) {
        throw new TypeError('nativeRelativeScore: each run must include probeId');
      }
      const base = targetBaseline[probeId];
      if (!base) throw new RangeError(`nativeRelativeScore: missing native baseline for ${target}.${probeId}`);
      const score = _finiteNumber(`nativeRelativeScore.${target}.${probeId}.score`, run.score, { min: 0, max: 1 });
      // calls/tokens fall back to the baseline (= neutral efficiency desirability)
      // when missing/non-finite. The candidate is already penalised on the accuracy
      // axis (the judge gave the errored / empty-answer run a low score) — a missing
      // efficiency measurement should NOT crash the whole candidate. Concretely:
      // both API runners (Anthropic + OpenRouter) initialise `usage = { input:0,
      // output:0,... }` and only accumulate values on successful API responses, so
      // if every retry attempt for one (probe,target) fails (or the provider returns
      // 200 with no usage block), `agentTokenCount` returns null and `toProbeRun`
      // threads that null through. At 1330 runs/gen-1 this fired in real life
      // 2026-05-26 (crashed gpt5_5.csharp-008) and torched ~5 completed seeds.
      const _callsFallback = !(typeof run.calls === 'number' && Number.isFinite(run.calls) && run.calls >= 0);
      const _tokensFallback = !(typeof run.tokens === 'number' && Number.isFinite(run.tokens) && run.tokens > 0);
      const calls = _callsFallback ? base.calls : run.calls;
      const tokens = _tokensFallback ? base.tokens : run.tokens;
      if (_callsFallback || _tokensFallback) {
        // eslint-disable-next-line no-console
        console.warn(`nativeRelativeScore: missing measurement for ${target}.${probeId}` +
          `${_callsFallback ? ` (calls=${run.calls})` : ''}${_tokensFallback ? ` (tokens=${run.tokens})` : ''}` +
          ` — falling back to baseline (neutral efficiency desirability)`);
      }
      const tokenPair = _effectiveTokenPair({ runTokens: tokens, base });
      const desirability = {
        accuracy: accuracyDesirability({ accuracy: score, nativeAccuracy: base.score }),
        calls: minimizeRelativeDesirability({
          value: calls,
          nativeValue: base.calls,
          targetRatio: DEFAULTS.nativeCallTargetRatio,
          failRatio: DEFAULTS.nativeCallFailRatio,
          minTarget: 1,
        }),
        tokens: minimizeRelativeDesirability({
          value: tokenPair.tokensForScoring,
          nativeValue: tokenPair.nativeTokensForScoring,
          targetRatio: DEFAULTS.nativeTokenTargetRatio,
          failRatio: DEFAULTS.nativeTokenFailRatio,
        }),
      };
      const overall = _weightedGeomean(desirability, weights);
      total += overall;
      details.push({
        probeId,
        score,
        nativeScore: base.score,
        calls,
        nativeCalls: base.calls,
        tokens,
        nativeTokens: base.tokens,
        overheadTokens: tokenPair.overheadTokens,
        tokensForScoring: tokenPair.tokensForScoring,
        nativeTokensForScoring: tokenPair.nativeTokensForScoring,
        desirability: { ...desirability, overall },
        ...(_callsFallback || _tokensFallback
          ? { missingMeasurement: { calls: _callsFallback, tokens: _tokensFallback } }
          : {}),
      });
    }
    perTargetFactor[target] = total / runs.length;
    breakdown[target] = { factor: perTargetFactor[target], runs: details };
  }

  return { factor: Math.min(...Object.values(perTargetFactor)), perTargetFactor, breakdown };
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
