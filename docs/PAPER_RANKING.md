# PAPER_RANKING.md — Sweet-Search Paper-Worthy Contributions

**Compiled**: 2026-04-14
**Method**: 11 parallel Explore agents swept the codebase; top candidates verified against published literature via Tavily web search. Scoring is intentionally harsh — a published paper exists to withstand reviewer scrutiny, not cheerlead. If prior art exists, it is cited.
**Audience**: Codex reviewer + paper-writing decision

---

## Methodology

Each item has:
- **Where**: concrete file paths (trust but verify)
- **What**: one-paragraph concrete description
- **Prior art**: closest published work, honest overlap assessment
- **Benchmark**: measurement if one exists, with source file
- **Score**: 1–10 **Paper Reliability Score** — combined novelty × measurability × publishability

Score bands:
- **S (8–10)**: Strong paper candidate. Novel + measurable + defensible at SIGIR short / ECIR / EuroSys / EMNLP Findings.
- **A (6–7)**: Solid chapter in a systems paper. Needs a second novel claim to stand alone.
- **B (4–5)**: Engineering with a clever twist. Doesn't lead a paper; worth a paragraph.
- **C (2–3)**: Pure engineering. Performance number only.
- **D (1)**: Reimplementation of published prior art. Cite, don't claim.

---

## CRITICAL CAVEATS — READ BEFORE CITING ANY NUMBER

These are facts the context brief got slightly wrong. Correcting them now before they reach a reviewer:

1. **"84% MRR on GenCodeSearchNet"** → actual peak is **84.06%** (`eval/results/gencodesearchnet_2026-04-13T08-56-35-196Z.json`, 6,000 queries, 6 languages, full profile). Ship-config number is **83.5%** (March 23). The round 84% is real but needs the date and profile.
2. **"9.9x median vs ripgrep"** → this was **one optimization milestone** (Step 6, SortedGramTable). Current overall p50 is **10.2x median** (`docs/GREP_INDEXING_STRATEGY.md`), ranging 8.5x–17.7x across 5 repos, 353 queries. The stored JSON `grep-benchmark_2026-04-07T16-22-05-098Z.json` shows 4.31x median — pre-Step-10. Use 10.2x as the headline, but re-run the benchmark to regenerate that JSON.
3. **"11x index compression"** → **does not exist as a single measured number**. Closest components: 32x binary HNSW vs f32, 4x int8 vs f32, 3.4x SSLX binary vs JSON LI. These are independent subsystems; they cannot be multiplied.
4. **"1.48x speedup over ONNX"** → **not found in any stored result file**. Documented measurements: candle F32 ≈ ORT parity at ~33 min, BF16 adds 1.20–1.32x, CoreML cascade adds 18%. Compounded: ~1.4–1.55x. Pick one measurement and stand behind it.
5. **"MRR 25%→97.97% restoration"** → the "25%" is from concurrent Metal command buffer corruption under `--concurrency=12`; the 97.97% is Python-only on a 500q subset. Aggregate MRR went 81.92% → 83.15% after the LI `Array.prototype.flat` bug fix; after the Metal concurrency fix MRR returned to ~83.64%. The "25→97.97%" headline is technically real but requires unpacking.
6. **"probabilistic MaxSim" (PROBABILISTIC_PLAN.md)** → **100% PLANNED, 0% IMPLEMENTED**. The doc is an aspirational catalog of 19 fixes; none ship. The title misled the brief. Drop from paper scope.

---

## Verified Benchmark Inventory

From `eval/results/`, cross-checked against `docs/BENCHMARKING.md`:

| Benchmark | Current | File / Source |
|-----------|---------|---------------|
| GenCodeSearchNet MRR@10 (6000q, 6 lang) | **0.8406** | `eval/results/gencodesearchnet_2026-04-13T08-56-35-196Z.json` |
| GenCSN Python MRR (subset 500q) | 0.9793 | `eval/results/gencodesearchnet_2026-04-14T15-20-48-858Z.json` |
| AdvTest MRR@10 (1000q) | 0.9151 | `eval/results/all_benchmarks_2026-02-19T00-17-05-442Z.json` |
| CoSQA MRR@10 (100q) | 0.7195 | `eval/results/cosqa_baseline.json` |
| COIR MRR@10 (4500q, 14 langs) | 0.5733 | `eval/results/all_benchmarks_2026-02-19T00-17-05-442Z.json` |
| CrossCodeEval MRR@10 | 0.1203 | same |
| CLARC (C/C++) MRR@10 (995q) | 0.6056 | same |
| M2CRB MRR@10 (2814q) | 0.5676 | `eval/results/m2crb_baseline.json` |
| Grep latency vs rg (353q, 5 repos) | **10.2x p50** | `docs/GREP_INDEXING_STRATEGY.md` |
| HNSW opt JS Recall@100 | 80.6% → **83.4%** | `docs/HNSW_APPROACH.md` |
| HNSW opt JS Recall@200 | 80.6% → **86.5%** | same |
| HNSW opt JS p50 | 1403ms → **942ms** | same |
| MaxSim Native Rust (50 cand, d=128) | **47x** vs naive JS | `docs/MAXSIM_OPTIMIZATION.md` |
| MaxSim WASM SIMD (same) | 16x | same |
| LI correctness fix (flat bug) | 81.92% → **83.15%** | `docs/CE_RESCUE_PLAN.md`, `eval/results/ce-rescue-shadow-fixed-li.json` |
| LI storage (JSON → SSLX binary) | 1.343 GiB → **396 MiB** (3.4x) | `docs/LI_QUANTIZATION_STRATEGY.md` |
| CoreML cascade (M3 Max, 16347 docs) | 34.0 min → **27.9 min** (18%) | commit `4fd9c9a` |
| Napi Float32Array (LI b32×s2048) | 26,289ms → **12,157ms** (2.16x) | commit `b8816c1` |
| Rust CLI (warm / cold / JS fallback) | **2.9 / 108 / 64.7 ms** | `docs/INIT_STRATEGY.md` |
| Agent-intrinsic B1.5 (40q, 4 repos) | self-contain 100%, packaging p95 1ms | `eval/results/agent-intrinsic_2026-04-07T12-01-53-624Z.json` |
| Agent-vs-rg (fastify, 30q, blind Opus judge) | quality 4.81 vs 4.80, **-25.4% tokens**, **0.0 vs 4.9 reads** | `eval/agent-eval/results/fastify-judgments.jsonl` |

---

## TIER S — Strongest paper candidates

### S1. Sweet-Search as an integrated code retrieval system achieving 84.06% MRR on GenCodeSearchNet
- **Where**: end-to-end, rooted at `core/search/sweet-search.js`
- **What**: Complete pipeline (query router → binary HNSW → int8 rescore → float rescore → graph expansion → MaxSim late interaction → cross-encoder cascade gate → context packaging) running in-process on commodity hardware (M3 Max). Measured: 84.06% MRR@10, Python 98.27%, Go 94.43%, across 6 languages, 6000 queries.
- **Prior art**: No single published system combines all these stages. ColBERTv2 / PLAID do retrieval+rerank, not graph expansion. Sourcegraph does grep+symbol, not late interaction. LightOn ColGrep (Feb 2026) does grep+late interaction but not graph expansion and does not report GenCodeSearchNet numbers at this level. SFR-Embedding-Code (Salesforce) tops CoIR but is a single-vector encoder.
- **Benchmark**: 84.06% (vs 83.5% ship config, vs ~80% baseline before HNSW+MaxSim+LI fixes). Reproducible via `eval/scripts/gencodesearchnet-bench.js`.
- **Score**: **9/10**. System-level SOTA on a recognized benchmark is publishable at SIGIR/ECIR as a resource paper or full paper with ablations. The work is credible only if every stage's contribution is individually ablated — infrastructure exists via `BENCHMARKING.md` profile toggles.
- **Paper framing**: "A hierarchical retrieval system for code with measurable contribution per stage."

