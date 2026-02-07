# Hybrid Search Architecture

Documentation of the hybrid search fusion logic in Smart Search v2.3.

## Current Performance

| Metric | Value |
|--------|-------|
| Success@10 | **90.5%** |
| MRR@10 | **0.912** |

Achieved through: Robust CC Fusion (Convex Combination with RRF fallback) + Post-Fusion Boosts + MMR Diversification.

## Source Files

- **Primary**: `.claude/helpers/search-100x/smart-search-v21.js`
  - `grep -n "async hybridSearch" smart-search-v21.js` → main hybrid function
  - `grep -n "convexCombination" smart-search-v21.js` → CC fusion
- **MMR**: `.claude/helpers/search-100x/mmr.js`
  - `grep -n "applyMMR" mmr.js` → diversity-aware reranking
- **Config**: `.claude/helpers/search-100x/config.js`
  - `grep -n "ROUTING_CONFIG" config.js` → routing patterns

## Overview

Hybrid search combines lexical (BM25/FTS5) and semantic (HNSW ANN) results using a multi-stage pipeline:

1. **Parallel Search**: Run lexical and semantic paths concurrently
2. **Robust CC Fusion**: Combine results using Convex Combination with quantile normalization (RRF fallback for edge cases)
3. **Post-Fusion Boosts**: Apply scoring boosts based on result characteristics
4. **MMR Diversification**: Intelligent diversity-aware reranking (replaces flood control)

## Fusion Methods

### 1. Robust CC Fusion - Current Default

**Source**: `hybridSearchV2()` method calling `robustCCFusion()` (`grep -n "robustCCFusion" smart-search-v21.js`)

**Strategy**: Convex Combination (CC) with quantile normalization as the primary fusion method, with RRF fallback for edge cases (sparse results, extreme score ranges).

**CC Formula**:
```
CC_score(d) = alpha * lexical_quantile_norm + (1 - alpha) * semantic_quantile_norm
```

Where:
- `lexical_quantile_norm` = quantile-normalized BM25 score (5th-95th percentile clipping)
- `semantic_quantile_norm` = quantile-normalized HNSW cosine similarity (5th-95th percentile clipping)
- `alpha` = route-specific weight

**Adaptive Alpha**: The fusion uses route-specific alpha values to weight lexical vs semantic contributions:

| Route Type | Alpha | Behavior |
|------------|-------|----------|
| `lexical` / `identifier` | 0.85 | Heavy lexical (identifier queries) |
| `structural` | 0.90 | Very heavy lexical (relationship queries) |
| `semantic` / `conceptual` | 0.25 | Heavy semantic (conceptual queries) |
| `hybrid` / `mixed` | 0.55 | Balanced (mixed queries) |

**Quantile Normalization**: Scores from both paths are aligned using quantile normalization (5th-95th percentile clipping) before fusion. This is robust to outliers compared to min-max normalization.

**RRF Fallback**: When CC would produce unreliable results (e.g., sparse results, extreme score variance), the system automatically falls back to Reciprocal Rank Fusion (RRF):
```
RRF_score(d) = SUM(1 / (k + rank_i(d)))
```
Where `k=60` (standard RRF parameter).

### 2. Legacy Convex Combination (CC) - Deprecated

**Source**: `hybridSearch()` method (`grep -n "async hybridSearch" smart-search-v21.js`) - marked `@deprecated`

The old `hybridSearch()` method used naive min-max normalization and applied boosts during lexical retrieval (unfair to semantic path). It has been superseded by `hybridSearchV2()` with `robustCCFusion()`.

**Note**: CC can outperform RRF by +7-18% MRR on some benchmarks (ACM TOIS 2023). The current robust CC implementation with quantile normalization achieves better results than both naive CC and pure RRF on the Sloth codebase.

## Execution Flow

**Source**: `hybridSearchV2()` method (`grep -n "hybridSearchV2" smart-search-v21.js`)

