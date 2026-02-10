# Reranking System

Documentation for the cascaded reranking system in Smart Search v2.3.

## Source Files

- **Primary**: `.claude/helpers/search-100x/flashrank.js`
- **Config**: `.claude/helpers/search-100x/config.js` (lines 669-712)
- **Integration**: `core/sweet-search.js`

## Overview

Reranking is the **final stage** of semantic search that refines candidate ordering using cross-encoder models. Our system uses a **cascaded two-stage approach** that balances quality with cost/latency.

**Why Reranking?**
- HNSW retrieval uses bi-encoder embeddings (fast but approximate)
- Cross-encoders jointly encode query+document (slower but more accurate)
- Reranking top candidates with cross-encoders improves precision significantly

### Pre-Reranking Pipeline

The pipeline varies by search path:

**Lexical/Graph Path (in `graph-search.js`):**
1. **BM25 FTS5 Search**: Initial candidates from full-text search
2. **Ranking Boosts (Strategies #1, #4, #5, #19, #20)**: Definition boost, intent-based boost, symbol kind weight
3. **Flood Control (Strategy #21)**: Per-file/type caps, implementation clustering
4. Results returned directly (no cross-encoder reranking)

**Semantic Path (in `sweet-search.js`):**
1. **HNSW Retrieval**: Binary HNSW → Int8 rescore → candidates
2. **Cross-Encoder Reranking**: FlashRank → optional Voyage/Jina (cascaded)
3. **No flood control applied** (reranking handles score-based filtering)

**Hybrid Path (`hybridSearchV2()`):**
1. **Fair Lexical Retrieval**: `graphExpandedSearch(skipBoosts=true)` for raw BM25 scores
2. **Semantic Retrieval**: Binary HNSW → Int8 rescore (no cross-encoder yet)
3. **Robust CC Fusion**: `robustCCFusion()` with quantile normalization + RRF fallback
4. **Post-Fusion Boosts**: `applyPostFusionBoosts()` applies definition/syntax/kind/position boosts uniformly
5. Results returned (reranking optional via semantic path)

**Structural Path (in `graph-search.js`):**
1. **Graph Traversal**: Direct relationship queries (callers, callees, implementations)
2. **No ranking boosts or flood control applied** (relationship-based, not scored)

### Fair Fusion Approach

**Source**: `sweet-search.js`, `hybridSearchV2()` method (lines 1451-1513)

The hybrid search pipeline uses a **fair fusion** approach to ensure both lexical and semantic paths are treated equally:

#### Step 1: Raw Score Retrieval

```javascript
// Lexical path: skipBoosts=true retrieves raw BM25 scores
const lexicalResults = await this.graphSearch.graphExpandedSearch(query, {
  k: 50,
  expand: true,
  skipBoosts: true  // NO definition/intent boosts during retrieval
});

// Semantic path: raw HNSW scores, no cross-encoder yet
const semanticResults = await this.semanticSearch(query, {
  k: 50,
  rerank: false  // Defer reranking to after fusion
});
```

#### Step 2: Robust CC Fusion

Uses `robustCCFusion()` with:
- **Quantile normalization (p05-p95)**: Robust to score outliers
- **RRF fallback**: Triggered for edge cases (insufficient results, zero variance, outlier compression)

```javascript
const { results, method, fallbackReason } = this.robustCCFusion(
  lexicalResults,
  semanticResults,
  routeType
);
```

#### Step 3: Post-Fusion Boosts

Boosts applied **uniformly after fusion** so both lexical and semantic paths benefit equally:

| Boost Type | Max Multiplier | Condition |
|------------|----------------|-----------|
| Definition | 2.0x | Filename matches query + definition type |
| Syntax | 1.8x | Signature contains `class/function EntityName` |
| Symbol Kind | 0.7-1.0x | Hierarchy weight (class > method > variable) |
| Position | 1.0-1.3x | Early-in-file definitions (line < 50) |

**Total boost cap**: 3.0x (prevents over-promotion from stacked boosts)

## Scoring Pipeline

**Source**: `sweet-search.js`, lines 1004-1440

### Quantile Normalization

**Source**: `sweet-search.js`, `quantileNormalize()` (lines 1017-1038)

Replaces min-max normalization for robustness to score outliers:

```javascript
quantileNormalize(scores, lowQuantile = 0.05, highQuantile = 0.95) {
  const sorted = [...scores].sort((a, b) => a - b);
  const pLow = sorted[Math.floor(sorted.length * 0.05)];   // 5th percentile
  const pHigh = sorted[Math.ceil(sorted.length * 0.95)];   // 95th percentile

  return scores.map(s => Math.max(0, Math.min(1, (s - pLow) / (pHigh - pLow))));
}
```

| Property | Value |
|----------|-------|
| Low percentile | 5th (p05) |
| High percentile | 95th (p95) |
| Output range | [0, 1] clamped |
| Edge case | Single item returns 0.5; zero range returns 0.5 |

### RRF Fallback Detection

**Source**: `sweet-search.js`, `shouldFallbackToRRF()` (lines 1047-1085)

Detects when CC fusion would be unreliable:

| Condition | Threshold | Reason |
|-----------|-----------|--------|
| Insufficient results | < 3 on either side | Not enough data for meaningful normalization |
| Zero variance | variance < 1e-6 | All scores identical, normalization degenerates |
| Outlier compression | Top 5% > 95% of max AND median < 30% of max | Heavy skew makes CC unreliable |
| No valid scores | Any NaN/undefined | Data quality issue |

```javascript
// Example: outlier compression detection
const lexSorted = [...lexScores].sort((a, b) => b - a);  // Descending
const lexMax = lexSorted[0];
const lexMedian = lexSorted[Math.floor(lexSorted.length * 0.5)];
const lexTop5PctThreshold = lexSorted[Math.floor(lexSorted.length * 0.05)];

// Top scores clustered near max but median far from max
if ((lexTop5PctThreshold / lexMax) > 0.95 && (lexMedian / lexMax) < 0.3) {
  return { fallback: true, reason: 'outlier_compression' };
}
```

### RRF Fusion (Fallback)

**Source**: `sweet-search.js`, `rrfFusion()` (lines 1095-1118)

Rank-based fusion when CC is unreliable:

```javascript
rrfFusion(lexicalResults, semanticResults, k = 60) {
  // RRF formula: score = sum(1 / (k + rank))
  lexicalResults.forEach((result, rank) => {
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
  });
  semanticResults.forEach((result, rank) => {
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
  });
}
```

| Property | Value |
|----------|-------|
| Default k | 60 |
| Score range | Depends on result count |
| Advantage | Rank-based, immune to score distribution issues |

### getBoostIntent Function

**Source**: `sweet-search.js`, `getBoostIntent()` (lines 1213-1240)

Maps query router output to boost intensity:

```javascript
getBoostIntent(routerMode, routerConfidence) {
  // High confidence identifier query -> strong definition boosts
  if (routerMode === 'lexical' && routerConfidence >= 0.8) {
    return 'definition_strong';
  }

  // Lower confidence lexical -> mild boosts
  if (routerMode === 'lexical') {
    return 'definition_mild';
  }

  // Hybrid/mixed -> minimal boosts (avoid oversteering)
  if (routerMode === 'hybrid') {
    return 'general';
  }

  // Semantic/conceptual -> no definition boosts
  if (routerMode === 'semantic') {
    return 'none';
  }

  // Structural -> handled by graph traversal
  if (routerMode === 'structural') {
    return 'structural';
  }

  return 'general';
}
```

**Intent-to-Boost Mapping:**

| Router Mode | Confidence | Intent | Boost Multipliers |
|-------------|------------|--------|-------------------|
| lexical | >= 0.8 | `definition_strong` | def: 2.0, syntax: 1.8, kind: yes, pos: yes |
| lexical | < 0.8 | `definition_mild` | def: 1.5, syntax: 1.3, kind: yes, pos: yes |
| hybrid | any | `general` | def: 1.2, syntax: 1.0, kind: yes, pos: no |
| semantic | any | `none` | def: 1.0, syntax: 1.0, kind: yes (mild), pos: no |
| structural | any | `structural` | All disabled (graph handles ranking) |

**Note**: Uses ML router (CatBoost) when available; falls back to heuristic detection for definition/API/semantic intents.

### Boost Policy Configuration

**Source**: `sweet-search.js`, `BOOST_POLICY` (lines 1245-1276)

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
```

### Post-Fusion Boost Computation

**Source**: `sweet-search.js`, `applyPostFusionBoosts()` (lines 1292-1356)

Applies boosts **after** fusion for uniform treatment of both paths:

```javascript
applyPostFusionBoosts(fusedResults, query, routerMode, routerConfidence) {
  const boostIntent = this.getBoostIntent(routerMode, routerConfidence);
  const policy = SmartSearch.BOOST_POLICY[boostIntent];

  return fusedResults.map(result => {
    let totalBoost = 1.0;

    // 1. Definition Boost (filename/name match)
    if (policy.definitionBoost > 1.0) {
      const defBoost = this.computeDefinitionBoost(result, queryLower, queryTokens);
      const scaledBoost = 1.0 + (defBoost - 1.0) * (policy.definitionBoost - 1.0);
      totalBoost *= scaledBoost;
    }

    // 2. Syntax Boost (definition patterns in signature)
    if (policy.syntaxBoost > 1.0) {
      const synBoost = this.computeSyntaxBoost(result, queryTokens);
      const scaledBoost = 1.0 + (synBoost - 1.0) * (policy.syntaxBoost - 1.0);
      totalBoost *= scaledBoost;
    }

    // 3. Symbol Kind Hierarchy (always mild: 0.7-1.0)
    if (policy.kindHierarchy) {
      const kindWeight = SYMBOL_KIND_WEIGHTS[result.type] || 0.5;
      const kindBoost = 0.7 + 0.3 * kindWeight;
      totalBoost *= kindBoost;
    }

    // 4. Position Boost (early-in-file definitions)
    if (policy.positionBoost && result.startLine != null) {
      const posBoost = this.computePositionBoost(result);
      totalBoost *= posBoost;
    }

    // Cap to prevent over-promotion
    const cappedBoost = Math.min(totalBoost, 3.0);

    return { ...result, score: result.score * cappedBoost };
  });
}
```

**Definition Boost Formula** (`computeDefinitionBoost()`):
- Filename matches query + definition type: 2.0x
- Exact name match + definition type: 1.5x
- Definition type only: 1.2x
- Otherwise: 1.0x

**Syntax Boost Formula** (`computeSyntaxBoost()`):
- Signature matches `class|function|interface|enum {QueryToken}`: 1.8x
- Otherwise: 1.0x

**Symbol Kind Weights** (from `constants.js`):
| Type | Weight | Soft Boost |
|------|--------|------------|
| class | 1.0 | 1.0x |
| interface | 0.9 | 0.97x |
| enum | 0.85 | 0.955x |
| method | 0.8 | 0.94x |
| function | 0.7 | 0.91x |
| variable | 0.5 | 0.85x |
| field | 0.4 | 0.82x |

**Position Boost Formula** (`computePositionBoost()`):
```javascript
const rawPrior = 1 / (1 + startLine / 50);  // Decay by line number
const positionPrior = Math.max(0.5, Math.min(1.0, rawPrior));
return 1 + 0.3 * positionPrior;  // Range: 1.15-1.30x
```

## Cascaded Reranking Strategy

**Source**: `flashrank.js`, `cascadedRerank()` method (lines 620-750)

The default reranking flow uses a two-stage cascade with local-first priority:

```
+---------------------------------------------------------+
| Stage 1: FlashRank TinyBERT (ALWAYS)                    |
|   Model: ms-marco-TinyBERT-L-2-v2                       |
|   Pipeline: feature-extraction + CLS pooling            |
|   Latency: ~15ms                                        |
|   Cost: FREE (local)                                    |
+--------------------------+------------------------------+
                           |
                           v
+---------------------------------------------------------+
| Score Spread Analysis                                   |
|   Analyze FlashRank scores to determine if Stage 2 needed|
|   Skip conditions: clear_winner | tight_cluster | high_conf |
+--------------------------+------------------------------+
                           |
          +----------------+----------------+
          |                                 |
     SKIP (fast)                     CONTINUE (quality)
          |                                 |
          v                                 v
+-------------------+       +-------------------------------+
| Return FlashRank  |       | Stage 2: Cross-Encoder        |
| Results (~15ms)   |       |   Priority: Local > Voyage > Jina |
+-------------------+       |   See Stage 2 details below   |
                            +-------------------------------+
```

### Stage 2 Priority Chain (Updated 2026-01-15)

```
+--------------------------------------------------+
| LOCAL ModernBERT INT8 (if useLocalReranker=true) |
|   Model: gte-reranker-modernbert-base            |
|   Latency: ~700ms (50 docs)                      |
|   Cost: FREE (local)                             |
|   Config: LOCAL_RERANKER_CONFIG.useLocalReranker |
+-------------------------+------------------------+
                          | (fallback if disabled/fails)
                          v
+--------------------------------------------------+
| REMOTE: Voyage > Jina API                        |
|   Voyage: rerank-2.5 (~350ms, $0.05/1K)          |
|   Jina: jina-reranker-v3 (~80ms, $0.02/1K)       |
+--------------------------------------------------+
```

### Stage 1: FlashRank TinyBERT (Local)

**Source**: `flashrank.js`, `FlashRankReranker` class (lines 18-146)

**Always runs first** - provides baseline ranking at minimal cost.

| Property | Value |
|----------|-------|
| Model | `ms-marco-TinyBERT-L-2-v2` (switched from MiniLM 2026-01-14, 8x faster) |
| Pipeline | `feature-extraction` with `pooling: 'cls'` via `@xenova/transformers` |
| Quantization | `true` (enabled) |
| Latency | ~8-15ms |
| Cost | Free (local inference) |
| Max doc length | 512 characters (configurable) |
| Fallback | `simpleScore()` keyword matching if model fails to load |

**Implementation details**:
- Uses Xenova/Transformers.js for browser/Node.js inference
- Cross-encoder input format: `{query} [SEP] {document}`
- **Pipeline**: Uses `feature-extraction` with `pooling: 'cls'` (NOT `text-classification`)
  - Why: `text-classification` applies softmax which saturates all scores to ~1.0
  - CLS pooling returns shape [1] (scalar), which is the actual cross-encoder relevance score

**Score Semantics (Logit Range)**:
- Scores are logits in the range [-10, -5] for typical code search queries
- Higher (closer to 0) = more relevant
- **Very relevant**: > -6.5
- **Relevant**: -6.5 to -8.0
- **Weak**: -8.0 to -9.0
- **Irrelevant**: < -9.0

### Stage 2: Cross-Encoder Reranker (Conditional)

Only invoked when score spread analysis indicates potential improvement.

**Priority chain**: Local ModernBERT (priority 1) > Voyage (priority 2) > Jina (priority 3)

| Reranker | Model | Latency | Cost | Priority | Config |
|----------|-------|---------|------|----------|--------|
| **Local ModernBERT** | `gte-reranker-modernbert-base` INT8 | ~700ms | FREE | 1 (default) | `LOCAL_RERANKER_CONFIG.useLocalReranker` |
| **Voyage** | `rerank-2.5` | ~300-350ms | $0.05/1K | 2 (fallback) | `VOYAGEAI_API_KEY` |
| **Jina** | `jina-reranker-v3` | ~80-100ms | $0.02/1K | 3 (fallback) | `JINA_API_KEY` |

**Local ModernBERT Details** (Added 2026-01-15):
- Model: `Alibaba-NLP/gte-reranker-modernbert-base` with INT8 quantization
- Library: `@huggingface/transformers` (auto-downloads ~150MB on first use)
- Inference: Sequential scoring with global ONNX mutex (`onnx-mutex.js`)
- Cold start: ~15s (model download + initialization)
- Config: `LOCAL_RERANKER_CONFIG.useLocalReranker = true` (default) in `config.js`
- Disable: Set `useLocalReranker: false` to use Voyage/Jina APIs instead

## Reranker Priority Chain

**Source**: `flashrank.js`, `rerank()` method (lines 560-590)

```javascript
// CASCADED MODE: FlashRank first, then best available reranker (Local > Voyage > Jina)
// Cascaded mode works if ANY Stage 2 reranker is available (local OR remote)
const hasRemoteReranker = this.voyageReranker.isAvailable() || this.jinaReranker.isAvailable();
const hasLocalReranker = this.useLocalReranker && this.localReranker.isAvailable();
if (useCascaded && (hasRemoteReranker || hasLocalReranker)) {
  return await this.cascadedRerank(query, documents, topK, options);
}

// Standard mode fallback: Voyage → Jina → FlashRank
if (this.preferVoyage && this.voyageReranker.isAvailable()) {
  return await this.voyageReranker.rerank(query, documents, topK);
}
if (this.preferJina && this.jinaReranker.isAvailable()) {
  return await this.jinaReranker.rerank(query, documents, topK);
}
return await this.flashRankReranker.rerank(query, documents, topK);
```

**Selection Logic** (Updated 2026-01-15):
1. **Default (Cascaded mode)**: FlashRank always, then Local ModernBERT > Voyage > Jina if score spread warrants
2. If `LOCAL_RERANKER_CONFIG.useLocalReranker = true` → Use Local ModernBERT for Stage 2
3. Else if `VOYAGEAI_API_KEY` set → Use Voyage API for Stage 2
4. Else if `JINA_API_KEY` set → Use Jina API for Stage 2
5. Else → Use FlashRank only (always available)

## Score Spread Analysis

**Source**: `flashrank.js`, `shouldSkipRerank()` method (lines 625-659)

After Stage 1, the system analyzes FlashRank scores to decide if Stage 2 is worthwhile.

**Important**: Thresholds are tuned for **logit space** (typical range [-10, -5]), not probability space.

### Skip Conditions (Logit Space)

| Condition | Threshold | Reason |
|-----------|-----------|--------|
| **Clear Winner** | `topGap > 0.5` | Top result is significantly better than #2 |
| **Tight Cluster** | `spread < 0.3` | Top K scores too similar to differentiate |
| **High Confidence** | All top 3 scores `> -6.5` | Already confident in ranking |
| **Minimum Score** | `topScore > -7.5` | Best result must be at least weakly relevant |

### Implementation

```javascript
shouldSkipRerank(scores, options = {}) {
  const {
    topGapThreshold = 0.5,      // Was 0.15 (probability), now 0.5 (logit)
    spreadThreshold = 0.3,      // Was 0.10 (probability), now 0.3 (logit)
    highConfidence = -6.5,      // Was 0.80 (probability), now -6.5 (logit)
    minScoreThreshold = -7.5,   // Was 0.30 (probability), now -7.5 (logit)
    minResults = 3,
    spreadTopK = 10,
  } = options;

  if (!scores || scores.length < minResults) {
    return { skip: false, reason: 'insufficient_results' };
  }

  const sorted = [...scores].sort((a, b) => b - a);
  const topGap = sorted[0] - sorted[1];

  // Calculate spread over top K only (avoid tail results inflating spread)
  const topK = Math.min(spreadTopK, sorted.length);
  const spread = sorted[0] - sorted[topK - 1];
  const topScores = sorted.slice(0, Math.min(3, sorted.length));

  // Clear winner: top result stands out
  if (topGap > topGapThreshold) {
    return { skip: true, reason: `clear_winner (gap=${topGap.toFixed(3)})` };
  }

  // Tight cluster: all scores similar (calculated over top K)
  if (spread < spreadThreshold) {
    return { skip: true, reason: `tight_cluster (spread=${spread.toFixed(3)})` };
  }

  // High confidence: ALL top 3 scores are very high (closer to 0 in logit space)
  if (topScores.every(s => s > highConfidence)) {
    return { skip: true, reason: `high_confidence (min=${Math.min(...topScores).toFixed(3)})` };
  }

  return { skip: false, reason: 'needs_rerank' };
}
```

### Skip Rate

In practice, **60-80% of queries skip Stage 2** due to:
- Exact identifier matches (clear winner)
- Conceptual queries with tight semantic clusters
- High-quality HNSW candidates

## MMR Diversification

**Source**: `sweet-search.js`, `mmrDiversify()` method

MMR (Maximal Marginal Relevance) replaces flood control for result diversity. Instead of arbitrary per-file/type caps, MMR uses a principled approach that balances relevance with diversity.

### Formula

```
MMR_Score = λ × Relevance - (1-λ) × max(Similarity to already selected)
```

Where:
- **λ** (lambda): Balance parameter between relevance and diversity
- **Relevance**: Original reranking score
- **max(Similarity)**: Maximum similarity to any already-selected result

### Lambda Values by Intent

| Intent | λ Value | Rationale |
|--------|---------|-----------|
| lexical (high confidence) | 0.95 | Strong identifier match → prioritize relevance |
| lexical (low confidence) | 0.90 | Slightly more diversity for ambiguous identifiers |
| semantic | 0.85 | Conceptual queries benefit from diverse perspectives |
| hybrid | 0.90 | Balanced approach for mixed queries |
| structural | 0.90 | Graph results already scoped, mild diversification |

### Similarity Computation

Similarity between results is computed using three factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| **File path** | ~0.5 | Same file = high similarity; same directory = moderate |
| **Entity type** | ~0.3 | Same type (class, method, etc.) = higher similarity |
| **Package** | ~0.2 | Same package/module = slight similarity boost |

This prevents the result list from being dominated by:
- Multiple methods from the same class
- Several implementations in the same file
- Repetitive results from the same package

### Why MMR Over Flood Control?

| Approach | Method | Limitation |
|----------|--------|------------|
| **Flood Control** | Hard caps per file/type | Arbitrary thresholds; may discard best results |
| **MMR** | Soft penalty based on similarity | Principled; considers actual result relationships |

MMR allows more results from a highly relevant file when they are sufficiently different from each other, while still ensuring overall diversity.

### Reference

- [MMR: Diversity-Aware Reranking (Qdrant Blog)](https://qdrant.tech/blog/mmr-diversity-aware-reranking/)

## Implementation Details

### VoyageReranker Class

**Source**: `flashrank.js`, lines 152-280

```javascript
class VoyageReranker {
  constructor(options = {}) {
    this.model = options.model || RERANK_CONFIG.voyage.model;  // 'rerank-2.5'
    this.endpoint = 'https://api.voyageai.com/v1/rerank';
    this.apiKey = getVoyageApiKey();
    this.maxDocuments = RERANK_CONFIG.voyage.maxDocuments;  // 100
  }

  async rerank(query, documents, topK = 10) {
    // Input validation
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Query must be a non-empty string');
    }
    if (!Array.isArray(documents) || documents.length === 0) {
      return { results: [], latency_ms: 0, model: this.model };
    }

    // AbortController for timeout (30s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    // Retry with exponential backoff (up to 2 retries)
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const response = await fetch(this.endpoint, {
          signal: controller.signal,
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.apiKey}`, ... },
          body: JSON.stringify({
            query,
            documents: preparedDocs,
            model: this.model,
            top_k: topK,
            return_documents: false,
          }),
        });
        // ... process response
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new Error('Request timed out after 30s');
        }
        // Retry on transient errors with exponential backoff
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
      }
    }
  }
}
```

### JinaReranker Class

**Source**: `flashrank.js`, lines 286-421

```javascript
class JinaReranker {
  constructor(options = {}) {
    this.model = options.model || 'jina-reranker-v3';
    this.endpoint = 'https://api.jina.ai/v1/rerank';
    this.apiKey = getJinaRerankerApiKey();
    this.maxDocuments = RERANK_CONFIG.jina.maxDocuments;  // 100
  }

  // Same pattern as VoyageReranker:
  // - Input validation (query must be non-empty string)
  // - 30s timeout with AbortController
  // - 2x retry with exponential backoff (100ms, 200ms, 400ms)
  // - Error cause preservation
  // - Uses 'top_n' parameter (Jina) instead of 'top_k' (Voyage)
}
```

### FlashRankReranker Class

**Source**: `flashrank.js`, lines 18-146

Local cross-encoder using Transformers.js:

```javascript
class FlashRankReranker {
  constructor(options = {}) {
    this.model = options.model || 'ms-marco-MiniLM-L-6-v2';
    this.maxDocLength = options.maxDocLength || 512;
    this.pipeline = null;  // Lazy-loaded
  }

  async init() {
    if (this.pipeline) return;

    const transformers = await import('@xenova/transformers');
    // feature-extraction pipeline with CLS pooling (NOT text-classification)
    // text-classification applies softmax which saturates scores to ~1.0
    this.pipeline = await transformers.pipeline(
      'feature-extraction',
      'Xenova/ms-marco-MiniLM-L-6-v2',
      { quantized: true, pooling: 'cls' }
    );
  }

  async rerank(query, documents, topK = 10) {
    if (this.pipeline) {
      // Cross-encoder inference: "{query} [SEP] {document}"
      const input = `${query} [SEP] ${docText}`;
      const result = await this.pipeline(input);
      // CLS pooling returns shape [1] - the actual relevance logit
      const score = result.data[0];  // Logit in range [-10, -5] typically
    } else {
      // Fallback: simpleScore() keyword matching
      score = this.simpleScore(query, docText);
    }
  }

  // Fallback: count query word occurrences with exact match bonus
  simpleScore(query, document) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    // ... count occurrences, bonus for word boundaries
    return score / queryWords.length;
  }
}
```

## Performance Characteristics

### Latency Breakdown

| Scenario | Latency | Notes |
|----------|---------|-------|
| FlashRank only (Stage 1 skip) | ~15ms | 60-80% of queries |
| FlashRank + Voyage | ~330ms | Best quality |
| FlashRank + Jina | ~95ms | Good quality, faster |
| Timeout fallback | ~15ms | Returns FlashRank results |

### Cost Analysis

| Reranker | Free Tier | Paid Rate |
|----------|-----------|-----------|
| **FlashRank** | Unlimited | Free |
| **Voyage** | 1M tokens/month | $0.05/1M tokens |
| **Jina** | 10M tokens | $0.018/1M tokens |

### Quality Comparison

Based on internal benchmarks (January 2026):

| Reranker | MRR@10 | NDCG@10 | Notes |
|----------|--------|---------|-------|
| Voyage rerank-2.5 | 0.82 | 0.79 | Best quality |
| Jina v3 | 0.79 | 0.76 | Good balance |
| FlashRank | 0.71 | 0.68 | Baseline |

### Alternative Models Evaluated

#### TinyBERT (NOT Recommended)

**Model**: `Xenova/ms-marco-TinyBERT-L-2-v2`

Tested as a faster alternative to the default MiniLM model.

| Metric | TinyBERT | MiniLM (Default) | Comparison |
|--------|----------|------------------|------------|
| **Latency** | ~2ms | ~13ms | 6.7x faster |
| **Quality** | Poor | Good | Significantly worse |

**Why NOT recommended**:
- Ranks irrelevant documents at position #2 in testing
- Model is too shallow (2 layers vs 6) to capture semantic relevance
- Speed gain not worth the quality degradation for code search

**Recommendation**: Stick with `ms-marco-MiniLM-L-6-v2`. The ~11ms additional latency is negligible compared to the quality improvement.

## Configuration

**Source**: `config.js`, `RERANK_CONFIG` (lines 669-712)

```javascript
export const RERANK_CONFIG = {
  // Shared settings for remote rerankers
  timeout: 30000,        // 30s timeout for API calls
  maxRetries: 2,         // Retry transient failures up to 2 times
  retryDelayMs: 100,     // Base delay for exponential backoff (100, 200, 400ms)
  maxDocTruncation: {    // Per-document truncation limits
    voyage: 4000,        // Voyage has stricter token limits
    jina: 8000,          // Jina v3 has 131K context, but limit per-doc for efficiency
  },

  // Tier 1: Voyage Rerank-2.5
  voyage: {
    enabled: VOYAGEAI_API_KEY.length > 0,
    priority: 1,
    model: 'rerank-2.5',
    endpoint: 'https://api.voyageai.com/v1/rerank',
    maxDocuments: 100,
    topK: 20,
  },

  // Tier 2: Jina Reranker v3 (listwise, 0.6B params)
  jina: {
    enabled: JINA_API_KEY.length > 0,
    priority: 2,
    model: 'jina-reranker-v3',
    endpoint: 'https://api.jina.ai/v1/rerank',
    maxDocuments: 100,
    topK: 20,
    contextLength: 131072,  // 131K context window
  },

  // Tier 3: FlashRank (local, no API needed)
  flashrank: {
    enabled: true,
    priority: 99,
    model: 'ms-marco-MiniLM-L-6-v2',
    maxDocLength: 512,
  },
};
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VOYAGEAI_API_KEY` | No | Enables Voyage reranker (priority 1) |
| `JINA_API_KEY` | No | Enables Jina reranker (priority 2) |

**Note**: If neither API key is set, cascaded mode uses FlashRank only.

## CLI Usage

**Source**: `flashrank.js`, CLI section (lines 691-845)

```bash
# Check reranker availability
node flashrank.js status

# Run performance test
node flashrank.js test

# Rerank with specific backend
node flashrank.js rerank "query" --voyage      # Force Voyage
node flashrank.js rerank "query" --jina        # Force Jina
node flashrank.js rerank "query" --local       # Force FlashRank
node flashrank.js rerank "query" --cascaded    # Two-stage cascade (default)
```

### Smart Search Integration

```bash
# Default: cascaded reranking enabled
.claude/helpers/search-100x/ss "how does auth work" --mode semantic

# Disable reranking
.claude/helpers/search-100x/ss "query" --no-rerank

# JSON output shows rerank info
.claude/helpers/search-100x/ss "query" --json
# -> earlyExit: true, skipReason: "tight_cluster (spread=0.000)"
```

## Troubleshooting

### Reranker Not Available

```bash
# Check status
node flashrank.js status

# Expected output:
# voyageAvailable: true/false
# jinaAvailable: true/false
# flashRankModel: "ms-marco-MiniLM-L-6-v2"
# useCascaded: true
```

**Fix**: Set `VOYAGEAI_API_KEY` or `JINA_API_KEY` in `.env` file.

### Slow Reranking

Check if remote reranker is being called unnecessarily:
- If most queries show `earlyExit: false`, tune thresholds
- Increase `spreadThreshold` to skip more queries
- Use `--no-rerank` for latency-critical searches

### Timeout Errors

Remote API calls have 30s timeout. If hitting this:
- Check network connectivity
- Reduce document count/length
- Jina is faster (~80ms) than Voyage (~300ms)

### FlashRank Model Load Failure

If FlashRank can't load the model, it falls back to `simpleScore()` keyword matching:
```
FlashRank: Could not load model: <error message>
```

Check:
- `@xenova/transformers` package is installed
- Sufficient memory for model loading
- Network access for first-time model download

## Related Documentation

- [SEMANTIC_SEARCH.md](./SEMANTIC_SEARCH.md) - Full semantic search pipeline
- [HYBRID_SEARCH.md](./HYBRID_SEARCH.md) - Hybrid search fusion
- [Query Router](./QUERY_ROUTER.md) - Query classification

## Changelog

**January 14, 2026** (FlashRank Pipeline Fix):
- **BREAKING**: Changed FlashRank from `text-classification` to `feature-extraction` pipeline with `pooling: 'cls'`
  - Why: `text-classification` applies softmax which saturates all scores to ~1.0
  - CLS pooling returns shape [1] (scalar), which is the actual cross-encoder relevance score
- Documented score semantics for logit space (range [-10, -5]):
  - Very relevant: > -6.5
  - Relevant: -6.5 to -8.0
  - Weak: -8.0 to -9.0
  - Irrelevant: < -9.0
- Updated `shouldSkipRerank()` thresholds for logit space:
  - `topGapThreshold`: 0.15 → 0.5
  - `spreadThreshold`: 0.10 → 0.3
  - `highConfidence`: 0.80 → -6.5
  - `minScoreThreshold`: 0.30 → -7.5
- Added TinyBERT evaluation results:
  - `Xenova/ms-marco-TinyBERT-L-2-v2` is 6.7x faster but NOT recommended
  - Poor quality: ranks irrelevant docs at #2
  - Recommendation: stick with MiniLM-L-6-v2

**January 14, 2026** (Hybrid Fusion v2 / robustCCFusion):
- Added fair fusion approach for hybrid search (`hybridSearchV2`)
- Documented `skipBoosts=true` for raw BM25 score retrieval in `graphExpandedSearch()`
- Added `robustCCFusion()` with quantile normalization (p05-p95) and RRF fallback
- Documented RRF fallback conditions (insufficient results, zero variance, outlier compression)
- Added `getBoostIntent()` function mapping router mode to boost intensity
- Added `BOOST_POLICY` configuration for intent-driven boost multipliers
- Documented `applyPostFusionBoosts()` for uniform post-fusion boost application
- Added post-fusion boost formulas: definition (2.0x), syntax (1.8x), kind (0.7-1.0x), position (1.15-1.30x)
- Added boost cap (3.0x) to prevent over-promotion from stacked boosts
- Added complete "Scoring Pipeline" section with all helper functions

**January 13, 2026**:
- Updated documentation to match current `flashrank.js` implementation
- Corrected line references to actual source locations
- Added note about pre-reranking pipeline stages (intent detection, flood control)
- Clarified FlashRank uses `text-classification` pipeline (not sequence-to-sequence)
- Added `simpleScore()` fallback documentation
- Updated config section with accurate `RERANK_CONFIG` values

**January 3, 2026**:
- Added Jina Reranker v3 integration
- Implemented cascaded two-stage reranking
- Added score spread analysis with skip optimization
- Added 30s timeout with AbortController
- Added retry logic with exponential backoff
- Added input validation for query/documents
