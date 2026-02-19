# Vocabulary Prewarm Plan: Codebase-Aware Dynamic Warmup

**Status**: Plan (not yet implemented)
**Date**: 2026-02-11 (updated 2026-02-18)
**Scope**: Refine the vocabulary warmup system so it mines *any* target codebase for meaningful terms instead of relying on hardcoded preset word lists. Target: **80%+ cache hit rate** across all three search modes.

---

## 1. Problem Statement

The current warmup system has three independent layers, all flawed in the same way:

| File | What it does | Problem |
|------|-------------|---------|
| `scripts/prewarm-vocab.js` | Falls back to 36 hardcoded `GENERIC_TERMS` ("authentication", "database", etc.) | Completely project-agnostic. Useless for a Rust game engine or a Go microservice. |
| `scripts/vocabulary-warmup.js` | Extracts entities from `code-graph.db`, generates question variants | Better, but (a) only warms semantic embeddings for a single provider, (b) requires a prior full indexing run, (c) no lexical or hybrid warmup. |
| `core/vocabulary-utils.js` | Binary format + query log mining + graph templates | Most advanced, but still single-provider, and the "learning" is reactive (waits for user to query 3+ times before promoting). |
| `.claude/helpers/session-preheat.sh` | Parallel component warmup | Vocabulary step just loads the file; **FTS5 warmup is literally `WHERE name MATCH "warmup"`** — a term that exists in zero codebases. |

### What's warm vs. cold today

| Component | Warm? | Details |
|-----------|-------|---------|
| Local embedding model (all-MiniLM-L6-v2) | Yes | Pre-initialized in session-preheat.sh (~4s) |
| Vocabulary cache (binary/JSON) | Yes | Loaded but contains generic/stale terms |
| FlashRank reranker | Yes | Pre-initialized (~1.5s) |
| HNSW index (loaded into memory) | Yes | But no traversal paths are warmed |
| WASM Query Router (CatBoost) | Yes | JIT warmed in ~6ms — **routing is solved; this plan is about seed generation** |
| **FTS5 page cache** | **No** | Touch query uses "warmup" — zero pages loaded |
| **HNSW traversal paths** | **No** | No actual searches executed during warmup |
| **Hybrid pipeline (fusion)** | **No** | No hybrid queries run |
| **Vocabulary relevance** | **No** | 36 generic terms vs. codebase-specific identifiers |
| **Semantic query seeds** | **No** | No project-specific NL concept phrases mined or cached |

**Core issue**: The routing classifier (CatBoost WASM) already decides whether an incoming query is lexical, semantic, or hybrid at sub-ms cost. What's missing is the **seed vocabulary** that makes each mode genuinely warm: real identifier embeddings for lexical, and project-specific NL concept phrases for semantic. The latter — phrases like "authentication in local instance" vs "central SSO flow" — cannot be derived from generic templates; they must be mined from the codebase's own language.

---

## 2. Research Foundation

### 2.1 What Developers Actually Search For

Research from Google, Sourcegraph, and academic field studies reveals a clear query distribution:

| Query Type | Frequency | Examples |
|------------|-----------|----------|
| **Identifier Lookup** | 60-70% | `UserController`, `fetchData`, `calculateTotal` |
| **Natural Language** | 15-20% | "how does authentication work", "parse JSON" |
| **File Path / Module** | 5-10% | `src/auth/login.js`, `components/Button` |
| **Error Messages** | 5-10% | "TypeError: Cannot read property", "ECONNREFUSED" |
| **API / Library Reference** | 5-10% | `express.Router()`, `useState` |

**Key facts** (Google Research, Sadowski et al.):
- Average developer conducts **5.3 search sessions/weekday** with **1-2 searches per session**
- Queries are overwhelmingly **1-2 terms** (simple, focused identifier lookups)
- **70% of program text** consists of identifiers — that IS the searchable vocabulary
- ~24.6% query reformulation rate when initial search fails

**Implication**: Warming the **top 1000-2000 identifiers** from the codebase will cover the vast majority of likely queries. The harder problem is the 15-20% semantic NL queries, which are project-specific and cannot be predicted from generic templates.