### S2. Metal SDPA F16 attention mask overflow → silent NaN, documented empirical fix for candle ModernBERT
- **Where**: `crates/sweet-search-native/src/inference/modernbert_sdpa.rs:316-372`, `nomic_bert_sdpa.rs:409-419`, commit `7aa15e8`.
- **What**: Apple's Metal SDPA kernel internally downcasts attention masks to F16 even with F32 activations. Upstream candle-transformers `modernbert.rs` uses `f32::MIN` as the padding mask value, which saturates to F16 `-Inf` → softmax produces NaN on every padded row. Silent, model-level correctness bug. Fix: clamp to `-1e4` (staying inside F16 range, matching HuggingFace's BF16-aware convention). MRR was collapsing 97% → 25% on LI with `--concurrency=12` before the fix was identified.
- **Prior art**: PyTorch SDPA has related issues (github.com/pytorch/pytorch#103749 for all-False masks). Candle has a known separate NaN-with-mask+GQA bug (#3388). Neither documents the `f32::MIN` → F16 saturation path for ModernBERT on Metal. Upstream candle-transformers `modernbert.rs` at time of fix still used `f32::MIN`.
- **Benchmark**: LI MRR before fix = 25% at concurrency=12. After fix = 97.97% (LI) / 83.96% (embed). Commit `7aa15e8` documents the before/after.
- **Score**: **8/10**. A genuine empirical bug in a widely-used framework (candle), with a minimal reproducible fix and concrete retrieval impact. Excellent systems-paper lesson: per-token cosine 0.9999 is insufficient as a correctness metric — only end-to-end MRR catches compounded errors. Easy upstream contribution; natural "war story" section of a systems paper.
- **Paper framing**: A section titled "When 0.9999 per-token cosine still breaks retrieval: the F16 mask overflow bug in Metal SDPA."

### S3. Three-stage vector pipeline (Binary HNSW → Int8 rescore → Float rescore) with shared score-spread adaptive pool sizing
- **Where**: `core/search/search-semantic.js:40-706`, `core/vector-store/binary-hnsw-index.js:64-174`, `core/vector-store/float-vector-store.js`
- **What**: Binary HNSW at ~100μs → int8 batched dot-product rescore at ~200–500μs → float32 rescore from a direct-access flat store at ~500μs → optional cross-encoder. Crucially, the same `analyzeScoreSpread` signal drives pool-size adjustment at every stage: topGap > 0.10 (clear winner) shrinks next-stage pool by 40%; spread < 0.08 (ambiguous) expands by 50%; the same signal gates whether to invoke the cross-encoder at all. All three storage tiers are co-resident in memory; the int8 sidecar is a `Map<id, Int8Array>` loaded at startup.
- **Prior art**: Elasticsearch BBQ uses binary HNSW + int8 rescore. Weaviate uses RQ with asymmetric distance. Vespa implements early-exit rerank gates. Nobody documents a **single shared score-spread signal** reused across three pool-sizing decisions and an early-exit gate. The combination is specific.
- **Benchmark**: Contributes to 84.06% MRR; breakdown in code comments (Stage 1 ~100μs, Stage 2 ~200–500μs, Stage 2.5 ~500μs). HNSW optimization alone gives +2.8pp R@100 / +5.9pp R@200 / -33% p50 on JS. No isolated adaptive-pool ablation yet.
- **Score**: **8/10**. Needs an A/B ablation: fixed pool vs adaptive vs adaptive+early-exit. Infrastructure exists. If the ablation shows 20%+ latency reduction at constant MRR, it's a clean systems contribution for ECIR/CIKM.
- **Paper framing**: "Adaptive cascade: reusing retrieval score-spread as a free sizing signal across tiers."

### S4. Per-codebase inverse-frequency bigram weight table with minimal-covering sparse n-gram extraction (full Rust implementation, tested at scale)
- **Where**: `crates/sweet-search-native/src/sparse_gram.rs:1703-1980` (`build_inverse_frequency_weights`, `extract_covering_grams`, `extract_sparse_grams`), plus `simd_intersect.rs`
- **What**: Per-corpus 128×128 bigram weight table computed in one byte-scan pass. Index-time gram extraction (`extract_sparse_grams`) emits windows where both boundary bigrams have higher weight than any interior bigram. Query-time extraction (`extract_covering_grams`) does recursive split at the highest-weight interior bigram to produce a minimal cover set. Thread-local scratch buffers (`CoveringScratch`) avoid per-query heap allocation. SIMD intersection (NEON/AVX2/SSE2), hybrid dense/sparse posting storage (adaptive density threshold `posting_count*4 ≥ dense_words*8`), regex-literal DNF extraction for prefilter correctness. Result: **10.2x median grep speedup over rg** with 353 wins / 0 losses / 0 ties across 5 repos.
- **Prior art**: GitHub Blackbird (Sourcegraph 2024 blog / Google internal), Cursor's sparse n-grams blog (2026) describe the algorithm family. Russ Cox 2012 covers trigram literal prefiltering. Zoekt uses fixed trigrams. What is ours: first open-source Rust implementation of the full variable-length covering sparse n-gram pipeline with SIMD intersection for code search, with published benchmarks and a reproducible eval harness.
- **Benchmark**: 353 queries, 5 repos: sweet-search 17.7x, fastify 11.5x, flask 9.1x, ripgrep-repo 9.7x, gin 8.5x; overall p50 10.2x. 353/353 wins.
- **Score**: **7/10**. The algorithm isn't new, but the implementation, benchmark harness, and head-to-head with ripgrep-in-a-CLI are publishable at a systems venue. Weakness: GitHub and Cursor have already told this story. Strength: reproducible numbers, open-source implementation, harder-to-fake benchmark.
- **Paper framing**: An open-source reproducible sparse n-gram code-search implementation; or an appendix in the broader system paper.

### S5. Hybrid architecture: sparse-gram indexed grep + semantic ColGrep + MaxSim late interaction reranking, in a single NAPI call
- **Where**: `core/search/search-pattern.js`, `crates/sweet-search-native/src/sparse_gram.rs:569-990` (`query_and_grep_lines`, `search_lines`), `core/ranking/late-interaction-index.js:1271` (`scoreWithLateInteraction`)
- **What**: One NAPI function accepts query + regex → runs gram lookup + rayon-parallel regex verification + returns `{matches, scannedFiles, gramElapsedUs, regexBuildElapsedUs, grepElapsedUs}`. The pattern-search JS path then parallelizes gram+grep with query encoding (`Promise.all`), maps grep `{file, line}` hits to AST chunk IDs via an interval map, runs MaxSim over chunks that have stored LI embeddings, optionally blends with grep density (log-scaled). The `mergeRegexIntoQuery` helper also injects regex tokens (stripped of metacharacters) into the semantic query string to improve embedding quality for pattern queries — a small novelty not in LightOn's ColGrep architecture.
- **Prior art**: LightOn ColGrep (Feb 2026) is the closest — same concept of grep+MaxSim parallelized. LightOn uses PLAID centroids for candidate generation; sweet-search uses the sparse-gram index. LightOn's head-to-head showed 25%+ token savings. Sweet-search independently replicates those results (fastify 30q: -25.4% tokens, quality parity). The `mergeRegexIntoQuery` injection of regex tokens into the semantic query is novel vs LightOn.
- **Benchmark**: `eval/results/pattern-benchmark_baseline.json` — pattern+MaxSim MRR 0.4521, hybrid-no-regex 0.3000, rg-only 0.1126 (60 queries). Agent-eval: token savings 25.4%, 100% read-elimination. Quality gap vs rg+read = 0.01 on 5-point scale (not 0.12 as the brief stated).
- **Score**: **7/10**. The architecture has been published concurrently by LightOn. Paper value = the sparse-gram backend (vs PLAID) + the regex-to-query token injection + the measured parity with ripgrep-plus-read on real agent workloads. Credible for ECIR short or SIGIR industry track.
- **Paper framing**: "Sparse n-gram backed semantic grep: an agent-friendly alternative to PLAID-based ColGrep, with measured token savings in agent workflows."

---

## TIER A — Strong contributions, chapter-level

### A1. CatBoost WASM 3-class query router with reject option and 50 multilingual code-aware features
- **Where**: `core/query/query-router.js:92-177`, `crates/wasm-router/src/catboost_v2.rs:14-62`, `crates/wasm-router/src/features_v2.rs:1-100`, `core/training/query-router/models/train_catboost.py`
- **What**: 499-tree CatBoost classifier (depth 4), compiled to 225KB WASM, runs at ~2.6μs (not 10μs as initially noted — `BENCH_TODO.md`) per query. 50 handcrafted features including CJK density, German compound detection, non-Latin PascalCase, camelCase/snake_case decomposition, structural-intent bitmask packing. 3-class output (lexical / semantic / hybrid) with reject-to-hybrid on low confidence. Used to set per-class fusion alpha in the CC fusion path.
- **Prior art**: Query classification is standard in IR. Three-class routing with reject option and multilingual code-aware features is more specific. Sub-10-μs WASM compilation of CatBoost classifiers for in-process routing is unusual as a systems choice. No published system I found does this exact combination.
- **Benchmark**: 87 queries previously misrouted to "structural" mode eliminated after 3-class upgrade. GenCSN p50 router time 2.6μs (`BENCHMARKS_EXPLAINED.md`). Not isolated in MRR ablation.
- **Score**: **6/10**. Solid engineering contribution; paper value is in the features (multilingual code query classification) and the deployment mode (WASM sub-ms in-process). Would benefit from an MRR ablation showing the router's lift over a rule-based classifier.

### A2. Intent-adaptive typed-edge 2-hop graph expansion for code, with degree-normalized scoring and PathRAG flow threshold
- **Where**: `core/graph/graph-expansion.js:1-839` (`expandSecondHopAdaptive`), `core/search/search-postprocess.js:139-187`, `core/query/intent-router.js:104-156`
- **What**: After retrieval, 1- or 2-hop traversal over an AST-derived code entity graph (entities: classes, functions, methods; edges: `imports`, `extends`, `implements`, `calls`, `uses`). Composite path score: `(hop1 × αedge × weight × priority) / sqrt(outDegree)` — degree normalization penalizes hub entities. `FLOW_THRESHOLD = 0.05` prunes low-signal paths (PathRAG style). Intent classifier picks edge-type subsets per query intent (bug_fix: calls+uses; api_lookup: imports+exports; refactor: extends+implements+calls). Results blended back with the int8 cosine to the query vector.
- **Prior art**: PathRAG (AAAI 2025, arXiv 2502.14902) introduced flow-based pruning for general graph RAG. GraphRAG (Microsoft) does graph RAG for summarization. None of the published code-search papers apply typed-edge intent-adaptive graph expansion with degree normalization and semantic blending. The specific combination for code is novel.
- **Benchmark**: A/B harness `eval/ab-adaptive-2hop.js` exists but stored results are not in `eval/results/`. Must be rerun.
- **Score**: **7/10**. The combination is specific and runnable. Run the A/B, get a number, the paper writes itself. Without the A/B it's **5/10**.

### A3. Cascaded MaxSim → multi-signal "decisive" gate → adaptive-K cross-encoder
- **Where**: `core/ranking/cascaded-scorer.js:1-379`, `core/search/search-postprocess.js:196-299`, `core/infrastructure/config/ranking.js:125-141`
- **What**: Scores candidates by MaxSim, then `isDecisive` evaluates four signals — margin gap, top-K stddev flatness, lexical confidence flag, LI token coverage — to decide whether the CE is needed. When non-decisive, `computeAdaptiveK` finds the largest inter-rank score gap as a natural cluster boundary and sends only that cluster to CE. Currently in **shadow mode** (`CASCADE_CONFIG.shadowMode = true`): the CE runs for data collection but its rankings are discarded. Honest comment in ranking.js: "CE rescue has no proven lift over MaxSim on GenCodeSearchNet."
- **Prior art**: PLAID (ColBERTv2) has a cascade. Vespa has early-exit rerank gates. The four-signal decisive gate (margin + flatness stddev + lexical confidence + LI coverage) is more detailed than typical threshold-only gates. Adaptive-K via natural cluster boundary is a specific mechanism. Neither is individually novel; the combination is.
- **Benchmark**: Shadow-mode data is being collected. No isolated A/B yet. With CE enabled under the gate, an MRR delta (±0.3pp) would determine whether the gate finds the right queries.
- **Score**: **6/10**. Strong systems contribution with a calibration story. Blocked on actually enabling CE under the gate and measuring. Current state: honest negative result ("CE doesn't help on GenCSN"), which is publishable if framed as "we tried cascaded reranking for code retrieval; here's why it doesn't lift."

### A4. CoreML variant cascade co-designed with upstream JS bucketer distribution, with lazy per-variant compilation, cosine parity guard, and stats telemetry
- **Where**: `core/infrastructure/coreml-cascade.js`, `core/infrastructure/coreml-cascade.json`, `crates/sweet-search-native/src/inference/coreml_embedding.rs:128-248`, `crates/sweet-search-native/src/inference/coreml_li.rs`, `crates/sweet-search-native/src/inference/li_model.rs:1-280`
- **What**: 12 pre-traced `.mlpackage` variants (6 NomicBERT embed + 6 ModernBERT LI) covering the batch×seq stair-step the upstream JS indexer bucketer actually produces. `pick(batch, seq)` selects the smallest variant that fits, compiles it lazily in `OnceLock`, dispatches to ANE. Variants outside the largest shape fall through to candle Metal silently. Startup runs a **parity check** (per-token cosine ≥ 0.998 vs candle) on a synthetic fixture; parity failure drops the backend entirely. Per-variant dispatch counters (`SWEET_SEARCH_COREML_STATS=1`). GPU path explicitly pinned to CPU_AND_NE (miscompilation: GPU cosine 0.40 vs CPU_AND_NE 0.9999 for ModernBERT sliding-window attention). Cascade JSON is the single source of truth read by both JS and Python tracing.
- **Prior art**: Apple `ml-ane-transformers` describes shape-specialized BERT for ANE. CoreML `EnumeratedShapes` flexes shapes. Neither does: (a) bucketer-informed shape selection by profiling upstream producer, (b) cross-language schema (JSON → JS + Python + Rust parsers), (c) runtime parity guard dropping the backend on divergence, (d) per-variant dispatch telemetry for dead-weight detection. The combination is a systems contribution.
- **Benchmark**: 18% faster full index on M3 Max (`34.0 → 27.9 min`, 16,347 docs, commit `4fd9c9a`). MRR delta +0.03pp (noise).
- **Score**: **7/10**. Real measurement, clean engineering, reproducible. Paper value is the methodology (profile the producer, derive shapes, maintain cross-language schema, guard with parity). An 18% speedup isn't landmark but the process is transferable. Good systems-venue material.

### A5. mlmodelc on-disk cache with SHA256 content-hash invalidation, atomic stage-and-rename, concurrent-process safe
- **Where**: `crates/sweet-search-native/src/inference/coreml_shim.m:163-421`
- **What**: `[MLModel compileModelAtURL:]` returns a temp compiled bundle. This shim computes `SHA256(Manifest.json)` of the source `.mlpackage`, writes it as a `.src-sha256` sidecar inside the compiled bundle, stages the bundle to `.stage-PID-TS/` on the same filesystem, then atomically renames into place (concurrent processes race-safe; loser cleans up). No official Apple API does this.
- **Prior art**: Bazel/Nix use content-hash atomic caches. No coremltools/Apple docs describe this pattern for `.mlmodelc`. The concurrent-safe + SHA256-sidecar + filesystem-aware temp is unusually careful.
- **Benchmark**: Per-variant cold compile 4,897ms → cached 43ms (b1×s2048 embed, 114x). For b64×s96: 22,604ms → 37ms (611x). Cascade cold total ~200s → warm ~few hundred ms.
- **Score**: **6/10**. Strong engineering contribution; concrete speedup data. Useful to the broader CoreML deployment community. Not research-novel but publishable as a systems-experience paper section.

### A6. Adaptive vocabulary prewarm via Leiden community detection on the code import graph
- **Where**: `core/vocabulary/vocab-warmup-orchestrator.js`, `core/vocabulary/vocab-warmer.js:63-260`, `core/search/warmup-metrics.js`
- **What**: Heavy tier (post-indexing) mines vocabulary from 5 sources including structural, symbol, code-graph, NL community, git history. Runs **Leiden community detection** on the import graph to derive "semantic modules." BM25+PageRank combined scores with 8 heuristic multipliers. Generates embeddings for hub entities using enriched text that matches the indexer's own document format (path + scope + symbol type + language) and warms HNSW traversal paths with those seeds. Persists SSWV binary artifacts for sub-3s session-start prewarm. **Dual-hash incremental gate**: graph hash gates community re-detection; NL content hash gates NL term mining; both must match to skip. Adaptive promotion: queries used 3+ times not in the warmup set are promoted on next heavy run; terms unused for 7 days are demoted. Working-set clustering via Jaccard over telemetry.
- **Prior art**: Leiden is a standard community-detection algorithm (2019 Traag et al.). Query-log replay warmup is standard. No published code-search system uses Leiden over import graphs to derive warmup vocabulary, nor uses dual-hash incremental gating, nor promotes/demotes from live telemetry. The combination is original.
- **Benchmark**: Lexical cache hit 84.2%, Semantic 79.1%, Hybrid 81.5% across 197 queries (`docs/VOCAB_PREWARM.md`). Light tier < 3s; heavy tier 8–30s. No isolated MRR impact measured.
- **Score**: **7/10**. Novel combination with working implementation and telemetry. Needs an A/B measuring cold-start query latency with vs without warmup. If prewarm drops cold p50 by 30%+, it's a clean ECIR/SIGIR Industry paper.

### A7. Pre-normalization L2 norm as free IDF proxy for weighted MaxSim (CRA-6)
- **Where**: `core/ranking/late-interaction-index.js:345-348`, `:417-421`, `:1102-1119`, `:1155-1159`
- **What**: Before L2-normalizing LI document token vectors, capture their pre-normalization norm as `preNorms[]`. The model normalizes away information that reflects per-token "activation strength." At query time (`useTokenWeights=true`), softmax over stored preNorms gives per-token weights; MaxSim becomes `Σ_q max_d(sim × w_d)`.
- **Prior art**: IDF-weighted MaxSim is published (Microsoft AAAI 2025 "Incorporating Token Importance in Multi-Vector Retrieval", arXiv 2511.16106; TRIAL EMNLP 2025; ColBERT-Att arXiv 2603.25248). All use learned weights, IDF from the collection, or attention weights. **No published system uses the pre-normalization L2 norm specifically** as a proxy — it is a "free" signal the encoder already computed and discarded. Novel twist on a well-studied concept.
- **Benchmark**: Not benchmarked. Gated behind `useTokenWeights=false`.
- **Score**: **6/10** if A/B'd with ≥+0.5pp MRR at zero cost, **3/10** if it's within noise. Very cheap to measure. The novelty angle ("the norm the encoder throws away is an IDF signal") is a publishable twist on Microsoft's AAAI 2025 paper if it demonstrably improves Recall@10 by >1pp.

### A8. Scope-chain embedding text enrichment via code-graph overlap query
- **Where**: `core/indexing/ast-chunker.js:605-686` (`enrichEmbeddingText`), `core/indexing/indexer-build.js:40-109` (`enrichChunksFromGraph`)
- **What**: Every chunk's `embedding_text` (the actual string fed to the encoder) is structured as: path, Scope (e.g. `ClassName > methodName`, sourced from a code-graph line-range overlap query), Defines (extracted symbols), Uses (top-5 imports), Language, then source. The scope chain comes from a `graph-db` query looking up any entity whose `[start_line, end_line]` contains the chunk's line range.
- **Prior art**: LangChain "parent document retrieval" uses separate parent-doc stores. GraphCodeBERT encodes structural info at the model level. Perplexity Contextualized Embeddings ("golden chunks") and Anthropic Contextual Retrieval prepend short LLM-generated summaries. **None** inject AST-derived scope chain + imports + symbol extractions as a structured pseudo-comment preamble via an overlap query into an index-time code-graph. Novel application.
- **Benchmark**: `enriched/total` count is logged but no A/B in `eval/results/`.
- **Score**: **7/10** if the A/B (enriched vs raw chunks on GenCodeSearchNet) shows ≥+1pp MRR. Infrastructure exists; a half-day run gets the number. **4/10** if no lift.

### A9. Variance-gated CC/RRF fusion with quantile normalization and per-route-type alpha table
- **Where**: `core/search/search-fusion.js:109-327`, `core/search/search-hybrid.js:26-100`
- **What**: Primary fusion = Convex Combination `score = α*norm_lex + (1-α)*norm_sem` with α table keyed by route type (`identifier: 0.85`, `conceptual: 0.25`, `structural: 0.90`, `mixed: 0.55`). Before CC runs, three-condition gate: (1) <3 results on either side, (2) <1e-6 variance, (3) outlier compression (top5%/max>0.95 AND median/max<0.3). Any condition → fall back to RRF k=60. CC uses **quantile normalization** (p05–p95 clipping) instead of min-max to clamp outliers before the linear blend.
- **Prior art**: CC fusion is standard (RRF is standard). Per-route-type alpha tables exist in various industrial stacks. The three-condition variance gate for RRF fallback and explicit outlier-compression detection for quantile normalization are cleaner than typical.
- **Benchmark**: Hybrid path contributes to 84.06% MRR. Deprecated code comments claim "+7-18% MRR" from CC over RRF — not in a stored A/B file.
- **Score**: **5/10**. Standard enough that reviewers will push back. Strong only as part of a wider paper; needs an isolated fusion A/B to stand alone.

### A10. Binary HNSW: custom pure-JS implementation with Algorithm 4 heuristic neighbor selection, shuffled insertion, and typed-array zero-alloc heaps
- **Where**: `core/vector-store/binary-hnsw-index.js:196-238` (Algorithm 4), `:244-307` (addToGraph), `core/vector-store/binary-heap.js:1-200`
- **What**: Custom JS HNSW over Hamming distance (not cosine/L2) with Algorithm 4 (Malkov & Yashunin 2016) diversity selection, shuffled insertion order (citing arXiv 2405.17813), M0=2*M on layer 0 (Lucene LUCENE-10527 style), and zero-allocation heaps stored as parallel Uint32Array. VisitedList is generation-stamped, reused across searches.
- **Prior art**: Algorithm 4 is from 2016. Shuffled insertion is from 2024. Typed-array heaps are standard JS optimization. USearch exists for off-the-shelf HNSW. What's unique: applying all three together to a Hamming-distance binary HNSW in pure JS, measuring +2.8pp R@100 / +5.9pp R@200 on GenCSN-JS, and -33% p50 latency. The measurement is the paper.
- **Benchmark**: JS Recall@100 80.6% → 83.4%, Recall@200 80.6% → 86.5%, p50 1403 → 942ms (`docs/HNSW_APPROACH.md`, `BENCH_TODO.md`).
- **Score**: **6/10**. Engineering + measurement paper. Needs to isolate each component (Alg4, shuffled insertion, typed heaps) for per-factor contribution.

### A11. Discovery-rate windowed early termination + greedy-descent quality gate for adaptive ef (binary HNSW)
- **Where**: `core/vector-store/binary-hnsw-index.js:411-485` (`search()`), `:518-582` (`searchLayerQuery()`)
- **What**: Two adaptive mechanisms layered: (1) after greedy descent to layer 0, compute quality = `1 - best_dist/max_dist`; if >0.85 shrink ef by 40%, if <0.55 expand by 50%. (2) During beam search, sliding window of last 16 visits tracks `rate = new_results / visits`; if progress >0.3 and rate <0.05, stop. The greedy-descent prior is novel; the discovery-rate approach is Elasticsearch 9.3's (cited in `HNSW_APPROACH.md:434-437`).
- **Prior art**: ES 9.3 does discovery-rate termination. ES/Lucene don't do greedy-descent quality gating for binary HNSW.
- **Score**: **5/10**. Needs an isolated latency ablation.

### A12. Agent-mode token-budget symbol-complete context packaging with calibrated confidence and sufficiency signals
- **Where**: `core/search/context-expander.js:38-41`, `mcp/server.js:124-147`, `mcp/tool-handlers.js:125-183`
- **What**: Top-k results are expanded to full function/class boundaries (three-tier fallback: code graph, sibling chunk merge, brace/indent scan), token-budgeted (4000 total default, 60/20/20 across top-3, max 2000/800/400 per result), tiered (`full`/`preview`/`summary`), emit header context (up to 200 tokens of minimal imports for rank-1 only), compute `confidence` (high/medium/low from score gap) and `sufficient` (boolean with reason codes), detect staleness (file mtime vs index mtime). Agent mode vs benchmark mode produce identical rankings — only presentation differs.
- **Prior art**: LightOn ColGrep (Feb 2026) demonstrated 25%+ token savings for code agents. Aider has repo-map. Cody/Copilot/Cursor have chunk retrieval. **No published system** documents explicit per-result token caps with confidence + sufficiency signals exposed to the agent, or head-to-head measurement of self-containment rate (fraction of agent answers not requiring follow-up reads).
- **Benchmark**: B1.5 intrinsic on 40 queries: rankingIdentity 1.0, symbolCompleteness 75%, avgReadsEliminated 3, packagingP95 1ms. B2 head-to-head (fastify 30q, blind Opus judge): quality 4.81 vs 4.80 (rg+read), -25.4% tokens, 0.0 vs 4.9 reads/query. `eval/agent-eval/results/fastify-judgments.jsonl`.
- **Score**: **6/10**. Backed by real data but single-repo single-model single-judge evaluation. Needs multi-repo/multi-model expansion. At full eval scale this is **8/10**. Paper claim: "self-contained code search eliminates follow-up reads while preserving answer quality — measured on 4 repos × 3 models."

### A13. Tri-tier MaxSim kernel stack (Native Rust+Rayon / WASM SIMD / JS flat-buffer) + WebGPU WGSL 4-bit nibble shader
- **Where**: `core/infrastructure/simd-distance.js`, `crates/wasm-maxsim/src/lib.rs`, `crates/sweet-search-native/src/lib.rs:280-397`, `core/infrastructure/webgpu-maxsim.js`
- **What**: Runtime dispatch across 4 MaxSim implementations. Native path does rayon parallelism + NEON/AVX2 SIMD + 16-entry stack LUT for int4 nibble unpacking (64 bytes = 1 L1 cache line). WASM SIMD uses i8x16 widening with `f32x4_*` intrinsics, fused dequant in-kernel. WebGPU WGSL compute shader (workgroup_size=64) does nibble-unpack + per-token LUT + fused dot+max for browser deployment.
- **Prior art**: EMVB, PLAID, CITADEL have CPU/GPU kernels but typically not ColBERT-for-WASM. 16-entry LUT is standard nibble-dequant pattern (llama.cpp). **WebGPU WGSL for ColBERT-style MaxSim from packed int4 is not described in any published system** I could find. Novel deployment angle.
- **Benchmark**: Native 47x over naive JS; WASM SIMD 16x; end-to-end p50 942ms → 502ms (-47%) on GenCSN, MRR unchanged at 83.64%.
- **Score**: **6/10**. Engineering with measurement. WebGPU browser tier is a paper differentiator if anyone cares about browser-side ColBERT.

### A14. 35+ language code chunker registry with tree-sitter + three-strategy regex fallback
- **Where**: `core/infrastructure/language-patterns/*.js`, `core/indexing/ast-chunker.js:108-260` (`parseBraceBasedFile`, `parseIndentBasedFile`, `parseEndKeywordFile`), `:359-453` (`_stripNonCode`)
- **What**: Tree-sitter WASM tier for 12 languages (JS/TS/Py/Go/Rust/Java/C/C++/Ruby/PHP/Kotlin/Swift) plus three-strategy regex fallback for 23+ more: brace-based (with correct string/comment/template-literal awareness, interpolation depth tracking), indent-based, end-keyword. Multi-line signature joining. Unified registry with same chunker patterns + graph extraction patterns + language metadata.
- **Prior art**: LangChain LanguageParser covers ~15 languages. Tree-sitter is standard. **The combination** (tree-sitter primary + three-strategy regex fallback + unified registry) covering 35+ is a practical engineering contribution enabling reproducible benchmarks on diverse codebases.
- **Score**: **5/10**. Engineering breadth contribution. Strong appendix material for a main paper.

### A15. SSLX v3 binary segment format with self-describing quantization pipeline metadata and CRC32 integrity
- **Where**: `core/ranking/late-interaction-index.js:574-755`
- **What**: Custom binary format for LI index. 64-byte header includes magic `0x53534C58`, version, quantBits, tokenDim, numDocs, poolFactor, modelId, whtSeed, whtOrdering, matryoshkaDim — enough to reconstruct the exact quantization pipeline at load time with no external config. Document table, ID table, token slab (packed nibbles or int8), per-token min/scale arrays, optional pre-norms, CRC32 footer. Replaces prior JSON encoding which was 3.4x larger.
- **Prior art**: FAISS, Qdrant, Weaviate have custom binary formats. **None** co-locate per-token quantization metadata + rotation parameters + pre-normalization norms + matryoshka config in one CRC32-protected slab for a ColBERT-style multi-vector index.
- **Benchmark**: 1.343 GiB JSON → ~396 MiB SSLX (3.4x).
- **Score**: **5/10**. Engineering contribution; useful open format for reproducible ColBERT deployments.

### A16. Negative result: asymmetric binary HNSW (WHT + centroid + RaBitQ-style) adds no quality at 512d for code retrieval
- **Where**: `core/infrastructure/quantization.js:39-326` (WHT, WUSH calibration, sequency WHT, fast Givens), `core/vector-store/binary-hnsw-index.js:589-616` (calibrateAsymmetric, encode)
- **What**: Full implementation of the RaBitQ-inspired pipeline — center → rotate (WHT / sequency-WHT / WUSH-whitened / Weaviate-style Givens) → binarize; with asymmetric int4-query × 1-bit-doc distance. A/B'd vs plain sign-bit. **No recall improvement** at 512d M=32. Ship config: `useAsymmetric: false`.
- **Prior art**: Elasticsearch BBQ, Weaviate 1-bit RQ claim recall gains with this pipeline — typically at higher dimensions. The sweet-search empirical finding that code-specific 512d embeddings don't benefit is a potential **negative result publication** for a venue like ECIR Reproducibility.
- **Benchmark**: BENCHMARKING.md experiment matrix: MRR@10 83.4–83.5% across symmetric and asymmetric modes.
- **Score**: **6/10**. Negative results with rigorous setup are publishable if framed as "when does asymmetric binary quantization help? An empirical study on code retrieval." Strong reproducibility signal.

### A17. Contention-aware native model prewarm during indexing (Promise.all parallel rebuild)
- **Where**: `core/indexing/indexer-phases.js:363-389`, `:428-433`, `core/indexing/indexer-utils.js` (`atomicSwapDatabase`)
- **What**: Before launching three-way parallel indexing (embedding + LI + HCGS summaries via `Promise.all`), pre-warm the native models via `getNativeEmbeddingModel()` + `getNativeLiModel()`. The motivation: SHA256-hashing a 596MB safetensors file while ORT CPU embedding is running causes **over-2-minute stalls** from Node microtask scheduler contention. Pre-warming avoids it.
- **Prior art**: Not in published literature. Discovered empirically.
- **Score**: **4/10**. A specific, measured systems finding. Good appendix/war-story material for a systems paper, weak standalone.

---

## TIER B — Solid engineering with some novelty

### B1. Fused 4-bit nibble MaxSim with per-token stack-resident 16-entry LUT (CRA-13)
- `crates/sweet-search-native/src/lib.rs:336-400`. Kernel pattern from llama.cpp / WARP / dejan.ai. Useful measurement; not novel. **Score: 3/10.**

### B2. Semantic proxy cache: lightweight MiniLM embeddings as key for expensive Voyage/Mistral embeddings
- `core/embedding/embedding-cache.js:22-334`, `core/embedding/embedding-service.js:200-278`. 4-layer cache (LRU → Vocabulary → SemanticCache → Deduplicator → API). Using cheap model as proxy key for expensive model cache is unusual in production systems. **Score: 5/10** with a cache-hit-rate + cost-per-query measurement; 3/10 without.

### B3. In-memory Int8 sidecar map co-resident with binary HNSW
- `core/vector-store/binary-hnsw-index.js:64-174`. Explicit O(1) int8 lookup Map, loaded once, dispatches to batched `int8BatchDotScores`. Removes SQLite from the hot path. Well-motivated but standard. **Score: 4/10.**

### B4. Direct-access FloatVectorStore (FVEC) flat-file with zero-copy `subarray()` batch dot
- `core/vector-store/float-vector-store.js:1-235`. Custom header + contiguous f32. Standard pattern in FAISS-family. **Score: 3/10.**

### B5. Unified gram+grep single NAPI call (`search_lines`, `search_full`)
- `crates/sweet-search-native/src/sparse_gram.rs:775-990`. Eliminates round-trips across NAPI boundary for Node-embedded search engines. **Score: 3/10.** Engineering pattern.

### B6. Grep density blending into MaxSim (log-scaled per chunk)
- `core/search/search-pattern.js:307-311`. Inert by default (`GREP_DENSITY_ALPHA=0`). Novel idea in the hybrid grep+semantic context but untested. **Score: 3/10.**

### B7. Regex literal DNF extraction for variable-length n-gram prefiltering
- `crates/sweet-search-native/src/regex_literals.rs`, `core/search/search-pattern-prefilter.js:148-171`. Russ Cox 2012 technique extended to variable-length grams with union-of-intersections DNF. **Score: 3/10.**

### B8. Merkle + config-fingerprint mtime/size fast-path with phase-progress crash recovery
- `core/indexing/incremental-tracker.js`, `core/indexing/indexer-phases.js`. Config-fingerprint driven full-reindex gate (dimension/provider mismatch → force rebuild) + `phase-progress.json` crash-resume. Standard techniques, rare in code search. **Score: 4/10.**

### B9. Tree-sitter incremental re-parse using `getChangedRanges()` for chunk-level invalidation
- `core/indexing/incremental-parser.js:1-390`. Selective chunk invalidation by byte-range overlap. Unusual in published code retrieval systems. **Score: 5/10** with a reindex latency benchmark showing 10x+ speedup vs full reparse; 3/10 without.

### B10. Parent-child AST chunk ID linking with bidirectional metadata (cAST extension)
- `core/infrastructure/tree-sitter-provider.js:429-546`, `core/indexing/ast-chunker.js:481-646`. Extension of published cAST with ID-level parent-child linking. **Score: 4/10.**

### B11. Code-specific extended skiplist for late-interaction document tokens (tab/newline/semicolon/comma)
- `core/infrastructure/config/ranking.js:199-204`, `core/ranking/late-interaction-model.js:725-758`. Extends ColBERT's standard punctuation skiplist with code-noise tokens for the document path (encoding asymmetry — query path doesn't use it). **Score: 5/10** with ablation; 3/10 without.

