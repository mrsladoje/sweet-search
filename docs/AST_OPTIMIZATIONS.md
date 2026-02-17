# AST Optimizations (Feb 2026 SOTA)

## Scope
This document captures cutting-edge AST chunking and retrieval optimizations beyond
`docs/AST_CHUNKING.md`. Merges findings from Codex analysis and independent web
research across 2025-2026 papers, production systems, and community tools.

Date snapshot: **2026-02-14**

---

## Competitive Landscape

Tree-sitter has become the dominant parser for code intelligence tools. Notable
systems and their approaches (source quality noted):

| Tool | Parser | Key Innovation | Source | Evidence Grade |
|------|--------|----------------|--------|----------------|
| **Aider** | tree-sitter + PageRank | Symbol importance ranking, token-budget repo maps | [aider.chat (official)](https://aider.chat/2023/10/22/repomap.html) | Primary |
| **cAST (CMU)** | tree-sitter recursive | +4.3 Recall@5 on RepoEval, +2.7 Pass@1 on SWE-bench | [EMNLP 2025 (peer-reviewed)](https://aclanthology.org/2025.findings-emnlp.430.pdf) | Primary |
| **Cline** | tree-sitter + ripgrep | 3-tier: regex, fuzzy match, AST definitions | [Cline GitHub repo](https://github.com/cline/cline); described in [survey preprint](https://www.preprints.org/manuscript/202510.0924) | Repo: primary; survey: secondary |
| **supermemory/code-chunk** | tree-sitter + scope chain | Contextualized text for embeddings | [GitHub repo](https://github.com/supermemoryai/code-chunk); [author blog](https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/) | Repo: primary; eval claims: self-reported |
| **SEISMIC** | Sparse inverted index with block summaries | Sub-ms latency on MS MARCO (3.4-12x faster than HNSW) | [SIGIR 2024 (peer-reviewed)](https://dl.acm.org/doi/10.1145/3626772.3657769); [GitHub](https://github.com/TusKANNy/seismic) | Primary (NL-IR domain; not validated on code) |

**Sweet Search today:** Regex-based chunker (37 languages) + graph extraction +
FTS5 + HNSW. **Strengths:** zero native deps, entity/relationship graphs (unique
among chunkers), integrated hybrid search. **Grade: B+ chunking, A- pipeline.**

---

## Bottom Line

The current architecture is strong, but it is not Feb 2026 SOTA yet.

The highest-value missing pieces are:
1. **Tree-sitter parsing tier** for top languages (cross-line, recursive, accurate).
2. **Scope chain / contextualized embedding text** (Anthropic showed 49-67% retrieval failure reduction).
3. **Recursive split-merge for oversized constructs** (cAST algorithm).
4. **Incremental AST re-chunking** (`changed_ranges`) to avoid full-file reparse/reindex.
5. **Repository-graph-aware chunk expansion/reranking** for multi-hop code questions.
6. **SEISMIC sparse vector search** (sub-ms on NL-IR benchmarks; code search applicability TBD).
7. **Intent-aware retrieval routing** (query-type-specific policies).

These are the main gaps compared to the latest evidence from 2025-2026 papers and
production systems.

---

## What Is Missing

### 1) Tree-Sitter Parsing Tier (Accuracy Foundation)

**What:** Add tree-sitter as the primary parser for top languages, with the
current regex engine as universal fallback.

**Why this matters:**
- Eliminates 5 of the 8 known limitations in `AST_CHUNKING.md`:
  - Cross-line matching (#7): multi-line signatures, split decorators handled natively.
  - Line trimming (#1, #2): AST structure is whitespace-independent.
  - TypeScript blind spot (#8): tree-sitter-typescript has full grammar.
  - Obj-C depth miscounting (#6): proper nesting from the parse tree.
- Regex patterns require manual maintenance per language; tree-sitter grammars
  are maintained by language communities (200+ contributors for typescript alone).
- Most prominent code intelligence tools use it (Aider, Cline, supermemory, cAST).
  Notable exceptions: Sourcegraph (zoekt), GitHub (custom stack).

**Benchmark evidence:**
- cAST (CMU, EMNLP 2025): structure-aware chunks improved Recall@5 by +4.3 points
  on RepoEval and Pass@1 by +2.7 on SWE-bench across all retrievers tested.
- StarCoder2-7B saw average +5.5 point gain on RepoEval with AST chunking.
- supermemory SWE-bench eval (self-reported, not peer-reviewed): semantic search
  with tree-sitter chunks reduced agent tool calls from 19 to 12 and cost from
  $0.25 to $0.20 per task.

**Deployment strategy (WASM):**
- Use `web-tree-sitter` (WASM build) to avoid C native bindings.
- WASM binaries add ~200KB per language grammar, loaded lazily.
- No `node-gyp`, no platform-specific builds, instant `npm install`.
- Fallback: if WASM load fails or grammar unavailable, use regex engine.

**Two-tier architecture:**

| Tier | Parser | Languages | When |
|------|--------|-----------|------|
| **Tier 1** | tree-sitter (WASM) | JS/TS, Python, Go, Rust, Java, C/C++, Ruby, PHP, Kotlin, Swift | Grammar available |
| **Tier 2** | Current regex engine | All 37 languages (fallback) | Grammar unavailable or parse failure |

**Action in this codebase:**
- Add `core/tree-sitter-provider.js` with lazy WASM grammar loading.
- Implement `TreeSitterBoundaryProvider` interface matching current `_matchBoundary()` contract.
- Wire into `ASTChunker.parseFile()` dispatch: try tree-sitter first, fall back to regex.
- Keep `language-patterns/` registry intact as fallback tier.

**Sources:**
- web-tree-sitter WASM: https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web
- tree-sitter grammar repos: https://github.com/tree-sitter (200+ language grammars)
- cAST paper: https://aclanthology.org/2025.findings-emnlp.430.pdf
- supermemory code-chunk: https://github.com/supermemoryai/code-chunk

---

### 2) Scope Chain and Contextualized Embedding Text

**What:** Build a hierarchical scope tree from the parse and prepend compact
context to each chunk's embedding text.

**Why this matters:**
- Anthropic's Contextual Retrieval paper: prepending chunk-specific context
  reduced top-20 retrieval failure rate by **49%** (5.7% to 2.9%). With reranking:
  **67%** reduction (5.7% to 1.9%).
- supermemory's `code-chunk` generates `contextualizedText` per chunk:
  ```
  # src/services/user.ts
  # Scope: UserService
  # Defines: async getUser(id: string): Promise<User>
  # Uses: Database
  # After: constructor
  ```
  This prepends file path, scope chain, entity signatures, imports, and sibling
  context to the raw code before embedding.
- Current Sweet Search chunks are bare text + metadata. The embedding model never
  sees "this function lives inside class X and uses import Y."

**Scope tree construction:**
- With tree-sitter: traverse AST, track `class_declaration > method_definition`
  nesting as scope chain.
- Without tree-sitter: use existing graph extractor's `activeEntityScopes` stack
  to approximate scope (already partially implemented).

**Action in this codebase:**
- Add `embedding_text` field separate from raw `content` in chunk output.
- Template: `Path | Module | Enclosing Symbol | Defines | Calls | Imports | code`.
- Keep raw `content` unchanged for exact-match display and FTS indexing.
- Wire `embedding_text` into the vector embedding pipeline.

**Sources:**
- Anthropic contextual retrieval: https://www.anthropic.com/news/contextual-retrieval
- supermemory code-chunk enrichment: https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/

---

### 3) Hierarchical Recursive Chunking with Merge (cAST Algorithm)

**What:** Recursive split-then-merge on AST nodes, preserving semantic boundaries
while fitting a configurable token budget.

**Why this matters:**
- A 400-line function currently either becomes one massive chunk or gets cut at
  an arbitrary point. cAST recursively descends into child nodes (statements,
  blocks) when a construct exceeds the size limit.
- Adjacent sibling nodes below the limit are merged to reduce fragment count.
- Emitting parent/child chunk links enables retrieval-time context expansion.

**Algorithm (from cAST paper):**
1. Parse file into AST tree.
2. Starting from root, greedily merge top-level AST nodes into chunks.
3. If adding a node would exceed `max_chunk_size`, recursively break it into
   child nodes and repeat.
4. Never split mid-expression or mid-statement.
5. Output: list of chunks where each chunk contains a list of AST nodes.

**Benchmark evidence:**
- cAST over line-based: +1.2-3.3 Precision, +1.8-4.3 Recall on code-to-code
  retrieval (RepoEval).
- Cross-language consistency: up to +4.3 points on CrossCodeEval.
- Works with any retriever (BGE, GIST, CodeSage all improved).

**Action in this codebase:**
- Implement `recursiveChunk(node, maxSize)` in tree-sitter provider.
- For regex fallback: approximate by tracking brace/indent depth levels and
  splitting at sub-boundary points when chunk exceeds threshold.
- Emit `parent_chunk_id` metadata for hierarchical chunk linking.

**Sources:**
- cAST EMNLP 2025: https://aclanthology.org/2025.findings-emnlp.430.pdf
- cAST arXiv (full algorithm pseudocode): https://arxiv.org/html/2506.15655v1

---

### 4) Query-Based Symbol Extraction (tags.scm)

**What:** Use tree-sitter `tags.scm` / query files for definitions and references
instead of only regex capture-group boundaries.

**Why this matters:**
- Tree-sitter queries use s-expression syntax to match structural patterns:
  ```scheme
  (function_declaration name: (identifier) @function.name)
  (class_declaration name: (identifier) @class.name)
  ```
- Eliminates per-language regex maintenance. Grammars ship with `tags.scm` files
  that define standard symbol extraction queries.
- Directly addresses TypeScript constructs: `interface_declaration`,
  `type_alias_declaration`, `enum_declaration`, `decorator`.

**Action in this codebase:**
- Load `tags.scm` from grammar packages for entity extraction in `graph-extractor.js`.
- Map tree-sitter tag captures to existing entity types (`function`, `class`, `method`).
- Keep regex `graph.entities` patterns as fallback for languages without queries.

**Sources:**
- tree-sitter code navigation/tags: https://tree-sitter.github.io/tree-sitter/4-code-navigation.html
- tree-sitter query syntax: https://tree-sitter.github.io/tree-sitter/using-parsers/6-pattern-matching.html

---

### 5) Aider-Style PageRank Repo Map

**What:** Build a dependency graph of all source files, rank symbols by
importance using PageRank, and generate a token-budget-optimized repository map.

**Why this matters:**
- Aider introduced this pattern and it has influenced several other tools. The
  repo map gives LLMs a compressed view of the entire codebase structure.
- Sweet Search already has the entity/relationship graph from `graph-extractor.js`.
  This is the raw material for PageRank ranking - most tools don't have this.
- Generates a compact map that fits within a configurable token budget (Aider
  defaults to 1k tokens) showing the most important classes, functions, and their
  signatures.

**How Aider does it:**
1. tree-sitter parses code, extracts function signatures and class definitions.
2. Builds a NetworkX graph where files are nodes, edges connect files with
   dependencies (imports, calls, inheritance).
3. Runs PageRank with personalization factors for context weighting.
4. Binary search to fit the most important symbols within the token budget.
5. Caches results with modification-time tracking.

**Action in this codebase:**
- Add `core/repo-map.js` that queries the existing relationship graph in SQLite.
- Run PageRank (or simplified eigenvector centrality) on the file/entity graph.
- Generate condensed repo map output fitting a token budget.
- Expose as MCP tool for Claude Code integration: `sweet-search:repo-map`.

**Sources:**
- Aider repo map architecture: https://aider.chat/2023/10/22/repomap.html
- Aider repo map docs: https://aider.chat/docs/repomap.html

---

### 6) Incremental Parsing + Selective Reindex

**What:** Use tree-sitter incremental parsing with `oldTree` and `changed_ranges`
to only re-chunk/re-embed changed regions.

**Why this matters:**
- Full-file re-chunking is the biggest avoidable indexing cost in active dev loops.
- CocoIndex reports that with 1% daily code churn, only 1% of files hit the
  embedding model per update cycle.
- For a Claude Code hook that reindexes on save, this is the difference between
  100ms and 5s per keystroke burst.

**Action in this codebase:**
- Add parser layer in `ast-chunker.js` with per-file AST cache (Map<path, Tree>).
- On file change: re-parse with `parser.parse(newSource, oldTree)`.
- Call `oldTree.getChangedRanges(newTree)` to identify affected byte ranges.
- Invalidate only chunks whose `[line_start, line_end]` overlaps changed ranges.
- Recompute graph edges only for affected symbols in `core/graph-extractor.js`.
- Re-embed only invalidated chunks.

**Sources:**
- tree-sitter incremental parse: https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html
- CocoIndex incremental pipeline: https://pub.towardsai.net/building-real-time-semantic-code-search-with-tree-sitter-and-vector-embeddings-b9b1fc0a94f3

---

### 7) Repo-Graph-Aware Chunk Expansion

**What:** At retrieval time, expand top-k chunks using repository structure
(imports/calls/ownership) with bounded hops.

**Why this matters:**
- Many coding tasks are multi-hop; isolated chunk relevance is insufficient.
- Sweet Search already has the graph data to do this - entities and relationships
  are in SQLite. This is a unique advantage over tools that only have chunks.

**Action in this codebase:**
- Use existing graph extraction as expansion backbone.
- Add `expand_mode`: `none | 1hop | 2hop` with token budget caps.
- Expansion follows: `imports`, `extends`, `implements`, `uses` edges.
- Rerank expanded candidate sets before final context pack.

**Sources:**
- CoRet (repository-level graph + retrieval): https://arxiv.org/abs/2506.03186
- Repo-level code search with temporal/repo context: https://arxiv.org/abs/2502.07067

---

### 8) Intent-Aware Retrieval Routing

**What:** Route queries by intent (`api_lookup`, `bug_fix`, `refactor`, `security`)
and alter chunk expansion/ranking policy per intent.

**Why this matters:**
- A single retrieval strategy is measurably suboptimal for diverse SWE tasks.
- Different query types benefit from different chunk types and expansion policies.

**Action in this codebase:**
- Add lightweight query classifier (keyword heuristics + optional LLM fallback).
- Per-intent policies:
  - `api_lookup`: prioritize declarations/signatures/import graphs.
  - `bug_fix`: prioritize failing-test neighbors + recent edits.
  - `refactor`: prioritize call graph + cross-file references.
  - `security`: prioritize input validation, auth, and crypto patterns.

**Sources:**
- AlignCoder (query enhancement for code retrieval): https://arxiv.org/abs/2508.03162
- "What to Retrieve?" empirical study: https://arxiv.org/abs/2501.00157

---

### 9) Quality-Aware Chunk/Context Weighting

**What:** Score chunks by quality/usefulness and include quality priors in ranking.

**Why this matters:**
- Recent code retrieval work shows retrieval quality, not just embedding
  similarity, drives downstream pass rate.
- Not all chunks are equally useful. A well-documented function with tests is
  more valuable than a utility helper.

**Action in this codebase:**
- Add per-chunk quality features:
  - Test coverage proximity (is there a test file for this symbol?).
  - Recency (git blame last-modified date).
  - Symbol centrality (PageRank score from entity graph).
  - Comment/code ratio.
  - Cyclomatic complexity estimate.
- Combine quality score with FTS + vector score in reranker.
- Log quality score contributions for debuggability.

**Quality weight default:**
- Current: `qualityWeight` defaults to 0 (disabled). May be moved to 0.05 or 0.1
  once validated.
- TODO: Benchmark `qualityWeight: 0 vs 0.05 vs 0.1 vs 0.2` on eval harness; gate
  default change on MRR/Recall delta.

**Sources:**
- CoQuIR (quality-aware code retrieval): https://arxiv.org/abs/2505.17173

---

### 10) TypeScript-Specific Boundaries (Quick Win)

**What:** Add TypeScript-only construct patterns to the regex registry even before
full tree-sitter rollout.

**Why this matters:**
- TypeScript is the #1 language for the Claude Code community.
- Current limitation #8: TS treated as JS means `interface`, `type`, `enum`,
  `namespace`, and `decorator` declarations are invisible to the chunker.
- This is a quick win that can ship immediately without tree-sitter.

**Action in this codebase:**
- Add a `typescript` language config extending `javascript` in `registry-core.js`.
- Chunker patterns for: `interface`, `type alias`, `enum`, `namespace`, `abstract class`.
- Entity patterns for: `interface`, `type`, `enum`, decorators.
- Map `.ts` and `.tsx` to `typescript` in `EXTENSION_MAP`.
- Keep `.js`/`.jsx`/`.mjs`/`.cjs` on existing `javascript` config.

**Patterns to add:**
```js
// Chunker boundaries
interface: /^(?:export\s+)?interface\s+(\w+)/
typeAlias: /^(?:export\s+)?type\s+(\w+)\s*[=<]/
enum:      /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/
namespace: /^(?:export\s+)?(?:declare\s+)?namespace\s+(\w+)/
```

---

### 11) Cross-Line Construct Handling (Regex Tier)

**What:** Improve multi-line construct detection in the regex engine for cases
where tree-sitter is not available.

**Why this matters:**
- Known limitation #7: all patterns operate on single lines.
- Decorators split across lines, multi-line function signatures, and
  continuation-line constructs are partially captured at best.
- Tree-sitter solves this natively, but for the regex fallback tier, a
  line-joining heuristic can recover some cases.

**Action in this codebase:**
- In `_matchBoundary()`: if a line ends with `(`, `,`, or `\` (continuation),
  peek ahead and join up to 3 subsequent lines for boundary matching.
- Track the joined range so `line_start` / `line_end` remain correct.
- Add a `multiLinePatterns` option per language config to opt in selectively.

---

### 12) SEISMIC: Sparse Vector Search for Hybrid Retrieval

**What:** Add SEISMIC (Spilled Clustering of Inverted Lists with Summaries for
Maximum Inner Product Search) as a third retrieval pathway alongside FTS5 and
HNSW, enabling fast approximate retrieval over learned sparse embeddings.

**Why this matters:**
- SEISMIC achieves sub-millisecond per-query latency on NL-IR benchmarks
  (MS MARCO with SPLADE embeddings). SIGIR 2024 Best Paper Runner-up.
- 3.4x-12x faster than graph-based methods (including HNSW) at 95% accuracy.
- 1-2 orders of magnitude faster than standard inverted index algorithms.
- At 97% accuracy on Efficient SPLADE, SEISMIC evaluates 2,198 documents
  where graph-based methods visit ~40,000.
- Learned sparse embeddings (SPLADE) generalize better to out-of-domain data
  than dense embeddings on the BEIR benchmark, which may help with code search.

**Important caveats:**
- All published SEISMIC benchmarks are on **natural language IR** (MS MARCO),
  not code search. Performance on code is unvalidated.
- Requires **learned sparse embeddings** (SPLADE or similar). Existing SPLADE
  models are trained on NL text, not code. A code-specific sparse encoder may
  need fine-tuning or training from scratch.
- Query-time sparse encoding adds latency (running the query through the
  encoder model) that is not reflected in the raw SEISMIC index lookup time.
- This is a retrieval-layer optimization. It only delivers value after
  chunking quality and embedding quality are solid (i.e., after P0 items).

**How SEISMIC works:**
1. Organizes inverted lists into geometrically-cohesive **blocks**.
2. Each block gets a **summary vector** (sketch) capturing its content.
3. During query: summaries let you **skip irrelevant blocks entirely**.
4. When a block must be examined, the forward index provides exact embeddings.
5. Key insight: block summaries preserve an `alpha`-fraction of importance,
   so skipped blocks provably contribute little to the final score.

**Three-tier retrieval architecture (target):**
```
Query
  |
  ├── FTS5 (lexical)        --> exact term matches, <5ms
  ├── HNSW (dense vectors)  --> semantic similarity, ~10ms
  └── SEISMIC (sparse)      --> learned sparse retrieval, <1ms (on NL-IR; code TBD)
  |
  v
Reciprocal rank fusion / reranker --> final ranked results
```

**Implementation path:**
- SEISMIC reference implementation is in **Rust** (MIT license):
  [github.com/TusKANNy/seismic](https://github.com/TusKANNy/seismic)
- Integration options:
  1. **WASM compile** of Rust implementation (preserves zero-native-dep story).
  2. **NAPI binding** to Rust library (fastest, but adds native dep).
  3. **Pure JS port** (maintainable, but slower than Rust).
- Can coexist with HNSW: use SEISMIC for sparse/hybrid queries, HNSW for
  pure dense similarity. FTS5 continues to handle exact lexical matches.

**Prerequisites before SEISMIC is useful:**
1. Code-specific sparse encoder (fine-tune SPLADE on code, or evaluate
   CodeXEmbed / CodeSage sparse variants).
2. Solid chunking pipeline (tree-sitter + contextualized text) so the
   embeddings are worth retrieving.
3. Evaluation harness (#13) to measure whether SEISMIC actually improves
   code search quality vs HNSW alone.

**Sparse embedding options to evaluate:**
- **SPLADE** (Naver): NL sparse expansion model, strong OOD generalization.
- **Efficient SPLADE**: Sparser queries = faster SEISMIC performance.
- **CodeXEmbed-2B**: Code-specific embeddings (70.4 nDCG on CoIR benchmark).
- **CodeSage**: Code-specific model with sparse variants.

**Sources:**
- SEISMIC paper (SIGIR 2024, peer-reviewed): https://dl.acm.org/doi/10.1145/3626772.3657769
- SEISMIC Rust implementation: https://github.com/TusKANNy/seismic
- SEISMIC scalability study (ECIR 2025, peer-reviewed): https://arxiv.org/html/2501.11628v1
- SPLADE models: https://github.com/naver/splade

---

### 13) Benchmarking Against Modern Code-RAG Suites

**What:** Validate chunking changes against modern code retrieval benchmarks,
not only unit tests.

**Why this matters:**
- Prevents local optimizations that regress end-to-end coding success.
- The cAST paper evaluated on RepoEval, CrossCodeEval, and SWE-bench Lite.
  Sweet Search should do the same.

**Action in this codebase:**
- Add `eval/` directory with retrieval evaluation harness.
- Benchmark on: RepoEval (code-to-code), SWE-bench Lite (NL-to-code),
  CrossCodeEval (cross-language).
- Metrics: `Recall@5`, `Recall@20`, `MRR`, downstream `Pass@1`.
- Gate releases on delta thresholds vs baseline.

**Sources:**
- CodeRAG-Bench: https://arxiv.org/abs/2508.05180
- SWE-bench: https://www.swebench.com/
- ContextBench: https://arxiv.org/html/2602.05892v3

---

## Current Strengths (Don't Break These)

Sweet Search has advantages that most tree-sitter-only chunkers lack:

1. **Entity/relationship graph extraction** - No competing chunker builds a
   knowledge graph with entities, relationships, and cross-file resolution.
   This is the foundation for PageRank repo maps and graph-aware expansion.

2. **Integrated hybrid search** - FTS5 (porter + trigram) + HNSW vectors +
   relationship resolution in one system. Matches Anthropic's recommendation
   of "contextual embeddings + contextual BM25 + reranking."

3. **37-language breadth** - Most tree-sitter tools wire up 6-10 languages.
   The regex fallback tier preserves this coverage.

4. **Zero native dependencies** - Pure JS, instant `npm install`, no `node-gyp`.
   WASM tree-sitter preserves this property.

5. **Debug counters and diagnostics** - Per-language, per-pattern tracking of
   empty captures, skipped lines, and pattern drops. Rare in competing tools.

---

## Prioritized Implementation Plan

### P0 (Immediate: biggest ROI)
1. TypeScript-specific regex patterns (#10) - quick win, no new deps.
2. Contextualized `embedding_text` generation (#2) - biggest retrieval uplift.
3. Tree-sitter WASM tier for JS/TS/Python/Go/Rust (#1) - accuracy foundation.
4. Recursive AST split-merge for oversized symbols (#3) - requires tree-sitter.

### P1 (2nd wave)
1. PageRank repo map from existing graph data (#5) - unique differentiator.
2. Incremental parsing with selective reindex (#6) - dev loop performance.
3. 1-hop graph expansion with reranking (#7) - multi-hop query support.
4. Cross-line construct handling for regex fallback (#11).
5. Benchmarking harness (#13) - needed to validate everything above.

### P2 (Advanced SOTA - requires P0/P1 foundation)
1. SEISMIC sparse vector search (#12) - evaluate code-specific sparse encoder
   first; only proceed if benchmarks show improvement over HNSW.
2. Query-intent router + per-intent retrieval policies (#8).
3. Quality-aware scoring model for chunk weighting (#9).
4. tree-sitter `tags.scm` for symbol extraction (#4).
5. 2-hop adaptive graph expansion under token budgets.

---

## KPIs (Must Move)

| Metric | Target | Measurement | Phase |
|--------|--------|-------------|-------|
| **TypeScript construct coverage** | 100% of interface/type/enum | Language pattern validator test | P0 |
| **Retrieval Recall@5** | +4 points vs current baseline | RepoEval code-to-code tasks | P0 |
| **Retrieval Recall@20** | +2 points | SWE-bench NL-to-code tasks | P0 |
| **Query latency (lexical)** | <5ms p95 | FTS5 indexed search (already close) | P0 |
| **Index update latency** (single-file) | >50% reduction | Incremental vs full reindex | P1 |
| **Agent tool calls per task** | -30% | Requires agent eval harness | P1 |
| **End-to-end Pass@1** | +2 points | SWE-bench Lite subset | P1 |
| **Sparse retrieval latency** | TBD (benchmark first) | SEISMIC on code-specific sparse embeddings | P2 |

---

## Guardrails

1. Keep regex engine as universal fallback to preserve 37-language coverage.
2. Keep chunk IDs stable where possible to avoid embedding churn.
3. Track every new heuristic with per-feature attribution in debug counters.
4. Require A/B benchmark wins before defaulting new policies.
5. WASM tree-sitter must not break `npm install` on any platform (lazy load).
6. `embedding_text` is separate from `content` - never mutate display text.

---

## Strategic Position: Sweet Search vs The Field

Sweet Search competes with ripgrep on two axes: **speed for indexed queries**
(where pre-indexing wins) and **capability** (semantic, structural, and
graph-aware search that ripgrep cannot do).

### Where pre-indexing wins on speed

ripgrep scans files from disk on every query. It's highly optimized (SIMD, mmap,
parallel directory walking), but it's fundamentally O(total-file-size):

```
ripgrep:      O(total bytes in repo)  -- reads files from disk each query
Sweet Search: O(log n) index lookup   -- pre-indexed, no disk scan
```

For **term lookups on large repos**, FTS5 indexed search is already faster than
ripgrep's disk scan. This is a direct, measurable advantage today - no new
technology needed.

Where ripgrep still wins: **ad-hoc regex patterns** not in the index, very small
repos where disk cache makes scanning near-instant, and queries that need
line-level byte offsets in the original file.

### Where Sweet Search adds capabilities ripgrep cannot

| Capability | ripgrep | Sweet Search (current) | Sweet Search (after P0) |
|------------|---------|----------------------|------------------------|
| Term lookup (indexed) | Disk scan (~100ms+) | FTS5 <5ms | FTS5 <5ms |
| Ad-hoc regex | Native, fast | Not supported | Not supported |
| Semantic similarity | No | HNSW vectors | HNSW + contextualized embeddings |
| Structural awareness | No | Regex boundaries | Tree-sitter AST |
| Cross-file relationships | No | Entity graph | Entity graph + PageRank |
| Scope-aware context | No | No | Scope chain enrichment |
| Recursive oversized splits | No | No | cAST algorithm |
| TypeScript constructs | Text-only grep | Partial (JS patterns) | Full coverage |
| Multi-line constructs | Regex only | No (limitation #7) | Tree-sitter native |
| Result ranking | None (match order) | FTS5 + vector score | Quality + graph-aware |

### Why Sweet Search wins for Claude Code agents

ripgrep requires **multiple iterative calls** in an agent loop: grep for a
keyword, read the file, grep for related terms, read more files, repeat. Each
round-trip costs tokens, latency, and context window space.

Sweet Search answers in **one call**: "find all functions that handle
authentication" returns ranked, scope-annotated, relationship-linked results.
The agent doesn't need 10 grep iterations to build context.

**Indicative impact** (supermemory SWE-bench eval, self-reported, not peer-reviewed):
- Agent tool calls: 19 -> 12 (-37%)
- Cost per task: $0.25 -> $0.20 (-20%)
- Duration: 2.0m -> 1.2m (-40%)

These numbers are directionally plausible but should be validated independently
on Sweet Search's own pipeline before being used as targets.

**Anthropic's own guidance** ("just-in-time context, not pre-inference RAG")
applies to agent-driven grep loops. But they also acknowledge this burns tokens
and is slow for large codebases. Sweet Search fills that gap: pre-indexed
semantic understanding that the agent can query in one call instead of 10 grep
iterations.

### The moat

The combination of **tree-sitter accuracy + knowledge graph + hybrid search +
context enrichment** is what no single competing tool offers today. ripgrep has
speed but no understanding. Aider has tree-sitter but no indexed search.
supermemory has chunking but no graph.

Sweet Search with P0 implemented brings **all of these into one system**. Adding
SEISMIC in P2 would further strengthen the speed axis, but only after validating
that sparse embeddings work well for code search specifically.
