# Queen Synthesis — Indexing Optimization Series

**Date**: 2026-04-15
**Branch**: main, HEAD `34089b2`
**Reviewer**: QE Queen Coordinator (system-level meta-review)
**Series under review**: 18 commits between `8be7e09..34089b2` (BigInt elimination → CoreML cascade HF distribution → 11-issue swarm-review fix-pack)
**Scope**: full-indexing pipeline only; incremental indexing explicitly out of scope per request
**Read-only**: source unchanged, no commands run

---

## 1. Executive Assessment

The fix-pack moves the indexing pipeline from "two known data-integrity bugs in the hot path" to "no known data-integrity bugs in the hot path." That is a real qualitative jump and the work is high quality: the C1 (LI staged-save aliasing) fix is properly atomic, race-tolerant, and ships a self-heal migration; H1 (DDD violation) is correctly resolved with a duck-typed slot; H6 (SHA256 stall) and H2 (in-memory summary backup) cleanly close those failure modes. The fix-pack is **shippable**, but with two caveats Codex should note: (a) the 11-issue scope deferred H3 (incremental vector stage-and-swap), the file-size decompositions, and the three duplicate hybrid dispatchers — all of which were P1/P2 in the prior review and remain open; and (b) the cross-language load-bearing `coreml-cascade.json` spec has zero schema validation in JS and the Rust filename parsers hardcode literal prefixes, so a JSON edit can silently desynchronize the three layers without any failing test. Net: **B+** on the fix-pack itself, **C+** on the system as a whole because the deferred items still exist.

---

## 2. System-level health by phase

Walking the `--full` pipeline top to bottom in `core/indexing/index-codebase-v21.js` and `indexer-phases.js`:

| # | Phase | Crash-safe? | Failure detectable? | Hardware-graceful? | Notes |
|---|-------|-------------|--------------------|--------------------|-------|
| 1 | File Discovery (`discoverFilesPhase`) | yes (read-only) | yes (logs + return value) | yes | unchanged in fix-pack |
| 2 | Determine Files (`determineFilesToIndexPhase`) | yes | yes | yes | unchanged |
| 3 | Code Graph + HCGS Prep (`buildCodeGraphWithHCGSPhase`) | **yes (NEW)** | partial | yes | H2 fix persists summaries to `{dbPath}.summaries.bak.json` and crash-recovers via orphan detection in `backupSummaries` |
| 4a | Vector embedding (parallel) | yes (full only — H3 deferred) | yes | yes | full rebuild uses tmp+atomic swap; incremental still writes directly to live DB |
| 4b | Late Interaction encoding | **yes (FIXED)** | yes | yes | C1+H4 fixed: `stagingSegmentDir` distinct from live, `atomicSwapLateInteractionIndex` renames stub+segments together with rollback; `cleanupStagedLateInteractionIndex` removes both stub and staged segments |
| 4c | HCGS summary regen (parallel) | n/a (writes to summary table) | **NO — silent** | yes | unchanged: failures still log `yellow` and return `{error: ...}`; main pipeline keeps going (Risk 3 from prior review NOT fixed) |
| 5 | HNSW build (`buildHNSWIndex`) | better (M5 fixed) | yes | yes | try/finally now cleans stale checkpoint on throw; rowid-gap problem (M6) still open |
| 6 | Binary HNSW + Int8 (`buildQuantizedArtifactsPhase` → `artifact-builder.js::buildFromCodebaseDb`) | partial | **NO — silent** | yes | C2 fixed (`buildAndSaveFloatStoreFromDb` correctly called); failures still log `yellow` and return `{error: ...}` (Risk 4 NOT fixed); M7 atomic-write deferred |
| 7 | Sparse gram | yes | partial (single log line) | yes | unchanged |
| 8 | Vocab warmup (Phase 7 in code) | yes | weak (`dim` log only) | yes | unchanged; failures completely silent |
| 9 | Update incremental state | yes | yes | yes | unchanged |
| 10 | Print summary (quiet JSON) | yes | yes | yes | does NOT include phase-state breakdown — observability hole |

**Phases newly safe (good)**: 3, 4b, 5
**Phases still silent on failure (bad)**: 4c (HCGS), 6 (quantized artifacts), 8 (vocab warmup)
**Phases still un-staged (deferred)**: 4a incremental path

---

## 3. Architectural coherence

