# Database Optimization Fix Plan

Targeted SQLite + driver-level optimizations for the query path. No schema changes, no architectural rewrites.

**Baseline:** better-sqlite3 `^11.7.0` (installed: 11.10.0, bundling SQLite 3.49.2). Compile options confirm `DIRECT_OVERFLOW_READ` is enabled and `MAX_MMAP_SIZE = 0x7fff0000` (~2.147GB).

---

## Fix 1: Read-Path PRAGMAs on GraphSearch Init (HIGH IMPACT)

**File:** `core/graph-search.js:37-59`

**Problem:** The main search class opens the DB with `{ readonly: true }` but sets zero PRAGMAs. Meanwhile `vocab-warmer.js:76-77` sets `mmap_size` and `cache_size` for warmup reads. The hottest query path in the entire system has no read optimization.

**Current code (line 46):**
```js
this.db = new Database(this.dbPath, { readonly: true });
```

**Fix — add after line 46:**
```js
this.db = new Database(this.dbPath, { readonly: true });

// Read-path optimizations
this.db.pragma('mmap_size = 268435456');   // 256MB — maps entire DB into OS page cache
this.db.pragma('cache_size = -20000');      // 20MB page cache (default is ~16MB)
this.db.pragma('temp_store = MEMORY');      // Temp tables/indexes in RAM, not disk
```

**Why these values:**
- `mmap_size = 256MB`: For a typical code-graph DB (5-50MB), this maps the entire file into memory. Subsequent reads bypass SQLite's page cache and go straight to OS buffer cache via `xFetch()`. Published benchmarks suggest significant improvements for mmap-friendly workloads like FTS5 random-access reads, though the exact gain depends on DB size and OS cache state — benchmark against this repo's workload to confirm. Note: the compiled `MAX_MMAP_SIZE` caps at ~2.147GB regardless of what value is set here, so 256MB is well within bounds.
- `cache_size = -20000` (20MB): The default on this build is `cache_size = -16000` (~16MB with 4KB pages), so this is a modest bump. With mmap enabled and the entire DB mapped, the page cache is partially redundant (mmap-served pages bypass it). However, the cache still serves pages for any internal bookkeeping and acts as a safety net.
- `temp_store = MEMORY`: Any temp B-trees (e.g., ORDER BY on FTS5 results) use RAM instead of temp files. Safe for read-only connections — write-path memory bloat is not a concern. However, large sorts or complex queries can still produce sizable temp structures in RAM, so this is not zero-cost in all cases. For typical code-search queries the overhead is negligible.

**Also apply to:** `core/sweet-search.js:140` (codebase DB for vector lookups).

**Risk:** None. Read-only PRAGMAs, no durability implications.

---

## Fix 2: Prepared Statement Caching (LOW-MEDIUM IMPACT)

**File:** `core/graph-search.js` — 28 calls to `this.db.prepare()` across the file

**Problem:** Every search call re-parses SQL via `this.db.prepare()`. better-sqlite3 does NOT cache prepared statements across calls. Microbenchmarking on this runtime shows ~8-9µs per `prepare()`. On a <10ms budget this is not a primary bottleneck, but caching hot-path statements is good hygiene and eliminates repeated allocations.

**Fix — prepare all hot-path statements once in `init()`:**

```js
async init() {
  if (this.db) return;
  // ...existing init...

  // Cache hot-path prepared statements
  if (this.hasFts5) {
    this._stmtFts5 = this.db.prepare(`
      SELECT e.id, e.file_path, e.type, e.name, e.signature,
             e.doc_comment, e.start_line, e.end_line, e.package, e.parent_class,
             bm25(entities_fts, 10.0, 5.0, 1.0) AS score
      FROM entities_fts
      JOIN entities e ON entities_fts.rowid = e.rowid
      WHERE entities_fts MATCH ?
        AND e.stale_since IS NULL
      ORDER BY score
      LIMIT ?
    `);
  }

  if (this.hasTrigram) {
    this._stmtTrigram = this.db.prepare(`
      SELECT e.id, e.file_path, e.type, e.name, e.signature,
             e.doc_comment, e.start_line, e.end_line, e.package, e.parent_class,
             bm25(entities_trigram, 10.0, 3.0) AS score
      FROM entities_trigram
      JOIN entities e ON entities_trigram.rowid = e.rowid
      WHERE entities_trigram MATCH ?
        AND e.stale_since IS NULL
      ORDER BY score
      LIMIT ?
    `);
  }

  // Entity lookup by ID (used in graph traversal)
  this._stmtEntityById = this.db.prepare(
    'SELECT * FROM entities WHERE id = ? AND stale_since IS NULL'
  );

  // Outgoing relationships
  this._stmtOutRels = this.db.prepare(`
    SELECT r.*, e.name AS target_entity_name, e.type AS target_entity_type, e.file_path AS target_file
    FROM relationships r
    LEFT JOIN entities e ON r.target_id = e.id
    WHERE r.source_id = ?
  `);

  // Incoming relationships
  this._stmtInRels = this.db.prepare(`
    SELECT r.*, e.name AS source_entity_name, e.type AS source_entity_type, e.file_path AS source_file
    FROM relationships r
    LEFT JOIN entities e ON r.source_id = e.id
    WHERE r.target_id = ?
  `);
}
```

