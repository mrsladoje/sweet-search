/**
 * Search Semantic Module
 *
 * Extracted from sweet-search.js (SOLID refactor).
 * Contains the 3-stage semantic search pipeline and standard semantic search.
 *
 * Functions that use `this` are regular function declarations (not arrows)
 * so they work correctly when wired onto SweetSearch.prototype.
 *
 * Rescoring Fix changes:
 *   Phase 0: Enhanced per-stage instrumentation, score-distribution signals
 *   Phase 1: Batched normalized-dot Stage 2 scoring (no per-candidate norms)
 *   Phase 2: Fixed Stage 2.5 dimension mismatch, float store direct access
 *   Phase 3: Adaptive oversampling (replaces fixed 200/200 pools)
 */

import {
  getBinaryEmbedding,
  getEmbedding,
  truncateForHNSW,
  floatToInt8,
  normalizedFloatToInt8,
  int8CosineSimilarity,
  int8BatchDotScores,
} from '../embedding/embedding-service.js';
import { EMBEDDING_CONFIG, BINARY_HNSW_CONFIG } from '../infrastructure/config/index.js';

const CASCADE_DEFERRED_STATS = { skipped: true, reason: 'cascade_deferred', provider: null, documents: 0, tokens: 0 };
const FULL_VECTOR_STAGE_WEIGHT = 0.80;
const FULL_VECTOR_STAGE_LIMIT = 200;

function cascadeDefer(candidates, stats, searchPath, k = 50) {
  const results = candidates.slice(0, k).map(r => ({ ...r, searchPath }));
  stats.rerank = CASCADE_DEFERRED_STATS;
  return { results, stats };
}

function dotProduct(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0);
  if (n === 0) return null;
  let score = 0;
  for (let i = 0; i < n; i++) score += a[i] * b[i];
  return score;
}

