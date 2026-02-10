#!/usr/bin/env node

/**
 * Smart Search v2.3 - Unified Search Pipeline with Auto-Warm Server
 *
 * Combines all search components into a single intelligent system:
 * - Query routing (lexical vs semantic vs hybrid)
 * - Lexical path: FTS5/BM25 + Code Graph expansion
 * - Semantic path: HNSW ANN + Reranking
 * - Hybrid path: Merge and deduplicate results
 * - Auto-warm server: Background HTTP server keeps indexes in memory
 *
 * Performance (with warm server):
 * - Lexical: ~6-10ms (target: <10ms) ✓
 * - Semantic: ~275ms (bottleneck: Voyage API ~250ms)
 * - First search: ~1-2s (server auto-start + index load)
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

import { DB_PATHS, PERFORMANCE_TARGETS, LOGGING, BINARY_HNSW_CONFIG, HCGS_CONFIG, COLBERT_CONFIG, shouldUseLocalReranker } from './config.js';
import { getGlobalLocalReranker } from './local-reranker.js';
import { QueryRouter, routeQuery } from './query-router.js';
import { GraphSearch } from './graph-search.js';
import { SYMBOL_KIND_WEIGHTS, DEFINITION_TYPES } from './constants.js';
import { HNSWIndex } from './hnsw-index.js';
import { BinaryHNSWIndex } from './binary-hnsw-index.js';
import { Reranker } from './flashrank.js';
import { ColBERTIndex } from './colbert-index.js';
import {
  getEmbedding,
  getBinaryEmbedding,
  truncateForHNSW,
  floatToInt8,
  int8CosineSimilarity,
  warmup as warmupEmbedding,
  isWarm,
  registerAutoPersistOnExit,
} from './embedding-service.js';

// Phase 4: Translation Fallback
import { TranslationFallback, queryNeedsTranslation } from '../translation/index.js';

// Phase 1 Fixes: MMR Diversification (replaces flood control)
import { applyMMR, shouldApplyMMR, getLambdaForIntent, MMR_CONFIG } from './mmr.js';

// =============================================================================
// SMART SEARCH CLASS
// =============================================================================

export class SweetSearch {
  constructor(options = {}) {
    this.graphSearch = new GraphSearch(options.graphDbPath || DB_PATHS.codeGraph);
    this.hnswIndex = new HNSWIndex({ indexPath: options.hnswPath || DB_PATHS.hnswIndex });
    this.binaryHnswIndex = new BinaryHNSWIndex({ indexPath: options.binaryHnswPath || DB_PATHS.binaryHnswIndex });
    this.reranker = new Reranker(options);
    this.colbertIndex = new ColBERTIndex(options.colbertOptions || {});
    this.router = new QueryRouter();

    this.codebaseDbPath = options.codebaseDbPath || DB_PATHS.codebase;

    this.verbose = options.verbose ?? LOGGING.verbose;
    this.timing = options.timing ?? LOGGING.timing;

    // 3-stage retrieval configuration
    this.use3Stage = options.use3Stage ?? true;
    this.stage1Candidates = options.stage1Candidates ?? BINARY_HNSW_CONFIG.retrieval.stage1Candidates;
    this.stage2Candidates = options.stage2Candidates ?? BINARY_HNSW_CONFIG.retrieval.stage2Candidates;
    this.stage3Candidates = options.stage3Candidates ?? BINARY_HNSW_CONFIG.retrieval.stage3Candidates;

    // ColBERT configuration
    this.useColBERT = options.useColBERT ?? COLBERT_CONFIG.enabled; // Auto-enable from config
    this.colbertBlendWeight = options.colbertBlendWeight ?? COLBERT_CONFIG.blendWeight ?? 0.3;

    // HCGS summary-first configuration
    this.returnSummaryFirst = options.returnSummaryFirst ?? HCGS_CONFIG.returnSummaryFirst;
    this.summaryTokenBudget = options.summaryTokenBudget ?? HCGS_CONFIG.summaryTokenBudget;
    this.fullCodeTokenBudget = options.fullCodeTokenBudget ?? HCGS_CONFIG.fullCodeTokenBudget;

    // Phase 4: Translation Fallback configuration
    this.enableTranslationFallback = options.enableTranslationFallback ?? true;
    this.translationFallback = new TranslationFallback(options.translation || {});

    this.initialized = false;
  }

  /**
   * Initialize all search components
   */
  async init() {
    if (this.initialized) return;

    const start = Date.now();

    // Check which indexes are available
    this.hasGraphIndex = existsSync(DB_PATHS.codeGraph);
    this.hasHnswIndex = existsSync(DB_PATHS.hnswIndex.replace('.idx', '.meta.json'));
    this.hasBinaryHnswIndex = existsSync(DB_PATHS.binaryHnswIndex.replace('.idx', '.meta.json'));
    this.hasCodebaseIndex = existsSync(this.codebaseDbPath);
    this.hasColbertIndex = existsSync(this.colbertIndex.indexPath);

    if (!this.hasGraphIndex && !this.hasCodebaseIndex) {
      throw new Error('No search indexes found. Run indexing first.');
    }

    // Initialize available components
    if (this.hasBinaryHnswIndex && this.use3Stage) {
      try {
        await this.binaryHnswIndex.load();
        const stats = this.binaryHnswIndex.getStats();
        this.log(`BinaryHNSW: Loaded ${stats.totalVectors} vectors (${stats.memorySizeMB} MB)`);
      } catch (err) {
        this.log(`BinaryHNSW: Failed to load: ${err.message}`);
        this.hasBinaryHnswIndex = false;
      }
    }

    if (this.hasHnswIndex) {
      try {
        await this.hnswIndex.load();
        this.log(`HNSW: Loaded ${this.hnswIndex.getStats().totalVectors} vectors`);
      } catch (err) {
        this.log(`HNSW: Failed to load: ${err.message}`);
        this.hasHnswIndex = false;
      }
    }

    // Initialize ColBERT if available and enabled
    if (this.hasColbertIndex && this.useColBERT) {
      try {
        await this.colbertIndex.init();
        const stats = this.colbertIndex.getStats();
        this.log(`ColBERT: Loaded ${stats.documents} documents (${stats.estimatedSizeMB} MB, ${stats.avgTokensPerDoc} avg tokens)`);
      } catch (err) {
        this.log(`ColBERT: Failed to load: ${err.message}`);
        this.hasColbertIndex = false;
      }
    }

    // CRITICAL: Warm up embedding service (SemanticCache local model + vocabulary)
    // This eliminates the 2-3s cold start penalty on first semantic search
    await warmupEmbedding({ initVocabulary: true, initSemanticCache: true });

    // Pre-initialize local reranker to avoid concurrent model loading crashes
    // The model is ~150MB and takes ~2s to load - must be done before serving requests
    if (shouldUseLocalReranker()) {
      try {
        const localReranker = getGlobalLocalReranker();
        await localReranker.init();
        this.log('LocalReranker: Pre-initialized (gte-reranker-modernbert-base INT8)');
      } catch (err) {
        this.log(`LocalReranker: Pre-init failed: ${err.message}`);
      }
    }

    // Phase 4: Initialize translation fallback (loads alias dictionary)
    if (this.enableTranslationFallback) {
      await this.translationFallback.init();
      this.log('TranslationFallback: Initialized');
    }

    this.initialized = true;
    this.log(`SweetSearch: Initialized in ${Date.now() - start}ms`);
  }

  /**
   * Main search entry point
   */
  async search(query, options = {}) {
    await this.init();

    const {
      k = 10,
      mode = 'auto',
      expand = true,
      rerank = true,
      fusion = 'cc',  // 'cc' (Convex Combination) or 'rrf' (Reciprocal Rank Fusion)
      useColBERT = this.useColBERT,  // Per-request override, defaults to instance setting
      translate = 'auto',  // Phase 4: Translation fallback ('auto', 'true', 'false')
    } = options;

    const start = Date.now();
    const stats = { query };

    // Step 1: Route query (P9 FIX: compute once, pass to sub-methods)
    const routing = mode === 'auto' ? routeQuery(query) : null;
    let searchMode;
    if (mode === 'auto') {
      searchMode = routing.mode;
      stats.routing = {
        mode: routing.mode,
        confidence: routing.confidence,
        latency_us: routing.routingLatency_us,
      };
    } else {
      searchMode = mode;
      stats.routing = { mode, forced: true };
    }

    this.log(`Search mode: ${searchMode}`);

    // Step 2: Execute search based on mode
    let results;
    let semanticStats = null;  // P0 FIX: Capture semantic stats for CostTracker

    switch (searchMode) {
      case 'structural':
        // P9 FIX: Reuse routing from step 1 instead of calling routeQuery again
        results = await this.structuralSearch(query, routing, options);
        stats.path = 'structural';
        stats.structuralType = routing.structuralType;
        stats.targetEntity = routing.targetEntity;
        break;

      case 'lexical':
        results = await this.lexicalSearch(query, { k, expand });
        stats.path = 'lexical';
        break;

      case 'semantic': {
        // P0 FIX: Semantic search now returns { results, stats }
        const semanticResult = await this.semanticSearch(query, { k, rerank, useColBERT });
        results = semanticResult.results;
        semanticStats = semanticResult.stats;
        stats.path = 'semantic';
        break;
      }

      case 'hybrid':
      default: {
        // P9 FIX: Pass routing to hybridSearchV2 to avoid redundant call
        // P0 FIX: Hybrid search uses semantic search internally, capture stats
        // PHASE_1_FIXES: Using hybridSearchV2 with:
        // - graphExpandedSearch(skipBoosts=true) for fair lexical retrieval
        // - robustCCFusion with RRF fallback
        // - applyPostFusionBoosts for uniform boost application
        const hybridResult = await this.hybridSearchV2(query, { k, useColBERT, routing });
        results = hybridResult.results || hybridResult;
        semanticStats = hybridResult.semanticStats || null;
        stats.path = 'hybrid';
        stats.fusion = hybridResult.fusionStats?.method || 'cc';
        stats.fusionFallback = hybridResult.fusionStats?.fallbackReason || null;
        break;
      }
    }

    // P0 FIX: Merge semantic stats (embedding/rerank) into main stats for CostTracker
    if (semanticStats) {
      // Validate embedding stats have required fields for cost tracking
      if (semanticStats.embedding &&
          typeof semanticStats.embedding.tokens === 'number' &&
          typeof semanticStats.embedding.provider === 'string') {
        stats.embedding = semanticStats.embedding;
      } else if (semanticStats.embedding) {
        // Partial embedding stats - fill in defaults
        stats.embedding = {
          source: semanticStats.embedding.source || 'unknown',
          tokens: semanticStats.embedding.tokens || Math.ceil(query.length / 4),
          provider: semanticStats.embedding.provider || 'voyage',
          cached: semanticStats.embedding.cached || false,
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
    // Phase 4: Translation Fallback
    // =========================================================================
    // Trigger conditions:
    // 1. Search returns 0 results OR low relevance
    // 2. Query contains non-ASCII characters
    // 3. translate='auto' or translate='true'
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
              k, mode, expand, rerank, fusion, useColBERT,
            });

            if (retryResult.results && retryResult.results.length > 0) {
              // Priority merge: translated results first, filter out invalid original results
              const translatedKeys = new Set(retryResult.results.map(r => this.getResultKey(r)));

              // Filter original results: keep only valid ones that aren't duplicates
              const validOriginal = results.filter(r => {
                // Skip if duplicate of translated result
                if (translatedKeys.has(this.getResultKey(r))) return false;
                // Skip if result has no valid file/name
                if (!r.file && !r.name) return false;
                return true;
              });

              // Put translated results first (they're more relevant)
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

    stats.total_ms = Date.now() - start;
    stats.results_count = Array.isArray(results) ? results.length : 0;

    // Log performance
    if (this.timing) {
      this.logPerformance(stats);
    }

    return { results, stats };
  }

  /**
   * Internal search without translation fallback (to avoid recursion)
   */
  async searchWithoutFallback(query, options = {}) {
    const originalEnable = this.enableTranslationFallback;
    this.enableTranslationFallback = false;
    try {
      return await this.search(query, { ...options, translate: 'false' });
    } finally {
      this.enableTranslationFallback = originalEnable;
    }
  }

  /**
   * Structural search path (GraphRAG structural queries)
   */
  async structuralSearch(query, routing, options = {}) {
    const { structuralType, targetEntity } = routing;
    const start = performance.now();

    let result;
    switch (structuralType) {
      case 'callers':
        result = await this.graphSearch.findCallers(targetEntity);
        break;
      case 'callees':
        result = await this.graphSearch.findCallees(targetEntity);
        break;
      case 'implementations':
        result = await this.graphSearch.findImplementations(targetEntity);
        break;
      case 'impact':
        result = await this.graphSearch.findImpact(targetEntity);
        break;
      default:
        return [];
    }

    const elapsed = performance.now() - start;
    this.log(`Structural (${structuralType}): ${elapsed.toFixed(1)}ms, ${result.results.length} results`);

    return result.results.map(r => ({ ...r, searchPath: 'structural', structuralType }));
  }

  /**
   * Lexical search path (FTS5/BM25 + Graph)
   */
  async lexicalSearch(query, options = {}) {
    const { k = 10, expand = true } = options;

    if (!this.hasGraphIndex) {
      this.log('Lexical search unavailable: no graph index');
      return [];
    }

    const { results, stats } = await this.graphSearch.graphExpandedSearch(query, {
      k,
      expand,
    });

    this.log(`Lexical: ${stats.bm25_ms}ms BM25, ${stats.graph_ms || 0}ms graph`);

    return results.map(r => ({
      ...r,
      searchPath: 'lexical',
    }));
  }

  /**
   * Semantic search path with 3-stage retrieval pipeline
   *
   * Stage 1: Binary HNSW (1000 candidates, ~100μs, Hamming distance)
   * Stage 2: Int8 rescore (100 candidates, ~1ms, dot product)
   * Stage 3: Rerank (top 20 → k, cross-encoder)
   *
   * Falls back to standard HNSW if binary index not available.
   *
   * Returns: { results: Array, stats: Object } with embedding/rerank stats for CostTracker
   */
  async semanticSearch(query, options = {}) {
    const { k = 10, rerank = true, useColBERT = this.useColBERT } = options;

    // Use 3-stage pipeline if binary index available
    if (this.hasBinaryHnswIndex && this.use3Stage) {
      return this.semanticSearch3Stage(query, { k, rerank, useColBERT });
    }

    // Fallback to standard HNSW search
    return this.semanticSearchStandard(query, { k, rerank });
  }

  /**
   * 3-Stage Semantic Search Pipeline (P0 + P3)
   *
   * Performance targets:
   *   Stage 1 (Binary): ~100μs for 1000 candidates (10x faster than float)
   *   Stage 2 (Int8):   ~1ms for 100 candidates
   *   Stage 3 (Rerank): ~50-100ms for 20 candidates
   *   Total: <150ms end-to-end
   *
   * Returns: { results: Array, stats: Object } with embedding/rerank stats for CostTracker
   */
  async semanticSearch3Stage(query, options = {}) {
    const { k = 10, rerank = true, useColBERT = this.useColBERT } = options;
    const stats = { stages: {} };

    // Generate binary embedding (with caching)
    const embedStart = performance.now();
    const embedResult = await getBinaryEmbedding(query);
    stats.embed_us = Math.round((performance.now() - embedStart) * 1000);
    this.log(`Embedding: ${stats.embed_us}μs (${embedResult.source})`);

    // P0 FIX: Add embedding stats for CostTracker
    stats.embedding = {
      source: embedResult.source || (embedResult.cached ? 'cache' : 'api'),
      tokens: embedResult.tokens || Math.ceil(query.length / 4),
      provider: 'voyage',
      cached: embedResult.cached || embedResult.source === 'vocabulary' || embedResult.source === 'lru' || false,
      latency_us: stats.embed_us,
    };

    // Stage 1: Binary HNSW search
    const stage1Start = performance.now();
    const stage1Result = await this.binaryHnswIndex.search(embedResult.binary, this.stage1Candidates);
    stats.stages.binary = {
      latency_us: stage1Result.latency_us,
      candidates: stage1Result.results.length,
    };
    this.log(`Stage 1 (Binary): ${stage1Result.latency_us}μs, ${stage1Result.results.length} candidates`);

    if (stage1Result.results.length === 0) {
      // P0 FIX: Return proper format with stats even for empty results
      stats.rerank = {
        skipped: true,
        reason: 'no_candidates',
        provider: null,
        documents: 0,
        tokens: 0,
      };
      return { results: [], stats };
    }

    // Stage 2: Int8 rescore
    const stage2Start = performance.now();
    const queryInt8 = floatToInt8(truncateForHNSW(embedResult.float));

    // P5 FIX: Load int8 vectors for candidates and compute dot product
    // Mutate candidate directly instead of using object spread in hot loop
    let scoredCandidates = [];
    let missingInt8Count = 0;
    for (const candidate of stage1Result.results.slice(0, this.stage2Candidates)) {
      const int8Vector = this.binaryHnswIndex.getInt8Vector(candidate.id);
      if (int8Vector) {
        candidate.int8Score = int8CosineSimilarity(queryInt8, int8Vector);
      } else {
        // SCALE FIX: Don't mix binary score (0-1 scale) with cosine similarity (0-1 scale)
        // Binary score is Hamming-based, not comparable to cosine similarity.
        // Use a neutral low value that won't pollute ranking but keeps candidate in results.
        candidate.int8Score = 0.0;  // Neutral - will sort to bottom
        candidate.missingInt8 = true;
        missingInt8Count++;
      }
      scoredCandidates.push(candidate);
    }
    if (missingInt8Count > 0) {
      this.log(`Warning: ${missingInt8Count} candidates missing int8 vectors (given neutral score)`);
    }

    // Sort by int8 score
    scoredCandidates.sort((a, b) => b.int8Score - a.int8Score);
    stats.stages.int8 = {
      latency_us: Math.round((performance.now() - stage2Start) * 1000),
      candidates: scoredCandidates.length,
    };
    this.log(`Stage 2 (Int8): ${stats.stages.int8.latency_us}μs, ${scoredCandidates.length} rescored`);

    // EARLY EXIT: Use score spread analysis to skip ColBERT and reranking
    // Checks: clear winner (gap > 0.15), tight cluster (spread < 0.1), or all high confidence (> 0.90)
    // SCALE FIX: Filter out candidates with missing int8 vectors (artificial 0.0 scores)
    const topCandidatesWithInt8 = scoredCandidates
      .slice(0, Math.min(10, scoredCandidates.length))
      .filter(c => !c.missingInt8);
    const topInt8Scores = topCandidatesWithInt8.map(c => c.int8Score);
    const skipAnalysis = this.shouldSkipRerank(topInt8Scores, { highConfidence: 0.90 });

    if (skipAnalysis.skip) {
      this.log(`Early exit: ${skipAnalysis.reason} (scores: ${topInt8Scores.slice(0, 3).map(s => s.toFixed(3)).join(', ')})`);

      // P0 FIX: Add rerank stats for CostTracker (skipped case)
      stats.rerank = {
        skipped: true,
        reason: skipAnalysis.reason,
        provider: null,
        documents: 0,
        tokens: 0,
      };

      const results = scoredCandidates.slice(0, k).map(r => ({
        ...r,
        searchPath: 'semantic-3stage',
        earlyExit: true,
        skipReason: skipAnalysis.reason,
      }));

      // Return both results and stats
      return { results, stats };
    }

    // Stage 2.5: ColBERT late interaction (ONLY for uncached queries)
    // CRITICAL: Guard with !embedResult.cached to preserve cached speed
    const shouldRunColBERT = this.hasColbertIndex &&
                             useColBERT &&
                             !embedResult.cached &&
                             scoredCandidates.length > 0;

    if (shouldRunColBERT) {
      try {
        const colbertStart = performance.now();
        const topCandidates = scoredCandidates.slice(0, this.stage3Candidates || 20);

        // Rescore top candidates with ColBERT MaxSim
        for (const candidate of topCandidates) {
          const docId = candidate.id || candidate.chunkId;
          const docTokens = this.colbertIndex.getTokens(docId);

          if (docTokens && docTokens.length > 0) {
            // For query, we'll use the sentence-level embedding as a proxy
            // In a full implementation, we'd generate token embeddings for the query
            // For now, we use the document tokens to approximate MaxSim
            const colbertScore = this.approximateColBERTScore(embedResult.float, docTokens);

            // Blend ColBERT score with int8 score
            const blendedScore = (colbertScore * this.colbertBlendWeight) +
                                (candidate.int8Score * (1 - this.colbertBlendWeight));

            candidate.colbertScore = colbertScore;
            candidate.preColbertScore = candidate.int8Score;
            candidate.int8Score = blendedScore; // Update score for sorting
          }
        }

        // Re-sort by blended score
        topCandidates.sort((a, b) => b.int8Score - a.int8Score);

        // Update scoredCandidates with re-ranked top results
        scoredCandidates = [
          ...topCandidates,
          ...scoredCandidates.slice(this.stage3Candidates || 20)
        ];

        stats.stages.colbert = {
          latency_us: Math.round((performance.now() - colbertStart) * 1000),
          candidates: topCandidates.length,
          skippedCache: embedResult.cached,
        };
        this.log(`Stage 2.5 (ColBERT): ${stats.stages.colbert.latency_us}μs for ${topCandidates.length} candidates`);
      } catch (err) {
        this.log(`ColBERT rescore failed: ${err.message}`);
        // Continue with int8 scores
      }
    } else if (this.hasColbertIndex && useColBERT && embedResult.cached) {
      this.log(`ColBERT: Skipped (using cached embedding)`);
    }

    // Stage 3: Rerank (if enabled)
    let results = scoredCandidates;
    if (rerank && scoredCandidates.length > k) {
      try {
        const stage3Start = performance.now();
        const topCandidates = scoredCandidates.slice(0, this.stage3Candidates);

        // Load full document content for reranking
        const documents = await this.loadDocumentContent(topCandidates);

        const rerankResult = await this.reranker.rerank(query, documents, k);
        results = rerankResult.results.map((r, i) => ({
          ...topCandidates[r.originalIndex],
          rerankScore: r.jinaScore || r.voyageScore || r.flashRankScore,
          originalScore: topCandidates[r.originalIndex].int8Score,
          binaryScore: topCandidates[r.originalIndex].score,
          colbertScore: topCandidates[r.originalIndex].colbertScore,
          preColbertScore: topCandidates[r.originalIndex].preColbertScore,
          newRank: i + 1,
        }));

        stats.stages.rerank = {
          latency_ms: rerankResult.latency_ms,
          model: rerankResult.model,
          candidates: topCandidates.length,
        };

        // P0 FIX: Add rerank stats for CostTracker
        stats.rerank = {
          skipped: false,
          provider: rerankResult.model || 'flashrank',
          documents: topCandidates.length,
          // Estimate tokens: query + avg 150 tokens per document
          tokens: Math.ceil(query.length / 4) + (topCandidates.length * 150),
          latency_ms: rerankResult.latency_ms,
        };

        this.log(`Stage 3 (Rerank): ${rerankResult.latency_ms}ms (${rerankResult.model})`);
      } catch (err) {
        this.log(`Rerank failed: ${err.message}`);
        results = scoredCandidates.slice(0, k);

        // P0 FIX: Add rerank stats for CostTracker (failed case)
        stats.rerank = {
          skipped: true,
          reason: `error: ${err.message}`,
          provider: null,
          documents: 0,
          tokens: 0,
        };
      }
    } else {
      results = scoredCandidates.slice(0, k);

      // P0 FIX: Add rerank stats for CostTracker (not requested case)
      stats.rerank = {
        skipped: true,
        reason: rerank ? 'insufficient_candidates' : 'disabled',
        provider: null,
        documents: 0,
        tokens: 0,
      };
    }

    const formattedResults = results.map(r => ({
      ...r,
      searchPath: 'semantic-3stage',
    }));

    // Return both results and stats for proper propagation
    return { results: formattedResults, stats };
  }

  /**
   * Standard Semantic Search (fallback when binary index not available)
   *
   * Returns: { results: Array, stats: Object } with embedding/rerank stats for CostTracker
   */
  async semanticSearchStandard(query, options = {}) {
    const { k = 10, rerank = true } = options;
    const stats = { stages: {} };

    // Generate query embedding (with caching)
    const embedStart = performance.now();
    const embedResult = await getEmbedding(query);
    const fullEmbedding = embedResult.embedding || embedResult; // Handle both new and old API
    const embedLatency_us = embedResult.latency_us || Math.round((performance.now() - embedStart) * 1000);
    const cacheStatus = embedResult.source || 'unknown';
    this.log(`Embedding: ${embedLatency_us}μs (${cacheStatus})`);

    // P0 FIX: Add embedding stats for CostTracker
    stats.embedding = {
      source: embedResult.source || (embedResult.cached ? 'cache' : 'api'),
      tokens: embedResult.tokens || Math.ceil(query.length / 4),
      provider: 'voyage',
      cached: embedResult.cached || embedResult.source === 'vocabulary' || embedResult.source === 'lru' || false,
      latency_us: embedLatency_us,
    };

    // Truncate to HNSW dimension (1024d → 512d Matryoshka)
    const queryEmbedding = truncateForHNSW(fullEmbedding);

    let candidates;

    if (this.hasHnswIndex) {
      // ADAPTIVE CANDIDATE SIZING: Reduce candidates for simple queries
      // Simple queries (short, likely identifier) need fewer candidates
      // Complex queries (questions, long) need more for better recall
      const baseNumCandidates = rerank ? Math.max(k * 10, 100) : k;
      const numCandidates = this.getAdaptiveCandidateCount(query, baseNumCandidates);

      const hnswResult = await this.hnswIndex.search(queryEmbedding, numCandidates);
      candidates = hnswResult.results;
      this.log(`HNSW: ${hnswResult.latency_us}μs for ${hnswResult.k} candidates (adaptive: ${numCandidates})`);
    } else if (this.hasCodebaseIndex) {
      // Fallback: O(N) scan from SQLite
      candidates = await this.vectorScan(queryEmbedding, rerank ? 100 : k);
      this.log(`Vector scan: ${candidates.length} candidates`);
    } else {
      // P0 FIX: Return proper format with stats even for no index case
      stats.rerank = {
        skipped: true,
        reason: 'no_index_available',
        provider: null,
        documents: 0,
        tokens: 0,
      };
      return { results: [], stats };
    }

    if (candidates.length === 0) {
      // P0 FIX: Return proper format with stats even for empty candidates
      stats.rerank = {
        skipped: true,
        reason: 'no_candidates',
        provider: null,
        documents: 0,
        tokens: 0,
      };
      return { results: [], stats };
    }

    // EARLY EXIT: Use score spread analysis to skip reranking
    // Checks: clear winner (gap > 0.15), tight cluster (spread < 0.1), or all high confidence (> 0.92)
    const topScores = candidates.slice(0, Math.min(10, candidates.length)).map(c => c.score);
    const skipAnalysis = this.shouldSkipRerank(topScores, { highConfidence: 0.92 });

    if (skipAnalysis.skip) {
      this.log(`Early exit: ${skipAnalysis.reason} (scores: ${topScores.slice(0, 3).map(s => s.toFixed(3)).join(', ')})`);

      // P0 FIX: Add rerank stats for CostTracker (skipped case)
      stats.rerank = {
        skipped: true,
        reason: skipAnalysis.reason,
        provider: null,
        documents: 0,
        tokens: 0,
      };

      const results = candidates.slice(0, k).map(r => ({
        ...r,
        searchPath: 'semantic',
        earlyExit: true,
        skipReason: skipAnalysis.reason,
      }));

      return { results, stats };
    }

    // Rerank if requested and we have candidates
    let results = candidates;
    if (rerank && candidates.length > k) {
      try {
        const rerankStart = Date.now();

        // Prepare documents for reranking
        const documents = await this.loadDocumentContent(candidates);

        const rerankResult = await this.reranker.rerank(query, documents, k);
        results = rerankResult.results.map((r, i) => ({
          ...candidates[r.originalIndex],
          rerankScore: r.jinaScore || r.voyageScore || r.flashRankScore,
          originalScore: candidates[r.originalIndex].score,
          newRank: i + 1,
        }));

        // P0 FIX: Add rerank stats for CostTracker
        stats.rerank = {
          skipped: false,
          provider: rerankResult.model || 'flashrank',
          documents: candidates.length,
          tokens: Math.ceil(query.length / 4) + (candidates.length * 150),
          latency_ms: rerankResult.latency_ms,
        };

        this.log(`Rerank: ${rerankResult.latency_ms}ms (${rerankResult.model})`);
      } catch (err) {
        this.log(`Rerank failed: ${err.message}`);
        results = candidates.slice(0, k);

        // P0 FIX: Add rerank stats for CostTracker (failed case)
        stats.rerank = {
          skipped: true,
          reason: `error: ${err.message}`,
          provider: null,
          documents: 0,
          tokens: 0,
        };
      }
    } else {
      // P0 FIX: Add rerank stats for CostTracker (not requested or insufficient candidates)
      stats.rerank = {
        skipped: true,
        reason: rerank ? 'insufficient_candidates' : 'disabled',
        provider: null,
        documents: 0,
        tokens: 0,
      };
    }

    const formattedResults = results.map(r => ({
      ...r,
      searchPath: 'semantic',
    }));

    return { results: formattedResults, stats };
  }

  /**
   * Score spread analysis for intelligent rerank skipping
   *
   * CALIBRATED FOR COSINE SIMILARITY (int8CosineSimilarity returns proper [-1, 1]):
   * - 0.85+ = Nearly identical content
   * - 0.70-0.85 = Very similar
   * - 0.50-0.70 = Semantically related
   * - 0.30-0.50 = Weakly related
   * - <0.30 = Likely unrelated
   *
   * Skip reranking when:
   * 1. Clear winner: Large gap between #1 and #2 (topGap > 0.10)
   * 2. Tight cluster: All scores very close (spread < 0.08, rerank won't change order)
   * 3. High confidence: Top scores all above 0.85 (very similar, stable ranking)
   * 4. Low scores: If max < 0.50, semantic search isn't finding relevant results
   *
   * @param {number[]} scores - Sorted scores (descending), cosine similarity [-1, 1]
   * @param {Object} options - Configuration
   * @returns {Object} { skip: boolean, reason: string }
   */
  shouldSkipRerank(scores, options = {}) {
    const {
      topGapThreshold = 0.10,       // Skip if #1 >> #2 (10% similarity gap)
      spreadThreshold = 0.08,       // Skip if all scores within 8%
      highConfidence = 0.85,        // Skip if all above 85% similarity
      minResults = 3,               // Need at least N results to analyze
      minScoreThreshold = 0.50,     // Minimum to consider semantically relevant
    } = options;

    if (!scores || scores.length < minResults) {
      return { skip: false, reason: 'insufficient_results' };
    }

    const sorted = [...scores].sort((a, b) => b - a);
    const topGap = sorted[0] - sorted[1];
    const spread = sorted[0] - sorted[sorted.length - 1];
    const topScores = sorted.slice(0, Math.min(3, sorted.length));

    // Check 0: Never skip if scores are too low (not semantically relevant)
    // Below 0.50 cosine similarity = weak semantic match, need reranker help
    if (sorted[0] < minScoreThreshold) {
      return { skip: false, reason: `low_scores (max=${sorted[0].toFixed(3)}, threshold=${minScoreThreshold})` };
    }

    // Check 1: Clear winner (large gap between #1 and #2)
    if (topGap > topGapThreshold) {
      return { skip: true, reason: `clear_winner (gap=${topGap.toFixed(3)})` };
    }

    // Check 2: Tight cluster (rerank won't meaningfully change order)
    if (spread < spreadThreshold) {
      return { skip: true, reason: `tight_cluster (spread=${spread.toFixed(3)})` };
    }

    // Check 3: All high confidence matches (very similar content)
    if (topScores.every(s => s > highConfidence)) {
      return { skip: true, reason: `high_confidence (min=${Math.min(...topScores).toFixed(3)})` };
    }

    return { skip: false, reason: 'needs_rerank' };
  }

  /**
   * Adaptive candidate count based on query complexity
   * Simple queries (identifiers) → fewer candidates (faster)
   * Complex queries (questions) → more candidates (better recall)
   */
  getAdaptiveCandidateCount(query, baseCount) {
    const trimmed = query.trim();

    // Very short queries (likely identifiers): use 50% of base
    if (trimmed.length < 15) {
      return Math.max(Math.floor(baseCount * 0.5), 20);
    }

    // Short queries without question words: use 75% of base
    if (trimmed.length < 30 && !/\b(how|what|where|why|when|which)\b/i.test(trimmed)) {
      return Math.max(Math.floor(baseCount * 0.75), 30);
    }

    // Complex queries (questions, long): use full base
    return baseCount;
  }

  /**
   * Min-max normalization for score fusion
   * Scales scores to [0, 1] range
   */
  minMaxNormalize(scores) {
    if (!scores || scores.length === 0) return [];
    if (scores.length === 1) return [1.0];

    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = max - min;

    if (range === 0) return scores.map(() => 1.0);
    return scores.map(s => (s - min) / range);
  }

  /**
   * Convex Combination (CC) fusion
   *
   * CC Formula: score = α * lexical_norm + (1-α) * semantic_norm
   * Where α is route-specific (identifier queries favor lexical, conceptual favor semantic)
   *
   * Per-route alphas (calibrated for code search):
   * - identifier: 0.85 (heavy lexical - exact names, APIs)
   * - conceptual: 0.25 (heavy semantic - "how does X work")
   * - structural: 0.90 (lexical + graph - "what calls X")
   * - mixed: 0.55 (balanced)
   *
   * Research: CC outperforms RRF by +7-18% MRR on hybrid search (ACM TOIS 2023)
   */
  convexCombination(lexicalResults, semanticResults, routeType = 'mixed', options = {}) {
    const ROUTE_ALPHAS = {
      'identifier': 0.85,    // Heavy lexical (BM25)
      'lexical': 0.85,       // Alias
      'conceptual': 0.25,    // Heavy semantic
      'semantic': 0.25,      // Alias
      'structural': 0.90,    // Lexical + graph
      'mixed': 0.55,         // Balanced
      'hybrid': 0.55,        // Alias
    };

    const alpha = options.alpha ?? ROUTE_ALPHAS[routeType] ?? 0.5;

    // Build score maps
    const lexicalScoreMap = new Map();
    const semanticScoreMap = new Map();
    const allKeys = new Set();

    for (const r of lexicalResults) {
      const key = this.getResultKey(r);
      lexicalScoreMap.set(key, r.score);
      allKeys.add(key);
    }

    for (const r of semanticResults) {
      const key = this.getResultKey(r);
      semanticScoreMap.set(key, r.score);
      allKeys.add(key);
    }

    // Get all scores for normalization
    const lexScores = Array.from(lexicalScoreMap.values());
    const semScores = Array.from(semanticScoreMap.values());

    // Min-max normalize
    const lexMin = lexScores.length > 0 ? Math.min(...lexScores) : 0;
    const lexMax = lexScores.length > 0 ? Math.max(...lexScores) : 1;
    const lexRange = lexMax - lexMin || 1;

    const semMin = semScores.length > 0 ? Math.min(...semScores) : 0;
    const semMax = semScores.length > 0 ? Math.max(...semScores) : 1;
    const semRange = semMax - semMin || 1;

    // Compute CC scores
    const ccResults = [];
    const lexResultMap = new Map(lexicalResults.map(r => [this.getResultKey(r), r]));
    const semResultMap = new Map(semanticResults.map(r => [this.getResultKey(r), r]));

    for (const key of allKeys) {
      const lexScore = lexicalScoreMap.get(key);
      const semScore = semanticScoreMap.get(key);

      // Normalize scores (missing results get 0)
      const normLex = lexScore !== undefined ? (lexScore - lexMin) / lexRange : 0;
      const normSem = semScore !== undefined ? (semScore - semMin) / semRange : 0;

      // Convex combination
      const ccScore = alpha * normLex + (1 - alpha) * normSem;

      // Merge result data
      const lexResult = lexResultMap.get(key) || {};
      const semResult = semResultMap.get(key) || {};
      const sources = [];
      if (lexScore !== undefined) sources.push('lexical');
      if (semScore !== undefined) sources.push('semantic');

      ccResults.push({
        ...semResult,
        ...lexResult, // lexical overwrites semantic if both exist
        ccScore,
        rrfScore: ccScore, // Backwards compatibility
        lexicalScore: lexScore,
        semanticScore: semScore,
        normLexical: normLex,
        normSemantic: normSem,
        alpha,
        sources,
      });
    }

    // Sort by CC score descending
    return ccResults.sort((a, b) => b.ccScore - a.ccScore);
  }

  // ===========================================================================
  // PHASE_1_FIXES: ROBUST CC FUSION + POST-FUSION BOOSTS (Changes 2-4)
  // ===========================================================================

  /**
   * Quantile-based normalization (PHASE_1_FIXES Change 2)
   * Robust to outliers from pre-fusion boosts
   *
   * @param {number[]} scores - Raw scores to normalize
   * @param {number} lowQuantile - Lower percentile cutoff (default 0.05)
   * @param {number} highQuantile - Upper percentile cutoff (default 0.95)
   * @returns {number[]} Normalized scores in [0, 1]
   */
  quantileNormalize(scores, lowQuantile = 0.05, highQuantile = 0.95) {
    if (scores.length === 0) return [];
    if (scores.length === 1) return [0.5]; // Single item = middle

    const sorted = [...scores].sort((a, b) => a - b);
    const lowIdx = Math.floor(sorted.length * lowQuantile);
    const highIdx = Math.ceil(sorted.length * highQuantile) - 1;

    const pLow = sorted[Math.max(0, lowIdx)];
    const pHigh = sorted[Math.min(sorted.length - 1, highIdx)];
    const range = pHigh - pLow;

    if (range < 1e-9) {
      // Degenerate case: all scores nearly identical
      return scores.map(() => 0.5);
    }

    return scores.map(s => {
      const normalized = (s - pLow) / range;
      return Math.max(0, Math.min(1, normalized)); // Clamp to [0, 1]
    });
  }

  /**
   * Detect when CC fusion would be unreliable (PHASE_1_FIXES Change 2)
   *
   * @param {Array} lexicalResults - Lexical search results
   * @param {Array} semanticResults - Semantic search results
   * @returns {{fallback: boolean, reason: string|null}}
   */
  shouldFallbackToRRF(lexicalResults, semanticResults) {
    // Case 1: Too few results on one side
    if (lexicalResults.length < 3 || semanticResults.length < 3) {
      return { fallback: true, reason: 'insufficient_results' };
    }

    // Case 2: Near-zero variance (degenerate range)
    // P0 FIX: Filter out undefined/NaN scores to prevent variance errors
    const lexScores = lexicalResults.map(r => r.score ?? 0).filter(s => !isNaN(s));
    const semScores = semanticResults.map(r => r.score ?? 0).filter(s => !isNaN(s));

    if (lexScores.length === 0 || semScores.length === 0) {
      return { fallback: true, reason: 'no_valid_scores' };
    }

    const lexVariance = this.variance(lexScores);
    const semVariance = this.variance(semScores);

    if (lexVariance < 1e-6 || semVariance < 1e-6) {
      return { fallback: true, reason: 'zero_variance' };
    }

    // Case 3: Extreme outlier compression
    // Detect when top scores are clustered near max but median is very low
    // This indicates score distribution is heavily skewed, making CC unreliable
    const lexSorted = [...lexScores].sort((a, b) => b - a);  // Descending: highest first
    const lexMax = lexSorted[0];
    const lexMedian = lexSorted[Math.floor(lexSorted.length * 0.5)];
    // Top 5% threshold (index 5% from start in descending = 95th percentile value)
    const lexTop5PctThreshold = lexSorted[Math.floor(lexSorted.length * 0.05)];

    // Outlier compression: top 5% clustered near max (>95%) but median far from max (<30%)
    // Example: [100, 98, 97, 96, ..., 20, 10, 5] - top scores compressed, long tail
    if (lexMax > 0 && (lexTop5PctThreshold / lexMax) > 0.95 && (lexMedian / lexMax) < 0.3) {
      return { fallback: true, reason: 'outlier_compression' };
    }

    return { fallback: false, reason: null };
  }

  /**
   * RRF fusion (rank-based fallback) (PHASE_1_FIXES Change 2)
   *
   * @param {Array} lexicalResults - Lexical search results
   * @param {Array} semanticResults - Semantic search results
   * @param {number} k - RRF constant (default 60)
   * @returns {Array} Fused results sorted by RRF score
   */
  rrfFusion(lexicalResults, semanticResults, k = 60) {
    const scores = new Map();
    const results = new Map();

    // Lexical contribution by rank
    lexicalResults.forEach((result, rank) => {
      const id = this.getResultKey(result);
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
      if (!results.has(id)) results.set(id, { ...result, sources: ['lexical'] });
      else results.get(id).sources.push('lexical');
    });

    // Semantic contribution by rank
    semanticResults.forEach((result, rank) => {
      const id = this.getResultKey(result);
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
      if (!results.has(id)) results.set(id, { ...result, sources: ['semantic'] });
      else results.get(id).sources.push('semantic');
    });

    return [...results.values()]
      .map(r => ({ ...r, score: scores.get(this.getResultKey(r)), ccScore: scores.get(this.getResultKey(r)) }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Robust CC fusion with RRF fallback (PHASE_1_FIXES Change 2)
   *
   * Uses quantile normalization for robustness, auto-fallback to RRF for edge cases.
   *
   * @param {Array} lexicalResults - Raw lexical results (no boosts)
   * @param {Array} semanticResults - Raw semantic results
   * @param {string} routeType - Query type for alpha selection
   * @param {Object} options - Fusion options
   * @returns {{results: Array, method: string, fallbackReason: string|null}}
   */
  robustCCFusion(lexicalResults, semanticResults, routeType = 'mixed', options = {}) {
    // Check if we should fallback to RRF
    const { fallback, reason } = this.shouldFallbackToRRF(lexicalResults, semanticResults);

    if (fallback) {
      this.log(`[Fusion] Fallback to RRF: ${reason}`);
      return {
        results: this.rrfFusion(lexicalResults, semanticResults),
        method: 'rrf',
        fallbackReason: reason,
      };
    }

    const ROUTE_ALPHAS = {
      'identifier': 0.85,
      'lexical': 0.85,
      'conceptual': 0.25,
      'semantic': 0.25,
      'structural': 0.90,
      'mixed': 0.55,
      'hybrid': 0.55,
    };

    const alpha = options.alpha ?? ROUTE_ALPHAS[routeType] ?? 0.5;

    // Quantile normalization (robust to outliers)
    const lexScores = lexicalResults.map(r => r.score);
    const semScores = semanticResults.map(r => r.score);

    const lexNormalized = this.quantileNormalize(lexScores, 0.05, 0.95);
    const semNormalized = this.quantileNormalize(semScores, 0.05, 0.95);

    // Build combined score map
    const combinedScores = new Map();
    const results = new Map();

    lexicalResults.forEach((result, i) => {
      const id = this.getResultKey(result);
      combinedScores.set(id, alpha * lexNormalized[i]);
      results.set(id, { ...result, lexScore: lexNormalized[i], sources: ['lexical'] });
    });

    semanticResults.forEach((result, i) => {
      const id = this.getResultKey(result);
      const existing = combinedScores.get(id) || 0;
      combinedScores.set(id, existing + (1 - alpha) * semNormalized[i]);

      if (results.has(id)) {
        results.get(id).semScore = semNormalized[i];
        results.get(id).sources.push('semantic');
      } else {
        results.set(id, { ...result, semScore: semNormalized[i], sources: ['semantic'] });
      }
    });

    return {
      results: [...results.values()]
        .map(r => ({ ...r, score: combinedScores.get(this.getResultKey(r)), ccScore: combinedScores.get(this.getResultKey(r)), alpha }))
        .sort((a, b) => b.score - a.score),
      method: 'cc_robust',
      fallbackReason: null,
    };
  }

  /**
   * Compute variance of an array (PHASE_1_FIXES helper)
   */
  variance(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
  }

  /**
   * Map router mode to boost intent (PHASE_1_FIXES Change 3)
   *
   * Replaces intent-detector.js with query router as single source of truth.
   *
   * @param {string} routerMode - Mode from query router (lexical, semantic, hybrid, structural)
   * @param {number} routerConfidence - Confidence score from router
   * @returns {string} Boost intent (definition_strong, definition_mild, general, none, structural)
   */
  getBoostIntent(routerMode, routerConfidence) {
    // High confidence identifier query → strong definition boosts
    if (routerMode === 'lexical' && routerConfidence >= 0.8) {
      return 'definition_strong';
    }

    // Lower confidence lexical → mild boosts
    if (routerMode === 'lexical') {
      return 'definition_mild';
    }

    // Hybrid/mixed → minimal boosts (avoid oversteering)
    if (routerMode === 'hybrid') {
      return 'general';
    }

    // Semantic/conceptual → no definition boosts
    if (routerMode === 'semantic') {
      return 'none';
    }

    // Structural → handled by graph traversal
    if (routerMode === 'structural') {
      return 'structural';
    }

    return 'general';
  }

  /**
   * Boost policy by intent (PHASE_1_FIXES Change 4)
   */
  static BOOST_POLICY = {
    definition_strong: {
      definitionBoost: 2.0,
      syntaxBoost: 1.8,
      kindHierarchy: true,
      positionBoost: true,
    },
    definition_mild: {
      // PHASE_1_FIXES: Increased from 1.5/1.3 to 1.8/1.5 per research
      definitionBoost: 1.8,
      syntaxBoost: 1.5,
      kindHierarchy: true,
      positionBoost: true,
    },
    general: {
      // PHASE_1_FIXES: Aggressive boosts restored per research (90.5% vs 90.0%)
      // Reference: https://opensourceconnections.com/blog/2022/12/16/approaches-to-field-boost-tuning-with-learning-to-rank/
      definitionBoost: 1.8,
      syntaxBoost: 1.8,
      kindHierarchy: true,
      positionBoost: false,
    },
    none: {
      definitionBoost: 1.0,
      syntaxBoost: 1.0,
      kindHierarchy: true,  // Keep mild type priors
      positionBoost: false,
    },
    structural: {
      definitionBoost: 1.0,
      syntaxBoost: 1.0,
      kindHierarchy: false,
      positionBoost: false,
    },
  };

  // SYMBOL_KIND_WEIGHTS and DEFINITION_TYPES imported from constants.js

  /**
   * Apply post-fusion boosts uniformly (PHASE_1_FIXES Change 4)
   *
   * Applied AFTER fusion so both lexical and semantic paths benefit equally.
   * Boost intensity controlled by router confidence.
   *
   * @param {Array} fusedResults - Results from robustCCFusion
   * @param {string} query - Original query
   * @param {string} routerMode - Mode from query router
   * @param {number} routerConfidence - Confidence from router
   * @returns {Array} Results with post-fusion boosts applied
   */
  applyPostFusionBoosts(fusedResults, query, routerMode, routerConfidence) {
    const boostIntent = this.getBoostIntent(routerMode, routerConfidence);
    const policy = SweetSearch.BOOST_POLICY[boostIntent] || SweetSearch.BOOST_POLICY.general;

    const queryLower = query.toLowerCase().trim();
    const queryTokens = this.extractQueryTokens(query);

    return fusedResults.map(result => {
      let totalBoost = 1.0;
      const boostDetails = [];

      // 1. Definition Boost (based on filename/name match)
      if (policy.definitionBoost > 1.0) {
        const defBoost = this.computeDefinitionBoost(result, queryLower, queryTokens);
        if (defBoost > 1.0) {
          const scaledBoost = 1.0 + (defBoost - 1.0) * (policy.definitionBoost - 1.0);
          totalBoost *= scaledBoost;
          boostDetails.push(`def:${scaledBoost.toFixed(2)}`);
        }
      }

      // 2. Syntax Boost (definition patterns in signature)
      if (policy.syntaxBoost > 1.0) {
        const synBoost = this.computeSyntaxBoost(result, queryTokens);
        if (synBoost > 1.0) {
          const scaledBoost = 1.0 + (synBoost - 1.0) * (policy.syntaxBoost - 1.0);
          totalBoost *= scaledBoost;
          boostDetails.push(`syntax:${scaledBoost.toFixed(2)}`);
        }
      }

      // 3. Symbol Kind Hierarchy (always mild)
      if (policy.kindHierarchy) {
        const kindWeight = SYMBOL_KIND_WEIGHTS[result.type] || 0.5;
        const kindBoost = 0.7 + 0.3 * kindWeight; // Softer: 0.7-1.0 range
        totalBoost *= kindBoost;
        if (kindWeight !== 1.0) {
          boostDetails.push(`kind:${kindBoost.toFixed(2)}`);
        }
      }

      // 4. Position Boost (only for strong definition intent)
      if (policy.positionBoost && result.startLine != null) {
        const posBoost = this.computePositionBoost(result);
        if (posBoost > 1.0) {
          totalBoost *= posBoost;
          boostDetails.push(`pos:${posBoost.toFixed(2)}`);
        }
      }

      // P0 FIX: Cap total boost to prevent over-promotion (max stacking = 4.68x theoretical)
      const cappedBoost = Math.min(totalBoost, 3.0);
      if (cappedBoost < totalBoost) {
        boostDetails.push(`capped:${totalBoost.toFixed(2)}→3.0`);
      }

      return {
        ...result,
        score: result.score * cappedBoost,
        _originalScore: result.score,
        _boostFactor: totalBoost,
        _boostDetails: boostDetails,
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Compute definition boost (PHASE_1_FIXES helper)
   */
  computeDefinitionBoost(result, queryLower, queryTokens) {
    const isDefinitionType = DEFINITION_TYPES.has(result.type);
    const resultNameLower = (result.name || '').toLowerCase();
    const fileName = (result.file || '').split('/').pop() || '';
    const fileNameNoExt = fileName.replace(/\.[^.]+$/, '').toLowerCase();

    const filenameMatchesQuery = queryTokens.some(token =>
      fileNameNoExt === token || fileNameNoExt.includes(token)
    );
    const exactNameMatch = queryTokens.some(token => resultNameLower === token);

    if (filenameMatchesQuery && isDefinitionType) return 2.0;
    if (exactNameMatch && isDefinitionType) return 1.5;
    if (isDefinitionType) return 1.2;
    return 1.0;
  }

  /**
   * Compute syntax boost (PHASE_1_FIXES helper)
   */
  computeSyntaxBoost(result, queryTokens) {
    const signature = (result.signature || '').toLowerCase();
    if (!signature) return 1.0;

    const definitionPatterns = [
      /\b(?:public|private|protected)?\s*(?:abstract|final)?\s*class\s+(\w+)/,
      /\b(?:public|private|protected)?\s*interface\s+(\w+)/,
      /\b(?:public|private|protected)?\s*enum\s+(\w+)/,
      /\bclass\s+(\w+)/,
      /\bfunction\s+(\w+)/,
      /\bexport\s+(?:default\s+)?(?:class|function)\s+(\w+)/,
      /\binterface\s+(\w+)/,
      /\btype\s+(\w+)\s*=/,
    ];

    for (const pattern of definitionPatterns) {
      const match = signature.match(pattern);
      if (match && match[1]) {
        const definedName = match[1].toLowerCase();
        if (queryTokens.some(token => definedName === token || definedName.includes(token))) {
          return 1.8;
        }
      }
    }

    return 1.0;
  }

  /**
   * Compute position boost (PHASE_1_FIXES helper)
   */
  computePositionBoost(result) {
    const startLine = result.startLine;
    if (startLine == null || startLine < 0) return 1.0;
    if (!DEFINITION_TYPES.has(result.type)) return 1.0;

    const rawPrior = 1 / (1 + startLine / 50);
    const positionPrior = Math.max(0.5, Math.min(1.0, rawPrior));
    return 1 + 0.3 * positionPrior;
  }

  /**
   * Extract query tokens for matching (PHASE_1_FIXES helper)
   */
  extractQueryTokens(query) {
    const tokens = new Set();
    tokens.add(query.toLowerCase().trim());

    for (const word of query.split(/\s+/)) {
      if (word.length > 0) tokens.add(word.toLowerCase());
    }

    const camelParts = query.split(/(?=[A-Z])/);
    for (const part of camelParts) {
      if (part.length > 1) tokens.add(part.toLowerCase());
    }

    return Array.from(tokens);
  }

  /**
   * Hybrid search V2 with raw paths + post-fusion boosts (PHASE_1_FIXES Change 5)
   *
   * Uses bm25Search(skipBoosts=true) for lexical path to ensure fair fusion.
   * Applies boosts AFTER fusion so both paths benefit equally.
   *
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<{results: Array, semanticStats: Object}>}
   */
  async hybridSearchV2(query, options = {}) {
    const { k = 10, useColBERT = this.useColBERT, routing: passedRouting } = options;

    // P9 FIX: Use passed routing or compute if not provided
    const routing = passedRouting || routeQuery(query);
    const routeType = routing.mode === 'hybrid' ? 'mixed' : routing.mode;

    // Step 1: Retrieval from both paths (raw scores, no pre-fusion boosts)
    // Use graphExpandedSearch with skipBoosts=true to get full recall:
    // - Definition-first search for identifier queries
    // - FTS5 + trigram + LIKE fallback
    // - Graph expansion for related entities
    // WITHOUT applying definition/intent boosts (those are applied post-fusion)
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
    // PHASE_1_FIXES: MMR is smarter than hard caps - it reranks based on both
    // relevance AND diversity without artificial blocking.
    // Reference: https://qdrant.tech/blog/mmr-diversity-aware-reranking/
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
        this.log(`MMR: reordered ${mmrStats.reorderCount} results (λ=${lambda.toFixed(2)})`);
      }
    }

    const results = diversified.slice(0, k).map(r => ({
      ...r,
      searchPath: 'hybrid',
      hybridScore: r.score,
      fusionMethod: method,
    }));

    this.log(`Hybrid V2 (${method}, α=${results[0]?.alpha?.toFixed(2) || '?'}): ${lexicalResults.length} lex + ${semanticResults.length} sem -> ${results.length} final`);

    return {
      results,
      semanticStats,
      fusionStats: {
        method,
        fallbackReason,
        mmrStats, // Changed from floodControlStats
        routerMode: routing.mode,
        routerConfidence: routing.confidence,
      },
    };
  }

  /**
   * @deprecated Use hybridSearchV2() instead - this method has architectural issues:
   * - Applies boosts during lexical retrieval (unfair to semantic path)
   * - Uses naive min-max normalization (vulnerable to outliers)
   * - No RRF fallback for edge cases
   *
   * Legacy hybrid search path with Convex Combination (CC) fusion or RRF.
   * Kept for reference but no longer called from search().
   *
   * @see hybridSearchV2 for the improved implementation
   */
  async hybridSearch(query, options = {}) {
    const { k = 10, expand = true, rrf_k = 60, fusion = 'cc', useColBERT = this.useColBERT, routing: passedRouting } = options;

    // P9 FIX: Use passed routing or compute if not provided (avoids redundant call)
    const routing = passedRouting || routeQuery(query);
    const routeType = routing.mode === 'hybrid' ? 'mixed' : routing.mode;

    // Run both paths in parallel
    // Fetch 1.5x candidates to ensure good coverage after fusion
    // P0 FIX: semanticSearch now returns { results, stats }
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

      this.log(`CC fusion (α=${results[0]?.alpha?.toFixed(2) || 0.55}): ${lexicalResults.length} lexical + ${semanticResults.length} semantic -> ${results.length} merged`);
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

  /**
   * O(N) vector scan fallback (when HNSW not available)
   * A1 FIX: Filters out stale entities to prevent returning outdated results
   */
  async vectorScan(queryEmbedding, limit = 100) {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const dbBuffer = await fs.readFile(this.codebaseDbPath);
    const db = new SQL.Database(dbBuffer);

    const stmt = db.prepare('SELECT id, embedding, text, metadata FROM vectors');
    const candidates = [];

    // A1 FIX: Build set of stale entity IDs for filtering
    const staleEntityIds = new Set();
    if (this.hasGraphIndex) {
      try {
        const graphDbBuffer = await fs.readFile(DB_PATHS.codeGraph);
        const graphDb = new SQL.Database(graphDbBuffer);

        // Check if stale_since column exists
        const columns = graphDb.exec("PRAGMA table_info(entities)");
        const hasStaleColumn = columns.length > 0 &&
          columns[0].values.some(col => col[1] === 'stale_since');

        if (hasStaleColumn) {
          const staleStmt = graphDb.prepare('SELECT id FROM entities WHERE stale_since IS NOT NULL');
          while (staleStmt.step()) {
            const row = staleStmt.getAsObject();
            staleEntityIds.add(row.id);
          }
          staleStmt.free();
        }
        graphDb.close();
      } catch (err) {
        this.log(`A1: Could not load stale entity list: ${err.message}`);
      }
    }

    while (stmt.step()) {
      const row = stmt.getAsObject();

      // Parse embedding
      const embeddingBuffer = row.embedding;
      const embedding = new Float32Array(
        embeddingBuffer.buffer,
        embeddingBuffer.byteOffset,
        embeddingBuffer.length / 4
      );

      // Cosine similarity
      const score = this.cosineSimilarity(queryEmbedding, Array.from(embedding));

      let metadata = {};
      try {
        metadata = row.metadata ? JSON.parse(row.metadata) : {};
      } catch {}

      candidates.push({
        id: row.id,
        content: row.text || '',
        score,
        metadata,
        entity_id: metadata.entity_id || null,  // A1: Track entity_id for filtering
      });
    }

    stmt.free();
    db.close();

    // A1 FIX: Filter out stale entities before returning results
    const activeResults = candidates.filter(r => {
      // If we have entity_id and it's in stale set, exclude it
      if (r.entity_id && staleEntityIds.has(r.entity_id)) {
        return false;
      }
      // Also check metadata for entity reference
      if (r.metadata?.entity_id && staleEntityIds.has(r.metadata.entity_id)) {
        return false;
      }
      return true;  // Keep if not stale or can't verify
    });

    this.log(`A1: Vector scan found ${candidates.length} candidates, ${activeResults.length} active (${staleEntityIds.size} stale entities filtered)`);

    return activeResults.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Load document content for reranking
   */
  async loadDocumentContent(candidates) {
    return candidates.map(c => {
      const content = c.content || c.text || '';
      const name = c.name || c.metadata?.name || '';
      const file = c.file || c.metadata?.file || '';
      return `${file} ${name}\n${content}`.slice(0, 1000);
    });
  }

  /**
   * Get unique key for a result
   */
  getResultKey(result) {
    // P0 FIX: Add null-safety for all fields to prevent undefined keys
    if (result.id) return String(result.id);
    if (result.file && result.startLine != null) return `${result.file}:${result.startLine}`;
    if (result.name) return String(result.name);
    // Fallback: hash first 100 chars of JSON representation
    return JSON.stringify(result || {}).slice(0, 100);
  }

  /**
   * Cosine similarity
   */
  cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Approximate ColBERT score using sentence-level query embedding
   *
   * Since we don't have token-level query embeddings in the current pipeline,
   * we approximate by computing max similarity between the query embedding
   * and each document token, then averaging.
   *
   * This is a simplified version of ColBERT's MaxSim that works with our
   * existing sentence embeddings. Full ColBERT would require token embeddings
   * for both query and document.
   *
   * @param {Float32Array|Array} queryEmbedding - Sentence-level query embedding
   * @param {Array<Array<number>>} docTokens - Document token embeddings
   * @returns {number} Approximate ColBERT score
   */
  approximateColBERTScore(queryEmbedding, docTokens) {
    if (!docTokens || docTokens.length === 0) return 0;

    const queryVec = Array.isArray(queryEmbedding) ? queryEmbedding : Array.from(queryEmbedding);

    // For each document token, compute similarity with query embedding
    let totalSim = 0;

    for (const docToken of docTokens) {
      const sim = this.cosineSimilarity(queryVec, docToken);
      totalSim += Math.max(0, sim); // Only positive similarities
    }

    // Average similarity across all tokens
    return totalSim / docTokens.length;
  }

  /**
   * Log message (if verbose)
   * Uses stderr to avoid corrupting JSON output
   */
  log(message) {
    if (this.verbose) {
      console.error(`[SweetSearch] ${message}`);
    }
  }

  /**
   * Log performance stats
   */
  logPerformance(stats) {
    const target = PERFORMANCE_TARGETS.latency;
    const path = stats.path;
    const total = stats.total_ms;

    let status = 'OK';
    if (path === 'lexical' && total > target.lexicalP50 * 2) status = 'SLOW';
    if (path === 'semantic' && total > target.semanticP50 * 2) status = 'SLOW';

    console.error(`[Perf] ${path} | ${total}ms | ${status}`);
  }

  /**
   * Format structural results for display
   */
  formatStructuralResults(results, stats) {
    if (!results.length) return `No results found for ${stats.targetEntity || 'query'}`;

    const type = results[0].structuralType;
    let out = `\n${'='.repeat(70)}\n`;
    out += `${type.toUpperCase()}: ${stats.targetEntity || ''} (${results.length} found)\n`;
    out += `${'='.repeat(70)}\n\n`;

    for (const r of results.slice(0, 30)) {
      out += `• ${r.name} (${r.type})`;
      if (r.depth > 1) out += ` [depth: ${r.depth}]`;
      if (r.riskScore) out += ` [risk: ${r.riskScore.toFixed(2)}]`;
      out += `\n`;
      out += `  ${r.file_path}:${r.start_line}`;
      if (r.call_line) out += ` (call at :${r.call_line})`;
      out += `\n`;
      if (r.summary) out += `  "${r.summary}"\n`;
      out += `\n`;
    }

    return out;
  }

  /**
   * Format results for display
   */
  formatResults(results, stats = {}) {
    // Check if this is structural results
    if (results.length > 0 && results[0].searchPath === 'structural') {
      return this.formatStructuralResults(results, stats);
    }

    if (results.length === 0) {
      return 'No results found';
    }

    let output = `\n${'='.repeat(80)}\n`;
    output += `TOP ${results.length} RESULTS\n`;
    output += `${'='.repeat(80)}\n\n`;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const name = r.name || r.metadata?.name || 'Unknown';
      const file = r.file || r.metadata?.file || r.id || '';
      const type = r.type || r.metadata?.type || '';
      const line = r.startLine || r.metadata?.startLine || '';

      output += `${i + 1}. ${name}${type ? ` (${type})` : ''}\n`;
      output += `   File: ${file}${line ? `:${line}` : ''}\n`;
      output += `   Path: ${r.searchPath}\n`;

      if (r.hybridScore !== undefined && r.rrfScore !== undefined) {
        // RRF hybrid results - show rank contributions
        const rankInfo = [];
        if (r.lexicalRank) rankInfo.push(`L#${r.lexicalRank}`);
        if (r.semanticRank) rankInfo.push(`S#${r.semanticRank}`);
        output += `   RRF: ${r.rrfScore.toFixed(4)} [${rankInfo.join(', ')}] (${r.sources?.join('+')})\n`;
      } else if (r.hybridScore !== undefined) {
        output += `   Score: ${r.hybridScore.toFixed(4)} (sources: ${r.sources?.join(', ')})\n`;
      } else if (r.rerankScore !== undefined) {
        output += `   Score: ${r.rerankScore.toFixed(4)} (reranked from ${r.originalScore?.toFixed(4)})\n`;
        if (r.colbertScore !== undefined && r.preColbertScore !== undefined) {
          output += `   ColBERT: ${r.colbertScore.toFixed(4)} (boosted from ${r.preColbertScore.toFixed(4)})\n`;
        }
      } else if (r.colbertScore !== undefined && r.preColbertScore !== undefined) {
        output += `   Score: ${r.int8Score?.toFixed(4)} (ColBERT: ${r.colbertScore.toFixed(4)}, pre: ${r.preColbertScore.toFixed(4)})\n`;
      } else {
        output += `   Score: ${r.score?.toFixed(4)}\n`;
      }

      // HCGS Summary-first: show summary before content
      if (r.summary) {
        output += `   Summary: ${r.summary}\n`;
      }

      const content = r.content || r.text || r.signature || '';
      const preview = content.slice(0, 150).replace(/\n/g, ' ').trim();
      if (preview) {
        output += `   ${preview}${content.length > 150 ? '...' : ''}\n`;
      }

      output += '\n';
    }

    return output;
  }

  /**
   * HCGS: Enrich results with summaries from graph database
   *
   * Returns results in summary-first format:
   * 1. Summary (10x fewer tokens than full code)
   * 2. File location for drill-down
   * 3. Full code only if needed
   */
  async enrichWithSummaries(results) {
    if (!this.hasGraphIndex || results.length === 0) {
      return results;
    }

    try {
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs();
      const dbBuffer = await fs.readFile(DB_PATHS.codeGraph);
      const db = new SQL.Database(dbBuffer);

      const enriched = [];

      for (const result of results) {
        // Try to find matching entity by name or file:line
        const name = result.name || result.metadata?.name;
        const file = result.file || result.metadata?.file;
        const line = result.startLine || result.metadata?.startLine;

        let entity = null;

        if (name) {
          const stmt = db.prepare(`
            SELECT id, name, type, signature, summary, file_path, start_line
            FROM entities
            WHERE name = ?
              AND stale_since IS NULL
            LIMIT 1
          `);
          stmt.bind([name]);
          if (stmt.step()) {
            entity = stmt.getAsObject();
          }
          stmt.free();
        }

        if (!entity && file && line) {
          const stmt = db.prepare(`
            SELECT id, name, type, signature, summary, file_path, start_line
            FROM entities
            WHERE file_path LIKE ? AND start_line <= ? AND end_line >= ?
              AND stale_since IS NULL
            LIMIT 1
          `);
          stmt.bind([`%${file}%`, line, line]);
          if (stmt.step()) {
            entity = stmt.getAsObject();
          }
          stmt.free();
        }

        if (entity && entity.summary) {
          enriched.push({
            ...result,
            summary: entity.summary,
            hasSummary: true,
          });
        } else {
          enriched.push(result);
        }
      }

      db.close();
      return enriched;
    } catch (err) {
      this.log(`Summary enrichment failed: ${err.message}`);
      return results;
    }
  }

  /**
   * HCGS: Format results with summary-first output (10x token reduction)
   *
   * Output format optimized for LLM consumption:
   * - Summary provides quick understanding
   * - File:line enables drill-down
   * - Full code only on demand
   */
  formatSummaryFirst(results) {
    if (results.length === 0) {
      return 'No results found';
    }

    let output = `\n${'='.repeat(60)}\n`;
    output += `SEARCH RESULTS (${results.length}) - Summary View\n`;
    output += `${'='.repeat(60)}\n\n`;

    let totalTokens = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const name = r.name || r.metadata?.name || 'Unknown';
      const file = r.file || r.metadata?.file || r.id || '';
      const type = r.type || r.metadata?.type || '';
      const line = r.startLine || r.metadata?.startLine || '';
      const location = `${file}${line ? `:${line}` : ''}`;

      // Compact format with summary
      if (r.summary) {
        output += `${i + 1}. [${type}] ${name} @ ${location}\n`;
        output += `   ${r.summary}\n\n`;
        totalTokens += Math.ceil(r.summary.length / 4); // Rough token estimate
      } else {
        // Fallback to signature if no summary
        const sig = r.signature || r.content?.slice(0, 100) || '';
        output += `${i + 1}. [${type}] ${name} @ ${location}\n`;
        if (sig) output += `   ${sig.replace(/\n/g, ' ')}\n\n`;
        totalTokens += Math.ceil(sig.length / 4);
      }
    }

    output += `${'='.repeat(60)}\n`;
    output += `Est. tokens: ~${totalTokens} (vs ~${totalTokens * 10} for full code)\n`;
    output += `Use: Read <file:line> for full code\n`;

    return output;
  }

  /**
   * Middle-Res View: Signature + Docstring (5x token reduction)
   *
   * Intermediate between summary and full code:
   * - Full signature for API understanding
   * - Docstring for intent/parameters
   * - No implementation details
   */
  formatMiddleRes(results) {
    if (results.length === 0) {
      return 'No results found';
    }

    let output = `\n${'='.repeat(70)}\n`;
    output += `SEARCH RESULTS (${results.length}) - Middle-Res View (Signature + Doc)\n`;
    output += `${'='.repeat(70)}\n\n`;

    let totalTokens = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const name = r.name || r.metadata?.name || 'Unknown';
      const file = r.file || r.metadata?.file || r.id || '';
      const type = r.type || r.metadata?.type || '';
      const line = r.startLine || r.metadata?.startLine || '';
      const location = `${file}${line ? `:${line}` : ''}`;

      output += `${i + 1}. [${type}] ${name}\n`;
      output += `   📍 ${location}\n`;

      // Full signature
      const sig = r.signature || '';
      if (sig) {
        output += `   📝 ${sig}\n`;
        totalTokens += Math.ceil(sig.length / 4);
      }

      // Docstring/comment (truncated)
      const doc = r.docComment || r.doc_comment || '';
      if (doc) {
        const truncDoc = doc.length > 200 ? doc.slice(0, 200) + '...' : doc;
        output += `   📖 ${truncDoc.replace(/\n/g, ' ')}\n`;
        totalTokens += Math.ceil(truncDoc.length / 4);
      }

      // Summary if available
      if (r.summary) {
        output += `   💡 ${r.summary}\n`;
        totalTokens += Math.ceil(r.summary.length / 4);
      }

      output += '\n';
    }

    output += `${'='.repeat(70)}\n`;
    output += `Est. tokens: ~${totalTokens} (5x less than full code)\n`;
    output += `Use: Read <file:line> for implementation details\n`;

    return output;
  }

  /**
   * Close all connections
   */
  close() {
    this.graphSearch.close();
  }
}

// =============================================================================
// MODULE-LEVEL SINGLETON (Warm Cache)
// =============================================================================

let _warmSearcher = null;
let _warmInitPromise = null;

/**
 * Get or create a warm SweetSearch instance (singleton pattern)
 * First call loads indexes (~400ms), subsequent calls are instant
 */
export async function getWarmSearcher(options = {}) {
  if (_warmSearcher && _warmSearcher.initialized) {
    return _warmSearcher;
  }

  if (_warmInitPromise) {
    await _warmInitPromise;
    return _warmSearcher;
  }

  _warmSearcher = new SweetSearch(options);
  _warmInitPromise = _warmSearcher.init();
  await _warmInitPromise;

  return _warmSearcher;
}

/**
 * Quick search using warm cache (for programmatic use)
 */
export async function warmSearch(query, options = {}) {
  const searcher = await getWarmSearcher();
  return searcher.search(query, options);
}

// =============================================================================
// HTTP SERVER MODE (--serve)
// =============================================================================

const SEARCH_SERVER_PORT = 9876;
const SEARCH_SERVER_SOCKET = '/tmp/sweet-search.sock';
const SEARCH_SERVER_SOCKET_LEGACY = '/tmp/search.sock';
const SEARCH_SERVER_PIDFILE = '/tmp/sweet-search-server.pid';

async function startServer() {
  const http = await import('http');

  const searcher = new SweetSearch({ verbose: false });
  console.log('[Server] Initializing indexes (one-time cost)...');
  const initStart = Date.now();
  await searcher.init();
  console.log(`[Server] Indexes loaded in ${Date.now() - initStart}ms`);

  // Write PID file
  await fs.writeFile(SEARCH_SERVER_PIDFILE, process.pid.toString());

  // P6 FIX: Track request count for periodic cache clearing
  let requestCount = 0;
  const CACHE_CLEAR_INTERVAL = 1000;  // Clear caches every 1000 requests

  // Shared request handler for both TCP and Unix socket
  const handleRequest = async (req, res) => {
    // P6 FIX: Periodic cache clearing to prevent memory growth
    requestCount++;
    if (requestCount % CACHE_CLEAR_INTERVAL === 0) {
      // Clear embedding cache if it exists
      if (searcher.embeddingCache) {
        searcher.embeddingCache.clear();
      }
      // Force garbage collection if available (run with --expose-gc)
      if (global.gc) {
        global.gc();
      }
      console.log(`[Server] Cache cleared after ${requestCount} requests`);
    }

    if (req.method === 'GET' && req.url.startsWith('/search?')) {
      const url = new URL(req.url, `http://localhost:${SEARCH_SERVER_PORT}`);
      const query = url.searchParams.get('q') || '';
      const mode = url.searchParams.get('mode') || 'auto';
      const topK = parseInt(url.searchParams.get('k') || '10', 10);

      // Additional search options
      const expand = url.searchParams.get('expand') !== 'false';
      const rerank = url.searchParams.get('rerank') !== 'false';
      const fusion = url.searchParams.get('fusion') || 'cc';  // Legacy (ignored for hybrid)
      // ColBERT: explicit param overrides config, else use config default
      const useColBERT = url.searchParams.has('colbert')
        ? url.searchParams.get('colbert') === 'true'
        : COLBERT_CONFIG.enabled;

      // Output format options
      const format = url.searchParams.get('format') || 'json';
      const summary = url.searchParams.get('summary') === 'true';
      const mid = url.searchParams.get('mid') === 'true';

      // Phase 4: Translation fallback
      const translate = url.searchParams.get('translate') || 'auto';

      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing query parameter ?q=' }));
        return;
      }

      try {
        const start = Date.now();
        let { results, stats } = await searcher.search(query, {
          k: topK,
          mode,
          expand,
          rerank,
          fusion,
          useColBERT,
          translate,
        });

        // Enrich with summaries if summary mode
        if (summary) {
          results = await searcher.enrichWithSummaries(results);
        }

        const totalTime = Date.now() - start;

        if (format === 'text') {
          // Pre-formatted text output (eliminates client-side parsing)
          const routeMode = stats?.routing?.mode || 'auto';
          const icon = routeMode === 'lexical' ? '⚡' : routeMode === 'semantic' ? '🧠' : '✨';
          const W = '\x1b[1;38;5;231m', D = '\x1b[38;5;245m', G = '\x1b[38;5;114m', R = '\x1b[0m';
          const Y = '\x1b[38;5;220m', C = '\x1b[38;5;51m';

          let out = `  ${icon} ${W}${routeMode}${R} ${D}│${R} ${W}${totalTime}ms${R} ${G}●${R}\n`;

          // Phase 4: Show translation info if fallback was used
          if (stats.translation?.triggered && stats.translation?.changed) {
            const T = '\x1b[38;5;208m'; // Orange for translation
            out += `  ${T}🌐 Translated: "${stats.translation.translated}" (${stats.translation.tier})${R}\n`;
            if (stats.translation.resultsAdded > 0) {
              out += `  ${T}   +${stats.translation.resultsAdded} results from translation${R}\n`;
            }
          }
          out += '\n';

          if (!results || results.length === 0) {
            out += 'No results\n';
          } else if (summary) {
            // Summary-first format (10x token reduction)
            out += `${Y}SUMMARY VIEW${R} (${results.length} results) - 10x fewer tokens\n`;
            out += `${'─'.repeat(50)}\n\n`;
            results.forEach((r, i) => {
              const m = r.metadata || {};
              const name = r.name || m.name || '?';
              const type = r.type || m.type || '?';
              const file = r.file || r.file_path || m.file || '?';
              // ID format: file:lineStart-lineEnd:chunkIndex (new) or file:lineStart (legacy)
              // Extract line range (second part) or fall back to last part for legacy IDs
              const idParts = r.id?.split(':') || [];
              const line = r.startLine || r.start_line || (idParts.length >= 2 ? idParts[1].split('-')[0] : '?');
              const summ = r.summary || r.signature?.slice(0, 100) || '';

              out += `${W}${i + 1}. [${type}] ${name}${R}\n`;
              out += `   ${C}${file}:${line}${R}\n`;
              if (summ) out += `   ${summ}\n`;
              out += '\n';
            });
            out += `${D}Use: Read <file:line> for full code${R}\n`;
          } else if (mid) {
            // Middle-res format (5x token reduction)
            out += `${Y}MIDDLE-RES VIEW${R} (${results.length} results) - Signature + Doc\n`;
            out += `${'─'.repeat(50)}\n\n`;
            results.forEach((r, i) => {
              const m = r.metadata || {};
              const name = r.name || m.name || '?';
              const type = r.type || m.type || '?';
              const file = r.file || r.file_path || m.file || '?';
              // ID format: file:lineStart-lineEnd:chunkIndex (new) or file:lineStart (legacy)
              // Extract line range (second part) or fall back to last part for legacy IDs
              const idParts = r.id?.split(':') || [];
              const line = r.startLine || r.start_line || (idParts.length >= 2 ? idParts[1].split('-')[0] : '?');
              const sig = r.signature || '';
              const doc = (r.docComment || r.doc_comment || '').slice(0, 150);

              out += `${W}${i + 1}. [${type}] ${name}${R}\n`;
              out += `   ${C}${file}:${line}${R}\n`;
              if (sig) out += `   ${sig}\n`;
              if (doc) out += `   ${D}${doc}${R}\n`;
              out += '\n';
            });
          } else {
            // Full format (default)
            out += `${results.length} results:\n\n`;
            results.forEach((r, i) => {
              const m = r.metadata || {};
              const name = r.name || m.name || '?';
              const type = r.type || m.type || '?';
              const file = r.file || r.file_path || m.file || '?';
              // ID format: file:lineStart-lineEnd:chunkIndex (new) or file:lineStart (legacy)
              // Extract line range (second part) or fall back to last part for legacy IDs
              const idParts = r.id?.split(':') || [];
              const line = r.startLine || r.start_line || (idParts.length >= 2 ? idParts[1].split('-')[0] : '?');
              const score = (r.score || 0).toFixed(4);
              const path = r.searchPath || '?';
              const sig = (r.signature || r.docComment || m.signature || '').slice(0, 70);

              out += `${W}${i + 1}. ${name}${R} (${type})\n`;
              out += `   File: ${file}:${line}\n`;
              out += `   Path: ${path}\n`;
              out += `   Score: ${score}\n`;
              if (sig) out += `   ${sig}\n`;
              out += '\n';
            });
          }

          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(out);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            results,
            stats: { ...stats, server_ms: totalTime },
          }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', warm: true }));
    } else if (req.method === 'GET' && req.url === '/stop') {
      // F-06: Only allow /stop via Unix socket (OS-level access control)
      const isUnixSocket = !req.socket.remoteAddress;
      if (!isUnixSocket) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: /stop is only available via Unix socket\n');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Shutting down...\n');
      tcpServer.close();
      unixServer.close();
      try { await fs.unlink(SEARCH_SERVER_PIDFILE); } catch {}
      try { await fs.unlink(SEARCH_SERVER_SOCKET); } catch {}
      try { await fs.unlink(SEARCH_SERVER_SOCKET_LEGACY); } catch {}
      process.exit(0);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found. Use GET /search?q=<query>&mode=auto&k=10\n');
    }
  };

  // TCP server (port 9876) - backward compatible
  const tcpServer = http.createServer(handleRequest);
  tcpServer.listen(SEARCH_SERVER_PORT);
  console.log(`[Server] TCP listening on http://localhost:${SEARCH_SERVER_PORT}`);

  // Unix socket server (/tmp/sweet-search.sock) - 30-50% faster
  const unixServer = http.createServer(handleRequest);
  try { await fs.unlink(SEARCH_SERVER_SOCKET); } catch {} // Remove stale socket
  unixServer.listen(SEARCH_SERVER_SOCKET);
  console.log(`[Server] Unix socket listening on ${SEARCH_SERVER_SOCKET}`);
  console.log(`[Server] Fast access: curl --unix-socket ${SEARCH_SERVER_SOCKET} "http://localhost/search?q=query"`);

  // Legacy socket symlink for backward compatibility (/tmp/search.sock → /tmp/sweet-search.sock)
  try { await fs.unlink(SEARCH_SERVER_SOCKET_LEGACY); } catch {}
  try { await fs.symlink(SEARCH_SERVER_SOCKET, SEARCH_SERVER_SOCKET_LEGACY); } catch {}

  // Alias for graceful shutdown
  const server = tcpServer;

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Server] Shutting down...');
    tcpServer.close();
    unixServer.close();
    searcher.close();
    try { await fs.unlink(SEARCH_SERVER_PIDFILE); } catch {}
    try { await fs.unlink(SEARCH_SERVER_SOCKET); } catch {}
    try { await fs.unlink(SEARCH_SERVER_SOCKET_LEGACY); } catch {}
    process.exit(0);
  });
}

async function queryServer(query, options = {}) {
  const http = await import('http');
  const {
    mode = 'auto',
    topK = 10,
    expand = true,
    rerank = true,
    fusion = 'cc',  // Legacy (ignored for hybrid)
    useColBERT = true,
    summary = false,
    mid = false,
  } = options;

  return new Promise((resolve, reject) => {
    // Build URL with all parameters
    const params = new URLSearchParams({
      q: query,
      mode,
      k: topK.toString(),
      fusion,
    });
    if (!expand) params.set('expand', 'false');
    if (!rerank) params.set('rerank', 'false');
    if (!useColBERT) params.set('colbert', 'false');
    if (summary) params.set('summary', 'true');
    if (mid) params.set('mid', 'true');

    const url = `http://localhost:${SEARCH_SERVER_PORT}/search?${params.toString()}`;

    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Invalid server response'));
        }
      });
    }).on('error', reject);
  });
}

