/**
 * Maximal Marginal Relevance (MMR) - Diversity-Aware Reranking
 *
 * Replaces hard flood control caps with intelligent diversification.
 * MMR balances relevance and diversity to avoid result flooding.
 *
 * Formula: MMR_Score = λ × Relevance - (1-λ) × max(Similarity to already selected)
 *
 * Reference: https://qdrant.tech/blog/mmr-diversity-aware-reranking/
 *
 * λ values guide:
 *   λ = 0.8-0.9 → Prioritize relevance (good for code search)
 *   λ = 0.5-0.7 → Balance (good for exploration)
 *   λ = 0.3-0.5 → Emphasize diversity (good for discovery)
 */

/**
 * Default MMR configuration
 */
export const MMR_CONFIG = {
  // Lambda controls relevance vs diversity tradeoff
  // Higher = more relevance-focused, Lower = more diversity-focused
  // TUNED: 0.9 prioritizes relevance strongly while still preventing flooding
  lambda: 0.9, // Default for code search (relevance-heavy)

  // Similarity weights for different features
  weights: {
    file: 0.4,      // Same file = high similarity
    type: 0.2,      // Same entity type = moderate similarity
    package: 0.2,   // Same package/directory = moderate similarity
    semantic: 0.2,  // Embedding similarity (if available)
  },

  // Minimum score to include in MMR selection
  minRelevance: 0.01,

  // Maximum candidates to consider (for performance)
  maxCandidates: 100,
};

/**
 * Compute similarity between two search results for MMR.
 *
 * Features considered:
 * 1. File similarity (same file = 1.0, same directory = 0.5)
 * 2. Type similarity (same entity type = 1.0)
 * 3. Package similarity (same package = 1.0)
 * 4. Semantic similarity (cosine of embeddings if available)
 *
 * @param {Object} a - First result
 * @param {Object} b - Second result
 * @param {Object} weights - Feature weights
 * @returns {number} Similarity score [0, 1]
 */
// Static type groupings used by computeSimilarity — hoisted out of the
// O(candidates × selected) MMR inner loop.
const SIMILARITY_DEF_TYPES = new Set(['class', 'interface', 'struct', 'enum', 'trait']);
const SIMILARITY_METHOD_TYPES = new Set(['method', 'function', 'constructor']);

export function computeSimilarity(a, b, weights = MMR_CONFIG.weights) {
  let totalSim = 0;
  let totalWeight = 0;

  // 1. File similarity
  const fileA = a.file || a.file_path || '';
  const fileB = b.file || b.file_path || '';

  if (fileA && fileB) {
    if (fileA === fileB) {
      totalSim += weights.file * 1.0; // Same file
    } else {
      // Same directory
      const dirA = fileA.split('/').slice(0, -1).join('/');
      const dirB = fileB.split('/').slice(0, -1).join('/');
      if (dirA === dirB && dirA.length > 0) {
        totalSim += weights.file * 0.5;
      }
    }
    totalWeight += weights.file;
  }

  // 2. Type similarity
  const typeA = a.type || '';
  const typeB = b.type || '';

  if (typeA && typeB) {
    if (typeA === typeB) {
      totalSim += weights.type * 1.0;
    } else {
      // Partial similarity for related types
      if ((SIMILARITY_DEF_TYPES.has(typeA) && SIMILARITY_DEF_TYPES.has(typeB)) ||
          (SIMILARITY_METHOD_TYPES.has(typeA) && SIMILARITY_METHOD_TYPES.has(typeB))) {
        totalSim += weights.type * 0.5;
      }
    }
    totalWeight += weights.type;
  }

  // 3. Package/namespace similarity (extract from file path)
  if (fileA && fileB) {
    const pkgA = extractPackage(fileA);
    const pkgB = extractPackage(fileB);

    if (pkgA && pkgB && pkgA === pkgB) {
      totalSim += weights.package * 1.0;
    } else if (pkgA && pkgB) {
      // Partial match (shared prefix)
      const partsA = pkgA.split('.');
      const partsB = pkgB.split('.');
      const commonParts = partsA.filter((p, i) => partsB[i] === p).length;
      const maxParts = Math.max(partsA.length, partsB.length);
      if (commonParts > 0) {
        totalSim += weights.package * (commonParts / maxParts);
      }
    }
    totalWeight += weights.package;
  }

  // 4. Semantic similarity (if embeddings available)
  if (a._embedding && b._embedding) {
    const cosSim = cosineSimilarity(a._embedding, b._embedding);
    totalSim += weights.semantic * Math.max(0, cosSim);
    totalWeight += weights.semantic;
  }

  return totalWeight > 0 ? totalSim / totalWeight : 0;
}