### B12. Identifier normalization with dual-form FTS alias (split tokens + collapsed form) using `name_alias`
- `core/graph/graph-extractor.js:40-64, 136-156, 2175`. CamelCase/snake_case/PascalCase decomposition stored in FTS5 alias column with porter stemming, alongside trigram FTS. **Score: 4/10.**

### B13. Markdown/RST chunker with header hierarchy, atomic code-block preservation, content-type tagging
- `core/indexing/chunking/markdown-chunker.js:1-503`, `plaintext-chunker.js:73-100`. Goes beyond LangChain `MarkdownHeaderTextSplitter`. **Score: 4/10.**

### B14. Dual-hash incremental gating (graph hash + NL content hash) for vocabulary warmup
- `core/vocabulary/vocab-warmup-orchestrator.js:94-113`. Paired with A6. **Score: 4/10** on its own.

### B15. Agent-eval blind-judging protocol with frozen question sets and claude-cli adapter
- `eval/agent-eval/*`, `eval/scripts/agent-intrinsic-bench.js`. Blind Opus-judged multi-system eval with 30 frozen questions per repo. Rigorous, but limited scale. **Score: 4/10** as methodology; 6/10 if expanded to 4 repos × 3 models.

### B16. LI correctness fix (Array.prototype.flat not flattening Float32Array) — +1.23pp MRR
- `docs/CE_RESCUE_PLAN.md`, commit `ce-rescue-shadow-fixed-li.json`. Empirical bug finding with measured before/after. Negative lesson: subtle framework behavior breaks correctness silently. **Score: 4/10.**

