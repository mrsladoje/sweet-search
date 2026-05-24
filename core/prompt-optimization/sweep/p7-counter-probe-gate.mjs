/**
 * §5.7 adversarial counter-probe generalization gate.
 *
 * The 10 counter-probes are hostile-surface rewrites of dev probes (same gold,
 * a query rephrased to VIOLATE the P6 query-shaping heuristic — no symbol, broad
 * or terse). At the end of a run the WINNING prompt is replayed on them per
 * production target; we compare the counter-probe aggregate to the winner's dev
 * taskScore:
 *
 *   drop = (devScore − counterMaximin) / devScore
 *     drop ≤ 0.15  ⇒ P6 signal GENERALISED (the prompt isn't shape-overfit)
 *     drop > 0.25  ⇒ OVERFIT to query-shape alignment → gate FAILS
 *     in between   ⇒ borderline (reported, does not fail)
 *
 * Purpose (Gemini 2nd-pass §B4): guard against the author subconsciously
 * aligning dev probes with the P6 win-rate signal so the loop "validates" a
 * rigged test. Like p7-ood-gate.mjs, the per-target runners are INJECTED so this
 * module has no network dependency and is fully unit-testable.
 *
 * Plan reference: docs/PHASE7.md §5.7.
 */

import { DEFAULTS } from './p7-shared.mjs';

/** Mean of a numeric array; null for empty. */
function mean(xs) {
  if (!xs || xs.length === 0) return null;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

/** Validate a runner result and extract its per-probe scores. */
function scoresOf(label, result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.perProbe)) {
    throw new TypeError(`runCounterProbeGate: ${label} must resolve to { perProbe: Array }`);
  }
  return result.perProbe.map((p, i) => {
    if (!p || typeof p !== 'object' || typeof p.score !== 'number' || !Number.isFinite(p.score)) {
      throw new TypeError(`runCounterProbeGate: ${label} perProbe[${i}].score must be a finite number`);
    }
    return p.score;
  });
}

/**
 * @typedef {object} CounterProbeGateResult
 * @property {number}  devScore        — winner's dev taskScore (baseline)
 * @property {number}  counterMaximin  — min(mean sonnet, mean gpt5_5) over counter-probes
 * @property {number}  counter_sonnet  — mean Sonnet score over counter-probes
 * @property {number}  counter_gpt5_5  — mean GPT-5.5 score over counter-probes
 * @property {number}  drop            — (devScore − counterMaximin)/devScore
 * @property {boolean} generalised     — drop ≤ counterProbeGeneralizeDrop (0.15)
 * @property {boolean} overfit         — drop > counterProbeOverfitDrop (0.25)
 * @property {boolean} borderline      — between the two thresholds
 * @property {boolean} pass            — NOT overfit (the gate fails only on clear overfit)
 */

/**
 * @param {object} args
 * @param {string} args.winnerPrompt
 * @param {object[]} args.counterProbes   — the §5.7 counter-probe set
 * @param {number} args.devScore          — winner's dev taskScore (> 0)
 * @param {(winnerPrompt:string, probes:object[])=>Promise<{perProbe:{score:number}[]}>} args.runSonnet
 * @param {(winnerPrompt:string, probes:object[])=>Promise<{perProbe:{score:number}[]}>} args.runGpt5_5
 * @returns {Promise<CounterProbeGateResult>}
 */
export async function runCounterProbeGate({ winnerPrompt, counterProbes, devScore, runSonnet, runGpt5_5 }) {
  if (typeof winnerPrompt !== 'string' || winnerPrompt.length === 0) {
    throw new TypeError('runCounterProbeGate: winnerPrompt must be a non-empty string');
  }
  if (!Array.isArray(counterProbes) || counterProbes.length === 0) {
    throw new TypeError('runCounterProbeGate: counterProbes must be a non-empty array');
  }
  if (typeof devScore !== 'number' || !Number.isFinite(devScore) || devScore <= 0) {
    throw new TypeError('runCounterProbeGate: devScore must be a positive finite number');
  }
  if (typeof runSonnet !== 'function' || typeof runGpt5_5 !== 'function') {
    throw new TypeError('runCounterProbeGate: runSonnet and runGpt5_5 must be functions');
  }

  const [sRes, gRes] = await Promise.all([runSonnet(winnerPrompt, counterProbes), runGpt5_5(winnerPrompt, counterProbes)]);
  const counter_sonnet = mean(scoresOf('runSonnet', sRes)) ?? 0;
  const counter_gpt5_5 = mean(scoresOf('runGpt5_5', gRes)) ?? 0;
  const counterMaximin = Math.min(counter_sonnet, counter_gpt5_5);

  const drop = (devScore - counterMaximin) / devScore;
  const generalised = drop <= DEFAULTS.counterProbeGeneralizeDrop;
  const overfit = drop > DEFAULTS.counterProbeOverfitDrop;

  return {
    devScore,
    counterMaximin,
    counter_sonnet,
    counter_gpt5_5,
    drop,
    generalised,
    overfit,
    borderline: !generalised && !overfit,
    pass: !overfit,
  };
}
