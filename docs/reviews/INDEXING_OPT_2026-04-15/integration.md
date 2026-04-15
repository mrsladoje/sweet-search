# Integration & DDD Compliance Review — Indexing Optimization Fix-Pack

**Reviewer**: V3 QE Integration Reviewer
**Date**: 2026-04-15
**Branch**: `main`
**HEAD**: `34089b2`
**Scope**: `8be7e09..34089b2` (excluding incremental indexing modules)

---

## 1. `scripts/check-boundaries.js` Output (Verbatim)

```
OK [indexing → ranking (late-interaction build)]: 6 imports (within limit of 6)
OK [query → training (CatBoost model artifact)]: 2 imports (within limit of 2)
INTERNAL BYPASS [graph → query]: core/graph/graph-search.js:19:import { detectIntent, getIntentBoost } from '../query/intent-detector.js';
INTERNAL BYPASS [graph → ranking]: core/graph/graph-search.js:20:import { applyMMR, shouldApplyMMR } from '../ranking/mmr.js';
INTERNAL BYPASS [indexing → embedding]: core/indexing/indexer-ann.js:12:import { truncateForHNSW, getEmbeddings, getModelInfo, fisherYatesShuffle } from '../embedding/embedding-service.js';
INTERNAL BYPASS [indexing → embedding]: core/indexing/indexer-build.js:14:import { getEmbeddings, getModelInfo } from '../embedding/embedding-service.js';
INTERNAL BYPASS [indexing → embedding]: core/indexing/indexer-phases.js:20:} from '../embedding/embedding-local-model.js';
INTERNAL BYPASS [indexing → graph]: core/indexing/indexer-build.js:12:import { GraphExtractor, createGraphSchema, insertGraph } from '../graph/graph-extractor.js';
INTERNAL BYPASS [indexing → graph]: core/indexing/indexer-build.js:13:import { resolveRelationshipTargets } from '../graph/relationship-resolver.js';
INTERNAL BYPASS [indexing → graph]: core/indexing/indexer-phases.js:12:import { backupSummaries, restoreSummaries, markForRegeneration } from '../graph/summary-manager.js';
INTERNAL BYPASS [indexing → graph]: core/indexing/index-codebase-v21.js:43:import { resolveRelationshipTargets } from '../graph/relationship-resolver.js';
INTERNAL BYPASS [indexing → ranking]: core/indexing/indexer-ann.js:11:import { LateInteractionIndex } from '../ranking/late-interaction-index.js';
INTERNAL BYPASS [indexing → ranking]: core/indexing/indexer-phases.js:25:} from '../ranking/late-interaction-model.js';
INTERNAL BYPASS [indexing → vector-store]: core/indexing/indexer-ann.js:10:import { HNSWIndex } from '../vector-store/hnsw-index.js';
INTERNAL BYPASS [indexing → vector-store]: core/indexing/artifact-builder.js:55:import { BinaryHNSWIndex } from '../vector-store/binary-hnsw-index.js';
INTERNAL BYPASS [indexing → vector-store]: core/indexing/artifact-builder.js:57:import { FloatVectorStore, getFloatStorePath } from '../vector-store/float-vector-store.js';
INTERNAL BYPASS [indexing → vector-store]: core/indexing/index-codebase-v21.js:44:import { requireNativeAnn as requireNativeAnnBackend } from '../vector-store/hnsw-index.js';
INTERNAL BYPASS [search → embedding]: core/search/search-cli.js:13:import { registerAutoPersistOnExit } from '../embedding/embedding-service.js';
INTERNAL BYPASS [search → embedding]: core/search/search-postprocess.js:14:import { int8CosineSimilarity } from '../embedding/embedding-service.js';
INTERNAL BYPASS [search → embedding]: core/search/search-postprocess.js:17:import { recordQueryTelemetry } from '../embedding/embedding-cache.js';
INTERNAL BYPASS [search → embedding]: core/search/search-server.js:14:import { clearCache } from '../embedding/embedding-cache.js';
INTERNAL BYPASS [search → embedding]: core/search/search-semantic.js:25:} from '../embedding/embedding-service.js';
INTERNAL BYPASS [search → embedding]: core/search/sweet-search.js:24:import { getEmbedding, getBinaryEmbedding, truncateForHNSW, int8CosineSimilarity, warmup as warmupEmbedding, isWarm, registerAutoPersistOnExit } from '../embedding/embedding-service.js';
INTERNAL BYPASS [search → embedding]: core/search/sweet-search.js:26:import { recordQueryTelemetry } from '../embedding/embedding-cache.js';
INTERNAL BYPASS [search → graph]: core/search/search-postprocess.js:13:import { expandResults } from '../graph/graph-expansion.js';
INTERNAL BYPASS [search → graph]: core/search/sweet-search.js:18:import { GraphSearch } from '../graph/graph-search.js';
INTERNAL BYPASS [search → graph]: core/search/sweet-search.js:30:import { expandResults } from '../graph/graph-expansion.js';
INTERNAL BYPASS [search → graph]: core/search/sweet-search.js:33:import { pageRank, loadGraph, buildAdjacency } from '../graph/repo-map.js';
INTERNAL BYPASS [search → query]: core/search/search-postprocess.js:16:import { classifyIntent, getIntentPolicy } from '../query/intent-router.js';
INTERNAL BYPASS [search → query]: core/search/sweet-search.js:17:import { QueryRouter, routeQuery } from '../query/query-router.js';
INTERNAL BYPASS [search → query]: core/search/sweet-search.js:34:import { classifyIntent, getIntentPolicy } from '../query/intent-router.js';
INTERNAL BYPASS [search → query]: core/search/search-hybrid.js:11:import { routeQuery } from '../query/query-router.js';
INTERNAL BYPASS [search → ranking]: core/search/search-postprocess.js:15:import { QualityScorer } from '../ranking/quality-scorer.js';
INTERNAL BYPASS [search → ranking]: core/search/sweet-search.js:16:import { getGlobalLocalReranker } from '../ranking/local-reranker.js';
INTERNAL BYPASS [search → ranking]: core/search/sweet-search.js:22:import { Reranker } from '../ranking/flashrank.js';
INTERNAL BYPASS [search → ranking]: core/search/sweet-search.js:23:import { LateInteractionIndex } from '../ranking/late-interaction-index.js';
INTERNAL BYPASS [search → ranking]: core/search/sweet-search.js:31:import { applyMMR, shouldApplyMMR, getLambdaForIntent, MMR_CONFIG } from '../ranking/mmr.js';
INTERNAL BYPASS [search → ranking]: core/search/sweet-search.js:32:import { QualityScorer, setRepoMapModule } from '../ranking/quality-scorer.js';
INTERNAL BYPASS [search → ranking]: core/search/search-hybrid.js:12:import { applyMMR, shouldApplyMMR, getLambdaForIntent } from '../ranking/mmr.js';
INTERNAL BYPASS [search → vector-store]: core/search/sweet-search.js:20:import { HNSWIndex } from '../vector-store/hnsw-index.js';
INTERNAL BYPASS [search → vector-store]: core/search/sweet-search.js:21:import { BinaryHNSWIndex } from '../vector-store/binary-hnsw-index.js';
INTERNAL BYPASS [search → vector-store]: core/search/sweet-search.js:25:import { FloatVectorStore, getFloatStorePath } from '../vector-store/float-vector-store.js';
INTERNAL BYPASS [search → vocabulary]: core/search/session-warmup.js:29:import { ARTIFACT_PATHS } from '../vocabulary/vocab-constants.js';
INTERNAL BYPASS [vocabulary → embedding]: core/vocabulary/vocab-warmer.js:25:import { generateEmbeddings, truncateForHNSW } from '../embedding/embedding-service.js';
INTERNAL BYPASS [vocabulary → graph]: core/vocabulary/vocab-warmup-orchestrator.js:20:import { detectCommunities, computeGraphHash } from '../graph/community-detector.js';
INTERNAL BYPASS [vocabulary → graph]: core/vocabulary/vocab-miner.js:21:import { pageRank, loadGraph, buildAdjacency } from '../graph/repo-map.js';

44 internal barrel bypass(es) within core/.

All domain boundaries clean.
Checked: 9 domains, 8 direction rules, barrel-only enforcement (external + internal).
44 internal barrel bypass warning(s) — not blocking.
```