### B17. Process-wide Metal mutex + CoreML ANE bypass pattern
- `crates/sweet-search-native/src/inference/mod.rs:39-53`. `metal_lock()` serializes candle Metal submissions (process-wide), but the CoreML path has its own per-variant mutex so ANE and Metal run concurrently on distinct hardware. **Score: 5/10** — good systems pattern.

### B18. ORT graph optimization materialization cache (version-keyed)
- `core/infrastructure/onnx-session-utils.js`. Persists optimized graph via `optimizedModelFilePath` keyed by ORT version + model hash. Standard ORT feature, used thoroughly. **Score: 2/10.**

### B19. Two-phase session warmup coordinator (pre-ready / post-ready) with Undici connection prewarming
- `core/search/session-warmup.js`. Health-check-first idempotent design; server accepts connections before `ready`. Good engineering. **Score: 3/10.**

### B20. PID-reuse-safe background indexer daemon with O_EXCL lock + `/proc/stat` field 22 stale detection
- `core/indexing/index-maintainer.mjs`. 7s deferred startup, 45s merkle checks, dead-letter queue, ENOSPC handling. Careful engineering. **Score: 3/10.**

---

## TIER C — Engineering; performance numbers, not paper material

| # | Item | File | Score |
|---|------|------|-------|
| C1 | Rust CLI launcher via Unix socket, 2.9ms warm dispatch | `crates/sweet-search-cli/src/main.rs`, `core/cli.js` | 2/10 |
| C2 | Napi AsyncTask Float32Array zero-copy (2.16x over nested vec) | `crates/sweet-search-native/src/inference/embedding_model.rs:430-612` | 2/10 |
| C3 | BF16-default dtype with documented F16 MRR collapse boundary | `crates/sweet-search-native/src/inference/mod.rs:70-112` | 2/10 |
| C4 | Hardware capability gate with forward-compatible generation floor (M3+) | `core/infrastructure/hardware-capability.js` | 2/10 |
| C5 | Cache-aware dual-constraint LI batch sizing (LLC + attention O(seq²×B)) | `core/indexing/indexer-ann.js:126-200` | 3/10 |
| C6 | HCGS-style code graph summary generation | `core/graph/hcgs-generator.js` | 3/10 |
| C7 | Resumable chunked model download with SHA256 verify + atomic rename | `core/infrastructure/model-fetcher.js` | 2/10 |
| C8 | MMR diversity reranking | `core/ranking/` (applyMMR) | 2/10 |
| C9 | WASM Hamming distance popcount (NEON/SSE) | `core/infrastructure/simd-distance.js` | 2/10 |
| C10 | Rust native tokenizer napi with Uint32Array→BigInt64 overlay trick | `crates/sweet-search-native/src/tokenizer.rs`, `core/infrastructure/native-tokenizer.js:136-160` | 2/10 |
| C11 | Uninstall idempotency + cascade cache cleanup | `scripts/uninstall.js` | 1/10 |
| C12 | SWEET_SEARCH_COREML_STATS per-variant dispatch counter telemetry | `core/infrastructure/coreml-cascade.js` | 2/10 |
| C13 | PreToolUse MCP hint hook + displacement language in tool descriptions | `mcp/server.js:124-147` | 1/10 |
| C14 | Cross-target smoke validation (4 targets × 3 package managers) | `scripts/cross-target-results.json` | 1/10 |
| C15 | 3-tier fallback (native → WASM → JS) architectural pattern, applied to MaxSim + router + CLI | systemwide | 2/10 |

