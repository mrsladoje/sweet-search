/**
 * Paired bootstrap confidence interval on a paired metric difference.
 *
 * Resample n paired (a_i, b_i) with replacement, compute the mean diff per
 * resample. The (1-α)/2 and 1-(1-α)/2 percentiles of the bootstrap
 * distribution form the CI. Default α=0.05 → 95% CI.
 *
 * Pairs are resampled jointly (the same index drawn from both vectors) so the
 * pair-level dependency is preserved, matching Efron's paired bootstrap and
 * the BEIR / TREC convention. Plan reference: §11.4.
 *
 * Returns the relative delta as well — defined as observedDiff / mean(b),
 * with NaN if mean(b)=0 (division-by-zero is a real possibility for binary
 * metrics where the baseline scored zero).
 *
 * @param {object} args
 * @param {number[]} args.a
 * @param {number[]} args.b
 * @param {number}   [args.iterations=10000]
 * @param {number}   [args.seed=42]
 * @param {number}   [args.confidence=0.95]
 * @returns {{
 *   observedDiff: number,
 *   ciLow: number,
 *   ciHigh: number,
 *   confidence: number,
 *   relDelta: number,
 *   relCiLow: number,
 *   relCiHigh: number,
 *   iterations: number,
 *   nPairs: number,
 * }}
 */
import { mulberry32, randInt } from './rng.mjs';

export function pairedBootstrapCI({
  a,
  b,
  iterations = 10000,
  seed = 42,
  confidence = 0.95,
}) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new TypeError('paired-bootstrap: a and b must be arrays');
  }
  if (a.length !== b.length) {
    throw new RangeError(`paired-bootstrap: length mismatch (${a.length} vs ${b.length})`);
  }
  if (a.length === 0) {
    throw new RangeError('paired-bootstrap: empty inputs');
  }
  if (!(confidence > 0 && confidence < 1)) {
    throw new RangeError('paired-bootstrap: confidence must be in (0, 1)');
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError('paired-bootstrap: iterations must be a positive integer');
  }

  const n = a.length;
  let observedSumA = 0;
  let observedSumB = 0;
  for (let i = 0; i < n; i++) {
    observedSumA += a[i];
    observedSumB += b[i];
  }
  const observedMeanA = observedSumA / n;
  const observedMeanB = observedSumB / n;
  const observedDiff = observedMeanA - observedMeanB;

  const rng = mulberry32(seed);
  const samples = new Float64Array(iterations);
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const idx = randInt(rng, n);
      s += a[idx] - b[idx];
    }
    samples[it] = s / n;
  }
  samples.sort();

  const tail = (1 - confidence) / 2;
  const loIdx = Math.max(0, Math.floor(tail * iterations));
  const hiIdx = Math.min(iterations - 1, Math.ceil((1 - tail) * iterations) - 1);
  const ciLow = samples[loIdx];
  const ciHigh = samples[hiIdx];

  const denom = observedMeanB;
  const safeDiv = (num) => (denom === 0 ? Number.NaN : num / denom);

  return {
    observedDiff,
    ciLow,
    ciHigh,
    confidence,
    relDelta: safeDiv(observedDiff),
    relCiLow: safeDiv(ciLow),
    relCiHigh: safeDiv(ciHigh),
    iterations,
    nPairs: n,
  };
}
