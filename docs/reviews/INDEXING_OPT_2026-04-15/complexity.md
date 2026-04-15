# Indexing Optimization — Complexity, Maintainability, Cognitive Load Review

**Date**: 2026-04-15
**Branch / HEAD**: `main` @ `34089b2`
**Scope**: Delta vs `docs/reviews/INDEXING_REVIEW_2026-04-14.md` (the qe-queen-coordinator C+/B− review). Quantifies how the fix-pack (`34089b2`) and the CoreML cascade work (`cf04213`, `4fd9c9a`, `504ad66`, etc.) changed the cognitive load of the hot-path indexing modules. Read-only — no source modifications.

**Out of scope**: incremental indexing (`incremental-tracker.js`, `merkle-tracker.js`, `index-maintainer.mjs`, `incremental-parser.js`).

---

## 1. File-size breach table — prior vs current

`wc -l` (commit `34089b2`). Files in the in-scope set with material changes; 4 unchanged breaches noted in passing (`ast-chunker.js` 709, `indexer-build.js` 597, `indexer-utils.js` 536, `embedding-service.js` 712).

| File | Prior | Current | Δ | Breach (×500) |
|---|---:|---:|---:|---|
| `core/ranking/late-interaction-index.js` | 2162 | **2311** | **+149** | 4.6× |
| `core/indexing/artifact-builder.js` | 1059 | **1054** | −5 | 2.1× |
| `core/indexing/indexer-ann.js` | 903 | **951** | **+48** | 1.9× |
| `core/embedding/embedding-local-model.js` | ~845 | 845 | 0 | 1.7× |
| `core/ranking/late-interaction-model.js` | ~812 | 812 | 0 | 1.6× |
| `core/indexing/indexer-pool.js` | 696 | **746** | **+50** | 1.5× |
| `core/indexing/indexer-phases.js` | 627 | **706** | **+79** | 1.4× |
| `core/infrastructure/coreml-cascade.js` | (none) | **645** | NEW | **1.3× — NEW breach** |
| `core/graph/summary-manager.js` | <500 | **542** | NEW | **1.1× — NEW breach** |
| `core/infrastructure/model-fetcher.js` | 225 | **372** | **+147** | ok |
| `core/infrastructure/native-inference.js` | 229 | **379** | **+150** | ok |
| `core/infrastructure/hardware-capability.js` | (none) | **169** | NEW | ok |
| `crates/.../inference/coreml_shim.m` (Obj-C) | (none) | **604** | NEW | n/a |
| `crates/.../inference/embedding_model.rs` | 508 | **611** | +103 | (Rust 1.2×) |
| `crates/.../inference/li_model.rs` | 603 | **677** | +74 | (Rust 1.4×) |

`git show --stat 34089b2` confirms: 8 files, +679 / −100 lines. Of the 7 prior JS breaches, **4 grew** (LI index +149, indexer-ann +48, indexer-phases +79, indexer-pool +50); 1 shrank trivially via the C2 fix; 2 are unchanged. **Two new JS breaches**: `summary-manager.js` and `coreml-cascade.js`. The Rust inference modules each absorbed ~100 LOC of CoreML cascade plumbing.

The fix-pack commit message is honest: *"summary-manager.js is a NEW breach at 542 lines; 4 already-breaching files grew further. Decompositions deferred per the review punchlist."*

---

## 2. Cognitive hotspot ranking — worst 5 functions

LOC counts via `awk` over function ranges (comment lines = `^\s*//`). Branches via grep for `if`/`else`/`?`/`while` tokens.

| Rank | Function | LOC | Branches | env-vars | Strategies | Δ vs prior |
|---|---|---:|---:|---:|---:|---|
| 1 | `buildLateInteractionIndex` (`indexer-ann.js:518-878`) | **361** (70 cmt / 267 code) | ~61 | 5 | 3 | +21 LOC |
| 2 | `buildVectorsAndArtifactsPhase` (`indexer-phases.js:326-600`) | **275** (37 cmt / 212 code) | ~39 | 1 in body + 6 via helpers | 6 boolean axes | +5 LOC |
| 3 | `LateInteractionIndex.save()` (`late-interaction-index.js:1459-1685`) | **227** | ~28 | 0 | 3 save paths | +21 LOC |
| 4 | `planAllocation` (`indexer-pool.js:171-386`) | **216** (56 cmt / 150 code) | ~40 | 7 | 9 axes | ±0 (refactor split) |
| 5 | `LateInteractionIndex.load()` self-heal block (`late-interaction-index.js:1706-1793`) | **88 NEW LOC** | n/a | 0 | 2 self-heal branches | +88 LOC |

