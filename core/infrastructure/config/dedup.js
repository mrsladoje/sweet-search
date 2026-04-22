/**
 * Dedup config — near-duplicate chunk detection via SimHash + MinHash-LSH.
 *
 * Parameters match BigCode MinHash-LSH canonical: 5-gram word shingles,
 * 128 permutations, 16 bands × 8 rows ⇒ threshold ≈ (1/16)^(1/8) ≈ 0.707.
 * SimHash Hamming ≤ 3 is a secondary filter against LSH false positives.
 */

function envBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

function envInt(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function envFloat(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

export const DEDUP_CONFIG = {
  enabled: envBool('SWEET_SEARCH_DEDUP_ENABLED', true),
  ngramSize: envInt('SWEET_SEARCH_DEDUP_NGRAM', 5),
  numPerm: envInt('SWEET_SEARCH_DEDUP_NUM_PERM', 128),
  numBands: envInt('SWEET_SEARCH_DEDUP_BANDS', 16),
  // Primary clustering threshold (bi-encoder reuse). BigCode canonical is 0.7,
  // but we run stricter to protect retrieval quality against the sibling
  // promotion path — at 0.9 only clearly-near-duplicate chunks cluster.
  jaccardThreshold: envFloat('SWEET_SEARCH_DEDUP_JACCARD', 0.9),
  simhashHammingMax: envInt('SWEET_SEARCH_DEDUP_SIMHASH_H', 3),
  seed: envInt('SWEET_SEARCH_DEDUP_SEED', 42),
  // LI reuse requires a stricter Jaccard bar than the bi-encoder because
  // MaxSim is per-token — an alias borrowing the exemplar's token matrix
  // at Jaccard 0.7 is scoring a query against only 70% of its real tokens.
  // Only reuse LI vectors when chunks are near-exact duplicates (≥0.95).
  liReuseEnabled: envBool('SWEET_SEARCH_DEDUP_LI_REUSE', true),
  liReuseJaccardThreshold: envFloat('SWEET_SEARCH_DEDUP_LI_JACCARD', 0.95),
};

export function describeDedupConfig(config = DEDUP_CONFIG) {
  if (!config.enabled) return 'disabled';
  const liNote = config.liReuseEnabled
    ? ` + LI reuse (τ≥${config.liReuseJaccardThreshold})`
    : '';
  return `MinHash-LSH (k=${config.numPerm}, ${config.numBands} bands, τ=${config.jaccardThreshold}) + SimHash (Hamming ≤ ${config.simhashHammingMax})${liNote}`;
}
