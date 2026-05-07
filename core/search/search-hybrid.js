/**
 * Search Hybrid Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains hybrid search implementations (V2 and legacy).
 *
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 */

import { routeQuery } from '../query/query-router.js';
import { applyMMR, shouldApplyMMR, getLambdaForIntent } from '../ranking/mmr.js';
import { applyFileKindRanking, applyResultDemotions, classifyFileKindIntent, detectFileKind } from '../ranking/file-kind-ranking.js';
import { injectAnchorCandidates } from './search-anchor.js';
import { runRRFFallback } from './search-rrf.js';

const QUERY_SCAFFOLD_RE = /^(?:where|when|how)\s+(?:does|do|did|is|are|was|were|can|could|should)?\s*/i;
const IMPLEMENTATION_VERB_RE = /^(?:abort|bind|build|call|compute|create|decode|decide|detect|encode|handle|load|parse|parsed|redirect|register|run|search|skip|transform|validate|write)s?\b/i;
const QUERY_STOPWORDS = new Set([
  'a', 'an', 'are', 'can', 'could', 'did', 'do', 'does', 'for', 'from',
  'how', 'in', 'into', 'is', 'of', 'on', 'should', 'the', 'to', 'was',
  'were', 'when', 'where', 'with',
]);

function hasAblation(ablations, name) {
  return ablations instanceof Set
    ? ablations.has(name)
    : Array.isArray(ablations) && ablations.includes(name);
}

function envFloat(name, fallback, min = 0, max = 1) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function rewriteImplementationQuery(query) {
  if (classifyFileKindIntent(query) !== 'implementation') return null;
  const stripped = String(query || '').trim().replace(QUERY_SCAFFOLD_RE, '').trim();
  if (!stripped) return null;

  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length >= 3 && /^[A-Z][A-Za-z0-9_.-]*$/.test(words[0]) && IMPLEMENTATION_VERB_RE.test(words[1])) {
    words.shift();
  }

  const compact = words.filter(word => {
    const normalized = word.toLowerCase().replace(/^[^\w]+|[^\w/.-]+$/g, '');
    return normalized && !QUERY_STOPWORDS.has(normalized);
  }).join(' ');

  return compact && compact !== query ? compact : null;
}

function resultFileKind(result) {
  return detectFileKind(
    result?.file
    || result?.file_path
    || result?.path
    || result?.metadata?.file
    || result?.metadata?.file_path
    || result?.metadata?.path
    || ''
  );
}

function implementationRetryReason(query, results) {
  if (classifyFileKindIntent(query) !== 'implementation') return null;
  if (!Array.isArray(results) || results.length === 0) return 'empty_results';

  const window = results.slice(0, Math.min(5, results.length));
  const hasImplementation = window.some(result => resultFileKind(result) === 'implementation');
  const hasDemotable = window.some(result => resultFileKind(result) !== 'implementation');
  return !hasImplementation && hasDemotable ? 'no_implementation_in_top_results' : null;
}

// =============================================================================
// Hybrid Search V2
// =============================================================================

/**
 * Hybrid search V2 with raw paths + post-fusion boosts (PHASE_1_FIXES Change 5)
 *
 * Uses bm25SearchRaw() for lexical path to ensure fair fusion.
 * Applies boosts AFTER fusion so both paths benefit equally.
 *
 * Uses `this` extensively.
 */