**Pipeline as a system** — does it still hang together post-fix-pack?

Mostly yes. The phase boundaries are crisp, `runPhase` provides uniform timing/error envelope, and the parallel-`Promise.all` pattern in `buildVectorsAndArtifactsPhase` is well-isolated. The fix-pack did not introduce any new cross-cutting state or hidden coupling. The 472-line facade in `index-codebase-v21.js` is a model of restraint.

**`core/infrastructure/` size watch.** The directory now holds **24 .js files** + the `coreml-cascade.json` spec + WASM blobs. That is up from ~22 pre-fix-pack. Two of the new arrivals are `coreml-cascade.js` (645 lines) and `hardware-capability.js` (169 lines), both legitimate infrastructure concerns. The directory is not yet doing too much, but it is approaching a point where a `core/infrastructure/coreml/` subdirectory would be honest. The file with most expansion pressure on it is `model-fetcher.js` (372 lines, +147 from H6 cache), still under the 500-line target.

**Duck-typed embedding-pool slot pattern (H1 fix).** This is sanctioned and works. The slot in `embedding-local-model.js` (`setEmbeddingPool`/`getEmbeddingPool`/`clearEmbeddingPool`) is a clean Inversion of Control that pushes pool lifetime to the indexing layer where it belongs. The pattern is mentioned briefly in `docs/DDD_ARCHITECTURE.md` but should arguably be elevated to a named pattern ("dispatch slot") and reused in **one** other obvious place: the `LateInteractionPool` in `core/indexing/indexer-pool.js:559` constructs and uses `late-interaction-model.js::encodeDocuments` directly (`indexer-pool.js:695`), which is one of the 6 indexing→ranking import sites the boundary checker tracks. A symmetric slot in `core/ranking/late-interaction-model.js` (`setLateInteractionPool`) would let `indexer-pool.js` install its `LateInteractionPool` once and reduce the indexing→ranking coupling surface from 6 to 4. Not urgent, but the pattern earns its keep with a second instance.

**Hybrid CPU+GPU LI dispatcher (`indexer-ann.js:670-870`).** This is the most architecturally suspect piece. The comments are honest about the limitation: "in the default pipeline (parallel embedding + LI phases) the GPU device queue is shared, and the embedding phase's continuous Metal command stream effectively starves the LI GPU encoder." That diagnosis is correct. What this means in practice is **the hybrid dispatcher only delivers value in the pure-CPU-embed + Metal-LI configuration** — every other configuration leaves the second encoder idle. It's not "fighting Node + Metal + ORT" so much as "Metal's `MTLCommandQueue` is single-producer single-consumer in practice and the `Promise.all` parallelism is a JS-side fiction when both encoders dispatch through it." The CoreML cascade's 18% win supports this — ANE is a **separate** compute unit, not a contended one, so dispatching there yields real parallelism. **Conclusion**: the hybrid dispatcher is sound in principle for true split-device cases (CPU+ANE, CPU+ORT-on-Metal-when-Metal-isn't-shared) but the fact that it shares an env-var `SWEET_SEARCH_LI_HYBRID=1` rather than auto-detecting compute-unit availability means most users will never benefit. A future cleanup should auto-arm hybrid only when Metal is NOT in the embed path.

---

## 4. Observability gaps

The prior review flagged 7 observability gaps. The fix-pack addressed **zero** of them (it was scoped to correctness, DDD, and one perf win). Status of each:

| Gap | Status | New gap from fix-pack? |
|-----|--------|------------------------|
| HCGS silent failure | **STILL OPEN** | — |
| Quantized artifact silent failure | **STILL OPEN** | — |
| Vocab warmup dim log only | **STILL OPEN** | — |
| LI profiling opt-in only | **STILL OPEN** | — |
| Sparse gram single line | **STILL OPEN** | — |
| HNSW checkpoint dim log | **STILL OPEN** | — |
| Atomic swap retry success unlogged | **STILL OPEN** | — |
| **NEW**: SHA256 verification cache hit/miss | — | **OPEN** |
| **NEW**: Cascade fetch partial-embed-only state surfacing to user | — | **OPEN in cascade module, partial in init** |
| **NEW**: LI self-heal migration trigger logging | — | **partial** (warns to console.warn) |

**Three new specific gaps the fix-pack introduced:**