Exit code: 0 (passes CI).
Direction rules: clean.
Exception caps: clean (`indexing → ranking` at the ceiling 6/6, `query → training` 2/2).
Internal warnings: 44 (unchanged from prior review).
**External bypass count reported: 0** — but this is fictitious; see §3 (M3-NEW-1).

---

## 2. Status of Prior Findings

| ID | Description | Status | Evidence |
|----|-------------|--------|----------|
| **H1** | `embedding → indexing` static + dynamic import (cycle) | **FIXED** | `grep -rn "from '../indexing" core/embedding/` → 0 hits. `grep -rn "import('.*indexing" core/embedding/` → 0 hits. The remaining mentions in `embedding-local-model.js:358,366` and `embedding-service.js:602` are doc comments only, not imports. The slot pattern in `embedding-local-model.js:368-377` (`setEmbeddingPool` / `getEmbeddingPool` / `clearEmbeddingPool`) lets `indexer-pool.js` install the pool without embedding ever importing indexing. `embedBatchesWithPool` at line 379 reads through `getEmbeddingPool()` (file-local accessor, no cross-module hop). |
| **L1** | `li-skip-policy.js` reached into `infrastructure/config/search.js` | **FIXED** | `core/indexing/li-skip-policy.js:31` now imports from `'../infrastructure/config/index.js'`. Repo-wide `grep -rn "from '../infrastructure/config/search" core/` → 0 hits. The barrel re-exports `loadProjectConfig` at `core/infrastructure/config/index.js:34,72`. |
| **L2/L3** | Indexing barrel under-exported pool helpers / skip policy / sparse-gram | **FIXED** | `core/indexing/index.js:58-79` now explicitly exports `planAllocation`, `detectResources`, `EmbeddingPool`, `LateInteractionPool`, `initEmbeddingPool`, `shutdownEmbeddingPool`, `getEmbeddingPool`, `applyLiSkipPolicy`, `isExcludedByConfig`, `chunkLooksGenerated`, `buildSparseGramArtifact` plus the barrel still re-exports the existing surface via `export *`. |
| **M3** | `check-boundaries.js` exception counter missed dynamic imports | **FIXED (Section 2 only)** | `scripts/check-boundaries.js:135-153` now sums `staticCount + dynamicCount` for each `EXCEPTIONS` entry. Cap raised from 2 → 6 with inline comment at line 36-40 enumerating the 6 sites. The script reports `OK [indexing → ranking]: 6 imports`. **However**, the related Section 4 (external barrel-only enforcement) is silently dead — see M3-NEW-1 below. |

