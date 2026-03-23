/**
 * Pattern benchmark evaluator — runs regex+semantic queries and evaluates results.
 *
 * Unlike the standard evaluator (text query → search → evaluate),
 * pattern evaluation sends (regex, semantic_query) → pattern search
 * and checks results against gold chunk IDs.
 */

import { runRipgrep, findChunkForLine } from '../../core/search-pattern.js';
import { PROJECT_ROOT } from '../../core/config.js';

/**
 * Run a single pattern query against Sweet Search.
 *
 * @param {Object} search - Initialized SweetSearch instance
 * @param {Object} queryObj - Pattern query with { regex, semantic_query }
 * @param {Object} [options]
 * @param {number} [options.k=10] - Top-k results
 * @returns {{ results: Array, latencyMs: number, stats: Object }}
 */
export async function runPatternQuery(search, queryObj, options = {}) {
  const { k = 10 } = options;

  const start = performance.now();
  const { results, stats } = await search.search(queryObj.semantic_query, {
    k,
    mode: 'pattern',
    regex: queryObj.regex,
    rerank: true,
    expand: false,
  });
  const latencyMs = performance.now() - start;

  return {
    results: results.map(r => ({
      id: r.id || '',
      file: r.file || r.metadata?.file || '',
      name: r.name || r.metadata?.name || '',
      score: r.score || r.lateInteractionScore || 0,
      type: r.type || '',
      startLine: r.startLine || null,
      endLine: r.endLine || null,
      indexed: r.indexed !== false,
    })),
    latencyMs,
    stats: stats || {},
  };
}

/**
 * Run a baseline query (non-pattern) for comparison.
 *
 * @param {Object} search - Initialized SweetSearch instance
 * @param {Object} queryObj - Query with { semantic_query }
 * @param {string} mode - Search mode (e.g., 'hybrid')
 * @param {Object} [options]
 * @returns {{ results: Array, latencyMs: number }}
 */
export async function runBaselineQuery(search, queryObj, mode, options = {}) {
  const { k = 10 } = options;

  const start = performance.now();
  const { results, stats } = await search.search(queryObj.semantic_query, {
    k,
    mode,
    rerank: true,
    expand: true,
  });
  const latencyMs = performance.now() - start;

  return {
    results: results.map(r => ({
      id: r.id || '',
      file: r.file || r.metadata?.file || '',
      name: r.name || r.metadata?.name || '',
      score: r.score || 0,
      type: r.type || '',
    })),
    latencyMs,
    stats: stats || {},
  };
}

/**
 * Run an rg-only baseline query — pure ripgrep with no semantic ranking.
 * Returns results in file order (ripgrep's natural output order = no ranking).
 * This is the recall ceiling: perfect structural match, zero relevance ranking.
 *
 * @param {Object} search - Initialized SweetSearch instance
 * @param {Object} queryObj - Query with { regex }
 * @param {Object} [options]
 * @param {number} [options.k=10] - Top-k results
 * @returns {{ results: Array, latencyMs: number, stats: Object }}
 */
export async function runRgOnlyQuery(search, queryObj, options = {}) {
  const { k = 10 } = options;

  const start = performance.now();
  const matches = await runRipgrep(queryObj.regex, PROJECT_ROOT, { maxMatches: 0 });
  const latencyMs = performance.now() - start;

  const locationMap = search.getChunkLocationMap();
  const seenChunkIds = new Set();
  const seenFiles = new Set();
  const results = [];
  for (const m of matches) {
    const chunkId = findChunkForLine(locationMap.get(m.file), m.line);
    if (!chunkId || seenChunkIds.has(chunkId)) continue;

    seenChunkIds.add(chunkId);
    seenFiles.add(m.file);
    results.push({
      id: chunkId,
      file: m.file,
      name: '',
      score: 0,
      type: '',
    });
    if (results.length >= k) break;
  }

  return {
    results,
    latencyMs,
    stats: {
      grepMatches: matches.length,
      uniqueChunks: seenChunkIds.size,
      uniqueFiles: seenFiles.size,
    },
  };
}

/**
 * Validate the pattern benchmark query contract.
 *
 * @param {Object} queryObj - Query with { query_id, relevant_chunk_ids, ... }
 * @returns {string[]} normalized relevant chunk IDs
 */
export function getRelevantChunkIds(queryObj) {
  const chunkIds = queryObj.relevant_chunk_ids;
  if (!Array.isArray(chunkIds) || chunkIds.length === 0) {
    throw new Error(
      `Pattern benchmark query ${queryObj.query_id || '<unknown>'} is missing relevant_chunk_ids`
    );
  }
  return [...new Set(chunkIds.filter(Boolean))];
}

/**
 * Evaluate a pattern query: check which returned results match ground truth chunks.
 *
 * @param {Object} queryObj - Query with { query_id, relevant_chunk_ids, ... }
 * @param {Array<Object>} searchResults - Results from runPatternQuery
 * @returns {Object} Evaluation result compatible with metrics.computeMetrics
 */
