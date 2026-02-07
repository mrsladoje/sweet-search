# Indexing System Fixes Changelog

> **Version:** 2.3
> **Last Updated:** 2026-01-02
> **Total Fixes:** 51 (v2: 39, v3: 12)

## Overview

This document tracks all fixes implemented in the indexing system through multiple review and hardening passes:

- **v1**: Initial implementation
- **v2**: 39 fixes from 6-agent swarm review
- **v3**: 12 remaining fixes validated by Cursor AI cross-review

---

## P0 Workstreams (Core Fixes)

### Workstream A: Fix Incremental Vector Indexing

**Problem:** Incremental runs were wiping `codebase.db`, destroying the global vector index.

**Fix:**
- Implement true incremental behavior: remove vectors for changed files only, then insert new
- Add `file_path` column for efficient remove-by-file operations
- Preserve vectors for unchanged files

**Status:** IMPLEMENTED

**Files Modified:**
- `index-codebase-v21.js`
- `config.js`

---

### Workstream B: Fix HCGS Regeneration Pipeline

**Problem:** `index-codebase-v21.js` was calling `generateAllSummaries(sqlDb, options)` incorrectly, and `sql.js` export could overwrite the DB.

**Fix:**
- Remove `sql.js` in-memory DB path from indexing
- Make summary generation callable by DB path
- Add targeted HCGS entry point for `filesToIndex`
- Eliminate `sqlDb.export()` logic that overwrites DB

**Status:** IMPLEMENTED

**Files Modified:**
- `index-codebase-v21.js`
- `hcgs-generator.js`
- `summary-manager.js`

---

### Workstream C: Fix HCGS Generator Correctness

**Problem:** HCGS generator wasn't building parent context (missing `parent_id`) and called `getEmbedding()` incorrectly.

**Fix:**
- Select `parent_id` in `getEntitiesNeedingSummary()`
- Replace O(N^2) scanning with `parentId -> children[]` map
- Use `embeddingResult.embedding` correctly
- Define consistent `summary_embedding` format

**Status:** IMPLEMENTED

**Files Modified:**
- `hcgs-generator.js`
- `embedding-service.js`

---

### Workstream D: Fix Index Maintainer Queue Race

**Problem:** Queue was read before being renamed to `.processing`, causing entries to be lost.

**Fix:**
- Implement rename-before-read pattern
- Read processing file content after rename
- Requeue on partial failures/shutdown
- Add crash recovery for `.processing` file

**Status:** IMPLEMENTED

**Files Modified:**
- `index-maintainer.mjs`

---

### Workstream E: Implement Targeted Indexing Flags

**Problem:** `--files-from-stdin` and `--quiet` flags weren't implemented.

**Fix:**
- Implement `--files-from-stdin`: read newline-delimited paths from stdin
- Implement `--quiet`: suppress progress bars and non-essential logs
- Align daemon spawn args with actual indexer behavior

**Status:** IMPLEMENTED

**Files Modified:**
- `index-codebase-v21.js`
- `index-maintainer.mjs`

---

## Security Fixes (S1-S5)

### S1: Lock Files Moved to .agentdb [IMPLEMENTED]

**Problem:** Lock files in `/tmp` were insecure (world-readable).

**Fix:** Move all lock files to `.agentdb/` directory.

**Files:**
- `.agentdb/index-maintainer.lock`
- `.agentdb/indexing.lock`

---

### S2: Lock File Permissions [IMPLEMENTED]

**Problem:** Lock files had default permissions.

**Fix:** Set permissions to `0o600` (owner-only read/write).

---

### S3: PID Validation for Lock Ownership [IMPLEMENTED]

**Problem:** No ownership verification before releasing locks.

**Fix:** Add PID validation pattern:
```javascript
if (lockPid === process.pid) {
  unlinkSync(lockFile);
}
```

---

### S4: refreshLock() Ownership Check (C1) [IMPLEMENTED]

**Problem:** `refreshLock()` blindly overwrote without checking ownership.

**Fix:**
```javascript
function refreshLock() {
  const existing = readLockFile();
  if (existing && existing.pid === process.pid) {
    writeLock();
    return true;
  }
  return false;
}
```

---

### S5: releaseGlobalIndexLock() PID Verification (C2) [IMPLEMENTED]

**Problem:** `releaseGlobalIndexLock()` deleted without verifying ownership.

