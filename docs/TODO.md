# Sweet Search TODO

Tracked gaps, vulnerabilities, and future work. Items are ordered by priority
within each section. Updated 2026-02-23 with completed items removed.

## Full Benchmark Baseline (2026-02-19)

20,262 queries across 8 benchmarks, ~4 hours wall time. Zero errors.

**Profile**: `balanced` — NO ColBERT (disabled at index+query time), WITH cascaded
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

## 0. ColBERT: Upgrade to LateOn-Code + Enable by Default

**Status**: ColBERT infrastructure is complete (`core/colbert-index.js`) but was
DISABLED in all benchmark runs (`buildColBERT: false, useColBERT: false` in the
`balanced` profile). The configured model is `jinaai/jina-colbert-v2` — **no longer
SOTA as of 2026-02-12.**

### 0.1 Current ColBERT Model Is Outdated

Jina ColBERT v2 (560M, 2024) has been superseded by **LateOn-Code** (LightOn AI,
released 2026-02-12):

| Model | Size | MTEB Code v1 Avg | CSN MRR | Architecture |
|-------|------|------------------|---------|--------------|
| LateOn-Code | 130M | 74.12 | 90.40% | ModernBERT + PyLate |
| EmbeddingGemma-300M | 300M | 68.76 | — | Gemma |
| LateOn-Code-edge | 17M | 66.64 | — | ModernBERT (small) |
| Jina ColBERT v2 | 560M | < LateOn | — | XLM-RoBERTa |

Key facts:
- LateOn-Code is purpose-built for code (trained on CoRNStack: Go, Java, JS, PHP,
  Python, Ruby — same 6 languages as CodeSearchNet).
- 130M params — almost identical to CodeRankEmbed (137M). Would NOT increase memory
  footprint vs current Jina ColBERT v2 (560M is 4x larger).
- Uses ModernBERT — same architecture family as our GTE-Reranker. Potential for
  shared ONNX runtime session pooling.
- HuggingFace: `lightonai/lateon-code` (full), `lightonai/lateon-code-edge` (17M).
- PyLate framework — needs ONNX export or `@huggingface/transformers` integration.

### 0.2 Expected Impact on Benchmark Scores

Late interaction (ColBERT) adds token-level matching on top of chunk-level
embeddings. This helps most when:
- Queries contain specific identifiers that dense embeddings average away
- Code has verbose signatures (Java `AbstractFactoryBuilder.createWidget()`)
- Language has many synonymous patterns (JS `function`/`=>`/`class method`)

**Estimated MRR deltas from enabling ColBERT (conservative):**

| Benchmark | Current MRR | Expected w/ ColBERT | Delta | Confidence |
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

- [ ] **ONNX export of LateOn-Code**: Export `lightonai/lateon-code` to ONNX INT8
  (same pattern as CodeRankEmbed). Verify token-level output shape matches our
  ColBERT index schema (per-token 128d vectors).
- [ ] **Update `COLBERT_CONFIG.model`** from `jinaai/jina-colbert-v2` to the new
  model ID in `core/config.js`.
- [ ] **Also evaluate LateOn-Code-edge** (17M): If quality is acceptable, the
  tiny model makes ColBERT essentially free at query time.
- [ ] **Re-run CodeSearchNet + GenCodeSearchNet with ColBERT enabled**: Use
  `--profile=full` on just these two benchmarks (~1-2h extra for ColBERT indexing).
  Measure per-language MRR delta.
- [ ] **If Java MRR improves >10 points**: Enable ColBERT in the `balanced` profile
  by default (`buildColBERT: true, useColBERT: true`).
- [ ] **ColBERT indexing cost**: Current ColBERT does per-line embedding (up to 16
  lines/chunk × 200 chars). For 1200 chunks that's ~9600 extra embed calls. Measure
  actual wall time and decide if it's acceptable for default indexing.

### 0.4 Priority

**HIGH** — This is the single highest-ROI improvement available. ColBERT
infrastructure already exists and works. Swapping the model is a config change.
The benchmark run proved the pipeline is stable (0 errors across 20K queries).
The only blocker is ONNX export of LateOn-Code.

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

