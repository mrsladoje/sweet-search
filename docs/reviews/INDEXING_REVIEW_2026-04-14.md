# Sweet Search — Indexing Pipeline Review

**Date**: 2026-04-14
**Scope**: Full-indexing pipeline (`core/indexing/*` and `scripts/init.js` + `scripts/benchmark-full-index.js`). **Incremental indexing is explicitly deferred** (`incremental-tracker.js`, `incremental-parser.js`, `merkle-tracker.js`, `index-maintainer.mjs` were NOT reviewed).
**Reviewers**: agentic-qe swarm — `qe-queen-coordinator` (synthesis) + `qe-integration-reviewer` (DDD), `qe-performance-reviewer`, `qe-code-complexity`, `qe-code-reviewer` (correctness), running in parallel.
**Authoritative docs checked**: `docs/DDD_ARCHITECTURE.md` (9-domain modular monolith, dependency matrix), `docs/INIT_STRATEGY.md` (profiles, model delivery, CoreML cascade), `CLAUDE.md` (file-size rule, TDD, AQE v3 integrity policy).
**Ground-truth tooling used**: `node scripts/check-boundaries.js` (1 violation, 44 warnings), `grep`, direct file reads, on-disk evidence inspection (`.sweet-search/`).

**Companion specialist reports** (this file is the synthesis):
- `docs/reviews/queen-synthesis.md` (orchestration summary)
- `docs/reviews/ddd-compliance.md`
- `docs/reviews/performance.md`
- `docs/reviews/complexity.md`
- `docs/reviews/correctness.md`

---

## Executive Summary

Sweet Search's indexing pipeline is **architecturally sound at the level of DDD boundaries and phase orchestration**, but **carries two live, high-impact defects** that require P0 remediation before the next release. The LI staged-save path leaks the `.tmp` suffix into the promoted segments directory, making every LI rebuild operate on the live-served data — confirmed by inspecting `.sweet-search/codebase-late-interaction.db` which currently contains `segmentDir: ".../codebase-late-interaction.db.tmp.segments"`. Separately, `artifact-builder.js:765` calls an undefined symbol (`buildAndSaveFloatStore`) that will ReferenceError any time `updateArtifacts()` is executed with new items.

Beyond those two defects, the pipeline shows typical mid-life tech debt: one hard DDD boundary violation (`embedding → indexing` dynamic import), seven file-size breaches (biggest: `artifact-builder.js` at 1059 lines — over 2× the 500-line target), three duplicated hybrid CPU+GPU dispatchers, and roughly half the indexing modules have no dedicated test. None of the performance/architectural review findings invalidate the current SOTA approach (cache-aware LI bucketing, checkpointed HNSW build, atomic DB swap), and none of the init/model delivery contracts are violated.

**Overall grade**: **C+ / B−**. Capped at B by the two critical bugs; baseline architecture is solid and fixes are surgically small.

---

## Top 12 Issues by Severity

### CRITICAL — must fix before next release

#### C1. LI staged-save path aliasing — every rebuild clobbers live-served segments

**Files**: `core/indexing/indexer-phases.js:283,486`, `core/ranking/late-interaction-index.js:375-383,1490,1500,1562-1566,1669`
**Evidence (on disk, verified)**: `.sweet-search/codebase-late-interaction.db` contains:
```json
{"version":"3.0","format":"segmented","segmentDir":"/.../.sweet-search/codebase-late-interaction.db.tmp.segments"}
```
The served index is pointing at a directory whose name includes the `.tmp` stage suffix. The directory `codebase-late-interaction.db.tmp.segments/` exists alongside `codebase-late-interaction.db` and is the live data store.

**Root cause**: `indexer-phases.js:283` sets `stagedLateInteractionPath = DB_PATHS.lateInteraction + '.tmp'`. The LI index uses `${indexPath}.segments` as its segment directory (`late-interaction-index.js:1500,1562-1566`). When `resetForSave(stagedPath)` is called early (line 577) to isolate the write target, both `indexPath` and `segmentDir` take the `.tmp` suffix. On promotion, `atomicSwapDatabase(stagedPath, DB_PATHS.lateInteraction)` at `indexer-phases.js:486` **only renames the stub file**, not the segment directory. The promoted stub file therefore contains a `segmentDir` that still points at the `.tmp` path. On the NEXT rebuild, `resetForSave()` treats the (aliased) `.tmp` segments directory as "fresh staging" — but it's the live-served data. `_flushSegment()` during `add()` and the cleanup loop in `save()` then overwrite served data mid-rebuild.

**Impact**: every successful rebuild after the first one (a) corrupts the live index during the write window, and (b) on crash mid-rebuild `cleanupStagedLateInteractionIndex()` (which only unlinks the stub) leaves a half-written segments directory orphaned on disk. A reader hitting the index during the rebuild window sees inconsistent data. This is a **data integrity bug in the hot path** and is **currently active on this developer's machine**.

