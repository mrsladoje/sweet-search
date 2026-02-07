/**
 * SEARCH 100x Report Generator
 *
 * Generates evaluation reports in multiple formats:
 * - Console (human-readable with colors)
 * - JSON (automation-friendly)
 *
 * Features:
 * - Latency separation (cold/warm-uncached/warm-cached)
 * - Per-category breakdowns
 * - Failed query analysis
 * - Regression detection
 */

import { calculateStats } from '../../benchmark-harness.js';
import {
  calculateMRR,
  calculateNDCG,
  calculateMAP,
  calculateRecall,
  calculateSuccessRate,
  calculateRouteAccuracy,
  calculateUtilityRouteAccuracy,
  calculateCacheHitRate,
  bootstrapCI,
} from './metrics.js';

/**
 * Latency thermal states
 */
const LATENCY_STATES = {
  cold: 'cold',           // First query after server restart
  warm_uncached: 'warm_uncached', // Server warm, query not cached
  warm_cached: 'warm_cached',     // Server warm, query in cache
};

/**
 * Categorize a query's latency based on thermal state and cache
 *
 * @param {object} queryResult - Query result with stats and timing info
 * @returns {string} Latency category ('cold', 'warm_uncached', 'warm_cached')
 */
export function categorizeLatency(queryResult) {
  const { stats, isFirstQuery, isColdStart } = queryResult;

  // Explicit cold start marker or first query of session
  if (isColdStart || isFirstQuery) {
    return LATENCY_STATES.cold;
  }

  // Check cache source from stats
  const cacheSource = stats?.embedding?.source;
  if (cacheSource === 'vocabulary' || cacheSource === 'lru' || cacheSource === 'semantic') {
    return LATENCY_STATES.warm_cached;
  }

  return LATENCY_STATES.warm_uncached;
}

/**
 * Separate queries into latency buckets
 *
 * @param {Array} queries - Array of evaluated queries with latencyMs
 * @returns {object} { cold: [], warm_uncached: [], warm_cached: [] }
 */
export function separateByLatency(queries) {
  const buckets = {
    cold: [],
    warm_uncached: [],
    warm_cached: [],
  };

  for (const q of queries) {
    const category = categorizeLatency(q);
    buckets[category].push(q.latencyMs);
  }

  return buckets;
}

/**
 * Get latency statistics by thermal state
 *
 * @param {Array} queries - Array of evaluated queries
 * @returns {object} { cold: stats, warmUncached: stats, warmCached: stats }
 */
export function getLatencyReport(queries) {
  const buckets = separateByLatency(queries);

  return {
    cold: buckets.cold.length > 0 ? calculateStats(buckets.cold) : null,
    warmUncached: buckets.warm_uncached.length > 0 ? calculateStats(buckets.warm_uncached) : null,
    warmCached: buckets.warm_cached.length > 0 ? calculateStats(buckets.warm_cached) : null,
    counts: {
      cold: buckets.cold.length,
      warmUncached: buckets.warm_uncached.length,
      warmCached: buckets.warm_cached.length,
    },
  };
}

/**
 * Calculate per-category metrics
 *
 * @param {Array} queries - All evaluated queries
 * @returns {object} Metrics grouped by category
 */
export function getMetricsByCategory(queries) {
  const categories = {};

  for (const q of queries) {
    const category = q.category || 'unknown';
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(q);
  }

  const result = {};
  for (const [category, categoryQueries] of Object.entries(categories)) {
    result[category] = {
      count: categoryQueries.length,
      mrr: calculateMRR(categoryQueries),
      ndcg: calculateNDCG(categoryQueries),
      recall: calculateRecall(categoryQueries),
      successRate: calculateSuccessRate(categoryQueries),
      routeAccuracy: calculateRouteAccuracy(categoryQueries),
      latency: getLatencyReport(categoryQueries),
    };
  }

  return result;
}

/**
 * Identify failed queries (no relevant results in top K)
 *
 * @param {Array} queries - Evaluated queries
 * @param {number} k - Top K to consider (default 10)
 * @returns {Array} Failed queries with details
 */
export function getFailedQueries(queries, k = 10) {
  return queries.filter(q => {
    const topK = (q.matchedResults || []).slice(0, k);
    const relevantCount = topK.filter(r =>
      (r.match?.relevanceGrade || 0) > 0
    ).length;
    return relevantCount === 0;
  }).map(q => ({
    id: q.id,
    query: q.query,
    category: q.category,
    expectedRoute: q.expectedRoute,
    actualRoute: q.actualRoute,
    expected: q.expected,
    topResults: (q.results || []).slice(0, 3).map(r => ({
      file: r.file || r.file_path,
      name: r.name,
      score: r.score,
    })),
  }));
}