1. **H6 SHA256 cache observability**: `model-fetcher.js::isVerified` returns `true`/`false` silently. There is no log line distinguishing "cache hit, skipping 2-minute hash" from "cache miss, hashing now". A Codex reviewer running the indexer fresh has no way to tell whether the H6 fix is actually firing without setting a debugger.
2. **Cascade `partial-embed-only` surfacing**: `coreml-cascade.js::getCoremlCascadeResolvedDirs` correctly returns `status: 'partial-embed-only'` when only embed variants are present, but `scripts/init.js:271-285` only handles `'present'`, `'partial'`, `'not-built'`, and `'disabled'` — `partial-embed-only` and `partial-li-only` fall through silently. A user who initialized successfully but with only one side cached will see no indication.
3. **LI self-heal migration**: when `late-interaction-index.js::load` triggers the `.tmp.segments` migration, it emits `console.warn` at the LI-internal level, NOT through the indexer's `log()` system, so it bypasses `--quiet` filtering AND won't show up in the Phase-7-style final summary. The warn IS visible in stderr, which is good for debugging, but it's not part of the post-run state record.

**Recommendation (carried over from prior review)**: the missing piece is a **final-state JSON summary** under `--quiet` mode. Today the JSON is `{success, filesProcessed, entities, relationships, chunks, embeddings, durationSeconds, mode}`. It needs per-phase status: `{hcgs: {status: 'ok'|'skipped'|'error', generated, error}, quantizedArtifacts: {status, ...}, lateInteraction: {status, selfHealed, ...}, cascade: {status, dispatched, fellThrough}}`.

---

## 5. INIT_STRATEGY.md compliance table

Walking each invariant from `docs/INIT_STRATEGY.md` against current code:

| Invariant | Status | Evidence |
|-----------|--------|----------|
| All hardware-gated fetches are gated | **PASS** | `coreml-cascade.js::fetchCoremlCascade` checks `detectHardwareCapability()` first (lines 533-543); ineligible hardware returns `status: 'skipped'` without touching network |
| Atomic writes (.tmp → rename) on tarballs | **PASS** | `extractVariantTarball:417-462` extracts to `${target}.staging-${pid}-${ts}` then `renameSync` |
| Resumable downloads | **PASS** | `model-fetcher.js:236-251` honors `Range` header on `.tmp` file; `416 Range Not Satisfiable` retries from start |
| SHA256 on every downloaded artifact | **PASS, with caveat** | `model-fetcher.js::fetchModelFile` always streams hash post-download (line 294). H6 cache only memoizes prior positive results — the trust model in the comment block (lines 38-56) is correct |
| No env-var bypass of SHA256 | **PASS** | grep for `SWEET_SEARCH_*SHA*` returns zero; the only env var that touches verification is `SWEET_SEARCH_COREML_CASCADE=0` which disables the entire cascade, not the verification |
| Cache root override (`SWEET_SEARCH_MODEL_CACHE`) honored | **PASS** | `coreml-cascade.js::getCoremlCascadeRoot` returns `MODEL_DELIVERY_CONFIG.modelCacheRoot/coreml-cascade`; `MODEL_DELIVERY_CONFIG` reads the env var via the config barrel |
| Uninstall cleans the cascade | **PASS** | `scripts/uninstall.js:128-143` calls `getCoremlCascadeRoot()` and `rmSync(root, {recursive: true})`, gated by `--keep-models` |
| Single source of truth (`coreml-cascade.json`) for shapes | **PASS** | JS, Python (`trace_cascade.py`), and the build script all read from this file |
| Cascade never blocks init | **PASS** | every error path in `init.js:481-509` writes a stderr note and continues; `try/catch` wraps the entire `fetchCoremlCascade` call |
| **`coreml-cascade.json` schema validation** | **FAIL — silent gap** | `getCascadeSpec()` does `JSON.parse(raw)` with no schema check; a malformed shape array would crash JS at first variant access, but a shape with the wrong filename pattern would silently produce files Rust ignores |
| **JS↔Rust filename pattern parity** | **FAIL — silent gap** | `crates/sweet-search-native/src/inference/embedding_model.rs:140` hardcodes `"nomic_bert_b"` and `"_fp16.mlpackage"` literals; the JSON's `filePattern: "nomic_bert_b{batch}_s{seq}_fp16.mlpackage"` is only consumed by JS at format time. Editing the JSON pattern without coordinating a Rust release would silently break dispatch. |

