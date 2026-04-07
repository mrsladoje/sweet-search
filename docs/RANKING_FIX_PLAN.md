# RANKING FIX PLAN - Search-100x

**Date:** 2026-01-12 (Updated: 2026-01-14)
**Target:** Fix 12 ranking failures while maintaining <50ms latency
**Phase 1 Status:** ✅ COMPLETED (Strategies #1, #2, #4, #5, #19, #20, #21)
**FlashRank Fixes:** ✅ COMPLETED (init() bug, score semantics, threshold calibration)
**Int8 Fixes:** ✅ COMPLETED (normalization, cosine similarity, missing vector handling)
**MMR Diversification:** ✅ COMPLETED (90.5% Success@10 achieved)
**Current:** 90.5% Success@10 → **Target: 95%+ Success@10**

---

## Executive Summary

After deep analysis of 12 failing queries and comprehensive research into 2026 SOTA ranking techniques, this plan outlines **24 strategies** ranging from quick wins (2h implementation) to architectural improvements (1-2 weeks).

**Root Cause:** Our SQLite FTS5/BM25 stage ranks **entities** using only `name`, `signature`, and `doc_comment` (porter + trigram), not full code or summaries. Implementations/usages often mention an identifier in signatures/comments and can outrank the definition entity. Rerankers (FlashRank, Voyage/Jina, ColBERT) operate on top‑K candidates—if the definition entity isn't in top‑K, no reranker can find it.

**Key Insight:** The fix must happen **before** or **during** FTS5 scoring (candidate recall + definition surfacing), not after.

**Already Implemented (per SEARCH_200X.md):**
- ✅ Cascaded Reranking (FlashRank TinyBERT → Local ModernBERT INT8 → Voyage/Jina API)
- ✅ Score Spread Analysis (`shouldSkipRerank`) - **FIXED 2026-01-14** (see P0 Bug Fix below)
- ✅ FlashRank Integration (TinyBERT-L2-v2, ~15ms)
- ✅ **Local ModernBERT INT8** (GTE reranker, ~700ms, FREE) - **ADDED 2026-01-15**
- ✅ Jina Reranker v3 (fallback if local disabled)
- ✅ Voyage rerank-2.5 (fallback if local disabled)
- ✅ ColBERT Late Interaction (auto-enabled, cache guard preserved)
- ✅ Matryoshka Truncation (1024d → 512d for HNSW)
- ✅ Early Exit Threshold (0.90/0.92)
- ✅ Convex Combination Fusion (replaces RRF, +7-18% MRR per ACM TOIS 2023)

---

## P0 Bug Fix: `shouldSkipRerank` Low Score Bypass (2026-01-14)

**Critical Bug Discovered:** The `shouldSkipRerank()` function was triggering early exit on **100% of semantic queries** because:

1. **Voyage embeddings are NOT normalized to [-1, 1]** - they're in ~[-0.11, 0.08] range
2. **Int8 quantization produces tiny values** (~±14 instead of ±127)
3. **Int8 dot product scores are ~0.001** (essentially garbage)
4. **`tight_cluster` check** interpreted "all scores similar" as "confident ranking" when it actually meant "no confidence"

**Symptoms:**
- FlashRank never ran (0% utilization despite being "enabled")
- ColBERT never ran
- Voyage API never called (0 rerank API calls)
- Model comparison tests (MiniLM vs TinyBERT) showed identical results (neither was used!)

**Fix Applied:**
```javascript
// smart-search-v21.js:842, flashrank.js:745
shouldSkipRerank(scores, options = {}) {
  const {
    // ... existing thresholds ...
    minScoreThreshold = 0.30,  // NEW: Never skip on low scores
  } = options;

  // P0 FIX: Never skip if scores are too low
  if (sorted[0] < minScoreThreshold) {
    return { skip: false, reason: `low_scores (max=${sorted[0].toFixed(3)})` };
  }
  // ... rest unchanged
}
```

**Results After Fix:**
| Metric | Before | After |
|--------|--------|-------|
| FlashRank utilization | 0% | 90%+ |
| ColBERT utilization | 0% | 100% (uncached) |
| Voyage API calls | 0 | 29 (per 410 queries) |
| Success@10 | 90.0% | 90.0% |

**Note:** Success@10 unchanged because FlashRank is handling most queries well; Voyage cascade triggers only for uncertain rankings.

**Future Improvement:** Fix `floatToInt8` to normalize based on actual embedding magnitude (requires reindex)

---

## Recently Completed Fixes (2026-01-14)

### FlashRank Fixes ✅ COMPLETED

**Issues Fixed:**

1. **init() Bug Fixed** - Moved initialization before the `if(this.pipeline)` check to ensure proper model loading
2. **Score Semantics Fixed** - Changed from `text-classification` to `feature-extraction` with CLS pooling for correct score computation
3. **Thresholds Calibrated** - Adjusted thresholds for logit space (not probability space)

**Implementation Details:**
```javascript
// flashrank.js - init() bug fix
async init() {
  // ✅ FIXED: Initialize BEFORE checking this.pipeline
  if (!this.pipeline) {
    this.pipeline = await pipeline('feature-extraction', this.modelName, {
      quantized: this.quantized
    });
  }
  return this;
}

// Score computation with CLS pooling
async rerank(query, documents) {
  const outputs = await this.pipeline(inputs, { pooling: 'cls' });
  // Logit-space thresholds (not sigmoid/softmax)
  const scores = outputs.map(o => o[0]); // CLS token embedding
}
```

### Int8 Cosine Similarity Fixes ✅ COMPLETED

**Issues Fixed:**

1. **floatToInt8 Normalization Fixed** - Now properly normalizes vectors before quantization
2. **Renamed Function** - `int8DotProduct` → `int8CosineSimilarity` for accuracy (it computes cosine similarity, not raw dot product)
3. **Missing Vector Handling** - Returns neutral score (0.5) instead of crashing; filters missing vectors from skip analysis

**Implementation Details:**
```javascript
// int8-cosine.js - Fixed normalization
function floatToInt8(floatVector) {
  // ✅ FIXED: Normalize to unit length BEFORE quantization
  const magnitude = Math.sqrt(floatVector.reduce((sum, v) => sum + v * v, 0));
  const normalized = floatVector.map(v => v / magnitude);

  // Now quantize normalized values to [-127, 127]
  return new Int8Array(normalized.map(v => Math.round(v * 127)));
}

// ✅ RENAMED: int8DotProduct → int8CosineSimilarity
function int8CosineSimilarity(vecA, vecB) {
  // Dot product of normalized vectors IS cosine similarity
  let sum = 0;
  for (let i = 0; i < vecA.length; i++) {
    sum += vecA[i] * vecB[i];
  }
  // Scale back from int8 range to [-1, 1]
  return sum / (127 * 127);
}

// ✅ FIXED: Missing vector handling
function computeSimilarities(queryVec, docVecs) {
  return docVecs.map((docVec, i) => {
    if (!docVec) {
      return { index: i, score: 0.5, missing: true }; // Neutral score
    }
    return { index: i, score: int8CosineSimilarity(queryVec, docVec), missing: false };
  });
}

// Filter missing vectors from skip analysis
function shouldSkipRerank(scores, options = {}) {
  const validScores = scores.filter(s => !s.missing);
  // ... rest of analysis on validScores only
}
```

### MMR Diversification ✅ COMPLETED

**Implementation:** See Strategy #21 details below.

**Key Results:**
- Replaced flood control with MMR (Maximal Marginal Relevance)
- λ=0.9 for code search (relevance-heavy, slight diversity push)
- Intent-aware λ tuning: lexical=0.95, semantic=0.85, hybrid=0.9
- **Achieved 90.5% Success@10** (up from 88.3% baseline)

---

## Planned Future Work

### ~~CROSS-JEM (Strategy #13)~~ - NOT FEASIBLE
- ~~Joint efficient modeling for batched reranking~~
- ~~Expected: -50-75% reranking latency~~
- **Status: NOT FEASIBLE** - Requires CROSS-JEM trained model; MS-MARCO outputs single CLS score. WASM batching is 0.6-0.8x slower (verified 2026-01-14: 10 docs 0% speedup, 20 docs -3.3%, 50 docs -2.9%).

### Fine-Tuning MS-MARCO on Code Search - Planned
- Train on Sloth + open source codebases (Python, Go, Rust for diversity)
- Export to INT8 ONNX for transformers.js compatibility
- See Appendix for detailed plan
- Status: Not immediate priority at 90.5% Success@10

---

## Current State Analysis

### Failing Query Patterns

| Pattern | Count | Example | Root Cause |
|---------|-------|---------|------------|
| Interface overshadowed by implementations | 3 | `DetectionHeuristic` → 31 implementations rank higher | BM25 rewards frequency |
| Class overshadowed by usages | 4 | `RingBuffer` → `TrajectoryHashStore.java:getMaxSize()` ranks first | Method calls mention class name |
| Same-file entity priority | 2 | `TrajectoryHasher` at #3, other entities in same file at #1-2 | No entity type hierarchy |
| References rank above definitions | 3 | `ConfigHandler` → `ConfigUpdater.java` (has param `ConfigHandler configHandler`) | No definition boost |

### Current Pipeline Gaps

| Feature | Current Status | Impact |
|---------|---------------|--------|
| Exact filename boost | ❌ None | Query "RingBuffer" doesn't boost `RingBuffer.java` |
| Definition vs reference flag | ❌ None | Definitions score same as mentions |
| Entity type hierarchy | ❌ None | Methods score same as classes |
| Symbol kind weights | ❌ None | All entity types equal |
| Intent detection | ❌ None | Can't distinguish "find definition" from "find usages" |

---

## Strategy Overview

| # | Strategy | Effort | Latency | Impact | Priority | Status |
|---|----------|--------|---------|--------|----------|--------|
| 1 | Post-FTS5 Definition Boost | 2h | +1ms | +6-8 queries | P0 | ✅ IMPLEMENTED |
| 2 | Two-Pass Definition-First Search | 4h | +2-3ms | +12 queries | P0 | ✅ IMPLEMENTED |
| 3 | ~~BM25F Field Weighting~~ | — | — | **Dropped: Redundant with post-fusion boosts** | — | N/A |
| 4 | Symbol Kind Hierarchy | 4h | +0ms | +4-6 queries | P1 | ✅ IMPLEMENTED |
| 5 | Query Intent Detection | 2h | +0ms | +15-25% targeted | P1 | ✅ IMPLEMENTED |
| 6 | ~~Identifier Segmentation~~ | — | — | **Dropped: Hurts precision** | — | N/A |
| 7 | PageRank on Symbol Graph | 1w | +0ms (offline) | +8-12% MRR | P2 | Planned |
| 8 | ~~Abbreviation Expansion~~ | — | — | **Dropped: Hurts precision** | — | N/A |
| 9 | ~~RRF Alpha Tuning~~ | — | — | **Already Covered** | — | N/A (CC Fusion) |
| 10 | Matryoshka Adaptive Reranking | 1w | -50% rerank | Same quality | P3 | Planned |
| 11 | ~~Qwen3-Reranker-0.6B~~ → GTE ModernBERT INT8 | 1d | ~700ms | Stage 2 local reranker (FREE) | P1 | ✅ IMPLEMENTED |
| 12 | ~~Learned Sparse Retrieval (LSR/LACONIC)~~ | — | — | **Dropped: Not language-agnostic** | — | N/A |
| 13 | ~~CROSS-JEM Joint Scoring~~ | — | — | **NOT FEASIBLE: Needs CROSS-JEM model; WASM batching slower** | — | ❌ NOT_FEASIBLE |
| 14 | Early Termination for HNSW | 1d | -20-40% vector | **LOW IMPACT: HNSW already <1ms; USearch no iterator API** | P3 | ⏸️ LOW_IMPACT |
| 15 | Rational Retrieval Acts (RRA) | 2-3d | +1-3ms | +5-10% MRR | P2 | Planned |
| 16 | Multivector Reranking | 1w | +5-10ms | +8-15% MRR | P2 | Planned |
| 17 | BlockRank (Attention Optimization) | 3-4d | +0-5ms | +3-5% MRR | P3 | Planned |
| 18 | Partitioned Elias-Fano (PEF) Indexes | 3-4d | +0ms | -30-50% memory | P3 | Planned |
| 19 | Definition Syntax Boost (FTS5 Phrase/NEAR Queries) | 2-4h | +0-2ms | Fixes "implementations outrank definition" | P0 | ✅ IMPLEMENTED |
| 20 | Structural Position Boost (start_line priors) | 1-2h | +0ms | Fixes class-vs-usage ranking | P1 | ✅ IMPLEMENTED |
| 21 | MMR Diversity (Maximal Marginal Relevance) | 4h | +0-1ms | Prevents "31 impls push def out of top10" | P1 | ✅ IMPLEMENTED |
| 22 | Neighborhood Locality Boost (Active-file prior) | 2-4h | +0ms | Better "working set" relevance | P2 | Planned |
| 23 | ~~Lightweight LTR Mid-Layer (LambdaMART/XGBoost features)~~ | — | — | **Dropped: Not language-agnostic** | — | N/A |
| 24 | ColBERT Early-Exit + Upper-Bound Pruning | 2-4d | -20-60% ColBERT | Same quality (or +) | P2 | Planned |

---

## Strategy Details

### Strategy 1: Post-FTS5 Definition Boost (P0 - Quick Win) ✅ IMPLEMENTED

**Status:** Implemented in `graph-search.js` via `robustCCFusion()` with `skipBoosts: true` parameter for fair fusion, followed by post-fusion boost application.

**Implementation Notes:**
- Uses `skipBoosts` parameter during CC Fusion to ensure fair score combination
- Boosts are applied AFTER fusion to avoid distorting lexical/semantic score blending
- RRF fallback triggers when semantic scores form tight clusters (spread < 0.01)

**Concept:** After FTS5 returns candidates, multiply score if result file **defines** the queried entity.

**Implementation:**
```javascript
// In graph-search.js after FTS5 results
function applyDefinitionBoost(results, query) {
  const queryLower = query.toLowerCase();

  for (const result of results) {
    // Check if filename matches query (definition indicator)
    const filename = path.basename(result.file_path, path.extname(result.file_path));
    const filenameMatches = filename.toLowerCase() === queryLower ||
                            filename.toLowerCase().includes(queryLower);

    // Check if entity type is a definition type
    const isDefinitionType = ['class', 'interface', 'struct', 'enum', 'function'].includes(result.type);

    // Check if entity name matches query exactly
    const nameMatches = result.name.toLowerCase() === queryLower;

    if (filenameMatches && isDefinitionType) {
      result.score *= 2.0; // Strong boost: file defines this entity
    } else if (nameMatches && isDefinitionType) {
      result.score *= 1.5; // Medium boost: definition type with exact name
    } else if (isDefinitionType) {
      result.score *= 1.2; // Weak boost: any definition type
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
```

**Pros:** Non-invasive, fast (~1ms), immediate impact
**Cons:** Heuristic, may over-boost in ambiguous cases
**Files to modify:** `graph-search.js:100-150`

---

### Strategy 2: Two-Pass Definition-First Search (P0 - High Impact) ✅ IMPLEMENTED

**Status:** Implemented in `graph-search.js`. Definition-first candidates are identified and merged with priority into the final result set.

**Implementation Notes:**
- Parallel execution of definition search and normal FTS5 search
- Definition results guaranteed visibility in top positions via merge priority
- Deduplication by entity key prevents duplicate entries

**Concept:** Run two searches in parallel:
1. **Definition search:** Find files where `filename == query` or entity is class/interface with exact name
2. **Normal FTS5:** Standard BM25 ranking

Merge with definition results guaranteed in top-3.

**Implementation:**
```javascript
async function hybridDefinitionSearch(query, options) {
  const queryNormalized = query.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Pass 1: Definition-first (parallel with Pass 2)
  const definitionPromise = db.all(`
    SELECT e.*, 100.0 as definition_boost
    FROM entities e
    WHERE (
      -- Filename matches query
      LOWER(REPLACE(e.file_path, '/', '')) LIKE '%' || ? || '.%'
      OR
      -- Entity name exact match + definition type
      (LOWER(e.name) = ? AND e.type IN ('class', 'interface', 'struct', 'enum', 'function'))
    )
    ORDER BY
      CASE WHEN LOWER(e.name) = ? THEN 0 ELSE 1 END,
      CASE e.type
        WHEN 'class' THEN 0
        WHEN 'interface' THEN 1
        WHEN 'function' THEN 2
        ELSE 3
      END
    LIMIT 5
  `, [queryNormalized, query.toLowerCase(), query.toLowerCase()]);

  // Pass 2: Normal FTS5 (parallel)
  const fts5Promise = fts5Search(query, options);

  const [definitionResults, fts5Results] = await Promise.all([definitionPromise, fts5Promise]);

  // Merge: definitions first, then FTS5 (deduplicated)
  return mergeWithDefinitionPriority(definitionResults, fts5Results);
}

function mergeWithDefinitionPriority(definitions, fts5Results) {
  const seen = new Set();
  const merged = [];

  // Add definitions first (guaranteed top positions)
  for (const def of definitions) {
    const key = `${def.file_path}:${def.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ ...def, score: def.score + def.definition_boost });
    }
  }

  // Add remaining FTS5 results
  for (const result of fts5Results) {
    const key = `${result.file_path}:${result.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(result);
    }
  }

  return merged;
}
```

**Pros:** Guarantees definition in results, parallel execution, no schema changes
**Cons:** Two queries instead of one (+2-3ms)
**Files to modify:** `graph-search.js:200-300`

---

### Strategy 3: ~~BM25F Field Weighting~~ (DROPPED)

> **DROPPED (2026-01-14):** Redundant with post-fusion boosts. Our skipBoosts + post-fusion pattern already achieves the same goal (prioritizing name matches over doc_comment mentions) without modifying FTS5 scoring. Both approaches are language-agnostic, so no benefit to switching.

**Concept:** Use field-weighted BM25 to boost symbol names over code body.

**Research Finding (Sourcegraph):**
> "We compute term frequencies for each line, boosting matches on symbols, while using the line's length in place of the usual file length."

**Implementation:**
```sql
-- Modify FTS5 table to include weighted fields
CREATE VIRTUAL TABLE entities_fts USING fts5(
  name,           -- Weight 3.0 (symbol names)
  signature,      -- Weight 2.0 (function signatures)
  doc_comment,    -- Weight 1.5 (documentation)
  content,        -- Weight 1.0 (code body)
  content='entities',
  content_rowid='rowid'
);

-- Query with field weights (BM25F approximation)
SELECT *,
  bm25(entities_fts, 3.0, 2.0, 1.5, 1.0) as weighted_score
FROM entities_fts
WHERE entities_fts MATCH ?
ORDER BY weighted_score DESC;
```

**Alternative (post-processing):**
```javascript
function applyBM25FWeights(results) {
  const FIELD_WEIGHTS = {
    name: 3.0,
    signature: 2.0,
    doc_comment: 1.5,
    content: 1.0
  };

  for (const result of results) {
    let weightedScore = 0;
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      if (result.matched_fields?.includes(field)) {
        weightedScore += result.field_scores[field] * weight;
      }
    }
    result.score = weightedScore || result.score;
  }

  return results.sort((a, b) => b.score - a.score);
}
```

**Pros:** Industry-proven (Sourcegraph, Elasticsearch), significant MRR improvement
**Cons:** Requires schema change or reindexing
**Files to modify:** `graph-extractor.js`, `graph-search.js`

**Alternative Consideration:** See Strategy #12 (LSR/LACONIC) for a more powerful learned approach.

---

### Strategy 4: Symbol Kind Hierarchy (P1) ✅ IMPLEMENTED

**Status:** Implemented in `graph-search.js` with `SYMBOL_KIND_WEIGHTS` applied during post-fusion boost phase.

**Implementation Notes:**
- Weights applied after robustCCFusion to avoid distorting fusion scores
- Higher weights for definition types (class: 1.0, interface: 0.95) vs references (call: 0.15, import: 0.1)
- Combined with intent detection (#5) for context-aware weighting

**Concept:** Apply multipliers based on entity type: class > interface > function > method > variable.

**Research Finding (LSP Specification):**
```javascript
const SYMBOL_KIND_WEIGHTS = {
  // Highest priority - structural definitions
  class: 1.0,
  interface: 0.95,
  struct: 0.95,
  enum: 0.9,

  // High priority - callable definitions
  function: 0.85,
  method: 0.80,
  constructor: 0.75,

  // Medium priority - data definitions
  constant: 0.7,
  property: 0.65,
  field: 0.6,

  // Lower priority - local scope
  variable: 0.4,
  parameter: 0.3,

  // References (not definitions)
  reference: 0.2,
  call: 0.15,
  import: 0.1,
};
```

**Implementation:**
```javascript
function applySymbolKindWeights(results, query) {
  for (const result of results) {
    const typeWeight = SYMBOL_KIND_WEIGHTS[result.type] || 0.5;
    result.score *= typeWeight;
  }
  return results.sort((a, b) => b.score - a.score);
}
```

**Pros:** Simple, fast, addresses entity priority issues
**Cons:** May over-penalize legitimate variable/method searches
**Files to modify:** `graph-search.js:150-200`

---

### Strategy 5: Query Intent Detection (P1 - Zero Latency) ✅ IMPLEMENTED

**Status:** Implemented in `smart-search-v21.js` with `INTENT_PATTERNS` regex matching.

**Implementation Notes:**
- Zero-latency regex-based intent classification (definition/usage/structural/general)
- Intent-aware boost multipliers applied to relevant entity types
- PascalCase detection for likely class/interface queries

**Concept:** Detect if user wants definition vs usage via regex patterns, then boost accordingly.

**Research Finding:** Heuristic-based intent detection achieves high accuracy with <1ms latency.

**Implementation:**
```javascript
const INTENT_PATTERNS = {
  definition: [
    /^(def|define|class|interface|struct|enum|type)\s+/i,
    /(definition|declaration|where\s+is.*defined)/i,
    /^[A-Z][a-zA-Z0-9]*$/,  // PascalCase identifier (likely class/interface)
  ],
  usage: [
    /(uses?|usage|references?|calls?)\s+(of|to)\s+/i,
    /who\s+(calls?|uses?|imports?)/i,
    /(example|how\s+to\s+use)/i,
  ],
  structural: [
    /what\s+(calls?|does)\s+/i,
    /implementations?\s+of/i,
    /subclass(es)?\s+of/i,
  ]
};

function detectIntent(query) {
  for (const pattern of INTENT_PATTERNS.definition) {
    if (pattern.test(query)) return 'definition';
  }
  for (const pattern of INTENT_PATTERNS.usage) {
    if (pattern.test(query)) return 'usage';
  }
  for (const pattern of INTENT_PATTERNS.structural) {
    if (pattern.test(query)) return 'structural';
  }
  return 'general';
}

function applyIntentBoost(results, intent) {
  const INTENT_BOOSTS = {
    definition: { class: 1.5, interface: 1.5, function: 1.3, method: 1.2 },
    definition_mild: { definitionBoost: 1.8, syntaxBoost: 1.5 }, // Updated from 1.5/1.3
    usage: { call: 1.5, reference: 1.4, import: 1.3 },
    structural: { class: 1.2, interface: 1.2 }, // Let structural search handle
    general: { definitionBoost: 1.8, syntaxBoost: 1.8 } // Updated from 1.2/1.0
  };

  const boosts = INTENT_BOOSTS[intent];
  for (const result of results) {
    result.score *= boosts[result.type] || 1.0;
  }
  return results.sort((a, b) => b.score - a.score);
}
```

**Pros:** Zero latency (regex), significant impact for targeted queries
**Cons:** Pattern coverage may miss edge cases
**Files to modify:** `smart-search-v21.js:100-150`

---

### Strategy 6: ~~Identifier Segmentation~~ (DROPPED)

> **DROPPED (2026-01-14):** Trades precision for recall. Users querying `authService` want exactly that, not `auth_service`. FTS5 lexical is for exact lookups; semantic search handles fuzzy queries. Also requires OR logic in FTS5 query builder which we don't have.

**Concept:** Split camelCase/snake_case identifiers for better matching.

**Research Finding (Qdrant):**
> "Divide camel case and snake case names into separate words" is critical for code search.

**Implementation:**
```javascript
function segmentIdentifier(identifier) {
  // Handle snake_case
  let parts = identifier.split('_');

  // Handle camelCase within each part
  const result = [];
  for (const part of parts) {
    // Split on transitions: lowercase->uppercase, letter->digit
    const tokens = part.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)|\d+/g) || [part];
    result.push(...tokens.map(t => t.toLowerCase()));
  }

  return result;
}

// Examples:
// "getUserById" -> ["get", "user", "by", "id"]
// "XMLHttpRequest" -> ["xml", "http", "request"]
// "employee_time_tracking" -> ["employee", "time", "tracking"]

function expandQueryWithSegmentation(query) {
  const tokens = query.split(/\s+/);
  const expanded = [];

  for (const token of tokens) {
    if (looksLikeIdentifier(token)) {
      expanded.push(token); // Keep original
      expanded.push(...segmentIdentifier(token)); // Add segments
    } else {
      expanded.push(token);
    }
  }

  return [...new Set(expanded)].join(' ');
}
```

**Pros:** Zero latency, improves recall for multi-word queries
**Cons:** May increase noise for short queries
**Files to modify:** `smart-search-v21.js:50-100`

---

### Strategy 7: PageRank on Symbol Graph (P2 - Long Term)

**Concept:** Compute PageRank offline on the symbol reference graph, use as ranking signal.

**Research Finding (Sourcegraph):**
> "We ended up running PageRank over an **undirected graph**, as directional edges tended to rank auto-generated files (protobuf codegen) very highly."

**Implementation:**
```javascript
// Offline computation (run during indexing)
async function computePageRank(db) {
  // Build adjacency list from relationships table
  const edges = await db.all(`
    SELECT source_entity_id, target_entity_id
    FROM relationships
    WHERE type IN ('calls', 'imports', 'extends', 'implements', 'references')
  `);

  // Build undirected graph
  const graph = new Map();
  for (const { source_entity_id, target_entity_id } of edges) {
    if (!graph.has(source_entity_id)) graph.set(source_entity_id, new Set());
    if (!graph.has(target_entity_id)) graph.set(target_entity_id, new Set());
    graph.get(source_entity_id).add(target_entity_id);
    graph.get(target_entity_id).add(source_entity_id); // Undirected
  }

  // Power iteration
  const damping = 0.85;
  const iterations = 50;
  const tolerance = 1e-6;

  let ranks = new Map();
  const n = graph.size;
  for (const node of graph.keys()) {
    ranks.set(node, 1.0 / n);
  }

  for (let i = 0; i < iterations; i++) {
    const newRanks = new Map();
    let diff = 0;

    for (const [node, neighbors] of graph) {
      let rank = (1 - damping) / n;
      for (const neighbor of neighbors) {
        rank += damping * (ranks.get(neighbor) / graph.get(neighbor).size);
      }
      newRanks.set(node, rank);
      diff += Math.abs(rank - ranks.get(node));
    }

    ranks = newRanks;
    if (diff < tolerance) break;
  }

  // Store in database
  for (const [entityId, rank] of ranks) {
    await db.run('UPDATE entities SET pagerank = ? WHERE id = ?', [rank, entityId]);
  }
}

// Query-time boost
function applyPageRankBoost(results) {
  for (const result of results) {
    // Logarithmic boost to prevent runaway scores
    result.score *= (1 + Math.log10(1 + result.pagerank * 1000));
  }
  return results.sort((a, b) => b.score - a.score);
}
```

**Pros:** Industry-proven (Sourcegraph, Google), captures code importance
**Cons:** Requires offline computation, schema change
**Files to modify:** `graph-extractor.js`, `graph-search.js`, schema

---

### Strategy 8: ~~Abbreviation Expansion~~ (DROPPED)

> **DROPPED (2026-01-14):** Same precision vs recall tradeoff as #6. Semantic embeddings already capture abbreviation→full-word relationships. Adding OR expansion to FTS5 adds complexity without measurable benefit at 90.5% Success@10.

**Concept:** Expand common code abbreviations at query time.

**Implementation:**
```javascript
const ABBREVIATIONS = {
  'auth': ['authentication', 'authorize', 'authorization'],
  'config': ['configuration', 'configure'],
  'db': ['database'],
  'str': ['string'],
  'btn': ['button'],
  'ctx': ['context'],
  'req': ['request'],
  'res': ['response', 'result'],
  'msg': ['message'],
  'err': ['error'],
  'mgr': ['manager'],
  'svc': ['service'],
  'impl': ['implementation', 'implements'],
  'repo': ['repository'],
  'util': ['utility', 'utilities'],
};

function expandAbbreviations(query) {
  const tokens = query.toLowerCase().split(/\s+/);
  const expanded = [];

  for (const token of tokens) {
    expanded.push(token);
    if (ABBREVIATIONS[token]) {
      expanded.push(...ABBREVIATIONS[token]);
    }
  }

  return [...new Set(expanded)].join(' OR ');
}
```

**Pros:** Zero latency (hash lookup), improves recall for abbreviated queries
**Cons:** May increase false positives
**Files to modify:** `smart-search-v21.js`

---

### Strategy 9: ~~RRF Alpha Tuning~~ (ALREADY COVERED)

> **NOTE:** Already implemented via **Convex Combination (CC) Fusion** (see SEARCH_200X.md).
> CC Fusion outperforms RRF by +7-18% MRR per ACM TOIS 2023:
> - CC Fusion is **score-aware** (preserves magnitude)
> - RRF is **rank-aware only** (loses score information)
>
> **Status:** ✅ Already in production. No action needed.

~~**Concept:** Tune the lexical vs semantic weight for code search.~~

~~**Research Finding:**~~
> ~~"For code search, alpha = 0.3-0.5 (favoring lexical) works best because identifiers are exact matches."~~

---

### Strategy 10: Matryoshka Adaptive Reranking (P3)

> **NOTE:** Basic Matryoshka truncation (1024d → 512d for HNSW) is **already implemented**.
> This strategy refers to **adaptive two-stage reranking** using different embedding dimensions—a distinct concept from basic truncation.

**Concept:** Use Matryoshka embeddings to do two-stage retrieval with adaptive precision:
- **Stage 1:** Fast recall with truncated embeddings (64d) for broad candidate retrieval
- **Stage 2:** Precise rerank with full embeddings (768d) on top-K candidates

This differs from basic truncation by using **dynamic dimension switching** during retrieval.

**Research Finding:**
> "OpenAI's text-embedding-3-large at 256 dims outperforms ada-002 at 1,536 dims."

**Implementation:**
```javascript
// Stage 1: Fast recall with truncated embeddings (64 dims)
const candidates = await hnsw.search(truncate(queryEmbedding, 64), { k: 200 });

// Stage 2: Precise rerank with full embeddings (768 dims)
const topK = candidates.slice(0, 50);
const reranked = await rerankWithFullEmbeddings(queryEmbedding, topK);
```

**Pros:** 4-12x speedup with 85-98% quality retention
**Cons:** Requires model that supports Matryoshka (Voyage, Jina v3/v4, OpenAI v3)
**Files to modify:** `colbert-index.js`, `smart-search-v21.js`

**Consideration:** Given we already have cascaded reranking (FlashRank → Jina/Voyage), evaluate whether this provides additional benefit beyond existing pipeline.

---

### Strategy 11: ~~Qwen3-Reranker-0.6B~~ → GTE ModernBERT INT8 (P1) ✅ IMPLEMENTED

**Original Concept:** Replace or complement FlashRank with Qwen3-Reranker-0.6B.

**What We Built Instead:** GTE ModernBERT INT8 as Stage 2 local reranker.

**Why GTE ModernBERT over Qwen:**
- **Better cross-encoder architecture** - GTE is purpose-built for reranking with query-document pairs
- **Smaller model** - ~150MB INT8 vs 600MB+ for Qwen
- **Proven MTEB scores** - Top-tier reranking performance on standard benchmarks
- **@huggingface/transformers v3 support** - Native ONNX inference, auto-downloads on first use

**Implementation:** See `local-reranker.js`
- Model: `Alibaba-NLP/gte-reranker-modernbert-base` (INT8 quantized)
- Library: `@huggingface/transformers` (auto-downloads ~150MB on first use)
- Inference: Sequential scoring with global ONNX mutex (`onnx-mutex.js`)
- Latency: ~700ms for 50 docs (~14ms/doc), ~15s cold start

**Cascade Priority:**
```
FlashRank TinyBERT (~15ms) → Local ModernBERT (~700ms) → Voyage API → Jina API
```

**Config:** `LOCAL_RERANKER_CONFIG.useLocalReranker = true` (default)

**Result:** 90.5% Success@10 benchmark, FREE local inference, works offline
**Source:** Qwen3-Reranker-0.6B (2026) - siliconflow.com/articles/en/Leading-reranker-for-code-search

---

### Strategy 12: ~~Learned Sparse Retrieval - LSR/LACONIC/SPLADE~~ (DROPPED)

> **DROPPED (2026-01-14):** Same problem as #23 (LTR). Any learned model trained on Sloth (Java/TS) won't generalize to Python/Go/Rust/C#. We need language-agnostic solutions, not learned weights from a specific codebase.

**Concept:** Use learned sparse retrieval models that combine lexical matching (BM25-like) with neural sparse representations, addressing FTS5 limitations at the source.

**Research Finding (arXiv:2601.01684, 2026):**
> "LSR methods, such as LACONIC and SPLADE, combine the efficiency of sparse vector representations with the effectiveness of neural embeddings, offering a balance between performance and computational cost. LACONIC utilizes a two-phase training curriculum to adapt large language models for bidirectional contextualization, achieving state-of-the-art effectiveness with reduced memory usage."

**Implementation:**
```javascript
// Option A: Use SPLADE-like sparse vectors (via transformers.js)
const { pipeline } = require('@xenova/transformers');

let spladeModel = null;

async function initSplade() {
  if (!spladeModel) {
    spladeModel = await pipeline('feature-extraction', 'naver/splade-cocondenser-ensembledistil');
  }
  return spladeModel;
}

async function generateSparseVector(text) {
  const model = await initSplade();
  const output = await model(text, { pooling: 'max' });

  // SPLADE outputs sparse activations over vocabulary
  // Convert to term weights for inverted index
  const sparseVector = {};
  for (let i = 0; i < output.data.length; i++) {
    if (output.data[i] > 0.1) { // Threshold for sparsity
      sparseVector[i] = output.data[i];
    }
  }
  return sparseVector;
}

// Option B: Hybrid with FTS5 (post-processing)
function applySparseBoost(fts5Results, querySparseVector) {
  for (const result of fts5Results) {
    const docSparseVector = result.sparse_vector || {};

    // Compute sparse dot product
    let sparseScore = 0;
    for (const [termId, queryWeight] of Object.entries(querySparseVector)) {
      if (docSparseVector[termId]) {
        sparseScore += queryWeight * docSparseVector[termId];
      }
    }

    // Blend with BM25 score
    result.score = 0.6 * result.score + 0.4 * sparseScore;
  }

  return fts5Results.sort((a, b) => b.score - a.score);
}
```

**Comparison with Strategy #3 (BM25F):**
| Aspect | BM25F (Strategy #3) | LSR/LACONIC (Strategy #12) |
|--------|---------------------|----------------------------|
| Implementation | Post-processing or FTS5 weights | Model integration |
| Power | Heuristic field weighting | Learned contextual weighting |
| Effort | 1 day | 1-2 weeks |
| Latency | +0ms | +0-5ms |
| Impact | +10-15% MRR | +10-20% MRR |

**Expected Impact:** +10-20% MRR improvement, addresses FTS5 root cause
**Effort:** 1-2 weeks (model integration)
**Latency:** +0-5ms (can be faster than BM25F post-processing)
**Priority:** P1 (alternative to Strategy #3)
**Source:** LACONIC (arXiv:2601.01684, 2026), SPLADE variants (Wikipedia: Learned sparse retrieval)

---

### ~~Strategy 13: CROSS-JEM - Joint Efficient Modeling~~ ❌ NOT FEASIBLE

> **Status: NOT FEASIBLE (2026-01-14)**
> - Requires CROSS-JEM trained model (MS-MARCO outputs single CLS score, can't produce N scores)
> - WASM batching benchmark: 10 docs 0% speedup, 20 docs -3.3%, 50 docs -2.9% (slower!)
> - Would need GPU/WebGPU to see batching benefits

**Original Concept:** Use CROSS-JEM to jointly score multiple query-document pairs in a single forward pass, achieving 4x lower latency than standard cross-encoders.

**Research Finding (arXiv:2409.09795, 2024, still SOTA in 2026):**
> "CROSS-JEM introduces a novel approach that enables transformer-based models to jointly score multiple items for a query, maximizing parameter utilization. By leveraging redundancies and token overlaps, it achieves state-of-the-art accuracy with over 4x lower ranking latency compared to standard cross-encoders."

**Implementation:**
```javascript
// CROSS-JEM batches multiple documents with a single query
async function crossJemRerank(query, documents) {
  // Instead of N forward passes (one per document), do 1 forward pass
  // by encoding [CLS] query [SEP] doc1 [SEP] doc2 [SEP] ... docN [SEP]

  const batchInput = formatCrossJemInput(query, documents);

  // Single forward pass scores all documents
  const scores = await crossJemModel.score(batchInput);

  return documents
    .map((doc, i) => ({ ...doc, score: scores[i] }))
    .sort((a, b) => b.score - a.score);
}

function formatCrossJemInput(query, documents) {
  // CROSS-JEM specific format: interleaved query-doc pairs
  // with shared query encoding across all documents
  return {
    query: query,
    documents: documents.map(d => d.content),
    max_length: 512 // Per document
  };
}

// Integration into cascaded reranking
async function cascadedRerank(query, candidates) {
  // Stage 1: FlashRank (fast, local) -> top 100
  const stage1 = await flashrank.rerank(query, candidates, 100);

  // Stage 2: CROSS-JEM (batched, efficient) -> top 20
  const stage2 = await crossJemRerank(query, stage1.slice(0, 50));

  // Stage 3: Voyage/Jina (if needed) -> top 10
  if (needsDeepRerank(stage2)) {
    return await voyageRerank(query, stage2.slice(0, 20));
  }

  return stage2.slice(0, 10);
}
```

**Expected Impact:** -50-75% reranking latency (4x faster), maintains accuracy
**Effort:** 2-3 days (model integration)
**Latency:** -50-75% reranking time (optimization)
**Priority:** P2 (reranking optimization)
**Source:** CROSS-JEM (arXiv:2409.09795, 2024, still SOTA in 2026)

---

### Strategy 14: Early Termination for HNSW Vector Search ⏸️ LOW IMPACT

> **Status: LOW IMPACT (2026-01-14)**
> - USearch HNSW already <1ms (50-500μs typical)
> - USearch doesn't expose iterator API for streaming results
> - Early termination would save <0.5ms - minimal impact vs other bottlenecks
> - Demoted to P3

**Concept:** Implement early termination in HNSW search to stop k-NN search early when confidence threshold is met.

**Research Finding (Apache Solr PatienceKnnVectorQuery, sease.io 2025):**
> "PatienceKnnVectorQuery introduces early termination strategies for approximate k-NN searches, allowing searches to stop earlier under specific conditions, reducing latency while maintaining accuracy."

**Implementation:**
```javascript
// Modified HNSW search with early termination
class PatienceHnswIndex {
  constructor(index, options = {}) {
    this.index = index;
    this.confidenceThreshold = options.confidenceThreshold || 0.95;
    this.patienceWindow = options.patienceWindow || 10; // Stop if no improvement in 10 candidates
  }

  async searchWithEarlyExit(queryVector, k = 10) {
    const results = [];
    let bestScore = -Infinity;
    let patienceCounter = 0;

    // Use HNSW's internal iterator if available, otherwise custom search
    const candidates = this.index.searchIterator(queryVector, k * 3);

    for await (const candidate of candidates) {
      results.push(candidate);

      // Check early termination conditions
      if (candidate.score > bestScore) {
        bestScore = candidate.score;
        patienceCounter = 0;
      } else {
        patienceCounter++;
      }

      // Condition 1: Top-k all exceed confidence threshold
      if (results.length >= k) {
        const topKScores = results.slice(0, k).map(r => r.score);
        if (Math.min(...topKScores) >= this.confidenceThreshold) {
          break; // High confidence in top-k
        }
      }

      // Condition 2: Patience exhausted (no score improvement)
      if (patienceCounter >= this.patienceWindow && results.length >= k) {
        break; // Unlikely to find better candidates
      }
    }

    return results.slice(0, k);
  }
}

// Integration
const patienceHnsw = new PatienceHnswIndex(hnswIndex, {
  confidenceThreshold: 0.92, // Match our early exit threshold
  patienceWindow: 15
});
```

**Expected Impact:** -20-40% vector search latency, maintains accuracy
**Effort:** 1 day (HNSW library integration)
**Latency:** -20-40% vector search time (optimization)
**Priority:** P2 (latency optimization)
**Source:** PatienceKnnVectorQuery (Apache Solr, 2025) - sease.io/2025/12/faster-vector-search-early-termination-strategy

---

### Strategy 15: Rational Retrieval Acts (RRA) (P2 - Dynamic Score Adjustment)

**Concept:** Dynamically modulate token-document interactions by considering the influence of other documents in the dataset, improving contrast in document representations.

**Research Finding (arXiv:2505.03676, 2025):**
> "Rational Retrieval Acts can dynamically adjust token-document interactions by considering the influence of other documents in the dataset, leading to improved contrast in document representations and enhanced retrieval accuracy."

**Implementation:**
```javascript
// Enhance Strategy #1 (Post-FTS5 Definition Boost) with RRA
function applyRationalRetrievalActs(results, query) {
  // Step 1: Compute corpus statistics for this result set
  const corpusStats = computeCorpusStats(results);

  // Step 2: Adjust scores based on document distribution
  for (const result of results) {
    const rawBoost = computeRawBoost(result, query); // From Strategy #1

    // RRA adjustment: consider how this document compares to others
    const documentRarity = computeDocumentRarity(result, corpusStats);
    const contrastFactor = computeContrastFactor(result, results);

    // Dynamic boost instead of static multiplier
    const rraBoost = rawBoost * (1 + documentRarity * contrastFactor);
    result.score *= rraBoost;
  }

  return results.sort((a, b) => b.score - a.score);
}

function computeCorpusStats(results) {
  return {
    avgScore: results.reduce((a, b) => a + b.score, 0) / results.length,
    scoreStdDev: computeStdDev(results.map(r => r.score)),
    typeDistribution: countByType(results),
    fileDistribution: countByFile(results)
  };
}

function computeDocumentRarity(doc, stats) {
  // Rare entity types get higher boost (e.g., interface among many classes)
  const typeCount = stats.typeDistribution[doc.type] || 1;
  const totalTypes = Object.values(stats.typeDistribution).reduce((a, b) => a + b, 0);
  return Math.log(totalTypes / typeCount); // IDF-like for types
}

function computeContrastFactor(doc, results) {
  // How different is this document from others?
  // Higher contrast = more distinctive = higher boost
  const avgSimilarity = results
    .filter(r => r.id !== doc.id)
    .reduce((sum, r) => sum + computeSimilarity(doc, r), 0) / (results.length - 1);

  return 1 - avgSimilarity; // Low similarity = high contrast
}
```

**Expected Impact:** +5-10% MRR improvement through better score calibration
**Effort:** 2-3 days (algorithmic implementation)
**Latency:** +1-3ms (lightweight computation)
**Priority:** P2 (enhancement to Strategy #1)
**Source:** Rational Retrieval Acts (arXiv:2505.03676, 2025)

---

### Strategy 16: Multivector Reranking (P2 - Enhanced Semantic Representations)

**Concept:** Use multiple vector representations per document (name vector, signature vector, doc vector) instead of single vector, capturing complex semantic relationships.

**Research Finding (arXiv:2601.05200, 2026):**
> "Multivector reranking utilizes multiple vector representations per document to capture complex semantic relationships. This approach has demonstrated substantial speedups over traditional multivector retrieval systems while maintaining or improving retrieval quality."

**Implementation:**
```javascript
// Schema changes: store multiple vectors per entity
// ALTER TABLE entities ADD COLUMN name_embedding BLOB;
// ALTER TABLE entities ADD COLUMN signature_embedding BLOB;
// ALTER TABLE entities ADD COLUMN doc_embedding BLOB;

// Index all three vector types
async function indexEntityMultivector(entity) {
  const nameEmb = await embed(entity.name);
  const sigEmb = entity.signature ? await embed(entity.signature) : null;
  const docEmb = entity.doc_comment ? await embed(entity.doc_comment) : null;

  await db.run(`
    UPDATE entities SET
      name_embedding = ?,
      signature_embedding = ?,
      doc_embedding = ?
    WHERE id = ?
  `, [nameEmb, sigEmb, docEmb, entity.id]);

  // Add to HNSW indexes
  await nameHnsw.add(entity.id, nameEmb);
  if (sigEmb) await signatureHnsw.add(entity.id, sigEmb);
  if (docEmb) await docHnsw.add(entity.id, docEmb);
}

// Search across all vectors, combine scores
async function multivectorSearch(query, options = {}) {
  const queryEmb = await embed(query);

  // Search all three indexes in parallel
  const [nameResults, sigResults, docResults] = await Promise.all([
    nameHnsw.search(queryEmb, options.k * 2),
    signatureHnsw.search(queryEmb, options.k * 2),
    docHnsw.search(queryEmb, options.k * 2)
  ]);

  // Combine with weighted fusion
  const VECTOR_WEIGHTS = {
    name: 0.5,       // Most important for "find X" queries
    signature: 0.3,  // Important for function searches
    doc: 0.2         // Context/description matching
  };

  return fuseMultivectorResults(
    { name: nameResults, signature: sigResults, doc: docResults },
    VECTOR_WEIGHTS,
    options.k
  );
}

function fuseMultivectorResults(resultsByVector, weights, k) {
  const combinedScores = new Map();

  for (const [vectorType, results] of Object.entries(resultsByVector)) {
    const weight = weights[vectorType];
    for (const result of results) {
      const current = combinedScores.get(result.id) || { id: result.id, score: 0, vectors: {} };
      current.score += result.score * weight;
      current.vectors[vectorType] = result.score;
      combinedScores.set(result.id, current);
    }
  }

  return [...combinedScores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
```

**Expected Impact:** +8-15% MRR improvement through better semantic matching
**Effort:** 1 week (index changes, storage)
**Latency:** +5-10ms (multiple vector lookups, parallelized)
**Priority:** P2 (enhancement to semantic search)
**Source:** Multivector Reranking (arXiv:2601.05200, 2026)

---

### Strategy 17: BlockRank - Blockwise In-Context Ranking (P3 - Attention Optimization)

**Concept:** Adapt attention mechanism within LLMs to focus on critical parts of the input during ranking, improving efficiency and reducing computational overhead.

**Research Finding (arXiv:2508.02455, 2025):**
> "BlockRank adapts the attention mechanism within large language models to focus on critical parts of the input during ranking, improving efficiency and reducing computational power. This method scales to large document sets while maintaining accuracy."

**Implementation:**
```javascript
// BlockRank focuses attention on definition-relevant tokens
function applyBlockRankAttention(query, document) {
  // Identify "blocks" in the document
  const blocks = segmentIntoBlocks(document);

  // Score each block's relevance to query
  const blockScores = blocks.map(block => ({
    block,
    relevance: computeBlockRelevance(query, block)
  }));

  // Focus on high-relevance blocks for final scoring
  const topBlocks = blockScores
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3); // Top 3 blocks

  return combineBlockScores(topBlocks);
}

function segmentIntoBlocks(document) {
  // For code: definition signature, body, doc comment
  return {
    definition: extractDefinitionBlock(document),
    signature: extractSignatureBlock(document),
    body: extractBodyBlock(document),
    comment: extractCommentBlock(document)
  };
}

function computeBlockRelevance(query, block) {
  // Definition blocks get attention boost for definition queries
  if (isDefinitionQuery(query)) {
    return {
      definition: 2.0,
      signature: 1.5,
      body: 0.5,
      comment: 1.0
    }[block.type] * block.baseScore;
  }
  return block.baseScore;
}
```

**Expected Impact:** +3-5% MRR improvement, -10-20% computation
**Effort:** 3-4 days (model modification)
**Latency:** +0-5ms (attention optimization can be faster)
**Priority:** P3 (nice-to-have optimization)
**Source:** BlockRank (arXiv:2508.02455, 2025)

---

### Strategy 18: Partitioned Elias-Fano (PEF) Indexes (P3 - Compression Optimization)

**Concept:** Use PEF indexes for compressed data structures in inverted indexes, achieving superior compression without sacrificing query speed.

**Research Finding (Wikipedia: Partitioned Elias-Fano):**
> "Partitioned Elias-Fano indexes are compressed data structures designed for efficiently representing sorted integer sequences, notably inverted indexes. They enhance classic Elias-Fano encoding by dividing sequences into partitions to leverage local clustering, achieving superior compression without sacrificing query speed."

**Implementation:**
```javascript
// PEF encoding for posting lists
class PartitionedEliasFanoIndex {
  constructor(options = {}) {
    this.partitionSize = options.partitionSize || 256;
    this.partitions = new Map();
  }

  // Encode a posting list with PEF
  encode(term, postings) {
    // Sort postings by document ID
    const sorted = [...postings].sort((a, b) => a.docId - b.docId);

    // Partition into chunks
    const partitions = [];
    for (let i = 0; i < sorted.length; i += this.partitionSize) {
      const partition = sorted.slice(i, i + this.partitionSize);
      partitions.push(this.encodePartition(partition));
    }

    this.partitions.set(term, partitions);
  }

  encodePartition(postings) {
    // Elias-Fano encoding within partition
    const docIds = postings.map(p => p.docId);
    const firstId = docIds[0];

    // Delta encode relative to first ID
    const deltas = docIds.map((id, i) => i === 0 ? 0 : id - docIds[i - 1]);

    // Elias-Fano encoding of deltas
    return {
      firstId,
      deltas: this.eliasFanoEncode(deltas),
      scores: postings.map(p => p.score)
    };
  }

  eliasFanoEncode(values) {
    // Standard Elias-Fano: split each value into high and low bits
    const maxVal = Math.max(...values);
    const lowBits = Math.ceil(Math.log2(maxVal / values.length));

    const lows = values.map(v => v & ((1 << lowBits) - 1));
    const highs = values.map(v => v >> lowBits);

    return { lowBits, lows, highs: this.encodeUnary(highs) };
  }

  // Decode for search
  decode(term) {
    const partitions = this.partitions.get(term);
    if (!partitions) return [];

    return partitions.flatMap(p => this.decodePartition(p));
  }
}

// Integration with FTS5
// Replace default posting list storage with PEF-compressed version
```

**Expected Impact:** -30-50% memory footprint, maintains or improves query speed
**Effort:** 3-4 days (indexing changes)
**Latency:** +0ms (may be faster due to cache effects)
**Priority:** P3 (infrastructure optimization)
**Source:** Partitioned Elias-Fano Indexes (Wikipedia)

---

### Strategy 19: Definition Syntax Boost (FTS5 Phrase/NEAR Queries) (P0 - Surgical Candidate Surfacing) ✅ IMPLEMENTED

**Status:** Implemented in `graph-search.js` with definition-syntax phrase matching.

**Implementation Notes:**
- Targets definition syntax patterns: `"class <Q>"`, `"interface <Q>"`, `"enum <Q>"`
- Merged with priority alongside standard FTS5 results
- Directly addresses "31 implementations outrank the interface" failure pattern

**Concept:** Add a second lexical query that explicitly targets definition syntax:
- Java: `"class <Q>"`, `"interface <Q>"`, `"enum <Q>"`, `"<Q> implements"` (as phrases / NEAR)
- JS/TS: `"class <Q>"`, `"function <Q>"`, `"export class <Q>"`, `"export function <Q>"`

Run alongside the existing FTS5 query and **merge with priority** (dedup by entity id).

**Why it works for our failures:**
- Implementations contain `<Q> implements ...` and usages contain `new <Q>(...)`, but the definition contains highly specific phrases like `interface <Q>` / `class <Q>`.
- This directly attacks the “31 implementations outrank the interface” pattern without requiring full schema changes.

**Pros:** Very low effort, fixes the highest-frequency ranking failures quickly.
**Cons:** Requires careful sanitization + gating (only run for identifier-like queries or when intent=definition).

---

### Strategy 20: Structural Position Boost (start_line priors) (P1 - Zero-cost, High Precision) ✅ IMPLEMENTED

**Status:** Implemented in `graph-search.js` with position-based prior calculation.

**Implementation Notes:**
- Position prior formula: `1 / (1 + start_line / 50)` (clamped)
- Applied to definition-like types (class/interface/enum/function)
- Gated by intent detection to avoid over-boosting for usage queries

**Concept:** Boost entities that are likely definitions using their `start_line` and `type`.

Rationale: In most codebases, primary definitions appear early (imports → type decls → members). Usages (calls) appear deeper in files and are less likely to be the sought “definition”.

**Example heuristic (plan-level):**
- `positionPrior = 1 / (1 + start_line / 50)` (clamped)
- Final score multiplier: `score *= (1 + 0.5 * positionPrior)` for definition-like types (class/interface/enum/function)

**Pros:** Uses existing fields, no DB changes, almost no risk.
**Cons:** Not universally true for all repos; must be gated by intent or identifier-likeness.

---

### Strategy 21: MMR Diversity (Maximal Marginal Relevance) (P1 - Prevent Definition Suppression) ✅ IMPLEMENTED

**Status:** Implemented in `mmr.js` with intent-aware λ tuning.

**Implementation Notes:**
- Replaced flood control with MMR (Maximal Marginal Relevance) for principled diversity
- λ=0.9 for code search (relevance-heavy, slight diversity push)
- Intent-aware λ tuning: lexical=0.95, semantic=0.85, hybrid=0.9
- Results improved from 88.3% to **90.5% Success@10**

**MMR Formula:**
```
MMR_Score = λ × Relevance(doc) - (1-λ) × max(Similarity(doc, selected_docs))
```

Where:
- `λ` (lambda): Balance between relevance and diversity (0-1)
- `Relevance(doc)`: Original score from fusion pipeline
- `max(Similarity(...))`: Maximum similarity to any already-selected document

**Intent-Aware λ Values:**
| Search Mode | λ Value | Rationale |
|-------------|---------|-----------|
| Lexical | 0.95 | Exact matches need minimal diversity push |
| Semantic | 0.85 | Conceptual queries benefit from more diversity |
| Hybrid | 0.90 | Balanced default for mixed queries |

**Concept:** Prevent top‑K from being dominated by repetitive entity kinds (e.g., dozens of implementations, or dozens of methods in same file) using principled diversity scoring rather than hard caps.

**Why MMR over Flood Control:**
- **Principled:** Mathematical formulation instead of arbitrary caps
- **Adaptive:** Diversity pressure scales with actual similarity, not heuristics
- **Tunable:** Single λ parameter instead of multiple per-file/per-kind thresholds
- **Proven:** Well-established technique from information retrieval (Carbonell & Goldstein, 1998)

**Pros:** Smooth diversity without hard cutoffs; mathematically grounded; single tunable parameter.
**Cons:** Requires similarity computation between result pairs (mitigated by early termination).

---

### Strategy 22: Neighborhood Locality Boost (Active-file prior) (P2 - Contextual Relevance When Available)

**Concept:** If the client provides an “active file path” (editor context), boost results in:
- same directory
- sibling directories
- same module/package

**Note:** This is only applicable when the search surface can provide context (e.g., editor integration). CLI-only mode may not have this signal.

**Pros:** Huge practical value for real developer workflows, zero compute cost.
**Cons:** Not available for all query surfaces; must be optional.

---

### Strategy 23: ~~Lightweight LTR Mid-Layer (LambdaMART/XGBoost features)~~ (DROPPED)

> **DROPPED (2026-01-14):** Training data would come from Sloth (Java/TS), making the model language-biased. Current hardcoded weights are language-agnostic and work on any codebase. At 90.5% Success@10, the complexity isn't justified.

**Concept:** Add a fast, local learning-to-rank model over top‑K lexical candidates (or over merged lexical+semantic candidates) using features we already compute or can compute cheaply.

**Why this helps (beyond heuristics):**
- Avoids brittle multiplier tuning across many strategies.
- Reduces regressions when adding new signals (graph priors, summary fields, reranker scores).
- Learns best weights for identifier vs conceptual queries automatically.

**Candidate feature set (examples):**
- Lexical: BM25 score, trigram-vs-porter source, exact name match, exact filename match, phrase-hit flags (from Strategy #19)
- Structural: entity type, start_line prior (Strategy #20), package match, parent_class match
- Graph: implementations_count, references_count, degree, pagerank (when available)
- Semantic: embedding similarity, ColBERT score (when run)
- Rerank: FlashRank/Jina/Voyage score (when run)

**Pros:** Strong accuracy gains with ~1–5ms overhead; easiest path to “best ranking”.
**Cons:** Needs training data + evaluation harness discipline (but we already have evaluation sets).

---

### Strategy 24: ColBERT Early-Exit + Upper-Bound Pruning (P2 - Make Late Interaction Cheaper)

**Concept:** Current ColBERT MaxSim implementation is brute-force over all query tokens × doc tokens. Add:
- **Top‑k cutoff pruning:** as we compute MaxSim sum, stop scoring a document early if it cannot beat the current k‑th best.
- **Token pruning:** limit doc tokens more aggressively for low-value candidates (already has `maxTokensPerDoc`, but can adapt by candidate score).
- **Upper-bound approximations:** cheap proxy (e.g., pooled embedding similarity) to skip ColBERT entirely when it’s unlikely to help.

**Pros:** Preserves quality but reduces tail latency; enables running ColBERT more often if desired.
**Cons:** More engineering complexity; must be tested carefully to avoid false negatives.

---

## Implementation Roadmap

### Phase 1: Quick Wins (Week 1) - Target: 92% Success@10 ✅ COMPLETED

| Day | Task | Strategy | Expected Impact | Status |
|-----|------|----------|-----------------|--------|
| 1 | Add definition syntax phrase/NEAR boosts + post-FTS5 definition boost | #19 + #1 | Fix "impls outrank def" quickly | ✅ Done |
| 2 | Implement two-pass definition-first search | #2 | Guarantee definition in top results | ✅ Done |
| 3 | Add symbol kind hierarchy + structural position priors | #4 + #20 | Fix method-vs-class ordering | ✅ Done |
| 4 | Add query intent detection + flood-control clustering/caps | #5 + #21 | Prevent definition suppression in top10 | ✅ Done |
| 5 | Testing & tuning | Phase 1 | Stabilize + prevent regressions | ✅ Done |

**Phase 1 Implementation Summary (2026-01-14):**
- `robustCCFusion()` with quantile normalization for fair score combination
- `skipBoosts` parameter ensures boosts don't distort fusion weights
- Post-fusion boost application preserves ranking integrity
- RRF fallback when semantic score spread < 0.01 (tight clustering)
- **MMR diversity** (`mmr.js`) replaces flood control with principled diversity scoring
- **Intent-aware λ**: lexical=0.95, semantic=0.85, hybrid=0.90
- **Updated boosts**: `definition_mild` (1.8, 1.5), `general` (1.8, 1.8)
- **Result: 90.5% Success@10** (up from 88.3% baseline)

### Phase 2: Architectural (Week 2-3) - Target: 95% Success@10

| Task | Strategy | Expected Impact | Status |
|------|----------|-----------------|--------|
| Qwen3-Reranker-0.6B integration | #11 | +5-10% rerank quality | Planned |
| ~~CROSS-JEM joint scoring~~ | ~~#13~~ | ~~-50% rerank latency~~ | ❌ NOT_FEASIBLE |
| ~~Early termination for HNSW~~ | ~~#14~~ | ~~-20-40% vector latency~~ | ⏸️ LOW_IMPACT |

### Phase 3: Advanced (Week 4+) - Target: 97%+ Success@10

| Task | Strategy | Expected Impact |
|------|----------|-----------------|
| PageRank on symbol graph | #7 | +8-12% MRR |
| Rational Retrieval Acts | #15 | +5-10% MRR |
| Multivector reranking | #16 | +8-15% MRR |
| Matryoshka adaptive reranking | #10 | -50% rerank latency |
| BlockRank attention | #17 | +3-5% MRR |
| PEF index compression | #18 | -30-50% memory |
| Neighborhood locality boost (editor context) | #22 | Better “working set” relevance |
| ColBERT early-exit pruning | #24 | Lower tail latency / more frequent ColBERT |

---

## Expected Results

### Before (Baseline)

| Metric | Value |
|--------|-------|
| Success@10 | 88.3% (362/410) |
| MRR@10 | 0.8902 |
| Ranking failures | 12 |
| P50 latency | ~45ms |

### After Phase 1 ✅ ACHIEVED

| Metric | Value | Change |
|--------|-------|--------|
| Success@10 | **90.5%** (371/410) | **+2.2%** |
| MRR@10 | ~0.91 | +0.02 |
| Ranking failures | ~5 | -7 |
| P50 latency | ~47ms | +2ms |

**Key Phase 1 Improvements:**
- MMR diversity (λ=0.9) replaced flood control for principled diversity
- Updated boost values: `definition_mild` (1.5→1.8, 1.3→1.5), `general` (1.2→1.8, 1.0→1.8)
- Intent-aware λ tuning for search modes

### After Phase 2

| Metric | Value | Change |
|--------|-------|--------|
| Success@10 | ~95% (390/410) | +7% total |
| MRR@10 | ~0.94 | +0.05 total |
| Ranking failures | ~2 | -10 |
| P50 latency | ~40ms | -5ms (CROSS-JEM + Early Term) |

### After Phase 3

| Metric | Value | Change |
|--------|-------|--------|
| Success@10 | ~97% (398/410) | +9% total |
| MRR@10 | ~0.96 | +0.07 total |
| Ranking failures | ~1 | -11 |
| P50 latency | ~35ms | -10ms (cumulative optimizations) |
| Memory footprint | -30-40% | PEF compression |

---

## Appendix: Research Sources

### BM25 & Fusion
- [Sourcegraph BM25F Implementation](https://sourcegraph.com/blog/keeping-it-boring-and-relevant-with-bm25f)
- [OpenSearch Hybrid Search Best Practices](https://opensearch.org/blog/building-effective-hybrid-search-in-opensearch)
- [Trotman et al. - BM25 Variants (2014)](https://www.cs.otago.ac.nz/homepages/andrew/papers/2014-2.pdf)
- [Convex Combination Fusion - ACM TOIS 2023](https://dl.acm.org/doi/10.1145/3596512)

### Definition-Aware Ranking
- [GitHub Code Search Architecture](https://github.blog/engineering/architecture-optimization/the-technology-behind-githubs-new-code-search/)
- [Sourcegraph PageRank Implementation](https://sourcegraph.com/blog/ranking-in-a-week)
- [Zoekt ctags Boosting](https://gerrit.googlesource.com/zoekt/+/refs/heads/master/doc/faq.md)

### Efficient Reranking
- [WARP - 41x Faster Late Interaction (SIGIR '25)](https://arxiv.org/pdf/2501.17788)
- [ColBERTv2/PLAID](https://arxiv.org/abs/2205.09707)
- [FlashRank](https://github.com/PrithivirajDamodaran/FlashRank)
- [Matryoshka Embeddings](https://huggingface.co/blog/matryoshka)

### Learning-to-Rank
- [XGBoost LTR Documentation](https://xgboost.readthedocs.io/en/latest/tutorials/learning_to_rank.html)
- [LambdaMART Explained](https://www.shaped.ai/blog/lambdamart-explained)

### Query Understanding
- [Identifier Segmentation (Guerrouj 2013)](https://publications.polymtl.ca/1203/1/2013_LatifaGuerrouj.pdf)
- [Query Intent Classification](https://arxiv.org/pdf/2110.04640)

### 2026 SOTA Techniques (NEW)
- [Qwen3-Reranker-0.6B (2026)](https://siliconflow.com/articles/en/Leading-reranker-for-code-search) - Code-specific reranker
- [LACONIC (arXiv:2601.01684, 2026)](https://arxiv.org/abs/2601.01684) - Learned sparse retrieval
- [SPLADE Variants](https://en.wikipedia.org/wiki/Learned_sparse_retrieval) - Neural sparse representations
- [CROSS-JEM (arXiv:2409.09795, 2024)](https://arxiv.org/abs/2409.09795) - Joint efficient scoring
- [PatienceKnnVectorQuery (Sease 2025)](https://sease.io/2025/12/faster-vector-search-early-termination-strategy) - HNSW early termination
- [Rational Retrieval Acts (arXiv:2505.03676, 2025)](https://arxiv.org/abs/2505.03676) - Dynamic score adjustment
- [Multivector Reranking (arXiv:2601.05200, 2026)](https://arxiv.org/abs/2601.05200) - Multiple vector representations
- [BlockRank (arXiv:2508.02455, 2025)](https://arxiv.org/abs/2508.02455) - Blockwise attention optimization
- [Partitioned Elias-Fano Indexes](https://en.wikipedia.org/wiki/Partitioned_Elias-Fano) - Index compression

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-12 | Prioritize Strategy #1 & #2 | Highest impact-to-effort ratio, fixes all 12 ranking issues |
| 2026-01-12 | Use undirected PageRank | Sourcegraph's finding: directed edges over-rank generated code |
| 2026-01-12 | Alpha = 0.4 for RRF | Code search favors lexical for identifiers |
| 2026-01-12 | Skip LLM rewriting | Latency budget too tight (<50ms), cache hit rate uncertain |
| 2026-01-13 | Mark Strategy #9 as covered | CC Fusion already implements superior fusion (+7-18% MRR over RRF) |
| 2026-01-13 | Clarify Strategy #10 scope | Distinguish adaptive reranking from basic truncation (already done) |
| 2026-01-13 | Add Strategies #11-18 | 2026 SOTA techniques for accuracy improvements under latency constraints |
| 2026-01-13 | Prefer LSR over BM25F | Strategy #12 addresses root cause; #3 is fallback if LSR too complex |
| 2026-01-13 | Add Strategies #19-24 | Fill remaining low-latency gaps: definition-phrase targeting, position priors, flood-control, LTR calibration, and cheaper ColBERT |
| 2026-01-14 | Phase 1 complete | Implemented #1, #2, #4, #5, #19, #20, #21 with robustCCFusion + skipBoosts pattern |
| 2026-01-14 | RRF fallback for tight clusters | When semantic score spread < 0.01, fall back to RRF to avoid CC distortion |
| 2026-01-14 | Post-fusion boost application | Boosts applied AFTER fusion to preserve fair lexical/semantic blending |
| 2026-01-14 | Strategy #21: Flood Control → MMR | Replaced hard caps with MMR (Maximal Marginal Relevance) for principled diversity |
| 2026-01-14 | MMR λ=0.9 default | Code search is relevance-heavy; slight diversity push prevents flooding |
| 2026-01-14 | Intent-aware λ tuning | lexical=0.95, semantic=0.85, hybrid=0.90 for mode-specific optimization |
| 2026-01-14 | Boost value updates | definition_mild: 1.5→1.8, 1.3→1.5; general: 1.2→1.8, 1.0→1.8 |
| 2026-01-14 | Phase 1 results: 90.5% Success@10 | Improved from 88.3% baseline (+2.2%) with MMR + updated boosts |
| 2026-01-14 | Drop Strategy #23 (LTR) | Training data would be language-biased (Java/TS); hardcoded weights are language-agnostic and sufficient at 90.5% |
| 2026-01-14 | Drop Strategy #6 (Identifier Segmentation) | Hurts precision for exact lookups; semantic search already handles fuzzy queries; no OR logic in FTS5 query builder |
| 2026-01-14 | Drop Strategy #8 (Abbreviation Expansion) | Hurts precision for exact lookups; semantic search already handles synonyms/abbreviations; adds complexity without clear benefit |
| 2026-01-14 | Drop Strategy #3 (BM25F) | Redundant with post-fusion boosts; skipBoosts + post-fusion pattern achieves same goal; both are language-agnostic |
| 2026-01-14 | Drop Strategy #12 (LSR/SPLADE) | Same problem as #23 - learned models trained on Java/TS won't generalize to other languages |
| 2026-01-14 | FlashRank init() bug fixed | Moved init() before if(this.pipeline) check; was causing silent initialization failures |
| 2026-01-14 | FlashRank score semantics fixed | Changed to feature-extraction with CLS pooling; thresholds calibrated for logit space |
| 2026-01-14 | Int8 cosine similarity fixed | Fixed floatToInt8 normalization; renamed int8DotProduct → int8CosineSimilarity; added missing vector handling |
| 2026-01-14 | MMR diversification completed | Replaced flood control with principled MMR; λ=0.9 default; achieved 90.5% Success@10 |

---

## Next Steps

~~1. **Review this plan** with stakeholders~~ ✅ Done
~~2. **Implement Strategy #19** (definition syntax phrase/NEAR boosts) + **#1** (post-FTS5 boosts)~~ ✅ Done
~~3. **Run evaluation** to validate impact on the 12 ranking failures~~ ✅ Done
~~4. **Proceed with Strategy #2** (two-pass definition-first) to guarantee definition visibility~~ ✅ Done
~~5. **Add Strategy #20/#21** with intent gating (#5) to prevent regressions~~ ✅ Done

**Phase 2 Next Steps:**
1. **Run full evaluation harness** to measure Phase 1 impact on Success@10 and MRR
2. **Evaluate Qwen3-Reranker-0.6B (#11)** for code-specific reranking improvement
3. ~~**Implement #13 + #14**~~ → **NOT FEASIBLE** (CROSS-JEM needs special model; HNSW already <1ms)

**Revised Phase 2 Focus (2026-01-14):**
- #11 Qwen3-Reranker-0.6B remains viable (+5-10% rerank quality)
- Consider TinyBERT-L2-v2 switch (7x faster: 6ms vs 42ms per 10 docs, same accuracy)
- Embedding caching already implemented (SemanticCache)

---

## Strategy Dependencies & Sequencing

```
Phase 1 (Quick Wins):
#19 + #1 → #2 → (#4 + #20) → (#5 + #21)

Phase 2 (Architectural):
#11 (Qwen3 reranker - independent)
#13, #14 (reranking/latency optimizations, can parallel)

Phase 3 (Advanced):
#7 (requires #1, #2 foundation)
#15 (enhances #1)
#16 (requires semantic search foundation)
#24 (ColBERT optimization; can be done any time ColBERT is enabled)
#22 (editor-context dependent)
#10, #17, #18 (independent optimizations)
```

---

## Remove / Supersede / Do-Not-Add (to keep the plan maximally accurate + low overhead)

### Remove / Supersede (already handled)

- **Strategy #9 (RRF Alpha Tuning)**: **Do not implement**. It is already superseded by CC Fusion (production).
- **Strategy #10 (Matryoshka Adaptive Reranking)**: keep, but treat as **optional**. Basic truncation is already done; only pursue if it measurably improves p95/p99 without quality loss beyond our existing cascaded reranking.

### Do-Not-Add (unless requirements change)

- **LLM listwise reranking / multi-turn "agent" ranking**: great accuracy, but violates the "blazing fast" constraint and introduces external cost/latency variance. If ever needed, gate behind an explicit `--slow-best` mode.
- **Engagement-trained pre-ranking (e.g., InteractRank-style)**: requires reliable click/interaction logs. We don't have this data.
- **Generic SEO/GEO/AEO techniques**: not applicable to codebase search ranking.
- **Strategy #23 (LambdaMART/XGBoost LTR)**: Dropped. Training data would come from Sloth (Java/TS), making the model language-biased. Current hardcoded weights are language-agnostic and work on any codebase (Python, Go, Rust, C#). At 90.5% Success@10, diminishing returns don't justify the complexity of a learned ranking model.
- **Strategy #6 (Identifier Segmentation)**: Dropped. Trades precision for recall - users querying `authService` want exactly that, not `auth_service`. FTS5 lexical is for exact lookups; semantic search handles fuzzy/conceptual queries. Also requires OR logic in FTS5 query builder which we don't have.
- **Strategy #8 (Abbreviation Expansion)**: Dropped. Same precision vs recall tradeoff as #6. Semantic embeddings already capture abbreviation→full-word relationships. Adding OR expansion to FTS5 adds complexity without measurable benefit at 90.5% Success@10.
- **Strategy #3 (BM25F Field Weighting)**: Dropped. Redundant with post-fusion boosts. Our `skipBoosts` + post-fusion pattern already prioritizes name matches over doc_comment mentions. BM25F would require FTS5 schema changes for marginal benefit we already achieve.
- **Strategy #12 (LSR/LACONIC/SPLADE)**: Dropped. Same problem as #23 - any learned sparse model trained on Sloth's Java/TS codebase won't generalize to Python/Go/Rust/C#. We need language-agnostic solutions.

---

## Appendix: Future Fine-Tuning Strategy (Code-Specific Reranking)

### Problem Statement

Current MS-MARCO-based models (TinyBERT-L2-v2, switched from MiniLM 2026-01-14 for 8x speed) are trained on web search queries, not code search. They lack understanding of:
- Code-specific relevance signals (definitions vs usages vs comments)
- Structural patterns (function names, imports, class hierarchies)
- Cross-language code semantics

### CoIR Benchmark Results (Code Reranking)

| Model | CoIR NDCG@10 | License | Notes |
|-------|--------------|---------|-------|
| **Jina-reranker-v3** | **63.28** | CC BY-NC 4.0 | Best accuracy, commercial restriction |
| Voyage rerank-2.5 | ~65.0* | Commercial API | Excellent but API-only |
| mxbai-rerank-v2 | ~31.73 | Apache 2.0 | Open source, lower code performance |
| MS-MARCO models | Not benchmarked | MIT/Apache | General web search models |

*Voyage numbers estimated from code task performance

### Current State (Why Fine-Tuning Helps)

**MS-MARCO TinyBERT-L2-v2** (current FlashRank default, switched 2026-01-14):
- 8x faster than MiniLM-L6-v2 (8ms vs 75ms for 50 docs)
- Same accuracy on raw code (17%) - neither model is code-aware
- Trained on 500k Bing search queries, no code-specific data
- Treats `AuthService.authenticate()` same as random text

**Code-specific fine-tuning would add:**
- Definition vs usage understanding
- Import/dependency awareness
- Cross-file relationship modeling
- Language-agnostic code patterns

### Proposed Fine-Tuning Plan

#### Phase 1: Synthetic Data Generation (10k examples)

```
Query Types (balanced distribution):
├── Exact identifier lookups (30%)
│   "AuthService"
│   "handleLogin()"
│
├── Conceptual/semantic queries (30%)
│   "how does authentication work"
│   "error handling patterns"
│
├── Structural queries (20%)
│   "what calls AuthService"
│   "implementations of UserRepository"
│
└── Mixed/hybrid queries (20%)
    "auth service login validation"
```

**Data sources:**
1. Sloth codebase (Java/TypeScript) - primary
2. Open source codebases (Python, Go, Rust) - diversity
3. Synthetic augmentation from evaluation failures

**Labeling approach:**
- Use existing evaluation ground truth (~410 queries)
- Extend with LLM-generated relevance judgments (Claude for quality)
- Include negative examples (wrong files, unrelated matches)

#### Phase 2: Model Selection

| Candidate | Size | Speed (docs/sec) | Baseline | Fine-tune Potential |
|-----------|------|------------------|----------|---------------------|
| **bge-reranker-base** | 278M | ~800 | Good | High (instruction-tuned) |
| MiniLM-L6-v2 | 22M | 1800 | Baseline | Medium |
| TinyBERT-L2-v2 | 4.4M | 9000 | Lower | Lower (limited capacity) |
| MiniLM-L2-v2 | 14M | 4100 | Medium | Medium |

**Recommendation:** Start with **bge-reranker-base**, then quantize for speed.

#### Phase 3: Training Protocol

```python
# Training configuration
config = {
    "base_model": "BAAI/bge-reranker-base",
    "learning_rate": 2e-5,
    "epochs": 3,
    "batch_size": 16,
    "loss": "cross_entropy",  # or contrastive
    "evaluation_strategy": "steps",
    "eval_steps": 500,
}

# Dataset format (JSON Lines)
{
    "query": "AuthService authentication",
    "positive": "class AuthService { authenticate() {...} }",
    "negatives": [
        "class UserService { ...",
        "// Auth helper utilities..."
    ]
}
```

#### Phase 4: Export to ONNX (Portable Deployment)

```bash
# Export fine-tuned model
optimum-cli export onnx \
    --model ./fine-tuned-code-reranker \
    --task text-classification \
    ./onnx-export/

# Quantize to INT8 (4x smaller, 2x faster)
optimum-cli optimize \
    --model ./onnx-export/ \
    --quantization int8 \
    --output ./onnx-quantized/

# Upload to HuggingFace for transformers.js
huggingface-cli upload \
    sloth/code-reranker-v1 \
    ./onnx-quantized/
```

**Portability guarantee:** INT8 ONNX runs on transformers.js (WASM) - no native dependencies.

### Expected Outcomes

| Metric | Current (MS-MARCO) | After Fine-Tuning | Change |
|--------|-------------------|-------------------|--------|
| CoIR-equivalent | ~30-35* | ~55-60 | +20-25 |
| Success@10 | 90.5% | ~94-96% | +4-6% |
| Ranking failures | ~39 | ~16-20 | -50% |
| Latency | ~15ms (50 docs) | ~15-20ms | Minimal |

*Estimated from MS-MARCO model performance on code tasks

### Implementation Timeline (Future)

| Phase | Effort | Dependency |
|-------|--------|------------|
| Data generation | 1-2 days | None |
| Model training | 1 day | Data |
| ONNX export | 0.5 day | Training |
| Integration | 0.5 day | Export |
| Evaluation | 1 day | Integration |

**Total: ~4-5 days** (not immediate priority)

### WASM Batching Limitation (2026-01-14 Finding)

During Phase 1 CROSS-JEM research, we discovered:

| Backend | Batching Benefit | Reason |
|---------|------------------|--------|
| GPU (CUDA/WebGPU) | ✅ 3-10x speedup | Parallel processing on thousands of cores |
| CPU Native | ⚠️ 1.2-2x speedup | Multi-threading helps but limited cores |
| **WASM (transformers.js)** | ❌ 0.6-0.8x (slower) | Single-threaded; batch overhead without parallelism |

**Implication for fine-tuning:**
- Smaller, faster models (TinyBERT-L2, MiniLM-L2) may be better choices than larger models
- Quantization (INT8) is critical for WASM performance
- WebGPU support would unlock batching benefits (experimental in Node.js)

### Alternative: Use Remote API for Complex Queries

For highest-stakes queries where accuracy matters most:
- **Voyage rerank-2.5**: ~65 CoIR, ~700ms latency, commercial API
- **Jina v3**: ~63.28 CoIR, ~80ms latency, CC BY-NC 4.0

Current cascaded approach already uses these for Stage 2 when FlashRank confidence is low.

---

## Decision Log Addition

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-14 | Document fine-tuning strategy | Future accuracy improvement path; not immediate priority at 90.5% |
| 2026-01-14 | Prefer bge-reranker-base | Instruction-tuned, good fine-tuning potential, can quantize to INT8 |
| 2026-01-14 | WASM batching not viable | Single-threaded execution; smaller models better than batching |
| 2026-01-14 | INT8 ONNX mandatory | Portability + speed for Claude Code plugin deployment |
| 2026-01-14 | Strategy #13 NOT_FEASIBLE | CROSS-JEM requires special model; MS-MARCO outputs single CLS score. Benchmark: WASM batching 0-3% slower |
| 2026-01-14 | Strategy #14 LOW_IMPACT | USearch HNSW already <1ms; no iterator API; savings <0.5ms. Demoted to P3 |
| 2026-01-14 | Phase 2 focus revised | #11 Qwen3 remains viable; TinyBERT 7x faster option; embedding caching already done |
| 2026-01-14 | **Default model → TinyBERT** | MiniLM and TinyBERT both 17% accuracy on raw code; TinyBERT is 8x faster (8ms vs 75ms). Future fine-tuning planned. |
| 2026-01-15 | **Local ModernBERT INT8 added** | GTE reranker (Alibaba-NLP/gte-reranker-modernbert-base) as Stage 2. Cascade: FlashRank→ModernBERT→Voyage/Jina. FREE, ~700ms, works offline. Config: `LOCAL_RERANKER_CONFIG.useLocalReranker` in config.js |
