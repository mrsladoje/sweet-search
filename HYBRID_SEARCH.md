# Hybrid Search Architecture

This document describes the hybrid search fusion implementation in Search 100x, including the Jan 2026 improvements for robust score fusion and fair boost application.

## Overview

Hybrid search combines lexical (BM25/FTS5) and semantic (HNSW embeddings) search paths to achieve both precision (exact term matching) and recall (conceptual similarity). The Hybrid Fusion v2 implementation addresses architectural issues in the original fusion approach.

## Pipeline Summary

```
Step 1: Parallel lexical + semantic search (skipBoosts=true)
Step 2: CC Fusion (quantile normalization + RRF fallback)
Step 3: Post-fusion boosts (definition, syntax, kind, position)
Step 4: MMR Diversification (λ=0.9 relevance/diversity trade-off)
Step 5: Top-K selection
```

## Architecture

```
Query
  │
  ├──► Query Router ──► Route Type (lexical/semantic/hybrid/structural)
  │
  ├──► Lexical Path (skipBoosts=true)
  │     ├── FTS5/BM25 search
  │     ├── Trigram fuzzy fallback
  │     └── LIKE fallback
  │
  └──► Semantic Path
        ├── Binary HNSW (Stage 1)
        ├── Int8 rescore (Stage 2)
        └── Optional rerank (Stage 3)
                │
                ▼
        Step 2: robustCCFusion()
        (Quantile normalization + RRF fallback)
                │
                ▼
        Step 3: applyPostFusionBoosts()
        (Definition, syntax, kind, position boosts)
                │
                ▼
        Step 4: MMR Diversification
        (λ=0.9 relevance/diversity trade-off)
                │
                ▼
        Step 5: Top-K Selection
                │
                ▼
        Final Results
```

## Key Components

### 1. Fair Fusion Approach (Change 1)

**Problem:** The original implementation applied ranking boosts during lexical retrieval, which gave lexical results an unfair advantage before fusion with semantic results.

**Solution:** The `skipBoosts` parameter retrieves raw scores from both paths before fusion:

```javascript
// hybridSearchV2 calls lexical search with skipBoosts=true
const [lexicalSearchResult, semanticSearchResult] = await Promise.all([
  this.graphSearch.graphExpandedSearch(query, { k: 50, expand: true, skipBoosts: true }),
  this.semanticSearch(query, { k: 50, rerank: false }),
]);
```

**How it works:**
- `bm25Search(query, { skipBoosts: true })` returns raw FTS5 scores
- `graphExpandedSearch(query, { skipBoosts: true })` propagates to underlying BM25 search
- Post-fusion boosts are applied uniformly to ALL results (lexical AND semantic)

### 2. Robust CC Fusion with RRF Fallback (Change 2)

The `robustCCFusion()` function replaces naive min-max normalization with quantile-based normalization and includes automatic fallback to RRF for edge cases.

#### Quantile Normalization

Standard min-max normalization is vulnerable to outliers:

```
min-max: normalized = (score - min) / (max - min)
         Problem: Single outlier dominates entire scale
```

Quantile normalization (p05-p95) is robust to outliers:

```javascript
/**
 * Quantile-based normalization
 * @param {number[]} scores - Raw scores to normalize
 * @param {number} lowQuantile - Lower percentile cutoff (default 0.05)
 * @param {number} highQuantile - Upper percentile cutoff (default 0.95)
 * @returns {number[]} Normalized scores in [0, 1]
 */
quantileNormalize(scores, lowQuantile = 0.05, highQuantile = 0.95) {
  const sorted = [...scores].sort((a, b) => a - b);
  const lowIdx = Math.floor(sorted.length * lowQuantile);
  const highIdx = Math.ceil(sorted.length * highQuantile) - 1;

  const pLow = sorted[Math.max(0, lowIdx)];          // p05
  const pHigh = sorted[Math.min(sorted.length - 1, highIdx)];  // p95
  const range = pHigh - pLow;

  // normalized = (score - p05) / (p95 - p05)
  return scores.map(s => {
    const normalized = (s - pLow) / range;
    return Math.max(0, Math.min(1, normalized));  // Clamp to [0, 1]
  });
}
```

**Why quantile normalization:**
- Outliers (scores outside p05-p95) don't compress the rest of the distribution
- More stable fusion weights when score distributions are skewed
- Scores beyond the quantile range are clamped to 0 or 1

#### RRF Fallback Detection

The `shouldFallbackToRRF()` function detects edge cases where CC fusion would be unreliable:

```javascript
shouldFallbackToRRF(lexicalResults, semanticResults) {
  // Case 1: Too few results on one side
  if (lexicalResults.length < 3 || semanticResults.length < 3) {
    return { fallback: true, reason: 'insufficient_results' };
  }

  // Case 2: Near-zero variance (degenerate range)
  const lexVariance = this.variance(lexScores);
  const semVariance = this.variance(semScores);
  if (lexVariance < 1e-6 || semVariance < 1e-6) {
    return { fallback: true, reason: 'zero_variance' };
  }

  // Case 3: Semantic scores form tight cluster (spread < 0.01)
  // When all semantic scores are nearly identical, normalization
  // would produce unstable results
  // This is detected via outlier_compression heuristic

  return { fallback: false, reason: null };
}
```