Then replace all inline `this.db.prepare(...)` in `bm25Search()`, `bm25SearchRaw()`, `getEntityById()`, etc. with the cached `this._stmt*` references.

**Estimated savings:** ~25-75µs per search call (3-8 prepare() calls on the hot path × ~8-9µs each). On a 5-8ms lexical query, that's roughly 0.5-1.5% improvement — not dramatic, but free after the one-time refactor.

**Risk:** Low. Must nullify cached statements in `close()`. If the DB is reopened, `init()` re-creates them.

**Cleanup in `close()`:**
```js
close() {
  // Prepared statements are automatically finalized when db closes,
  // but null refs to prevent use-after-close
  this._stmtFts5 = null;
  this._stmtTrigram = null;
  this._stmtEntityById = null;
  this._stmtOutRels = null;
  this._stmtInRels = null;
  if (this.db) {
    this.db.close();
    this.db = null;
  }
}
```

---

## Fix 3: Consistent Read PRAGMAs Across All Query Paths (LOW-MEDIUM IMPACT)

**Problem:** PRAGMA settings are inconsistent across read paths. The plan originally identified 3 files, but a full audit found **14+ production read-only opens** with no PRAGMAs:

| File | Line(s) | mmap_size | cache_size | temp_store |
|------|---------|-----------|------------|------------|
| `core/graph-search.js` | 46 | (none) | (none) | (none) |
| `core/sweet-search.js` | 140 | (none) | (none) | (none) |
| `core/vocab-warmer.js` | 73 | 30GB* | 100MB | (none) |
| `core/vocab-warmer.js` | 447 | (none) | (none) | (none) |
| `core/artifact-builder.js` | 461 | (none) | (none) | (none) |
| `core/community-detector.js` | 50, 130 | (none) | (none) | (none) |
| `core/hcgs-generator.js` | 401, 579 | (none) | (none) | (none) |
| `core/indexer-build.js` | 32 | (none) | (none) | (none) |
| `core/repo-map.js` | 125 | (none) | (none) | (none) |
| `core/session-warmup.js` | 208 | (none) | (none) | (none) |
| `core/summary-manager.js` | 42, 206, 281, 369 | (none) | (none) | (none) |
| `core/vocab-miner.js` | 518 | (none) | (none) | (none) |
| `core/vocab-warmup-orchestrator.js` | 195 | (none) | (none) | (none) |
| `core/vocabulary-utils.js` | 259 | (none) | (none) | (none) |
| `mcp/tool-handlers.js` | 249 | (none) | (none) | (none) |
| `scripts/vocabulary-warmup.js` | 53 | (none) | (none) | (none) |

*\* `vocab-warmer.js:76` sets `mmap_size = 30000000000` (30GB), but this is silently capped by the compiled `MAX_MMAP_SIZE = 0x7fff0000` (~2.147GB). The 30GB value is misleading, not harmful. Standardizing to 256MB is a clarity fix, not a performance change.*

**Fix:** Add the three PRAGMA lines after every `new Database(..., { readonly: true })` call listed above.

**Recommended approach:** Extract a helper to avoid repetition:

```js
// In a shared utility (e.g., core/db-utils.js or inline)
function applyReadPragmas(db) {
  db.pragma('mmap_size = 268435456');   // 256MB
  db.pragma('cache_size = -20000');      // 20MB
  db.pragma('temp_store = MEMORY');
}
```

Then call `applyReadPragmas(db)` after each read-only open. This keeps the PRAGMAs consistent and maintainable across 14+ call sites.

**Risk:** None.

---

## Fix 4: FTS5 Index Optimization After Bulk Indexing (MEDIUM IMPACT)

**File:** `core/graph-extractor.js` or `core/indexer-build.js` (after indexing completes)

**Problem:** After bulk indexing, FTS5 internal state consists of multiple b-tree segments. Queries must scan and merge these segments at read time. SQLite's FTS5 documentation explicitly recommends running the `optimize` command after bulk writes to merge all segments into a single b-tree.

**Fix — add after indexing completes:**
```js
// Merge all FTS5 segments into optimal form for reads
db.exec("INSERT INTO entities_fts(entities_fts) VALUES('optimize')");
db.exec("INSERT INTO entities_trigram(entities_trigram) VALUES('optimize')");
```

**Why:** This is a one-time cost paid during indexing that directly reduces every subsequent query's latency. FTS5 queries against a single-segment index avoid merge overhead entirely.

**Where to add:** At the end of the indexing pipeline, before the DB is closed or handed to the read path. The exact insertion point depends on whether indexing uses transactions — the optimize should run after the final commit.

**Risk:** None for reads. Adds indexing-time cost for the one-time segment merge — duration depends on index size and should be measured, but is typically acceptable as a one-time post-indexing step.

---

## Fix 5: PRAGMA optimize on Indexer/Writer Lifecycle (LOW-MEDIUM IMPACT)

