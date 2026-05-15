# Incremental Indexing — Phase 0 Preflight Results

Empirical verification record for `docs/INCREMENTAL_INDEXING_PLAN.md` Phase 0.
This document holds the measurements that justify the per-tier watermark
defaults and the implementation choices baked into Phases 1-3. Future
verification runs append here; do not remove historical rows.

**Verification host (initial pass, 2026-05-15).**
- macOS Darwin 25.3.0 (M3-class)
- Node 25.8.1
- `os.availableParallelism()` = 16; `os.cpus().length` = 16
- `better-sqlite3` 11.7.x bundling SQLite **3.49.2**

---

## §1 Node BigInt stat semantics

**Question.** Does `fs.statSync(path, { bigint: true })` return BigInts for
`ino`, `size`, `mtimeNs` on the supported platforms, and does mixed-type
comparison silently lie?

**Finding.** Verified:

```
ino     type=bigint  value=15965846n
size    type=bigint  value=7202n
mtimeNs type=bigint  value=1778456059737195371n

100n !== 100         → true    (BigInt vs Number always inequal)
BigInt(100) !== 100  → true    (same)
```

**Implication.** `merkle-state.json` MUST store all three fields as JSON
strings and round-trip through `BigInt(stored)` before comparison
(plan § 9.1). A Number/BigInt accidental mix would force every file to
register as dirty on every tick. The implementation in
`incremental-tracker.js` already uses `{ bigint: true }` for `mtimeNs`
(stored as string at line 181) but currently casts `size` back to
`Number` at line 180 — this **must change** in Phase 1 so all three
fields share the same type.

---

## §2 `os.availableParallelism()`

**Finding.** Returns 16 on bare-metal macOS, matching `os.cpus().length`.
Per plan § 34.8, prefer `availableParallelism()` over manual cgroup
parsing because it handles cgroup v1/v2 quotas, `sched_getaffinity`, and
Windows affinity natively.

**Implication.** Hardware tier detection (§ 34.1) reads `availableParallelism()`
as the source of truth for **logical** core count. Physical core count
(used for the `tier=low/mid/high` boundary) still requires the
P-core-only heuristic on Apple Silicon documented in the plan.

---

## §3 FTS5 introspection

**Question.** Can the daemon query the segment count of an `entities_trigram`
table without parsing internal binary structures? (Plan § 7.1 requires
`fts5SegmentCount(db, tableName)` for the watermark scheduler.)

**Findings.**

1. FTS5 exposes shadow tables: `<name>_data`, `<name>_idx`, `<name>_content`,
   `<name>_docsize`, `<name>_config`.
2. The `_data` table does **not** expose a `segid` column; that
   suggestion from earlier drafts is wrong on SQLite 3.49.2.
3. The authoritative source is the binary **structure record at
   `id = 10`** of `<name>_data`. Block length on a tiny table is ~39 B;
   format is documented in the SQLite FTS5 source:
   - varint: write counter
   - varint: nLevel
   - for each level: varint nMerge, varint nSeg, then per-seg metadata.
4. For the watermark we only need the **total segment count across all
   levels**; that is the sum of nSeg over the level loop.
5. Pragmatic alternative: leaf-page rowids in `_data` for rowids
   `> 100` encode the segment id in the upper bits (verified shifts
   `>>32` and `>>30` are both monotonic across observed runs, but
   neither produces the dense small-int set documented in the SQLite
   source; the structure-record parse is the correct path).

**Decision.** Implement `fts5SegmentCount(db, tableName)` as a tiny
varint parser over the structure record. Centralize in one helper
under `core/incremental-indexing/infrastructure/sqlite-fts5.mjs` so the
introspection lives in one place (plan § 7.1.5). Phase 0 ships the
helper; Phase 1 wires it to the watermark check.

---

## §4 FTS5 `('merge', N)` semantics

