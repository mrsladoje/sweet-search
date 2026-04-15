# Complexity Review — Full Indexing Pipeline

Scope: `core/indexing/` full-index path. Read-only. 2026-04-14.
Excluded: `incremental-*`, `index-maintainer.mjs`.

## 1. Per-file Hotspots (> 400 lines)

### `indexer-phases.js` (627)

1. **`buildVectorsAndArtifactsPhase`** — `indexer-phases.js:252-521`. ~270 LOC. 8 gate booleans, 4 nested try blocks, 3 distinct `Promise.all`/sequential paths, 10-key options bag. Walk-through in §2. Seam: `planVectorPhaseResources`, `preWarmNativeModels`, `runVectorAndLi`, `promoteOrInvalidateLi`, `runPostVectorArtifacts`.
2. **`buildCodeGraphWithHCGSPhase`** — `:168-250`. Fuses backup/restore summaries, marking for regen, and a dynamic-import IIFE (`:230-245`). Seam: `preserveExistingSummaries` / `markEntitiesForRegeneration` / `scheduleHcgsSummaryPromise`.
3. **`determineFilesToIndexPhase`** — `:104-166`. Three mutually-exclusive modes cascaded with shared fallthrough; three early-exit sites. Seam: dispatch by mode, each returning the same `{filesToIndex, incrementalInfo, earlyExit, exitReason}` shape.

### `indexer-ann.js` (903)

1. **`buildLateInteractionIndex`** — `:492-830`, ~340 LOC. Audited in §3.
2. **`buildHNSWIndex`** — `:334-486`. Checkpoint-resume block (`:379-417`) interleaved with insertion loop; time-based flush logic inside the stream (`:449-469`). Seam: `tryResumeFromCheckpoint()` + `maybeWriteCheckpoint()`.
3. **`incrementalUpdateHNSW`** — `:235-328`. Fuses load-or-create, removal of changed metadata, and SQLite row streaming. Seam: three helpers with those names.

### `indexer-build.js` (597)

1. **`buildVectorIndex`** — `:442-597`. Two ~80% duplicated `if (fullRebuild) {…} else {…}` branches; journal-mode/schema/pipeline/close are copy-pasted. Seam: `openVectorDbForBuild(fullRebuild, sqliteFastMode)` returning a common handle.
2. **`enrichChunksFromGraph`** — `:40-110`. Inner loop with 4 nested conditionals, two cache maps, inline hash-ID reconstruction (`:81`). Seam: `resolveFileEntityId()` + `computeScopeChainForChunk()`.
3. **`pipelinedEmbedAndInsert`** — `:322-377`. **Nine positional parameters** — reader burden. Seam: single `options` object; extract progress-wiring at `:343-348`.

### `indexer-pool.js` (696)

1. **`planAllocation`** — `:162-377`, ~215 LOC. 8 env vars, 15 derived values, 4 interleaved tiering subsystems. See §4.
2. **`LateInteractionPool.encodeDocuments`** — `:623-683`. Hand-decodes an ArrayBuffer layout that mirrors the packing at `indexer-worker.js:111-138` across a process boundary with no contract test. Seam: shared `indexer-worker-protocol.js`.
3. **`_handleWorkerExit`** duplicated at `:453-468` and `:607-621`. Seam: `RestartablePool` base.

### `indexer-utils.js` (536)

1. **`getGitIgnoredPathSet`** — `:379-435`. Symlink pre-filter (`:392-414`) has 4-level inner conditional logic. Seam: `partitionPathsBySymlinks(paths)`.
2. **`discoverFiles`** — `:480-535`. Mixes discovery, gitignore alignment, size filter, and telemetry. Seam: `discoverAndFilter` + `logDiscoveryTelemetry`.
3. **`readFilesFromStdin`** — `:212-279`. Promise wiring + normalization + WSL UNC + abs→rel + dedup + quiet-mode error reporting. Seam: pure `parseStdinLines(raw, projectRoot)`.

### `artifact-builder.js` (1059)

1. **`buildFromCodebaseDb`** — `:598-688`. Orchestrator OK, but pairs with `buildHnswIndexFromDb` (`:378-492`) that re-implements insertion-order logic already present in `indexer-ann.js:64-117`. Two independent implementations of diversity-first permutation. Seam: `core/indexing/vector-stream.js`.
2. **`buildHnswIndex` (in-memory)** vs **`buildHnswIndexFromDb` (streaming)** at `:281-371` and `:378-492`. The first is dead (§6); only the second is live. Two implementations of the same logic drift in lockstep.
3. **`updateArtifacts`** — `:700-784`. Silently triggers full rebuild on *any* removal (`:718-728`) via a stub "TODO: remove not yet implemented" path. Three exit routes. Unclear whether ever exercised.

