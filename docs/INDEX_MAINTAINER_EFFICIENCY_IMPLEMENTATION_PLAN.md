# Index-Maintainer Efficiency — Implementation Plan

**Date:** 2026-06-23
**Source design:** `docs/INDEX_MAINTAINER_EFFICIENCY_RESEARCH.md` (levers A.1–A.6, B, C, D.1–D.5, E.1–E.6)
**Status:** implementation spec only — no code changed by this document.

This is the concrete, conflict-aware, per-file build plan for every recommendation in the research
doc, honoring its §5 phasing and §1.1 risk tiers + verification plan. The USER runs the accuracy/MRR
gate and the byte-diff; this plan makes every change verifiable and specifies the §1.1 determinism
harness.

---

## 0. Hard constraints (project policy) encoded into every group

1. **Never regress MRR/Recall or index correctness for speed.** Every encode-path and ranking-path
   change is gated; Tier-2/Tier-3 items ship only after the USER's GCSN dev + held-out gate.
2. **Tier-2/Tier-3 items must be output-equivalent and gated** — gates are encoded as env flags
   (default narrow/off for risky encode-path changes).
3. **New structured ranking signals stay off by default.** None of these levers add a ranking
   signal; the only encode-path numeric risk (B: thread count / arena) is env-gated and
   benchmark-blocked.
4. **Files under 500 lines where practical; edit existing files; follow DDD layering**
   (`domain/` pure, `application/` orchestration, `infrastructure/` I/O). New helpers go in the
   correct layer; new platform/native code is isolated.
5. **The USER owns the accuracy gate and byte-diff.** This plan ships the determinism harness
   (Group G0) the USER runs; every Tier-1/Tier-2 group declares which artifacts must byte-diff clean.

---

## 0.5 HNSW determinism — the gating question, resolved

**Question:** does E.1 (batch tier writes per tick) stay byte-identical, or does it need a
determinism fix first?

**Answer: E.1 is NOT byte-identical as written and MUST be preceded by a determinism fix
(Group G1) for the HNSW tier.** Verified in `core/vector-store/binary-hnsw-index.js:141`:

```js
getRandomLevel(){ const mL=1/Math.log(this.M); let level=Math.floor(-Math.log(Math.random())*mL); return Math.min(level,10); }
```

`getRandomLevel()` draws from the **global, unseeded `Math.random()`** at insert time (`add()` :189),
and `load()` (:835) never resets RNG state. Per-file (reload→insert-few→save, ×50) vs. batched
(load-once→insert-all→save-once) consume the global RNG stream in a **different interleaving**, so a
given node id receives a **different level**, producing a structurally different graph (different
`entryPoint`/`maxLevel` at :314, different neighbor lists). The same non-determinism already exists
run-to-run in `binaryHnswHandler` compaction (`maintenance-handlers.mjs:195` `resetForBuild()+add()`).

Therefore the build order is:

- **G1 (determinism fix) lands first**: replace `Math.random()` with a **per-id deterministic level**
  = `hash(id)` mapped through the same exponential CDF (`-ln(u)*mL`, `u∈(0,1]` derived from a hash of
  the id), making the level **insertion-order-independent**. This is the strongest fix and the only
  one that makes batched == per-file == compaction byte-identical. It is gated
  (`SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS`, default **off** until the USER's byte-diff + MRR gate
  confirms recall-neutral) so the level distribution change is provable, not assumed.
- **G2 (E.1 batching) depends on G1.** Only after G1 is on do batched and per-file modes converge.
  Until G1 is gated-on, E.1 ships behind its own flag and is verified **recall-equivalent** (not
  byte-identical) — the byte-identical claim is only made once G1 is on.
- Even with a per-id level, byte-identity also needs **identical insertion order** and identical
  neighbor-prune order (`selectNeighborsHeuristic`/`pruneNeighbors` are tie-order-sensitive). G2
  locks a deterministic insertion order (sort ops by id within the tick) so the byte-diff can pass;
  if it cannot be made byte-identical, the fallback acceptance is **recall-equivalent within noise**
  on the USER's MRR gate.

**Crash-consistency corollary (Tier-2):** deferring the HNSW + float-sidecar save to end-of-tick
breaks today's per-file persist-before-advance ordering. `this.touched` is populated in
`applyVectorDelta` (`production-reconciler.mjs:438`) the moment SQLite vectors land, **before** the
(now deferred) HNSW save. G2 must gate `persistManifest` (`:539`) and the processing-queue unlink
(`:552`) on the batched HNSW + float save having fsynced, and exclude any file not in the persisted
HNSW batch from `merkle.files` / requeue it. This is covered by the crash-consistency test in G0/G2.

---

## 1. File-group map (conflict-free ownership)

Each group **owns its files end-to-end** for all its levers. No two groups edit the same file. The
two known overlaps are merged into single groups:

- `index-maintainer.mjs` is touched by **A** (setPriority, autotune-consume) AND **D** (idle-TTL) →
  **one group G4**.
- `production-reconciler.mjs` + `reconciler.mjs` are touched by **E.1/E.2/E.4/E.5/E.6** AND the
  autotune-config (A.4) → consolidated so the reconciler files have a **single owner (G2)**; A.4's
  config edit in `production-reconciler.mjs` is delegated to G2 to avoid a second writer.
- `maintainer-launcher.mjs` (A.2/A.3 post-spawn helper + D.2 respawn already exists) → **G5**.

| Group | Owns (files) | Levers | Phase | dependsOn |
|---|---|---|---|---|
| **G0** harness | `eval/index-maintainer-determinism/*` (new), `tests/indexing/incremental-indexing-determinism-harness.test.js` (new) | §1.1 verification plan | 1 | — |
| **G1** HNSW determinism | `core/vector-store/binary-hnsw-index.js`, `core/incremental-indexing/application/maintenance-handlers.mjs` | E.1 prerequisite (level RNG) | 1 | G0 |
| **G2** reconciler batching + SQLite + FTS5 + cutoff + autotune-config | `core/incremental-indexing/application/production-reconciler.mjs`, `core/incremental-indexing/application/reconciler.mjs`, `core/incremental-indexing/application/production-reconciler-helpers.mjs`, `core/vector-store/float-vector-store.js`, `core/incremental-indexing/infrastructure/sqlite-fts5.mjs` (add `fts5Optimize`), `core/incremental-indexing/domain/cutoff-cache.mjs` (new) | E.1, E.2, E.4, E.5, E.6, A.4(config) | 1→3 | G1 |
| **G3** ORT background profile | `core/embedding/embedding-local-model.js`, `core/infrastructure/onnx-session-utils.js` | B | 2 | — |
| **G4** daemon lifecycle (priority + autotune-consume + idle-TTL + model unload) | `core/indexing/index-maintainer.mjs`, `core/incremental-indexing/domain/interval-autotune.mjs` (add `backstopWalkIntervalMs`) | A.1, A.4(consume), D.1 | 1→3 | G2 |
| **G5** launcher + OS priority helper + native priority addon | `core/indexing/maintainer-launcher.mjs`, `core/indexing/os-priority.mjs` (new), `native/bg-priority/*` (new optional addon), `package.json` (optionalDependencies) | A.2, A.3, A.5, A.6 | 1→4 | — |
| **G6** file watcher | `core/indexing/maintainer-watcher.mjs` (new), watcher wiring in `core/indexing/index-maintainer.mjs` lifecycle (see note), `package.json` (`@parcel/watcher` dep) | C | 3 | G4 |
| **G7** RSS-budget LRU + memory-pressure | `core/search/daemon-registry.js`, `core/indexing/rss-budget.mjs` (new), `native/mem-pressure/*` (new optional addon) | D.3, D.4 | 4 | G4 |
| **G8** shared model server | `core/embedding/model-server.mjs` (new), `core/embedding/model-client.mjs` (new), `core/embedding/embedding-service.js` (dispatch shim) | D.5 | 4 | G3, G4 |
| **G9** mmap HNSW | `core/vector-store/binary-hnsw-index.js` (format/load path) | E.3 | 4 | G1, G2 |

