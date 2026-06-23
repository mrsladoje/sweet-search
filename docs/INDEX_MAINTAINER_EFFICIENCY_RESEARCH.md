# Index-Maintainer CPU & Memory Efficiency — SOTA Research Report

**Date:** 2026-06-22
**Scope:** Make the `index-maintainer` daemon memory- and CPU-efficient so it never causes
contention on users' machines (esp. 16 GB laptops). **Functionality stays identical** — same
artifacts, same freshness guarantees, same search surface. This document is **research +
recommendations only; no code was changed.**

> Discipline note: every recommendation below is a *candidate* to be benchmarked before shipping.
> Per project policy, nothing here should regress MRR/Recall or index correctness for speed —
> the encode-path changes (ORT threads/arena) in particular must pass the GCSN/held-out gate and
> a byte-identical-index check before adoption.

---

## 1. Executive summary

The maintainer is functionally correct but pays for it at **normal OS priority** with a
**resident embedding model**, a **full working-tree stat-walk every tick**, and a
**per-file load/save of every index tier**. The five biggest levers, in priority order:

| # | Lever | Class | Where | Expected win |
|---|-------|-------|-------|-------------|
| 1 | **Batch per-tier writes per *tick*, not per *file*** (HNSW `load→save` runs up to 50×/tick today) | Drop-in | `production-reconciler.mjs`, `reconciler.mjs` | Removes the dominant tick-time peak-RAM + disk-IO spike |
| 2 | **Run the daemon at background OS priority/QoS** (nice/`PRIO_DARWIN_BG`/`PROCESS_MODE_BACKGROUND_BEGIN`) | Drop-in | `maintainer-launcher.mjs` spawn + daemon startup | Foreground work stops feeling the daemon |
| 3 | **Tame ORT: `force_spinning_stop`, fewer intra-op threads, arena off** | Drop-in (gated) | `embedding-local-model.js` (background profile) | Kills ~2 idle cores of spinning; bounds resident MB |
| 4 | **Idle-TTL self-shutdown + on-demand respawn** | Small arch | `index-maintainer.mjs` main loop + launcher | N→1 resident daemons; fixes the ~16 GB cross-repo footprint |
| 5 | **Event-driven file watching + rare reconcile backstop** | Small arch | `dirty-scan.mjs` | Idle cost O(N syscalls/tick) → ~0 |

Levers 1–3 are **drop-in efficiency wins** (no format/behavior change). Levers 4–5 add a small
amount of lifecycle/architecture but keep the index contract identical. Each is detailed in §4
with concrete code anchors, and §5 is the consolidated roadmap.

### 1.1 — Does this keep the maintainer *exactly* as effective?

This report treats functional equivalence as a **hard design constraint and a verification gate —
not a proof.** "Same artifacts, same freshness" is the goal for every item, but honesty requires
separating three axes of "effective" and three risk tiers. Nothing below should be *assumed*
equivalent; the verification plan at the end is what turns "should be" into "is."

**Three axes of "effective":**
- **Search quality** — what gets indexed; recall/MRR/correctness of results.
- **Freshness** — how fast an edit reaches the index.
- **Durability** — crash/abort consistency of the on-disk artifacts.

**Tier 1 — output-identical, low risk (confirm with a byte-diff; expect a pass):**
- **E.4** SQLite memory pragmas, **E.5** FTS5 `merge=N` budgeting — cache/compaction only; query
  results are independent of segment count and page-cache size.
- **B (partial)** `force_spinning_stop:'1'` and `enableCpuMemArena:false` — threadpool idle
  behavior and allocator strategy; they do **not** touch inference math.
- **A.1–A.3** background OS priority — identical output; only *when* CPU is granted changes.

**Tier 2 — output-identical only if implemented carefully (needs a targeted test, not just a diff):**
- **E.1 batch load/save per tick** — a *successfully completed* tick should be byte-identical, BUT
  two things must be **verified, not assumed**: (a) moving the HNSW save from per-file to end-of-tick
  changes durability — a tick killed/budget-cut mid-way has SQLite deltas applied but the HNSW
  unsaved, so merkle-state/manifest must not advance past what is actually persisted (else
  "marked-indexed-but-missing-from-HNSW"); (b) whether `BinaryHNSWIndex` assigns graph levels
  **deterministically per id** vs. from a **running RNG that resets on each `load()`** — if the
  latter, per-file (reload-per-file) vs. batched (continuous) insertion can produce a *different*
  graph. *(This corrects the flat "byte-identical" claim elsewhere in this doc — it is a hypothesis
  to test, see verification plan below. Check `core/vector-store/binary-hnsw-index.js` level
  assignment.)*