### `ast-chunker.js` (709)

1. **`parseBraceBasedFile`** — `:108-154`. Inner loop mutates `braceDepth/currentChunk/chunkStart/stripState` across 4-way branching; joined-line handling re-strips inside the same loop. Seam: `advanceBraceDepthForLine()` + `consumeJoinedLines()`.
2. **`_stripNonCode`** — `:359-454`. 95-line state machine with 5 modes, depth-4 nesting. Inherently a state machine; dispatch-table refactor is the right seam.
3. **`_splitAtSubBoundaries`** — `:518-581`. Duplicates the brace/strip state machine from `parseBraceBasedFile`. Seam: share `updateDepthAndStrip()`.

## 2. `buildVectorsAndArtifactsPhase` Control Flow

`indexer-phases.js:252-521`.

**Config axes branched on** (18 total): `dryRun`, `filesToIndex.length>0`, `EMBEDDING_CONFIG.provider==='local'`, `shouldParallelLI` (`:268`), `forceEmbedCpu` (`:310`), `queryTimeEmbedIsCpu` (`:311`), `liOnMetal` (`:314`), `allowPoolWithParallelLi` (`:315`), `resourcePlan.useWorkerPool` (`:319`), `useEmbeddingPool` (`:316-321`), `noLateInteraction`, `fullReindex`, `incrementalInfo!=null`, `hcgsPromise!=null`, `preChunked.allChunks.length>0||filesToRemoveFromLI.length>0`, `liPromise!=null`, `liOutcome.ok`, `forceArtifacts`.

**Combinatoric size.** Five independent macro-flags reshape the pipeline: `isNativeInferenceAvailable()`, `EMBED_USE_CPU`, `noLateInteraction`, `parallelLateInteraction`, `useWorkerPool`. Nominally 32 configurations; some unreachable (`useWorkerPool` gated by `queryTimeEmbedIsCpu`). Reachable testable surface ≈ 12 branches. `tests/indexing/indexer-phases.parallel.test.js` exercises only parallel-LI ON/OFF; embed-CPU-with-pool, native-unavailable, and hybrid are covered only indirectly via `indexer-ann` tests.

Testable *in principle* — all deps go through module imports vitest can mock — but the function is too long for any one test to enumerate interesting branches. Refactor in §10 is a prerequisite.

**Invalid-combo check:**

- `SWEET_SEARCH_LI_HYBRID=1 + SWEET_SEARCH_LI_USE_CPU=1`: **handled correctly**. `indexer-ann.js:650-653` sets `hybridDisabled = !hybridEnabled || SWEET_SEARCH_LI_USE_CPU==='1'`; CPU-only wins, hybrid silently suppressed.
- `SWEET_SEARCH_LI_HYBRID=1 + noLateInteraction`: LI branch gated on `!noLateInteraction`, hybrid code never runs. Correct.
- `SWEET_SEARCH_EMBED_USE_CPU=1` without native inference: `liOnMetal=false`, `allowPoolWithParallelLi=false`; `useEmbeddingPool` still suppressed via `!shouldParallelLI`. Correct but untested.
- `SWEET_SEARCH_LI_HYBRID=1 + parallel-LI default-ON`: comment at `indexer-ann.js:632-641` says hybrid is only useful with parallel-LI OFF, but nothing in code enforces it — user gets a silently-degraded pipeline (GPU queue contention). **Flag-enforcement gap.**
- `SWEET_SEARCH_LI_BATCH_SIZE=0`, `SWEET_SEARCH_LI_ATTENTION_BUDGET=0`: both treated as override-disabled; consistent.

**Smells**: staged-LI cleanup duplicated at `:441,:467,:490`; `:473-482` mutates `liOutcome.ok/.error` in place, silently racing the "parallel returned ok=true with null result" check at `:484`.

## 3. `buildLateInteractionIndex` Seams

`indexer-ann.js:492-830`.

Burden: 14 function-scope locals; three mutually-exclusive encoder strategies (`hybrid` / `pool` / `inline`) with separate lifecycle (`liPool`), different encoder signatures, and two profile-instrumentation blocks (`:705-720`, `:774-798`) orthogonal to control flow. Four dynamic imports (`:522, :543, :657, :684, :697`).