**Conflict note on G4/G6:** both touch `index-maintainer.mjs`. To keep single-writer ownership,
**G4 owns `index-maintainer.mjs` end-to-end**, including the watcher start/stop/early-wake hooks. G6
delivers the watcher as a **self-contained module** (`maintainer-watcher.mjs`) with a stable
`startWatcher({stateDir, projectRoot, admissionPolicy, onEvent, onOverflow})` interface; G4 wires the
three call sites (start after lock, early-wake in `sleepWithProgress`, teardown in `finally`).
**G6 dependsOn G4** so G4's lifecycle hooks exist before G6 plugs into them. Likewise **G9 dependsOn
G1+G2** because it changes the on-disk HNSW format that G1 made deterministic and G2 batched.

---

## 2. Group specs

### G0 — Determinism + crash-consistency harness (Phase 1, no production code)

**Files (new):**
- `eval/index-maintainer-determinism/run-harness.mjs` — driver.
- `eval/index-maintainer-determinism/fixtures/` — a fixed-SHA mini-repo + a fixed edit sequence
  (add / modify-1-chunk / modify-with-dependency-change / delete / rename) as a JSON script.
- `eval/index-maintainer-determinism/dump-artifacts.mjs` — canonical dumpers.
- `tests/indexing/incremental-indexing-determinism-harness.test.js` — unit-level smoke that the
  dumpers + diff are stable on a 3-file repo.

**changeSummary:**
- `run-harness.mjs` exposes `runFixedSequence({ variant: 'baseline'|'candidate', envOverrides })`:
  builds a baseline full index, replays the edit script through the reconciler tick path, then calls
  `dumpAllArtifacts(stateDir)`.
- `dumpArtifacts.mjs` produces **canonical, timestamp/epoch-stripped** dumps of all five artifacts:
  `codebase.db` (`.dump` via better-sqlite3 iterate, ORDER BY rowid), `code-graph.db` (same),
  `codebase-binary-hnsw.idx` sidecars (`.meta/.vectors/.graph/.int8.json` parsed + re-serialized
  with sorted keys), `codebase-float-vectors.bin` (header + per-id float arrays sorted by id), LI
  segments (`codebase-late-interaction.db` dump), sparse-gram (`.ssgrmdelta` records sorted by key),
  and `merkle-state.json` modulo `epoch`/`*timestamp*`/`queued_at`.
- `byteDiff(a, b)` returns the first differing artifact + key path.
- **Crash-consistency mode:** `runFixedSequence` accepts `killAfter: {tick, phase}` to SIGKILL the
  reconcile worker mid-tick (via a child process running one tick), then restart and assert the
  re-reconciled artifacts equal a clean run's.

**gating:** none (eval/test only). Harness reads candidate env flags so it can diff
flag-on vs flag-off for each group.

**tests:** new harness test verifies the dumpers are deterministic for two identical runs (the
control: baseline-vs-baseline diff is empty). Existing `incremental-indexing-atomicity-crash.test.js`
is the pattern reference for SIGKILL-restart.

**dependsOn:** —

---

### G1 — HNSW level determinism (Phase 1, gated; E.1 prerequisite)

**Files:** `core/vector-store/binary-hnsw-index.js`,
`core/incremental-indexing/application/maintenance-handlers.mjs`.

**changeSummary:**
- In `binary-hnsw-index.js`, add `levelForId(id)` next to `getRandomLevel()` (`:141`). It computes a
  uniform `u∈(0,1]` from a stable hash of the node id (e.g. FNV-1a/xxhash of the string id → map to
  `(0,1]`), then `level = min(floor(-ln(u) * (1/ln(M))), 10)` — same CDF, no global RNG.
- Gate the choice in `add()` (`:189`): when
  `process.env.SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS === '1'`, call `levelForId(id)`; else
  `getRandomLevel()`. Default **off**. Thread the same flag through `resetForBuild()`/the
  compaction rebuild loop so all three construction paths (incremental add, end-of-tick batch in G2,
  compaction in `maintenance-handlers.mjs:195`) agree.
- In `maintenance-handlers.mjs` `binaryHnswHandler`, the `resetForBuild()+add()` rebuild
  (`:195–201`) must iterate the surviving ids in a **fixed sorted order** so the compacted graph is
  reproducible when the flag is on.

**gating:** `SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS` (default `0`/off). Widen to default-on only
after the USER's byte-diff (G0) shows batched==per-file==compaction and the GCSN dev+held-out MRR
gate shows recall-neutral (the level-distribution change is statistically identical to the random
CDF, but must be **proven** per `feedback_accuracy_nonnegotiable`).

**tests:**
- Existing: `incremental-indexing-binary-hnsw-visibility.test.js`,
  `incremental-indexing-tombstone-bitmap.test.js`, `tests/vector-store/*hnsw*`.
- New unit: assert `levelForId(id)` is pure (same id → same level across calls and across a fresh
  process) and that its level histogram over 10k ids matches the `Math.random()` CDF within a
  chi-square tolerance.
- Verification: G0 byte-diff with flag on → two independent builds of the same id set produce
  byte-identical `.graph.json`. USER runs MRR gate.

**dependsOn:** G0.

---

### G2 — Reconciler batching, SQLite pragmas, FTS5 budgeting, chunk-cutoff, autotune-config (Phase 1→3)

**Files:** `core/incremental-indexing/application/production-reconciler.mjs`,
`core/incremental-indexing/application/reconciler.mjs`,
`core/incremental-indexing/application/production-reconciler-helpers.mjs`,
`core/vector-store/float-vector-store.js`,
`core/incremental-indexing/infrastructure/sqlite-fts5.mjs`,
`core/incremental-indexing/domain/cutoff-cache.mjs` (new).

This is the largest group; it owns both reconciler files so E.1/E.2/E.4/E.5/E.6 + A.4-config never
collide with another writer. Sub-levers are individually gated so they can land and be verified
one at a time within the group.

**E.1 — batch per-tier writes per tick (Phase 1, Tier-2):**
- Introduce a **tick-scoped store context** owned by `Reconciler.tick` (`reconciler.mjs:228`):
  open `codebase.db` (RW), `code-graph.db` (RW), `code-graph.db` (RO for enrichment), the resident
  `BinaryHNSWIndex` (loaded once), and the `FloatVectorStore` (loaded once) at **tick start**; pass
  the handles into `_reconcileOneFile` (`:360`) and on into each `apply*Delta` adapter.
- In `production-reconciler.mjs`, change `applyBinaryHNSWDelta` (`:455`) to accept the resident index
  + float store instead of `new BinaryHNSWIndex()`+`load()`(`:459`)+`save()`(`:478`)+
  `maintainFloatStore`(`:480`) per call — accumulate ops only. Change `applyVectorDelta` (`:374`) and
  `applyGraphDelta` (`:297`) and `enrichChunksFromGraph` (`:105`) to reuse the tick-scoped
  connections instead of `new Database()` per file.