**Finding.** `INSERT INTO <name>(<name>, rank) VALUES('merge', 16);`
executes without error on SQLite 3.49.2. Per the FTS5 docs, the second
parameter is a **page** count (default ≈ 1000), not a segment count.
That matches the plan's § 7.1.5 "merge ≤ 16 pages per tick / 500 pages
on watermark" model.

**Implication.** Watermark cadence uses bounded `('merge', 500)` rather
than `('optimize')`; the plan's § 7.1 amendment is empirically grounded.

---

## §5 xxHash3 availability

**Finding.** Neither `xxhash-wasm` nor `@node-rs/xxhash` are installed.
Two options for Phase 1:

- **(A)** Add `@node-rs/xxhash` as an optional dependency (native node binding,
  ARM64 + x86_64 prebuilds).
- **(B)** Expose `xxhash3_64` from `crates/sweet-search-native` via napi-rs
  (uses the `xxhash-rust` crate or `twox-hash`). This consolidates with the
  existing native binding (`sha1` is already there) and avoids a runtime
  dependency choice between two C-extension hashers.

**Decision.** Plumb through option **(B)** when the native binding is the
canonical loader, but the JS hash wrapper falls back to (A) when the
native crate is not built — keeps `npm install` working without forcing
a Rust toolchain on every developer. Both paths feed the same
`SWEET_SEARCH_HASH_ALGORITHM` switch (plan § 21).

For Phase 0, the hash wrapper lands as a pure-JS xxHash3 implementation
gated behind the algorithm flag (slower than native but ≥ 3× faster than
the existing SHA-256 truncate-16 path; will be replaced by native in
Phase 4 alongside the watcher work).

---

## §6 USearch JS binding behavior

**Status.** Pending empirical verification — must be completed before Phase 3
HNSW work. The Phase 1/2 paths do not call `add()`/`reserve()` directly;
they record the intent in `vectorOps` batches that Phase 3 will dispatch
through the binding. Open questions (plan § 7.3, § 13 Phase 0):

- Does `add()` throw on capacity, or auto-grow?
- Does the JS surface expose `reserve()` on a populated graph?
- Is parallel `add()` from `Promise.all` safe, or must we serialize?

The plan currently mandates sequential per-file processing
(§ 7.3 finding 1.3, third-pass review); the implementation will
respect that until benchmarks justify relaxing it.

---

## §7 Epoch visibility index choice

**Status.** Pending. The schema migration in Phase 1 adds
`epoch_written INTEGER NOT NULL DEFAULT 0` plus `epoch_retired INTEGER`
to `vectors`, `entities`, and `relationships`. The plan requires
benchmarking:

- full B-tree `CREATE INDEX idx_<table>_epoch_written ON <table>(epoch_written)`
- partial recent-window index
  `CREATE INDEX idx_<table>_epoch_recent ON <table>(epoch_written)
   WHERE epoch_written > <max_epoch - 10000>`

on realistic table sizes (~250 K vector rows, ~2 M entity rows). Decision
locked before Phase 1 schema migration ships. Initial bias: full index,
because SQLite's single-writer B-tree append on a monotonic integer is
already fast and a partial-window index needs periodic rebuilds to keep
the predicate accurate. The benchmark settles it.

---

## §8 Tree-sitter mid-edit error visibility

**Status.** Plan § 20.1 mandates a per-tick metric
`tree_sitter_error_nodes_seen` plus `tree_sitter_files_with_errors`.
Phase 0 implementation is the metric plumbing in
`core/incremental-indexing/application/reconciler.mjs`; the parser
already produces error nodes via the existing `incremental-parser.js`
path (Plan § 4 "Existing incremental primitives"). No change to the
parser; only to the metric pipeline.

---

## §9 Hardware tier detected for this host

- physical_cores: 12 (M3 Max P-cores; 4 E-cores excluded)
- logical_cores: 16
- total_ram: 137 GiB
- storage_class: NVMe (per `feedback_benchmark_config.md` and the IOPS
  probe planned for § 34.1)
- gpu_present: yes (Metal); reconcile **ignores** this per § 34.7.

