/**
 * Search Post-Processing Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains all post-retrieval processing logic that was inlined in search().
 *
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 */

import { SEISMIC_CONFIG, DB_PATHS } from './config.js';
import { expandResults } from './graph-expansion.js';
import { QualityScorer } from './quality-scorer.js';
import { classifyIntent, getIntentPolicy } from './intent-router.js';
import { recordQueryTelemetry } from './embedding-cache.js';

// Threshold (ms) below which a lexical sub-query is considered a "cache hit"
// for telemetry purposes. Derived empirically: FTS5 page-cache hits typically
// complete in <2ms; 5ms gives headroom for slow I/O without inflating miss rates.
const LEXICAL_HIT_THRESHOLD_MS = 5;

// =============================================================================
// Post-retrieval processing
// =============================================================================

/**
 * Apply all post-retrieval processing to search results.
 *
 * This function encapsulates the post-search pipeline:
 * 1. Merge semantic stats into main stats
 * 2. SEISMIC sparse vector integration
 * 3. Graph expansion
 * 4. Translation fallback
 * 5. Quality scoring
 * 6. Intent policy application
 * 7. Telemetry recording
 *
 * Uses `this` extensively — must be wired onto prototype as _applyPostRetrieval.
 *
 * @param {Array} results - Raw search results
 * @param {string} query - Original search query
 * @param {Object} options - Search options from the caller
 * @param {Object} searchContext - Context built during search
 * @returns {Promise<{results: Array, stats: Object}>}
 */