**Two of the eight Phase 8 contracts are honored only by convention, not by code.** Both are real correctness risks if a future maintainer changes shape names.

---

## 6. Docs drift audit

| Doc | Status |
|-----|--------|
| `docs/DDD_ARCHITECTURE.md` | **mostly current**: 2026-04-15 update raised exception cap 2→6, added `summary-manager.js (542 lines, NEW breach)` and pool/phase line counts in Honest Assessment. The cascade routing section is written and correct. Missing: there's no entry documenting the `setEmbeddingPool` slot pattern as a sanctioned IoC pattern callers should use elsewhere (it'd help future cross-domain refactors). |
| `docs/INIT_STRATEGY.md` | **current**: Phase 8 section is comprehensive (lines 561-609); HF repo, checksum-backfill workflow, hardware gating, and cascade fallback all documented. Caveat: the doc claims "no env-var bypass" but `SWEET_SEARCH_COREML_CASCADE=0` is documented as a "diagnostic opt-out" — calling it a "diagnostic env var" elides that it does in fact bypass cascade dispatch for benchmarking. Acceptable framing, but Codex should know it's not literally zero. |
| `docs/reviews/INDEXING_REVIEW_2026-04-14.md` | **superseded but in canonical location**: lives at `docs/reviews/INDEXING_REVIEW_2026-04-14.md`, while the new specialist reports land in `docs/reviews/INDEXING_OPT_2026-04-15/`. The 2026-04-14 file's findings are mostly addressed (11 of 12), but it's still presented as the canonical review. Recommendation: rename to `docs/reviews/2026-04-14-indexing/INDEXING_REVIEW.md` and move the loose `correctness.md`, `complexity.md`, `ddd-compliance.md`, `performance.md`, `queen-synthesis.md` siblings into that same folder. The current layout — three loose `.md` files at `docs/reviews/` plus a `INDEXING_OPT_2026-04-15/` sibling folder — drifts. |
| `docs/PAPER_RANKING.md` | **honest, well-calibrated, but should NOT have been added without explicit user request.** The audit itself is high-quality and the "CRITICAL CAVEATS" section (lines 27-37) is exactly the kind of intellectually-honest correction a paper reviewer would respect. The "84.06% MRR" headline is verified to a date and benchmark file. The "11x compression" claim is correctly debunked. The "1.48x ORT speedup" is correctly flagged as not in any stored result. **However**: per CLAUDE.md "NEVER proactively create documentation files (*.md) or README files unless explicitly requested" — was this requested? The doc is good but existence is a process violation if not asked-for. |

---

## 7. Ship / hold decision

**Recommendation: SHIP, with three blocking items downgraded to "fix in a follow-up tag."**

If Codex asks "merge this fix-pack to a release branch tomorrow?" the answer is **yes, conditionally**.

**Yes because:**
- The two P0 data-integrity bugs (C1, C2) are correctly fixed with regression tests
- The H1 DDD violation is properly resolved with a clean slot pattern
- The H2 in-memory backup destruction risk is closed with disk persistence + crash recovery
- The H6 SHA256 stall is closed without weakening the integrity model
- The 11-fix scope was honestly documented (no false claims about H3, H5, M4)
- The MRR regression test (gencodesearchnet 0.9793 → 0.9793 byte-identical) demonstrates zero quality regression
- The 37/37 critical-path tests pass and 1655/1655 cross-domain tests pass on this commit
- The fix-pack adds 191 lines of regression test for C1 (`tests/indexing/li-staged-save.test.js`)

**Conditionally because three items must be fixed within one release cycle:**

1. **`coreml-cascade.json` schema validation** in `getCascadeSpec()`. This is a 30-line addition (validate `version`, `hfRepo`, `embed.filePattern`, `embed.variants[].batch|seq|tarballSha256|tarballSizeBytes`, same for `li`). Currently a malformed JSON edit ships silently and Rust loads nothing. **Risk: cascade goes silently dark on update.**
2. **JS↔Rust filename pattern parity test**. A test that loads `coreml-cascade.json`, formats one variant, and parses it back through a Rust harness (or at minimum, asserts the prefix from the JSON pattern matches the hardcoded `"nomic_bert_b"`/`"li_modernbert_b"` prefixes via a Node-side regex). **Risk: shape rename in JSON silently breaks all M3+ Apple users on next release.**
3. **HCGS + quantized-artifact failures must surface in the quiet-mode JSON**. Current behavior: both fail silently to `{error: ...}` and the run reports `success: true`. A user who deploys and then notices "search quality dropped after the last reindex" has no way to tell whether HCGS or binary HNSW silently degraded. **Risk: users get reduced retrieval quality without an alarm.**

