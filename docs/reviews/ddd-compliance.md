# DDD / Bounded-Context Compliance Review — `core/indexing/`

**Reviewer**: qe-integration-reviewer (parallel swarm)
**Date**: 2026-04-14
**Scope**: `core/indexing/*.js` (excluding `incremental-*.js`, `index-maintainer.mjs`)
**Checker ground truth**: 1 violation, 44 warnings from `node scripts/check-boundaries.js` (run 2026-04-14)

---

## 1. Per-file cross-domain dependency matrix

| File | Import | Target domain | Rule | Barrel? |
|---|---|---|---|---|
| `index.js:7-54` | siblings only | — | ok (barrel) | n/a |
| `index-codebase-v21.js:42` | `../infrastructure/config/index.js` | infra | allowed | yes |
| `index-codebase-v21.js:43` | `../graph/relationship-resolver.js` | graph | allowed | INTERNAL BYPASS |
| `index-codebase-v21.js:44` | `../vector-store/hnsw-index.js` | vector-store | allowed | INTERNAL BYPASS |
| `index-codebase-v21.js:419` (dyn) | `../vocabulary/vocab-warmer.js` | vocabulary | allowed | INTERNAL BYPASS |
| `indexer-phases.js:10` | `../infrastructure/config/index.js` | infra | allowed | yes |
| `indexer-phases.js:12` | `../graph/summary-manager.js` | graph | allowed | INTERNAL BYPASS |
| `indexer-phases.js:18-22` | `../embedding/embedding-local-model.js` | embedding | allowed | INTERNAL BYPASS |
| `indexer-phases.js:23` | `../infrastructure/native-inference.js` | infra | allowed | yes |
| `indexer-phases.js:24-27` | `../ranking/late-interaction-model.js` | ranking | **EXCEPTION (max 2)** | INTERNAL BYPASS |
| `indexer-phases.js:232-233` (dyn) | `../graph/index.js`, `../embedding/index.js` | graph/embedding | allowed | **yes** (barrel!) |
| `indexer-phases.js:376` (dyn) | `../infrastructure/native-inference.js` | infra | allowed | yes |
| `indexer-build.js:11` | `../infrastructure/config/index.js` | infra | allowed | yes |
| `indexer-build.js:12-13` | `../graph/graph-extractor.js`, `../graph/relationship-resolver.js` | graph | allowed | INTERNAL BYPASS |
| `indexer-build.js:14` | `../embedding/embedding-service.js` | embedding | allowed | INTERNAL BYPASS |
| `indexer-build.js:42` (dyn) | `../infrastructure/db-utils.js` | infra | allowed | yes |
| `indexer-ann.js:9` | `../infrastructure/config/index.js` | infra | allowed | yes |
| `indexer-ann.js:10` | `../vector-store/hnsw-index.js` | vector-store | allowed | INTERNAL BYPASS |
| `indexer-ann.js:11` | `../ranking/late-interaction-index.js` | ranking | **EXCEPTION (max 2)** | INTERNAL BYPASS |
| `indexer-ann.js:12` | `../embedding/embedding-service.js` | embedding | allowed | INTERNAL BYPASS |
| `indexer-ann.js:543` (dyn) | `../infrastructure/config/index.js` | infra | allowed | yes |
| `indexer-ann.js:657` (dyn) | `../infrastructure/native-inference.js` | infra | allowed | yes |
| `indexer-ann.js:658,697` (dyn) | `../ranking/late-interaction-model.js` | ranking | **EXCEPTION (uncounted)** | INTERNAL BYPASS |
| `indexer-pool.js:20,22-26` | `../infrastructure/*.js` | infra | allowed | yes |
| `indexer-pool.js:535` (dyn) | `../embedding/embedding-local-model.js` | embedding | allowed | INTERNAL BYPASS |
| `indexer-pool.js:686` (dyn) | `../ranking/late-interaction-model.js` | ranking | **EXCEPTION (uncounted)** | INTERNAL BYPASS |
| `indexer-utils.js:12` | `../infrastructure/config/index.js` | infra | allowed | yes |
| `indexer-worker.js:23-27` (dyn) | `../infrastructure/*`, `../embedding/embedding-local-model.js` | infra/embedding | allowed | INTERNAL BYPASS (embedding) |
| `indexer-worker.js:98` (dyn) | `../ranking/late-interaction-model.js` | ranking | **EXCEPTION (uncounted)** | INTERNAL BYPASS |
| `indexer-sparse-gram.js:5-12` | infra only | infra | allowed | yes |
| `artifact-builder.js:32` | `../infrastructure/config/index.js` | infra | allowed | yes |
| `artifact-builder.js:55,57` | `../vector-store/{binary-hnsw,float-vector-store}.js` | vector-store | allowed | INTERNAL BYPASS |
| `artifact-builder.js:56` | `../infrastructure/quantization.js` | infra | allowed | yes |
| `artifact-builder.js:616,753` (dyn) | `../infrastructure/db-utils.js` | infra | allowed | yes |
| `li-skip-policy.js:31` | `../infrastructure/config/search.js` | infra | allowed | **bypasses config barrel** |
| `ast-chunker.js:14-15` | `../infrastructure/{project-detector,language-patterns}.js` | infra | allowed | yes |
| `ast-chunker.js:85` (dyn) | `../infrastructure/tree-sitter-provider.js` | infra | allowed | yes |
| `document-chunker.js` | siblings only | — | ok | n/a |
| `chunking/chunk-builder.js:7` | `../../infrastructure/project-detector.js` | infra | allowed | yes |
| `chunking/{markdown,plaintext}-chunker.js` | siblings only | — | ok | n/a |