async function isServerRunning() {
  try {
    const http = await import('http');
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${SEARCH_SERVER_PORT}/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

/**
 * Auto-spawn warm server in background
 * Returns true if server started successfully
 */
async function autoSpawnServer() {
  const { spawn } = await import('child_process');
  const { fileURLToPath } = await import('url');

  const __filename = fileURLToPath(import.meta.url);

  console.error('[AutoStart] Starting warm server in background...');

  // Spawn detached process
  const child = spawn(process.execPath, [__filename, '--serve'], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(__filename),
  });

  child.unref();

  // Wait for server to be ready (up to 5 seconds)
  const maxWait = 5000;
  const checkInterval = 100;
  let waited = 0;

  while (waited < maxWait) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    waited += checkInterval;

    if (await isServerRunning()) {
      console.error(`[AutoStart] Server ready in ${waited}ms`);
      return true;
    }
  }

  console.error('[AutoStart] Server startup timeout, using cold start');
  return false;
}

// =============================================================================
// CLI STYLING (ANSI truecolor w/ fallback)
// =============================================================================

const STYLE = (() => {
  // 5 shades of dark blue (edge → center). These are intentionally spaced apart
  // so they remain distinguishable on typical dark terminal themes.
  const colors = {
    darkest:       { r: 6,   g: 10,  b: 31  },  // #060A1F
    darker:        { r: 10,  g: 17,  b: 52  },  // #0A1134
    dark:          { r: 14,  g: 24,  b: 73  },  // #0E1849
    lightDark:     { r: 18,  g: 32,  b: 95  },  // #12205F
    lightestDark:  { r: 22,  g: 40,  b: 116 },  // #162874
    border:        { r: 90,  g: 115, b: 220 },  // #5A73DC
    white:         { r: 255, g: 255, b: 255 },  // #FFFFFF
  };

  const reset = '\x1b[0m';
  const bold = '\x1b[1m';

  const lerp = (c1, c2, t) => ({
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  });

  // Convert RGB to xterm-256 color code (fallback for terminals without truecolor)
  const rgbToAnsi256 = (r, g, b) => {
    // Grayscale range
    if (r === g && g === b) {
      if (r < 8) return 16;
      if (r > 248) return 231;
      return Math.round(((r - 8) / 247) * 24) + 232;
    }

    const to6 = (v) => Math.round((v / 255) * 5);
    const rr = to6(r);
    const gg = to6(g);
    const bb = to6(b);
    return 16 + (36 * rr) + (6 * gg) + bb;
  };

  const fg24 = (c) => `\x1b[38;2;${c.r};${c.g};${c.b}m`;
  const bg24 = (c) => `\x1b[48;2;${c.r};${c.g};${c.b}m`;

  const fg256 = (c) => `\x1b[38;5;${rgbToAnsi256(c.r, c.g, c.b)}m`;
  const bg256 = (c) => `\x1b[48;5;${rgbToAnsi256(c.r, c.g, c.b)}m`;

  const detectColorMode = () => {
    const forced = (process.env.SWEET_SEARCH_COLOR_MODE || process.env.SMART_SEARCH_COLOR_MODE || '').trim().toLowerCase();
    if (forced === 'none' || forced === '0' || forced === 'off') return 'none';
    if (forced === '256' || forced === 'ansi256' || forced === 'xterm256') return 'ansi256';
    if (forced === 'truecolor' || forced === '24bit' || forced === 'rgb') return 'truecolor';

    if (process.env.NO_COLOR) return 'none';

    const colorterm = process.env.COLORTERM || '';
    if (/truecolor|24bit/i.test(colorterm)) return 'truecolor';

    // Windows Terminal + VS Code terminals are typically truecolor-capable.
    if (process.env.WT_SESSION || process.env.TERM_PROGRAM === 'vscode') return 'truecolor';

    const term = process.env.TERM || '';
    if (/256color/i.test(term)) return 'ansi256';

    return 'none';
  };

  const colorMode = detectColorMode(); // 'truecolor' | 'ansi256' | 'none'
  const fg = colorMode === 'truecolor' ? fg24 : colorMode === 'ansi256' ? fg256 : () => '';
  const bg = colorMode === 'truecolor' ? bg24 : colorMode === 'ansi256' ? bg256 : () => '';

  const headerStyleEnv = (process.env.SWEET_SEARCH_HEADER_STYLE || process.env.SMART_SEARCH_HEADER_STYLE || '').trim().toLowerCase();
  const headerStyle =
    headerStyleEnv === 'zones' || headerStyleEnv === 'gradient'
      ? headerStyleEnv
      : (colorMode === 'truecolor' ? 'gradient' : 'zones');

  return {
    colors,
    fg,
    bg,
    reset: colorMode === 'none' ? '' : reset,
    bold: colorMode === 'none' ? '' : bold,
    lerp,
    colorMode,
    headerStyle,
  };
})();