```javascript
async hybridSearchV2(query, options = {}) {
  const { k = 10, useColBERT = this.useColBERT, routing: passedRouting } = options;

  // 1. Determine route type for adaptive alpha
  const routing = passedRouting || routeQuery(query);
  const routeType = routing.mode === 'hybrid' ? 'mixed' : routing.mode;

  // 2. Run both paths in parallel (50 candidates each for full recall)
  // Uses graphExpandedSearch with skipBoosts=true (no pre-fusion boosts)
  const [lexicalResults, semanticResults] = await Promise.all([
    this.graphSearch.graphExpandedSearch(query, { k: 50, expand: true, skipBoosts: true }),
    this.semanticSearch(query, { k: 50, rerank: false, useColBERT }),
  ]);

  // 3. Apply Robust CC Fusion (with RRF fallback for edge cases)
  const { results: fused, method, fallbackReason } = this.robustCCFusion(
    lexicalResults,
    semanticResults,
    routeType
  );

  // 4. Apply post-fusion boosts uniformly (both paths benefit equally)
  const boosted = this.applyPostFusionBoosts(fused, query, routing.mode, routing.confidence);

  // 5. Apply MMR diversification (replaces flood control)
  const lambda = getLambdaForIntent(routing.mode, routing.confidence);
  const { results: diversified, stats: mmrStats } = applyMMR(boosted, {
    k: Math.min(k * 2, boosted.length),
    lambda,
  });

  return {
    results: diversified.slice(0, k),
    fusionStats: { method, fallbackReason, mmrStats },
  };
}
```

## Quantile Normalization

**Source**: `quantileNormalize()` method (`grep -n "quantileNormalize" smart-search-v21.js`)

Scores are normalized using quantile clipping (5th-95th percentile) before CC fusion. This is more robust to outliers than min-max normalization:
```javascript
quantileNormalize(scores, lowerQ = 0.05, upperQ = 0.95) {
  const sorted = [...scores].sort((a, b) => a - b);
  const lowerIdx = Math.floor(sorted.length * lowerQ);
  const upperIdx = Math.ceil(sorted.length * upperQ) - 1;
  const min = sorted[lowerIdx];
  const max = sorted[upperIdx];
  const range = max - min || 1;
  return scores.map(s => Math.max(0, Math.min(1, (s - min) / range)));
}
```

## Result Merging

**Source**: `robustCCFusion()` method (`grep -n "robustCCFusion" smart-search-v21.js`)

Results are merged by unique key (`getResultKey()` method):
1. Build score maps for each path
2. Apply quantile normalization independently (5th-95th percentile clipping)
3. Compute CC score for each unique result: `alpha * lexNorm + (1-alpha) * semNorm`
4. Sort by descending CC score

**Result structure** includes:
- `ccScore` - fusion score (or `rrfScore` if fallback used)
- `lexScore` / `semScore` - quantile-normalized scores
- `alpha` - weight used
- `sources` - array of contributing paths (`['lexical']`, `['semantic']`, or both)
- `fusionMethod` - either `'cc_robust'` or `'rrf'` (if fallback triggered)

## Performance Numbers

### Current Benchmark Results

| Metric | Value |
|--------|-------|
| **Success@10** | **90.5%** |
| **MRR@10** | **0.912** |

### Latency Breakdown

| Component | Latency | Notes |
|-----------|---------|-------|
| Lexical path | <10ms target, ~6-10ms typical | FTS5 trigram search |
| Semantic path (cached) | <10ms | HNSW ANN with cache hit |
| Semantic path (uncached) | ~275ms | Includes Voyage API embedding (~250ms) |
| Robust CC fusion | ~0.5ms | Pure computation, no I/O |
| MMR diversification | ~1ms | O(k * n) similarity computations |

**Note**: All latency values depend on index size and hardware. Semantic path latency is dominated by embedding API calls when cache misses occur.

## Configuration

**Source**: `grep -n "ROUTING_CONFIG" config.js`

```javascript
export const ROUTING_CONFIG = {
  lexicalPatterns: [...],    // Regex patterns favoring lexical
  semanticPatterns: [...],   // Regex patterns favoring semantic
  defaultMode: 'hybrid',     // Fallback when no strong signal
};
```

## CLI Options