**No forbidden-direction violations FROM `indexing/` itself.** All 9 `indexing → {graph,embedding,ranking,vector-store,vocabulary}` warnings are "INTERNAL BARREL BYPASS" — allowed per the declared matrix, flagged as non-blocking hygiene warnings.

---

## 2. Embedding → Indexing violation (the only hard fail)

**Confirmed violation** at `core/embedding/embedding-local-model.js:359-365`:

```js
export async function initEmbeddingPool(options = {}) {
  if (_embeddingPool) return _embeddingPool;
  const { EmbeddingPool } = await import('../indexing/indexer-pool.js');
  _embeddingPool = new EmbeddingPool(options);
  ...
}
```

`embedding` sits below `indexing` in the dependency matrix (`scripts/check-boundaries.js:27`), so **any** reverse edge is forbidden — the dynamic `await import()` is an escape hatch, not a fix, and the boundary checker correctly flags it.

**Call sites** (`Grep` for `initEmbeddingPool|shutdownEmbeddingPool|getEmbeddingPool`):
- `core/indexing/indexer-phases.js:347` — the only real caller of `initEmbeddingPool(...)`
- `core/indexing/indexer-phases.js:517` — the only real caller of `shutdownEmbeddingPool()`
- `core/embedding/embedding-local-model.js:711` — `getEmbeddingPool()` read at embed time to route batches through the pool
- `core/embedding/embedding-service.js:39-41, 607-609` — pass-through re-exports
- `core/indexing/indexer-pool.js:535` — `_inlineFallback` dynamically imports `embedding-local-model.js::callLocalModel` (the legitimate forward direction)

**Recommended fix: Option (a) — Move pool lifecycle into `indexing/`, leave a slot on the embedding model.**

Concretely:
1. Move `initEmbeddingPool`, `shutdownEmbeddingPool`, `_embeddingPool`, `embedBatchesWithPool`, and the early-return branch at `embedding-local-model.js:711-720` out of the embedding layer.
2. Add a module-local setter on `embedding-local-model.js` — e.g. `setEmbeddingPool(pool) { _embeddingPool = pool }` and `getEmbeddingPool()` stays — that takes an opaque `{ embed(batch, opts) }` port (NOT the `EmbeddingPool` class).
3. In `indexer-phases.js:347` (and `:517`), construct `new EmbeddingPool(...)` directly and call `embedding-local-model.setEmbeddingPool(pool)` before dispatching the embed phase. Null it out on shutdown.

**Why option (a) over (b)/(c)**:
- **(b)** (DI via factory) is equivalent but keeps the pool lifecycle and the `_embeddingPool` module singleton inside embedding, which means embedding still imports/knows about `EmbeddingPool`'s shape. Doesn't reduce coupling.
- **(c)** (port in embedding implemented by indexing) works but requires a new interface file and still leaves the init/shutdown ordering inside embedding, where it has no business — indexing owns the *phase*, which owns the *pool lifetime*.
- **(a)** moves lifetime control to the actual lifecycle owner (`indexer-phases.js`), collapses the re-exports in `embedding-service.js:39-41,607-609`, and replaces a forbidden dynamic `await import('../indexing/...')` with a single collaborator setter call on the legal direction.

