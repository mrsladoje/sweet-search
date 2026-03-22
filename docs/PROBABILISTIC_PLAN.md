# Probabilistic Data Structures Plan — Sweet Search

## Status: PLANNED

## Thesis

Sweet Search already uses several probabilistic/approximate structures (HNSW, Binary HNSW,
Int8 MaxSim, Matryoshka truncation, CatBoost routing, Leiden clustering). This plan explores
where *additional* probabilistic data structures can reduce latency, memory, embedding cost,
and duplicate noise. Accuracy gains are indirect — via better budgeting, dedup, and adaptation.

> **Key principle:** probabilistic structures are more likely to lower latency, memory, and
> duplicate-noise than to directly raise recall. Accuracy improvements come from spending
> compute smarter, not from the structures themselves.

### Prior Art & Key References

| Structure | Seminal Paper | Key Result |
|-----------|---------------|------------|
| Bloom Filter | Bloom 1970 | O(1) membership, ~9.6 bits/element at 1% FPR |
| Cuckoo Filter | Fan et al., CoNEXT 2014 | Deletion support, 2x lookup vs counting Bloom |
| Xor Filter | Graf & Lemire, arXiv 1912.08258 | 3 cache-parallel accesses, ~9 bits/element |
| Binary Fuse | Lemire et al., arXiv 2201.01174 | Within 13% of theoretical space lower bound |
| Ribbon Filter | Meta, 2021 | 1/3 memory savings vs Bloom (deployed in RocksDB) |
| HyperLogLog | Flajolet et al., INRIA 2007 | Cardinality estimation, ~2% error in 1.5 KB |
| HyperLogLog++ | Google Research, 2013 | Improved bias correction, deployed in BigQuery |
| UltraLogLog | Ertl, VLDB 2024 | 28% more space-efficient than HLL |
| HyperANF | Boldi et al., arXiv 1011.5599 | Approximate neighbourhood function via HLL |
| Count-Min Sketch | Cormode & Muthukrishnan, 2003 | Streaming frequency estimation, sub-linear space |
| Frequent Items | Apache DataSketches | Streaming top-K with guaranteed error bounds |
| KLL Sketch | Karnin, Lang, Liberty, arXiv 1603.05346 | Streaming quantiles, mergeable, optimal space |
| T-Digest | Dunning & Ertl, arXiv 1902.04023 | Streaming quantiles, ~2 KB per sketch |
| SimHash | Charikar, STOC 2002 | Cosine-LSH fingerprints, O(1) Hamming comparison |
| MinHash | Broder, 1997 | Jaccard similarity estimation from signatures |
| SimHash@Google | Manku, Jain, Sarma, WWW 2007 | Near-duplicate detection at 8B web pages |
| BitFunnel | Goodwin et al., SIGIR 2017 | Bloom-based inverted index, 2.4x throughput (Bing) |
| Learned Bloom | Kraska et al., SIGMOD 2018 | ML+BF hybrid, 30% smaller at same FPR |
| Cascaded LBF | Sato & Matsui, arXiv 2025 | 24% memory reduction, 14x faster rejection |
| Block-Max WAND | Ding & Suel, SIGIR 2011 | Safe early termination, 2-5x BM25 speedup |
| SEISMIC | SIGIR 2024 | Block sketches for sparse retrieval |
| Early-Exit CE | Busolin et al., SIGIR 2025 | 60-80% cross-encoder latency reduction |
| Conformal Retrieval | arXiv 2404.17769, 2024 | Statistical guarantees on retrieval quality |
| RGS Reranking | arXiv 2509.07163, 2025 | Budget-constrained reranking as optimization |
| Theta Sketch | Apache DataSketches | Set operations with guaranteed error bounds |
| SetSketch | Ertl, 2023 | Bridges MinHash and HLL (cardinality + similarity) |
| Spectral Bloom | Cohen & Matias, Stanford | Frequency-aware membership queries |
| Quotient Filter | Bender et al., VLDB 2012 | Single cache miss, deletion support, mergeable |
| Prefix Filter | Even et al., VLDB 2022 | Theoretically + practically better than Bloom |
| Ada-BF | Dai & Shrivastava, NeurIPS 2020 | Adaptive learned BF with confidence-based FPR |
| Scalable Bloom | Almeida et al., 2007 | Dynamically growing Bloom filter |
| Morris Counter | Morris, 1978 | Approximate counting in O(log log n) bits |
| Reservoir Sampling | Vitter, 1985 | Uniform random sample from stream of unknown size |
| Skip List | Pugh, CACM 1990 | O(log n) sorted insert/search, simpler than trees |
| LotusFilter | Matsui, CVPR 2025 | Learned cutoff table for diverse NN, 0.02ms/query |
| GPTSemCache | arXiv 2411.05276, 2024 | Semantic caching for LLMs, 68.8% API reduction |
| Matryoshka RL | Kusupati et al., NeurIPS 2022 | Truncatable embeddings, coarse-to-fine retrieval |
| DPP Diversity | Kulesza & Taskar, 2012 | Determinantal point processes for diverse subsets |

---

## Fix Overview

| # | Name | Target | Impact | Risk | Tier |
|---|------|--------|--------|------|------|
| 1 | SimHash/MinHash chunk dedup | Indexing pipeline | High | Low | Implement |
| 2 | KLL/T-Digest adaptive cascade thresholds | `cascaded-scorer.js:24` | High | Medium | Implement |
| 3 | Count-Min / Frequent-Items for hot queries | Telemetry & warmup | Medium | Low | Implement |
| 4 | HLL/HyperANF for graph expansion planning | `graph-expansion.js:183` | High | Medium | Prototype |
| 5 | Block-Max MaxSim early termination | `late-interaction-index.js:177` | High | Medium | Prototype |
| 6 | HLL/Theta for distinctness telemetry | Warmup & metrics | Medium | Low | Implement |
| 7 | Xor/Binary Fuse for immutable membership | Vocabulary, negative cache | Medium | Low | Implement |
| 8 | Cuckoo Filter for mutable membership | Translation cache, active sets | Low | Low | Evaluate |
| 9 | Attenuated Bloom for multi-hop reachability | `graph-expansion.js` | Medium | High | Prototype |
| 10 | SimHash MMR diversity proxy | `mmr.js:42` | Low | Medium | Evaluate |
| 11 | LSH-accelerated semantic cache | `embedding-cache.js:63` | Low | Medium | Evaluate |
| 12 | Reservoir sampling for telemetry | `embedding-telemetry.js` | Low | Low | Evaluate |
| 13 | Spectral Bloom for term significance | `search-boost.js` | Low | Medium | Research |
| 14 | Learned Bloom for route fast-path | `query-router.js:42` | Low | Medium | Research |
| 15 | Early-Exit Cross-Encoder layers | `local-reranker.js` | Medium | Medium | Prototype |
| 16 | Conformal prediction result set sizing | `cascaded-scorer.js` | Medium | High | Research |
| 17 | Persistent embedding negative cache | `embedding-service.js` | Medium | Low | Implement |
| 18 | RGS budget-constrained reranking | `search-postprocess.js` | Medium | Medium | Prototype |
| 19 | Skip List for score-sorted candidates | `search-fusion.js` | Low | Low | Evaluate |

