# Database Optimization Fix Plan

Targeted SQLite + driver-level optimizations for the query path. No schema changes, no architectural rewrites.

---

## Fix 1: Read-Path PRAGMAs on GraphSearch Init (HIGH IMPACT)

**File:** `core/graph-search.js:37-59`

**Problem:** The main search class opens the DB with `{ readonly: true }` but sets zero PRAGMAs. Meanwhile `vocab-warmer.js:75-77` sets `mmap_size` and `cache_size` for warmup reads. The hottest query path in the entire system has no read optimization.

**Current code (line 46):**
```js
this.db = new Database(this.dbPath, { readonly: true });
```

**Fix — add after line 46:**
```js
this.db = new Database(this.dbPath, { readonly: true });

// Read-path optimizations
this.db.pragma('mmap_size = 268435456');   // 256MB — let OS page cache serve reads directly
this.db.pragma('cache_size = -20000');      // 20MB page cache (default is 2MB)
this.db.pragma('temp_store = MEMORY');      // Temp tables/indexes in RAM, not disk
```

**Why these values:**
- `mmap_size = 256MB`: For a typical code-graph DB (5-50MB), this maps the entire file into memory. Subsequent reads skip SQLite's page cache entirely and read from the OS buffer cache. This alone can cut FTS5 query time by 30-50% on warm queries.
- `cache_size = -20000` (20MB): Generous for a code-graph DB. Ensures the FTS5 inverted index pages stay cached between queries.
- `temp_store = MEMORY`: Any temp B-trees (e.g., ORDER BY on FTS5 results) use RAM instead of temp files.

**Also apply to:** `core/sweet-search.js:138` (codebase DB for vector lookups).

**Risk:** None. Read-only PRAGMAs, no durability implications.

---

## Fix 2: Prepared Statement Caching (MEDIUM-HIGH IMPACT)

**File:** `core/graph-search.js` — 27 calls to `this.db.prepare()` across the file

**Problem:** Every search call re-parses SQL via `this.db.prepare()`. better-sqlite3 does NOT cache prepared statements across calls. On a <10ms budget, the ~0.1-0.5ms per `prepare()` is meaningful — especially when `bm25Search` calls `prepare()` up to 3 times (FTS5 + trigram + LIKE).

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

**Estimated savings:** 0.3-1.5ms per search call (depending on how many prepare() calls the query path hits). On a 5-8ms lexical query, that's 5-20% improvement.

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

**Problem:** PRAGMA settings are inconsistent across read paths:

| File | mmap_size | cache_size | temp_store |
|------|-----------|------------|------------|
| `graph-search.js` | (none) | (none) | (none) |
| `sweet-search.js` | (none) | (none) | (none) |
| `vocab-warmer.js` | 30GB | 100MB | (none) |
| `tool-handlers.js` | (none) | (none) | (none) |

**Fix:** Manually add the three PRAGMA lines after each `new Database(..., { readonly: true })` call in:
- `core/graph-search.js:46`
- `core/sweet-search.js:138`
- `mcp/tool-handlers.js:249`

The vocab-warmer already has PRAGMAs but uses 30GB mmap — this should be standardized to 256MB (sufficient for typical code-graph DBs, and 30GB can cause issues on systems with limited virtual address space).

**Risk:** None.

---

## Implementation Order

| Priority | Fix | Impact | Effort | Risk |
|----------|-----|--------|--------|------|
| **P0** | Fix 1: Read-path PRAGMAs on GraphSearch | High | 3 lines | None |
| **P0** | Fix 2: Prepared statement caching | Medium-High | ~40 lines refactor | Low |
| **P1** | Fix 3: Consistent PRAGMAs everywhere | Low-Medium | 6-9 lines across 3 files | None |

Fixes 1 + 2 can ship together immediately — they're pure optimizations within the existing driver.
Fix 3 is a follow-up pass to standardize PRAGMAs across all read-only DB opens.

### Expected Combined Impact

On a warm lexical query (`bm25Search`), estimated p50 latency improvement:

| Scenario | Before | After |
|----------|--------|-------|
| Small codebase (200 entities) | ~4ms | ~2.5ms |
| Medium codebase (2000 entities) | ~8ms | ~5ms |
| Large codebase (10000 entities) | ~15ms | ~10ms |
