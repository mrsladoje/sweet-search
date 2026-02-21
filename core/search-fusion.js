/**
 * Search Fusion Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains all score fusion logic: CC, RRF, quantile normalization, variance.
 *
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 */

// =============================================================================
// ROUTE_ALPHAS (shared constant for CC fusion)
// =============================================================================

export const ROUTE_ALPHAS = {
  'identifier': 0.85,    // Heavy lexical (BM25)
  'lexical': 0.85,       // Alias
  'conceptual': 0.25,    // Heavy semantic
  'semantic': 0.25,      // Alias
  'structural': 0.90,    // Lexical + graph
  'mixed': 0.55,         // Balanced
  'hybrid': 0.55,        // Alias
};

// =============================================================================
// Pure helpers (no `this`)
// =============================================================================

/**
 * Get unique key for a result.
 * Pure function — no `this`. On prototype because callers use this.getResultKey().
 */
export function getResultKey(result) {
  // P0 FIX: Add null-safety for all fields to prevent undefined keys
  if (result.id) return String(result.id);
  if (result.file && result.startLine != null) return `${result.file}:${result.startLine}`;
  if (result.name) return String(result.name);
  // Fallback: hash first 100 chars of JSON representation
  return JSON.stringify(result || {}).slice(0, 100);
}

/**
 * Min-max normalization for score fusion.
 * Scales scores to [0, 1] range. Pure function — no `this`.
 */
export function minMaxNormalize(scores) {
  if (!scores || scores.length === 0) return [];
  if (scores.length === 1) return [1.0];

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;

  if (range === 0) return scores.map(() => 1.0);
  return scores.map(s => (s - min) / range);
}

/**
 * Quantile-based normalization (PHASE_1_FIXES Change 2)
 * Robust to outliers from pre-fusion boosts
 *
 * @param {number[]} scores - Raw scores to normalize
 * @param {number} lowQuantile - Lower percentile cutoff (default 0.05)
 * @param {number} highQuantile - Upper percentile cutoff (default 0.95)
 * @returns {number[]} Normalized scores in [0, 1]
 */
export function quantileNormalize(scores, lowQuantile = 0.05, highQuantile = 0.95) {
  if (scores.length === 0) return [];
  if (scores.length === 1) return [0.5]; // Single item = middle

  const sorted = [...scores].sort((a, b) => a - b);
  const lowIdx = Math.floor(sorted.length * lowQuantile);
  const highIdx = Math.ceil(sorted.length * highQuantile) - 1;

  const pLow = sorted[Math.max(0, lowIdx)];
  const pHigh = sorted[Math.min(sorted.length - 1, highIdx)];
  const range = pHigh - pLow;

  if (range < 1e-9) {
    // Degenerate case: all scores nearly identical
    return scores.map(() => 0.5);
  }

  return scores.map(s => {
    const normalized = (s - pLow) / range;
    return Math.max(0, Math.min(1, normalized)); // Clamp to [0, 1]
  });
}

/**
 * Convex Combination (CC) fusion
 *
 * CC Formula: score = alpha * lexical_norm + (1-alpha) * semantic_norm
 * Where alpha is route-specific (identifier queries favor lexical, conceptual favor semantic)
 *
 * Uses `this` — calls this.getResultKey.
 */
export function convexCombination(lexicalResults, semanticResults, routeType = 'mixed', options = {}) {
  const alpha = options.alpha ?? ROUTE_ALPHAS[routeType] ?? 0.5;

  // Build score maps
  const lexicalScoreMap = new Map();
  const semanticScoreMap = new Map();
  const allKeys = new Set();

  for (const r of lexicalResults) {
    const key = this.getResultKey(r);
    lexicalScoreMap.set(key, r.score);
    allKeys.add(key);
  }

  for (const r of semanticResults) {
    const key = this.getResultKey(r);
    semanticScoreMap.set(key, r.score);
    allKeys.add(key);
  }

  // Get all scores for normalization
  const lexScores = Array.from(lexicalScoreMap.values());
  const semScores = Array.from(semanticScoreMap.values());

  // Min-max normalize
  const lexMin = lexScores.length > 0 ? Math.min(...lexScores) : 0;
  const lexMax = lexScores.length > 0 ? Math.max(...lexScores) : 1;
  const lexRange = lexMax - lexMin || 1;

  const semMin = semScores.length > 0 ? Math.min(...semScores) : 0;
  const semMax = semScores.length > 0 ? Math.max(...semScores) : 1;
  const semRange = semMax - semMin || 1;

  // Compute CC scores
  const ccResults = [];
  const lexResultMap = new Map(lexicalResults.map(r => [this.getResultKey(r), r]));
  const semResultMap = new Map(semanticResults.map(r => [this.getResultKey(r), r]));

  for (const key of allKeys) {
    const lexScore = lexicalScoreMap.get(key);
    const semScore = semanticScoreMap.get(key);

    // Normalize scores (missing results get 0)
    const normLex = lexScore !== undefined ? (lexScore - lexMin) / lexRange : 0;
    const normSem = semScore !== undefined ? (semScore - semMin) / semRange : 0;

    // Convex combination
    const ccScore = alpha * normLex + (1 - alpha) * normSem;

    // Merge result data
    const lexResult = lexResultMap.get(key) || {};
    const semResult = semResultMap.get(key) || {};
    const sources = [];
    if (lexScore !== undefined) sources.push('lexical');
    if (semScore !== undefined) sources.push('semantic');

    ccResults.push({
      ...semResult,
      ...lexResult, // lexical overwrites semantic if both exist
      ccScore,
      rrfScore: ccScore, // Backwards compatibility
      lexicalScore: lexScore,
      semanticScore: semScore,
      normLexical: normLex,
      normSemantic: normSem,
      alpha,
      sources,
    });
  }

  // Sort by CC score descending
  return ccResults.sort((a, b) => b.ccScore - a.ccScore);
}