- ~~**REMOVE `scoreRecency()` git dependency**~~ — DONE (2026-02-23). Replaced
  `spawnSync('git', ['log', ...])` with `fs.statSync().mtimeMs`. Note: mtime !=
  git commit time — on fresh clones all files score ~1.0. Acceptable tradeoff for
  a search engine running in a dev's working tree.
- ~~`scoreTestProximity()` uncached `fs.existsSync()`~~ — DONE (2026-02-23). Added
  module-level `_testProximityCache` Map + `clearTestProximityCache()` export.
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

- [x] ~~**Wire adaptive 2-hop into the search pipeline**~~ — DONE (2026-02-23)
- [ ] **Benchmark adaptive vs simple 2-hop**: Measure Recall/MRR delta on eval
  harness. If adaptive doesn't help, revert.
- [x] ~~**Justify or tune magic decay constants**~~ — DONE (2026-02-23). Replaced
  with per-edge-type `effectiveAlpha^2` from `BASE_ALPHA + EDGE_ALPHA_BONUS[type]`.
- [ ] **Token budget validation**: Verify that token estimates (10 tokens/line) are
  reasonable across different languages and codebases.
- [ ] **Intent policy integration**: Consider having intent policies set
  `adaptiveHop2: true` for appropriate intents (e.g., refactor, bug_fix).

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
get averaged away. Late interaction (ColBERT) would help by preserving token-level
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

- [ ] **Enable ColBERT** (Section 0) — expected to help Java most (+15-25 MRR pts)
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
ColBERT. A full-profile run is needed for a complete picture.

### 8.1 What Was Missing

The `balanced` profile in `eval/run_all.js` sets:
```js
{ buildColBERT: false, useColBERT: false, sqliteFast: true,
  indexMode: 'single', requireNativeAnn: false }
```

This means the benchmark results are CodeRankEmbed + FlashRank/ModernBERT
reranking only. ColBERT late interaction, which is the main retrieval feature
differentiator, was never tested.

### 8.2 Indexing Time Concern

The balanced run took ~4 hours for 20K queries. ColBERT adds per-line embedding
(up to 16 lines × 200 chars per chunk). Rough estimate for full ColBERT indexing
across all 8 benchmarks: +8-20 hours.

**Recommendation**: Don't run all 8 with ColBERT. Run selectively:
- CodeSearchNet (1,200 queries) — to see per-language ColBERT impact
- GenCodeSearchNet (6,000 queries) — largest dataset, most representative
- COIR (4,500 queries) — mixed tasks, good diversity