Proposed shape:

```
skip          = applyLiSkipPolicy(chunks, projectRoot)   // exists
liIndex       = createLiIndex(opts)                      // :543-578
removedCount  = removeExistingDocs(liIndex, filesToRemove) // :580-593
batches       = buildLateInteractionBatches(kept, ...)   // exists
dispatcher    = selectLiDispatcher(hybridEnv, workerCount) // :642-700 → {kind,run}
encodeAndFinalize(batches, dispatcher, liIndex, profile) // :702-816
saveLiIndex(liIndex, saveToPath, loadFromPath)           // :819-829
```

`selectLiDispatcher` is the big win: it isolates hybrid-probe + pool-fallback + inline-fallback behind a uniform `{kind, run(batches, finalize)}` handle. After split, `buildLateInteractionIndex` is ~80 LOC of sequencing. Each piece becomes trivially testable with a fake `liIndex` + fake encoder.

## 4. `planAllocation` Env-Var Contract

`indexer-pool.js:162-377` reads (directly):

| Var | Purpose | Documented? |
|---|---|---|
| `SWEET_SEARCH_EMBEDDING_WORKERS` | Override embed worker count (max 4) | Inline `:184-194`. Not in `--help`. |
| `SWEET_SEARCH_EMBED_USE_CPU` | Force ORT CPU embed alongside Metal LI | Inline `:187-192`; also read `indexer-phases.js:310`. Not in `--help`. |
| `SWEET_SEARCH_LI_WORKERS` | Override LI worker count | Inline `:227-229`. |
| `SWEET_SEARCH_LI_BATCH_SIZE` | Override GPU-tier LI batch | Inline `:252-256`. |
| `SWEET_SEARCH_LI_TOKEN_BUDGET` | Override LI token budget | Inline `:281-291`. |
| `SWEET_SEARCH_LI_ATTENTION_BUDGET` | Cap attention FLOPs | Inline `:318-320`; **also read at `indexer-ann.js:157`** with a different fallback default. |
| `SWEET_SEARCH_LI_L2_SAFETY` | Multiplicative L2 cache safety | Inline `:321`. |

All are reconstructible from in-module comments — `planAllocation` is internally self-documenting. But `--help` mentions **none** of the 7. Only `SWEET_SEARCH_SQLITE_FAST_MODE` and `SWEET_SEARCH_LI_POOL_FACTOR` surface there, via flag aliases. `docs/INDEXING_ARCHITECTURE.md` mentions `SWEET_SEARCH_EMBED_USE_CPU` 3×; no single source of truth for the env-var surface anywhere in `docs/`.

## 5. Full Env-Var Catalog

`grep -n 'process.env.SWEET_SEARCH_' core/indexing/` — **24 distinct vars** (prefix `SWEET_SEARCH_` omitted below):

| Var | Read at | Purpose | Doc |
|---|---|---|---|
| `UV_THREADPOOL_SIZE` | `index-codebase-v21.js:36-37` | Libuv pool (hybrid only) | Inline `:29-38` |
| `LI_POOL_FACTOR` | `index-codebase-v21.js:98` | Default for `--late-interaction-pool` | `--help` via flag |
| `SQLITE_FAST_MODE` | `index-codebase-v21.js:101` | `--sqlite-fast` alias | `--help` |
| `EMBED_USE_CPU` | `indexer-phases.js:310,379`; `indexer-pool.js:197` | Force ORT CPU embed | Inline only (3 readers, consistent) |
| `EMBEDDING_WORKERS` | `indexer-pool.js:195` | Embed worker override | Inline |
| `LI_WORKERS` | `indexer-pool.js:222` | LI worker override | Inline |
| `LI_BATCH_SIZE` | `indexer-pool.js:236` | LI batch override | Inline |
| `LI_TOKEN_BUDGET` | `indexer-pool.js:237` | LI token budget override | Inline |
| `LI_ATTENTION_BUDGET` | `indexer-pool.js:340`; `indexer-ann.js:157` | Cap attention FLOPs | Inline; **DRIFT — different fallback defaults** |
| `LI_L2_SAFETY` | `indexer-pool.js:326` | L2 safety factor | Inline |
| `LI_SKIP_DISABLE` | `li-skip-policy.js:149` | Disable LI skip | Header |
| `LI_SKIP_FILE` | `li-skip-policy.js:84` | Extra LI skip globs | Header |
| `LI_MAX_FILE_TOKENS` | `li-skip-policy.js:154` | Per-file LI cap | Header |
| `LI_CHARS_PER_TOKEN` | `indexer-ann.js:120` | Token estimator calibration | **UNDOCUMENTED** |
| `LI_BATCHING_SAFETY` | `indexer-ann.js:121` | Token estimate safety | **UNDOCUMENTED** |
| `LI_QUANT_BITS` | `indexer-ann.js:551` | LI quant bits | Inline `:549-551` |
| `LI_WHT_SEED` | `indexer-ann.js:552` | WHT seed | Inline `:550` |
| `LI_WHT_ORDERING` | `indexer-ann.js:553` | WHT ordering | Inline `:550` |
| `LI_HYBRID` | `indexer-ann.js:648` | Hybrid CPU+GPU LI | Inline `:622-641` |
| `LI_USE_CPU` | `indexer-ann.js:653` | Force single-CPU LI | Inline `:651-653` |
| `LI_PROFILE` | `indexer-ann.js:705` | LI batch timing | Inline `:702` |
| `INDEXING_OUTPUT_DIMENSION` | `indexer-build.js:481` | Remote embed output dim | **UNDOC**; silently no-op for local |
| `EMBEDDING_CONCURRENCY` | `indexer-build.js:492` | Remote embed concurrency | **UNDOC**; remote-only |
| `INDEXING_MAX_LENGTH` | `indexer-worker.js:30` | Tokenizer max length | **UNDOC**; read only in worker — ignored on inline fallback |

