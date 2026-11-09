/**
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 */

import { routeQuery } from '../query/query-router.js';
import { applyMMR, shouldApplyMMR, getLambdaForIntent } from '../ranking/mmr.js';
import { takeDistinctSpans } from './span-dedupe.js';
import { applyFileKindRanking, applyResultDemotions, classifyFileKindIntent, detectFileKind } from '../ranking/file-kind-ranking.js';
import { injectAnchorCandidates } from './search-anchor.js';
import { runRRFFallback } from './search-rrf.js';
import { isAgentFormat } from '../infrastructure/agent-format.js';
import { hasAblation } from './ablations.js';
import { bodyLexicalSettings, composeSeeds, fuseBodyRRF, retrieveBodyLexical } from './body-lexical.js';
import { __ptStart, __ptEnd } from './stage-timing.js';

const QUERY_SCAFFOLD_RE = /^(?:where|when|how)\s+(?:does|do|did|is|are|was|were|can|could|should)?\s*/i;
const IMPLEMENTATION_VERB_RE = /^(?:abort|bind|build|call|compute|create|decode|decide|detect|encode|handle|load|parse|parsed|redirect|register|run|search|skip|transform|validate|write)s?\b/i;
const QUERY_STOPWORDS = new Set([
  'a', 'an', 'are', 'can', 'could', 'did', 'do', 'does', 'for', 'from',
  'how', 'in', 'into', 'is', 'of', 'on', 'should', 'the', 'to', 'was',
  'were', 'when', 'where', 'with',
]);