### #1 — `buildLateInteractionIndex` (361 LOC, ~61 branches)

Prior: 340 LOC at line 492. Current: 361 LOC at 518-878 (+21). New LOC: hybrid dispatcher 670-861 (192 lines), LI skip-policy invocation 548-562 (15), staging-aware `resetForSave` plumbing 611-616 (6). Three mutually-exclusive sub-strategies in one body (hybrid bidirectional / worker pool / inline single-encoder), 5 dynamic imports, 14+ locals at peak.

**Worst section** is 670-861: `runGpu`/`runCpu` arrow functions close over 5 mutable closure variables (`front`, `back`, `stats`, `profile`, `finalizeBatchResults`) with cursor invariants ("front advances, back retreats, no race because JS is single-threaded between awaits"). Comment block 795-814 explains the invariant well, but this is exactly where a bug would be invisible. **More readable than before only because the new comments are conscientious. Cognitive load +10-15%.**

### #2 — `buildVectorsAndArtifactsPhase` (275 LOC, +5 net)

New content: pre-warm at 448-463 (16 LOC, well-explained at 437-447), `stagedLateInteractionSegmentDir(...)` at 482, `atomicSwapLateInteractionIndex` at 565. Try/finally cleanup paths: 5 distinct (vector failure, HNSW failure, LI failure with rollback, pool shutdown, runtime reset).

**Biggest cognitive trap**: the 6-boolean `useEmbeddingPool` truth table at 384-395 — 4 dependent conditions (`forceEmbedCpu` → `queryTimeEmbedIsCpu` → `allowPoolWithParallelLi` → `useEmbeddingPool`). A reader follows the chain to know whether the pool is on. **Modestly worse than prior** because the function now owns crash-window management it didn't own before. Priority extraction target.

### #3 — `LateInteractionIndex.save()` (227 LOC, +21)

Three distinct save paths in one body: segmented fast (1469-1523), segmented full rewrite (1526-1611), and a 72-LOC legacy single-file dead branch (1613-1684) reachable only for tiny indexes. The staging-aware stub-basename ternary `this._finalIndexPath ? path.basename(this._finalIndexPath) + '.segments' : path.basename(segDir)` is **duplicated** at 1511-1513 and 1595-1597, no helper. Quiet invariant: `_segmentDir = segDir` assignments at 1519 (fast) and 1605 (full) update state asymmetrically — fast leaves `_segments[i].path` as relative basenames, full rewrites them as absolute joins. Refactors must preserve this asymmetry or break load-after-save round-trips. **Save is ~30% more work to read** because correctness depends on `resetForSave` having been called with the right options upstream.

### #4 — `planAllocation` (216 LOC, ±0 body change)

The function body is virtually unchanged (215 → 216 LOC), but two new helpers were extracted at the top of the file: `detectAppleSiliconTier()` (60-89, 30 LOC) and `planLateInteractionFromGpuTier()` (145-164, 20 LOC). The L2-cache-aware computation block at 312-346 is now wrapped behind these helper calls. **Net cognitive change: roughly neutral** — new logic added through extraction, not body widening. Comment-to-code ratio: 56/206 = 27% (above project average), most are "why" (env precedence, F32-vs-F16 dtype reasoning, tier-vs-RAM rationale). The historical `embeddingWorkers=1` justification at 192-202 is a tombstone from a prior round — candidate for `docs/RESOURCE_PLAN.md`.

### #5 — `LateInteractionIndex.load()` self-heal (NEW 88 LOC at 1706-1793)

Defensible (recovers from C1 broken state on existing dev machines) but **not separated** from the normal-load body — both share `state`, `segDirAbs`, `canonicalSegDir` locals. Two inline closures (`maybeMigrate` tolerates `ENOENT`/`EEXIST`/`ENOTEMPTY`/`EPERM`; `writeStubAtomic`). Two distinct self-heal branches: (a) stub records absolute `.tmp.segments` path, (b) stub points at non-existent dir + orphan `.tmp.segments` exists.