### Drift / overlap / consumer gaps

1. **`LI_ATTENTION_BUDGET` drift**: `planAllocation` (`:340`) falls back to cache-bound compute; `buildLateInteractionBatches` (`:157-169`) falls back to `floor(batchSize/2) * maxLength²`. When the var is unset but `planAllocation` is bypassed (tests, one-off tools), results diverge.
2. **Hybrid/CPU flag cluster**: `LI_HYBRID`, `LI_USE_CPU`, `EMBED_USE_CPU` all reshape CPU/GPU dispatch; no combined validator or documentation of the matrix.
3. **`INDEXING_OUTPUT_DIMENSION` / `EMBEDDING_CONCURRENCY`**: silently no-op on local provider (the common path). Not called out anywhere.
4. **`INDEXING_MAX_LENGTH`**: read *only inside* `indexer-worker.js:30`. Main-thread/inline fallback path has no equivalent. Consumer drift — the setting is honored on some paths and ignored on others depending on `useEmbeddingPool`.

## 6. Dead Code

1. **`buildHnswIndex`** (in-memory) — `artifact-builder.js:281-371`. Only referenced by the module's own default export (`:1043`); no external caller. Live path uses `buildHnswIndexFromDb`. **Dead.**
2. **`saveArtifacts`** — `artifact-builder.js:528-536`. No external caller; `buildFromCodebaseDb` inlines `await hnswIndex.save()`. **Dead.**
3. **`updateArtifacts`** — `artifact-builder.js:700-784`. No caller in `core/indexing/`. Contains the "silent full rebuild on removal" trap at `:724`. **Dead.**
4. **`batchQuantizeToInt8` / `quantizeToBinary` / `batchQuantizeToBinary`** — `artifact-builder.js:220-268`. Called only by the module's own CLI test command (`:1007,1016`) and one unit test. Not on the indexing hot path. **Live-only-in-tests.**
5. **`insertVectors`** — `indexer-build.js:292-320`. Re-exported via `index-codebase-v21.js:466` for backward compatibility; runtime path uses `pipelinedEmbedAndInsert`. Tests define local copies rather than import. **Dead at runtime.** (`ensureVectorSchema`/`createVectorSchema` are still live via `buildVectorIndex`.)
6. **`isVerboseMode`** — `indexer-utils.js:98`. Exported but never imported. **Dead export.**
7. **`getArtifactStats` / `verifyArtifacts`** — `artifact-builder.js:792-917`. Used only by `artifact-builder.js` CLI subcommands. Not on indexing hot path. **Live-only-in-CLI.**

**Tombstones**:

- `index-codebase-v21.js:91,158,302-305`; `indexer-phases.js:190-194` — `--skip-summary-regen` flag marked deprecated; still parsed.
- `artifact-builder.js:494-513` — "DEPRECATED — Use .int8.json sidecar" block with only comments, no code.
- `artifact-builder.js:830-844` — warning about `DB_PATHS.int8Vectors` presence; no removal target date.
- `indexer-ann.js:227-229` — "applyInsertionOrder and diversityFirstPermutation … removed in Phase B".