/**
 * Detect when CC fusion would be unreliable (PHASE_1_FIXES Change 2)
 *
 * Uses `this` — calls this.variance.
 */
export function shouldFallbackToRRF(lexicalResults, semanticResults) {
  // Case 1: Too few results on one side
  if (lexicalResults.length < 3 || semanticResults.length < 3) {
    return { fallback: true, reason: 'insufficient_results' };
  }

  // Case 2: Near-zero variance (degenerate range)
  // P0 FIX: Filter out undefined/NaN scores to prevent variance errors
  const lexScores = lexicalResults.map(r => r.score ?? 0).filter(s => !isNaN(s));
  const semScores = semanticResults.map(r => r.score ?? 0).filter(s => !isNaN(s));

  if (lexScores.length === 0 || semScores.length === 0) {
    return { fallback: true, reason: 'no_valid_scores' };
  }

  const lexVariance = this.variance(lexScores);
  const semVariance = this.variance(semScores);

  if (lexVariance < 1e-6 || semVariance < 1e-6) {
    return { fallback: true, reason: 'zero_variance' };
  }

  // Case 3: Extreme outlier compression
  const lexSorted = [...lexScores].sort((a, b) => b - a);  // Descending: highest first
  const lexMax = lexSorted[0];
  const lexMedian = lexSorted[Math.floor(lexSorted.length * 0.5)];
  const lexTop5PctThreshold = lexSorted[Math.floor(lexSorted.length * 0.05)];

  if (lexMax > 0 && (lexTop5PctThreshold / lexMax) > 0.95 && (lexMedian / lexMax) < 0.3) {
    return { fallback: true, reason: 'outlier_compression' };
  }

  return { fallback: false, reason: null };
}

/**
 * RRF fusion (rank-based fallback) (PHASE_1_FIXES Change 2)
 *
 * Uses `this` — calls this.getResultKey.
 */
export function rrfFusion(lexicalResults, semanticResults, k = 60) {
  const scores = new Map();
  const results = new Map();

  // Lexical contribution by rank
  lexicalResults.forEach((result, rank) => {
    const id = this.getResultKey(result);
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
    if (!results.has(id)) results.set(id, { ...result, sources: ['lexical'] });
    else results.get(id).sources.push('lexical');
  });

  // Semantic contribution by rank
  semanticResults.forEach((result, rank) => {
    const id = this.getResultKey(result);
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
    if (!results.has(id)) results.set(id, { ...result, sources: ['semantic'] });
    else results.get(id).sources.push('semantic');
  });

  return [...results.values()]
    .map(r => ({ ...r, score: scores.get(this.getResultKey(r)), ccScore: scores.get(this.getResultKey(r)) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Robust CC fusion with RRF fallback (PHASE_1_FIXES Change 2)
 *
 * Uses `this` — calls this.shouldFallbackToRRF, this.log, this.rrfFusion,
 *   this.quantileNormalize, this.getResultKey.
 */
export function robustCCFusion(lexicalResults, semanticResults, routeType = 'mixed', options = {}) {
  // Check if we should fallback to RRF
  const { fallback, reason } = this.shouldFallbackToRRF(lexicalResults, semanticResults);

  if (fallback) {
    this.log(`[Fusion] Fallback to RRF: ${reason}`);
    return {
      results: this.rrfFusion(lexicalResults, semanticResults),
      method: 'rrf',
      fallbackReason: reason,
    };
  }

  const alpha = options.alpha ?? ROUTE_ALPHAS[routeType] ?? 0.5;

  // Quantile normalization (robust to outliers)
  const lexScores = lexicalResults.map(r => r.score);
  const semScores = semanticResults.map(r => r.score);

  const lexNormalized = this.quantileNormalize(lexScores, 0.05, 0.95);
  const semNormalized = this.quantileNormalize(semScores, 0.05, 0.95);

  // Build combined score map
  const combinedScores = new Map();
  const results = new Map();

  lexicalResults.forEach((result, i) => {
    const id = this.getResultKey(result);
    combinedScores.set(id, alpha * lexNormalized[i]);
    results.set(id, { ...result, lexScore: lexNormalized[i], sources: ['lexical'] });
  });

  semanticResults.forEach((result, i) => {
    const id = this.getResultKey(result);
    const existing = combinedScores.get(id) || 0;
    combinedScores.set(id, existing + (1 - alpha) * semNormalized[i]);

    if (results.has(id)) {
      results.get(id).semScore = semNormalized[i];
      results.get(id).sources.push('semantic');
    } else {
      results.set(id, { ...result, semScore: semNormalized[i], sources: ['semantic'] });
    }
  });

  return {
    results: [...results.values()]
      .map(r => ({ ...r, score: combinedScores.get(this.getResultKey(r)), ccScore: combinedScores.get(this.getResultKey(r)), alpha }))
      .sort((a, b) => b.score - a.score),
    method: 'cc_robust',
    fallbackReason: null,
  };
}

/**
 * Compute variance of an array (PHASE_1_FIXES helper)
 */
export function variance(arr) {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
}
