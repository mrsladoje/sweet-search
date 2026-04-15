# Queen Synthesis — Sweet Search Full-Indexing Pipeline Review

**Reviewer**: QE queen coordinator (strategic, integration-level view)
**Scope**: `core/indexing/` (excluding incremental-specific files per brief), `scripts/init.js`, `scripts/benchmark-full-index.js`
**Date**: 2026-04-14
**Mode**: Read-only evidence review. Every claim cites `file:line`.

> **Specialist reports note**: At the time of writing, none of the four specialist reports
> (`ddd-compliance.md`, `performance.md`, `complexity.md`, `correctness.md`) had landed in
> `docs/reviews/`. This synthesis is therefore the primary reference; section 8 is stubbed
> with instructions for re-synthesis once the specialist outputs arrive.

---

## 1. Executive Summary

The indexing pipeline is structurally sound and an impressive piece of engineering:
the phase decomposition is crisp, the resource allocator in `indexer-pool.js` is
genuinely cache-aware, and the staging/atomic-swap pattern for SQLite artifacts is
correctly applied to `code-graph.db` and `codebase.db`. The DDD compliance story is
overwhelmingly clean — one forbidden dynamic import is the only hard violation.

However, two deploy-blocker issues hide in the pipeline, both in code paths that are
rarely exercised by the happy-path benchmark. First, the staged late-interaction save
leaks its `.tmp` suffix into the promoted index's `segmentDir`, so every subsequent
rebuild **deletes the live segments directory before writing new ones** — confirmed
against the live `.sweet-search/codebase-late-interaction.db` stub. Second,
`artifact-builder.js:765` calls an undefined function `buildAndSaveFloatStore` on the
`updateArtifacts()` incremental path — confirmed via `node -e import()` that no such
symbol is exported. These are both **critical** and the pipeline happens to work today
only because the happy-path full-index run avoids them.

Beyond the bugs, the pipeline's phase-progress/crash-recovery story is weak (a single
`{phase, status}` record instead of a per-phase map), three files breach the 500-line
rule significantly, and the artifact-rebuild state file is path-scoped to `process.cwd()`
which breaks threshold accounting when invoked from subdirectories.

---

## 2. Top Issues by Severity

### CRITICAL (deploy blocker / data-integrity risk)

#### C1. Staged LI save leaks `.tmp` path into promoted `segmentDir` — every rebuild deletes live segments

**Evidence**
- `core/indexing/indexer-phases.js:283` — `stagedLateInteractionPath = DB_PATHS.lateInteraction + '.tmp'`
- `core/indexing/indexer-ann.js:576-578` — `liIndex.resetForSave(saveToPath)` where `saveToPath = <...>.db.tmp`
- `core/ranking/late-interaction-index.js:375-383` — `resetForSave` sets `this.indexPath = newIndexPath` and clears `_segmentDir`
- `core/ranking/late-interaction-index.js:1500` — `const segDir = this.indexPath + '.segments';` → `<...>.db.tmp.segments`
- `core/ranking/late-interaction-index.js:1562-1566` — stub writes absolute `segmentDir: segDir` into the promoted file
- `core/indexing/indexer-phases.js:486` — `atomicSwapDatabase(stagedLateInteractionPath, DB_PATHS.lateInteraction)` renames **the stub only**; the segments directory keeps its `.tmp.segments` name
- **LIVE PROOF**: `/Users/admin/Projects/sweet-search-private/.sweet-search/codebase-late-interaction.db` currently contains:
  ```json
  {"version":"3.0","format":"segmented",
   "segmentDir":"/Users/admin/Projects/sweet-search-private/.sweet-search/codebase-late-interaction.db.tmp.segments"}
  ```
  and `ls .sweet-search/` shows `codebase-late-interaction.db.tmp.segments` but no `codebase-late-interaction.db.segments`. The staged name leaked into the live state.

**Why this is a data-integrity issue**
1. On next rebuild, `load()` reads the stub → resolves `_loadSegmented(<stagedName>.segments)` → loads from the stale-suffix directory (works, data is there).
2. `resetForSave(<...>.db.tmp)` points `this.indexPath` back at the `.tmp` name.
3. `save()` at `late-interaction-index.js:1500-1509` derives `segDir = this.indexPath + '.segments'` = **the exact same absolute directory as the live-served segments**, then iterates `fs.readdir(segDir)` and **`unlink`s every file** before writing fresh ones.
4. If a `SweetSearch` process reads during this window, it gets partial or missing segment files. Even worse, if the rebuild crashes after the unlink loop but before writing new segments, the live index is permanently corrupted until a full reindex.

**Rule broken**: CLAUDE.md integrity rule ("never run destructive operations without confirmation that they don't affect live state"), plus the basic atomicity contract that indexing is supposed to provide.

**Concrete fix**
- Preferred: `save()` should NEVER write an absolute `segmentDir`. Write `segmentDir` as a basename (`"codebase-late-interaction.db.segments"`), and `_loadSegmented` should resolve it via `path.resolve(path.dirname(this.indexPath), state.segmentDir)`. Then a single `fs.rename(<...>.db.tmp.segments, <...>.db.segments)` promotes both the stub and the data dir.
- Alternative: After `atomicSwapDatabase` on the stub, also rename the `.segments` directory to match, and **rewrite** the stub to point at the new absolute path. This is uglier but preserves the current on-disk format.
- Either way, `cleanupStagedLateInteractionIndex` and `invalidateLateInteractionIndex` in `indexer-phases.js:38-46` MUST also `rm -rf` the `.tmp.segments/` directory — today they only unlink two files.

