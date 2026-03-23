# ColGrep Integration Plan: Hybrid Pattern+Semantic Search

**Status**: Planning
**Priority**: HIGH (pattern mode), LOW (PLAID), MEDIUM (MCP tool)
**Prerequisites**: Late interaction index (done), LateOn-Code model (done)
**References**: TODO Section 28, LATE_INTERACTION.md

---

## 1. Goal

Add a 5th search mode (`pattern`) that combines regex pattern matching with late
interaction semantic ranking. This fills a real gap: no current mode handles "find
all code matching regex X, ranked by relevance to concept Y."

```
ss -e "class.*Service" "authentication"
ss --mode=pattern --regex="fn.*sort" "sorting algorithm"
```

The core insight: regex gives perfect recall for structural patterns but zero ranking.
Late interaction (MaxSim) gives fine-grained semantic ranking but needs candidates.
Combine them: regex for candidate generation, MaxSim for ranking.

---

## 2. Architecture

### 2.1 Pipeline (Parallel Query Encoding)

```
User Query: regex="class.*Service"  semantic="authentication"
    │                                      │
    │  [PARALLEL]                          │
    ▼                                      ▼
┌──────────────────┐            ┌─────────────────────────┐
│ Stage A: Regex   │            │ Stage B: Query Encode   │
│ ripgrep scan     │            │ LateOn-Code encodeQuery │
│ ~5-20ms          │            │ ~20-50ms                │
└────────┬─────────┘            └────────────┬────────────┘
         │                                   │
         │  matched chunk IDs                │  query token vectors
         ▼                                   ▼
┌────────────────────────────────────────────────────────┐
│ Stage C: MaxSim Rerank                                 │
│                                                        │
│ 1. Map regex matches → indexed chunk IDs               │
│ 2. Load pre-indexed document token embeddings          │
│ 3. MaxSim score: Σ max(sim(q_token, d_token))         │
│ 4. Sort by MaxSim score                                │
│ ~0.01-5ms (depends on candidate count)                 │
└────────────────────────────────────────────────────────┘
         │
         ▼
┌───────────────────────┐
│ Stage D: Post-process │
│ Token budget, format  │
└───────────────────────┘
```

**Key design decision**: Encode the query in parallel with the regex scan. LateOn-Code
`encodeQuery()` takes ~20-50ms. Ripgrep takes ~5-20ms. Running them concurrently means
query tokens are ready by the time grep returns. Total latency = `max(grep, encode) +
maxsim` instead of `grep + encode + maxsim`, saving ~20-50ms per search.

### 2.2 No New Retrieval Index, but Needs a Chunk-Location Map

We already have the retrieval primitives:
- `LateInteractionIndex` with pre-indexed document token embeddings (int8 quantized)
- `encodeQuery()` in `late-interaction-model.js`
- `maxSimScore()` in `late-interaction-index.js`

**What's missing**: a way to map regex hits (file:line) to indexed chunk IDs. The LI
index metadata (`indexer-ann.js:136`) stores only `{ file, name, type }` — no line
spans. Line spans (`startLine`, `endLine`) exist in `codebase.db` vector metadata
(`indexer-build.js:265`) but not in the LI store.

**Options**:
1. **Enrich LI metadata** with `startLine`/`endLine` at index time (clean, small change
   to `indexer-ann.js` — store what `indexer-build.js` already computes)
2. **Build a load-time interval map** from `codebase.db` at startup (no index change,
   but adds a startup query + memory)
3. **Query codebase.db on-demand** per pattern search (simplest, but adds SQLite I/O
   to the hot path)

**Recommendation**: Option 1. Enrich LI metadata during indexing. It's a one-line
change to `indexer-ann.js` and avoids SQLite on the hot path. Search still needs a
lightweight lookup structure (for example `file -> sorted [startLine, endLine, chunkId]`
intervals), but that can be built directly from LI metadata at load time. Requires a
re-index for existing codebases.

### 2.3 Regex Engine Options

| Option | Pros | Cons |
|--------|------|------|
| **ripgrep (child_process)** | Fast, battle-tested, regex support | External binary, spawn overhead |
| **FTS5 trigram** | Already indexed, no binary dep | Limited regex, slow for complex patterns |
| **node:child_process + grep** | Universal | Slower than ripgrep |