// 2-line pixel art using half-blocks - SWEET SEARCH
// Uses ▄ at bottom of L1 + ▀ at top of L2 for middle bars (E,A,H)
// W is 5 chars wide with ▄/█ showing double peaks
// R has leg on RIGHT via ▄ in L2
// S  W(5)  E   E   T      S   E   A   R   C   H
const SWEET_SEARCH_L1 = '█▀▀ █ █ █ █▀▀ █▀▀ ▀█▀  █▀▀ █▀▀ ▄▀▄ █▀▄ █▀▀ █▄█';
const SWEET_SEARCH_L2 = '▄▄█ ▀▄█▄▀ ██▄ ██▄  █   ▄▄█ ██▄ █▀█ ██▄ █▄▄ █▀█';

/**
 * Print styled header - 2-line pixel art with query on right = 2 content lines.
 * Line 1: Top half of pixel letters
 * Line 2: Bottom half of pixel letters + query on right
 */
function printStyledHeader(query) {
  const width = Math.min(process.stdout.columns || 80, 80);
  const { colors, fg, bg, reset, bold } = STYLE;

  const artLen = SWEET_SEARCH_L2.length;
  const maxQueryLen = width - artLen - 8; // space between art and query
  const displayQuery = query.length > maxQueryLen
    ? query.slice(0, maxQueryLen - 3) + '...'
    : query;

  const palette = [
    colors.darkest,
    colors.darker,
    colors.dark,
    colors.lightDark,
    colors.lightestDark,
  ];

  const getBgColor = (i, w) => {
    const pos = i / Math.max(1, w - 1);
    const t = 1 - Math.abs(0.5 - pos) * 2;
    const zone = Math.min(Math.floor(t * palette.length), palette.length - 1);
    return palette[zone];
  };

  // Build a line with left content (art) and optional right content (query)
  const buildLine = (leftContent, rightContent = null, isArt = false) => {
    let result = '';
    const leftPad = 2;
    const rightPad = 2;
    const rightStart = rightContent ? width - rightPad - rightContent.length : width;

    for (let i = 0; i < width; i++) {
      const bgColor = getBgColor(i, width);
      const leftCharIdx = i - leftPad;
      const rightCharIdx = i - rightStart;

      if (rightContent && rightCharIdx >= 0 && rightCharIdx < rightContent.length) {
        // Right content (query) - white text
        result += bold + fg(colors.white) + bg(bgColor) + rightContent[rightCharIdx];
      } else if (leftCharIdx >= 0 && leftCharIdx < leftContent.length) {
        // Left content (art)
        const fgColor = isArt ? colors.border : colors.white;
        result += bold + fg(fgColor) + bg(bgColor) + leftContent[leftCharIdx];
      } else {
        result += bg(bgColor) + ' ';
      }
    }
    return result + reset;
  };

  const queryStr = `"${displayQuery}"`;

  console.log('');
  console.log(buildLine(SWEET_SEARCH_L1, null, true));      // Top pixels
  console.log(buildLine(SWEET_SEARCH_L2, queryStr, true));  // Bottom pixels + query right
}