**Refactor (S, low risk)**: extract `_selfHealStaleSegmentDir(state, segDirAbs)` private method. Normal-load body shrinks from 207 to ~120 LOC; self-heal becomes individually testable. The C+ baseline grade did not account for these 88 LOC.

---

## 3. Duplication audit

**Three hybrid CPU+GPU dispatchers (M4, still unresolved)**:

| Site | LOC | Purpose |
|---|---:|---|
| `indexer-ann.js:670-861` | **192** | LI hybrid with `front`/`back` cursor + smart routing |
| `indexer-pool.js:559-705` (`LateInteractionPool`) | **147** | LI worker_threads pool (round-robin, postMessage) |
| `embedding-local-model.js:723-797` | **75** | Embedding hybrid (same `front`/`back` cursor pattern) |

`indexer-ann.js` (192) and `embedding-local-model.js` (75) implement the **same algorithm** — bidirectional cursor with `runGpu` (back--) and `runCpu` (front++). Differences are purely the encoder names and per-batch result shape. **A 30-line `bidirectionalCursor({batches, runFront, runBack})` helper would collapse both call sites.**

`LateInteractionPool` (147) is a different algorithm (worker pool, not GPU/CPU split) but shares **~140 LOC of mechanism** with `EmbeddingPool` (lines 399-557, 159 LOC) just above it: identical `init`, `_spawnWorker`, `_handleWorkerExit`, `shutdown`, round-robin, batch-id timeout, restart budget. **A shared `WorkerPoolBase` would collapse both into ~150 LOC + two ~30-LOC result-decoder overrides.**

Combined ROI: ~250 LOC saved out of ~535 (47% reduction). Neither is on the inner loop — refactor is safe.

**Other duplication**:
- `LI_ATTENTION_BUDGET` env var read in **two places** (`indexer-pool.js:349` AND `indexer-ann.js:170`), with an explicit "env wins" warning comment at `indexer-ann.js:158-168`. **L4 from the prior review, still unresolved.**
- `late-interaction-index.js::save()` has 2 copies of the stub-basename derivation (1511-1513 and 1595-1597), 4 LOC × 2.
- `cleanupStagedLateInteractionIndex` / `invalidateLateInteractionIndex` (`indexer-phases.js:60-72`) both unlink stub + `.bak` + segments dir, differing only in which path. ~10 LOC saved by parameterizing.

---

## 4. Env var sprawl

**Indexing-domain count**: `grep -roh 'process\.env\.SWEET_SEARCH_[A-Z_]*' core/indexing | sort -u | wc -l` → **24 unique** vars (same count as prior review, different mix). Repository-wide: **56 unique** across `core/`.

New env vars added by the fix-pack and cascade work (all verified at the cited sites):

| Var | Site | Purpose | Default |
|---|---|---|---|
| `SWEET_SEARCH_LI_L2_SAFETY` | `indexer-pool.js:335` | Multiplicative safety on usable L2 for weights-aware batch cap | 1.0 |
| `SWEET_SEARCH_LI_SKIP_DISABLE` | `li-skip-policy.js:149` | Bypass LI skip policy | unset |
| `SWEET_SEARCH_LI_SKIP_FILE` | `li-skip-policy.js:84` | Extra skip glob patterns file | unset |
| `SWEET_SEARCH_LI_MAX_FILE_TOKENS` | `li-skip-policy.js:154` | Per-file LI token cap | 50_000 |
| `SWEET_SEARCH_COREML_CASCADE` | `coreml-cascade.js:250,548` | Disable cascade dispatch + fetch (`=0`) | enabled |
| `SWEET_SEARCH_COREML_STATS` | `coreml_shim.m`, `embedding_model.rs:64`, `li_model.rs:61` | Per-variant CoreML dispatch counts on shutdown | unset |

**`docs/ENVIRONMENT.md`**: does not exist. **`--help` coverage**: only **1 of 24** indexing env vars is mentioned (`SWEET_SEARCH_SQLITE_FAST_MODE`, `index-codebase-v21.js:173`). Even the new `SWEET_SEARCH_LI_HYBRID` and `SWEET_SEARCH_LI_PROFILE` have no `--help` line. The prior review's 3 undocumented vars (`LI_CHARS_PER_TOKEN`, `LI_BATCHING_SAFETY`, `INDEXING_MAX_LENGTH`) are **still** undocumented. The L7 finding is materially worse: surface widened by 6 vars (4 LI + 2 CoreML), zero docs added.