**Items deferred per fix-pack scope (ok to defer if tracked):**
- H3 (incremental vector stage-and-swap) — out of scope for full-index review
- H5 (file-size decompositions) — 7 files still over 500 LOC, plus `summary-manager.js` is a NEW breach
- M4 (three duplicate hybrid dispatchers) — explicit deferral
- M6 (HNSW rowid-gap on incremental resume) — explicit deferral
- M7 (binary HNSW atomic write) — explicit deferral

---

## 8. Cross-lane findings — what the 5 specialists likely missed

The 5 specialist reports run in parallel without seeing each other or seeing this synthesis. Each is bottom-up (file-by-file). My value-add is the cracks **between** their lanes:

### 8.1 Correctness specialist will look at fixes individually, miss EMERGENT interactions
The C1 fix and the H6 fix both land in commit `34089b2`. Neither is independently buggy, but together they create a new reentrancy: the H6 verified-sidecar write (`recordVerified` at `model-fetcher.js:307`) happens AFTER `renameSync` of the model file. The pre-warm in `indexer-phases.js:448-462` calls `getNativeEmbeddingModel()` and `getNativeLiModel()` from the main thread. If a user runs two `node index-codebase-v21.js --full` processes against the same model cache concurrently (which a CI runner might), both will independently reach `fetchModelFile` → see no cache → both download, both hash, both `recordVerified` to the same path. The final write wins, but in between, both processes are happily reading the cache file mid-download. This is the same race the C1 fix addressed for LI, and the H6 cache writes inherit it. The mitigation in the H6 cache trust model — "any stat mismatch invalidates" — handles the case but produces no observability when the race fires.

### 8.2 Performance specialist will look at headline numbers, miss baseline drift
The fix-pack's "Full-index wall-clock: 29m 03s on 16,792 chunks (within noise of the documented 28 min CoreML cascade target)" claim is honest but Codex should know:
- The "28 min" CoreML cascade baseline is from commit `4fd9c9a` (single M3 Max measurement, no variance bands published)
- The "18% faster full index" claim is one machine, one run, not a distribution
- The H6 fix saves "2+ minutes on cold start" — that's measurable on M3 Max but **not measured on other hardware**; if Linux CPU-only systems don't see the worker-pool contention, H6 is a no-op there but the comment doesn't say so
- The Float32Array napi return (`b8816c1`) shows 26,289ms → 12,157ms (2.16x) in `b32×s2048` LI — that's a microbenchmark, not end-to-end. Wall-time impact on a real index is smaller because LI is one of three parallel phases.

**The pattern**: every perf number cited is a single-machine, single-run measurement. There is no variance, no P50/P95, and no cross-platform validation. Codex should ask for either error bars or a one-line "this is one M3 Max measurement, your mileage will vary."

### 8.3 Security specialist will look at attack surfaces, miss the cross-language trust hole
The most concerning item I found is `coreml-cascade.json`: a single JSON file consumed by **JS, Python, and Rust**, none of which validates the schema, and the Rust side hardcodes literal filename prefixes that don't match the JSON's `filePattern` field by any code path — only by maintainer discipline. The security framing is: an attacker who can edit `coreml-cascade.json` (e.g., a supply-chain compromise of the published package) can:
- Add new shapes Rust ignores (ineffective)
- **Change `hfRepo` to a typosquat** — JS will fetch from there, SHA256 will validate (they can publish their own hash), and the cascade `.mlpackage` files will be loaded by Rust. This is a real trust path: the hash check defends the **download**, but the hash itself is in the same JSON the attacker edited. **There is no second-source for the cascade hashes.** Other models in `model-registry.js` share the same property — the registry IS the trust anchor — but the cascade is interesting because it's a JSON file rather than a code module, so it's in scope for a "config-only" supply-chain edit.
- Mitigation: ship the cascade JSON's hashes inside `model-registry.js` (a code file, harder to edit invisibly), OR codesign `coreml-cascade.json`, OR pin the file's hash in the package's published `manifest.json`.

