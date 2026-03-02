# Sweet Search TODO

Tracked gaps, vulnerabilities, and future work. Items are ordered by priority
within each section. Updated 2026-02-23 with completed items removed.

## Full Benchmark Baseline (2026-02-19)

20,262 queries across 8 benchmarks, ~4 hours wall time. Zero errors.

**Profile**: `balanced` — NO late interaction (disabled at index+query time), WITH cascaded
reranking (FlashRank TinyBERT → GTE-ModernBERT-Base INT8).

**Embedding model**: CodeRankEmbed INT8 (`mrsladoje/CodeRankEmbed-onnx-int8`, 137M,
768d → 512d HNSW). Code-specialized, NOT a general-purpose embedder.

| Benchmark | Queries | MRR@10 | NDCG@10 | R@10 | S@1 | p50 lat |
|-----------|---------|--------|---------|------|------|---------|
| AdvTest | 1,000 | 91.5% | 92.6% | 95.8% | 88.8% | 268ms |
| GenCodeSearchNet | 6,000 | 79.2% | 81.4% | 88.4% | 73.8% | 406ms |
| CosQA | 100 | 70.5% | 71.9% | 76.0% | 67.0% | 242ms |
| CodeSearchNet | 1,200 | 66.4% | 69.2% | 77.8% | 60.6% | 191ms |
| CLARC | 995 | 60.6% | 64.7% | 77.8% | 52.0% | 309ms |
| COIR | 4,500 | 57.3% | 59.3% | 65.4% | 53.4% | 160ms |
| CoQuIR | 2,467 | 44.4% | 46.5% | 53.1% | 40.3% | 278ms |
| CrossCodeEval | 4,000 | 12.0% | 14.8% | 23.6% | 7.4% | 146ms |

CodeSearchNet per-language: Go 93.6%, Python 76.6%, Ruby 75.0%, PHP 66.8%,
JavaScript 51.7%, Java 34.8%.

GenCodeSearchNet per-language: Go 93.6%, Python 89.8%, Java 79.0%, PHP 74.7%,
Ruby 72.4%, JavaScript 65.5%.

Results: `eval/results/all_benchmarks_2026-02-19T00-17-05-442Z.json`

---

## P2 Review Summary (2026-02-17)

| Item | Grade | Real? | Integrated? | Used by default? |
|------|-------|-------|-------------|------------------|
| SEISMIC Sparse Index | A code / F integration | Yes (complete algorithm) | No (dead code) | No |
| Intent Router | B+ | Yes | Yes (full pipeline) | DISABLED (was auto) |
| Quality Scorer | C+ | Yes (6 factors) | Yes (but qualityWeight=0) | No (disabled) |
| tags.scm (P2.4) | B- | Partial (hand-written queries) | Yes (in tree-sitter provider) | Yes (for 5 langs) |
| 2-Hop Adaptive Expansion | B+ | Yes | Yes (SOTA scoring, enabled by default) | Yes (adaptiveHop2=true) |

**No P2 item has been A/B tested against a baseline.**

---

## 0. Late Interaction: Upgrade to LateOn-Code + Enable by Default

**Status**: Late interaction infrastructure is complete (`core/late-interaction-index.js`,
`core/late-interaction-model.js`). Model upgraded from Jina ColBERT v2 to LateOn-Code
(2026-03-01). Rename from `colbert` → `late-interaction` complete across all code.
Phase 1 ONNX validation PASSED (both models). Projection gap FIXED (defensive fallback
for manual projection, verified baked in ONNX). DISABLED in all benchmark runs
(`buildLateInteraction: false, useLateInteraction: false` in the `balanced` profile).
Blend weight (α=0.3) untested with real MaxSim scores — see Section 28.6.

### 0.1 Model Upgrade: DONE (2026-03-01)

~~Jina ColBERT v2 (560M, 2024) has been superseded by~~ **COMPLETED** — upgraded to
LateOn-Code (LightOn AI, released 2026-02-12):

| Model | Size | MTEB Code v1 Avg | CSN MRR | Architecture |
|-------|------|------------------|---------|--------------|
| LateOn-Code | 149M | 74.12 | 89.6% | ModernBERT + PyLate |
| EmbeddingGemma-300M | 300M | 68.76 | — | Gemma |
| LateOn-Code-edge | 17M | 66.64 | 86.9% | ModernBERT (small) |
| Jina ColBERT v2 (old) | 560M | < LateOn | — | XLM-RoBERTa |

Key facts:
- LateOn-Code is purpose-built for **text→code** retrieval (trained on CoRNStack:
  docstring queries → code functions). Covers Go, Java, JS, PHP, Python, Ruby.
- Training modality: NL queries → code documents. Exactly matches Sweet Search's
  primary use case (agents write NL queries, search returns code).
- 149M params — almost identical to CodeRankEmbed (137M).
- ONNX exports have projection layers baked in (verified by Phase 1 validation).
- Full model: 128d tokens, p50=9.8ms, discrimination=0.6275.
- Edge model: 48d tokens, p50=2.1ms, discrimination=0.4454.
- Config: `LATE_INTERACTION_CONFIG` in `core/config.js` with both model variants.

### 0.2 Expected Impact on Benchmark Scores

Late interaction adds token-level matching on top of chunk-level
embeddings. This helps most when:
- Queries contain specific identifiers that dense embeddings average away
- Code has verbose signatures (Java `AbstractFactoryBuilder.createWidget()`)
- Language has many synonymous patterns (JS `function`/`=>`/`class method`)

**Estimated MRR deltas from enabling late interaction (conservative):**

| Benchmark | Current MRR | Expected w/ LateInteraction | Delta | Confidence |
|-----------|-------------|---------------------|-------|------------|
| Java (CSN) | 34.8% | 50-60% | +15-25 | HIGH — Java benefits most from token matching |
| JavaScript (CSN) | 51.7% | 60-68% | +8-16 | MEDIUM — helps with identifier matching |
| JavaScript (GCSN) | 65.5% | 72-78% | +7-13 | MEDIUM |
| CodeSearchNet avg | 66.4% | 72-78% | +6-12 | MEDIUM |
| CrossCodeEval | 12.0% | 15-20% | +3-8 | LOW — fundamentally different task |
| AdvTest | 91.5% | 92-94% | +0.5-2.5 | LOW — already near ceiling |

**Late interaction is NOT a magic bullet.** It helps with precision (finding the
exact right function) more than recall. The biggest wins will be on Java and
JavaScript where identifier matching matters. For Go (93.6%) and Python (76.6%),
gains will be smaller because dense embeddings already capture them well.

The LateOn-Code edge model (17M) could also be interesting as a lightweight
alternative — 66.64 MTEB score is still better than Jina ColBERT v2 at ~13x fewer
parameters, meaning near-zero latency overhead.

### 0.3 Action Items

- [x] ~~ONNX export of LateOn-Code~~ — DONE. Both models use pre-exported ONNX
  (`model_int8.onnx` for full, `model.onnx` for edge). Downloaded from HuggingFace.
- [x] ~~Update config model~~ — DONE. `LATE_INTERACTION_CONFIG` in `core/config.js`.
- [x] ~~Evaluate LateOn-Code-edge~~ — DONE. Phase 1 validation passed both models.
- [x] ~~Rename colbert → late-interaction~~ — DONE. 31 files, zero backward compat.
- [x] ~~Fix projection gap~~ — DONE. Defensive fallback in `late-interaction-model.js`.
- [ ] **Run Phase 5 benchmarks**: CodeSearchNet + GenCodeSearchNet with late
  interaction enabled. Measure per-language MRR delta. See Section 28.6 for blend
  weight tuning plan.
- [ ] **If Java MRR improves >10 points**: Enable late interaction in the `balanced`
  profile by default (`buildLateInteraction: true, useLateInteraction: true`).
- [ ] **Measure late interaction indexing cost**: LateOn-Code encodes entire chunks
  (not per-line). For 1200 chunks at p50=9.8ms → ~12 seconds total. Edge model
  at p50=2.1ms → ~2.5 seconds. Verify in practice.

### 0.4 Priority

**HIGH** — This is the single highest-ROI improvement available. Infrastructure is
complete and validated. Only remaining work is benchmarking (Phase 5) and blend weight
tuning (Section 28.6).

---

## 1. Quality Scorer: Benchmarking + SONA Self-Learning

**Status**: Fully implemented but disabled (`qualityWeight` defaults to 0).

### 1.1 Benchmark qualityWeight Values

The quality scorer (`core/quality-scorer.js`) computes 6 factors (testProximity,
recency, centrality, commentDensity, complexity, sizeScore) but has never been
benchmarked against the eval harness.

**Action items:**
- [ ] Run eval harness with `qualityWeight: 0, 0.05, 0.1, 0.2` on CodeSearchNet
- [ ] Measure Recall@5, Recall@20, MRR delta for each value
- [ ] Gate default change on statistically significant MRR improvement (+1-2 pts)
- [ ] If positive: change default from 0 to the best-performing value

### 1.2 Known Implementation Issues

- PageRank lazy-loading via `setRepoMapModule()` has a fragile circular dependency.
  If `QualityScorer` is instantiated outside `sweet-search.js`, it crashes.
- Comment regex `/^\s*(\/\/|#(?!!)|\/\*|\*(?!\/)|\*\/)/` is fragile for
  multi-language detection: Python `#!` hashbang incorrectly skipped, SQL comments
  (`--`) not recognized, multi-line block comments in some languages missed.
- Complexity threshold of 20 branching keywords is arbitrary -- no justification.

### 1.3 SONA Self-Learning for Per-Codebase Weight Tuning

Quality factor importance varies per codebase. A well-tested repo benefits from high
`testProximity` weight; a legacy codebase with sparse tests should lower it. Fixed
global weights can't capture this.

**Proposed approach:**
- Store per-codebase quality weight profiles in AgentDB memory (keyed by repo
  fingerprint: git origin URL + file count + language distribution).
- On init: load codebase-specific weights if available, else fall back to defaults.
- After agent task completion: use SONA trajectory tracking to adjust weights based
  on whether quality-weighted results contributed to task success.
- Convergence: over time, each project develops its own optimal weight profile.
- Per-factor learning (not just the global `qualityWeight` scalar): learn optimal
  weights for all 6 individual factors.

**Prerequisites:**
- Benchmarking (1.1) must be done first to establish a baseline.
- SONA trajectory hooks must be wired to the search pipeline's success signal.

---

## 2. Intent Router: Disabled, Needs CatBoost Model + Benchmarking

**Status**: DISABLED in `sweet-search.js` (2026-02-17). Code preserved in
`core/intent-router.js` for future reintegration.

### 2.1 Why Disabled

The keyword-based classifier has fundamental limitations:
- No multilingual support (non-English queries get `general` intent always)
- No synonym coverage ("defect" matches nothing, only "bug"/"error"/"crash")
- Can't disambiguate context ("fix security bug" vs "fix bug in security module")
- **No benchmark showing it actually improves search quality.** Intent routing may
  help or hurt Recall/MRR -- we don't know.
- Position weighting formula `1.0 - 0.5 * (idx / queryLen)` is simplistic -- very
  long queries compress position weight heavily, reducing discrimination.