**File:** `core/indexer-build.js`, `core/graph-extractor.js`, or any write-capable DB connection lifecycle

**Problem:** Since SQLite 3.46.0, `PRAGMA optimize` is the recommended way to keep `sqlite_stat1` (query planner statistics) up to date. It auto-runs `ANALYZE` on tables whose stats are stale or missing, with a built-in `analysis_limit` so it completes quickly even on large databases.

**Fix — two-part lifecycle on write-capable connections:**

SQLite documents two patterns:
- **Short-lived connections:** `PRAGMA optimize;` before close (uses default heuristics).
- **Long-lived connections:** `PRAGMA optimize=0x10002;` at open (checks all tables, fills missing stats), then plain `PRAGMA optimize;` periodically or before close.

For indexer connections (typically short-lived, opened per indexing run):
```js
// Before closing the indexer connection
db.pragma('optimize');
db.close();
```

For any long-lived writer connection (if applicable):
```js
// At open
db.pragma('optimize = 0x10002');
// ... work ...
// Before close (or periodically)
db.pragma('optimize');
db.close();
```

**Important:** Do NOT run this on read-only connections. `PRAGMA optimize` can trigger `ANALYZE` writes, which will throw `SQLITE_READONLY` on a `{ readonly: true }` connection if stats need updating. It belongs on the write/indexer lifecycle only.

**Risk:** None on write connections.

---

## Future Investigation: In-Memory Deserialize

better-sqlite3 supports opening a database from a Buffer:

```js
const buffer = fs.readFileSync(dbPath);
const db = new Database(buffer, { readonly: true });
```

This uses `sqlite3_deserialize()` to load the entire DB into process memory. Benchmarks suggest ~2x faster than mmap for databases in the 5-50MB range, because it eliminates all syscall overhead entirely.

**Trade-offs:**
- Higher open-time cost (read entire file into memory at startup)
- Higher RSS (real memory, not virtual address space like mmap)
- Snapshot semantics — the in-memory copy is frozen at load time; changes to the underlying file are invisible until reopen
- The ~2x claim is from general SQLite benchmarks, not validated against this specific codebase

**Status:** Promising but unproven for this repo. Needs benchmarking against the actual graph-search workload before adopting. Consider as a follow-up if Fix 1 + Fix 4 don't achieve target latency.

**Note:** `?immutable=1` (SQLite URI flag for skipping all locking) is another theoretical optimization, but better-sqlite3's `new Database()` does not pass `SQLITE_OPEN_URI`, so URI parameters are treated as literal filename characters. Not usable without driver changes.

---

## Future Investigation: better-sqlite3 Upgrade

**Current:** `^11.7.0` (installed 11.10.0, SQLite 3.49.2)
**Latest:** 12.8.0 (SQLite 3.51.3)

SQLite 3.51.0 includes "Use fewer CPU cycles to commit a read transaction" — a direct win for the read path. However, better-sqlite3 v12.x requires Node.js 20+, while this repo declares `engines.node >= 18.0.0` in `package.json:113`. Upgrading requires dropping Node 18 support.

**Status:** Evaluate when the repo's minimum Node.js version is raised to 20+.

---

## Implementation Order

| Priority | Fix | Impact | Effort | Risk |
|----------|-----|--------|--------|------|
| **P0** | Fix 1: Read-path PRAGMAs on GraphSearch + SweetSearch | High | 3 lines × 2 files | None |
| **P0** | Fix 4: FTS5 optimize after bulk indexing | Medium | 2 lines | None |
| **P1** | Fix 3: Consistent PRAGMAs across all 14+ read-only opens | Low-Medium | Helper + 14 call sites | None |
| **P1** | Fix 5: PRAGMA optimize on indexer lifecycle | Low-Medium | 1 line | None |
| **P2** | Fix 2: Prepared statement caching | Low | ~40 lines refactor | Low |
| **—** | In-memory deserialize | TBD | Benchmark first | Medium |
| **—** | better-sqlite3 upgrade | TBD | Node 20+ dependency | Low |

Fixes 1 + 4 should ship together — they are complementary (Fix 1 speeds up query I/O, Fix 4 speeds up FTS5 index traversal) and both are zero-risk.

Fix 3 is best done with a shared helper to avoid repeating the same 3 PRAGMAs across 14+ sites.

Fix 2 (statement caching) is correct but low-priority: ~8-9µs per prepare() means the total savings are <0.1ms per search call.

### Expected Combined Impact

On a warm lexical query (`bm25Search`), estimated p50 latency improvement from Fix 1 + Fix 4:

| Scenario | Before | After (est.) |
|----------|--------|--------------|
| Small codebase (200 entities) | ~4ms | ~2.5-3ms |
| Medium codebase (2000 entities) | ~8ms | ~5-6ms |
| Large codebase (10000 entities) | ~15ms | ~9-11ms |

These estimates are for Fix 1 (mmap + cache) and Fix 4 (FTS5 segment merge) combined. Fix 2 (statement caching) adds <0.1ms on top. Actual numbers depend on DB size, OS page cache state, and query complexity — benchmark to confirm.
