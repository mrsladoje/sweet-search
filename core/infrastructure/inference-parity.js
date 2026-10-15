/**
 * Output checks for native inference backends.
 *
 * Used by the backend parity gates (scripts/parity-cuda.js) and meant for
 * the per-batch output checks before vectors are stored. Every check
 * returns `{ ok, reasons }`; each reason starts with a stable code
 * (`count_mismatch`, `token_count_mismatch`, `dim_mismatch`, `empty`,
 * `non_finite`, `bad_norm`, `min_cosine`, `mean_cosine`, `maxsim_diff`,
 * `maxsim_order`, `backend_mismatch`) followed by the detail.
 *
 * Why structure first: the previous CUDA gate compared only
 * `Math.min(candidate.length, reference.length)` tokens, so a backend
 * that dropped trailing tokens passed. Why min AND mean: one token at
 * cosine 0.90 among 63 perfect ones has mean 0.9984 and passed a
 * mean-only 0.998 gate.
 *
 * Mirrors the Rust rules in crates/sweet-search-native/src/inference/parity.rs.
 */

/** Largest allowed |norm - 1| for an L2-normalised output vector. */
export const UNIT_NORM_TOLERANCE = 1e-2;

function result(reasons, extra = {}) {
  return { ok: reasons.length === 0, reasons, ...extra };
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Check one list of unit vectors. Appends reasons; returns nothing.
 * @param {ArrayLike<number>[]} vectors
 * @param {number} dim
 * @param {string} label
 * @param {string[]} reasons
 */
function checkUnitVectors(vectors, dim, label, reasons) {
  if (!vectors || vectors.length === 0) {
    reasons.push(`empty: ${label} has no vectors`);
    return;
  }
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (!v || v.length !== dim) {
      reasons.push(`dim_mismatch: ${label}[${i}] has ${v?.length ?? 0} values, expected ${dim}`);
      return;
    }
    let sq = 0;
    for (let k = 0; k < dim; k++) {
      if (!Number.isFinite(v[k])) {
        reasons.push(`non_finite: ${label}[${i}][${k}] = ${v[k]}`);
        return;
      }
      sq += v[k] * v[k];
    }
    const norm = Math.sqrt(sq);
    if (Math.abs(norm - 1) > UNIT_NORM_TOLERANCE) {
      reasons.push(`bad_norm: ${label}[${i}] has norm ${norm.toFixed(6)}, expected 1`);
      return;
    }
  }
}

/**
 * Structural check of an embedding batch: `count` vectors of width `dim`,
 * finite, unit norm.
 */
export function checkEmbeddingBatch(vectors, { count, dim, label = 'embeddings' }) {
  const reasons = [];
  if ((vectors?.length ?? 0) !== count) {
    reasons.push(`count_mismatch: ${label} has ${vectors?.length ?? 0} vectors, expected ${count}`);
    return result(reasons);
  }
  checkUnitVectors(vectors, dim, label, reasons);
  return result(reasons);
}

/**
 * Structural check of a late-interaction batch: `count` documents, each a
 * non-empty list of `dim`-wide unit token vectors. When `tokenCounts` is
 * given, document i must have exactly tokenCounts[i] tokens.
 */
export function checkLateInteractionBatch(docs, { count, dim, tokenCounts, label = 'documents' }) {
  const reasons = [];
  if ((docs?.length ?? 0) !== count) {
    reasons.push(`count_mismatch: ${label} has ${docs?.length ?? 0} documents, expected ${count}`);
    return result(reasons);
  }
  for (let d = 0; d < docs.length; d++) {
    if (tokenCounts && docs[d]?.length !== tokenCounts[d]) {
      reasons.push(`token_count_mismatch: ${label}[${d}] has ${docs[d]?.length ?? 0} tokens, expected ${tokenCounts[d]}`);
      continue;
    }
    checkUnitVectors(docs[d], dim, `${label}[${d}]`, reasons);
  }
  return result(reasons);
}

function cosineStats(cosines) {
  let min = Infinity;
  let sum = 0;
  for (const c of cosines) {
    if (c < min) min = c;
    sum += c;
  }
  return { n: cosines.length, min, mean: sum / cosines.length };
}

/**
 * Compare candidate embeddings against a reference. Both sides must pass
 * the structural check with the same count and dimension before any
 * cosine is computed.
 */