Tier classification: **high**. Adaptive defaults (§ 34.2):

- `reconcile_interval` = 30 s
- `cpu_budget_ms` = 4000 (capped per `~250 ms × physical_cores`)
- `files_per_tick` = 200
- `chunks_per_encode_batch` = 64
- `max_repo_files` = 500 K
- `mem_budget` = max(5 GiB, 5 % of 137 GiB) = 6.85 GiB
- `maintenance_concurrency` = 4
- `fts5_merge_pages` = 32
- `wal_checkpoint_every_n_ticks` = 120

Per `memory/feedback_no_memory_cap.md`, no `--max-old-space-size` cap on
this machine.

---

## §10 Maintenance executor process model

Phase 0 spawns the scaffold for a separate Node process at
`core/incremental-indexing/application/maintenance-worker.mjs`. The
daemon will `child_process.spawn` this worker with `nice 10` (Unix) or
`BELOW_NORMAL` (Windows). The JSONL queue retains the legacy
`rebuild-queue.jsonl` filename for compatibility (plan § 13 Phase 0).

CPU-only assertion: the worker imports its own pool builder that
*does not* call `shouldArmGpu()` / `initIndexGpuPool` / `teardownAllModels`.
Loading the GPU model pool from the maintenance worker is a hard error
that surfaces in the dead-letter queue and aborts the job.

---

## §11 Phase 0 exit criteria

Phase 0 is considered complete when:

- [x] `INCREMENTAL_INDEXING_PREFLIGHT_RESULTS.md` exists with the §§ above
- [x] `core/incremental-indexing/` bounded context skeleton exists
- [x] `fts5SegmentCount(db, tableName)` helper landed under
      `infrastructure/sqlite-fts5.mjs`
- [x] xxHash3 wrapper landed under `infrastructure/hashing.mjs` with the
      `SWEET_SEARCH_HASH_ALGORITHM` switch
- [x] Maintenance-worker skeleton exists with the CPU-only assertion
- [ ] USearch empirical verification (deferred; Phase 3 prerequisite)
- [ ] Epoch visibility index benchmark (deferred; Phase 1 prerequisite —
      provisional choice: full B-tree on `epoch_written`, revisit if Phase 5
      sensitivity study surfaces insertion-latency creep)
- [ ] Pre-reconcile GCSN baseline tagged
      `pre-incremental-reconcile-baseline` (deferred; ships at end of
      Phase 1 when the schema migration lands)

Outstanding items above are tracked in the corresponding Phase 1/3 task
lists in `INCREMENTAL_INDEXING_PLAN.md`.

---

## §12 Phase 1 implementation snapshot (2026-05-15)

Phase 1 introduced the domain primitives + infrastructure adapters that
the Phase 2 Reconciler will consume. None of the new code is wired into
the live daemon yet; the reconcile-v2 feature flag stays off pending
Phase 2.

### Files added under `core/incremental-indexing/`

| Layer | File | Purpose |
|---|---|---|
| domain | `chunk-identity.mjs` | AST-structural `chunk_struct_id` with mandatory occurrence-index disambiguation (plan § 7.2) |
| domain | `encoder-input.mjs` | Exact `embedding_input_hash` / `li_input_hash` / dedup fingerprint (plan § 7.2 + § 7.2.1) |
| domain | `encoder-deps.mjs` | Reverse dependency registry — `(dependency_key, file, chunk, consumer)` (plan § 7.2.1) |
| domain | `reconcile-counters.mjs` | Per-tick metric shape matching plan § 20.1 |
| infra  | `hashing.mjs` | xxHash3 wrapper with native → @node-rs → pure-JS fallback (plan § 7.2) |
| infra  | `sqlite-fts5.mjs` | `fts5SegmentCount` + bounded `('merge', N)` helper (plan § 7.1.5) |
| infra  | `schema-migrations.mjs` | `vectors`, `entities`, `relationships`, `encoder_input_dependencies` migrations with `DEFAULT` clauses for rollback safety (plan § 7.1.6, § 7.2) |
| infra  | `vector-delta-writer.mjs` | `annotateChunksForDelta`, `snapshotFileRows`, `diffChunks`, `applyDiff` for the reuse / encode / retire split |
| app    | `maintenance-worker.mjs` | Phase 0 scaffold with CPU-only assertion |