---

## TIER D — Implementation of published prior art. Cite, don't claim.

These are valuable engineering but have **published prior art** that the paper must cite. Claiming novelty here will get the paper desk-rejected.

| # | Item | Prior art | Our delta |
|---|------|-----------|-----------|
| D1 | cAST recursive split-then-merge AST chunking | Zhang et al. 2025 (CMU+Augment), arXiv 2506.15655, ACL Findings EMNLP 2025 | Direct reimplementation; parent-child ID linking is a small extension (→ B10) |
| D2 | Voronoi-guided token pruning CRA-9 | arXiv 2603.09933 (Sorbonne) — "A Voronoi Cell Formulation for Principled Token Pruning in LI Retrieval" | Reimplementation; not default, not benchmarked |
| D3 | IDF-weighted MaxSim core concept (CRA-6 scoring side) | arXiv 2511.16106 (Microsoft AAAI 2025) "Incorporating Token Importance in Multi-Vector Retrieval" | Pre-normalization norm variant is our twist (→ A7) |
| D4 | Hierarchical agglomerative token pooling CRA-1 | LIR'26 Workshop, arXiv 2603.22434 | Reimplementation with 64-token cap; rejected in A/B |
| D5 | PathRAG flow-based pruning threshold | arXiv 2502.14902 (AAAI 2025), github.com/BUPT-GAMMA/PathRAG | Applied to code structural graph with typed edges (→ A2) |
| D6 | WHT pre-rotation before scalar quantization | TurboQuant (arXiv 2504.19874, ICLR 2026 Google), QuIP#, Weaviate 8-bit RQ | Applied to LI tokens at d=128, untested in production |
| D7 | WUSH calibrated rotation (Jacobi eigendecomposition + S^-1/2) | Weaviate blog; arXiv 2512.00956 | Inline JS implementation, untested |
| D8 | Sequency-ordered WHT | GSR paper, arXiv 2505.03810 | Variant, untested |
| D9 | Sparse n-gram algorithm base (weighted bigram boundaries) | GitHub Blackbird (2022), Cursor blog (2026), ClickHouse | Rust implementation (→ S4) |
| D10 | Russ Cox trigram literal extraction for regex prefiltering | Cox 2012 code search blog series | DNF extension for variable grams (→ B7) |
| D11 | RaBitQ asymmetric binary distance | Elasticsearch BBQ (arXiv 2405.12497), Weaviate RQ blog | Tested, ship-disabled (→ A16) |
| D12 | ColBERTv2 residual compression + late interaction architecture | Santhanam et al. 2022, aclanthology.org/2022.naacl-main.272 | Foundation for LI path |
| D13 | HNSW Algorithm 4 (heuristic neighbor selection) | Malkov & Yashunin 2016 | Applied to binary Hamming (→ A10) |
| D14 | HNSW shuffled insertion | arXiv 2405.17813 | Applied (→ A10) |
| D15 | Discovery-rate HNSW early termination | Elasticsearch 9.3 release notes | Combined with greedy-descent gate (→ A11) |
| D16 | Matryoshka embeddings (optional matryoshkaDim) | Kusupati et al. 2022 | Optional, untested for code |
| D17 | Reciprocal Rank Fusion (RRF, k=60) | Cormack et al. 2009 | Fallback path only |
| D18 | FlashRank / TinyBERT cross-encoder | standard re-rankers | Used in cascade |
| D19 | MiniLM as semantic proxy cache key | standard lightweight model usage | Cache structure is ours (→ B2) |
| D20 | tree-sitter incremental parsing (`getChangedRanges`) | tree-sitter project | Applied to chunk invalidation (→ B9) |
| D21 | LightOn ColGrep architecture (grep + ColBERT late interaction, parallelized) | LightOn blog + open source, Feb 2026 | Independent concurrent work; sparse-gram backend vs LightOn's PLAID (→ S5) |