export async function hybridSearchV2(query, options = {}) {
  const { k = 10, useLateInteraction = this.useLateInteraction, routing: passedRouting } = options;

  // P9 FIX: Use passed routing or compute if not provided
  const routing = passedRouting || routeQuery(query);
  const routeType = routing.mode === 'hybrid' ? 'mixed' : routing.mode;

  // Step 1: Retrieval from both paths (raw scores, no pre-fusion boosts)
  // Uses bm25SearchRaw() (not graphExpandedSearch) so fusion sees pure BM25 scores
  // without synthetic graph-expansion scores polluting the distribution.
  const [lexicalSearchResult, semanticSearchResult] = await Promise.all([
    this.graphSearch.bm25SearchRaw(query, 50),
    this.semanticSearch(query, {
      k: 50,
      rerank: false,
      useLateInteraction,
      format: options.format,
      ablations: options.ablations,
    }),
  ]);

  const lexicalResults = lexicalSearchResult.results.map(r => ({
    ...r,
    searchPath: 'lexical',
  }));
  const semanticResults = semanticSearchResult.results;
  const semanticStats = semanticSearchResult.stats;
  // P1.3 FIX: Capture direct lexical latency for accurate telemetry
  const lexicalLatencyMs = lexicalSearchResult.latency ?? null;

  // Step 2: Robust CC fusion with RRF fallback for edge cases
  const fusionAlpha = options.fusionAlpha ?? (
    routing.rawMode === 'semantic'
      ? envFloat('SWEET_SEARCH_COLLAPSED_SEMANTIC_ALPHA', undefined)
      : undefined
  );
  const { results: fused, method, fallbackReason } = this.robustCCFusion(
    lexicalResults,
    semanticResults,
    routeType,
    fusionAlpha == null ? undefined : { alpha: fusionAlpha }
  );

  // Step 2.5: Identifier-Anchored Retrieval (IAR).
  // Couples dense fusion with an exact-name symbol lookup so abstract
  // natural-language queries that mention a real entity name can land on
  // that entity even when the encoder ranked something tangentially-similar
  // higher. Mirrors the Aider repo-map / Cody+SCIP / Cursor recipe.
  // Purely additive: only surfaces entities that exist in the index, deduped
  // against the fused set. Disable via ablations 'no-anchor-injection' or
  // env SWEET_SEARCH_DISABLE_IAR=1 (kill switch — overrides the format-based
  // default for ablation experiments).
  const iarKilled = process.env.SWEET_SEARCH_DISABLE_IAR === '1'
    || hasAblation(options.ablations, 'no-anchor-injection');
  const shouldInjectAnchors = !iarKilled && (
    options.anchorInjection === true
    || options.format === 'agent'
    || process.env.SWEET_SEARCH_ANCHOR_INJECTION === '1'
  );
  const { results: anchored, stats: anchorStats } = shouldInjectAnchors
    ? injectAnchorCandidates(fused, query, {
        codeGraphRepo: this.codeGraphRepo,
        lateInteractionIndex: this.lateInteractionIndex,
        ablations: options.ablations,
        allowPlainTitlecase: options.format === 'agent',
      })
    : { results: fused, stats: { skipped: true, reason: 'disabled_for_non_agent_search' } };

  // Step 3: Apply post-fusion boosts uniformly (both paths benefit equally)
  const boosted = this.applyPostFusionBoosts(anchored, query, routing.mode, routing.confidence, {
    format: options.format,
  });

  // Step 3.5: Apply source-vs-doc/test/config preference before the top-k cut.
  // The post-retrieval pass has the same guard, but hybrid used to slice first,
  // so docs/tests/tiny YAML could occupy top-1 and hide implementation chunks.
  const fileKindIntent = classifyFileKindIntent(query);
  const rankedByFileKind = applyFileKindRanking(boosted, {
    intent: fileKindIntent,
    window: options.fileKindWindow ?? 100,
    docFactor: options.hybridDocFactor ?? 0.35,
    testFactor: options.hybridTestFactor ?? 0.35,
    typeFactor: options.hybridTypeFactor ?? 0.70,
    ancillaryFactor: options.hybridAncillaryFactor ?? 0.15,
    tinyAncillaryFactor: options.hybridTinyAncillaryFactor ?? 0.05,
  });
  const demoted = applyResultDemotions(rankedByFileKind, {
    query,
    window: options.resultDemotionWindow ?? 100,
    ablations: options.ablations,
    format: options.format,
    projectRoot: this.projectRoot,
    codeGraphRepo: this.codeGraphRepo,
  });

  // Step 4: MMR Diversification (replaces flood control)
  let diversified = demoted;
  let mmrStats = null;

  const useMMR = (options.useMMR ?? true) && !hasAblation(options.ablations, 'no-mmr');
  if (useMMR && shouldApplyMMR(demoted)) {
    const lambda = getLambdaForIntent(routing.mode, routing.confidence);
    const mmrResult = applyMMR(demoted, {
      k: Math.min(k * 2, demoted.length), // Get more candidates for diversity
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

  const retryReason = implementationRetryReason(query, results);
  if (retryReason && options.allowQueryRewrite !== false && !hasAblation(options.ablations, 'no-query-rewrite')) {
    const rewrittenQuery = rewriteImplementationQuery(query);
    if (rewrittenQuery && rewrittenQuery !== query) {
      this.log(`Hybrid rewrite retry: "${query}" -> "${rewrittenQuery}"`);
      const retry = await hybridSearchV2.call(this, rewrittenQuery, {
        ...options,
        allowQueryRewrite: false,
      });
      retry.fusionStats = {
        ...(retry.fusionStats || {}),
        queryRewrite: {
          from: query,
          to: rewrittenQuery,
          reason: retryReason,
        },
      };
      return retry;
    }
  }

  // Step 6: Multi-query BM25F + RRF tail fallback.
  // Last-resort safety net: when hybrid + IAR + rewrite-retry STILL leaves
  // top-1 below the confidence floor, the candidate list empty, or no
  // source file in top-3, fire one BM25F query per content keyword
  // and fuse with reciprocal-rank-fusion. RRF (Cormack 2009) is the
  // SOTA pattern used by SWE-grep, Polarity Omnigrep, and Cody Deep
  // Search; corpus-agnostic (no stopword denylist) and naturally
  // demotes single-keyword noise hits via rank-position weighting.
  // Disable via ablations 'no-rrf-fallback'.
  let finalResults = results;
  let fallbackStats = null;
  if (options.allowKeywordFallback !== false) {
    const fb = await runRRFFallback(results, query, {
      searcher: this,
      ablations: options.ablations,
      confidenceFloor: options.confidenceFloor,
    });
    fallbackStats = fb.stats;
    if (fb.results !== results) {
      // Re-run BOTH file-kind ranking AND content demotions on the merged
      // set so doc/test/example demotion AND tiny/test-name/entity-kind
      // rules apply to the RRF-injected chunks. Without the file-kind
      // re-pass, a test-file chunk that RRF-fused on a couple of keywords
      // would slip past the primary doc/test demotion.
      const reRanked = applyFileKindRanking(fb.results, {
        intent: fileKindIntent,
        window: options.fileKindWindow ?? 100,
        docFactor: options.hybridDocFactor ?? 0.35,
        testFactor: options.hybridTestFactor ?? 0.35,
        typeFactor: options.hybridTypeFactor ?? 0.70,
        ancillaryFactor: options.hybridAncillaryFactor ?? 0.15,
        tinyAncillaryFactor: options.hybridTinyAncillaryFactor ?? 0.05,
      });
      const remerged = applyResultDemotions(reRanked, {
        query,
        window: options.resultDemotionWindow ?? 100,
        ablations: options.ablations,
        format: options.format,
        projectRoot: this.projectRoot,
        codeGraphRepo: this.codeGraphRepo,
      });
      finalResults = remerged.slice(0, k).map(r => ({
        ...r,
        searchPath: r.searchPath || 'hybrid',
        hybridScore: r.score,
        fusionMethod: method,
      }));
      this.log(`Hybrid RRF fallback (${fb.stats.reason}, ${fb.stats.keywords.length}kw, ${fb.stats.fusedCount} fused): +${fb.stats.injected} new, +${fb.stats.boosted} boosted`);
    }
  }

  this.log(`Hybrid V2 (${method}, alpha=${finalResults[0]?.alpha?.toFixed(2) || '?'}): ${lexicalResults.length} lex + ${semanticResults.length} sem -> ${finalResults.length} final`);

  return {
    results: finalResults,
    semanticStats,
    fusionStats: {
      method,
      fallbackReason,
      mmrStats,
      routerMode: routing.mode,
      routerConfidence: routing.confidence,
      lexicalLatencyMs,
      fileKindIntent,
      fileKindRankingApplied: rankedByFileKind !== boosted,
      resultDemotionsApplied: demoted !== rankedByFileKind,
      anchorInjection: anchorStats,
      keywordFallback: fallbackStats,
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
 * - lexicalSearch() calls graphExpandedSearch internally, mixing graph-expanded
 *   entities with BM25 hits before fusion (pre-fusion expansion is wrong)
 *
 * Uses `this` extensively.
 */
export async function hybridSearch(query, options = {}) {
  const { k = 10, expand = true, rrf_k = 60, fusion = 'cc', useLateInteraction = this.useLateInteraction, routing: passedRouting } = options;

  // P9 FIX: Use passed routing or compute if not provided (avoids redundant call)
  const routing = passedRouting || routeQuery(query);
  const routeType = routing.mode === 'hybrid' ? 'mixed' : routing.mode;

  // Run both paths in parallel
  const [lexicalSearchResult, semanticSearchResult] = await Promise.all([
    this.lexicalSearch(query, { k: Math.ceil(k * 1.5), expand }),
    this.semanticSearch(query, { k: Math.ceil(k * 1.5), rerank: false, useLateInteraction }),
  ]);
  const lexicalResults = lexicalSearchResult.results;

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
