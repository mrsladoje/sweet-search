# HNSW Optimization — Implementation Record

> **Status: COMPLETED** (March 23, 2026). All fixes implemented, benchmarked, and shipped.
> Commit `31b26d8` (code) + `a0969fa` (docs).

## Results Summary

**Ship config**: Local CodeRankEmbed, 512d HNSW, M=64, efC=800, efS=400, plain
sign-bit Hamming, heuristic neighbor selection (Algorithm 4), M0=2*M on layer 0,
shuffled insertion order. Asymmetric encoding disabled.

| Metric (GenCodeSearchNet) | Before | After | Delta |
|---------------------------|--------|-------|-------|
| JS ground-truth recall@200 | 80.6% (plateau) | 86.5% | **+5.9pp** |
| JS ANN fidelity@200 | unmeasured | 97.4% | — |
| End-to-end MRR@10 | 83.2% | 83.5% | +0.3pp |
| Latency p50 | 1403ms | 942ms | **-461ms (-33%)** |

### What worked
- Heuristic neighbor selection (Algorithm 4) — broke the recall plateau
- M=64 / efC=800 / efS=400 — denser graph, faster convergence
- Shuffled insertion order — unbiased graph backbone
- Typed-array heaps + generation-stamped visited list — zero GC per search
- Adaptive early termination + adaptive ef — cheap queries finish faster
- WASM SIMD hamming distance — ~3x faster distance computation

### What didn't work (tested, no improvement)
- Asymmetric binary quantization (WHT rotation) at 512d — degrades graph connectivity
- Asymmetric at 1024d with Voyage Code 3 — still no improvement
- Voyage Code 3 vs local CodeRankEmbed — identical quality (83.5% MRR)
- 1024d HNSW dimension vs 512d — no quality gain (1-bit quantization dominates)
- Stage 2.5 float rescore — present but marginal impact with strong Stage 2 int8

### Conclusion
Stage 1 is no longer the retrieval bottleneck. The remaining MRR ceiling (~83.5%)
is shared between embedding quality, chunking, and reranker limits. Next levers:
chunking improvements, query expansion, or stronger reranking models.

---

## Original Plan (v2)

> Goal: Improve Stage 1 candidate recall (currently 80.6% recall@200, plateau at top-100)
> and reduce latency across the 3-stage retrieval pipeline.
> Constraint: All changes must be implementable in JavaScript/Node.js (no native addons beyond USearch).
>
> v2 revision: Incorporates feedback from Codex review (2026-03-22).
> Key reframe: **recall is the bottleneck, not raw microseconds.**
> The 80.6% recall@200 plateau (BENCH_TODO.md) means 194/1000 ground truth docs
> never reach Stage 2 or 3. ~24 were routing bugs (now fixed), ~50 are unfixable
> dataset noise. The remaining ~120 misses are the addressable gap.

---

## Current Baseline

| Component | Implementation | Parameters |
|-----------|---------------|------------|
| Float HNSW | USearch (native, SIMD) | M=16, efC=200, efS=100, 512d cosine |
| Binary HNSW | Pure JS | M=32, efC=400, efS=200, 64-byte Hamming |
| Binary Quantization | Sign-based (`x > 0 → 1`) | 512d float → 64 bytes (32x) |
| Int8 Quantization | Linear scaling (max-abs) | 512d float → 512 bytes (4x) |
| Hamming Distance | Lookup-table popcount | 256-entry `POPCOUNT_TABLE` |
| Neighbor Selection | Simple (top-M by distance) | Prune at 2M, keep M closest |
| Layer Assignment | Random exponential | `floor(-log(rand()) / log(M))`, cap 10 |
| Early Termination | None (in graph search) | Score-spread analysis for rerank skip only |
| Visited Set | Fresh `new Set()` per search | Object allocation per candidate |

### Pipeline Latency Targets

| Stage | Current Target | Candidates |
|-------|---------------|------------|
| Stage 1 (Binary HNSW) | ~100us | 1000 |
| Stage 2 (Int8 rescore) | ~1ms | 100 |
| Stage 3 (Cross-encoder rerank) | ~50-100ms | 20 |
| **Total** | **<150ms** | |

### Recall Baseline (GenCodeSearchNet JS, 2026-03-08)

```
Recall@10   72.7%  (727/1000)
Recall@50   80.4%  (804/1000)
Recall@100  80.6%  (806/1000)
Recall@200  80.6%  (806/1000)  ← hard plateau
```

---

## Phase 0: Parameter Sweeps (Before Algorithm Surgery)

**Impact**: Unknown (potentially large) | **Effort**: Low | **Risk**: None
**Targets**: `core/config.js`

### Rationale

Official vendor guidance (Milvus, Qdrant, OpenSearch) treats M, efConstruction, efSearch,
and stage candidate counts as the primary HNSW quality levers. Before changing algorithms,
sweep the existing knobs to establish a proper Pareto frontier.

### Prerequisite: Dimension Alignment Audit

Before any sweep, verify that query and document binary dimensions are explicitly equal.
Currently `hammingDistance()` uses `Math.min(a.length, b.length)` (`embedding-service.js:365`),
which silently ignores extra bytes if vectors differ in length. This masks dimension
mismatches instead of failing. Add an assertion:

```javascript
if (a.length !== b.length) throw new Error(`Hamming dimension mismatch: ${a.length} vs ${b.length}`);
```

All providers must produce binary vectors at the same dimension for both queries and
documents. Verify this holds across Voyage, Nomic, Mistral, and local ONNX paths before
changing `hnswDimension`.

### Experiments

| Parameter | Current | Sweep Range | Metric |
|-----------|---------|-------------|--------|
| **hnswDimension (binary)** | **512** | **Provider-supported Matryoshka dims only** | **recall@100 vs memory** |
| M (binary) | 32 | 16, 24, 32, 48, 64 | recall@100 vs build time |
| efConstruction (binary) | 400 | 200, 400, 600, 800 | recall@100 vs build time |
| efSearch (binary) | 200 | 100, 200, 400, 600 | recall@100 vs latency |
| stage1Candidates | 1000 | 500, 1000, 2000, 4000 | end-to-end nDCG@10 vs latency |
| stage2Candidates | 100 | 50, 100, 200 | end-to-end nDCG@10 vs latency |
| M (float/USearch) | 16 | 16, 24, 32 | recall@100 vs build time |

The **binary dimension sweep is the highest-priority experiment.** Qdrant explicitly warns
that 1-bit binary quantization degrades below 1024 dimensions and recommends 1.5-bit or
2-bit schemes for 512-1024d. In this codebase, we currently truncate embeddings from their
full dimension (1024d for Voyage, 768d for CodeRankEmbed) to 512d before binarizing —
discarding signal before an already-lossy step. Going to 1024d binary costs 128 bytes/vector
instead of 64 (still 16x smaller than float) and may yield significant recall improvement.

Sweep only dimensions supported by each provider:
- **Voyage Code 3**: 512, 1024 (optionally 2048 if memory allows)
- **CodeRankEmbed local**: 512 (current), 768 (full — no Matryoshka, just skip truncation)
- **Mistral Codestral**: 512, 1024
- **Jina v3**: 512, 1024

### Prerequisite: Truncation Normalization

`truncateForHNSW()` (`embedding-service.js:327`) currently just slices — no re-normalization.
Any client-side Matryoshka truncation requires L2 re-normalization for cosine similarity to
work correctly (confirmed by Voyage docs, and applies equally to all providers). A truncated
vector has a different L2 norm than the full vector, which distorts cosine scores.

Add L2 re-normalization after truncation:

```javascript
export function truncateForHNSW(embedding) {
  const targetDim = EMBEDDING_CONFIG.hnswDimension;
  if (embedding.length <= targetDim) return embedding;
  const truncated = embedding.slice(0, targetDim);
  // Re-normalize for cosine similarity correctness
  let norm = 0;
  for (let i = 0; i < truncated.length; i++) norm += truncated[i] * truncated[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < truncated.length; i++) truncated[i] /= norm;
  return truncated;
}
```

This affects both index-time and query-time embeddings. It's a correctness fix that should
be applied before any sweep — without it, cosine similarity on truncated vectors is
subtly biased, potentially explaining some of the recall plateau.

### Diagnostic: Dimension Distribution Profiling

Before implementing any quantization changes (Fix 5), profile the per-dimension value
distribution of actual indexed embeddings:

```javascript
// Sample 1000 vectors from the float HNSW index
// For each dimension d (0..511 or 0..1023):
//   - Compute mean, stddev, and fraction of values in [-0.05, +0.05]
//   - Plot histogram of values
```

This tells you:
- **How many dimensions are "coin flips"** (values clustered near 0, sign bit unreliable)
- **Whether centroid subtraction is needed** (mean far from 0 on many dimensions)
- **Whether rotation is needed** (high variance on some dims, near-zero on others)
- **Optimal Matryoshka truncation for binarization** (which dimensions carry signal)

### Diagnostic: Graph Connectivity Check

Run Union-Find on the HNSW graph to detect disconnected components:

```javascript
// For each level in graph:
//   - Count connected components via Union-Find
//   - Report: largest component fraction, unreachable node count
//   - Flag if any component has <1% of total nodes
```

Lucene found ~18% of HNSW graphs have disconnected components — nodes unreachable from
the entry point that can never appear in search results. If detected, the rebuild fixes
(Fix 2, Fix 3) should resolve it. If it persists, investigate targeted repair.

**Caution**: Lucene's experience showed that naive component-linking (adding edges between
components) can hurt performance on skewed distributions. Detect first, repair carefully.

### Validation

Run GenCodeSearchNet JS eval (1000 queries) for each configuration. Record:
- **candidate recall@100/@200/@1000** against exact brute-force search
- **visited nodes per query** (instrument `searchLayerQuery`)
- **recall-per-visited-node** (efficiency metric)
- **end-to-end nDCG@10 and MRR@10**
- **p50/p95 latency**

This establishes the baseline all subsequent fixes are measured against.

### Files to Change

- `core/config.js` — Parameterize sweep values, add dimension sweep support
- `core/embedding-service.js` — Add dimension assertion to `hammingDistance()`
- `tests/eval/` — New sweep harness script, dimension profiler, connectivity checker

---

## Fix 1: Heap + Visited-List + Allocation Cleanup