Tiers:
- **Implement** — clear value, low risk, build and benchmark immediately
- **Prototype** — strong idea, needs experimental validation before production
- **Evaluate** — worth testing, unclear if payoff justifies complexity
- **Research** — interesting for a paper, not necessarily for production

---

## Fix 1: SimHash/MinHash Near-Duplicate Chunk Suppression

### Problem

Document chunks use exact SHA-256 content hashes (`core/chunking/chunk-builder.js:36`) and
incremental tracking uses exact hashes (`core/incremental-tracker.js:6`). This misses:
- Boilerplate headers (license blocks, imports differing by 1-2 lines)
- Templated/generated files (similar structure, different identifiers)
- Near-duplicate tests, configs, and repeated utility code
- Copied-and-modified functions across files

Each near-duplicate gets embedded separately → wasted API calls, inflated index, diluted search precision.

### Approach

**Phase A: SimHash fingerprints during chunking**
1. Compute 64-bit SimHash from chunk tokens (whitespace-split, lowered)
2. Store fingerprint alongside SHA-256 in chunk metadata
3. During indexing, compare SimHash via Hamming distance (XOR + POPCNT, O(1))
4. If Hamming distance ≤ 3 from an existing chunk → flag as near-duplicate
5. Near-duplicate policy: reuse embedding from exemplar, store back-reference

**Phase B: Weighted SimHash for code (novel)**
- Weight identifier tokens higher than keywords/syntax tokens
- Tree-sitter node types → weight map (e.g., identifier: 3.0, keyword: 0.5, punctuation: 0.1)
- This makes SimHash sensitive to semantic content, not boilerplate

**Phase C: MinHash for cluster-level dedup (Codex idea)**
- Compute MinHash signatures (k=128 permutations) for token shingles (w=3)
- Group chunks into near-duplicate clusters using MinHash LSH (threshold 0.7)
- Index only cluster exemplars, re-expand siblings after ranking
- This is the strongest "useful + publishable" direction per Codex

### Key Files
- `core/chunking/chunk-builder.js:36` — `hashContent()` (SHA-256, add SimHash here)
- `core/incremental-tracker.js:6` — exact hash tracking (keep exact, add SimHash layer)
- `core/index-codebase-v21.js` — indexing orchestrator (integrate dedup decisions)
- `core/indexer-phases.js` — phase pipeline (add dedup phase)

### Expected Impact
- 10-30% reduction in embedding API calls during indexing
- 5-15% reduction in index size (fewer near-duplicate entries)
- Precision improvement from reduced duplicate noise in results
- SimHash: 8 bytes per chunk. MinHash (k=128): 512 bytes per chunk.

### Benchmark Plan
```bash
# Baseline: index a codebase, measure embedding API calls and index size
node eval/run_benchmark.js --dataset codesearchnet --profile balanced

# A/B: same codebase with SimHash dedup enabled
# Compare: embedding_api_calls, index_size_mb, MRR@10, Recall@5, Recall@20
# Also measure: number of near-duplicate clusters found, false-positive dedup rate
```

**Metrics to track:**
- Embedding API calls (before vs after)
- Index size in MB
- MRR@10, NDCG@10, Recall@5, Recall@20 (must not regress)
- Near-duplicate clusters found
- False-positive dedup rate (manual spot-check of 50 flagged pairs)

### Risk Assessment
- **Low risk.** SimHash is a pre-filter before embedding; false positives only cause
  embedding reuse (slightly wrong embedding), not missing results entirely.
- DO NOT replace exact change detection in `incremental-tracker.js` with probabilistic
  filters — exact hashing is correct and cheap for that use case.
- Start with SimHash only (simpler). Add MinHash clusters if SimHash shows >15% dedup rate.

---

## Fix 2: KLL/T-Digest Adaptive Cascade Thresholds

### Problem

The cascaded scorer uses hand-tuned thresholds (`core/cascaded-scorer.js:24`):
- `marginThreshold = 0.08` — fixed gap for decisive classification
- `std < 0.02` — fixed flatness threshold
- `ceTopK = 20` — fixed candidate count for cross-encoder
- Postprocess gates in `core/search-postprocess.js:202` also use fixed cutoffs

These can't adapt to different codebases, query types, or score distributions. A codebase
with tightly clustered MaxSim scores needs a different threshold than one with clear winners.

### Approach

**Phase A: KLL sketch over MaxSim score gaps (Codex recommendation)**
1. Maintain a KLL sketch (streaming quantile estimator) over MaxSim score gaps
2. Instead of fixed 0.08 threshold, use the p75 or p90 of the score gap distribution
3. The threshold auto-calibrates per codebase and query mode
4. KLL chosen over T-Digest for formal error guarantees and mergeability

**Phase B: Multi-signal adaptive thresholds**
- Separate KLL sketches per signal: margin gaps, flatness (std), token coverage ratios
- Each signal's threshold = quantile from its own distribution
- "This margin is in the top 90th percentile of margins I've seen" > "this margin > 0.08"

**Phase C: Adaptive ceTopK via Frequent Items + expansion fanout sketch**
- Track CE "rescue gain" (how much CE changes ranking) via CMS
- If CE rarely changes ranking for a query type → lower ceTopK (save compute)
- If CE frequently rescues → raise ceTopK (spend more where it matters)
- Track expansion fanout per edge type via KLL → adapt hop2 budget

### Key Files
- `core/cascaded-scorer.js:24` — `isDecisive()` (add KLL-based thresholds)
- `core/cascaded-scorer.js:156-172` — cascade bypass (currently `pure_reranker`)
- `core/search-postprocess.js:202` — postprocess gates (use adaptive thresholds)
- `core/config.js:965-976` — `CASCADE_CONFIG` (add KLL persistence config)

### Expected Impact
- 15-30% fewer unnecessary CE invocations on well-separated result sets
- Better CE allocation: spend CE budget where it actually rescues ranking
- Self-calibrating: no per-codebase threshold tuning needed
- KLL: ~2-4 KB per sketch, O(1) per update, O(log(1/ε)) per quantile query

### Benchmark Plan
```bash
# Baseline: run benchmark with fixed thresholds
node eval/run_benchmark.js --profile balanced --verbose

# A/B: run with KLL-adaptive thresholds (warmup period: first 50 queries)
# Compare: MRR@10, NDCG@10, CE invocation rate, latency_p50, latency_p95
# Key question: does adaptive gating match or beat fixed gating on MRR?
```

**Metrics to track:**
- CE invocation rate (% of queries that trigger cross-encoder)
- CE rescue rate (% of CE invocations that actually changed top-1)
- MRR@10, NDCG@10 (must not regress vs fixed threshold)
- Latency p50, p95 (should improve with fewer CE calls)
- Threshold convergence (how many queries until stable?)

### Risk Assessment
- **Medium risk.** Bad thresholds can either waste CE compute (too low threshold → always CE)
  or miss rescues (too high threshold → never CE). Need a warmup period.