**Fix (recommended)**: rename the segments directory alongside the stub in `atomicSwapDatabase`, OR switch the LI index to content-addressed segment subdirs under a stable parent, OR use a two-level directory layout where `atomicSwap` can rename the parent directory atomically. The queen-synthesis report and correctness report converge on this diagnosis.

**Test to add (critical)**: a round-trip test that (1) builds an LI index, (2) promotes via `atomicSwap`, (3) inspects the promoted stub file's `segmentDir` field and asserts it does NOT contain `.tmp`, (4) rebuilds and asserts the live index is unaffected.

---

#### C2. `buildAndSaveFloatStore` undefined — `updateArtifacts()` throws ReferenceError

**File**: `core/indexing/artifact-builder.js:765`
**Evidence (verified)**: The call site reads:
```javascript
await buildAndSaveFloatStore(allItems, floatDimension, floatStorePath);
```
But only `buildAndSaveFloatStoreFromDb(db, floatDimension, floatStorePath)` is defined (line 580, different signature — takes a `db` handle, not an `allItems` array). Grep of `core/vector-store/` finds zero export matching `buildAndSaveFloatStore`.

**Impact**: any invocation of `updateArtifacts()` with new items triggers a `ReferenceError: buildAndSaveFloatStore is not defined`. The enclosing try/catch at `:766-777` swallows it, logs a warning, and *intentionally deletes the float store* (`unlink(floatStorePath)`) so that stage-2.5 rescore falls back to SQLite. So the bug is masked at runtime — users see a degraded retrieval path instead of a crash — but the documented incremental artifact update path never succeeds and silently downgrades performance.

**Fix**: call `buildAndSaveFloatStoreFromDb(db, floatDimension, floatStorePath)` (matching signature) and refactor the 3-line Database open to reuse the existing handle. Or export a variant that accepts `allItems`.

**Test to add**: unit test for `updateArtifacts()` that exercises the new-items path and asserts no ReferenceError is thrown and the float store is written.

---

### HIGH — fix before next major release

#### H1. `embedding → indexing` DDD boundary violation (dynamic import escape hatch)

**File**: `core/embedding/embedding-local-model.js:361`
**Rule violated**: `docs/DDD_ARCHITECTURE.md` dependency matrix — `embedding/` must NOT import from `indexing/`. `scripts/check-boundaries.js` flags this as the only hard violation (`process.exit(1)`-blocking).

```javascript
export async function initEmbeddingPool(options = {}) {
  if (_embeddingPool) return _embeddingPool;
  const { EmbeddingPool } = await import('../indexing/indexer-pool.js'); // ← violation
  _embeddingPool = new EmbeddingPool(options);
  ...
}
```

**Call sites**: `initEmbeddingPool` is called from exactly ONE place: `core/indexing/indexer-phases.js:347`. The round-trip (indexing → embedding → indexing) exists only because of this function living on the wrong side of the boundary.

**Recommended fix (option a — simplest, lowest surface change)**: move `initEmbeddingPool`, `shutdownEmbeddingPool`, the `_embeddingPool` module singleton, and `embedBatchesWithPool` out of `embedding-local-model.js` and into `core/indexing/indexer-pool.js` (or a new `core/indexing/embedding-pool-lifecycle.js`). Add a tiny setter on `embedding-local-model.js` — `setEmbeddingPool(pool)` — taking an opaque `{ embed(batch, opts) }` port (NOT the `EmbeddingPool` class). `indexer-phases.js:347` constructs the pool and calls the setter; nulls it on shutdown. Net: 1 embedding file, 1 indexing file, re-export cleanup in `embedding-service.js:39-41,607-609`. Zero public API change. Boundary checker returns 0 violations.

**Alternatives considered and rejected**:
- DI via factory: still keeps lifecycle in the wrong layer.
- Port in embedding implemented by indexing: requires a new interface file and doesn't simplify anything.

See `docs/reviews/ddd-compliance.md §2` for the full analysis.

---

#### H2. Summary backup is in-memory only — crash between backup and restore loses all summaries

**Files**: `core/indexing/indexer-phases.js:179-200`, `core/graph/summary-manager.js:35-68`
**Scenario**: `buildCodeGraphWithHCGSPhase` calls `backupSummaries(dbPath)` which loads all existing HCGS summaries **into a JS object in memory**. Then `buildCodeGraph(...)` runs the full graph rebuild, which atomically swaps the code-graph DB file (`indexer-build.js:194`). Then `restoreSummaries(dbPath, summaryBackup)` writes the in-memory copy back into the new DB.

