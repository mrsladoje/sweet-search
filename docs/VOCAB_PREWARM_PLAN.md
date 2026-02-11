# Vocabulary Prewarm Plan: Codebase-Aware Dynamic Warmup

**Status**: Plan (not yet implemented)
**Date**: 2026-02-11
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
| WASM Query Router (CatBoost) | Yes | JIT warmed in ~6ms |
| **FTS5 page cache** | **No** | Touch query uses "warmup" — zero pages loaded |
| **HNSW traversal paths** | **No** | No actual searches executed during warmup |
| **Hybrid pipeline (fusion)** | **No** | No hybrid queries run |
| **Vocabulary relevance** | **No** | 36 generic terms vs. codebase-specific identifiers |

**Core issue**: The warmup is either generic (preset words) or post-hoc (requires prior indexing + query history). There is no **proactive, codebase-aware** warmup that works on a fresh project from minute one, across all three search modes.

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

**Implication**: Warming the **top 1000-2000 identifiers** from the codebase will cover the vast majority of likely queries.

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
| **Voyage-code-3 + int8 quantization** (SOTA for code, Jan 2026) | +13.8-16.8% vs competitors, 83% cost reduction | [Voyage AI](https://blog.voyageai.com/2024/12/04/voyage-code-3/) |
| **Matryoshka embeddings** | 8.3% of size retains 98.37% of performance | [HuggingFace](https://huggingface.co/blog/matryoshka) |
| **GoVector hybrid caching** | 46% fewer I/O ops, 1.73x throughput | [arXiv 2508.15694](https://www.arxiv.org/pdf/2508.15694) |
| **StorInfer precomputation** | 150K precomputed queries, 17.3% latency reduction | [arXiv 2503.17603](https://arxiv.org/html/2503.17603v1) |
| **DiskANN/Vamana** | Preload entry + multi-hop neighbors, eliminates cold-start | [Zilliz](https://zilliz.com/learn/DiskANN-and-the-Vamana-Algorithm) |
| **OpenSearch warmup API** | Native `/_plugins/_knn/warmup/` endpoint, 65% cold-start reduction | [OpenSearch Docs](https://docs.opensearch.org/2.8/search-plugins/knn/api/) |
| **Milvus explicit warmup** | Per-field warmup config (vectorField, vectorIndex) | [Milvus Docs](https://milvus.io/docs/warm-up.md) |

### 2.5 Hybrid Search Warming

**RRF (Reciprocal Rank Fusion)** is the gold standard for combining BM25 + vector search:
```
RRF_score(d) = Sum[ 1 / (k + rank_in_method_i) ]    k = 60
```

- No tuning required, rank-based (immune to mismatched score scales)
- Both paths MUST be warm independently for hybrid to be fast
- **Optimal effort split**: 60% semantic (higher latency), 40% lexical (simpler)
- Warming only one path leaves the other cold — hybrid latency = max(lexical, semantic)

**Sources**: [Microsoft Azure RRF](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking), [Weaviate Hybrid Search](https://weaviate.io/blog/hybrid-search-explained), [Elasticsearch Caching Deep Dive](https://www.elastic.co/blog/elasticsearch-caching-deep-dive-boosting-query-speed-one-cache-at-a-time)

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

---

## 3. Proposed Architecture

### 3.1 Core Thesis

**The warmup command should itself contain the intelligence to scan any codebase and build a dynamic vocabulary. No preset words. No prior indexing required. All three search modes warmed. Provider-agnostic — works with whatever embedding provider is active (`EMBEDDING_CONFIG.provider`).**

The command becomes a 4-phase pipeline:

```
/sweet-vocab-prewarm
    Phase 1: MINE the codebase (extract terms)        → 1-5s
    Phase 2: RANK terms by importance                  → <1s
    Phase 3: WARM each search mode with ranked terms   → varies by provider (see §3.5)
    Phase 4: PERSIST for incremental updates           → <1s
```

**Note on time budgets**: Phase 3 timing depends heavily on the active embedding provider. Local models (Xenova/all-MiniLM-L6-v2, 384d) generate embeddings at ~50-100ms per batch of 32. Remote APIs (Voyage, Mistral, Jina) add network latency (~200-500ms per batch) but produce higher-dimensional embeddings. All time estimates in this document assume the **local provider** as the default. Remote providers may add 2-3x to semantic warmup times.

### 3.2 Multi-Tier Cache Architecture

```
L1: In-Memory Cache (Hot Data)
├── HNSW index entry points + frequent traversal paths
├── FTS5 B-tree pages for top identifiers
├── Precomputed embeddings for top 500 terms
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

Multiple mining strategies run in parallel, each producing a scored term list. Total budget: **1-5 seconds** depending on depth.

#### 3.3.1 Structural Mining (Fast, ~500ms)

No parsing required. File system + simple regex:

- **File paths**: `src/auth/login-controller.ts` -> `auth`, `login`, `controller`, `LoginController`
- **Directory names**: Top-level dirs reveal the project's domain vocabulary
- **Package manifests**: `package.json`/`Cargo.toml`/`go.mod`/`requirements.txt` -> dependency names (`express`, `prisma`, `tokio`)
- **Config files**: `.env.example` keys, config property names

#### 3.3.2 Symbol Mining (Medium, ~1-3s)

**Hybrid Tree-sitter + regex approach** (research shows they're equal speed at ~1.6s, but Tree-sitter has better accuracy):

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

#### 3.3.3 Code Graph Mining (if available, ~500ms)

If `code-graph.db` exists (from prior `/index-codebase`):

- Entity names from `entities` table (class, interface, method, field)
- Hub detection: entities with high in-degree in `relationships` table
- Leaf entities (rarely referenced) get lower weight

This is what `vocabulary-warmup.js` already does, but it becomes one input among many.

#### 3.3.4 Content Mining (Deep mode only, ~2-5s)

- **Comments and docstrings**: Domain terms from natural language
- **String literals**: Error messages, log messages, API paths (`/api/v1/users`)
- **README / docs**: Project-specific terminology

#### 3.3.5 Git Mining (Deep mode only, ~1-3s)

- **Recent commit messages**: What developers talk about = what they search for
- **Frequently changed files**: Hot files have hot vocabulary
- **Branch names**: `feature/oauth2-integration` -> `oauth2`, `integration`

### 3.4 Phase 2: Rank Terms by Importance

Research-backed scoring using **BM25 + PageRank + heuristic weights**.

#### BM25 Configuration for Code
```
BM25(term, file, codebase) = IDF(term) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * |file|/avgFileLen))

k1 = 1.5  (higher saturation — identifiers repeat more than prose)
b  = 0.5  (lower length penalty — file sizes vary widely)
```

#### Heuristic Multipliers

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

#### Combined Scoring
```
final_score = bm25_score * heuristic_multiplier * (1 + pagerank_score)
```

**Output**: Sorted list of `{ term, score, sources[], type }` with configurable cutoff:
- **Light**: top 200 terms (~70% coverage)
- **Medium**: top 1000 terms (~80-85% coverage)
- **Deep**: top 2000 terms (~85-90% coverage)

### 3.5 Phase 3: Warm Each Search Mode

**Key innovation**: Each mode gets warmed differently with the same vocabulary. 60% effort on semantic, 40% on lexical (per research recommendation).

#### 3.5.1 Lexical Warmup (FTS5 / BM25 / Trigram)

**Goal**: Prime SQLite FTS5 page cache and posting lists.

**Strategy**:
1. **SQLite optimization** (once per session):
   ```sql
   PRAGMA mmap_size = 30000000000;
   PRAGMA cache_size = -100000;  -- 100MB (tunable)
   INSERT INTO entities_fts(entities_fts) VALUES('optimize');
   ```
2. **Execute MATCH queries** for top-N entity names from the mined vocabulary:
   ```sql
   SELECT rowid FROM entities_fts WHERE name MATCH ? LIMIT 1;
   ```
3. **Exercise trigram index** (if available) with substring queries
4. **Touch relationship table** to warm join pages:
   ```sql
   SELECT count(*) FROM relationships WHERE source IN (SELECT rowid FROM entities WHERE name = ?);
   ```

**Why this matters**: Forces SQLite to load relevant FTS5 B-tree pages into OS page cache. Current warmup queries use "warmup" — a term that matches nothing. Real terms warm real pages.

**Time budget**: ~1-2s for top 50 MATCH queries.

#### 3.5.2 Semantic Warmup (Embedding + HNSW)

**Goal**: Pre-compute embeddings for likely queries and warm HNSW traversal paths.

**Provider-agnostic design**: All embedding calls go through `generateEmbeddings()` from `embedding-service.js`, which routes to the active provider automatically (`EMBEDDING_CONFIG.provider`). The vocabulary cache already tracks which provider generated the embeddings and **invalidates on provider change** (see `Vocabulary.load()` in `embedding-service.js`). No Voyage-specific or provider-specific code in the warmup path.

**Strategy**:
1. **Generate embeddings** for top-N terms (whole identifiers + split tokens) via `generateEmbeddings()`:
   - Entity names: `AuthService`, `LoginController`
   - Qualified names: `auth.AuthService`, `user.getProfile`
2. **Generate question variant embeddings** for top-M terms:
   - `"what is {X}"`, `"how does {X} work"`, `"where is {X} defined"`
   - Research shows these templates cover the main natural language query patterns
3. **Store in vocabulary cache** (binary format, dimension = `EMBEDDING_CONFIG.hnswDimension`)
4. **Execute HNSW searches** with these embeddings to warm traversal paths:
   ```js
   for (const embedding of topEmbeddings) {
     await hnswIndex.search(embedding, { k: 10 });
   }
   ```
5. **Use Matryoshka multi-resolution** for providers that support it (Voyage, Jina):
   - `EMBEDDING_CONFIG.hnswDimension` for HNSW index (fast traversal, small footprint)
   - `EMBEDDING_CONFIG.dimension` for final reranking (full precision)
   - Local provider (all-MiniLM-L6-v2): 256d HNSW / 384d full — no Matryoshka, but dimensions are already compact

**Why this matters**: DiskANN research shows preloading entry points + neighbors reduces cold-start latency. Running actual searches warms exactly the graph regions users will hit.

**Time budget** (provider-dependent):

| Provider | Batch of 32 | 200 terms (light) | 1000 terms (medium) | Notes |
|----------|-------------|--------------------|-----------------------|-------|
| **Local** (all-MiniLM-L6-v2) | ~50-100ms | **~1-2s** | **~3-5s** | No network overhead, 384d |
| **Voyage** (code-3 / 4) | ~200-400ms | ~3-5s | ~8-15s | Rate limit: 300 req/min |
| **Mistral** (codestral) | ~200-300ms | ~3-5s | ~8-12s | Rate limit: 100 req/min |
| **Jina** (v3) | ~150-300ms | ~2-4s | ~6-10s | Rate limit: 500 req/min |

Question variants (~5x multiplier) are only generated for top-M terms (M = top 50-100), not all N terms, to keep the budget manageable regardless of provider.

#### 3.5.3 Hybrid Warmup (Full Pipeline)

**Goal**: Exercise the entire hybrid pipeline: query router -> parallel lexical+semantic -> fusion.

**Strategy**:
- Select **10-20 representative queries** covering different query types:
  - Identifier queries: `AuthService`, `handleLogin`
  - Natural language queries: `how does authentication work`
  - Path queries: `src/auth/`
  - Mixed queries: `auth service implementation`
- Run full hybrid searches through `sweet-search.js` unified pipeline
- This warms: **query router WASM**, **FTS5 pages**, **embedding model**, **HNSW graph**, **reranker model**, **RRF fusion logic**

**Why this matters**: A cold hybrid query hits every component in sequence. Pre-running 10-20 representative queries eliminates the cold-start cascade. Research shows this can reduce cold-start times by **65%**.

**Time budget** (provider-dependent): ~1-2s with local provider (embedding is fast), ~2-5s with remote providers (network latency per query).

### 3.6 Phase 4: Persist and Track

- Save mined vocabulary to `.sweet-search/vocab-dynamic.json` (or binary `.sweet-search/vocab-dynamic.bin`)
- Include metadata: `{ terms[], scores[], sources[], contentHash, timestamp, depth }`
- Track vocabulary freshness via content hash of source files
- On subsequent runs, only mine changed files (incremental mode)
- Merge with query log mining (existing `vocabulary-utils.js` QueryStats feature)

---

## 4. Adaptive Learning (Post-Warmup Feedback Loop)

The warmup shouldn't be static. Over time, actual query patterns should refine the vocabulary.

### 4.1 Query Log Analysis

The existing `query-vocabulary-stats.json` already tracks per-query frequency. Extend it:

```
On each search:
  1. Record query text + mode (lexical/semantic/hybrid)
  2. Record cache hit/miss for each layer
  3. Every N queries (or daily), analyze:
     - Cache misses → candidate terms to add to warmup
     - Unused warmed terms → candidates to demote
     - Query clusters (semantic similarity) → identify query families
```

### 4.2 Promotion/Demotion Rules

| Condition | Action |
|-----------|--------|
| Query used 3+ times, not in warmup set | **Promote** — add to vocabulary, precompute embedding |
| Warmup term not queried in 7 days | **Demote** — remove from warmup set (keep in cold cache) |
| Cache miss for identifier that exists in code | **Fast-promote** — add immediately (clear gap in mining) |
| Query cluster with 5+ similar queries | **Add centroid** — warm the cluster center embedding |

### 4.3 Working Set Size Tracking

```
WSS(T) = unique query clusters in time window T

If WSS < warmup set size → warmup is well-sized
If WSS > warmup set size → expand warmup (up to 2000 terms max)
If WSS is stable → converged; only update on code changes
```

---

## 5. Slash Command & MCP Tool Design

### 5.1 Command: `/sweet-vocab-prewarm`

```
/sweet-vocab-prewarm [options]

Options:
  --full          Full mine + warm (first time or after major changes)
  --incremental   Only mine changed files, warm new terms (default)
  --dry-run       Show what would be mined without warming
  --stats         Show current vocabulary statistics + cache hit rates
  --depth light   Fast: file paths + imports + exports only (~2s, 200 terms)
  --depth medium  Standard: + symbols + dependencies (~5s, 1000 terms)
  --depth deep    Full: + comments + strings + git history (~15s, 2000 terms)
  --modes all     Warm all modes (default)
  --modes lexical Warm only FTS5/BM25
  --modes semantic Warm only embedding + HNSW
  --modes hybrid  Warm only full pipeline
  --top N         Warm top N terms (default: 1000)
  --provider P    Override embedding provider (voyage/mistral/jina/local, default: uses EMBEDDING_CONFIG.provider)
  --local-warmup  Force local model for warmup even when remote provider is active (faster warmup)
```

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

### 5.3 Integration Points

| Integration | When | Depth | Time Budget (local) | Time Budget (remote) |
|-------------|------|-------|---------------------|----------------------|
| **Session preheat** (`session-preheat.sh`) | Every session start | `light` (200 terms) | <3s | <5s |
| **Post-indexing hook** (after `/index-codebase`) | After full index | `medium` (1000 terms) | <8s | <15s |
| **On-demand** (`/sweet-vocab-prewarm`) | User-triggered | `deep` (2000 terms) | <15s | <30s |
| **MCP tool** (programmatic) | API consumers | Configurable | Configurable | Configurable |

---

## 6. Sub-Agent Strategy (for `--depth deep` or swarm mode)

For maximum coverage on large codebases, the warmup can dispatch parallel sub-agents:

| Agent | Responsibility | Output | Time |
|-------|---------------|--------|------|
| **structure-scout** | File tree, dir names, package manifests | Structural terms + scores | ~1s |
| **symbol-scout** | Imports, exports, class/function names (regex + Tree-sitter) | Symbol terms + scores | ~3s |
| **content-scout** | Comments, docstrings, string literals, README | NL terms + scores | ~3s |
| **graph-scout** | Code graph entities + connectivity (if DB exists) | Graph-weighted terms + scores | ~1s |
| **git-scout** | Recent commits, hot files, branch names | Activity-weighted terms + scores | ~2s |

The coordinator merges all term lists, deduplicates, applies ranking weights, and feeds the result to Phase 3.

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

| Mode | Cache Hit Definition |
|------|---------------------|
| **Lexical** | FTS5 query served from OS page cache (no disk I/O) |
| **Semantic** | Query embedding found in vocabulary cache (no API call or model inference needed) |
| **Hybrid** | Both lexical and semantic paths served from cache |

### 7.3 Reporting (via `--stats`)

```
Vocabulary Warmup Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Vocabulary size:    1,247 terms (medium depth)
Last warmup:        2 hours ago (incremental, 47 new terms)
Content hash:       a3f2b8c1 (up to date)

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
  1. "UserProfileService" (queried 4x, not in vocab)
  2. "handleWebhookEvent" (queried 3x, not in vocab)
  3. "database migration" (NL query, no similar embedding)
  4. "src/utils/crypto" (path query)
  5. "RATE_LIMIT_EXCEEDED" (error constant)
```

---

## 8. Backward Compatibility

- `prewarm-vocab.js` continues to work (falls back to `GENERIC_TERMS` if no codebase mining available)
- `vocabulary-warmup.js` continues to work (entity extraction from code graph)
- `vocabulary-utils.js` binary format is reused (new terms get appended)
- The new system produces the same output format (vocabulary.bin + vocabulary.meta.json)
- Existing query log mining is preserved as an additional input to the term ranker
- New system adds lexical + hybrid warmup without breaking existing semantic warmup

---

## 9. Success Metrics

| Metric | Current | Target (local provider) | Target (remote provider) | How |
|--------|---------|-------------------------|--------------------------|-----|
| Vocabulary cache hit rate (first 100 queries) | ~20% (generic terms) | **>80%** | **>80%** | Codebase-mined terms match actual queries |
| First lexical query (warm) | ~6-10ms (FTS5 pages cold) | **<3ms** | **<3ms** | Real MATCH queries prime FTS5 B-tree |
| First semantic query (warm, cached term) | ~150ms (HNSW cold) | **<15ms** | **<15ms** | Precomputed embedding + warmed HNSW paths |
| First hybrid query (warm) | ~200ms (both paths cold) | **<50ms** | **<50ms** | Full pipeline pre-exercised |
| Warmup time (light, 200 terms) | N/A | **<3s** | **<5s** | Fits in session preheat window |
| Warmup time (medium, 1000 terms) | N/A | **<8s** | **<15s** | Post-indexing hook |
| Warmup time (deep, 2000 terms) | N/A | **<15s** | **<30s** | On-demand / swarm |
| Cold-start reduction | 0% | **65%+** | **65%+** | All components pre-warmed |

**Note**: Post-warmup latency targets (rows 1-4) are the same regardless of provider — once embeddings are cached, the provider no longer matters. Only warmup *generation time* differs. The local provider (Xenova/all-MiniLM-L6-v2) is the default and provides the fastest warmup.

---

## 10. Non-Goals (Out of Scope)

- Full AST parsing per-language (too slow, too fragile — regex + Tree-sitter is 90% as good at 10% complexity)
- Training custom embedding models per-codebase (overkill for warmup)
- Replacing the indexing pipeline (warmup complements indexing, doesn't replace it)
- Multi-language NLP for comment extraction (simple heuristics are sufficient)
- Real-time re-warmup on every file save (too expensive; incremental on session start is enough)

---

## 11. Implementation Order

1. **Term extractor module** — `core/vocab-miner.js`
   - Structural miner (file paths, dirs, manifests)
   - Symbol miner (imports/exports, class/function names, regex + optional Tree-sitter)
   - Graph miner (code-graph.db entities + hub detection)
   - Content miner (comments, strings, README — deep mode only)
   - Git miner (commits, hot files, branches — deep mode only)

2. **Term ranker module** — `core/vocab-ranker.js`
   - BM25 scoring (k1=1.5, b=0.5 for code)
   - PageRank on dependency graph (if code-graph.db exists)
   - Heuristic multipliers (export, cross-file, naming convention)
   - Combined scoring with configurable cutoff

3. **Per-mode warmup functions** — extend `core/vocabulary-utils.js`
   - `warmLexical(terms)` — FTS5 MATCH queries + SQLite pragmas
   - `warmSemantic(terms)` — embedding generation + HNSW search
   - `warmHybrid(terms)` — full pipeline execution with representative queries

4. **Slash command** — `.claude/commands/sweet-vocab-prewarm.md`

5. **MCP tool** — Add to `mcp/server.js` as `sweet-search/vocab-prewarm`

6. **Session preheat integration** — Replace static warmup in `session-preheat.sh` with:
   ```js
   // Replace: db.prepare('SELECT count(*) FROM entities_fts WHERE name MATCH "warmup"').get()
   // With: dynamic vocabulary-driven warmup at light depth
   const { warmAll } = await import('./core/vocab-warmer.js');
   await warmAll({ depth: 'light', top: 200 });
   ```

7. **Metrics + adaptive learning** — `core/warmup-metrics.js`
   - Per-mode hit/miss tracking
   - Promotion/demotion logic
   - Working set size estimation
   - Stats reporting

8. **Sub-agent definitions** — Optional, for `--depth deep` swarm mode

---

## 12. Open Questions

1. **Tree-sitter dependency**: Should we bundle Tree-sitter grammars, or make it optional with regex fallback? Tree-sitter adds ~10MB of grammars but provides better accuracy for 100+ languages.

2. **~~Embedding provider flexibility~~** *(Resolved)*: The warmup uses `EMBEDDING_CONFIG.provider` — whatever provider is active (local by default, remote if API keys are configured). The vocabulary cache already invalidates on provider change. No provider-specific code in the warmup path. Dimension handling adapts automatically via `EMBEDDING_CONFIG.dimension` and `EMBEDDING_CONFIG.hnswDimension`.

3. **Warmup during first indexing**: Should `/index-codebase` automatically trigger a medium-depth warmup after indexing completes? Probably yes — the code graph is fresh, and the user's about to start searching.

4. **Cross-session vocabulary persistence**: How long should a vocabulary be considered "fresh"? Proposal: content hash of `package.json` + top-level dir listing. If unchanged, skip re-mining.

5. **Remote provider cost/rate considerations**: When a remote provider is active, warmup generates more API calls. At 1000 terms + 500 question variants (~1500 embeddings), the cost per warmup is roughly: Voyage ~$0.002, Mistral ~$0.001, Jina ~$0.001. The rate limiters in `embedding-service.js` already handle throttling. For users who want fast warmup regardless of their search provider, a `--local-warmup` flag could force warmup to use the local model even when a remote provider is the active search provider (the warmed HNSW paths still benefit from any-provider traversal).

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