- **E.2 live HNSW across ticks** — same graph, but deferred saves widen the crash-loss window;
  same persist-before-advance discipline required.
- **D.1/D.2 idle-TTL + respawn** — index is identical *after* the startup catch-up reconcile; the
  risk is a search arriving *during* catch-up seeing a staler index than an always-on daemon would.
  Must "reconcile-before-serve" on respawn.

**Tier 3 — can genuinely change effectiveness; must be benchmarked/designed, not assumed:**
- **B thread count (`intraOpNumThreads:2–4`)** — parallel FP reduction order can differ with thread
  count → tiny embedding deltas → INT8 quantization-boundary flips → a few different HNSW neighbors
  → potentially different results at the margin. Plausibly equivalent (many ORT ops are
  thread-count-deterministic) but **not guaranteed** — this is the item gated on the MRR/held-out +
  byte-identical-index check.
- **C event-driven watching** — changes the **freshness guarantee**: for changes the watcher
  catches (common case) it is *faster* than today; for changes it misses (dropped events,
  daemon-down gaps, edge-case renames/symlinks) worst-case staleness grows from ~1 tick (20–60 s) to
  the backstop interval (5–15 min). Steady-state completeness is preserved by the backstop walk, but
  the timing contract is not identical — full-walk-every-tick is strictly more aggressive about
  completeness.
- **E.6 chunk-hash early-cutoff** — **correctness risk**: `enrichChunksFromGraph`
  (`production-reconciler.mjs:102`) folds scope + imports from *other* files into a chunk's embedding
  text, so a file whose own text is unchanged can still need re-embedding when a dependency changed.
  A cutoff keyed only on the file's own chunk text would skip those and silently degrade recall.
  Safe only if the cutoff key includes the enrichment inputs.

**Verification plan — what "ensure" actually requires before shipping any item:**
1. **Determinism harness:** run a fixed edit sequence on a fixed-SHA repo through (a) current
   maintainer and (b) candidate, then **byte-diff all five artifacts** (`codebase.db` dump,
   `code-graph.db` dump, `codebase-binary-hnsw.idx` + float sidecar, LI segments, sparse-gram) +
   `merkle-state.json` (modulo timestamps/epoch). Tier-1 and Tier-2 items must produce an identical
   diff.
2. **Accuracy gate:** GCSN dev + held-out MRR/Recall unchanged within noise — mandatory for **B**,
   recommended for **C** and **E.6** (`feedback_accuracy_nonnegotiable`).
3. **Freshness probe:** measure edit→queryable latency (median + worst-case) for **A/C/D**; confirm
   steady-state convergence and quantify the worst-case staleness window being accepted.
4. **Crash-consistency test:** SIGKILL mid-tick, restart, assert the index reconciles to the same
   state as a clean run — mandatory for **E.1/E.2**.

**Net:** Tier-1 items are safe to treat as equivalent once the byte-diff passes; Tier-2 items are
output-equivalent but require the crash/serve discipline above; Tier-3 items are **not**
assume-equivalent — which is why the roadmap puts **B** in a benchmark-gated phase and **C/E.6** in
the architectural phase.

---

## 2. How the maintainer works today (verified code map)

**Process model** — `core/indexing/index-maintainer.mjs` (2366 lines) is a long-lived Node
daemon, **one per repo**, spawned **detached with no priority adjustment** by
`core/indexing/maintainer-launcher.mjs` (`spawn(execPath, [entry], {detached:true, stdio:'ignore'})`,
line ~121). Single-instance via an `O_EXCL` lockfile with a progress-aware takeover protocol
(`acquireStateLock`, heartbeat + `progressTimestamp`). It **runs forever** — exits only on
SIGTERM/SIGINT or lock loss. **No idle-TTL, no cross-repo cap, no LRU.**

**Default loop (`reconcile v2`, on by default)** — `runReconcileV2Main` acquires the lock, then
loops: `runReconcileV2Tick` → `drainMaintenanceInline` → `sleepWithProgress(intervalMs)`.
Interval is a **fixed hardware-tier value** chosen at startup by `resolveReconcileV2Interval`
(`interval-autotune.mjs` `TIER_TABLE`: **high 20 s / mid 30 s / low 60 s**).

Each tick does two things:

1. **Producer — `incremental-indexing/application/dirty-scan.mjs`**: **walks the entire working
   tree every tick**, `stat()`-comparing `size + mtime_ns` against `merkle-state.json` (no hashing),
   pruning excluded dirs, with one batched `git check-ignore`. Enqueues add/modify/delete hints to
   a JSONL queue (enqueue bounded at 5000; the *walk* is always full-tree). This is O(N) syscalls
   every 20–60 s forever, even when nothing changed.

