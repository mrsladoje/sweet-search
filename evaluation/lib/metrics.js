/**
 * SEARCH 100x Evaluation Metrics
 *
 * Implements standard IR metrics:
 * - MRR@K (Mean Reciprocal Rank)
 * - NDCG@K (Normalized Discounted Cumulative Gain)
 * - MAP@K (Mean Average Precision)
 * - Recall@K
 * - Success Rate@K
 * - Route Accuracy
 * - Cache Hit Rate
 * - Latency Percentiles (P50/P75/P90/P95/P99)
 * - Bootstrap Confidence Intervals
 *
 * References:
 * - https://www.evidentlyai.com/ranking-metrics/mean-reciprocal-rank-mrr
 * - https://www.evidentlyai.com/ranking-metrics/ndcg-metric
 * - CoIR Benchmark (ACL 2025): https://github.com/CoIR-team/coir
 * - BEIR Benchmark: https://github.com/beir-cellar/beir
 */

import { calculateStats } from '../../benchmark-harness.js';

/**
 * Extract relevance grade from a result object
 * Handles both nested match.relevanceGrade and flat relevanceGrade structures
 *
 * @param {object} result - Result object with relevance grade
 * @returns {number} Relevance grade (0 if not found)
 */
function getRelevanceGrade(result) {
  return result?.match?.relevanceGrade || result?.relevanceGrade || 0;
}

/**
 * Mean Reciprocal Rank at K
 *
 * MRR = (1/|Q|) * SUM(1/rank_i) where rank_i is the position of the first relevant result
 *
 * @param {Array} evaluatedQueries - Array of { results: [{matched, relevanceGrade}], expected, minRelevant }
 * @param {number} k - Cutoff (default 10)
 * @returns {number} MRR score [0, 1]
 */
export function calculateMRR(evaluatedQueries, k = 10) {
  if (!evaluatedQueries || evaluatedQueries.length === 0) return 0;

  let totalRR = 0;
  let validQueries = 0;

  for (const q of evaluatedQueries) {
    const topK = (q.matchedResults || q.results || []).slice(0, k);

    // Find first relevant result (relevanceGrade > 0)
    const firstRelevantIdx = topK.findIndex(r => getRelevanceGrade(r) > 0);

    if (firstRelevantIdx >= 0) {
      // Reciprocal rank (1-indexed)
      totalRR += 1 / (firstRelevantIdx + 1);
      validQueries++;
    } else {
      // Query had expected results but none found - counts as 0 RR
      const hasExpected = q.expected?.exact?.length > 0 ||
                          q.expected?.anyOf?.length > 0 ||
                          q.expected?.contains?.length > 0;
      if (hasExpected) {
        validQueries++;
      }
    }
  }

  return validQueries > 0 ? totalRR / validQueries : 0;
}

/**
 * Normalized Discounted Cumulative Gain at K
 *
 * DCG@K = SUM(rel_i / log2(i + 1)) for i in 1..K
 * NDCG@K = DCG@K / IDCG@K (ideal DCG)
 *
 * Supports graded relevance: 3 = highly relevant, 2 = relevant, 1 = marginally relevant
 *
 * @param {Array} evaluatedQueries - Array of { matchedResults: [{relevanceGrade}], expected }
 * @param {number} k - Cutoff (default 10)
 * @returns {number} NDCG score [0, 1]
 */
