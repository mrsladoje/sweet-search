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
 * Agent formats (ss-search): the seed pool is max(k, 15), and the final list keeps the result the
 * k-seed pool would have put first (pinNarrowTop1, search-postprocess.js). With k=5 the late-
 * interaction reranker saw only the 5 seeds (plus graph neighbours), so a gold chunk at fused rank
 * 10 never reached it: sequel `Model.[]` / primary_key_lookup (base.rb, fused rank 10) ranks first
 * once the reranker sees it. Measured on r3 DEV (n=137 positives: r3 devSplit train+validation and
 * r3-hard ids.dev, seed-42 splits; ss-search's call, k=5): recall@5 0.311 -> 0.328, MRR@5 0.421 ->
 * 0.439, hit@5 0.591 -> 0.635, top-1 0.321 = 0.321 (+15 / -8 questions on recall). A wider pool
 * WITHOUT the top-1 pin lost 3 top-1s (0.321 -> 0.299), as the retrieval-probes test of max(k, 10)
 * did. Non-agent formats (GCSN, the library API) keep DEFAULT_SEED_POOL_MIN.
 */
export const AGENT_SEED_POOL_MIN = 15;

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
export function seedPoolSize(k, { agentFormat = false } = {}) {
  const cap = normalizeFinalK(k) ?? 10;
  const fallback = agentFormat ? AGENT_SEED_POOL_MIN : DEFAULT_SEED_POOL_MIN;
  const raw = process.env.SWEET_SEARCH_SEED_POOL_MIN;
  const parsed = raw == null || raw === '' ? fallback : Number.parseInt(raw, 10);
  const min = Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  return Math.max(cap, min);
}

/**
 * The first result of `results` that was one of the first `k` seeds moves to the front: the
 * wider seed pool may fill ranks 2..k, but rank 1 stays what the k-seed pool ranked first
 * (AGENT_SEED_POOL_MIN). Seeds carry `seedRank` (sweet-search.js). Returns the same array when
 * nothing moves.
 * @param {Array} results
 * @param {number} k
 */
export function pinNarrowTop1(results, k) {
  const cap = normalizeFinalK(k);
  if (cap == null || !Array.isArray(results) || results.length < 2) return results;
  // Only when the pool was wider than k: with k seeds the order is already the k-seed order.
  if (!results.some(r => Number.isInteger(r?.seedRank) && r.seedRank >= cap)) return results;
  const i = results.findIndex(r => Number.isInteger(r?.seedRank) && r.seedRank < cap);
  if (i <= 0) return results;
  return [results[i], ...results.slice(0, i), ...results.slice(i + 1)];
}
