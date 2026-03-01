# Query-Dependent Graph Expansion Scoring

Implementation plan for TODO Section 24. Updated 2026-02-28.

## Problem

Both stages of graph expansion are completely query-agnostic:

- `expandSecondHopAdaptive` scores candidates by graph topology only (edge type,
  degree, hop distance). A hop-2 entity semantically related to the query scores
  the same as an unrelated one if they have the same graph structure.

- `rerankExpanded` applies fixed multipliers (1.5x same-file, 1.2-1.3x entity
  type) that are identical regardless of what the query asked.

This means graph-connected but semantically irrelevant entities consume token
budget over relevant ones. Every graph RAG system from 2024 onward uses query
embedding similarity — we are below this baseline.

## Fix: Blend Graph Score with Cosine Similarity

```
final_score = (1 - w) * graph_score + w * cosine(query_embedding, entity_embedding)
```

Both the query embedding and entity embeddings already exist in the pipeline:

- **Query embedding**: Computed in `semanticSearch3Stage` (`search-semantic.js:79`)
  as `queryInt8 = floatToInt8(truncateForHNSW(embedResult.float))`. Also available
  as float32 from `embedResult.float`.
- **Entity embeddings**: Stored in `binaryHnswIndex.int8Vectors` Map, keyed by
  chunk/entity ID. Accessible via `binaryHnswIndex.getInt8Vector(id)`.
- **Similarity function**: `int8CosineSimilarity(a, b)` already exists in
  `embedding-service.js` and is used in stage 2 scoring.

Estimated latency: ~2ms (20 SQLite lookups + 20 int8 dot products on 512-dim).

---

## Current Data Flow (what exists)

```
sweet-search.js:search()
  → semanticSearch3Stage()              ← queryInt8 computed here (line 79)
    → returns { results, stats }
  → hybridSearchV2()                    ← queryInt8 also computed internally
    → returns { results, semanticStats }

  → _applyPostRetrieval(results, query, options, searchContext)
    → expandResults(graphDb, results, {...})    ← NO query embedding passed
      → expandOneHop(db, seedIds, edgeTypes)    ← returns Map<id, {via, direction}>
      → expandSecondHopAdaptive(db, ...)        ← scores by topology only
      → rerankExpanded(expandedResults, results) ← 1.5x/1.3x heuristics only
      → applyTokenBudget(...)
```

The query embedding is computed in the semantic search step but is never
threaded into post-retrieval processing. This is the core plumbing gap.

---

## Implementation Plan

### Step 1: Thread queryEmbedding through the pipeline

**File: `core/search-semantic.js`**

Both `semanticSearch3Stage` and `semanticSearchStandard` already compute the
query embedding. Return it in the stats object so it's available downstream.

In `semanticSearch3Stage` (~line 79):
```js
const queryInt8 = floatToInt8(truncateForHNSW(embedResult.float));
// ADD: attach to stats for downstream use
stats.queryInt8 = queryInt8;
```

In `semanticSearchStandard` (~line 294):
```js
const queryEmbedding = truncateForHNSW(fullEmbedding);
// ADD: attach int8 version to stats
stats.queryInt8 = floatToInt8(queryEmbedding);
```

**File: `core/search-postprocess.js`**

In `applyPostRetrieval` (~line 64-93), the `semanticStats` object is merged
into `stats`. After that merge, extract `queryInt8`:

```js
const queryInt8 = semanticStats?.queryInt8 || null;
```

Then pass it into `expandResults` (~line 128):

```js
results = expandResults(graphDb, results, {
  expandMode: effectiveGraphExpand,
  adaptiveHop2,
  queryInt8,                        // NEW
  hnswIndex: this.binaryHnswIndex,  // NEW: for entity embedding lookup
  ...(intentEdgeTypes && !graphExpandOptions.edgeTypes ? { edgeTypes: intentEdgeTypes } : {}),
  ...graphExpandOptions,
});
```

### Step 2: Use queryInt8 in expandSecondHopAdaptive

**File: `core/graph-expansion.js`**

Update `expandResults` signature to accept `queryInt8` and `hnswIndex`:

```js
export function expandResults(db, results, options = {}) {
  const {
    expandMode = '1hop',
    maxExpanded = 10,
    tokenBudget = 8000,
    edgeTypes = DEFAULT_EDGE_TYPES,
    adaptiveHop2 = false,
    hop2TokenBudget = 4000,
    expandedBudget,
    queryInt8 = null,        // NEW
    hnswIndex = null,        // NEW: BinaryHNSWIndex for entity embedding lookup
    semanticWeight = 0.4,    // NEW: blend weight for cosine similarity
  } = options;
```

Pass `queryInt8`, `hnswIndex`, and `semanticWeight` into
`expandSecondHopAdaptive`:

```js
if (adaptiveHop2) {
  expandSecondHopAdaptive(db, seedIds, expanded, edgeTypes, {
    maxHop2: maxExpanded,
    tokenBudget: hop2TokenBudget,
    queryInt8,
    hnswIndex,
    semanticWeight,
  });
}
```

Inside `expandSecondHopAdaptive`, after computing the topology-only score
(~line 301), blend with cosine similarity when available:

```js
let score = (effectiveAlpha * effectiveAlpha * weight * edgePriority) / Math.sqrt(outDegree);

// Query-dependent scoring: blend graph topology with semantic similarity
if (queryInt8 && hnswIndex) {
  const entityInt8 = hnswIndex.getInt8Vector(c.target_id);
  if (entityInt8) {
    const cosSim = int8CosineSimilarity(queryInt8, entityInt8);
    // Normalize cosSim from [-1,1] to [0,1] for blending
    const normSim = (cosSim + 1) / 2;
    score = (1 - semanticWeight) * score + semanticWeight * normSim;
  }
}
```

Import `int8CosineSimilarity` at the top of `graph-expansion.js`:

```js
import { int8CosineSimilarity } from './embedding-service.js';
```

### Step 3: Use queryInt8 in rerankExpanded

In `rerankExpanded` (~line 411), replace the fixed multipliers with a blend:

```js
export function rerankExpanded(expandedResults, seedResults, options = {}) {
  const { queryInt8 = null, hnswIndex = null, semanticWeight = 0.4 } = options;
```

For each expanded result, compute cosine similarity and blend:

```js
for (const er of expandedResults) {
  let rerankScore = er.score || 0;

  // File proximity boost (keep — structural signal)
  const erFile = er.file_path || er.file || er.metadata?.path;
  if (erFile && seedFiles.has(erFile)) {
    rerankScore *= 1.5;
  }

  // Entity type relevance (keep — structural signal)
  const entType = er.type || er.metadata?.chunk_type;
  if (TYPE_BOOST[entType]) {
    rerankScore *= TYPE_BOOST[entType];
  }

  // NEW: Query-dependent semantic similarity
  if (queryInt8 && hnswIndex) {
    const entityId = er.entity_id || er.id;
    const entityInt8 = hnswIndex.getInt8Vector(entityId);
    if (entityInt8) {
      const cosSim = int8CosineSimilarity(queryInt8, entityInt8);
      const normSim = (cosSim + 1) / 2;
      // Blend: heuristic score with semantic relevance
      rerankScore = (1 - semanticWeight) * rerankScore + semanticWeight * normSim;
    }
  }

  er.score = rerankScore;
}
```

Update the caller in `expandResults` (~line 98):

```js
rerankExpanded(expandedResults, results, { queryInt8, hnswIndex, semanticWeight });
```

### Step 4: Handle lexical-only and structural paths

When the search mode is `lexical` or `structural`, there is no semantic search
step, so `semanticStats?.queryInt8` will be null.

**Options (pick one):**

**(a) Embed on demand (~5-15ms, recommended):** If `queryInt8` is null and graph
expansion is enabled, compute it just-in-time in `applyPostRetrieval`:

```js
if (!queryInt8 && effectiveGraphExpand !== 'none' && this.binaryHnswIndex) {
  try {
    const embedResult = await getBinaryEmbedding(query);
    queryInt8 = floatToInt8(truncateForHNSW(embedResult.float));
  } catch { /* fall back to topology-only scoring */ }
}
```

This costs one embedding call (~5-15ms) but only triggers when graph expansion
is actually active (which is currently `graphExpand: 'none'` by default).

**(b) Skip gracefully:** If `queryInt8` is null, the blending code does nothing
(all the `if (queryInt8 && hnswIndex)` guards return false). Expansion falls
back to pure topology scoring — identical to today's behavior.

**Recommendation:** Start with (b) for the initial PR. Add (a) as a follow-up
if/when `graphExpand` defaults to `'2hop'` (Section 5).

### Step 5: Add tests

**New file: `tests/query-dependent-expansion.test.js`**

Test cases:

1. **Cosine blend improves relevance:** Create a mock graph where entity A is
   graph-connected but semantically unrelated to the query, and entity B is
   weakly graph-connected but semantically similar. With `semanticWeight > 0`,
   B should score higher than A.

2. **Graceful degradation when queryInt8 is null:** `expandResults` with no
   `queryInt8` should produce identical results to the current behavior.

3. **Graceful degradation when entity has no int8 vector:** If
   `hnswIndex.getInt8Vector(id)` returns undefined for some entities, those
   entities keep their topology-only score.

4. **semanticWeight=0 matches old behavior:** Verify that setting
   `semanticWeight: 0` produces identical scores to the current implementation.

5. **semanticWeight=1 uses pure cosine:** Verify that topology score is
   ignored when `semanticWeight: 1`.

6. **rerankExpanded with semantic blend:** Same-file and entity-type boosts
   still apply, then semantic similarity blends on top.