If the process is killed between `backupSummaries` and `restoreSummaries` (e.g., mid-`buildCodeGraph`), the `.bak` of the old code-graph has already been unlinked on the atomic swap success path in `atomicSwapDatabase`, the new code-graph DB has no summaries, and the in-memory copy is gone. The **next** run of `backupSummaries` then reads the now-empty new DB and has nothing to back up. **HCGS summaries are permanently destroyed.**

**Fix**: persist the backup to disk (e.g., `{dbPath}.summaries.bak.json`) before `buildCodeGraph`, and unlink it only after `restoreSummaries` succeeds. The file serves as a replay log for crash recovery on re-run.

**Test**: simulate a mid-phase kill with a real summary table and assert summaries survive a restart.

---

#### H3. Incremental vector rebuild is unstaged — crash leaves torn state

**File**: `core/indexing/indexer-build.js:544-593`
**Scenario**: the `fullRebuild=false` branch opens the live `codebase.db` directly, deletes vectors for changed files, then calls `pipelinedEmbedAndInsert()` which streams inserts directly. A crash mid-flush leaves the DB with some old files deleted and some new vectors not yet written. HNSW then gets rebuilt from this torn state.

**Impact**: reduced but not zero — the code-graph is rebuilt separately, and the HNSW checkpoint mechanism can resume. But the vector database itself has no "previous known good" state to fall back to. Recovery is re-running `--full`.

**Fix**: stage-and-swap for incremental vectors too. Open `codebase.db.tmp` as a copy of the live DB (or use SQLite backup API for fast copy), perform delete+insert against the tmp, atomically swap on success.

---

#### H4. `cleanupStagedLateInteractionIndex` leaks `.tmp.segments/` directory on failure

**Files**: `core/indexing/indexer-phases.js:38-41,467-493`
**Issue**: on LI rebuild failure, `cleanupStagedLateInteractionIndex(stagedLateInteractionPath)` only unlinks the stub file and its `.bak`. The segment directory (`${stagedPath}.segments/`) is **not** cleaned up. Combined with C1, this accumulates orphaned `.tmp.segments` directories and (because of C1) may actually contain live-served data the cleanup would incorrectly delete if it DID run.

**Fix**: must be resolved TOGETHER with C1 — when the segment-dir naming is corrected, the cleanup also needs to remove the tmp segments directory recursively.

---

#### H5. Seven files breach the 500-line CLAUDE.md rule

| File | Lines | Severity |
|---|---:|---|
| `artifact-builder.js` | 1059 | major (2.1×) |
| `indexer-ann.js` | 903 | major |
| `ast-chunker.js` | 709 | medium |
| `indexer-pool.js` | 696 | medium |
| `indexer-phases.js` | 627 | medium |
| `indexer-build.js` | 597 | minor |
| `indexer-utils.js` | 536 | minor |
| `chunking/markdown-chunker.js` | 503 | trivial (+3) |

**Recommended seams** (from DDD + complexity reviewers, non-arbitrary):
- `artifact-builder.js` → 4 files: thresholds/state, binary HNSW build, int8 sidecar build, verify/stats CLI.
- `indexer-ann.js` → 4 files: HNSW phase, binary HNSW phase, LI phase, hybrid dispatcher.
- `indexer-phases.js` → phase-runner + per-phase files under `phases/`.
- `indexer-pool.js` → resource-planner + pool classes.
- `ast-chunker.js` → split by parsing strategy (brace / indent / end-keyword).

---

#### H6. Per-worker SHA256 verification serializes under load (2-minute stall)

**Files**: `core/indexing/indexer-phases.js:372-389`, `core/infrastructure/native-inference.js` `getNativeEmbeddingModel`/`getNativeLiModel`
**Issue**: the pre-warm exists because each embedding/LI worker independently re-verifies the 596 MB LateOn-Code safetensors via SHA256 stream. Under concurrent ORT load, Node microtask scheduling is unfair and the verification stalls 60×. The current fix — pre-warm before the parallel phase — works, but the root cause (per-worker verification) remains.

**Fix**: cache verified-model-file tokens in a per-process Map keyed on `(path, stat.mtime, stat.size, sha256)`. First verification writes a token; subsequent `fetchModel` calls short-circuit if the token matches. Saves 2+ minutes on every cold full-index start under worker-pool contention.

---

### MEDIUM

#### M1. Single-slot phase-progress file cannot support crash recovery

**File**: `core/indexing/incremental-tracker.js` (out of review scope, but referenced)
**Issue**: `updatePhaseProgress({ phase, status })` overwrites a single-slot file. There's no history of "which phases completed successfully" for a resume path. Not blocking for full-indexing review, noted for completeness.