- Edge types `implFor` and `plainImport` (used in graph-extractor relMapping) are
  not included in any intent policy `edgeTypePriority` array.
- `POLICIES` are hardcoded with no A/B test baseline or data-driven tuning. Boost
  values (1.2x, 1.3x) look plausible but lack evidence.

### 2.2 Reintegration Plan: CatBoost Intent Classifier

Train a CatBoost model for intent classification (same pattern as the existing
query-router for lexical/semantic/structural routing):

- **Features**: Reuse `extractMLFeatures()` (50 features) + add intent-specific
  binary features (presence of domain keywords as soft signals, not hard rules).
- **Training data**: ~1000-5000 labeled intent queries across English + 2-3 other
  languages. Sources: CodeSearchNet queries, StackOverflow titles, internal logs.
- **Export**: CatBoost -> ONNX -> WASM for sub-ms inference (matches current query
  router architecture).
- **Intents**: Keep current 5 (api_lookup, bug_fix, refactor, security, general).
  Consider adding: `documentation`, `navigation`, `testing`.

### 2.3 Required Research Before Reintegration

- [ ] A/B test intent routing on CodeSearchNet: measure MRR delta with vs without
- [ ] If MRR delta < 1 point, the feature may not be worth the complexity
- [ ] Validate per-intent policies (chunkTypeBoosts, expandMode, maxResults) with
  ablation studies -- are the hardcoded boost values actually optimal?
- [ ] Test whether intent-driven graph expansion (1hop for api_lookup, 2hop for
  bug_fix) actually retrieves more relevant context vs no expansion
- [ ] Evaluate edge type priorities (`extends > imports > calls > uses`) empirically

### 2.4 Reintegration Checklist

When ready to re-enable:
- [ ] Train and validate CatBoost model (see 2.2)
- [ ] Replace keyword classifier with WASM model in `core/intent-router.js`
- [ ] Restore `intent: 'auto'` default in `sweet-search.js`
- [ ] Uncomment intent policy application block
- [ ] Add regression tests against eval harness baseline

---

## 3. SEISMIC + HCGS: Sparse Vector Search for Summaries

**Status**: SEISMIC core algorithm is complete and tested (`core/seismic-index.js`,
47 tests). No integration into the search pipeline. `SEISMIC_CONFIG.enabled = false`.

### 3.1 Key Finding: HCGS Summaries Are the Right Target