## 7. CLI Dispatch — `parseArgs`

`index-codebase-v21.js:82-104`. **22 flags.**

| Concern | Detail |
|---|---|
| Deprecated | `--skip-summary-regen` (`:91,158,302-305`) — explicit DEPRECATION. Just delete. |
| Unenforced mutex | `--graph-only` + `--vectors-only` both settable — undefined behavior. `--quiet` + `--verbose`: order-sensitive (`setVerboseMode` at `:122` silently overrides). |
| Flag/env overlap | `--late-interaction-pool=N` ↔ `SWEET_SEARCH_LI_POOL_FACTOR` (flag wins via `\|\|` at `:98`). `--sqlite-fast` ↔ `SWEET_SEARCH_SQLITE_FAST_MODE` (either wins). No conflict, but both pairs deserve a single documented precedence rule. |

Other flags are unique and match their `--help` text.

## 8. Error-Handling Consistency

Total try/catch in in-scope files ≈ 105. Classification by pattern:

**Swallow + fallback** (notable cases, not all safe):
- `indexer-phases.js:225-227, 240-244` — HCGS marking/run failures log warning, proceed with 0 or error object; **HCGS failures are invisible to CI** (no non-zero exit).
- `indexer-phases.js:351-354, 386-388` — pool init + native pre-warm failures: legitimate fallback with visible warnings.
- `indexer-phases.js:478-481` — sequential-LI fallback mutates `liOutcome.ok/.error` in place; see §2.
- `indexer-ann.js:259-262` — HNSW load failure → "creating new". Corruption erases "no prior index" vs "corrupt" distinction.
- `indexer-ann.js:676-678` — **empty catch** on hybrid probe (by design per `:677`); no log → hard to diagnose.
- `indexer-ann.js:898-902` — quantized artifact failure logs warning, indexing reports success. **Policy hole** — CI can't see a broken artifact phase. Add a `status:'degraded'` field in quiet-mode JSON.
- `indexer-build.js:163-164` — `catch { errors++; }` counts parse errors without messages — no per-file diagnostics.
- `indexer-build.js:427-429` — corrupt `code-graph.db` only shows a one-line warning.
- `artifact-builder.js:765-777` — float-store rebuild failure **deletes stale store** to force clean fallback. Right policy; model for others.

**Thrown upward**: `runPhase` wraps into `{success,error}` at `indexer-phases.js:52-66`; vector/HNSW errors rethrow after staged-LI cleanup at `:442,468`; `indexer-sparse-gram.js:95-97` rethrows after cleanup; `indexer-utils.js:186` restores backup and rethrows on non-EBUSY swap failure.

**Per-phase verdict**: Code graph consistent; Vectors silently counts parse errors; HNSW erases "missing vs corrupt"; LI staged-temp pattern is correct; Artifacts too forgiving; Sparse gram consistent with LI; HCGS silently degrades.

## 9. Testability (0-10)

| File | Score | Blocker |
|---|---|---|
| `li-skip-policy.js` | 9 | Pure + cache reset hook. Already tested. |
| `document-chunker.js` | 9 | Pure dispatch. |
| `ast-chunker.js` | 7 | Tree-sitter provider is a hidden dep (`:85`). |
| `indexer-sparse-gram.js` | 7 | Mockable native addon + SQLite. |
| `indexer-utils.js` | 6 | Heavy on FS + `git` subprocess; pure helpers are trivial. |
| `indexer-pool.js` | 5 | `planAllocation` is pure; pool classes need `Worker` + ORT. |
| `indexer-build.js` | 4 | SQLite, model-info singleton, `PROJECT_ROOT` singleton, embeddings service. |
| `artifact-builder.js` | 4 | Heavy SQLite streaming + BinaryHNSWIndex + FloatVectorStore + sidecar FS. |
| `index-codebase-v21.js` | 4 | `parseArgs` trivial; `main()` is process-level. |
| `indexer-phases.js` | 3 | `buildVectorsAndArtifactsPhase`: 270 LOC, 24 branches, 6 dynamic imports, mutates `LATE_INTERACTION_CONFIG` indirectly. |
| `indexer-ann.js` | 3 | `buildLateInteractionIndex`: dynamic imports at `:522,543,657,684,697` don't play well with `vi.mock` unless hoisted. |
| `indexer-worker.js` | 3 | Entry point for `worker_threads`; integration-only. |