**Impact**: High latency reduction | **Effort**: Low | **Risk**: Low
**Targets**: `binary-hnsw-index.js:searchLayerQuery()`, `binary-hnsw-index.js:searchLayer()`

### Problem

Three interleaved performance issues in the search hot loop:

1. **Repeated full sorts**: `candidates.sort()` (line 394) and `results.sort()` (line 410)
   called on every iteration. O(ef * log(ef)) per iteration, hundreds of times per search.

2. **Fresh Set allocation**: `new Set()` allocated per search call (lines 250, 389).
   Set is hash-based with high per-entry overhead in V8. For ef=200 with M=32 neighbors,
   the visited set grows to ~1000-2000 entries, each a heap-allocated JS number.

3. **Object churn**: Every candidate is `{ idx: number, dist: number }` — two heap-allocated
   objects per node visit. With ~1000 visits per search, that's ~2000 objects for GC.

### Proposed Change

**1a. Heap-based priority queues** — Replace sorted arrays:

```javascript
// Typed-array backed heap (zero object allocation)
class TypedMinHeap {
  constructor(capacity) {
    this.keys = new Uint32Array(capacity);   // node indices
    this.vals = new Uint32Array(capacity);   // distances (Hamming is integer)
    this.size = 0;
  }
  insert(key, val) { /* O(log n) sift-up */ }
  extractMin()     { /* O(log n) sift-down, returns [key, val] */ }
  peekVal()        { /* O(1) */ }
}
```

- `candidates` → TypedMinHeap (extract closest)
- `results` → TypedMaxHeap of size ef (peek furthest, replaceMax when closer found)
- **No object creation** — indices and distances stored in parallel typed arrays

**1b. Generation-stamped visited list** — Replace `new Set()`:

```javascript
// Allocated ONCE, reused across searches
class VisitedList {
  constructor(maxElements) {
    this.stamps = new Uint32Array(maxElements);  // one slot per vector
    this.generation = 0;
  }
  reset() { this.generation++; }  // O(1) — no clearing needed
  mark(idx) { this.stamps[idx] = this.generation; }
  isVisited(idx) { return this.stamps[idx] === this.generation; }
}
```

- Allocated once at index init (e.g., 500K entries = 2MB)
- `reset()` just bumps the generation counter — O(1) instead of O(n) Set clearing
- `isVisited()` is a single typed-array read — no hash lookup
- Wraps around at `2^32` (4 billion searches before needing actual clear)

**1c. Objectless candidate storage** — Encode idx+dist into a single value or use parallel arrays instead of `{ idx, dist }` objects.

### Expected Gains

- **Latency**: 3-5x speedup for `searchLayerQuery()` (heap + allocation elimination compound)
- **GC pressure**: Near-zero per-search allocation (eliminates ~2000 objects per query)
- **Accuracy**: No change (same algorithm, better data structures)
- **Scope**: Drop-in replacement, no index rebuild needed

### Files to Change

- `core/binary-heap.js` — New file: TypedMinHeap, TypedMaxHeap
- `core/visited-list.js` — New file: generation-stamped visited list
- `core/binary-hnsw-index.js` — Replace array sorts, Set, and object creation

---

## Fix 2: Heuristic Neighbor Selection (Algorithm 4)

**Impact**: Medium-high accuracy gain | **Effort**: Low | **Risk**: Low
**Targets**: `binary-hnsw-index.js:addToGraph()`, `binary-hnsw-index.js:pruneNeighbors()`

**Status**: This is baseline parity, not an enhancement. Every production HNSW (hnswlib,
FAISS, USearch, Voyager) uses heuristic selection. Our simple closest-M approach is below
standard practice.

### Problem

Current neighbor selection keeps the M closest neighbors by distance. This creates clusters
of nearby nodes pointing at each other, leaving angular gaps — directions with no shortcut
edges. Queries arriving from those directions take long detours.

### Proposed Change

Replace `slice(0, M)` in `addToGraph()` (line 188) and `pruneNeighbors()` (lines 289-302)
with the heuristic from the original HNSW paper (Algorithm 4, Malkov & Yashunin 2016):

```
function selectNeighborsHeuristic(nodeIdx, candidates, M):
  selected = []
  sort candidates by distance ascending
  for each candidate in candidates:
    if len(selected) >= M: break
    candidateDist = distance(node, candidate)
    tooClose = false
    for each s in selected:
      if distance(candidate, s) < candidateDist:
        tooClose = true
        break
    if not tooClose:
      selected.append(candidate)
  // Backfill with closest if heuristic was too aggressive
  if len(selected) < M:
    for each candidate in candidates:
      if candidate not in selected and len(selected) < M:
        selected.append(candidate)
  return selected
```

### Expected Gains

- **Accuracy**: +5-15% recall@100 at same ef (better graph connectivity)
- **Latency**: Neutral at query time; small increase at construction time
- **Scope**: Requires index rebuild

### 2b. M0 = 2*M on Layer 0

**Status**: Also baseline parity. Standard HNSW uses a larger max degree on layer 0
because that's where the final candidate collection happens. Currently `addToGraph()`
(line 188) and `pruneNeighbors()` (line 289) use `this.M` on all layers, and the prune
threshold at line 201 is `this.M * 2` on all layers.