/**
 * Extract package/namespace from file path.
 *
 * Examples:
 *   "com/example/service/AuthService.java" → "com.example.service"
 *   "src/main/java/com/foo/Bar.java" → "com.foo"
 *
 * @param {string} filePath - File path
 * @returns {string|null} Package name or null
 */
function extractPackage(filePath) {
  // Handle Java package extraction
  const javaMatch = filePath.match(/(?:src\/main\/java\/|src\/)?(.+)\/[^/]+\.java$/);
  if (javaMatch) {
    return javaMatch[1].replace(/\//g, '.');
  }

  // Handle TypeScript/JavaScript (use directory)
  const jsMatch = filePath.match(/(?:src\/)?(.+)\/[^/]+\.[jt]sx?$/);
  if (jsMatch) {
    return jsMatch[1].replace(/\//g, '.');
  }

  return null;
}

/**
 * Compute cosine similarity between two vectors.
 *
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Cosine similarity [-1, 1]
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dotProduct / denom : 0;
}

/**
 * Apply MMR (Maximal Marginal Relevance) reranking.
 *
 * Iteratively selects results that maximize:
 *   MMR = λ × relevance - (1-λ) × max_similarity_to_selected
 *
 * This naturally diversifies results without hard caps:
 * - High relevance results are selected first
 * - Similar results to already selected ones are penalized
 * - No artificial blocking, just intelligent reordering
 *
 * @param {Array} results - Results sorted by relevance score
 * @param {Object} options - Configuration options
 * @param {number} options.k - Number of results to return
 * @param {number} options.lambda - Relevance vs diversity tradeoff [0, 1]
 * @param {Object} options.weights - Feature weights for similarity
 * @returns {{results: Array, stats: Object}}
 */
export function applyMMR(results, options = {}) {
  const {
    k = 10,
    lambda = MMR_CONFIG.lambda,
    weights = MMR_CONFIG.weights,
    minRelevance = MMR_CONFIG.minRelevance,
    maxCandidates = MMR_CONFIG.maxCandidates,
  } = options;

  if (!results || results.length === 0) {
    return { results: [], stats: { selected: 0, candidates: 0, lambda } };
  }

  // Filter by minimum relevance and limit candidates
  const candidates = results
    .filter(r => r.score >= minRelevance)
    .slice(0, maxCandidates);

  if (candidates.length === 0) {
    return { results: [], stats: { selected: 0, candidates: 0, lambda } };
  }

  // Normalize relevance scores to [0, 1] for MMR calculation
  const maxScore = Math.max(...candidates.map(r => r.score));
  const minScore = Math.min(...candidates.map(r => r.score));
  const scoreRange = maxScore - minScore || 1;

  const normalized = candidates.map(r => ({
    ...r,
    _normalizedRelevance: (r.score - minScore) / scoreRange,
  }));

  // Selected results (output)
  const selected = [];
  // Remaining candidates (pool)
  const remaining = new Set(normalized.map((_, i) => i));

  // Stats
  let totalDiversityPenalty = 0;
  let reorderCount = 0;

  // Iteratively select k results
  while (selected.length < k && remaining.size > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;
    // Highest-relevance tracking shares the same pass (same iteration order
    // and strict-> comparison as the reduce it replaces).
    let highestRelevanceIdx = -1;

    // Find the candidate with highest MMR score
    for (const idx of remaining) {
      const candidate = normalized[idx];

      if (highestRelevanceIdx === -1
          || candidate._normalizedRelevance > normalized[highestRelevanceIdx]._normalizedRelevance) {
        highestRelevanceIdx = idx;
      }

      // Compute max similarity to already selected results
      let maxSim = 0;
      for (const selectedResult of selected) {
        const sim = computeSimilarity(candidate, selectedResult, weights);
        maxSim = Math.max(maxSim, sim);
      }

      // MMR score: λ × relevance - (1-λ) × max_similarity
      const mmrScore = lambda * candidate._normalizedRelevance - (1 - lambda) * maxSim;

      if (mmrScore > bestMMR) {
        bestMMR = mmrScore;
        bestIdx = idx;
      }
    }

    if (bestIdx >= 0) {
      const selectedCandidate = normalized[bestIdx];

      if (bestIdx !== highestRelevanceIdx) {
        reorderCount++;
        totalDiversityPenalty += normalized[highestRelevanceIdx]._normalizedRelevance - selectedCandidate._normalizedRelevance;
      }

      // Add MMR metadata
      selected.push({
        ...selectedCandidate,
        _mmrRank: selected.length + 1,
        _mmrScore: bestMMR,
      });

      remaining.delete(bestIdx);
    }
  }

  // Clean up internal fields
  const cleanedResults = selected.map(r => {
    const { _normalizedRelevance, ...clean } = r;
    return clean;
  });

  return {
    results: cleanedResults,
    stats: {
      selected: selected.length,
      candidates: candidates.length,
      lambda,
      reorderCount,
      avgDiversityPenalty: reorderCount > 0 ? totalDiversityPenalty / reorderCount : 0,
    },
  };
}

/**
 * Check if MMR diversification should be applied.
 *
 * Criteria:
 * 1. More than 10 results (otherwise not enough to diversify)
 * 2. High concentration of results from same file or type
 *
 * @param {Array} results - Search results
 * @returns {boolean} True if MMR is recommended
 */
export function shouldApplyMMR(results) {
  if (!results || results.length < 10) return false;

  // Check for file concentration in top 20
  const fileCounts = new Map();
  const typeCounts = new Map();

  for (const r of results.slice(0, 20)) {
    const file = r.file || r.file_path || '';
    const type = r.type || '';

    fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  }

  // If any file has >40% of top 20 results, apply MMR
  const maxFileCount = Math.max(...fileCounts.values());
  if (maxFileCount >= 8) return true;

  // If any non-definition type has >50% of top 20 results
  const defTypes = new Set(['class', 'interface', 'struct', 'enum']);
  for (const [type, count] of typeCounts) {
    if (count >= 10 && !defTypes.has(type)) {
      return true;
    }
  }

  return false;
}

/**
 * Get recommended lambda based on query intent.
 *
 * @param {string} routerMode - Query router mode
 * @param {number} routerConfidence - Router confidence
 * @returns {number} Recommended lambda value
 */
export function getLambdaForIntent(routerMode, routerConfidence) {
  switch (routerMode) {
    case 'lexical':
      // Identifier search: prioritize relevance very strongly
      return routerConfidence >= 0.8 ? 0.95 : 0.9;

    case 'semantic':
      // Conceptual search: still relevance-heavy, mild diversity
      return 0.85;

    case 'hybrid':
      // Mixed: relevance-focused with diversity consideration
      return 0.9;

    case 'structural':
      // Relationship queries: very relevance-focused
      return 0.9;

    default:
      return 0.9;
  }
}

export default {
  applyMMR,
  shouldApplyMMR,
  computeSimilarity,
  getLambdaForIntent,
  MMR_CONFIG,
};
