/**
 * Query execution and result evaluation for benchmarks.
 */

import path from 'path';

/**
 * Run a single query against Sweet Search.
 *
 * @param {Object} search - Initialized SweetSearch instance
 * @param {string} query - Natural language query
 * @param {Object} [options]
 * @param {number} [options.k=20] - Top-k results
 * @param {string} [options.mode='auto'] - Search mode
 * @returns {{ results: Array, latencyMs: number, mode: string }}
 */
export async function runQuery(search, query, options = {}) {
  const { k = 20, mode = 'auto', expand = true } = options;

  const start = performance.now();
  const { results, stats } = await search.search(query, { k, mode, rerank: true, expand });
  const latencyMs = performance.now() - start;

  return {
    results: results.map(r => ({
      file: r.file || r.metadata?.file || r.filePath || r.path || '',
      name: r.name || r.metadata?.name || r.entityName || '',
      score: r.score || 0,
      type: r.type || r.metadata?.type || '',
    })),
    latencyMs,
    mode: stats?.routing?.mode || mode,
  };
}

/**
 * Evaluate a single query: check which returned results match ground truth.
 *
 * @param {Object} queryObj - Query with { query_id, query, relevant_doc_ids, language }
 * @param {Array<Object>} searchResults - Results from runQuery
 * @param {Map<string, string>} docIdToFile - Map of doc_id → file path
 * @returns {Object} Evaluation result with ranked relevance
 */
export function evaluateQuery(queryObj, searchResults, docIdToFile) {
  const relevantFiles = new Set();

  for (const docId of queryObj.relevant_doc_ids) {
    const filePath = docIdToFile.get(docId);
    if (filePath) {
      relevantFiles.add(filePath);
      relevantFiles.add(path.basename(filePath));
    }
  }

  const matchedFiles = new Set();
  const rankedRelevance = searchResults.map(r => {
    const resultFile = r.file || '';
    if (!resultFile) return 0;

    const resultBasename = path.basename(resultFile);
    if (matchedFiles.has(resultBasename)) return 0;

    let isMatch = relevantFiles.has(resultFile) || relevantFiles.has(resultBasename);

    if (!isMatch) {
      for (const relFile of relevantFiles) {
        if ((relFile && resultFile.endsWith(relFile)) ||
            (resultFile && relFile.endsWith(resultFile))) {
          isMatch = true;
          break;
        }
      }
    }

    if (isMatch) {
      matchedFiles.add(resultBasename);
      return 1;
    }
    return 0;
  });

  return {
    queryId: queryObj.query_id,
    query: queryObj.query,
    language: queryObj.language,
    rankedRelevance,
    totalRelevant: queryObj.relevant_doc_ids.length,
    latencyMs: 0,
  };
}

/**
 * Strip common comment markers from query text.
 * Go, PHP, JS, Python, Ruby queries may have leading comment prefixes.
 *
 * @param {string} query - Raw query string
 * @returns {string} Cleaned query
 */
export function cleanQueryText(query) {
  return query
    .replace(/^\/\/\s*/, '')
    .replace(/^\/\*+\s*/, '')
    .replace(/^\*+\s*/, '')
    .replace(/^#\s*/, '')
    .trim();
}