- Add a **tick-finalize step** at the end of `Reconciler.tick`: save HNSW once, save float store once
  (`maintainFloatStore` hoisted to `production-reconciler-helpers.mjs` as `flushFloatStore`), then
  `wal_checkpoint(PASSIVE)` + close. Insertion order into HNSW is sorted by id (for G1 byte-identity).
- **Persist-before-advance:** gate `persistManifest` (`:539`) and the processing-queue unlink
  (`:552`) on the HNSW + float fsync succeeding. Make `this.touched.set` (`:438`) provisional;
  promote a file into `merkle.files` only after its ops are in the persisted HNSW batch. On budget
  cut, files not in the persisted batch go to `deferredFiles` → `requeueDirtyFiles` (`:258`).
- Gate: `SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES` (default **off** initially; flip on after G0
  recall-equivalent + crash-consistency pass; byte-identical claim requires G1 on).

**E.2 — keep HNSW live across ticks + threshold save (Phase 3, depends on E.1):**
- Promote the tick-scoped resident index to a **daemon-scoped** singleton held by the reconciler
  instance; do not close it at tick end. Track `deletedCount/totalCount`; save to disk only on
  (a) graceful shutdown, (b) deletion-fraction ≥ `0.15` (reuse `markBinaryStale`
  tombstones in `production-reconciler-helpers.mjs:63`), (c) every N inserts (~5–10 min cadence).
  Add an in-class deletion-fraction trigger (currently only the external `binaryHnswHandler` rebuilds).
- Same persist-before-advance discipline; widens the crash window, so the save-on-budget-cut path
  must still fsync before the manifest advances for the affected files.
- Gate: `SWEET_SEARCH_RECONCILE_LIVE_HNSW` (default off).

**E.4 — SQLite memory pragmas (Phase 1, Tier-1):**
- After the existing `journal_mode=WAL; synchronous=NORMAL` in `applyVectorDelta` (`:375–376`),
  `applyGraphDelta` (`:298–299`), and the LI write conn (`production-li-delta.mjs`), add
  `cache_size=-32768`, and set `soft_heap_limit=134217728` **once at daemon startup** (it is
  process-global — G4 sets it, G2 documents the dependency). With E.1 on, these attach to the
  tick-scoped (persistent across the tick) conns so the cache is meaningful; **note** that without
  E.1 the per-file conn churn makes them near no-ops (documented in the plan, not a bug).
- After the maintenance drain, call `PRAGMA shrink_memory` on the tick-scoped conns
  (in the tick-finalize step).
- `mmap_size` is added to the **readonly** maintainer conns in
  `maintenance-state-reader.mjs` / `maintenance-handlers.mjs` readonly opens (low benefit — the user
  search path is native Rust, not JS — but harmless and matches the doc). Owned by G2 since they sit
  under the same context; documented as negligible-user-benefit.
- **Correction encoded:** the doc's `incremental_vacuum(100)` for the "sparse-gram DB" targets a
  non-existent DB — sparse-gram is flat `.ssgrmdelta` files (`sparse-gram-delta.mjs`). G2 applies
  `incremental_vacuum` **only** to the SQLite tiers and **only** if `auto_vacuum=INCREMENTAL` is set
  at schema-create (a non-drop-in change deferred to Phase 3; gated
  `SWEET_SEARCH_RECONCILE_INCR_VACUUM`, default off). For sparse-gram, the existing
  `compactDeltaSegments` file-merge is the analogue — left as-is.