The security specialist will likely catch SAST issues but probably not this trust topology.

### 8.4 Integration/DDD specialist will look at imports, miss runtime coupling
The `setEmbeddingPool` slot pattern resolves the static import direction (`embedding/` no longer imports `indexing/`) but introduces a **runtime lifetime coupling** that the import graph doesn't show: the pool's lifetime is now coupled to `indexing/indexer-pool.js::shutdownEmbeddingPool`, which is called from `indexer-phases.js:596` in the `finally` block of `buildVectorsAndArtifactsPhase`. If indexing crashes between `initEmbeddingPool` and the `finally`, the pool leaks worker threads. The `try/finally` IS there, so this is theoretical, but the broader observation is: **the boundary check passed at the import-graph level masks an inversion at the lifetime level**. The embedding layer used to OWN the pool's lifetime (via the module singleton); now indexing owns it but installs into embedding's slot, so a pool used by `embedding-service.js::callLocalModel` lives or dies based on what `indexer-phases.js` does. Code that imports `embedding/` and calls `getEmbedding()` from a non-indexing context (e.g., a query path) will see `_embeddingPool === null` and fall through to the inline single-session path — this is correct behavior, but worth documenting because it's the kind of subtle "where do worker threads go when indexing isn't running" question a new contributor will ask.