function envFloat(name, fallback, min = 0, max = 1) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function rewriteImplementationQuery(query) {
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

/**
 * Hybrid search V2 with raw paths + post-fusion boosts
 *
 * Uses bm25SearchRaw() for lexical path to ensure fair fusion.
 * Applies boosts AFTER fusion so both paths benefit equally.
 *
 * Uses `this` extensively.
 */
export async function hybridSearchV2(query, options = {}) {
  const { k = 10, useLateInteraction = this.useLateInteraction, routing: passedRouting } = options;

  const routing = passedRouting || routeQuery(query);
  const routeType = routing.mode === 'hybrid' ? 'mixed' : routing.mode;

  // Raw scores, no pre-fusion boosts.
  // Uses bm25SearchRaw() (not graphExpandedSearch) so fusion sees pure BM25 scores
  // without synthetic graph-expansion scores polluting the distribution.
  const [lexicalSearchResult, semanticSearchResult] = await Promise.all([
    this.graphSearch.bm25SearchRaw(query, 50, { format: options.format }),
    this.semanticSearch(query, {
      k: 50,
      rerank: false,
      useLateInteraction,
      format: options.format,
      ablations: options.ablations,
    }),
  ]);

  // Body-text lexical channel (agent formats only; core/search/body-lexical.js).
  const bodySettings = bodyLexicalSettings(options);
  const __t_body = __ptStart();
  const body = bodySettings
    ? retrieveBodyLexical(this.codebaseRepo, query, bodySettings)
    : { pins: [], hits: [], stats: null };
  __ptEnd('hybrid:bodyLexical', __t_body);

  const lexicalResults = lexicalSearchResult.results.map(r => ({
    ...r,
    searchPath: 'lexical',
  }));
  const semanticResults = semanticSearchResult.results;
  const semanticStats = semanticSearchResult.stats;
  const lexicalLatencyMs = lexicalSearchResult.latency ?? null;

  const fusionAlpha = options.fusionAlpha ?? (
    routing.rawMode === 'semantic'
      ? envFloat('SWEET_SEARCH_COLLAPSED_SEMANTIC_ALPHA', undefined)
      : undefined
  );
  const { results: ccFused, method, fallbackReason } = this.robustCCFusion(
    lexicalResults,
    semanticResults,
    routeType,
    fusionAlpha == null ? undefined : { alpha: fusionAlpha }
  );
  const fused = bodySettings?.rrf
    ? fuseBodyRRF(ccFused, body.hits, bodySettings.rrfWeight)
    : ccFused;

  // Identifier-Anchored Retrieval (IAR).
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
  const __t_iar = __ptStart();
  const { results: anchored, stats: anchorStats } = shouldInjectAnchors
    ? injectAnchorCandidates(fused, query, {
        codeGraphRepo: this.codeGraphRepo,
        lateInteractionIndex: this.lateInteractionIndex,
        ablations: options.ablations,
        allowPlainTitlecase: options.format === 'agent',
      })
    : { results: fused, stats: { skipped: true, reason: 'disabled_for_non_agent_search' } };
  __ptEnd('hybrid:injectAnchorCandidates', __t_iar);

  const boosted = this.applyPostFusionBoosts(anchored, query, routing.mode, routing.confidence, {
    format: options.format,
  });

  // Apply source-vs-doc/test/config preference before the top-k cut.
  // The post-retrieval pass has the same guard, but hybrid used to slice first,
  // so docs/tests/tiny YAML could occupy top-1 and hide implementation chunks.
  const agentFormat = isAgentFormat(options.format);
  const fileKindIntent = classifyFileKindIntent(query, { agentFormat });
  const __t_fk = __ptStart();
  const rankedByFileKind = applyFileKindRanking(boosted, {
    intent: fileKindIntent,
    agentFormat,
    window: options.fileKindWindow ?? 100,
    docFactor: options.hybridDocFactor ?? 0.35,
    testFactor: options.hybridTestFactor ?? 0.35,
    typeFactor: options.hybridTypeFactor ?? 0.70,
    ancillaryFactor: options.hybridAncillaryFactor ?? 0.15,
    tinyAncillaryFactor: options.hybridTinyAncillaryFactor ?? 0.05,
    _fileKindCache: options._fileKindCache,
  });
  __ptEnd('hybrid:applyFileKindRanking', __t_fk);
  const __t_dem = __ptStart();
  const demoted = applyResultDemotions(rankedByFileKind, {
    query,
    window: options.resultDemotionWindow ?? 100,
    ablations: options.ablations,
    format: options.format,
    projectRoot: this.projectRoot,
    codeGraphRepo: this.codeGraphRepo,
    _entityKindCache: options._entityKindCache,
    _entityNameCache: options._entityNameCache,
    _resultTextCache: options._resultTextCache,
    _fullFileTextCache: options._fullFileTextCache,
    _isTestSupportCache: options._isTestSupportCache,
    _isTestChunkCache: options._isTestChunkCache,
    _fileKindCache: options._fileKindCache,
  });
  __ptEnd('hybrid:applyResultDemotions', __t_dem);

  let diversified = demoted;
  let mmrStats = null;

  const useMMR = (options.useMMR ?? true) && !hasAblation(options.ablations, 'no-mmr');
  if (useMMR && shouldApplyMMR(demoted)) {
    const lambda = getLambdaForIntent(routing.mode, routing.confidence);
    const __t_mmr = __ptStart();
    const mmrResult = applyMMR(demoted, {
      k: Math.min(k * 2, demoted.length), // Get more candidates for diversity
      lambda,
    });
    __ptEnd('hybrid:applyMMR', __t_mmr);
    diversified = mmrResult.results;
    mmrStats = mmrResult.stats;

    if (mmrStats.reorderCount > 0) {
      this.log(`MMR: reordered ${mmrStats.reorderCount} results (lambda=${lambda.toFixed(2)})`);
    }
  }

  // Seed pool by distinct span: the index splits a long symbol into
  // sub-chunks that all carry the symbol's span, so several seed slots can
  // hold the same span (r3h-dgraph-23: 3 of 6 seeds were movePredicate). The
  // cut counts distinct spans, so the pool holds k of them; copies met on the
  // way stay in for the cascade (each sub-chunk has its own MaxSim tokens) and
  // the final dedupe keeps the best-scored copy (span-dedupe.js). Agent
  // formats only (CLAUDE.md format-gating; the final dedupe runs only there).
  //
  // DEFAULT OFF; SWEET_SEARCH_SEED_SPAN_COLLAPSE=1 turns it on (A/B only).
  // Re-measured on the rebased tree (cfd18b77, DEV only, seed-42 splits,
  // final dedupe + MMR + refill on in both arms): it changed top-1 on 3 of
  // 280 r3 lists (none gold-better) and lost one r3 question at k=5, the
  // ss-search default (recall@5 0.2516 -> 0.2498), for one gained at k=10
  // (0.3361 -> 0.3372). Probes dev top-1 31 = 31 either way. The final span
  // dedupe alone already removes every duplicate slot at k=5.
  const seedCollapse = process.env.SWEET_SEARCH_SEED_SPAN_COLLAPSE === '1'
    && isAgentFormat(options.format);
  const bodyPins = body.pins;
  const bodyPool = bodySettings?.pool ? body.hits.slice(0, bodySettings.poolN) : [];
  const withBody = (list) => (bodyPins.length > 0 || bodyPool.length > 0
    ? composeSeeds(list, k, bodyPins, bodyPool)
    : list.slice(0, k));
  // Pins apply on the span-collapse arm too: an A/B with collapse on must not
  // silently drop them.
  const collapsed = seedCollapse && !hasAblation(options.ablations, 'no-span-dedupe')
    ? takeDistinctSpans(diversified, k)
    : null;
  const seeds = collapsed
    ? (bodyPins.length > 0 || bodyPool.length > 0
      ? composeSeeds(collapsed, collapsed.length, bodyPins, bodyPool)
      : collapsed)
    : withBody(diversified);

  const results = seeds.map(r => ({
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

  // Multi-query BM25F + RRF tail fallback.
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
    const __t_rrf = __ptStart();
    const fb = await runRRFFallback(results, query, {
      searcher: this,
      format: options.format,
      ablations: options.ablations,
      confidenceFloor: options.confidenceFloor,
    });
    __ptEnd('hybrid:runRRFFallback', __t_rrf);
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
        _entityKindCache: options._entityKindCache,
        _entityNameCache: options._entityNameCache,
        _resultTextCache: options._resultTextCache,
        _fullFileTextCache: options._fullFileTextCache,
        _isTestSupportCache: options._isTestSupportCache,
        _isTestChunkCache: options._isTestChunkCache,
        _fileKindCache: options._fileKindCache,
      });
      finalResults = withBody(remerged).map(r => ({
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
      bodyLexical: body.stats,
    },
  };
}