**Fix:**
```javascript
function releaseGlobalIndexLock() {
  const content = readFileSync(GLOBAL_INDEX_LOCK, 'utf-8');
  const lockPid = parseInt(content.split('\n')[0], 10);
  if (lockPid === process.pid) {
    unlinkSync(GLOBAL_INDEX_LOCK);
  }
}
```

---

## Error Handling Fixes (E1-E8)

### E1: Async Try-Catch Patterns [IMPLEMENTED]

**Problem:** Missing try-catch in async functions.

**Fix:** Wrap all async operations with proper error handling.

---

### E2: Corrupt vs Missing State Differentiation [IMPLEMENTED]

**Problem:** All state file errors treated the same.

**Fix:**
```javascript
if (err.code === 'ENOENT') {
  // Missing - normal for first run
  return { files: {}, version: '2.2' };
}
if (err instanceof SyntaxError) {
  // Corrupt - backup and recreate
  await backupCorruptState();
  return { files: {}, version: '2.2' };
}
```

---

### E3: Circuit Breaker for Voyage API (H1) [IMPLEMENTED]

**Problem:** No protection against API outages.

**Fix:**
```javascript
const circuitBreaker = {
  FAILURE_THRESHOLD: 5,
  COOLDOWN_MS: 60000,
  SUCCESS_TO_CLOSE: 2,
  state: 'CLOSED',
  // ...
};
```

---

### E4: ENOSPC Handling in index-maintainer.mjs (H3) [IMPLEMENTED]

**Problem:** Disk full errors not handled.

**Fix:**
```javascript
if (err.code === 'ENOSPC') {
  throw new Error(`CRITICAL: Disk full, cannot write to ${filePath}`);
}
```

---

### E5: Atomic Write Pattern [IMPLEMENTED]

**Problem:** Non-atomic writes could corrupt files.

**Fix:**
```javascript
const tempPath = `${filePath}.tmp.${process.pid}`;
await fs.writeFile(tempPath, content);
await fs.rename(tempPath, filePath);
```

---

### E6: Queue Append Error Handling [IMPLEMENTED]

**Problem:** Silent failures when appending to queue.

**Fix:** Log dropped entries and return false on ENOSPC.

---

### E7: Indexing Timeout [IMPLEMENTED]

**Problem:** Stuck indexing operations.

**Fix:** 5-minute timeout with SIGTERM.

---

### E8: Crash Recovery [IMPLEMENTED]

**Problem:** Processing file not recovered after crash.

**Fix:** Check for `.processing` file on startup and prepend to queue.

---

## Performance Fixes (P1-P9)

### P1: stale_since Column + Covering Index [IMPLEMENTED]

**Problem:** No efficient way to filter stale entries.

**Fix:**
```sql
ALTER TABLE entities ADD COLUMN stale_since INTEGER DEFAULT NULL;
CREATE INDEX idx_entities_active ON entities(file_path) WHERE stale_since IS NULL;
```

---

### P2: N+1 Query Batching [IMPLEMENTED]

**Problem:** Individual queries for each entity.

**Fix:** Batch queries with IN clauses.

---

### P3: Async Sleep Patterns [IMPLEMENTED]

**Problem:** Blocking sleep calls.

**Fix:** Use `await new Promise(r => setTimeout(r, ms))`.

---

### P4: Fast-Path Stat Check [IMPLEMENTED]

**Problem:** Reading all file contents for change detection.

**Fix:** Check `(mtime_ns, size)` first (~0.1ms vs ~1ms for content hash).

---

### P5: Deferred Startup Check [IMPLEMENTED]

**Problem:** First merkle check blocked startup.

**Fix:** 7-second delay before first check.

---

### P6: Lock Refresh Interval [IMPLEMENTED]

**Problem:** Lock could become stale.

**Fix:** Refresh every 30 seconds.

---

### P7: Queue Peek Before Process [IMPLEMENTED]

**Problem:** Unnecessary processing attempts.

**Fix:** Peek queue before acquiring lock.

---

### P8: Binary HNSW Rebuild Threshold [IMPLEMENTED]

**Problem:** Rebuilding on every change.

**Fix:** Only rebuild if >5% vectors changed.

---

### P9: Soft Delete Strategy [IMPLEMENTED]

**Problem:** Losing HCGS summaries on branch switch.

**Fix:** Mark stale instead of delete, prune after 30 days.