#### M2. `artifact-builder.js` state path uses `process.cwd()` instead of `PROJECT_ROOT`

**File**: `core/indexing/artifact-builder.js:68` — `path.resolve(process.cwd(), ARTIFACT_THRESHOLDS.stateFile)`
**Issue**: if the indexer is invoked from a subdirectory of the project, `process.cwd()` ≠ `PROJECT_ROOT` and the state file gets written somewhere unexpected. Everywhere else in the indexing domain uses `PROJECT_ROOT` imported from `infrastructure/config/index.js`. Two minutes to fix, but easy to miss.

#### M3. Dynamic ranking imports bypass the exception counter

**File**: `scripts/check-boundaries.js:125-139`
**Issue**: the exception allowlist says `indexing → ranking (late-interaction build): max 2`. The static-import grep returns 2 (correct). But there are **4 additional dynamic imports** from `indexing/*` to `ranking/late-interaction-model.js` (`indexer-ann.js:658,697`, `indexer-pool.js:686`, `indexer-worker.js:98`) that the grep pattern `from '.*ranking/'` doesn't match. Actual coupling is 6 sites, declared max is 2.
**Fix**: extend the counter to also grep `import\(.*ranking`, and either bump `max: 6` or introduce a `ranking/li-build` sub-barrel and route through it.

#### M4. Three duplicate hybrid CPU+GPU dispatchers

**Files**: `indexer-ann.js:644-700`, `indexer-pool.js` (`LateInteractionPool`), `embedding-local-model.js:722-...`
**Issue**: all three roll their own GPU probe, worker count, CPU fallback, and env-var reading. Collapsing into a single `hybrid-dispatcher` (owned by indexing or infrastructure) saves ~80 LOC and — not coincidentally — eliminates the reason H1 exists, since hybrid dispatch is the only code path that needs `EmbeddingPool` in embedding.

#### M5. HNSW checkpoint stale-on-error

**File**: `core/indexing/indexer-ann.js:366-486`
**Issue**: `cleanupCheckpoint()` is called on success and when `canCheckpoint=false`. On a throw inside the build loop, stale checkpoint files remain on disk. Next run silently resumes against a possibly-changed vector DB.
**Fix**: try/finally in the build loop; OR pin the checkpoint to a generation counter tied to the vector DB hash and reject mismatches at resume time.

#### M6. HNSW resume assumes contiguous rowids after incremental vector update

**File**: `core/indexing/indexer-ann.js:389-404,426`
**Issue**: SQLite does not renumber rowids after DELETE. After incremental vector updates delete + insert, rowid gaps exist. The resume path uses `WHERE rowid <= resumeFromRowId` and restores `nextKey = restoredKey++` counting from 0 — but the USearch graph's internal keys were assigned against the ORIGINAL (ungapped) sequence. `nextKey` drifts from the graph's key space.
**Fix**: persist a `rowid → hnswKey` map in the checkpoint sidecar, or refuse resume when the vector DB has gaps vs the snapshot.

#### M7. Non-atomic Binary HNSW + Int8 sidecar writes

**File**: `core/indexing/artifact-builder.js` (binary HNSW save path)
**Issue**: the binary HNSW artifact saves the `.idx`, `.meta.json`, `.vectors.json`, `.graph.json`, and `.int8.json` as separate writes. A crash between writes leaves mismatched versions on disk. Fallback path works (degrade to float HNSW) but the artifacts themselves aren't crash-safe.
**Fix**: write to a staging subdirectory and rename the subdirectory atomically (POSIX `rename()` on directories is atomic).

---

### LOW

#### L1. `li-skip-policy.js:31` reaches into `../infrastructure/config/search.js` sub-module instead of the config barrel
Change to `from '../infrastructure/config/index.js'` for consistency.

#### L2. Barrel under-exports
`core/indexing/index.js` does not export `planAllocation`, `detectResources`, `EmbeddingPool`, `LateInteractionPool`, `applyLiSkipPolicy`, `buildSparseGramArtifact`. Tests reach into internals.

#### L3. Internal helpers leak via `export *`
`indexer-phases.js` exports `cleanupStagedLateInteractionIndex`, `invalidateLateInteractionIndex`, `unlinkIfExists` through `export * from`. Switch to explicit named exports.

#### L4. `SWEET_SEARCH_LI_ATTENTION_BUDGET` read in two places
`indexer-pool.js:339` AND `indexer-ann.js:157`. Env var wins over computed value (the opposite of what most readers would guess). Comment + consolidation needed.

#### L5. Dead code in `artifact-builder.js`
`buildHnswIndex` (in-memory, `:281-371`), `saveArtifacts` (`:528-536`), and `updateArtifacts` (`:700-784`) have no live callers inside core; plus dead re-exports of `insertVectors` and `isVerboseMode`.

