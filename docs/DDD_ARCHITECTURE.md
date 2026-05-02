# Sweet Search Domain Architecture

**Status**: Modular monolith with enforced bounded contexts
**Last updated**: 2026-04-14

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
   dependency, not query-time coupling. Max 7 import sites; machine-checked (counts both
   static `from` and dynamic `import()` forms). Current sites:
   - `indexer-ann.js:11` → `late-interaction-index.js` (static, `LateInteractionIndex`)
   - `indexer-phases.js:27` → `late-interaction-model.js` (static, runtime configuration)
   - `indexer-ann.js:~658` → `late-interaction-model.js` (dynamic, hybrid CPU+GPU probe)
   - `indexer-ann.js:~697` → `late-interaction-model.js` (dynamic, single-encoder fallback)
   - `indexer-pool.js:~686` → `late-interaction-model.js` (dynamic, `LateInteractionPool` inline fallback)
   - `indexer-worker.js:~98` → `late-interaction-model.js` (dynamic, worker entrypoint)
   - `model-pool.js:~35` → `late-interaction-model.js` (static, GPU↔CPU lifecycle: unload, pipeline, encodeDocumentsCpu for warmup)

   The cap was 2 before 2026-04-15, bumped to 6 when dynamic imports joined the count,
   and to 7 on 2026-04-17 when the `model-pool.js` lifecycle manager landed in
   `core/indexing/`. All 7 sites are indexing → ranking in the build direction and
   are legitimate — the limit tracks reality, not relaxation.

2. **query -> training**: `query-router-catboost.js` loads a trained model artifact from
   `core/training/query-router/output/`. This is a read-only artifact dependency. Max 2
   import sites; machine-checked. `core/training/` is build-time tooling — no barrel
   `index.js`, not a runtime domain.

3. **graph -> embedding (CLI dynamic only)**: `graph/hcgs-generator.js` may lazy-load
   `embedding/index.js` via dynamic `import()` annotated `// CLI`. Permitted only from
   CLI-invoked code paths. Static imports from graph/ into embedding/ are forbidden.

   > **Note (2026-05)**: HCGS is disabled by default (`HCGS_CONFIG.enabled = false`); code retained for future re-evaluation.

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
| `infrastructure` | config objects, `fetchModel`, ONNX session helpers, `withOnnxMutex`, language registry, `generateWithRetry`, quantization/SIMD, hardware capability detection, CoreML variant cascade management |

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

## Infrastructure: Hardware Capability + CoreML Cascade

Two 2026-04-14 additions to `core/infrastructure/` implement hardware-aware
backend selection for the native Rust addon without reaching across domain
boundaries or using env-var bypasses.

### `hardware-capability.js`

Reads `sysctl -n machdep.cpu.brand_string` on darwin and classifies the current
machine's chip family, generation, and variant (e.g., `Apple M3 Max` →
`{ family: 'M3', generation: 3, variant: 'max' }`). Decides which inference
backend the addon should prefer. Cached after first call — hardware doesn't
change at runtime.

Public surface (exposed through `core/infrastructure/index.js`):

- `detectHardwareCapability()` — returns `{ platform, arch, totalMemGB,
  logicalCores, brandString, appleSilicon, coremlCascadeEligible,
  coremlCascadeReason, nvidiaGpu, cudaAddonEnabled, cudaAvailable,
  cudaReason, candleGpuBackend, inferenceBackendPreference }`
- `parseAppleChipBrandString(raw)` — pure function for unit tests
- `parseNvidiaSmiOutput(raw)` — pure function for unit tests
- `_resetHardwareCapabilityCache()` — tests only

`candleGpuBackend` ∈ `{ 'metal', 'cuda', null }` and
`inferenceBackendPreference` ∈ `{ 'coreml-cascade', 'candle-metal',
'candle-cuda', 'candle-cpu' }`. The CUDA branch combines a `nvidia-smi`
probe (installed GPU descriptor) with an addon-side
`Device::new_cuda(0)` probe via the NAPI export `native_cuda_available()`
— both must succeed for `cudaAvailable === true`.

Never throws. Unknown hardware degrades to `candle-cpu` fallback. The module
depends on `node:child_process`, `node:os`, `node:module`, and
`./native-resolver.js` for the addon probe; it does NOT import the
`index.js` barrel, so `scripts/init.js` can consume it without import
cycles.