HCGS summaries are natural language descriptions of code entities ("Validates user
credentials against the database and returns a boolean"). Since they are NL text,
standard SPLADE models (trained on MS MARCO) work directly -- **no code-specific
fine-tuning needed**.

This avoids the main blocker identified in AST_OPTIMIZATIONS.md: "no production
SPLADE model exists that's trained on source code."

See also: `docs/HCGS_ENHANCE.md` (the existing HCGS enhancement plan). SEISMIC
integration should be considered as a Phase 3 extension of that plan, building on
the dual-model embedding work.

### 3.2 What Exists

- SEISMIC index: complete algorithm (TopKHeap, block-based inverted lists,
  approximate query with block pruning, serialization/deserialization)
- HCGS pipeline: complete summary generation and storage
- DB schema: `summary_embedding BLOB` column exists (currently dense embeddings)
- Config: `SEISMIC_CONFIG` in `core/config.js` (blockSize, alpha, weight)
- Note: `alpha` parameter (0.8) is reserved but unused -- intentionally deferred

### 3.3 What's Missing

- [ ] **Sparse encoder service**: Wrap a SPLADE model (e.g., `naver/splade-v3` via
  `@huggingface/transformers` or Sentence Transformers). New file:
  `core/sparse-encoder.js`.
- [ ] **Indexing pipeline**: Generate sparse vectors for all HCGS summaries, build
  SEISMIC index, persist to disk. New file or extension of `index-codebase-v21.js`.
- [ ] **DB schema update**: Add `summary_sparse_vector BLOB` column or reuse
  existing column with format flag.
- [ ] **Query-time wiring**: Encode query with SPLADE, query SEISMIC index, fuse
  results with existing dense/FTS results via reciprocal rank fusion.
- [ ] **Evaluation**: Compare HNSW-only vs HNSW+SEISMIC on CodeSearchNet/RepoEval.

### 3.4 Risks

- SPLADE query encoding adds ~50-200ms latency (model inference), not reflected in
  SEISMIC's sub-ms index lookup time. Still a win for `--summary` search.
- SPLADE vocab trained on English Wikipedia + MS MARCO -- code entity names may map
  poorly to NL terms even in summaries.
- Summary quality is the bottleneck: if HCGS summaries are poor, sparse retrieval
  won't help.

---

## 4. Tree-Sitter tags.scm: Further Research + Official Grammar Queries

**Status**: Partial. Hand-written s-expression queries exist in
`core/tree-sitter-provider.js` (TAGS_QUERIES object, 5 languages). These are
approximations, not the official `tags.scm` files shipped with grammar packages.

### 4.1 Current State

- P0 tree-sitter (DONE): WASM grammar loading, boundary detection, cAST recursive
  split-merge for **chunking**.
- P2.4 tags.scm (PARTIAL): `extractSymbols()` uses hand-written query patterns for
  symbol **entity extraction** (JS, TS, Python, Go, Rust). Integrated into
  `graph-extractor.js` as first-try before regex fallback.

### 4.2 What's Missing

- [ ] **Load official tags.scm from grammar packages** instead of hand-written
  approximations. Most tree-sitter grammars ship standard query files.
- [ ] **Validate queries against official grammar-provided tags.scm** -- current
  hand-written queries may miss node types or capture groups.
- [ ] **Extend to all 12 supported languages** (currently only 5 have queries;
  Ruby, PHP, Kotlin, Swift, C, C++, Java are missing from TAGS_QUERIES).
- [ ] **Relationship extraction via queries** -- currently only definitions are
  extracted via tree-sitter; relationships still use regex entirely. tags.scm
  `@reference` captures could replace regex relationship patterns.
- [ ] **Dedicated P2.4 test coverage** -- no test file specifically validates
  tags.scm queries against real grammar outputs.

### 4.3 Entity Extraction → Embedding Quality Causality Chain

The connection between missing TAGS_QUERIES languages and benchmark MRR scores is
not obvious from the code structure. This section makes the mechanism explicit.

**The causal chain for Java (and any language absent from TAGS_QUERIES):**

```
extractSymbols() returns null for Java              (tree-sitter-provider.js:214)
        ↓
graph-extractor.js falls through to extractJava()  (regex-based fallback)
        ↓
Entity metadata is lower quality:
  - Cannot determine scope chain: sees handleLogin() but not that it's inside
    AuthController, not BaseController or an anonymous inner class
  - Misses annotations on the preceding line (@Override, @Deprecated, @RequestMapping)
    that change the entity's semantic meaning
  - Fails on multi-line declarations: return type, name, and throws clause can
    span 3+ lines with formatters; regex gets the name wrong or misses the entity
  - Generic type parameters confuse name extraction: Map<String, List<T>> parsed
    as "Map" with garbage suffix
        ↓
enrichEmbeddingText() receives incomplete or wrong parent/scope info
        ↓
Embedding text becomes:
  "# path\n# Scope: ?\n# Language: java"           ← regex fallback result
instead of:
  "# path\n# Scope: AuthController > handleLogin\n# Language: java"  ← tree-sitter
        ↓
CodeRankEmbed produces a less precise vector — it cannot distinguish
AuthController.handleLogin() from BaseController.handleLogin()
        ↓
HNSW nearest-neighbor search returns wrong candidates → lower MRR
```

**Why tree-sitter extraction is structurally superior to regex:**
Tree-sitter gives you the entity's full structural context from the parsed AST. The
surrounding `class_declaration` node tells you exactly which class a method belongs
to — this is already in the parse tree, not inferred from line patterns. Regex cannot
reliably recover scope from line-by-line scanning without re-implementing a full
language parser, which is exactly what tree-sitter is.

**The benchmark evidence:** Java CSN 34.8% vs GenCSN 79.0% — a 44-point gap. The gap
is mostly CodeSearchNet's garbage queries, but the embedding precision deficit is real
and shows up on legitimate Java queries where the wrong overloaded method or wrong
inner class variant is retrieved at rank 1.

**Priority implication:** Adding Java (and the other 6 missing languages) to
TAGS_QUERIES is not a completeness checkbox — it is a direct embedding quality fix
with measurable MRR impact. The entity extraction quality directly determines what
`enrichEmbeddingText()` can produce, which directly determines what the embedding
model encodes. This is Section 4's highest-priority action item. See Section 7 for
benchmark evidence and Section 4.2 for the specific action items.

---

## 5. 2-Hop Adaptive Graph Expansion: Remaining Work

**Status**: Adaptive 2-hop is **wired in and enabled by default** (2026-02-23).
`adaptiveHop2` defaults to `true` in `sweet-search.js`. Scoring upgraded to
PathRAG/LEGO-GraphRAG SOTA: per-edge-type `effectiveAlpha^2` decay, degree
normalization (`1/sqrt(outDegree)`), flow-based early stopping (`FLOW_THRESHOLD`).
Old magic constants (0.45/0.25) replaced.

### 5.1 Remaining Issues

- `collectSeedIds()` fallback matching (file_path + line range overlap) is fragile --
  false positives when two entities in the same file have overlapping line ranges.
- Performance not analyzed: querying all forward + reverse edges for 1-hop could be
  expensive on large graphs. No pagination or limit on edge queries.
- Tests use in-memory SQLite only; no tests against real indexed codebases.
- **Side effect of intent router disable**: Since graph expansion was triggered by
  intent classification (api_lookup -> 1hop, bug_fix -> 2hop), disabling intent
  routing also effectively disables automatic graph expansion. Expansion now requires
  explicit `graphExpand: '1hop'` or `graphExpand: '2hop'` in the search API call.

### 5.2 What's Missing

- [ ] **Benchmark adaptive vs simple 2-hop**: Measure Recall/MRR delta on eval
  harness. If adaptive doesn't help, revert.
- [ ] **Token budget validation**: Verify that token estimates (10 tokens/line) are
  reasonable across different languages and codebases.
- [ ] **Intent policy integration**: Consider having intent policies set
  `adaptiveHop2: true` for appropriate intents (e.g., refactor, bug_fix).
- [ ] **Turn on graph expansion by default**: `graphExpand` defaults to `'none'`
  in `sweet-search.js:147`. Change to `'2hop'` (with `adaptiveHop2: true`) so
  every query benefits from graph enrichment without explicit configuration. Gate
  on: (a) adaptive vs simple A/B test showing adaptive wins, and (b) regression
  test confirming expansion doesn't degrade queries with no relevant graph context.

---

## 6. GPU-Accelerated Indexing (Optional)

**Status**: Not started. CPU batch=1 is the current default (~220s for 1200 docs).

### 6.1 Motivation

The 137M CodeRankEmbed model fits easily in any modern GPU's VRAM (~500MB).
On GPU, batched inference is drastically faster — kernel launch overhead dominates,
so batch=32-64 gives real throughput gains. Estimated: 1200 docs in ~10-20s vs
~220s on CPU (10-20x speedup).

### 6.2 Implementation Options

| Provider | Package | Platform | Pros | Cons |
|----------|---------|----------|------|------|
| CUDA EP | `onnxruntime-node-gpu` | NVIDIA only | Fastest, mature | ~200-500MB, requires CUDA runtime |
| DirectML EP | `onnxruntime-node-directml` | Windows (any GPU) | Works on AMD/Intel/NVIDIA | Windows only, slower than CUDA |
| WebGPU | `@huggingface/transformers` (device: 'webgpu') | Cross-platform | No native deps | Experimental in Node.js |

### 6.3 Design Considerations

- `onnxruntime-node` and `onnxruntime-node-gpu` are **mutually exclusive** npm
  packages — can't install both. Need optional dependency + runtime detection.
- Auto-detect GPU availability, fall back to CPU seamlessly.
- When GPU is available, switch `indexerBatchSize` default from 1 to 32-64.
- Model weights are identical — no separate model needed, just a different EP.
- Test matrix expands: CPU-only, CUDA, DirectML across OS variants.

### 6.4 Action Items

- [ ] Research: can `onnxruntime-node` load CUDA EP dynamically if the user has
  CUDA installed, without requiring the `-gpu` package?
- [ ] Prototype: add `SWEET_SEARCH_USE_GPU=1` env var that swaps execution provider
- [ ] Benchmark on a CUDA machine with batch sizes 1, 8, 32, 64
- [ ] If viable: make GPU an optional dependency (`optionalDependencies` in package.json)
- [ ] Add GPU detection to `bestIntraOpThreads()` or a new `resolveExecutionProvider()`
- [ ] Document setup instructions for CUDA and DirectML

### 6.5 Priority

Low — current CPU performance is usable, and incremental indexing (Merkle state)
means the full-index cost is a first-run thing. Revisit when indexing speed becomes
a user complaint or when targeting server deployments.

---

## 7. JavaScript + Java Weakness: Root Cause Analysis

**Status**: Identified in the 2026-02-19 benchmark run. Not yet investigated.

### 7.1 The Problem

JavaScript and Java are the two weakest languages on CodeSearchNet:
- Java: 34.8% MRR (vs 79.0% on GenCodeSearchNet — a 44-point gap)
- JavaScript: 51.7% MRR (vs 65.5% on GenCodeSearchNet — a 14-point gap)

These are among the most common languages for Claude Code users. A search plugin
that's weak on JS and Java is a meaningful usability gap.

### 7.2 Likely Causes

**Data quality (dominant factor):** The massive MRR gap between CodeSearchNet and
GenCodeSearchNet for the same languages (Java: 34.8% vs 79.0%) strongly suggests
CodeSearchNet's query quality is the primary issue, not Sweet Search. CSN Java
queries include garbage like `str->None`, `try:`, `int->None` that no search engine
can reasonably match. GenCodeSearchNet has cleaner, more natural queries.

**Dense embedding limitations:** CodeRankEmbed is good but still compresses a whole
code chunk into a single 768d vector. Java's verbose signatures
(`AbstractFactoryBuilderImpl.createWidgetFromConfig()`) contain many tokens that
get averaged away. Late interaction would help by preserving token-level
information.

**JavaScript syntax diversity:** JS has many equivalent patterns (`function`,
`=> {}`, `class method()`, `module.exports = function`, `export default`) that
mean the same thing semantically. Dense embeddings handle this better than keyword
search, but the variety still hurts compared to Go's single `func` pattern.

**Tree-sitter is NOT the issue:** We use the standard tree-sitter grammars
(tree-sitter-wasms@0.1.13, same as VS Code/Neovim). These are high-quality.
However, our tags.scm queries are hand-written and only cover 5 languages —
Java is MISSING from TAGS_QUERIES. Adding Java tags.scm queries (Section 4) could
improve entity extraction for graph-based features.

### 7.3 Action Items

- [ ] **Enable late interaction** (Section 0) — expected to help Java most (+15-25 MRR pts)
- [ ] **Add Java to TAGS_QUERIES** in `tree-sitter-provider.js` — currently only
  JS, TS, Python, Go, Rust have hand-written queries
- [ ] **Error analysis on CodeSearchNet JS/Java failures**: Sample 50 failed queries
  per language, categorize as: (a) garbage query, (b) relevant query but wrong
  result, (c) relevant query but result not in top-10. This tells us whether to
  focus on query filtering vs search quality.
- [ ] **Benchmark with query cleaning**: Filter obvious garbage CSN queries
  (single-word type names, bare keywords like `try:`) and re-measure. If MRR jumps
  significantly, the problem is data, not Sweet Search.

---

## 8. Benchmark Configuration: Run Full Profile

**Status**: The 2026-02-19 baseline used the `balanced` profile which disables
late interaction. A full-profile run is needed for a complete picture.

### 8.1 What Was Missing

The `balanced` profile in `eval/run_all.js` sets:
```js
{ buildLateInteraction: false, useLateInteraction: false, sqliteFast: true,
  indexMode: 'single', requireNativeAnn: false }
```

This means the benchmark results are CodeRankEmbed + FlashRank/ModernBERT
reranking only. Late interaction (LateOn-Code MaxSim), which is the main retrieval
feature differentiator, was never tested.

### 8.2 Indexing Time Concern

The balanced run took ~4 hours for 20K queries. Late interaction adds per-chunk
encoding via LateOn-Code. Estimated: full model at p50=9.8ms/chunk ≈ 12s per 1200
chunks. Edge model at p50=2.1ms ≈ 2.5s. Dramatically cheaper than the old per-line
approach (the old Jina ColBERT v2 required per-line embedding).

**Recommendation**: Don't run all 8 with late interaction. Run selectively:
- CodeSearchNet (1,200 queries) — to see per-language late interaction impact
- GenCodeSearchNet (6,000 queries) — largest dataset, most representative
- COIR (4,500 queries) — mixed tasks, good diversity

Skip: AdvTest (already 91.5%), CosQA (too small), CrossCodeEval (fundamentally
different task), CoQuIR (quality-focused, late interaction won't help much).

### 8.3 Action Items

- [ ] **Run selective late interaction benchmark** on CSN + GCSN + COIR (~3 benchmarks)
- [ ] **Compare balanced vs full profile** per-language and per-benchmark
- [ ] **Measure late interaction indexing overhead** to decide if it can be default-on
- [ ] **Document the full vs balanced delta** in eval/results/

---

## 9. JavaScript/TypeScript Chunking + Entity Extraction Hardening

**Status**: COMPLETE (2026-03-02, commit bb254f7).

Implemented full JS_TS_CHUNKING_HARDENING.md plan across 4 phases:
- Phase 1: Chunker patterns (arrowNoParen, let/var arrows, generators, getters/setters,
  objectMethod, moduleExport/moduleExportObj, export default class/function)
- Phase 2: Graph entities (objectArrow, objectMethod, arrowFunction type fix, export
  default) + relationships (require, reexport, dynamicImport, destructured require
  per-name imports)
- Phase 3: Tree-sitter queries (generator_function_declaration, abstract_class_declaration,
  variable_declarator+arrow_function combined capture, pair queries for object
  methods/arrows, namespace module/internal_module, type_identifier for TS class,
  export_statement class declarations)
- Phase 4: 91-test dedicated file with multiset parity comparators (tree-sitter vs
  regex), 87 tests added to typescript-patterns.test.js
- Simplify pass: hoisted constants, DRY'd relationship blocks, if-else entity chain
- Tree-sitter packages moved to required dependencies; parity tests hard-fail

Remaining out-of-scope items (deferred):
- [ ] Computed property methods (`[Symbol.iterator]() {}`) — regex can't reliably match
- [ ] Callback patterns (`app.get('/path', (req, res) => {})`) — anonymous, no name
- [ ] Re-run GenCodeSearchNet JS subset before/after to measure MRR delta

---

## 10. MinCut Graph Partitioning

**Status**: Not started. No MinCut implementation exists in the codebase.

MinCut (minimum edge cut) finds the smallest set of edges whose removal disconnects
two vertex sets in a graph. In code search, this enables principled graph
partitioning and importance scoring across multiple pipeline stages.

### 10.1 Use Case: AST Chunking Boundaries

When splitting a large file into chunks, we currently use line-based boundaries
with tree-sitter node detection. MinCut on the **intra-file dependency graph**
(which functions call which, which variables reference which) would find natural
"seam" points where cutting severs the fewest cross-references.

Example: a 500-line file with 3 classes. MinCut identifies the gaps between classes
as optimal chunk boundaries because cross-class references are minimal compared to
intra-class references.

**Integration point**: `core/document-chunker.js` — as an alternative boundary
strategy alongside the existing regex and tree-sitter boundary detection.

**Expected benefit**: Better-aligned chunks → better embeddings → higher MRR,
especially for large files with complex internal structure. Most impactful for
Java (deep class hierarchies in single files) and C++ (header+impl patterns).

### 10.2 Use Case: Graph Expansion Pruning (Query Time)

When doing 2-hop graph expansion, we now use PathRAG-style per-edge-type alpha
decay with degree normalization. MinCut could further improve this by identifying
the **most important bridge edges** — if removing a single edge disconnects a
large subgraph from the query seed, that edge (and the entity it connects to) is
critical context that must be included.

MinCut-based edge importance would complement the current SOTA scoring (which uses
per-edge-type alpha decay + degree normalization) with structural importance that
is independent of edge type or weight.

**Integration point**: `core/graph-expansion.js` — specifically
`expandSecondHopAdaptive()` which already has token budgets, per-edge-type alpha
decay, and degree normalization. MinCut would add a structural importance signal.

**Expected benefit**: More relevant 2-hop expansions, fewer irrelevant context
entities consuming token budget.

### 10.3 Use Case: Module Boundary Detection (Index Time)

Compute MinCut on the full project's dependency graph at index time to identify
natural module boundaries. Code within a module is tightly connected; code across
modules has few edges (the MinCut edges).

Benefits:
- **Scope search results** to the right module when a query is ambiguous (e.g.,
  two `UserService` classes in different modules — MinCut tells you they're in
  different clusters)
- **HCGS summary context**: Include module membership in summaries ("Validates
  user credentials — part of the auth module")
- **Structural search**: When the query router selects structural mode, knowing
  module boundaries helps filter results to the relevant code neighborhood

**Integration point**: `core/graph-extractor.js` (build module graph at extraction
time) or new file `core/module-detector.js`. Store module assignments in the
`entities` table as a column.

**Expected benefit**: Improves structural search quality and HCGS summary richness.
Moderate impact on overall MRR but significant for navigation-oriented queries.

### 10.4 Use Case: CrossCodeEval (Cross-File Retrieval)

CrossCodeEval scores 12.0% MRR because it requires finding cross-file dependencies
— "I'm calling `UserService.get_by_id`, find where it's defined." MinCut analysis
on the repo's import graph at index time would pre-compute which files are **bridge
files** (high betweenness centrality, on many MinCut paths).

When a cross-file query comes in, bridge files are strong candidates because they
connect different parts of the codebase. Combined with structural search mode
routing, this could significantly improve CrossCodeEval-type queries.

**Integration point**: Pre-computed during indexing in `core/graph-extractor.js`,
stored as metadata, queried during structural search in `core/graph-search.js`.

**Expected benefit**: Could meaningfully improve the 12% CrossCodeEval MRR,
especially if combined with query router improvements to detect cross-file
queries and route to structural mode.

### 10.5 Implementation Approach

Algorithm options:
- **Stoer-Wagner** for global MinCut (undirected graphs): O(VE + V² log V). Good
  for module detection (10.3).
- **Max-flow/min-cut (Ford-Fulkerson / Dinic's)** for s-t MinCut: O(V²E). Good
  for expansion pruning (10.2) where you have a source (query seed) and sink (rest
  of graph).
- **Karger's randomized**: O(V² log³ V). Good for approximate module boundaries
  when exact solution is too slow on large codebases.

For a typical project (1000-5000 entities, 5000-20000 edges), any of these run in
under 100ms. No performance concern.

### 10.6 Action Items

- [ ] Implement MinCut (Stoer-Wagner for global, Dinic's for s-t) as a shared
  utility in `core/graph-algorithms.js`
- [ ] **10.2 first**: Integrate s-t MinCut into `expandSecondHopAdaptive()` for
  principled expansion scoring — highest near-term impact
- [ ] **10.3 second**: Module boundary detection at index time using global MinCut
  on the file-level dependency graph
- [ ] **10.1 later**: Intra-file MinCut for chunking boundaries (requires building
  per-file reference graphs from tree-sitter, more work)
- [ ] **10.4 later**: Bridge file detection for CrossCodeEval-type queries
- [ ] Benchmark each integration independently against eval harness baseline
- [ ] Consider Karger's for large monorepos where exact MinCut is too slow

### 10.7 Priority

**MEDIUM** — High potential but requires new algorithmic infrastructure.
Start with 10.2 (graph expansion, direct A/B testable) and 10.3 (module
detection, enriches summaries and structural search). Defer 10.1 and 10.4
until the simpler integrations prove value.

---

## 11. CrossCodeEval Query Router Gap

**Status**: Identified in 2026-02-19 benchmark analysis. CrossCodeEval scores
12.0% MRR — the lowest of all benchmarks — because the query router doesn't
recognize cross-file dependency queries.

### 11.1 The Problem

CrossCodeEval queries are code completion contexts: "I'm writing
`user = UserService.get_by_id(uid)` — find the file that defines
`UserService.get_by_id`." These should route to **structural search** mode
(imports, usages, callers in `graph-search.js`), not semantic search.

But the CatBoost query router classifies these as semantic or hybrid because
the "query" is a code snippet, not natural language. It was never trained on
cross-file dependency queries.

### 11.2 What Would Help

- [ ] **Add structural query detection to CatBoost**: Train on examples of code
  completion contexts (identifier references, partial call expressions, import
  statements) that should route to structural mode.
- [ ] **Heuristic fallback**: If the query looks like code (contains `.`, `()`,
  `import`, `from`, `::`), check whether the referenced identifier exists in the
  entity graph. If yes, route to structural search directly.
- [ ] **Hybrid structural+semantic**: For code queries, run both structural (find
  the definition) and semantic (find similar implementations) in parallel, merge
  results.
- [ ] **MinCut bridge file pre-computation** (Section 10.4): Pre-compute which
  files are import hubs and boost them for cross-file queries.
- [ ] **Benchmark structural mode on CrossCodeEval**: Run CrossCodeEval with
  `--mode=structural` to see the upper bound of what structural search alone can
  achieve.

### 11.3 Priority

**LOW-MEDIUM** — CrossCodeEval is the least representative benchmark for the
Claude Code plugin use case (users search with NL, not code contexts). However,
the fixes benefit all structural queries, not just CrossCodeEval.

---

## 12. CoQuIR Quality-Aware Retrieval Gap

**Status**: CoQuIR scores 44.4% MRR. Python at 31.4%, SQL at 19.1%. This is a
fundamentally different task from semantic similarity search.

### 12.1 The Problem

CoQuIR requires finding not just *relevant* code but *correct, secure, and
efficient* code. When 5 sort implementations exist (one correct, one buggy, one
slow, one insecure, one perfect), semantic embeddings can't distinguish quality —
they all embed to similar vectors.

### 12.2 Connection to Quality Scorer (Section 1)

The disabled Quality Scorer computes exactly the factors that CoQuIR tests:
- `testProximity` → correctness signal (well-tested code is more likely correct)
- `complexity` → efficiency signal (lower complexity often = better implementation)
- `centrality` → maturity signal (heavily-used code has been battle-tested)
- `commentDensity` → documentation quality signal

Enabling the Quality Scorer with appropriate weights could meaningfully improve
CoQuIR scores, especially for Python (31.4%) where quality differences are subtle.

### 12.3 Action Items

- [ ] **Run CoQuIR with `qualityWeight: 0.1, 0.2, 0.3`** to measure direct impact
- [ ] **Analyze CoQuIR failures**: Are we finding the relevant function but ranking
  the wrong implementation highest? Or not finding it at all?
- [ ] **SQL-specific**: SQL quality is invisible to all our signals (19.1% MRR).
  Consider SQL-specific quality heuristics: parameterized queries > string concat,
  specific columns > `SELECT *`, `LIMIT` clauses present, etc.

### 12.4 Priority

**LOW** — CoQuIR is a specialized benchmark. Most Claude Code users want
"find relevant code," not "find the best implementation." But the Quality Scorer
is already built — testing it costs almost nothing.

---

## 13. FTS5 Tokenizer: Code-Aware camelCase/snake_case Splitting

**Status**: Not started. Requires discussion before implementation.

### 13.1 The Problem

Our FTS5 index uses `tokenize='porter unicode61'` (graph-extractor.js:1511). This
treats `getUserById` as a single token. A lexical search for "user" won't match it
via FTS5 — only the trigram fallback catches it, which is slower and has lower
precision.

Similarly, `parse_json_response` is tokenized as `parse_json_response` (unicode61
splits on `_` but porter-stems each part). The `_` splitting works, but camelCase
doesn't get split at all.

This means our lexical search mode systematically underperforms on identifier-based
queries in camelCase languages (Java, JS/TS, Go, C#).

### 13.2 Discussion Points

- Should we add a **custom FTS5 tokenizer** that splits camelCase, or is trigram
  fallback sufficient? Custom tokenizers in SQLite FTS5 require C extensions or
  creative SQL workarounds.
- Alternative: **pre-process entity names** at index time — store both the original
  (`getUserById`) and the split form (`get user by id`) in the FTS5 index. No
  custom tokenizer needed, just an extra column or concatenated field.
- Alternative: **dual FTS5 tables** — one with porter (for NL text) and one with
  a split-name field (for identifier matching). Query both and merge.
- Risk: Over-splitting may hurt precision. `HttpURLConnection` → `http url connection`
  could match irrelevant results containing "connection".
- What about **acronyms**? `XMLParser` should split to `XML Parser`, not
  `x m l parser`.

### 13.3 Action Items

- [ ] **Discuss approach** before implementing — pre-processing vs custom tokenizer
  vs dual tables
- [ ] Prototype the simplest approach (pre-process at index time) and measure
  lexical search MRR delta on CodeSearchNet
- [ ] Consider interaction with trigram table — if trigram already catches these
  cases, the improvement may be marginal

---

## 14. Code-to-Code Search Mode

**Status**: Not started. Requires discussion and design.

### 14.1 The Problem

COIR benchmark had 2,102 "unknown" language queries at 46.4% MRR. These are likely
code-to-code retrieval tasks where the "query" is itself a code snippet, not NL
text. Our pipeline assumes NL→code: the embedding model prepends `queryPrefix`:
`"Represent this query for searching relevant code: "` to all queries. This prefix
is wrong for code→code search.

In real-world Claude Code use, a developer might paste a code snippet and ask "find
similar code" or "where is this pattern used." Our query router doesn't detect that
the query is code, and the embedding prefix actively hurts similarity matching.

### 14.2 Discussion Points

- **Full mode vs heuristic**: Should we add a dedicated `code2code` search mode, or
  handle it via heuristics in the query router? The CatBoost model could learn to
  detect code queries (presence of `()`, `.`, `{`, `import`, indentation) and skip
  the query prefix.
- **Symmetric vs asymmetric embedding**: CodeRankEmbed was trained for asymmetric
  retrieval (NL query → code document). Code→code needs symmetric embedding. We
  could: (a) strip the query prefix, (b) use a separate symmetric model, or
  (c) just extract identifiers from the code query and do lexical+structural search.
- **Simple rule-based approach**: If the query contains >50% code tokens (detected
  by brackets, semicolons, indentation), route to structural search (find matching
  identifiers) + lexical search (FTS5 on entity names) instead of semantic search.
  No new model needed.
- **Entity extraction from query**: Parse the code snippet with tree-sitter, extract
  identifiers, and search for those identifiers in the entity graph. This leverages
  existing infrastructure.

### 14.3 Action Items

- [ ] **Discuss design** — full mode vs heuristic query detection
- [ ] Add code detection features to CatBoost query router training data
- [ ] Prototype: strip queryPrefix when code is detected, measure COIR MRR delta
- [ ] Prototype: extract identifiers from code queries, run structural search
- [ ] Evaluate which approach gives better results on COIR "unknown" queries

---

## 15. HCGS Summary Search: Benchmark Needed

**Status**: HCGS summary-first search is fully implemented (`--summary` flag) but
was never included in the 8-benchmark evaluation. We have zero data on whether
summaries help or hurt retrieval quality.

### 15.1 Why This Matters

HCGS summaries are NL descriptions of code entities ("Validates user credentials
against the database and returns a boolean"). Since both the query and the
"document" are NL text, semantic similarity should be higher — the embedding model
doesn't need to bridge the NL↔code modality gap.

Hypothesis: HCGS summary search could score HIGHER than code search on NL→code
benchmarks because the query and document are in the same modality.

Counter-hypothesis: Summaries may lose implementation details that the query
references ("uses recursion", "handles null", "returns a list").

### 15.2 Action Items

- [ ] Run CodeSearchNet and GenCodeSearchNet with `--summary` mode enabled
- [ ] Compare MRR/Recall per-language: summary search vs code search
- [ ] If summary search is better for some query types, consider hybrid: search
  both code and summaries, merge results via reciprocal rank fusion
- [ ] Measure token reduction: how much smaller are summary results vs code results?

---

## 16. Matryoshka Dimension Tuning

**Status**: We truncate embeddings to 512d for HNSW across all providers. This was
chosen as a balance between speed and quality, but never A/B tested.

### 16.1 Current Configuration

All providers use `hnsw: 512` in their dimension config:
- Voyage Code 3: 1024d full → 512d HNSW
- Mistral Codestral: 3072d full → 512d HNSW
- Jina v3: 1024d full → 512d HNSW
- CodeRankEmbed: 768d full → 512d HNSW

Matryoshka embedding models produce nested dimensions where the first N dimensions
are a valid, lower-quality embedding. We could use 256d (half the index size, faster
search) or keep 512d or even go to 768d.

### 16.2 Action Items

- [ ] Benchmark CodeSearchNet with 256d, 384d, 512d, 768d HNSW dimensions
- [ ] Measure: MRR delta, index size, query latency for each dimension
- [ ] If 256d loses <2 MRR points: consider making it the default for faster search
  and smaller indexes
- [ ] If 768d gains >2 MRR points: consider using full dimensions despite larger
  index

---

## 17. HNSW Parameter Tuning + SONA Self-Learning

**Status**: Current HNSW parameters are reasonable defaults but were never tuned for
our specific workload.

### 17.1 Current Parameters (config.js)

```
HNSW: M=16, efConstruction=200, efSearch=100
Binary HNSW: M=32, efConstruction=400, efSearch=200
```

These affect recall/latency tradeoff:
- Higher `efSearch` → better recall but slower queries
- Higher `M` → more links per node, better graph connectivity, larger index
- Higher `efConstruction` → better index quality, slower indexing

### 17.2 Tuning Plan

- [ ] Benchmark CodeSearchNet with efSearch: 50, 100, 200, 400
- [ ] Benchmark with M: 8, 16, 32, 48
- [ ] Measure: MRR delta, p50/p95 latency, index size for each combination
- [ ] For each benchmark, check if missed results at lower efSearch are recovered
  by the reranker (if reranker catches them anyway, lower efSearch is fine)

### 17.3 SONA Self-Learning for HNSW Parameters

Different codebases have different optimal parameters. A small 200-file project
doesn't need M=16 (M=8 is fine). A 50K-file monorepo needs higher efSearch.

Proposed approach:
- After search, check if the reranker significantly reorders results (indicates
  HNSW missed good candidates). If reranking frequently promotes items from
  position >10 to top-3, increase efSearch.
- Store per-codebase HNSW preferences in the index metadata.
- On re-index, adjust parameters based on learned codebase characteristics
  (file count, entity density, average query patterns from MCP usage logs).

---

## 18. Embedding Model Benchmarking (API Providers)

**Status**: The 2026-02-19 baseline used only the local CodeRankEmbed INT8 model.
We have 3 API providers configured (Voyage Code 3, Mistral Codestral, Jina v3) but
none were tested.

### 18.1 Why This Matters

CodeRankEmbed reports 77.9% CSN MRR. Voyage Code 3 claims ~81.7%. Mistral
Codestral Embed (released May 2025) claims to outperform Voyage on SWE-Bench.
If users have API keys, we should know how much better their search gets.

### 18.2 Action Items

- [ ] Run CodeSearchNet + GenCodeSearchNet with each API provider enabled
  (requires valid API keys — cost estimate: ~$1-5 per benchmark run)
- [ ] Compare per-language MRR: local vs Voyage vs Mistral vs Jina
- [ ] Measure latency impact: API embedding adds network round-trip
- [ ] Document the quality/cost/latency tradeoff for each provider
- [ ] Check if Mistral Codestral or Voyage have released newer models since our
  config was written

---

## 19. Reranker Model Freshness

**Status**: Our cascaded reranker uses FlashRank TinyBERT (~15ms, Stage 1) and
GTE-Reranker-ModernBERT-Base INT8 (~700ms, Stage 2). These were configured in
early 2026. The reranker landscape has evolved.

### 19.1 Current Reranker Landscape (February 2026)

| Model | Size | BEIR NDCG@10 | Speed | Notes |
|-------|------|--------------|-------|-------|
| mxbai-rerank-large-v2 | 1.5B | 57.49 | ~0.9s/query (A100) | GRPO training, 100+ languages, 8K context |
| mxbai-rerank-base-v2 | 0.5B | 55.57 | faster | Code search NDCG: 31.73 |
| reranker-ModernBERT-large-gooaq | 300M | 79.42* | ~1h train on 3090 | *Realistic setting; outperforms all <1B rerankers |
| reranker-ModernBERT-base-gooaq | 150M | top of <1B class | ~30min train | Outperforms 13 common rerankers |
| GTE-Reranker-ModernBERT-Base | 150M | competitive | ~700ms | Our current Stage 2 |
| FlashRank TinyBERT | 22M | fast baseline | ~15ms | Our current Stage 1 |

Notable developments:
- **Sentence Transformers v4** (released late 2025) introduced a reranker training
  framework. ModernBERT-based rerankers trained with it outperform all prior <1B
  models.
- **Mixedbread mxbai-rerank-v2** uses GRPO (reinforcement learning) training and
  supports code search natively (31.73 NDCG on code benchmarks).
- **Custom fine-tuning** is now trivial: 30 minutes on a consumer GPU with 99K
  training pairs produces SOTA-competitive rerankers. We could fine-tune a reranker
  on CodeSearchNet data specifically.

Sources:
- [Mixedbread mxbai-rerank-v2](https://www.mixedbread.com/docs/models/reranking/mxbai-rerank-base-v2)
- [Sentence Transformers v4 reranker training](https://huggingface.co/blog/train-reranker)
- [tomaarsen/reranker-ModernBERT-base-gooaq-bce](https://huggingface.co/tomaarsen/reranker-ModernBERT-base-gooaq-bce)
- [Top 7 Rerankers for RAG](https://www.analyticsvidhya.com/blog/2025/06/top-rerankers-for-rag/)

### 19.2 Action Items

- [ ] **Evaluate mxbai-rerank-base-v2** (0.5B) as Stage 2 replacement — it has
  native code search support and GRPO training
- [ ] **Evaluate reranker-ModernBERT-base-gooaq** (150M) — same architecture family
  as our current GTE, drop-in replacement potential
- [ ] **ONNX export** of the best candidate for local INT8 inference (matching our
  current GTE-ModernBERT-Base INT8 pattern)
- [ ] **Consider fine-tuning**: Train a ModernBERT reranker on CodeSearchNet query-
  code pairs using Sentence Transformers v4. 30 minutes of training could produce
  a code-specialized reranker that outperforms general-purpose models.
- [ ] **Benchmark Stage 1**: Is FlashRank TinyBERT still the best fast filter, or
  has a faster/better model appeared?

---

## 20. web-tree-sitter Version Update — BLOCKED

**Status**: BLOCKED. Attempted upgrade to `web-tree-sitter@0.26.5` on 2026-02-23.
**ABI incompatible** with `tree-sitter-wasms@0.1.13` (latest available). All 12
grammar WASM files fail to load — the compiled grammars target the 0.25.x ABI.

### 20.1 What Happened

- Bumped `web-tree-sitter` to `^0.26.5`, ran `npm install` — installed fine.
- `npm test -- --run` showed 12 failures in `tests/p0-gaps.test.js` — every
  tree-sitter grammar loading test failed with ABI mismatch errors.
- No compatible `tree-sitter-wasms` version exists for 0.26.x.
- Reverted to `^0.25.10`.

### 20.2 Unblocking

- [ ] Wait for `tree-sitter-wasms` to release a version compiled against
  `web-tree-sitter@0.26.x`
- [ ] Alternatively, compile WASM grammars ourselves using `tree-sitter-cli`
  with the 0.26.x runtime (significant effort, 12 languages)

---

## 21. Query Preprocessing + Robustness

**Status**: Not started. Requires discussion and research.

### 21.1 The Problem

The benchmark showed that garbage queries devastate MRR (Java CSN at 34.8% with
garbage queries vs 79.0% with clean queries). In real-world Claude Code use, users
will also type vague or incomplete queries:
- "find the thing" (no specificity)
- "error" (single word, too broad)
- "where does it handle the stuff" (vague pronouns)
- "fix" (bare verb, no context)
- `str -> None` (type signature pasted accidentally)

### 21.2 Discussion Points

- **Minimum query quality**: Should we enforce a minimum query length or reject
  single-token queries? Or silently expand them?
- **Query expansion**: For short queries, expand with context from the current file
  or recent search history. "error" → "error handling in authentication module"
  (using the user's current file context from the MCP session).
- **Query cleaning**: Strip obvious non-NL patterns (type signatures, bare
  operators, comment markers) before embedding. Already partially done in
  `cleanQueryText()` but only for comment prefixes.
- **Fallback strategies**: When semantic search returns low-confidence results
  (reranker scores below threshold), fall back to broader lexical search or suggest
  query refinement.
- **Spell correction for identifiers**: If the query contains a near-miss identifier
  ("getUserByld" instead of "getUserById"), trigram search catches it but semantic
  search doesn't. Could we detect and correct these before embedding?
- **Session context injection**: The MCP server knows which file the user is editing.
  Prepend "In the context of {current_file}:" to vague queries to improve relevance.

### 21.3 Action Items

- [ ] **Discuss approach** — which preprocessing steps are safe defaults vs opt-in?
- [ ] Analyze the 2026-02-19 benchmark failures: what percentage are caused by
  garbage/vague queries vs genuine search misses?
- [ ] Prototype session context injection in the MCP server and measure MRR delta
- [ ] Prototype minimum query quality detection (reject or expand queries under
  3 meaningful tokens)

---

## 22. Token Estimation: Replace 10 Tokens/Line Heuristic

**Status**: Not started. `applyTokenBudget` in `core/graph-expansion.js` estimates
token cost as `(endLine - startLine + 1) * 10`. This is systematically wrong across
languages: Java averages ~15 tokens/line, Python ~8, Go ~12. In a mixed-language
codebase this causes incorrect budget cutoffs and corrupts density-based allocation
(Section 25) if that is added later.

### 22.1 Options

| Approach | Latency added | Accuracy | Notes |
|----------|---------------|----------|-------|
| Current: `lines × 10` | 0ms | ±50% | Systematically wrong for Java |
| Language-specific multipliers | 0ms | ±20% | Java×1.5, Python×0.8, etc. |
| Fetch chunk text + BPE count | +2ms | ±5% | SQLite lookup per result |

Language-specific multipliers are the right first step: zero latency, no I/O, and
capture the main source of error. Per-language rough averages from CodeSearchNet:
Java ~15, Go ~12, PHP ~11, JS ~10, Ruby ~9, Python ~8.

### 22.2 Action Items

- [ ] **Add language-specific multipliers** to `applyTokenBudget`: look up file
  extension for each result and apply the appropriate factor. Zero latency cost.
- [ ] **Prerequisite for Section 25** (knapsack allocation): fix token counts before
  implementing density sorting — sorting by `score / inaccurateTokens` is worse than
  sorting by score alone.
- [ ] Measure impact after fix: re-run CodeSearchNet and compare budget utilization
  stats (tokens spent on originals vs hop-1 vs hop-2).

### 22.3 Priority

**LOW-MEDIUM** — blocking prerequisite for Section 25. On its own, only meaningfully
affects mixed-language repos. Low effort; implement before knapsack work.

---

## 23. Path-Level Scoring for 2-Hop Graph Expansion

**Status**: Not implemented. `expandSecondHopAdaptive` in `core/graph-expansion.js`
scores each hop-2 entity using only the hop-2 edge type. The hop-1 entity's relevance
(how strongly it connects to the original seed) is not propagated.

### 23.1 The Problem

A hop-2 entity reached via:
- `seed → (extends, hop1_score=0.8) → hop1 → (extends) → hop2`
scores identically to:
- `seed → (uses, hop1_score=0.2) → hop1 → (extends) → hop2`

Both use the same `effectiveAlpha^2` for the hop-2 edge type. The first path is
far stronger evidence but the signal is lost.

### 23.2 Fix

Pass hop-1 scores into `expandSecondHopAdaptive` and include them in the formula:

```
path_score = hop1_score × effectiveAlpha(hop2_edge_type) × weight / sqrt(outDegree)
```

`expandOneHop` currently returns `Map<entityId, {via, direction}>` — extend it to
also carry the hop-1 entity's score.

### 23.3 Expected Impact

**Medium-low**. Current per-edge-type alpha already captures most of the signal.
The missing piece matters most when hop-1 entities have widely varying relevance,
which is only common when original search results are themselves mixed in quality.
**Zero latency addition** — pure data plumbing, no new computation.

### 23.4 Action Items

- [ ] Modify `expandOneHop` to return `Map<entityId, {score, via, direction}>`
- [ ] Pass hop-1 scores into `expandSecondHopAdaptive` and use in path formula
- [ ] Add tests for score propagation through hop-1 → hop-2
- [ ] Benchmark MRR delta on CodeSearchNet

---

## 24. Query-Dependent Graph Expansion Scoring

**Status**: DONE (2026-03-01). Query embedding threaded through pipeline.
Min-max normalized graph scores blended with cosine similarity in both
`expandSecondHopAdaptive`, `expandSecondHop`, and `rerankExpanded`.
`cosineSimilarity` injected via options (DI — no import coupling in graph-expansion.js).
Default `semanticWeight: 0.4`, configurable via `graphExpandOptions`.
14 tests in `tests/query-dependent-expansion.test.js` + 1 in
`tests/search-postprocess-graph-options.test.js`. Benchmark sweep pending.

### 24.1 The Problem

An entity can be graph-connected to a seed but semantically unrelated to the query.
Example:
- Query: "handle null pointer exception"
- Seed: `UserService.getUser()`
- Hop-2 A: `NullPointerExceptionHandler` — graph score 0.3 (weak calls path),
  query similarity 0.85 → combined 0.52
- Hop-2 B: `UserPreferences` — graph score 0.5 (strong uses path),
  query similarity 0.1 → combined 0.34

Without query-dependent scoring B wins. With it, A wins — correctly.

### 24.2 Fix

Blend graph score with cosine similarity between query embedding and entity embedding:

```js
final_score = 0.6 × graph_score + 0.4 × cosine(query_embedding, entity_embedding)
```

Entity embeddings are already stored in the HNSW index. The query embedding is already
computed in the semantic search step — it needs to be threaded into `expandResults()`.

### 24.3 Expected Impact

**HIGH** — single highest-ROI improvement to graph expansion. Directly attacks false
positives (graph-connected but semantically irrelevant entities). No training data,
no new indexes, minimal code change. **~2ms latency addition**: 20 SQLite lookups +
20 dot products on 512-dim vectors.

### 24.4 SOTA Position

Every graph RAG system from 2024 onward uses query embedding similarity as a core
scoring signal for expanded nodes. We are currently below this baseline:

| System | Year | Query-aware expansion scoring |
|--------|------|-------------------------------|
| **Our rerankExpanded** | — | **No — pure structural heuristics** |
| Early GraphRAG (naive) | 2023 | No |
| LEGO-GraphRAG (cat. 2) | 2024 | Yes — embedding cosine similarity |
| PathRAG (arxiv 2502.14902) | Feb 2025 | Yes — flow reliability + path-level |
| PankRAG | 2025 | Yes — semantic sim to query answer |
| ProGraph-R1 (arxiv 2601.17755) | Jan 2026 | Yes — RL with structural + semantic |

The minimum viable fix to reach **2024 LEGO-GraphRAG category 2** is adding cosine
similarity between query embedding and entity embedding to both `expandSecondHopAdaptive`
(candidate selection) and `rerankExpanded` (post-lookup scoring). Both the query
embedding and entity embeddings already exist — this is a data-plumbing change.

Note: Section 26 (pipeline restructuring) will ultimately supersede `rerankExpanded`
by routing expanded entities through the learned cross-encoder reranker. But Section 26
is a larger refactor. Section 24 is the fix within the current architecture.

### 24.5 Action Items

- [x] Thread `queryEmbedding` (already computed in semantic search) into
  `expandResults()` via the options object
- [x] In `expandSecondHopAdaptive`, look up entity embeddings from the HNSW index
  for each hop-2 candidate and blend cosine similarity with graph score
- [x] In `rerankExpanded`, apply the same cosine blend — replace the query-agnostic
  ×1.5/×1.3 multipliers with `w₁ × graph_score + w₂ × cosine(query, entity)`
- [ ] A/B test blend weights (0.6/0.4 is a starting point) on eval harness
- [ ] Benchmark MRR delta on CodeSearchNet + GenCodeSearchNet

### 24.6 Priority

**HIGH** — negligible latency, no training data, uses existing infrastructure.
The query-agnostic nature of `rerankExpanded` is the specific gap vs 2024 SOTA.
Most impactful graph expansion improvement available in the current architecture.

---

## 25. Budget Allocation: Greedy vs Knapsack

**Status**: Not started. `applyTokenBudget` in `core/graph-expansion.js` walks
results sorted by score and stops when the running token total exceeds the budget.
This greedy approach can discard many small, collectively high-value results in favor
of one large, high-scoring result.

### 25.1 The Problem

```
Result A: score=0.8, tokens=500
Result B: score=0.75, tokens=50
Result C: score=0.70, tokens=50
Budget = 600

Greedy:  A (500 tokens) → budget gone          → total value 0.8
Optimal: B + C (100 tokens) → skip A           → total value 1.45
```

### 25.2 Candidate Approaches

**Fractional knapsack** (sort by score/tokens ratio — value density):
- O(n log n), ~5 lines of code change
- Provably optimal for the fractional relaxation; within 5% of DP optimal in practice

**DP 0/1 knapsack** (exact):
- O(n × B/unit) — with B=800 discrete units and n=20 results: ~16,000 ops, <1ms
- Exact optimal

**Important caveat**: for code search, a single large function containing the exact
answer may be more useful than several small snippets. Fractional knapsack would
penalize it. A/B test before committing to either approach.

### 25.3 Prerequisites

Section 22 (token estimation fix) must be done first. Sorting by
`score / inaccurateTokens` adds noise to the density signal and can be worse than
sorting by score alone.

### 25.4 Action Items

- [ ] Complete Section 22 (token estimation) first
- [ ] Implement fractional knapsack as a configurable option alongside greedy
- [ ] A/B test greedy vs fractional knapsack vs DP on CodeSearchNet
- [ ] Decide on method based on results — do not assume fractional is better

### 25.5 Priority

**LOW-MEDIUM** — depends on token estimation fix (Section 22). Largest impact in
Java-heavy codebases with mixed result sizes.

---

## 26. Pipeline Restructuring: Cascaded Scoring with Conditional Cross-Encoder

**Status**: Not started. Identified 2026-02-28 as the highest-value architectural
improvement to the retrieval pipeline. Updated 2026-03-01 with cascaded late
interaction analysis and conditional reranking design.

### 26.1 Current Architecture (Two Problems)

```
lexicalSearch()            ← BM25 FTS5
semanticSearch3Stage()     ← Binary → Int8 → LateInteraction → Reranker  ← here
hybridSearchV2()           ← CC fusion + MMR
expandResults()            ← graph expansion with heuristic scoring only
applyTokenBudget()
```

**Problem 1 — Expanded entities never see the reranker.** The cross-encoder reranker
(the most powerful scorer in the pipeline) only scores candidates BEFORE graph
expansion. Expanded entities get only heuristic scores (topology decay + 1.5× file
proximity + 1.3× type boost). This is a structural asymmetry.

**Problem 2 — Late interaction and cross-encoder are redundant on the same candidates.**
Currently both run on the same top-20 from HNSW. The cross-encoder does full query-
document attention (every query token attends to every document token). MaxSim only
finds max per-query-token. The cross-encoder is strictly more powerful — it will
largely override late interaction's ranking. When both run on the same candidates,
late interaction's contribution is near-zero.

### 26.2 Key Insight: Late Interaction as Stage 1, Not Parallel Reranker

Late interaction with pre-indexed token vectors is essentially **free** at query time.
Document tokens are already in the index. We only need one query encoding (~2ms edge,
~10ms full model) then MaxSim scoring is pure arithmetic on pre-computed vectors.

Compare this to our current Stage 1 (FlashRank TinyBERT, 22M):
- FlashRank: re-encodes each (query, document) pair. ~15ms for 20 candidates.
- MaxSim on pre-indexed tokens: ~0.04ms for 20 candidates (just dot products).

Late interaction is a natural replacement for FlashRank as the fast filter in a
cascaded scoring pipeline. It's faster, uses richer signal (per-token vs pooled),
and the token vectors are already stored.

### 26.3 Proposed Architecture: Conditional Cascade

**Core idea**: use late interaction as the primary reranker, only invoke the expensive
cross-encoder when MaxSim confidence is low (scores are close together, ranking is
uncertain).

```
HNSW (top 50)
  → expand (graph expansion on broader candidate set)
  → MaxSim rerank all candidates (~2-10ms)
  → confidence check:
      HIGH (score gap decisive):  DONE           (~5-15ms total, est. 60-70% of queries)
      LOW  (scores clustered):    cross-encoder   (~350-700ms total, est. 30-40% of queries)
  → budget
```

**Confidence heuristic (needs benchmarking):** if the MaxSim score gap between rank 1
and rank 2 exceeds a threshold (e.g., 0.15), the ranking is decisive — the cross-
encoder won't change it. If the gap is small (e.g., 0.02), the ranking is uncertain
and the cross-encoder might reorder.

**Expected average latency**: ~50-100ms (vs current ~700ms), because the cross-encoder
only fires on the ~30-40% of queries where cheap scorers disagree. Identifier lookups
(where MaxSim excels) skip the cross-encoder entirely.

### 26.4 Model Choice Matters: Full vs Edge

The cascade design changes the full-vs-edge model tradeoff:

| Model | Query encode | MaxSim discrimination | Cross-encoder skip rate |
|-------|-------------|----------------------|------------------------|
| **Edge (17M, 48d)** | 2.1ms | 0.4454 | Lower — smaller score gaps mean more queries need cross-encoder |
| **Full (149M, 128d)** | 9.8ms | 0.6275 | Higher — larger score gaps mean more queries are decisive |

The edge model is faster per-query, but its lower discrimination (0.45 vs 0.63) means
the confidence threshold is hit less often, so more queries fall through to the cross-
encoder. The full model is slower per-query but may produce **lower average latency**
overall because it skips the cross-encoder more often.

This is a critical benchmarking question:
- Edge: 2ms query + cross-encoder 40% of the time = 2 + 0.4×350 = **142ms avg**
- Full: 10ms query + cross-encoder 25% of the time = 10 + 0.25×350 = **97ms avg**

These numbers are speculative — the actual skip rates depend on the query distribution
and the threshold. **Must benchmark both models with real queries before deciding.**

### 26.5 Per Query Type Pipelines

**LEXICAL-ONLY** (identifier search):
```
BM25 → expand → MaxSim rerank → [confidence gate] → optional cross-encoder → budget
```
Currently lexical gets ZERO reranking. MaxSim adds token-level scoring for free.

**SEMANTIC-ONLY** (conceptual questions):
```
Binary → Int8 → expand → MaxSim rerank → [confidence gate] → cross-encoder → budget
```

**HYBRID** (most common):
```
BM25 ‖ (Binary → Int8) → CC fusion + MMR → expand → MaxSim → [gate] → cross-encoder → budget
```

**STRUCTURAL** (relationship/navigation queries):
```
BM25 structural → expand → MaxSim rerank → [gate] → optional cross-encoder → budget
```

### 26.6 Fusion with Int8 Scores

Moving the cross-encoder to after fusion means CC fusion uses Int8 cosine scores
instead of reranker scores for the semantic side. This is acceptable: Int8 cosine
preserves relative ordering within 1–3% of float32 cosine, and fusion cares about
ordering rather than absolute score magnitude.

### 26.7 Notes on Existing Token Budgets

The internal `hop2TokenBudget` (4000 tokens) inside `expandSecondHopAdaptive` is NOT
affected — it limits candidate generation during graph traversal and stays in place.
Only the final `applyTokenBudget` (8000 tokens) moves to after the scoring cascade.

### 26.8 Session Warmup: Pre-Load Late Interaction Model

The late interaction model MUST be pre-loaded during session warmup for this cascade
to work. A cold-start query that triggers model download + ONNX session creation
would be catastrophic for latency.

Current state: session warmup already pre-loads the late interaction model
(`session-warmup.js:508-521`, `pre-ready` phase, gated on
`LATE_INTERACTION_CONFIG.enabled`). This loads the ONNX session, tokenizer, and
skiplist. The warmup fires for whichever model is configured (full or edge).

What's needed:
- [ ] **Verify warmup includes probe inference** — the `loadModel()` in
  `late-interaction-model.js` runs a probe inference to detect projection dimensions.
  Confirm this runs during warmup, not deferred to first query.
- [ ] **Measure warmup latency for both models**: full model ONNX session creation
  was 815ms in validation; edge was 294ms. These are one-time costs that must complete
  before the first search.
- [ ] **Consider pre-encoding a warmup query** during session warmup to prime any
  lazy caches in the ONNX runtime (thread pool startup, memory allocation). A single
  `encodeQuery("warmup")` call during warmup would ensure the first real query doesn't
  pay cold-start overhead.

### 26.9 Open Questions (Needs Discussion + Benchmarking)

These questions cannot be answered without benchmarking. They should be resolved
during Phase 5 benchmarks (Section 0.3) or in a dedicated pipeline restructuring
benchmark pass.

1. **Does the confidence gate actually work?** The score-gap heuristic assumes that
   large MaxSim gaps correlate with correct rankings. This may not hold — a document
   could score high on MaxSim due to token overlap but be semantically wrong. The
   cross-encoder would catch this. Benchmark: measure MRR with and without the gate
   at various thresholds.

2. **Full vs edge for the cascade?** The full model gives better discrimination but
   adds ~8ms per query. If the cross-encoder skip rate is significantly higher, the
   full model wins on average latency. If skip rates are similar, edge wins. This is
   query-distribution-dependent and must be measured on real benchmarks.

3. **What replaces FlashRank Stage 1?** If MaxSim becomes Stage 1, FlashRank becomes
   redundant. But FlashRank is a general-purpose reranker that works on any text, while
   MaxSim requires pre-indexed token vectors. Queries that hit chunks without late
   interaction tokens (e.g., newly added files not yet re-indexed) would have no MaxSim
   scores. FlashRank could serve as the fallback for un-indexed chunks.

4. **Should the cross-encoder run on fewer candidates?** Currently it scores 20. If
   MaxSim already identified a clear winner, we could pass only the top 5-10 to the
   cross-encoder, cutting its latency by 50-75%. The confidence gate could also
   modulate HOW MANY candidates go to the cross-encoder (not just whether it runs).

5. **Is MaxSim redundant with the cross-encoder on the same candidates?** Yes, when
   both score the same set. The restructuring avoids this by making them sequential
   stages with the gate between them, not parallel scorers on the same input. But if
   the gate threshold is set too low (always passes through), we're back to the
   redundancy problem.

6. **Graph expansion on a broader candidate set?** Currently we expand the top 20.
   If MaxSim can cheaply score 50+ candidates, we could expand the top 50, then let
   MaxSim + the gate determine which make the final cut. More candidates = better
   recall at the expansion stage, at negligible cost (MaxSim is ~0.04ms per candidate).

### 26.10 Action Items

**Phase A: Benchmark current pipeline components (prerequisite)**
- [ ] **Measure MaxSim scoring latency** on pre-indexed tokens: time per candidate
  at 20, 50, 100 candidates with both full and edge model tokens
- [ ] **Measure FlashRank latency** at 20, 50 candidates for comparison
- [ ] **Compute score gap distributions** on CodeSearchNet: what fraction of queries
  have decisive MaxSim gaps (>0.15) vs ambiguous gaps (<0.05)?
- [ ] **Measure cross-encoder impact on MaxSim-reranked results**: after MaxSim
  reranking, does the cross-encoder change the top-1 result? If rarely, the gate
  threshold can be aggressive. Count: "cross-encoder changed rank-1 in X% of queries"

**Phase B: Restructure pipeline (after benchmarks inform design)**
- [ ] **Extract late interaction + reranker from `semanticSearch3Stage`** into a
  standalone `cascadedRerank(candidates, query)` function
- [ ] **Implement confidence gate**: configurable threshold, fallback to full
  cross-encoder when MaxSim scores are ambiguous
- [ ] **All search paths**: route through the shared cascade (lexical, semantic,
  hybrid, structural)
- [ ] **Fallback for un-indexed chunks**: if a candidate has no late interaction
  tokens (not indexed or index stale), fall through to FlashRank or cross-encoder
- [ ] **Move `applyTokenBudget`** to after the cascade in all paths

**Phase C: Validate**
- [ ] **A/B benchmark** on CodeSearchNet + GenCodeSearchNet: compare MRR + latency
  of current pipeline vs restructured cascade at various gate thresholds
- [ ] **Per-model comparison**: run cascade with full model vs edge model, measure
  average latency including cross-encoder skip rates
- [ ] **Regression test**: verify each query type doesn't degrade
- [ ] **Latency distribution**: p50, p95, p99 before and after — the p95 matters
  more than p50 for user experience

### 26.11 Priority

**HIGH** — two architectural issues (expanded entities unranked, redundant scorers)
plus a major latency optimization opportunity (conditional cross-encoder). Combined
with Section 24 (query-dependent expansion scoring), this restructuring makes the
pipeline both faster and more accurate. But the design depends on benchmarking results
— don't implement before Phase A measurements.

---

## 27. PathRAG Prompt Positioning: "Lost in the Middle" Mitigation

**Status**: Not implemented. PathRAG (arxiv 2502.14902, Feb 2025) identified that
result ordering in the LLM context window matters significantly: LLMs systematically
underweight information in the middle of long contexts and overweight content at the
beginning and end. They term this "lost in the middle" degradation.

### 27.1 The Problem

When we return 10 results to the LLM (via MCP or the search API), we currently order
them by score descending — highest score first. The LLM receives:

```
[Rank 1 — most relevant]   ← LLM pays high attention
[Rank 2]
[Rank 3]
...
[Rank 9]
[Rank 10 — least relevant] ← LLM pays high attention (end-of-context effect)
```

If the correct answer is Rank 3 or 4, it lands in the middle of the context window
where LLM attention is lowest. PathRAG's solution: place the most reliable/relevant
results at the **end** of the context, not the beginning.

### 27.2 PathRAG's Approach

PathRAG orders retrieved paths by reliability score ascending, then places the most
reliable path last. Their empirical result: this ordering alone improves answer quality
on multi-hop QA benchmarks without changing what is retrieved — only how it is presented.

For our use case, the analogous approach would be to return results in reverse score
order (lowest score first, highest score last) so the most relevant chunk is the last
thing the LLM reads before generating its answer.

### 27.3 Considerations

This is a simple reordering of the output array. There is no latency cost.

The tradeoff: for users who inspect search results directly (not via LLM), the
highest-relevance result should be at the top (current behavior). For LLM consumption,
it should be at the bottom (PathRAG recommendation). These are in conflict.

Options:
- Add an `outputOrder: 'asc' | 'desc'` option to the search API, default `'desc'`
  for display, with MCP callers passing `'asc'` for LLM context construction
- Or: only reverse in the MCP tool handler, not in the core search API

### 27.4 Action Items

- [ ] **Research**: does "lost in the middle" apply to our primary LLM targets
  (Claude 3.5+, GPT-4o)? Both have improved long-context handling. Check if the
  effect is still significant at 10 results vs 50+.
- [ ] **Prototype**: add `reverseForLLM: true` option to MCP tool handler, benchmark
  on a QA task where the correct code answer is known (CosQA or CoQuIR are suitable)
- [ ] **Measure**: compare answer quality with score-descending vs score-ascending
  result ordering at the MCP layer
- [ ] If positive: make score-ascending the default in the MCP tool handler

### 27.5 Priority

**LOW-MEDIUM** — zero implementation cost if the reordering is confirmed beneficial.
The main question is whether modern LLMs still exhibit "lost in the middle" degradation
at our result set sizes (10–30 chunks). Worth a quick experiment before committing.

---

## 28. ColGrep Integration: Hybrid Regex+Semantic Search + PLAID Index

**Status**: Not started. Research complete. LightOn released ColGrep (Rust CLI) and
NextPlaid (PLAID multi-vector engine) alongside the LateOn-Code models we already use.

### 28.1 What ColGrep Is

ColGrep is a semantic code search CLI built on NextPlaid (a pure Rust PLAID engine).
It combines grep-style regex filtering with LateOn-Code semantic ranking. Key stats
from LightOn's eval (Claude Opus 4.5, 135 questions across HuggingFace repos):

- 70% win rate vs vanilla grep
- 15.7% average token reduction for the agent
- 56% fewer search operations per question
- Grep still wins when function names are highly descriptive (TRL)

Architecture: single Rust binary, no server, ONNX baked in. Incremental indexing
(detects file changes automatically). PLAID compressed multi-vector index. Unit-aware
chunking via tree-sitter.

Source: `lightonai/next-plaid` on GitHub. Apache-2.0 license.

### 28.2 Why This Matters for Sweet Search

We have 4 search modes: `lexical`, `semantic`, `hybrid`, `structural`. None support
"find all code matching a regex pattern, then rank by semantic relevance." This is a
real gap — agents frequently need "show me all implementations of X pattern, ranked
by relevance to concept Y."

ColGrep's hybrid query model (`-e "regex" "semantic query"`) solves this directly.
Their eval proves it works better than plain grep for agentic code navigation.

### 28.3 Integration Plan: Hybrid Pattern+Semantic Search Mode

Add a 5th search mode: `pattern` — regex filter then late interaction rerank.

```
ss -e "fn.*sort" "sorting algorithm"
ss --mode=pattern --regex="class.*Service" "authentication"
```

Pipeline:
```
1. Regex scan (ripgrep or FTS5 trigram)  →  matched files/chunks
2. Late interaction encode query          →  token vectors
3. Late interaction encode matched chunks →  token vectors (from index if available)
4. MaxSim rerank matched chunks           →  sorted by semantic relevance
5. Apply token budget                     →  final results
```

This fills the gap identified in TODO Section 14 (Code-to-Code Search). When the
"query" is a code pattern (regex), we can't embed it meaningfully. But we CAN regex-
match first, then semantically rank the matches using a natural language intent string.

#### Implementation Steps

- [ ] **Add `pattern` mode to search-cli.js**: `--mode=pattern`, `-e <regex>` flag
      for the regex component, remaining positional args as the semantic query
- [ ] **Add `pattern` mode to search-server.js**: `?mode=pattern&regex=<regex>&q=<query>`
- [ ] **Core implementation in sweet-search.js**: new `patternSearch()` method that:
      (a) runs ripgrep or FTS5 trigram to find regex matches,
      (b) maps matches to indexed chunks,
      (c) runs late interaction rerank on matched chunks
- [ ] **Update ss-fast.c**: add `-e, --regex <pattern>` flag
- [ ] **MCP tool support**: add `regex` parameter to the search MCP tool
- [ ] **Benchmark**: measure on COIR "unknown" language queries (46.4% MRR currently)
      where queries are code snippets — extract identifiers as regex, use the snippet's
      intent as the semantic query

### 28.4 PLAID Index: When and Why

PLAID (Performance-optimized Late Interaction using Approximate Dimensions) is the
compressed multi-vector index format used by ColBERTv2, NextPlaid, and ColGrep.

**How PLAID works:**
1. K-means cluster ALL document token embeddings → centroid codebook
2. Store each token as: centroid ID (4 bytes) + quantized residual (16-32 bytes)
3. Build an IVF mapping centroids → documents containing those tokens
4. At query time, 3-stage pipeline:
   - Centroid routing: find most relevant centroids for query tokens
   - Centroid interaction: score documents using ONLY centroid IDs (no decompression)
   - Exact MaxSim: decompress and score only the top ~100 candidates

Storage: 36 bytes per 128d token (vs 512 bytes float32, vs 128 bytes our int8).
This is ~3.5x smaller than our current int8 quantization.

**Why PLAID does NOT help our current pipeline:**

Our late interaction is a **reranker** on 20 candidates, not a **retriever** over the
full index. We only ever run MaxSim on ~20 docs × ~50 tokens = 6,000 dot products.
That's microseconds. PLAID's multi-stage centroid routing was designed to avoid brute-
force MaxSim over MILLIONS of documents (MS MARCO = 8.8M passages). At our scale,
PLAID's overhead would make scoring *slower* than our brute-force approach.

| Our scale (11K chunks, 550K tokens) | PLAID designed for |
|--------------------------------------|-------------------|
| MaxSim reranker on 20 candidates     | Primary retriever over 8.8M passages |
| 6,000 dot products per query         | Would be 550M without pruning |
| Brute-force: ~0.01ms                 | Brute-force: impossible |
| int8 index: ~69 MB                   | Uncompressed: 170+ GB |

**When PLAID becomes useful:**

1. **Monorepo scale** (100K+ chunks): int8 index grows to 600+ MB. PLAID's 3.5x
   compression brings it to ~170 MB and the multi-stage pipeline starts paying off
   because brute-force MaxSim on 5M tokens per query is no longer microseconds.

2. **Late interaction as primary retriever**: If we ever want to skip HNSW entirely
   and use PLAID for first-stage retrieval (like ColGrep does), we need the centroid
   routing infrastructure. This would eliminate the dense embedding model dependency
   for the semantic path — LateOn-Code does both retrieval and reranking.

3. **ColGrep ecosystem interop**: ColGrep uses PLAID natively. If we want to share
   indexes (e.g., ColGrep indexes the repo, Sweet Search reads the same index for
   its reranking), we need PLAID-compatible storage.

**Recommendation**: Defer PLAID until either (a) a monorepo user reports storage/
perf issues, or (b) we decide to use late interaction as a primary retriever. For now,
our int8 JSON index is fine for the reranker role.

#### PLAID Implementation Steps (When Ready)

- [ ] **Implement K-means clustering** of token vectors at index time (or use existing
      HNSW centroids from the dense index as starting points)
- [ ] **Replace `late-interaction-index.js`** JSON storage with centroid ID + 2-bit
      residual binary format
- [ ] **Add centroid interaction scoring** as a fast pre-filter before exact MaxSim
      (only relevant if candidate count grows beyond ~100)
- [ ] **Evaluate NextPlaid Rust crate** (`next-plaid` on crates.io) as a potential
      FFI dependency instead of reimplementing in JS. Their crate is pure Rust,
      CPU-only, Apache-2.0. Could be called via `napi-rs` bindings.
- [ ] **Index compatibility**: ensure our PLAID index can be read by ColGrep and
      vice versa (same centroid format, same residual encoding)
- [ ] **Benchmark**: storage reduction and scoring latency at 10K, 50K, 100K chunks

### 28.5 Future: ColGrep as MCP Tool Alternative

A longer-term option is exposing ColGrep directly as an MCP tool alongside Sweet
Search's existing search tool. This gives agents two complementary interfaces:

- **Sweet Search**: full pipeline (BM25 + semantic + graph expansion + reranking +
  late interaction + quality scoring + token budget). Best for complex queries.
- **ColGrep**: fast regex+semantic hybrid. Best for "find this pattern and rank by
  relevance." Single binary, no server dependency.

This is NOT a replacement — Sweet Search has graph expansion, translation fallback,
vocabulary prewarm, cascaded reranking, and HCGS summaries that ColGrep can't do.
ColGrep is a focused tool for a specific query pattern.

- [ ] **Evaluate ColGrep as optional MCP tool** — measure whether agents benefit from
      having both tools available vs Sweet Search's `pattern` mode alone
- [ ] **Shared index**: if both tools read the same PLAID index, users don't pay
      double indexing cost

### 28.6 Blend Weight: SONA Adaptive Learning

The current late interaction blend weight (`α = 0.3` in `search-postprocess.js`) was
set for the old pseudo-ColBERT approximation and never tuned for real MaxSim scores.

Research consensus (arXiv 2508.01405, "Balancing the Blend"): optimal blend weight
varies per dataset. No universal constant exists. Production systems use RRF (rank-
based, no tuning), learned weights (train on dev set), or query-dependent blending.

**Problems with fixed 0.3:**
- MaxSim scores range ~0.14–0.77. BM25 scores can be 0–30+. Cosine scores are 0–1.
  Linear blending without score normalization is comparing different distributions.
- LateOn-Code was trained for text→code (docstring queries → function documents).
  Identifier-heavy queries may benefit from higher α. NL-concept queries may not.

**Proposed SONA adaptive approach** (builds on TODO Section 1.3):

1. Store per-codebase blend weight in AgentDB, keyed by repo fingerprint
2. Cold start: use benchmark-tuned default (TBD from Phase 5 benchmarks)
3. Feedback signal from MCP usage: file opens (positive), re-searches (negative)
4. Per-query-type α: intent router (when re-enabled) routes identifier queries to
   higher α, conceptual queries to lower α
5. Score normalization: min-max normalize MaxSim and base scores to [0,1] before
   blending, so α is meaningful regardless of score distribution

**Action items:**
- [ ] **Phase 5 benchmarks first**: establish baseline default α across CodeSearchNet +
      GenCodeSearchNet with α ∈ {0.1, 0.2, 0.3, 0.5, 0.7} and RRF as comparison
- [ ] **Score normalization**: add min-max normalization in `search-postprocess.js`
      before blending (zero-cost: we already have the score array)
- [ ] **RRF alternative**: test `1/(k + rank_lateInteraction) + 1/(k + rank_base)` as
      a tuning-free fusion method, compare MRR to weighted sum at best α
- [ ] **SONA wiring**: connect MCP file-open events to blend weight adjustment.
      Convergence: ~50-100 searches per codebase to stabilize
- [ ] **Per-intent α**: when intent router returns (TODO Section 2), add per-intent
      blend weight overrides to intent policies

### 28.7 Priority

**Pattern mode (28.3)**: HIGH — fills a real search capability gap, low implementation
effort (mostly wiring existing components), directly addresses COIR benchmark weakness.

**PLAID index (28.4)**: LOW — our current int8 reranker index works fine at typical
codebase scale. Revisit when monorepo users report issues or when we want to use late
interaction as a primary retriever.

**ColGrep MCP tool (28.5)**: MEDIUM — depends on whether the `pattern` mode alone is
sufficient. Evaluate after implementing 28.3.

**SONA blend weight (28.6)**: MEDIUM — requires Phase 5 benchmarks as prerequisite.
Score normalization can be done immediately (zero risk, zero cost). SONA trajectory
hooks are a larger investment that also benefits TODO Section 1.3 (quality scorer).

---

## Cross-Cutting: No P2 Item Has Been A/B Tested

The single biggest gap across all P2 features is the absence of benchmarking.
The 2026-02-19 baseline (balanced profile, no late interaction) now provides the reference
point for A/B testing. Before investing more engineering effort in any P2 item:

- [ ] Enable each P2 feature individually and measure MRR/Recall delta
- [ ] Only invest further in features that show measurable improvement
- [ ] Gate all default-on changes on statistically significant benchmark wins

### Recommended A/B Test Priority Order

1. **Late interaction enable** (Section 0) — highest expected impact, infrastructure exists
2. **Late interaction blend weight tuning** (Section 28.6) — score normalization + α sweep
3. **Pipeline restructuring** (Section 26) — single reranker pass covers expanded
   entities; likely net-faster; architectural correctness
4. **Query-dependent expansion scoring** (Section 24) — ~2ms latency, no training
   data, uses existing embeddings; highest-ROI graph improvement
5. **Pattern search mode** (Section 28.3) — regex+semantic hybrid, fills real gap
6. ~~**JS/TS chunking hardening** (Section 9)~~ — DONE (2026-03-02)
7. **Graph expansion on by default** (Section 5) — gate on A/B validation first
8. **Quality scorer qualityWeight** (Section 1.1) — quick to A/B test
9. **Graph expansion adaptive 2-hop benchmarking** (Section 5) — needs A/B validation
10. **Token estimation fix** (Section 22) — prerequisite for knapsack; zero latency
11. **MinCut graph expansion** (Section 10.2) — structural importance complement
12. **Path-level scoring** (Section 23) — medium-low impact, zero latency
13. **Budget allocation knapsack** (Section 25) — depends on Section 22; A/B first
14. **Intent router** (Section 2) — requires CatBoost training first, defer
15. **SEISMIC sparse** (Section 3) — requires SPLADE integration first, defer
16. **CrossCodeEval structural routing** (Section 11) — niche but tests graph infra
17. **PLAID index** (Section 28.4) — defer until monorepo scale demands it
18. **ColGrep MCP tool** (Section 28.5) — evaluate after pattern mode proves value