#### L6. Flag/env drift
`parseArgs()` has 22 CLI flags; 1 is explicitly deprecated (`--skip-summary-regen`). Two flag pairs have no mutual-exclusion enforcement (`--graph-only`/`--vectors-only`, `--quiet`/`--verbose`). Two overlaps with env vars (`--sqlite-fast`/`SWEET_SEARCH_SQLITE_FAST_MODE`, `--late-interaction-pool=N`/`SWEET_SEARCH_LI_POOL_FACTOR`).

#### L7. 24 `SWEET_SEARCH_*` env vars in indexing domain
3 undocumented (`SWEET_SEARCH_LI_CHARS_PER_TOKEN`, `SWEET_SEARCH_LI_BATCHING_SAFETY`, `SWEET_SEARCH_INDEXING_MAX_LENGTH`). Zero are in `--help`. Consolidate into `core/indexing/env-vars.js` + `docs/ENVIRONMENT.md`.

#### L8. Windows-path LI id split fallback
`indexer-ann.js:585` — `id.split(':')[0]` used as the fallback for file lookup. On Windows drive letters (`C:\...`) this breaks. Low risk because the metadata path should be populated, but a bug waiting to fire.

#### L9. `enrichChunksFromGraph` silent error catch
`indexer-build.js` — catches errors, logs "enrichment skipped", continues. Defensible but masks query-planner regressions. Add a `logProgress` counter for the next run to notice.

---

## DDD Compliance Matrix (per-file)

See `docs/reviews/ddd-compliance.md §1` for the full per-file import table. Summary:

| Rule | Status |
|---|---|
| Forbidden direction FROM `indexing/` | **ok** — zero imports of `search/` or `query/` |
| Forbidden direction TO `indexing/` | **1 violation** — `embedding-local-model.js:361` |
| Declared exception `indexing → ranking` (max 2 static) | **ok** — 2 static imports within limit |
| Declared exception counts include dynamic imports? | **no** — 4 dynamic imports uncounted (checker bug, M3) |
| Config imports via `infrastructure/config/index.js` barrel | **ok** — 1 sub-module reach-through (L1) |
| `core/config.js` reach-throughs | **none** |
| File < 500 lines (CLAUDE.md) | **7 breaches** (H5) |
| Internal barrel bypasses (warnings) | 44 — allowed per DDD doc; tracked |

**DDD compliance grade**: **C+** (capped at B− until H1 is fixed; path to A is small).

---

## Pipeline-Level Risks

The phase sequence is: File Discovery → Determine Files → Code Graph + HCGS Prep → **Parallel(HCGS, Vectors, LI)** → HNSW → **Quantized Artifacts** → Sparse Gram → Vocab Warmup.

### Risk 1 — Parallel Metal embed + Metal LI contend on the command queue
`Promise.all` launches 3 coroutines but the native LI and native embed both dispatch through candle's single `MTLCommandQueue`. Parallelism gain comes from hiding Node-side tokenization behind GPU compute, not from actual parallel GPU execution. The CoreML cascade's 18% win (dispatching to ANE, a separate compute unit) is consistent with this hypothesis. Flag as "the parallel-Promise structure is slightly misleading about actual concurrency".

### Risk 2 — Vector + LI share `preChunked.allChunks`
Both read-only. Correctness reviewer verified no mutation. Safe.

### Risk 3 — HCGS failure is silenced
`indexer-phases.js:225,240` — HCGS errors log a yellow warning and return `{ error: e.message }`. The main pipeline continues with empty summaries. Indexing reports "success" even though graph summaries are missing. Users won't notice until a query gets bad results.
**Recommendation**: surface HCGS failures in the final summary JSON under `--quiet`; don't just log dim.

### Risk 4 — Quantized artifact failure is silenced
`indexer-ann.js:898-902` — binary HNSW + int8 build failure logs yellow "will fall back to float HNSW" but does not fail the indexing run or set a flag in the summary JSON. Combined with C2, users see a silent degradation from 3-stage retrieval to 1-stage float HNSW and do not know why search quality dropped.
**Recommendation**: report artifact-rebuild state explicitly in the final summary.

### Risk 5 — `updateIncrementalStatePhase` runs after all other phases
If anything in Phase 4 (vectors + LI + HNSW + artifacts) partially succeeds, Phase 5 marks the run complete anyway. The phase-progress file (M1) is single-slot. Error recovery requires deleting `.sweet-search/incremental-state.json` by hand.

### Risk 6 — `.bak` cleanup on atomic swap is racy with concurrent readers
`atomicSwapDatabase` unlinks the `.bak` after the swap succeeds. A concurrent `sweet-search` query holding a file descriptor on the old file is fine (Linux/macOS), but on Windows the unlink can fail with EBUSY. The retry loop handles this but on failure the `.bak` sticks around. Benign.