**Fallback triggers:**
| Condition | Reason | Why Fallback |
|-----------|--------|--------------|
| < 3 results on either side | `insufficient_results` | Not enough data for reliable normalization |
| Variance < 1e-6 | `zero_variance` | All scores identical, division by zero |
| Top 5% clustered but median far | `outlier_compression` | Skewed distribution breaks normalization |
| No valid scores | `no_valid_scores` | NaN/undefined scores present |

#### RRF Fusion (Rank-Based)

When CC fusion would be unreliable, the system falls back to Reciprocal Rank Fusion:

```javascript
rrfFusion(lexicalResults, semanticResults, k = 60) {
  // RRF formula: score = sum(1 / (k + rank))
  // Rank-based, ignores raw scores entirely
  lexicalResults.forEach((result, rank) => {
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
  });
  semanticResults.forEach((result, rank) => {
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
  });
}
```

### 3. Route-Specific Alpha Values (Change 3)

The convex combination formula uses route-specific alpha values calibrated for code search:

```
CC Formula: score = alpha * lexical_norm + (1 - alpha) * semantic_norm
```

| Route Type | Alpha | Rationale |
|------------|-------|-----------|
| `semantic` / `conceptual` | 0.25 | Heavy semantic weight for "how does X work" queries |
| `structural` | 0.50 | Balanced (graph expansion handles most work) |
| `hybrid` / `mixed` | 0.55 | Slightly favor lexical for balanced queries |
| `lexical` / `identifier` | 0.80 | Heavy lexical weight for exact names, APIs |

```javascript
const ROUTE_ALPHAS = {
  'identifier': 0.85,
  'lexical': 0.85,      // Alias
  'conceptual': 0.25,
  'semantic': 0.25,     // Alias
  'structural': 0.90,
  'mixed': 0.55,
  'hybrid': 0.55,       // Alias
};
```

### 4. Post-Fusion Boosts (Change 4)

Boosts are applied AFTER fusion so both lexical and semantic paths benefit equally.

```javascript
applyPostFusionBoosts(fusedResults, query, routerMode, routerConfidence) {
  const boostIntent = this.getBoostIntent(routerMode, routerConfidence);
  const policy = BOOST_POLICY[boostIntent];

  return fusedResults.map(result => {
    let totalBoost = 1.0;

    // 1. Definition Boost (filename/name match)
    if (policy.definitionBoost > 1.0) { ... }

    // 2. Syntax Boost (definition patterns in signature)
    if (policy.syntaxBoost > 1.0) { ... }

    // 3. Symbol Kind Hierarchy (class > function > variable)
    if (policy.kindHierarchy) { ... }

    // 4. Position Boost (early in file = likely definition)
    if (policy.positionBoost) { ... }

    return { ...result, score: result.score * cappedBoost };
  });
}
```

#### Boost Intent Mapping

The router mode and confidence determine boost intensity:

| Router Mode | Confidence | Boost Intent |
|-------------|------------|--------------|
| `lexical` | >= 0.8 | `definition_strong` |
| `lexical` | < 0.8 | `definition_mild` |
| `hybrid` | any | `general` |
| `semantic` | any | `none` |
| `structural` | any | `structural` |

#### Boost Policy

```javascript
static BOOST_POLICY = {
  definition_strong: {
    definitionBoost: 2.0,
    syntaxBoost: 1.8,
    kindHierarchy: true,
    positionBoost: true,
  },
  definition_mild: {
    definitionBoost: 1.5,
    syntaxBoost: 1.3,
    kindHierarchy: true,
    positionBoost: true,
  },
  general: {
    definitionBoost: 1.2,
    syntaxBoost: 1.0,
    kindHierarchy: true,
    positionBoost: false,
  },
  none: {
    definitionBoost: 1.0,
    syntaxBoost: 1.0,
    kindHierarchy: true,  // Mild type priors kept
    positionBoost: false,
  },
  structural: {
    definitionBoost: 1.0,
    syntaxBoost: 1.0,
    kindHierarchy: false,
    positionBoost: false,
  },
};
```

### 5. MMR Diversification (Step 4)

**Purpose:** Maximal Marginal Relevance (MMR) prevents result redundancy by balancing relevance against diversity.

The MMR algorithm iteratively selects results that are both relevant to the query AND diverse from already-selected results:

```javascript
/**
 * MMR formula: score = λ * relevance(d) - (1-λ) * max_similarity(d, selected)
 *
 * @param {Array} results - Post-boost results to diversify
 * @param {number} lambda - Trade-off parameter (0.9 = 90% relevance, 10% diversity)
 * @param {number} k - Number of results to return
 * @returns {Array} Diversified top-K results
 */
mmrDiversify(results, lambda = 0.9, k = 10) {
  const selected = [];
  const remaining = [...results];

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;
      const maxSimilarity = selected.length === 0
        ? 0
        : Math.max(...selected.map(s => this.similarity(remaining[i], s)));

      const mmrScore = lambda * relevance - (1 - lambda) * maxSimilarity;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}
```

#### Lambda Parameter

| Lambda | Behavior | Use Case |
|--------|----------|----------|
| 1.0 | Pure relevance (no diversity) | When exact matches matter most |
| 0.9 | Slight diversity (default) | Code search with related definitions |
| 0.7 | Moderate diversity | Exploratory queries |
| 0.5 | Balanced | Topic exploration |

The default λ=0.9 prioritizes relevance while preventing near-duplicate results (e.g., multiple methods from the same file with identical signatures).

#### Similarity Computation

Similarity between results considers:
- **File path:** Same file = high similarity (0.8 base)
- **Symbol kind:** Same type (class/function/variable) adds similarity
- **Content overlap:** Jaccard similarity of token sets

```javascript
similarity(a, b) {
  let sim = 0;

  // Same file penalty
  if (a.file === b.file) sim += 0.8;

  // Same kind penalty
  if (a.kind === b.kind) sim += 0.1;

  // Content overlap (Jaccard)
  const tokensA = new Set(a.content?.split(/\W+/) || []);
  const tokensB = new Set(b.content?.split(/\W+/) || []);
  const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  sim += 0.1 * (intersection / union);

  return Math.min(1, sim);
}
```

#### Why MMR Instead of Flood Control

The previous flood control approach used hard caps (perFileCap, perTypeCap) which caused issues:
- Too aggressive: Reduced 53 results to 6 in test cases
- Binary decisions: No nuance between "slightly similar" and "very similar"
- Position-blind: Didn't consider result quality, only counts

MMR advantages:
- **Soft trade-off:** High-quality duplicates can still appear if relevance is strong enough
- **Gradual diversity:** Each selection considers the entire selected set
- **Tunable:** Lambda parameter allows easy adjustment without code changes

## Usage

### Default (Hybrid Search V2)

```javascript
const smartSearch = new SmartSearch();
const { results, stats } = await smartSearch.search('AuthService', {
  k: 10,
  mode: 'auto',  // Routes to hybrid for mixed queries
});

// stats.fusion = 'cc_robust' or 'rrf'
// stats.fusionFallback = null or 'insufficient_results' / 'zero_variance' / etc.
```

### Force Specific Fusion

```javascript
// Force hybrid mode
const result = await smartSearch.search(query, {
  mode: 'hybrid',
  fusion: 'cc',  // 'cc' (Convex Combination) or 'rrf' (Reciprocal Rank)
});
```

## Performance

| Component | Latency | Notes |
|-----------|---------|-------|
| Query routing | ~50us | Regex-based classification |
| Lexical (FTS5) | ~6-10ms | With trigram fallback |
| Semantic (3-stage) | ~275ms | Dominated by Voyage API (~250ms) |
| Quantile normalization | ~0.1ms | O(n log n) sort |
| CC fusion | ~0.5ms | Map operations |
| Post-fusion boosts | ~0.2ms | Per-result computation |
| MMR diversification | ~0.3ms | O(k*n) iterations |

## Migration from Legacy hybridSearch

The original `hybridSearch()` method is deprecated. Key differences:

| Aspect | Legacy hybridSearch | hybridSearchV2 |
|--------|---------------------|----------------|
| Lexical boosts | During retrieval | After fusion |
| Normalization | Min-max | Quantile (p05-p95) |
| Edge case handling | None | RRF fallback |
| Diversification | Flood control (hard caps) | MMR (λ=0.9) |
| Route alphas | Fixed 0.55 | Route-specific |

## Debugging

### Check Fusion Method

```javascript
const { results, stats } = await search.search(query);
console.log(stats.fusion);         // 'cc_robust' or 'rrf'
console.log(stats.fusionFallback); // null or reason string
```

### Inspect Per-Result Boosts

```javascript
results.forEach(r => {
  console.log(r.name, {
    finalScore: r.score,
    originalScore: r._originalScore,
    boostFactor: r._boostFactor,
    boostDetails: r._boostDetails,  // e.g., ['def:1.50', 'syntax:1.30']
  });
});
```

### Verify Raw Scores (skipBoosts)

```javascript
// Get raw lexical scores without boosts
const { results } = await graphSearch.bm25Search(query, { skipBoosts: true });

// Or use bm25SearchRaw for cleaner API
const { results } = await graphSearch.bm25SearchRaw(query, 50);
```

## References

- **Convex Combination vs RRF:** CC outperforms RRF by +7-18% MRR on hybrid search (ACM TOIS 2023)
- **Quantile normalization:** Standard practice in ML for handling outliers without clipping
- **RRF constant k=60:** Original Cormack et al. recommendation for stable rank fusion