7. **int8CosineSimilarity called correctly:** Mock `hnswIndex.getInt8Vector`
   and verify it's called with the right entity IDs.

**Existing test files to verify no regressions:**
- `tests/graph-expansion.test.js` — existing tests should pass unchanged
  (they don't pass `queryInt8`, so blend code is skipped)

### Step 6: Benchmark

Run the eval harness with and without query-dependent scoring:

```bash
# Baseline (current behavior, no graph expansion)
node eval/run_benchmark.js --benchmark=codesearchnet --graph-expand=none

# Graph expansion without semantic blend (current behavior if expansion were on)
node eval/run_benchmark.js --benchmark=codesearchnet --graph-expand=2hop --semantic-weight=0

# Graph expansion WITH semantic blend (new)
node eval/run_benchmark.js --benchmark=codesearchnet --graph-expand=2hop --semantic-weight=0.4

# Sweep blend weights
for w in 0.2 0.3 0.4 0.5 0.6; do
  node eval/run_benchmark.js --benchmark=codesearchnet --graph-expand=2hop --semantic-weight=$w
done
```

Measure: MRR@10, NDCG@10, Recall@10 per-language, p50 latency.

---

## Files to Change

| File | Change | Lines |
|------|--------|-------|
| `core/graph-expansion.js` | Add `queryInt8`, `hnswIndex`, `semanticWeight` to options; blend scores in `expandSecondHopAdaptive` and `rerankExpanded` | ~30 lines added |
| `core/search-semantic.js` | Attach `queryInt8` to stats in both semantic search functions | ~2 lines added |
| `core/search-postprocess.js` | Extract `queryInt8` from semanticStats, pass to `expandResults` with `hnswIndex` | ~5 lines added |
| `tests/query-dependent-expansion.test.js` | **NEW** — 7 test cases | ~200 lines |

Total: ~35 lines of production code, ~200 lines of tests.

---

## ID Mismatch Risk

The int8 vectors in `binaryHnswIndex` are keyed by chunk ID (the same ID used
in search results). The entities in `graph-expansion.js` are keyed by entity ID
from the `entities` table. These may not be the same ID:

- Search result IDs come from `binaryHnswIndex` (chunk IDs like `chunk_0042`)
- Entity IDs come from `entities` table (entity IDs like `ent_auth_service`)
- `collectSeedIds` in `graph-expansion.js:117` already handles the mapping

For `rerankExpanded`, the expanded entities have `entity_id` (from
`lookupEntities`). We need to check whether `binaryHnswIndex.getInt8Vector`
can resolve entity IDs or only chunk IDs.

**Investigation needed:** Check what IDs are stored in the int8Vectors map.
If they're chunk IDs (not entity IDs), we need a mapping step. The `entities`
table has both `id` (entity ID) and may have a chunk reference. Alternatively,
the `vectors` table in `codebase.db` may have an `entity_id` in metadata.

**Fallback if IDs don't match:** Skip the semantic blend for entities where
`getInt8Vector` returns null. This degrades gracefully to topology-only scoring
for those entities — no worse than today.

---

## Expected Impact

| Scenario | Current | With semantic blend | Why |
|----------|---------|---------------------|-----|
| "handle null pointer" → seed `UserService` → hop-2 `NullPointerExceptionHandler` | Loses to `UserPreferences` (stronger graph path) | Wins (high cosine to query) | Cosine similarity catches semantic relevance |
| "database schema" → seed `UserModel` → hop-2 `SchemaValidator` vs `UserPreferences` | Random (both have similar topology) | `SchemaValidator` wins | Direct semantic match |
| No expansion (graphExpand='none') | Unchanged | Unchanged | Code path not exercised |

Conservative estimate: +1-3 MRR points on benchmarks where graph expansion
helps (CodeSearchNet, GenCodeSearchNet). Larger impact on Java and JavaScript
where verbose identifiers cause more false positives in topology-only scoring.

---

## Configuration

Default `semanticWeight: 0.4` (40% cosine, 60% graph topology). This is a
starting point — the benchmark sweep (Step 6) will determine the optimal value.

The weight is configurable via the `graphExpandOptions` in the search API:

```js
await searcher.search("handle null pointer", {
  graphExpand: '2hop',
  graphExpandOptions: { semanticWeight: 0.5 },
});
```

---

## Dependencies

- **None.** All required data (int8 vectors, query embedding) already exists.
- **No new npm packages.**
- **No ONNX models, training data, or external services.**
- **Prerequisite for Section 26** (pipeline restructuring): Section 24 is
  the fix within the current architecture. Section 26 will route expanded
  entities through the learned cross-encoder reranker, superseding
  `rerankExpanded` entirely. Section 24 is still valuable as the improvement
  to candidate *selection* in `expandSecondHopAdaptive`.
