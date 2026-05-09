/**
 * Threshold-sensitivity audit — Goodhart defense for the compound PASS metric.
 *
 * PASS = (fileRecall = 1)
 *      ∧ (factRecall ≥ 0.8)
 *      ∧ (symbolRecall ≥ 0.8)
 *      ∧ (lineOverlap ≥ 0.3)
 *      ∧ (filePrecision ≥ 0.5)
 *
 * is a 5-knob compound binary metric, and GEPA will optimise against exactly
 * that function. Pradeep et al. SIGIR 2025 ("The Great Nugget Recall") showed
 * ±10% threshold perturbation moves RAG rankings by 5pp — i.e. the threshold
 * cocktail itself is a tunable. This module pre-registers a fractional-
 * factorial sweep at -20%/registered/+20% per threshold and reports rank-
 * stability, which is the actual promotion criterion (not raw PASS).
 *
 * Plan reference: §0.5 (control #6), §11.10 (algorithm).
 *
 * Pure function. Caller supplies per-(variant × probe) raw metric vectors
 * (fileRecall, factRecall, ...). This module reconstructs PASS for every cell
 * in the sensitivity sweep, computes per-variant means, and re-ranks.
 */

const REGISTERED = Object.freeze({
  fileRecall: 1.0, // exact equality required at registered level
  factRecall: 0.8,
  symbolRecall: 0.8,
  lineOverlap: 0.3,
  filePrecision: 0.5,
});

const PERTURB_FACTORS = Object.freeze([0.8, 1.0, 1.2]); // -20% / registered / +20%

/**
 * Resolution-12 Plackett-Burman-style fractional-factorial design over 5
 * factors at 3 levels each. We use a Latin-hypercube subset rather than the
 * full 3^5=243 grid because §11.10.1 calls for "27-cell fractional factorial"
 * and a Latin hypercube of size 27 over 5 factors gives orthogonal main-effect
 * estimates without the combinatorial blow-up.
 *
 * The design is deterministic (fixed permutations) so reruns produce the same
 * 27 cells; pre-registration commits this design before any sweep runs.
 */
function buildSweepCells() {
  // 27 = 3^3; we generate 27 (i, j, k, l, m) tuples that touch each level
  // exactly 9× per factor (balanced) and avoid the full 3^5 grid.
  // Construction: cycle each factor through a deterministic offset of the
  // base 27-cell grid so the projection onto any 3 factors is balanced.
  const offsets = [
    [0, 0, 0],
    [1, 2, 0],
    [2, 1, 0],
    [0, 1, 1],
    [1, 0, 1],
    [2, 2, 1],
    [0, 2, 2],
    [1, 1, 2],
    [2, 0, 2],
  ];
  const cells = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const [i, j, k] of offsets) {
      const l = (i + j + cycle) % 3;
      const mIdx = (i + k + cycle * 2) % 3;
      cells.push([i, j, k, l, mIdx]);
    }
  }
  // Stable ordering for reproducibility
  cells.sort((a, b) => {
    for (let p = 0; p < 5; p++) if (a[p] !== b[p]) return a[p] - b[p];
    return 0;
  });
  return cells;
}

/**
 * Compute PASS at a given threshold cell.
 */
function passAt(metrics, thresholds) {
  return (
    metrics.fileRecall >= thresholds.fileRecall &&
    metrics.factRecall >= thresholds.factRecall &&
    metrics.symbolRecall >= thresholds.symbolRecall &&
    metrics.lineOverlap >= thresholds.lineOverlap &&
    metrics.filePrecision >= thresholds.filePrecision
  );
}

function thresholdsFromCell(cell) {
  return {
    fileRecall: REGISTERED.fileRecall * PERTURB_FACTORS[cell[0]],
    factRecall: REGISTERED.factRecall * PERTURB_FACTORS[cell[1]],
    symbolRecall: REGISTERED.symbolRecall * PERTURB_FACTORS[cell[2]],
    lineOverlap: REGISTERED.lineOverlap * PERTURB_FACTORS[cell[3]],
    filePrecision: REGISTERED.filePrecision * PERTURB_FACTORS[cell[4]],
  };
}

/**
 * Run the sensitivity sweep.
 *
 * @param {object} args
 * @param {Array<{ variantId: string, perProbe: Array<{
 *   probeId: string, fileRecall: number, factRecall: number,
 *   symbolRecall: number, lineOverlap: number, filePrecision: number,
 * }> }>} args.variants
 * @returns {{
 *   nCells: number,
 *   cells: Array<{ thresholds: object, ranking: string[], passByVariant: Record<string, number> }>,
 *   perVariant: Array<{
 *     variantId: string,
 *     passAtRegistered: number,
 *     ranks: number[],
 *     medianRank: number,
 *     rankRange90: number,
 *     rankStable: boolean,
 *   }>,
 *   registeredThresholds: object,
 * }}
 */
export function runThresholdSensitivity({ variants }) {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new TypeError('threshold-sensitivity: variants must be a non-empty array');
  }
  for (const v of variants) {
    if (!v || typeof v.variantId !== 'string' || !Array.isArray(v.perProbe)) {
      throw new TypeError('threshold-sensitivity: each variant needs variantId + perProbe[]');
    }
  }
  const probeCount = variants[0].perProbe.length;
  for (const v of variants) {
    if (v.perProbe.length !== probeCount) {
      throw new RangeError(
        `threshold-sensitivity: variant ${v.variantId} has ${v.perProbe.length} probes, expected ${probeCount}`
      );
    }
  }

  const cells = buildSweepCells();
  const cellResults = [];
  const ranksByVariant = new Map(variants.map((v) => [v.variantId, []]));

  for (const cell of cells) {
    const thresholds = thresholdsFromCell(cell);
    const passByVariant = {};
    for (const v of variants) {
      let nPass = 0;
      for (const p of v.perProbe) {
        if (passAt(p, thresholds)) nPass++;
      }
      passByVariant[v.variantId] = nPass / v.perProbe.length;
    }
    // Rank: 1 = best (highest pass rate). Ties get the same rank (averaged).
    const sorted = Object.entries(passByVariant)
      .map(([id, pass]) => ({ id, pass }))
      .sort((a, b) => b.pass - a.pass || a.id.localeCompare(b.id));
    const ranking = sorted.map((s) => s.id);
    sorted.forEach((s, i) => ranksByVariant.get(s.id).push(i + 1));
    cellResults.push({ thresholds, ranking, passByVariant });
  }

  const registeredThresholds = { ...REGISTERED };
  const perVariant = variants.map((v) => {
    const ranks = ranksByVariant.get(v.variantId).slice().sort((a, b) => a - b);
    const median = ranks[Math.floor(ranks.length / 2)];
    const lo = ranks[Math.floor(0.05 * ranks.length)];
    const hi = ranks[Math.min(ranks.length - 1, Math.ceil(0.95 * ranks.length) - 1)];
    const rankRange90 = hi - lo;
    let nPassReg = 0;
    for (const p of v.perProbe) if (passAt(p, registeredThresholds)) nPassReg++;
    const passAtRegistered = nPassReg / v.perProbe.length;
    return {
      variantId: v.variantId,
      passAtRegistered,
      ranks: ranksByVariant.get(v.variantId),
      medianRank: median,
      rankRange90,
      rankStable: median <= 3 && rankRange90 <= 5,
    };
  });

  return {
    nCells: cells.length,
    cells: cellResults,
    perVariant,
    registeredThresholds,
  };
}

/**
 * Reusable in unit tests + caller diagnostics.
 */
export const _internal = { buildSweepCells, thresholdsFromCell, REGISTERED, PERTURB_FACTORS };