export function calculateNDCG(evaluatedQueries, k = 10) {
  if (!evaluatedQueries || evaluatedQueries.length === 0) return 0;

  let totalNDCG = 0;
  let validQueries = 0;

  for (const q of evaluatedQueries) {
    const topK = (q.matchedResults || q.results || []).slice(0, k);

    // Get actual relevance grades from results
    const actualGrades = topK.map(r => getRelevanceGrade(r));

    // Calculate DCG from actual results
    const dcg = calculateDCG(actualGrades);

    // Calculate IDCG from ground truth labels only (BEIR standard)
    // IDCG represents the ideal ranking using ONLY expected/ground truth grades,
    // NOT from actual results. This ensures NDCG properly measures ranking quality.
    const expectedGrades = getExpectedGrades(q.expected);

    if (expectedGrades.length === 0) {
      // No ground truth defined - can't compute meaningful NDCG
      // Skip this query from the calculation entirely
      continue;
    }

    // Sort expected grades descending for ideal DCG
    const idealGrades = [...expectedGrades].sort((a, b) => b - a);
    const idcg = calculateDCG(idealGrades.slice(0, k));

    if (idcg > 0) {
      totalNDCG += dcg / idcg;
      validQueries++;
    }
  }

  return validQueries > 0 ? totalNDCG / validQueries : 0;
}

/**
 * Calculate Discounted Cumulative Gain
 * @param {number[]} grades - Relevance grades in ranked order
 * @returns {number} DCG value
 */
function calculateDCG(grades) {
  return grades.reduce((sum, grade, i) => {
    const discount = Math.log2(i + 2); // log2(rank + 1), rank is 1-indexed
    return sum + grade / discount;
  }, 0);
}

/**
 * Extract expected relevance grades from ground truth
 * @param {object} expected - Expected results object
 * @returns {number[]} Array of expected relevance grades
 */
function getExpectedGrades(expected) {
  if (!expected) return [];

  const grades = [];

  // Exact matches get their specified grade or default 3
  if (expected.exact) {
    for (const ex of expected.exact) {
      grades.push(ex.relevanceGrade || 3);
    }
  }

  // AnyOf matches get grade 2
  if (expected.anyOf) {
    for (const ao of expected.anyOf) {
      const minMatches = ao.minMatches || 1;
      for (let i = 0; i < minMatches; i++) {
        grades.push(2);
      }
    }
  }

  // Contains matches get grade 1
  if (expected.contains) {
    grades.push(...expected.contains.map(() => 1));
  }

  return grades;
}

/**
 * Recall at K
 *
 * Recall@K = |relevant in top K| / |total relevant|
 *
 * @param {Array} evaluatedQueries - Array of { matchedResults, expected }
 * @param {number} k - Cutoff (default 20)
 * @returns {number} Recall score [0, 1]
 */
export function calculateRecall(evaluatedQueries, k = 20) {
  if (!evaluatedQueries || evaluatedQueries.length === 0) return 0;

  let totalRecall = 0;
  let validQueries = 0;

  for (const q of evaluatedQueries) {
    const totalRelevant = countTotalRelevant(q.expected);
    if (totalRelevant === 0) continue;

    const topK = (q.matchedResults || q.results || []).slice(0, k);
    const relevantInTopK = topK.filter(r => getRelevanceGrade(r) > 0).length;

    totalRecall += relevantInTopK / totalRelevant;
    validQueries++;
  }

  return validQueries > 0 ? totalRecall / validQueries : 0;
}

/**
 * Count total relevant results expected
 * @param {object} expected - Expected results object
 * @returns {number} Total relevant count
 */
function countTotalRelevant(expected) {
  if (!expected) return 0;

  let count = 0;

  if (expected.exact) count += expected.exact.length;
  if (expected.anyOf) {
    for (const ao of expected.anyOf) {
      count += ao.minMatches || 1;
    }
  }
  if (expected.contains) count += expected.contains.length;

  return count;
}

/**
 * Success Rate at K
 *
 * Success@K = |queries with at least minRelevant in top K| / |total queries|
 *
 * @param {Array} evaluatedQueries - Array of { matchedResults, minRelevant }
 * @param {number} k - Cutoff (default 10)
 * @returns {number} Success rate [0, 1]
 */
export function calculateSuccessRate(evaluatedQueries, k = 10) {
  if (!evaluatedQueries || evaluatedQueries.length === 0) return 0;

  let successful = 0;

  for (const q of evaluatedQueries) {
    const topK = (q.matchedResults || q.results || []).slice(0, k);
    const relevantCount = topK.filter(r => getRelevanceGrade(r) > 0).length;

    const minRequired = q.minRelevant || 1;
    if (relevantCount >= minRequired) {
      successful++;
    }
  }

  return evaluatedQueries.length > 0 ? successful / evaluatedQueries.length : 0;
}