---

#### C2. `updateArtifacts()` calls undefined `buildAndSaveFloatStore` — runtime ReferenceError on any incremental artifact update

**Evidence**
- `core/indexing/artifact-builder.js:765` — `await buildAndSaveFloatStore(allItems, floatDimension, floatStorePath);`
- `core/indexing/artifact-builder.js:580` — only `buildAndSaveFloatStoreFromDb(db, floatDimension, floatStorePath)` is defined (different signature — takes `db`, not `allItems`)
- Verified by runtime import:
  ```
  $ node -e "import('core/indexing/artifact-builder.js').then(m => console.log(typeof m.buildAndSaveFloatStore))"
  undefined
  ```
- Ripgrep across the entire repo finds **only** `buildAndSaveFloatStoreFromDb` defined. `buildAndSaveFloatStore` is not defined, imported, or exported anywhere.

**Rule broken**: AQE v3 integrity policy ("always run actual tests, not assume they pass"). This code path has never been exercised — `phase5-artifacts.integration.test.js` must not cover `updateArtifacts()` with a non-empty `newItems` list.

**Concrete fix**
- Rewrite the `updateArtifacts()` float-store branch to call `buildAndSaveFloatStoreFromDb` with an opened DB handle, mirroring `buildFromCodebaseDb` at lines 653-655.
- Add a test to `tests/indexing/phase5-artifacts.integration.test.js` that exercises `updateArtifacts([<newItem>], [])` end-to-end.
- Separately, **whether this code path is even reachable from the live pipeline** needs checking — `indexer-phases.js` goes through `buildQuantizedArtifactsPhase` → `buildFromCodebaseDb` (full rebuild), never `updateArtifacts`. If it truly is dead code, delete it rather than fix it.

---

### HIGH (must-fix before next major release)

#### H1. Forbidden dynamic import `embedding → indexing` — breaks DDD dependency direction

**Evidence**
- `scripts/check-boundaries.js` output (verified live):
  ```
  VIOLATION [embedding → higher] (dynamic):
    core/embedding/embedding-local-model.js:361: const { EmbeddingPool } = await import('../indexing/indexer-pool.js');
  ```
- `core/embedding/embedding-local-model.js:359-365` — `initEmbeddingPool()` lazy-imports `EmbeddingPool` from `../indexing/indexer-pool.js`
- `core/indexing/indexer-phases.js:19-22` — imports `initEmbeddingPool` *from* `embedding-local-model.js` and calls it at line 347

**Rule broken**: `docs/DDD_ARCHITECTURE.md` dependency matrix (table at line 65): `embedding` may import `infrastructure` only. Dynamic `import()` doesn't bypass the rule.

**The design is inverted**: `indexer-phases.js` owns pool lifecycle (it calls `initEmbeddingPool` + `shutdownEmbeddingPool`), and `EmbeddingPool` lives in `indexing/`, but the factory function sits in `embedding/`. The cleanest fix: move `initEmbeddingPool`/`shutdownEmbeddingPool`/`getEmbeddingPool` from `embedding-local-model.js` into `core/indexing/indexer-pool.js` (or a new `core/indexing/embedding-pool-facade.js`), and re-export them from the indexing barrel. `embedding-local-model.js` doesn't need pool-lifecycle knowledge — it exposes `callLocalModel(texts, options)` which the pool's `_inlineFallback` already calls (line 533-537) via a dynamic import in the other direction, which is allowed.

