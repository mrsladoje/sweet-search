/**
 * Search Hybrid Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains hybrid search implementations (V2 and legacy).
 *
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 */

import { routeQuery } from './query-router.js';
import { applyMMR, shouldApplyMMR, getLambdaForIntent } from './mmr.js';

// =============================================================================
// Hybrid Search V2
// =============================================================================

/**
 * Hybrid search V2 with raw paths + post-fusion boosts (PHASE_1_FIXES Change 5)
 *
 * Uses bm25Search(skipBoosts=true) for lexical path to ensure fair fusion.
 * Applies boosts AFTER fusion so both paths benefit equally.
 *
 * Uses `this` extensively.
 */
export async function hybridSearchV2(query, options = {}) {
  const { k = 10, useColBERT = this.useColBERT, routing: passedRouting } = options;

  // P9 FIX: Use passed routing or compute if not provided
  const routing = passedRouting || routeQuery(query);
  const routeType = routing.mode === 'hybrid' ? 'mixed' : routing.mode;

  // Step 1: Retrieval from both paths (raw scores, no pre-fusion boosts)
  const [lexicalSearchResult, semanticSearchResult] = await Promise.all([
    this.graphSearch.graphExpandedSearch(query, { k: 50, expand: true, skipBoosts: true }),
    this.semanticSearch(query, { k: 50, rerank: false, useColBERT }),
  ]);

  // Normalize lexical results format (graphExpandedSearch returns { results, stats })
  const lexicalResults = (lexicalSearchResult.results || lexicalSearchResult).map(r => ({
    ...r,
    searchPath: 'lexical',
  }));
  const semanticResults = semanticSearchResult.results;
  const semanticStats = semanticSearchResult.stats;

  // Step 2: Robust CC fusion with RRF fallback for edge cases
  const { results: fused, method, fallbackReason } = this.robustCCFusion(
    lexicalResults,
    semanticResults,
    routeType
  );

  // Step 3: Apply post-fusion boosts uniformly (both paths benefit equally)
  const boosted = this.applyPostFusionBoosts(fused, query, routing.mode, routing.confidence);

  // Step 4: MMR Diversification (replaces flood control)
  let diversified = boosted;
  let mmrStats = null;

  const useMMR = options.useMMR ?? true; // Enable by default
  if (useMMR && shouldApplyMMR(boosted)) {
    const lambda = getLambdaForIntent(routing.mode, routing.confidence);
    const mmrResult = applyMMR(boosted, {
      k: Math.min(k * 2, boosted.length), // Get more candidates for diversity
      lambda,
    });
    diversified = mmrResult.results;
    mmrStats = mmrResult.stats;

    if (mmrStats.reorderCount > 0) {
      this.log(`MMR: reordered ${mmrStats.reorderCount} results (lambda=${lambda.toFixed(2)})`);
    }
  }

  const results = diversified.slice(0, k).map(r => ({
    ...r,
    searchPath: 'hybrid',
    hybridScore: r.score,
    fusionMethod: method,
  }));

  this.log(`Hybrid V2 (${method}, alpha=${results[0]?.alpha?.toFixed(2) || '?'}): ${lexicalResults.length} lex + ${semanticResults.length} sem -> ${results.length} final`);

  return {
    results,
    semanticStats,
    fusionStats: {
      method,
      fallbackReason,
      mmrStats,
      routerMode: routing.mode,
      routerConfidence: routing.confidence,
    },
  };
}

// =============================================================================
// Legacy Hybrid Search
// =============================================================================

/**
 * @deprecated Use hybridSearchV2() instead - this method has architectural issues:
 * - Applies boosts during lexical retrieval (unfair to semantic path)
 * - Uses naive min-max normalization (vulnerable to outliers)
 * - No RRF fallback for edge cases
 *
 * Uses `this` extensively.
 */
export async function hybridSearch(query, options = {}) {
  const { k = 10, expand = true, rrf_k = 60, fusion = 'cc', useColBERT = this.useColBERT, routing: passedRouting } = options;

  // P9 FIX: Use passed routing or compute if not provided (avoids redundant call)
  const routing = passedRouting || routeQuery(query);
  const routeType = routing.mode === 'hybrid' ? 'mixed' : routing.mode;

  // Run both paths in parallel
  const [lexicalResults, semanticSearchResult] = await Promise.all([
    this.lexicalSearch(query, { k: Math.ceil(k * 1.5), expand }),
    this.semanticSearch(query, { k: Math.ceil(k * 1.5), rerank: false, useColBERT }),
  ]);

  // P0 FIX: Extract semantic results and stats
  const semanticResults = semanticSearchResult.results;
  const semanticStats = semanticSearchResult.stats;

  let results;

  if (fusion === 'cc') {
    // Convex Combination fusion (default, +7-18% MRR)
    const ccResults = this.convexCombination(lexicalResults, semanticResults, routeType);
    results = ccResults.slice(0, k).map(r => ({
      ...r,
      searchPath: 'hybrid',
      hybridScore: r.ccScore,
      fusionMethod: 'cc',
    }));

    this.log(`CC fusion (alpha=${results[0]?.alpha?.toFixed(2) || 0.55}): ${lexicalResults.length} lexical + ${semanticResults.length} semantic -> ${results.length} merged`);
  } else {
    // RRF fallback
    const rrfScores = new Map();

    // Add lexical ranks (1-indexed for RRF formula)
    for (let rank = 0; rank < lexicalResults.length; rank++) {
      const result = lexicalResults[rank];
      const key = this.getResultKey(result);
      const rrfContrib = 1 / (rrf_k + rank + 1);

      rrfScores.set(key, {
        ...result,
        rrfScore: rrfContrib,
        sources: ['lexical'],
        lexicalRank: rank + 1,
        lexicalScore: result.score,
      });
    }

    // Add semantic ranks (merge with existing or create new)
    for (let rank = 0; rank < semanticResults.length; rank++) {
      const result = semanticResults[rank];
      const key = this.getResultKey(result);
      const rrfContrib = 1 / (rrf_k + rank + 1);

      const existing = rrfScores.get(key);
      if (existing) {
        existing.rrfScore += rrfContrib;
        existing.sources.push('semantic');
        existing.semanticRank = rank + 1;
        existing.semanticScore = result.score;
      } else {
        rrfScores.set(key, {
          ...result,
          rrfScore: rrfContrib,
          sources: ['semantic'],
          semanticRank: rank + 1,
          semanticScore: result.score,
        });
      }
    }

    results = Array.from(rrfScores.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, k)
      .map(r => ({
        ...r,
        searchPath: 'hybrid',
        hybridScore: r.rrfScore,
        fusionMethod: 'rrf',
      }));

    this.log(`RRF fusion: ${lexicalResults.length} lexical + ${semanticResults.length} semantic -> ${results.length} merged`);
  }

  // P0 FIX: Return both results and semanticStats for CostTracker
  return { results, semanticStats };
}
