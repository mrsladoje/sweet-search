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
 * Parse a gold chunk ID in the format `file:startLine-endLine:index`.
 * Returns { file, startLine, endLine } or null if the format doesn't match.
 *
 * @param {string} goldId
 * @returns {{ file: string, startLine: number, endLine: number }|null}
 */
function parseGoldId(goldId) {
  // Format: file:startLine-endLine:index  (index is optional trailing :N)
  // The file portion may itself contain colons on some platforms, so we match
  // from the right: the last two colon-separated segments are endLine:index,
  // and the segment before that contains startLine at the end after a dash.
  const match = goldId.match(/^(.+):(\d+)-(\d+)(?::\d+)?$/);
  if (!match) return null;
  return {
    file: match[1],
    startLine: parseInt(match[2], 10),
    endLine: parseInt(match[3], 10),
  };
}

/**
 * Compute the overlap ratio between two line ranges.
 * Returns a value in [0, 1]: overlap length / length of the gold range.
 *
 * @param {number} goldStart
 * @param {number} goldEnd
 * @param {number} resultStart
 * @param {number} resultEnd
 * @returns {number}
 */
function lineRangeOverlap(goldStart, goldEnd, resultStart, resultEnd) {
  const overlapStart = Math.max(goldStart, resultStart);
  const overlapEnd = Math.min(goldEnd, resultEnd);
  if (overlapEnd < overlapStart) return 0;

  const overlapLen = overlapEnd - overlapStart + 1;
  const goldLen = goldEnd - goldStart + 1;
  return goldLen > 0 ? overlapLen / goldLen : 0;
}

/**
 * Check whether a search result matches a gold chunk ID.
 *
 * Matching strategy:
 *   1. Exact ID match: `goldId === result.id`
 *   2. Fuzzy fallback — requires same file AND either:
 *      a. Both have a non-empty symbol name and they match (case-insensitive), OR
 *      b. Line range overlap > 50% (overlap relative to gold chunk length)
 *
 * @param {string} goldId - Gold chunk ID (e.g. "core/sweet-search.js:88-116:3")
 * @param {Object} result - Search result with { id, file, name, startLine, endLine }
 * @returns {boolean}
 */
export function chunksMatch(goldId, result) {
  // 1. Exact match
  if (goldId === result.id) return true;

  // 2. Fuzzy fallback — parse the gold ID
  const parsed = parseGoldId(goldId);
  if (!parsed) return false;

  // Files must match
  const resultFile = result.file || result.metadata?.file || '';
  if (parsed.file !== resultFile) return false;

  // 2a. Symbol name match (both must be non-empty)
  const goldName = null; // gold IDs don't carry a name; only result does
  const resultName = (result.name || result.metadata?.name || '').trim();
  // We skip name matching since gold IDs don't encode names — proceed to line overlap.

  void goldName; // suppress unused-variable lint noise

  // 2b. Line range overlap > 50%
  const resultStart = result.startLine ?? result.metadata?.startLine ?? null;
  const resultEnd = result.endLine ?? result.metadata?.endLine ?? null;
  if (resultStart == null || resultEnd == null) return false;

  return lineRangeOverlap(parsed.startLine, parsed.endLine, resultStart, resultEnd) > 0.5;
}

/**
 * Evaluate a pattern query: check which returned results match ground truth chunks.
 *
 * Matching is done via chunksMatch(), which tries exact ID match first and
 * falls back to fuzzy file + line-range-overlap matching. This makes
 * evaluation robust to chunk boundary shifts during re-indexing.
 *
 * @param {Object} queryObj - Query with { query_id, relevant_chunk_ids, ... }
 * @param {Array<Object>} searchResults - Results from runPatternQuery
 * @returns {Object} Evaluation result compatible with metrics.computeMetrics
 */
