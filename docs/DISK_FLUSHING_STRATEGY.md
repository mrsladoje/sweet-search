# Disk Flushing & OOM Prevention

> Architecture documentation for sweet-search's indexing persistence layer.
> Covers memory management, crash safety, and incremental persistence
> across all indexing phases.
>
> **Status**: Implemented (`c775434`)
> **Last updated**: 2026-04-07

> **HCGS Status (2026-05)**: HCGS is disabled by default (`HCGS_CONFIG.enabled = false`); references below describe the original design. Flip the flag to re-enable.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Architecture Overview](#2-architecture-overview)
3. [HNSW Persistence (Phase A)](#3-hnsw-persistence)
4. [Streaming Embeddings from SQLite (Phase B)](#4-streaming-embeddings-from-sqlite)
5. [Late-Interaction Segmented Flush (Phase C)](#5-late-interaction-segmented-flush)
6. [Artifact Builder Streaming (Phase D)](#6-artifact-builder-streaming)
7. [HNSW Periodic Checkpoints (Phase E)](#7-hnsw-periodic-checkpoints)
8. [SQLite WAL Tuning (Phase F)](#8-sqlite-wal-tuning)
9. [Code Graph Batched Insert (Phase G)](#9-code-graph-batched-insert)
10. [Crash-Resume Tracker (Phase H)](#10-crash-resume-tracker)
11. [Memory Budget](#11-memory-budget)
12. [Design Decisions & Constraints](#12-design-decisions--constraints)
13. [Industry SOTA Reference (April 2026)](#13-industry-sota-reference)
14. [Research Sources](#14-research-sources)

---

## 1. Problem Statement

Before this work, indexing a 100K-chunk codebase could peak at **~1.0–1.5 GB**
of V8 heap due to several large in-memory arrays held simultaneously. At 500K
chunks this exceeded V8's default ~4 GB heap. A process crash at any point
during indexing lost the entire run — HNSW, late-interaction, and artifact
indexes were each written in a single atomic save at the end.

### Memory accumulation points (ranked by peak size)

| # | Component | Location | Peak (100K chunks, 512d) |
|---|-----------|----------|--------------------------|
| 1 | Late-interaction docs Map | `late-interaction-index.js` | **335+ MB** (int8) |
| 2 | Artifact parsed embeddings | `artifact-builder.js` | **409 MB** |
| 3 | Embeddings array | `indexer-build.js` | **200 MB** |
| 4 | HNSW native index | USearch C++ heap | **~200 MB** |
| 5 | All chunks array | `indexer-build.js` | **100+ MB** |
| 6 | ONNX hidden states | ORT tensor per batch | **100 MB** (transient) |
| 7 | Artifact DB row load | `artifact-builder.js` | **50–100 MB** |
| 8 | Code graph entities | `indexer-build.js` | **2–5 MB** |

### Crash safety gaps (before)

| Component | Crash at minute 59/60 | Data lost |
|-----------|----------------------|-----------|
| HNSW index | 100% lost — single `save()` at end | Entire HNSW |
| Late-interaction index | 100% lost — single `save()` at end | Entire LI index |
| Binary HNSW + int8 | 100% lost | Entire artifact set |

---

## 2. Architecture Overview

The persistence layer is organized around a pipeline of indexing phases, each
with its own flush/crash-safety strategy:

```
Phase 1: Code Graph       → Batched insert (100 files/batch), atomic swap
Phase 2: Vector Embeddings → Pipelined embed+insert to SQLite, WAL mode
Phase 3: HNSW Index       → Reads from SQLite cursor, time-based checkpoints
Phase 4: Late Interaction  → Segmented flush (10K docs/segment), staged builds
Phase 5: Artifacts        → Streams from SQLite cursor, per-row truncation
```

### Phase concurrency model

```
Timeline:
  ├─ HCGS Summaries ──────────────────────┐  (hcgsPromise)
  ├─ Vector Embeddings ───────────────────┤  (vectorPromise)
  │  (if shouldParallelLI)                │
  ├─ Late-Interaction Encoding ───────────┤  (liPromise)
  │                                       │
  └─── Promise.all ───────────────────────┘
       │
       ▼  Sequential:
  ├─ HNSW Build ────────────── Streams from SQLite (Phase B)
  ├─ LI Sequential Fallback ── Only if !shouldParallelLI
  └─ Artifact Build ─────────── Streams from SQLite (Phase D)
```

---

## 3. HNSW Persistence

### Search-time: mmap via `view()` (Phase A.1)

The search path uses USearch's `view()` (mmap, zero-copy) instead of `load()`
(full copy into process memory).

```
Build phase:  index = new Index({...}); add vectors; index.save(path)
Serve phase:  index = new Index({...}); index.view(path)  // mmap, zero-copy
```

**Files**: `core/vector-store/hnsw-index.js` (`load()` accepts `{ mmap: true }`),
`core/search/sweet-search.js` (passes `{ mmap: true }` in search init).

| Metric | Before (load) | After (view) |
|--------|---------------|--------------|
| HNSW at search time | ~200 MB in process | 0 MB (mmap, OS-managed) |
| HNSW during build | ~200 MB in process | ~200 MB (**unchanged**) |

### Build-time: periodic checkpoints (Phase E)

See [Section 7](#7-hnsw-periodic-checkpoints).

---

## 4. Streaming Embeddings from SQLite

### What changed (Phase B)

Before: `pipelinedEmbedAndInsert` accumulated an `embeddings[]` array (200 MB)
and `buildVectorIndex` returned `{ allChunks, allEmbeddings }` (300+ MB total).
HNSW construction consumed these arrays.

After: `pipelinedEmbedAndInsert` returns only a count. `buildVectorIndex`
returns stats only. HNSW reads directly from SQLite via a streaming cursor.

### `streamVectorsFromDb` generator

```
core/indexing/indexer-ann.js

function* streamVectorsFromDb(db, _dim, order = 'sequential')
```

For **sequential** order: `SELECT ... FROM vectors ORDER BY rowid` with
`.iterate()` — O(1) memory per row.

For **shuffle** or **diversity** order: pre-computes a permutation in a
temp table (`hnsw_order`), then streams via `JOIN ... ORDER BY o.pos`.
The temp-table approach replaces the old in-memory index permutation
(`applyInsertionOrder`). The `indices` array is O(n) integers (~800 KB
for 100K rows) — negligible compared to the O(n*d) arrays it replaces.

### Insertion order with temp tables

```sql
CREATE TEMP TABLE hnsw_order (pos INTEGER PRIMARY KEY, vector_rowid INTEGER);
-- populate with permuted rowids
SELECT v.* FROM hnsw_order o JOIN vectors v ON v.rowid = o.vector_rowid ORDER BY o.pos;
```

**Constraint**: non-sequential orders require a writable DB connection (temp
tables). The code opens `readonly: true` only for sequential order.

### Files changed

- `core/indexing/indexer-build.js` — `pipelinedEmbedAndInsert` returns count;
  `buildVectorIndex` returns stats only
- `core/indexing/indexer-ann.js` — `buildHNSWIndex(dbPath)` and
  `incrementalUpdateHNSW(dbPath, changedFiles)` read from SQLite
- `core/indexing/indexer-phases.js` — always pre-chunks files; passes
  `DB_PATHS.codebase` to HNSW build

| Metric | Before | After |
|--------|--------|-------|
| embeddings[] peak | 200 MB | 0 MB |
| allChunks[] peak | 100+ MB | 0 MB |
| HNSW build input | In-memory arrays | SQLite cursor (O(1) per row) |

---

## 5. Late-Interaction Segmented Flush

### Segment format (Phase C)

Documents are split into segments of `LI_SEGMENT_SIZE` (default 10,000 docs).
Each segment is a standalone binary file:

```
.sweet-search/
  late-interaction-tokens.db              # Stub → points to segment dir
  late-interaction-tokens.db.segments/
    segment-0000.bin                      # docs 0-9999
    segment-0001.bin                      # docs 10000-19999
    manifest.json                         # segment metadata
```

Binary segment format:
```
Header (64 bytes):
  magic: u32 = 0x4C495345  ("LISE")
  version: u16 = 1
  docCount: u32
  tokenDim: u16
  useInt8: u8
  padding: 51 bytes

Body:
  JSON array of documents (tokens, metadata, dequant params)
```

### Search-time behavior (Option 3)

All segments are flattened into `this.documents` at search init — identical
search semantics to the legacy single-file format. Memory savings come from
indexing time only. Upgrade to mmap-per-segment (Option 1) when search-time
memory becomes a constraint; the segment format is mmap-ready.

### Staged rebuild isolation

When `saveToPath !== loadFromPath` (staged builds), `resetForSave(saveToPath)`
is called **immediately after `init()`**, before any `add()` calls. This
resets `_segmentDir` and `_segments` so that intermediate segment flushes
during encoding go to the staged directory, never the live one.

On `save()`, all segments are rewritten from scratch using the authoritative
`this.documents` Map — stale segment files from a previous load are never
reused, ensuring document removals are reflected on disk.

### Files changed

- `core/ranking/late-interaction-index.js` — segment write/read/flush logic,
  `resetForSave()`, rewrite-on-save
- `core/indexing/indexer-ann.js` — calls `resetForSave(saveToPath)` before
  encoding loop

| Metric | Before | After |
|--------|--------|-------|
| Peak LI memory during indexing (100K docs) | 335 MB | ~33 MB (1 segment) |
| LI memory at search time | 335 MB | 335 MB (unchanged, Option 3) |
| Crash data loss | 100% | Max 10K docs (1 segment) |

---

## 6. Artifact Builder Streaming

### Phase D(b): Kill `Array.from` copy

`artifact-builder.js` used `Array.from(new Float32Array(...))` to parse
embeddings from SQLite BLOBs. The `Array.from` creates a JS array (~2x
memory vs typed arrays due to pointer boxing). Changed to use `Float32Array`
directly.

### Phase D(a): Stream from SQLite cursor

`buildHnswIndexFromDb(db)` streams rows from SQLite with per-row truncation
and quantization. Pre-computes insertion order in a temp table
(`artifact_order`) for non-sequential modes. The `buildAndSaveFloatStoreFromDb`
function similarly streams from a cursor.

**Constraint**: `FloatVectorStore.build()` requires the full entries array,
so float store construction still materializes O(n) entries. This is bounded
to truncated vectors (not full-dimension), so peak is lower.

### Files changed

- `core/indexing/artifact-builder.js` — `buildHnswIndexFromDb(db)`,
  `buildAndSaveFloatStoreFromDb(db)`, `Float32Array` direct use

| Metric | Before | After |
|--------|--------|-------|
| items[] with Array.from | 409 MB | 0 MB (streamed per-row) |
| truncated[] array | ~200 MB | 0 MB (per-row) |
| Peak during artifact build | ~550 MB | ~60 MB |

---

## 7. HNSW Periodic Checkpoints

### Design (Phase E)

USearch `save()` serializes the **entire** index, not a delta. Save cost
grows with index size. **Time-based** checkpoints guarantee bounded data
loss (~30s) regardless of index size or insertion speed.

### Checkpoint protocol

```
During build:
  1. After each vector add, check elapsed time since last checkpoint
  2. If elapsed >= 30s AND vectorsSinceCheckpoint >= 1000 → save checkpoint
  3. Write sidecar JSON: { vectorsAdded, lastRowId, version, timestamp }
  4. fsync(checkpoint) → fsync(sidecar) → fsync(parent directory)
  5. On completion → final save(), delete checkpoint + sidecar

On restart:
  1. Check for checkpoint file + sidecar
  2. If found → init() fresh, load USearch graph from checkpoint,
     rebuild JS metadata (idMap, reverseMap, nextKey) from SQLite
  3. Resume adding from rowid > sidecar.lastRowId
  4. If config changed → discard checkpoint, full rebuild
```

### Sequential-only constraint

Checkpoint resume uses `rowid <= lastRowId` to skip already-processed vectors.
This is only valid when the stream is ordered by rowid (sequential mode).
For shuffle/diversity orders, checkpoints are disabled and stale checkpoint
files are cleaned up.

### fsync ordering

The checkpoint write follows POSIX durability requirements:
`write file → fsync(file) → write sidecar → fsync(sidecar) → fsync(directory)`.
Without directory fsync, the checkpoint file may not be visible after
power-loss even though the contents are durable.

### Files changed

- `core/indexing/indexer-ann.js` — checkpoint save/load/resume/cleanup,
  fsync helpers, metadata rebuild from SQLite

| Parameter | Default |
|-----------|---------|
| `CHECKPOINT_INTERVAL_SEC` | 30 |
| `MIN_VECTORS_BETWEEN_SAVES` | 1,000 |
| Max data loss on crash | ~30s of work |

---

## 8. SQLite WAL Tuning

### WAL on macOS (Phase F.1)

`isWalSafe()` was restricted to Linux only. WAL mode works correctly on
macOS (APFS/HFS+). The guard now only excludes WSL/NTFS mounts (unreliable
file locking).

### Indexing-optimized pragmas (Phase F.2)

```sql
PRAGMA wal_autocheckpoint = 4000;        -- ~16 MB WAL before auto-checkpoint
PRAGMA mmap_size = 1073741824;           -- 1 GB mmap for reads during build
PRAGMA cache_size = -64000;              -- 64 MB page cache
PRAGMA journal_size_limit = 67108864;    -- 64 MB WAL size limit
```

### Explicit checkpoint after inserts

`checkpointWal(db)` calls `PRAGMA wal_checkpoint(TRUNCATE)` after all inserts
complete and before HNSW construction reads from the DB. Critical because
the streaming cursor holds a read transaction open for the entire HNSW
build, preventing WAL checkpointing.

### Files changed

- `core/indexing/indexer-utils.js` — `isWalSafe()`, `configureJournalMode()`,
  `checkpointWal()`
- `core/indexing/indexer-build.js` — calls `checkpointWal()` after inserts

---

## 9. Code Graph Batched Insert

### Design (Phase G)

Entity/relationship extraction and insertion are batched every 100 files
instead of accumulating everything in memory before a single `insertGraph()`
call. All batches go to the temp DB before the atomic swap.

Memory savings are small (2–5 MB → <0.5 MB per batch), but crash granularity
improves: only the last 100 files' entities are lost on crash.

### Files changed

- `core/indexing/indexer-build.js` — `buildCodeGraph()` batch loop

---

## 10. Crash-Resume Tracker

### Design (Phase H)

The incremental tracker (`core/indexing/incremental-tracker.js`) is extended
with per-phase progress markers written durably (fsync). On restart, the
pipeline can skip completed phases.

### Phase progress file

```json
{
  "phase": "hnsw",
  "status": "in_progress",
  "configFingerprint": { "provider": "...", "model": "...", ... },
  "timestamp": "2026-04-07T10:23:45Z"
}
```

Phase transitions: `vectors` → `hnsw` → `late-interaction` → `artifacts`.
Progress file is cleared after successful pipeline completion. Config
fingerprint mismatch discards stale progress.

### Files changed

- `core/indexing/incremental-tracker.js` — `updatePhaseProgress()`,
  `markPhaseComplete()`, `getPhaseProgress()`, `clearPhaseProgress()`
- `core/indexing/indexer-phases.js` — phase markers at boundaries

---

## 11. Memory Budget

### Concurrent peak (worst-case overlap)

| Milestone | V8 heap | Process RSS | OOM risk |
|-----------|---------|-------------|----------|
| Before | ~785 MB | ~885 MB | **High** at >200K chunks |
| After all phases | ~213 MB | ~313 MB | **None** |

Note: HNSW's 200 MB lives in USearch's C++ heap (process RSS), not V8's
managed heap. V8's GC cannot see it and it won't trigger V8 OOM.

### Per-component breakdown (after)

| Component | Peak |
|-----------|------|
| Embeddings array | **0 MB** (streamed from SQLite) |
| All chunks array | **0 MB** (streamed from SQLite) |
| Late-interaction docs | **~33 MB** (1 segment during indexing) |
| Artifact build | **~60 MB** (streamed) |
| HNSW build (C++ heap) | **~200 MB** (unavoidable, not V8 heap) |
| Code graph | **~0.5 MB** (batched) |
| ONNX inference | **~100 MB** (transient, per batch) |
| SQLite + WAL | **~80 MB** (tuned cache + mmap) |

---

## 12. Design Decisions & Constraints

### Why SQLite streaming, not flat files

SQLite `.iterate()` provides O(1) memory per row with transactional
guarantees. A custom flat file would be faster (~5–15% less overhead from
per-row BLOB deserialization) but adds a persistence format to maintain.
SQLite is already the source of truth for vector storage.

### Why time-based checkpoints, not count-based

USearch `save()` serializes the entire index. Save cost grows with index
size: saving 200K vectors takes longer than saving 50K. A fixed count
interval means later checkpoints are disproportionately expensive. Time-based
guarantees bounded data loss regardless of corpus size.

### Why sequential-only for checkpoint resume

Non-sequential insertion orders (shuffle, diversity) permute the stream so
that rowid is not a monotonic marker of progress. Storing the full permutation
in the sidecar would work but adds significant complexity. The dominant
production pattern (Qdrant, HAKES) uses per-segment version tracking which
requires immutable segments — a larger architectural change deferred for now.

### Why Option 3 for LI segments

Option 3 (flatten at search init) preserves current search semantics exactly.
Option 1 (mmap per segment) saves memory at search time but changes the
scoring hot path — each document's tokens must be accessed from a mmap'd
segment file instead of a contiguous in-memory Map. Deferred until
search-time memory becomes a constraint.

### Why temp tables for insertion order

The old `applyInsertionOrder` operated on paired in-memory arrays via index
permutation (`indices.map(i => chunks[i])`). With streaming, random access
isn't possible. A temp table in SQLite serves the same purpose: pre-compute
the order, then join to stream in that order. The `indices` array is O(n)
integers (~800 KB for 100K rows) — negligible.

### USearch binding limitations

- `view()` is read-only mmap. It helps search time only.
- During construction, the HNSW graph lives in C++ heap (~200 MB for
  100K@512d). Not addressable by V8 GC but counts toward process RSS.
- Native C++ supports mmap construction, but this is not exposed in JS.

---

## 13. Industry SOTA Reference

### Production vector databases (April 2026)

**Qdrant** (Rust, HNSW):
- Segments with configurable `flush_interval_sec`, mmap-backed vectors/graph
- Per-segment version tracking for WAL replay
- 2025–2026: Incremental HNSW indexing, inline storage, graph compression

**Milvus** (Go/C++):
- Full WAL (Kafka-backed cluster, RocksDB standalone)
- 2.6 (2025): Woodpecker WAL — object-storage persistence, O_DIRECT

**Oracle 26ai** (2026):
- `ENABLE_CHECKPOINT` / `DISABLE_CHECKPOINT` for HNSW indexes
- Automatic checkpoints during creation, repopulation, refresh

**USearch** (C++, our library):
- `view(path)` for mmap read-only search; `save()/load()` for serialization
- Construction always in-memory; mmap construction not exposed in JS bindings

### Key takeaways

1. **Nobody has a clean incremental WAL for HNSW graphs.** Industry consensus:
   mmap the graph to disk and/or periodic checkpoint snapshots.
2. **Per-segment versioning** (Qdrant) is more robust than positional skip.
3. **fsync ordering is critical.** Atomic rename is NOT durable without
   `write → fsync(file) → rename → fsync(parent directory)`.
4. **WAL + checkpoint + segment-version-tracking** is the dominant pattern.

---

## 14. Research Sources

### Production systems
- Qdrant 1.17+ (Feb 2026): incremental HNSW, inline storage, per-segment versions
- Milvus 2.6 (2025): Woodpecker WAL, zero-disk durability
- Oracle 26ai (2026): HNSW checkpoint/snapshot architecture
- DuckDB VSS: Experimental HNSW persistence (WAL not yet implemented)
- OpenSearch k-NN #1599: Streaming vectors to JNI to avoid 2x memory
- TursoDB (2025): Tantivy Directory trait over B-Tree for transactional FTS

### Academic papers
- **SPFresh** (Harvard, 2024, arXiv:2410.14452): Incremental in-place HNSW
- **Starling** (Tongji, 2024, arXiv:2401.02116): I/O-efficient disk-resident graph
- **LSM-VEC** (NTU, 2025, arXiv:2505.17152): LSM-tree dynamic vector search with WAL
- **P-HNSW** (Konkuk, Sep 2025, doi:10.3390/app151910554): Crash-consistent HNSW
- **HAKES** (NUS, VLDB 2025, pvldb/vol18/p3049): Periodic checkpoints + re-insert
- **I/O Optimizations for Disk-Resident ANN** (Feb 2026, arXiv:2602.21514): I/O = 70–90% of latency
- **B+ANN** (Georgia Tech/IBM, Nov 2025, arXiv:2511.15557): B+ tree disk NN
- **SHINE** (Salzburg, Jul 2025, arXiv:2507.17647): Scalable HNSW in disaggregated memory
- **GoVector** (Northeastern, Aug 2025, arXiv:2508.15694): I/O-efficient HNSW caching
- **In-Place Updates of Graph Index** (CMU, Feb 2025, arXiv:2502.13826): Streaming ANN
- **Quake** (Waterloo/Apple, Jun 2025, arXiv:2506.03437): Adaptive vector index
- **FreshDiskANN** (Microsoft, 2021, arXiv:2105.09613): Foundational streaming graph ANN

### Durability fundamentals
- SQLite WAL docs: `autocheckpoint`, `wal_checkpoint(TRUNCATE)`, `mmap_size`
- POSIX fsync ordering: file fsync + directory fsync for durable rename
- Qdrant memory article: 1M vectors served with 135 MB RAM via full mmap
