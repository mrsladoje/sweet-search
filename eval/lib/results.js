/**
 * Result persistence for benchmark evaluations.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

/**
 * Save benchmark results to a timestamped JSON file.
 * Does NOT overwrite the baseline — use saveBaseline() explicitly.
 *
 * @param {string} dataset - Dataset name
 * @param {Object} report - Full report object
 * @param {string} resultsDir - Directory to save results
 * @returns {{ timestampedFile: string, baselineFile: string }}
 */
export function saveResults(dataset, report, resultsDir) {
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const timestampedFile = path.join(resultsDir, `${dataset}_${timestamp}.json`);
  const baselineFile = path.join(resultsDir, `${dataset}_baseline.json`);

  writeFileSync(timestampedFile, JSON.stringify(report, null, 2));

  // Auto-create baseline if none exists (first run bootstrap)
  if (!existsSync(baselineFile)) {
    writeFileSync(baselineFile, JSON.stringify(report, null, 2));
  }

  return { timestampedFile, baselineFile };
}

/**
 * Explicitly save current results as the new baseline.
 *
 * @param {string} dataset - Dataset name
 * @param {Object} report - Full report object
 * @param {string} resultsDir - Directory to save results
 * @returns {string} Path to the baseline file
 */
export function saveBaseline(dataset, report, resultsDir) {
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const baselineFile = path.join(resultsDir, `${dataset}_baseline.json`);
  writeFileSync(baselineFile, JSON.stringify(report, null, 2));
  return baselineFile;
}

/**
 * Build a standard report object from benchmark results.
 *
 * @param {Object} params
 * @param {string} params.dataset - Dataset name
 * @param {number} params.queryCount - Number of queries
 * @param {number} params.corpusSize - Corpus size
 * @param {string} params.searchMode - Search mode used
 * @param {number} params.totalTimeMs - Total elapsed time
 * @param {number} params.errorCount - Number of errors
 * @param {Object} params.metrics - Aggregate metrics
 * @param {Object} params.perLanguage - Per-language metrics
 * @param {Array<Object>} params.evaluatedQueries - All evaluated queries
 * @returns {Object} Full report object
 */
export function buildReport({
  dataset,
  queryCount,
  corpusSize,
  searchMode,
  totalTimeMs,
  errorCount,
  metrics,
  perLanguage,
  evaluatedQueries,
  config = null,
}) {
  return {
    timestamp: new Date().toISOString(),
    dataset,
    queryCount,
    corpusSize,
    searchMode,
    totalTimeMs,
    errors: errorCount,
    // Optional run configuration snapshot — saved when the caller passes it
    // so two result JSONs can be compared without guessing which flags ran.
    // Recommended fields: profile, k, useLateInteraction, cascadeEnabled,
    // graphExpand, stage3Candidates, embedTextVariant, codeRevision.
    ...(config ? { config } : {}),
    aggregate: metrics,
    perLanguage,
    failedQueries: evaluatedQueries
      .filter(q => q.rankedRelevance[0] !== 1)
      .slice(0, 20)
      .map(q => ({
        queryId: q.queryId,
        query: q.query.slice(0, 100),
        language: q.language,
        topRelevance: q.rankedRelevance.slice(0, 5),
      })),
  };
}
