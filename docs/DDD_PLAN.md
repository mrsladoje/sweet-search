# DDD Restructure Plan (DRAFT — Needs Refinement)

> **Status:** Draft for discussion. Domain boundaries, file assignments, and migration
> order all need review before any code moves.

## Goal

Migrate the flat `core/` directory (72 files) into bounded contexts with explicit
public APIs, enforced dependency direction, and independent testability.

---

## Proposed Domain Structure

```
src/
├── embedding/          # Vector generation & model lifecycle
├── indexing/           # Corpus ingestion & index construction
├── search/             # Query execution & result assembly
├── ranking/            # Scoring, reranking, late interaction
├── graph/              # Code knowledge graph & community detection
├── vocabulary/         # Domain-specific term extraction & warming
├── query/              # Query classification, intent, routing
├── vector-store/       # ANN indices & distance computation
├── shared/             # Config, constants, DB utils, platform detection
└── sweet-search.js     # Composition root / public façade
```

Each domain folder gets an `index.js` that exports only the public API.
Internal files are implementation details — never imported cross-domain directly.

---

## Domain → File Mapping (Tentative)

### `src/embedding/`
| File | Notes |
|------|-------|
| `embedding-service.js` | Orchestrator — likely the domain's public entry |
| `embedding-local-model.js` | Local ONNX inference |
| `embedding-remote.js` | API-based embedding (Voyage, etc.) |
| `embedding-cache.js` | Embedding memoization layer |
| `embedding-telemetry.js` | Latency/throughput tracking |
| `onnx-mutex.js` | Session-level concurrency control |
| `onnx-session-utils.js` | ONNX session helpers |

### `src/indexing/`
| File | Notes |
|------|-------|
| `indexer-build.js` | Main build orchestrator |
| `indexer-phases.js` | Phase management |
| `indexer-ann.js` | ANN index construction |
| `indexer-utils.js` | Shared indexing helpers |
| `index-codebase-v21.js` | Legacy entry — evaluate if still needed |
| `incremental-tracker.js` | Change detection / merkle |
| `incremental-parser.js` | Incremental parse pipeline |
| `index-maintainer.mjs` | **From `.claude/hooks/`** — background daemon |
| `artifact-builder.js` | Index artifact packaging |

### `src/search/`
| File | Notes |
|------|-------|
| `search-semantic.js` | Semantic search path |
| `search-hybrid.js` | Hybrid merge path |
| `search-pattern.js` | Structural/pattern search |
| `search-fusion.js` | Multi-signal fusion |
| `search-boost.js` | Boost rules |
| `search-postprocess.js` | Result post-processing |
| `search-format.js` | Output formatting |
| `search-cli.js` | CLI interface |
| `search-server.js` | HTTP/MCP server |

### `src/ranking/`
| File | Notes |
|------|-------|
| `cascaded-scorer.js` | Multi-stage scoring pipeline |
| `flashrank.js` | FlashRank Stage 1 |
| `local-reranker.js` | ModernBERT INT8 reranker |
| `quality-scorer.js` | Result quality signals |
| `mmr.js` | Maximal Marginal Relevance |
| `late-interaction-model.js` | ColBERT model management |
| `late-interaction-index.js` | ColBERT token-level index |

### `src/graph/`
| File | Notes |
|------|-------|
| `graph-extractor.js` | Entity & relationship extraction |
| `graph-search.js` | Graph query engine |
| `graph-expansion.js` | 2-hop adaptive expansion |
| `relationship-resolver.js` | Cross-file relationship resolution |
| `community-detector.js` | Leiden-based community detection |
| `leiden-algorithm.js` | Leiden algorithm implementation |
| `repo-map.js` | Repository structure mapping |
| `hcgs-generator.js` | Hierarchical code graph summaries |
| `summary-manager.js` | Summary lifecycle |

### `src/vocabulary/`
| File | Notes |
|------|-------|
| `vocab-miner.js` | Main mining orchestrator |
| `vocab-miner-extractors.js` | Identifier/symbol extractors |
| `vocab-miner-nl.js` | Natural language phrase extraction |
| `vocab-miner-utils.js` | Mining helpers |
| `vocab-ranker.js` | PageRank + BM25 term ranking |
| `vocab-warmer.js` | Cache warming engine |
| `vocab-warmup-orchestrator.js` | Warmup coordination |
| `vocabulary-utils.js` | Shared vocab utilities |
| `vocab-constants.js` | Constants |