**Impact radius**: 1 embedding file, 1 indexing file, a re-export block in `embedding-service.js`. No public API change for external consumers. Boundary checker returns zero violations after the move. No callers of `embedding-service.initEmbeddingPool` exist outside core.

---

## 3. Exception audit — `indexing → ranking (late-interaction build)`

**Allowlist**: `scripts/check-boundaries.js:36` — max 2.
**Checker output**: `OK [indexing → ranking (late-interaction build)]: 2 imports (within limit of 2)`.

**Static imports counted** (the `grep "from '.*ranking/"` at `check-boundaries.js:128`):
1. `core/indexing/indexer-ann.js:11` → `LateInteractionIndex`
2. `core/indexing/indexer-phases.js:27` → `configureLateInteractionRuntime, resetLateInteractionRuntime` from `late-interaction-model.js`

**Dynamic imports NOT counted but still in the indexing → ranking direction**:
3. `core/indexing/indexer-ann.js:658` → `import('../ranking/late-interaction-model.js')` (hybrid probe)
4. `core/indexing/indexer-ann.js:697` → `import('../ranking/late-interaction-model.js')` (single-encoder fallback)
5. `core/indexing/indexer-pool.js:686` → `import('../ranking/late-interaction-model.js')` (LateInteractionPool inline fallback)
6. `core/indexing/indexer-worker.js:98` → `import('../ranking/late-interaction-model.js')` (worker entrypoint)

**Finding**: the allowlist is **accurate for static imports** but **undercounts** reality. The declared limit is 2; actual coupling surface is 6 distinct sites in 4 files. `check-boundaries.js:125-139` does `grep "from '.*ranking"` which only matches ES static imports — dynamic `import()` calls bypass the counter.

**Fix**: extend the EXCEPTION counter on `check-boundaries.js:125-139` to also grep `import\(.*ranking` and treat the sum against a raised `max: 6`, or introduce a `ranking/li-build` sub-barrel and route all 6 through it.

---

## 4. Barrel hygiene — `core/indexing/index.js`

**Missing public symbols (leaking via internal paths)**:
- **`li-skip-policy.js`**: exports `isExcludedByConfig`, `chunkLooksGenerated`, `applyLiSkipPolicy`, `_internals` — zero of these are re-exported. `tests/indexing/li-skip-policy.test.js:3-7` bypasses the barrel.
- **`indexer-pool.js`**: exports `EmbeddingPool`, `LateInteractionPool`, `planAllocation`, `detectResources`, `detectAppleSiliconTier`, `planLateInteractionFromGpuTier`, `detectLastLevelCacheBytes` — **none** are in the barrel. `tests/indexing/indexer-resource-plan.test.js:2` imports `detectResources, planAllocation` directly.
- **`indexer-sparse-gram.js`**: exports `buildSparseGramArtifact` — not in the barrel.

**Internal symbols leaking outward**:
- `indexer-phases.js` uses `export * from './indexer-phases.js'` at `index.js:13`, which re-exports `cleanupStagedLateInteractionIndex`, `invalidateLateInteractionIndex`, `unlinkIfExists` — private helpers with no `_` prefix.

**Recommendation**: switch the `export * from` pattern to explicit `export { ... }` lists (as already done for `ast-chunker.js:40`) on `indexer-phases.js`, `indexer-build.js`, `indexer-ann.js`, `indexer-utils.js`. Add `li-skip-policy`, `indexer-pool.js` planner exports, and `indexer-sparse-gram.js` to the barrel.

---

## 5. File size audit (CLAUDE.md: files < 500 lines)

| File | Lines | Status | Recommended seam |
|---|---:|---|---|
| `chunking/chunk-builder.js` | 170 | ok | — |
| `chunking/markdown-chunker.js` | 503 | **breach (+3)** | split RST underline parser into `chunking/rst-chunker.js` |
| `chunking/plaintext-chunker.js` | 104 | ok | — |
| `document-chunker.js` | 56 | ok (facade) | — |
| `ast-chunker.js` | 709 | **breach** | split by strategy: brace / indent / end-keyword parsers |
| `li-skip-policy.js` | 225 | ok | — |
| `index.js` (barrel) | 54 | ok | — |
| `index-codebase-v21.js` (facade) | 472 | ok | — |
| `indexer-phases.js` | 627 | **breach** | split by phase group; keep `runPhase` in its own file |
| `indexer-build.js` | 597 | **breach** | split chunk enrichment + pipelined embed/write |
| `indexer-ann.js` | 903 | **breach (major)** | split by artifact: hnsw-phase, binary-hnsw-phase, late-interaction-phase, hybrid-dispatcher |
| `indexer-pool.js` | 696 | **breach** | split `EmbeddingPool`, `LateInteractionPool`, `planAllocation` |
| `indexer-utils.js` | 536 | **breach (+36)** | split file discovery + gitignore out of SQLite/logging/swap |
| `indexer-worker.js` | 148 | ok | — |
| `indexer-sparse-gram.js` | 98 | ok | — |
| `artifact-builder.js` | 1059 | **breach (major, 2.1×)** | split state, binary HNSW build, int8 sidecar, verify/stats CLI |

