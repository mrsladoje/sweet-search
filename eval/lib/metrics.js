/**
 * IR metrics computation for code search evaluation.
 * Computes MRR, NDCG, MAP, Recall, Success rate, and latency stats.
 */

/**
 * Compute aggregate IR metrics from evaluated queries.
 * @param {Array<Object>} evaluatedQueries - Each with { rankedRelevance, totalRelevant, latencyMs }
 * @returns {Object} Metrics object
 */
export function computeMetrics(evaluatedQueries) {
  const metrics = {};

  metrics.mrr_at_10 = meanMetric(evaluatedQueries, mrrAt10);
  metrics.ndcg_at_10 = meanMetric(evaluatedQueries, ndcgAt10);
  metrics.map_at_10 = meanMetric(evaluatedQueries, mapAt10);
  metrics.recall_at_5 = meanMetric(evaluatedQueries, recallAtK(5));
  metrics.recall_at_10 = meanMetric(evaluatedQueries, recallAtK(10));
  metrics.recall_at_20 = meanMetric(evaluatedQueries, recallAtK(20));
  metrics.success_at_1 = meanMetric(evaluatedQueries, successAtK(1));
  metrics.success_at_5 = meanMetric(evaluatedQueries, successAtK(5));

  const latencies = evaluatedQueries.map(q => q.latencyMs).sort((a, b) => a - b);
  const n = latencies.length;
  metrics.latency_p50_ms = latencies[Math.floor(n * 0.5)] || 0;
  metrics.latency_p95_ms = latencies[Math.floor(n * 0.95)] || 0;
  metrics.latency_mean_ms = n > 0 ? latencies.reduce((a, b) => a + b, 0) / n : 0;

  for (const key in metrics) {
    metrics[key] = Math.round(metrics[key] * 10000) / 10000;
  }

  return metrics;
}

/**
 * Compute per-language metrics breakdown.
 * @param {Array<Object>} evaluatedQueries
 * @returns {Object} { [language]: { count, ...metrics } }
 */
export function computePerLanguageMetrics(evaluatedQueries) {
  const byLang = {};
  for (const q of evaluatedQueries) {
    const lang = q.language || 'unknown';
    if (!byLang[lang]) byLang[lang] = [];
    byLang[lang].push(q);
  }

  const result = {};
  for (const [lang, queries] of Object.entries(byLang)) {
    result[lang] = { count: queries.length, ...computeMetrics(queries) };
  }
  return result;
}

// ─── Metric Functions ─────────────────────────────────────────────────────

function meanMetric(queries, fn) {
  if (queries.length === 0) return 0;
  return queries.reduce((sum, q) => sum + fn(q), 0) / queries.length;
}

function mrrAt10(q) {
  const topK = q.rankedRelevance.slice(0, 10);
  const idx = topK.indexOf(1);
  return idx >= 0 ? 1 / (idx + 1) : 0;
}

function ndcgAt10(q) {
  const topK = q.rankedRelevance.slice(0, 10);
  const dcg = topK.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  const idealTopK = Array(Math.min(q.totalRelevant, 10)).fill(1);
  const idcg = idealTopK.reduce((sum, rel, i) => sum + rel / Math.log2(i + 2), 0);
  return idcg > 0 ? dcg / idcg : 0;
}

function mapAt10(q) {
  const topK = q.rankedRelevance.slice(0, 10);
  let relSoFar = 0;
  let precSum = 0;
  for (let i = 0; i < topK.length; i++) {
    if (topK[i] === 1) {
      relSoFar++;
      precSum += relSoFar / (i + 1);
    }
  }
  return q.totalRelevant > 0 ? precSum / q.totalRelevant : 0;
}

function recallAtK(k) {
  return (q) => {
    const topK = q.rankedRelevance.slice(0, k);
    const found = topK.filter(r => r === 1).length;
    return q.totalRelevant > 0 ? found / q.totalRelevant : 0;
  };
}

function successAtK(k) {
  return (q) => {
    return q.rankedRelevance.slice(0, k).includes(1) ? 1 : 0;
  };
}