Standard practice (hnswlib, Lucene LUCENE-10527):
- Layers > 0: max degree = M, prune to M
- Layer 0: max degree = 2*M, prune to 2*M

```javascript
const maxM = (level === 0) ? this.M * 2 : this.M;
const selectedNeighbors = selectNeighborsHeuristic(idx, neighbors, maxM);
```

This is trivial to implement alongside Fix 2 and materially improves layer-0 recall
because more connections at the finest level means fewer missed candidates.

### Files to Change

- `core/binary-hnsw-index.js` — New `selectNeighborsHeuristic()`, modify `addToGraph()` and `pruneNeighbors()` to use level-aware max degree

---

## Fix 3: Insertion Order Tuning

**Impact**: Medium-high accuracy gain | **Effort**: Low | **Risk**: Low
**Targets**: `core/indexer-ann.js`, `core/binary-hnsw-index.js:addBatch()`

### Problem

HNSW graph quality is sensitive to insertion order. A 2024 study (arXiv 2405.17813) found
insertion order can shift recall by up to 12 percentage points. Early-inserted nodes form
the graph's backbone — if they're unrepresentative, the highway structure is poor.

Currently, vectors are inserted in file-system traversal order (alphabetical by path),
which clusters related files together. This means the early graph backbone is biased
toward whatever letter comes first (e.g., lots of `api/` files before any `utils/` files).

### Proposed Change

Benchmark three insertion orders and pick the best:

1. **Random shuffle** (baseline improvement) — breaks file-system clustering
2. **Diversity-first** — insert one vector from each directory/language first, then fill in.
   Ensures the backbone spans the full codebase before filling local detail.
3. **LID-descending** (two-pass) — compute approximate LID from a random sample, insert
   high-LID (hard-to-reach) vectors first so they get more connections during construction.

### Implementation

```javascript
// In indexer-ann.js, before calling binaryHnswIndex.addBatch():
if (insertionOrder === 'shuffle') {
  fisherYatesShuffle(items);
} else if (insertionOrder === 'diversity') {
  items = diversityFirstSort(items); // round-robin by directory
}
```

### Expected Gains

- **Accuracy**: +3-12% recall@100 (empirically measured, varies by dataset)
- **Latency**: No change at query time
- **Effort**: Trivial to implement — just reorder the array before insertion
- **Scope**: Requires index rebuild

### Files to Change

- `core/indexer-ann.js` — Add shuffle/diversity-sort before addBatch()
- `core/config.js` — Add `insertionOrder: 'shuffle'` to `BINARY_HNSW_CONFIG`

---

## Fix 4: Adaptive Early Termination (Discovery-Rate Based)

**Impact**: High latency reduction | **Effort**: Low-Medium | **Risk**: Low
**Targets**: `binary-hnsw-index.js:searchLayerQuery()` (query-time ONLY)

### Problem

`searchLayerQuery()` exhaustively processes all candidates up to ef. Easy queries converge
quickly and waste effort exploring nodes that will never enter the result set.

### What Changed in the Field

Lucene 10.2.1 (April 2025) introduced static "Patience-in-Proximity." Elasticsearch 9.3
(March 2, 2026) replaced it with **adaptive discovery-rate thresholds** because static
patience over-explored easy queries and cut off hard ones too early.

### Proposed Change

Use a **discovery-rate** metric rather than static patience:

```
discoveryRate = recentDiscoveries / recentVisits  (sliding window of last W visits)

// Adaptive threshold based on search progress
progress = visitedCount / ef
if progress > 0.3 and discoveryRate < 0.05:
  break  // mature search with near-zero discovery — stop
if progress > 0.6 and discoveryRate < 0.10:
  break  // well-explored with diminishing returns — stop
```

Key differences from the v1 static patience approach:
- **Rate-based, not count-based**: adapts to the actual discovery pattern
- **Progress-aware**: tolerates low discovery early (still exploring) but not late
- **Query-time only**: Do NOT apply to construction-time `searchLayer()` — risk of
  degrading graph quality during build

### Expected Gains

- **Latency**: 30-50% reduction on easy/medium queries; 0% on hard queries
- **Accuracy**: <0.3% recall loss (adaptive threshold preserves hard-query behavior)
- **Scope**: Query-time only, no rebuild needed

### Files to Change

- `core/binary-hnsw-index.js` — Modify `searchLayerQuery()` only (not `searchLayer()`)

---

## Fix 5: Asymmetric Binary Quantization

**Impact**: High accuracy gain | **Effort**: Medium-High | **Risk**: Medium
**Targets**: `core/embedding-service.js:floatToBinary()`, `core/binary-hnsw-index.js:search()`

### Problem

Sign-based binary quantization (`x > 0 → 1`) is the simplest possible 1-bit scheme.
It throws away magnitude information completely. For dimensions near zero (common in
transformer embeddings), the sign bit is essentially a coin flip.

### What Changed in the Field

The March 2026 production frontier is **asymmetric binary quantization**, not symmetric
sign-bit Hamming. The key systems:

- **Elasticsearch BBQ** (Nov 2024): 1-bit documents + 4-bit queries + correction terms
- **Weaviate 1-bit RQ** (2025): 1-bit documents + 5-bit queries + fast Walsh-Hadamard rotation
- **RaBitQ** (SIGMOD 2024): theoretical foundation for all of the above