Eight breaches. Priority: `artifact-builder.js` (1059), `indexer-ann.js` (903), `ast-chunker.js` (709), `indexer-pool.js` (696), `indexer-phases.js` (627), `indexer-build.js` (597), `indexer-utils.js` (536), `chunking/markdown-chunker.js` (503).

---

## 6. Config import compliance

**Rule**: in-domain code must import from `../infrastructure/config/index.js`.

| File | Import | Verdict |
|---|---|---|
| `index-codebase-v21.js:42` | `../infrastructure/config/index.js` | ok |
| `indexer-phases.js:10` | `../infrastructure/config/index.js` | ok |
| `indexer-build.js:11` | `../infrastructure/config/index.js` | ok |
| `indexer-ann.js:9, 543` | `../infrastructure/config/index.js` | ok |
| `indexer-utils.js:12` | `../infrastructure/config/index.js` | ok |
| `indexer-sparse-gram.js:5` | `../infrastructure/config/index.js` | ok |
| `artifact-builder.js:32` | `../infrastructure/config/index.js` | ok |
| `li-skip-policy.js:31` | `../infrastructure/config/search.js` | **irregular** — reaches into sub-module |

Zero files reach into `core/config.js`.

---

## 7. External consumer audit

**Two real bypasses** that `check-boundaries.js` misses:
1. `tests/integration/flag-semantics.test.js:15` — imports `parseArgs` from `index-codebase-v21.js` internal. Not exported from barrel. Either add to the barrel or add `tests/integration/` to the allowlist.
2. `tests/embedding/embedding-text.test.js:9-10` — `tests/embedding/` allowlisted for embedding, but reaches into `core/indexing/ast-chunker.js` and `core/indexing/chunking/chunk-builder.js`. Cross-domain test bypass.

---

## 8. Pattern consistency audit

| Pattern | Canonical invocation | Consistency |
|---|---|---|
| **Atomic DB swap** | `indexer-utils.js:139` | consistent — callers: `indexer-build.js:194,531`, `indexer-phases.js:486`, `indexer-sparse-gram.js:88` |
| **Phase runner** | `indexer-phases.js:52` | consistent |
| **Resource plan** | `indexer-pool.js:162` | **two callers** — `indexer-phases.js:267` stores plan; `indexer-pool.js:392,552` re-derive it in constructors. Duplicate derivation |
| **Hybrid CPU+GPU dispatcher** | duplicated in `embedding-local-model.js:722-...` AND `indexer-ann.js:644-700` AND `indexer-pool.js` | **three near-duplicates** |

The hybrid-dispatcher duplication is the **root cause** of §2. Collapsing it into a single dispatcher (owned by indexing, consumed via DI by embedding) fixes both the duplication and the boundary violation in one move.

---

## 9. Overall DDD compliance grade: **C+**

**Passing**:
- Dependency direction from `indexing/` is clean — no imports of `search/` or `query/`.
- Config imports all route through the infrastructure barrel.
- Phase runner + atomic swap patterns are single-source.
- External consumers mostly use the indexing barrel.
- Declared exception `indexing → ranking` is within static count.

**Failing / weak**:
- **One hard boundary violation** — `embedding-local-model.js:361`. Blocking per `check-boundaries.js:258`.
- **Eight file-size breaches**, two major (`artifact-builder.js` 1059, `indexer-ann.js` 903).
- **Barrel under-exports**: planner, skip-policy, sparse-gram missing.
- **Checker accounting bug**: dynamic ranking imports bypass the exception counter.
- **Three duplicate hybrid dispatchers**.

**Path to A**: fix §2, fix 3 largest file breaches (§5), add missing exports (§4), extend exception counter to dynamic imports (§3), unify hybrid dispatcher (§8). Net impact: roughly 10 file moves, ~150 LOC reduction via dispatcher unification, zero public API change.