- KLL is preferred over T-Digest (Codex recommendation): formal ε-guarantees, mergeable.
- Start with read-only shadow mode: compute KLL thresholds but use fixed thresholds for
  decisions. Log what *would* have happened. Compare after 500+ queries.

### Connection to CE Rescue Plan
This directly enables `docs/CE_RESCUE_PLAN.md`. The CE gate was disabled because the fixed
threshold (0.12) was poorly calibrated. Adaptive thresholds via KLL solve the root cause.

---

## Fix 3: Count-Min / Frequent-Items for Hot Query Adaptation

### Problem

Telemetry tracking (`core/embedding-telemetry.js:61`) uses JSONL files capped at 10K lines.
Cache hit counting (`core/embedding-cache.js:63`) uses exact Maps. Warmup metrics
(`core/warmup-metrics.js:158`) store full latency arrays. These are:
- Unbounded in memory (latency arrays grow forever within a session)
- Require file I/O for analysis (JSONL parsing for vocabulary mining)
- Cannot efficiently answer "what are the top-K hottest queries right now?"

### Approach

**Phase A: Frequent Items sketch for hot queries**
1. Apache DataSketches-style Frequent Items (or HeavyKeepers) for top-K tracking
2. As queries arrive, update sketch. O(1) per update, bounded memory.
3. At any time: "top-50 hottest queries" in O(K) — drives cache warming decisions
4. Replace `getFrequentQueries()` in `embedding-cache.js:48` with sketch query

**Phase B: Count-Min Sketch for term frequency tracking**
1. CMS (w=2048, d=5, ~40 KB) for per-term frequency estimation
2. Augment vocabulary mining (`core/vocab-miner.js`) with streaming frequency data
3. Hot terms → promote to vocabulary cache; cold terms → demote
4. Also tracks hot prefixes, hot translation pairs, hot graph-expansion patterns

**Phase C: Streaming latency percentiles via KLL**
1. Replace raw latency arrays in `WarmupMetrics` with KLL sketches
2. Per-mode p50/p90/p95/p99 in O(1) with bounded memory (~2 KB per sketch)
3. Serves warmup adaptive learning (Step 9) without unbounded memory growth