---

## 5. Dead code status

| Symbol | Prior | Current |
|---|---|---|
| `buildHnswIndex` in-memory variant (`artifact-builder.js:281-371`) | dead | **still present**, 0 in-core callers, re-exported at `:1038`, only used by `tests/integration/indexer-vectors.integration.test.js` |
| `saveArtifacts` (`:528-536`) | dead | **still present**, 0 in-core callers, re-exported at `:1044` |
| `updateArtifacts` (`:700-779`) | dead AND BUGGY (C2) | **C2 fixed** at line 757 (now calls `buildAndSaveFloatStoreFromDb(db, ...)`); **still dead** — 0 in-core callers |
| `insertVectors` re-export | dead re-export | `indexer-build.js:292` defines, `index-codebase-v21.js:58,466` imports + re-exports; no out-of-module caller |
| `isVerboseMode` re-export | dead re-export | actually has live callers — **not dead anymore** |

**C2 was fixed inside dead code.** The function no longer throws ReferenceError, but it has no callers. The reasonable next step is to delete `buildHnswIndex`, `saveArtifacts`, and `updateArtifacts` outright — keep only `buildFromCodebaseDb` and `getArtifactStats`. Drops ~250 LOC from `artifact-builder.js` (1054 → ~800).

---

## 6. Test coverage of new code

| New / modified module | Test file | Tests | Adequate? |
|---|---|---:|---|
| `coreml-cascade.js` (NEW 645 LOC) | `tests/infrastructure/coreml-cascade.test.js` | **25** | Good — spec, eligibility, env opt-out, resolved-dirs, report, fetchCoremlCascade. No end-to-end `extractVariantTarball` (needs real tarball fixture). |
| `hardware-capability.js` (NEW 169 LOC) | `tests/infrastructure/hardware-capability.test.js` | **24** | Good — chip parser, all generations, M3+ threshold, cache invalidation. |
| `model-fetcher.js` H6 verification cache (~80 NEW LOC) | `tests/infrastructure/model-fetcher.test.js` | 11 (older) | **GAP — zero tests for the new code.** No test of `_verificationMemCache`, sidecar read/write, mem→disk fallback, rename-time invalidation, or SHA256 short-circuit. |
| LI staged-save (C1 fix) | `tests/indexing/li-staged-save.test.js` + `tests/indexing/late-interaction-segment-isolation.test.js` | **4 + 1** | Good — basename stub, staging-segment dir, basename load resolution, self-heal migration, "rebuild does not mutate live segments". |
| Summary disk-backup persistence (H2, 146 NEW LOC in `summary-manager.js`) | `tests/graph/backup-restore.test.js` | 16 (older + sidecar cleanup added at lines 57-62) | **GAP — orphan-recovery branch not tested.** No `it()` exercises "live DB empty + sidecar present → restore from sidecar". |
| H1 slot pattern (`setEmbeddingPool`/`getEmbeddingPool`/`clearEmbeddingPool` + lifecycle) | — | **0** | **GAP — untested.** Boundary checker validates direction but not slot semantics. |
| `planAllocation` Apple-Silicon tier path | `tests/indexing/indexer-resource-plan.test.js` | 2 | **GAP — new tier path not tested.** Existing 2 tests run with `gpuTier: { tier: 0 }` (RAM fallback only); no test of `detectAppleSiliconTier`, `planLateInteractionFromGpuTier`, or `LI_L2_SAFETY` override. |

**Net delta**: +49 tests (25+24) for CoreML cascade and hardware capability — strong. **Three meaningful gaps** remain on NEW behaviour: H2 orphan recovery, H6 verification cache, `planAllocation` GPU-tier. C1 is covered by 5 tests across two files (cross-confirmation).

---

## 7. Naming + abstraction critique

**`stagedLateInteractionSegmentDir(stagedStubPath)`** (`indexer-phases.js:56`) returns `stagedStubPath + '-stage.segments'`. Defensible but cryptic — a reader sees `-stage.segments` and asks "why not `.tmp.segments`?" The answer (the prior `.tmp.segments` aliased into the live path post-promote, causing C1) is in the docblock at lines 42-55. Risk: a maintainer who inlines `stagedStubPath + '.segments'` "to simplify" reintroduces C1. Section 8 seam #5 fixes this.

