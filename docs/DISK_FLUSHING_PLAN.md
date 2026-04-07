# Disk Flushing & OOM Prevention Plan

> **Goal**: Eliminate Node.js OOM risk during indexing and ensure crash-safe
> incremental persistence so a killed process never loses more than a few
> seconds of work.
>
> **Status**: Plan (not yet implemented)
> **Date**: 2026-04-07 (v2 — updated for DDD refactor + April 2026 SOTA)
> **Supersedes**: 2026-04-01 v1

---

## Table of Contents

1. [Current State & Risk Assessment](#1-current-state--risk-assessment)
2. [Industry SOTA Reference (April 2026)](#2-industry-sota-reference-april-2026)
3. [Phase A: HNSW Persistence (Serve vs Build)](#phase-a-hnsw-persistence-serve-vs-build-are-separate-problems)
4. [Phase B: Streaming Embeddings + Chunks](#phase-b-streaming-embeddings--chunks-kill-the-big-arrays)
5. [Phase C: Late-Interaction Streaming Flush](#phase-c-late-interaction-streaming-flush)
6. [Phase D: Artifact Builder Streaming](#phase-d-artifact-builder-streaming)
7. [Phase E: HNSW Periodic Checkpoints](#phase-e-hnsw-periodic-checkpoints)
8. [Phase F: SQLite WAL Tuning](#phase-f-sqlite-wal-tuning)
9. [Phase G: Code Graph Batched Insert](#phase-g-code-graph-batched-insert)
10. [Phase H: Crash-Resume via Incremental Tracker](#phase-h-crash-resume-via-incremental-tracker)
11. [Memory Budget & Monitoring](#memory-budget--monitoring)
12. [Implementation Order](#implementation-order)

---

## 1. Current State & Risk Assessment

### Memory Accumulation Points (ranked by peak size)

| # | Component | Location | Growth | Peak (100K chunks, 512d) | Flushed? |
|---|-----------|----------|--------|--------------------------|----------|
| 1 | Embeddings array | `core/indexing/indexer-build.js:310` | O(n*d) | **200 MB** | Never (until return at line 354) |
| 2 | Late-interaction docs Map | `core/ranking/late-interaction-index.js:103` | O(n*t*d) | **335+ MB** (int8) | Once at save() |
| 3 | Artifact parsed embeddings | `core/indexing/artifact-builder.js:504-516` | O(n*d) | **409 MB** | Never (GC after fn) |
| 4 | Artifact DB row load | `core/indexing/artifact-builder.js:494` (`.all()`) | O(n) | **50-100 MB** | Never |
| 5 | HNSW native index | USearch C++ heap | O(n*(M*d)) | **~200 MB** | Once at save() (line 217 of `indexer-ann.js`) |
| 6 | ONNX hidden states | ORT tensor per batch | O(batch*seq*hidden) | **100 MB** (transient) | Per batch |
| 7 | All chunks array | `core/indexing/indexer-build.js:367` (`chunkFiles`) | O(n) | **100+ MB** | Never (returned at line 564) |
| 8 | Code graph entities | `core/indexing/indexer-build.js:125-126` | O(n) | **2-5 MB** | Once at insertGraph (line 172) |

**Concurrent peak** (phases overlap — see concurrency model below): **~1.0-1.5 GB** for
a 100K-chunk codebase. At 500K chunks this exceeds V8's default ~4 GB heap.

### Crash Safety Gaps

| Component | Crash at minute 59/60 | Data lost |
|-----------|----------------------|-----------|
| SQLite vectors (full rebuild) | Temp file discarded, old DB intact | Current run only |
| SQLite vectors (incremental) | WAL may have partial transactions | Last uncommitted batch |
| HNSW index | **100% lost** — single save() at end (indexer-ann.js:217) | Entire HNSW |
| Late-interaction index | **100% lost** — single save() at end | Entire LI index |
| Binary HNSW + int8 | **100% lost** | Entire artifact set |
| Code graph (full rebuild) | Temp file discarded, old DB intact | Current run only |

### Current Phase Concurrency Model

Traced from `core/indexing/indexer-phases.js:248-356`:

```
Timeline:
  ├─ HCGS Summaries ──────────────────────┐  (hcgsPromise)
  ├─ Vector Embeddings ───────────────────┤  (vectorPromise, line 277)
  │  (if shouldParallelLI, line 257)      │
  ├─ Late-Interaction Encoding ───────────┤  (liPromise, line 294)
  │                                       │
  └─── Promise.all (line 307) ────────────┘
       │
       ▼
  ├─ HNSW Build (line 328-338) ───────────── Sequential after Promise.all
  │                                          Receives vectorResult.allChunks + allEmbeddings
  │  (if !shouldParallelLI, line 348)
  ├─ LI Sequential Fallback ──────────────── Only if LI didn't run in parallel
  │
  └─ Artifact Build ──────────────────────── Called later from Phase 4
```

The **worst-case concurrent overlap** is: embeddings array + chunks array +
LI documents Map + ONNX inference + SQLite — all alive during the parallel
window before Promise.all resolves.

---

## 2. Industry SOTA Reference (April 2026)

### How production vector databases handle persistence

**Qdrant** (Rust, HNSW) — *most mature production approach*:
- Segments: data split into fixed-size segments (~50K vectors each)
- Each segment flushed independently with configurable `flush_interval_sec` (default 10s)
- HNSW graph stored via **mmap** (`on_disk: true`) — OS page cache handles persistence
- Vectors also mmap-backed, reducing process RSS to ~135 MB for 1M vectors
- Quantized vectors (int8/binary) kept in RAM for first-pass; full vectors on disk
- **New in 2025-2026**: Incremental HNSW indexing for upsert-heavy workloads,
  inline storage (quantized vectors embedded directly in graph), HNSW graph
  compression, custom storage engine, GPU-accelerated HNSW indexing
- **Per-segment version tracking**: each segment stores a `last_change_version`
  and per-point version numbers. During WAL replay, stale updates (version <=
  stored version) are skipped. More robust than positional "skip first N rows".

**Milvus** (Go/C++, HNSW/IVF):
- Full WAL (Kafka-backed in cluster, RocksDB in standalone)
- DataNode transforms WAL to binlog, persists to object storage
- Segments sealed at size threshold, independently indexed
- **New in 2.6 (2025)**: Woodpecker WAL — persists log data to object storage
  (S3), metadata managed by etcd. Zero-disk durability design for clustered
  deployments. O_DIRECT + 16 MB block sizes for multi-GB/s NVMe throughput.

**Oracle 26ai** (2026, HNSW):
- `ENABLE_CHECKPOINT` / `DISABLE_CHECKPOINT` procedures for HNSW indexes
- Checkpoints are disk-serialized copies of the HNSW graph topology + metadata
- Created automatically during index creation, repopulation, and graph refresh
- Incremental snapshots for minimal frequent updates

**DuckDB VSS** (C++, HNSW):
- Experimental persistence: entire index serialized on checkpoint, deserialized on startup
- WAL recovery for HNSW "not yet properly implemented" — they acknowledge this is hard
- Crash during uncommitted changes can corrupt the index

**OpenSearch k-NN** (Java/C++ via Faiss):
- Streaming vectors from Java to JNI layer — builds graph incrementally without
  storing all vectors in a separate memory location
- Avoids 2x memory spike from Faiss internal FlatIndex duplication

**USearch** (C++, our library):
- JS bindings expose `view(path)` for mmap-backed **read-only** search access
- `save(path)` / `load(path)` for full serialization (copy into process memory)
- `view()` does NOT support `add()` — construction always happens in-memory
- Native C++ supports mmap construction, but this is not exposed in JS bindings
- During build, the HNSW graph lives in C++ heap (~200 MB for 100K@512d, M=16),
  outside V8's managed heap but still in process RSS

### How search engines handle durable index writes

**Lucene / Elasticsearch / OpenSearch**:
- Immutable segments + translog (WAL). Commit = fsync segments + directory.
  Refresh = segments become searchable but are NOT durable.
- Translog fsync'd per request by default (`durability: request`). Async mode
  defers fsync up to 5s, risking bounded data loss.
- Recovery = load segments + replay translog.

**Tantivy**:
- Immutable segments + `meta.json` atomic update (the commit point).
- No built-in translog — durability comes from segment commit.
- `prepare_commit` / `commit` two-phase protocol.
- TursoDB (2025) wraps Tantivy's `Directory` trait over B-Tree storage to get
  transactional guarantees, WAL, crash safety, and rollback "for free."

**Meilisearch**:
- LMDB (mmap, MVCC, single-writer). ACID from LMDB.
- Reads served directly from page cache via memory map — zero-copy.
- Snapshots and dumps for backup/DR.

**Typesense**:
- In-memory index + disk snapshots + WAL.
- `enable_disk_persistence` + `snapshot_interval_seconds` control recovery.

### Academic SOTA (2024-2026)

| Paper | Year | Key Contribution |
|-------|------|------------------|
| **SPFresh** (Harvard) | 2024 | Incremental in-place update for billion-scale HNSW. LSMT-style compaction for vector deletions. |
| **Starling** (Tongji/Zilliz) | 2024 | I/O-efficient disk-resident graph index on segments. Segment-based persistence with mmap reads. |
| **FreshDiskANN** (Microsoft) | 2021/updated | Streaming graph-based ANN with in-place updates. Foundational for streaming HNSW. |
| **LSM-VEC** (NTU) | 2025 | LSM-tree based dynamic vector search with WAL. Production-viable for high-write workloads. |
| **P-HNSW** (Konkuk University) | Sep 2025 | First crash-consistent HNSW on persistent memory. Not directly applicable (requires Intel Optane-class hardware) but crash-consistency primitives are instructive. |
| **HAKES** (NUS, VLDB) | 2025 | Periodic checkpoints + re-insert on recovery. Documents fine-grained locking costs. Tombstones for deletions. |
| **I/O Optimizations for Disk-Resident ANN** | Feb 2026 | I/O accounts for **70-90% of query latency** in disk-based ANN. I/O-first design framework. |
| **B+ANN** (Georgia Tech/IBM) | Nov 2025 | B+ tree approach for billion-scale disk NN. Alternative to graph-only. |
| **SHINE** (Salzburg) | Jul 2025 | Scalable HNSW in disaggregated memory. RDMA-based remote memory. |
| **GoVector** (Northeastern) | Aug 2025 | I/O-efficient caching for HNSW with topology-aware page management. |
| **In-Place Updates of Graph Index** (CMU) | Feb 2025 | Streaming ANN updates without full rebuild. Extends FreshDiskANN lineage. |
| **Quake** (Waterloo/Apple) | Jun 2025 | Adaptive indexing for vector search — dynamically restructures index based on query distribution. |

### Key takeaways

1. **Nobody has a clean incremental WAL for HNSW graphs.** The industry consensus
   remains: **mmap the graph to disk** (Qdrant, USearch) and/or **periodic
   checkpoint snapshots** (Oracle, Qdrant, HAKES). Both approaches are viable
   for sweet-search.

2. **Per-segment versioning** (Qdrant) is more robust than positional skip for
   crash resume. Track a monotonic version per vector; during WAL replay, skip
   entries whose version <= the stored version.

3. **fsync ordering is critical.** Atomic rename (`rename(tmp, final)`) is NOT
   durable without: `write file → fsync(file) → rename → fsync(parent directory)`.
   Every phase that writes checkpoint or segment files must follow this protocol.

4. **WAL + checkpoint + segment-version-tracking** is the dominant production
   pattern across Qdrant, Milvus, HAKES, and Elasticsearch.

---

## Phase A: HNSW Persistence (Serve vs Build are separate problems)

### A.1 — `view()` for search (trivial, search-time only)

**Problem**: After indexing, `core/vector-store/hnsw-index.js:300-368` (`load()`)
uses `this.index.load(usearchPath)` (line 344) which copies the entire index
into process memory. For search, this is wasteful.

**Solution**: Switch search path to use `view()` (mmap, zero-copy):

```
Build phase:  index = new Index({...}); add vectors; index.save(path)
Serve phase:  index = new Index({...}); index.view(path)  // mmap, zero-copy
```

USearch's `view()` memory-maps the file. The OS page cache handles hot/cold
pages. Confirmed available in `usearch.d.ts`: `view(path): void`.

**Important**: `view()` is read-only mmap. It helps **search time only**.
During index construction, the HNSW graph lives in USearch's C++ heap
(not V8 heap, but still process RSS). There is no way to avoid ~200 MB
of process memory during HNSW build with USearch's current JS bindings.

| Metric | Before (load) | After (view) | When |
|--------|---------------|--------------|------|
| HNSW at search time | ~200 MB in process | 0 MB (mmap, OS-managed) | Search |
| HNSW during build | ~200 MB in process | ~200 MB in process | Build (**unchanged**) |
| Search latency (NVMe) | ~0.5 ms | ~0.8 ms (page faults amortized) | Search |

### A.2 — Periodic checkpoint during build (crash safety, NOT memory)

This phase addresses **crash safety**, not memory. The ~200 MB HNSW build
cost is unavoidable with USearch — what we can fix is losing the entire
index on crash.

See **Phase E** for the checkpoint design (moved there to avoid confusion
between serve-time mmap and build-time checkpointing).

### Files to change (A.1 only)

- `core/vector-store/hnsw-index.js:300-368` (`load()`) — add parameter to
  use `view()` instead of `load()` when opened for search
- Callers of `HNSWIndex.load()` in search path (under `core/search/`) — pass
  `{ mmap: true }` option

---

## Phase B: Streaming Embeddings + Chunks (Kill the Big Arrays)

**Problem**: Two large arrays accumulate the entire corpus in memory:
1. `embeddings[]` in `core/indexing/indexer-build.js:310` — all embedding vectors (O(n*d))
2. `allChunks[]` built by `chunkFiles` at `core/indexing/indexer-build.js:362-418` — all chunks (O(n))

Both are returned from `buildVectorIndex` (line 564) as
`{ allChunks, allEmbeddings: embeddings }` and consumed by
`core/indexing/indexer-phases.js:329-337` which passes them to:
- `incrementalUpdateHNSW(vectorResult.allChunks, vectorResult.allEmbeddings, ...)` (line 335)
- `buildHNSWIndex(vectorResult.allChunks, vectorResult.allEmbeddings, dryRun)` (line 337)

The embeddings are *also* written to SQLite via the write-buffer flush path
(indexer-build.js:318-328). So the in-memory copy exists solely to feed
downstream HNSW construction.

**Solution**: After embedding inserts complete, HNSW reads from SQLite instead
of receiving in-memory arrays. This eliminates both arrays.

### B.1 — Full call chain that must change

```
core/indexing/indexer-build.js:310    embeddings[] accumulated during pipelinedEmbedAndInsert()
core/indexing/indexer-build.js:354    return embeddings
core/indexing/indexer-build.js:564    return { allChunks, allEmbeddings: embeddings }
core/indexing/indexer-phases.js:329   if (vectorResult.allChunks && vectorResult.allEmbeddings)
core/indexing/indexer-phases.js:335     incrementalUpdateHNSW(vectorResult.allChunks, vectorResult.allEmbeddings, ...)
core/indexing/indexer-phases.js:337     buildHNSWIndex(vectorResult.allChunks, vectorResult.allEmbeddings, dryRun)
core/indexing/indexer-ann.js:161      buildHNSWIndex(chunks, embeddings, dryRun)
core/indexing/indexer-ann.js:188        applyInsertionOrder(chunks, embeddings)  ← reorder via index permutation
core/indexing/indexer-ann.js:196        for (i...) { chunk = orderedChunks[i]; embedding = orderedEmbeddings[i] }
```

**Changes required:**

1. `pipelinedEmbedAndInsert` (indexer-build.js:309-355) — stop accumulating
   `embeddings[]`, stop returning it. Return only `{ count }`.
2. `buildVectorIndex` (indexer-build.js:420-565) — stop returning `allChunks` /
   `allEmbeddings`; return only `{ chunks: count, embeddings: count }` (stats).
3. `indexer-phases.js:328-338` — pass `db` handle (or db path) to
   `buildHNSWIndex` instead of arrays; guard condition changes from checking
   arrays to checking chunk count > 0.
4. `buildHNSWIndex` (indexer-ann.js:161-222) — new signature:
   `buildHNSWIndex(db, dryRun)`, reads from SQLite internally.
5. `applyInsertionOrder` (indexer-ann.js:49-65) — must be rewritten (see B.3).
6. `incrementalUpdateHNSW` (indexer-ann.js:71-155) — similar signature change.

### B.2 — HNSW reads from SQLite cursor

```javascript
function* streamVectorsFromDb(db, dim) {
  const stmt = db.prepare(
    'SELECT id, file_path, embedding, metadata FROM vectors ORDER BY rowid'
  );
  for (const row of stmt.iterate()) {
    yield {
      id: row.id,
      file: row.file_path,
      embedding: new Float32Array(row.embedding.buffer,
        row.embedding.byteOffset, dim),
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  }
}
```

**Caveats with `.iterate()`:**
- **Synchronous**: holds a read transaction open for the entire HNSW build
  (potentially minutes). WAL cannot checkpoint past this read snapshot, so
  WAL file grows if concurrent writes happen. Not a problem for our
  single-writer indexing pipeline, but must be documented.
- **Throughput**: per-row BLOB deserialization adds overhead vs reading from
  memory. Estimate ~5-15% slower for HNSW build — **must benchmark before
  committing**. If overhead exceeds 15%, consider a memory-mapped flat file
  (pre-built after SQLite inserts) as an alternative read path.

### B.3 — Insertion order with SQLite (the hard part)

`applyInsertionOrder` (`core/indexing/indexer-ann.js:49-65`) currently operates
on paired in-memory arrays via index permutation:
`indices.map(i => chunks[i])`. This cannot work with a streaming cursor.

**Solution: pre-compute order in a temp table.**

```javascript
// For 'shuffle' or 'diversity' insertion orders:
// 1. Create temp table with desired ordering
db.exec('CREATE TEMP TABLE hnsw_order (pos INTEGER PRIMARY KEY, vector_rowid INTEGER)');
const insertOrder = db.prepare('INSERT INTO hnsw_order (pos, vector_rowid) VALUES (?, ?)');

// 2. Compute permutation indices (same logic as current applyInsertionOrder)
const totalRows = db.prepare('SELECT COUNT(*) as c FROM vectors').get().c;
let indices = Array.from({ length: totalRows }, (_, i) => i + 1); // rowid is 1-based
if (order === 'shuffle') fisherYatesShuffle(indices);
else if (order === 'diversity') indices = diversityFirstPermutation(/* from file_path column */);

// 3. Populate temp table
db.transaction(() => {
  for (let pos = 0; pos < indices.length; pos++) {
    insertOrder.run(pos, indices[pos]);
  }
})();

// 4. Stream in desired order via JOIN
const stmt = db.prepare(`
  SELECT v.id, v.file_path, v.embedding, v.metadata
  FROM hnsw_order o
  JOIN vectors v ON v.rowid = o.vector_rowid
  ORDER BY o.pos
`);
for (const row of stmt.iterate()) { ... }
```

The `indices` array is O(n) integers (~800 KB for 100K rows) — negligible
compared to the O(n*d) embeddings array it replaces.

For `order === 'sequential'`, skip the temp table entirely and use
`ORDER BY rowid` directly.

### B.4 — Memory savings

| Metric | Before | After |
|--------|--------|-------|
| embeddings[] peak (100K @ 512d) | 200 MB | 0 MB |
| allChunks[] peak (100K chunks) | 100+ MB | 0 MB |
| Insertion order indices | 0 | ~0.8 MB (temp, integers only) |
| HNSW build input | In-memory arrays | SQLite cursor (O(1) per row) |
| Throughput impact | None | ~5-15% slower (**benchmark required**) |

### Files to change

- `core/indexing/indexer-build.js:309-355` (`pipelinedEmbedAndInsert`) —
  remove `embeddings` accumulation, change return type
- `core/indexing/indexer-build.js:564` (`buildVectorIndex`) — stop returning
  `allChunks` / `allEmbeddings`, return stats only
- `core/indexing/indexer-phases.js:328-338` — pass db handle to HNSW build,
  change guard condition
- `core/indexing/indexer-ann.js:49-65` (`applyInsertionOrder`) — rewrite as
  temp-table approach for non-sequential orders
- `core/indexing/indexer-ann.js:161-222` (`buildHNSWIndex`) — new signature
  `(db, dryRun)`, stream from SQLite internally
- `core/indexing/indexer-ann.js:71-155` (`incrementalUpdateHNSW`) — similar
  signature change to accept db handle

---

## Phase C: Late-Interaction Streaming Flush

**Problem**: `core/ranking/late-interaction-index.js:103` — `this.documents`
Map holds ALL token embeddings in memory (335+ MB at 100K docs with int8).
Only flushed on `save()`.

**Solution**: Segment the late-interaction index. Write segments to disk
incrementally, memory-map them for search.

### C.1 — Segmented storage

Split documents into segments of `SEGMENT_SIZE` (default 10,000 docs).
Each segment is a standalone file:

```
.sweet-search/
  late-interaction/
    segment-0000.bin   # docs 0-9999
    segment-0001.bin   # docs 10000-19999
    segment-0002.bin   # docs 20000-29999
    manifest.json      # segment metadata, doc count, token stats
```

During indexing, when a segment fills up, flush it to disk and release the
JS references. Search fans out across segments using mmap reads.

### C.2 — Segment flush pattern

```javascript
const SEGMENT_SIZE = 10_000;

async add(id, tokenEmbeddings, metadata) {
  // ... existing quantization logic (lines 130-180) ...
  this.currentSegment.set(id, { tokens, numTokens, ... });

  if (this.currentSegment.size >= SEGMENT_SIZE) {
    await this._flushSegment();
    this.currentSegment = new Map();  // Release memory
  }
}

async _flushSegment() {
  const segIdx = this.segments.length;
  const segPath = `${this.basePath}/segment-${String(segIdx).padStart(4,'0')}.bin`;

  // Durable write: write → fsync file → fsync parent directory
  await writeSegmentToDisk(segPath, this.currentSegment);
  await fsyncFile(segPath);
  await fsyncDirectory(path.dirname(segPath));

  this.segments.push({ path: segPath, count: this.currentSegment.size });
}
```

### C.3 — Search path design (MaxSim across segments)

The current search path uses MaxSim scoring via the WASM kernel
(`core/infrastructure/simd-distance.js`). The kernel expects a
**contiguous buffer** per document.

Segmented storage changes this. Three options, in order of preference:

**Option 1: Load segment into contiguous buffer on demand (recommended)**

At search time, mmap the segment file but score one segment at a time.
Each segment's documents are already contiguous within the segment file.
The WASM kernel operates on one document at a time (not the whole corpus),
so the key requirement is that each *document's* tokens are contiguous —
not that all documents are in one buffer.

```javascript
async search(queryTokens, k) {
  const allScores = [];

  for (const segment of this.segments) {
    const segData = await mmapSegment(segment.path);

    for (const [docId, docMeta] of segData.entries()) {
      const score = wasmMaxSim(queryTokens, docMeta.tokens, docMeta.numTokens, docMeta.dim);
      allScores.push({ id: docId, score });
    }
  }

  return topK(allScores, k);
}
```

This works because MaxSim is **per-document** (max over doc tokens, sum
over query tokens). Cross-document aggregation is a simple top-K merge.

**Option 2: Keep hot segment in memory, cold segments on disk**

For codebases <50K docs (5 segments), keep the most-recently-queried
segment in memory and mmap the rest. LRU eviction with 1-2 segment cache.

**Option 3: Flatten all segments at search init (fallback)**

Load all segments into a single Map at search startup (current behavior
but from segmented files). No memory savings at search time, but still
gets crash-safety and OOM-prevention during indexing.

**Recommended**: Start with Option 3 (simplest, preserves current search
semantics exactly). Upgrade to Option 1 when search-time memory becomes a
constraint. The segment file format should be designed for mmap from the
start so Option 1 is a non-breaking change.

### C.4 — Segment file format (mmap-friendly)

```
Header (64 bytes):
  magic: u32 = 0x4C495345  ("LISE" = Late Interaction Segment)
  version: u16
  docCount: u32
  tokenDim: u16
  useInt8: u8
  padding: ...

Doc index (docCount * 24 bytes):
  docIdOffset: u32     (offset into string table)
  docIdLen: u16
  tokenOffset: u32     (offset into token data)
  numTokens: u16
  min: f32             (int8 dequant param)
  scale: f32           (int8 dequant param)

String table:
  packed doc IDs (UTF-8, length-prefixed)

Token data:
  packed token arrays (int8 or f32, contiguous per doc)
```

This layout lets mmap + direct offset access work without parsing. Each
document's tokens are contiguous, satisfying the WASM kernel requirement.

### C.5 — Memory savings

| Metric | Before | After |
|--------|--------|-------|
| Peak LI memory during indexing (100K docs, int8) | 335 MB | ~33 MB (1 segment) |
| LI memory at search time (Option 3 / fallback) | 335 MB | 335 MB (unchanged) |
| LI memory at search time (Option 1 / mmap) | 335 MB | OS-managed (page cache) |
| Crash data loss | 100% | Max 10K docs (1 segment) |
| Search latency (Option 3) | Same as current | Same as current |
| Search latency (Option 1) | Same as current | +10-30% (page faults, segment iteration) |

### Files to change

- `core/ranking/late-interaction-index.js` — segment write/read logic,
  add segment file format writer, modify `add()`, `save()`, `load()`
- `core/ranking/late-interaction-index.js` (`search`) — for Option 3:
  load all segments into Map at init (minimal change); for Option 1:
  segment-by-segment scoring with mmap (larger change, deferred)
- `core/indexing/indexer-ann.js:228+` (`buildLateInteractionIndex`) —
  pass base path for segments

---

## Phase D: Artifact Builder Streaming

**Problem**: `core/indexing/artifact-builder.js:494-516` loads ALL rows from
SQLite at once (`db.prepare(...).all()` at line 494), then
`Array.from(new Float32Array(...))` at line 505 doubles memory by converting
typed arrays to JS arrays. Peak: ~450-550 MB for 100K vectors.

The `buildFromCodebaseDb` function does three memory-heavy operations on
the full `items` array:

1. `items.map(item => truncateForHNSW(...))` (artifact-builder.js:306) —
   creates ANOTHER full O(n*d) array of truncated embeddings
2. `buildHnswIndex(items, ...)` (artifact-builder.js:520) — builds binary
   HNSW with insertion-order permutation using `items[idx]` and
   `truncated[idx]` random access (lines 340-353)
3. `buildAndSaveFloatStore(items, ...)` (artifact-builder.js:541) — maps
   all items into float entries for Stage 2.5 rescoring

**Solution**: Eliminate the three-copy chain (`rows` → `items` → `truncated`)
by streaming from SQLite with per-row truncation and quantization.

### D.1 — The same insertion-order problem as Phase B

`buildHnswIndex` (`artifact-builder.js:281-370`) uses a permuted `order`
array (lines 315-335) and accesses `items[idx]` / `truncated[idx]` by random
index. This requires either:

**(a) Pre-sorted stream (same temp-table approach as Phase B)**:
Pre-compute the insertion order in a temp table, then stream rows in the
desired order. Truncation and quantization happen per-row:

```javascript
// 1. Pre-compute insertion order (reuse Phase B.3 pattern)
const orderTable = buildInsertionOrderTable(db, insertionOrder);

// 2. Stream in desired order
const stmt = db.prepare(`
  SELECT v.id, v.embedding, v.metadata
  FROM hnsw_order o
  JOIN vectors v ON v.rowid = o.vector_rowid
  ORDER BY o.pos
`);

for (const row of stmt.iterate()) {
  const embedding = new Float32Array(row.embedding.buffer,
    row.embedding.byteOffset, row.embedding.length / 4);
  const truncated = truncateForHNSW(embedding, floatDimension);
  const binary = index.encodeDocument(truncated);
  const int8 = includeInt8 ? quantizeToInt8(truncated) : null;
  await index.add(row.id, binary, row.metadata ? JSON.parse(row.metadata) : {}, int8);
  // embedding, truncated, binary, int8 all go out of scope → GC'd
}
```

**(b) Two-pass alternative**: If the temp-table approach adds too much
complexity for the artifact builder, a simpler option is to keep `.all()`
but **stop the `Array.from()` copy**:

```javascript
// Kill the double-copy: use Float32Array directly instead of Array.from
// Change artifact-builder.js:504-516
const items = rows.map(row => ({
  id: row.id,
  embedding: new Float32Array(row.embedding.buffer,
    row.embedding.byteOffset, row.embedding.length / 4),
  metadata: row.metadata ? JSON.parse(row.metadata) : {},
}));
// This alone saves ~200-300 MB by avoiding Array.from (JS arrays use ~2x
// memory vs typed arrays due to pointer boxing)
```

This is a smaller win (~50% reduction instead of ~90%) but trivially safe.

### D.2 — FloatVectorStore also needs streaming

`buildAndSaveFloatStore(items, ...)` (artifact-builder.js:459-469) maps all
items into float entries. If using approach (a), the float store must also be
built from the SQLite cursor (second pass or integrated into the same pass).
If using approach (b), the float store continues to work as-is.

### D.3 — Memory savings

| Metric | Before | After (approach a) | After (approach b) |
|--------|--------|--------------------|--------------------|
| rows[] array | 50-100 MB | 0 MB | 0 MB (rows freed after map) |
| items[] with Array.from | 409 MB | 0 MB | ~200 MB (Float32Array, no copy) |
| truncated[] array | ~200 MB | 0 MB (per-row) | ~200 MB (kept) |
| Peak during artifact build | ~550 MB | ~60 MB | ~250 MB |

### D.4 — Recommended approach

Start with **(b)** — kill the `Array.from()` copy. This is a 1-line change
at `artifact-builder.js:505` that halves the peak with zero risk. Graduate
to **(a)** if memory is still a constraint after P0/P1 items land.

### Files to change

- `core/indexing/artifact-builder.js:504-516` — remove `Array.from`, use
  `Float32Array` directly (approach b, immediate)
- `core/indexing/artifact-builder.js:281-370` (`buildHnswIndex`) — refactor
  to accept SQLite cursor with pre-sorted order (approach a, deferred)
- `core/indexing/artifact-builder.js:459-469` (`buildAndSaveFloatStore`) —
  stream from cursor or accept iterator (approach a, deferred)
- `core/vector-store/binary-hnsw-index.js` — no change needed (already has
  `add()` for single items)

---

## Phase E: HNSW Periodic Checkpoints

**Problem**: If the process dies during HNSW construction, the entire index
must be rebuilt from scratch. (`core/indexing/indexer-ann.js:217` — single
`save()` call at the end of the build loop.)

**Solution**: Save checkpoints at regular **time** intervals. On restart,
detect and resume from the last checkpoint.

### E.1 — Why time-based, not count-based

USearch `save()` serializes the **entire** index, not a delta. Save cost
grows with index size: saving 200K vectors takes longer than saving 50K.
A fixed count interval (e.g., every 50K vectors) means later checkpoints
are disproportionately expensive and the time between checkpoints is
unpredictable.

**Time-based** checkpoints guarantee bounded data loss regardless of index
size or insertion speed.

### E.2 — Checkpoint protocol

```
During build:
  1. After each vector add, check elapsed time since last checkpoint
  2. If elapsed >= CHECKPOINT_INTERVAL_SEC → save checkpoint file
  3. Write sidecar JSON: { vectorsAdded, lastRowId, version, timestamp, elapsedMs }
  4. fsync(checkpoint file) → fsync(sidecar) → fsync(parent directory)
  5. On completion → final save, delete checkpoint + sidecar

On restart:
  1. Check for checkpoint file + sidecar
  2. If found and configFingerprint matches →
     load checkpoint, skip vectors where version <= sidecar.version
  3. Resume adding from the next unprocessed vector
  4. If configFingerprint differs → discard checkpoint, full rebuild
```

**Important — fsync ordering**: The checkpoint write MUST follow:
`write file → fsync(file) → write sidecar → fsync(sidecar) → fsync(parent directory)`.
Without directory fsync, the checkpoint file may not be visible after a
power-loss crash even though the file contents are durable. This is a
POSIX requirement confirmed by Lucene, Elasticsearch, and the academic
literature (see Section 2).

### E.3 — Checkpoint file naming

```
.sweet-search/hnsw-index.usearch              # Final index
.sweet-search/hnsw-index.usearch.checkpoint    # In-progress checkpoint
.sweet-search/hnsw-index.usearch.checkpoint.json  # Sidecar metadata
```

### E.4 — Version-based resume (Qdrant pattern)

Rather than "skip first N rows" (brittle if row order changes), adopt
Qdrant's **version-based approach**: the sidecar stores a monotonic
`version` counter. Each vector in SQLite can be associated with its
`rowid` as the version. On resume, skip all vectors where `rowid <=
sidecar.lastRowId`. This is equivalent for our sequential-insert
pipeline but more robust if we later add concurrent writes.

```javascript
const CHECKPOINT_INTERVAL_SEC = 30;
const MIN_VECTORS_BETWEEN_SAVES = 1000;

let lastCheckpointTime = Date.now();
let vectorsSinceCheckpoint = 0;

for (const row of streamVectorsFromDb(db, dim)) {
  index.add(key, truncatedEmbedding);
  added++;
  vectorsSinceCheckpoint++;

  const elapsed = (Date.now() - lastCheckpointTime) / 1000;
  if (elapsed >= CHECKPOINT_INTERVAL_SEC && vectorsSinceCheckpoint >= MIN_VECTORS_BETWEEN_SAVES) {
    index.save(`${indexPath}.checkpoint`);
    await fsyncFile(`${indexPath}.checkpoint`);
    writeSidecar({ vectorsAdded: added, lastRowId: row.rowid,
                   version: row.rowid, timestamp: new Date().toISOString() });
    await fsyncFile(`${indexPath}.checkpoint.json`);
    await fsyncDirectory(path.dirname(indexPath));
    lastCheckpointTime = Date.now();
    vectorsSinceCheckpoint = 0;
  }
}

index.save(indexPath);
unlinkCheckpoint();
```

### E.5 — Tuning

| Parameter | Default | Notes |
|-----------|---------|-------|
| `CHECKPOINT_INTERVAL_SEC` | 30 | Time between checkpoints |
| `MIN_VECTORS_BETWEEN_SAVES` | 1,000 | Skip save if too few vectors added |
| Checkpoint save time (100K @ 512d) | ~200-400ms | Grows with index size |
| Max data loss on crash | ~30s of work | Independent of corpus size |

### Files to change

- `core/vector-store/hnsw-index.js` — checkpoint save/load/resume logic
- `core/indexing/indexer-ann.js:161-222` — checkpoint integration in build loop

---

## Phase F: SQLite WAL Tuning

**Problem**: Two issues:

1. **WAL is Linux-only.** `core/indexing/indexer-utils.js:20-24` —
   `isWalSafe()` returns `false` on macOS (`process.platform !== 'linux'`).
   On macOS/Darwin, the fallback is DELETE journal mode (line 41), which is
   significantly worse for write-heavy indexing (no concurrent readers, no
   append-only writes, full page journaling).

2. Current WAL config uses `autocheckpoint=1000` pages (~4 MB). This is
   reasonable but can cause write stalls during checkpoint under heavy
   insert load.

### F.1 — Enable WAL on macOS

SQLite WAL mode works correctly on macOS/APFS. The `isWalSafe` guard was
likely added for WSL/NTFS concerns. macOS should be safe:

```javascript
export function isWalSafe(dbPath) {
  // WSL + NTFS mount: WAL is unreliable due to lack of proper file locking
  if (process.env.WSL_DISTRO_NAME && dbPath && /^\/mnt\/[a-zA-Z]\//.test(dbPath)) {
    return false;
  }
  // WAL works on Linux, macOS (APFS/HFS+), and most modern filesystems.
  // Only known-bad: WSL/NTFS mounts and network filesystems.
  return true;
}
```

### F.2 — Indexing-optimized pragmas

```javascript
// During indexing only (not for search/serve):
db.pragma('wal_autocheckpoint = 4000');     // ~16 MB WAL before auto-checkpoint
db.pragma('mmap_size = 1073741824');         // 1 GB mmap for reads during build
db.pragma('cache_size = -64000');            // 64 MB page cache
db.pragma('journal_size_limit = 67108864');  // 64 MB WAL size limit
```

### F.3 — Explicit checkpoint after indexing

```javascript
// After all inserts complete (before HNSW reads from DB):
db.pragma('wal_checkpoint(TRUNCATE)');  // Force checkpoint + truncate WAL
```

This ensures the WAL is fully flushed before HNSW construction reads from
the DB. Critical because Phase B's streaming cursor holds a read
transaction open for the entire HNSW build, preventing WAL checkpointing.

### F.4 — Separate checkpoint thread (future)

For truly large corpora (>500K chunks), run WAL checkpointing in a worker
thread to avoid stalling the insert path. `better-sqlite3` doesn't support
concurrent connections from separate threads natively, but a child process
with a read-only connection can trigger checkpoints via `PRAGMA
wal_checkpoint(PASSIVE)`.

### Files to change

- `core/indexing/indexer-utils.js:20-24` (`isWalSafe`) — enable WAL on macOS
- `core/indexing/indexer-utils.js:26-44` (`configureJournalMode`) — add
  indexing-specific pragma profile
- `core/indexing/indexer-build.js` — call explicit checkpoint after inserts

---

## Phase G: Code Graph Batched Insert

**Problem**: `core/indexing/indexer-build.js:125-126` — `allEntities[]` and
`allRelationships[]` accumulate all graph data in memory before a single
`insertGraph()` call at line 172.

**Solution**: Batch insert every N files instead of accumulating everything.

### G.1 — Incremental insert

```javascript
const GRAPH_BATCH_SIZE = 100; // files
let entityBatch = [];
let relBatch = [];

for (let i = 0; i < files.length; i++) {
  const { entities, relationships } = await extractor.extractFromFile(files[i], content);
  entityBatch.push(...entities);
  relBatch.push(...relationships);

  if ((i + 1) % GRAPH_BATCH_SIZE === 0 || i === files.length - 1) {
    insertGraph(db, entityBatch, relBatch, hasFts5);
    entityBatch = [];
    relBatch = [];
  }
}
```

**Note**: The current code writes to a temp DB and atomically swaps
(`atomicSwapDatabase` at line 181). Batched inserts work within this same
temp-DB pattern — all batches go to the temp file before the swap.

### G.2 — Memory savings

Small (2-5 MB peak → <0.5 MB per batch), but improves crash granularity:
only the last 100 files' entities are lost on crash.

### Files to change

- `core/indexing/indexer-build.js:116-193` (`buildCodeGraph`) — batch the
  graph extraction + insert loop

---

## Phase H: Crash-Resume via Incremental Tracker

**Problem**: The incremental tracker (`core/indexing/incremental-tracker.js`)
knows *which* files have been indexed (via `merkle-state.json`) but not *how
far* through each phase we got. A crash means restarting the entire pipeline
even if vectors were fully inserted and only HNSW build was interrupted.

**Solution**: Extend the tracker with per-phase progress markers.

### H.1 — Phase progress file

```json
{
  "phase": "hnsw",
  "vectorsAdded": 47230,
  "lastRowId": 47230,
  "lastCheckpointFile": "hnsw-index.usearch.checkpoint",
  "timestamp": "2026-04-07T10:23:45Z",
  "configFingerprint": "abc123..."
}
```

On restart:
1. Read phase progress
2. If `phase == "vectors"` — skip already-inserted files (existing behavior)
3. If `phase == "hnsw"` — load checkpoint, skip vectors with rowid <= lastRowId
4. If `phase == "late-interaction"` — load sealed segments, resume from last
   segment's doc count
5. If `phase == "artifacts"` — just restart artifacts (fast, no embedding)

### H.2 — Phase transition markers

At each phase boundary, write a progress marker:

```javascript
async function markPhaseComplete(tracker, phase) {
  await tracker.updateProgress({ phase, status: 'complete', timestamp: Date.now() });
  // Durable: fsync progress file + parent directory
  await fsyncFile(tracker.progressPath);
  await fsyncDirectory(path.dirname(tracker.progressPath));
}
```

### Files to change

- `core/indexing/incremental-tracker.js` — add `updateProgress()`,
  `getProgress()` methods
- `core/indexing/index-codebase-v21.js` — call phase markers at boundaries
- `core/indexing/indexer-phases.js` — integrate phase progress checks into
  phase orchestration

---

## Memory Budget & Monitoring

### Phase concurrency model (verified from indexer-phases.js:248-356)

```
Timeline (current):
  ├─ HCGS Summaries ──────────────────────┐  (hcgsPromise)
  ├─ Vector Embeddings ───────────────────┤  (vectorPromise, line 277)
  │  (if shouldParallelLI, line 257)      │
  ├─ Late-Interaction Encoding ───────────┤  (liPromise, line 294)
  │                                       │
  └─── Promise.all (line 307) ────────────┘
       │
       ▼  Sequential after Promise.all:
  ├─ HNSW Build (lines 328-338) ──────────── receives allChunks + allEmbeddings
  ├─ LI Sequential Fallback (line 348) ──── only if !shouldParallelLI
  │
  └─ Artifact Build ──────────────────────── later phase
```

The **worst-case concurrent overlap** is: Vector Embeddings + Late-Interaction
Encoding + HCGS + ONNX inference all alive during the parallel window.

### Target memory profile (per-component)

| Component | Current Peak | After P0 only | After all phases | Notes |
|-----------|-------------|---------------|-----------------|-------|
| Embeddings array | 200 MB | 200 MB | 0 MB | Eliminated by Phase B (P1) |
| All chunks array | 100+ MB | 100+ MB | 0 MB | Eliminated by Phase B (P1) |
| Late-interaction docs | 335 MB | 335 MB | 33 MB (1 seg) | Phase C (P3) |
| Artifact build | 550 MB | **250 MB** | 60 MB | P0: kill Array.from; Full: D(a) streaming |
| HNSW build (C++ heap) | 200 MB | 200 MB | 200 MB | Unavoidable (not V8 heap) |
| Code graph | 5 MB | **0.5 MB** | 0.5 MB | Phase G (P0) |
| ONNX inference | 100 MB | 100 MB | 100 MB | Transient, per batch |
| SQLite + WAL | 50 MB | **80 MB** | 80 MB | Phase F (P0), larger cache |

### Concurrent peak (worst-case overlap)

**Before** (current):

| Overlap window | Components alive | V8 heap | Process RSS |
|---------------|-----------------|---------|-------------|
| Vectors + LI parallel | embeddings(200) + chunks(100) + LI(335) + ONNX(100) + SQLite(50) | ~785 MB | ~785 MB |
| HNSW build (after vectors) | embeddings(200) + chunks(100) + HNSW(200) + LI(335) + SQLite(50) | ~685 MB | ~885 MB |
| Artifact build | artifacts(550) + SQLite(50) | ~600 MB | ~600 MB |
| **Worst case** | | **~785 MB** | **~885 MB** |

**After P0 only** (D(b) + A.1 + F + G — low effort):

| Overlap window | Components alive | V8 heap | Process RSS |
|---------------|-----------------|---------|-------------|
| Vectors + LI parallel | embeddings(200) + chunks(100) + LI(335) + ONNX(100) + SQLite(80) | ~815 MB | ~815 MB |
| HNSW build | embeddings(200) + chunks(100) + HNSW(200) + LI(335) + SQLite(80) | ~715 MB | ~915 MB |
| Artifact build | artifacts(**250**) + SQLite(80) | **~330 MB** | ~330 MB |
| **Worst case** | | **~815 MB** | **~915 MB** |

P0 alone **doesn't fix the vector/HNSW/LI overlap peak** — it only fixes
the artifact build peak. The main OOM risk remains until Phase B lands.

**After P0 + P1** (add Phase B):

| Overlap window | Components alive | V8 heap | Process RSS |
|---------------|-----------------|---------|-------------|
| Vectors + LI parallel | LI(335) + ONNX(100) + SQLite(80) | ~515 MB | ~515 MB |
| HNSW build | HNSW(200) + LI(335) + SQLite(80) | ~415 MB | ~615 MB |
| Artifact build | artifacts(250) + SQLite(80) | ~330 MB | ~330 MB |
| **Worst case** | | **~515 MB** | **~615 MB** |

**After all phases** (add C, D(a)):

| Overlap window | Components alive | V8 heap | Process RSS |
|---------------|-----------------|---------|-------------|
| Vectors + LI parallel | LI-segment(33) + ONNX(100) + SQLite(80) | ~213 MB | ~213 MB |
| HNSW build | HNSW(200) + LI-segment(33) + SQLite(80) | ~113 MB | ~313 MB |
| Artifact build | artifacts(60) + SQLite(80) | ~140 MB | ~140 MB |
| **Worst case** | | **~213 MB** | **~313 MB** |

### Summary

| Milestone | V8 heap worst-case | Process RSS worst-case | V8 OOM risk |
|-----------|-------------------|----------------------|-------------|
| Current | ~785 MB | ~885 MB | **High** at >200K chunks |
| After P0 | ~815 MB | ~915 MB | **Still high** (P0 only helps artifacts) |
| After P0+P1 | ~515 MB | ~615 MB | **Low** (comfortable under 4 GB default) |
| After all | ~213 MB | ~313 MB | **None** |

Note: HNSW's 200 MB lives in USearch's C++ heap (process RSS), not V8's
managed heap. V8's GC cannot see it and it won't trigger V8 OOM. The V8
heap column excludes HNSW; the RSS column includes it.

### Runtime memory guard

Add a memory watchdog that logs warnings and triggers early flushes:

```javascript
const HEAP_WARNING_THRESHOLD = 0.75; // 75% of heap limit

function checkMemoryPressure() {
  const { heapUsed, heapTotal } = process.memoryUsage();
  const usage = heapUsed / heapTotal;
  if (usage > HEAP_WARNING_THRESHOLD) {
    log.warn(`Heap at ${(usage*100).toFixed(0)}% - triggering early flush`);
    return true;
  }
  return false;
}
```

Integrate into batch loops: if `checkMemoryPressure()` returns true, flush
the current segment/checkpoint early regardless of the normal interval.

---

## Implementation Order

Phases ordered by **impact / effort** ratio:

| Priority | Phase | Impact | Effort | Risk | Notes |
|----------|-------|--------|--------|------|-------|
| **P0** | **D(b): Artifact kill Array.from** | -250 MB | Low | Low | 1-line change at `artifact-builder.js:505`: `Array.from(new Float32Array(...))` → `new Float32Array(...)`. No API change. |
| **P0** | **A.1: HNSW view() for search** | -200 MB at search time | Low | Low | Switch `load()` → `view()` in search path of `hnsw-index.js:344` |
| **P0** | **F.1: Enable WAL on macOS** | Correct journal mode | Low | Low | Fix `isWalSafe()` in `indexer-utils.js:20-24` to return true on macOS |
| **P0** | **F.2: SQLite WAL tuning** | Better write throughput | Low | Low | Pragma changes in `indexer-utils.js:26-44` |
| **P0** | **G: Graph batched insert** | -4.5 MB, crash granularity | Low | Low | Batch loop in `indexer-build.js:116-193`, no API change |
| **P1** | **B: Kill embeddings + chunks arrays** | **-300 MB, fixes OOM** | **Medium** | **Medium** | Requires call chain refactor (4 files), insertion-order temp-table rewrite, new `buildHNSWIndex(db)` signature. **Benchmark `.iterate()` overhead first.** |
| **P2** | **E: HNSW time-based checkpoints** | Crash safety (30s max loss) | Medium | Low | Checkpoint save/resume with version-based skip + fsync ordering |
| **P2** | **D(a): Artifact full streaming** | -440 MB (vs current) | **Medium** | **Medium** | Same insertion-order temp-table issue as Phase B, plus FloatVectorStore streaming. Only needed if D(b) is insufficient. Reuse B's temp-table pattern. |
| **P3** | **C: LI segmented flush (indexing)** | -302 MB, crash safety | High | **High** | New binary segment format, search-path implications. Start with Option 3 (flatten at search init) to limit risk. |
| **P4** | **H: Crash-resume tracker** | Full resume capability | Medium | Low | Depends on E (checkpoints) and C (segments) |

### Execution sequence

```
P0  (Low effort, safe):
  1. F.1  Enable WAL on macOS              ← indexer-utils.js, 3 lines
  2. D(b) Kill Array.from                  ← artifact-builder.js:505, 1 line
  3. A.1  HNSW view() for search           ← hnsw-index.js, ~20 lines
  4. F.2  WAL tuning pragmas               ← indexer-utils.js, ~10 lines
  5. G    Graph batched insert              ← indexer-build.js, ~30 lines

P1  (Medium effort, benchmark first):
  6. B    Kill embeddings + chunks arrays   ← 4 files, ~150 lines total
         - Benchmark .iterate() overhead BEFORE starting
         - If >15% overhead, prototype flat-file alternative

P2  (Medium effort, crash safety):
  7. E    HNSW periodic checkpoints         ← 2 files, ~100 lines
  8. D(a) Artifact full streaming           ← reuse B's temp-table pattern

P3  (High effort, high risk):
  9. C    LI segmented flush                ← 2 files, ~300 lines + binary format
         - Start with Option 3 (flatten at search init)

P4  (Depends on P2+P3):
  10. H   Crash-resume tracker              ← 3 files, ~80 lines
```

---

## Research Sources

### Production systems
- Qdrant 1.17+ (Feb 2026): incremental HNSW indexing, inline storage, segment
  optimization monitoring, per-segment version tracking
- Milvus 2.6 (2025): Woodpecker WAL, O_DIRECT benchmarks, zero-disk durability
- Oracle 26ai (2026): HNSW checkpoint/snapshot architecture
- DuckDB VSS: Experimental HNSW persistence (WAL not yet implemented)
- OpenSearch k-NN #1599: Streaming vectors to JNI to avoid 2x memory
- USearch JS bindings: `view()` confirmed available in `usearch.d.ts`
- TursoDB (2025): Tantivy Directory trait over B-Tree storage for transactional FTS
- Elasticsearch/OpenSearch: translog durability model, fsync ordering

### Academic papers
- **SPFresh** (Harvard, 2024, arXiv:2410.14452): Incremental in-place HNSW update
- **Starling** (Tongji, 2024, arXiv:2401.02116): I/O-efficient disk-resident graph on segments
- **LSM-VEC** (NTU, 2025, arXiv:2505.17152): LSM-tree based dynamic vector search with WAL
- **P-HNSW** (Konkuk University, Sep 2025, doi:10.3390/app151910554): Crash-consistent
  HNSW for persistent memory
- **HAKES** (NUS, VLDB 2025, pvldb/vol18/p3049): Periodic checkpoints + re-insert recovery
- **I/O Optimizations for Disk-Resident ANN** (Feb 2026, arXiv:2602.21514): I/O = 70-90%
  of query latency; I/O-first design framework
- **B+ANN** (Georgia Tech/IBM, Nov 2025, arXiv:2511.15557): B+ tree disk NN index
- **SHINE** (Salzburg, Jul 2025, arXiv:2507.17647): Scalable HNSW in disaggregated memory
- **GoVector** (Northeastern, Aug 2025, arXiv:2508.15694): I/O-efficient HNSW caching
- **In-Place Updates of Graph Index** (CMU, Feb 2025, arXiv:2502.13826): Streaming ANN
- **Quake** (Waterloo/Apple, Jun 2025, arXiv:2506.03437): Adaptive vector index
- **FreshDiskANN** (Microsoft, 2021, arXiv:2105.09613): Foundational streaming graph ANN

### Durability fundamentals
- SQLite WAL docs: `autocheckpoint`, `wal_checkpoint(TRUNCATE)`, mmap_size
- POSIX fsync ordering: file fsync + directory fsync for durable rename
  (Evans Jones, "Ensuring Durability with File System Operations")
- Qdrant memory article: 1M vectors served with 135 MB RAM via full mmap