function normalizeScore(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  if (!(max > min)) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function envNumber(name, fallback, min = 0, max = Infinity) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function applyFullVectorStageRescore(candidates, queryFloat, codebaseRepo, opts = {}) {
  if (!Array.isArray(candidates) || candidates.length < 3) return { candidates, stats: null };
  if (!queryFloat || !codebaseRepo?.getEmbeddingsByIds) return { candidates, stats: null };

  const limit = Math.min(candidates.length, opts.limit ?? FULL_VECTOR_STAGE_LIMIT);
  const head = candidates.slice(0, limit);
  const ids = head.map(c => c.id).filter(Boolean);
  if (ids.length === 0) return { candidates, stats: null };

  const embeddings = codebaseRepo.getEmbeddingsByIds(ids);
  if (!embeddings || embeddings.size < 2) return { candidates, stats: null };

  const scored = head.map((candidate, index) => {
    const vector = candidate.id ? embeddings.get(candidate.id) : null;
    const fullScore = vector ? dotProduct(queryFloat, vector) : null;
    const baseScore = candidate.floatScore ?? candidate.int8Score ?? candidate.score ?? 0;
    return { candidate, index, baseScore, fullScore };
  });
  const withFull = scored.filter(item => Number.isFinite(item.fullScore));
  if (withFull.length < 2) return { candidates, stats: null };

  const baseValues = scored.map(item => item.baseScore);
  const fullValues = withFull.map(item => item.fullScore);
  const minBase = Math.min(...baseValues);
  const maxBase = Math.max(...baseValues);
  const minFull = Math.min(...fullValues);
  const maxFull = Math.max(...fullValues);
  const weight = opts.weight ?? envNumber('SWEET_SEARCH_FULL_VECTOR_STAGE_WEIGHT', FULL_VECTOR_STAGE_WEIGHT, 0, 1);

  const reranked = scored.map(item => {
    if (!Number.isFinite(item.fullScore)) {
      return { ...item.candidate, _fullVectorStageOrigIndex: item.index };
    }
    const baseNorm = normalizeScore(item.baseScore, minBase, maxBase);
    const fullNorm = normalizeScore(item.fullScore, minFull, maxFull);
    return {
      ...item.candidate,
      fullVectorScore: item.fullScore,
      fullVectorNorm: fullNorm,
      preFullVectorScore: item.baseScore,
      semanticBlendScore: (1 - weight) * baseNorm + weight * fullNorm,
      _fullVectorStageOrigIndex: item.index,
    };
  });
  reranked.sort((a, b) => {
    const d = (b.semanticBlendScore || 0) - (a.semanticBlendScore || 0);
    return d !== 0 ? d : a._fullVectorStageOrigIndex - b._fullVectorStageOrigIndex;
  });
  for (const candidate of reranked) {
    delete candidate._fullVectorStageOrigIndex;
    candidate.score = candidate.semanticBlendScore;
  }

  return {
    candidates: limit === candidates.length ? reranked : reranked.concat(candidates.slice(limit)),
    stats: { candidates: withFull.length, window: limit, weight },
  };
}

// =============================================================================
// Phase 0: Score-Spread Analysis (shared signal source)
// =============================================================================

// Thresholds shared between shouldSkipRerank and adaptive pool sizing.
// Single source of truth — no parallel heuristic stacks.
const SCORE_SPREAD = {
  topGapThreshold: 0.10,   // Gap above this = clear winner
  spreadThreshold: 0.08,   // Spread below this = tight cluster / ambiguous
};

/**
 * Analyze score-spread signals from a set of scores. O(n) single pass —
 * no sort needed since we only need top-1, top-2, min, mean, and variance.
 *
 * Used by both shouldSkipRerank (to skip CE) and adaptive pool sizing
 * (to shrink/widen candidate pools). Single computation, reused everywhere.
 */
function analyzeScoreSpread(scores) {
  if (!scores || scores.length < 2) return null;
  const n = scores.length;

  // Single O(n) pass: top1, top2, min, sum, sumSq
  let top1 = -Infinity, top2 = -Infinity, min = Infinity, sum = 0;
  for (let i = 0; i < n; i++) {
    const s = scores[i];
    sum += s;
    if (s > top1) { top2 = top1; top1 = s; }
    else if (s > top2) { top2 = s; }
    if (s < min) min = s;
  }
  const mean = sum / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (scores[i] - mean) ** 2;
  variance /= n;

  const topGap = top1 - top2;
  const spread = top1 - min;

  return {
    top1, top2, topGap, spread, mean,
    stdDev: Math.sqrt(variance),
    count: n,
    isDecisive: topGap > SCORE_SPREAD.topGapThreshold,
    isAmbiguous: spread < SCORE_SPREAD.spreadThreshold,
  };
}

// =============================================================================
// Phase 3: Adaptive Pool Sizing
// =============================================================================

/**
 * Compute adaptive Stage 2 pool size based on k and pre-computed score signals.
 * Uses the same isDecisive/isAmbiguous signals as shouldSkipRerank.
 */
function adaptiveStage2Pool(k, analysis, config) {
  const {
    minStage2 = 40,
    maxStage2 = 400,
    oversample1 = 10,
  } = config;

  let base = Math.max(minStage2, k * oversample1);

  if (analysis) {
    if (analysis.isDecisive) {
      base = Math.max(minStage2, Math.floor(base * 0.6));
      return { size: Math.min(base, maxStage2), reason: `shrink_decisive (gap=${analysis.topGap.toFixed(3)})` };
    }
    if (analysis.isAmbiguous) {
      base = Math.min(maxStage2, Math.floor(base * 1.5));
      return { size: base, reason: `widen_ambiguous (spread=${analysis.spread.toFixed(3)})` };
    }
  }

  return { size: Math.min(base, maxStage2), reason: 'default' };
}

/**
 * Compute adaptive Stage 2.5 pool size.
 * Always smaller than Stage 2 pool — float rescoring is more expensive.
 */
function adaptiveStage2_5Pool(k, analysis, config) {
  const {
    minStage2_5 = 20,
    maxStage2_5 = 200,
    oversample2 = 5,
  } = config;

  let base = Math.max(minStage2_5, k * oversample2);

  if (analysis && analysis.isDecisive) {
    base = Math.max(minStage2_5, Math.floor(base * 0.6));
    return { size: Math.min(base, maxStage2_5), reason: `shrink_decisive (gap=${analysis.topGap.toFixed(3)})` };
  }

  return { size: Math.min(base, maxStage2_5), reason: 'default' };
}

// =============================================================================
// 3-Stage Semantic Search
// =============================================================================

/**
 * 3-Stage Semantic Search Pipeline
 *
 * Performance targets (after rescoring fix):
 *   Stage 1 (Binary): ~100us for 1000 candidates
 *   Stage 2 (Int8):   ~200-500us for adaptive candidates (batched normalized dot)
 *   Stage 2.5 (Float): ~500us for adaptive candidates (direct-access store)
 *   Stage 3 (Rerank): ~50-100ms for 20 candidates
 *   Total: <150ms end-to-end
 *
 * Returns: { results: Array, stats: Object } with embedding/rerank stats for CostTracker
 *
 * Uses `this` extensively.
 */
export async function semanticSearch3Stage(query, options = {}) {
  const { k = 10, rerank = true, useLateInteraction = this.useLateInteraction } = options;
  const stats = { stages: {} };
  const adaptiveConfig = BINARY_HNSW_CONFIG.retrieval.adaptive || {};

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
  stats.queryFloat = embedResult.float || null;

  // Stage 1: Binary HNSW search
  // Pass floatQuery for asymmetric distance during graph traversal
  const stage1Start = performance.now();
  const truncatedFloat = truncateForHNSW(embedResult.float);
  const stage1Result = await this.binaryHnswIndex.search(
    embedResult.binary, this.stage1Candidates, { floatQuery: truncatedFloat }
  );
  const stage1Scores = stage1Result.results.map(r => r.score);
  const stage1Analysis = analyzeScoreSpread(stage1Scores);
  stats.stages.binary = {
    latency_us: stage1Result.latency_us,
    candidates: stage1Result.results.length,
    scoreDistribution: stage1Analysis,
  };
  this.log(`Stage 1 (Binary): ${stage1Result.latency_us}us, ${stage1Result.results.length} candidates`);

  if (stage1Result.results.length === 0) {
    stats.rerank = {
      skipped: true,
      reason: 'no_candidates',
      provider: null,
      documents: 0,
      tokens: 0,
    };
    return { results: [], stats };
  }

  // -------------------------------------------------------------------------
  // Stage 2: Int8 Rescore (Phase 1 — batched normalized dot product)
  //
  // Key optimization: use normalizedFloatToInt8 (matches index-time quantizer)
  // and raw dot product scoring. Since both query and document int8 vectors
  // are quantized from L2-normalized floats, dot/(127²) ≈ cosine.
  // No per-candidate norm computation needed.
  // -------------------------------------------------------------------------
  const stage2Start = performance.now();
  const useBatchedDot = BINARY_HNSW_CONFIG.retrieval.useBatchedDot !== false;

  // Phase 3: Adaptive Stage 2 pool size (uses shared score-spread analysis)
  const stage2Pool = adaptiveStage2Pool(k, stage1Analysis, adaptiveConfig);
  const stage2Count = Math.min(stage2Pool.size, stage1Result.results.length);

  // Collect int8 vectors for scoring
  const stage2Candidates = stage1Result.results.slice(0, stage2Count);
  const int8Vectors = [];
  const validIndices = [];
  let missingInt8Count = 0;

  // One stale-bitmap snapshot for the whole pool (getInt8Vector would stat
  // the bitmap file once per candidate). Falls back per-id for injected
  // index doubles without the batch method.
  const poolIds = stage2Candidates.map((c) => c.id);
  const poolInt8 = typeof this.binaryHnswIndex.getInt8VectorsForIds === 'function'
    ? this.binaryHnswIndex.getInt8VectorsForIds(poolIds)
    : poolIds.map((id) => this.binaryHnswIndex.getInt8Vector(id));
  for (let i = 0; i < stage2Candidates.length; i++) {
    const int8Vector = poolInt8[i];
    if (int8Vector) {
      int8Vectors.push(int8Vector);
      validIndices.push(i);
    } else {
      stage2Candidates[i].int8Score = 0.0;
      stage2Candidates[i].missingInt8 = true;
      missingInt8Count++;
    }
  }

  if (useBatchedDot) {
    // Phase 1 NEW PATH: Batched normalized dot product
    // Use same quantizer as index time. No per-candidate norms.
    const queryInt8 = normalizedFloatToInt8(truncatedFloat);
    stats.queryInt8 = queryInt8;
    if (int8Vectors.length > 0) {
      const batchScores = int8BatchDotScores(queryInt8, int8Vectors);
      for (let j = 0; j < validIndices.length; j++) {
        stage2Candidates[validIndices[j]].int8Score = batchScores[j];
      }
    }
  } else {
    // Phase 1 OLD PATH (fallback): Per-candidate int8 cosine similarity
    const queryInt8 = floatToInt8(truncatedFloat);
    stats.queryInt8 = queryInt8;
    for (let j = 0; j < validIndices.length; j++) {
      stage2Candidates[validIndices[j]].int8Score = int8CosineSimilarity(queryInt8, int8Vectors[j]);
    }
  }

  if (missingInt8Count > 0) {
    this.log(`Warning: ${missingInt8Count} candidates missing int8 vectors (given neutral score)`);
  }

  // Sort by int8 score
  let scoredCandidates = [...stage2Candidates];
  scoredCandidates.sort((a, b) => b.int8Score - a.int8Score);

  const int8Scores = scoredCandidates.filter(c => !c.missingInt8).map(c => c.int8Score);
  const int8Analysis = analyzeScoreSpread(int8Scores);
  stats.stages.int8 = {
    latency_us: Math.round((performance.now() - stage2Start) * 1000),
    candidates: scoredCandidates.length,
    missingVectors: missingInt8Count,
    poolSize: stage2Count,
    poolReason: stage2Pool.reason,
    scoringPath: useBatchedDot ? 'batched-dot' : 'per-candidate-cosine',
    scoreDistribution: int8Analysis,
  };
  this.log(`Stage 2 (Int8): ${stats.stages.int8.latency_us}us, ${scoredCandidates.length} rescored (pool: ${stage2Count}, ${stage2Pool.reason}, ${useBatchedDot ? 'batched' : 'legacy'})`);

  // -------------------------------------------------------------------------
  // Stage 2.5: Float Rescore (Phase 2 — fixed dimension, direct-access store)
  //
  // Fixes from the plan:
  // 1. Query and document vectors scored at same intended dimension
  //    (both use truncateForHNSW output, no silent Math.min truncation)
  // 2. Float vectors loaded from direct-access store (not SQLite)
  // 3. SQLite retained as fallback if float store not available
  // -------------------------------------------------------------------------
  const stage2_5Pool = adaptiveStage2_5Pool(k, int8Analysis, adaptiveConfig);
  const stage2_5Count = Math.min(stage2_5Pool.size, scoredCandidates.length);

  if (stage2_5Count > 0 && embedResult.float) {
    const stage2_5Start = performance.now();
    try {
      const pool = scoredCandidates.slice(0, stage2_5Count);
      // Phase 2 fix: query at intended dimension (truncated + normalized)
      const queryFloat = truncatedFloat;
      const poolIds = pool.map(c => c.id);

      let floatVectors = null;
      let floatSource = 'none';
      let missingFloatCount = 0;

      // Prefer direct-access float store (Phase 2)
      if (this.floatVectorStore && this.floatVectorStore.loaded) {
        const result = this.floatVectorStore.batchScore(queryFloat, poolIds);
        if (result.scores.size > 0) {
          for (const c of pool) {
            const score = result.scores.get(c.id);
            if (score !== undefined) {
              c.floatScore = score;
            } else {
              c.floatScore = c.int8Score; // fallback
            }
          }
          // result.missing is the authoritative count (IDs not in store)
          missingFloatCount = result.missing;
          floatSource = 'float-store';
        }
      }

      // Fallback: SQLite _loadFloatVectors (if float store unavailable)
      if (floatSource === 'none' && this._loadFloatVectors) {
        floatVectors = await this._loadFloatVectors(poolIds);
        if (floatVectors && floatVectors.size > 0) {
          for (const c of pool) {
            let fv = floatVectors.get(c.id);
            if (fv) {
              // codebase.db stores full-dim (e.g. 768d) embeddings, but the
              // query, HNSW, and direct-access float store all operate at
              // hnswDimension (e.g. 512d). When the direct-access float store is
              // absent — e.g. an index bootstrapped purely via incremental
              // reconcile, which does not build it — this SQLite fallback hands
              // back full-dim rows. Truncate to the query dimension (the same
              // matryoshka prefix the rest of the pipeline uses) so the score is
              // comparable. A vector SHORTER than the query dim is genuinely
              // misaligned and unrecoverable — keep failing loud so it gets
              // fixed at index time.
              if (fv.length > queryFloat.length) {
                fv = truncateForHNSW(fv, queryFloat.length);
              } else if (fv.length < queryFloat.length) {
                throw new Error(
                  `Stage 2.5 dimension mismatch: query=${queryFloat.length}, doc=${fv.length} (id=${c.id}). ` +
                  'Stored vector is shorter than the query dimension — re-index to align.'
                );
              }
              let dot = 0;
              for (let i = 0; i < queryFloat.length; i++) dot += queryFloat[i] * fv[i];
              c.floatScore = dot;
            } else {
              c.floatScore = c.int8Score; // fallback
              missingFloatCount++;
            }
          }
          floatSource = 'sqlite-fallback';
        }
      }

      if (floatSource !== 'none') {
        pool.sort((a, b) => b.floatScore - a.floatScore);
        scoredCandidates = pool;
      }

      const floatScores = pool.filter(c => c.floatScore !== undefined).map(c => c.floatScore);
      stats.stages.floatRescore = {
        latency_us: Math.round((performance.now() - stage2_5Start) * 1000),
        candidates: pool.length,
        poolSize: stage2_5Count,
        poolReason: stage2_5Pool.reason,
        source: floatSource,
        missingVectors: missingFloatCount,
        scoreDistribution: analyzeScoreSpread(floatScores),
      };
      this.log(`Stage 2.5 (Float): ${stats.stages.floatRescore.latency_us}us, ${pool.length} rescored (${floatSource}, pool: ${stage2_5Count})`);
    } catch (err) {
      // Dimension mismatches are correctness bugs — propagate, don't swallow.
      if (err.message.includes('dimension mismatch')) throw err;
      this.log(`Stage 2.5 skipped: ${err.message}`);
    }
  }

  // CASCADE MODE: Return broad candidate set, let postprocess handle scoring.
  if (options.format !== 'agent' && !options.ablations?.has?.('no-full-vector-stage-rescore')) {
    const fullVectorStage = applyFullVectorStageRescore(
      scoredCandidates,
      embedResult.float,
      this.codebaseRepo
    );
    scoredCandidates = fullVectorStage.candidates;
    if (fullVectorStage.stats) stats.stages.fullVector = fullVectorStage.stats;
  }

  // CASCADE MODE: Return broad candidate set, let postprocess handle scoring.
  if (this.cascadeEnabled) {
    return cascadeDefer(scoredCandidates, stats, 'semantic-3stage', options.cascadeK);
  }

  // =========================================================================
  // FLAG OFF: Existing Stage 3 rerank path, completely unchanged.
  // =========================================================================

  // EARLY EXIT: Use score spread analysis to skip reranking
  const topCandidatesWithInt8 = scoredCandidates
    .slice(0, Math.min(10, scoredCandidates.length))
    .filter(c => !c.missingInt8);
  const topInt8Scores = topCandidatesWithInt8.map(c => c.floatScore ?? c.int8Score);
  const skipAnalysis = this.shouldSkipRerank(topInt8Scores, { highConfidence: 0.90 });

  if (skipAnalysis.skip) {
    this.log(`Early exit: ${skipAnalysis.reason} (scores: ${topInt8Scores.slice(0, 3).map(s => s.toFixed(3)).join(', ')})`);

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

    return { results, stats };
  }

  // Late interaction moved to post-expansion pipeline (Phase 6).
  // See search-postprocess.js — runs after graph expansion so expanded
  // candidates also benefit from MaxSim scoring.

  // Stage 3: Rerank (if enabled AND a reranker is actually available)
  let results = scoredCandidates;
  if (rerank && scoredCandidates.length > k && this.reranker.isAnyAvailable?.()) {
    try {
      const stage3Start = performance.now();
      const topCandidates = scoredCandidates.slice(0, this.stage3Candidates);

      // Load full document content for reranking
      const documents = await this.loadDocumentContent(topCandidates);

      const rerankResult = await this.reranker.rerank(query, documents, k);
      results = rerankResult.results.map((r, i) => ({
        ...topCandidates[r.originalIndex],
        rerankScore: r.localRerankerScore || r.jinaScore || r.voyageScore || r.flashRankScore,
        originalScore: topCandidates[r.originalIndex].int8Score,
        binaryScore: topCandidates[r.originalIndex].score,
        lateInteractionScore: topCandidates[r.originalIndex].lateInteractionScore,
        preLateInteractionScore: topCandidates[r.originalIndex].preLateInteractionScore,
        newRank: i + 1,
      }));

      stats.stages.rerank = {
        latency_ms: rerankResult.latency_ms,
        model: rerankResult.model,
        candidates: topCandidates.length,
      };

      stats.rerank = {
        skipped: false,
        provider: rerankResult.model || 'direct-cross-encoder',
        documents: topCandidates.length,
        tokens: Math.ceil(query.length / 4) + (topCandidates.length * 150),
        latency_ms: rerankResult.latency_ms,
      };

      this.log(`Stage 3 (Rerank): ${rerankResult.latency_ms}ms (${rerankResult.model})`);
    } catch (err) {
      this.log(`Rerank failed: ${err.message}`);
      results = scoredCandidates.slice(0, k);

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
  stats.queryFloat = fullEmbedding || null;

  // Truncate to HNSW dimension (1024d -> 512d Matryoshka)
  const queryEmbedding = truncateForHNSW(fullEmbedding);
  stats.queryInt8 = normalizedFloatToInt8(queryEmbedding);

  let candidates;

  // Non-3-stage ("Standard") path: the binary 3-stage cascade is the default
  // (see semanticSearch dispatcher). This path is reached only when 3-stage is
  // disabled or no binary index exists, and scans float vectors directly from
  // SQLite. (The legacy usearch float-HNSW shortcut was removed.)
  if (this.hasCodebaseIndex) {
    // O(N) scan from SQLite
    candidates = await this.vectorScan(queryEmbedding, rerank ? 100 : k);
    this.log(`Vector scan: ${candidates.length} candidates`);
  } else {
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
    stats.rerank = {
      skipped: true,
      reason: 'no_candidates',
      provider: null,
      documents: 0,
      tokens: 0,
    };
    return { results: [], stats };
  }

  // CASCADE MODE: Return broad candidate set, let postprocess handle scoring.
  if (this.cascadeEnabled) {
    return cascadeDefer(candidates, stats, 'semantic');
  }

  // =========================================================================
  // FLAG OFF: Existing rerank path, completely unchanged.
  // =========================================================================

  // EARLY EXIT: Use score spread analysis to skip reranking
  const topScores = candidates.slice(0, Math.min(10, candidates.length)).map(c => c.score);
  const skipAnalysis = this.shouldSkipRerank(topScores, { highConfidence: 0.92 });

  if (skipAnalysis.skip) {
    this.log(`Early exit: ${skipAnalysis.reason} (scores: ${topScores.slice(0, 3).map(s => s.toFixed(3)).join(', ')})`);

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
  if (rerank && candidates.length > k && this.reranker.isAnyAvailable?.()) {
    try {
      const rerankStart = Date.now();

      // Prepare documents for reranking
      const documents = await this.loadDocumentContent(candidates);

      const rerankResult = await this.reranker.rerank(query, documents, k);
      results = rerankResult.results.map((r, i) => ({
        ...candidates[r.originalIndex],
        rerankScore: r.localRerankerScore || r.jinaScore || r.voyageScore || r.flashRankScore,
        originalScore: candidates[r.originalIndex].score,
        newRank: i + 1,
      }));

      stats.rerank = {
        skipped: false,
        provider: rerankResult.model || 'direct-cross-encoder',
        documents: candidates.length,
        tokens: Math.ceil(query.length / 4) + (candidates.length * 150),
        latency_ms: rerankResult.latency_ms,
      };

      this.log(`Rerank: ${rerankResult.latency_ms}ms (${rerankResult.model})`);
    } catch (err) {
      this.log(`Rerank failed: ${err.message}`);
      results = candidates.slice(0, k);

      stats.rerank = {
        skipped: true,
        reason: `error: ${err.message}`,
        provider: null,
        documents: 0,
        tokens: 0,
      };
    }
  } else {
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
    topGapThreshold = SCORE_SPREAD.topGapThreshold,
    spreadThreshold = SCORE_SPREAD.spreadThreshold,
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