**`atomicSwapLateInteractionIndex`** vs **`atomicSwapDatabase`** (`indexer-phases.js:87-120`, 34 LOC) — specialized because LI is a stub + segments-dir pair. Rollback at 108-112 is correct; comment at 81-86 acknowledges the narrow rename window where rollback can fail (covered by load-time self-heal). **Conscientious**, but the concept "an index has multiple coupled atoms" leaks into the phases module. If a future index adds a third coupled file, this helper will silently miss it. A generic `atomicSwapPaths([...])` would generalize.

**Slot pattern (`setEmbeddingPool` / `getEmbeddingPool` / `clearEmbeddingPool`)** — direction is **good** (embedding owns slot, indexing owns lifecycle, H1 unblocked). Coupling is **loose**. Type contract is **weak**: no JSDoc typedef at `embedding-local-model.js:371-377`. A 5-line `@typedef {{ embed: (string[], object?) => Promise<Float32Array[]>, shutdown: () => Promise<void> }} EmbeddingPoolPort` would lock the contract and let tests build mocks without dragging in worker_threads. Disposal contract is underdocumented — `clearEmbeddingPool()` doesn't enforce "must shut down first".

**Minor**: `_finalIndexPath` and `looksLikeBrokenTmpState` (`late-interaction-index.js:1756-1758`) are good. `maybeMigrate(from, to)` (inline closure at 1726) is too generic — `tryRenameToleratingRaces` would be explicit.

---

## 8. Refactor seams ranked by ROI

| # | Seam | Effort | Expected gain | Risk |
|---|---|---|---|---|
| 1 | Delete dead `buildHnswIndex`/`saveArtifacts`/`updateArtifacts` from `artifact-builder.js` (~250 LOC) | **S** (~20 min) | `artifact-builder.js` 1054 → ~800. C2 fix becomes irrelevant (deleted with its function). One integration test needs migration to `buildFromCodebaseDb`. | Low |
| 2 | Consolidate 24 indexing env vars into `core/indexing/env-vars.js` + `--help` + `docs/ENVIRONMENT.md` | **S** (~1 hr) | Single source of truth; tests import constants instead of stringly-typed `process.env`; closes prior L7. | Low |
| 3 | Extract `_selfHealStaleSegmentDir(state, segDirAbs)` from `LateInteractionIndex.load()` (88 LOC) | **S** (~30 min) | Normal-load body 207 → ~120 LOC; self-heal individually testable; ~40% drop in load-path cognitive load. Existing `li-staged-save.test.js::self-heal` catches regressions. | Low |
| 4 | Decompose `planAllocation` into `planEmbeddingWorkers` + `planLiWorkers` + `planLiBatching` + `planLiAttentionBudget` helpers; top-level becomes ~30 LOC combiner | **M** (~2 hr) | Each of the 9 config axes becomes per-axis testable; env-var precedence becomes locally visible. | Low |
| 5 | Two-level staging layout for LI: `{live}.staging/{stub, segments/}` instead of dual-rename | **M** (~3 hr) | One filesystem rename promotes the whole index. Eliminates `atomicSwapLateInteractionIndex` (34 LOC), most of `load()` self-heal (~40 LOC), `stagedLateInteractionSegmentDir`. **−80 LOC net, simpler invariant.** | Medium — touches C1 hot fix; needs round-trip test. |
| 6 | Extract `bidirectionalCursor({batches, runFront, runBack})` helper from `indexer-ann.js` (192 LOC) and `embedding-local-model.js` (75 LOC) hybrid dispatchers (M4) | **M** (~2 hr) | Saves ~100 LOC across two sites; cursor algorithm becomes a 30-LOC pure function. | Medium — both on hot path. |
| 7 | Decompose `summary-manager.js` into `summary-store.js` + `summary-disk-backup.js` + `summary-restore.js` | **M** (~2 hr) | Each file under 250 LOC; H2 disk persistence becomes independently testable (closes coverage gap). | Low |
| 8 | Decompose `buildLateInteractionIndex` along `applySkipPolicy → selectLiEncoder → encodeBatches → finalize` seams | **M** (~3 hr) | Function shrinks 361 → ~120 LOC. | Medium |
| 9 | Decompose `coreml-cascade.js` (645 LOC) into `*-spec.js` + `*-state.js` + `*-fetch.js` | **M** (~2 hr) | Each file ~200 LOC; fetch logic isolatable for tests without real network. | Low |
| 10 | Extract `WorkerPoolBase` from `EmbeddingPool` + `LateInteractionPool` | **M** (~3 hr) | Saves ~140 LOC of duplicated mechanism (init, spawn, restart, round-robin, shutdown). | Low |
| 11 | Decompose `buildVectorsAndArtifactsPhase` along `prepareInferencePlan → preWarmNativeModels → runParallelStages → runHnsw → runArtifacts → runSparseGram` | **L** (~half day) | Function 275 → ~80 LOC; the 6-boolean truth table at 384-395 becomes a tested helper. | Medium — most error handling lives here. |
| 12 | Add `@typedef EmbeddingPoolPort` JSDoc + extract `_resolveStubBasename` helper from `save()` | **S** (~25 min) | Documents duck-typed contract; eliminates 8 LOC of duplicated stub-basename derivation. | None |

