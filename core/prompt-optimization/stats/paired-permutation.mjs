/**
 * Paired permutation test on two paired observation vectors.
 *
 * For each iteration, randomly swap each pair (a_i, b_i) with prob 0.5, then
 * recompute the mean difference. The two-sided p-value is the fraction of
 * permutations whose absolute mean diff is >= the absolute observed diff.
 *
 * Suitable for bounded discrete metrics (e.g. PASS rate ∈ {0,1}) where t-test
 * assumptions don't hold. Matches the IR / SE-conference convention (Sakai
 * 2019, BEIR reproducibility appendix). Plan reference: §11.4.
 *
 * Always pre-pend +1 (the observed labelling) into the count so the p-value is
 * never zero — a standard small-sample correction (North et al. 2002).
 *
 * @param {object} args
 * @param {number[]} args.a   — sample A observations (numeric, e.g. 0/1)
 * @param {number[]} args.b   — sample B observations (paired with a, same length)
 * @param {number}   [args.iterations=10000]
 * @param {number}   [args.seed=42]
 * @returns {{
 *   observedDiff: number,
 *   pValue: number,
 *   iterations: number,
 *   nGreaterOrEqual: number,
 *   nPairs: number,
 * }}
 */
import { mulberry32 } from './rng.mjs';

export function pairedPermutationTest({ a, b, iterations = 10000, seed = 42 }) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new TypeError('paired-permutation: a and b must be arrays');
  }
  if (a.length !== b.length) {
    throw new RangeError(`paired-permutation: length mismatch (${a.length} vs ${b.length})`);
  }
  if (a.length === 0) {
    throw new RangeError('paired-permutation: empty inputs');
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError('paired-permutation: iterations must be a positive integer');
  }

  const n = a.length;
  const diffs = new Float64Array(n);
  let observedSum = 0;
  for (let i = 0; i < n; i++) {
    diffs[i] = a[i] - b[i];
    observedSum += diffs[i];
  }
  const observedDiff = observedSum / n;
  const absObserved = Math.abs(observedDiff);

  const rng = mulberry32(seed);
  let nGE = 1; // include the observed labelling itself
  for (let iter = 0; iter < iterations; iter++) {
    let permSum = 0;
    for (let i = 0; i < n; i++) {
      const sign = rng() < 0.5 ? -1 : 1;
      permSum += sign * diffs[i];
    }
    if (Math.abs(permSum / n) >= absObserved) nGE++;
  }

  return {
    observedDiff,
    pValue: nGE / (iterations + 1),
    iterations,
    nGreaterOrEqual: nGE,
    nPairs: n,
  };
}
