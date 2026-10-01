/**
 * Final-k contract for every search surface.
 *
 * `k` / `topK` means "the caller gets at most k FINAL results". Internal stages
 * (hybrid fusion, graph expansion, MaxSim, cross-encoder) may work on a larger
 * candidate pool, but the list that leaves search() — and the list the agent
 * packager uses to pick a token-budget tier — is cut back to k.
 *
 * Without this cut, graph expansion appended up to 10 neighbours after the
 * hybrid stage had already sliced to k, so `ss-search -k 6` returned 16 results
 * and the auto budget picker (`numResults >= 10` rule) counted the inflated
 * list.
 */

/**
 * Smallest candidate pool the seed stage (hybrid retrieval) collects before
 * graph expansion + rerank + the final cut. The seed pool is
 * max(k, SEED_POOL_MIN); the final list is always <= k.
 *
 * Default 0: the seed stage cuts at k. Measured on retrieval-probes DEV
 * (n=40, k=5, seed=42 split): a pool of max(k, 10) lost one top-1 PASS and
 * 0.022 probe MRR against a pool of k, with no gain in hits. Set
 * SWEET_SEARCH_SEED_POOL_MIN=10 to experiment with a wider pool.
 */
export const DEFAULT_SEED_POOL_MIN = 0;

/**
 * @param {unknown} k
 * @returns {number|null} positive integer k, or null when k is not a usable cap
 */
export function normalizeFinalK(k) {
  const n = typeof k === 'string' ? Number.parseInt(k, 10) : k;
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

/**
 * Cut `results` to the final k. Returns the same array when no cut is needed
 * (so identity checks in callers keep working).
 * @param {Array} results
 * @param {unknown} k
 */
export function capToFinalK(results, k) {
  const cap = normalizeFinalK(k);
  if (cap == null || !Array.isArray(results) || results.length <= cap) return results;
  return results.slice(0, cap);
}

/**
 * Candidate-pool size for the seed stage.
 * @param {unknown} k final result count requested by the caller
 * @returns {number}
 */
export function seedPoolSize(k) {
  const cap = normalizeFinalK(k) ?? 10;
  const raw = process.env.SWEET_SEARCH_SEED_POOL_MIN;
  const parsed = raw == null || raw === '' ? DEFAULT_SEED_POOL_MIN : Number.parseInt(raw, 10);
  const min = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SEED_POOL_MIN;
  return Math.max(cap, min);
}
