/**
 * Krippendorff's α — inter-annotator agreement coefficient.
 *
 * Reference: Krippendorff, "Computing Krippendorff's Alpha-Reliability,"
 * 2011, https://repository.upenn.edu/asc_papers/43/. Used by §11.6.4
 * (judge IAA gate) and Track B's IAA validation step (§7.5 P6.3).
 *
 * α ranges:
 *   1.0   = perfect agreement
 *   0.0   = agreement at chance level
 *   < 0   = systematic disagreement
 *
 * Plan threshold (§11.6.4 / disjoint-panel.toml):
 *   alphaIndividual ≥ 0.6   per-judge α (vs human reference)
 *   alphaMajority   ≥ 0.7   panel-majority α (vs human reference)
 *
 * Inputs are a units × annotators matrix of categorical labels (e.g.
 * 'A' | 'B' | 'tie' for PRP pairwise outcomes). NaN / null marks missing
 * data; missing cells are tolerated per Krippendorff §3.
 *
 * Pure function. No I/O.
 */

/**
 * Coincidence-matrix Krippendorff α for nominal data.
 *
 * @param {object} args
 * @param {Array<Array<string|null>>} args.matrix — units × annotators; null = missing
 * @param {string[]} [args.labels] — universe of labels (auto-derived if absent)
 * @returns {{ alpha: number, n: number, observedDisagreement: number, expectedDisagreement: number, labels: string[] }}
 */
export function krippendorffAlphaNominal({ matrix, labels }) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new RangeError('krippendorff: matrix must be a non-empty array');
  }
  for (const row of matrix) {
    if (!Array.isArray(row)) throw new TypeError('krippendorff: each row must be an array');
  }

  const labelSet = new Set();
  if (Array.isArray(labels)) {
    for (const l of labels) labelSet.add(l);
  } else {
    for (const row of matrix) {
      for (const v of row) {
        if (v != null) labelSet.add(v);
      }
    }
  }
  const labelArr = [...labelSet];
  const labelIdx = new Map(labelArr.map((l, i) => [l, i]));
  const k = labelArr.length;

  if (k < 1) {
    return { alpha: 1, n: 0, observedDisagreement: 0, expectedDisagreement: 0, labels: [] };
  }

  // Build the coincidence matrix o_ck per Krippendorff §3.2.
  //   For each unit, for each pair (i, j) of valid annotations within the
  //   unit, increment o[ai][aj] by 1 / (m_u - 1) where m_u is the number of
  //   valid annotations for that unit. Diagonal counts contribute too.
  const O = Array.from({ length: k }, () => new Array(k).fill(0));
  let pairableUnits = 0;
  let totalValidAnnotations = 0;
  for (const row of matrix) {
    const valid = [];
    for (const v of row) {
      if (v != null && labelIdx.has(v)) valid.push(labelIdx.get(v));
    }
    const m = valid.length;
    if (m < 2) continue;
    pairableUnits += 1;
    totalValidAnnotations += m;
    const w = 1 / (m - 1);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        if (i === j) continue;
        O[valid[i]][valid[j]] += w;
      }
    }
  }
  if (pairableUnits === 0) {
    return { alpha: NaN, n: 0, observedDisagreement: 0, expectedDisagreement: 0, labels: labelArr };
  }

  // Marginal totals n_c = sum over rows of O.
  const nC = new Array(k).fill(0);
  let nTotal = 0;
  for (let c = 0; c < k; c++) {
    for (let kk = 0; kk < k; kk++) nC[c] += O[c][kk];
    nTotal += nC[c];
  }
  if (nTotal === 0) return { alpha: NaN, n: 0, observedDisagreement: 0, expectedDisagreement: 0, labels: labelArr };

  // Nominal disagreement metric δ²(c, k') = 1 if c != k', else 0.
  //   D_o = sum_{c != k'} O[c][k'] / nTotal
  //   D_e = sum_{c != k'} (n_c · n_k') / (nTotal · (nTotal - 1))
  let Do = 0, De = 0;
  for (let c = 0; c < k; c++) {
    for (let kk = 0; kk < k; kk++) {
      if (c === kk) continue;
      Do += O[c][kk];
      De += nC[c] * nC[kk];
    }
  }
  Do /= nTotal;
  De /= nTotal * (nTotal - 1);

  const alpha = De === 0 ? 1 : 1 - Do / De;
  return {
    alpha,
    n: pairableUnits,
    observedDisagreement: Do,
    expectedDisagreement: De,
    labels: labelArr,
  };
}

/**
 * Validate IAA against the §7.5 / §11.6.4 thresholds.
 *
 * @param {object} args
 * @param {Array<Array<string|null>>} args.matrix — judge × probe matrix
 * @param {number} [args.alphaIndividual=0.6]
 * @param {number} [args.alphaMajority=0.7]
 * @returns {{ alpha: number, passes: boolean, threshold: number, n: number }}
 */
export function validateIaa({ matrix, alphaIndividual = 0.6, alphaMajority = 0.7, threshold = null }) {
  const r = krippendorffAlphaNominal({ matrix });
  const t = typeof threshold === 'number' ? threshold : alphaIndividual;
  return {
    alpha: r.alpha,
    n: r.n,
    threshold: t,
    alphaIndividual,
    alphaMajority,
    passes: Number.isFinite(r.alpha) && r.alpha >= t,
    observedDisagreement: r.observedDisagreement,
    expectedDisagreement: r.expectedDisagreement,
  };
}