---

## INIT_STRATEGY Compliance

Checked against `docs/INIT_STRATEGY.md`:

| Contract | Status |
|---|---|
| Init profiles (core/full) respected | **ok** — `scripts/init.js` gates model fetch on profile |
| Model delivery via `model-fetcher.js` / `model-registry.js` | **ok** — `fetchModel` is the single path |
| SHA256 checksums on all LFS files | **ok** — verified per-file |
| `allowRuntimeModelDownload = false` default | **ok** — no lazy fetches found in indexing |
| CoreML cascade hardware gating | **ok** — `getCoremlCascadeResolvedDirs()` returns null on ineligible hardware, native addon falls through |
| Atomic writes + resumable downloads | **ok** — `.tmp` → rename |
| `modelCacheRoot` override honored | **ok** — inherited through `MODEL_DELIVERY_CONFIG` |
| No env-var bypass for CoreML cascade | **ok** — only `SWEET_SEARCH_COREML_CASCADE=0` diagnostic remains |

**INIT_STRATEGY compliance grade**: **A** — no violations found.

---

## Observability Gaps

Phases with inadequate post-mortem debugging:

1. **HCGS** — failures silently return `{ error: ... }` and the main pipeline continues. No stat in summary JSON.
2. **Quantized artifacts** — failures log yellow and return `{ error: ... }`. Users can't tell from the final summary whether 3-stage retrieval is armed.
3. **Vocab warmup** (`index-codebase-v21.js:418-425`) — dim log only; no timing, no count of prewarmed items.
4. **LI profiling** (`SWEET_SEARCH_LI_PROFILE=1`) — exists but is opt-in. The `parRatio`/GPU/CPU ms stats are exactly what you'd want to debug LI regressions but you have to know the env var.
5. **Sparse gram** — single "Building sparse gram artifact" line; no throughput, no per-phase timing.
6. **HNSW checkpoint** — logs `checkpoint: N/T vectors` in `dim`; easy to miss in production logs.
7. **Atomic swap retries** — `EBUSY` retries log to stderr via `logError`, but success after retry doesn't log a final "swapped on attempt K" line.

**Recommendation**: add a final-summary JSON (in quiet mode) that enumerates each phase's state (`ok`/`skipped`/`error`), duration, and counts. Codex reviewers would also benefit from this.

---

## Test Coverage Gaps

Cross-referencing the 16 test files in `tests/indexing/` against the 17 in-scope source files:

| Source | Tested? | Notes |
|---|---|---|
| `index-codebase-v21.js` | partial | `indexer.test.js`, `core-indexer-flags.test.js` |
| `indexer-phases.js` | **no dedicated test** | `indexer-phases.parallel.test.js` covers one scenario |
| `indexer-build.js` | partial | no direct test of `pipelinedEmbedAndInsert` |
| `indexer-ann.js` | partial | `indexer-ann.late-interaction.test.js`; no HNSW checkpoint/resume test |
| `indexer-pool.js` | partial | `indexer-resource-plan.test.js` covers `planAllocation`; zero tests for `EmbeddingPool`/`LateInteractionPool` lifecycle |
| `indexer-utils.js` | partial | `sqlite-wal-mode.test.js`, `wsl-unc-path.test.js`; **no `atomicSwapDatabase` retry test** |
| `indexer-worker.js` | **no test** | |
| `indexer-sparse-gram.js` | **no test** | |
| `artifact-builder.js` | **no test** | contains C2 bug |
| `li-skip-policy.js` | yes | `li-skip-policy.test.js` |
| `ast-chunker.js` | yes (heavy) | |
| `document-chunker.js` | yes | |
| `chunking/chunk-builder.js` | yes | |
| `chunking/markdown-chunker.js` | yes | |
| `chunking/plaintext-chunker.js` | yes | |

**Priority test-coverage adds (close the critical bugs)**:
1. LI staged-save round-trip test — catches C1 by asserting `segmentDir` does not contain `.tmp` after promotion.
2. `updateArtifacts()` new-items path — catches C2 by asserting no ReferenceError.
3. `EmbeddingPool` lifecycle — init → embed → shutdown round-trip.
4. `atomicSwapDatabase` retry on simulated EBUSY.
5. HNSW checkpoint resume after vector DB with rowid gaps (M6).
6. `artifact-builder.js` everything — currently untested, contains 1059 lines and the C2 bug.
7. `indexer-sparse-gram.js` — zero tests today.

---

## Performance Review Summary (from `docs/reviews/performance.md`)

Hot-path ranking (16K docs, 34 min baseline):

