/**
 * Search Semantic Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains the 3-stage semantic search pipeline and standard semantic search.
 *
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 */

import {
  getBinaryEmbedding,
  getEmbedding,
  truncateForHNSW,
  floatToInt8,
  int8CosineSimilarity,
} from './embedding-service.js';
import { EMBEDDING_CONFIG } from './config.js';

// =============================================================================
// 3-Stage Semantic Search
// =============================================================================

/**
 * 3-Stage Semantic Search Pipeline (P0 + P3)
 *
 * Performance targets:
 *   Stage 1 (Binary): ~100us for 1000 candidates (10x faster than float)
 *   Stage 2 (Int8):   ~1ms for 100 candidates
 *   Stage 3 (Rerank): ~50-100ms for 20 candidates
 *   Total: <150ms end-to-end
 *
 * Returns: { results: Array, stats: Object } with embedding/rerank stats for CostTracker
 *
 * Uses `this` extensively.
 */
export async function semanticSearch3Stage(query, options = {}) {
  const { k = 10, rerank = true, useColBERT = this.useColBERT } = options;
  const stats = { stages: {} };

  // Generate binary embedding (with caching)
  const embedStart = performance.now();
  const embedResult = await getBinaryEmbedding(query);
  stats.embed_us = Math.round((performance.now() - embedStart) * 1000);
  this.log(`Embedding: ${stats.embed_us}us (${embedResult.source})`);

  // P0 FIX: Add embedding stats for CostTracker
  stats.embedding = {
    source: embedResult.source || (embedResult.cached ? 'cache' : 'api'),
    tokens: embedResult.tokens || Math.ceil(query.length / 4),
    provider: EMBEDDING_CONFIG.provider,
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
  this.log(`Stage 1 (Binary): ${stage1Result.latency_us}us, ${stage1Result.results.length} candidates`);

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
  let scoredCandidates = [];
  let missingInt8Count = 0;
  for (const candidate of stage1Result.results.slice(0, this.stage2Candidates)) {
    const int8Vector = this.binaryHnswIndex.getInt8Vector(candidate.id);
    if (int8Vector) {
      candidate.int8Score = int8CosineSimilarity(queryInt8, int8Vector);
    } else {
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
  this.log(`Stage 2 (Int8): ${stats.stages.int8.latency_us}us, ${scoredCandidates.length} rescored`);

  // EARLY EXIT: Use score spread analysis to skip ColBERT and reranking
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
      this.log(`Stage 2.5 (ColBERT): ${stats.stages.colbert.latency_us}us for ${topCandidates.length} candidates`);
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

// =============================================================================
// Standard Semantic Search (fallback)
// =============================================================================

/**
 * Standard Semantic Search (fallback when binary index not available)
 *
 * Returns: { results: Array, stats: Object } with embedding/rerank stats for CostTracker
 *
 * Uses `this` extensively.
 */
export async function semanticSearchStandard(query, options = {}) {
  const { k = 10, rerank = true } = options;
  const stats = { stages: {} };

  // Generate query embedding (with caching)
  const embedStart = performance.now();
  const embedResult = await getEmbedding(query, { isQuery: true });
  const fullEmbedding = embedResult.embedding || embedResult; // Handle both new and old API
  const embedLatency_us = embedResult.latency_us || Math.round((performance.now() - embedStart) * 1000);
  const cacheStatus = embedResult.source || 'unknown';
  this.log(`Embedding: ${embedLatency_us}us (${cacheStatus})`);

  // P0 FIX: Add embedding stats for CostTracker
  stats.embedding = {
    source: embedResult.source || (embedResult.cached ? 'cache' : 'api'),
    tokens: embedResult.tokens || Math.ceil(query.length / 4),
    provider: EMBEDDING_CONFIG.provider,
    cached: embedResult.cached || embedResult.source === 'vocabulary' || embedResult.source === 'lru' || false,
    latency_us: embedLatency_us,
  };

  // Truncate to HNSW dimension (1024d -> 512d Matryoshka)
  const queryEmbedding = truncateForHNSW(fullEmbedding);

  let candidates;

  if (this.hasHnswIndex) {
    // ADAPTIVE CANDIDATE SIZING: Reduce candidates for simple queries
    const baseNumCandidates = rerank ? Math.max(k * 10, 100) : k;
    const numCandidates = this.getAdaptiveCandidateCount(query, baseNumCandidates);

    const hnswResult = await this.hnswIndex.search(queryEmbedding, numCandidates);
    candidates = hnswResult.results;
    this.log(`HNSW: ${hnswResult.latency_us}us for ${hnswResult.k} candidates (adaptive: ${numCandidates})`);
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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Score spread analysis for intelligent rerank skipping.
 * Pure function — does not reference `this`. On prototype for call-site convenience.
 */
export function shouldSkipRerank(scores, options = {}) {
  const {
    topGapThreshold = 0.10,
    spreadThreshold = 0.08,
    highConfidence = 0.85,
    minResults = 3,
    minScoreThreshold = 0.50,
  } = options;

  if (!scores || scores.length < minResults) {
    return { skip: false, reason: 'insufficient_results' };
  }

  const sorted = [...scores].sort((a, b) => b - a);
  const topGap = sorted[0] - sorted[1];
  const spread = sorted[0] - sorted[sorted.length - 1];
  const topScores = sorted.slice(0, Math.min(3, sorted.length));

  // Check 0: Never skip if scores are too low
  if (sorted[0] < minScoreThreshold) {
    return { skip: false, reason: `low_scores (max=${sorted[0].toFixed(3)}, threshold=${minScoreThreshold})` };
  }

  // Check 1: Clear winner
  if (topGap > topGapThreshold) {
    return { skip: true, reason: `clear_winner (gap=${topGap.toFixed(3)})` };
  }

  // Check 2: Tight cluster
  if (spread < spreadThreshold) {
    return { skip: true, reason: `tight_cluster (spread=${spread.toFixed(3)})` };
  }

  // Check 3: All high confidence matches
  if (topScores.every(s => s > highConfidence)) {
    return { skip: true, reason: `high_confidence (min=${Math.min(...topScores).toFixed(3)})` };
  }

  return { skip: false, reason: 'needs_rerank' };
}

/**
 * Adaptive candidate count based on query complexity
 */
export function getAdaptiveCandidateCount(query, baseCount) {
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