export function evaluatePatternQuery(queryObj, searchResults) {
  const relevantChunkIds = getRelevantChunkIds(queryObj);
  const matchedGoldIds = new Set();
  const rankedRelevance = searchResults.map(r => {
    if (!r.id && !r.file) return 0;

    for (const goldId of relevantChunkIds) {
      if (matchedGoldIds.has(goldId)) continue;
      if (chunksMatch(goldId, r)) {
        matchedGoldIds.add(goldId);
        return 1;
      }
    }
    return 0;
  });

  return {
    queryId: queryObj.query_id,
    query: `[${queryObj.regex}] ${queryObj.semantic_query}`,
    language: queryObj.language || 'unknown',
    rankedRelevance,
    totalRelevant: relevantChunkIds.length,
    latencyMs: 0,
    // Pattern-specific metadata for per-slice reporting
    regexFamily: queryObj.regex_family || 'unknown',
    difficulty: queryObj.difficulty || 'unknown',
    namingQuality: queryObj.naming_quality || 'unknown',
  };
}

/**
 * Classify failure mode for a pattern query evaluation.
 * Separates "grep didn't find it" from "mapping lost it" from "MaxSim ranked it wrong."
 *
 * @param {Object} evaluated - Output of evaluatePatternQuery
 * @param {Object} stats - Pattern search stats (with allCandidateIds, allMappedChunkIds)
 * @param {Set<string>} relevantChunkIds - Gold chunk IDs for this query
 * @returns {string} One of: 'hit', 'rerank_miss', 'mapping_miss', 'regex_miss'
 */
export function classifyFailure(evaluated, stats, relevantChunkIds) {
  // Did the system find a gold chunk in top-k?
  if (evaluated.rankedRelevance.includes(1)) return 'hit';

  const candidateSet = new Set(stats?.allCandidateIds || []);
  const mappedSet = new Set(stats?.allMappedChunkIds || []);

  // Was any gold chunk in the MaxSim candidate pool?
  for (const goldId of relevantChunkIds) {
    if (candidateSet.has(goldId)) return 'rerank_miss'; // MaxSim had it but ranked it below top-k
  }

  // Was any gold chunk mapped from grep but filtered out (no LI embedding)?
  for (const goldId of relevantChunkIds) {
    if (mappedSet.has(goldId)) return 'mapping_miss'; // Grep found it, LI didn't have it
  }

  // Grep didn't find the right chunk at all
  return 'regex_miss';
}

/**
 * Compute pipeline diagnostic breakdown across all evaluated queries.
 *
 * @param {Array<Object>} evaluatedQueries - With .patternStats and .relevantChunkIds attached
 * @returns {{ hit: number, rerank_miss: number, mapping_miss: number, regex_miss: number, total: number }}
 */
export function computeDiagnostics(evaluatedQueries) {
  const counts = { hit: 0, rerank_miss: 0, mapping_miss: 0, regex_miss: 0 };

  for (const eq of evaluatedQueries) {
    const classification = eq._failureMode || 'hit';
    counts[classification] = (counts[classification] || 0) + 1;
  }

  return { ...counts, total: evaluatedQueries.length };
}

/**
 * Print diagnostic breakdown.
 */
export function printDiagnostics(diag) {
  const pct = (n) => ((n / diag.total) * 100).toFixed(1);
  console.log('\n  ── Pipeline Diagnostics ──');
  console.log('  ' + '-'.repeat(45));
  console.log(`  Hit (gold in top-k):       ${diag.hit}/${diag.total} (${pct(diag.hit)}%)`);
  console.log(`  Rerank miss (in cands):    ${diag.rerank_miss}/${diag.total} (${pct(diag.rerank_miss)}%)`);
  console.log(`  Mapping miss (no LI emb):  ${diag.mapping_miss}/${diag.total} (${pct(diag.mapping_miss)}%)`);
  console.log(`  Regex miss (not in grep):  ${diag.regex_miss}/${diag.total} (${pct(diag.regex_miss)}%)`);
  console.log(`  Candidate recall:          ${pct(diag.hit + diag.rerank_miss)}% (gold was in candidate pool)`);
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
