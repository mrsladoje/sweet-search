# Vocabulary Prewarm System

The vocabulary prewarm system mines a target codebase for meaningful search terms and pre-warms all three search modes (lexical, semantic, hybrid) with project-specific vocabulary. It replaces the old hardcoded 36-term warmup with a pipeline that extracts real identifiers, discovers code communities via the Leiden algorithm, and generates NL concept phrases from each community's own language.

---

## Architecture Overview

The system is a 4-phase pipeline:

```
Mine → Rank → Warm → Persist
```

Each phase is implemented as an independent module. The orchestrator (`vocab-warmup-orchestrator.js`) ties them together.

### Three-Tier Timing Model

| Tier | When | What runs | Budget |
|------|------|-----------|--------|
| **Heavy** | Post-indexing or manual `/sweet-prewarm-vocab` | Full pipeline: mine, detect communities, rank, embed, persist | ~8-30s |
| **Light** | Session start (preheat) | Load cached `.bin` artifacts, run FTS5 MATCH + HNSW traversal — no embedding generation | <3s |
| **Lookup** | Every query | Embedding cache hit check | <1ms |

Session preheat never generates embeddings. It reads pre-computed binary artifacts only.

---

## Module Map

```
core/
├── vocab-warmup-orchestrator.js  — Full pipeline: mine → rank → warm → persist
├── vocab-warmer.js               — Per-mode warmup functions + warmFromCache (light tier)
├── vocab-constants.js            — Shared paths (ARTIFACT_PATHS, DATA_DIR)
├── vocab-miner.js                — Barrel: merges all miners via mineAll()
│   ├── vocab-miner-utils.js      — splitIdentifier, STOP_WORDS, addTerm, walkShallow
│   ├── vocab-miner-extractors.js — Language-specific import/export/definition extractors
│   └── vocab-miner-nl.js         — Community-aware NL mining, secret detection, c-TF-IDF
├── vocab-ranker.js               — BM25 + PageRank scoring, warm_mode classification
├── community-detector.js         — Leiden graph API + directory fallback
│   └── leiden-algorithm.js       — Canonical Traag et al. 2019 implementation (547 lines)
├── warmup-metrics.js             — Per-mode hit rates, promotion/demotion, stats report
└── embedding-telemetry.js        — Per-query telemetry (JSONL append, buffered flush)
```

### Persisted Artifacts

All artifacts live in `.sweet-search/`:

| File | Contents |
|------|----------|
| `vocab-identifiers.bin` + `.meta.json` | Binary Float32Array embeddings for hub entities (SSWV format) |
| `vocab-semantic-seeds.bin` + `.meta.json` | Binary embeddings for community phrases + question variants |
| `communities.json` | Leiden community map with `graphHash`, `nlHash`, per-community `phrases[]`, `topEntities[]` |
| `vocab-dynamic.json` | Full ranked term list with scores, sources, warm_mode |
| `query-telemetry.jsonl` | Per-query telemetry (mode, hit, latency, source). Rotated at 10K lines |

Binary format: 32-byte header (`SSWV` magic + version + dimension + count + padding), followed by `count * dimension * 4` bytes of Float32 embeddings.

---

## Phase 1: Mining (`vocab-miner.js`)

Five miners run in sequence via `mineAll()`. Each returns `{ terms: [{ term, score, source }] }`.

### 1. Structural Mining
Extracts terms from file paths, directory names, package manifests (`package.json`, `Cargo.toml`, `go.mod`, `requirements.txt`, `pyproject.toml`), and `.env.example` keys. Walks 3 directory levels. No parsing required.

### 2. Symbol Mining
Regex-based extraction of imports, exports, class/function/method definitions, and SCREAMING_SNAKE constants from source files. Processes up to 500 files (configurable), max 100KB each.

### 3. Code Graph Mining
Reads entities from `code-graph.db`, runs PageRank via `repo-map.js`, and weights terms by graph importance. Hub entities (high in-degree) get boosted, leaf entities get penalized.

### 4. Community NL Mining (requires code-graph.db)
After Leiden detection (Phase 1.5 below), extracts NL text (comments, docstrings, commit messages, string literals) per community. Runs bigram/trigram TF-IDF, then c-TF-IDF across communities to find phrases distinctive to each community. CJK/non-Latin scripts use `Intl.Segmenter` for word boundaries (detected via Unicode script sampling).

Secret redaction: phrases matching `sk-*`, `ghp_*`, `Bearer *`, `token=*`, `password=*`, and long base64 blobs are filtered, unless the term also appears as a code graph entity name.

### 5. Git Mining (deep mode only)
Extracts terms from the last 200 commits / 30 days, branch names, and frequently changed files. Bounded by `git log --max-count=200`.

### Community Detection (between steps 3 and 4)

`community-detector.js` builds a weighted adjacency graph from `code-graph.db` relationships and runs the Leiden algorithm:

- **Edge weights**: imports/extends/implements = 3, calls/uses = 1
- **Algorithm**: Leiden (Traag et al. 2019) — guarantees well-connected communities
- **Fallback**: top-2 directory grouping when code-graph.db is absent
- **Hard cutoffs**: >50K entities or >200K relationships falls back to directory grouping; >2s wall-clock aborts with partial results (`stale: true`)
- **Connectivity sanity check**: each community's induced subgraph is verified connected via BFS; disconnected subcommunities are split into separate communities

The Leiden implementation (`leiden-algorithm.js`, 547 lines) has 3 phases: local moving (self-loop skip in community weights), constrained singleton-merge refinement, and aggregation with self-loops and fresh-ID initial partition. `_flattenAssignment()` resolves transitive chains.

**Output**: `{ communities: [{ id, entityIds, entityNames, fileIds, entityCount }], graphHash, stale }`

---

## Phase 2: Ranking (`vocab-ranker.js`)

Two parallel scoring streams.

### Stream A: Identifier Ranking

Scores mined terms using BM25 (k1=1.5, b=0.5) combined with heuristic multipliers:

| Signal | Multiplier |
|--------|------------|
| Exports / public API | 3.0x |
| High PageRank (>0.1) | 2.5x |
| File/directory name | 2.0x |
| Cross-file occurrence | 1.5x |
| camelCase/PascalCase identifier | 1.2x |
| Dependency name | 1.0x |
| String literal / error | 0.8x |
| Single occurrence, private | 0.3x |

**Combined score**: `bm25 * heuristic * (1 + pageRankScore)`

Each term gets a `warm_mode` classification (heuristic, no inference):
- `"lexical"` — PascalCase, SCREAMING_SNAKE, snake_case, dotted paths, short code tokens → FTS5 only
- `"semantic"` — NL phrases (3+ tokens, no code tokens) → HNSW only
- `"both"` — high-PageRank hub entities → cache both ways

**Depth cutoffs**: light (200 identifiers), medium (1000), deep (2000).

### Stream B: Community Phrase Ranking

Ranks c-TF-IDF phrases per community, boosts phrases containing high-PageRank entity names. Deduplicates across communities (keeps highest-scoring). Generates question variants per phrase:
- `"how does {phrase} work"`
- `"where is {phrase}"`
- `"what handles {phrase}"`
- `"find {phrase}"`

**Depth cutoffs**: light (100 phrases), medium (500), deep (1000).

---

## Phase 3: Warming (`vocab-warmer.js`)

Three warmup tracks, plus a cache-only light path.

### `warmLexical(terms, dbPath)`
Executes FTS5 MATCH queries against `code-graph.db` using real PageRank-ranked identifiers. Sets SQLite PRAGMAs (`mmap_size`, `cache_size`) and touches relationship table join pages. Terms are FTS5-escaped (double-quoted phrase syntax). Time-budgeted to 2s, processes top 50 terms.

### `warmSemantic(hubEntities, communityPhrases, options)`
Two-track embedding generation:

- **Track A** — hub entity embeddings using enriched text format matching the indexer's `enrichEmbeddingText()` output: `# file_path`, `# Scope: parent > symbol`, `# Defines: type name`, `# Language: ext`. Entity metadata fetched from code-graph.db via `_loadEntityMetadata()` (batched SQL with ROW_NUMBER).
- **Track B** — community phrases + question variants

All embeddings go through `generateEmbeddings()` from `embedding-service.js` (provider-agnostic). HNSW traversal paths are warmed by running `hnswIndex.search()` on each generated embedding.

### `warmHybrid(queries, searcher)`
Runs 10-20 representative queries through the full SweetSearch hybrid pipeline. Queries are selected by community entity count (log2 weighting), one per community, then cross-community fill. Time-budgeted to 30s per query.

### `warmFromCache(options)` (Light Tier)
Session preheat path. Reads binary `.bin` artifacts (no embedding generation), runs FTS5 MATCH for cached identifier names, and traverses HNSW with cached seed embeddings. Handles unaligned `byteOffset` from Buffer pool.

---

## Phase 4: Persistence (`vocab-warmup-orchestrator.js`)

The orchestrator (`runFullWarmup`) ties phases 1-3 together and persists all artifacts.

### Incremental Gating

Two separate hashes control what gets re-run:

- **Graph hash**: sha256 over all `(source_id, target_id, type)` tuples from relationships table. Gates community re-detection.
- **NL content hash**: sha256 of comment text + README + recent commits. Gates phrase re-extraction.

Incremental mode skips steps whose input hash hasn't changed. Both hashes must be unchanged to skip NL mining — if graph hash changed, communities were re-detected and NL content must be re-mined against the new community structure.

---

## Telemetry (`embedding-telemetry.js`)

Every search query records a telemetry event:

```js
{ mode, hit, latencyMs, timestamp, query?, source?, lexicalHit?, semanticHit? }
```

Events are buffered in memory (flush threshold: 50 entries, periodic 30s interval). JSONL file rotated at 10K lines. Shutdown hooks (`beforeExit`, `exit`) flush remaining buffer.