/**
 * Check if a query contains non-ASCII characters
 * @param {string} query - Query string
 * @returns {boolean} True if contains non-ASCII
 */
function hasNonAscii(query) {
  return /[^\x00-\x7F]/.test(query || '');
}

/**
 * Route Accuracy (Strict)
 *
 * Percentage of queries routed to the expected search mode
 *
 * @param {Array} evaluatedQueries - Array of { actualRoute, expectedRoute }
 * @returns {object} { accuracy, correct, total, misroutes: [{queryId, expected, actual}] }
 */
export function calculateRouteAccuracy(evaluatedQueries) {
  if (!evaluatedQueries || evaluatedQueries.length === 0) {
    return { accuracy: 0, correct: 0, total: 0, misroutes: [] };
  }

  const misroutes = [];
  let correct = 0;

  for (const q of evaluatedQueries) {
    if (q.actualRoute === q.expectedRoute) {
      correct++;
    } else if (q.expectedRoute) {
      misroutes.push({
        queryId: q.id || q.queryId,
        query: q.query,
        expected: q.expectedRoute,
        actual: q.actualRoute,
      });
    }
  }

  return {
    accuracy: evaluatedQueries.length > 0 ? correct / evaluatedQueries.length : 0,
    correct,
    total: evaluatedQueries.length,
    misroutes,
  };
}

/**
 * Utility Route Accuracy
 *
 * For non-ASCII queries, SEMANTIC and HYBRID are functionally equivalent
 * (both will find results through translation/embedding). This metric
 * measures practical routing correctness rather than exact label matching.
 *
 * Equivalence rules for non-ASCII queries:
 * - SEMANTIC ≈ HYBRID (both use embeddings, find relevant results)
 * - LEXICAL stays strict (only transliteration path)
 * - STRUCTURAL stays strict (requires exact patterns)
 *
 * @param {Array} evaluatedQueries - Array of { actualRoute, expectedRoute, query }
 * @returns {object} { accuracy, correct, total, equivalentMatches, strictMatches, misroutes }
 */
export function calculateUtilityRouteAccuracy(evaluatedQueries) {
  if (!evaluatedQueries || evaluatedQueries.length === 0) {
    return { accuracy: 0, correct: 0, total: 0, equivalentMatches: 0, strictMatches: 0, misroutes: [] };
  }

  const misroutes = [];
  let correct = 0;
  let equivalentMatches = 0;
  let strictMatches = 0;

  // Equivalent routes for non-ASCII queries
  const SEMANTIC_HYBRID_EQUIVALENT = new Set(['semantic', 'hybrid']);

  for (const q of evaluatedQueries) {
    const actual = q.actualRoute;
    const expected = q.expectedRoute;

    // Strict match
    if (actual === expected) {
      correct++;
      strictMatches++;
      continue;
    }

    // Check for utility equivalence on non-ASCII queries
    if (expected && hasNonAscii(q.query)) {
      // SEMANTIC ≈ HYBRID for non-ASCII (both use embeddings effectively)
      if (SEMANTIC_HYBRID_EQUIVALENT.has(actual) && SEMANTIC_HYBRID_EQUIVALENT.has(expected)) {
        correct++;
        equivalentMatches++;
        continue;
      }
    }

    // True misroute
    if (expected) {
      misroutes.push({
        queryId: q.id || q.queryId,
        query: q.query,
        expected,
        actual,
        hasNonAscii: hasNonAscii(q.query),
      });
    }
  }

  return {
    accuracy: evaluatedQueries.length > 0 ? correct / evaluatedQueries.length : 0,
    correct,
    total: evaluatedQueries.length,
    equivalentMatches,
    strictMatches,
    misroutes,
  };
}