---

## Architecture Fixes (A1-A3)

### A1: Vector Stale Filtering [IMPLEMENTED]

**Problem:** Stale entries returned in search.

**Fix:** Add `WHERE stale_since IS NULL` to all search queries.

---

### A2: Module Loader Resilience [IMPLEMENTED]

**Problem:** Hard failures on missing optional modules.

**Fix:** Try-catch with graceful fallback.

---

### A3: DRY Indexer Patterns [IMPLEMENTED]

**Problem:** Duplicated indexing logic.

**Fix:** Extract common patterns to helper functions.

---

## Test Fixes (T1-T3)

### T1: graph-search.test.js [IMPLEMENTED]

**Problem:** No tests for graph search.

**Fix:** Add integration tests with real DB fixtures.

---

### T2: incremental-tracker.test.js [IMPLEMENTED]

**Problem:** Tests re-implemented logic instead of testing real modules.

**Fix:** Import real modules and test against them.

---

### T3: lock-ownership.test.js [IMPLEMENTED]

**Problem:** No tests for lock ownership verification.

**Fix:** Add tests for ownership patterns.

---

## Documentation Fixes (D1-D6)

### D1: Latency Claim Correction (H2) [IMPLEMENTED]

**Problem:** Documentation claimed "<5 seconds" for edit detection.

**Fix:**
- Queue polling: ~30 seconds (avg ~15s)
- Merkle check: ~45 seconds (avg ~22s)

---

### D2: Version String Consistency (M2) [IMPLEMENTED]

**Problem:** Mix of v2 vs v3 references.

**Fix:** Consistent v2.3 for indexer, v3 for index-maintainer.

---

### D3: Queue Interval Documentation (M3) [IMPLEMENTED]

**Problem:** Missing merkle check interval.

**Fix:** Document both intervals clearly:
- Queue polling: 30 seconds
- Merkle check: 45 seconds
- Startup delay: 7 seconds

---

### D4: SEARCH 200X vs 100x Branding (L1) [IMPLEMENTED]

**Problem:** Inconsistent branding.

**Fix:** Changed all references to "SEARCH 100x".

---

### D5: startupTimeout Cleanup (L2) [IMPLEMENTED]

**Problem:** Timeout reference not stored for cleanup.

**Fix:** Store reference and clear on shutdown.

---

### D6: Lock Pattern Documentation (M1) [IMPLEMENTED]

**Problem:** No documentation of ownership pattern.

**Fix:** Added security invariant comment:
```javascript
// SECURITY INVARIANT: All lock release functions MUST verify ownership before releasing.
// Pattern: read lock file → verify PID matches process.pid → then release
```

---

## False Positives (No Action Needed)

These issues were flagged in review but already working:

| Issue | Why No Action Needed |
|-------|---------------------|
| Stale index missing | `idx_entities_active` exists at line 823 in graph-extractor.js |
| N+1 queries in graph expansion | Already batched at lines 297-319 in graph-search.js |
| Hardcoded module paths | ESM relative imports are correct |
| ENOSPC in incremental-tracker | Already handled at lines 300-301 |

---

## Verification Commands

```bash
# Security
grep -A10 "function refreshLock" .claude/hooks/index-maintainer.mjs | grep -q "process.pid" && echo "OK"
grep -A15 "function releaseGlobalIndexLock" .claude/hooks/index-maintainer.mjs | grep -q "process.pid" && echo "OK"

# Error Handling
grep -q "circuitBreaker" .claude/helpers/search-100x/embedding-service.js && echo "OK"
grep -q "ENOSPC" .claude/hooks/index-maintainer.mjs && echo "OK"

# Performance
sqlite3 .agentdb/code-graph.db ".indexes entities" | grep -q "idx_entities_active" && echo "OK"

# Documentation
grep -q "30 seconds" CLAUDE.md && echo "OK"

# Tests
test -f .claude/helpers/search-100x/__tests__/lock-ownership.test.js && echo "OK"
```

---

## Related Documentation

- [SMART_SEARCH_INDEXING.md](../SMART_SEARCH_INDEXING.md) - Complete indexing specification
- [INDEX_MAINTAINER.md](./INDEX_MAINTAINER.md) - Daemon technical documentation
- [CACHE_STRATEGY.md](./CACHE_STRATEGY.md) - 4-tier cache hierarchy
