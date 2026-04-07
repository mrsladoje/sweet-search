# Sweet Search Domain Architecture

**Status**: Modular monolith with enforced bounded contexts
**Last updated**: 2026-04-01

---

## Overview

Sweet Search organises its core into 9 bounded contexts under `core/`. Each context owns a
public API barrel (`index.js`), all files that implement that capability, and enforced
dependency direction. Cross-domain imports are checked by `scripts/check-boundaries.js`,
ESLint rules, and CI.

This is a well-enforced **modular monolith**. Domain boundaries are physical (separate
directories, barrel public APIs) and mechanically enforced (CI-blocking checks). Formal port
and adapter abstractions do not yet exist inside domains — that is the next architectural
step (see [Remaining Work](#remaining-work)).

---

## Dependency Direction

```
                     +------------------+
                     |     search/      |  Application layer
                     | (sweet-search.js |  (orchestrates all domains)
                     |  lives here)     |
                     +--------+---------+
                              |
          +-------------------+---------------------+
          |                   |                     |
    +-----v-----+      +-----v------+        +-----v-----+
    |  ranking/  |      |  indexing/  |        |  query/   |
    +-----+-----+      +-----+------+        +-----------+
          |                   |
    +-----v-------------------v------+
    |          embedding/            |
    +-----+--------------------------+
          |
  +-------+------------------------------+
  |       |                              |
+-v------+|+-----------+  +-----------+  |
|vector- ||| vocabulary|  |  graph/   |  |  Mid layer
|store/  |||           |  |           |  |
|(leaf)  |||           |  |           |  |
+--------+|+-----------+  +-----------+  |
          |                              |
    +-----v------------------------------v--+
    |          infrastructure/               |  Support layer
    | (config, DB, ONNX, platform, models)   |  (no domain logic)
    +----------------------------------------+
```

---

## Dependency Matrix

| From | May import | Must NOT import |
|------|-----------|-----------------|
| `search/` | all other domains, infrastructure | -- |
| `ranking/` | embedding, vector-store, infrastructure | search, indexing, query, graph, vocabulary |
| `indexing/` | embedding, vector-store, graph, vocabulary, ranking (1), infrastructure | search, query |
| `query/` | infrastructure, training (2) | search, ranking, indexing, embedding, graph, vocabulary, vector-store |
| `embedding/` | infrastructure | search, ranking, indexing, query, graph, vocabulary, vector-store |
| `vocabulary/` | embedding, graph, infrastructure | search, ranking, indexing, query, vector-store |
| `graph/` | query, ranking, infrastructure | search, indexing, vocabulary, vector-store, embedding (3) |
| `vector-store/` | infrastructure | search, ranking, indexing, query, embedding, graph, vocabulary |
| `infrastructure/` | external packages only | all domain directories |

**Declared exceptions:**

1. **indexing -> ranking**: `indexer-ann.js` builds late-interaction artifacts at index time
   using `late-interaction-index.js` and `late-interaction-model.js`. This is a build-time
   dependency, not query-time coupling. Max 2 import sites; machine-checked.

2. **query -> training**: `query-router-catboost.js` loads a trained model artifact from
   `training/output/`. This is a read-only artifact dependency. Max 2 import sites;
   machine-checked.

3. **graph -> embedding (CLI dynamic only)**: `graph/hcgs-generator.js` may lazy-load
   `embedding/index.js` via dynamic `import()` annotated `// CLI`. Permitted only from
   CLI-invoked code paths. Static imports from graph/ into embedding/ are forbidden.

---

## Barrel Public API

Each domain exposes its public surface through `core/<domain>/index.js`. Consumers outside
the domain import from the barrel, not from internal files.

### Pattern

Barrels use `export *` from internal files with explicit resolution where ESM ambiguity
would occur. Modules with a default export include both `export { default }` and named
re-exports.

```javascript
// Example: core/embedding/index.js
export { default } from './embedding-service.js';
export * from './embedding-service.js';
export * from './embedding-remote.js';
export * from './embedding-local-model.js';
export * from './embedding-cache.js';
// Resolve ESM ambiguity: expandVocabulary exists in both service and cache
export { expandVocabulary } from './embedding-service.js';
```

### Key public exports by domain

| Domain | Key public symbols |
|--------|-------------------|
| `embedding` | `default` (service facade), `generateEmbedding`, `expandVocabulary`, circuit-breaker remotes, LRU cache |
| `indexing` | `indexCodebase`, `IncrementalTracker`, `IncrementalParser`, `ASTChunker`, `MarkdownChunker` |
| `search` | `SweetSearch`, `warmSearch`, `getWarmSearcher`, `startServer`, `runCli` |
| `ranking` | `cascadedScore`, `Reranker`, `LocalReranker`, `LateInteractionIndex`, `applyMMR` |
| `graph` | `GraphSearch`, `GraphExtractor`, `detectCommunities`, `generateHCGS`, repo-map |
| `vocabulary` | `mineAll`, `rankAll`, `warmHybrid`, `runFullWarmup`, `BinaryVocabulary` |
| `query` | `routeQuery`, `detectIntent`, `getIntentBoost`, `classifyIntent`, CatBoost router |
| `vector-store` | `HNSWIndex`, `BinaryHNSWIndex`, `FloatVectorStore`, `SeismicIndex`, WASM distance fns |
| `infrastructure` | config objects, `fetchModel`, ONNX session helpers, `withOnnxMutex`, language registry, `generateWithRetry`, quantization/SIMD |

### `core/config.js` policy

`core/config.js` is a permanent compatibility facade:

```javascript
export * from './infrastructure/config/index.js';
export { default } from './infrastructure/config/index.js';
```

- Code **outside** `core/` (scripts, tests, eval, training, mcp) may import
  from `core/config.js` or `core/infrastructure/config/index.js`.
- Code **inside** `core/` must import from `../infrastructure/config/index.js` directly.

---

## Infrastructure Config Split

The original monolithic `config.js` is split into 9 domain-scoped files under
`core/infrastructure/config/`:

| File | Owns |
|------|------|
| `platform.js` | `PROJECT_ROOT`, `DB_PATHS`, `detectIndexerProfile()`, `MODEL_DELIVERY_CONFIG` |
| `embedding.js` | `EMBEDDING_CONFIG`, provider tiers, rate limits, `getVoyageApiKey`, `getJinaApiKey` |
| `ranking.js` | `CASCADE_CONFIG`, `RERANK_CONFIG`, `LATE_INTERACTION_CONFIG` |
| `search.js` | search modes, `PERFORMANCE_TARGETS`, `AGENTIC_GITIGNORE_ALLOWLIST`, `loadProjectConfig` |
| `indexing.js` | batch sizing, flush intervals |
| `graph.js` | `GRAPH_CONFIG`, `HCGS_CONFIG`, BM25 tuning |
| `vector-store.js` | `HNSW_CONFIG`, `BINARY_HNSW_CONFIG`, `SEISMIC_CONFIG` |
| `translation.js` | `CEREBRAS_CONFIG` (translation config removed; file retained for CEREBRAS LLM config used by graph/HCGS) |
| `index.js` | Re-export facade (backwards-compatible aggregate + default export) |

`config/index.js` re-exports everything from all sub-files. Adding a new config constant
means editing the appropriate sub-file, not a monolith.

---

## Enforcement Mechanisms

### 1. `scripts/check-boundaries.js`

Runs four checks:

| Check | What it catches |
|-------|----------------|
| Forbidden direction | Domain imports that violate the dependency matrix |
| Exception limits | Declared cross-domain exceptions exceeding their max import count |
| Internal barrel bypass | Domain files importing another domain's internal file (warning) |
| External barrel bypass | Scripts, tests, mcp, eval, bin importing domain internals |

Run manually: `node scripts/check-boundaries.js`

### 2. ESLint (`eslint.config.mjs`)

`no-restricted-imports` rules enforce the forbidden dependency directions at the import
statement level. Developers get in-editor feedback before commit.

### 3. CI (`.github/workflows/ci.yml`)

Every push and PR runs: build, lint (ESLint), boundary checks, and full test suite.
Violations exit non-zero and block merge.

### 4. Barrel contract tests

`tests/integration/barrel-contracts.test.js` imports from each `core/<domain>/index.js` and
asserts the expected named exports exist. These fail if a public symbol is silently removed.

### 5. Exception allowlist

Exceptions are explicit in `check-boundaries.js` with bounded counts:

```javascript
const EXCEPTIONS = [
  { from: 'core/indexing/', to: 'ranking/', label: 'indexing → ranking (late-interaction build)', max: 2 },
  // query-router-catboost imports trained model from training/ — declared dependency
  { from: 'core/query/', to: 'training/', label: 'query → training (CatBoost model artifact)', max: 2 },
];
```

Increasing the count requires updating the allowlist, which is visible in code review.

Infrastructure imports from domains are allowlisted separately because infrastructure is a
support layer whose utilities are imported directly for performance and simplicity.

---

## Files at `core/` Root

| File | Reason |
|------|--------|
| `start-server.js` | Rust CLI (`crates/sweet-search-cli/src/main.rs`) hardcodes this path |
| `config.js` | Permanent compatibility facade for external consumers |
| `vectors.db` | Data artifact, not code |

---

## Honest Assessment

What is true:

- Physical layout matches the 9-domain target.
- Dependency direction is enforced mechanically and violations block CI.
- Each domain has a barrel public API that is the normal integration surface.
- Config is split into domain-scoped sub-files with a backward-compatible facade.
- Declared exceptions are bounded and machine-checked.

What is not yet true:

- No formal port interfaces (abstract contracts) inside domains. Coupling to concrete
  implementations (SQLite, ORT, HTTP providers) is direct everywhere.
- Internal cross-domain imports within `core/` bypass barrels (tracked as warnings, not
  blocking). The search composition root (`sweet-search.js`) imports directly from
  internal files across 5 domains.
- 28 files exceed the 500-line target. The largest: `graph-extractor.js` (2304 lines),
  `graph-search.js` (2018 lines), `index-maintainer.mjs` (1674 lines).
- Roughly half of the ~100 non-barrel source modules have no dedicated test file.

---

## Remaining Work

These extend the architecture. The codebase is stable and enforcement is active.

### Phase 6: Ports, adapters, and dependency inversion

Introduce formal port interfaces at the highest-value seams: embedding provider access,
reranking provider access, graph summary generation, and persistence/cache access.
Infrastructure implements adapters for domain-defined contracts. Scope is pragmatic — only
the seams that reduce concrete coupling or improve testability.

### Phase 7: Test coverage gap closure

Add at minimum one test per public-facing barrel export imported by other domains or
consumers. Priority by gap size:

| Domain | Source modules | Tested | Gap |
|--------|---------------|--------|-----|
| infrastructure | 34 | 11 | 23 |
| indexing | 18 | 9 | 9 |
| search | 15 | 9 | 6 |
| vocabulary | 10 | 5 | 5 |
| vector-store | 6 | 2 | 4 |

### Phase 8: Large file decomposition

Split oversized modules along domain seams. Priority targets:
`graph-extractor.js` (2304), `graph-search.js` (2018), `index-maintainer.mjs` (1674).

### Phase 9: Final architecture closure

Re-run verification gates. Remove any remaining stale compatibility stubs. Update this
document to reflect completed hexagonal architecture when ports and adapters are in place.