---

## TIER E — Tracked but excluded from paper scope

### E1. Everything in `docs/PROBABILISTIC_PLAN.md`
All 19 fixes (Block-Max MaxSim, SimHash chunk dedup, KLL adaptive thresholds, HLL distinct counters, etc.) — **planned, not implemented**. The doc itself is worth citing as a research agenda, but none of these can be claimed as contributions. The `hashContent()` in `chunk-builder.js:36` computes only a SHA256 for exact dedup, not SimHash.

### E2. DSPy multi-model prompt optimization (`docs/DSPY_PLAN.md`)
Architecture and floor-weighted metric formulation exist. **No implementation.** Not a contribution until run.

### E3. `sweet-search read` / `read-semantic` / `files` CLI tools
Designed in `READ_TOOLS_AND_TOOLUSE_ENFORCEMENT_PLAN.md`. **Not implemented.**

### E4. Dirty overlay for sparse gram index
Planned in `INDEXED_GREP.md` phase 2. **Not implemented** — `overlayMatches` is always `[]`. The incremental rebuild is a full reindex via `index-maintainer` daemon, not an overlay.

### E5. "Probabilistic MaxSim" as advertised
Does not exist. The title of `PROBABILISTIC_PLAN.md` is misleading — it refers to probabilistic data structures in surrounding pipeline components, not a probabilistic MaxSim algorithm.

