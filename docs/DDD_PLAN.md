# DDD Migration Plan v2 — Clean Architecture with SOLID Principles

> **Status:** Ready for review. Based on verified import analysis, domain boundary
> tracing, academic research (2023-2026), and full codebase exploration of 81 core files.
>
> **Ruflo Workflow:** `ddd-migration-v2` (adaptive strategy, 9 phases, verification gates)
>
> **Constraint:** Zero functionality loss. Every entry point, test, script, and the
> INIT_PLAN.md packaging contract must work identically after migration.

---

## Executive Summary

Migrate the flat `core/` directory (81 files, 36K LOC) into 9 bounded contexts with
explicit public APIs, enforced dependency direction, and independent testability — while
keeping the app fully functional at every step.

**Architecture:** Hexagonal (Ports & Adapters) inside each domain, Clean Architecture
dependency direction across domains, Strangler Fig migration pattern.

**Academic basis:** Modular Monolith as pragmatic middle ground (Al-Qora'n & Al-Said
Ahmad 2025 SLR); DDD + Strangler Fig as essential migration strategies (Villaca et al.
2024, IEEE); Anti-corruption layers for boundary integrity (Pasunoori 2026).

---

## Design Principles (SOLID Applied)

| Principle | Application |
|-----------|-------------|
| **SRP** | Each bounded context owns exactly one business capability |
| **OCP** | Domain facades (`index.js`) are stable; new adapters extend without modifying |
| **LSP** | All adapters for a port are substitutable (e.g., any EmbeddingAdapter) |
| **ISP** | Domain public APIs export only what consumers need, not internal helpers |
| **DIP** | Domains depend on abstractions (ports); infrastructure implements adapters |

---

## Target Structure

```
core/
├── infrastructure/        # Shared platform services (outermost ring)
│   ├── index.js           # Public API
│   ├── config/            # Split config.js (see Config Strategy below)
│   │   ├── index.js       # Re-export facade (backwards compat during migration)
│   │   ├── embedding.js   # EMBEDDING_CONFIG, provider tiers
│   │   ├── ranking.js     # CASCADE_CONFIG, RERANK_CONFIG, LATE_INTERACTION_CONFIG
│   │   ├── search.js      # Search modes, performance targets
│   │   ├── indexing.js    # Indexer profiles, batch sizing
│   │   ├── graph.js       # GRAPH_CONFIG
│   │   ├── vector-store.js # HNSW_CONFIG, BINARY_HNSW_CONFIG, SEISMIC_CONFIG
│   │   ├── translation.js # TRANSLATION_CONFIG, CEREBRAS_CONFIG
│   │   └── platform.js    # DB_PATHS, PROJECT_ROOT, platform detection
│   ├── db-utils.js
│   ├── onnx-mutex.js
│   ├── onnx-session-utils.js
│   ├── coreml-provider.js
│   ├── native-resolver.js
│   ├── native-tokenizer.js
│   ├── tree-sitter-provider.js
│   ├── constants.js
│   └── language-patterns/
│       ├── registry.js
│       ├── registry-core.js
│       ├── registry-object-oriented.js
│       ├── registry-web-style.js
│       ├── registry-data-query.js
│       ├── registry-tooling.js
│       └── maps.js
│
├── embedding/             # Vector generation & model lifecycle
│   ├── index.js           # Exports: createEmbeddingService, generateEmbedding, etc.
│   ├── embedding-service.js
│   ├── embedding-local-model.js
│   ├── embedding-remote.js
│   ├── embedding-cache.js
│   └── embedding-telemetry.js
│
├── indexing/              # Corpus ingestion & index construction
│   ├── index.js           # Exports: indexCodebase, IncrementalTracker, etc.
│   ├── index-codebase-v21.js
│   ├── indexer-build.js
│   ├── indexer-phases.js
│   ├── indexer-ann.js
│   ├── indexer-utils.js
│   ├── incremental-tracker.js
│   ├── incremental-parser.js
│   ├── artifact-builder.js
│   └── chunking/
│       ├── chunk-builder.js
│       ├── markdown-chunker.js
│       └── plaintext-chunker.js
│
├── search/                # Query execution & result assembly
│   ├── index.js           # Exports: SweetSearch class, search, warmSearch, etc.
│   ├── sweet-search.js    # Composition root (remains here, imports from all domains)
│   ├── search-semantic.js
│   ├── search-hybrid.js
│   ├── search-pattern.js
│   ├── search-fusion.js
│   ├── search-boost.js
│   ├── search-postprocess.js
│   ├── search-format.js
│   ├── search-cli.js
│   └── search-server.js
│
├── ranking/               # Scoring, reranking, late interaction
│   ├── index.js           # Exports: cascadedScore, FlashRankReranker, etc.
│   ├── cascaded-scorer.js
│   ├── flashrank.js
│   ├── local-reranker.js
│   ├── quality-scorer.js
│   ├── mmr.js
│   ├── late-interaction-model.js
│   └── late-interaction-index.js
│
├── graph/                 # Code knowledge graph & community detection
│   ├── index.js           # Exports: GraphSearch, extractGraph, detectCommunities, etc.
│   ├── graph-extractor.js
│   ├── graph-search.js
│   ├── graph-expansion.js
│   ├── relationship-resolver.js
│   ├── community-detector.js
│   ├── leiden-algorithm.js
│   ├── repo-map.js
│   ├── hcgs-generator.js
│   └── summary-manager.js
│
├── vocabulary/            # Domain-specific term extraction & warming
│   ├── index.js           # Exports: mineVocabulary, rankTerms, warmCache, etc.
│   ├── vocab-miner.js
│   ├── vocab-miner-extractors.js
│   ├── vocab-miner-nl.js
│   ├── vocab-miner-utils.js
│   ├── vocab-ranker.js
│   ├── vocab-warmer.js
│   ├── vocab-warmup-orchestrator.js
│   ├── vocabulary-utils.js
│   └── vocab-constants.js
│
├── query/                 # Query classification, intent, routing
│   ├── index.js           # Exports: routeQuery, detectIntent, getIntentBoost, etc.
│   ├── query-router.js
│   ├── query-router-ml.js
│   ├── query-router-catboost.js
│   ├── intent-detector.js
│   └── intent-router.js
│
└── vector-store/          # ANN indices & distance computation
    ├── index.js           # Exports: HNSWIndex, BinaryHNSWIndex, etc.
    ├── hnsw-index.js
    ├── binary-hnsw-index.js
    ├── float-vector-store.js
    ├── seismic-index.js
    ├── simd-distance.js
    ├── simd-distance.wasm
    ├── maxsim.wasm
    └── binary-heap.js
```

### Files That Stay at `core/` Root

These are NOT moved into domains:

| File | Reason |
|------|--------|
| `vectors.db` | Data artifact, not code |
| `start-server.js` | Rust CLI (`sweet-search-cli/src/main.rs:248`) hardcodes `core/start-server.js` — moving it requires rebuilding all native binaries |
| `ort-pipeline.js` | Infrastructure — moves to `infrastructure/` |
| `model-fetcher.js` | Infrastructure — moves to `infrastructure/` |
| `model-registry.js` | Infrastructure — moves to `infrastructure/` |
| `llm-provider.js` | Infrastructure — moves to `infrastructure/` |
| `project-detector.js` | Infrastructure — moves to `infrastructure/` |
| `session-warmup.js` | Search domain — moves to `search/` |
| `warmup-metrics.js` | Search domain — moves to `search/` |
| `merkle-tracker.js` | Indexing domain — moves to `indexing/` |

### Directories That Stay As-Is (NOT Moved)

| Directory | Reason |
|-----------|--------|
| `bin/` | CLI entry point, imports from `core/search/` |
| `mcp/` | MCP server, imports from `core/search/` |
| `scripts/` | Utility scripts, updated imports in Phase 3 |
| `tests/` + `__tests__/` | Test suites, updated imports in Phase 3 |
| `eval/` + `evaluation/` | Benchmarks, updated imports in Phase 3 |
| `training/` | ML training pipeline, stays top-level |
| `translation/` | Translation module, stays top-level |
| `.claude/hooks/` | `index-maintainer.mjs` stays here (it's a hook, not core; does NOT import from core/) |
| `ast-chunker.js` (root) | Listed in `package.json` `files`; imports from `core/`. Updated in Phase 3 (Coder-3) |

---

## Dependency Direction (Enforced)

```
                         ┌──────────────┐
                         │   search/    │  Application Layer
                         │ (sweet-search│  (orchestrates all domains)
                         │  .js lives   │
                         │  here)       │
                         └──────┬───────┘
                                │ depends on ▼
            ┌───────────────────┼───────────────────┐
            │                   │                   │
      ┌─────▼─────┐      ┌─────▼──────┐      ┌─────▼─────┐
      │  ranking/  │      │  indexing/  │      │  query/   │
      │            │      │            │      │           │
      └─────┬─────┘      └─────┬──────┘      └───────────┘
            │                   │               Domain Layer
      ┌─────▼───────────────────▼───────┐
      │          embedding/             │
      └─────┬───────────────────────────┘
            │ depends on ▼
  ┌─────────┼─────────────────────────────┐
  │         │                             │
┌─▼──────┐ ┌▼──────────┐ ┌──────────────┐│
│vector-  │ │vocabulary/│ │   graph/     ││  Mid Layer
│store/   │ │ (→embed,  │ │ (→query,     ││  (cross-domain deps exist)
│ (leaf)  │ │  graph)   │ │  ranking)    ││
└─────────┘ └───────────┘ └──────────────┘│
            │             │              │
      ┌─────▼─────────────▼──────────────▼──┐
      │         infrastructure/              │  Infrastructure Layer
      │  (config, DB, ONNX, platform, etc.)  │  (adapters, no domain logic)
      └─────────────────────────────────────┘
```

### Dependency Rules

| From | May Import | MUST NOT Import |
|------|-----------|-----------------|
| `search/` | ranking, indexing, query, embedding, vector-store, graph, vocabulary, infrastructure | — |
| `ranking/` | embedding, vector-store, infrastructure | search, indexing, query, graph, vocabulary |
| `indexing/` | embedding, vector-store, graph, vocabulary, ranking (late-interaction only), infrastructure | search, query |
| `query/` | infrastructure | search, ranking, indexing, embedding, graph, vocabulary, vector-store |
| `embedding/` | vector-store, infrastructure | search, ranking, indexing, query, graph, vocabulary |
| `vocabulary/` | embedding, graph, infrastructure | search, ranking, indexing, query, vector-store |
| `graph/` | query, ranking, infrastructure | search, indexing, embedding (static; CLI-only dynamic lazy-load permitted), vocabulary, vector-store |
| `vector-store/` | infrastructure | search, ranking, indexing, query, embedding, graph, vocabulary |
| `infrastructure/` | (external only) | ALL domains |

> **Verified against actual imports (2026-03-31, updated 2026-04-01):**
> - `graph-search.js` imports `intent-detector.js` (query/) and `mmr.js` (ranking/) —
>   graph/ is NOT a pure leaf domain.
> - `vocab-warmer.js` imports `embedding-service.js` — vocabulary/ depends on embedding/.
> - `indexer-ann.js` imports `late-interaction-index.js` and `late-interaction-model.js`
>   (ranking/) — indexing MUST build the late interaction index at index time. This is a
>   real build-time dependency, not a query-time coupling. The alternative (moving late
>   interaction to indexing/) would break the ranking domain's coherence.
> - These cross-domain imports are intentional and correct; the matrix above reflects them.

---

## Config Split Strategy

The 1715-line `config.js` is imported by 39 files. It contains 10 distinct config groups.

### Phase 1 Approach: Extract + Re-Export Facade

**Step 1:** Create domain config files that own their constants:

```
core/infrastructure/config/
├── index.js          ← re-exports everything (Strangler Fig facade)
├── platform.js       ← PROJECT_ROOT, DB_PATHS, detectIndexerProfile()
├── embedding.js      ← EMBEDDING_CONFIG, provider tiers, rate limits
├── ranking.js        ← CASCADE_CONFIG, RERANK_CONFIG, LATE_INTERACTION_CONFIG
├── search.js         ← search modes, PERFORMANCE_TARGETS
├── indexing.js       ← batch sizing, flush intervals
├── graph.js          ← GRAPH_CONFIG, BM25 tuning
├── vector-store.js   ← HNSW_CONFIG, BINARY_HNSW_CONFIG, SEISMIC_CONFIG
└── translation.js    ← TRANSLATION_CONFIG, CEREBRAS_CONFIG, HCGS_CONFIG
```

**Step 2:** `config/index.js` re-exports all named exports from all sub-files:

```javascript
// Strangler Fig: all existing imports still work
export * from './platform.js';
export * from './embedding.js';
export * from './ranking.js';
// ... etc
```

**Step 3:** `core/config.js` is a **special case**. It changes in Phase 1, but it cannot be
treated like an ordinary one-line stub because several tests and eval fixtures parse
`core/config.js` as corpus data and depend on that path having meaningful contents.

Keep `core/config.js` as a **real compatibility facade module** at the same path during
migration. It may re-export from `core/infrastructure/config/*`, but it remains real code.

```javascript
// core/config.js (REAL FACADE — not a fake stub)
// This repo is "type": "module" — use ESM syntax only.
export * from './infrastructure/config/index.js';
```

**Step 4 (still in Phase 1):** Immediately after the config split, re-index and refresh the
small set of config-sensitive fixtures before Gate 1:

- `tests/chunk-files.test.js` if chunk expectations change materially
- `eval/data/pattern-benchmark/queries.jsonl` entries that point to `core/config.js:*`
- any benchmark or evaluator snapshots that hardcode `core/config.js` chunk IDs

**Step 5 (Phase 4):** After consumers are updated, either keep `core/config.js` as a real
public aggregator or delete it entirely. Do not leave a fake stub behind.

---

## Strangler Fig Pattern — How It Works Here

The migration uses **re-export stubs** as the strangler fig mechanism:

```
BEFORE:  consumer → core/embedding-service.js
DURING:  consumer → core/embedding-service.js (stub) → core/embedding/embedding-service.js
AFTER:   consumer → core/embedding/ (via index.js)
```

Each moved file leaves behind an ESM re-export stub:

```javascript
// core/embedding-service.js (STUB — remove in Phase 4)
// IMPORTANT: This repo is "type": "module". All stubs MUST use ESM syntax.
export * from './embedding/embedding-service.js';
```

For files that use `export default`, the stub MUST also re-export the default.
`export *` does NOT re-export defaults — missing this silently breaks all
`import X from '...'` calls (the import resolves to `undefined`).

```javascript
// core/flashrank.js (STUB — remove in Phase 4)
export { default } from './ranking/flashrank.js';
export * from './ranking/flashrank.js';
```

### Files Requiring `export { default }` in Stubs

Every file below uses `export default` and its stub MUST include `export { default }`:

| File | Default Export | Domain |
|------|--------------|--------|
| `sweet-search.js` | `SweetSearch` class | search/ |
| `embedding-service.js` | object `{ generateEmbedding, ... }` | embedding/ |
| `flashrank.js` | `Reranker` class | ranking/ |
| `query-router.js` | `QueryRouter` class | query/ |
| `query-router-catboost.js` | object `{ routeQueryCatBoost, ... }` | query/ |
| `graph-extractor.js` | `GraphExtractor` class | graph/ |
| `quality-scorer.js` | `QualityScorer` class | ranking/ |
| `community-detector.js` | object `{ detectCommunities, ... }` | graph/ |
| `repo-map.js` | object `{ pageRank, loadGraph, ... }` | graph/ |
| `mmr.js` | object `{ applyMMR, ... }` | ranking/ |
| `vocab-miner.js` | object `{ mineStructural, ... }` | vocabulary/ |
| `vocab-warmer.js` | object `{ warmVocabulary, ... }` | vocabulary/ |
| `incremental-parser.js` | `IncrementalParser` class | indexing/ |
| `artifact-builder.js` | object `{ buildArtifact, ... }` | indexing/ |
| `relationship-resolver.js` | object `{ resolveRelationshipTargets, ... }` | graph/ |
| `llm-provider.js` | object `{ generateSummary, ... }` | infrastructure/ |
| `onnx-mutex.js` | object `{ withOnnxMutex, ... }` | infrastructure/ |
| `language-patterns.js` | aggregated patterns object | infrastructure/ |
| `chunking/markdown-chunker.js` | `MarkdownChunker` class | indexing/ |
| `chunking/plaintext-chunker.js` | `PlainTextChunker` class | indexing/ |

**Rule for agents:** Before writing any stub, inspect the source file's last lines for
`export default`. If present, the stub MUST include `export { default } from '...';`
in addition to `export * from '...';`.

Verification: stubs are tested with `node --input-type=module -e "import('./core/embedding-service.js')"`,
NOT with `require()`.

This means:
- **Zero breakage** at any point — all existing ESM `import` paths resolve
- **Gradual migration** — consumers update imports at their own pace
- **Easy rollback** — delete domain dir, remove stub, file is back where it was

---

## INIT_PLAN.md Compatibility Contract

The INIT_PLAN.md defines the npm packaging contract. The DDD migration MUST preserve:

| Contract | How We Preserve It |
|----------|-------------------|
| `package.json` `main: "core/sweet-search.js"` | `sweet-search.js` moves to `core/search/sweet-search.js`; stub at old path during transition; `main` updated in Phase 4 to `core/search/sweet-search.js` |
| `package.json` `exports: { ".": "core/sweet-search.js" }` | Updated in Phase 4 alongside `main` |
| `package.json` `exports: { "./mcp": "mcp/server.js" }` | Unchanged — `mcp/` is not moved |
| `package.json` `bin.sweet-search: "bin/sweet-search.js"` | Unchanged — `bin/` is not moved |
| `package.json` `bin.sweet-search-mcp: "mcp/server.js"` | Unchanged — `mcp/` is not moved |
| `package.json` `files` includes `core/` | Still includes `core/` — all code stays under `core/` |
| Native resolution: `core/native-resolver.js` | Moves to `core/infrastructure/native-resolver.js`; stub at old path |
| WASM assets: `core/*.wasm` | Stay at `core/` root until Phase 4; see Hard Runtime Paths section |
| CatBoost router: `training/output/v45_router_d4.js` | Unchanged — `training/` is not moved |
| Model fetcher: `core/model-fetcher.js` | Moves to `core/infrastructure/model-fetcher.js`; stub at old path |
| `@huggingface/transformers` replacement plan | Unaffected — replacement targets move with their domains |

### Verification: `npm pack --dry-run`

Run before and after migration. The set of published files must be a **superset** of
the pre-migration set (new `index.js` barrel files are added; nothing is removed).

---

## Hard Runtime Path Contracts

These files contain **hardcoded `core/` paths** that are NOT JavaScript imports and therefore
are NOT covered by ESM re-export stubs. Each must be explicitly handled:

| File | Hardcoded Path | Type | Migration Strategy |
|------|---------------|------|-------------------|
| `sweet-search-cli/src/main.rs:248-291` | `core/start-server.js` | Rust string literal | **Do not move** `start-server.js`. It stays at `core/` root. |
| `assets/manifest.json:6` | `core/maxsim.wasm` | Asset manifest | **Phase 4:** Update manifest after WASM moves to `core/vector-store/`. Regenerate via `scripts/generate-asset-manifest.js`. |
| `assets/manifest.json:7` | `core/simd-distance.wasm` | Asset manifest | Same as above. |
| `scripts/generate-asset-manifest.js:16-17` | `core/maxsim.wasm`, `core/simd-distance.wasm` | JS string literal | **Phase 4:** Update to `core/vector-store/maxsim.wasm` etc. |
| `package.json:61` | `core/sweet-search.js` | npm `build` script | **Phase 4:** Update to `core/search/sweet-search.js`. |
| `package.json:62` | `../core/maxsim.wasm` | npm `build:wasm` copy target | **Phase 4:** Update the copy destination to `../core/vector-store/maxsim.wasm`. |
| `package.json:65` | `core/sweet-search.js` | npm `search` script | **Phase 4:** Update. |
| `package.json:66-67` | `core/index-codebase-v21.js` | npm `index` scripts | **Phase 4:** Update to `core/indexing/index-codebase-v21.js`. |
| `scripts/bench-batch-size.sh:14` | `core/index-codebase-v21.js` | Shell variable | **Phase 3:** Update. |
| `scripts/benchmark-constrained.sh:30` | `core/index-codebase-v21.js` | Shell variable | **Phase 3:** Update. |
| `scripts/benchmark.js:567` | `../core/index-codebase-v21.js` | JS string literal | **Phase 3:** Update full-index benchmark path to `../core/indexing/index-codebase-v21.js`. |
| `scripts/benchmark.js:617` | `../core/index-codebase-v21.js` | JS string literal | **Phase 3:** Update incremental-index benchmark path to `../core/indexing/index-codebase-v21.js`. |

**During Phases 2A-2D:** WASM files stay at `core/` root. `start-server.js` stays at `core/` root.
npm scripts still reference old paths (stubs resolve them). This is safe.

**In Phase 4:** All hardcoded paths are updated atomically alongside stub removal. The asset
manifest is regenerated. npm scripts are updated. This is the only phase that touches these.

---

## Golden Fixtures & Path-Sensitive Test Data

Several test and evaluation files contain **hardcoded `core/` file paths as data**, not imports.
Moving files changes chunk IDs, golden expected values, and benchmark fixture data.

### Affected Files

| File | What It Contains | Impact |
|------|-----------------|--------|
| `eval/data/pattern-benchmark/queries.jsonl` | `relevant_files: ["core/sweet-search.js"]`, `relevant_chunk_ids: ["core/config.js:893-943:22"]` etc. | ~30 entries reference `core/*.js` paths as golden data |
| `eval/data/pattern-benchmark/manifest.json` | `goldIdFormat: "core/sweet-search.js:88-116:3"` | Format documentation |
| `tests/chunk-files.test.js:7-19` | `chunkFiles(['core/config.js'])`, asserts `chunk.id` matches `core/config.js:*` | Hardcoded test input paths |
| `tests/pattern-evaluator.test.js:32-38` | `relevant_chunk_ids: ['core/sweet-search.js:253-360:10']` | Golden chunk IDs in test |
| `eval/lib/pattern-evaluator.js:200` | Parses gold IDs like `core/sweet-search.js:88-116:3` | Evaluator logic |

### Strategy: Regenerate In Two Waves

1. **Phase 1 special case — immediately after config split:** Re-index and refresh only the
   fixtures that depend on `core/config.js` chunk IDs. This is required because `config.js`
   changes before the rest of the domain moves happen.

2. **During Phases 2A-2D:** Stubs keep moved files at old paths, so non-config chunk IDs
   do not change yet. Tests and benchmarks continue to pass because the indexer still sees
   the old module paths.

3. **Phase 3 — before stub removal:** Re-index the codebase. This regenerates chunk IDs
   with new paths (e.g., `core/search/sweet-search.js:88-116:3`).

4. **Phase 4 (explicit sub-task):** Regenerate the remaining golden fixtures:
   - Run `node eval/run_all.js --regenerate-goldens` (or manual update)
   - Update `queries.jsonl` paths: `core/sweet-search.js` → `core/search/sweet-search.js`
   - Update `tests/chunk-files.test.js` to use a file that didn't move, OR update expected paths
   - Update `tests/pattern-evaluator.test.js` golden IDs

5. **Phase 5:** Verify regenerated goldens produce equivalent eval scores (within tolerance).

> **Key insight:** "Zero functionality loss" means the search engine returns equivalent results
> and passes equivalent tests — NOT that hardcoded file paths in test fixtures remain identical.
> File paths in golden data are metadata about the corpus, not application behavior.

---

## Migration Phases — Parallel Execution Plan

### Ruflo Workflow: `ddd-migration-v2`

```
Phase 0 ──→ Phase 1 ──→ Phase 2A ──→ Phase 2B ──→ Phase 2C ──→ Phase 2D ──→ Phase 2E ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
(baseline)  (infra)     (leaf ∥2)    (embed)      (mid ∥3)     (index)      (search)     (consumers   (cleanup    (final
                        vec+query    sequential   vocab+rank   sequential   sequential    ∥3)          +goldens)   verify)
                                                  +graph
```

---

### Phase 0: Safety Net & Baseline

**Agents:** `tester` + `reviewer` (parallel)
**Duration estimate:** Short
**Commit:** None (read-only)

| Task | Agent | Details |
|------|-------|---------|
| Record test baseline | tester | `npm test -- --run` — record pass count, fail count, skip count |
| Record benchmark baseline | tester | `node eval/run_all.js` — record p50/p95 latency, throughput |
| Verify entry points | tester | CLI (`sweet-search --help`), MCP (`sweet-search-mcp`), warm server |
| Dependency graph snapshot | reviewer | Generate import graph of all `core/` files → `docs/dep-graph-pre.json` |
| Package contents snapshot | reviewer | `npm pack --dry-run 2>&1 > docs/pack-pre.txt` |

#### Verification Gate 0

```
PASS CONDITIONS:
  ✅ Test baseline recorded (pass count, fail count, skip count)
  ✅ Benchmark baseline recorded
  ✅ CLI returns help text
  ✅ MCP server starts without error
  ✅ Dependency graph JSON written
  ✅ Pack dry-run output captured

NOTE: Pre-existing failures in CLI integration tests (cli-flags, flag-semantics,
full-flag), native-launcher, telemetry, and local-reranker are environmental —
they require a compiled Rust binary or running server process. These are recorded
in the baseline and excluded from regression comparison. The migration gate
requires zero NEW failures, not zero total failures.

FAIL → STOP: Do not proceed if any test that passed in the baseline now fails.
```

---

### Phase 1: Infrastructure Foundation

**Agents:** `architect` + `coder` (parallel tasks)
**Duration estimate:** Medium
**Commits:** 1 per sub-task (4-5 commits)

| Task | Agent | Details |
|------|-------|---------|
| Create `core/infrastructure/` | architect | Directory + `index.js` barrel |
| Split `config.js` | coder | 9 domain config files + re-export facade (see Config Strategy) |
| Refresh config-sensitive fixtures | coder | Immediately after config split, re-index and update tests/eval data tied to `core/config.js` chunk IDs |
| Move shared modules | coder | `db-utils`, `onnx-mutex`, `onnx-session-utils`, `coreml-provider`, `native-resolver`, `native-tokenizer`, `tree-sitter-provider`, `constants`, `ort-pipeline`, `model-fetcher`, `model-registry`, `llm-provider`, `project-detector` → `infrastructure/` |
| Move `language-patterns/` | coder | Entire subdirectory → `infrastructure/language-patterns/` |
| Create re-export stubs | coder | One-line stubs at ALL old paths |

#### Verification Gate 1

```
PASS CONDITIONS:
  ✅ npm test -- --run passes (same count as baseline)
  ✅ No import resolution errors (node --check on all entry points)
  ✅ config.js re-export facade works (spot-check 5 config imports)
  ✅ config-sensitive fixtures refreshed after split (`core/config.js` chunk IDs/tests)
  ✅ All stubs resolve correctly
  ✅ npm pack --dry-run includes all infrastructure/ files

FAIL → ROLLBACK: git reset to Phase 0 baseline.
```

---

### Phase 2A: True Leaf Domains (Parallel — 2 agents)

**Agents:** 2x `coder` (parallel — these have zero inbound deps from other domains)
**Duration estimate:** Medium
**Commits:** 1 per domain (2 commits)

> **Why only 2, not 3:** Import analysis shows `graph-search.js` imports `intent-detector.js`
> (query/) and `mmr.js` (ranking/). So graph/ is NOT a leaf — it depends on query/ and
> ranking/. It moves in Phase 2C after those domains exist.

| Agent | Domain | Files to Move |
|-------|--------|---------------|
| Coder-1 | `vector-store/` | `hnsw-index.js`, `binary-hnsw-index.js`, `float-vector-store.js`, `seismic-index.js`, `simd-distance.js`, `binary-heap.js` |
| Coder-2 | `query/` | `query-router.js`, `query-router-ml.js`, `query-router-catboost.js`, `intent-detector.js`, `intent-router.js` |

**WASM files stay at `core/` root** during Phases 2-3 (see Hard Runtime Paths below).
`vector-store/index.js` imports them via `../maxsim.wasm` and `../simd-distance.wasm`.
They move into `vector-store/` only in Phase 4 when asset manifest is also updated.

**Each agent must:**
1. Create `core/{domain}/` directory
2. Move `.js` files into it
3. Create `core/{domain}/index.js` with public API exports (ESM)
4. Create ESM re-export stubs at old `core/{filename}.js` paths
5. Run `npm test -- --run` before committing

#### Verification Gate 2A

```
PASS CONDITIONS:
  ✅ All tests pass
  ✅ Each domain index.js resolves: node --input-type=module -e "import('./core/vector-store/index.js')"
  ✅ Old import paths still work via ESM stubs
  ✅ WASM files still load from core/ root

FAIL → ROLLBACK: Revert the failing domain only; other parallel domain unaffected.
```

---

### Phase 2B: Embedding Domain (Sequential — required before vocabulary and graph)

**Agents:** 1x `coder`
**Duration estimate:** Short-Medium
**Commits:** 1 commit

| Agent | Domain | Files to Move |
|-------|--------|---------------|
| Coder-1 | `embedding/` | `embedding-service.js`, `embedding-local-model.js`, `embedding-remote.js`, `embedding-cache.js`, `embedding-telemetry.js` |

**Why sequential:** Both `vocabulary/` (vocab-warmer.js) and `graph/` (via search paths)
depend on embedding-service.js. Embedding must be moved and stubbed before either can move.

**Critical:** `embedding-cache.js` contains `Vocabulary` class used by vocabulary domain.
During this phase, keep it in `embedding/`. Phase 4 can optionally extract it to `vocabulary/`
if the coupling bothers us — but it's not a blocker.

#### Verification Gate 2B

```
PASS CONDITIONS:
  ✅ All tests pass
  ✅ Embedding service generates embeddings correctly (run embedding test)
  ✅ Old import paths still work via stubs
  ✅ vocab-warmer.js still resolves embedding-service.js (via stub)

FAIL → ROLLBACK: Revert embedding domain.
```

---

### Phase 2C: Mid Domains (Parallel — 3 agents)

**Agents:** 3x `coder` (parallel — these depend on leaf/embedding domains but not each other)
**Duration estimate:** Medium
**Commits:** 1 per domain (3 commits)

> Now safe to parallelize: query/ and embedding/ already moved; stubs in place.

| Agent | Domain | Files to Move |
|-------|--------|---------------|
| Coder-1 | `vocabulary/` | `vocab-miner.js`, `vocab-miner-extractors.js`, `vocab-miner-nl.js`, `vocab-miner-utils.js`, `vocab-ranker.js`, `vocab-warmer.js`, `vocab-warmup-orchestrator.js`, `vocabulary-utils.js`, `vocab-constants.js` |
| Coder-2 | `ranking/` | `cascaded-scorer.js`, `flashrank.js`, `local-reranker.js`, `quality-scorer.js`, `mmr.js`, `late-interaction-model.js`, `late-interaction-index.js` |
| Coder-3 | `graph/` | `graph-extractor.js`, `graph-search.js`, `graph-expansion.js`, `relationship-resolver.js`, `community-detector.js`, `leiden-algorithm.js`, `repo-map.js`, `hcgs-generator.js`, `summary-manager.js` |

#### Verification Gate 2C

```
PASS CONDITIONS:
  ✅ All tests pass
  ✅ Vocabulary mining produces terms (run vocab test)
  ✅ Reranking pipeline functional (cascaded scorer test)
  ✅ Graph search returns FTS5 results
  ✅ graph-search.js → intent-detector (query/) resolves via stub
  ✅ graph-search.js → mmr (ranking/) resolves via stub
  ✅ vocab-warmer.js → embedding-service (embedding/) resolves via stub
  ✅ Old import paths still work via stubs

FAIL → ROLLBACK: Revert the failing domain only.
```

---

### Phase 2D: Indexing Domain (Sequential — depends on embedding, vector-store, graph, vocabulary)

**Agents:** 1x `coder` (sequential — indexing orchestrates multiple lower domains)
**Duration estimate:** Short-Medium
**Commits:** 1 commit

| Agent | Domain | Files to Move |
|-------|--------|---------------|
| Coder-1 | `indexing/` | `index-codebase-v21.js`, `indexer-build.js`, `indexer-phases.js`, `indexer-ann.js`, `indexer-utils.js`, `incremental-tracker.js`, `incremental-parser.js`, `artifact-builder.js`, `merkle-tracker.js`, `chunking/` |

#### Verification Gate 2D

```
PASS CONDITIONS:
  ✅ All tests pass
  ✅ Indexing pipeline functional (incremental indexing test)
  ✅ Chunking produces valid chunks (chunk-files test — still uses stubs)
  ✅ Old import paths still work via stubs

FAIL → ROLLBACK: Revert indexing domain.
```

---

### Phase 2E: Search Domain (Sequential — depends on all below)

**Agents:** 1x `coder` (sequential — this is the composition root)
**Duration estimate:** Medium-Long
**Commits:** 1 commit

| Task | Details |
|------|---------|
| Move search files | `search-semantic.js`, `search-hybrid.js`, `search-pattern.js`, `search-fusion.js`, `search-boost.js`, `search-postprocess.js`, `search-format.js`, `search-cli.js`, `search-server.js`, `session-warmup.js`, `warmup-metrics.js` |
| Move composition root | `sweet-search.js` → `core/search/sweet-search.js` |
| Create search/index.js | Export `SweetSearch`, `warmSearch`, `getWarmSearcher`, `runCli` |
| Update prototype wiring | `sweet-search.js` imports from sibling files (now same directory) |
| Create root stub | `core/sweet-search.js` → re-exports from `core/search/sweet-search.js` |

**This is the highest-risk phase.** `sweet-search.js` imports 26 files spanning ALL domains:

- **7 sibling search-* files** → stay as `./search-semantic.js` (no path change)
- **19 cross-domain imports** → must be rewritten from `./embedding-service.js` to
  `../embedding/embedding-service.js` (or `../embedding/index.js`)

This is NOT a zero-change move. The rewrite scope for `sweet-search.js` includes:

```
./config.js              → ../infrastructure/config/index.js
./local-reranker.js      → ../ranking/local-reranker.js
./query-router.js        → ../query/query-router.js
./graph-search.js        → ../graph/graph-search.js
./constants.js           → ../infrastructure/constants.js
./hnsw-index.js          → ../vector-store/hnsw-index.js
./binary-hnsw-index.js   → ../vector-store/binary-hnsw-index.js
./embedding-service.js   → ../embedding/embedding-service.js
./flashrank.js           → ../ranking/flashrank.js
./late-interaction-index.js → ../ranking/late-interaction-index.js
./float-vector-store.js  → ../vector-store/float-vector-store.js
./embedding-cache.js     → ../embedding/embedding-cache.js
./db-utils.js            → ../infrastructure/db-utils.js
./graph-expansion.js     → ../graph/graph-expansion.js
./mmr.js                 → ../ranking/mmr.js
./quality-scorer.js      → ../ranking/quality-scorer.js
./repo-map.js            → ../graph/repo-map.js
./intent-router.js       → ../query/intent-router.js
../translation/index.js  → ../../translation/index.js  (one more ../)
```

**Mitigation:** During Phases 2A-2C, all these old paths still work via stubs.
The import rewrite happens atomically in this phase. If it fails, stubs still work.

#### Verification Gate 2E

```
PASS CONDITIONS:
  ✅ All tests pass
  ✅ Full search pipeline functional:
     - CLI: sweet-search "test query" returns results
     - MCP: server starts, search tool works
     - Warm server: starts on socket, responds to queries
  ✅ package.json main still resolves (via stub)
  ✅ npm pack --dry-run still includes all files

FAIL → ROLLBACK: Revert entire Phase 2E. This is atomic.
```

---

### Phase 3: Consumer Migration (Parallel — 3 agents)

**Agents:** 3x `coder` (parallel — updating imports in different directories)
**Duration estimate:** Medium
**Commits:** 1 per agent (3 commits)

| Agent | Scope | Details |
|-------|-------|---------|
| Coder-1 | `tests/` + `__tests__/` | Update ~77 test files to import from domain `index.js` files instead of old paths |
| Coder-2 | `scripts/` + `eval/` + `evaluation/` | Update ~48 script/eval files |
| Coder-3 | `translation/` + `training/` + `mcp/` + `bin/` + root `ast-chunker.js` | Update ~27 files |

**Strategy:** Find-and-replace ESM imports: `import { X } from '../core/embedding-service.js'` →
`import { X } from '../core/embedding/index.js'`. The domain `index.js` files export the same
symbols as the individual files did.

#### Verification Gate 3

```
PASS CONDITIONS:
  ✅ All tests pass
  ✅ All scripts run without import errors
  ✅ MCP server starts and handles all 5 tools
  ✅ npx sweet-search init works (INIT_PLAN.md contract)
  ✅ No remaining imports to old stub paths from updated consumers

FAIL → ROLLBACK: Revert the failing agent's changes only.
```

---

### Phase 4: Stub Removal, Hard Paths, Golden Regeneration & Boundary Enforcement

**Agents:** `coder` + `reviewer` + `tester` (parallel where possible)
**Duration estimate:** Medium (this is the point of no return)
**Commits:** 4-5 commits

| Task | Agent | Details |
|------|-------|---------|
| Remove all re-export stubs | coder | Delete ~40 ESM stub files from `core/` root (keep `start-server.js`) |
| Move WASM files to `vector-store/` | coder | `core/maxsim.wasm` → `core/vector-store/maxsim.wasm`, same for `simd-distance.wasm` |
| Update hard runtime paths | coder | `package.json` scripts including `build:wasm`, `scripts/generate-asset-manifest.js`, `scripts/bench-batch-size.sh`, `scripts/benchmark-constrained.sh`, `scripts/benchmark.js` |
| Regenerate asset manifest | coder | Run `node scripts/generate-asset-manifest.js` after path updates |
| Update `package.json` | coder | `main: "core/search/sweet-search.js"`, update `exports`, update `files` |
| Regenerate golden fixtures | tester | Update `eval/data/pattern-benchmark/queries.jsonl` paths, `tests/chunk-files.test.js`, `tests/pattern-evaluator.test.js` |
| Re-index codebase | tester | `node core/indexing/index-codebase-v21.js` to regenerate chunk IDs |
| Add ESLint boundary rules | reviewer | `no-restricted-imports` for cross-domain violations |
| Verify dependency direction | reviewer | Script that checks no domain imports from a higher layer |
| Verify `npm pack --dry-run` | reviewer | Compare to Phase 0 snapshot — must be superset |

#### Verification Gate 4

```
PASS CONDITIONS:
  ✅ All tests pass (with updated golden fixtures)
  ✅ ESLint passes with new boundary rules
  ✅ No dependency direction violations
  ✅ No remaining stub files in core/ root (only start-server.js, config.js facade, + domain dirs)
     Note: config.js is a permanent re-export facade (not a stub). vectors.db is a data
     artifact excluded from npm pack via explicit files[] listing.
  ✅ package.json exports resolve correctly
  ✅ npm pack --dry-run is superset of Phase 0 snapshot
  ✅ assets/manifest.json references correct WASM paths
  ✅ Regenerated eval goldens produce equivalent benchmark scores (±5%)
  ✅ No file path references to deleted stubs anywhere in codebase
  ✅ Rust CLI can still find core/start-server.js

FAIL → ROLLBACK: Re-create stubs, restore WASM files to core/ root, revert
package.json. Golden fixture revert is automatic via git.
```

---

### Phase 5: Final Verification & Regression

**Agents:** `tester` + `reviewer` (parallel)
**Duration estimate:** Short
**Commits:** None (read-only verification)

| Task | Agent | Acceptance Criteria |
|------|-------|-------------------|
| Full test suite | tester | Same pass count as Phase 0 baseline |
| Full benchmark suite | tester | Latency within 5% of Phase 0 baseline |
| CLI end-to-end | tester | `sweet-search "function"` returns results |
| MCP end-to-end | tester | All 5 tools (search, index, health, repoMap, vocabPrewarm) |
| Warm server | tester | Starts on socket, responds <10ms |
| Init flow | tester | `npx sweet-search init` per INIT_PLAN.md |
| Package publishability | reviewer | `npm pack --dry-run` clean, `npm publish --dry-run` clean |
| Dependency graph | reviewer | Generate `docs/dep-graph-post.json`, verify no forbidden edges |
| Architecture diagram | reviewer | Generate updated domain dependency diagram |

#### Final Verification Gate

```
PASS CONDITIONS:
  ✅ Zero NEW test failures vs Phase 0 baseline (pre-existing env failures excluded)
  ✅ Total test count unchanged from baseline
  ✅ Benchmarks within 5% of baseline (no performance regression)
  ✅ CLI search works end-to-end
  ✅ MCP server handles all tools
  ✅ npm pack --dry-run is clean (no workspace-only files)
  ✅ No forbidden dependency edges (per updated matrix with documented exceptions)
  ✅ All 9 domain index.js files export correctly
  ✅ No internal imports through root compatibility facades

KNOWN EXCEPTIONS (pre-existing, not migration regressions):
  - native-launcher, warm-server: require compiled Rust binary
  - cli-flags, flag-semantics, full-flag: CLI subprocess integration tests
  - telemetry: mock initialization ordering issue
  - local-reranker: behavioral assertion mismatch

PASS → MERGE TO MAIN
FAIL → Identify regression, fix, re-verify
```

---

## Rollback Strategy

Every phase is independently rollbackable:

| Phase | Rollback Method |
|-------|----------------|
| Phase 1 | `git revert` infrastructure commits; delete `core/infrastructure/` |
| Phase 2A-2E | `git revert` individual domain commit; delete `core/{domain}/`; stubs gone = files back |
| Phase 3 | `git revert` consumer update commits; old stub paths still work |
| Phase 4 | Re-create stubs from git history; restore WASM to `core/`; revert package.json |

**Key insight:** Because of the Strangler Fig stubs, Phases 2-3 are safe. The stubs mean
both old and new paths work simultaneously. Only Phase 4 (stub removal) is the point of
no return — and by then, all gates have passed.

---

## Agent Specialization & Memory

### Ruflo Agent Assignments

| Agent ID | Type | Domain Memory | Phase | Responsibilities |
|----------|------|---------------|-------|-----------------|
| `arch-ddd` | architect | DDD patterns, SOLID, Clean Architecture | All | Phase planning, boundary review, gate verification, hive mind leader |
| `infra-coder` | coder | Infrastructure patterns, config splitting | 1 | Create infrastructure/, split config.js, move shared modules |
| `leaf-coder-1` | coder | vector-store internals, HNSW, SIMD | 2A | Move vector-store domain |
| `leaf-coder-2` | coder | query routing, CatBoost, intent | 2A | Move query domain |
| `embed-coder` | coder | embedding providers, caching, ONNX | 2B | Move embedding domain (sequential) |
| `mid-coder-1` | coder | vocabulary mining, ranking, warming | 2C | Move vocabulary domain |
| `mid-coder-2` | coder | cascaded scoring, reranking, ColBERT | 2C | Move ranking domain |
| `mid-coder-3` | coder | graph extraction, FTS5, Leiden | 2C | Move graph domain |
| `index-coder` | coder | indexing pipeline, chunking, incremental | 2D | Move indexing domain (sequential) |
| `search-coder` | coder | search pipeline, sweet-search.js composition | 2E | Move search domain, rewrite 19 cross-domain imports |
| `consumer-coder-1` | coder | Test imports, find-replace patterns | 3 | Update tests/ + __tests__/ |
| `consumer-coder-2` | coder | Script/eval imports | 3 | Update scripts/ + eval/ + evaluation/ |
| `consumer-coder-3` | coder | External module imports | 3 | Update translation/ + training/ + mcp/ + bin/ + ast-chunker.js |
| `gate-tester` | tester | Baseline metrics, regression detection | 0,4,5 | Record baselines, verify gates, regenerate goldens |
| `boundary-reviewer` | reviewer | ESLint rules, dep graph, package.json | 4,5 | Boundary enforcement, dep direction check, pack verification |

### Ruflo Execution Commands — Per-Phase Playbook

This section specifies the **exact MCP tool calls** for orchestrating the migration.
Without these, agents won't have shared memory or coordinated consensus.

#### Session Lifecycle

```
START (before Phase 0):
  mcp__ruflo__agentdb_session-start  sessionId="ddd-migration-v2"  context="DDD bounded context migration for sweet-search"
  mcp__ruflo__hive-mind_init         topology="hierarchical"  queenId="arch-ddd"

END (after Phase 5 passes):
  mcp__ruflo__agentdb_session-end    sessionId="ddd-migration-v2"  summary="..."  tasksCompleted=N
  mcp__ruflo__hive-mind_shutdown     graceful=true
```

#### Phase 0 — Baseline Recording

```bash
# Spawn tester + reviewer, join hive
mcp__ruflo__agent_spawn       agentType="tester"   agentId="gate-tester"      model="sonnet"  domain="testing"
mcp__ruflo__agent_spawn       agentType="reviewer"  agentId="boundary-reviewer" model="sonnet"  domain="review"
mcp__ruflo__hive-mind_join    agentId="gate-tester"      role="specialist"
mcp__ruflo__hive-mind_join    agentId="boundary-reviewer" role="specialist"

# After baseline captured, persist to shared memory
mcp__ruflo__hive-mind_memory  action="set"  key="phase0/test-baseline"       value="{passCount, failCount, skipCount}"
mcp__ruflo__hive-mind_memory  action="set"  key="phase0/benchmark-baseline"  value="{p50, p95, throughput}"
mcp__ruflo__hive-mind_memory  action="set"  key="phase0/pack-snapshot"       value="<npm pack --dry-run output>"

# Persist to durable AgentDB (survives session restarts)
mcp__ruflo__agentdb_hierarchical-store  key="ddd/phase0/test-baseline"  value="..."  tier="episodic"
mcp__ruflo__agentdb_hierarchical-store  key="ddd/phase0/pack-snapshot"  value="..."  tier="episodic"
```

#### Phase 1 — Infrastructure (architect + coder, parallel tasks)

```bash
# Spawn Phase 1 workers
mcp__ruflo__hive-mind_spawn  count=1  prefix="infra-coder"  agentType="coder"  role="specialist"

# After config split + moves complete, checkpoint
mcp__ruflo__hive-mind_memory  action="set"  key="phase1/config-split-done"  value="true"
mcp__ruflo__hive-mind_memory  action="set"  key="phase1/stubs-created"     value="{count: 13, files: [...]}"
mcp__ruflo__hive-mind_memory  action="set"  key="phase1/gate-result"       value="PASS"

# Store pattern for future learning
mcp__ruflo__agentdb_pattern-store  pattern="config.js split into 9 ESM domain files with re-export facade"  type="migration-pattern"  confidence=0.95
```

#### Phases 2A, 2C, 3 — Parallel Workers with Consensus Gates

```bash
# Phase 2A: spawn 2 leaf coders in parallel
mcp__ruflo__hive-mind_spawn  count=2  prefix="leaf-coder"  agentType="coder"  role="worker"

# Each worker stores its result to hive memory when done
mcp__ruflo__hive-mind_memory  action="set"  key="phase2a/leaf-coder-1/status"  value="PASS"
mcp__ruflo__hive-mind_memory  action="set"  key="phase2a/leaf-coder-2/status"  value="PASS"

# Leader proposes phase transition via raft consensus
mcp__ruflo__hive-mind_consensus  action="propose"  strategy="raft"  type="phase-gate"  value={"phase": "2A", "gate": "PASS", "testsPassed": true}

# Each worker votes
mcp__ruflo__hive-mind_consensus  action="vote"  strategy="raft"  vote=true  voterId="leaf-coder-1"
mcp__ruflo__hive-mind_consensus  action="vote"  strategy="raft"  vote=true  voterId="leaf-coder-2"

# Check consensus status — must be "committed" before proceeding
mcp__ruflo__hive-mind_consensus  action="status"  strategy="raft"

# Persist gate result durably
mcp__ruflo__agentdb_hierarchical-store  key="ddd/phase2a/gate"  value="PASS - all tests pass, stubs verified"  tier="episodic"
```

Repeat this pattern for Phase 2C (3 workers) and Phase 3 (3 workers).

#### Phases 2B, 2D, 2E — Sequential Workers (No Consensus Needed)

```bash
# Phase 2B: single embed-coder
mcp__ruflo__hive-mind_spawn  count=1  prefix="embed-coder"  agentType="coder"  role="specialist"

# Worker stores result directly
mcp__ruflo__hive-mind_memory  action="set"  key="phase2b/status"  value="PASS"
mcp__ruflo__agentdb_hierarchical-store  key="ddd/phase2b/gate"  value="PASS"  tier="episodic"

# Leader reads and approves — no consensus vote needed for single-agent phases
mcp__ruflo__hive-mind_memory  action="get"  key="phase2b/status"
```

#### Phase 4 — Cleanup (read previous phase data from shared memory)

```bash
# Workers read baseline from Phase 0 to compare
mcp__ruflo__hive-mind_memory  action="get"  key="phase0/pack-snapshot"
mcp__ruflo__hive-mind_memory  action="get"  key="phase0/test-baseline"

# After stub removal + golden regeneration
mcp__ruflo__hive-mind_memory  action="set"  key="phase4/stubs-removed"    value="{count: 40}"
mcp__ruflo__hive-mind_memory  action="set"  key="phase4/goldens-updated"  value="{queriesJsonl: true, chunkTest: true, patternEval: true}"
mcp__ruflo__hive-mind_memory  action="set"  key="phase4/gate-result"      value="PASS"
```

#### Phase 5 — Final Verification (compare against Phase 0 baseline)

```bash
# Read Phase 0 baselines for comparison
mcp__ruflo__hive-mind_memory  action="get"  key="phase0/test-baseline"
mcp__ruflo__hive-mind_memory  action="get"  key="phase0/benchmark-baseline"

# After all checks pass, store final state
mcp__ruflo__agentdb_hierarchical-store  key="ddd/migration-complete"  value="All gates passed. Migration successful."  tier="semantic"

# Store learned patterns for future migrations
mcp__ruflo__agentdb_pattern-store  pattern="ESM re-export stubs with export { default } for safe strangler fig migration"  type="migration-pattern"  confidence=0.98
mcp__ruflo__agentdb_pattern-store  pattern="Parallel domain moves with raft consensus gates prevent drift"  type="coordination-pattern"  confidence=0.95

# End session — triggers NightlyLearner consolidation
mcp__ruflo__agentdb_session-end  sessionId="ddd-migration-v2"  summary="DDD migration complete: 81 files → 9 bounded contexts"  tasksCompleted=10
mcp__ruflo__hive-mind_shutdown   graceful=true
```

#### Memory Namespace Convention

All hive-mind memory keys follow this schema:

```
{phase}/{agent-id}/{field}     — per-agent phase state
{phase}/gate-result            — phase gate pass/fail
{phase}/status                 — single-agent phase status
phase0/*                       — baseline data (read by Phase 4-5)
```

All AgentDB durable keys follow:

```
ddd/{phase}/{field}            — survives session restart
ddd/migration-complete         — final success marker
```

#### Shared Memory Query (Any Agent, Any Phase)

Any agent can recall context from any previous phase:

```bash
# Semantic search across all stored patterns
mcp__ruflo__agentdb_hierarchical-recall  query="config splitting strategy"  tier="episodic"  topK=3

# Search hive memory for specific phase data
mcp__ruflo__hive-mind_memory  action="list"  # lists all keys

# Search learned patterns from this and past migrations
mcp__ruflo__agentdb_pattern-search  query="ESM stub default export"  topK=5
```

---

## What We Explicitly Do NOT Do

| Anti-Pattern | Why We Avoid It |
|--------------|----------------|
| Rename `core/` to `src/` | Breaks every consumer path simultaneously |
| Create abstract interface files | JavaScript duck typing + factories achieve DIP without boilerplate |
| Add an event bus between domains | Synchronous function calls are fine for a monolith |
| Rename any public API methods | Migration is structural, not behavioral |
| Move `training/` or `translation/` into domains | They're satellite tools, not core search domains |
| Split files that don't need splitting for migration | `graph-extractor.js` (2304), `graph-search.js` (2018), `binary-hnsw-index.js` (1003), `flashrank.js` (788), `search-semantic.js` (706) are all over 500 lines — but splitting them is a separate refactor, not a DDD migration task. Only `config.js` splits because it serves multiple domains. |
| Delete `.claude/commands/` or `.claude/docs/` | Separate cleanup, not part of DDD migration |
| Move `index-maintainer.mjs` from `.claude/hooks/` | It's a hook, not a core module |
| Create documentation files | Unless explicitly requested |

---

## Monitoring: Architecture Fitness Functions

After migration, add these to CI:

```javascript
// scripts/check-boundaries.js
// 1. No domain imports from higher layers
// 2. No cross-domain imports bypassing index.js
// 3. No infrastructure/ importing from any domain
// 4. config/ files only imported by their owning domain or infrastructure/
```

```javascript
// ESLint config addition
{
  "rules": {
    "no-restricted-imports": ["error", {
      "patterns": [
        { "group": ["../embedding/*", "!../embedding/index"],
          "message": "Import from domain index, not internals" },
        // ... repeat for each domain
      ]
    }]
  }
}
```

---

## References

### Academic

- Abgaz et al. (2023). "Decomposition of Monolith Applications Into Microservices Architectures: A Systematic Review." *IEEE TSE*. 105 citations.
- Al-Qora'n & Al-Said Ahmad (2025). "Modular Monolith Architecture in Cloud Environments: A Systematic Literature Review." *Future Internet*.
- Villaca et al. (2024). "Strategies for Mitigating Microservice Anti-Patterns in the Pre-Migration Phase." *ERES 2024*.
- Pasunoori (2026). "Legacy Core Modernization via Strangler-Fig with Micro Frontends." *IJCESEN*.
- Fritzsch et al. (2023). "Towards an Architecture-Centric Methodology for Migrating to Microservices." *Springer LNBIP*.
- Li et al. (2020). "Microservice Migration Using Strangler Fig Pattern: A Case Study." *IEEE ICS*. 17 citations.

### Practitioner

- Martin, R.C. (2012). "The Clean Architecture." *Clean Coder Blog*.
- Cockburn, A. (2005). "Hexagonal Architecture (Ports and Adapters)."
- Evans, E. (2003). *Domain-Driven Design: Tackling Complexity in the Heart of Software.*
- AWS Prescriptive Guidance. "Strangler Fig Pattern."
- Ploeh Blog (2024). "Keeping Cross-Cutting Concerns Out of Application Code."