**Source**: `grep -n "yargs" smart-search-v21.js` (CLI parsing)

```bash
# Default: Robust CC fusion + Post-fusion boosts + MMR diversification
.claude/helpers/search-100x/ss "query"

# Force specific mode (bypasses hybrid fusion)
.claude/helpers/search-100x/ss "query" --mode lexical
.claude/helpers/search-100x/ss "query" --mode semantic

# Adjust result count (default: 10)
.claude/helpers/search-100x/ss "query" --top 20

# Token-efficient exploration mode
.claude/helpers/search-100x/ss "query" --summary
```

## Reranking

Hybrid search results can optionally be reranked using the cascaded reranking system.

**Note**: By default, hybrid search does NOT apply reranking (the robust CC fusion + post-fusion boosts + MMR already provides quality ordering). Reranking is primarily used in the semantic path.

For reranking details, see [RERANKING.md](./RERANKING.md).

## MMR Diversification

**Source**: `.claude/helpers/search-100x/mmr.js`

MMR (Maximal Marginal Relevance) replaces the previous flood control mechanism with intelligent diversity-aware reranking. Instead of hard caps on results per file/type, MMR balances relevance and diversity through a principled algorithm.

### Formula

```
MMR_Score = lambda * Relevance - (1 - lambda) * max(Similarity to already selected)
```

Where:
- **lambda** controls the relevance vs diversity tradeoff
- Higher lambda (0.8-0.95) prioritizes relevance (good for code search)
- Lower lambda (0.5-0.7) increases diversity (good for exploration)

### Lambda Values by Query Type

| Route Type | Lambda | Rationale |
|------------|--------|-----------|
| `lexical` (high confidence) | 0.95 | Identifier search: strongly prioritize relevance |
| `lexical` (low confidence) | 0.90 | Still relevance-heavy |
| `semantic` | 0.85 | Conceptual search: mild diversity |
| `hybrid` | 0.90 | Mixed queries: relevance-focused |
| `structural` | 0.90 | Relationship queries: very relevance-focused |

### Similarity Calculation

MMR computes similarity between results using multiple features:

| Feature | Weight | Description |
|---------|--------|-------------|
| File | 0.4 | Same file = 1.0, same directory = 0.5 |
| Type | 0.2 | Same entity type = 1.0, related types = 0.5 |
| Package | 0.2 | Same package = 1.0, shared prefix = proportional |
| Semantic | 0.2 | Cosine similarity of embeddings (if available) |

### When MMR is Applied

MMR is applied automatically when:
1. More than 10 results exist (otherwise not enough to diversify)
2. High concentration detected (>40% of top 20 from same file, or >50% from same non-definition type)

### Advantages over Flood Control

| Aspect | Old Flood Control | New MMR |
|--------|-------------------|---------|
| Mechanism | Hard caps (max N per file) | Soft penalty on similarity |
| Flexibility | Binary (blocked or allowed) | Gradual relevance reduction |
| Relevance preservation | May block highly relevant results | Always considers relevance |
| Configuration | Multiple thresholds to tune | Single lambda parameter |
| Adaptability | Static rules | Dynamic based on result set |

### Configuration

```javascript
// Default MMR configuration (from mmr.js)
export const MMR_CONFIG = {
  lambda: 0.9,           // Default for code search (relevance-heavy)
  weights: {
    file: 0.4,           // Same file similarity weight
    type: 0.2,           // Same entity type weight
    package: 0.2,        // Same package weight
    semantic: 0.2,       // Embedding similarity weight
  },
  minRelevance: 0.01,    // Minimum score to include
  maxCandidates: 100,    // Max candidates to consider
};
```

### Reference

- [Qdrant MMR Blog](https://qdrant.tech/blog/mmr-diversity-aware-reranking/) - Theory and implementation details

## Related Documentation

- [SEMANTIC_SEARCH.md](./SEMANTIC_SEARCH.md) - Semantic search pipeline
- [RERANKING.md](./RERANKING.md) - Cascaded reranking system
- [Query Router](./QUERY_ROUTER.md) - Query classification