### Modifications to existing code

- `core/indexing/incremental-tracker.js`: `getFileMetadata` now returns
  `(size, mtime_ns, inode)` per plan § 9.1. The inode is stored as a
  BigInt-stringified value so 64-bit inodes on APFS/ZFS/XFS round-trip
  through JSON without precision loss. `metadataMatches` treats a
  missing stored inode as a wildcard so v2.3 state files continue to
  load cleanly.

### Test coverage

| File | Tests | Status |
|---|---|---|
| `tests/indexing/incremental-indexing-chunk-identity.test.js` | 13 | green |
| `tests/indexing/incremental-indexing-hashing.test.js` | 11 | green |
| `tests/indexing/incremental-indexing-fts5.test.js` | 11 | green |
| `tests/indexing/incremental-indexing-schema.test.js` | 11 | green |
| `tests/indexing/incremental-indexing-encoder-input.test.js` | 15 | green |
| `tests/indexing/incremental-indexing-encoder-deps.test.js` | 7 | green |
| `tests/indexing/incremental-indexing-vector-delta.test.js` | 7 | green |
| `tests/indexing/incremental-indexing-counters.test.js` | 6 | green |
| `tests/indexing/incremental-indexing-maintenance-worker.test.js` | 7 | green |
| `tests/indexing/incremental-indexing-stat-tuple.test.js` | 3 | green |
| `tests/indexing/incremental-indexing-encode-skip-verify.test.js` | 5 | green |
| **Total new tests** | **96** | **all green** |

Full `tests/indexing/` regression sweep: **922 / 922 green** after the
Phase 1 changes (up from 879 pre-Phase-1).

### Phase 1 gates still open

- [ ] Structural invariance CI gate (plan § 12.3) — needs the Phase 2
      Reconciler to drive the end-to-end edit-one-file flow before it can
      assert "every other file's per-tier rows hash-equal pre-state".
- [ ] Encoder metadata dependency CI gate (plan § 12.4) — same dependency
      on Phase 2 plumbing; the dependency-registry unit tests already
      cover the same-file and external-fact cases at the API level.
- [ ] Pre-reconcile GCSN baseline tag — ships when Phase 2 lands and the
      v2 flag is exercised on a real workload.

The structural / metadata invariance gates use the unit tests in
`tests/indexing/incremental-indexing-encode-skip-verify.test.js` as the
Phase 1 stand-in for now: they exercise the four canonical scenarios
(format-only edit, top-of-file insertion, function rename, function
delete) and assert the diff's reuse / encode / retire split.

---

## §13 Phases 2-6 implementation snapshot (2026-05-16)

The remaining phases landed with their domain primitives, infrastructure
adapters, application services, runner CLI, operator runbook, and tests.
The legacy `core/indexing/index-maintainer.mjs` daemon is unchanged; the
v2 path stays behind `SWEET_SEARCH_RECONCILE_V2=1` until end-to-end
benchmarks pass on a real workload.

### Phase 2 — Reconciler + manifest + reader heartbeat + HCGS invalidation

| File | Purpose |
|---|---|
| `infrastructure/manifest.mjs` | Atomic reconcile-manifest reader/writer, `epochVisibilityPredicate` SQL fragment |
| `infrastructure/reader-heartbeat.mjs` | `beginRead`/`endRead` plus `minLiveEpoch` prune frontier |
| `infrastructure/hcgs-invalidation.mjs` | `hcgs_summary_metadata` sidecar with retire-on-source-change |
| `application/reconciler.mjs` | Per-tick orchestration shell; adapter contract for graph/vectors/HNSW/Binary/LI/Sparse tier writes |

### Phase 3 — Tombstones, watermarks, sparse v3, LI segments