Skip: AdvTest (already 91.5%), CosQA (too small), CrossCodeEval (fundamentally
different task), CoQuIR (quality-focused, ColBERT won't help much).

### 8.3 Action Items

- [ ] **Run selective ColBERT benchmark** on CSN + GCSN + COIR (~3 benchmarks)
- [ ] **Compare balanced vs full profile** per-language and per-benchmark
- [ ] **Measure ColBERT indexing overhead** to decide if it can be default-on
- [ ] **Document the full vs balanced delta** in eval/results/

---

## 9. JavaScript/TypeScript Chunking + Entity Extraction Hardening

**Status**: Current JS patterns cover basic cases but miss several modern JS/TS
patterns that are common in real-world codebases. This directly impacts benchmark
performance (JS at 65.5% MRR on GenCSN vs Go at 93.6%).

### 9.1 Current JS Chunker Patterns (registry-core.js)

What we detect:
- `function foo()` — function declarations
- `const foo = (` — arrow function assignments (parenthesized params only)
- `class Foo` — class declarations
- `export function/const/class` — exported declarations

### 9.2 Missing Modern JS Patterns

**Chunker gaps** (boundary detection in `document-chunker.js`):

- [ ] **Arrow functions without parens**: `const fn = x => x + 1` — the `arrow`
  pattern requires `\(` so single-param arrows without parens are missed.
- [ ] **Object method shorthand**: `{ foo() {}, bar: function() {} }` — common in
  Express route handlers, test suites, Vue options API, config objects. Not detected
  as boundaries.
- [ ] **Destructured exports**: `const { foo, bar } = require('./utils')` — CJS
  destructured imports create entities we never see.
- [ ] **`module.exports = { ... }`**: CJS default export pattern. The object's
  methods are invisible to the chunker.
- [ ] **`module.exports = function()`**: CJS function export — no name to capture.
- [ ] **`export default function/class`**: Default exports without a name binding.
  The regex sees `export` but there's no `const` or named `function` after it.
- [ ] **Getter/setter syntax**: `get foo() {}`, `set foo(v) {}` — class accessors
  and object literal accessors. Not matched by any pattern.
- [ ] **Computed property methods**: `[Symbol.iterator]() {}`, `['method']() {}` —
  the method name isn't a simple identifier.
- [ ] **Generator functions**: `function* gen()`, `async function* gen()` — the `*`
  breaks the function pattern.
- [ ] **`let`/`var` arrow functions**: The arrow pattern only matches `const`. Real
  code uses `let` for reassignable arrow functions.

**Graph entity gaps** (entity extraction in `graph-extractor.js`):

- [ ] **`require()` calls**: `const x = require('module')` — CJS imports are not
  captured by the `import` relationship pattern which only matches ESM `import`.
- [ ] **Dynamic imports**: `const mod = await import('./module')` — not matched.
- [ ] **Re-exports**: `export { foo } from './bar'`, `export * from './utils'` —
  the import pattern expects `import` keyword, not `export ... from`.
- [ ] **Named arrow functions in objects**: `const routes = { getUser: async (req) => {} }`
  — the arrow pattern expects top-level `const name = async (`, not nested.
- [ ] **Callback patterns**: `app.get('/path', (req, res) => {})` — anonymous
  callbacks that define significant behavior but have no name to extract.

**Tree-sitter tags.scm gaps** (`tree-sitter-provider.js`):

- [ ] **Named arrow function assignment**: The query `(arrow_function) @arrow.definition`
  captures the arrow but loses the variable name. Should use
  `(variable_declarator name: (identifier) @arrow.definition value: (arrow_function))`.
- [ ] **Object methods**: `(pair key: (property_identifier) @method.definition value: (function_expression))`
  — Express/Koa route handlers.
- [ ] **Generator functions**: `(generator_function_declaration name: (identifier) @function.definition)`
- [ ] **Export default**: `(export_statement value: (class_declaration name: (identifier) @class.definition))`

### 9.3 Priority

**HIGH** — JavaScript and TypeScript are the most common languages for Claude Code
users. Improving chunking boundaries and entity extraction directly impacts how
well we chunk JS files and how many entities appear in the graph. Even without
ColBERT, better chunking means better embedding quality (chunks aligned to
semantic boundaries embed better than arbitrary line splits).

### 9.4 Action Items

- [ ] Add missing chunker patterns for modern JS (arrow without parens, generators,
  getters/setters, object method shorthand, `let`/`var` arrows)
- [ ] Add `require()` and `export ... from` to JS/TS graph relationship patterns
- [ ] Fix tree-sitter arrow function query to capture the variable name, not
  just the arrow_function node
- [ ] Add tree-sitter queries for object methods, generators, export defaults
- [ ] Add tests for each new pattern (use existing chunker test structure)
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

## Cross-Cutting: No P2 Item Has Been A/B Tested

The single biggest gap across all P2 features is the absence of benchmarking.
The 2026-02-19 baseline (balanced profile, no ColBERT) now provides the reference
point for A/B testing. Before investing more engineering effort in any P2 item:

- [x] Run eval harness baseline with ALL P2 features disabled — DONE (2026-02-19,
  20,262 queries, 8 benchmarks, balanced profile)
- [ ] Enable each P2 feature individually and measure MRR/Recall delta
- [ ] Only invest further in features that show measurable improvement
- [ ] Gate all default-on changes on statistically significant benchmark wins

### Recommended A/B Test Priority Order

1. **ColBERT enable** (Section 0) — highest expected impact, infrastructure exists
2. **JS/TS chunking hardening** (Section 9) — directly impacts #2 most common language
3. **Quality scorer qualityWeight** (Section 1.1) — quick to A/B test
4. **Graph expansion adaptive 2-hop benchmarking** (Section 5) — now enabled, needs A/B validation
5. **MinCut graph expansion** (Section 10.2) — structural importance complement to SOTA scoring
6. **Intent router** (Section 2) — requires CatBoost training first, defer
7. **SEISMIC sparse** (Section 3) — requires SPLADE integration first, defer
8. **CrossCodeEval structural routing** (Section 11) — niche but tests graph infra