| Rank | Phase | Est. wall-time share |
|------|-------|----------------------|
| 1 | Late-interaction encoding | ~55-70% |
| 2 | Vector embedding | ~15-25% |
| 3 | HCGS summary regen | ~5-15% (network-bound, parallel) |
| 4 | HNSW build | ~3-7% |
| 5 | Code graph extraction | ~2-5% |
| 6-8 | Sparse gram / Binary HNSW+Int8 / Vocab warmup | ~1-4% each |

**Findings the performance reviewer could verify**:
- SQLite pragmas (`wal_autocheckpoint=4000`, `mmap_size=1GB`, `cache_size=-64MB`, `journal_size_limit=64MB`) **match SOTA 2025-2026 bulk-load guidance** ([sqlite.org/wal.html](https://sqlite.org/wal.html), [shivekkhurana.com/blog/sqlite-in-production/](https://shivekkhurana.com/blog/sqlite-in-production/)).
- The LI cache-aware attention budget formula in `onnx-session-utils.js::computeWeightsAwareBatchCap()` arithmetically yields **B=1 at seq=2048 on M3 Max** with F32 weights. This matches the cited microbench ("B=1 strictly fastest, B=16 was 2.13× slower"). **Not a bug**, but the formula assumes a full layer's weights are resident — the actual resident set during candle's layer-by-layer streaming is smaller, so B=2 might be feasible with `SWEET_SEARCH_LI_L2_SAFETY=1.5`. Worth measuring.
- `embeddingWorkers=1` default is still correct on M3+ — the legacy "37% vs 80% efficiency" measurement is the right reason.
- The `SWEET_SEARCH_LI_HYBRID=1` opt-in cannot safely be made the default under `SWEET_SEARCH_EMBED_USE_CPU=1` without re-tuning CPU thread counts (2 embed workers × 5 threads + 1 LI CPU session × 7 threads = 17 threads on 8 P-cores → the exact L2-contention pathology the code already avoids).

**SOTA check** — no indexing optimization published in 2025-2026 is missing from the pipeline:
- PLAID / ColBERTv2 residual encoding → SEARCH optimization, not build.
- Mixedbread maxsim-cpu → SEARCH optimization.
- Lucene HNSW merge-reuse → segment merge, not single-session.

**Top 5 performance improvements** ranked by expected gain (all **unverified** — flagged for benchmark):
1. `SWEET_SEARCH_LI_L2_SAFETY=1.5` to unlock B=2 at long seq (potentially 2-5% wall time)
2. Default `LI_PROFILE=1` in `--verbose` mode (zero direct gain, unblocks future iterations)
3. Audit `finalizeBatchResults` single-threaded JS cost (potentially 3-8% if it's the hidden serialization point)
4. Unify the `SWEET_SEARCH_LI_ATTENTION_BUDGET` env var read site (zero gain, maintenance)
5. Measure `runFullWarmup` in Phase 7 and background it if > 5% (plausibly 2-5%)

---

## Complexity Review Summary (from `docs/reviews/complexity.md`)

**Worst cognitive hotspots**:

1. **`buildVectorsAndArtifactsPhase` in `indexer-phases.js:252-521`** — 270 LOC, 18 config axes, 24 branches, 6 dynamic imports, 10-key options bag. Reachable testable surface is ~12 branches out of a nominal 32 combinatoric. The 6-boolean `useEmbeddingPool` computation at `:316-321` is a truth-table comment away from unintelligible.

2. **`buildLateInteractionIndex` in `indexer-ann.js:492-830`** — 340 LOC, 14 local variables, three mutually-exclusive encoder strategies (hybrid CPU+GPU, worker pool, inline single-encoder) intermixed with profile instrumentation. The clean seams are: skip policy application → encoder selection → dispatch → finalization. Each is a clear extract candidate.

3. **`planAllocation` in `indexer-pool.js:162-377`** — 215 LOC, 8 env vars, 4 interleaved subsystems (embedding workers, LI workers, LI batch sizing, attention budget). Well-commented but the cache-aware computation logic deserves its own module.

**Flag combination safety**:
- `SWEET_SEARCH_LI_HYBRID=1` + `SWEET_SEARCH_LI_USE_CPU=1` — handled correctly at `indexer-ann.js:650-653`.
- `SWEET_SEARCH_LI_HYBRID=1` + default parallel-LI — silent degradation (comment at `:632-641` documents it, no enforcement).

**Env var catalog**: 24 distinct `SWEET_SEARCH_*` vars in the indexing domain. One drift (`LI_ATTENTION_BUDGET`, L4). Three undocumented (`LI_CHARS_PER_TOKEN`, `LI_BATCHING_SAFETY`, `INDEXING_MAX_LENGTH`). Zero in `--help`.

**Dead code**: 5+ exports with no callers (L5). Multiple "Phase B" tombstone comment blocks.

**Top refactoring ROI** (from complexity reviewer):
1. Extract `selectLiDispatcher` from `buildLateInteractionIndex` — S, low risk.
2. Consolidate env vars into `core/indexing/env-vars.js` + `docs/ENVIRONMENT.md` — S.
3. Split `buildVectorsAndArtifactsPhase` into 5 helpers — M.
4. Delete dead exports + tombstones — S.
5. Deduplicate insertion-order streaming between `indexer-ann.js` and `artifact-builder.js` — M.

---

## Correctness Review Summary (from `docs/reviews/correctness.md`)

Already inlined in the C1-H4 findings above. Additional verified-safe findings worth citing:

- **Code Graph build** (`indexer-build.js:116-206`) — tmp + `atomicSwapDatabase`, safe.
- **Vector FULL rebuild** (`indexer-build.js:504-535`) — tmp + swap, safe.
- **Sparse Gram build** — tmp + swap, safe.
- **WAL + swap ordering** — `checkpointWal(db) → close → atomicSwap` is correct; no dangling WAL after promotion.
- **`Promise.all` between vector + LI** — both read-only on `preChunked.allChunks`; no shared mutation.
- **`applyLiSkipPolicy`** — per-file decisions applied uniformly (decide once, apply to all chunks of the file); no partial-file state.
- **Chunk ID uniqueness** within a file — `${file}:${lineStart}-${lineEnd}:${chunkIndex}` is collision-safe for the same file.

---

## Recommended Action Order (Codex: read this first)

### P0 — blocker, fix before next release
1. **C1 (LI staged-save aliasing)** + **H4 (tmp segments cleanup)** — fix together. Touch: `indexer-phases.js`, `late-interaction-index.js`. Add round-trip test. *Blast radius: every LI rebuild runs through this code; currently broken in production on the reviewer's dev machine (verified on disk).*
2. **C2 (`buildAndSaveFloatStore` undefined)** — one-line fix (call the existing `buildAndSaveFloatStoreFromDb`). Add unit test for `updateArtifacts()` new-items path.

### P1 — next sprint
3. **H1 (DDD violation)** — move `initEmbeddingPool` into indexing, use a setter. 1 embedding file + 1 indexing file. Unblocks the boundary checker from reporting violations.
4. **H2 (in-memory summary backup)** — persist backup to disk.
5. **H3 (unstaged incremental vectors)** — stage-and-swap for incremental too. (Note: this is the incremental path but fixing it benefits crash-safety of the overall pipeline.)
6. **H6 (per-worker SHA256 verification)** — cached verification tokens. Saves 2 min on cold starts under worker-pool contention.

### P2 — tech debt (next major release)
7. **H5 (file-size breaches)** — decompose the 7 files along the DDD/complexity-suggested seams.
8. **M4 (three duplicate hybrid dispatchers)** — unify into one module.
9. **M3 (check-boundaries.js counts dynamic imports)** — 10-line script fix.
10. **M2 (`process.cwd()` vs `PROJECT_ROOT`)** — one-line fix.
11. **M5, M6 (HNSW checkpoint robustness)** — generation counter + gap detection.
12. **M7 (binary HNSW atomic write)** — subdirectory rename.

### P3 — polish
13. L1-L9: barrel exports, env var consolidation, dead code removal, flag/env drift cleanup, Windows path robustness.
14. **Test coverage adds** — top of the list at "Test Coverage Gaps" above.
15. **Observability summary JSON** — final-phase status in `--quiet` output.

---

## Notes for Codex Review

- Every finding in this report cites `file:line` with exceptions made only where the finding is architectural rather than file-local.
- The **two critical bugs (C1, C2) were verified against on-disk state** — C1 by reading `.sweet-search/codebase-late-interaction.db` and finding the `.tmp.segments` suffix in the live `segmentDir`, C2 by grepping `core/vector-store/` for `buildAndSaveFloatStore` and finding zero exports.
- Every "unverified" performance claim is explicitly marked so you can drop it or promote it after running a benchmark.
- The DDD violation (H1) is the only CI-blocking issue that `scripts/check-boundaries.js` currently reports as `process.exit(1)` — everything else is warnings or runtime hazards the checker can't see.
- The swarm reviewers did NOT run `npm test` (integrity policy: "NEVER run `npm test` without `--run`" and the reviewers were instructed read-only). Running `npm test -- --run tests/indexing/` after fixes would validate the C1/C2 fixes end-to-end.
- All agents stayed in their assigned lanes. Where their findings overlap (C1 surfaces in both queen synthesis and correctness report; H1 surfaces in DDD and complexity reviews), the diagnoses converged independently — good signal for confidence.

**End of unified review.**