/**
 * Print styled stats line
 */
function printStyledStats(stats, isWarm = false) {
  const { colors, fg, reset } = STYLE;
  const mode = stats.routing?.mode || stats.mode || 'auto';
  const pathType = stats.path || 'hybrid';
  const timeMs = stats.server_ms || stats.total_ms || 0;

  const modeIcon = { lexical: '⚡', semantic: '🧠', hybrid: '⚗️', structural: '🔗', auto: '✨' }[mode] || '◆';
  const warmIcon = isWarm ? `${fg(colors.border)}●${reset}` : `${fg(colors.darker)}○${reset}`;

  console.log(
    `  ${modeIcon} ${fg(colors.white)}${mode}${reset} ` +
    `${fg(colors.dark)}│${reset} ${fg(colors.border)}${pathType}${reset} ` +
    `${fg(colors.dark)}│${reset} ${fg(colors.white)}${timeMs}ms${reset} ${warmIcon}`
  );
  console.log('');
}

// =============================================================================
// CLI
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Sweet Search v2.3 - Unified Code Search with Auto-Warm Server

Usage:
  sweet-search <query> [options]
  sweet-search --stop               Stop warm server

Options:
  --mode <mode>     Search mode: auto, lexical, semantic, hybrid (default: auto)
  --top, -k <n>     Number of results (default: 10)
  --no-expand       Disable graph expansion
  --no-rerank       Disable reranking
  --fusion <type>   Legacy: cc or rrf (ignored for hybrid - always uses robust CC fusion)
  --colbert         Enable ColBERT late interaction (if index available)
  --summary         HCGS summary-first output (10x token reduction)
  --mid             Middle-res view: signature + docstring (5x token reduction)
  --json            Output as JSON
  --verbose, -v     Enable verbose logging
  --cold            Force cold start (skip auto-start server)
  --serve           Manually start server (usually not needed)