**Sources**: [Google Developer Search Study](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43835.pdf), [Sourcegraph Query Analysis](https://arxiv.org/pdf/2212.03459), [Damevski et al. Field Study](https://damevski.github.io/files/cst-field-study.pdf)

### 2.2 Zipf's Law and the Pareto Cutoff

Code search terms follow a Zipf's law distribution: the Nth most-common term appears ~1/N as often as the most common one. Combined with the Pareto principle (80/20 rule):

| Terms Warmed | Expected Cache Hit Rate | Marginal Gain |
|--------------|-------------------------|---------------|
| 100 | 55-60% | +55-60% |
| 500 | 70-75% | +15% |
| **1000** | **80-85%** | **+7%** |
| 2000 | 85-90% | +5% |
| 5000 | 90-95% | +3% |

**Sweet spot**: **1000-2000 terms** for most codebases. Beyond that, diminishing returns make the embedding cost not worth it.

**Sources**: [Stanford NLP - Zipf's Law in Term Distributions](https://nlp.stanford.edu/IR-book/html/htmledition/zipfs-law-modeling-the-distribution-of-terms-1.html), [PMC - Zipf's Law in Code](https://pmc.ncbi.nlm.nih.gov/articles/PMC4176592/)

### 2.3 Production Code Search Architectures

| System | Approach | Vocabulary Strategy |
|--------|----------|---------------------|
| **Sourcegraph/Zoekt** | Trigram indexing + ctags symbols | Multi-layered: trigrams for substring, symbols for navigation |
| **GitHub Code Search** | Zoekt + SCIP semantic analysis | Symbol-aware, ranks by code-specific signals |
| **Cursor** | RAG + semantic search + ripgrep | Hybrid: semantic chunks + regex patterns + AST code graph |
| **CodeRabbit** | AST graph analysis | Repository-wide code graph, tracks definitions + references |
| **Continue.dev** | Codebase embeddings (Voyage) | Indexed chunks, incremental updates on commit |

**Common pattern**: All successful systems build vocabulary from the codebase itself, not from preset lists. Multi-layered retrieval (keyword + semantic + structural) yields the best results.

**Sources**: [Sourcegraph Zoekt](https://github.com/sourcegraph/zoekt), [How Cursor Indexes Codebases](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/), [Continue.dev Embeddings](https://docs.continue.dev/features/codebase-embeddings)

### 2.4 Embedding Cache Warming (SOTA 2025-2026)

| Technique | Impact | Source |
|-----------|--------|--------|
| **Voyage-code-3 + int8 quantization** (leading code-specific embedding model) | +13.8-16.8% vs competitors, 83% cost reduction | [Voyage AI](https://blog.voyageai.com/2024/12/04/voyage-code-3/) |
| **Matryoshka embeddings** | 8.3% of size retains 98.37% of performance | [HuggingFace](https://huggingface.co/blog/matryoshka) |
| **GoVector hybrid caching** | 46% fewer I/O ops, 1.73x throughput | [arXiv 2508.15694](https://www.arxiv.org/pdf/2508.15694) |
| **StorInfer precomputation** | 150K precomputed queries, 17.3% latency reduction | [arXiv 2503.17603](https://arxiv.org/html/2503.17603v1) |
| **DiskANN/Vamana** | Preload entry + multi-hop neighbors, eliminates cold-start | [Zilliz](https://zilliz.com/learn/DiskANN-and-the-Vamana-Algorithm) |
| **OpenSearch warmup API** | Native `/_plugins/_knn/warmup/` endpoint, 65% cold-start reduction | [OpenSearch Docs](https://docs.opensearch.org/2.8/search-plugins/knn/api/) |
| **Milvus explicit warmup** | Per-field warmup config (vectorField, vectorIndex) | [Milvus Docs](https://milvus.io/docs/warm-up.md) |

### 2.5 Hybrid Search Warming

**RRF (Reciprocal Rank Fusion)** is widely used and effective for combining BM25 + vector search:
```
RRF_score(d) = Sum[ 1 / (k + rank_in_method_i) ]    k = 60
```

- No tuning required, rank-based (immune to mismatched score scales)
- Both paths MUST be warm independently for hybrid to be fast
- Warming only one path leaves the other cold — hybrid latency = max(lexical, semantic)
- **Weakest-link phenomenon** (arXiv:2508.01405, "Balancing the Blend", 2025): a weak retrieval path substantially degrades overall RRF accuracy. This directly motivates this plan's dual-path warmup strategy — if FTS5 is cold while HNSW is warm (or vice versa), hybrid quality degrades even though one path is fast.

**Sources**: [Microsoft Azure RRF](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking), [Weaviate Hybrid Search](https://weaviate.io/blog/hybrid-search-explained), [Elasticsearch Caching Deep Dive](https://www.elastic.co/blog/elasticsearch-caching-deep-dive-boosting-query-speed-one-cache-at-a-time), [Balancing the Blend — Weakest Link in RRF](https://arxiv.org/abs/2508.01405)

### 2.6 SQLite FTS5 Proper Warming

Research shows the right way to warm SQLite for search:

```sql
PRAGMA journal_mode = WAL;           -- Write-ahead logging
PRAGMA mmap_size = 30000000000;      -- Memory-map the DB file
PRAGMA cache_size = -400000;         -- 400MB page cache
INSERT INTO entities_fts(entities_fts) VALUES('optimize');  -- Merge FTS segments
```

Then execute actual `MATCH` queries with **real terms from the codebase** to force B-tree pages into OS page cache. The current `MATCH "warmup"` does nothing.

**Sources**: [SQLite Performance Tuning](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/), [FTS5 Structure](https://darksi.de/13.sqlite-fts5-structure/), [SQLite mmap](https://oldmoe.blog/2024/02/03/turn-on-mmap-support-for-your-sqlite-connections/)

### 2.7 Semantic Query Seed Generation Without LLM (SOTA 2025-2026)

The challenge for semantic/hybrid warmup is predicting NL queries before they happen. They are project-specific: "authentication in local instance" vs "central SSO flow" — words that come from this codebase's own structure, not from any generic template.

**Key finding** (Search4Code, SIGIR 2025): Rule-based heuristics + classical ML reach production-grade accuracy for code search intent classification. No LLM required. For code queries specifically, surface features are extremely strong signals:

| Feature | Signal |
|---|---|
| camelCase / PascalCase / SCREAMING_SNAKE | → lexical (identifier lookup) |
| File path fragment (`src/`, `.js`, `/`) | → lexical |
| Query length ≤ 2 tokens, no NL words | → lexical |
| NL trigger words (`how`, `what`, `find`, `where`) | → semantic |
| Multi-word phrase with no code tokens | → semantic/hybrid |

**Note**: The CatBoost WASM router already handles per-query routing at inference time. This classification is needed only at warmup-seed-generation time to avoid wasting HNSW warmup budget on identifier-only terms.

**For project-specific NL concept phrase extraction**, the SOTA approach is **Leiden community detection on the import graph** followed by **c-TF-IDF per community**:

1. Leiden groups files by import/call density — depth-independent (a frontend buried 5 folders inside a Spring Boot project forms its own community because it imports within itself)
2. c-TF-IDF extracts what makes each community's language *distinct* from others — not "authentication" (appears everywhere), but "local instance auth", "central SSO", "device session" (each distinctive to one community)
3. These multi-word phrases are the semantic query seeds — they match how developers actually describe a subsystem in NL

**Sources**: [Search4Code weak supervision](https://arxiv.org/abs/2011.11950), [Leiden algorithm](https://arxiv.org/abs/1810.08473), [BERTopic / c-TF-IDF](https://maartengr.github.io/BERTopic/), [SIGIR 2025 - Weak Supervision vs LLMs for Query Intent](https://arxiv.org/html/2504.21398v1)

---

## 3. Proposed Architecture

### 3.1 Core Thesis

**The warmup system mines the codebase, detects its logical communities via the import graph, extracts project-specific NL concept phrases from those communities, and pre-computes embeddings for both high-PageRank identifiers and community phrases. No preset words. Provider-agnostic. The CatBoost WASM router already handles query routing; this system generates the seeds that make the warm paths worth hitting.**

The command is a 4-phase pipeline:

```
/sweet-prewarm-vocab
    Phase 1: MINE the codebase (identifiers + community phrases)    → 2-8s
    Phase 2: RANK + CLASSIFY warm mode per term                     → <1s
    Phase 3: WARM each search mode with appropriately typed seeds   → varies by provider
    Phase 4: PERSIST vocabulary + community map                     → <1s
```

### 3.1.1 Three-Tier Timing Model

Work is strictly separated into three tiers. Never cross them.

| Tier | When | What happens | Latency budget |
|------|------|-------------|----------------|
| **Heavy** | At indexing time (post `/index-codebase`) | Community detection, phrase extraction, embedding generation, HNSW seeding | 5-30s (amortized, nobody is waiting) |
| **Light** | At session start (preheat) | Load cached binary, run FTS5 MATCH queries, traverse HNSW with cached embeddings | <3s |
| **Lookup** | At query time | Cache hit check in vocabulary binary | <1ms |

**Session preheat reads the cache only — it never recomputes.** The heavy work runs once at indexing time and is re-run only when the import graph structure changes significantly (new modules, major refactors), gated by a graph structure hash.

**Note on time budgets**: Phase 3 timing depends on the active embedding provider. Local models (all-MiniLM-L6-v2, 384d) generate embeddings at ~50-100ms per batch of 32. Remote APIs (Voyage, Mistral, Jina) add network latency (~200-500ms per batch). All time estimates below assume the **local provider** as the default. Remote providers may add 2-3x to semantic warmup times.

### 3.2 Multi-Tier Cache Architecture

```
L1: In-Memory Cache (Hot Data)
├── HNSW index entry points + frequent traversal paths
├── FTS5 B-tree pages for top identifiers (PageRank-ranked)
├── Precomputed embeddings for top-N identifiers + community phrase seeds
└── Hybrid fusion results for common queries

L2: OS Page Cache (Warm Data, via mmap)
├── SQLite mmap region (code-graph.db, codebase.db)
├── HNSW segments (memory-mapped .idx files)
└── FTS5 posting lists

L3: Disk (Cold Data)
├── Full vector dataset
├── Complete FTS5 index
└── ColBERT token database
```

### 3.3 Phase 1: Mine the Codebase (Term Extraction)

Multiple mining strategies run in parallel. This is **Heavy tier** work — it runs at indexing time (post `/index-codebase`) or on manual `/sweet-prewarm-vocab`, never at session start. Total budget: **2-8 seconds** depending on depth and whether code-graph.db exists.

#### 3.3.1 Structural Mining (Fast, ~500ms)

No parsing required. File system + simple regex:

- **File paths**: `src/auth/login-controller.ts` -> `auth`, `login`, `controller`, `LoginController`
- **Directory names**: Provides weak module signals (top-level only; buried subsystems handled by §3.3.4)
- **Package manifests**: `package.json`/`Cargo.toml`/`go.mod`/`requirements.txt` -> dependency names (`express`, `prisma`, `tokio`)
- **Config files**: `.env.example` keys, config property names

**Note**: Directory-based grouping is a *weak* signal for module vocabulary because important subsystems are often buried multiple levels deep (e.g., a React app inside a Spring Boot project at `backend/src/main/resources/static/frontend/`). §3.3.4 Leiden community detection handles depth-independent module discovery using the import graph.

#### 3.3.2 Symbol Mining (Medium, ~1-3s)

**Hybrid Tree-sitter + regex approach** (tree-sitter grammars already available via `tree-sitter-wasms`):

- **Import/export statements**: Regex extraction across languages (JS/TS/Python/Rust/Go/Java)
- **Class/function/method names**: camelCase/snake_case/PascalCase splitting
- **Constants/enums**: `USER_ROLE_ADMIN`, `ORDER_STATUS_PENDING` -> domain vocabulary
- **Public API surface**: `export`, `pub`, capitalized (Go) -> higher weight

**Identifier Splitting** (compound identifiers -> individual tokens):
```
getUserData       -> ["get", "User", "Data"]
user_data_model   -> ["user", "data", "model"]
XMLParser         -> ["XML", "Parser"]
API_RATE_LIMIT    -> ["API", "RATE", "LIMIT"]
```

#### 3.3.3 Code Graph Mining (if code-graph.db exists, ~500ms)

If `code-graph.db` exists (from prior `/index-codebase`):

- Entity names from `entities` table (class, interface, method, field)
- Hub detection: entities with high in-degree in `relationships` table
- Leaf entities (rarely referenced) get lower weight
- **PageRank scores from `core/repo-map.js` are consumed directly here** — no re-computation

This is what `vocabulary-warmup.js` already does, but it becomes one input among many.

#### 3.3.4 Leiden Community Detection (requires code-graph.db, ~500ms)

**This is the key step that enables depth-independent module discovery.** It must run before §3.3.5 (community-aware NL mining), which depends on its output.

Build a weighted adjacency graph from `code-graph.db` relationships and run the Leiden algorithm:

```
Edge weights:
  imports / extends / implements  →  weight 3
  calls / uses                    →  weight 1

Algorithm: Leiden (preferred over Louvain — guarantees well-connected communities)
Complexity: O(n log n) on typical code graphs
Output: community membership per entity
```

**Why Leiden over directory grouping**: A frontend React app at `backend/src/main/resources/static/frontend/` forms a dense import cluster within itself and rarely imports from the Java backend. Leiden puts it in its own community regardless of its directory depth. Directory grouping at depth 1 or 2 would merge it with the entire backend.

**Why Leiden over Louvain**: The Leiden algorithm (2019) guarantees that communities are well-connected (no disconnected subcommunities), which Louvain can produce. For code graphs with sparse cross-module connections, this matters.

**Output feeds into**: §3.3.5 (community-aware NL mining), §3.4 (community c-TF-IDF ranking), and §3.6 (community map persistence).

**Hard cutoffs**: If `code-graph.db` has >50,000 entities or >200,000 relationships, skip Leiden and fall back to directory grouping. If Leiden exceeds 2x its wall-clock budget (1s), abort, emit partial results from the best completed iteration, and mark the community map as `stale: true` in `communities.json`. Stale maps are still used for warmup but flagged in `--stats` output.

**Fallback when code-graph.db is absent**: Fall back to top-2 directory path grouping. Semantic warmup quality degrades but remains functional.

#### 3.3.5 Community-Aware NL Content Mining (requires code-graph.db, ~1-3s)

**Goal**: Extract project-specific multi-word NL concept phrases that match how developers describe subsystems in natural language queries ("authentication in local instance", "central SSO flow", "payment webhook handler").

This step runs **after §3.3.4 Leiden community detection** and mines NL content *per community*, not globally.

For each detected community:
1. Collect all NL text from files in that community:
   - Comments and docstrings
   - README sections that reference those files (linked by filename mentions)
   - Commit messages touching those files (git mining)
   - String literals and log messages
2. Extract **bigrams and trigrams** using TF-IDF over the community's text corpus — not unigrams, since semantic queries are multi-word phrases
3. Apply **c-TF-IDF across communities**: weight phrases by how distinctive they are to this community vs. all others. "authentication" alone is not distinctive (appears everywhere). "local instance auth" is distinctive to community A. "central SSO" is distinctive to community B.
4. Output: `{ communityId, phrases: [{ text, score, type: 'bigram'|'trigram' }] }` per community

**Why bigrams/trigrams matter**: A developer in a project with `apps/local/` and `apps/central/` will search "authentication local instance" not "authentication". The community phrase extraction captures exactly this vocabulary because it's statistically distinctive within that project. Unigram extraction misses it entirely.

**NL language awareness**: Bigram/trigram extraction assumes whitespace-segmented text and works well for English and other Latin-script languages. For CJK-dominant codebases (detected via Unicode script sampling of the first 5,000 lines of comment text): if >80% of NL text is a single non-Latin script, use `Intl.Segmenter` for word boundary detection before n-gram extraction; otherwise fall back to unigram extraction for that script. Default: detect dominant NL from comments/docs; if mixed (<80% single script), extract n-grams per script separately to avoid TF-IDF contamination across languages.

**Redaction before persistence**: Before any mined phrase is persisted to `.sweet-search/` artifacts, apply a redaction pass. Filter out phrases matching common secret patterns: base64 blobs >32 chars, prefixes `sk-`, `ghp_`, `Bearer `, `token=`, `password=`, and any string literal containing `secret`, `password`, `api_key`, or `credential` unless the term also appears as an identifier name in the code graph (where it's a variable name, not a secret value). Never persist raw string literal values from `.env` files.

**Hard cutoffs**: If phrase extraction exceeds 2x its wall-clock budget (6s), emit partial results from completed communities and mark remaining communities as `phrasesMined: false` in `communities.json`. Warmup proceeds with whatever was extracted; stale communities are prioritized for the next incremental run.

**Time budget**: ~1-3s for bigram/trigram extraction across a typical codebase (~100 communities, ~500 characteristic phrases total).

#### 3.3.6 Git Mining (Deep mode only, ~1-3s)

- **Recent commit messages**: What developers talk about = what they search for. Bounded to last **200 commits or 30 days** (whichever is smaller) on the default branch — same bound used for NL content hashing in §3.6. Use `git log --max-count=200` to avoid scanning large histories.
- **Frequently changed files**: Hot files have hot vocabulary
- **Branch names**: `feature/oauth2-integration` -> `oauth2`, `integration`

### 3.4 Phase 2: Rank Terms and Classify Warm Mode

Two parallel ranking streams feed Phase 3.

#### Stream A: Identifier Ranking (for Lexical + Identifier-Semantic Warmup)

Research-backed scoring using **PageRank + BM25 + heuristic weights**:

```
BM25(term, file, codebase) = IDF(term) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * |file|/avgFileLen))

k1 = 1.5  (higher saturation — identifiers repeat more than prose)
b  = 0.5  (lower length penalty — file sizes vary widely)
```

**Heuristic Multipliers**:

| Signal | Weight | Rationale |
|--------|--------|-----------|
| Appears in exports/public API | 3.0x | Users search for public interfaces (research: 60-70% are identifier lookups) |
| High code-graph connectivity (PageRank > 0.1) | 2.5x | Hub entities are searched more (PageRank on dependency graph) |
| Appears in file/directory names | 2.0x | Structural terms are common queries (path searches = 5-10%) |
| Appears in multiple files (cross-cutting) | 1.5x | Cross-cutting terms are important |
| camelCase/PascalCase identifier (named entity) | 1.2x | Named entities vs generic words |
| Appears in dependency names | 1.0x | Tech stack vocabulary |
| String literal / error message | 0.8x | Error searches = 5-10% of queries |
| Single occurrence, private scope | 0.3x | Low-priority, skip in resource-constrained mode |

**Combined score**: `final_score = bm25_score * heuristic_multiplier * (1 + pagerank_score)`

**Per-term warm_mode classification** (heuristic, ~0ms):
- PascalCase / SCREAMING_SNAKE / dotted.path → `warm_mode: "lexical"` (FTS5 warmup only; skip HNSW)
- snake_case single identifier → `warm_mode: "lexical"`
- Short (≤2 tokens), high FTS frequency → `warm_mode: "lexical"`
- Identifier of high-PageRank hub entity → `warm_mode: "both"` (worth embedding too)
- NL phrase (3+ tokens, no code tokens) → `warm_mode: "semantic"` (HNSW only)

This classification is purely heuristic — no inference required. It ensures HNSW warmup budget is not wasted on identifiers that will almost never be searched semantically.

**Output**: Sorted list `{ term, score, warm_mode, sources[], type }` with configurable cutoff:
- **Light**: top 200 identifiers (~70% coverage)
- **Medium**: top 1000 identifiers (~80-85% coverage)
- **Deep**: top 2000 identifiers (~85-90% coverage)

#### Stream B: Community Phrase Ranking (for Semantic Warmup)

After Leiden community detection (§3.3.4) and c-TF-IDF phrase extraction (§3.3.5):

1. Take top-K characteristic phrases per community (K = 10-20 phrases per community)
2. **Boost phrases that contain high-PageRank entity names** (cross-reference with Stream A output): "local auth **service**" where `AuthService` has PageRank > 0.1 → boosted
3. Generate question variants for each phrase:
   - `"how does {phrase} work"`, `"where is {phrase}"`, `"what handles {phrase}"`
4. Deduplicate across communities (some phrases appear in multiple communities — keep highest-scoring)

**Output**: `{ phrase, communityId, score, variants[] }` — typically 200-500 phrases total for a medium-sized project.

**Why this is the right approach for semantic queries**: Stream B phrases are the NL vocabulary that developers use when describing their own codebase. "authentication in local instance" is the query; "local instance auth" is what c-TF-IDF extracts from community A's comments and docs. These match because the developer's mental model of the code IS the code's own NL vocabulary.

### 3.5 Phase 3: Warm Each Search Mode

Two source streams feed three warm paths. The CatBoost WASM query router is already warm (handled by session preheat). This phase warms the data paths it routes to.

#### 3.5.1 Lexical Warmup (FTS5 / BM25 / Trigram)

**Goal**: Prime SQLite FTS5 page cache and posting lists using real codebase identifiers.

**Source**: Stream A identifiers with `warm_mode: "lexical"` or `"both"`, ranked by PageRank score. The top-N entities from `core/repo-map.js` output are consumed directly — no re-ranking needed.

**Strategy**:
1. **SQLite optimization** (once per session):
   ```sql
   PRAGMA mmap_size = 30000000000;
   PRAGMA cache_size = -100000;  -- 100MB (tunable)
   INSERT INTO entities_fts(entities_fts) VALUES('optimize');
   ```
2. **Execute MATCH queries** for top-N entity names in a single read transaction (batch to reduce round-trip overhead):
   ```sql
   BEGIN;
   SELECT rowid FROM entities_fts WHERE name MATCH ? LIMIT 1;  -- repeated for top-N
   COMMIT;
   ```
3. **Exercise trigram index** (if available) with substring queries
4. **Touch relationship table** to warm join pages:
   ```sql
   SELECT count(*) FROM relationships WHERE source IN (SELECT rowid FROM entities WHERE name = ?);
   ```

**Why this matters**: Forces SQLite to load relevant FTS5 B-tree pages into OS page cache. Current warmup queries use "warmup" — a term that matches nothing. Real terms warm real pages.

**Time budget**: ~1-2s for top 50 MATCH queries.

#### 3.5.2 Semantic Warmup (Embedding + HNSW)

**Goal**: Pre-compute embeddings for likely NL queries and warm HNSW traversal paths.

**Two-track design — different seeds for different query types:**

**Track A — Hub entity embeddings** (for NL queries about named entities):
- Input: Stream A identifiers with `warm_mode: "both"` (high-PageRank hub entities only, not all identifiers)
- Embed using the same `enrichEmbeddingText` format the indexer uses (scope chain, file path, symbol context from `core/tree-sitter-provider.js`) — not raw identifier strings. This ensures cosine similarity between warmup queries and indexed chunks is maximized.
- Qualified names: `AuthService`, `auth.AuthService`, `user.getProfile`
- These cover queries like "what does AuthService do" or "where is getProfile defined"
- Typical count: top 50-100 hub entities

**Track B — Community phrase embeddings** (for NL concept queries):
- Input: Stream B community phrases + their question variants
- These cover queries like "how does authentication work in local instance", "where is central SSO"
- Embed each phrase AND its question variants
- Typical count: 200-500 phrases × 3-4 variants = 600-2000 embeddings

**Implementation**:
```js
// Track A: hub entity embeddings
const hubEmbeddings = await generateEmbeddings(hubEntityNames);

// Track B: community phrase embeddings
const phraseEmbeddings = await generateEmbeddings([
  ...communityPhrases,
  ...communityPhrases.flatMap(p => p.variants)
]);

// Warm HNSW traversal paths for both tracks
// Note: HNSW warming is inherently neighborhood-aware — warming with
// "local instance auth" also warms graph paths for similar queries like
// "auth in local instance" because they land in the same embedding region.
// Additionally, SemanticCache (cosine threshold 0.85) provides similarity-aware
// cache hits at query time for remote providers, so slight query variations
// still benefit from precomputed seeds.
for (const embedding of [...hubEmbeddings, ...phraseEmbeddings]) {
  await hnswIndex.search(embedding, { k: 10 });
}
```

**Provider-agnostic design**: All embedding calls go through `generateEmbeddings()` from `embedding-service.js`. The vocabulary cache invalidates on provider change. No provider-specific code in the warmup path.

**Matryoshka multi-resolution** (for providers that support it):
- `EMBEDDING_CONFIG.hnswDimension` for HNSW index (fast traversal, small footprint)
- `EMBEDDING_CONFIG.dimension` for final reranking (full precision)
- Local provider (all-MiniLM-L6-v2): 256d HNSW / 384d full — no Matryoshka, dimensions are already compact
- **Dimension consistency invariant**: Seed embeddings are produced and stored at the same dimensions used at query time — `EMBEDDING_CONFIG.hnswDimension` for HNSW seeds, `EMBEDDING_CONFIG.dimension` for rerank. No separate warmup dimension config; warmup inherits production dimensions via the same `generateEmbeddings()` call path.
- **Provider capability guard**: Only use Matryoshka truncation (`hnswDimension` < `dimension`) when the active provider's model was specifically trained with Matryoshka loss (e.g., Voyage-code-3, OpenAI v3). For models without Matryoshka training, `hnswDimension` must equal `dimension` — truncating destroys recall.

**Time budget** (provider-dependent):

| Provider | Batch of 32 | Track A (100 items) | Track B (500 items) | Total (light) | Total (medium) |
|----------|-------------|---------------------|---------------------|----------------|----------------|
| **Local** (all-MiniLM-L6-v2) | ~50-100ms | ~200-300ms | ~1-2s | **~1-2s** | **~3-5s** |
| **Voyage** (code-3 / 4) | ~200-400ms | ~1-2s | ~4-8s | ~3-5s | ~8-15s |
| **Mistral** (codestral) | ~200-300ms | ~1-2s | ~3-6s | ~3-5s | ~8-12s |
| **Jina** (v3) | ~150-300ms | ~1s | ~3-5s | ~2-4s | ~6-10s |

#### 3.5.3 Hybrid Warmup (Full Pipeline)

**Goal**: Exercise the entire hybrid pipeline: CatBoost router → parallel lexical+semantic → RRF fusion.

**The CatBoost WASM router is already warm** (pre-initialized in session preheat). This step warms the data paths.

**Strategy**: Select **10-20 representative queries** derived from the community phrase seeds, weighted by community size (entity count) to avoid over-representing small communities:
- Top-1 identifier query per community (from Stream A hub entities), weighted by community entity count
- Top-1 NL phrase per community (from Stream B), weighted by community entity count
- 2-3 cross-community queries (phrases that span multiple communities)
- Run full hybrid searches through `sweet-search.js` unified pipeline

This warms: **FTS5 pages**, **HNSW graph**, **embedding model**, **reranker model**, **RRF fusion logic** — all with queries that are representative of the actual project vocabulary.

**Why this matters**: A cold hybrid query hits every component in sequence. Pre-running 10-20 representative queries eliminates the cold-start cascade. Research shows this can reduce cold-start times by **65%**.

**Time budget** (provider-dependent): ~1-2s with local provider, ~2-5s with remote providers.

### 3.6 Phase 4: Persist and Track

Persisted artifacts:

| File | Contents | Updated when |
|------|----------|-------------|
| `.sweet-search/vocab-identifiers.bin` | Binary embeddings for Stream A hub entities | Import graph structure changes |
| `.sweet-search/vocab-semantic-seeds.bin` | Binary embeddings for Stream B community phrases + variants | NL content hash changes |
| `.sweet-search/communities.json` | Leiden community map: `{ communityId, fileIds[], phrases[], topEntities[] }` | Import graph structure changes |
| `.sweet-search/vocab-dynamic.json` | Full ranked term list with scores, sources, warm_mode | Any mining run |

**Freshness tracking** — two separate hashes:
- **Import graph hash**: sha256 streaming over all `(source_id, target_id, rel_type)` tuples sorted lexicographically from the `relationships` table — O(E) time, constant memory. Catches any structural change (new modules, removed imports, added files) regardless of whether it affects "top" edges. Gates community re-detection.
- **NL content hash**: sha256 of `(comment text, README, recent commits)` — changes when descriptions change. Gates phrase re-extraction. "Recent commits" is bounded: last 200 commits on the default branch or 30 days, whichever is smaller. Total text input to hash is capped at 100KB to keep hashing fast and predictable.

On subsequent runs, only re-run steps whose input hash changed (incremental mode).

**Merge with query log mining**: Existing `vocabulary-utils.js` QueryStats feature remains — community phrases that get queried frequently get promoted; community phrases never queried get demoted after 7 days.

---

## 4. Adaptive Learning (Post-Warmup Feedback Loop)

The warmup shouldn't be static. Over time, actual query patterns should refine the vocabulary.

### 4.1 Query Log Analysis

The existing `query-vocabulary-stats.json` already tracks per-query frequency. Extend it:

```
On each search:
  1. Record query text + mode (lexical/semantic/hybrid) — CatBoost router decision
  2. Record cache hit/miss for each layer
  3. Every N queries (or daily), analyze:
     - Semantic cache misses → candidate phrases to add to community seeds
     - Unused warmed phrases → candidates to demote
     - Query clusters (semantic similarity) → identify query families not covered by any community
```

### 4.2 Promotion/Demotion Rules

| Condition | Action |
|-----------|--------|
| Query used 3+ times, not in warmup set | **Promote** — add to vocabulary, precompute embedding |
| Warmup term not queried in 7 days | **Demote** — remove from warmup set (keep in cold cache) |
| Cache miss for identifier that exists in code | **Fast-promote** — add immediately (clear gap in mining) |
| Query cluster with 5+ similar queries, no community match | **Add centroid** — warm the cluster center embedding; flag community detection gap |

### 4.3 Working Set Size Tracking

```
WSS(T) = unique query clusters in time window T

If WSS < warmup set size → warmup is well-sized
If WSS > warmup set size → expand warmup (up to 2000 terms max)
If WSS is stable → converged; only update on code changes
```

---

## 5. Slash Command & MCP Tool Design

### 5.1 Command: `/sweet-prewarm-vocab`

```
/sweet-prewarm-vocab [options]

Options:
  --full          Full mine + warm (first time or after major changes)
  --incremental   Only mine changed files, warm new terms (default)
  --dry-run       Show what would be mined without warming
  --stats         Show current vocabulary statistics + cache hit rates
  --depth light   Fast: file paths + imports + exports only (~2s, 200 terms)
  --depth medium  Standard: + symbols + dependencies + communities (~8s, 1000 terms)
  --depth deep    Full: + comments + strings + git history (~15s, 2000 terms)
  --modes all     Warm all modes (default)
  --modes lexical Warm only FTS5/BM25
  --modes semantic Warm only embedding + HNSW
  --modes hybrid  Warm only full pipeline
  --top N         Warm top N terms (default: 1000)
  --provider P    Override embedding provider (voyage/mistral/jina/local, default: uses EMBEDDING_CONFIG.provider)
  --local-warmup  Force local model for warmup even when remote provider is active (see note below)
```

**`--local-warmup` dimension safety**: When the active provider uses a different dimension than the local model (e.g., Voyage 1024d vs MiniLM 384d), `--local-warmup` embeddings **cannot** be stored in the main vocabulary cache — they would produce dimension mismatches at query time. Behavior: `--local-warmup` warms HNSW traversal paths (the `hnswIndex.search()` calls in §3.5.2 still exercise graph neighborhoods) and primes the FTS5 page cache (dimension-independent), but the generated embeddings are stored in a **separate `local-warmup` cache namespace** that is never consulted at query time. The flag is useful for fast path-warming when you don't need query-time cache hits from the warmup pass.

### 5.2 MCP Tool: `sweet-search/vocab-prewarm`

```json
{
  "name": "sweet-search/vocab-prewarm",
  "description": "Mine the codebase for search terms and warm all search modes",
  "parameters": {
    "depth": { "enum": ["light", "medium", "deep"], "default": "medium" },
    "modes": { "type": "array", "items": { "enum": ["lexical", "semantic", "hybrid"] }, "default": ["lexical", "semantic", "hybrid"] },
    "top": { "type": "integer", "default": 1000 },
    "incremental": { "type": "boolean", "default": true },
    "dryRun": { "type": "boolean", "default": false }
  }
}
```

### 5.3 Integration Points and Three-Tier Timing

**Strict separation of heavy vs. light work:**

| Tier | Trigger | What runs | Time budget (local) | Time budget (remote) |
|------|---------|-----------|---------------------|----------------------|
| **Heavy** | Post `/index-codebase` (automatic) | Leiden community detection, phrase extraction, embedding generation, HNSW seeding, persist all artifacts | ~8-30s | ~15-60s |
| **Heavy** | `/sweet-prewarm-vocab --full` (manual) | Same as above | ~8-30s | ~15-60s |
| **Heavy** | `/sweet-prewarm-vocab --incremental` (manual) | Re-run only changed-hash steps | ~3-10s | ~5-20s |
| **Light** | Every session start (`session-preheat.sh`) | Load cached binary, FTS5 MATCH warmup, HNSW traversal with cached embeddings — **no recomputation** | <3s | <3s (no embeddings generated) |
| **Lookup** | Every query | Embedding cache hit check | <1ms | <1ms |

**Key invariant**: Session preheat never generates embeddings. It only reads the pre-computed `.sweet-search/vocab-*.bin` artifacts and runs FTS5/HNSW traversal queries to warm the OS page cache and HNSW entry points. If the artifacts don't exist yet (first run before indexing), session preheat falls back to the current behavior gracefully.

---

## 6. Sub-Agent Strategy (for `--depth deep` or swarm mode)

For maximum coverage on large codebases, the warmup can dispatch parallel sub-agents:

| Agent | Responsibility | Output | Time |
|-------|---------------|--------|------|
| **structure-scout** | File tree, dir names, package manifests | Structural terms + scores | ~1s |
| **symbol-scout** | Imports, exports, class/function names (regex + Tree-sitter) | Symbol terms + scores | ~3s |
| **community-scout** | Leiden detection + c-TF-IDF phrase extraction per community | Community map + phrase seeds | ~2s |
| **content-scout** | Per-community comments, docstrings, string literals, README | NL phrases per community | ~3s |
| **graph-scout** | Code graph entities + PageRank connectivity (if DB exists) | Graph-weighted terms + scores | ~1s |
| **git-scout** | Recent commits, hot files, branch names | Activity-weighted terms + scores | ~2s |

The coordinator merges all scout outputs: union by normalized term key, rank by Stream A/B scoring logic (§3.4), dedup by keeping the highest-scoring source for each term. Deep mode is triggered when repo exceeds 5,000 files or the user passes `--depth deep`.

This is optional — the default path runs all mining in-process sequentially. Sub-agents are for when the user wants maximum coverage on a large codebase.

---

## 7. Cache Hit Rate Monitoring

### 7.1 Per-Mode Metrics

```js
class WarmupMetrics {
  // Track separately for each search mode
  lexical:  { hits: 0, misses: 0, avgLatency: 0 }
  semantic: { hits: 0, misses: 0, avgLatency: 0 }
  hybrid:   { hits: 0, misses: 0, avgLatency: 0 }

  hitRate(mode) { return hits[mode] / (hits[mode] + misses[mode]) }
  overallHitRate() { return totalHits / totalRequests }
}
```

### 7.2 What Constitutes a "Hit"

| Mode | Cache Hit Definition | Measurement |
|------|---------------------|-------------|
| **Lexical** | FTS5 query latency below post-warmup baseline threshold (proxy for OS page cache hit — direct I/O accounting is not portable from userspace) | Latency < 5ms = hit; > 5ms = miss |
| **Semantic** | Query embedding found in vocabulary cache (`source: 'vocabulary'`, no inference at all) or SemanticCache (`source: 'semantic-cache'`, avoids remote API call but still runs local MiniLM inference for the cosine lookup) | `source: 'vocabulary'` or `source: 'semantic-cache'` in embedding result |
| **Hybrid** | Both lexical and semantic paths served from cache | Both sub-mode hits |

### 7.3 Reporting (via `--stats`)

```
Vocabulary Warmup Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Vocabulary size:    1,247 identifiers + 312 community phrases (medium depth)
Communities:        8 detected (Leiden, import-graph-based)
Last warmup:        2 hours ago (incremental, 47 new terms)
Import graph hash:  a3f2b8c1 (up to date)
NL content hash:    d7e91f04 (up to date)

Cache Hit Rates (last 100 queries):
  Lexical:   84.2%  ████████░░ (64/76 queries)
  Semantic:  79.1%  ████████░░ (53/67 queries)
  Hybrid:    81.5%  ████████░░ (44/54 queries)
  Overall:   82.3%  ████████░░ (161/197 queries)

Latency (p50 / p95):
  Lexical:   3ms / 8ms      (target: <10ms)
  Semantic:  12ms / 45ms     (target: <50ms warm)
  Hybrid:    28ms / 89ms     (target: <100ms)

Top 5 Cache Misses (candidates for next warmup):
  1. "UserProfileService" (queried 4x, not in vocab) [lexical]
  2. "handleWebhookEvent" (queried 3x, not in vocab) [lexical]
  3. "database migration local" (NL query, no community phrase match) [semantic]
  4. "src/utils/crypto" (path query) [lexical]
  5. "RATE_LIMIT_EXCEEDED" (error constant) [lexical]

Communities (Leiden):
  community-0: apps/local/** (12 files) — phrases: "local oauth", "device session", "local auth flow"
  community-1: apps/central/** (18 files) — phrases: "central SSO", "token federation", "enterprise auth"
  community-2: frontend/src/** (34 files) — phrases: "login form", "auth context", "session provider"
  ...
```

---

## 8. Success Metrics

| Metric | Current | Target (local provider) | Target (remote provider) | How |
|--------|---------|-------------------------|--------------------------|-----|
| Vocabulary cache hit rate (first 100 queries) | ~20% (generic terms) | **>80%** (target to validate with Step 0 telemetry — Zipf extrapolation, not a guarantee; iterate if actual rate is lower) | **>80%** | Codebase-mined identifiers + community phrases match actual queries |
| Semantic cache hit rate specifically | ~5% (no NL seeds) | **>70%** | **>70%** | Community phrase seeds cover project-specific NL queries |
| First lexical query (warm) | ~6-10ms (FTS5 pages cold) | **<3ms** | **<3ms** | Real MATCH queries prime FTS5 B-tree |
| First semantic query (warm, cached term) | ~150ms (HNSW cold) | **<15ms** | **<15ms** | Precomputed embedding + warmed HNSW paths |
| First hybrid query (warm) | ~200ms (both paths cold) | **<50ms** | **<50ms** | Full pipeline pre-exercised |
| Heavy warmup time (medium, 1000 terms + communities) | N/A | **<15s** | **<30s** | Post-indexing hook (amortized) |
| Light warmup time (session preheat, cache reads only) | N/A | **<3s** | **<3s** | No embedding generation at session start |
| Cold-start reduction | 0% | **65%+** | **65%+** | All components pre-warmed |

**Note**: Post-warmup latency targets are the same regardless of provider — once embeddings are cached, the provider no longer matters. Heavy warmup generation time is the only provider-dependent variable.

---

## 9. Non-Goals (Out of Scope)

- Full AST parsing per-language (too slow, too fragile — regex + Tree-sitter is 90% as good at 10% complexity)
- Training custom embedding models per-codebase (overkill for warmup)
- Replacing the indexing pipeline (warmup complements indexing, doesn't replace it)
- Full multi-language NLP pipelines for comment extraction (lightweight `Intl.Segmenter` + script detection handles non-Latin scripts; see §3.3.5 NL language awareness)
- Real-time re-warmup on every file save (too expensive; incremental triggered by hash change is enough)
- Building a query router (the CatBoost WASM router already handles this at sub-ms)

---

## 10. Implementation Order

0. **Per-mode cache-hit telemetry** — extend `core/embedding-cache.js`
   - Instrument every query with `{ mode, lexicalHit, semanticHit, hybridHit, latencyMs, timestamp }`
   - Current `cacheStats` (line 322) tracks aggregate hits/misses only — add per-mode breakdown
   - Persist to `.sweet-search/query-telemetry.jsonl` (append-only, rotated at 10k lines)
   - This is the measurement baseline that validates the 80% target. Ship before any mining work.

1. **Community detector module** — `core/community-detector.js`
   - Build weighted adjacency from `code-graph.db` relationships (imports=3, calls=1)
   - Leiden algorithm implementation (pure JS, ~200-300 lines; modularity optimization + refinement phase + connectivity guarantee; no external dep required)
   - Output: `{ communities: [{ id, entityIds[], fileIds[] }], graphHash }`
   - Fallback: top-2 directory path grouping when code-graph.db absent

2. **Term extractor module** — `core/vocab-miner.js`
   - Structural miner (file paths, dirs, manifests)
   - Symbol miner (imports/exports, class/function names, Tree-sitter via existing `tree-sitter-provider.js`)
   - Graph miner (code-graph.db entities + PageRank from existing `repo-map.js`)
   - **Community-aware NL miner**: bigram/trigram TF-IDF per community over comments/docs/commits
   - Git miner (commits, hot files, branches — deep mode only)

3. **Term ranker module** — `core/vocab-ranker.js`
   - Stream A: BM25 + PageRank + heuristic multipliers → per-term `warm_mode` classification
   - Stream B: c-TF-IDF across Leiden communities → ranked community phrase seeds
   - Cross-reference: boost community phrases containing high-PageRank entity names
   - Question variant generation for Stream B phrases

4. **Per-mode warmup functions** — extend `core/vocabulary-utils.js`
   - `warmLexical(terms)` — FTS5 MATCH queries + SQLite pragmas, using PageRank-ranked entities
   - `warmSemantic(hubEntities, communityPhrases)` — two-track embedding + HNSW search
   - `warmHybrid(representativeQueries)` — full pipeline, queries derived from community phrase seeds

5. **Slash command** — `.claude/commands/sweet-prewarm-vocab.md`

6. **MCP tool** — Add to `mcp/server.js` as `sweet-search/vocab-prewarm`

7. **Session preheat integration** — Replace static warmup in `session-preheat.sh` with:
   ```js
   // Replace: db.prepare('SELECT count(*) FROM entities_fts WHERE name MATCH "warmup"').get()
   // With: load cached artifacts + FTS5/HNSW traversal warmup (no embedding generation)
   const { warmFromCache } = await import('./core/vocab-warmer.js');
   await warmFromCache({ maxFts5Queries: 50, maxHnswTraversals: 100 });
   ```

8. **Post-indexing hook** — Trigger heavy warmup automatically after `/index-codebase` completes:
   ```js
   const { runFullWarmup } = await import('./core/vocab-warmer.js');
   await runFullWarmup({ depth: 'medium', top: 1000 });
   ```

9. **Metrics + adaptive learning** — `core/warmup-metrics.js`
   - Per-mode hit/miss tracking
   - Community phrase promotion/demotion logic
   - Working set size estimation
   - Stats reporting (including community breakdown)

10. **Sub-agent definitions** — Optional, for `--depth deep` swarm mode

---

## 11. Open Questions

1. **~~Embedding provider flexibility~~** *(Resolved)*: The warmup uses `EMBEDDING_CONFIG.provider` — whatever provider is active (local by default, remote if API keys are configured). The vocabulary cache already invalidates on provider change. No provider-specific code in the warmup path. Dimension handling adapts automatically via `EMBEDDING_CONFIG.dimension` and `EMBEDDING_CONFIG.hnswDimension`.

2. **Leiden pure-JS implementation vs. library**: Leiden is ~200-300 lines (modularity optimization + refinement phase + connectivity guarantee). Implementing it directly avoids a dependency. Alternative: use `graphology` + `graphology-communities-louvain` (Louvain, not Leiden) which is already packaged for JS. Decision: implement Leiden directly for correctness guarantees, or accept Louvain quality as sufficient for code graphs (empirically similar on typical sizes). **Regardless of choice, add a per-community connectivity sanity check** (verify each community's induced subgraph is connected) to catch implementation bugs that could produce disconnected subcommunities and weak phrases.

3. **Community granularity tuning**: Leiden's resolution parameter controls how fine-grained communities are. Too coarse: `apps/local/` and `apps/central/` merge into one. Too fine: single files become their own communities. Proposal: start with resolution=1.0 and validate on a few representative projects; expose as a config option.

4. **~~Community staleness~~** *(Resolved)*: The import graph hash (§3.6) is now a full edge-set sha256 — any structural change triggers re-detection. This is the correct behavior: even a single new import edge can create a new community or merge two existing ones. The cost of re-running Leiden on change is low (~500ms) relative to the cost of stale communities producing irrelevant phrases.

5. **Warmup during first indexing**: `/index-codebase` should automatically trigger medium-depth warmup after indexing completes — the code graph is fresh and the user is about to start searching. This is step 8 in §10.

6. **Remote provider cost/rate considerations**: At 1000 identifiers + 500 community phrases + 1500 question variants (~3000 embeddings), the cost per warmup is roughly: Voyage ~$0.004, Mistral ~$0.002, Jina ~$0.002. The rate limiters in `embedding-service.js` already handle throttling. The `--local-warmup` flag forces local model even when a remote provider is active.

---

## Appendix A: Research Sources

### Developer Search Behavior
- [Google Developer Search Study (Sadowski et al.)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43835.pdf)
- [Sourcegraph Query Analysis](https://arxiv.org/pdf/2212.03459)
- [Damevski et al. Field Study](https://damevski.github.io/files/cst-field-study.pdf)
- [JetBrains Developer Ecosystem 2024](https://www.jetbrains.com/lp/devecosystem-2024/)
- [Stack Overflow Developer Survey 2024](https://survey.stackoverflow.co/2024/)
- [FSE 2025 - Revisiting Developer Search](https://conf.researchr.org/details/fse-2025/fse-2025-research-papers/113)

### Code Search Systems
- [Sourcegraph Zoekt](https://github.com/sourcegraph/zoekt)
- [How Cursor Indexes Codebases](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/)
- [Continue.dev Codebase Embeddings](https://docs.continue.dev/features/codebase-embeddings)
- [CodeRabbit Architecture](https://www.coderabbit.ai/blog/2025-the-year-of-the-ai-dev-tool-tech-stack)
- [Greptile State of AI Coding 2025](https://www.greptile.com/state-of-ai-coding-2025)
- [ZeroEntropy Semantic Code Search](https://www.zeroentropy.dev/articles/semantic-code-search)

### Embedding & Vector Search
- [Voyage-code-3](https://blog.voyageai.com/2024/12/04/voyage-code-3/)
- [Matryoshka Embeddings (HuggingFace)](https://huggingface.co/blog/matryoshka)
- [GoVector Hybrid Caching](https://www.arxiv.org/pdf/2508.15694)
- [StorInfer Precomputation](https://arxiv.org/html/2503.17603v1)
- [DiskANN/Vamana](https://zilliz.com/learn/DiskANN-and-the-Vamana-Algorithm)
- [LoRACode Adapters](https://arxiv.org/pdf/2503.05315)
- [MongoDB Matryoshka + Voyage](https://www.mongodb.com/company/blog/technical/matryoshka-embeddings-smarter-embeddings-with-voyage-ai)

### Hybrid Search & Fusion
- [Microsoft Azure RRF](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking)
- [OpenSearch RRF](https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search/)
- [Weaviate Hybrid Search](https://weaviate.io/blog/hybrid-search-explained)
- [7 Hybrid Search Recipes](https://medium.com/@connect.hashblock/7-hybrid-search-recipes-bm25-vectors-without-lag-467189542bf0)

### Cache Warming & Optimization
- [Redis Cache Hit Ratio Strategy](https://redis.io/blog/why-your-cache-hit-ratio-strategy-needs-an-update/)
- [Netflix Cache Warming](https://netflixtechblog.com/cache-warming-agility-for-a-stateful-service-2d3b1da82642)
- [Elasticsearch Caching Deep Dive](https://www.elastic.co/blog/elasticsearch-caching-deep-dive-boosting-query-speed-one-cache-at-a-time)
- [OpenSearch Performance Innovations](https://opensearch.org/blog/opensearch-3-3-performance-innovations-for-ai-search-solutions/)
- [Milvus Warmup](https://milvus.io/docs/warm-up.md)
- [SparkCo Embedding Caching 2025](https://sparkco.ai/blog/mastering-embedding-caching-advanced-techniques-for-2025)

### SQLite & FTS5
- [SQLite Performance Tuning](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/)
- [FTS5 Structure Internals](https://darksi.de/13.sqlite-fts5-structure/)
- [SQLite mmap Support](https://oldmoe.blog/2024/02/03/turn-on-mmap-support-for-your-sqlite-connections/)
- [SQLite FTS5 Documentation](https://sqlite.org/fts5.html)

### Statistical Foundations
- [Zipf's Law in Term Distributions](https://nlp.stanford.edu/IR-book/html/htmledition/zipfs-law-modeling-the-distribution-of-terms-1.html)
- [Zipf's Law in Code](https://pmc.ncbi.nlm.nih.gov/articles/PMC4176592/)
- [Pareto Principle](https://betterexplained.com/articles/understanding-the-pareto-principle-the-8020-rule/)
- [DVAGen Dynamic Vocabulary](https://arxiv.org/abs/2510.17115)

### Query Intent Classification (No LLM)
- [Search4Code — weak supervision for code search intent](https://arxiv.org/abs/2011.11950)
- [SIGIR 2025 — Weak Supervision vs LLMs for Short Query Intent](https://arxiv.org/html/2504.21398v1)
- [semroute — embedding-based routing without training](https://github.com/HansalShah007/semroute)
- [Intent classification at <1ms with embeddings](https://medium.com/@durgeshrathod.777/intent-classification-in-1ms-how-we-built-a-lightning-fast-classifier-with-embeddings-db76bfb6d964)

### Community Detection & Module Discovery
- [Leiden algorithm paper](https://arxiv.org/abs/1810.08473)
- [Louvain method (predecessor)](https://arxiv.org/abs/0803.0476)
- [BERTopic / c-TF-IDF](https://maartengr.github.io/BERTopic/getting_started/ctfidf/ctfidf.html)
- [graphology JS graph library](https://graphology.github.io/)

### Term Extraction Tools
- [Tree-sitter](https://github.com/tree-sitter/tree-sitter)
- [Universal-ctags](https://github.com/universal-ctags/ctags)
- [BM25 Algorithm (Elastic)](https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables)
- [PageRank for Code Graphs](https://neo4j.com/docs/graph-data-science/current/algorithms/page-rank/)
- [Code Vocabulary Normalization](https://www.researchgate.net/publication/224198190_Normalizing_Source_Code_Vocabulary)

### Production Vector Databases
- [Pinecone Best Practices](https://docs.pinecone.io/troubleshooting/best-practices)
- [Weaviate Resource Management](https://docs.weaviate.io/weaviate/starter-guides/managing-resources)
- [Qdrant Storage & Optimization](https://qdrant.tech/documentation/guides/optimize/)
- [Milvus mmap Guide](https://milvus.io/docs/mmap.md)
- [LanceDB Query Optimization](https://docs.lancedb.com/search/optimize-queries)