---

## Top-10 most paper-worthy items (ranked)

For a reviewer / grant committee / "what's the paper?" conversation:

1. **S1** — Integrated 84.06% MRR code retrieval system (the paper umbrella)
2. **S2** — Metal SDPA F16 mask overflow NaN fix for candle ModernBERT (the upstream bug report)
3. **S3** — Three-stage adaptive pool cascade (with single score-spread signal)
4. **S4** — Per-codebase covering sparse n-gram implementation with 10.2x median vs rg
5. **A6** — Leiden community detection vocabulary prewarm with dual-hash gating
6. **A2** — Intent-adaptive typed-edge graph expansion for code with degree normalization
7. **A4** — CoreML cascade co-designed with JS bucketer distribution, parity-guarded
8. **A12** — Agent-mode context packaging with sufficiency signals + 25% token savings
9. **A7** — Pre-normalization norm as free IDF proxy for weighted MaxSim (the quickest-to-validate item)
10. **S5** — Sparse-gram + ColGrep + MaxSim parallel hybrid (framed as systems alternative to LightOn's PLAID-backed ColGrep)

---

## Recommended paper structure (if writing ONE paper)

**Title candidate**: *"Sweet-Search: A Hierarchical Code Retrieval System with SOTA on GenCodeSearchNet"*

**Venue target**: ECIR 2027 / SIGIR Industry Track / EMNLP Findings / Code Intelligence Workshop.

**Outline**:

1. **Introduction** — 84.06% MRR on GenCodeSearchNet headline + architectural motivation (agent-facing local code retrieval, zero cloud)
2. **Pipeline** — query router (A1) → binary HNSW (A10, A11) → three-stage adaptive cascade (S3) → LI MaxSim (S2 bug story + D12 base) → intent-adaptive graph expansion (A2) → cascade gate (A3) → agent-mode context packaging (A12)
3. **Hybrid grep** — sparse n-gram backend (S4) + semantic ColGrep (S5) with token savings evaluation
4. **Inference infrastructure** — CoreML variant cascade (A4) + mlmodelc cache (A5) + Metal SDPA bug fix (S2)
5. **Warmup + session** — Leiden-based vocabulary prewarm (A6)
6. **Per-stage ablations** (the critical section): each stage's contribution to the 84.06% headline, plus negative results (A16 asymmetric binary adds no quality)
7. **Agent eval** — B2 head-to-head with ripgrep+read, multi-repo if time permits (A12)
8. **Related work** — cite cAST, Voronoi pruning, PathRAG, PLAID, LightOn ColGrep, Cursor sparse n-grams, ColBERTv2, TurboQuant, Weaviate RQ, GitHub Blackbird

**What to cut**: DSPy plan, probabilistic plan, read-tools plan, and any item scoring < 4 except as supporting engineering details.

**What to ablate** (mandatory for peer review):
- HNSW opt (old vs new)
- Three-stage adaptive pool sizing (fixed vs adaptive vs adaptive+exit)
- Intent-adaptive graph expansion (no-graph vs 1-hop vs 2-hop-adaptive)
- Agent-mode packaging (raw vs agent mode)
- Scope-chain embedding enrichment (enriched vs raw)
- Pre-norm IDF weighting (uniform MaxSim vs weighted)

---

## Honest warnings for Codex

- **The 84.06% headline will not survive a skeptical reviewer without per-stage ablations.** Each stage must contribute measurably.
- **Every D-tier item is a citation trap.** Claiming novelty for cAST, Voronoi pruning, weighted MaxSim, or PathRAG will get you desk-rejected. Cite the paper, describe the reimplementation, move on.
- **LightOn ColGrep shipped the same core grep+LI architecture in Feb 2026.** The paper framing must acknowledge concurrent work and position sweet-search as either (a) faster with sparse-gram backend vs PLAID, or (b) measured on a different benchmark, or (c) integrated with graph expansion that LightOn lacks.
- **The "25%→97.97% restoration" narrative is technically real but requires careful unpacking** — it's Python-only, 500q subset, and conflates two separate bugs (flat bug + Metal concurrency).
- **No F16 mask fix has been upstreamed to candle yet.** Upstream the fix first; then the paper has higher weight ("we fixed a bug in candle's ModernBERT implementation that silently produces NaN on Metal for padded inputs; see PR #xxxx").
- **The agent eval (30q, 1 repo, 1 model, 1 judge) is insufficient scale.** Expand to 4 repos × 3 models × human judges before any claim that "quality is preserved."
- **Per-token LI 4-bit scoring is not a novelty anchor** — WARP and dejan.ai have blog-posted this kernel pattern. It's a systems detail, not a paper claim.
- **The 10.2x grep speedup sounds impressive but the algorithm is credited to GitHub Blackbird / Cursor.** The contribution is the open-source Rust implementation + reproducible harness + head-to-head with rg.
- **Items rated ≥ 7 all currently lack an isolated A/B.** The week of benchmark-running that separates "we built this" from "we measured this" is the highest-value work left.

---

*End of PAPER_RANKING.md. Codex — critique ruthlessly.*