### `src/query/`
| File | Notes |
|------|-------|
| `query-router.js` | Rule-based router |
| `query-router-ml.js` | ML router |
| `query-router-catboost.js` | CatBoost model router |
| `intent-detector.js` | Intent classification |
| `intent-router.js` | Intent → search mode dispatch |

### `src/vector-store/`
| File | Notes |
|------|-------|
| `hnsw-index.js` | Float32 HNSW |
| `binary-hnsw-index.js` | Binary quantized HNSW |
| `float-vector-store.js` | Raw float vector storage |
| `seismic-index.js` | SEISMIC ANN index |
| `simd-distance.js` | SIMD distance kernels |
| `simd-distance.wasm` | WASM binary |
| `maxsim.wasm` | MaxSim WASM binary |
| `binary-heap.js` | Priority queue for kNN |
| `native-resolver.js` | Native addon resolution |

### `src/shared/`
| File | Notes |
|------|-------|
| `config.js` | **57KB — needs splitting during or after move** |
| `constants.js` | Global constants |
| `db-utils.js` | SQLite helpers |
| `project-detector.js` | Project type detection |
| `tree-sitter-provider.js` | Tree-sitter grammar loading |
| `language-patterns.js` | + `language-patterns/` subdir |

---

## Dependency Direction (Allowed)

```
search, indexing ──→ embedding, ranking, graph, vocabulary, query, vector-store
                 ──→ shared

ranking ──→ embedding, vector-store, shared
graph ──→ shared
vocabulary ──→ graph, shared
query ──→ shared
vector-store ──→ shared
embedding ──→ shared
```

**Forbidden:** circular imports, or lower-level domains reaching up into `search/` or `indexing/`.

---

## What Gets Deleted

- `.claude/commands/` (all 4 — will be remade)
- `.claude/docs/` (all 16 tracked docs — architecture docs will be regenerated)
- `.claude/hooks/index-maintainer.mjs` moves to `src/indexing/`, old path removed

---

## Migration Strategy (Phased)

### Phase 0 — Preparation
- Verify all tests pass on `main`
- Map every cross-file import in `core/` to validate domain assignments
- Identify any files that straddle two domains (split candidates)
- Flag `config.js` sections that belong to specific domains

### Phase 1 — Create structure, move files
- Create `src/` directories
- Move files domain-by-domain (one domain per commit)
- Update all import paths
- Add `index.js` barrel exports per domain
- Move `index-maintainer.mjs` from `.claude/hooks/` → `src/indexing/`

### Phase 2 — Enforce boundaries
- Lint rule: no cross-domain imports except through `index.js`
- Verify dependency direction matches the allowed graph
- Update test imports

### Phase 3 — Clean up
- Split `config.js` into domain-specific configs
- Remove `.claude/commands/` and `.claude/docs/`
- Rebuild slash commands against new structure
- Update `package.json` exports map

---

## Open Questions

1. **`config.js` at 57KB** — split per-domain, or keep a shared config with domain namespaces?
2. **`index-codebase-v21.js`** — is this still the active entry point, or is it superseded by `indexer-build.js`?
3. **`chunking/` subdir** — stays in `indexing/` or becomes its own domain?
4. **`training/` and `translation/` top-level dirs** — fold into domains or leave separate?
5. **Test directory structure** — mirror `src/` domains in `tests/`, or keep flat?
6. **`bin/`, `mcp/`, `eval/`** — these reference `core/` paths; update in Phase 1 or later?
7. **WASM binaries** (`simd-distance.wasm`, `maxsim.wasm`) — keep in `vector-store/` or a separate `wasm/` dir?

---

> **This plan needs refinement.** Domain boundaries are based on file naming patterns,
> not verified import analysis. Before executing, we should trace actual `require()`/`import`
> graphs to confirm groupings and catch files that belong in a different domain than
> their name suggests.
