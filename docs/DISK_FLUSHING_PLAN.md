# Disk Flushing & OOM Prevention Plan

> **Goal**: Eliminate Node.js OOM risk during indexing and ensure crash-safe
> incremental persistence so a killed process never loses more than a few
> seconds of work.
>
> **Status**: Plan (not yet implemented)  
> **Date**: 2026-04-01

---

## Table of Contents

1. [Current State & Risk Assessment](#1-current-state--risk-assessment)
2. [Industry SOTA Reference](#2-industry-sota-reference)
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
| 1 | Embeddings array | `indexer-build.js:310` | O(n*d) | **200 MB** | Never (until end) |
| 2 | Late-interaction docs Map | `late-interaction-index.js:102` | O(n*t*d) | **335+ MB** (int8) | Once at save() |
| 3 | Artifact parsed embeddings | `artifact-builder.js:519` | O(n*d) | **409 MB** | Never (GC after fn) |
| 4 | Artifact DB row load | `artifact-builder.js:509` | O(n) | **50-100 MB** | Never |
| 5 | HNSW native index | USearch C++ heap | O(n*(M*d)) | **~200 MB** | Once at save() |
| 6 | ONNX hidden states | ORT tensor per batch | O(batch*seq*hidden) | **100 MB** (transient) | Per batch |
| 7 | All chunks array | `indexer-build.js:367` | O(n) | **100+ MB** | Never |
| 8 | Code graph entities | `indexer-build.js:125-126` | O(n) | **2-5 MB** | Once at insert |

**Concurrent peak** (phases 2-5 overlap): **~1.0-1.5 GB** for a 100K-chunk codebase.
At 500K chunks this exceeds V8's default ~4 GB heap.

### Crash Safety Gaps

| Component | Crash at minute 59/60 | Data lost |
|-----------|----------------------|-----------|
| SQLite vectors (full rebuild) | Temp file discarded, old DB intact | Current run only |
| SQLite vectors (incremental) | WAL may have partial transactions | Last uncommitted batch |
| HNSW index | **100% lost** - single save() at end | Entire HNSW |
| Late-interaction index | **100% lost** - single save() at end | Entire LI index |
| Binary HNSW + int8 | **100% lost** | Entire artifact set |
| Code graph (full rebuild) | Temp file discarded, old DB intact | Current run only |

---

## 2. Industry SOTA Reference

### How production vector databases handle this

**Qdrant** (Rust, HNSW):
- Segments: data split into fixed-size segments (~50K vectors each)
- Each segment flushed independently with configurable `flush_interval_sec` (default 10s)
- HNSW graph stored via **mmap** (`on_disk: true`) -- OS page cache handles persistence
- Vectors also mmap-backed, reducing process RSS to ~135 MB for 1M vectors
- Quantized vectors (int8/binary) kept in RAM for first-pass; full vectors on disk

**Milvus** (Go/C++, HNSW/IVF):
- Full WAL (Kafka-backed) for all write operations
- DataNode transforms WAL to binlog, persists to object storage
- Segments sealed at size threshold, independently indexed
- Checkpoints track which WAL entries are persisted

**Oracle 26ai** (2026, HNSW):
- `ENABLE_CHECKPOINT` / `DISABLE_CHECKPOINT` procedures for HNSW indexes
- Checkpoints are disk-serialized copies of the HNSW graph topology + metadata
- Created automatically during index creation, repopulation, and graph refresh
- `VECSYS.VECTOR$INDEX$CHECKPOINTS` view tracks checkpoint status
- Incremental snapshots for minimal frequent updates

**DuckDB VSS** (C++, HNSW):
- Experimental persistence: entire index serialized on checkpoint, deserialized on startup
- WAL recovery for HNSW "not yet properly implemented" -- they acknowledge this is hard
- Crash during uncommitted changes can corrupt the index

**OpenSearch k-NN** (Java/C++ via Faiss):
- Streaming vectors from Java to JNI layer -- builds graph incrementally without
  storing all vectors in a separate memory location
- Avoids 2x memory spike from Faiss internal FlatIndex duplication

**USearch** (C++, our library):
- JS bindings expose `view(path)` for mmap-backed **read-only** search access
- `save(path)` / `load(path)` for full serialization (copy into process memory)
- `view()` does NOT support `add()` -- construction always happens in-memory
- Native C++ supports mmap construction, but this is not exposed in JS bindings
- During build, the HNSW graph lives in C++ heap (~200 MB for 100K@512d, M=16),
  outside V8's managed heap but still in process RSS

### Key takeaway

Nobody has a clean incremental WAL for HNSW graphs. The industry consensus
is: **mmap the graph to disk** (Qdrant, USearch) and/or **periodic checkpoint
snapshots** (Oracle, Qdrant). Both approaches are viable for sweet-search.

---

## Phase A: HNSW Persistence (Serve vs Build are separate problems)

### A.1 -- `view()` for search (trivial, search-time only)

**Problem**: After indexing, `hnsw-index.js` uses `load()` which copies the
entire index into process memory. For search, this is wasteful.

**Solution**: Switch search path to use `view()` (mmap, zero-copy):

```
Build phase:  index = new Index({...}); add vectors; index.save(path)
Serve phase:  index = new Index({...}); index.view(path)  // mmap, zero-copy
```

USearch's `view()` memory-maps the file. The OS page cache handles hot/cold
pages. Already supported by the JS bindings (`usearch.d.ts` confirms
`view(path): void`).

**Important**: `view()` is read-only mmap. It helps **search time only**.
During index construction, the HNSW graph lives in USearch's C++ heap
(not V8 heap, but still process RSS). There is no way to avoid ~200 MB
of process memory during HNSW build with USearch's current JS bindings.

| Metric | Before (load) | After (view) | When |
|--------|---------------|--------------|------|
| HNSW at search time | ~200 MB in process | 0 MB (mmap, OS-managed) | Search |
| HNSW during build | ~200 MB in process | ~200 MB in process | Build (**unchanged**) |
| Search latency (NVMe) | ~0.5 ms | ~0.8 ms (page faults amortized) | Search |

### A.2 -- Periodic checkpoint during build (crash safety, NOT memory)

This phase addresses **crash safety**, not memory. The ~200 MB HNSW build
cost is unavoidable with USearch -- what we can fix is losing the entire
index on crash.

See **Phase E** for the checkpoint design (moved there to avoid confusion
between serve-time mmap and build-time checkpointing).

### Files to change (A.1 only)

- `core/vector-store/hnsw-index.js:300-340` (`load()`) -- add option to use
  `view()` instead of `load()` when index is opened for search
- Callers of `HNSWIndex.load()` in search path -- pass `{ mmap: true }`

---

## Phase B: Streaming Embeddings + Chunks (Kill the Big Arrays)

**Problem**: Two large arrays accumulate the entire corpus in memory:
1. `embeddings[]` in `indexer-build.js:310` -- all embedding vectors (O(n*d))
2. `allChunks[]` in `indexer-build.js:367` -- all parsed chunks with text/metadata (O(n))

Both are returned from `buildVectorIndex` (line 564) as
`{ allChunks, allEmbeddings: embeddings }` and passed through `indexer-phases.js:335`
to `buildHNSWIndex(vectorResult.allChunks, vectorResult.allEmbeddings)`.

The embeddings are *also* written to SQLite via the write-buffer flush path.
So the in-memory copy exists solely to feed downstream HNSW construction.

**Solution**: After embedding inserts complete, HNSW reads from SQLite instead
of receiving in-memory arrays. This eliminates both arrays.

### B.1 -- Full call chain that must change

This is NOT a simple deletion. The data flows through 4 files:

```
indexer-build.js:310    embeddings[] accumulated during pipelinedEmbedAndInsert()
indexer-build.js:354    return embeddings
indexer-build.js:564    return { allChunks, allEmbeddings: embeddings }
indexer-phases.js:327   if (vectorResult.allChunks && vectorResult.allEmbeddings)
indexer-phases.js:333     incrementalUpdateHNSW(vectorResult.allChunks, vectorResult.allEmbeddings, ...)
indexer-phases.js:335     buildHNSWIndex(vectorResult.allChunks, vectorResult.allEmbeddings, dryRun)
indexer-ann.js:161      buildHNSWIndex(chunks, embeddings, dryRun)
indexer-ann.js:188        applyInsertionOrder(chunks, embeddings)  ← reorder via index permutation
indexer-ann.js:196        for (i...) { chunk = orderedChunks[i]; embedding = orderedEmbeddings[i] }
```

**Changes required:**

1. `pipelinedEmbedAndInsert` -- stop accumulating `embeddings[]`, stop returning it
2. `buildVectorIndex` -- stop returning `allChunks` / `allEmbeddings`; return
   only `{ chunks: count, embeddings: count }` (stats)
3. `indexer-phases.js` -- pass `db` handle (or db path) to `buildHNSWIndex`
   instead of arrays; guard condition changes from checking arrays to checking
   chunk count > 0
4. `buildHNSWIndex` -- new signature: `buildHNSWIndex(db, dryRun)`, reads from
   SQLite internally
5. `applyInsertionOrder` -- must be rewritten (see B.3)
6. `incrementalUpdateHNSW` -- similar signature change

### B.2 -- HNSW reads from SQLite cursor

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
  memory. Estimate ~5-15% slower for HNSW build -- **must benchmark before
  committing**. If overhead exceeds 15%, consider a memory-mapped flat file
  (pre-built after SQLite inserts) as an alternative read path.

### B.3 -- Insertion order with SQLite (the hard part)

`applyInsertionOrder` (`indexer-ann.js:49`) currently operates on paired
in-memory arrays via index permutation: `indices.map(i => chunks[i])`. This
cannot work with a streaming cursor.

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

The `indices` array is O(n) integers (~800 KB for 100K rows) -- negligible
compared to the O(n*d) embeddings array it replaces.

For `order === 'sequential'`, skip the temp table entirely and use
`ORDER BY rowid` directly.

### B.4 -- Memory savings

| Metric | Before | After |
|--------|--------|-------|
| embeddings[] peak (100K @ 512d) | 200 MB | 0 MB |
| allChunks[] peak (100K chunks) | 100+ MB | 0 MB |
| Insertion order indices | 0 | ~0.8 MB (temp, integers only) |
| HNSW build input | In-memory arrays | SQLite cursor (O(1) per row) |
| Throughput impact | None | ~5-15% slower (**benchmark required**) |

### Files to change

- `core/indexing/indexer-build.js:309-355` (`pipelinedEmbedAndInsert`) --
  remove `embeddings` accumulation, change return type
- `core/indexing/indexer-build.js:564` (`buildVectorIndex`) -- stop returning
  `allChunks` / `allEmbeddings`, return stats only
- `core/indexing/indexer-phases.js:325-336` -- pass db handle to HNSW build,
  change guard condition
- `core/indexing/indexer-ann.js:49-64` (`applyInsertionOrder`) -- rewrite as
  temp-table approach for non-sequential orders
- `core/indexing/indexer-ann.js:161-222` (`buildHNSWIndex`) -- new signature
  `(db, dryRun)`, stream from SQLite internally
- `core/indexing/indexer-ann.js:71-155` (`incrementalUpdateHNSW`) -- similar
  signature change to accept db handle

---

## Phase C: Late-Interaction Streaming Flush

**Problem**: `late-interaction-index.js` `documents` Map holds ALL token
embeddings in memory (335+ MB at 100K docs with int8). Only flushed on
`save()`.

**Solution**: Segment the late-interaction index. Write segments to disk
incrementally, memory-map them for search.

### C.1 -- Segmented storage

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

### C.2 -- Segment flush pattern

```javascript
const SEGMENT_SIZE = 10_000;

async add(id, tokenEmbeddings, metadata) {
  // ... existing quantization logic ...
  this.currentSegment.set(id, { tokens, numTokens, ... });

  if (this.currentSegment.size >= SEGMENT_SIZE) {
    await this._flushSegment();
    this.currentSegment = new Map();  // Release memory
  }
}

async _flushSegment() {
  const segIdx = this.segments.length;
  const path = `${this.basePath}/segment-${String(segIdx).padStart(4,'0')}.bin`;
  await writeSegmentToDisk(path, this.currentSegment);
  this.segments.push({ path, count: this.currentSegment.size });
}
```

### C.3 -- Search path design (MaxSim across segments)

This is the hard part. The current search path uses MaxSim scoring:
for each query token, find the max dot-product across all document tokens,
then sum those maxima. The WASM kernel (`maxsim-wasm.js`) expects a
**contiguous buffer** per document.

Segmented storage changes this. Three options, in order of preference:

**Option 1: Load segment into contiguous buffer on demand (recommended)**

At search time, mmap the segment file but score one segment at a time.
Each segment's documents are already contiguous within the segment file.
The WASM kernel operates on one document at a time (not the whole corpus),
so the key requirement is that each *document's* tokens are contiguous --
not that all documents are in one buffer.

```javascript
async search(queryTokens, k) {
  const allScores = [];

  for (const segment of this.segments) {
    // mmap the segment file (OS page cache handles hot segments)
    const segData = await mmapSegment(segment.path);

    for (const [docId, docMeta] of segData.entries()) {
      // Tokens for this doc are contiguous within the segment
      const score = wasmMaxSim(queryTokens, docMeta.tokens, docMeta.numTokens, docMeta.dim);
      allScores.push({ id: docId, score });
    }

    // Release mmap reference (OS can evict pages)
  }

  // Global top-K across all segments
  return topK(allScores, k);
}
```

This works because MaxSim is **per-document** (max over doc tokens, sum
over query tokens). Cross-document aggregation is a simple top-K merge.
There is no cross-document dependency that would require all documents
in one buffer.

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

### C.4 -- Segment file format (mmap-friendly)

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

### C.5 -- Memory savings

| Metric | Before | After |
|--------|--------|-------|
| Peak LI memory during indexing (100K docs, int8) | 335 MB | ~33 MB (1 segment) |
| LI memory at search time (Option 3 / fallback) | 335 MB | 335 MB (unchanged) |
| LI memory at search time (Option 1 / mmap) | 335 MB | OS-managed (page cache) |
| Crash data loss | 100% | Max 10K docs (1 segment) |
| Search latency (Option 3) | Same as current | Same as current |
| Search latency (Option 1) | Same as current | +10-30% (page faults, segment iteration) |

### Files to change

- `core/ranking/late-interaction-index.js` -- segment write/read logic,
  add segment file format writer, modify `add()`, `save()`, `load()`
- `core/ranking/late-interaction-index.js` (`search`) -- for Option 3:
  load all segments into Map at init (minimal change); for Option 1:
  segment-by-segment scoring with mmap (larger change, deferred)
- `core/indexing/indexer-ann.js:228-334` (`buildLateInteractionIndex`) --
  pass base path for segments

---

## Phase D: Artifact Builder Streaming

**Problem**: `artifact-builder.js:509` loads ALL rows from SQLite at once
(`db.prepare(...).all()`), then `Array.from(new Float32Array(...))` doubles
memory by converting typed arrays to JS arrays. Peak: ~450-550 MB for 100K
vectors.

The `buildFromCodebaseDb` function does three memory-heavy operations on
the full `items` array:

1. `items.map(item => truncateForHNSW(...))` (line 321) -- creates ANOTHER
   full O(n*d) array of truncated embeddings
2. `buildHnswIndex(items, ...)` (line 535) -- builds binary HNSW with
   insertion-order permutation using `items[idx]` and `truncated[idx]`
   random access
3. `buildAndSaveFloatStore(items, ...)` (line 556) -- maps all items into
   float entries for the Stage 2.5 rescoring store

**Solution**: Eliminate the three-copy chain (`rows` → `items` → `truncated`)
by streaming from SQLite with per-row truncation and quantization.

### D.1 -- The same insertion-order problem as Phase B

`buildHnswIndex` (`artifact-builder.js:328-368`) uses a permuted `order`
array and accesses `items[idx]` / `truncated[idx]` by random index. This
requires either:

**(a) Pre-sorted stream (same temp-table approach as Phase B)**:
Pre-compute the insertion order in a temp table, then stream rows in the
desired order. Truncation and quantization happen per-row:

```javascript
// 1. Pre-compute insertion order (same as Phase B.3)
const orderTable = buildInsertionOrderTable(db, insertionOrder);

// 2. Stream in desired order
const stmt = db.prepare(`
  SELECT v.id, v.embedding, v.metadata
  FROM hnsw_order o
  JOIN vectors v ON v.rowid = o.vector_rowid
  ORDER BY o.pos
`);

for (const row of stmt.iterate()) {
  const embedding = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4);
  const truncated = truncateForHNSW(embedding, floatDimension);  // Per-row, not pre-allocated
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
const items = rows.map(row => ({
  id: row.id,
  embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
  metadata: row.metadata ? JSON.parse(row.metadata) : {},
}));
// This alone saves ~200-300 MB by avoiding Array.from (JS arrays use ~2x
// memory vs typed arrays due to pointer boxing)
```

This is a smaller win (~50% reduction instead of ~90%) but trivially safe.

### D.2 -- FloatVectorStore also needs streaming

`buildAndSaveFloatStore(items, ...)` (line 474) maps all items into float
entries. If using approach (a), the float store must also be built from the
SQLite cursor (second pass or integrated into the same pass). If using
approach (b), the float store continues to work as-is.

### D.3 -- Memory savings

| Metric | Before | After (approach a) | After (approach b) |
|--------|--------|--------------------|--------------------|
| rows[] array | 50-100 MB | 0 MB | 0 MB (rows freed after map) |
| items[] with Array.from | 409 MB | 0 MB | ~200 MB (Float32Array, no copy) |
| truncated[] array | ~200 MB | 0 MB (per-row) | ~200 MB (kept) |
| Peak during artifact build | ~550 MB | ~60 MB | ~250 MB |

### D.4 -- Recommended approach

Start with **(b)** -- kill the `Array.from()` copy. This is a 1-line change
that halves the peak with zero risk. Graduate to **(a)** if memory is still
a constraint after P0/P1 items land.

### Files to change

- `core/indexing/artifact-builder.js:519-531` -- remove `Array.from`, use
  `Float32Array` directly (approach b, immediate)
- `core/indexing/artifact-builder.js:296-368` (`buildHnswIndex`) -- refactor
  to accept SQLite cursor with pre-sorted order (approach a, deferred)
- `core/indexing/artifact-builder.js:473-484` (`buildAndSaveFloatStore`) --
  stream from cursor or accept iterator (approach a, deferred)
- `core/vector-store/binary-hnsw-index.js` -- no change needed (already has
  `add()` for single items)

---

## Phase E: HNSW Periodic Checkpoints

**Problem**: If the process dies during HNSW construction, the entire index
must be rebuilt from scratch. (Moved here from Phase A.2 -- checkpointing
is about crash safety, not memory.)

**Solution**: Save checkpoints at regular **time** intervals. On restart,
detect and resume from the last checkpoint.

### E.1 -- Why time-based, not count-based

USearch `save()` serializes the **entire** index, not a delta. Save cost
grows with index size: saving 200K vectors takes longer than saving 50K.
A fixed count interval (e.g., every 50K vectors) means later checkpoints
are disproportionately expensive and the time between checkpoints is
unpredictable.

**Time-based** checkpoints guarantee bounded data loss regardless of index
size or insertion speed.

### E.2 -- Checkpoint protocol

```
During build:
  1. After each vector add, check elapsed time since last checkpoint
  2. If elapsed >= CHECKPOINT_INTERVAL_SEC → save checkpoint file
  3. Write sidecar JSON: { vectorsAdded, lastRowId, timestamp, elapsedMs }
  4. On completion → final save, delete checkpoint + sidecar

On restart:
  1. Check for checkpoint file + sidecar
  2. If found and configFingerprint matches →
     load checkpoint, skip first N rows from SQLite cursor
  3. Resume adding from row N+1
  4. If configFingerprint differs → discard checkpoint, full rebuild
```

### E.3 -- Checkpoint file naming

```
.sweet-search/hnsw-index.usearch              # Final index
.sweet-search/hnsw-index.usearch.checkpoint    # In-progress checkpoint
.sweet-search/hnsw-index.usearch.checkpoint.json  # Sidecar metadata
```

### E.4 -- Adaptive checkpoint implementation

```javascript
const CHECKPOINT_INTERVAL_SEC = 30;  // Save at most every 30 seconds
const MIN_VECTORS_BETWEEN_SAVES = 1000;  // Don't save for trivially small batches

let lastCheckpointTime = Date.now();
let vectorsSinceCheckpoint = 0;

for (const row of streamVectorsFromDb(db, dim)) {
  index.add(key, truncatedEmbedding);
  added++;
  vectorsSinceCheckpoint++;

  const elapsed = (Date.now() - lastCheckpointTime) / 1000;
  if (elapsed >= CHECKPOINT_INTERVAL_SEC && vectorsSinceCheckpoint >= MIN_VECTORS_BETWEEN_SAVES) {
    index.save(`${indexPath}.checkpoint`);
    writeSidecar({ vectorsAdded: added, lastRowId: row.rowid, timestamp: new Date().toISOString() });
    lastCheckpointTime = Date.now();
    vectorsSinceCheckpoint = 0;
  }
}

index.save(indexPath);
unlinkCheckpoint();
```

### E.5 -- Tuning

| Parameter | Default | Notes |
|-----------|---------|-------|
| `CHECKPOINT_INTERVAL_SEC` | 30 | Time between checkpoints |
| `MIN_VECTORS_BETWEEN_SAVES` | 1,000 | Skip save if too few vectors added |
| Checkpoint save time (100K @ 512d) | ~200-400ms | Grows with index size |
| Max data loss on crash | ~30s of work | Independent of corpus size |

### Files to change

- `core/vector-store/hnsw-index.js` -- checkpoint save/load/resume logic
- `core/indexing/indexer-ann.js` -- checkpoint integration in build loop

---

## Phase F: SQLite WAL Tuning

**Problem**: Current WAL config uses `autocheckpoint=1000` pages (~4 MB).
This is reasonable but can cause write stalls during checkpoint under heavy
insert load.

**Solution**: Tune WAL for the indexing workload.

### F.1 -- Indexing-optimized pragmas

```javascript
// During indexing only (not for search/serve):
db.pragma('wal_autocheckpoint = 4000');     // ~16 MB WAL before auto-checkpoint
db.pragma('mmap_size = 1073741824');         // 1 GB mmap for reads during build
db.pragma('cache_size = -64000');            // 64 MB page cache
db.pragma('journal_size_limit = 67108864');  // 64 MB WAL size limit
```

### F.2 -- Explicit checkpoint after indexing

```javascript
// After all inserts complete:
db.pragma('wal_checkpoint(TRUNCATE)');  // Force checkpoint + truncate WAL
```

This ensures the WAL is fully flushed before HNSW construction reads from
the DB.

### F.3 -- Separate checkpoint thread (future)

For truly large corpora (>500K chunks), run WAL checkpointing in a worker
thread to avoid stalling the insert path. `better-sqlite3` doesn't support
concurrent connections from separate threads natively, but a child process
with a read-only connection can trigger checkpoints via `PRAGMA
wal_checkpoint(PASSIVE)`.

### Files to change

- `core/indexing/indexer-utils.js:26-44` -- add indexing-specific pragma profile
- `core/indexing/indexer-build.js` -- call explicit checkpoint after inserts

---

## Phase G: Code Graph Batched Insert

**Problem**: `allEntities[]` and `allRelationships[]` accumulate all graph
data in memory before a single `insertGraph()` call.

**Solution**: Batch insert every N files instead of accumulating everything.

### G.1 -- Incremental insert

```javascript
const GRAPH_BATCH_SIZE = 100; // files
let entityBatch = [];
let relBatch = [];

for (let i = 0; i < files.length; i++) {
  const { entities, relationships } = await extractor.extractFromFile(files[i]);
  entityBatch.push(...entities);
  relBatch.push(...relationships);

  if ((i + 1) % GRAPH_BATCH_SIZE === 0 || i === files.length - 1) {
    insertGraph(db, entityBatch, relBatch, hasFts5);
    entityBatch = [];
    relBatch = [];
  }
}
```

### G.2 -- Memory savings

Small (2-5 MB peak → <0.5 MB per batch), but improves crash granularity:
only the last 100 files' entities are lost on crash.

### Files to change

- `core/indexing/indexer-build.js:116-193` -- batch the graph insert loop

---

## Phase H: Crash-Resume via Incremental Tracker

**Problem**: The incremental tracker (`incremental-tracker.js`) knows *which*
files have been indexed but not *how far* through each phase we got. A crash
means restarting the entire pipeline.

**Solution**: Extend the tracker with per-phase progress markers.

### H.1 -- Phase progress file

```json
{
  "phase": "hnsw",
  "vectorsAdded": 47230,
  "lastRowId": 47230,
  "lastCheckpointFile": "hnsw-index.usearch.checkpoint",
  "timestamp": "2026-04-01T10:23:45Z",
  "configFingerprint": "abc123..."
}
```

On restart:
1. Read phase progress
2. If `phase == "vectors"` -- skip already-inserted files (existing behavior)
3. If `phase == "hnsw"` -- load checkpoint, skip N rows from SQLite
4. If `phase == "late-interaction"` -- load sealed segments, resume from last
   segment's doc count
5. If `phase == "artifacts"` -- just restart artifacts (fast, no embedding)

### H.2 -- Phase transition markers

At each phase boundary, write a progress marker:

```javascript
async function markPhaseComplete(tracker, phase) {
  await tracker.updateProgress({ phase, status: 'complete', timestamp: Date.now() });
}
```

### Files to change

- `core/indexing/incremental-tracker.js` -- add `updateProgress()`,
  `getProgress()` methods
- `core/indexing/index-codebase-v21.js` -- call phase markers at boundaries

---

## Memory Budget & Monitoring

### Phase concurrency model

Phases do NOT run sequentially. `indexer-phases.js` runs some in parallel:

```
Timeline (current):
  ├─ Phase 2: Vector embeddings ──────────────┐
  │  (if shouldParallelLI)                     │
  ├─ Phase 4: Late-interaction encoding ───┐   │
  │                                        │   │
  │  (LI may still run when HNSW starts)   │   │
  ├─ Phase 3: HNSW build ─────────────     │   │
  │                                    │   │   │
  │  (sequential after HNSW)           ▼   ▼   ▼
  └─ Phase 5: Artifact build ─────
```

The **worst-case concurrent overlap** is: LI encoding + HNSW build (when
LI started in parallel and hasn't finished before HNSW begins).

### Target memory profile (per-component)

Two scenarios: P0-only (low effort) and full plan (all phases).

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

Phases don't run sequentially -- LI can run in parallel with vectors. The
worst-case overlap is: embeddings + LI + ONNX (during vector+LI parallel
phase), or embeddings + chunks + HNSW + LI (if LI hasn't finished when
HNSW starts).

**Before** (current):

| Overlap window | Components alive | V8 heap | Process RSS |
|---------------|-----------------|---------|-------------|
| Vectors + LI parallel | embeddings(200) + chunks(100) + LI(335) + ONNX(100) + SQLite(50) | ~785 MB | ~785 MB |
| HNSW build (after vectors) | embeddings(200) + chunks(100) + HNSW(200) + LI(335) + SQLite(50) | ~685 MB | ~885 MB |
| Artifact build | artifacts(550) + SQLite(50) | ~600 MB | ~600 MB |
| **Worst case** | | **~785 MB** | **~885 MB** |

**After P0 only** (D(b) + A.1 + F + G -- low effort):

| Overlap window | Components alive | V8 heap | Process RSS |
|---------------|-----------------|---------|-------------|
| Vectors + LI parallel | embeddings(200) + chunks(100) + LI(335) + ONNX(100) + SQLite(80) | ~815 MB | ~815 MB |
| HNSW build | embeddings(200) + chunks(100) + HNSW(200) + LI(335) + SQLite(80) | ~715 MB | ~915 MB |
| Artifact build | artifacts(**250**) + SQLite(80) | **~330 MB** | ~330 MB |
| **Worst case** | | **~815 MB** | **~915 MB** |

P0 alone **doesn't fix the vector/HNSW/LI overlap peak** -- it only fixes
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

Phases ordered by **impact / effort** ratio, with honest effort ratings:

| Priority | Phase | Impact | Effort | Risk | Notes |
|----------|-------|--------|--------|------|-------|
| **P0** | **D(b): Artifact kill Array.from** | -250 MB | Low | Low | 1-line change: `Array.from(new Float32Array(...))` → `new Float32Array(...)` directly. No API change. |
| **P0** | **A.1: HNSW view() for search** | -200 MB at search time | Low | Low | Switch `load()` → `view()` in search path |
| **P0** | **F: SQLite WAL tuning** | Better write throughput | Low | Low | Pragma changes only |
| **P0** | **G: Graph batched insert** | -4.5 MB, crash granularity | Low | Low | Batch loop, no API change |
| **P1** | **B: Kill embeddings + chunks arrays** | -300 MB, fixes OOM | **Medium** | **Medium** | Requires call chain refactor (4 files), insertion-order temp-table rewrite, new `buildHNSWIndex(db)` signature. **Benchmark `.iterate()` overhead first.** |
| **P2** | **E: HNSW time-based checkpoints** | Crash safety (30s max loss) | Medium | Low | Checkpoint save/resume protocol |
| **P2** | **D(a): Artifact full streaming** | -440 MB (vs current) | **Medium** | **Medium** | Same insertion-order temp-table issue as Phase B, plus FloatVectorStore streaming. Only needed if D(b) is insufficient. |
| **P3** | **C: LI segmented flush (indexing)** | -302 MB, crash safety | High | **High** | New binary segment format, search-path implications. Start with Option 3 (flatten at search init) to limit risk. |
| **P4** | **H: Crash-resume tracker** | Full resume capability | Medium | Low | Depends on E (checkpoints) and C (segments) |

**P0 items eliminate ~455 MB with Low effort and no API changes.** The
single biggest P0 win is Phase D(b) -- killing the `Array.from()` copy in
artifact-builder.js:520 is a 1-line change that eliminates ~250 MB of
JS-array pointer boxing overhead.

**P1 (Phase B) is the highest-impact single change (-300 MB) but requires
the most careful implementation** -- it changes the `buildHNSWIndex` signature,
the phase orchestration contract, and the insertion-order mechanism. Must be
benchmarked to verify `.iterate()` overhead is acceptable.

**P2 (Phase D(a)) shares the same insertion-order complexity as Phase B.**
Implement B first, then reuse the same temp-table pattern for D(a). Do not
attempt D(a) before B -- the pattern must be proven first.

**P3 (Phase C) is the riskiest** -- incorrect segment search implementation
would silently degrade search quality. The recommended path is to implement
segmented *writes* for crash safety / memory savings during indexing, but
flatten back into a single Map at search-init time (Option 3). Upgrade to
mmap-per-segment search (Option 1) only when search-time memory becomes a
measured problem.

---

## Research Sources

- Oracle 26ai Vector Search: HNSW checkpoint/snapshot architecture (Feb 2026)
- Qdrant: mmap storage + `flush_interval_sec` + segment-based persistence
- Milvus: WAL → binlog → object storage pipeline
- DuckDB VSS: Experimental HNSW persistence (WAL not yet implemented)
- OpenSearch k-NN #1599: Streaming vectors to JNI to avoid 2x memory
- USearch JS bindings: `view()` confirmed available in `usearch.d.ts`
- SPFresh (Harvard, 2024): Incremental in-place update for billion-scale HNSW
- Starling (Tongji, 2024): I/O-efficient disk-resident graph index on segments
- LSM-VEC (NTU, 2025): LSM-tree based dynamic vector search with WAL
- SQLite WAL docs: `autocheckpoint`, `wal_checkpoint(TRUNCATE)`, mmap_size
- Firebolt (2025): ACID-compliant vector indexes with mmap `load_strategy = disk`
- Qdrant memory article: 1M vectors served with 135 MB RAM via full mmap