All four prior findings are resolved within their stated scope. **The H1 fix is real and clean.**

---

## 3. New Boundary Concerns

### M3-NEW-1: `check-boundaries.js` Section 4 silently dead (CRITICAL, pre-existing, not introduced by this fix-pack)

`scripts/check-boundaries.js` lines 196-251 implement Check 4 ("Barrel-only imports from consumers outside core/"). The grep template literal uses an embedded character class `[^'"]` inside a double-quoted shell argument:

```js
`grep -rn --include='*.js' --include='*.mjs' -E "from ['\"].*core/${domain}/[^'\"]+['\"]" tests/ scripts/ ...`
```

When JavaScript escapes `'\"'` to `"`, the resulting shell command is:

```
grep -rn --include='*.js' --include='*.mjs' -E "from ['"].*core/infrastructure/[^'"]+['"]" tests/ scripts/ ...
```

The unescaped `"` inside the double-quoted argument terminates the shell string. Running this raw produces:

```
zsh: bad pattern: from ['].*core/infrastructure/[^"]+[]
```

The script swallows this with `2>/dev/null || true`, so `result` is empty for every domain, and the entire external-bypass loop is a no-op.

**Verification I ran**:
1. Re-implemented Check 4 logic in standalone Node with the same allowlist — found **39 external barrel bypasses** (28 from `tests/`, 11 from `scripts/`).
2. Confirmed by patching the script to print `result.length` per domain — every domain reported `0` despite `grep ... 2>&1` returning 45+ lines from the same paths.
3. Confirmed regression pre-exists: `git show 8be7e09:scripts/check-boundaries.js` has the identical broken pattern. The M3 fix-pack did not touch Section 4, so this is a pre-existing latent bug, not a regression.

**Hidden bypasses currently invisible to CI** (sample, not exhaustive):
- `scripts/uninstall.js:19` — `import { getCoremlCascadeRoot, getCoremlCascadeState } from '../core/infrastructure/coreml-cascade.js';` (NEW, introduced by `cf04213`)
- `scripts/spike-coreml/*.js` — six files reaching into `native-tokenizer.js` / `native-inference.js`
- `scripts/profile-pipeline.js:55` — `'./core/infrastructure/native-resolver.js'`
- `tests/diagnose-metal-*.js` (5 files) — diagnostic harnesses bypassing tokenizer + native-inference + model-fetcher + model-registry
- `tests/diagnose-cpu-utilization.js`, `tests/diagnose-hybrid-*.js`, `tests/native-li-accuracy.js`, `tests/native-inference-accuracy.js` — reach into `core/ranking/late-interaction-model.js`
- `tests/indexing/li-staged-save.test.js:28` — reaches into `core/ranking/late-interaction-index.js` from `tests/indexing/` (allowlisted for `indexing/`, NOT for `ranking/`)
- `eval/scripts/maxsim-quant-correlation.js:16`, `eval/scripts/grep-latency-bench.js:27`