### Key Files
- `core/embedding-cache.js:48-54` — `getFrequentQueries()` (replace with sketch)
- `core/embedding-cache.js:63` — `QueryStats` class (add CMS integration)
- `core/embedding-telemetry.js:61` — `telemetryStats` (augment, don't replace logs)
- `core/warmup-metrics.js:15-17` — `latencies: []` arrays (replace with KLL)
- `core/vocab-miner.js` — vocabulary extraction (use CMS for term frequencies)

### Expected Impact
- Bounded memory for telemetry (KB instead of MB for long sessions)
- O(1) "top-K hot queries" — enables real-time adaptive cache warming
- Streaming p95 latency without storing all samples
- Better prewarm decisions → improved p95 latency for repeated queries

### Benchmark Plan
```bash
# Measure memory usage before/after for a 10K-query session
# Compare: memory_mb, hot_query_accuracy (vs exact counting), prewarm_hit_rate
# Validate: sketch top-50 vs exact top-50 overlap (should be >90%)
```

**Metrics to track:**
- Memory usage (bytes) for telemetry/metrics subsystem
- Hot query accuracy: overlap(sketch_top50, exact_top50) / 50
- Prewarm hit rate improvement (if using sketch-driven warmup)
- Latency percentile accuracy: |sketch_p95 - exact_p95| / exact_p95

### Risk Assessment
- **Low risk.** Sketches *augment* telemetry, not replace logs. JSONL logs remain for
  debugging; sketches provide real-time summaries.
- CMS always overestimates, never underestimates — safe for hot-query identification.
- Count-Min Sketch replacing logs entirely is too aggressive (Codex correctly flags this).

---

## Fix 4: HLL/HyperANF for Graph Expansion Planning

### Problem

Graph expansion (`core/graph-expansion.js:183`) traverses edges from seed entities to find
1-hop and 2-hop neighbors. The decision to expand (and how far) uses fixed heuristics:
- `HOP_DECAY = 0.6`, `HOP2_DECAY = 0.35` — fixed score decay
- `maxExpanded = 10`, `tokenBudget = 8000` — fixed limits
- `adaptiveHop2` flag with fixed `hop2TokenBudget = 4000`

The system has no way to estimate *how many distinct new entities* an expansion will yield
before actually traversing. Expanding a well-connected hub (e.g., a base class with 200
subclasses) wastes budget on diminishing returns.

### Approach (Codex's top paper idea: "HopHLL")

**Phase A: Per-entity HLL sketches (indexing time)**
1. During graph extraction, compute an HLL sketch per entity encoding its 1-hop neighborhood
2. Each sketch stores the approximate distinct count of reachable entities at hop-1
3. Storage: ~200 bytes per entity (HLL with 128 registers)
4. Persist in the code-graph SQLite DB as a BLOB column on the `entities` table

**Phase B: HyperANF-style multi-hop sketches**
1. Iterate: for each entity, union its HLL with its neighbors' HLLs → hop-2 estimate
2. The difference between hop-2 HLL cardinality and hop-1 HLL cardinality = "distinct gain"
3. This estimates how many *new* entities a 2nd hop would discover, without traversing

**Phase C: Sketch-conditioned expansion decisions**
1. Before expanding, query the HLL: "what's the estimated distinct gain per token for 2-hop?"
2. If gain is low (< 3 new entities) → skip 2-hop entirely (save the DB queries)
3. If gain is high but fanout is huge → cap expansion more aggressively
4. Per-edge-type sketches: estimate gain from `extends` vs `imports` vs `calls` separately

### Key Files
- `core/graph-expansion.js:183` — `expandResults()` (add sketch-based planning)
- `core/graph-expansion.js:318` — `expandOneHop()` (build sketches during indexing)
- `core/graph-expansion.js:373` — `expandSecondHop()` (use sketch for skip decision)
- `core/graph-search.js:1053` — graph query interface (store/retrieve HLL blobs)
- `core/graph-extractor.js` — graph extraction (compute HLL during extraction)

### Expected Impact
- Skip unnecessary 2-hop expansion for 40-60% of queries (low-gain cases)
- Save 2-10ms per skipped expansion (DB queries + scoring)
- Better budget allocation: spend expansion budget where distinct gain is highest
- HyperANF is ~200 bytes per entity × 10K entities = ~2 MB total

### Benchmark Plan
```bash
# Baseline: measure expansion behavior on CodeSearchNet corpus
# Log: per-query expansion_1hop_count, expansion_2hop_count, distinct_new_entities

# A/B: with HopHLL, skip 2-hop when estimated gain < threshold
# Compare: MRR@10, NDCG@10, expansion_latency_ms, budget_utilization
# Key: MRR must not regress; latency should drop on low-gain queries
```

**Metrics to track:**
- 2-hop skip rate (% of queries where HopHLL skips 2nd hop)
- Distinct gain estimation accuracy: |estimated - actual| / actual
- MRR@10, NDCG@10 (must not regress)
- Mean expansion latency (should decrease)
- False-skip rate (queries where 2-hop would have helped but was skipped)

### Risk Assessment
- **Medium risk.** HLL estimation error (~2%) could cause wrong skip/expand decisions.
- Mitigate: conservative threshold (skip only when estimated gain < 2 entities).
- HyperANF requires iterative computation during indexing (adds ~5-10% index time).
- Paper potential: "HopHLL: Sketch-Conditioned Graph Expansion for Code Search" — novel.

---

## Fix 5: Block-Max MaxSim Early Termination

### Problem

MaxSim scoring (`core/late-interaction-index.js:177`) computes per-query-token maximum
similarity over ALL document tokens:

```javascript
for (const queryToken of queryTokens) {       // |Q| iterations
  for (const docToken of docTokens) {          // |D| iterations (up to 2048)
    const sim = cosineSimilarity(queryToken, docToken);  // 64d dot product
    if (sim > maxSim) maxSim = sim;
  }
}
```

For a 256-token query against a 2048-token document: 524,288 cosine similarity computations.
This is the bottleneck when scoring 50 candidates after graph expansion.

### Approach (Novel — no existing literature applies WAND to MaxSim)

**Phase A: Block-level summary vectors (indexing time)**
1. During `add()`, partition each document's tokens into blocks of B=64 tokens
2. Per block, compute the maximum L2 norm of any token vector → `blockMaxNorm`
3. Store `blockMaxNorm` as metadata alongside the Int8 token embeddings
4. Storage overhead: 1 float per block ≈ 32 floats per 2048-token document (128 bytes)

**Phase B: Upper-bound pruning (query time)**
1. For each query token, compute its L2 norm: `queryNorm`
2. Upper bound on MaxSim contribution from block b: `queryNorm × blockMaxNorm[b]`
3. Score blocks in decreasing order of upper bound
4. If remaining blocks can't improve the current best MaxSim → stop early (safe termination)
5. Track the running "threshold" from the current top-k candidates

**Phase C: Two-level pruning**
1. Level 1 (document level): before scoring any tokens, compute the upper bound for the
   entire document using the global max token norm. Skip documents that can't enter top-k.
2. Level 2 (block level): within a document, skip blocks as described above.
3. This is analogous to Block-Max WAND but for late interaction instead of BM25.

### Key Files
- `core/late-interaction-index.js:116-145` — `add()` (compute block summaries)
- `core/late-interaction-index.js:177-194` — `maxSimScore()` (add early termination)
- `core/late-interaction-index.js:203-235` — `scoreWithLateInteraction()` (integrate)
- `core/cascaded-scorer.js` — cascade orchestration (passes candidates to MaxSim)

### Expected Impact
- 2-5x speedup on MaxSim scoring for long documents (>512 tokens)
- Zero accuracy loss (safe early termination — mathematically identical results)
- Largest impact on 2048-token documents with localized relevance
- Minimal overhead: 1 float per 64-token block during indexing

### Benchmark Plan
```bash
# Baseline: measure MaxSim scoring latency per document (log per-candidate timing)
# Vary document length: 64, 128, 256, 512, 1024, 2048 tokens

# A/B: with block-max pruning enabled
# Compare: maxsim_latency_per_doc, total_query_latency, blocks_evaluated_ratio
# Validate: bit-exact MaxSim scores (safe termination guarantee)
```

**Metrics to track:**
- MaxSim latency per document (μs) at each document length
- Blocks evaluated ratio (evaluated_blocks / total_blocks) — lower = better pruning
- Total query latency p50, p95
- Score correctness: assert bit-exact match with unpruned MaxSim on 100% of queries

### Risk Assessment
- **Medium risk.** Implementation complexity is moderate (block management + early exit logic).
- Zero accuracy risk if implemented correctly (mathematical guarantee).
- Biggest risk: JS overhead of block tracking may offset gains for short documents.
- Test on documents with 512+ tokens first; disable for shorter documents.
- **Paper-worthy:** "Block-Max MaxSim: Safe Early Termination for Late Interaction Models"
  — applies WAND principles to ColBERT-style scoring. No existing literature does this.
  Natural fit for SIGIR/CIKM/ECIR submission.

---

## Fix 6: HLL/Theta Sketches for Distinctness Telemetry

### Problem

Several subsystems need "how many distinct X?" answers:
- Distinct cache misses per session (for sizing decisions)
- Distinct files surfaced by hot queries (for warmup coverage)
- Overlap between lexical and semantic hit sets (for fusion tuning)
- Distinct query patterns per mode (for router evaluation)

Currently these are computed ad-hoc using Sets or log parsing.

### Approach

**Phase A: HLL counters for key cardinalities**
1. Per-session HLL: distinct queries, distinct cache misses, distinct files returned
2. Per-mode HLL: distinct query patterns for lexical/semantic/hybrid
3. Merge across sessions for long-term trend analysis
4. UltraLogLog variant for 28% space savings (Ertl, VLDB 2024)

**Phase B: Theta sketches for set operations**
1. Lexical hit set → Theta sketch; Semantic hit set → Theta sketch
2. Intersection/union/difference of sketches → overlap coefficient
3. If overlap is high → CC fusion is duplicating; if low → both paths contribute
4. Drives adaptive fusion alpha tuning per query mode

### Key Files
- `core/embedding-cache.js` — cache miss tracking (add HLL)
- `core/embedding-telemetry.js` — per-mode stats (add HLL per mode)
- `core/search-fusion.js:19-27` — `ROUTE_ALPHAS` (Theta-informed alpha tuning)
- `core/warmup-metrics.js` — warmup coverage (add HLL for distinct files)

### Expected Impact
- Per-session cardinality estimates in 1.5 KB per counter (vs unbounded Sets)
- Lexical/semantic overlap measurement → better fusion alpha selection
- Warmup coverage gaps identified automatically
- Mergeable across sessions for trend analysis

### Benchmark Plan
```bash
# Run 1000-query session, compare:
# HLL distinct count vs exact Set.size for each counter
# Expected: <2% error, >99% memory savings for long sessions
```

### Risk Assessment
- **Low risk.** Purely observational — sketches inform decisions, don't make them.

---

## Fix 7: Xor/Binary Fuse Filters for Immutable Membership

### Problem

Several components check membership against immutable sets:
- Vocabulary cache: "does this term have a pre-computed embedding?"
- Negative cache (future): "is this query known to return zero results?"
- Stop-word/skip-list: "should this token be skipped during indexing?"

Currently uses Map/Set lookups. These work but carry full key storage overhead.

### Approach

1. At index build time, construct an Xor filter (or Binary Fuse filter) from the vocabulary
2. At query time, check the filter first (3 memory accesses, ~1ns)
3. If filter says "not present" → guaranteed absent, skip the Map lookup entirely
4. If filter says "present" → proceed to Map lookup for the actual embedding

**Why Xor over Bloom:** Xor filters are faster (3 cache-parallel accesses vs k sequential),
smaller (~9 bits/element), and the static nature matches vocabulary lifecycle perfectly.

**Why not for small sets:** Per Codex, small mutable maps like `translation-cache.js:23` and
the tiny fast router in `query-router.js:92` are not worth complicating.

### Key Files
- `core/vocabulary-utils.js:33` — vocabulary config (add filter build step)
- `core/embedding-cache.js` — vocabulary cache lookup (add filter pre-check)

### Expected Impact
- Saves ~1-2μs per vocabulary miss (avoids Map lookup for absent terms)
- Useful only if misses dominate hits. Profile first.
- 100K-term vocabulary → ~110 KB Xor filter

### Benchmark Plan
```bash
# Profile vocabulary cache: what % of lookups are misses?
# If >50% miss rate: Xor filter is worth it
# If <20% miss rate: skip this fix (the Map is fine)
```

### Risk Assessment
- **Low risk.** Filter is a pre-check; correctness doesn't depend on it.
- Codex caveat: "weaker than it sounds because you still need the real map to retrieve
  embeddings; the filter only helps if misses dominate and storage is reworked."
- Only implement after profiling miss rate.

---

## Fix 8: Cuckoo Filter for Mutable Membership Sets

### Problem

Some components maintain mutable sets that are checked frequently:
- Translation cache (insert/delete as translations are learned)
- Active entity sets during graph traversal
- In-flight request deduplication

### Approach

1. Replace JavaScript `Set` with Cuckoo filter where deletion is needed
2. Cuckoo filter: 8 bits/element, supports insert + delete, 2x lookup vs counting Bloom
3. Use for large mutable sets (>1000 elements) only — small Sets are fine

### Key Files
- `core/embedding-cache.js` — inflight request dedup (evaluate)
- Translation cache (evaluate)

### Expected Impact
- Memory reduction for large mutable sets
- Likely marginal for this codebase's current scale

### Benchmark Plan
```bash
# Profile: which mutable sets exceed 1000 elements?
# If none: skip this fix. JS Sets are fast and correct.
```

### Risk Assessment
- **Low risk** but likely low payoff at current scale.
- DO NOT use Cuckoo filter for HNSW visited-set: false positives would silently hurt recall
  (both Claude and Codex agree on this).

---

## Fix 9: Attenuated Bloom Filters for Multi-Hop Reachability

### Problem

During 2-hop graph expansion (`core/graph-expansion.js:373`), the system performs SQL queries
to discover 2nd-hop neighbors. Many of these queries return entities already in the result set
or entities reachable via cheaper 1-hop paths.

### Approach (Claude's idea)

1. During indexing, build attenuated Bloom filters: D-level BFs per entity where level i
   encodes what's reachable i hops away
2. At query time, check reachability via BF lookup instead of SQL traversal

### Assessment

Codex correctly flags concerns:
- Per-entity multi-hop filters could **explode in space** — a hub entity with 200 1-hop
  neighbors, each with 100 2-hop neighbors, needs a very large BF at level 2
- False positives accumulate multiplicatively across hops
- Update story is poor: any edge change invalidates all downstream BFs

**Recommendation:** Prototype with HopHLL (Fix 4) first. If that works, *then* consider
attenuated BFs for the specific case of "is X reachable from Y?" queries. HopHLL answers
the more useful question ("how many new entities will I discover?").

### Risk Assessment
- **High risk.** Space explosion, FP accumulation, poor update story.
- Interesting for a paper but HopHLL (Fix 4) is the better practical approach.

---

## Fix 10: SimHash Diversity Proxy for MMR

### Problem

MMR (`core/mmr.js:42`) computes pairwise similarity between candidates using feature blending
(file 0.4, type 0.2, package 0.2, semantic 0.2). For K candidates, this is O(K²).

### Approach

1. Compute 64-bit SimHash per result (from content tokens)
2. Hamming distance between SimHash fingerprints ≈ 1 - cosine similarity
3. Use as fast diversity proxy: O(1) per pair instead of feature blending
4. Falls back to full feature blending only for close SimHash distances

### Assessment

- MMR maxCandidates is 100 → O(100²) = 10K comparisons. Already fast (~1ms).
- SimHash proxy would save ~0.5ms at best. Probably not worth the complexity.
- More interesting if candidate sets grow larger (>500 candidates).

### Risk Assessment
- **Medium risk.** SimHash captures content similarity but not file/type/package similarity,
  which are the dominant MMR features (0.6 weight combined).

---

## Fix 11: LSH-Accelerated Semantic Cache

### Problem

Semantic cache (`core/embedding-cache.js:63`) does brute-force cosine similarity against up
to 500 cached embeddings on every cache miss. At 256d with 500 entries: 128K multiply-adds.

### Approach

1. Multi-probe LSH on 256d Matryoshka-truncated embeddings
2. Hash each cached embedding into LSH buckets
3. On a query, hash and compare only within same/neighboring buckets
4. Reduce comparisons from 500 to ~20-50 (90% reduction)

### Assessment

- 500 entries at 256d: brute-force takes ~50μs. Already fast.
- LSH setup overhead (hash computation) may exceed brute-force time at 500 entries.
- Only valuable if cache grows to 5000+ entries.

### Risk Assessment
- **Medium risk.** Overhead may exceed savings at current cache size.

---

## Fix 12: Reservoir Sampling for Telemetry

### Problem

Telemetry logs all queries to JSONL (`core/embedding-telemetry.js:15`), capped at 10K lines
but still requiring full file parsing for analysis.

### Approach

1. Maintain a reservoir of K=1000 representative queries (Vitter, 1985)
2. Each new query replaces a random existing one with probability K/n
3. Guaranteed uniform random sample for analysis without unbounded log growth

### Assessment

- Telemetry already caps at 10K lines with periodic flush.
- Reservoir sampling would reduce this to 1K with statistical representativeness.
- Nice-to-have, not critical. Better paired with Fix 3 (Frequent Items).

### Risk Assessment
- **Low risk.** No accuracy impact on search results.

---

## Fix 13: Spectral Bloom Filters for Term Significance

### Problem

Boost policy (`core/search-boost.js`) applies static multipliers. It doesn't know how
significant a query term is within a matched document.

### Approach

1. During indexing, build a Spectral Bloom Filter per document encoding term frequencies
2. At query time, look up approximate TF for query terms
3. Use approximate TF to modulate boost: frequent terms → utility signal,
   rare terms → unique definition signal

### Assessment

- Interesting research direction but complex to implement and evaluate.
- The existing boost policy works well for code search (definitions are naturally rare).
- Better as a paper contribution than a production feature.

### Risk Assessment
- **Medium risk.** May hurt more than help if TF estimation is noisy for code.

---

## Fix 14: Learned Bloom Filter for Route Fast-Path

### Problem

CatBoost WASM (`core/query-router.js:42`) runs 499 trees for every query (~10μs). Many
queries are trivially classifiable (single identifier → lexical, NL sentence → semantic).

### Approach

1. Train a lightweight ML model (logistic regression) as a fast-path classifier
2. If confident → bypass CatBoost (save ~8μs)
3. Backup Bloom filter catches false negatives

### Assessment

Codex correctly flags: "probably not worth it when CatBoost is already around 10 microseconds."
- CatBoost at 10μs is already extremely fast.
- Adding a learned BF layer adds complexity for <10μs savings.
- Only interesting as a research prototype.

### Risk Assessment
- **Medium risk.** Complexity vs. marginal gain doesn't justify production deployment.

---

## Fix 15: Early-Exit Cross-Encoder Layers

### Problem

When the cascade invokes the cross-encoder (`core/local-reranker.js`, gte-reranker-modernbert-base,
149M params), it runs ALL 12 transformer layers for every query-document pair. But many pairs are
obviously irrelevant after just 3-4 layers — the intermediate representation already shows low
relevance, yet the model continues computing through all remaining layers.

This is **distinct from Fix 5** (Block-Max MaxSim): Fix 5 decides *which documents* to score;
Fix 15 decides *how deeply* to score each document within the CE itself.

### Approach

Based on Busolin et al., "Efficient Re-ranking with Cross-encoders via Early Exit" (SIGIR 2025):

**Phase A: Confidence-based early exit**
1. After each transformer layer, add a lightweight classifier head (linear layer)
2. If the classifier is confident the document is irrelevant → stop, return low score
3. Only run full 12 layers for ambiguous or high-relevance pairs
4. Expected: 60-80% of CE compute saved on irrelevant documents

**Phase B: Nested prediction sets (UAI 2024)**
1. Use anytime-valid confidence sequences (AVCSs) to maintain consistency across exits
2. Ensures that early-exit scores are calibrated against full-model scores
3. Jazbec et al., "Early-Exit Neural Networks with Nested Prediction Sets"

### Key Files
- `core/local-reranker.js` — CE model integration (add early-exit inference)
- `core/flashrank.js:590-601` — `rerankDirect()` interface
- `core/cascaded-scorer.js` — cascade orchestration (receives CE scores)
- `core/onnx-session-utils.js` — ONNX Runtime session config (modify for partial execution)

### Expected Impact
- 60-80% reduction in CE latency for obviously-irrelevant pairs
- No accuracy loss on relevant documents (they still get full scoring)
- Enables increasing ceTopK (more candidates with same latency budget)

### Benchmark Plan
```bash
# Baseline: CE latency per document at ceTopK=20
# A/B: with early-exit at layers 4/6/8
# Compare: CE_latency_per_doc, total_CE_latency, MRR@10 (must not regress)
# Validate: score correlation between early-exit and full-model scores
```

### Risk Assessment
- **Medium risk.** Requires ONNX model modification or custom inference loop.
- Early-exit classifiers need training data (which layer is sufficient for each pair).
- May require fine-tuning the CE model with exit heads — non-trivial.
- Strong paper potential when combined with Fix 5: "end-to-end probabilistic pruning."

---

## Fix 16: Conformal Prediction for Result Set Sizing

### Problem

Sweet Search returns a fixed top-k result set. But the *appropriate* number of results varies
per query: some queries have 1 relevant document, others have 50. Returning too many dilutes
precision; returning too few misses relevant results.

### Approach

Based on arXiv 2404.17769 (2024), "Two-stage Conformal Risk Control":

**Phase A: Conformal retrieval sets**
1. Use conformal prediction to determine, per query, how many results to return
2. Calibrate on a held-out set: for each score threshold, measure empirical coverage
3. At query time: find the smallest result set that guarantees ≥95% recall with probability ≥90%
4. This is a formal statistical guarantee, not a heuristic

**Phase B: Distribution-informed scoring**
1. Use the score distribution (via KLL from Fix 2) to derive non-conformity scores
2. Conformal threshold adapts to the query's score distribution shape
3. arXiv 2601.23128 (2025): "Distribution-informed Efficient Conformal Prediction for Full Ranking"

### Key Files
- `core/cascaded-scorer.js` — cascade output (add conformal set sizing)
- `core/search-postprocess.js` — post-processing (apply conformal truncation)

### Expected Impact
- Queries with 1 relevant result → return 3-5 instead of 20 (precision ↑)
- Queries with 50 relevant results → return 30+ instead of 20 (recall ↑)
- Formal statistical guarantee on result set quality

### Benchmark Plan
```bash
# Requires held-out calibration set (100+ queries with relevance judgments)
# Measure: coverage (fraction of queries where relevant doc is in returned set)
# Compare: precision@k, recall@k, set size distribution
```

### Risk Assessment
- **High risk.** Requires calibration data and careful statistical reasoning.
- Pure research direction — unlikely to be production-ready without significant validation.
- Strong paper potential: "Conformal Code Search: Statistically-Guaranteed Result Sets"

---

## Fix 17: Persistent Embedding Negative Cache

### Problem

The embedding service (`core/embedding-service.js`) makes API calls for every cache miss.
Across sessions, the same "miss" queries (terms not in the vocabulary and not previously
embedded) trigger repeated API calls. There's no persistent record of "this text has already
been embedded and cached."

This is distinct from Fix 7 (vocabulary membership): Fix 7 checks if a *pre-computed* vocab
term exists. Fix 17 checks if a query has *ever been embedded before* (cross-session).

### Approach

1. Maintain a persistent Xor filter (or Binary Fuse filter) of all previously embedded texts
2. At startup, load the filter (~110 KB for 100K entries)
3. Before making an API call, check the filter:
   - If "seen before" → the embedding should be in the LRU cache or on disk
   - If "never seen" → guaranteed first-time query, API call is necessary
4. Update the filter during indexing and after API calls
5. Since Xor filters are static, rebuild periodically (e.g., after each indexing run)

### Key Files
- `core/embedding-service.js` — API call path (add filter check before API)
- `core/embedding-cache.js` — cache management (build filter from cache contents)
- `core/vocabulary-utils.js` — vocabulary build (include filter generation)

### Expected Impact
- Eliminates redundant API calls for queries that were embedded in prior sessions
  but evicted from LRU cache
- Most valuable for vocabulary-style repeated queries (entity names, function names)
- Filter size: ~9 bits/element × 100K = ~110 KB

### Benchmark Plan
```bash
# Profile: what % of API calls are for previously-seen texts?
# Run two consecutive indexing+search sessions on same codebase
# Measure: API calls in session 2 with vs without negative cache
```

### Risk Assessment
- **Low risk.** Filter is a hint, not authoritative. False positive (filter says "seen"
  but embedding isn't available) just triggers a cache miss → API call (existing path).

---

## Fix 18: RGS Budget-Constrained Reranking

### Problem

The cascade allocates a fixed ceTopK=20 candidates to the cross-encoder. This is a uniform
budget regardless of query difficulty. Easy queries waste CE compute on already-correct
rankings; hard queries could benefit from scoring more candidates.

### Approach

Based on arXiv 2509.07163 (2025), "Reranker-Guided Search (RGS)":

**Phase A: Greedy reranker-guided candidate selection**
1. Instead of scoring the top-20 candidates in order, use the reranker's preferences
   to *guide* which candidates to score next
2. Start with 5 candidates, score them, use scores to decide which 5 to score next
3. Stop when scoring more candidates shows diminishing returns
4. Achieved +3.5 MRR on BRIGHT benchmark within same 100-document budget

**Phase B: Bayesian optimization of CE budget**
1. Model the CE "rescue probability" as a function of query features + score distribution
2. Allocate more CE budget to queries with high rescue probability (from Fix 2 KLL sketch)
3. Reduce CE budget for queries where MaxSim is already confident

### Key Files
- `core/cascaded-scorer.js` — cascade orchestration (replace fixed ceTopK with adaptive)
- `core/search-postprocess.js:202` — cascade invocation point

### Expected Impact
- +2-5 MRR points on difficult queries (more CE budget where it matters)
- -30% total CE compute (less budget wasted on easy queries)
- Integrates naturally with Fix 2 (KLL adaptive thresholds)

### Benchmark Plan
```bash
# A/B: fixed ceTopK=20 vs RGS-style adaptive budgeting
# Compare: MRR@10, NDCG@10, CE_calls_total, CE_calls_per_query_distribution
```

### Risk Assessment
- **Medium risk.** Requires iterative CE invocation (multiple rounds instead of batch).
- Latency may increase for individual queries even if total CE compute decreases.
- Pair with Fix 15 (early-exit CE) to mitigate per-invocation latency.

---

## Fix 19: Skip List for Score-Sorted Candidate Management

### Problem

Score fusion (`core/search-fusion.js`) and candidate management sort arrays of results by
score. When candidates arrive incrementally (e.g., during streaming retrieval or iterative
scoring), each insertion requires re-sorting or finding the insertion point via binary search.

### Approach

1. Use a probabilistic skip list to maintain candidates in sorted order
2. O(log n) insertion, deletion, and lookup
3. Pugh, 1990: "Skip Lists: A Probabilistic Alternative to Balanced Trees"
4. Used in Redis sorted sets and LevelDB MemTables

### Assessment

- Current approach (array sort) is O(n log n) but n is small (~100-500 candidates).
- Skip list would help only if insertion is incremental and frequent.
- Not worth it at current scale; revisit if candidate sets grow past 10K.

### Risk Assessment
- **Low risk** but marginal benefit at current scale.

---

## Probabilistic Cascade Architecture (Unifying Vision)

This section synthesizes all fixes into an end-to-end architecture where each pipeline
stage uses the cheapest probabilistic structure whose error is tolerable at that stage.

```
Query arrives
  │
  ├─ Layer 0: Xor Filter              (~1ns)    [Fix 7]
  │           "Does this term exist in vocabulary at all?"
  │           If not → skip vocabulary lookup entirely
  │
  ├─ Layer 1: Persistent Neg Cache     (~1ns)    [Fix 17]
  │           "Has this query ever been embedded?"
  │           If never → API call is unavoidable, skip cache search
  │
  ├─ Layer 2: CatBoost WASM            (~10μs)   [existing]
  │           Route: lexical / semantic / hybrid
  │
  ├─ Layer 3: Binary HNSW              (~100μs)  [existing]
  │           Coarse ANN retrieval (top-1000)
  │           Int8 rescore (top-100)
  │
  ├─ Layer 4: SimHash dedup            (~1μs)    [Fix 1]
  │           Near-duplicate suppression in candidate set
  │
  ├─ Layer 5: Block-Max MaxSim         (~1ms)    [Fix 5]
  │           Late interaction with safe block-level early termination
  │           Score blocks in decreasing upper-bound order
  │
  ├─ Layer 6: KLL adaptive gate        (~1μs)    [Fix 2]
  │           "Is MaxSim confident?" (quantile-relative threshold)
  │           ├─ Confident → skip CE, return MaxSim ranking
  │           └─ Unsure → proceed to CE with RGS budget [Fix 18]
  │
  ├─ Layer 7: Early-Exit CE            (~5-50ms) [Fix 15]
  │           Cross-encoder with per-layer confidence exits
  │           RGS guides which candidates to score next [Fix 18]
  │
  ├─ Layer 8: HopHLL expansion         (~1μs)    [Fix 4]
  │           "How many distinct entities will 2-hop yield?"
  │           ├─ Low gain → skip 2-hop
  │           └─ High gain → expand with per-edge-type budgets
  │
  ├─ Layer 9: Graph expansion          (~2-10ms) [existing]
  │           1-hop and conditional 2-hop traversal
  │
  ├─ Layer 10: Conformal set sizing    (~1μs)    [Fix 16]
  │            Statistical guarantee on result set size
  │
  ├─ Layer 11: MMR diversity           (~1ms)    [existing]
  │            Diversity-aware reranking
  │
  └─ Layer 12: Telemetry sketches      (~1ns)    [Fix 3, 6]
               CMS: update term frequencies
               HLL: update cardinality counters
               KLL: update latency quantiles
               Frequent Items: update hot query tracking
```

### Design Principle: Error Tolerance Gradient

Each layer uses a probabilistic structure whose error guarantee matches the *cost of being
wrong* at that stage:

| Layer | Error Type | Cost of Error | Acceptable FPR |
|-------|-----------|---------------|----------------|
| 0 (Xor filter) | False positive | Unnecessary Map lookup (~1μs) | 1% |
| 1 (Neg cache) | False positive | Unnecessary cache search (~10μs) | 1% |
| 4 (SimHash) | False dedup | Reuse wrong embedding (slight quality loss) | 0.1% |
| 5 (Block-Max) | None | Safe termination = zero error | 0% |
| 6 (KLL gate) | Wrong threshold | Wasted CE or missed rescue (~50ms) | 5-10% |
| 8 (HopHLL) | Wrong skip | Missed expansion results (recall loss) | 2% |
| 10 (Conformal) | Under-coverage | Missing relevant results | 5-10% (calibrated) |
| 12 (Sketches) | Estimation error | Suboptimal warmup/adaptation | 5-10% |

The gradient property: early layers (cheap operations) tolerate higher FPR because the cost
of a false positive is just "do slightly more work." Late layers (expensive operations) need
lower FPR because errors affect result quality directly.

### Paper Potential

**"Error-Tolerant Probabilistic Cascades for Code Search"**

No existing paper formalizes error propagation through a cascade of heterogeneous probabilistic
structures. The contribution would be:
1. Formal model of how FPR at each stage compounds through the pipeline
2. Optimal FPR allocation given a total error budget and per-stage cost function
3. Empirical evaluation showing that individually-cheap structures compose into
   significant system-level improvements

This subsumes Paper Candidates #4 (Sketch-Conditioned Cascade) and adds the theoretical
framework for error propagation.

---

## Implementation Order

### Phase 1: Low-Hanging Fruit (Weeks 1-2)
1. **Fix 3A** — Frequent Items sketch for hot queries (augments, doesn't replace)
2. **Fix 6A** — HLL counters for distinctness telemetry
3. **Fix 3C** — KLL sketches for streaming latency percentiles in WarmupMetrics
4. **Fix 17** — Persistent embedding negative cache (Xor filter, cross-session)

### Phase 2: Core Improvements (Weeks 3-4)
5. **Fix 1A** — SimHash fingerprints during chunking
6. **Fix 2A** — KLL sketch over MaxSim gaps (shadow mode first)
7. **Fix 7** — Xor filter for vocabulary membership (after profiling miss rate)

### Phase 3: Experimental Prototypes (Weeks 5-8)
8. **Fix 5** — Block-Max MaxSim early termination (paper candidate)
9. **Fix 4** — HopHLL for graph expansion planning (paper candidate)
10. **Fix 1C** — MinHash cluster-level dedup (paper candidate)
11. **Fix 2C** — Adaptive ceTopK via Frequent Items + expansion fanout
12. **Fix 15** — Early-Exit CE layers (requires ONNX model work)
13. **Fix 18** — RGS budget-constrained reranking (pairs with Fix 2)

### Phase 4: Evaluate & Research (Ongoing)
14. **Fix 8** — Cuckoo filter (if mutable sets grow large)
15. **Fix 10** — SimHash MMR diversity proxy (if candidate sets grow)
16. **Fix 11** — LSH semantic cache (if cache grows past 5K)
17. **Fix 9** — Attenuated BF (after HopHLL validates the approach)
18. **Fix 12** — Reservoir sampling (pair with Fix 3)
19. **Fix 19** — Skip List for candidates (if sets grow past 10K)
20. **Fix 13** — Spectral Bloom (research only)
21. **Fix 14** — Learned Bloom route fast-path (research only)
22. **Fix 16** — Conformal prediction result sizing (research, needs calibration data)

---

## Paper Candidates (Ranked)

### 1. Block-Max MaxSim (Fix 5) — STRONGEST
**Title:** "Block-Max MaxSim: Safe Early Termination for Late Interaction Models"
**Venue:** SIGIR, CIKM, or ECIR
**Novelty:** Applies Block-Max WAND principles (well-established for BM25) to ColBERT-style
late interaction scoring. No existing paper does this.
**Contribution:** Mathematical proof of safe termination + empirical evaluation on code search.

### 2. HopHLL for Graph Expansion (Fix 4) — STRONG
**Title:** "HopHLL: Sketch-Conditioned Graph Expansion for Code Search"
**Venue:** SIGIR, WWW, or EMNLP (code/SE track)
**Novelty:** Using HyperANF-style sketches to estimate distinct expansion gain before traversal.
No existing paper applies this to code search graph expansion.
**Contribution:** Formal analysis of sketch accuracy vs expansion quality.

### 3. Near-Duplicate-Aware Code Search (Fix 1C) — STRONG
**Title:** "Near-Duplicate-Aware Code Search: Cluster, Index Exemplars, Re-Expand After Ranking"
**Venue:** ICSE, FSE, or ASE (SE venues)
**Novelty:** MinHash clustering of code chunks → index exemplars → re-expand siblings after
ranking. The "index exemplars" approach is novel for code search.
**Contribution:** Precision improvement + embedding cost reduction + scalability analysis.

### 4. Sketch-Conditioned Cascade (Fixes 2+3+4 combined) — AMBITIOUS
**Title:** "Sketch-Conditioned Cascaded Retrieval: Adaptive Budgeting via KLL, CMS, and HLL"
**Venue:** SIGIR or WWW
**Novelty:** End-to-end framework where cascaded scoring thresholds, cross-encoder budgets,
and graph expansion decisions are all driven by streaming sketches.
**Contribution:** Unifying framework + empirical evaluation on code search.

### 5. Error-Tolerant Probabilistic Cascades (Full Architecture) — MOST AMBITIOUS
**Title:** "Error-Tolerant Probabilistic Cascades for Code Search"
**Venue:** SIGIR, VLDB, or ICDE
**Novelty:** Formalizes error propagation through heterogeneous probabilistic structures in a
search cascade. Optimal FPR allocation given total error budget and per-stage cost.
**Contribution:** Theoretical framework + empirical validation that individually-cheap
structures compose into significant system-level gains. No existing paper does this.

### 6. Conformal Code Search (Fix 16) — THEORETICAL
**Title:** "Conformal Code Search: Statistically-Guaranteed Result Sets for RAG Pipelines"
**Venue:** NeurIPS, ICML, or AAAI
**Novelty:** Applying conformal prediction to code search result set sizing with formal coverage
guarantees. Extends recent conformal IR work (arXiv 2404.17769) to the code search domain.
**Contribution:** Formal guarantees on retrieval quality for downstream LLM consumption.

---

## What NOT to Do

Per combined analysis from both Claude and Codex:

1. **DO NOT** put Bloom-like filters inside the 3-stage semantic core
   (`core/search-semantic.js`). HNSW + Int8 + MaxSim/CE is already approximate; adding
   another approximate gate is more likely to hurt recall than help latency.

2. **DO NOT** replace exact change detection in `core/incremental-tracker.js` with
   probabilistic filters. Exact hashing is correct, cheap, and necessary for integrity.

3. **DO NOT** use Cuckoo/Bloom filters for HNSW visited-set tracking. Any false positive
   silently hurts recall by skipping valid graph nodes.

4. **DO NOT** expect Bloom/HLL/CMS alone to "increase accuracy." Their value is latency,
   memory, adaptation, and dedup. Accuracy gains are indirect.

5. **DO NOT** replace JSONL telemetry logs with sketches. Augment them — logs are needed
   for debugging; sketches provide real-time summaries.

6. **DO NOT** add complexity to small, fast components (query router at 10μs, translation
   cache at <100 entries). The overhead of probabilistic structures exceeds their benefit
   at small scale.

---

## Dependencies

- **NPM packages to evaluate:**
  - `bloom-filters` — Bloom, Cuckoo, XOR filter implementations
  - `hyperloglog` or custom — HLL/UltraLogLog
  - `datastructures-js` — various probabilistic structures
  - Consider native WASM implementations for hot-path structures (Xor filter, KLL)
  - Or implement from scratch in JS (~100-200 lines each for simple variants)

- **Benchmark infrastructure:** `eval/run_benchmark.js` with CodeSearchNet dataset
  - Metrics: MRR@10, NDCG@10, Recall@5, Recall@20, latency p50/p95
  - A/B comparison framework: baseline vs probabilistic variant
  - Need per-query timing breakdown (routing, retrieval, scoring, expansion, MMR)

---

## Success Criteria

| Metric | Baseline | Target | Hard Constraint |
|--------|----------|--------|-----------------|
| MRR@10 | current | ≥ current | Must not regress |
| NDCG@10 | current | ≥ current | Must not regress |
| Recall@20 | current | ≥ current | Must not regress |
| Latency p50 | current | -10-30% | — |
| Latency p95 | current | -15-40% | — |
| Embedding API calls (indexing) | current | -10-30% | — |
| Index size | current | -5-15% | — |
| Memory (telemetry/metrics) | current | -50-80% | — |
| CE invocation rate | current | -15-30% | MRR must hold |