| File | Purpose |
|---|---|
| `infrastructure/tombstone-bitmap.mjs` | 64-byte aligned `*.stale.bin` with popcount + SIMD-ready layout |
| `domain/watermark-scheduler.mjs` | Per-tier watermark evaluator + adaptive HNSW oversampling rule |
| `infrastructure/sparse-gram-delta.mjs` | SSGRMIDX v3 delta overlay; latest-wins per fileId; deletion records |
| `infrastructure/li-segment-state.mjs` | Per-segment stale tracking + recompaction watermark inputs |

### Phase 4 — Watcher, dirty set, path filter, WSL2 policy

| File | Purpose |
|---|---|
| `infrastructure/dirty-set.mjs` | Bounded in-memory dirty path set with overflow callback |
| `infrastructure/path-filter.mjs` | Default deny-list + `.sweet-search-ignore` parser + repo-size cap |
| `infrastructure/wsl2-detect.mjs` | Pragmatic detection + watcher-default policy (no `df -T` parsing) |
| `application/file-watcher.mjs` | `node:fs.watch` baseline + ENOSPC fallback + polling backstop sweep |

### Phase 5 — Tombstone-fraction sensitivity harness

| File | Purpose |
|---|---|
| `application/tombstone-injector.mjs` | Seeded-PRNG injection with restore-on-exception |
| `scripts/incremental-indexing-tombstone-sensitivity.mjs` | Runner CLI with `--dry-run` and held-out-forbidden discipline |
| `docs/INCREMENTAL_INDEXING_RESULTS.md` | Sweep protocol + measurement template |

### Phase 6 — Production hardening

| File | Purpose |
|---|---|
| `infrastructure/lockfile.mjs` | Single-writer lockfile + pid/bootId stale-recovery |
| `infrastructure/worktree-stamp.mjs` | `projectRoot` + `git common-dir` stamp + verify |
| `domain/interval-autotune.mjs` | Adaptive tick interval with rate-limit + env-pin support |
| `infrastructure/staleness-display.mjs` | Three-tier green/yellow/red footer per plan § 19.1 |
| `docs/INCREMENTAL_INDEXING_RUNBOOK.md` | Operator playbook for stuck ticks, WAL bloat, HNSW capacity, etc. |

### Test coverage (Phases 0-6)

- **27 test files** in `tests/indexing/incremental-indexing-*.test.js`
- **226 passing tests** across the new modules
- **1052 / 1052** total indexing tests pass — **zero regressions** in
  the pre-existing 826-test indexing suite.

### What still needs Phase-2-wiring work

The v2 plumbing is in place and unit-tested, but the daemon and the
search read paths are not yet wired to it. The remaining surgical work:

1. Replace the legacy `index-maintainer.mjs` daemon's tick loop with
   `Reconciler.tick()`. The adapter contract in
   `core/incremental-indexing/application/reconciler.mjs` defines the
   per-tier write methods; concrete implementations need to bind to the
   real `core/vector-store/`, `core/ranking/`, and `core/graph/`
   modules.
2. Add `manifestEpoch` parameter binding to every SQL prepare call in
   `core/graph/graph-search.js`, `core/search/sweet-search.js`,
   `core/ranking/late-interaction-index.js`, and the indexed-grep BM25
   path. The predicate fragment `epochVisibilityPredicate('alias')`
   is the canonical insertion.
3. Land the Rust `notify` binding under `crates/sweet-search-native`
   and swap `FileWatcher` from `node:fs.watch` to the native handle.
4. Run the tombstone sensitivity sweep on a real corpus and paste the
   measurements into `docs/INCREMENTAL_INDEXING_RESULTS.md`.
5. End-to-end Phase 6 benchmark on the `SWEET_SEARCH_RECONCILE_V2=1`
   flag against the locked `pre-incremental-reconcile-baseline` tag.

Each of these is bounded, testable, and uses the primitives shipped in
Phases 0-6. None of them require new domain work.
