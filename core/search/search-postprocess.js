/**
 * Search Post-Processing Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains all post-retrieval processing logic that was inlined in search().
 *
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 */

import { readFileSync } from 'fs';
import { SEISMIC_CONFIG, DB_PATHS } from '../infrastructure/config/index.js';
import { expandResults } from '../graph/graph-expansion.js';
import { int8CosineSimilarity } from '../embedding/embedding-service.js';
import { QualityScorer } from '../ranking/quality-scorer.js';
import { classifyIntent, getIntentPolicy } from '../query/intent-router.js';
import { applyFileKindRanking, applyResultDemotions, classifyFileKindIntent } from '../ranking/file-kind-ranking.js';
import { recordQueryTelemetry } from '../embedding/embedding-cache.js';
import { expandAliases } from './dedup/sibling-expander.js';

/**
 * Min-max normalize an array of scores to [0, 1].
 * Returns 0.5 for all values if min === max (no discrimination).
 */
export function minMaxNormalize(values) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

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
    graphExpandOptions = {},
    adaptiveHop2 = true,
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

  // Confident lexical queries skip expansion and MaxSim — BM25 exact matching
  // and definition-first ranking are the correct signals for identifier lookup.
  const isConfidentLexical = stats.path === 'lexical'
    && (stats.confidence === 'exact' || stats.confidence === 'high');

  // Extract query embedding for query-dependent graph expansion scoring
  const queryInt8 = semanticStats?.queryInt8 || null;

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
  if (effectiveGraphExpand !== 'none' && this.hasGraphIndex && Array.isArray(results) && results.length > 0 && !isConfidentLexical) {
    try {
      await this.graphSearch.init();
      const graphDb = this.graphSearch.db;
      if (graphDb) {
        const expandStart = Date.now();
        // Pass intent-derived edge types unless explicitly overridden.
        const intentEdgeTypes = intentPolicy?.edgeTypePriority
          ? new Set(intentPolicy.edgeTypePriority)
          : undefined;
        // Provide readFileLines closure for expanded result token estimation
        // (dependency injection — keeps graph-expansion.js import-free)
        // Per-search file cache avoids re-reading the same file for multiple expanded results
        const fileCache = new Map();
        const readFileLines = (filePath, startLine, endLine) => {
          try {
            let lines = fileCache.get(filePath);
            if (!lines) {
              lines = readFileSync(filePath, 'utf-8').split('\n');
              fileCache.set(filePath, lines);
            }
            return lines.slice((startLine || 1) - 1, endLine || startLine).join('\n');
          } catch {
            return null;
          }
        };

        results = expandResults(graphDb, results, {
          expandMode: effectiveGraphExpand,
          adaptiveHop2,
          queryInt8,
          hnswIndex: this.binaryHnswIndex,
          cosineSimilarity: int8CosineSimilarity,
          codebaseDb: this.codebaseRepo,
          readFileLines,
          ...(intentEdgeTypes && !graphExpandOptions.edgeTypes ? { edgeTypes: intentEdgeTypes } : {}),
          ...graphExpandOptions,
        });

        // Attach LI chunk ids to expanded entities so they can participate
        // in the post-expansion MaxSim rerank pool. The graph stores entities
        // (entity_id keyed by code-graph.db) while LI is keyed by chunk id;
        // without this bridge expanded entries fall through hasTokens() and
        // are appended to the result tail without ever competing for top-K.
        const expandedAttached = attachChunkIdsToExpanded(results, this.codebaseRepo);

        stats.graphExpansion = {
          mode: effectiveGraphExpand,
          latency_ms: Date.now() - expandStart,
          total: results.length,
          expanded: results.filter(r => r.is_expanded).length,
          expandedWithLiChunk: expandedAttached,
        };
      }
    } catch (err) {
      this.log(`GraphExpansion: ${err.message}`);
      stats.graphExpansion = { mode: effectiveGraphExpand, error: err.message };
    }
  }

  // =========================================================================
  // Cascaded Scoring (MaxSim → confidence gate → conditional cross-encoder)
  // =========================================================================
  // Runs after graph expansion so expanded candidates also get scored.
  // Replaces the old separate "late interaction blend" block when cascade is enabled.
  // POLICY: Lexical confident queries skip this entirely (handled by isConfidentLexical).
  //
  // Guard does NOT require hasLateInteractionIndex. When LI is unavailable
  // (missing index, model mismatch), cascadedScore() handles it internally:
  // all candidates are treated as unscored → CE-only fallback.
  // Cascade runs when enabled, regardless of useLateInteraction.
  // When LI is unavailable, cascadedScore() receives null → CE-only fallback.
  // Pattern mode already ran MaxSim ranking — skip redundant CE cascade.
  const isPatternMode = searchMode === 'pattern';
  const shouldRunCascade = this.cascadeEnabled
    && !isConfidentLexical
    && !isPatternMode
    && Array.isArray(results) && results.length > 1;

  if (shouldRunCascade) {
    // Pass LI index only if available, model matches, AND useLateInteraction is enabled.
    // When null, cascadedScore() treats all candidates as unscored → CE-only path.
    const liIndex = (this.hasLateInteractionIndex
      && !this.lateInteractionIndex.modelMismatch
      && (options.useLateInteraction ?? this.useLateInteraction))
      ? this.lateInteractionIndex
      : null;

    try {
      const { cascadedScore } = await import('../ranking/cascaded-scorer.js');
      const cascadeResult = await cascadedScore(query, results, {
        lateInteractionIndex: liIndex,
        crossEncoder: this.reranker,
        ceTopK: this.cascadeCeTopK || 20,
        gateThreshold: this.cascadeGateThreshold || 0.08,
        forceFullCrossEncoder: this.cascadeForceFullCE || false,
        shadowMode: this.cascadeShadowMode || false,
        lexicalConfident: false,
        loadDocumentContent: this.loadDocumentContent.bind(this),
      });
      results = cascadeResult.results;
      stats.cascade = cascadeResult.stats;

      // Emit stats.rerank for CostTracker compatibility (cost-tracker.js:168 reads it).
      stats.rerank = {
        skipped: !cascadeResult.stats.ceInvoked,
        provider: cascadeResult.stats.ceProvider || null,
        documents: cascadeResult.stats.ceCandidates || 0,
        tokens: cascadeResult.stats.ceTokens || 0,
        reason: cascadeResult.stats.ceInvoked ? undefined : cascadeResult.stats.gateReason,
      };
    } catch (err) {
      this.log(`Cascade scoring failed: ${err.message}`);
      stats.cascade = { error: err.message };
    }
  } else if (!this.cascadeEnabled) {
    // =========================================================================
    // Late Interaction Reranking (legacy, flag OFF — post-expansion, Phase 6)
    // =========================================================================
    const shouldRunLateInteraction = this.hasLateInteractionIndex &&
                             (options.useLateInteraction ?? this.useLateInteraction) &&
                             !this.lateInteractionIndex.modelMismatch &&
                             Array.isArray(results) && results.length > 0 &&
                             !isConfidentLexical;

    if (shouldRunLateInteraction) {
      try {
        const liStart = performance.now();
        // Pool size and original/expanded split are overridable per call so
        // the graph-2hop sweep can compare allocations without forking the
        // pipeline. Defaults preserve production behaviour.
        const liCandidateCount =
          options.liPoolSize ?? this.stage3Candidates ?? 20;
        const liExpandedFraction = options.liExpandedFraction;  // undefined → builder default

        // Build a bounded MIXED rerank pool: top originals + top expanded.
        // Without this, expanded entries always sit behind the originals'
        // tail and the LI rerank only re-orders the original head — graph
        // expansion has zero effect on top-K. Reserve a slice of the rerank
        // pool for the highest-scoring expanded candidates so they actually
        // compete for top-K positions.
        const { topCandidates, expandedQuotaUsed } = buildMixedRerankPool(
          results, liCandidateCount, liExpandedFraction,
        );

        const { encodeQuery } = await import('../ranking/late-interaction-model.js');
        const queryTokens = await encodeQuery(query);

        if (queryTokens && queryTokens.length > 0) {
          const scored = await this.lateInteractionIndex.scoreWithLateInteraction(queryTokens, topCandidates);

          // Pure reranker: sort by MaxSim score directly.
          // Previous alpha-blend (alpha * normLI + (1-alpha) * normBase) was fragile —
          // static weights caused -8.6pp MRR regression on GenCodeSearchNet.
          // MaxSim is a stronger signal than Int8 cosine; let it decide ranking.
          for (const candidate of scored) {
            candidate.preLateInteractionScore = candidate.score ?? candidate.int8Score ?? 0;
            const liScore = candidate.lateInteractionScore;
            candidate.score = (Number.isFinite(liScore) ? liScore : candidate.preLateInteractionScore) || 0;
          }

          scored.sort((a, b) => b.score - a.score);

          // Anything not in the rerank pool keeps original ordering at the tail.
          const pickedKeys = new Set(topCandidates.map(c => c.id || c.entity_id));
          const tail = results.filter(r => !pickedKeys.has(r.id || r.entity_id));
          results = [...scored, ...tail];
        }

        stats.lateInteraction = {
          position: 'post-expansion',
          mode: 'pure-reranker-mixed-pool',
          latency_us: Math.round((performance.now() - liStart) * 1000),
          candidates: topCandidates.length,
          expandedInPool: expandedQuotaUsed,
          queryTokens: queryTokens?.length || 0,
        };
        this.log(`LateInteraction (mixed-pool): ${stats.lateInteraction.latency_us}us for ${topCandidates.length} candidates (${expandedQuotaUsed} expanded, ${queryTokens?.length || 0} query tokens)`);
      } catch (err) {
        this.log(`LateInteraction rerank failed: ${err.message}`);
        stats.lateInteraction = { position: 'post-expansion', error: err.message };
      }
    } else if (this.hasLateInteractionIndex && (options.useLateInteraction ?? this.useLateInteraction) && this.lateInteractionIndex.modelMismatch) {
      this.log('LateInteraction: Skipped (model mismatch — re-index to fix)');
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

  // =========================================================================
  // Intent-aware file-kind ranking
  // =========================================================================
  // Soft-demote docs/examples/tests/types/config files when the query is
  // confidently implementation-seeking AND the top-N window contains both
  // demotable and implementation candidates. No-op otherwise. Disable with
  // SWEET_SEARCH_FILE_KIND_RANKING=0; tune SWEET_SEARCH_FILE_KIND_FACTOR.
  if (Array.isArray(results) && results.length > 0) {
    const fileKindIntent = classifyFileKindIntent(query);
    const beforeTop = results[0];
    const semanticLike = searchMode === 'hybrid' || searchMode === 'semantic'
      || stats.path === 'hybrid' || stats.path === 'semantic';
    const afterFK = applyFileKindRanking(results, {
      intent: fileKindIntent,
      ...(semanticLike ? {
        docFactor: 0.35,
        testFactor: 0.35,
        typeFactor: 0.70,
        ancillaryFactor: 0.15,
        tinyAncillaryFactor: 0.05,
      } : {}),
    });
    if (afterFK !== results) {
      results = afterFK;
      stats.fileKindRanking = {
        intent: fileKindIntent,
        applied: true,
        top1Changed: !!beforeTop && results[0] && (beforeTop !== results[0]),
      };
    } else {
      stats.fileKindRanking = {
        intent: fileKindIntent,
        applied: false,
      };
    }

    const beforeDemotionTop = results[0];
    const afterDemotions = applyResultDemotions(results, {
      query,
      ablations: options.ablations,
      projectRoot: this.projectRoot,
      codeGraphRepo: this.codeGraphRepo,
    });
    if (afterDemotions !== results) {
      results = afterDemotions;
      stats.resultDemotions = {
        applied: true,
        top1Changed: !!beforeDemotionTop && results[0] && (beforeDemotionTop !== results[0]),
      };
    }
  }

  stats.total_ms = Date.now() - start;
  stats.results_count = Array.isArray(results) ? results.length : 0;

  // Log performance
  if (this.timing) {
    this.logPerformance(stats);
  }

  // Record per-mode telemetry for vocabulary prewarm analytics (Step 0)
  // =========================================================================
  // Sibling expansion (dedup re-attach)
  // =========================================================================
  // Aliases were skipped during HNSW construction to prevent duplicate-hits
  // for the same cluster. Re-attach them now so callers can still surface
  // every file matching a search — grouped under the exemplar as result.aliases.
  if (Array.isArray(results) && results.length > 0 && this.codebaseRepo) {
    try {
      const { stats: dedupStats } = expandAliases(results, this.codebaseRepo, query);
      if (dedupStats.exemplarsExpanded > 0) {
        stats.dedupExpansion = dedupStats;
      }
    } catch (err) {
      this.log(`Sibling expansion failed: ${err.message}`);
    }
  }

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

// =============================================================================
// Mixed rerank pool helpers (post-expansion LI / cascade)
// =============================================================================

/**
 * For each `is_expanded` result with a known file_path + line range, find the
 * codebase chunk that best covers it and stash its id under `_liChunkId`.
 *
 * Why: graph expansion produces results keyed by entity_id (from code-graph.db)
 * but the LI index is keyed by chunk id (from codebase.db). Without bridging
 * the two ID spaces, expanded results can never participate in MaxSim rerank.
 *
 * Best-effort: missing/zero-overlap entries are left as-is and will fall
 * through to the unscored path.
 *
 * @param {Array} results
 * @param {import('../infrastructure/codebase-repository.js').CodebaseRepository} codebaseRepo
 * @returns {number} count of expanded results that received a _liChunkId
 */
export function attachChunkIdsToExpanded(results, codebaseRepo) {
  if (!Array.isArray(results) || results.length === 0 || !codebaseRepo) return 0;
  const fileChunkCache = new Map(); // file_path -> Array<{ id, file_path, text, metadata }>
  let attached = 0;

  for (const r of results) {
    if (!r.is_expanded || r._liChunkId) continue;
    const fp = r.file_path || r.file || r.metadata?.file || r.metadata?.path;
    const sl = r.start_line ?? r.startLine ?? r.metadata?.start_line ?? r.metadata?.startLine;
    if (!fp || sl == null) continue;
    const el = r.end_line ?? r.endLine ?? r.metadata?.end_line ?? r.metadata?.endLine ?? sl;

    let chunks = fileChunkCache.get(fp);
    if (!chunks) {
      try { chunks = codebaseRepo.getChunksByFilePath(fp) || []; }
      catch { chunks = []; }
      fileChunkCache.set(fp, chunks);
    }
    if (chunks.length === 0) continue;

    // Greatest line-range overlap with the entity wins; ties broken by smaller
    // chunk (tighter match). Chunk metadata is the primary signal; chunk id
    // pattern `<path>:<start>-<end>:<n>` is a fallback when metadata is sparse.
    let bestId = null;
    let bestOverlap = 0;
    let bestSize = Infinity;
    for (const c of chunks) {
      let cs, ce;
      let meta = c.metadata;
      if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
      if (meta) {
        cs = meta.start_line ?? meta.startLine;
        ce = meta.end_line ?? meta.endLine;
      }
      if (cs == null || ce == null) {
        const m = typeof c.id === 'string' ? c.id.match(/:(\d+)-(\d+)(?::|$)/) : null;
        if (m) { cs = parseInt(m[1], 10); ce = parseInt(m[2], 10); }
      }
      if (cs == null || ce == null) continue;
      const overlap = Math.max(0, Math.min(el, ce) - Math.max(sl, cs) + 1);
      if (overlap <= 0) continue;
      const size = ce - cs + 1;
      if (overlap > bestOverlap || (overlap === bestOverlap && size < bestSize)) {
        bestOverlap = overlap;
        bestSize = size;
        bestId = c.id;
      }
    }

    if (bestId) {
      r._liChunkId = bestId;
      attached++;
    }
  }
  return attached;
}

/**
 * Build a bounded LI rerank pool that mixes top originals and top expanded.
 *
 * Reserves `expandedQuota = floor(slot * expandedFraction)` of the rerank
 * slots for the highest-scoring expanded candidates (so adaptive 2-hop's
 * scoring choices actually influence the top-K), with the remainder going
 * to the highest-scoring originals (preserving lexical/HNSW lead).
 *
 * If there are fewer expanded (or fewer originals) than the quota, the
 * unused slots flow to the other side.
 *
 * @param {Array} results - Combined original + expanded result list
 * @param {number} slot   - Total rerank slots (e.g. stage3Candidates)
 * @param {number} [expandedFraction=0.4] - Fraction of pool reserved for expanded
 * @returns {{ topCandidates: Array, expandedQuotaUsed: number }}
 */
export function buildMixedRerankPool(results, slot, expandedFraction = 0.4) {
  const EXPANDED_FRACTION = Math.max(0, Math.min(1, expandedFraction));

  const originals = results.filter(r => !r.is_expanded);
  const expanded = results.filter(r => r.is_expanded);

  if (expanded.length === 0) {
    return { topCandidates: originals.slice(0, slot), expandedQuotaUsed: 0 };
  }

  const expandedScore = (r) =>
    r.expansion?.adaptiveScore ?? r.score ?? 0;
  const originalScore = (r) =>
    r.score ?? r.int8Score ?? r.hybridScore ?? 0;

  const sortedOriginals = [...originals].sort((a, b) => originalScore(b) - originalScore(a));
  const sortedExpanded  = [...expanded].sort((a, b) => expandedScore(b)  - expandedScore(a));

  const expandedQuota = Math.min(
    Math.floor(slot * EXPANDED_FRACTION),
    sortedExpanded.length,
  );
  const originalQuota = Math.min(slot - expandedQuota, sortedOriginals.length);

  // If originals can't fill their quota, redirect the surplus to expanded.
  const originalShort = (slot - expandedQuota) - originalQuota;
  const finalExpandedQuota = Math.min(expandedQuota + originalShort, sortedExpanded.length);

  const topOriginals = sortedOriginals.slice(0, originalQuota);
  const topExpanded  = sortedExpanded.slice(0, finalExpandedQuota);

  return {
    topCandidates: [...topOriginals, ...topExpanded],
    expandedQuotaUsed: topExpanded.length,
  };
}
