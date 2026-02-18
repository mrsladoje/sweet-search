# Sweet Search TODO

Tracked gaps, vulnerabilities, and future work from the P2 brutal honesty review
(2026-02-17). Items are ordered by priority within each section.

## P2 Review Summary (2026-02-17)

| Item | Grade | Real? | Integrated? | Used by default? |
|------|-------|-------|-------------|------------------|
| SEISMIC Sparse Index | A code / F integration | Yes (complete algorithm) | No (dead code) | No |
| Intent Router | B+ | Yes | Yes (full pipeline) | DISABLED (was auto) |
| Quality Scorer | C+ | Yes (6 factors) | Yes (but qualityWeight=0) | No (disabled) |
| tags.scm (P2.4) | B- | Partial (hand-written queries) | Yes (in tree-sitter provider) | Yes (for 5 langs) |
| 2-Hop Adaptive Expansion | B | Yes | Simple 2-hop only | No (adaptive variant unused) |

**No P2 item has been A/B tested against a baseline.**

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

- **REMOVE `scoreRecency()` git dependency**: `git log` is called synchronously
  (spawnSync, 5s timeout) -- blocks the search thread on large repos. Git can be
  arbitrarily slow on networked filesystems, large monorepos, or shallow clones.
  **Recommendation: remove the git log factor entirely.** If recency is needed,
  use `fs.statSync().mtimeMs` instead (instant, no git dependency). Or pre-compute
  during indexing and store in the DB.
- `scoreTestProximity()` does uncached `fs.existsSync()` per chunk -- O(n) syscalls
  for batch scoring. Add a per-session cache.
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

## 5. 2-Hop Adaptive Graph Expansion: Adaptive Variant Unused

**Status**: Simple 1-hop and 2-hop expansion are live and working. The adaptive
variant (`expandSecondHopAdaptive()` in `core/graph-expansion.js`) with priority
scoring and token budgets is **implemented but never called**.

### 5.1 Current State

- `expandResults()` dispatches to `expandSecondHop()` (simple) not
  `expandSecondHopAdaptive()` for 2-hop mode.
- `adaptiveHop2` parameter exists in the search API but is never set to true by
  any code path (including intent policies).
- Score decay multipliers (0.6, 0.45, 0.25) are magic numbers with no empirical
  justification.
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

- [ ] **Wire adaptive 2-hop into the search pipeline**: When `adaptiveHop2: true`,
  `expandResults()` should call `expandSecondHopAdaptive()` instead of
  `expandSecondHop()`.
- [ ] **Benchmark adaptive vs simple 2-hop**: Measure Recall/MRR delta on eval
  harness. If adaptive doesn't help, remove the dead code.
- [ ] **Justify or tune magic decay constants**: 0.6 (1-hop), 0.45 (priority 2-hop),
  0.25 (non-priority 2-hop) need sensitivity analysis or empirical tuning.
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

## Cross-Cutting: No P2 Item Has Been A/B Tested

The single biggest gap across all P2 features is the absence of benchmarking.
Before investing more engineering effort in any P2 item:

- [ ] Run eval harness baseline with ALL P2 features disabled
- [ ] Enable each P2 feature individually and measure MRR/Recall delta
- [ ] Only invest further in features that show measurable improvement
- [ ] Gate all default-on changes on statistically significant benchmark wins