export function evaluatePatternQuery(queryObj, searchResults) {
  const relevantChunkIds = new Set(getRelevantChunkIds(queryObj));
  const matchedChunkIds = new Set();
  const rankedRelevance = searchResults.map(r => {
    const resultId = r.id || '';
    if (!resultId || matchedChunkIds.has(resultId)) return 0;

    if (relevantChunkIds.has(resultId)) {
      matchedChunkIds.add(resultId);
      return 1;
    }
    return 0;
  });

  return {
    queryId: queryObj.query_id,
    query: `[${queryObj.regex}] ${queryObj.semantic_query}`,
    language: queryObj.language || 'unknown',
    rankedRelevance,
    totalRelevant: relevantChunkIds.size,
    latencyMs: 0,
    // Pattern-specific metadata for per-slice reporting
    regexFamily: queryObj.regex_family || 'unknown',
    difficulty: queryObj.difficulty || 'unknown',
    namingQuality: queryObj.naming_quality || 'unknown',
  };
}

/**
 * Compute per-slice metrics breakdown for pattern evaluation.
 *
 * Slices: regex_family, difficulty, naming_quality.
 *
 * @param {Array<Object>} evaluatedQueries - Evaluated queries with slice metadata
 * @param {Function} computeMetricsFn - metrics.computeMetrics function
 * @returns {Object} { byRegexFamily: {...}, byDifficulty: {...}, byNamingQuality: {...} }
 */
export function computePerSliceMetrics(evaluatedQueries, computeMetricsFn) {
  const sliceKeys = ['regexFamily', 'difficulty', 'namingQuality'];
  const result = {};

  for (const key of sliceKeys) {
    const grouped = {};
    for (const q of evaluatedQueries) {
      const val = q[key] || 'unknown';
      if (!grouped[val]) grouped[val] = [];
      grouped[val].push(q);
    }

    result[key] = {};
    for (const [val, queries] of Object.entries(grouped)) {
      result[key][val] = { count: queries.length, ...computeMetricsFn(queries) };
    }
  }

  return result;
}

/**
 * Compute win rate between two evaluated result sets.
 *
 * A "win" means the treatment achieved a better (lower) reciprocal rank
 * for the first relevant result compared to the baseline.
 *
 * @param {Array<Object>} treatmentQueries - Evaluated queries for treatment
 * @param {Array<Object>} baselineQueries - Evaluated queries for baseline
 * @returns {{ wins: number, losses: number, ties: number, winRate: number, details: Array }}
 */
export function computeWinRate(treatmentQueries, baselineQueries) {
  let wins = 0, losses = 0, ties = 0;
  const details = [];

  const baselineMap = new Map(baselineQueries.map(q => [q.queryId, q]));

  for (const tq of treatmentQueries) {
    const bq = baselineMap.get(tq.queryId);
    if (!bq) continue;

    const tRR = reciprocalRank(tq.rankedRelevance);
    const bRR = reciprocalRank(bq.rankedRelevance);

    let outcome;
    if (tRR > bRR) { wins++; outcome = 'win'; }
    else if (tRR < bRR) { losses++; outcome = 'loss'; }
    else { ties++; outcome = 'tie'; }

    details.push({
      queryId: tq.queryId,
      treatmentRR: tRR,
      baselineRR: bRR,
      outcome,
    });
  }

  const total = wins + losses + ties;
  return {
    wins,
    losses,
    ties,
    total,
    winRate: total > 0 ? wins / total : 0,
    details,
  };
}

function reciprocalRank(rankedRelevance) {
  const idx = rankedRelevance.indexOf(1);
  return idx >= 0 ? 1 / (idx + 1) : 0;
}

/**
 * Print per-slice report table.
 *
 * @param {string} sliceName - Name of the slice dimension
 * @param {Object} sliceMetrics - { [value]: { count, mrr_at_10, recall_at_5, ... } }
 */
export function printSliceReport(sliceName, sliceMetrics) {
  const entries = Object.entries(sliceMetrics);
  if (entries.length === 0) return;

  console.log(`\n  Per-${sliceName} Breakdown:`);
  console.log('  ' + '-'.repeat(62));
  console.log('  ' + sliceName.padEnd(16) + '| Queries | MRR@10  | Recall@5 | Recall@10 | p50ms');
  console.log('  ' + '-'.repeat(62));

  for (const [val, m] of entries) {
    console.log(
      `  ${val.padEnd(16)}| ` +
      `${String(m.count).padEnd(8)}| ` +
      `${(m.mrr_at_10 * 100).toFixed(1).padStart(6)}% | ` +
      `${(m.recall_at_5 * 100).toFixed(1).padStart(7)}% | ` +
      `${(m.recall_at_10 * 100).toFixed(1).padStart(8)}% | ` +
      `${m.latency_p50_ms.toFixed(0).padStart(5)}`
    );
  }
}

/**
 * Print win rate comparison.
 */
export function printWinRate(label, winRate) {
  console.log(`\n  ${label}:`);
  console.log('  ' + '-'.repeat(40));
  console.log(`  Wins:   ${winRate.wins}/${winRate.total} (${(winRate.winRate * 100).toFixed(1)}%)`);
  console.log(`  Losses: ${winRate.losses}/${winRate.total}`);
  console.log(`  Ties:   ${winRate.ties}/${winRate.total}`);
}