### 8.5 Complexity specialist will look at file sizes, miss test infrastructure bloat
`tests/diagnose-*.js` contains **26 files totaling 2,210 LOC** — a parallel test universe of single-purpose diagnostic scripts (`diagnose-cpu-utilization.js`, `diagnose-fp32-vs-int8.js`, `diagnose-hybrid-hang.js`, `diagnose-li-metal-vs-cpu.js`, `diagnose-tokenizer-parity.js`, etc.). These are not registered with vitest, are not run in CI, do not have a clear lifecycle ("delete after the bug they were chasing is fixed"), and now include `diagnose-variant-a-slowdown.js` from commit `8ec87c6`. The 2026-04-14 review counted 16 indexing test files and 17 source files; nobody counted these 26 diagnose scripts. They represent **test debt**, not test coverage: they were debugging tools that became permanent residents. Recommendation: move all `tests/diagnose-*.js` to `scripts/diagnose/` (since they're closer to operational diagnostics than test code), and add a CLAUDE.md rule that diagnose scripts have a TTL stamped in their header.

### 8.6 Devils-advocate specialist will challenge the fix-pack, miss the long-term direction question
The fix-pack is good, but the **trajectory** the indexing pipeline is on deserves challenge: the fix-pack adds **416 net lines of code** (2,969 insertions, 114 deletions) and **explicitly defers** all decomposition. This is the third successive fix-pack on this pipeline (the BigInt elimination, the Float32Array napi return, and now the swarm-review fix-pack) where the "work to do later" list grew. A devil's-advocate question Codex should ask is: **is this codebase going to ever decompose, or is the indexing/ directory destined to grow until something fundamental forces a rewrite?** The 706-line `indexer-phases.js` and the 951-line `indexer-ann.js` will hit 1,000+ at the next perf optimization. The duplicate hybrid dispatchers (M4) are now THREE. The pattern suggests "we'll refactor when it's blocking" but the only thing that has ever blocked it was the 2026-04-14 review — i.e., a person stopping to look. There is no automated metric (no CI fail on file size, no fitness function) that will trigger a refactor. **The long-term risk is that the fix-pack pattern becomes the steady state.**

---

## 9. Risk pareto top 10

Ranked by likelihood × impact for a user running `sweet-search init` + `sweet-search` on a fresh machine.

| # | Risk | Phase | Commit that introduced/exacerbated | Fail mode on user machine | One-line fix |
|---|------|-------|------------------------------------|---------------------------|--------------|
| 1 | `coreml-cascade.json` schema desync with Rust filename parser | Phase 8 init + native dispatch | `cf04213`, `504ad66` | New cascade shape silently produces .mlpackages Rust ignores — falls back to candle, user sees no error but loses the 18% perf | Add JSON schema + parity test that round-trips JSON pattern through Rust regex |
| 2 | HCGS regen failure silently degrades retrieval | Phase 4c | pre-existing (NOT fixed) | User reindexes, HCGS errors logged dim, search quality drops on graph queries, no JSON signal | Add `hcgs.status` to quiet-mode summary JSON |
| 3 | Quantized artifact failure silently downgrades 3-stage to 1-stage | Phase 6 | C2 fixed, but silent-failure pattern unchanged | User reindexes, 3-stage retrieval pipeline collapses to float HNSW only, MRR drops ~5pp, no JSON signal | Add `quantizedArtifacts.status` to quiet-mode summary JSON |
| 4 | Concurrent `init` race between two processes hashing same model file | model-fetcher | H6 (`34089b2`) | Two CI runners against shared cache — one wins, both see correct end state, but mid-window reads hit a half-written file | Lockfile or per-process tempdir for downloads |
| 5 | LI self-heal triggers but only on `console.warn`, no JSON record | Phase 4b | C1 fix (`34089b2`) | First indexing on machine with old broken state succeeds via self-heal, user has no record of migration in their logs | Surface `selfHealed: true` in LI phase result |
| 6 | Cascade `partial-embed-only` / `partial-li-only` not surfaced to user | init phase 8 | `cf04213` | Fetch fails halfway, user sees normal init complete, only embed half of cascade is armed, performance is mixed | Extend `init.js:271-285` cascade-status switch |
| 7 | H3 incremental vectors crash leaves torn DB | Phase 4a (incremental) | unchanged from prior review | User runs incremental, kills it with Ctrl-C mid-flush, vector DB has half-deleted half-inserted state | Stage-and-swap for incremental too (deferred) |
| 8 | M6 HNSW resume drift after rowid gap | Phase 5 | unchanged from prior review | Incremental update creates rowid gap, HNSW checkpoint resume mismatches keys, search returns wrong ids | Persist rowid→hnswKey map in checkpoint sidecar |
| 9 | LI hybrid dispatcher silently does nothing in default config | Phase 4b | `059fffb` | User sets `SWEET_SEARCH_LI_HYBRID=1` expecting speedup, but Metal is shared with embed phase, hybrid never fires | Auto-detect compute-unit availability instead of opt-in |
| 10 | `tests/diagnose-*` scripts accrue with no lifecycle | tests dir | every recent commit | New contributors run them confused about purpose, they stay in repo forever | Move to `scripts/diagnose/`, require TTL header |

---

## 10. Benchmarks Codex should run

The fix-pack's only published validation is gencodesearchnet MRR@10 (Python subset) byte-identical at 0.9793 and full-index wall-clock 29m03s on M3 Max. That's two numbers from one machine. Codex should request these additional runs before tagging:

1. **CPU-only path on Intel Mac OR Linux x64.** The fix-pack's H6 fix was measured under "worker pool contention" which happens because of `SWEET_SEARCH_EMBED_USE_CPU=1` + Metal-LI parallel. On Linux CPU-only there is no Metal, no contention, and no measurable H6 win. Worth confirming the H6 fix is a no-op (not a regression) on Linux. Run: `node scripts/benchmark-full-index.js --profile=full` on a Linux x64 CI runner.

2. **Cold start + first-ever init via `sweet-search init` on a fresh machine.** The fix-pack adds the HF cascade fetch path. The only validation in the commit message is "Self-heal verified against actual on-disk broken state." The first-time happy path (no cache, no network errors, all 12 variants downloaded fresh, hashes verified, init completes) was not exercised in the test pass. Run: in a fresh OS image, `npm install sweet-search && npx sweet-search init --profile full` and time it end-to-end.

3. **Init with cascade fetch FAILING midway (simulated network drop).** The cascade is documented to "never block init." Test by having `model-fetcher.js` honor a chaos-mode env var that randomly drops 30% of requests, run init, assert it completes successfully and the cascade report is `partial`. Run: `SWEET_SEARCH_CHAOS_DROP=0.3 npx sweet-search init --profile full`.

4. **Self-heal migration second-rebuild test.** The C1 fix's self-heal migrates broken state on first load. The test in `tests/indexing/li-staged-save.test.js` verifies a SINGLE load handles the migration. What's not tested: a second `--full` rebuild AFTER the self-heal fired produces a normally-shaped index (i.e., the migration path doesn't leave subtle residual state). Run: pre-seed broken state, run `--full` once, run `--full` a second time, diff `.sweet-search/` between the two.

5. **Worker pool contention scenario — 8 parallel embed calls under high CPU load.** The H6 fix is supposed to remove the SHA256 stall. Confirm this empirically: spawn 8 `node` processes that all call `fetchModel('coderankembed-int8')` at once, with `cpulimit` or background CPU stress, and assert each completes in <5s. The fix-pack reports "1090ms (previously ~2 min)" but doesn't say how many concurrent workers that was measured with.

6. **Cross-target verification that the binary HNSW + Int8 sidecar actually loads after a successful build**. The C2 fix means `updateArtifacts()` no longer ReferenceErrors, but `updateArtifacts()` is only called from `artifact-builder.js`'s incremental path which is out of scope. The full-rebuild path through `buildFromCodebaseDb` was not tested for the 3-stage retrieval load on the produced artifact. Run: `node index-codebase-v21.js --full`, then `node -e "import('./core/vector-store/binary-hnsw-index.js').then(m => new m.BinaryHNSWIndex({indexPath: '.sweet-search/codebase-binary-hnsw.idx'}).load())"` and assert no error.

7. **MRR on the FULL gencodesearchnet (6000q, 6 lang)**, not just the Python subset of 500. The fix-pack cites `0.9793` which is `gencodesearchnet_2026-04-14T15-20-48-858Z.json` — a 500q Python subset per `PAPER_RANKING.md`. The "84.06%" headline is from `gencodesearchnet_2026-04-13T08-56-35-196Z.json`, 6000q. Re-run the 6000q benchmark on the post-fix-pack index and verify the 84.06% is preserved within ±0.5pp. **This is the only number that proves the fix-pack didn't regress the system-level MRR.**

---

## 11. Overall grade & scorecard

**Grade: B+** for the fix-pack as a piece of work; **C+** for the indexing pipeline as a system shipped on this commit.

| Axis | Grade | Rationale |
|------|-------|-----------|
| Correctness | **A−** | C1 + C2 properly fixed, regression tests added, MRR byte-identical, self-heal designed correctly. Knock down for the cross-language schema gap (cascade JSON ↔ Rust parser) which is a latent correctness time bomb. |
| Performance | **B** | Real wins (CoreML cascade 18%, Float32Array napi 2x, BF16 1.6x) but every number is a single M3 Max measurement with no variance and no cross-platform validation. The H6 win is real but only on the worker-pool contention path. |
| Security | **B−** | INIT_STRATEGY.md SHA256 model is intact; H6 cache correctly memoizes only positive prior verifications; uninstall is honest. Knock down for `coreml-cascade.json` being a cross-language config trust anchor with no schema validation and no second-source hash. |
| DDD | **B+** | H1 properly fixed with a clean slot pattern, check-boundaries.js now counts dynamic imports correctly. The slot pattern is sanctioned and reusable. Knock down for asymmetric application (only embedding, not ranking) and for the `indexing → ranking` exception cap rising from 2 to 6 in one commit (correct, but a regression in coupling tightness). |
| Complexity | **C** | 7 files still over 500 LOC, plus `summary-manager.js` is a NEW breach at 542 lines. `indexer-phases.js` grew 87 lines, `indexer-ann.js` grew 144 lines, `indexer-pool.js` grew 50 lines. The fix-pack made things bigger without making them cleaner. The 26 `tests/diagnose-*.js` scripts are unaccounted bloat. |
| Docs | **B** | DDD_ARCHITECTURE.md and INIT_STRATEGY.md are mostly current and honest about the deferred items. PAPER_RANKING.md is high-quality but its existence may be a process violation if not user-requested. The `docs/reviews/` directory layout drifts (old files at root, new files in subdirectory). |

**Bottom-line shippability**: the fix-pack closes the two P0 data-integrity bugs, addresses the only CI-blocking DDD violation, and demonstrates zero MRR regression. The deferred items are honestly documented. **Ship it as a patch release**, with the three blocking items in section 7 tracked as the next-tag work.

**Codex's job, if I'm being direct**: read the C1 fix in `indexer-phases.js:74-120` and `late-interaction-index.js:1690-1795` carefully — the reasoning is correct but the rollback-window comment in `atomicSwapLateInteractionIndex:80-86` describes a real (narrow) failure window that the self-heal handles. Verify the self-heal is idempotent under partial states (the test only covers one shape). Then look at `coreml-cascade.json` and `embedding_model.rs:139` side-by-side and decide whether the literal hardcoding is acceptable until a parity test exists.

---

**End of synthesis.**