/**
 * Cache Hit Rate
 *
 * Percentage of queries served from cache (vocabulary, LRU, or semantic cache)
 *
 * @param {Array} evaluatedQueries - Array of { stats: { embedding: { source } } }
 * @returns {object} { rate, breakdown: { vocabulary, lru, semantic, api } }
 */
export function calculateCacheHitRate(evaluatedQueries) {
  if (!evaluatedQueries || evaluatedQueries.length === 0) {
    return { rate: 0, breakdown: { vocabulary: 0, lru: 0, semantic: 0, api: 0 } };
  }

  const breakdown = { vocabulary: 0, lru: 0, semantic: 0, api: 0 };

  for (const q of evaluatedQueries) {
    const source = q.stats?.embedding?.source || 'api';
    breakdown[source] = (breakdown[source] || 0) + 1;
  }

  const cached = breakdown.vocabulary + breakdown.lru + breakdown.semantic;

  return {
    rate: evaluatedQueries.length > 0 ? cached / evaluatedQueries.length : 0,
    breakdown,
  };
}

/**
 * Mean Average Precision at K
 *
 * MAP@K = (1/|Q|) * SUM(AP_i)
 * where AP@K = SUM(P@k * rel_k) / min(K, |R|) for k in 1..K
 *
 * P@k is precision at cutoff k, rel_k is 1 if result at k is relevant, 0 otherwise
 * |R| is the total number of relevant documents for the query
 *
 * @param {Array} evaluatedQueries - Array of { matchedResults, expected }
 * @param {number} k - Cutoff (default 10)
 * @returns {number} MAP score [0, 1]
 */
export function calculateMAP(evaluatedQueries, k = 10) {
  if (!evaluatedQueries || evaluatedQueries.length === 0) return 0;

  let totalAP = 0;
  let validQueries = 0;

  for (const q of evaluatedQueries) {
    const totalRelevant = countTotalRelevant(q.expected);
    if (totalRelevant === 0) continue;

    const topK = (q.matchedResults || q.results || []).slice(0, k);

    let relevantSoFar = 0;
    let precisionSum = 0;

    for (let i = 0; i < topK.length; i++) {
      const isRelevant = getRelevanceGrade(topK[i]) > 0;

      if (isRelevant) {
        relevantSoFar++;
        // Precision at this position (1-indexed)
        const precisionAtK = relevantSoFar / (i + 1);
        precisionSum += precisionAtK;
      }
    }

    // Standard AP formula: AP = sum(P@k * rel(k)) / |R|
    // where |R| is total number of relevant documents
    // Using totalRelevant (not min(k, totalRelevant)) aligns with TREC/BEIR standard
    const ap = totalRelevant > 0 ? precisionSum / totalRelevant : 0;

    totalAP += ap;
    validQueries++;
  }

  return validQueries > 0 ? totalAP / validQueries : 0;
}

/**
 * Calculate latency percentiles
 *
 * @param {number[]} latencies - Array of latency values in milliseconds
 * @returns {object} { p50, p75, p90, p95, p99, min, max, mean }
 */
export function calculateLatencyPercentiles(latencies) {
  if (!latencies || latencies.length === 0) {
    return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0 };
  }

  // Sort for percentile calculation
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;

  /**
   * Get percentile value using linear interpolation
   * @param {number} p - Percentile (0-1)
   * @returns {number} Percentile value
   */
  const percentile = (p) => {
    const index = p * (n - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const fraction = index - lower;

    if (lower === upper || upper >= n) {
      return sorted[lower];
    }

    return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
  };

  const mean = latencies.reduce((a, b) => a + b, 0) / n;

  return {
    p50: Math.round(percentile(0.50) * 100) / 100,
    p75: Math.round(percentile(0.75) * 100) / 100,
    p90: Math.round(percentile(0.90) * 100) / 100,
    p95: Math.round(percentile(0.95) * 100) / 100,
    p99: Math.round(percentile(0.99) * 100) / 100,
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[n - 1] * 100) / 100,
    mean: Math.round(mean * 100) / 100,
  };
}