The core insight: **documents and queries don't need the same precision.** Documents are
stored once and read many times — compress aggressively. Queries are computed once per
search — keep them higher precision. Then use an asymmetric distance function that
compensates for the document's quantization error.

### Proposed Change

Four-part upgrade to the binary quantization pipeline:

**5a. Centroid subtraction**

Compute the dataset centroid (mean vector across all indexed embeddings) and subtract it
from every vector before binarization. This recenters the distribution so the sign-bit
threshold (0) sits at the actual decision boundary.

```
// At index time (once):
centroid = mean(all_embeddings, axis=0)       // d-dimensional vector
save(centroid)                                 // stored alongside index

// At index time (per document) and at query time:
centered = embedding - centroid
```

Sign-based binarization assumes values are centered at 0. If the per-dimension mean is
far from 0 (common with transformer embeddings), many dimensions have biased signs.
Elastic BBQ, RaBitQ, and OpenSearch 3.2 all center vectors before rotation+binarization.

Storage: one d-dimensional float vector (~2-4KB). Negligible.

**5b. Fast pseudorandom rotation (Walsh-Hadamard)**

After centering, apply a fast pseudorandom rotation to equalize variance across dimensions:

```
function fastRotate(v, signs):
  // signs = random ±1 vector, generated once per index (d bytes)
  for i in 0..d: v[i] *= signs[i]       // random sign flip: O(d)
  walshHadamardTransform(v)               // in-place: O(d log d)
  return v
```

- O(d log d) instead of O(d^2) — ~4600 ops instead of 262,144 (at 512d)
- No matrix storage — just a d-byte sign vector
- Mathematically equivalent scrambling effect to dense rotation

The full preprocessing pipeline is: **center → rotate → quantize**.

**5c. Asymmetric query coding (int4)**

Keep documents as 1-bit (binary). Encode queries at 4-bit precision:

```
Document: floatToBinary(rotate(center(embedding)))     → d/8 bytes (1 bit/dim)
Query:    floatToInt4(rotate(center(queryEmbedding)))   → d/2 bytes (4 bits/dim)
```

The int4 query retains magnitude information that the 1-bit document lost.

**5d. Asymmetric distance with correction term**

Replace symmetric Hamming distance with an asymmetric estimator:

```
function asymmetricDistance(docBinary, queryInt4, queryNorm):
  // Approximate dot product: for each dimension,
  // if docBit == 1: add queryInt4[i]
  // if docBit == 0: subtract queryInt4[i]
  // Then apply a correction based on queryNorm
  approxDot = 0
  for each byte b in docBinary:
    for each bit j in b:
      idx = byteIndex * 8 + j
      if bit set: approxDot += queryInt4[idx]
      else:       approxDot -= queryInt4[idx]
  return queryNorm - 2 * approxDot  // squared distance estimate
```

This is substantially more accurate than symmetric Hamming because the query's magnitude
information compensates for the document's quantization error.

### Expected Gains

- **Accuracy**: +8-15% recall@100 for Stage 1 (the largest single accuracy improvement)
- **Latency**: Stage 1 distance computation ~2-3x slower than pure Hamming (int4 ops
  vs bit ops), but offset by needing fewer Stage 2 candidates for same recall
- **Memory**: Documents unchanged (64 bytes). Query is 256 bytes (computed per search).
- **Scope**: Requires index rebuild (documents re-quantized with rotation)

### Files to Change

- `core/embedding-service.js` — New `computeCentroid()`, `fastRotate()`, `floatToInt4()`, `asymmetricDistance()`
- `core/binary-hnsw-index.js` — Load centroid + sign vector; apply center→rotate→quantize; replace `hammingDistance` with `asymmetricDistance` in search
- `core/artifact-builder.js` — Compute and save centroid + sign vector during index build
- `core/indexer-ann.js` — Apply center→rotate pipeline before binary quantization

---

## Fix 5.5: Float-Rescore Stage (Stage 2.5)

**Impact**: Medium-high accuracy gain | **Effort**: Low-Medium | **Risk**: Low
**Targets**: `core/search-semantic.js:semanticSearch3Stage()`

### Problem

The current pipeline goes: binary HNSW (1000 candidates) → int8 rescore (100 candidates)
→ cross-encoder rerank (20 candidates). The int8 rescore uses 8-bit quantized cosine
similarity, which is lossy — good candidates can be incorrectly ranked and dropped before
reaching the cross-encoder.

Float embeddings already exist in SQLite (`codebase.db` vectors table, used by
`vectorScan()` in `sweet-search.js:394`). These are never consulted in the 3-stage path.

### What Changed in the Field

OpenSearch's quantized-kNN guidance is explicit: retrieve with the compressed index
(oversampling), then **recompute scores with full-precision vectors** before the final
reranker. This is standard in Qdrant ("rescore: true"), Elasticsearch (oversampling +
float rescore), and Weaviate.

### Proposed Change

Add a **Stage 2.5** between int8 rescore and cross-encoder rerank:

```
Stage 1: Binary HNSW     → 1000 candidates  (~100us)
Stage 2: Int8 rescore     → 200 candidates   (~1ms)
Stage 2.5: Float rescore  → 50 candidates    (~2-5ms)
Stage 3: Cross-encoder    → 10-20 candidates (~50-100ms)
```

Stage 2.5 loads full-precision float embeddings from SQLite for the top 200 int8
candidates, computes exact float cosine similarity, and selects the best 50 for the
cross-encoder. This catches cases where int8 quantization error mis-ranked candidates.

```javascript
// In semanticSearch3Stage(), after int8 rescore:
const floatCandidates = await loadFloatEmbeddings(scoredCandidates.slice(0, 200));
for (const c of floatCandidates) {
  c.floatScore = floatCosineSimilarity(queryFloat, c.floatEmbedding);
}
floatCandidates.sort((a, b) => b.floatScore - a.floatScore);
const stage3Input = floatCandidates.slice(0, this.stage3Candidates);
```

### Expected Gains

- **Accuracy**: Potentially significant — the cross-encoder only sees what Stage 2 passes
  it. If int8 mis-ranks a good candidate out of the top 20, it's gone forever. Float
  rescore on 200 candidates catches these errors.
- **Latency**: +2-5ms (SQLite lookup + 200 float cosine computations). Acceptable given
  Stage 3 is 50-100ms.
- **Memory**: No additional storage — float vectors already in SQLite.
- **Scope**: Query-time only, no rebuild needed.

### Configuration

Add as a configurable quality mode. For latency-sensitive paths, skip Stage 2.5. For
quality-sensitive paths (the default), enable it.

```javascript
stage2_5Candidates: 200,  // float rescore pool size (0 = disabled)
```

### Files to Change

- `core/search-semantic.js` — Add float rescore step between int8 and cross-encoder
- `core/sweet-search.js` — New `loadFloatEmbeddings()` helper using SQLite
- `core/config.js` — Add `stage2_5Candidates` parameter

---

## Fix 6: WASM SIMD Distance Functions

**Impact**: Medium latency reduction | **Effort**: Medium | **Risk**: Low
**Targets**: `core/embedding-service.js` distance functions

### Problem

Distance functions are pure JS loops. After Fix 1 removes allocation overhead, the
remaining bottleneck is raw arithmetic — especially in Stage 2 where int8 cosine
similarity over 512 elements runs 100 times per query.

### Proposed Change

WASM SIMD module with three functions:

1. **`hamming_distance(a, b, len) → u32`** — 16 bytes/iteration via `i8x16.popcnt`
2. **`int8_cosine(a, b, len) → f32`** — `i16x8.dot` for 8-wide multiply-accumulate
3. **`asymmetric_distance(docBinary, queryInt4, len) → f32`** — SIMD-accelerated Fix 5c

Stage 1 note: after Fix 1 (allocation cleanup), raw popcount may become the new bottleneck.
After Fix 5 (asymmetric quantization), the distance function changes from simple Hamming
to int4-asymmetric, which benefits more from SIMD.

### Expected Gains

- **Latency**: 4-8x speedup on distance computations
  - Stage 2 (primary target): ~1ms → ~200-300us
  - Stage 1: depends on whether Fix 5 is adopted (Hamming vs asymmetric)
- **Accuracy**: No change (same math, faster execution)
- **Scope**: Drop-in replacement, no index rebuild needed

### Files to Change

- `core/simd-distance.wat` — New file, WASM text format source
- `core/simd-distance.js` — New file, WASM loader with JS fallback
- `core/embedding-service.js` — Swap distance functions to use WASM versions

---

## Fix 7: Adaptive ef (Lightweight, Rider on Fix 4)

**Impact**: Medium latency reduction | **Effort**: Low | **Risk**: Low
**Targets**: `binary-hnsw-index.js:search()`

### Problem

Every query uses efSearch=200 regardless of difficulty.

### Proposed Change

Lightweight heuristic that piggybacks on the greedy descent already done in `search()`:

```
After greedy descent, before level-0 search:
  Use the discovery-rate from Fix 4's early termination to set initial ef.
  If first few candidates at level 0 are very close → reduce ef to 0.5x
  If first few candidates are far → increase ef to 1.5x
```

This is **not** the full Ada-ef (SIGMOD 2026) approach — that requires offline calibration.
It's a cheap heuristic that compounds with Fix 4's adaptive termination:
- Adaptive ef sets the **starting budget**
- Adaptive termination sets the **stopping point**

### Expected Gains

- **Latency**: 10-20% additional reduction on easy queries (stacks with Fix 4)
- **Accuracy**: Slight improvement on hard queries (higher budget)
- **Scope**: Query-time only, no rebuild needed

### Files to Change

- `core/binary-hnsw-index.js` — Modify `search()` to compute adaptive ef

---

## Deferred: LID-Based Layer Assignment

**Status**: Deferred until after Fixes 1-6 are measured.

HNSW++ (arXiv 2501.13992) gains come from the full package: dual-branch structure +
skip bridges + LID-aware layer assignment. The `lidBoost` multiplier alone is a weak
derivative. If insertion order tuning (Fix 3) closes most of the recall gap, LID-based
layers may not be worth the complexity.

Revisit after Phase B if recall@100 is still below 88%.

---