/**
 * Generate a full evaluation report
 *
 * @param {Array} queries - All evaluated queries
 * @param {object} options - Report options
 * @returns {object} Full report object
 */
export function generateReport(queries, options = {}) {
  const {
    k = 10,
    recallK = 20,
    includeCI = true,
    costTracker = null,
    totalTime = 0,
    timestamp = new Date().toISOString(),
  } = options;

  // Aggregate metrics
  const aggregate = {
    mrr: calculateMRR(queries, k),
    ndcg: calculateNDCG(queries, k),
    map: calculateMAP(queries, k),
    recall: calculateRecall(queries, recallK),
    successRate: calculateSuccessRate(queries, k),
    successRate5: calculateSuccessRate(queries, 5),
    successRate1: calculateSuccessRate(queries, 1),
  };

  // Confidence intervals
  if (includeCI && queries.length >= 10) {
    aggregate.mrrCI = bootstrapCI(queries, q => calculateMRR(q, k));
    aggregate.ndcgCI = bootstrapCI(queries, q => calculateNDCG(q, k));
    aggregate.mapCI = bootstrapCI(queries, q => calculateMAP(q, k));
    aggregate.recallCI = bootstrapCI(queries, q => calculateRecall(q, recallK));
  }

  // Route accuracy (strict and utility-based)
  const routeAccuracy = calculateRouteAccuracy(queries);
  const utilityRouteAccuracy = calculateUtilityRouteAccuracy(queries);

  // Cache efficiency
  const cacheHitRate = calculateCacheHitRate(queries);

  // Latency by thermal state
  const latency = getLatencyReport(queries);

  // Per-category breakdown
  const byCategory = getMetricsByCategory(queries);

  // Failed queries
  const failedQueries = getFailedQueries(queries, k);

  // Cost metrics (with defaults for null costTracker)
  const cost = costTracker ? costTracker.getStats() : {
    costs: { embed: 0, rerank: 0, total: 0 },
    avgCostPerQuery: 0,
    calls: { embed: 0, embedCached: 0, rerank: 0, rerankSkipped: 0 },
  };

  return {
    timestamp,
    queryCount: queries.length,
    totalTime,
    aggregate,
    routeAccuracy,
    utilityRouteAccuracy,
    cacheHitRate,
    latency,
    byCategory,
    failedQueries,
    cost,
  };
}

/**
 * Format a number as percentage
 */