### Cache Hit Definitions

| Mode | Hit condition |
|------|---------------|
| Lexical | FTS5 query latency < 5ms |
| Semantic | Source is `vocabulary` or `semantic-cache` |
| Hybrid | Both lexical AND semantic sub-paths are hits |

---

## Adaptive Learning (`warmup-metrics.js`)

### Promotion Rules

| Condition | Action |
|-----------|--------|
| Query used 3+ times, not in warmup set | **Promote** |
| Cache miss for code identifier | **Fast-promote** |

### Demotion Rules

| Condition | Action |
|-----------|--------|
| Warmup term not queried in 7 days | **Demote** (remove from warmup set, keep in cold cache) |

### Working Set Size

`estimateWorkingSetSize()` uses Jaccard word-set clustering (threshold 0.6) over recent telemetry to estimate unique query clusters. Recommendations: `well-sized` (WSS <= warmup size), `expand` (WSS > warmup size, below max), `converged` (at max 2000).

---

## Integration Points

### MCP Tool: `vocab-prewarm`

Registered in `mcp/server.js`. Parameters:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `depth` | `light\|medium\|deep` | `medium` | Mining depth |
| `modes` | `string[]` | `['lexical','semantic','hybrid']` | Search modes to warm |
| `top` | `int` | `1000` | Number of top terms |
| `incremental` | `bool` | `true` | Only process changes since last warmup |
| `dryRun` | `bool` | `false` | Show what would be mined without warming |
| `stats` | `bool` | `false` | Return current warmup statistics |
| `localWarmup` | `bool` | `false` | Force local model even when remote provider is active |
| `provider` | `string` | (active) | Override embedding provider |

### Session Preheat (`.claude/helpers/session-preheat.sh`)

Calls `warmFromCache({ maxFts5Queries: 50, maxHnswTraversals: 100 })` at session start. Falls back to basic FTS5 touch if `vocab-warmer.js` is not available.

### Post-Indexing Hook

The indexer can call `runFullWarmup({ depth: 'medium', top: 1000 })` after `/index-codebase` completes.

---

## Configuration

Provider-agnostic. All embedding calls go through `generateEmbeddings()` from `embedding-service.js`. The vocabulary cache invalidates on provider change. Dimension handling adapts via `EMBEDDING_CONFIG.dimension` and `EMBEDDING_CONFIG.hnswDimension`.

**`--local-warmup` safety**: When the active provider uses different dimensions than the local model, `--local-warmup` still warms HNSW traversal paths and FTS5 pages (dimension-independent), but generated embeddings are not stored in the main vocabulary cache.

**Matryoshka truncation**: Only applied when the active provider's model was trained with Matryoshka loss (Voyage-code-3, OpenAI v3). Otherwise `hnswDimension` must equal `dimension`.

---

## Error Handling

All warmup failures are non-fatal. Every function catches errors internally and returns timing/stats objects. Silently swallowed errors log to stderr when `DEBUG_CATCHES` env var is set.

Leiden detection, NL mining, and FTS5 queries all have wall-clock time budgets. Exceeding the budget emits partial results rather than failing.

---

## Stats Report (via `--stats`)

`formatStatsReport()` in `warmup-metrics.js` renders:

```
Vocabulary Warmup Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Vocabulary size:    1,247 identifiers + 312 community phrases (medium depth)
Communities:        8 detected (Leiden, import-graph-based)
Last warmup:        2 hours ago (incremental, 47 new terms)
Import graph hash:  a3f2b8c1 (up to date)
NL content hash:    d7e91f04 (up to date)

Cache Hit Rates (last 100 queries):
  Lexical    84.2%  ████████░░ (64/76 queries)
  Semantic   79.1%  ████████░░ (53/67 queries)
  Hybrid     81.5%  ████████░░ (44/54 queries)
  Overall    82.3%  ████████░░ (161/197 queries)

Latency (p50 / p95):
  Lexical    3ms / 8ms
  Semantic   12ms / 45ms
  Hybrid     28ms / 89ms

Top 5 Cache Misses (candidates for next warmup):
  1. "UserProfileService" (queried 4x, not in vocab)
  ...

Communities (Leiden):
  community-0: apps/local/** (12 files) — phrases: "local oauth", "device session"
  community-1: apps/central/** (18 files) — phrases: "central SSO", "token federation"
  ...
```

---

## Testing

- 88 test files, ~2394 tests, 0 failures
- Unit tests: `tests/community-detector.test.js`, `tests/vocab-miner.test.js`, `tests/vocab-ranker.test.js`, `tests/vocab-warmer.test.js`, `tests/warmup-metrics.test.js`, `tests/telemetry.test.js`, `tests/review-fixes.test.js`
- Mock pattern: `_mockDbInstance` module-level var + `vi.fn(function() {})` (not arrow) for constructors
- Prototype-bound methods tested via `tests/helpers/prototype-test-helper.js`
