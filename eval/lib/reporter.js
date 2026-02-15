/**
 * Report formatting and display for benchmark results.
 */

/**
 * Print a benchmark report to console.
 *
 * @param {string} dataset - Dataset name
 * @param {Object} metrics - Aggregate metrics
 * @param {Object} perLanguage - Per-language metrics breakdown
 * @param {number} totalTime - Total elapsed time in ms
 * @param {number} queryCount - Number of queries evaluated
 */
export function printReport(dataset, metrics, perLanguage, totalTime, queryCount) {
  console.log('\n' + '='.repeat(70));
  console.log(`  SWEET SEARCH BENCHMARK RESULTS`);
  console.log(`  Dataset: ${dataset}`);
  console.log(`  Queries: ${queryCount}`);
  console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log('='.repeat(70));

  printAggregateMetrics(metrics);
  printPerLanguageTable(perLanguage);

  console.log('\n' + '='.repeat(70));
}

/**
 * Print a combined report for multiple benchmarks.
 *
 * @param {Array<Object>} allResults - Array of { dataset, metrics, perLanguage, totalTime, queryCount }
 */
export function printCombinedReport(allResults) {
  console.log('\n' + '='.repeat(70));
  console.log('  SWEET SEARCH - ALL BENCHMARKS SUMMARY');
  console.log('='.repeat(70));

  console.log('\n  ' + '-'.repeat(66));
  console.log('  ' + 'Dataset'.padEnd(22) +
    'Queries'.padStart(8) +
    'MRR@10'.padStart(10) +
    'Recall@5'.padStart(10) +
    'R@20'.padStart(8) +
    'p50ms'.padStart(8));
  console.log('  ' + '-'.repeat(66));

  for (const r of allResults) {
    const m = r.metrics;
    console.log('  ' +
      r.dataset.padEnd(22) +
      String(r.queryCount).padStart(8) +
      `${(m.mrr_at_10 * 100).toFixed(1)}%`.padStart(10) +
      `${(m.recall_at_5 * 100).toFixed(1)}%`.padStart(10) +
      `${(m.recall_at_20 * 100).toFixed(1)}%`.padStart(8) +
      `${m.latency_p50_ms.toFixed(0)}`.padStart(8));
  }

  console.log('  ' + '-'.repeat(66));

  // Weighted average across all benchmarks
  const totalQueries = allResults.reduce((s, r) => s + r.queryCount, 0);
  if (totalQueries > 0) {
    const wavg = (key) => allResults.reduce((s, r) =>
      s + r.metrics[key] * r.queryCount, 0) / totalQueries;

    console.log('  ' +
      'WEIGHTED AVG'.padEnd(22) +
      String(totalQueries).padStart(8) +
      `${(wavg('mrr_at_10') * 100).toFixed(1)}%`.padStart(10) +
      `${(wavg('recall_at_5') * 100).toFixed(1)}%`.padStart(10) +
      `${(wavg('recall_at_20') * 100).toFixed(1)}%`.padStart(8) +
      `${wavg('latency_p50_ms').toFixed(0)}`.padStart(8));
  }

  const totalTime = allResults.reduce((s, r) => s + r.totalTime, 0);
  console.log(`\n  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log('='.repeat(70));
}

function printAggregateMetrics(metrics) {
  console.log('\n  Aggregate Metrics:');
  console.log('  ' + '-'.repeat(50));
  console.log(`  MRR@10:      ${(metrics.mrr_at_10 * 100).toFixed(2)}%`);
  console.log(`  NDCG@10:     ${(metrics.ndcg_at_10 * 100).toFixed(2)}%`);
  console.log(`  MAP@10:      ${(metrics.map_at_10 * 100).toFixed(2)}%`);
  console.log(`  Recall@5:    ${(metrics.recall_at_5 * 100).toFixed(2)}%`);
  console.log(`  Recall@10:   ${(metrics.recall_at_10 * 100).toFixed(2)}%`);
  console.log(`  Recall@20:   ${(metrics.recall_at_20 * 100).toFixed(2)}%`);
  console.log(`  Success@1:   ${(metrics.success_at_1 * 100).toFixed(2)}%`);
  console.log(`  Success@5:   ${(metrics.success_at_5 * 100).toFixed(2)}%`);
  console.log('  ' + '-'.repeat(50));
  console.log(`  Latency p50: ${metrics.latency_p50_ms.toFixed(1)}ms`);
  console.log(`  Latency p95: ${metrics.latency_p95_ms.toFixed(1)}ms`);
  console.log(`  Latency avg: ${metrics.latency_mean_ms.toFixed(1)}ms`);
}

function printPerLanguageTable(perLanguage) {
  const langs = Object.entries(perLanguage);
  if (langs.length <= 1) return;

  console.log('\n  Per-Language Breakdown:');
  console.log('  ' + '-'.repeat(50));
  console.log('  Language    | Queries | MRR@10  | Recall@5 | Recall@20');
  console.log('  ' + '-'.repeat(50));
  for (const [lang, lm] of langs) {
    console.log(
      `  ${lang.padEnd(12)}| ` +
      `${String(lm.count).padEnd(8)}| ` +
      `${(lm.mrr_at_10 * 100).toFixed(1).padStart(6)}% | ` +
      `${(lm.recall_at_5 * 100).toFixed(1).padStart(7)}% | ` +
      `${(lm.recall_at_20 * 100).toFixed(1).padStart(7)}%`
    );
  }
}