function formatPercent(n) {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Format latency stats
 */
function formatLatency(stats) {
  if (!stats) return 'N/A';
  return `p50=${stats.p50.toFixed(0)}ms, p95=${stats.p95.toFixed(0)}ms, p99=${stats.p99.toFixed(0)}ms`;
}

/**
 * ANSI color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

/**
 * Format report as human-readable console output
 *
 * @param {object} report - Report object from generateReport
 * @param {boolean} useColors - Whether to use ANSI colors (default true)
 * @returns {string} Formatted report
 */
export function formatConsoleReport(report, useColors = true) {
  const c = useColors ? colors : { reset: '', bold: '', dim: '', green: '', yellow: '', red: '', cyan: '', magenta: '' };

  const lines = [];

  // Header
  lines.push(`${c.bold}${c.cyan}SEARCH 100x EVALUATION REPORT${c.reset}`);
  lines.push('='.repeat(50));
  lines.push(`${c.dim}Timestamp: ${report.timestamp}${c.reset}`);
  lines.push(`${c.dim}Queries: ${report.queryCount}${c.reset}`);
  lines.push('');

  // Aggregate metrics (with null guards to avoid NaN)
  lines.push(`${c.bold}Aggregate Metrics:${c.reset}`);
  const mrr = report.aggregate?.mrr ?? 0;
  const mrrColor = mrr >= 0.72 ? c.green : mrr >= 0.5 ? c.yellow : c.red;
  lines.push(`  MRR@10:      ${mrrColor}${mrr.toFixed(4)}${c.reset}${report.aggregate?.mrrCI ? ` (95% CI: ${report.aggregate.mrrCI.lower.toFixed(3)}-${report.aggregate.mrrCI.upper.toFixed(3)})` : ''}`);

  const ndcg = report.aggregate?.ndcg ?? 0;
  const ndcgColor = ndcg >= 0.68 ? c.green : ndcg >= 0.5 ? c.yellow : c.red;
  lines.push(`  NDCG@10:     ${ndcgColor}${ndcg.toFixed(4)}${c.reset}${report.aggregate?.ndcgCI ? ` (95% CI: ${report.aggregate.ndcgCI.lower.toFixed(3)}-${report.aggregate.ndcgCI.upper.toFixed(3)})` : ''}`);

  const map = report.aggregate?.map ?? 0;
  const mapColor = map >= 0.70 ? c.green : map >= 0.5 ? c.yellow : c.red;
  lines.push(`  MAP@10:      ${mapColor}${map.toFixed(4)}${c.reset}${report.aggregate?.mapCI ? ` (95% CI: ${report.aggregate.mapCI.lower.toFixed(3)}-${report.aggregate.mapCI.upper.toFixed(3)})` : ''}`);

  const recall = report.aggregate?.recall ?? 0;
  const recallColor = recall >= 0.88 ? c.green : recall >= 0.7 ? c.yellow : c.red;
  lines.push(`  Recall@20:   ${recallColor}${recall.toFixed(4)}${c.reset}${report.aggregate?.recallCI ? ` (95% CI: ${report.aggregate.recallCI.lower.toFixed(3)}-${report.aggregate.recallCI.upper.toFixed(3)})` : ''}`);

  const success = report.aggregate?.successRate ?? 0;
  const successColor = success >= 0.9 ? c.green : success >= 0.8 ? c.yellow : c.red;
  lines.push(`  Success@10:  ${successColor}${formatPercent(success)}${c.reset}`);
  lines.push(`  Success@5:   ${formatPercent(report.aggregate?.successRate5 ?? 0)}`);
  lines.push(`  Success@1:   ${formatPercent(report.aggregate?.successRate1 ?? 0)}`);
  lines.push('');

  // Route accuracy (strict and utility-based)
  lines.push(`${c.bold}Routing:${c.reset}`);

  // Strict route accuracy
  const routeAcc = report.routeAccuracy?.accuracy ?? 0;
  const routeCorrect = report.routeAccuracy?.correct ?? 0;
  const routeTotal = report.routeAccuracy?.total ?? 0;
  const routeColor = routeAcc >= 0.9 ? c.green : routeAcc >= 0.8 ? c.yellow : c.red;
  lines.push(`  Strict Accuracy:  ${routeColor}${formatPercent(routeAcc)}${c.reset} (${routeCorrect}/${routeTotal})`);

  // Utility route accuracy (SEMANTIC ≈ HYBRID for non-ASCII)
  const utilityAcc = report.utilityRouteAccuracy?.accuracy ?? 0;
  const utilityCorrect = report.utilityRouteAccuracy?.correct ?? 0;
  const utilityEquiv = report.utilityRouteAccuracy?.equivalentMatches ?? 0;
  const utilityColor = utilityAcc >= 0.9 ? c.green : utilityAcc >= 0.8 ? c.yellow : c.red;
  lines.push(`  Utility Accuracy: ${utilityColor}${formatPercent(utilityAcc)}${c.reset} (${utilityCorrect}/${routeTotal}, ${utilityEquiv} equiv matches)`);
  lines.push(`  ${c.dim}(Utility: SEMANTIC ≈ HYBRID for non-ASCII queries)${c.reset}`);

  // Show misroutes from utility metric (the true misroutes)
  const misroutes = report.utilityRouteAccuracy?.misroutes ?? [];
  if (misroutes.length > 0 && misroutes.length <= 5) {
    lines.push(`  True Misroutes:`);
    for (const m of misroutes) {
      lines.push(`    - ${m.queryId}: "${m.query.slice(0, 30)}..." (expected: ${m.expected}, actual: ${m.actual})`);
    }
  } else if (misroutes.length > 5) {
    lines.push(`  ${c.dim}${misroutes.length} true misroutes (see JSON for details)${c.reset}`);
  }
  lines.push('');

  // Cache efficiency
  lines.push(`${c.bold}Cache Efficiency:${c.reset}`);
  const cacheRate = report.cacheHitRate?.rate ?? 0;
  const cacheColor = cacheRate >= 0.8 ? c.green : cacheRate >= 0.5 ? c.yellow : c.red;
  lines.push(`  Hit Rate: ${cacheColor}${formatPercent(cacheRate)}${c.reset}`);
  const bd = report.cacheHitRate?.breakdown ?? { vocabulary: 0, lru: 0, semantic: 0, api: 0 };
  lines.push(`  Breakdown: vocabulary=${bd.vocabulary ?? 0}, lru=${bd.lru ?? 0}, semantic=${bd.semantic ?? 0}, api=${bd.api ?? 0}`);
  lines.push('');

  // Latency by thermal state
  lines.push(`${c.bold}Latency (by thermal state):${c.reset}`);
  const latCounts = report.latency?.counts ?? { cold: 0, warmUncached: 0, warmCached: 0 };
  lines.push(`  Cold start (${latCounts.cold} queries): ${formatLatency(report.latency?.cold)}`);
  lines.push(`  Warm uncached (${latCounts.warmUncached} queries): ${formatLatency(report.latency?.warmUncached)}`);
  lines.push(`  Warm cached (${latCounts.warmCached} queries): ${formatLatency(report.latency?.warmCached)}`);
  lines.push('');

  // Cost
  if (report.cost) {
    const costs = report.cost.costs ?? { embed: 0, rerank: 0, total: 0 };
    const calls = report.cost.calls ?? { embed: 0, embedCached: 0, rerank: 0, rerankSkipped: 0 };
    lines.push(`${c.bold}Cost:${c.reset}`);
    lines.push(`  Embed: $${(costs.embed ?? 0).toFixed(6)} (${calls.embed ?? 0} API calls, ${calls.embedCached ?? 0} cached)`);
    lines.push(`  Rerank: $${(costs.rerank ?? 0).toFixed(6)} (${calls.rerank ?? 0} API calls, ${calls.rerankSkipped ?? 0} skipped)`);
    lines.push(`  Total: $${(costs.total ?? 0).toFixed(6)}`);
    lines.push(`  Avg/query: $${(report.cost.avgCostPerQuery ?? 0).toFixed(6)}`);
    lines.push('');
  }

  // Per-category breakdown
  lines.push(`${c.bold}By Category:${c.reset}`);
  for (const [category, metrics] of Object.entries(report.byCategory)) {
    const routeStr = metrics.routeAccuracy.accuracy >= 0.9 ? c.green : c.yellow;
    lines.push(`  ${c.magenta}${category}${c.reset} (${metrics.count} queries):`);
    lines.push(`    MRR=${metrics.mrr.toFixed(3)}, Success@10=${formatPercent(metrics.successRate)}, Route=${routeStr}${formatPercent(metrics.routeAccuracy.accuracy)}${c.reset}`);
    if (metrics.latency.warmUncached) {
      lines.push(`    Latency (warm uncached): ${formatLatency(metrics.latency.warmUncached)}`);
    }
  }
  lines.push('');

  // Failed queries
  if (report.failedQueries.length > 0) {
    lines.push(`${c.bold}${c.red}Failed Queries (0 relevant in top 10):${c.reset}`);
    for (const fq of report.failedQueries.slice(0, 10)) {
      lines.push(`  ${c.red}- ${fq.id}:${c.reset} "${fq.query.slice(0, 50)}${fq.query.length > 50 ? '...' : ''}"`);
      if (fq.topResults.length > 0) {
        lines.push(`    ${c.dim}Top result: ${fq.topResults[0].file}${c.reset}`);
      }
    }
    if (report.failedQueries.length > 10) {
      lines.push(`  ${c.dim}... and ${report.failedQueries.length - 10} more${c.reset}`);
    }
  } else {
    lines.push(`${c.green}No failed queries!${c.reset}`);
  }

  return lines.join('\n');
}

/**
 * Format report as JSON
 *
 * @param {object} report - Report object from generateReport
 * @returns {string} JSON string
 */
export function formatJsonReport(report) {
  return JSON.stringify(report, null, 2);
}

/**
 * Format report as JUnit XML for CI systems (Jenkins, GitHub Actions, GitLab CI)
 *
 * @param {object} report - Report object from generateReport
 * @param {object} options - Formatting options
 * @param {string} options.suiteName - Test suite name (default: 'SEARCH 100x Evaluation')
 * @returns {string} JUnit XML string
 */
export function formatJUnitReport(report, options = {}) {
  const { suiteName = 'SEARCH 100x Evaluation' } = options;
  const testCases = [];

  // Calculate total execution time from report (in seconds)
  const totalTime = (report.totalTime ?? 0) / 1000;

  // Create test case for each metric target
  const metrics = [
    { name: 'MRR@10', value: report.aggregate?.mrr ?? 0, target: 0.72 },
    { name: 'NDCG@10', value: report.aggregate?.ndcg ?? 0, target: 0.68 },
    { name: 'MAP@10', value: report.aggregate?.map ?? 0, target: 0.70 },
    { name: 'Recall@20', value: report.aggregate?.recall ?? 0, target: 0.88 },
    { name: 'Success@10', value: report.aggregate?.successRate ?? 0, target: 0.90 },
    { name: 'RouteAccuracy', value: report.routeAccuracy?.accuracy ?? 0, target: 0.90 },
  ];

  // Divide total time evenly among test cases
  const perTestTime = metrics.length > 0 ? (totalTime / metrics.length).toFixed(3) : '0.000';

  let failures = 0;
  for (const m of metrics) {
    const passed = m.value >= m.target;
    if (!passed) failures++;
    testCases.push(`    <testcase name="${m.name}" classname="Metrics" time="${perTestTime}">
      ${passed ? '' : `<failure message="${m.name} below target: ${m.value.toFixed(4)} &lt; ${m.target}">${m.name}: ${m.value.toFixed(4)} (target: ${m.target})</failure>`}
    </testcase>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="${suiteName}" tests="${metrics.length}" failures="${failures}" time="${totalTime.toFixed(3)}" timestamp="${report.timestamp || new Date().toISOString()}">
${testCases.join('\n')}
</testsuite>`;
}

/**
 * Compare report to baseline and detect regressions
 *
 * @param {object} current - Current report
 * @param {object} baseline - Baseline report
 * @param {object} thresholds - Regression thresholds
 * @returns {object} { regressions: [], improvements: [], summary: {} }
 */
export function compareToBaseline(current, baseline, thresholds = {}) {
  const {
    mrrDelta = 0.02,      // 2% regression threshold
    ndcgDelta = 0.02,
    successDelta = 0.05,  // 5% threshold
    latencyMultiplier = 1.5,  // 50% slower
  } = thresholds;

  const regressions = [];
  const improvements = [];

  // MRR comparison
  const mrrDiff = current.aggregate.mrr - baseline.aggregate.mrr;
  if (mrrDiff < -mrrDelta) {
    regressions.push({
      metric: 'MRR@10',
      baseline: baseline.aggregate.mrr,
      current: current.aggregate.mrr,
      delta: mrrDiff,
    });
  } else if (mrrDiff > mrrDelta) {
    improvements.push({
      metric: 'MRR@10',
      baseline: baseline.aggregate.mrr,
      current: current.aggregate.mrr,
      delta: mrrDiff,
    });
  }

  // NDCG comparison
  const ndcgDiff = current.aggregate.ndcg - baseline.aggregate.ndcg;
  if (ndcgDiff < -ndcgDelta) {
    regressions.push({
      metric: 'NDCG@10',
      baseline: baseline.aggregate.ndcg,
      current: current.aggregate.ndcg,
      delta: ndcgDiff,
    });
  } else if (ndcgDiff > ndcgDelta) {
    improvements.push({
      metric: 'NDCG@10',
      baseline: baseline.aggregate.ndcg,
      current: current.aggregate.ndcg,
      delta: ndcgDiff,
    });
  }

  // Success rate comparison
  const successDiff = current.aggregate.successRate - baseline.aggregate.successRate;
  if (successDiff < -successDelta) {
    regressions.push({
      metric: 'Success@10',
      baseline: baseline.aggregate.successRate,
      current: current.aggregate.successRate,
      delta: successDiff,
    });
  } else if (successDiff > successDelta) {
    improvements.push({
      metric: 'Success@10',
      baseline: baseline.aggregate.successRate,
      current: current.aggregate.successRate,
      delta: successDiff,
    });
  }

  // Latency comparison (warm uncached p50) with comprehensive null and divide-by-zero guards
  if (current.latency?.warmUncached?.p50 !== undefined &&
      baseline.latency?.warmUncached?.p50 !== undefined) {
    const baselineP50 = baseline.latency.warmUncached.p50 || 1; // Avoid divide by zero
    const currentP50 = current.latency.warmUncached.p50 || 0;
    const latencyRatio = baselineP50 > 0 ? currentP50 / baselineP50 : 1;
    if (latencyRatio > latencyMultiplier) {
      regressions.push({
        metric: 'Latency (warm p50)',
        baseline: baselineP50,
        current: currentP50,
        ratio: latencyRatio,
      });
    } else if (latencyRatio < 1 / latencyMultiplier) {
      improvements.push({
        metric: 'Latency (warm p50)',
        baseline: baselineP50,
        current: currentP50,
        ratio: latencyRatio,
      });
    }
  }

  return {
    regressions,
    improvements,
    hasRegressions: regressions.length > 0,
    summary: {
      totalRegressions: regressions.length,
      totalImprovements: improvements.length,
    },
  };
}

export default {
  categorizeLatency,
  separateByLatency,
  getLatencyReport,
  getMetricsByCategory,
  getFailedQueries,
  generateReport,
  formatConsoleReport,
  formatJsonReport,
  formatJUnitReport,
  compareToBaseline,
};