### `coreml-cascade.js`

Single source of truth for the CoreML variant cascade lifecycle. Owns:

- Cascade shape set (read from `core/infrastructure/coreml-cascade.json`)
- Cache dir resolution (always `MODEL_DELIVERY_CONFIG.modelCacheRoot/coreml-cascade/`)
- `isValidMlpackage(path)` sanity check
- `getCoremlCascadeState()` for read-only inspection
- `getCoremlCascadeResolvedDirs()` for runtime dispatch (returns the
  (embedDir, liDir) pair native-inference.js hands to the Rust addon)
- `getCoremlCascadeReport()` for init's report line + `.sweet-search/config.json`
  diagnostics
- `getAllCoremlCachePaths()` for uninstall's removal list

The module has a hard invariant: **cascade resolution never fails init**. Every
code path — ineligible hardware, missing cache, partial cache, unreadable
directory, `SWEET_SEARCH_COREML_CASCADE=0` opt-out — returns a well-formed
object that describes the situation. The Rust addon treats a null dir as "CoreML
path disabled" and falls through to candle unconditionally.

### Routing contract (no env-var bypass)

Cascade configuration flows **exclusively** through the JS infrastructure layer:

```
scripts/init.js
    ↓ (reads state for diagnostic, optionally invokes build)
core/infrastructure/coreml-cascade.js
    ↓ (resolves (embedDir, liDir))
core/infrastructure/native-inference.js::resolveCoremlCascadeForAddon()
    ↓ (passes as the 3rd/4th argument to load())
crates/sweet-search-native NativeEmbeddingModel::load / NativeLateInteractionModel::load
    ↓ (scans dir, parses filenames, builds variant cascade)
crates/sweet-search-native inference/coreml_embedding.rs::CoremlEmbedding
```

The old spike env vars (`SWEET_SEARCH_COREML_EMBED_MLPACKAGE_DIR`,
`SWEET_SEARCH_COREML_LI_MLPACKAGE_DIR`, `SWEET_SEARCH_INFERENCE_BACKEND=coreml`)
have been removed. Only `SWEET_SEARCH_COREML_CASCADE=0` remains as a diagnostic
opt-out; it is honored by `coreml-cascade.js` and results in a null dir at
the constructor boundary. Init, uninstall, and runtime all read from the same
decision-making function.

### Barrel exports

- `core/infrastructure/index.js` exports the full cascade + capability API.
- `core/embedding/index.js` re-exports `isCoremlCascadeApplicable`,
  `getCoremlCascadeState`, `getCoremlCascadeReport`,
  `getCoremlCascadeResolvedDirs` so consumers that only pull the embedding
  barrel can ask "what inference backend is armed right now?" without
  reaching into infrastructure directly. This respects the embedding →
  infrastructure import direction (allowed per the dependency matrix).

### What this does NOT do

This addition does not introduce new ports or adapters. The cascade module is
a concrete service in the infrastructure layer, matching the rest of
`core/infrastructure/`. Phase 6 (ports, adapters, dependency inversion) may
extract it into a port/adapter pair later if formal dependency inversion is
warranted; until then, direct coupling through barrel imports is the
deliberate, consistent pattern.

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
  // query-router-catboost imports trained model from core/training/query-router/ — declared build-time artifact dependency
  { from: 'core/query/', to: 'training/query-router/', label: 'query → training (CatBoost model artifact)', max: 2 },
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
- 29+ files exceed the 500-line target. The largest: `late-interaction-index.js`
  (2311 lines, +125 lines on 2026-04-15 from the LI staged-save fix), `graph-extractor.js`
  (2304 lines), `graph-search.js` (2018 lines), `index-maintainer.mjs` (1674 lines),
  `artifact-builder.js` (1054 lines), `indexer-ann.js` (951 lines, +48 from the C1 fix),
  `indexer-pool.js` (742 lines, +46 from the DDD-fix pool lifecycle move),
  `indexer-phases.js` (706 lines, +79 from the `atomicSwapLateInteractionIndex` helper),
  `summary-manager.js` (542 lines, NEW breach from the H2 disk-persisted backup).
  The 2026-04-15 P0/P1 fixes landed correctness and DDD compliance first and explicitly
  deferred the file-size decompositions to a follow-up refactor (see
  `docs/reviews/INDEXING_REVIEW_2026-04-14.md` Phase 2 plan).
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