**Top-5 least testable**:

1. `indexer-phases.js::buildVectorsAndArtifactsPhase` — 270 LOC, 24 branches, 6 dynamic imports.
2. `indexer-ann.js::buildLateInteractionIndex` — 340 LOC, 4+ dynamic imports, three encoder strategies intermixed with instrumentation.
3. `artifact-builder.js::buildFromCodebaseDb`+`buildHnswIndexFromDb` — tightly coupled to real `BinaryHNSWIndex`/`FloatVectorStore`/SQLite; no seam for in-memory iterator.
4. `indexer-build.js::buildVectorIndex` — full/incremental fork with inlined WAL + atomic swap.
5. `indexer-ann.js::buildHNSWIndex` — checkpoint-resume interleaved with insertion stream; can't be tested without a real USearch checkpoint.

## 10. Refactoring Plan (ROI-Ordered)

Ranked by impact ÷ risk.

### 1. Extract `selectLiDispatcher` from `buildLateInteractionIndex` — **S**

File: `indexer-ann.js:642-700`. Hoist hybrid-probe + pool-fallback + inline-fallback into a single function returning `{kind, run(batches, finalizeBatchResults)}`. Replaces the `useHybrid` fork at `:746-813`. **Impact: high** (enables unit tests on encoder selection; isolates the `LI_HYBRID`/`LI_USE_CPU`/native-available interaction). **Risk: low** (pure move). **Effort: S**.

### 2. Consolidate env-var surface into one module + doc — **S**

New `core/indexing/env-vars.js` + `docs/ENVIRONMENT.md`. Typed getters (`getLiAttentionBudget`, `getEmbeddingWorkers`, …). Delete the duplicated `LI_ATTENTION_BUDGET` parse at `indexer-ann.js:157`. Replaces 24 scattered reads with named imports. Cures the drift in §5, surfaces the 3 undocumented vars (`LI_CHARS_PER_TOKEN`, `LI_BATCHING_SAFETY`, `INDEXING_MAX_LENGTH`). **Impact: med-high**. **Risk: low** (unit tests on the new module pin behavior). **Effort: S**.

### 3. Split `buildVectorsAndArtifactsPhase` into 5 named helpers — **M**

File: `indexer-phases.js:252-521`. Extract `planVectorPhaseResources`, `preWarmNativeModels`, `runVectorAndLiInParallel`, `promoteOrInvalidateLi`, `runPostVectorArtifacts`. Top-level becomes a ~60-line sequencer. **Impact: high** (unlocks targeted tests per config axis; removes the three-site staged-LI cleanup duplication). **Risk: medium** (lots of local-state plumbing between helpers). **Effort: M**.

### 4. Delete dead exports + tombstones — **S**

Remove: `buildHnswIndex` in-memory (`artifact-builder.js:281-371`); `saveArtifacts` (`:528-536`); `updateArtifacts` (`:700-784`); DEPRECATED tombstones at `:494-513, :830-844`; `isVerboseMode` (`indexer-utils.js:98`); `--skip-summary-regen` + both deprecation warnings (`index-codebase-v21.js:91,158,302`, `indexer-phases.js:190-194`); the `insertVectors` re-export at `index-codebase-v21.js:466` if no external consumers; the "Phase B" tombstone at `indexer-ann.js:227-229`. **Impact: medium** (reduces surface, cuts drift-prone duplicates). **Risk: low-medium** (verify `tests/integration/barrel-contracts.test.js` still passes). **Effort: S**.

### 5. Deduplicate insertion-order streaming — **M**

Files: `indexer-ann.js:64-117` (`streamVectorsFromDb`) vs `artifact-builder.js:378-492` (inline version in `buildHnswIndexFromDb`). Hoist `createOrderedVectorStream(db, {order, idColumn})` into a new `core/indexing/vector-stream.js`; both callers iterate it. **Impact: medium** (two independent bug surfaces for the same logic; historically one side already missed a fix, per the Phase-B tombstone). **Risk: medium** (HNSW build hot path; needs regression on real vectors). **Effort: M**.

---

**Summary.** Correctness scaffolding is sound (staged-temp paths, pre-warm, GPU-tier sizing). Cognitive weight concentrates in `buildVectorsAndArtifactsPhase` and `buildLateInteractionIndex` — nearly untestable as written. The env-var surface is the biggest operability gap: 24 vars, 3 undocumented, 1 drifting (`LI_ATTENTION_BUDGET`), zero in `--help`.