- Gate: `SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS` (default off → flip on after G0 byte-diff clean,
  which it will be since cache/heap settings don't change query output).

**E.5 — budgeted FTS5 merge + idle-gated optimize (Phase 1, Tier-1):**
- In `production-reconciler.mjs:362` replace the fixed `fts5Merge(db, table, 16)` with a
  budget-derived page count (token bucket: tick<500ms→small merge, tick>1800ms→skip).
- In `maintenance-worker.mjs` the watermark `fts5` handler (`:235` pages=500, `:245` exec) derives
  `pages` from remaining `budgetMs` (the existing `processMaintenanceQueue` budget gate at `:310`).
  Note: `maintenance-worker.mjs` is owned by G2 for these two edits only — flag to other groups that
  G2 owns it. (No other group edits it.)
- Add `fts5Optimize(db, table)` to `sqlite-fts5.mjs` (near `:166`) — a **new** helper (optimize is
  deliberately never called today, `:158`). It runs `INSERT INTO <t>(<t>) VALUES('optimize')`
  **only** when gated by: true-idle (consecutive empty ticks) AND table-size check AND a
  `wal_checkpoint(TRUNCATE)` immediately after, to avoid the documented 256MiB-WAL bloat alarm.
- Gate: `SWEET_SEARCH_RECONCILE_FTS5_BUDGET` (merge budgeting, default off → Tier-1 flip-on);
  `SWEET_SEARCH_RECONCILE_FTS5_OPTIMIZE` (idle optimize, default off, conservative).

**E.6 — chunk-hash early-cutoff (Phase 3, Tier-3 correctness-risk):**
- New `core/incremental-indexing/domain/cutoff-cache.mjs`: persist `{filePath → [embedding_input_hash...] + [li_input_hash...]}` alongside the merkle `chunkIds` (`production-reconciler.mjs:546`).
- In the consumer, before re-embedding a changed file, compare the new per-chunk
  `embedding_input_hash`/`li_input_hash` set (from `chunkInputHashes`, `encoder-input.mjs:198`) to the
  persisted set; if **all** match, skip embedding + all tier writes for that file.
- **Correctness gate (the §1.1 Tier-3 risk):** the cutoff key MUST be `embedding_input_hash` +
  `li_input_hash` (which fold in cross-file enrichment via `enrichChunksFromGraph`, `:102`), NEVER the
  file's own `chunk_text_hash` or `hashFile.contentUnchanged` (`:287`). This is enforced in code and
  asserted by a test that changes a dependency's symbols and verifies the dependent file is **not**
  skipped.
- Gate: `SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF` (default off; ship only after the USER's recall gate).

**A.4-config — autotune flag + signal (Phase 1; consumed in G4):**
- In `createProductionReconciler` config (`production-reconciler.mjs:141–145`) add
  `autotuneInterval: true` and `cpuLoadAvg: os.loadavg()[0]/Math.max(1, os.cpus().length)` (add
  `import os from 'node:os'` — currently absent). Also pass `maintenanceBacklog` from the maintenance
  state. The reconciler config edit lives here (single writer); the **consume half** (the daemon must
  read the tuned interval back) is in G4. Gate: `SWEET_SEARCH_RECONCILE_AUTOTUNE` (default off,
  flipped on with G4's consume wiring after the incremental-soak benchmark).

**gating summary (G2):** every sub-lever has its own env flag, all default **off**; Tier-1
(E.4, E.5-merge) flip on after a clean G0 byte-diff; Tier-2 (E.1, E.2) flip on after G1 + crash
test; Tier-3 (E.6) only after the USER's recall gate.

**tests:**
- Existing: `incremental-indexing-reconciler.test.js`,
  `incremental-indexing-production-reconciler.test.js`, `incremental-indexing-multi-tier-workflow.test.js`,
  `incremental-indexing-vector-delta.test.js`, `incremental-indexing-fts5.test.js`,
  `incremental-indexing-li-segment*.test.js`, `incremental-indexing-sparse-delta.test.js`,
  `incremental-indexing-atomicity-crash.test.js`, `incremental-indexing-manifest.test.js`,
  `tests/vector-store/float-vector-store.test.js`, `incremental-indexing-encoder-input.test.js`.
- New: (a) **byte-identical tick** test via G0 harness with E.1+G1 on (batched == per-file);
  (b) **crash-consistency** test: SIGKILL between SQLite commit and HNSW batch-save → restart →
  artifacts equal clean run, and no "indexed-but-missing-from-HNSW" merkle row;
  (c) **E.6 dependency-change** test (dependent file not skipped);
  (d) **FTS5 budget** test (merge pages scale with spare budget; optimize only fires on idle).
- Verification: USER byte-diff (Tier-1 + Tier-2-with-G1), USER MRR gate (E.6), crash test (E.1/E.2).

**dependsOn:** G1.

---

### G3 — ORT background profile (Phase 2, benchmark-gated, Tier-3)

**Files:** `core/embedding/embedding-local-model.js`, `core/infrastructure/onnx-session-utils.js`.

**changeSummary:**
- Add a **background-profile branch** to `buildLocalSessionOptions` (`:173`): when a bg flag is set
  in `localModelRuntimeConfig` (or `SWEET_SEARCH_ORT_BACKGROUND=1`), emit
  `extra.session.force_spinning_stop:'1'` (drop the hardcoded `allow_spinning:'1'` at `:186–190`),
  set `enableCpuMemArena:false`, and use `intraOpNumThreads` from the bg setting (2–4). Keep the
  foreground/full-index path on `allow_spinning:'1'` + arena on (branch, do not change the shared
  default).
- **Verify the config key is honored:** the MAP agent confirmed via `strings` on the installed
  `onnxruntime_binding.node` (1.24.3 darwin/arm64) that `SessionOptions.extra` IS parsed by the
  native binding (validation strings present), contradicting the stale TS "WebAssembly only" doc and
  the RESEARCH agent's web-doc-based claim. **The plan trusts the binary inspection** but adds a
  startup self-check: build a throwaway session with the bg `extra` and log if it errors, falling
  back to thread-count-only if the key is rejected. `RunOptions.extra` is confirmed **not wired** —
  do not use per-Run arena shrinkage; `enableCpuMemArena:false` is the only arena lever.
- `onnx-session-utils.js`: add a `backgroundIntraOpThreads()` returning a clamped 2–4 (read
  `SWEET_SEARCH_INTRA_OP_THREADS`); `bestIntraOpThreads` (`:236`) stays for the foreground path.
- **Affinity caveat encoded:** `intra_op_thread_affinities` is a no-op on macOS
  (`pthread_setaffinity_np` unavailable) — do NOT rely on it; E-core routing comes from G5's
  process-level `taskpolicy -b`, not from ORT affinity.

**gating:** `SWEET_SEARCH_ORT_BACKGROUND` (default off). The daemon (G4) sets it via
`configureLocalModelRuntime(...)` **before the first encode** (singleton built once on first encode —
configuring after is a silent no-op; this ordering constraint is the load-bearing risk). Process-wide
config contamination caveat: if the daemon also serves query embeddings, the bg thread cap throttles
foreground query latency — for the maintainer daemon this is acceptable (it owns its process); a
daemon that also serves search must NOT set the bg profile process-globally (documented; resolved
cleanly by G8's shared model server if that path is taken).

**tests:**
- Existing: `tests/embedding/*` session-option tests (if present), `incremental-indexing-encode-skip-verify.test.js`.
- New unit: `buildLocalSessionOptions` emits `force_spinning_stop` + arena-off only under the bg flag;
  foreground path unchanged (snapshot the emitted options object).
- Verification: **USER GCSN dev + held-out MRR gate** (thread count + arena can perturb INT8
  numerics → HNSW neighbor flips) AND a **byte-identical-index check** via G0 (embeddings identical →
  artifacts identical). This is the §1.1 Tier-3 gate; ship only on a pass.

**dependsOn:** — (independent of reconciler; but the daemon wiring to *use* it is in G4).

---

### G4 — Daemon lifecycle: OS priority + autotune-consume + idle-TTL + model unload (Phase 1→3)

**Files:** `core/indexing/index-maintainer.mjs`,
`core/incremental-indexing/domain/interval-autotune.mjs`.

This group owns `index-maintainer.mjs` end-to-end (A.1 priority, A.4 consume, D.1 idle-TTL, the G3
bg-profile arming call, and the G6 watcher wiring hooks) so it is the single writer.

**A.1 — `os.setPriority` (Phase 1, Tier-1):**
- At the top of `main()` (`:2178`, before the `runReconcileV2Main` branch at `:2188`):
  `try { os.setPriority(os.constants.priority.PRIORITY_LOW); } catch {}`. Covers both reconcile-v2
  and legacy paths; demotes only the daemon, not the launcher's parent. Add
  `import os from 'node:os'` if absent.
- Set the **process-global** `soft_heap_limit` (E.4's global half) here too, once, before any tier
  conn opens — documented dependency with G2.

**G3 arming (Phase 2):** at daemon startup, before the first `runReconcileV2Tick` embeds, call
`configureLocalModelRuntime({ intraOpThreads: backgroundIntraOpThreads(), background: true })` when
`SWEET_SEARCH_ORT_BACKGROUND=1`. Mirrors `indexer-phases.js:491`. Must precede first encode
(singleton timing).

**A.4-consume — wire the tuned interval into the sleep loop (Phase 1):**
- The daemon currently captures `intervalMs` as a `const` at `:1106–1107` and sleeps on it forever
  (`:1175`). Change the loop to **recompute the interval each iteration** before
  `sleepWithProgress`: import `nextInterval` from `interval-autotune.mjs`, feed
  `cpuLoadAvg = os.loadavg()[0]/Math.max(1,os.cpus().length)`, `currentMs`, measured `lastTickMs`,
  `dirtyAtTickStart`, `maintenanceBacklog`, and reassign a `let intervalMs`. Windows fallback:
  `os.loadavg()` returns `[0,0,0]` → skip the loosen-under-load signal (documented; use a flat
  interval on Windows or PSI-equivalent later).
- Gate: `SWEET_SEARCH_RECONCILE_AUTOTUNE` (shared with G2's config flag, default off → flip on after
  the incremental-soak benchmark; 15s was the only soak-validated floor).

**D.1 — idle-TTL self-shutdown (Phase 3):**
- After `acquireStateLock` succeeds (`~:1089`), add an unref'd `setInterval` mirroring
  `search-server.js:907–913`. **Activity signal:** the maintainer has no query route — key idle on
  `dirtyAtTickStart===0` AND empty maintenance queue across N **consecutive** ticks (an `idleTicks`
  counter incremented on empty ticks, reset on any indexed change), NOT on the self-heartbeats
  (`recordProgress`/`writeStateLock` always tick). When wall-clock idle exceeds
  `SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS`, set `shutdownRequested=true` (do NOT `process.exit` — let the
  loop drain the current tick to the `finally` at `:1177`).
- In the `finally` block (`:1177–1181`), before the final log, `await unloadLocalModel()`
  (`embedding-local-model.js:833`) to release the ORT session in order; then `releaseStateLock`
  unlinks the `O_EXCL` lock so the next `launchMaintainer` respawns cleanly (reconcile-before-serve
  via the new daemon's t=0 tick). Note: `unloadLocalModel` cannot go in the `process.on('exit')`
  handler (`:1119`, no async) — it goes in `finally`.
- Latency caveat encoded: an idle timer that fires mid-tick won't interrupt the current
  `runReconcileV2Tick`; exit is delayed up to one tick/timeout. Acceptable (flush-first).
- Gate: `SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS` (default `0`/disabled initially; set to e.g.
  `1_200_000` (20 min) after soak validation). Must not double-count with `search-server.js`'s
  existing idle-TTL+LRU — verify the footprint note's R2/R3 didn't already land a second mechanism.

**G6 watcher hooks (Phase 3, wiring only):** add `startWatcher(...)` after lock-acquire,
early-wake check inside `sleepWithProgress` (break when watcher sets a pending-events flag),
teardown in `finally`. The watcher module itself is G6.

**`interval-autotune.mjs` edit:** add a `backstopWalkIntervalMs` resolver (5–15 min, sibling to
`startupInterval`/`TIER_TABLE` at `:106`) for G6's backstop cadence. G4 owns this file.

**tests:**
- Existing: `incremental-indexing-interval.test.js`, `incremental-indexing-heartbeat.test.js`,
  `incremental-indexing-lockfile.test.js`, `maintainer-lifecycle-fix.test.js`,
  `tests/integration/index-maintainer.integration.test.js`, `incremental-indexing-daemon-maintenance.test.js`.
- New: (a) autotune-consume test (tuned interval actually changes the sleep duration — guards the
  "doubly-dead" trap); (b) idle-TTL test (N empty ticks → `shutdownRequested` set → clean
  `finally` runs `unloadLocalModel` + `releaseStateLock`; a busy tick resets the counter);
  (c) priority-set smoke (no throw on each platform).
- Verification: freshness probe (edit→queryable latency) + incremental-soak (USER) for autotune/idle.

**dependsOn:** G2 (consumes the tuned interval the reconciler config produces; reconciler files
already owned/stable).

---

### G5 — Launcher OS priority helper + native addon (Phase 1→4)

**Files:** `core/indexing/maintainer-launcher.mjs`, `core/indexing/os-priority.mjs` (new),
`native/bg-priority/*` (new optional napi-rs addon), `package.json`.

**A.2/A.3 — post-spawn OS helper (Phase 1, Tier-1):**
- New `os-priority.mjs` exports `applyBackgroundPriority(pid)`: best-effort, never throws.
  macOS → `spawn('taskpolicy', ['-b','-p',String(pid)], {stdio:'ignore'}).unref()`; Linux →
  `spawn('ionice',['-c','3','-p',String(pid)])` + `spawn('chrt',['-b','-p','0',String(pid)])`.
- In `maintainer-launcher.mjs`, call `applyBackgroundPriority(child.pid)` immediately after
  `child.unref()` (`:130`), before the `return` (`:132`). The launcher runs in the caller's
  (foreground) process, so this only demotes the child.
- D.2 respawn already exists (`search-server.js:891`, `session-daemon-prewarm.mjs:291`, MCP startup
  all call `launchMaintainer`, O_EXCL-guarded) — no new code; G5 just documents the contract that
  idle-exit (G4) + these triggers = on-demand respawn.
- Gate: `SWEET_SEARCH_MAINTAINER_BG_PRIORITY` (default **on** for the helper — Tier-1, identical
  output, only *when* CPU is granted changes; off-token disables).

**A.5/A.6 — native priority addon (Phase 4, optional):**
- `native/bg-priority/` napi-rs addon: `setBackgroundMode(enable)` →
  Windows `SetPriorityClass(PROCESS_MODE_BACKGROUND_BEGIN/END)`; macOS per-thread
  `pthread_set_qos_class_self_np(QOS_CLASS_BACKGROUND)` for ORT worker threads (A.6). Published as
  per-platform `optionalDependencies`; `os-priority.mjs` loads it if present, falls back to
  `os.setPriority(PRIORITY_LOW)` (G4) if absent.
- Caveats encoded: Windows `PROCESS_MODE_BACKGROUND_BEGIN` empties the working set (use only during
  bulk phases, call END before serving) → this is an **openDecision**. Never mix raw
  `setpriority`/`taskpolicy` with QoS on the same thread.
- Gate: addon presence + `SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY` (default off).

**tests:**
- Existing: `maintainer-launcher.test.js`.
- New: `os-priority.mjs` unit (correct command per platform, never throws on missing binary);
  launcher test asserts `applyBackgroundPriority` called with `child.pid`.
- Verification: foreground-latency probe (git-status / keystroke jank) at normal vs bg priority (USER).

**dependsOn:** —

---

### G6 — Event-driven file watcher (Phase 3, Tier-3 freshness)

**Files:** `core/indexing/maintainer-watcher.mjs` (new), `package.json` (`@parcel/watcher` 2.5.6).
Wiring call sites in `index-maintainer.mjs` are owned by **G4** (G6 ships the module + the three
hook signatures).

**changeSummary:**
- `maintainer-watcher.mjs` exports `startWatcher({stateDir, projectRoot, admissionPolicy, onEvent, onOverflow})`:
  `watcher.subscribe(projectRoot, handler, { ignore })` where `ignore` is built from
  `admissionPolicy.isExcluded` / `DEFAULT_DENY_DIRS` (`path-filter.mjs:28`) **plus the resolved
  `.sweet-search` stateDir** (event-storm guard — the single highest-severity risk; the daemon's own
  queue/db writes must never re-trigger). Watch-set scoped to non-ignored dirs (inotify budget).
- On event: append to `index-maintainer-queue.jsonl` with the **exact** dirty-scan line shape
  (`{file_path, timestamp, queued_at, source:'watch'}`, matching `dirty-scan.mjs:230`) and set a
  shared `pendingEvents` flag for early-wake. The watcher NEVER touches merkle and NEVER makes the
  final admit decision (consumer re-admits + content-hashes at `production-reconciler.mjs:230`).
- `.git/HEAD` + `.git/index` watch (narrow allowlist, even though `.git` is denied): on change, set a
  `forceBackstopWalk` flag (branch switch = bursty; the bounded full walk handles it, not unbounded
  per-file events).
- **Overflow handler** (`IN_Q_OVERFLOW` / `ERROR_NOTIFY_ENUM_DIR`): trigger a full backstop walk.
- **Backstop demotion** in `runReconcileV2Tick` (the producer block at `index-maintainer.mjs:907–927`,
  owned by G4): when the watcher is active, run the full `scanDirtyAndEnqueue` only (a) first tick,
  (b) every `backstopWalkIntervalMs` (G4's resolver), (c) on overflow/`forceBackstopWalk`. Otherwise
  skip the walk; the watcher already fed the queue.
- **FSEvents snapshot/replay** (`writeSnapshot` on clean shutdown to a file **outside** the watch
  tree, `getEventsSince` before `subscribe` on startup) for gap-free restart.
- Gate: `SWEET_SEARCH_MAINTAINER_WATCH` (default off; the per-tick full walk stays primary until the
  watcher is validated on a large monorepo). When off, behavior is exactly today's.

**tests:**
- Existing: `incremental-indexing-watcher.test.js` (currently a different "watcher"; confirm scope),
  `incremental-indexing-dirty-scan.test.js`, `incremental-indexing-dirty-set.test.js`.
- New: (a) event→queue-line shape matches dirty-scan exactly; (b) stateDir-exclusion prevents
  self-trigger (write to queue → no event re-appended); (c) overflow → backstop walk; (d) backstop
  cadence (walk only every Nth tick); (e) `.git/HEAD` → forceBackstopWalk.
- Verification: freshness probe (edit→queryable faster than today common case); **convergence test**
  — after a dir becomes gitignored with no file event, the 5–15 min backstop walk retires it (the
  load-bearing C1-equivalence guarantee). USER recall gate (freshness, not quality).

**dependsOn:** G4 (lifecycle hooks + `backstopWalkIntervalMs`).

---

### G7 — RSS-budget LRU + memory-pressure reactive eviction (Phase 4)

**Files:** `core/search/daemon-registry.js`, `core/indexing/rss-budget.mjs` (new),
`native/mem-pressure/*` (new optional addon).

**changeSummary:**
- `rss-budget.mjs`: a coordinator (setInterval, every 30s) summing daemon RSS; when total crosses
  `~0.60 * os.totalmem()`, SIGTERM the longest-idle daemon (sorted by last-activity asc). Auto-scales
  with system RAM (no per-machine config; respects `feedback_no_memory_cap` — soft eviction, not a V8
  cap). Builds on `daemon-registry.js`'s existing LRU cap (`search-server.js:915–942`,
  `SWEET_SEARCH_MAX_DAEMONS`); extend, don't duplicate.
- D.4 memory-pressure: Linux `/proc/pressure/memory` epoll trigger (pure JS); macOS
  `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` needs a C addon (`native/mem-pressure/`) — **openDecision**.
- Gate: `SWEET_SEARCH_RSS_BUDGET_FRACTION` (default unset/off → soft cap only when set).

**tests:** new `rss-budget.mjs` unit (eviction picks longest-idle; respects fraction); existing
`daemon-registry` tests. Verification: multi-repo soak (USER).

**dependsOn:** G4 (idle-exit + clean SIGTERM handler is the precondition for safe eviction).

---

### G8 — Shared model server (Phase 4, architectural)

**Files:** `core/embedding/model-server.mjs` (new), `core/embedding/model-client.mjs` (new),
`core/embedding/embedding-service.js` (dispatch shim).

**changeSummary:** load the ONNX model once in a separate process; per-repo daemons RPC for
embeddings (Unix socket). Saves N−1 model copies (~10GB/8 repos), keeps per-repo crash isolation,
makes per-repo state cheap to evict, and **cleanly resolves the G3 process-global-config
contamination** (the model process is bg-profiled; query-serving processes are not). High refactor
cost → **openDecision** (is the RPC hop's latency acceptable for query-time embedding?).
- Gate: `SWEET_SEARCH_SHARED_MODEL_SERVER` (default off).

**tests:** new client/server contract tests; embedding parity test (RPC embeddings == in-process,
byte-identical) via G0. **dependsOn:** G3 (bg profile), G4 (lifecycle).

---

### G9 — mmap-backed HNSW (Phase 4, format change)

**Files:** `core/vector-store/binary-hnsw-index.js`.

**changeSummary:** the current `.idx` is **JSON sidecars** (`save()` `:740` writes
`.vectors.json`/`.graph.json` etc.; `load()` `:835` is a full parse+rebuild into `Uint8Array`+`Map`).
mmap is therefore **NOT drop-in** — it requires a packed flat-binary format change (the float sidecar
`codebase-float-vectors.bin` is already flat and mmap-friendly on read). G9 introduces a packed
binary layout for the binary HNSW with a `PIPELINE_VERSION` bump + migration, mmap on the read/search
path (touched pages only). **openDecision** (format change → requires rebuild/migration; confirm the
USER wants it given the user search path is native Rust, limiting the JS-side benefit).
- Gate: `SWEET_SEARCH_HNSW_MMAP` + format version. **dependsOn:** G1 (deterministic levels must be
  preserved in the new format), G2 (batched save writes the new format once/tick).

---

## 3. Phase map + gates

| Phase | Groups (sub-levers) | Gate to advance |
|---|---|---|
| **Phase 1** (drop-in / Tier-1 + Tier-2 prereq) | G0 (harness), G1 (HNSW determinism, gated), G2[E.4, E.5-merge, A.4-config], G4[A.1, A.4-consume], G5[A.2/A.3] | **Tier-1:** G0 byte-diff clean (E.4/E.5/A.* produce identical artifacts). **Tier-2 prereq:** G1 byte-diff (batched==per-file build) + G1 MRR-neutral. Foreground-latency probe shows reduced contention. |
| **Phase 1→2 boundary** (E.1 itself) | G2[E.1] | E.1 + G1 on → G0 **byte-identical tick** + **crash-consistency** (SIGKILL mid-tick → clean reconverge, no indexed-but-missing-from-HNSW). Without G1: **recall-equivalent** on USER MRR gate, not byte-identical. |
| **Phase 2** (encode path, Tier-3) | G3[B] | **USER GCSN dev + held-out MRR/Recall within noise** AND G0 byte-identical-index (embeddings identical). Ship only on pass (`feedback_accuracy_nonnegotiable`). |
| **Phase 3** (small arch, contract unchanged) | G4[D.1 idle-TTL], G6[C], G2[E.2 live HNSW, E.6 cutoff, E.4-incr-vacuum] | Freshness probe + incremental-soak (15–20 min) convergence. E.6: USER recall gate (dependency-change not skipped). E.2: crash test. C: large-monorepo watcher validation + backstop convergence. |
| **Phase 4** (larger arch) | G7[D.3/D.4], G8[D.5], G9[E.3] | Per-item openDecision resolved; multi-repo soak; format-migration plan (G9). |

---

## 4. Byte-diff determinism harness (the §1.1 verification plan, concrete)

Delivered by **G0**. The USER runs it; this plan specifies it.

1. **Determinism harness** (`eval/index-maintainer-determinism/run-harness.mjs`): fixed-SHA repo +
   fixed edit script → run through (a) current maintainer (flags off) and (b) candidate (flags on) →
   **byte-diff all five artifacts** + `merkle-state.json` modulo timestamps/epoch. Canonical dumpers
   sort by id/rowid and re-serialize JSON sidecars with sorted keys so only *semantic* diffs surface.
   Tier-1 (E.4, E.5-merge, A.*) and Tier-2 (E.1+G1) must produce an **empty** diff.
2. **Accuracy gate:** USER's GCSN dev + held-out MRR/Recall — mandatory for **B (G3)**, recommended
   for **C (G6)** and **E.6 (G2)**.
3. **Freshness probe:** edit→queryable latency (median + worst-case) for **A/C/D** (G4/G5/G6);
   quantify the worst-case staleness window accepted for C (backstop interval).
4. **Crash-consistency test:** SIGKILL mid-tick → restart → reconcile to the same state as a clean
   run — mandatory for **E.1/E.2 (G2)**; the harness's `killAfter` mode + restart-assert covers it.

---

## 5. Doc corrections encoded (so implementers don't follow a wrong claim)

- **E.1 is NOT flatly byte-identical** (§2/§4.E.1 overclaim) — needs G1 first (HNSW level RNG).
  §1.1(b) is the correct framing.
- **E.4 `incremental_vacuum` for the "sparse-gram DB"** targets a non-existent SQLite DB —
  sparse-gram is flat `.ssgrmdelta` files. Apply incr-vacuum only to the SQLite tiers (gated,
  auto_vacuum=INCREMENTAL at schema-create), leave sparse-gram on `compactDeltaSegments`.
- **E.3 mmap is NOT drop-in** for the binary HNSW (JSON sidecars, parse+rebuild on load) — it is a
  format change (G9). Only the float sidecar is already flat.
- **SQLite pragmas are near no-ops without E.1** (per-file conn churn) — they only bind meaningfully
  once tier conns are tick-scoped.
- **autotune is doubly-dead** — flag off AND output disconnected from the daemon sleep loop; G4 must
  wire the consume half, not just flip the flag.
- **ORT `SessionOptions.extra` IS honored** by the installed 1.24.3 native binding (binary inspection)
  despite the stale TS "WebAssembly only" doc and the web-doc-based RESEARCH claim; G3 adds a
  startup self-check + thread-count-only fallback. `RunOptions.extra` is genuinely not wired.
- **ORT thread affinity is a macOS no-op** — E-core routing comes from G5's `taskpolicy -b`.
- **The maintainer idle signal is NOT a query route** — key on empty ticks, not self-heartbeats.

---

## 6. Open decisions (need a USER call before building — see DESIGN_SCHEMA.openDecisions)

These are the Phase-4 / feasibility items requiring a decision before implementation.

---

## 7. Implementation status — SHIPPED 2026-06-23 (gated, uncommitted on `main`)

All ten groups (G0–G9) + the optional native addons were implemented behind env flags.
**Behavior is preserved by default**; the USER flips the gated flags only after the accuracy/
soak gates below. Existing on-disk indexes are reused with **zero reindex** (only `HNSW_MMAP`
changes the format, and it is off + non-migrating by default).

### Verification snapshot
- Full suite: **3053 passed / 1 failed / 7 skipped**. The single failure is a **pre-existing,
  intermittent TOCTOU race** in `core/infrastructure/sparse-gram-delta-reader.js:61`
  (`ENOENT` when concurrent compaction unlinks a `.ssgrmdelta` segment between `readdir` and
  `read`) — not a maintainer-efficiency regression (passes 123/123 in isolation; shifts test
  case on re-run). `npm run build` + `npm run lint`: **PASS**.
- Determinism harness control (`eval/index-maintainer-determinism/run-harness.mjs`): **5/5
  stable, BYTE-DIFF CLEAN** (pins `HNSW_DETERMINISTIC_LEVELS=1` so byte-diffs isolate the lever).
- **E.1 byte-identity CLOSED:** `run-harness.mjs --candidate SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES=1`
  → BYTE-DIFF CLEAN. G1 (`levelForId`, FNV-1a) + FIX-B (entry-point = min-id at max-level tie)
  make batched == per-file == compaction byte-identical under the determinism flag.
- Index format preserved: `HNSW_MMAP` off ⇒ identical JSON sidecars, no `PIPELINE_VERSION` bump,
  load routes by detected on-disk magic ⇒ the ~200 task-completion-bench indexes need no reindex.

### Env-flag matrix
**Tier-1, output-identical, ON by default** (only *when* CPU/RAM is granted changes):
- A.1 `os.setPriority(PRIORITY_LOW)` — **ungated**, daemon `main()` only, try/catch.
- E.4 global `soft_heap_limit = 134217728` (128 MiB) — **ungated**, set once at daemon startup,
  try/catch. (Soft SQLite reclaim hint — distinct from the forbidden V8 `--max-old-space-size`.)
- `SWEET_SEARCH_MAINTAINER_BG_PRIORITY` — **default ON** (post-spawn `taskpolicy -b` / `ionice -c3`
  / `chrt -b`); set to `0`/`off` to disable.

**Gated, default-OFF — flip only after the named gate (`feedback_accuracy_nonnegotiable`):**

| Flag | Lever | Gate to enable |
|---|---|---|
| `SWEET_SEARCH_HNSW_DETERMINISTIC_LEVELS` | G1 per-id levels (E.1 prereq) | byte-diff (done) + MRR recall-neutral |
| `SWEET_SEARCH_RECONCILE_BATCH_TIER_WRITES` | E.1 per-tick batching (the big peak-RAM/IO win) | byte-diff (clean w/ det-levels) + crash test |
| `SWEET_SEARCH_RECONCILE_LIVE_HNSW` (+`_DELETE_FRAC=0.15`, `_SAVE_EVERY=2000`) | E.2 live HNSW | crash test + soak |
| `SWEET_SEARCH_RECONCILE_SQLITE_PRAGMAS` | E.4 cache_size + shrink_memory | byte-diff |
| `SWEET_SEARCH_RECONCILE_FTS5_BUDGET` / `_FTS5_OPTIMIZE` (+`_MIN_SEGMENTS=8`) | E.5 merge budget / idle optimize | byte-diff |
| `SWEET_SEARCH_RECONCILE_INCR_VACUUM` | E.4 incr-vacuum (reserved; needs `auto_vacuum=INCREMENTAL` at schema-create) | new-index only |
| `SWEET_SEARCH_RECONCILE_CHUNK_CUTOFF` | E.6 enrichment-aware cutoff | USER MRR/recall gate |
| `SWEET_SEARCH_RECONCILE_AUTOTUNE` | A.4 interval autotune | incremental soak |
| `SWEET_SEARCH_ORT_BACKGROUND` (+`SWEET_SEARCH_INTRA_OP_THREADS`) | B background ORT profile (maintainer-only; **never on the search/query path**) | **GCSN dev+held-out MRR + byte-identical-index** |
| `SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS=0` (+`_IDLE_CHECK_MS=60000`, `_BACKSTOP_WALK_MS=600000`) | D.1 idle-TTL | freshness probe + soak (e.g. `1200000`) |
| `SWEET_SEARCH_MAINTAINER_WATCH` | C `@parcel/watcher`@2.5.6 + backstop | large-monorepo freshness validation |
| `SWEET_SEARCH_RSS_BUDGET_FRACTION` | D.3 RSS-LRU + Linux PSI (e.g. `0.6`) | multi-repo soak |
| `SWEET_SEARCH_SHARED_MODEL_SERVER` (+`_MODEL_SERVER_BACKGROUND`, `MODEL_SOCKET_PATH`) | D.5 shared model server | embedding-parity (proven) + soak |
| `SWEET_SEARCH_HNSW_MMAP` | E.3 packed-binary + mmap (**format change → needs rebuild to benefit; do NOT enable on the reused bench indexes**) | format-migration plan |
| `SWEET_SEARCH_MAINTAINER_NATIVE_PRIORITY` | A.5/A.6 napi addon (QoS / `PROCESS_MODE_BACKGROUND_BEGIN`) | addon built + present |

### Known follow-ups (out of scope of this work)
1. ~~Pre-existing TOCTOU flake `sparse-gram-delta-reader.js:61`~~ — **FIXED** (commit `9dc8eb4`):
   `readFileSync` wrapped, skip on concurrent-unlink `ENOENT`, rethrow other errors.
2. Pre-existing `tests/embedding/embedding-correctness.test.js` batched-vs-sequential failure
   (proven pre-existing by git-stash; unrelated to G8).
3. Native-addon publish-readiness: add `files`/`os`/`cpu` to `native/*/package.json` so the
   prebuilt `.node` ships despite the root `.gitignore` (only if the addons are ever published).

---

## 8. Measured results — benchmarked 2026-06-23 (the claim, made true)

Machine: Apple M3 Max, 16 cores, 137 GB, Node v25.8.1, onnxruntime-node 1.24.3, real INT8
CodeRankEmbed CPU model. Ran **alone** (pkill of all daemons before each run; verified clean
before/after); each lever in isolated child processes with fresh temp stateDirs. **Shared dev
machine ⇒ numbers are indicative, not lab-isolated.** Reusable script:
`scripts/bench-maintainer-efficiency.mjs`. *(This section replaces the earlier unmeasured
"more efficient" assertion — what is measured is now stated; what is not is labelled.)*

### 8.1 — Measured efficiency, lever by lever

| Lever | Metric | OFF (today) | ON | Delta | Verdict |
|---|---|---|---|---|---|
| **E.1 batch tier writes** | tick **peak RSS** (12.7 MB idx, touch 40, ×3) | 600.8 MB | 356.3 MB | **−244 MB** | **STRONG — the headline win** |
| **E.1 batch tier writes** | tick wall-clock | 10 519 ms | 7 551 ms | **−28 %** | strong (batching share; see caveat) |
| **A OS background priority** | foreground `git status` median **under tick load** | 22–24 ms (+~40 % vs 16 ms baseline) | 16–18 ms (≈ baseline) | **erases the +7 ms regression** | **SUPPORTED — real & reproducible (×3)** |
| **B `force_spinning_stop`** | **steady** 50 s idle self-CPU | 0.091 % | 0.002 % | ~40× but **both negligible** | **PARTIAL — doc overclaimed (see 8.2)** |
| **B `force_spinning_stop`** | **post-burst spin tail** (settle CPU, equal threads) | 1.39 % (250 ms) | 0.03 % (5 ms) | ~50× less tail | the *real* (small) win |

**Caveats:** tick-RSS used the determinism-harness stub encoders at 768-dim (batching is
encoder-independent — the RSS shape is the per-file HNSW JSON parse/stringify reload, not embed
math); with the real encoder, total tick wall is larger and embedding-dominated, so the −28 % is
the *batching* share only. OFF peak RSS is noisy (501–642 MB, retained heap + GC timing); ON is
rock-steady ~356 MB. fg-latency would shrink on a more contended box and may differ on hardware
without E-cores.

### 8.2 — Honest correction to the research doc (B / idle CPU)

The research doc (citing ORT issue #26026) claimed `allow_spinning:'1'` **pegs ~a full core at
idle**. **On ORT 1.24.3 this does NOT reproduce** — the default threadpool self-parks within ~1 s,
so steady idle is ~0 % for *both* profiles. `force_spinning_stop`'s real, measured benefit is
cutting the **post-burst spin-down tail** (~50× less settle-window CPU). For a daemon that bursts
then idles between ticks that tail recurs each tick, so it still helps — but it is **tens-to-
hundreds of ms of tail per burst, not a pegged core.** Re-check on ORT upgrades.

### 8.3 — Freshness impact per flag (the trade, stated honestly)

"Stays exactly as fresh as before" is **only true with every flag off.** Several levers trade
freshness for efficiency:

| Flag / lever | Freshness vs today | Worst-case staleness |
|---|---|---|
| A.1 `setPriority`, A.2/3 `BG_PRIORITY` | **same** (only *when* CPU is granted changes) | none |
| E.1 batch, E.2 live-HNSW, E.4 pragmas, E.5 FTS5 | **same** (same per-tick cadence; write path only) | none |
| B `ORT_BACKGROUND` | **same** (embeddings byte-identical — see 8.4) | none |
| A.4 `AUTOTUNE` | **worse under CPU load by design** (loosens interval when `loadavg` high) | up to the loosened interval (tier max) while load is high |
| D.1 `IDLE_TTL_MS` | **worse during the idle window** — daemon is down; edits not indexed until a search/MCP/session trigger respawns it (cold start 2–8 s, then reconcile-before-serve) | one respawn cycle |
| C `MAINTAINER_WATCH` | **better common-case** (event-driven < per-tick walk); **worse worst-case** on dropped/missed events | up to `BACKSTOP_WALK_MS` (default 10 min) |
| D.3 `RSS_BUDGET_FRACTION` | same until budget crossed; then the **evicted** repo is down until respawn | one respawn cycle (longest-idle repo only) |

**Net:** with flags off, freshness is identical and nothing is faster. The efficiency wins above
(RAM, fg-latency, spin-tail) come **only** when you enable the flags, and the watcher/idle-TTL/
autotune levers are explicit freshness↔efficiency trades — not free.

### 8.4 — E2E smokes on the real model (2026-06-23)

| Feature | Result | Evidence |
|---|---|---|
| **B ORT parity (MRR-risk preview)** | **BYTE-IDENTICAL** | foreground vs background profile, 10 strings × 768 dims, `maxAbsDelta=0`, `firstMismatch=-1`. Enabling `ORT_BACKGROUND` shifts embeddings by **zero** → the MRR gate is essentially pre-cleared (still run it, but the outcome is determined). |
| **G8 shared model server** | **PASS** | unix-socket round-trip byte-identical to in-process for matched batch composition (the cross-client mismatch was traced to ORT INT8 batch-composition, *not* transport — transport is lossless); 2 concurrent clients; clean socket unlink on shutdown. |
| **C watcher** | **PASS** | real FSEvents → correctly-shaped queue line (`source:'watch'`); **stateDir self-trigger guard held** (writes into `.sweet-search` produced zero events); `.git/HEAD` → backstop. Live in the real daemon ("file watcher active"). |
| **D.1 idle-TTL respawn** | **PASS** | real daemon: model load → reconcile → idle-TTL fires → `unloadLocalModel` → `releaseStateLock` unlinks the `O_EXCL` lock → exit 0; relaunch acquires the lock cleanly and reconciles-before-serve. |

Not exercised here (honest): native `IN_Q_OVERFLOW` (source-confirmed; the `.git/HEAD` overflow
path *was* live), `SWEET_SEARCH_STATE_DIR` (ignored by indexer+maintainer — they default to
`<root>/.sweet-search`), and the Metal/GPU path (intentionally CPU-only per safety).

### 8.5 — Default-path crash-consistency: a real bug, found and FIXED

The byte-diff harness surfaced a **genuine correctness bug in the shipped default path** (not just
the gated one): a SIGKILL after a file's SQLite vector COMMIT but before its HNSW/LI save left the
row durable in `codebase.db` (queryable via FTS) yet **permanently missing from the HNSW + LI
vector index** — on restart `diffChunks` saw the committed row as unchanged and never re-added it.
Classification: **correctness — queryable-doc-missing.** **Fixed** on the default per-file path
(minimal persist-before-advance repair keyed on `epoch_written > published merkle.epoch`,
idempotent HNSW add + LI retire-then-add; never fires on the happy path). Verified:
`run-harness.mjs --kill-after-tick 2` → **CRASH-CONSISTENCY PASS** (was FAIL), happy-path byte-diff
unchanged, full `tests/indexing/` + vector-store green. Residual on modify/delete-tick crashes is
the cosmetic stale-node (self-healed by `binaryHnswHandler` maintenance + eliminated by E.1).

### 8.6 — Flag coupling (footgun removed)

`RECONCILE_BATCH_TIER_WRITES` now **forces** `HNSW_DETERMINISTIC_LEVELS` on (one-time warning) so
batching is always byte-identical; explicitly setting `HNSW_DETERMINISTIC_LEVELS=0` while batch is
on **throws** a clear config error. Normalized once in `createProductionReconciler`
(`normalizeHnswDeterminismFlags`), so the daemon is covered without per-call wiring.