The honest assessment in `DDD_ARCHITECTURE.md` line 270-275 claims four checks run; in reality only three (forbidden direction, exception limits, internal barrel) actually find anything. **The "external barrel-only enforcement" gate has been a placebo since at least `8be7e09`.**

**Suggested fix** (for follow-up, NOT this PR — read-only review):
```js
// Use a single-quoted shell argument so JS escaping doesn't collide with the regex:
const cmd = `grep -rn --include='*.js' --include='*.mjs' -E 'from ["\\x27].*core/${domain}/[^"\\x27]+["\\x27]' tests/ scripts/ eval/ mcp/ bin/ evaluation/ __tests__/ 2>/dev/null || true`;
```
Or, more robustly, drop `execSync` for Section 4 and walk the filesystem with `node:fs` + `node:path`, applying the regex in-process.

**Severity**: HIGH. Every "external barrel bypass" line in the prior review (`docs/reviews/ddd-compliance.md`) was hand-counted by Codex, not produced by `check-boundaries.js`. CI cannot regress on this metric because CI never measured it.

---

### M3-NEW-2: New external bypass introduced by `cf04213`

`scripts/uninstall.js:19` reaches directly into `core/infrastructure/coreml-cascade.js` for `getCoremlCascadeRoot` + `getCoremlCascadeState`, instead of going through `core/infrastructure/index.js` like its sibling `scripts/init.js:23` does. Both symbols ARE re-exported through the barrel (`core/infrastructure/index.js:48,57`), so this is a one-line fix to make uninstall's import shape match init's. It is currently invisible to CI because of M3-NEW-1.

**Severity**: LOW (cosmetic; one symbol away from compliance).

---

### M3-NEW-3: Embedding pool slot is duck-typed, not interface-declared

The H1 fix pattern is sound but the contract is informal. Three observations:

1. **No type declaration**. `core/embedding/embedding-local-model.js:371-377` exposes three module-level functions that take and return `any`. The expected shape `{ embed(texts, opts) => Promise<Float32Array[]>, numWorkers?: number }` is described in the doc comment at lines 360-364 of the same file, but there is no `.d.ts`, no JSDoc `@typedef`, and no runtime check at `setEmbeddingPool` time. A caller that installs an object missing `embed` will fail with a `TypeError` at first dispatch (`embedding-local-model.js:714`), not at registration.

2. **No serialization between dispatch and shutdown**. `EmbeddingPool.shutdown()` at `indexer-pool.js:548-557` flips `_ready = false` and immediately terminates worker threads. `embedBatchesWithPool` at lines 379-395 of `embedding-local-model.js` is a Promise.all over `pool.embed(batch, opts)` calls; an in-flight `embed()` mid-shutdown would observe its worker `terminate()` and reject. The current pipeline structure happens to be safe — `indexer-phases.js:419-424` calls `initEmbeddingPool` BEFORE the parallel embed/LI phases and `indexer-phases.js:596` calls `shutdownEmbeddingPool` in the `finally` block AFTER `Promise.all([...])` — so dispatch and teardown never overlap. But the slot itself does not enforce this; any future caller that races the slot would get a hard fault, not a graceful no-op.

3. **No reference counting**. `clearEmbeddingPool` simply sets `_embeddingPool = null` (no decrement, no in-use guard). If a second indexer instance ever attempted to share the same embedding layer, the first to call `shutdownEmbeddingPool` would leave the second pointing at a terminated pool.