2. **Consumer — `incremental-indexing/application/production-reconciler.mjs`** via
   `application/reconciler.mjs`: drains the queue and, per file, content-hashes, AST-chunks, embeds
   **changed** chunks with the **in-process ORT INT8 CodeRankEmbed model**
   (`embedding-service.js::getEmbeddings`, `useCache:false`), then writes five tiers: SQLite
   vectors (`codebase.db`), Binary HNSW (`codebase-binary-hnsw.idx`), Late-Interaction segments
   (`codebase-late-interaction.db`), sparse-gram deltas, and the code-graph DB. Per-tick budget:
   **50 files OR 2000 ms wall-clock** (`Reconciler.tick`, checked after each file).

3. **Inline maintenance drain** (`drainMaintenanceInline`, 1500 ms budget): FTS5 merges +
   HNSW/LI/sparse compaction — runs **in the daemon process**. (The documented `nice -n 10`
   separate-process maintenance worker in `maintenance-worker.mjs` is *not* used by the default
   inline path.)

**Embedding runtime** — `core/embedding/embedding-local-model.js::buildLocalSessionOptions`:
`graphOptimizationLevel:'all'`, `intraOpNumThreads ≈ performance-core count` (`bestIntraOpThreads`
in `onnx-session-utils.js`, ~10 on an M3 Max), `interOpNumThreads:1`, `enableCpuMemArena:true`,
`enableMemPattern:true`, and **`extra.session.intra_op.allow_spinning:'1'`** (worker threads
hot-loop instead of sleeping). The model is **loaded lazily on first encode then kept resident for
the daemon's whole life** — never unloaded, because `unloadLocalModel()` notes the **native memory
leak in ORT `session.release()` (microsoft/onnxruntime#25325)** and deliberately avoids
load/unload cycles. The reconcile path **never caps threads** (no `configureLocalModelRuntime`
call) — a background tick runs at full P-core width.

### The single biggest concrete inefficiency (verified)

`Reconciler._reconcileOneFile` (reconciler.mjs:360) calls each tier adapter **once per file**:
`applyGraphDelta`, `applyVectorDelta`, `applyBinaryHNSWDelta`, `applyLIDelta`,
`applySparseGramDelta`. In `production-reconciler.mjs` each of those **opens its store from scratch
per call**:

- `applyBinaryHNSWDelta` (line 455): `new BinaryHNSWIndex(...)` → `index.load(indexPath)` → append
  a few vectors → `index.save(indexPath)` → `maintainFloatStore(...)` — **the whole HNSW index is
  deserialized into RAM and rewritten to disk *for every changed file*.**
- `applyVectorDelta` (374), `applyGraphDelta` (297): `new Database(dbPath)` per file.

So a tick that touches 50 files performs **up to 50 full HNSW load+save cycles** and **50× open/close
of each SQLite tier**. This is the dominant tick-time **peak-memory spike** and a large chunk of the
tick's CPU + disk I/O. Hoisting the load/open to **once per tick** and the save to **once per tick**
(batching all files' ops between) is an efficiency change that should produce a **byte-identical
index on a successfully completed tick** — it is the highest-ROI item in this report (see §4.E.1),
**conditional on the HNSW level-assignment + crash-consistency caveats in §1.1, which must be
verified with a byte-diff rather than assumed.**

*(Context: `project_streaming_vectors_oom_fix` already bounded peak memory of the full-index build
to O(batch); this per-file load/save is a separate axis specific to the incremental tick path.)*

---

## 3. Inefficiency inventory (the contention levers)

| Lever | Current state | Why it bites | Cluster |
|---|---|---|---|
| **Scheduling priority** | Normal priority; no nice/QoS/background mode (launcher spawn) | Daemon competes head-to-head with foreground work | A |
| **ORT thread spinning** | `allow_spinning:'1'` on a resident session | ~2 cores of idle CPU burn between bursts | B |
| **ORT thread count** | `intraOp ≈ P-core count (~10)` in the background path | A background tick spikes ~10 threads at full priority | B |
| **ORT arena / residency** | `enableCpuMemArena:true`, model resident forever (leak #25325) | Monotonic arena growth + steady-state RSS; ×N repos ⇒ ~16 GB | B, D |
| **Per-file tier load/save** | HNSW `load→save` & SQLite `open→close` per file | Up to 50× whole-index reload per tick — peak RAM + IO | E |
| **Per-tick full tree walk** | `stat()` every file every 20–60 s | Wasted CPU/IO on large repos when idle | C |
| **Dormant autotune** | `nextInterval` CPU-pressure backoff exists but `autotuneInterval` defaults `false` | Daemon never backs off under load | A |
| **No idle-TTL / no cap** | Daemon runs forever; one per repo; no LRU | Cross-repo resident footprint unbounded | D |
| **SQLite memory** | WAL + `synchronous=NORMAL` only; no `cache_size`/`soft_heap_limit`/`mmap`/`shrink_memory` | Page cache grows per connection, unbounded across tiers | E |

---

## 4. SOTA findings & recommendations

Each subsection maps a research cluster onto our code. Full source lists in §7.

### 4.A — OS-level scheduling priority & adaptive throttling

The cleanest "don't cause contention" fix is to tell the OS this is background work. Real
background indexers (Spotlight/`mds`, Windows Search `searchindexer.exe`, Time Machine, restic,
borg) all do this.

- **macOS:** `setpriority(PRIO_DARWIN_PROCESS, 0, PRIO_DARWIN_BG)` (a.k.a. `taskpolicy -b`) drops
  the process into the background band — it throttles **CPU + disk I/O (IOPOL_THROTTLE) + widens
  timer coalescing**, and on Apple Silicon routes work to **E-cores**. `pthread_set_qos_class_self_np(QOS_CLASS_BACKGROUND, 0)`
  is the modern per-thread form (needed because ORT spins up its own threads, which don't inherit
  process QoS automatically). ⚠️ Never mix raw `setpriority` with QoS on the same thread — it
  permanently opts the thread out of QoS.
- **Linux:** `nice 19` + **`SCHED_BATCH`** (disfavors wakeups without starving — better than
  `SCHED_IDLE` for a daemon that must make progress) + **`ionice -c 3`** (idle I/O class). All work
  on your own process **without root**. For pressure-aware backoff, poll **PSI**
  `/proc/pressure/cpu` (`some avg10`) and AIMD-throttle the next batch — this is the most effective
  16 GB-laptop signal and is **pure JS, no root**.
- **Windows:** `SetPriorityClass(PROCESS_MODE_BACKGROUND_BEGIN)` demotes **CPU + I/O + memory
  priority** together (strictly better than `BELOW_NORMAL` alone) — exactly what Windows Search
  does. Needs a tiny N-API shim; `os.setPriority(PRIORITY_LOW)` only covers CPU.

**From Node:** `os.setPriority(os.constants.priority.PRIORITY_LOW)` is a one-line, cross-platform
**baseline** (nice 19 / `IDLE_PRIORITY_CLASS`) — but it is partial on every platform (no I/O
throttle, no `PRIO_DARWIN_BG`, no E-core routing). The full effect needs either a ~30–50-line N-API
addon or spawning system tools (`taskpolicy -b -p $PID`, `ionice`, `chrt -b`).

**Reactivate the dormant autotune.** `interval-autotune.mjs::nextInterval` already loosens the tick
interval under `cpuLoadAvg > 0.8` and tightens it when idle, but `Reconciler` only runs it when
`config.autotuneInterval === true`, which the production path never sets, and it's fed
`cpuLoadAvg ?? 0`. Enabling autotune and feeding it a real signal (`os.loadavg()[0]/cpus().length`,
or Linux PSI) is a near-free CPU-contention win with code that already exists and is unit-tested.

**Recommendations (A):**
1. `os.setPriority(PRIORITY_LOW)` at daemon startup — trivial baseline, all platforms.
2. macOS: `taskpolicy -b -p $PID` helper spawn (no root, no native code) → I/O throttle + E-cores.
3. Linux: spawn `ionice -c 3 -p $PID` + `chrt -b -p 0 $PID` (no root).
4. Wire `autotuneInterval:true` + a real `cpuLoadAvg`/PSI signal into the production reconciler config.
5. Windows: thin N-API `PROCESS_MODE_BACKGROUND_BEGIN` shim with prebuilt binaries; fall back to `PRIORITY_LOW`.
6. macOS refinement: per-thread `QOS_CLASS_BACKGROUND` on ORT worker threads via N-API.

### 4.B — ONNX Runtime: idle CPU + resident memory

The resident session is correct (given #25325), but its **defaults are tuned for a latency-critical
foreground encoder**, not a background daemon.

- **Idle-CPU killer — `force_spinning_stop`:** set `"session.force_spinning_stop":"1"` (via
  `SessionOptions.extra`, which **is** honored by onnxruntime-node — the native
  `session_options_helper.cc` walks `extra` into `AddConfigEntry`). Threads park immediately after
  the last `Run()` and re-spin on the next one. Measured trade-off (ORT #26026): always-spinning ≈ a
  full core pegged at idle vs. ~0% with force-stop, at ~14 % latency cost — a trivially good trade
  for a daemon that's idle 20–60 s between bursts. Alternative middle ground:
  `spin_duration_us:"500"` + `spin_backoff_max:"8"`.
- **Thread count for background work:** drop `intraOpNumThreads` to **2–4** for the maintainer
  profile (encoder-only INT8 GEMM recovers ~85–90 % throughput at 4 threads), optionally pinned to
  E-cores via `"session.intra_op_thread_affinities"`. We already have the plumbing:
  `configureLocalModelRuntime({intraOpThreads})` / `SWEET_SEARCH_INTRA_OP_THREADS` — it's simply
  never set on the reconcile path.
- **Resident memory — arena:** `enableCpuMemArena:false` stops the monotonic arena growth (ORT's
  arena is **never returned to the OS** once grown) at a negligible latency cost for intermittent
  batch inference. ⚠️ Per-`Run()` **arena shrinkage** (`kOrtRunOptionsConfigEnableMemoryArenaShrinkage`,
  `"cpu:0"`) is the more surgical option but the agent found `RunOptions.extra` is **not wired in
  the onnxruntime-node binding** (documented "WebAssembly only") — so disabling the arena is the
  practical Node lever today.
- **The leak (#25325):** still **open as of ORT 1.23.x (mid-2026)**, RSS grows on release. The
  team's resident-forever decision is the right call — keep it. `--max-old-space-size` is correctly
  *not* used here (the leak is **native**, not V8 heap) — consistent with project policy
  `feedback_no_memory_cap`. If memory pressure ever forces unload-when-idle, do it by running
  inference in a **disposable `worker_thread`/child process** and terminating it (reclaims all
  native memory, bypassing the leak) — accept ~100–200 ms re-arm.

**Recommendations (B):** a dedicated **"maintainer/background" ORT profile** —
`force_spinning_stop:"1"`, `intraOpNumThreads:2–4` (E-core-affined where applicable),
`enableCpuMemArena:false` — selected when the session is built inside the reconcile daemon. All
reachable from `buildLocalSessionOptions` via existing env/`configureLocalModelRuntime` hooks.
**Gate on the accuracy + byte-identical-index benchmark before shipping** (thread count and arena
can in principle perturb numerics; verify they don't).

### 4.C — Filesystem change detection at scale

Replace the per-tick full `stat()` walk with **event-driven detection + a rare reconcile
backstop** — the architecture every production tool uses (VS Code, Watchman, git fsmonitor).

- **Primary:** `@parcel/watcher` — one native lib, three platforms (FSEvents / inotify /
  ReadDirectoryChangesW), the exact watcher **VS Code** uses in production. FSEvents gives O(1)
  kernel cost + persistent event IDs for gap-free replay; inotify needs `max_user_watches` raised
  and watch set restricted to non-ignored dirs (~1 KB kernel/watch); RDCW needs a generous buffer
  for branch-switch bursts.
- **Backstop:** keep the existing full stat-walk but run it **rarely** — every 5–15 min, on
  watcher overflow/`error`, and on daemon startup. This preserves today's correctness exactly
  (the walk is already proven correct) while making it the safety net instead of the hot path.
- **Git-aware trigger:** watch `.git/HEAD` / `.git/index` to force an immediate reconcile on branch
  switches; optionally consume `git fsmonitor--daemon` (Git ≥ 2.37) directly.
- **If staying on the walk short-term:** `getattrlistbulk` (macOS) / `statx` (Linux) / `fts` +
  early prune of ignored subtrees gives ~2–5× but is still O(N); event-driven goes to ~0.

**Net effect:** idle cost O(N syscalls/tick) → ~0; burst cost O(N) → O(changed files). Functionality
is unchanged because the merkle-diff + reconcile semantics stay; only *what triggers a diff* changes,
with the full walk retained as backstop.

### 4.D — Daemon lifecycle & resident-memory management

This is the fix for the cross-repo ~16 GB footprint (one resident, model-loaded daemon per repo,
forever). Ladder of options, cheapest first:

1. **Idle-TTL self-shutdown (highest ROI, low cost):** exit cleanly after N min (15–30) with no
   search/index/edit activity; flush reconciler state first; respawn on next use. Mirrors `gopls`
   (≈1 min idle exit) and JetBrains' active→background→dormant→closed state machine. For a dev who
   context-switches across 8 repos this collapses 8 resident daemons to 1–2 — i.e. ~16 GB → ~2–4 GB.
   Cold start is 2–8 s (model load + warm from disk), best triggered by a first *search* rather than
   a keypress. **Aligns with and supersedes the R2 "idle-evict" idea in `project_ss_daemon_footprint_safety`.**
2. **On-demand respawn:** pair idle-TTL with **launchd** (`KeepAlive=false` + `Sockets`) on macOS
   and **systemd socket activation** (`systemd-socket-proxyd --exit-idle-time`) on Linux so the OS
   re-spawns on next connection with zero supervisor. Windows: app-level idle-exit. (The launcher
   already spawns on demand from search-server/MCP/SessionStart, so the respawn trigger mostly
   exists — this just makes "stop when unneeded" first-class.)
3. **Global RSS budget with process-level LRU:** coordinator tracks total daemon RSS; when it
   crosses ~60 % of `os.totalmem()`, SIGTERM the longest-idle daemon (it respawns on next use).
   Budget derived from system RAM auto-scales (4 GB on 16 GB; 32 GB on 128 GB) — no per-machine
   config, and respects `feedback_no_memory_cap` (it's a soft eviction policy, not a V8 heap cap).
   **= R3 "LRU cap."**
4. **Memory-pressure reactive eviction:** Linux **PSI** `/proc/pressure/memory` epoll trigger;
   macOS `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` (⚠️ no confirmed Node binding — needs a C addon).
   On WARN, drop idle daemons before the OS OOM-kills.
5. **Shared model server (architectural endgame, biggest absolute win):** load the ONNX model once
   in a separate process; per-repo daemons RPC for embeddings. Saves N−1 model copies
   (~10 GB for 8 repos), keeps per-repo crash isolation, and makes per-repo state cheap to evict.
   High refactor cost — propose as a later phase.

**Recommendations (D):** idle-TTL (1) + on-demand respawn (2) first — together they fix the
reported footprint with minimal change and no functional difference (an idle repo's index is
identical after respawn). Add (3) as a safety cap; consider (5) as the long-term architecture.

### 4.E — Memory-bounded incremental index maintenance

1. **Batch tier writes per tick, not per file (THE drop-in fix).** Hoist `new BinaryHNSWIndex()` +
   `load()`/`save()` and `new Database()` open/close out of the per-file adapter calls to **once per
   tick**: load/open at tick start, apply all files' ops in memory, save/close once at tick end.
   This is the structural cause of the tick peak-RAM spike (whole HNSW reloaded up to 50×/tick) and
   a big share of tick CPU+IO. **Produces a byte-identical index** — pure batching, no behavior
   change. *(Requires care around the per-tick budget cut-off / requeue path so a partially-drained
   tick still persists a consistent index + manifest.)*
2. **Keep the HNSW object live across ticks** (resident, incrementally inserted/deleted; save to
   disk only on a deletion-fraction threshold ~15 % or graceful shutdown). Eliminates the
   double-copy (old+new buffer) spike entirely. Standard hnswlib/Qdrant/Weaviate practice.
3. **mmap the HNSW `.idx`** instead of `readFileSync`+heap, *if* the format is already a flat
   binary layout — OS page cache holds only touched pages, near-zero heap on a cold tick. (Drop-in
   only if no deserialization step; otherwise a format change. Worth checking
   `binary-hnsw-index.js`'s on-disk layout.)
4. **SQLite memory bounding (drop-in pragmas):** on each tier connection set
   `cache_size = -32768` (≈32 MB cap), `soft_heap_limit = 134217728` (128 MB), and call
   `PRAGMA shrink_memory` after the maintenance drain to return cache to the OS. `mmap_size` on the
   **read/search** connections (not the write-heavy indexer ones). `wal_autocheckpoint` tuning +
   `wal_checkpoint(PASSIVE)` in the idle window. `incremental_vacuum(100)`/tick for the high-churn
   sparse-gram DB.
5. **Throttle compaction (FTS5/LSM pattern):** replace the inline drain's unbounded merge with a
   budgeted `INSERT INTO fts(fts) VALUES('merge=500')` per tick, and reserve `'optimize'` for true
   idle windows — RocksDB/tantivy-style "compact only when idle," with a token bucket keyed to the
   tick's spare budget (tick < 500 ms → one merge step; tick > 1800 ms → skip maintenance).
6. **Chunk-hash early-cutoff (Salsa principle, small arch):** persist `{filePath → chunkHashes[]}`;
   if a changed file's chunk hashes all match the prior tick (comment-only / reformat edits), skip
   embedding + all tier writes for it. Potentially large reduction in embedding calls on real edit
   streams — the most expensive per-tick CPU. *(Verify against existing delta-diff in
   `vector-delta-writer.mjs`, which already reuses unchanged chunks — this extends cutoff to skip the
   whole-file path earlier.)*

Architectural/format-changing options (LSM-VEC bottom layer, SPFresh/LIRE) are noted in §6 as
long-horizon only — **not** drop-in and likely overkill at code-search scale (<10 M vectors).

---

## 5. Consolidated roadmap (prioritized, functionality-preserving)

**Phase 1 — drop-in, no behavior change (highest ROI):**
- **E.1** Batch per-tier load/save per tick (byte-identical index). *Biggest single win; peak RAM + IO.*
- **A.1–A.3** Background OS priority: `os.setPriority(PRIORITY_LOW)` everywhere + `taskpolicy -b`
  (macOS) + `ionice`/`chrt -b` (Linux). *Removes felt contention; no native code.*
- **A.4** Flip on the existing `nextInterval` autotune with a real load/PSI signal.
- **E.4** SQLite pragmas (`cache_size`, `soft_heap_limit`, `shrink_memory`, WAL checkpoint tuning).
- **E.5** Budgeted FTS5 `merge=N` + idle-gated `optimize`.

**Phase 2 — drop-in but benchmark-gated (encode path):**
- **B** Background ORT profile: `force_spinning_stop`, `intraOpNumThreads:2–4`, `enableCpuMemArena:false`.
  *Must pass accuracy + byte-identical-index gate (`feedback_accuracy_nonnegotiable`).*

**Phase 3 — small architecture, index contract unchanged:**
- **D.1 + D.2** Idle-TTL self-shutdown + launchd/systemd on-demand respawn. *Fixes the ~16 GB footprint.*
- **C** `@parcel/watcher` event-driven primary + full stat-walk demoted to a 5–15 min backstop.
- **E.2** Keep HNSW object live across ticks; threshold-based save.
- **E.6** Chunk-hash early-cutoff cache.

**Phase 4 — larger architecture (evaluate later):**
- **D.3/D.4** Global RSS budget + LRU eviction + memory-pressure (PSI / Dispatch) reactive drop.
- **D.5** Shared model server (one model process, per-repo RPC) — biggest absolute memory win.
- **E.3** mmap-backed HNSW (if layout permits).

Windows-specific N-API `PROCESS_MODE_BACKGROUND_BEGIN` and macOS per-thread QoS addons (A.5/A.6)
slot into Phase 1–2 as polish where a native shim is acceptable.

---

## 6. Caveats, unknowns & what to benchmark

- **ORT `SessionOptions.extra` in onnxruntime-node**: confirmed by native-binding code inspection,
  **but** the public TS docs mislabel `extra` as "WebAssembly only." Verify against the installed
  ORT version before relying on `force_spinning_stop`.
- **ORT `RunOptions.extra` (per-Run arena shrinkage)**: reported **not wired** in the Node binding.
  Use `enableCpuMemArena:false` instead; re-check on ORT upgrades.
- **#25325 (`session.release()` leak)**: still open mid-2026 — keep the resident-forever design;
  monitor for a fixed release before attempting idle-unload.
- **Thread count / arena vs accuracy**: must pass the GCSN/held-out MRR gate **and** a
  byte-identical-index check (`feedback_accuracy_nonnegotiable`); numerics can shift with thread
  count and arena strategy.
- **`@parcel/watcher` on Linux**: needs `max_user_watches` raised and the watch set scoped to
  non-ignored dirs; handle `IN_Q_OVERFLOW` → backstop rescan. Validate on a large monorepo.
- **macOS memory-pressure (`DISPATCH_SOURCE_TYPE_MEMORYPRESSURE`)**: no confirmed Node binding found
  — would need a C addon.
- **Chunk-hash cutoff payoff** is edit-pattern-dependent; measure the fraction of ticks/files it
  saves on real repos before counting on it.
- **mmap HNSW** is drop-in only if `codebase-binary-hnsw.idx` is already a flat binary layout —
  verify in `core/vector-store/binary-hnsw-index.js`.
- **GPU contention note**: the reconcile path is **CPU-only** (`maintenance-worker.mjs` asserts no
  GPU), so the Metal contention tracked in `feedback_leaked_maintainer_metal_contention` comes from
  the *GPU full-index* path, not this daemon — but idle-TTL/on-demand here also reduces the chance
  of a leaked maintainer holding resources.

**Suggested measurements before/after:** daemon idle CPU % (spinning), tick wall-clock + peak RSS
(`/proc/pid/status` VmHWM or `process.memoryUsage().rss`) on a small and a large repo, idle steady-
state RSS across N repos, and a foreground-latency probe (e.g. `git status` / editor keystroke jank)
while a tick runs — at normal vs. background priority.

---

## 7. Sources

**OS scheduling / QoS / throttling:** Apple [Tuning for Apple Silicon](https://developer.apple.com/documentation/apple-silicon/tuning-your-code-s-performance-for-apple-silicon) · [taskpolicy(8)](https://ss64.com/mac/taskpolicy.html) · [Eclectic Light: background activities](https://eclecticlight.co/2021/09/10/explainer-macos-scheduled-background-activities) · [sched(7)](https://man7.org/linux/man-pages/man7/sched.7.html) · [sched_setattr(2)](https://man7.org/linux/man-pages/man2/sched_setattr.2.html) · [cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) · [Facebook PSI](https://facebookmicrosites.github.io/psi/docs/overview) · [SetPriorityClass (MSDN)](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setpriorityclass) · [Windows Search perf](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/windows-search-performance-issues) · [Node os.setPriority](https://nodejs.org/api/os.html) · [Borg/restic systemd pattern](https://oneuptime.com/blog/post/2026-01-07-ubuntu-automated-backups-restic-borg/view)

**ONNX Runtime:** [Threading](https://onnxruntime.ai/docs/performance/tune-performance/threading.html) · [session_options_config_keys.h](https://www.sidefx.com/docs/hdk/onnxruntime__session__options__config__keys_8h_source.html) · [Memory tuning](https://onnxruntime.ai/docs/performance/tune-performance/memory.html) · [#26026 spinning CPU](https://github.com/microsoft/onnxruntime/issues/26026) · [#25325 node release() leak](https://github.com/microsoft/onnxruntime/issues/25325) · [#26831 still leaking 1.23.2](https://github.com/microsoft/onnxruntime/issues/26831) · [Triton arena shrinkage](https://github.com/triton-inference-server/onnxruntime_backend/issues/103)

**File watching:** [Apple FSEvents](https://developer.apple.com/documentation/coreservices/file_system_events) · [inotify watch limits](https://watchexec.github.io/docs/inotify-limits.html) · [fanotify(7)](https://man7.org/linux/man-pages/man7/fanotify.7.html) · [@parcel/watcher](https://github.com/parcel-bundler/watcher) · [Watchman SCM queries](https://facebook.github.io/watchman/docs/scm-query) · [chokidar 4 migration](https://dev.to/43081j/migrating-from-chokidar-3x-to-4x-5ab5) · [notify (Rust)](https://github.com/notify-rs/notify) · [git fsmonitor benchmark](https://github.blog/engineering/infrastructure/improve-git-monorepo-performance-with-a-file-system-monitor/)

**Daemon lifecycle / memory:** [gopls](https://go.dev/gopls) · [clangd troubleshooting](https://clangd.llvm.org/troubleshooting) · [rust-analyzer manual](https://rust-analyzer.github.io/manual.html) · [Sourcegraph zoekt 5× RAM cut](https://sourcegraph.com/blog/zoekt-memory-optimizations-for-sourcegraph-cloud) · [systemd socket activation](http://0pointer.de/blog/projects/socket-activation.html) · [launchd.plist](https://keith.github.io/xcode-man-pages/launchd.plist.5.html) · [Dispatch memory pressure](https://developer.apple.com/documentation/dispatch/dispatch_source_memorypressure_flags_t) · [Linux PSI docs](https://docs.kernel.org/accounting/psi.html) · [PM2 max-memory-restart](https://pm2.io/docs/runtime/features/memory-limit) · [Node 22 memory behavior](https://cribl.io/blog/understanding-node-js-22-memory-behavior-and-our-upstream-contribution)

**Incremental index maintenance:** [SPFresh (SOSP'23)](https://www.microsoft.com/en-us/research/publication/spfresh-incremental-in-place-update-for-billion-scale-vector-search) · [LSM-VEC (arXiv 2505.17152)](https://arxiv.org/html/2505.17152v1) · [Enhancing HNSW real-time updates](https://arxiv.org/html/2407.07871v2) · [Qdrant on-disk/mmap](https://qdrant.tech/documentation/concepts/storage/) · [SQLite mmap benchmark](https://oldmoe.blog/2024/02/03/turn-on-mmap-support-for-your-sqlite-connections) · [SQLite FTS5](https://sqlite.org/fts5.html) · [RocksDB auto-tuned rate limiter](http://rocksdb.org/blog/2017/12/18/17-auto-tuned-rate-limiter.html) · [tantivy ARCHITECTURE](https://github.com/quickwit-oss/tantivy/blob/main/ARCHITECTURE.md) · [Salsa](https://salsa-rs.github.io/salsa/overview.html) · [rust-analyzer durable incrementality](https://rust-analyzer.github.io/blog/2023/07/24/durable-incrementality.html)