## Deferred: Filter-Aware HNSW (ACORN)

**Status**: Not currently applicable.

ACORN (SIGMOD 2024, arXiv 2403.04871) adds predicate-aware graph traversal — 2-hop
neighbor expansion during search when metadata filters are active. This avoids the
"filter-then-search" recall collapse that happens when filters are selective.

Currently, our HNSW search has **no metadata filtering** — path/language/type filters
are applied post-retrieval. If we ever add pre-retrieval metadata filters (e.g.,
"search only .js files"), ACORN-style traversal becomes relevant. Until then, deferred.

---

## Implementation Priority (Quality-First Ordering)

The ordering prioritizes **retrieval quality first, latency second**. Latency optimizations
(Fix 4, Fix 7) are deferred until quality is established, because early termination and
adaptive ef can only preserve quality if tuned very carefully — and tuning requires knowing
the quality baseline.

| Phase | Fix | Type | Accuracy | Latency | Effort | Rebuild? |
|-------|-----|------|----------|---------|--------|----------|
| 0 | Parameter sweeps + diagnostics | Baseline | ? | ? | Low | Yes |
| 0 | Truncation normalization | Correctness | + | — | Trivial | Yes |
| A | Fix 1: Heap + visited-list + allocation | Latency | — | +++ | Low | No |
| A | Fix 2: Heuristic selection + M0=2*M | Accuracy | ++ | — | Low | Yes |
| A | Fix 3: Insertion order tuning | Accuracy | ++ | — | Low | Yes |
| B | Fix 5: Asymmetric binary quantization | Accuracy | +++ | — | Med-High | Yes |
| B | Fix 5.5: Float-rescore stage | Accuracy | ++ | -1 | Low-Med | No |
| C | Fix 4: Adaptive early termination | Latency | — | ++ | Low | No |
| C | Fix 6: WASM SIMD distances | Latency | — | +++ | Medium | No |
| C | Fix 7: Adaptive ef | Latency | + | + | Low | No |
| — | LID-based layers | Accuracy | ++? | — | Medium | Yes |

### Recommended Order

**Phase 0 — Establish baseline**
- Truncation normalization fix (correctness, do first)
- Dimension alignment audit (assertion in `hammingDistance`)
- Binary dimension sweep (512 vs 1024, highest-priority experiment)
- Parameter sweeps (M, efConstruction, efSearch, stage candidate counts)
- Dimension distribution profiling + graph connectivity check
- Result: know the quality ceiling with current algorithms + optimal parameters

**Phase A — Graph quality (accuracy)** (Fixes 1-3, combined rebuild)
- Fix 1: Heap + allocation cleanup (needed for accurate benchmarking)
- Fix 2: Heuristic selection + M0=2*M (baseline parity, rebuild)
- Fix 3: Insertion order experiments (trivial, same rebuild)
- Measure: candidate recall@100 should improve 5-15% from Fix 2+3
- Single rebuild combines all three graph-quality fixes

**Phase B — Quantization quality (accuracy)** (Fixes 5, 5.5)
- Fix 5: Asymmetric binary quantization with centroid + rotation (rebuild)
- Fix 5.5: Float-rescore Stage 2.5 (quality mode, no rebuild)
- Measure: candidate recall@100 should reach 90-95%
- This is where the biggest accuracy gains are

**Phase C — Latency** (Fixes 4, 6, 7)
- Fix 4: Adaptive early termination (now safe to tune against known quality)
- Fix 6: WASM SIMD (raw distance speedup)
- Fix 7: Adaptive ef (cheap rider on Fix 4)
- Constraint: no fix in Phase C may regress recall@100 by more than 0.5%

### Combined Projected Targets

| Metric | Baseline | After Phase 0 | After Phase A | After Phase B | After Phase C |
|--------|----------|---------------|---------------|---------------|---------------|
| Recall@100 (JS) | 80.6% | ~82-86% | ~87-92% | ~92-96% | ~92-96% |
| Stage 1 latency | ~100us | ~100us | ~20-40us | ~20-40us | ~10-20us |
| Stage 2 latency | ~1ms | ~1ms | ~1ms | ~2-5ms* | ~1-2ms |
| Total pipeline | <150ms | <150ms | <120ms | <110ms | <80ms |

*Stage 2 latency increases in Phase B due to float-rescore stage, but end-to-end quality
improves enough to potentially reduce Stage 3 candidate count.

Note: Stage 3 (50-100ms) dominates total latency. The real payoff of better Stage 1+2
recall is **being able to reduce Stage 3 candidate budgets** while maintaining or
improving end-to-end nDCG@10. That's the path to sub-80ms total latency.

---

## Validation Plan (v2)

The v1 validation plan used recall@10 as the primary metric. For a Stage 1 candidate
generator, that's wrong. Updated metrics:

### Primary Metrics

1. **Candidate recall@100 and @1000 against exact brute-force search**
   - The question: "Of the true top-100 nearest neighbors, how many does HNSW find?"
   - Run on GenCodeSearchNet JS (1000 queries)
   - This is the metric that directly measures Stage 1 quality

2. **Visited nodes per query** (instrument searchLayerQuery)
   - Measures search efficiency independent of wall-clock timing
   - Recall-per-visited-node is the true HNSW quality metric