**Concrete fix**
1. Move `_embeddingPool` state variable + `initEmbeddingPool` + `shutdownEmbeddingPool` + `getEmbeddingPool` + `embedBatchesWithPool` (4 functions, ~40 lines) from `core/embedding/embedding-local-model.js:356-394` into `core/indexing/indexer-pool.js`.
2. Update `core/indexing/indexer-phases.js:19-22` to import from `./indexer-pool.js` instead of `../embedding/embedding-local-model.js`.
3. Any caller inside `embedding/` that used to access the pool must instead call `callLocalModel` directly (the pool's fallback path already does this).
4. Re-run `node scripts/check-boundaries.js` — should report 0 violations.

---

#### H2. Phase progress is a single-slot record — crash recovery cannot reconstruct state

**Evidence**
- `core/indexing/incremental-tracker.js:620-635` — `updatePhaseProgress(progress)` writes the entire `{phase, status, configFingerprint, timestamp}` object as one JSON blob, overwriting previous content
- `core/indexing/indexer-phases.js:449-503` — calls `markPhaseComplete('vectors')`, `markPhaseComplete('hnsw')`, `markPhaseComplete('late-interaction')`, `markPhaseComplete('artifacts')` in sequence, each overwriting the file
- No per-phase map is maintained; `getPhaseProgress()` returns only the most recent phase's status

**Consequence**: If the build crashes between `markPhaseComplete('vectors')` and `markPhaseComplete('hnsw')` — i.e., during HNSW build — the progress file says `{phase: 'vectors', status: 'complete'}`. On restart, there is no way to know that vectors are done, HNSW is incomplete, LI has never run, and artifacts need rebuilding. The HNSW checkpoint-sidecar (`indexer-ann.js:37-53`) partially compensates for HNSW, but nothing tracks whether LI actually finished.

**Rule broken**: `CLAUDE.md` ("event sourcing for state changes" — the pipeline does use SQLite for data, but the progress-tracking meta-state is overwrite-scoped, not event-sourced).

**Concrete fix**
- Change `updatePhaseProgress` to a **merge** write: read existing file, set `data.phases[phase] = {status, timestamp}`, rewrite.
- Add `getPhaseStatus(phase)` → returns the entry from the phases map, or `'not-started'`.
- Indexer-phases can then read `getPhaseStatus('hnsw')` on startup and skip already-completed phases.

---

#### H3. `shouldSkipArtifactRebuild` state path uses `process.cwd()` — counter resets silently from subdirectories

**Evidence**
- `core/indexing/artifact-builder.js:52` — `stateFile: '.sweet-search/artifact-rebuild-state.json'`
- `core/indexing/artifact-builder.js:68` — `const statePath = path.resolve(process.cwd(), ARTIFACT_THRESHOLDS.stateFile);`
- `core/indexing/artifact-builder.js:88` — same

**Consequence**: The accumulation counter (`accumulatedChanges`) that drives the 10-files skip threshold is scoped to wherever the process happens to be launched. Running `sweet-search index` from `src/core/`, then from `src/test/`, then from the repo root creates **three** separate state files, each reset to zero, defeating the optimization. Worse: if launched from a subdirectory the first time and the repo root the second time, the second run sees "no state" and triggers a full rebuild unnecessarily. Also risks writing into a parent project's `.sweet-search/` if the user happens to be deep in a nested workspace.

**Rule broken**: `CLAUDE.md` ("Always sanitize file paths" — this isn't a traversal, but it violates the spirit: the pipeline should key state off project identity, not invocation cwd).

**Concrete fix**
- Import `PROJECT_ROOT` from `../infrastructure/config/index.js` and replace `process.cwd()` with `PROJECT_ROOT` at both sites.
- Add a unit test that runs `shouldSkipArtifactRebuild` from a `child_process` with cwd set to a subdirectory and asserts the state file is written at `PROJECT_ROOT/.sweet-search/`.

---

#### H4. Dead cleanup path leaks `.tmp.segments/` directories on build failure

**Evidence**
- `core/indexing/indexer-phases.js:38-41`:
  ```js
  async function cleanupStagedLateInteractionIndex(stagedPath) {
    await unlinkIfExists(stagedPath);
    await unlinkIfExists(stagedPath + '.bak');
  }
  ```
- `core/indexing/indexer-phases.js:490-491`: `cleanupStagedLateInteractionIndex` is called on failure but only unlinks two stub files, never `rm -rf`s the `.segments/` directory
- Combined with C1, every failed LI build leaves a `codebase-late-interaction.db.tmp.segments/` directory orphaned in `.sweet-search/`

**Rule broken**: Data hygiene (resource leak on the sad path).

**Concrete fix**: Once C1 is fixed (segment dir is a basename, not absolute), cleanup should also `rm -rf` the staged segments directory. Use `fs.rm(path, { recursive: true, force: true })`.

---

#### H5. File-size limits exceeded on three modules (DDD_ARCHITECTURE §Remaining Work)

**Evidence** (verified via `wc -l`):
- `core/indexing/artifact-builder.js` — **1059** lines (target: <500)
- `core/indexing/indexer-ann.js` — **903** lines
- `core/indexing/indexer-phases.js` — **627** lines
- `core/indexing/indexer-pool.js` — 696 lines (also over, but less egregiously)

**Rule broken**: `CLAUDE.md` ("Keep files under 500 lines") and `docs/DDD_ARCHITECTURE.md` Phase 8 ("Large file decomposition").

**Concrete fix**
- `artifact-builder.js`: split into `artifact-threshold.js` (lines 36-193, threshold logic), `artifact-quantize.js` (lines 195-268, quantization helpers), `artifact-hnsw-builder.js` (lines 280-492, HNSW build from items+db), `artifact-verifier.js` (lines 787-917). The top-level `buildFromCodebaseDb` remains in a thin `artifact-builder.js` facade.
- `indexer-ann.js`: split into `hnsw-builder.js` (HNSW full+incremental, lines 233-486), `li-builder.js` (lines 488-830 — this is already one giant function, could become a class), `quantized-artifacts-phase.js` (lines 836-903). Keep streaming helpers in `indexer-ann-streaming.js`.
- `indexer-phases.js`: split into `phase-runner.js` (lines 52-66), `phase-discover.js` (lines 72-166), `phase-graph.js` (lines 168-250), `phase-vectors.js` (lines 252-521). Each wrapper stays thin.

---

#### H6. `indexer-worker.js` fetches models inside every worker — 2-minute SHA stall root cause

**Evidence**
- `core/indexing/indexer-worker.js:25-33` — each worker thread runs `await fetchModel('coderankembed-int8')` on startup
- `core/indexing/indexer-phases.js:363-389` — the main-thread pre-warm workaround explicitly acknowledges this: "The 596 MB LateOn-Code file streams through `pipeline(createReadStream, hash)` in ~2s when the process is idle, but blocks for >2 minutes (and counting) when ORT CPU embed is running concurrently"
- `core/indexing/indexer-pool.js:390-412` — `EmbeddingPool.init()` spawns N workers in parallel, each calling `fetchModel` independently; no deduplication

**Consequence**: the main-thread pre-warm at indexer-phases.js:363-389 only pre-warms native models via `native-inference.js`, NOT the ORT workers. When the pool spawns, each worker races on `fetchModel('coderankembed-int8')` independently, and each one SHA256-verifies the 139 MB ONNX file. If ORT inference is already active in the main thread (in the CPU-embed + Metal-LI variant), these N verifications each stall for minutes.

**Rule broken**: Resource planning consistency — the pre-warm logic is asymmetric between native and ORT paths.

**Concrete fix**
- Pre-warm `fetchModel('coderankembed-int8')` in the main thread before spawning embedding workers, mirroring the native pre-warm at `indexer-phases.js:374-389`. Since `fetchModel` is idempotent (cached), workers will skip the verification pass when they start.
- Better still: pre-verify once in the main thread, set an env var like `SWEET_SEARCH_SKIP_MODEL_VERIFY=1`, and have workers honor it.

---

### MEDIUM

#### M1. `enrichChunksFromGraph` opens code-graph.db even when it doesn't exist yet

**Evidence**
- `core/indexing/indexer-build.js:421` — `if (existsSync(DB_PATHS.codeGraph) && allChunks.length > 0)`
- But `chunkFiles` is called from `indexer-phases.js:290` **before** `buildCodeGraphWithHCGSPhase` on the parallel path — no wait, parallel runs graph + vectors in separate phases, but the code-graph write happens first (`indexer-phases.js:168-250` runs as Phase 3 → graph is built), then `buildVectorsAndArtifactsPhase` runs → calls `chunkFiles` → enrichment works because code-graph.db now exists. OK that's correct on the happy path.
- But: on first-ever `--vectors-only` run without a prior code-graph.db, `enrichChunksFromGraph` silently skips enrichment, emitting only a `dim` "Chunk enrichment skipped" log. That's probably fine but warrants a clearer warning.

**Rule broken**: Observability clarity.

**Concrete fix**: Log `yellow` instead of the current silent-if-existsSync-false behavior. Optionally mark it as "expected for --vectors-only before graph build".

---

#### M2. `buildInsertItems` returns items with `sessionId: codebase-v22-<provider>` — version drift

**Evidence**
- `core/indexing/indexer-build.js:284` — `sessionId: \`codebase-v22-${modelInfo.provider}\``
- `core/indexing/index-codebase-v21.js:1-2` — the facade announces itself as v2.3

**Rule broken**: Config-identity accuracy (not a functional bug, but misleading when debugging by sessionId).

**Concrete fix**: Use a single `INDEX_VERSION` constant (e.g., `'2.3'`) from `infrastructure/config/indexing.js`, not a magic string.

---

#### M3. LI skip policy imports directly from an internal config sub-file, bypassing the infrastructure barrel

**Evidence**
- `core/indexing/li-skip-policy.js:31` — `import { loadProjectConfig } from '../infrastructure/config/search.js';`
- All other indexing modules import from `../infrastructure/config/index.js` (the barrel)

**Rule broken**: DDD_ARCHITECTURE.md "Internal cross-domain imports within `core/` bypass barrels (tracked as warnings)". This bypass is inside `infrastructure/` so the boundary checker doesn't flag it, but it still violates the consistency principle.

**Concrete fix**: Change to `import { loadProjectConfig } from '../infrastructure/config/index.js';`.

---

#### M4. `fsyncFile` opens with `'r'` — metadata-only flush on macOS

**Evidence**
- `core/indexing/indexer-ann.js:23-26` — `openSync(filePath, 'r')` then `fsyncSync(fd)`
- macOS `fsync(2)` on a read-only fd does NOT flush user data to disk; `F_FULLFSYNC` or write-mode fsync is required for hard durability

**Rule broken**: Durability contract of the checkpoint mechanism. On a power loss right after a checkpoint write, macOS may replay an incomplete checkpoint.

**Concrete fix**: Use `openSync(filePath, 'r+')` (read+write) or, better, `fs.fdatasync` on the original write fd before `closeSync`. Since `writeFileSync` closes its own fd, switch to a `openSync / writeSync / fsyncSync / closeSync` sequence for checkpoint files.

---

#### M5. `determineFilesToIndexPhase` mutates the caller's `incrementalInfo.toIndex` model as a reference to `filesToIndex`

**Evidence**
- `core/indexing/indexer-phases.js:126-134` — `incrementalInfo = { toIndex: filesToIndex, ... }` with `filesToIndex = validStdinFiles`
- The same `incrementalInfo.toIndex` list is later used in `indexer-phases.js:395-397` to compute `filesToRemoveFromLI` and `allFilesToRemoveFromHNSW`
- This works today but is brittle: if any caller mutates `filesToIndex` in-place, it silently changes the removal sets

**Concrete fix**: `toIndex: [...filesToIndex]` (shallow copy).

---

### LOW

#### L1. `indexer-phases.js` early-exits via `mode` decisions that rewrite themselves

**Evidence**
- `core/indexing/indexer-phases.js:577` — `const mode = fullReindex ? 'FULL' : (incrementalInfo ? 'INCREMENTAL' : 'FULL');` — on `--vectors-only` this says `FULL` even when the user ran an incremental; a cosmetic mislabel.

#### L2. `parseArgs` parses `--late-interaction-pool` as `parseInt(..., 10)` of `SWEET_SEARCH_LI_POOL_FACTOR` even when no CLI flag is set

**Evidence**: `core/indexing/index-codebase-v21.js:98` — swallows env var silently; if user sets `SWEET_SEARCH_LI_POOL_FACTOR='1.5'`, `parseInt` truncates to `1` with no warning.

#### L3. CLI help text claims `codebase.db` contains "Vector embeddings (semantic search)" but the live DB also stores metadata used by graph scope enrichment — docs are narrower than reality.

**Evidence**: `core/indexing/index-codebase-v21.js:204`.

---

## 3. DDD Compliance Matrix

Evidence source: live run of `node scripts/check-boundaries.js`.

| Module | Imports outside `indexing/` | Category | Compliant? |
|---|---|---|---|
| `index-codebase-v21.js` | `infrastructure/config`, `graph/relationship-resolver` (internal bypass), `vector-store/hnsw-index` (internal bypass) | facade | ✅ allowed by matrix; 2 bypass-warnings |
| `indexer-phases.js` | `infrastructure/config`, `graph/summary-manager` (bypass), `embedding/embedding-local-model` (bypass), `infrastructure/native-inference`, `ranking/late-interaction-model` (bypass) | orchestrator | ✅ allowed; 3 bypass-warnings |
| `indexer-build.js` | `infrastructure/config`, `graph/graph-extractor` (bypass), `graph/relationship-resolver` (bypass), `embedding/embedding-service` (bypass) | build | ✅ allowed; 3 bypass-warnings |
| `indexer-ann.js` | `infrastructure/config`, `vector-store/hnsw-index` (bypass), `ranking/late-interaction-index` (bypass), `embedding/embedding-service` (bypass), `artifact-builder` (intra-domain) | build | ✅ allowed; 3 bypass-warnings; also declared exception (ranking, count ≤ 2) |
| `indexer-pool.js` | `infrastructure/native-inference`, `infrastructure/onnx-session-utils` | resource | ✅ clean, no bypasses |
| `indexer-utils.js` | `infrastructure/config` | utility | ✅ clean |
| `indexer-worker.js` | `infrastructure/ort-pipeline`, `infrastructure/native-tokenizer`, `infrastructure/model-fetcher`, `infrastructure/model-registry`, `embedding/embedding-local-model` (bypass), `ranking/late-interaction-model` (bypass) | worker | ✅ allowed via dynamic imports; 2 bypass-warnings |
| `indexer-sparse-gram.js` | `infrastructure/config`, `infrastructure/constants`, `infrastructure/native-sparse-gram` | build | ✅ clean, no bypasses |
| `artifact-builder.js` | `infrastructure/config`, `infrastructure/quantization`, `vector-store/binary-hnsw-index` (bypass), `vector-store/float-vector-store` (bypass) | build | ✅ allowed; 2 bypass-warnings |
| `li-skip-policy.js` | `infrastructure/config/search.js` (**sub-file bypass**, see M3) | policy | ⚠ infra-internal bypass |
| `ast-chunker.js`, `document-chunker.js`, `chunking/*` | (not re-reviewed — chunker-owned) | chunking | (defer to specialist) |

### Forbidden imports

1. **`core/embedding/embedding-local-model.js:361`** — dynamic `import('../indexing/indexer-pool.js')`. See H1. **Hard violation** (only one in the entire repo, per the boundary checker).

### Barrel bypass warnings

All 13 `[indexing → X]` warnings from the boundary checker output are **allowed by the
dependency matrix** (indexing may import embedding, vector-store, graph, vocabulary,
ranking up to 2, infrastructure). They are flagged only as "not going through the target
domain's `index.js` barrel", which is a Phase 6 aspirational goal, not a current
blocker. `DDD_ARCHITECTURE.md` ("Honest Assessment") explicitly accepts internal bypasses
as warnings.

**Decision on H1**: Move the pool-lifecycle factory **into** `indexing/indexer-pool.js`.
Rationale: (a) the pool CLASS already lives there; (b) the indexer owns the pool's
lifecycle (spawns, shuts down, and knows the resource plan); (c) this avoids inverting
the dependency direction, which would require port/adapter scaffolding and contradict
the "Phase 6 is aspirational" note in DDD_ARCHITECTURE.md. Embedding shouldn't need to
know pools exist.

---

## 4. Pipeline-Level Risks

### 4.1 LI staged save is not actually isolated (CRITICAL, see C1)

The entire purpose of staging (`saveToPath = stagedPath`, `loadFromPath = live path`) is
to build into a scratch location, promote atomically, and clean up on failure. The
implementation accomplishes (b) only for the stub file; the segments directory is
aliased to the live one across builds. This is the biggest pipeline-level
correctness hole I found.

### 4.2 No cross-phase compensation if HNSW fails after vectors succeed

`indexer-phases.js:466-469`: if HNSW build throws, the code cleans up the staged LI and
rethrows. But vectors have already been atomically swapped into `codebase.db` (line 531
in `indexer-build.js`). The result: `codebase.db` contains the NEW vectors, but
`codebase-hnsw.usearch` / `.meta.json` still contain the OLD HNSW graph. Search at that
point reads stale HNSW vectors against fresh DB entries — same ID space but potentially
wrong neighborhoods. No detection mechanism exists to notice this divergence.

Recommendation: either (a) gate `buildVectorIndex`'s atomic swap until HNSW succeeds
(write to `codebase.db.tmp`, build HNSW reading from tmp, then swap both together); or
(b) maintain a pipeline-level generation counter in `merkle-state.json` that HNSW writes
atomically with its meta.json, and detect mismatch at load time.

### 4.3 Parallel LI + vectors share the same chunked input but hit disjoint outputs — OK

`indexer-phases.js:290` — `preChunked` is the shared chunk list.
`indexer-phases.js:414-415` — LI promise starts with `preChunked.allChunks`.
`indexer-phases.js:392` — vector promise starts with `vectorOptions.preChunked`.

Both promises start before `await Promise.all` at line 428. Vectors write to
`codebase.db.tmp`, LI writes to `codebase-late-interaction.db.tmp` (+ the aliased
segments dir, see C1). The SQL path is fine (vectors own their own DB). Not a shared-state
issue once C1 is fixed.

However, the HCGS promise (line 230-246) ALSO runs in parallel and reads from
`code-graph.db` (line 239) while `buildCodeGraphWithHCGSPhase` may still be in the
process of completing the restore step (line 198). The order: graph phase completes
fully BEFORE `buildVectorsAndArtifactsPhase` is called (see `index-codebase-v21.js:336-352`
then :360), so HCGS read is safe — but only because the phase-runner is strictly
sequential. Worth a pipeline-level comment or invariant check.

### 4.4 Pipeline pre-warm logic is asymmetric (see H6)

Native pre-warm happens in main thread; ORT worker pool models pre-warm inside each
worker on startup. This causes the 2-minute stall scenario explicitly described in
`indexer-phases.js:363-372` comments.

### 4.5 `fullRebuild: fullReindex` mix-up is consistent, but the HNSW path has a special case

`indexer-phases.js:454-465`: on `!fullReindex`, calls `incrementalUpdateHNSW`; on full,
calls `buildHNSWIndex`. Both paths read from `codebase.db` (NOT the staged tmp), so they
depend on `buildVectorIndex` having done its atomic swap first. That's correct ordering
(`vectorPromise` is awaited before `buildHNSWIndex`). But the parallel+incremental combo
has a subtle bug: `incrementalUpdateHNSW` is called with `allFilesToRemoveFromHNSW =
[...toIndex, ...toRemove]`. The function then queries `codebase.db` for rows matching
those file_paths, inserting only the ones still present (toIndex). That's fine. OK.

### 4.6 Crash mid-phase leaves hybrid state

Per H2, `{phase, status}` can't describe "vectors done, HNSW half-done, LI not started,
artifacts not started". The HNSW path has its own checkpoint-resume (indexer-ann.js:379-417)
but only for sequential insertion order. For shuffle/diversity orders, a mid-build crash
discards progress entirely. The non-sequential path is advertised as a feature
(BINARY_HNSW_CONFIG.insertionOrder) — it should either support checkpointing or document
that a crash forces a full HNSW rebuild.

### 4.7 `cleanupStagedLateInteractionIndex` leaks the segments directory (see H4)

---

## 5. INIT_STRATEGY Compliance

| Rule | Compliant? | Evidence |
|---|---|---|
| Indexing MUST NOT re-fetch models lazily when `allowRuntimeModelDownload=false` | ✅ via model-fetcher | `core/infrastructure/model-fetcher.js:85-88` throws if model not cached AND runtime download disabled; indexer-worker.js:33 calls `fetchModel` which is a no-op when cache is populated (performs SHA256 verification only) |
| Native inference pre-warm must not bypass cascade gating | ✅ | `indexer-phases.js:374-389` goes through `infrastructure/native-inference.js` which itself reads `getCoremlCascadeResolvedDirs()` |
| Indexing must not hardcode model paths | ✅ | All paths derive from `model-registry.js` via `fetchModel` / `getModelCacheDir` |
| Honor `SWEET_SEARCH_COREML_CASCADE=0` | ✅ (indirect) | Indexing calls `native-inference.js` which calls `coreml-cascade.js` which reads the env var |
| Init profile gating (`core` vs `full`) | ✅ | Indexing doesn't invoke init directly; it relies on already-fetched models. Per `scripts/init.js:521`, `allowRuntimeModelDownload = profile === 'core'` — indexing therefore sees `false` by default for `full`, and any missing model throws at fetch time instead of silently downloading |
| Hardware gating / cascade report | ✅ | Indexing is an observer of cascade state, not a driver |
| **Subtlety — `indexer-worker.js:33` calls `fetchModel('coderankembed-int8')`** | ⚠ | This is a **verification** pass (SHA256 check on cached files), NOT a download. It's compliant with the contract: if the file is missing and `allowRuntimeModelDownload=false`, it throws, which is the correct behavior. But see H6 — it causes a stall when run concurrently with inference |

**Conclusion**: Indexing's INIT_STRATEGY compliance is clean. No model is fetched lazily
from the network by any indexing module under `full` profile. The one friction point is
the repeated SHA256 verification on each worker spawn (H6), which is a performance
issue, not a compliance issue.

---

## 6. Observability Gaps

| Phase | What's logged | What's missing |
|---|---|---|
| File discovery | Found N files, skipped M gitignored, K oversized, file-type histogram | No per-exclude-pattern stats (hard to debug "why did file X get skipped") |
| Determine files | Changed/new, removed, unchanged counts + first 10 files | No per-file `reason` (hash changed? mtime? new?) |
| Code graph | Entities, relationships, resolved count, duration | No per-language breakdown; no error file list (only count, line 183-184) |
| HCGS (parallel branch) | Summary "generated/skipped" count | Error path buries the message in `e.message` — no stack; no structured telemetry |
| Vectors | Embedding count, batch mode, dimension, progress bar | No per-batch latency distribution; no GPU vs CPU breakdown when hybrid |
| HNSW | Vector count, dimension, fallback status, checkpoint resume info, periodic "checkpoint: N/M" | No `M`, `efConstruction`, `efSearch` printed at build start (the Phase 3 log line shows them but not at a structured level); no graph quality metrics (avg degree, recall@1 smoke test) |
| LI | Model, quantBits, batch+tokens+attention budgets, skip-policy summary, hybrid/single-encoder mode, progress | Progress bar only; no per-batch timings outside `SWEET_SEARCH_LI_PROFILE=1`. Failure surface is `log(..., 'yellow')` only — no structured error code |
| Artifacts | Binary HNSW vector count, build ms, vec/s, Int8 count+MB, skip reason | No graph-level metrics; no check that Int8 count matches float count |
| Sparse gram | filesIndexed, grams, postings | No duration; no file-size on disk |
| Vocabulary warmup | "Vocabulary warmup complete" or "skipped: <message>" | The only post-indexing step that reports nothing on success beyond one line |

**Biggest gap**: there is no **single structured JSON artifact** summarising the entire
pipeline run (durations, counts, failures, warnings). `quiet` mode writes `{success,
filesProcessed, entities, relationships, chunks, embeddings, durationSeconds, mode}` on
line 616-625 of indexer-phases.js — but it's missing LI, HNSW, artifacts, sparse-gram,
and vocabulary data. A post-mortem after a benchmark run has to grep terminal output.

**Concrete fix**: create `.sweet-search/last-index-report.json` at end of
`buildVectorsAndArtifactsPhase` with every phase's structured stats. This is
tracked-as-code rather than tracked-as-console-output.

---

## 7. Test Coverage Gaps

Cross-referencing `core/indexing/*.js` against `tests/indexing/*.test.js` via Grep for
each source filename:

| Source file | Test file exists? | Notes |
|---|---|---|
| `index-codebase-v21.js` | ❌ no direct test | `core-indexer-flags.test.js` tests CLI flag parsing, not the full facade |
| `indexer-phases.js` | ✅ `indexer-phases.parallel.test.js` | Only covers parallel execution with **mocked** `indexer-ann` (`indexer-phases.parallel.test.js:42-43`) — does NOT exercise the real staged-LI save path. Would not catch C1 |
| `indexer-build.js` | ❌ no direct test | `chunk-files.test.js` tests the chunker invocation, not buildCodeGraph / buildVectorIndex / pipelinedEmbedAndInsert / enrichChunksFromGraph |
| `indexer-ann.js` | ✅ `indexer-ann.late-interaction.test.js` | Covers late-interaction path, but not `buildHNSWIndex`, `incrementalUpdateHNSW`, `streamVectorsFromDb`, or checkpoint-resume |
| `indexer-pool.js` | ✅ `indexer-resource-plan.test.js`, `indexer-profile.test.js` | Both cover `planAllocation()`; neither exercises `EmbeddingPool.init/embed/shutdown` or `LateInteractionPool` |
| `indexer-utils.js` | ✅ `sqlite-wal-mode.test.js`, `wsl-unc-path.test.js` | Covers WAL + WSL paths; does NOT cover `atomicSwapDatabase` retry logic, `applyGitignoreAlignment`, `findSymlinkDirs`, `discoverFiles` size cap |
| `indexer-worker.js` | ❌ no test | Not unit-testable in isolation (worker_threads boundary), but an integration test running a 2-worker pool would be valuable |
| `indexer-sparse-gram.js` | ❌ no test | Zero coverage; the `collectFileSymbolMasks` DB path is completely untested |
| `li-skip-policy.js` | ✅ `li-skip-policy.test.js` | Recent unification — tests exist |
| `artifact-builder.js` | ✅ `phase5-artifacts.integration.test.js` | Covers `buildFromCodebaseDb`; does NOT cover `updateArtifacts()` (which is why C2 slipped through) |
| `ast-chunker.js` | ✅ many chunker tests | Well-covered |
| `document-chunker.js` | ✅ `document-chunker.test.js` | |
| `chunking/chunk-builder.js` | ❌ no direct test | Used by other chunker tests |
| `chunking/markdown-chunker.js` | ✅ indirect via chunker-batch tests | Deserves dedicated test |
| `chunking/plaintext-chunker.js` | ❌ no test | Zero coverage |

### Highest-value gaps to close

1. **`updateArtifacts()` incremental path** — would have caught C2 in ~5 minutes.
2. **Staged LI promote round-trip** — would have caught C1. Add `phase5-artifacts.integration.test.js`-style test: build a tiny corpus, rebuild twice, assert `codebase-late-interaction.db.segments/` exists (basename, no `.tmp` leak) and `codebase-late-interaction.db` stub resolves to it.
3. **`EmbeddingPool` lifecycle** — spawn pool, submit a batch, shutdown, assert no worker leaks.
4. **`indexer-sparse-gram.js`** — zero tests today.
5. **`atomicSwapDatabase` EBUSY retry + restore-from-backup** (indexer-utils.js:144-189) — critical safety net, currently untested.
6. **`checkpoint-resume` HNSW path** — kill the process mid-build, restart, assert final index matches a from-scratch build byte-for-byte (or at least recall@10 match).

---

## 8. Swarm Synthesis

Status: at time of writing, none of the four specialist reports had landed in
`docs/reviews/`. When they arrive (`ddd-compliance.md`, `performance.md`, `complexity.md`,
`correctness.md`), this section should be updated by the queen in a follow-up pass using
the merge rules below.

### Merge rules

1. **Hard violations** (DDD, INIT, boundaries) from any report become critical if the
   specialist did not mark them as such — trust the strictest severity.
2. **Correctness report** C-series findings should be merged into §2; dedupe by
   `file:line` and keep the clearest explanation.
3. **Performance report** findings feed §4 (Pipeline-Level Risks) and §6 (Observability).
4. **Complexity report** findings feed §2 H5 (file-size decomposition) and §7 (test gaps).
5. **Contradictions**: if specialist and queen disagree, the queen's finding wins ONLY
   if backed by a verified file:line citation. Otherwise, flag as "DISPUTED" and let
   Codex arbitrate.

### Pre-merge sanity check questions for each specialist report

- Did they find C1 (LI `.tmp.segments` leak)? If no, that's a specialist-side gap —
  evidence is on-disk at `.sweet-search/codebase-late-interaction.db`.
- Did they find C2 (`buildAndSaveFloatStore` undefined)? If no, re-run their
  verification against `node -e "import('artifact-builder.js')"`.
- Did DDD review agree H1's fix direction (move factory into indexing)?
- Did performance review catch H6 (per-worker SHA256 stall)?

---

## 9. Recommended Action Order

Weighted by `blast_radius × likelihood`. All issues cited in §2 — this is the execution
punch list.

### P0 — fix before next release

1. **C1** — fix LI staged save path aliasing. Blast radius: production search index
   corruption on every rebuild. Likelihood: already happened (live on-disk proof).
   Effort: ~1 day (rework `save()` / `_loadSegmented` path handling, add
   promote-segments-dir rename, add round-trip test).
2. **C2** — delete or fix the dead `buildAndSaveFloatStore` call. Blast radius: hard
   crash on any `updateArtifacts()` invocation with new items. Likelihood: probably
   never hit today (dead code) but a latent trap. Effort: 30 min (delete call, or
   rewrite to use `buildAndSaveFloatStoreFromDb`, add test).
3. **H1** — move `initEmbeddingPool` into `core/indexing/indexer-pool.js`. Blast radius:
   CI boundary check fails on every push (it's failing today). Likelihood: 100%. Effort:
   1–2 hours.

### P1 — before next major release

4. **H2** — convert phase progress from single-slot to per-phase map. Blast radius:
   crash recovery is broken today. Likelihood: a rare crash will surface it badly.
   Effort: ~4 hours (update writer, reader, and indexer-phases call sites, add test).
5. **H6** — main-thread pre-warm `fetchModel('coderankembed-int8')` before pool spawn.
   Blast radius: 2-minute stall on hybrid path. Likelihood: repeatable. Effort: 1 hour.
6. **H4** — cleanup should `rm -rf` the staged segments directory. Effort: 30 min
   (coupled with C1 fix; update `cleanupStagedLateInteractionIndex`).

### P2 — tech debt, schedule opportunistically

7. **H3** — use `PROJECT_ROOT` in artifact-builder state path. Effort: 15 min.
8. **H5** — decompose `artifact-builder.js`, `indexer-ann.js`, `indexer-phases.js` along
   the seams sketched in §2. Large refactor (~2 days), must not regress the benchmark.
9. **M1–M5** / **L1–L3** — batch into a "small cleanups" PR. ~4 hours total.
10. **§7 test gaps** — ship alongside the C1/C2 fixes so the bugs can't return. 1 day.
11. **§6 observability** — add `.sweet-search/last-index-report.json`. ~3 hours.

### Do NOT do

- Do not attempt the Phase 6 DDD port-adapter refactor as part of this hotfix — it's
  explicitly flagged as aspirational in `DDD_ARCHITECTURE.md` and would inflate the
  blast radius of the C1/C2 fixes.
- Do not touch `index-maintainer.mjs` — it's out of scope per the brief (incremental
  infrastructure).
- Do not change the staging atomicity contract for `code-graph.db` or `codebase.db` —
  those work correctly and the only broken one is the LI segments directory.

---

## Appendix A — Files reviewed with evidence cited

| File | LOC | Evidence cited |
|---|---|---|
| `core/indexing/index-codebase-v21.js` | 472 | facade, CLI, vocab warmup |
| `core/indexing/indexer-phases.js` | 627 | C1, H2, H4, H6, §4.2, §4.4, §4.6, §6 |
| `core/indexing/indexer-build.js` | 597 | M1, §6 |
| `core/indexing/indexer-ann.js` | 903 | C1, M4, §4.5, §7 |
| `core/indexing/indexer-pool.js` | 696 | H1, H6 |
| `core/indexing/indexer-utils.js` | 536 | §6 (no major findings) |
| `core/indexing/indexer-worker.js` | 148 | H6 |
| `core/indexing/indexer-sparse-gram.js` | 98 | §7 |
| `core/indexing/li-skip-policy.js` | 225 | M3 |
| `core/indexing/artifact-builder.js` | 1059 | C2, H3, H5 |
| `core/indexing/incremental-tracker.js` (phase progress only) | 761 | H2 |
| `core/ranking/late-interaction-index.js` (staged save only) | 2200+ | C1 |
| `core/embedding/embedding-local-model.js` (pool factory only) | 2000+ | H1 |
| `scripts/init.js` | 713 | §5 |
| `scripts/benchmark-full-index.js` | 66 | benchmark entry point |
| `docs/DDD_ARCHITECTURE.md` | 367 | §3 dependency matrix |
| `docs/INIT_STRATEGY.md` | 609 | §5 compliance review |

## Appendix B — Commands that produced verification evidence

- `node scripts/check-boundaries.js` — surfaced H1
- `wc -l core/indexing/*.js core/indexing/*.mjs` — surfaced H5
- `node -e "import('core/indexing/artifact-builder.js').then(m => console.log(typeof m.buildAndSaveFloatStore))"` — confirmed C2 (`undefined`)
- `cat .sweet-search/codebase-late-interaction.db` — confirmed C1 (`segmentDir` has `.tmp.segments` suffix)
- `ls .sweet-search/` — confirmed the staged directory exists as `codebase-late-interaction.db.tmp.segments`

All commands were read-only. No source file was modified during this review.