This is **pragmatically OK**, because the codebase only has one indexing pipeline running at a time, and the convention is sound. But the slot pattern is load-bearing for the entire DDD compliance story (it's the mechanism that breaks the embedding ⇄ indexing cycle). It deserves either a JSDoc `@typedef EmbeddingPoolSlot { embed(...): ..., numWorkers?: ... }` declaration in `embedding-local-model.js`, or — better — a Phase-6 port-and-adapter formalization where the contract lives in a domain-defined interface and the indexer pool is the adapter. The current state is fine for now; flag it so the next refactor doesn't break it accidentally.

**Severity**: LOW (works today, has no enforcement scaffolding).

---

### M3-NEW-4: `indexer-phases.js` does not thread `projectRoot` to `buildLateInteractionIndex` (3fa180c regression)

Commit `3fa180c` added `projectRoot` as a destructured option to `buildLateInteractionIndex` at `core/indexing/indexer-ann.js:534`, with the comment "honored by LI skip policy for `.sweet-search.config.json` excludes". Inside the function, `applyLiSkipPolicy(chunks, { projectRoot })` is called at line 551.

But the only caller of `buildLateInteractionIndex` is `core/indexing/indexer-phases.js:473-490`, and that call **does not pass `projectRoot`**:

```js
const buildLateInteraction = (chunks) => buildLateInteractionIndex(chunks, dryRun, filesToRemoveFromLI, {
  poolFactor: lateInteractionPool,
  extendedSkiplist: lateInteractionExtendedSkiplist,
  loadFromPath: DB_PATHS.lateInteraction,
  saveToPath: stagedLateInteractionPath,
  finalIndexPath: DB_PATHS.lateInteraction,
  stagingSegmentDir: stagedLateInteractionSegmentDir(stagedLateInteractionPath),
  fullRebuild: fullReindex,
  workerCount: lateInteractionWorkers,
  threadsPerWorker: lateInteractionWorkerThreads,
  batchSize: resourcePlan.lateInteractionBatchSize,
  batchSizeUpperCap: resourcePlan.lateInteractionBatchSizeUpperCap,
  tokenBudget: resourcePlan.lateInteractionTokenBudget,
  attentionBudget: resourcePlan.lateInteractionAttentionBudget,
});
```

`indexer-phases.js:10` already imports `PROJECT_ROOT` from infrastructure config, so it has the value. The fall-through is `applyLiSkipPolicy({projectRoot: undefined}) → loadProjectConfig(undefined || process.cwd())` (`li-skip-policy.js:50`). For `sweet-search index ...` invocations launched from the project root this happens to work because `process.cwd() === PROJECT_ROOT`. For any invocation from a different cwd (CI runners that `cd` elsewhere, MCP tool callers, hooks) the LI skip policy will silently load the **wrong** `.sweet-search.config.json` excludes — or none, if the cwd isn't a project. The embedding indexer sees `PROJECT_ROOT` correctly via `indexer-utils.js:482` (uses `projectRoot = PROJECT_ROOT` default), so embed and LI may now **disagree about which files are skip-listed**, defeating the whole point of the bde9b26 unification.

This is a one-line fix in `indexer-phases.js:473`: add `projectRoot: PROJECT_ROOT,` to the options bag. The audit chain is otherwise sound: `buildLateInteractionIndex` accepts the option, threads it to `applyLiSkipPolicy`, which threads it to `loadProjectConfig`. Just the connecting hop is missing.

**Severity**: MEDIUM. Functionally invisible from `process.cwd() === PROJECT_ROOT`, silently incorrect otherwise. The 3fa180c refactor is incomplete.

---

### M3-NEW-5: CoreML cascade re-exported through embedding barrel

`core/embedding/index.js:35-40` re-exports four cascade diagnostic functions from `core/infrastructure/coreml-cascade.js`:

```js
export {
  isCoremlCascadeApplicable,
  getCoremlCascadeState,
  getCoremlCascadeReport,
  getCoremlCascadeResolvedDirs,
} from '../infrastructure/coreml-cascade.js';
```

This is "leaky" in the strict architectural sense — the embedding barrel exposes infrastructure internals. But:

- All four are read-only diagnostic accessors (no mutation, no side effects).
- They answer a question that is genuinely embedding-shaped: "what backend will my next embed call dispatch to?"
- The DDD_ARCHITECTURE.md documents the rationale at lines 243-252.
- The alternative (force every consumer to import from `core/infrastructure/index.js` for these four functions while pulling everything else from `core/embedding/index.js`) is more leakage, not less, because it spreads the abstraction across two import statements.

The ALTERNATIVE concern is direction: this re-export is `embedding → infrastructure`, which IS an allowed direction per the dependency matrix (line 65 of DDD_ARCHITECTURE.md). It just bypasses the infrastructure barrel (`'../infrastructure/coreml-cascade.js'` instead of `'../infrastructure/index.js'`). The internal barrel allowlist exempts `infrastructure` (line 70-75 of `check-boundaries.js`), so this is permitted by policy.

**Verdict**: Acceptable. Document trail is intact. Flag if a Phase-6 port-and-adapter pass happens, because then the cascade should live behind an embedding port, not be re-exported from infrastructure.

**Severity**: INFORMATIONAL.

---

### M3-NEW-6: `indexing → ranking` exception cap is at the ceiling

`scripts/check-boundaries.js:40` sets `max: 6` for `indexing → ranking`. Current count: exactly 6.

```
core/indexing/indexer-ann.js:11      static  LateInteractionIndex
core/indexing/indexer-phases.js:25   static  late-interaction-model.js (configureLateInteractionRuntime, etc.)
core/indexing/indexer-ann.js:706     dynamic late-interaction-model.js (hybrid CPU+GPU probe)
core/indexing/indexer-ann.js:745     dynamic late-interaction-model.js (single-encoder fallback)
core/indexing/indexer-pool.js:695    dynamic late-interaction-model.js (LI pool inline fallback)
core/indexing/indexer-worker.js:98   dynamic late-interaction-model.js (worker entrypoint)
```

A 7th import would break CI. This is a tight ceiling, intentionally so. New devs adding fallbacks or hooks into the LI runtime path will need to consolidate before adding. Recommend the LI runtime exposes a single facade (`liRuntime.encode`, `liRuntime.configure`) so that the four dynamic fallbacks collapse to one site. That's a refactor for a future PR; flagging the headroom as "zero" so the constraint is visible.

**Severity**: INFORMATIONAL.

---

## 4. Cyclic Dependency Audit

**Confirmed: no cycles in the hot-path domains.**

Direct verification:
```
$ grep -rn "from '../indexing" core/embedding/        → 0 hits
$ grep -rn "import('.*indexing" core/embedding/       → 0 hits
$ grep -rn "indexing/" core/ranking/                  → 0 hits
$ grep -rn "from '../embedding" core/indexing/        → 4 hits (allowed direction)
$ grep -rn "from '../embedding\|from '../indexing\|from '../ranking" core/infrastructure/  → 0 hits
$ grep -rn "from '../indexing\|from '../search\|from '../ranking" core/embedding/  → 0 hits
```

The embedding ⇄ indexing cycle is broken. Single direction `indexing → embedding`. Infrastructure is a true leaf (imports zero domains). The `graph → embedding` exception is documented as CLI-dynamic-only and gated by an `// CLI` annotation in `check-boundaries.js:114`.

**No new cycles introduced by `cf04213`** (CoreML cascade). The cascade flow is `scripts/init.js → core/infrastructure/index.js → core/infrastructure/coreml-cascade.js → core/infrastructure/hardware-capability.js + model-fetcher.js`. All inside the infrastructure leaf. `native-inference.js` is also infrastructure-internal; the consumers (`embedding/embedding-local-model.js`, `ranking/late-interaction-model.js`, `indexing/indexer-pool.js`, `indexing/indexer-phases.js`) all import in the allowed `domain → infrastructure` direction.

---

## 5. Barrel Completeness Table

| Domain | Barrel | Complete? | Notes |
|--------|--------|-----------|-------|
| embedding | `core/embedding/index.js` | YES | Re-exports facade default + service + remote + local-model + cache. Resolves `expandVocabulary` ambiguity explicitly. New: cascade diagnostic re-exports (lines 35-40) — see M3-NEW-5. |
| indexing | `core/indexing/index.js` | YES | Explicit list of pool helpers (planAllocation, EmbeddingPool, LateInteractionPool, init/shutdown/get pool slot accessors), LI skip policy (applyLiSkipPolicy, isExcludedByConfig, chunkLooksGenerated), sparse-gram artifact builder. L2/L3 fixed. |
| infrastructure | `core/infrastructure/index.js` | YES | Now includes hardware-capability + 12 cascade exports (lines 43-62). Organization is logical (config → repos → models → ONNX → CoreML → cascade → hardware → languages → quantization → SIMD). |
| ranking | `core/ranking/index.js` | not audited (out of scope; no changes in fix-pack) | — |
| graph | `core/graph/index.js` | not audited | — |
| search | `core/search/index.js` | not audited | — |
| query | `core/query/index.js` | not audited | — |
| vector-store | `core/vector-store/index.js` | not audited | — |
| vocabulary | `core/vocabulary/index.js` | not audited | — |

The three barrels in scope (embedding, indexing, infrastructure) are complete. The 39 external bypasses listed in §3 M3-NEW-1 are NOT due to missing barrel exports — they're due to consumers (mostly diagnostic harnesses and spike scripts) reaching past the barrel for direct internal access. A handful (e.g. `scripts/uninstall.js`) have a one-line fix; the rest are diagnostic code that would benefit from being moved under `tests/<domain>/` to qualify for the existing allowlist exemption.

---

## 6. File-Size Breach Update

| File | Prior Review | Current | Δ | Status |
|------|--------------|---------|---|--------|
| `core/ranking/late-interaction-index.js` | 2186 | **2311** | +125 | Largest. Grew from LI staged-save fix (C1). |
| `core/graph/graph-extractor.js` | 2304 | **2304** | 0 | Unchanged. |
| `core/graph/graph-search.js` | 2018 | **2148** | +130 | New growth — out of scope (review focus is indexing). |
| `core/indexing/artifact-builder.js` | 1059 | **1054** | -5 | Slight reduction. |
| `core/indexing/indexer-ann.js` | 903 | **951** | +48 | Grew from C1 LI staged-save fix + projectRoot threading. |
| `core/embedding/embedding-local-model.js` | 819 | **845** | +26 | Grew from H1 fix slot accessors + comments. |
| `core/graph/graph-expansion.js` | 815 | **839** | +24 | Out of scope. |
| `core/ranking/late-interaction-model.js` | not enumerated | **812** | — | Not in prior table. |
| `core/ranking/flashrank.js` | not enumerated | **788** | — | Not in prior table. |
| `core/indexing/incremental-tracker.js` | not enumerated | **761** | — | OUT OF SCOPE per instructions. |
| `core/indexing/indexer-pool.js` | 696 | **746** | +50 | Grew from H1 fix (`initEmbeddingPool`/`shutdownEmbeddingPool` moved here from embedding). |
| `core/infrastructure/llm-provider.js` | not enumerated | **733** | — | Pre-existing breach, not in prior table. |
| `core/embedding/embedding-service.js` | not enumerated | **712** | — | Pre-existing breach. |
| `core/indexing/ast-chunker.js` | 709 | **709** | 0 | Unchanged. |
| `core/indexing/indexer-phases.js` | 627 | **706** | +79 | Grew from `atomicSwapLateInteractionIndex` helper (C1) + initEmbeddingPool/shutdownEmbeddingPool wiring. |
| `core/graph/hcgs-generator.js` | not enumerated | **666** | — | Pre-existing breach. |
| `core/infrastructure/tree-sitter-provider.js` | not enumerated | **665** | — | Pre-existing breach. |
| `core/infrastructure/coreml-cascade.js` | NEW | **645** | NEW | New file from cf04213, BREACHES 500-line target on first commit. |
| `core/indexing/indexer-build.js` | 597 | **597** | 0 | Unchanged. |
| `core/graph/leiden-algorithm.js` | not enumerated | **547** | — | Pre-existing breach. |
| `core/graph/summary-manager.js` | (not yet existed) | **542** | NEW | NEW BREACH from H2 disk-persisted backup (acknowledged in DDD_ARCHITECTURE.md:346). |
| `core/indexing/indexer-utils.js` | 536 | **536** | 0 | Unchanged. |

**Net file-size status**: 4 files in indexing grew further (`indexer-ann.js` +48, `indexer-pool.js` +50, `indexer-phases.js` +79, `embedding-local-model.js` +26). 2 NEW breaches landed: `summary-manager.js` (542) and `coreml-cascade.js` (645, NEW file). The DDD_ARCHITECTURE.md "Honest Assessment" section (line 340-349) acknowledges this and explicitly defers decomposition to Phase 8. The fix-pack made the right tradeoff — correctness and DDD compliance first, file-size discipline later — and its commit message is explicit about the deferral.

The new `coreml-cascade.js` at 645 lines is the most concerning addition: it's a fresh file that lands ABOVE the 500-line target on day one. A natural split would be `coreml-cascade.js` (state inspection) + `coreml-cascade-fetcher.js` (HF download + cache management), which would put both halves around 320 lines. Recommend addressing in a follow-up before more cascade-related code accretes.

---

## 7. DDD Docs Consistency

`docs/DDD_ARCHITECTURE.md` updates:

| Topic | Documented? | Accuracy |
|-------|-------------|----------|
| **Embedding slot pattern** (H1 fix) | **NO** | Drift. The doc describes the cascade pattern at length but is silent on the embedding-pool slot — the load-bearing mechanism that keeps the dependency direction one-way. The Honest Assessment section (line 333-351) lists "What is not yet true" but doesn't mention the slot. Recommend adding a "Embedding Worker Pool Slot" subsection mirroring the CoreML cascade subsection (lines 173-261), explaining why the slot exists, what its contract is, and which file owns lifecycle. |
| **`indexing → ranking` cap raised to 6** | **YES** (lines 73-87) | Accurate. Explicitly enumerates all 6 sites by file and describes whether each is static or dynamic. Notes that the previous cap of 2 was wrong because dynamic imports were uncounted, and that the 2026-04-15 fix exposed the real surface. |
| **`hardware-capability.js` + `coreml-cascade.js` modules** | **YES** (lines 173-261) | Accurate and detailed. Documents invariants (cascade NEVER fails init), routing contract (no env-var bypass; only `SWEET_SEARCH_COREML_CASCADE=0` survives), and barrel exports including the embedding re-export. The "What this does NOT do" section at lines 253-260 honestly notes that this is concrete coupling, not formal port-and-adapter. |
| **File-size breaches** | **PARTIAL** (lines 340-349) | The "Honest Assessment" lists the largest files with line counts that match the current state. Notes `summary-manager.js (542 lines, NEW breach)`. Does NOT mention `coreml-cascade.js (645)` as a NEW breach despite enumerating other new growth — recommend adding it. |
| **External barrel-only enforcement** | **YES, but the doc is wrong** (lines 264-275) | The doc claims `check-boundaries.js` runs four checks, including "External barrel bypass: scripts, tests, mcp, eval, bin importing domain internals". This check is silently dead (M3-NEW-1). The doc's claim is unsupported by the code. |

**Net docs status**: The CoreML cascade additions are well-documented; the H1 fix's slot pattern is undocumented. The check-boundaries claim about Check 4 is fictional, which is the docs equivalent of M3-NEW-1.

---

## 8. Overall DDD Compliance Grade

**Grade: B+**

**What's good** (would be A−):
- Hard direction violations: zero. Every domain → domain import respects the matrix, statically and dynamically.
- The H1 fix is structurally correct: the embedding ⇄ indexing cycle is broken with a slot pattern that lives entirely in embedding (the leaf that owns the lifetime question), and indexing owns construction (the higher layer that knows about pool resources).
- The L1, L2, L3 fixes are clean and complete — barrel imports work, exports are explicit.
- The M3 dynamic-import counter fix is real for Section 2 and the new cap (6) is documented in both `check-boundaries.js` and `DDD_ARCHITECTURE.md`.
- The CoreML cascade introduction across infrastructure follows good pattern: a single owning module (`coreml-cascade.js`), no env-var bypasses, hard "never fails init" invariant, single-point dispatch via `getCoremlCascadeResolvedDirs()`. Tests exist (`tests/infrastructure/coreml-cascade.test.js`).

**What knocks it from A− to B+**:
- **M3-NEW-1**: the script's external barrel-only enforcement (Check 4) is silently dead due to a shell-escaping bug. The "0 BARREL BYPASS" claim is fictitious. This pre-exists the fix-pack but the fix-pack didn't notice it. CI is currently incapable of catching new bypasses from `scripts/`, `eval/`, `tests/diagnose-*.js`, etc.
- **M3-NEW-4**: `indexer-phases.js:473` does not pass `projectRoot` into `buildLateInteractionIndex`, breaking the projectRoot threading chain that 3fa180c added. The LI skip policy will silently load the wrong config when invoked from a non-`PROJECT_ROOT` cwd.
- The embedding pool slot is correct but informally specified (M3-NEW-3) — it's load-bearing for the entire DDD compliance story but has no JSDoc typedef and no runtime contract check.
- `summary-manager.js` (542) and `coreml-cascade.js` (645) are NEW file-size breaches; 4 indexing files grew further (acknowledged but not addressed).
- DDD_ARCHITECTURE.md is silent on the embedding slot pattern (the most significant architectural addition in this fix-pack).

**What would need to happen to reach A**:
1. Fix `check-boundaries.js` Section 4 shell escaping — replace with single-quoted shell args or rewrite in pure JS. Reduce the actual external bypass count to whatever is genuinely necessary (mostly diagnostic harnesses that should move under `tests/<domain>/`). [M3-NEW-1]
2. Add `projectRoot: PROJECT_ROOT` to the `buildLateInteraction` options bag at `indexer-phases.js:473`. One line. [M3-NEW-4]
3. Add a `@typedef EmbeddingPoolSlot` JSDoc declaration in `embedding-local-model.js` and a runtime shape check in `setEmbeddingPool`. Document the slot pattern in `DDD_ARCHITECTURE.md` with the same depth as the cascade subsection. [M3-NEW-3 + docs drift]
4. Convert `scripts/uninstall.js:19` to import via the infrastructure barrel like `scripts/init.js:23` does. One line. [M3-NEW-2]
5. Decompose `coreml-cascade.js` into state-inspection + tarball-fetcher halves to honor the 500-line target on a NEW file. [file-size]

None of these are blocking. The fix-pack is structurally sound and resolves all four prior findings within their stated scope. The grade B+ reflects: H1 is genuinely fixed, L1/L2/L3 are genuinely fixed, M3 is fixed for what it claimed to fix; but the broader CI gate (Check 4) was already broken and remains broken, and the projectRoot threading is one hop short of complete.