export async function applyPostRetrieval(results, query, options, searchContext) {
  const {
    k = 10,
    translate = 'auto',
    graphExpandOptions = {},
    adaptiveHop2 = false,
    qualityWeight = this.qualityWeight,
  } = options;

  const {
    stats,
    semanticStats,
    searchMode,
    effectiveGraphExpand,
    intentPolicy,
    start,
  } = searchContext;

  // Merge semantic stats (embedding/rerank) into main stats for CostTracker.
  if (semanticStats) {
    // Validate embedding stats have required fields for cost tracking
    if (semanticStats.embedding &&
        typeof semanticStats.embedding.tokens === 'number' &&
        typeof semanticStats.embedding.provider === 'string') {
      stats.embedding = semanticStats.embedding;
    } else if (semanticStats.embedding) {
      // Partial embedding stats - fill in defaults, preserve latency_us for telemetry
      stats.embedding = {
        source: semanticStats.embedding.source || 'unknown',
        tokens: semanticStats.embedding.tokens || Math.ceil(query.length / 4),
        provider: semanticStats.embedding.provider || 'voyage',
        cached: semanticStats.embedding.cached || false,
        latency_us: semanticStats.embedding.latency_us,
      };
    }

    // Validate rerank stats
    if (semanticStats.rerank) {
      stats.rerank = {
        skipped: semanticStats.rerank.skipped ?? true,
        provider: semanticStats.rerank.provider || null,
        documents: semanticStats.rerank.documents || 0,
        tokens: semanticStats.rerank.tokens || 0,
        reason: semanticStats.rerank.reason,
      };
    }

    if (semanticStats.stages) stats.stages = semanticStats.stages;
  }

  // =========================================================================
  // SEISMIC Sparse Vector Path (gated by SEISMIC_CONFIG.enabled)
  // =========================================================================
  // Prerequisites: sparse encoder (SPLADE or code-specific) not yet available.
  // When enabled, will provide third retrieval pathway for learned sparse embeddings.
  // See docs/AST_OPTIMIZATIONS.md #12 for architecture and integration plan.
  if (SEISMIC_CONFIG.enabled && this._seismicIndex) {
    try {
      const sparseStart = Date.now();
      // TODO: Generate sparse query embedding via encoder
      // const sparseQuery = await sparseEncoder.encode(query);
      // const sparseResults = this._seismicIndex.query(sparseQuery, k);
      // results = reciprocalRankFuse(results, sparseResults, SEISMIC_CONFIG.weight);
      stats.seismic = { enabled: true, latency_ms: Date.now() - sparseStart, status: 'awaiting_sparse_encoder' };
    } catch (err) {
      stats.seismic = { enabled: true, error: err.message };
    }
  }

  // =========================================================================
  // Graph Expansion (post-processing)
  // =========================================================================
  if (effectiveGraphExpand !== 'none' && this.hasGraphIndex && Array.isArray(results) && results.length > 0) {
    try {
      await this.graphSearch.init();
      const graphDb = this.graphSearch.db;
      if (graphDb) {
        const expandStart = Date.now();
        // Pass intent-derived edge types unless explicitly overridden.
        const intentEdgeTypes = intentPolicy?.edgeTypePriority
          ? new Set(intentPolicy.edgeTypePriority)
          : undefined;
        results = expandResults(graphDb, results, {
          expandMode: effectiveGraphExpand,
          adaptiveHop2,
          ...(intentEdgeTypes && !graphExpandOptions.edgeTypes ? { edgeTypes: intentEdgeTypes } : {}),
          ...graphExpandOptions,
        });
        stats.graphExpansion = {
          mode: effectiveGraphExpand,
          latency_ms: Date.now() - expandStart,
          total: results.length,
        };
      }
    } catch (err) {
      this.log(`GraphExpansion: ${err.message}`);
      stats.graphExpansion = { mode: effectiveGraphExpand, error: err.message };
    }
  }

  // =========================================================================
  // Phase 4: Translation Fallback
  // =========================================================================
  if (this.enableTranslationFallback && translate !== 'false') {
    const shouldFallback = this.translationFallback.shouldTriggerFallback(
      results, query, { translate }
    );

    if (shouldFallback) {
      this.log('TranslationFallback: Triggered');
      const translationResult = await this.translationFallback.translate(query);
      stats.translation = {
        triggered: true,
        original: query,
        translated: translationResult.bestTranslation,
        tier: translationResult.tier,
        changed: translationResult.changed,
        latency_ms: translationResult.totalLatency_ms,
      };

      // Retry search with translated query if translation changed it
      if (translationResult.changed && translationResult.bestTranslation !== query) {
        this.log(`TranslationFallback: Retrying with "${translationResult.bestTranslation}"`);

        // Get all translation variants to try
        const translatedQueries = this.translationFallback.getSearchQueries(translationResult);

        for (const translatedQuery of translatedQueries.slice(0, 2)) { // Max 2 retries
          const retryResult = await this.searchWithoutFallback(translatedQuery, {
            k, mode: options.mode, expand: options.expand, rerank: options.rerank,
            fusion: options.fusion, useColBERT: options.useColBERT,
          });

          if (retryResult.results && retryResult.results.length > 0) {
            // Priority merge: translated results first, filter out invalid original results
            const translatedKeys = new Set(retryResult.results.map(r => this.getResultKey(r)));

            // Filter original results: keep only valid ones that aren't duplicates
            const validOriginal = results.filter(r => {
              if (translatedKeys.has(this.getResultKey(r))) return false;
              if (!r.file && !r.name) return false;
              return true;
            });

            results = [...retryResult.results, ...validOriginal];
            stats.translation.retryQuery = translatedQuery;
            stats.translation.resultsAdded = retryResult.results.length;
            stats.translation.retryLatency_ms = retryResult.stats.total_ms;
            this.log(`TranslationFallback: Added ${retryResult.results.length} results from "${translatedQuery}"`);
            break; // Found results, stop retrying
          }
        }
      }
    } else {
      stats.translation = { triggered: false };
    }
  }

  // =========================================================================
  // Quality-Aware Chunk Weighting (opt-in)
  // =========================================================================
  if (qualityWeight > 0 && Array.isArray(results) && results.length > 0) {
    const qStart = Date.now();
    if (!this._qualityScorer) {
      this._qualityScorer = new QualityScorer({
        dbPath: this.graphSearch?.dbPath || DB_PATHS.codeGraph,
      });
    }
    results = this._qualityScorer.scoreResults(results);

    // Blend: final = (1 - w) * original + w * quality
    const w = Math.max(0, Math.min(1, qualityWeight));
    for (const r of results) {
      const orig = r.score ?? r.hybridScore ?? r.rerankScore ?? 0;
      r._preQualityScore = orig;
      r.score = (1 - w) * orig + w * r.quality_score;
    }
    results.sort((a, b) => b.score - a.score);

    // Per-result quality factor logging (top 5)
    if (this.verbose) {
      for (const r of results.slice(0, 5)) {
        this.log(`Quality[${r.metadata?.symbol || r.name || '?'}]: score=${r.quality_score?.toFixed(3)} factors=${JSON.stringify(r.quality_factors)}`);
      }
    }

    stats.qualityScoring = {
      weight: w,
      latency_ms: Date.now() - qStart,
      topFactors: results.slice(0, 5).map(r => ({
        symbol: r.metadata?.symbol || r.name,
        score: r.quality_score,
        factors: r.quality_factors,
      })),
    };
  }

  // =========================================================================
  // Apply intent policy — chunkTypeBoosts, maxResults, rerankerWeight
  // =========================================================================
  if (intentPolicy && Array.isArray(results) && results.length > 0) {
    // (a) chunkTypeBoosts: Multiply result scores by per-chunk-type boost factors
    if (intentPolicy.chunkTypeBoosts && Object.keys(intentPolicy.chunkTypeBoosts).length > 0) {
      for (const r of results) {
        const chunkType = r.metadata?.chunk_type || r.chunk_type || r.type;
        const boost = intentPolicy.chunkTypeBoosts[chunkType];
        if (boost && boost !== 1.0) {
          r._preIntentBoostScore = r.score;
          r.score = (r.score || 0) * boost;
        }
      }
      results.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // (b) rerankerWeight: Modulate rerankScore blending when present
    if (intentPolicy.rerankerWeight != null) {
      const rw = intentPolicy.rerankerWeight;
      for (const r of results) {
        if (r.rerankScore != null && r.originalScore != null) {
          r._preIntentRerankScore = r.score;
          r.score = rw * r.rerankScore + (1 - rw) * r.originalScore;
        }
      }
      results.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // (c) maxResults: Cap output size per intent policy
    if (intentPolicy.maxResults) {
      const effectiveK = Math.min(k, intentPolicy.maxResults);
      results = results.slice(0, effectiveK);
    }
  }

  stats.total_ms = Date.now() - start;
  stats.results_count = Array.isArray(results) ? results.length : 0;

  // Log performance
  if (this.timing) {
    this.logPerformance(stats);
  }

  // Record per-mode telemetry for vocabulary prewarm analytics (Step 0)
  const telemetryMode = searchMode === 'structural' ? 'lexical' : searchMode;
  const latency = stats.total_ms;
  const embeddingSource = stats.embedding?.source || null;
  const embedLatencyMs = (stats.embedding?.latency_us || 0) / 1000;
  const { lexHit, semHit, cacheHit } = computeCacheHit(telemetryMode, {
    latency,
    embedLatencyMs,
    directLexMs: stats.lexicalLatencyMs,
    embeddingSource,
    lexicalHitThresholdMs: LEXICAL_HIT_THRESHOLD_MS,
  });
  recordQueryTelemetry(
    telemetryMode, cacheHit, latency, query, embeddingSource,
    telemetryMode === 'hybrid' ? lexHit : undefined,
    telemetryMode === 'hybrid' ? semHit : undefined,
  ).catch(() => {}); // best-effort, never block search

  return { results, stats };
}

/**
 * Compute per-mode cache hit signals for telemetry.
 * Extracted as a pure helper to keep logic testable and auditable.
 */
export function computeCacheHit(mode, {
  latency = 0,
  embedLatencyMs = 0,
  directLexMs = null,
  embeddingSource = null,
  lexicalHitThresholdMs = LEXICAL_HIT_THRESHOLD_MS,
} = {}) {
  // Use direct lexical timing when available; fallback to residual heuristic.
  const lexSubLatency = (mode === 'hybrid' && directLexMs != null)
    ? directLexMs
    : mode === 'hybrid'
      ? Math.max(0, latency - embedLatencyMs)
      : latency;

  const lexHit = lexSubLatency < lexicalHitThresholdMs;
  const semHit = embeddingSource === 'vocabulary' || embeddingSource === 'semantic-cache';
  const cacheHit = mode === 'lexical'
    ? lexHit
    : mode === 'semantic'
      ? semHit
      : mode === 'hybrid'
        ? lexHit && semHit
        : false;

  return { lexSubLatency, lexHit, semHit, cacheHit };
}