**Top 5 by ROI**: #1 (largest LOC delete per hour), #2 (closes L7), #3 (largest cognitive-load drop per hour), #4 (per-axis testability), #5 (eliminates a whole failure mode + 80 LOC).

---

## 9. Overall complexity grade

**Current**: **C+** (unchanged from prior review baseline).

Negatives:
- File-size breaches grew from 7 to **9**: 4 prior breaches grew further (LI index +149, indexer-ann +48, indexer-phases +79, indexer-pool +50), 2 new breaches (`summary-manager.js` 542, `coreml-cascade.js` 645), only 1 shrank trivially.
- Largest function (`buildLateInteractionIndex` 361 LOC, ~61 branches, 3 mutually-exclusive strategies) grew by 21 LOC.
- `load()` absorbed 88 LOC of self-heal not separated from the normal-load body.
- 3 duplicate hybrid dispatchers still unresolved (M4): ~415 LOC combined.
- 24 indexing env vars, 0 documented in `--help` or `docs/ENVIRONMENT.md` (the latter doesn't exist); +6 net new vars added.
- Dead code in `artifact-builder.js` (~250 LOC) survives — C2 was fixed *inside* dead code instead of deleting the dead code.

Mitigations (significant):
- The new code is *conscientiously commented*. C1 invariants are explained at every site (`indexer-phases.js:42-55, 74-86`; `late-interaction-index.js:374-385, 1588-1602, 1718-1725`). `planAllocation`'s F32-vs-F16 reasoning at `indexer-pool.js:312-346` is paper-quality. `coreml-cascade.js` has explicit design-invariant blocks (44-48).
- **+49 tests** for the two new modules (CoreML cascade 25, hardware-capability 24); C1 has 5 tests across 2 files (cross-confirmation).
- Apple-silicon tier extraction in `planAllocation` shows the right pattern — net cognitive load on that function is unchanged despite new behaviour, because the new logic was added through helpers rather than by widening the body.
- The fix-pack commit message is honest about deferred decomposition — correct prioritization, not poor engineering.

**Expected grade if seams #1-5 (the small + critical-impact ones) are executed**: **B+**. Together they delete 250 LOC of dead code, document env vars, drop load-path cognitive load by ~40%, make `planAllocation` per-axis testable, and eliminate the C1 dual-rename failure mode.

**Expected grade if all 12 seams executed**: **A−**. The medium/large refactors touch the indexing hot path and need round-trip benchmarks per `feedback_accuracy_nonnegotiable.md`. Sequence them across a sprint.

**A grade is unreachable without** decomposing `late-interaction-index.js`. At 2311 LOC and 4.6× the limit, it is the single largest file in scope; any A+ grade must address it. Natural seams: per-doc storage / per-segment storage / save / load / search / quantization / WUSH calibration. ~5-day refactor with extensive regression coverage.

---

**Methodology**: LOC via `awk` over function ranges (comment lines = `^\s*//`). Branches via grep for `if`/`else`/`?`/`while` tokens (±10% of an ESLint cyclomatic run). Env vars via `grep -roh 'process\.env\.SWEET_SEARCH_[A-Z_]*' core/indexing | sort -u`. Every metric has a `file:line` or `wc/grep` citation. The fix-pack made the right call: critical bugs first, decomposition next sprint.