/**
 * Bootstrap 95% Confidence Interval
 *
 * Uses bootstrap resampling to estimate confidence intervals for a metric
 *
 * NOTE: For sample sizes < 2, returns identical lower/upper bounds equal to the
 * point estimate. The CI is not statistically meaningful in this case - at least
 * 10 samples are recommended for reliable confidence intervals.
 *
 * @param {Array} evaluatedQueries - Array of query results
 * @param {Function} metricFn - Metric function (e.g., calculateMRR)
 * @param {number} iterations - Number of bootstrap samples (default 1000)
 * @returns {object} { lower, upper, mean, stddev }
 */
export function bootstrapCI(evaluatedQueries, metricFn, iterations = 1000) {
  // Edge case: With < 2 samples, bootstrap CI is not statistically meaningful.
  // Returns the point estimate with zero-width CI to indicate insufficient data.
  if (!evaluatedQueries || evaluatedQueries.length < 2) {
    const value = metricFn(evaluatedQueries);
    return { lower: value, upper: value, mean: value, stddev: 0 };
  }

  const n = evaluatedQueries.length;

  // Adaptive iterations for performance with large query sets
  const adaptiveIterations = n > 1000 ? 500
    : n > 500 ? 750
    : iterations;

  const samples = [];

  for (let i = 0; i < adaptiveIterations; i++) {
    // Create bootstrap sample (random sampling with replacement)
    const sample = Array.from({ length: n }, () =>
      evaluatedQueries[Math.floor(Math.random() * n)]
    );
    samples.push(metricFn(sample));
  }

  // Sort for percentile calculation
  samples.sort((a, b) => a - b);

  const mean = samples.reduce((a, b) => a + b, 0) / adaptiveIterations;
  const variance = samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (adaptiveIterations - 1);
  const stddev = Math.sqrt(variance);

  // Protect both lower and upper bounds against out-of-bounds access
  const lowerIndex = Math.min(Math.max(0, Math.floor(adaptiveIterations * 0.025)), samples.length - 1);
  const upperIndex = Math.min(Math.floor(adaptiveIterations * 0.975), samples.length - 1);

  return {
    lower: samples[lowerIndex],
    upper: samples[upperIndex],
    mean: Math.round(mean * 10000) / 10000,
    stddev: Math.round(stddev * 10000) / 10000,
  };
}

/**
 * Calculate all metrics for a set of evaluated queries
 *
 * @param {Array} evaluatedQueries - Array of evaluated query results
 * @param {object} options - { k: 10, recallK: 20, includeCI: false }
 * @returns {object} All metrics
 */
export function calculateAllMetrics(evaluatedQueries, options = {}) {
  const { k = 10, recallK = 20, includeCI = false } = options;

  const metrics = {
    mrr: calculateMRR(evaluatedQueries, k),
    ndcg: calculateNDCG(evaluatedQueries, k),
    map: calculateMAP(evaluatedQueries, k),
    recall: calculateRecall(evaluatedQueries, recallK),
    successRate: calculateSuccessRate(evaluatedQueries, k),
    successRate5: calculateSuccessRate(evaluatedQueries, 5),
    successRate1: calculateSuccessRate(evaluatedQueries, 1),
    routeAccuracy: calculateRouteAccuracy(evaluatedQueries),
    utilityRouteAccuracy: calculateUtilityRouteAccuracy(evaluatedQueries),
    cacheHitRate: calculateCacheHitRate(evaluatedQueries),
  };

  if (includeCI) {
    metrics.mrrCI = bootstrapCI(evaluatedQueries, (q) => calculateMRR(q, k));
    metrics.ndcgCI = bootstrapCI(evaluatedQueries, (q) => calculateNDCG(q, k));
    metrics.mapCI = bootstrapCI(evaluatedQueries, (q) => calculateMAP(q, k));
    metrics.recallCI = bootstrapCI(evaluatedQueries, (q) => calculateRecall(q, recallK));
  }

  return metrics;
}

// Re-export calculateStats from benchmark-harness for latency calculations
export { calculateStats };