**Recommendation**: ripgrep as primary (it's fast and nearly universal on dev machines),
FTS5 trigram as fallback. Detect ripgrep at startup with `which rg`.

### 2.4 Chunk Mapping Strategy

Ripgrep returns file:line matches. We need to map these to indexed chunk IDs.

```
ripgrep output: src/auth.js:47:class AuthService extends BaseService {
                                   │
                                   ▼
chunk-ID lookup: find chunk whose file_path = "src/auth.js"
                 AND start_line <= 47 <= end_line
                                   │
                                   ▼
late interaction: load token embeddings for that chunk ID
```

Implementation: build a sorted interval map from chunk metadata at index load time.
Binary search per match → O(log n) per ripgrep hit.

---

## 3. Execution Phases (Benchmark-First)

### Phase 0a: Benchmark Contract Freeze (Before Implementation)

Freeze the benchmark contract before writing feature code. This is the most important
workstream because ColGrep's value is primarily a ranking/agent-efficiency claim, not
just an implementation claim.

**Deliverables**:
- A fixed benchmark manifest with:
  - repos
  - regex families
  - semantic intents
  - grading instructions
- A baseline matrix covering:
  - `rg` only
  - `rg + FTS/BM25`
  - `--mode=hybrid` without regex
  - `regex + MaxSim`
  - `regex + MaxSim + graph expansion` (optional ablation)
- Initial evaluation slices:
  - language
  - repo size
  - naming quality
  - regex type (`class`, `function`, `import`, `test`, `config`, etc.)
- Statistical protocol:
  - bootstrap confidence intervals
  - paired significance tests where applicable
  - manual audit sample for judge disagreements
- Logging schema so MVP runs capture the evidence needed to refine the benchmark

**Exit criterion**: We can run the same benchmark contract repeatedly and compare runs
without changing repos, task families, baselines, or top-level metrics midstream.

### Phase 1: Harness Extensions

Extend the existing eval stack so pattern-mode evaluation is first-class instead of
being inferred from generic retrieval benchmarks.

**Deliverables**:
- Pattern benchmark format: `(regex, semantic_query, relevant_chunk_ids, metadata)`
- Runner support for pattern queries alongside existing retrieval harness flows
- Reporting for:
  - MRR
  - Recall@5 / Recall@10
  - latency
  - token usage (agent eval)
  - win rate vs baseline
- Per-slice reporting and failure breakdowns

**Exit criterion**: The harness can run Track A, Track B1, and Track C automatically.

### Phase 2: Core Pattern Search (MVP)

**Files to modify:**

| File | Change |
|------|--------|
| `core/sweet-search.js` | Add `patternSearch()` method, wire into `search()` router |
| `core/search-cli.js` | Add `--mode=pattern`, `-e <regex>` flag |
| `core/config.js` | Add `pattern` to valid search modes |
| `core/search-server.js` | Add `?mode=pattern&regex=<regex>&q=<query>` |

**New file:**

| File | Purpose |
|------|---------|
| `core/search-pattern.js` | Regex scan, chunk mapping, parallel encode+grep, MaxSim rerank |

**Implementation:**

```javascript
// core/search-pattern.js (pseudocode)

export async function patternSearch(regex, semanticQuery, options) {
  const { lateInteractionIndex, searchDir } = options;

  // Parallel: regex scan + query encode
  const [grepMatches, queryTokens] = await Promise.all([
    runRipgrep(regex, searchDir),
    encodeQuery(semanticQuery),
  ]);

  // Map file:line matches to indexed chunk IDs
  const chunkIds = mapMatchesToChunks(grepMatches, chunkMetadata);

  // Filter to chunks that have token embeddings
  const available = lateInteractionIndex.hasTokens(chunkIds);

  // MaxSim rerank
  const candidates = [...available].map(id => ({ id }));
  const scored = await lateInteractionIndex.scoreWithLateInteraction(
    queryTokens, candidates
  );

  return scored;
}
```

### Phase 2.5: Benchmark Semantics Freeze (After MVP, Before Agent Eval)

Use the MVP to refine the parts of the benchmark that are hard to specify correctly
without observing real system behavior.

**Deliverables**:
- Freeze gold relevant chunk IDs for the primary pattern benchmark set
- Freeze slice definitions if MVP results show better cuts than the initial guess
- Freeze failure taxonomy based on real observed errors:
  - regex matched correct family but wrong chunk rank
  - chunk-location mapping failure
  - MaxSim reranking failure
  - grep already sufficient due to descriptive names
  - graph expansion helped/hurt
- Freeze the agent-eval judge rubric and disagreement audit procedure

**Constraint**: After Phase 2.5, no benchmark edits except for clearly documented bug
fixes in labels or harness logic.

**Exit criterion**: Gold labels, failure taxonomy, and agent-eval rubric are locked
before Track B2 becomes release-relevant.

### Phase 3: Fallback for Unindexed Matches

When regex matches code not in the late interaction index (new/unstaged files):

1. **Eager**: Encode matched chunks on-the-fly with `encodeDocuments()`. Slow (~50ms
   per chunk) but accurate.
2. **Lazy**: Return unindexed matches at the bottom with score=0 and a flag
   `indexed: false` so the caller knows.
3. **Hybrid**: Eager for top-N unindexed matches (by regex match count), lazy for rest.

**Recommendation**: Start with lazy (Phase 1), add eager in Phase 2 if users hit the
gap frequently.

### Phase 4: MCP Tool + ss-fast.c

- Add `regex` parameter to the MCP search tool schema
- Add `-e, --regex <pattern>` to `ss-fast.c` C CLI
- Update MCP tool description to explain the hybrid query model

### Phase 5: Quality Scoring + Graph Expansion (Optional)

If pattern search results need enrichment:
- Run graph expansion on top MaxSim results (find callers/callees)
- Apply quality scoring (PageRank-based entity importance)
- Blend with existing post-processing pipeline in `search-postprocess.js`

---

## 4. Benchmarking Strategy

### 4.1 How LightOn Benchmarked ColGrep

LightOn used an **agent-in-the-loop evaluation**:

- **Agent**: Claude Opus 4.5 via Claude Code
- **Judge**: Claude Opus 4.5 (same model, separate evaluation pass)
- **Repos**: 5 HuggingFace repos (Datasets, Accelerate, Optimum, Transformers, TRL)
- **Questions**: 135 code retrieval questions at 3 difficulty levels:
  - Easy: well-known entry points ("where is class X defined?")
  - Medium: module boundary understanding
  - Hard: functionality described without naming the implementation
- **Metrics**: Win rate, token savings, search operation count, turn count
- **Baseline**: Claude Opus 4.5 with vanilla grep/glob only
- **Treatment**: Claude Opus 4.5 with grep/glob + ColGrep

**Results**: 70% win rate, 15.7% avg token reduction, 56% fewer search ops.
Grep won when function names were highly descriptive (TRL repo).

**Key insight**: No standard benchmark exists for hybrid regex+semantic code search.
LightOn's approach (agent-in-the-loop with LLM judge) is the current best practice.

### 4.2 Our Benchmarking Plan

Two separate tracks: **regression** (did we break existing retrieval?) and **feature
validation** (does pattern mode actually help?).

This section defines the benchmark program, but the execution order is benchmark-first:
contract and harness work happen before implementation, benchmark semantics freeze after
the MVP, and a final ship/no-ship gate happens after ablations and agent evaluation.

#### Track A: Retrieval Regression (Existing Harness)

Use our existing eval infrastructure (`eval/retrieval-harness.js`, `docs/BENCHMARKING.md`)
with standard code search benchmarks as regression checks. These are NOT primary evidence
that ColGrep works — they verify we didn't break anything. MTEB Code v1 remains an
external reference point for model quality, not a dataset run by our local harness.

| Benchmark | What It Tests | Metric | How We Use It |
|-----------|--------------|--------|---------------|
| **COIR** (ACL 2025) | 10 datasets, 8 tasks, 7 domains | NDCG@10 / MRR | Local regression harness |
| **CodeSearchNet** | 6 languages, text→code | MRR | Local regression harness |
| **GenCodeSearchNet** | Cleaner 6-language text→code benchmark | MRR | Local regression harness |
| **MTEB Code v1** | 13 datasets, model comparison | Avg score | External reference only |

#### Track B: Pattern-Mode Feature Validation (New)

A dedicated pattern benchmark with `(regex, semantic_query, relevant_chunk_ids)` tuples.
This is the primary gate for "does ColGrep work?"

**B1: Synthetic pattern benchmark** (automated, fast)
- Curate 50-100 examples from our own indexed repos:
  - `regex="class.*Service"`, `semantic="authentication"`, `expected=["auth-service.js:AuthService"]`
  - `regex="async fn.*sort"`, `semantic="sorting algorithm"`, `expected=["sort-utils.rs:merge_sort"]`
- Metric: MRR and Recall@5 of MaxSim-ranked results vs expected chunk IDs
- Weak proxy: Extract identifiers from COIR "code-to-code" queries as regex patterns,
  use the query's intent as the semantic string

**B1 quality bar**:
- At least 100 benchmark cases before any launch decision
- Hand-curated gold chunk IDs for the primary set, frozen in Phase 2.5
- Synthetic or weak-proxy cases must be tagged separately and reported separately
- Every case should record language, repo, regex family, and naming quality

**B2: Agent-in-the-loop** (our repos, slow)
Replicate LightOn's methodology:

1. **Generate questions**: Use Claude to generate 50-100 questions per repo at
   easy/medium/hard levels
2. **Run baseline**: Sweet Search with `--mode=hybrid` (no regex)
3. **Run treatment**: Sweet Search with `--mode=pattern` (regex + semantic)
4. **Judge**: Claude evaluates which response better answers the question
5. **Metrics**: Win rate, result quality (precision@k), token count

**Target repos** (diverse sizes and naming conventions):
- A small, well-named repo (grep should do well — tests our weakness)
- A large monorepo with abbreviated names (our strength)
- A multi-language repo (tests cross-language regex patterns)

**B2 quality bar**:
- Freeze the question set before running baselines
- Use the Phase 2.5 frozen judge rubric
- Run blind pairwise judging where the judge does not see which system produced which result
- Manually review a sample of wins, losses, and judge disagreements
- Record not just win rate, but why the winner won

#### Track C: Latency Profiling (Before Setting Targets)

Profile per-component latency **before** setting hard targets. The current MaxSim
scorer (`late-interaction-index.js:156-174`) dequantizes int8→float32 and materializes
token arrays per document per call. That allocation overhead may dominate over raw dot
product cost. Profile first, then set targets.

| Component | How | Notes |
|-----------|-----|-------|
| Ripgrep scan | `process.hrtime.bigint()` around spawn | Likely ~5-20ms |
| Query encode (LateOn-Code) | Timer around `encodeQuery()` | Likely ~20-50ms |
| Chunk mapping | Timer around interval map lookup | Should be <1ms |
| MaxSim rerank (20 candidates) | Timer around `scoreWithLateInteraction()` | **Profile first** — dequant overhead unknown |
| MaxSim rerank (100 candidates) | Same, larger candidate set | **Profile first** |
| **Total pipeline** | End-to-end timer | **Profile first** |

**Aspirational targets** (to be validated by profiling):
- Total pipeline: <100ms (faster than hybrid's ~200ms)
- MaxSim for 20 candidates: <5ms (if dequant overhead is high, consider
  keeping float32 in-memory for hot documents or adding a WASM MaxSim kernel)

Compare against:
- Pure grep: <20ms (but no ranking)
- Pure semantic (`--mode=semantic`): <150ms (but no pattern matching)

#### Final Gate: Ship / No-Ship Benchmark Pack

This is the final phase, after implementation and ablations:

1. Run Track A regression suite on the standard local harness datasets
2. Run Track B1 primary pattern benchmark
3. Run Track B2 LightOn-style agent evaluation
4. Run Track C latency profiling on warm and cold paths
5. Review failure taxonomy and manual audit sample
6. Decide:
   - ship
   - ship behind flag
   - do not ship yet

No default-on launch should happen without this final benchmark pack.

---

## 5. SOTA Methods to Consider

### 5.1 WASM MaxSim Acceleration (NumKong / maxsim-cpu)

**What**: SIMD-accelerated MaxSim scoring kernels.

- **maxsim-cpu** (mixedbread.ai): 2-3x speedup on ARM Macs via Apple Accelerate,
  5x on Linux x86 via libxsmm. Python/Rust.
- **NumKong** (Ash Vardanian): ~2000 SIMD kernels including `maxsim_packed_f32` and
  `maxsim_packed_bf16` with a **WebAssembly Relaxed SIMD** target.

**Relevance**: We already have `simd-distance.wasm` for Hamming and int8 dot product.
Adding a WASM MaxSim kernel would accelerate Stage C of the pattern pipeline. At
20 candidates this doesn't matter (microseconds either way), but at 100+ candidates
with 100+ tokens each it starts to add up.

**Action**: LOW priority. Evaluate NumKong's WASM MaxSim kernel when candidate counts
exceed 100 regularly. Our JS MaxSim is fast enough for typical pattern search.

### 5.2 SPLATE: Sparse Late Interaction for Candidate Generation

**What**: Learns a sparse vocabulary-space mapping from ColBERT token embeddings,
enabling candidate generation via standard inverted indexes (like FTS5).

- Paper: arXiv 2404.13950 (SIGIR 2024)
- Candidate generation under 10ms
- Re-ranking 50 candidates matches full PLAID effectiveness

**Relevance**: SPLATE could let us use our existing FTS5 index for late-interaction-
aware candidate generation — without building a separate PLAID index. This is the
middle ground between "brute force MaxSim on regex matches" and "full PLAID infra."

**Action**: MEDIUM priority. Investigate after pattern mode is proven. Would require
training a SPLATE adapter on our LateOn-Code embeddings — non-trivial but the payoff
is getting PLAID-quality candidate generation through existing infrastructure.

### 5.3 XTR: Contextual Token Retrieval (Token Pruning)

**What**: Trains the model to predict which document tokens are "important" and only
stores/scores those. 2-3 orders of magnitude cheaper MaxSim scoring.

- Paper: arXiv 2304.01982 (NeurIPS 2023)
- +2.8 nDCG@10 on BEIR over prior SOTA

**Relevance**: Storage reduction. Our int8 late interaction index is ~69 MB for 11K
chunks. XTR-style pruning could reduce this by 10-50x by only keeping the tokens that
matter. Combined with our existing token pooling (Phase 7.1 in late-interaction-model.js),
this could make the late interaction index negligible in size.

**Action**: LOW priority. Our current index size is fine. Revisit at monorepo scale.

### 5.4 WARP: 3x Faster Than PLAID

**What**: Implicit decompression + two-stage reduction for multi-vector retrieval.
3x faster than PLAID, 41x faster than XTR reference.

- Paper: arXiv 2501.17788 (SIGIR 2025)
- 171ms single-threaded on LoTTE Pooled

**Relevance**: If we ever need PLAID-scale infrastructure (100K+ chunks), WARP is the
engine to use instead. But the same caveat from TODO 28.4 applies: we don't need
PLAID-scale infrastructure until we have monorepo-scale storage.

**Action**: LOW priority. File for future reference. When PLAID becomes necessary,
evaluate WARP as the engine instead of vanilla PLAID/NextPLAID.

### 5.5 cAST: AST-Aware Chunking (Already Implemented)

**What**: Recursively chunks code via tree-sitter AST parsing. +5.5pp on code
generation benchmarks, +4.3 Recall@5 on retrieval.

- Paper: arXiv 2506.15655 (EMNLP 2025 Findings)
- Code: github.com/yilinjz/astchunk

**Status**: Already implemented in our codebase.
- `tree-sitter-provider.js:411` — `parseFileToChunks()` explicitly implements the
  "cAST recursive algorithm" with greedy sibling merge + recursive oversized split
- `tree-sitter-provider.js:455` — `recursiveChunk()` does the split-merge loop
- `ast-chunker.js:472` — regex fallback "approximates cAST recursive split"
- `ast-chunker.js:635` — hierarchical parent/child chunk linking (cAST-style)

**Action**: LOW priority. Validate parity with the cAST paper's approach and measure
impact vs a naive line-based chunker on our retrieval benchmarks. Our implementation
is already doing the right thing — this is a verification task, not an adoption task.

### 5.6 SEISMIC: Sub-ms Sparse Retrieval

**What**: Inverted index with geometrically-cohesive blocks and summary vectors.
Sub-millisecond sparse retrieval at high recall.

- Paper: arXiv 2404.18812 (SIGIR 2024 Best Paper Runner-up)
- 3.4x faster than HNSW at 95% accuracy on SPLADE embeddings

**Relevance**: If we add SPLADE-style learned sparse retrieval (TODO Section 3),
SEISMIC would be the index to use. Could replace or complement our FTS5 BM25.

**Action**: LOW priority. Depends on SPLADE integration (not yet started).

### 5.7 Multi-Vector Compression (Attention-Guided Clustering)

**What**: Compress document token embeddings to a fixed number of vectors (e.g., 5)
using attention-guided clustering. New SOTA on MSR-VTT with 5 vectors per doc.

- Paper: arXiv 2602.21202 (2026)

**Relevance**: Our late interaction index stores ~50-100 tokens per document. Compressing
to 5-10 tokens would reduce storage by 10-20x and make MaxSim scoring proportionally
faster. This is complementary to our existing token pooling (poolFactor=2) but more
aggressive and learned rather than heuristic.

**Action**: MEDIUM priority. Evaluate after pattern mode ships. Would require training
a compression layer on our token embeddings — or adopting the paper's attention-guided
clustering as a post-processing step during indexing.

---

## 6. PLAID Index (Deferred)

Per TODO 28.4, PLAID is deferred. Updated reasoning:

1. **Scale mismatch**: Our MaxSim runs on 20-100 regex-matched candidates. PLAID was
   designed for millions of documents. Centroid routing overhead > brute-force at our
   scale.

2. **Storage tier blocker**: A monorepo large enough to need PLAID (100K+ chunks) can't
   be indexed locally anyway. The int8 index alone would be 600+ MB, float vectors
   would be gigabytes. PLAID becomes relevant when we solve the broader cloud/remote
   index problem, not before.

3. **WARP supersedes PLAID**: If we do need a multi-vector engine, WARP (SIGIR 2025)
   is 3x faster with smaller indexes. NextPLAID would be an interim step at best.

**Trigger to revisit**: A user reports >50K chunks AND we have a remote index tier.

---

## 7. ColGrep as MCP Tool (Deferred)

Per TODO 28.5, evaluate after pattern mode proves value.

**Trade-offs**:
- Pro: Zero implementation (shell out to `colgrep` binary)
- Pro: ColGrep handles incremental indexing, tree-sitter parsing, PLAID natively
- Con: Double indexing cost (ColGrep + Sweet Search both index the repo)
- Con: Lose graph expansion, quality scoring, translation fallback, token budget
- Con: External binary dependency

**Shared index opportunity**: If both tools read PLAID format, users don't pay double
indexing. But this requires our PLAID implementation (deferred) to be format-compatible
with ColGrep's NextPLAID storage.

**Trigger to revisit**: Pattern mode ships, users request ColGrep specifically, or
we find the pattern mode insufficient for complex queries.

---

## 8. Blend Weight Tuning (SONA)

The current late interaction blend weight (α=0.3) was never tuned for real MaxSim
scores. For pattern search, we need a different blending strategy since there's no
base semantic score to blend with — MaxSim IS the score.

**Pattern mode scoring**: Pure MaxSim rank (no blending needed).

**Hybrid mode with late interaction** (existing pipeline): Tune α via SONA adaptive
learning per TODO 28.6. Prerequisites:
- Phase 5 benchmarks (not yet done)
- Score normalization (done)

---

## 9. Priority Order

| # | Task | Effort | Impact | Depends On |
|---|------|--------|--------|------------|
| 1 | Benchmark contract freeze (Phase 0a) | 0.5-1 day | CRITICAL | Nothing |
| 2 | Harness extension for pattern eval (Phase 1) | 1-2 days | CRITICAL | Benchmark contract freeze |
| 3 | Pattern mode MVP (Phase 2) | 2-3 days | HIGH | Chunk-location map (2.2), harness contract |
| 4 | Benchmark semantics freeze (Phase 2.5) | 0.5-1 day | CRITICAL | Pattern mode MVP |
| 5 | Latency profiling (Track C) | 0.5 day | HIGH | Pattern mode MVP |
| 6 | Synthetic pattern benchmark (Track B1) | 1-2 days | HIGH | Benchmark semantics freeze |
| 7 | Agent-in-the-loop eval (Track B2) | 2-3 days | HIGH | Benchmark semantics freeze, frozen question set |
| 8 | Retrieval regression check (Track A) | 1 day | HIGH | Pattern mode MVP |
| 9 | Final ship/no-ship benchmark pack | 0.5 day | CRITICAL | Items 5-8 |
| 10 | MCP tool + ss-fast.c (Phase 4) | 1-2 days | MEDIUM | Ship decision = positive |
| 11 | Unindexed match fallback (Phase 3) | 1 day | LOW | Pattern mode MVP |
| 12 | cAST parity validation (5.5) | 0.5 day | LOW | Nothing |
| 13 | WASM MaxSim kernel (5.1) | 2-3 days | LOW | Latency profiling evidence |
| 14 | SPLATE adapter (5.2) | 1-2 weeks | LOW | Ship decision + PLAID decision |
| 15 | Multi-vector compression (5.7) | 1 week | LOW | Scale evidence |

**Critical path**: Items 1-9. Benchmark contract comes first, implementation follows,
benchmark semantics are frozen after the MVP, and the final benchmark pack is the
release gate.

---

## 10. Success Criteria

| Metric | Target | Rationale |
|--------|--------|-----------|
| Pattern search latency (P50) | **TBD after profiling** | Aspirational: <100ms. Must beat hybrid (<200ms) |
| Win rate vs grep (agent eval) | >60% | Match LightOn's 70% directionally |
| Token savings (agent eval) | >10% | Match LightOn's 15.7% directionally |
| Pattern benchmark MRR (Track B1) | >0.7 | Primary feature validation gate |
| Recall on regex matches | 100% | Every regex match must be returned (ranking changes, not filtering) |
| MaxSim rerank for 100 candidates | **TBD after profiling** | Current scorer has dequant overhead — profile first |

**Release gate**:
- Track A shows no meaningful regression on standard retrieval benchmarks
- Track B1 clears the primary pattern benchmark thresholds
- Track B2 shows clear win-rate and token-usage benefit over grep-only workflows
- Track C confirms latency is acceptable for interactive use
- Manual audit does not reveal systemic judge bias or hidden failure modes

---

## Appendix A: Reference Implementations

| Implementation | Language | URL | Notes |
|----------------|----------|-----|-------|
| ColGrep | Rust | github.com/lightonai/next-plaid/tree/main/colgrep | Reference for hybrid regex+semantic |
| NextPLAID | Rust | github.com/lightonai/next-plaid | PLAID engine, SIMD MaxSim |
| PyLate | Python | github.com/lightonai/pylate | ColBERT training library |
| maxsim-cpu | Rust/Python | github.com/mixedbread-ai/maxsim-cpu | SIMD MaxSim kernels |
| NumKong | C/Rust/WASM | github.com/ashvardanian/NumKong | WASM Relaxed SIMD MaxSim |
| SEISMIC | Rust | github.com/TusKANNy/seismic | Sparse retrieval index |
| cAST/ASTChunk | Python | github.com/yilinjz/astchunk | AST-aware chunking |

## Appendix B: Relevant Papers

| Paper | Venue | arXiv | Relevance |
|-------|-------|-------|-----------|
| PLAID: Efficient Engine for Late Interaction | CIKM 2022 | 2205.09707 | Original PLAID design |
| WARP: Efficient Multi-Vector Retrieval | SIGIR 2025 | 2501.17788 | 3x faster than PLAID |
| SPLATE: Sparse Late Interaction | SIGIR 2024 | 2404.13950 | Sparse space MaxSim |
| XTR: Rethinking Token Retrieval | NeurIPS 2023 | 2304.01982 | Token pruning |
| SEISMIC: Efficient Inverted Indexes | SIGIR 2024 | 2404.18812 | Sparse retrieval |
| cAST: AST Structural Chunking | EMNLP 2025 | 2506.15655 | AST-aware chunks |
| COIR: Code Information Retrieval | ACL 2025 | 2407.02883 | Benchmark |
| CoRNStack: Contrastive Training from Stack | ICLR 2025 | 2412.01007 | Training data |
| SPLARE: Sparse Autoencoders for Retrieval | 2026 | 2603.13277 | Next-gen sparse |
| Multi-Vector Index Compression | 2026 | 2602.21202 | Token compression |
| Jina-ColBERT-v2 | 2024 | 2408.16672 | 8K context ColBERT |
| LIR Workshop (Late Interaction) | ECIR 2026 | 2511.00444 | Community signal |
