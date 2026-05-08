/**
 * Plackett-Luce ranking model fit (Hunter 2004 MM iteration).
 *
 * Given a list of partial rankings over a shared item set, fits the worth
 * parameter w_i for each item s.t.
 *
 *   P(ranking r) = ∏_{k=1..|r|-1} w_{r[k]} / Σ_{j=k..|r|} w_{r[j]}
 *
 * The MM (Minorisation-Maximisation) update is:
 *
 *   w_i^(t+1) = W_i / Σ_{r ∋ i} Σ_{k ≤ pos(i, r)} 1 / Σ_{j=k..|r|} w_{r[j]}^(t)
 *
 * where W_i is the number of times i appears as a non-last entry in any
 * ranking. Worths are normalised to sum to 1 for stability.
 *
 * Plan reference: §6.4 (variant ablation), §11.4.
 *
 * Pairwise specialisation: if every ranking has length 2 ([winner, loser]),
 * this collapses to the Bradley-Terry MM iteration (Zermelo / Ford 1957).
 *
 * @param {object} args
 * @param {string[]} args.items
 * @param {string[][]} args.rankings    — each is best→worst, items must be in `items`
 * @param {number}   [args.maxIter=500]
 * @param {number}   [args.tol=1e-8]    — relative change in worth vector
 * @returns {{
 *   worth: Record<string, number>,
 *   rank: Record<string, number>,    // 1 = best
 *   iterations: number,
 *   converged: boolean,
 * }}
 */
import { mulberry32, randInt } from './rng.mjs';

export function plackettLuceFit({ items, rankings, maxIter = 500, tol = 1e-8 }) {
  if (!Array.isArray(items) || items.length < 2) {
    throw new RangeError('plackett-luce: need at least 2 items');
  }
  if (!Array.isArray(rankings) || rankings.length === 0) {
    throw new RangeError('plackett-luce: need at least one ranking');
  }

  const n = items.length;
  const idx = new Map(items.map((it, i) => [it, i]));

  // Pre-validate rankings + count W_i (wins = non-last appearances).
  const wins = new Float64Array(n);
  const validated = [];
  for (const r of rankings) {
    if (!Array.isArray(r) || r.length < 2) continue; // need ≥ 2 to contribute
    const positions = new Int32Array(r.length);
    for (let k = 0; k < r.length; k++) {
      const i = idx.get(r[k]);
      if (i === undefined) {
        throw new RangeError(`plackett-luce: ranking item "${r[k]}" not in items`);
      }
      positions[k] = i;
    }
    for (let k = 0; k < r.length - 1; k++) wins[positions[k]] += 1;
    validated.push(positions);
  }

  // Initialise uniformly.
  let w = new Float64Array(n).fill(1 / n);

  let converged = false;
  let lastIter = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    lastIter = iter + 1;
    const denom = new Float64Array(n);
    for (const r of validated) {
      const len = r.length;
      // Tail-sum of worth from position k..len-1.
      let suffix = 0;
      const suffixSums = new Float64Array(len);
      for (let k = len - 1; k >= 0; k--) {
        suffix += w[r[k]];
        suffixSums[k] = suffix;
      }
      // For each k where r[k] is a winner (k < len-1), add 1/Σ_{j=k..len-1} w_{r[j]}
      // to the denominator of EVERY item r[j] with j ≥ k.
      for (let k = 0; k < len - 1; k++) {
        const inv = 1 / suffixSums[k];
        for (let j = k; j < len; j++) denom[r[j]] += inv;
      }
    }

    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      next[i] = denom[i] > 0 ? wins[i] / denom[i] : 0;
    }
    // Normalise to sum = 1.
    let s = 0;
    for (let i = 0; i < n; i++) s += next[i];
    if (s > 0) {
      for (let i = 0; i < n; i++) next[i] /= s;
    } else {
      // All-zero denominators (degenerate input) — keep prior estimate.
      converged = true;
      break;
    }

    // Convergence on max absolute worth change (worths sum to 1 so abs is
    // bounded). Relative change misbehaves when one item's worth → 0 — the
    // shrinking-but-still-large relative-change loop never exits.
    let maxAbs = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(next[i] - w[i]);
      if (d > maxAbs) maxAbs = d;
    }
    w = next;
    if (maxAbs < tol) {
      converged = true;
      break;
    }
  }

  const worth = {};
  for (let i = 0; i < n; i++) worth[items[i]] = w[i];

  // Ranks: 1 = highest worth, ties broken by item order for determinism.
  const ordered = items
    .map((it, i) => ({ it, i, w: w[i] }))
    .sort((a, b) => (b.w - a.w) || (a.i - b.i));
  const rank = {};
  for (let r = 0; r < ordered.length; r++) rank[ordered[r].it] = r + 1;

  return { worth, rank, iterations: lastIter, converged };
}

/**
 * Bootstrap CIs over the rank vector. Resample rankings with replacement,
 * refit PL, record each item's rank. Returns 2.5/97.5 percentiles per item.
 *
 * @param {object} args
 * @param {string[]} args.items
 * @param {string[][]} args.rankings
 * @param {number}   [args.bootstrapIters=200]
 * @param {number}   [args.seed=42]
 * @param {number}   [args.confidence=0.95]
 * @param {number}   [args.maxIter=500]
 * @param {number}   [args.tol=1e-8]
 */
export function plackettLuceFitWithBootstrap({
  items,
  rankings,
  bootstrapIters = 200,
  seed = 42,
  confidence = 0.95,
  maxIter = 500,
  tol = 1e-8,
}) {
  const point = plackettLuceFit({ items, rankings, maxIter, tol });
  const rng = mulberry32(seed);
  const m = rankings.length;
  const ranksMatrix = items.map(() => new Int32Array(bootstrapIters));

  for (let b = 0; b < bootstrapIters; b++) {
    const sample = new Array(m);
    for (let i = 0; i < m; i++) sample[i] = rankings[randInt(rng, m)];
    let fit;
    try {
      fit = plackettLuceFit({ items, rankings: sample, maxIter, tol });
    } catch {
      // Degenerate resample — repeat the point estimate.
      fit = point;
    }
    for (let i = 0; i < items.length; i++) {
      ranksMatrix[i][b] = fit.rank[items[i]];
    }
  }

  const tail = (1 - confidence) / 2;
  const ciLow = {};
  const ciHigh = {};
  const ciSpread = {};
  for (let i = 0; i < items.length; i++) {
    const sorted = Array.from(ranksMatrix[i]).sort((a, b) => a - b);
    const lo = sorted[Math.max(0, Math.floor(tail * bootstrapIters))];
    const hi = sorted[Math.min(bootstrapIters - 1, Math.ceil((1 - tail) * bootstrapIters) - 1)];
    ciLow[items[i]] = lo;
    ciHigh[items[i]] = hi;
    ciSpread[items[i]] = hi - lo;
  }

  return {
    ...point,
    ciLow,
    ciHigh,
    ciSpread,
    bootstrapIters,
    confidence,
  };
}