Auto-Warm Server (automatic):
  The server automatically starts on first search and stays warm:
  - First search: ~1-2s (server startup + index load)
  - Subsequent:   ~6-10ms lexical, ~275ms semantic (warm cache)

  Server runs in background until explicitly stopped or system restart.

Examples:
  sweet-search "AuthService"        # Auto-starts server, uses warm cache
  sweet-search "how does auth work" # Semantic search
  sweet-search "auth" --cold        # Skip server, cold start only
  sweet-search --stop               # Stop warm server
`);
    process.exit(0);
  }

  // Handle --serve
  if (args[0] === '--serve') {
    startServer();
  } else if (args[0] === '--stop') {
    (async () => {
      try {
        const http = await import('http');
        http.get(`http://localhost:${SEARCH_SERVER_PORT}/stop`);
        console.log('Stop signal sent');
      } catch {
        console.log('Server not running');
      }
    })();
  } else {
    // Normal query mode
    let query = '';
    let mode = 'auto';
    let topK = 10;
    let expand = true;
    let rerank = true;
    let fusion = 'cc'; // Legacy (ignored for hybrid - always uses robust CC)
    let useColBERT = COLBERT_CONFIG.enabled; // Auto from config, --colbert flag can override
    let json = false;
    let verbose = false;
    let summaryFirst = false;
    let middleRes = false;
    let forceCold = false;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '--mode' && args[i + 1]) {
        mode = args[++i];
      } else if ((arg === '--top' || arg === '-k') && args[i + 1]) {
        topK = parseInt(args[++i], 10);
      } else if (arg === '--no-expand') {
        expand = false;
      } else if (arg === '--no-rerank') {
        rerank = false;
      } else if (arg === '--fusion' && args[i + 1]) {
        fusion = args[++i]; // Legacy: 'cc' or 'rrf' (ignored for hybrid)
      } else if (arg === '--colbert') {
        useColBERT = true;
      } else if (arg === '--no-colbert') {
        useColBERT = false;
      } else if (arg === '--json') {
        json = true;
      } else if (arg === '--summary') {
        summaryFirst = true;
      } else if (arg === '--mid') {
        middleRes = true;
      } else if (arg === '--verbose' || arg === '-v') {
        verbose = true;
      } else if (arg === '--cold') {
        forceCold = true;
      } else if (!arg.startsWith('--')) {
        query = arg;
      }
    }

    if (!query) {
      console.error('Error: Query required');
      process.exit(1);
    }

    (async () => {
      // Check if warm server is running (unless --cold)
      let serverRunning = !forceCold && await isServerRunning();

      // Auto-start server if not running (unless --cold)
      if (!serverRunning && !forceCold) {
        serverRunning = await autoSpawnServer();
      }

      if (serverRunning) {
        // Use warm server (fast path)
        try {
          const response = await queryServer(query, {
            mode,
            topK,
            expand,
            rerank,
            fusion,
            useColBERT,
            summary: summaryFirst,
            mid: middleRes,
          });

          if (response.error) {
            console.error('Server error:', response.error);
            process.exit(1);
          }

          const { results, stats } = response;

          if (json) {
            console.log(JSON.stringify({ results, stats }, null, 2));
          } else {
            printStyledHeader(query);
            printStyledStats(stats, true);

            // Simple format for server results
            const searcher = new SweetSearch();
            if (stats.path === 'structural') {
              console.log(searcher.formatStructuralResults(results, stats));
            } else if (summaryFirst) {
              console.log(searcher.formatSummaryFirst(results));
            } else if (middleRes) {
              console.log(searcher.formatMiddleRes(results));
            } else {
              console.log(searcher.formatResults(results, stats));
            }
          }
        } catch (err) {
          console.error('Server query failed, falling back to cold start:', err.message);
          // Fall through to cold start
        }
        process.exit(0);
      }

      // Cold start (server auto-start failed or --cold flag)
      const searcher = new SweetSearch({
        verbose,
        returnSummaryFirst: summaryFirst,
        useColBERT
      });

      // Auto-persist frequent queries to vocabulary on exit
      registerAutoPersistOnExit(2);

      try {
        let { results, stats } = await searcher.search(query, {
          k: topK,
          mode,
          expand,
          rerank,
          fusion,
          useColBERT,
        });

        // HCGS: Enrich with summaries if summary-first mode
        if (summaryFirst) {
          results = await searcher.enrichWithSummaries(results);
        }

        if (json) {
          console.log(JSON.stringify({ results, stats }, null, 2));
        } else {
          printStyledHeader(query);
          printStyledStats(stats, false);

          if (stats.path === 'structural') {
            console.log(searcher.formatStructuralResults(results, stats));
          } else if (summaryFirst) {
            console.log(searcher.formatSummaryFirst(results));
          } else if (middleRes) {
            console.log(searcher.formatMiddleRes(results));
          } else {
            console.log(searcher.formatResults(results, stats));
          }
        }
      } catch (err) {
        console.error('Error:', err.message);
        if (verbose) console.error(err.stack);
        process.exit(1);
      } finally {
        searcher.close();
      }
    })();
  }
}

export default SweetSearch;
export { SweetSearch as SmartSearch };