3. **End-to-end nDCG@10 and MRR@10**
   - The metric users actually care about
   - Run full 3-stage pipeline on GenCodeSearchNet

### Secondary Metrics

4. **Latency p50/p95/p99** (stage-level and end-to-end)
5. **Graph quality** (for rebuild fixes): average degree, graph diameter, connected components
6. **Memory usage**: RSS before and after index load

### A/B Testing Protocol

For each fix:
1. Run eval suite BEFORE (current config)
2. Apply fix
3. Run eval suite AFTER (same queries, same dataset)
4. Report delta on all metrics with 95% confidence intervals
5. Apply a phase-aware ship gate:
   - **Phase A / Phase B (quality phases)**: ship if candidate recall@100 and/or end-to-end
     nDCG@10 / MRR@10 improve materially, and latency stays within the agreed budget.
   - **Phase C (latency phase)**: ship only if latency improves and candidate recall@100
     does not regress by more than 0.5%.

---

## Multi-Provider Considerations

This codebase supports multiple embedding providers (Voyage Code 3, CodeRankEmbed local,
Mistral, Jina). The plan must produce correct, optimized results for all of them.

### Key Constraints

1. **Indexes are provider-specific.** An index built with Voyage cannot be searched with
   CodeRankEmbed queries — they are different embedding spaces. Centroid vectors, rotation
   sign vectors, and quantization calibration are all per-index and therefore per-provider.
   This is already the case and requires no change.

2. **Voyage native binary/int8 must be gated after Fix 5.** `getBinaryEmbedding()`
   (`embedding-service.js:412`) and `getInt8Embedding()` (`embedding-service.js:448`) have
   Voyage-native fast paths that request binary/int8 directly from the API. After Fix 5
   introduces center→rotate→asymmetric quantization, these native paths **bypass the
   calibrated pipeline** and produce incompatible vectors.

   Rule: once Fix 5 lands, **all providers must use the same client-side quantization
   pipeline**: float embedding → truncate → renormalize → centroid subtract → rotate →
   quantize. Voyage-native binary/int8 may be re-enabled only if empirically proven
   equivalent or better on the eval suite.

3. **Dimension sweeps are provider-specific.** Each provider has different supported
   Matryoshka dimensions:
   - Voyage Code 3: 256, 512, 1024, 2048
   - CodeRankEmbed local: 768 full, 512 HNSW (no Matryoshka)
   - Mistral Codestral: 256, 512, 1024, 3072
   - Jina v3: 64, 128, 256, 512, 1024

   Phase 0 dimension sweeps must use each provider's supported dimensions. For CodeRankEmbed
   (no Matryoshka), the only option is 512 (truncated from 768) or 768 (full).

4. **Eval must cover each active provider.** Run GenCodeSearchNet evals separately for
   each provider to ensure fixes don't improve one at the cost of another. At minimum:
   - Voyage Code 3 (primary remote provider)
   - CodeRankEmbed (local/offline provider)

5. **Artifact fingerprinting.** Index artifacts must be invalidated when any pipeline
   component changes: provider, model, HNSW dimension, quantization scheme version,
   centroid, or rotation vector. The current `.meta.json` already stores dimension and
   model info; extend it to include a pipeline version hash.

---

## Sources

- Elastic adaptive early termination (March 2, 2026): https://www.elastic.co/search-labs/blog/hnsw-elasticsearch-adaptive-early-termination
- Ada-ef / SIGMOD 2026: https://arxiv.org/abs/2512.06636
- Original HNSW / heuristic selection: https://arxiv.org/abs/1603.09320
- HNSW insertion-order / LID effects: https://arxiv.org/abs/2405.17813
- HNSW++ / dual-branch + skip bridges: https://arxiv.org/abs/2501.13992
- RaBitQ: https://arxiv.org/abs/2405.12497
- Elasticsearch BBQ: https://www.elastic.co/search-labs/blog/better-binary-quantization-lucene-elasticsearch
- Weaviate rotational quantization: https://docs.weaviate.io/weaviate/concepts/vector-quantization
- AQR-HNSW (Feb 2026): https://arxiv.org/abs/2602.21600
- ACORN filtered search: https://arxiv.org/abs/2403.04871
- Qdrant binary quantization guide: https://qdrant.tech/articles/binary-quantization/
- OpenSearch random rotation + ADC: https://opensearch.org/blog/the-benefits-of-random-rotation-in-quantized-vector-search/
- OpenSearch asymmetric distance computation: https://opensearch.org/blog/asymmetric-distance-computation-for-binary-quantization/
- Voyage Code 3 dimensions: https://blog.voyageai.com/2024/12/04/voyage-code-3/
- Lucene HNSW disconnected components: https://github.com/apache/lucene/issues/12627
- Lucene M0=2*M (LUCENE-10527): https://issues.apache.org/jira/browse/LUCENE-10527
- Voyage embeddings / truncation normalization: https://docs.voyageai.com/docs/embeddings
- Voyage flexible dimensions: https://docs.voyageai.com/docs/flexible-dimensions-and-quantization
- OpenSearch approximate k-NN / oversample+rescore: https://docs.opensearch.org/2.17/search-plugins/knn/approximate-knn/