export function compareEmbeddings(candidate, reference, { minCosine, meanCosine }) {
  const dim = reference?.[0]?.length ?? 0;
  const count = reference?.length ?? 0;
  const reasons = [
    ...checkEmbeddingBatch(reference, { count, dim, label: 'reference' }).reasons,
    ...checkEmbeddingBatch(candidate, { count, dim, label: 'candidate' }).reasons,
  ];
  if (reasons.length) return result(reasons);
  const cosines = candidate.map((v, i) => dot(v, reference[i]));
  const stats = cosineStats(cosines);
  if (stats.min < minCosine) reasons.push(`min_cosine: ${stats.min.toFixed(6)} < ${minCosine}`);
  if (stats.mean < meanCosine) reasons.push(`mean_cosine: ${stats.mean.toFixed(6)} < ${meanCosine}`);
  return result(reasons, { stats, cosines });
}

/** ColBERT MaxSim: sum over query tokens of the best dot product with any doc token. */
export function maxSimScore(queryTokens, docTokens) {
  let total = 0;
  for (const q of queryTokens) {
    let best = -Infinity;
    for (const d of docTokens) {
      const s = dot(q, d);
      if (s > best) best = s;
    }
    total += best;
  }
  return total;
}

/**
 * Compare candidate late-interaction output against a reference.
 *
 * Checks, in order: equal document counts, equal per-document token
 * counts, equal dimension, finite values and unit norms (both sides);
 * then per-token cosine min and mean; then MaxSim scores with every
 * document (or each index in `queryIndices`) used as a query against
 * every document. Scores must agree
 * within `maxSimRelTol` (relative), and no reference ordering whose gap
 * exceeds that tolerance may flip.
 */
export function compareLateInteraction(candidate, reference, {
  minTokenCosine,
  meanTokenCosine,
  maxSimRelTol,
  queryIndices,
}) {
  const count = reference?.length ?? 0;
  const dim = reference?.[0]?.[0]?.length ?? 0;
  const tokenCounts = (reference ?? []).map((d) => d?.length ?? 0);
  const reasons = [
    ...checkLateInteractionBatch(reference, { count, dim, label: 'reference' }).reasons,
    ...checkLateInteractionBatch(candidate, { count, dim, tokenCounts, label: 'candidate' }).reasons,
  ];
  if (reasons.length) return result(reasons);

  const cosines = [];
  for (let d = 0; d < count; d++) {
    for (let t = 0; t < tokenCounts[d]; t++) cosines.push(dot(candidate[d][t], reference[d][t]));
  }
  const tokenStats = cosineStats(cosines);
  if (tokenStats.min < minTokenCosine) reasons.push(`min_cosine: token ${tokenStats.min.toFixed(6)} < ${minTokenCosine}`);
  if (tokenStats.mean < meanTokenCosine) reasons.push(`mean_cosine: token ${tokenStats.mean.toFixed(6)} < ${meanTokenCosine}`);

  let maxRelDiff = 0;
  let flips = 0;
  for (const q of queryIndices ?? reference.keys()) {
    const ref = reference.map((doc) => maxSimScore(reference[q], doc));
    const cand = candidate.map((doc) => maxSimScore(candidate[q], doc));
    for (let d = 0; d < count; d++) {
      const rel = Math.abs(cand[d] - ref[d]) / Math.max(Math.abs(ref[d]), 1e-9);
      if (rel > maxRelDiff) maxRelDiff = rel;
    }
    for (let a = 0; a < count; a++) {
      for (let b = 0; b < count; b++) {
        const gap = ref[a] - ref[b];
        if (gap > maxSimRelTol * Math.abs(ref[a]) && cand[a] <= cand[b]) flips++;
      }
    }
  }
  if (maxRelDiff > maxSimRelTol) reasons.push(`maxsim_diff: max relative difference ${maxRelDiff.toExponential(3)} > ${maxSimRelTol}`);
  if (flips > 0) reasons.push(`maxsim_order: ${flips} document order(s) flipped against the reference`);
  return result(reasons, { tokenStats, maxSim: { maxRelDiff, flips } });
}

/**
 * Confirm the loaded native model reports the requested device. The addon
 * exposes `model.backend` as `<device>/<dtype>`, prefixed `coreml+` when
 * the CoreML cascade is armed.
 */
export function checkBackend(model, deviceKind) {
  const backend = model?.backend;
  if (typeof backend !== 'string') {
    return result([`backend_mismatch: model reports no backend (addon older than the backend getter)`]);
  }
  const device = backend.replace(/^coreml\+/, '').split('/')[0];
  if (device !== deviceKind) {
    return result([`backend_mismatch: requested ${deviceKind}, model runs on ${backend}`], { backend });
  }
  return result([], { backend });
}
