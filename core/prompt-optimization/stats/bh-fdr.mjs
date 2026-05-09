/**
 * Benjamini-Hochberg False Discovery Rate correction.
 *
 * Reference: Benjamini & Hochberg, "Controlling the False Discovery Rate: A
 * Practical and Powerful Approach to Multiple Testing," J. Royal Statistical
 * Society B, 57:289-300, 1995. IR adoption justification: Urbano, Lima,
 * Hanjalic, "Towards Reliable Testing for Multiple IR System Comparisons,"
 * arXiv:2501.03930 — Wilcoxon + BH-FDR is empirically the highest-power IR
 * multi-system test.
 *
 * Why this is in P0: at our scale (14 variants × 4 evaluatees × ~6 metrics ×
 * multiple gates ≈ hundreds of implicit comparisons) Bonferroni at α=0.05/300
 * has near-zero power and BH-FDR at q=0.10 is the right tool. Plan reference:
 * §0.5 (control #4), §11.4.3 (algorithm), §11.4.1 (claim-space enumeration).
 *
 * Apply BH-FDR per claim space — never compound across claim spaces — so
 * Layer A's shape-grid corrections don't pollute Layer B's variant-pair
 * corrections.
 *
 * Pure function. No I/O.
 */

/**
 * @typedef {object} BHTest
 * @property {string} id     — claim identifier (e.g. "T1_vs_T9", "shape:short+symbol+narrow")
 * @property {number} pValue — two-sided p-value in [0, 1]
 * @property {object} [meta] — caller-supplied metadata, returned untouched
 */

/**
 * @typedef {object} BHResult
 * @property {string} id
 * @property {number} pValue
 * @property {number} adjustedP    — BH-adjusted p-value (≤ original; clipped to 1)
 * @property {number} rank         — 1-based position after sort by p-value asc
 * @property {boolean} survives    — true iff this claim is in the rejected set at q
 * @property {object} [meta]
 */

/**
 * Run Benjamini-Hochberg with FDR target q (default 0.10) over a list of
 * tests within a single claim space.
 *
 * Algorithm:
 *   1. Sort tests by pValue ascending.
 *   2. Find the largest k such that p_(k) ≤ k/m × q.
 *   3. Reject all tests with rank ≤ k.
 *   4. Compute monotone adjusted p-values:
 *        adj_(k) = min over j ≥ k of  p_(j) · m / j
 *      (this is the standard step-up adjusted-p definition; ensures adj_p
 *      is non-decreasing in rank.)
 *
 * @param {object} args
 * @param {BHTest[]} args.tests
 * @param {number}  [args.q=0.10] — FDR target
 * @param {string}  [args.claimSpace='unspecified'] — for output traceability
 * @returns {{
 *   q: number,
 *   m: number,
 *   nSurvived: number,
 *   maxRejectedRank: number,    // 0 when nothing survives
 *   results: BHResult[],        // in original input order
 *   sortedResults: BHResult[],  // sorted by pValue asc
 *   claimSpace: string,
 * }}
 */
export function benjaminiHochberg({ tests, q = 0.1, claimSpace = 'unspecified' }) {
  if (!Array.isArray(tests)) throw new TypeError('bh-fdr: tests must be an array');
  if (tests.length === 0) throw new RangeError('bh-fdr: empty test list');
  if (!(q > 0 && q < 1)) throw new RangeError('bh-fdr: q must be in (0, 1)');

  const m = tests.length;
  const annotated = tests.map((t, idx) => {
    if (!t || typeof t.id !== 'string') {
      throw new TypeError('bh-fdr: each test needs a string id');
    }
    if (typeof t.pValue !== 'number' || !(t.pValue >= 0 && t.pValue <= 1)) {
      throw new RangeError(`bh-fdr: test ${t.id} has invalid pValue ${t.pValue}`);
    }
    return { ...t, _origIdx: idx };
  });

  const sorted = annotated.slice().sort((x, y) => {
    if (x.pValue !== y.pValue) return x.pValue - y.pValue;
    return x.id.localeCompare(y.id); // tie-break deterministically by id
  });

  // Find max k such that p_(k) ≤ k/m · q
  let maxRejectedRank = 0;
  for (let k = 1; k <= m; k++) {
    const threshold = (k / m) * q;
    if (sorted[k - 1].pValue <= threshold) {
      maxRejectedRank = k;
    }
  }

  // Monotone adjusted p-values via step-up: walk back from k=m, take running min
  const adjustedSorted = new Array(m);
  let runningMin = 1;
  for (let k = m; k >= 1; k--) {
    const adj = Math.min(1, (sorted[k - 1].pValue * m) / k);
    runningMin = Math.min(runningMin, adj);
    adjustedSorted[k - 1] = runningMin;
  }

  const sortedResults = sorted.map((t, i) => ({
    id: t.id,
    pValue: t.pValue,
    adjustedP: adjustedSorted[i],
    rank: i + 1,
    survives: i + 1 <= maxRejectedRank,
    ...(t.meta !== undefined ? { meta: t.meta } : {}),
  }));

  // Restore original order for the primary results array
  const results = new Array(m);
  for (let i = 0; i < m; i++) {
    const orig = sorted[i]._origIdx;
    results[orig] = sortedResults[i];
  }

  return {
    q,
    m,
    nSurvived: maxRejectedRank,
    maxRejectedRank,
    results,
    sortedResults,
    claimSpace,
  };
}

/**
 * Convenience: filter a results array down to surviving claims only.
 * Used by §6.4 ablation (only surviving variant pairs feed PL ranking) and
 * §7.6 query-shape promotion (only surviving shape-cells get baked into
 * `instruction_text`).
 */
export function survivors(bhResult) {
  return bhResult.results.filter((r) => r.survives);
}
