# Incremental Indexing — Operator Runbook

Companion to `docs/INCREMENTAL_INDEXING_PLAN.md`. This document is the
field manual for diagnosing and repairing the reconcile daemon, the
maintenance worker, and the per-tier artifacts under `.sweet-search/`.

If you're new to the system, read the plan's § 1 Executive Summary and
§ 6 Proposed Architecture first; the runbook assumes you already know
the names "Reconciler", "manifest", and "tombstone".

---

## 1. Health-check checklist (start here)

Run these in order:

1. **Manifest publish age.**
   ```bash
   stat -f%m .sweet-search/reconcile-manifest.json
   ```
   Compare against the current reconcile interval (default 60 s on tier=mid).
   If the manifest is more than `3 × interval` old, the daemon is stuck.

2. **Lockfile.**
   ```bash
   cat .sweet-search/index-maintainer.lock
   ```
   Check `pid` is alive (`ps -p <pid>`). A stale lock with a dead pid is
   automatically cleared on next daemon start; see `lockfile.mjs::acquireLock`.

3. **Worktree stamp.**
   ```bash
   cat .sweet-search/worktree-stamp.json
   ```
   If `projectRoot` differs from your current `pwd`, two worktrees are
   sharing the same `.sweet-search/`. Either move one to a fresh state
   dir or accept the lock contention (`verifyStamp` aborts daemon start
   in this case with a clear remediation message).

4. **Rebuild queue depth.**
   ```bash
   wc -l .sweet-search/rebuild-queue.jsonl
   ```
   Anything > 50 indicates the maintenance worker is starving — either it
   crashed, is throttled by `nice 10` under load, or watermarks fire
   faster than CPU can drain. Inspect the dead-letter:
   ```bash
   wc -l .sweet-search/rebuild-queue.dead-letter.jsonl
   ```

5. **WAL bloat.**
   ```bash
   ls -lh .sweet-search/code-graph.db-wal .sweet-search/codebase.db-wal
   ```
   Plan § 8.4: pass 256 MiB is a WARN; pass 1 GiB is an ERROR. Most
   likely culprit: a long-lived MCP server holding read transactions
   open between queries. See § 4 "MCP-side WAL bloat" below.

6. **Reader heartbeats.**
   ```bash
   ls .sweet-search/readers/
   ```
   Each file is `<pid>-<bootId>.json`. Stale heartbeats (pid no longer
   running) get swept after `READER_GRACE_MS=1h`; they do not block
   correctness.

---

## 2. Common failure modes

### 2.1 Stuck reconcile tick (manifest age > 5 minutes)

**Diagnose:** `tail -n 20 .sweet-search/logs/reconcile-*.log`. Look for
`tick already in progress` (re-entrance guard fired — a previous tick
never returned) or a parse failure on the dirty set.

**Fix:**
1. Send `SIGTERM` to the daemon pid in the lockfile.
2. Wait 30 s for graceful shutdown. If it doesn't terminate, `kill -9`.
3. On next start the daemon clears the stale lock automatically and
   enqueues a `crash_recovery` Float HNSW replacement (plan § 8.6).

### 2.2 Daemon crash-loops on startup

**Diagnose:** the most common cause is a `SQLITE_CONSTRAINT_NOTNULL`
violation from an older daemon writing through the v3 schema. Plan §
7.1.6 / § 7.2: every reconcile-owned column has a `DEFAULT` clause to
prevent this, but if a fork drops the default a rollback can lock the
daemon out.

**Fix:**
1. Inspect `.sweet-search/codebase.db` columns:
   ```bash
   sqlite3 .sweet-search/codebase.db "PRAGMA table_info(vectors)"
   ```
   The reconcile-v2 columns must show `dflt_value = ''` or `0`.
2. Re-apply the migration:
   ```bash
   node -e "
     import('better-sqlite3').then(({default: Database}) => {
       const db = new Database('.sweet-search/codebase.db');
       import('./core/incremental-indexing/infrastructure/schema-migrations.mjs').then((m) => {
         console.log(m.migrateVectorsSchema(db));
       });
     });
   "
   ```

### 2.3 Search returns rows from the wrong epoch

**Symptom:** structural / read-semantic returns a row whose code no
longer exists on disk, or misses a row that was just edited.

**Diagnose:**
1. Confirm the reader is pinning the latest manifest:
   ```bash
   jq .epoch .sweet-search/reconcile-manifest.json
   ```
2. Confirm the row's epoch lifecycle:
   ```bash
   sqlite3 .sweet-search/codebase.db \
     "SELECT id, epoch_written, epoch_retired FROM vectors WHERE id = '<id>'"
   ```

**Fix:** ensure the search path applies the predicate from
`manifest.epochVisibilityPredicate('v')` on every query. Plan § 8.1.1.

### 2.4 HNSW capacity exhaustion

**Symptom:** daemon log shows
`hnsw_capacity_used > 0.85` alerts, then `USearch reserve failed (out of memory)`.

**Fix:**
1. Free disk space first (the replacement needs `2 ×` the current graph
   size, plus a safety margin — see § 29.3).
2. Force an immediate clean replacement:
   ```bash
   echo '{"tier":"float_hnsw","reason":"manual","epoch":0}' \
     >> .sweet-search/rebuild-queue.jsonl
   ```
3. Restart the maintenance worker if it's not draining:
   ```bash
   pkill -f maintenance-worker.mjs
   # The daemon respawns the worker via child_process.spawn on next tick.
   ```

### 2.5 LI segment recompaction loop

**Symptom:** `last_maintenance: li_segment` appears repeatedly in the
staleness footer; the same segment file keeps being recompacted.

**Diagnose:** check the per-segment stale ratio is actually crossing the
watermark. The most common cause is a stale-bitmap file that was never
cleared after recompaction.

**Fix:** delete the orphan sidecar:
```bash
rm .sweet-search/codebase-late-interaction.db.segments/old-segment.bin.stale.bin
```
The next tick re-opens the bitmap fresh.

### 2.6 Sparse-gram delta directory grows unbounded

**Symptom:** `du -sh .sweet-search/codebase-sparse-grams.idx.deltas/`
exceeds 30 % of base artifact size.

**Fix:** force a compaction:
```bash
echo '{"tier":"sparse_gram","reason":"manual","epoch":0}' \
  >> .sweet-search/rebuild-queue.jsonl
```
The compactor reads the latest delta record per `fileId`, merges with
base postings for unchanged files, and emits a new base under `*.next`.
**Source files are not re-grammed** during compaction — the operation
is copy-only on postings.

---

## 3. Force-reset escape hatches

Use **only** after investigating the underlying cause; resetting hides
the root issue.

### 3.1 Drop dirty set, force full mtime sweep

```bash
sweet-search reconcile reset
```

Equivalent to: delete the in-memory dirty set, leave `merkle-state.json`
intact, schedule a full mtime sweep on the next tick.

### 3.2 Force a full reindex

```bash
npm run index
```

Takes the writer lock; daemon waits for current tick to commit, then
the full reindex runs to completion. Daemon resumes after.

### 3.3 Clear all reconcile state

```bash
# DESTRUCTIVE. Loses all incremental progress.
rm -rf .sweet-search/{reconcile-manifest.json,rebuild-queue*.jsonl,readers,worktree-stamp.json}
npm run index
```

---

## 4. MCP-side WAL bloat (the most common production pathology)

SQLite's WAL grows unboundedly when at least one reader is always
active. Plan § 8.4 makes this explicit: `wal_checkpoint(TRUNCATE)` is
**cooperative** — it cannot force a reader to release its snapshot.

**Diagnose:**
1. `ls -lh .sweet-search/code-graph.db-wal` — past 256 MiB triggers a
   WARN; past 1 GiB triggers an ERROR.
2. Plan § 27.2.1 lists the MCP-side contract:
   - never hold a read transaction across queries;
   - run `wal_checkpoint(PASSIVE)` every 100 queries or 60 s;
   - rotate the connection every hour or 10 000 queries.

**Fix:**
1. Verify your MCP server follows the contract above. If not, file the
   fix in the MCP integration guide.
2. Wait for the daemon's self-defense (plan § 27.2.1): after 10 minutes
   of sustained 1 GiB+ WAL, the daemon VACUUM-INTOs the database and
   renames the old DB family aside under `*.old.<epoch>`. The maintenance
   queue shows `db_swap_count` ticking up.
3. Manually trigger:
   ```bash
   sqlite3 .sweet-search/code-graph.db "PRAGMA wal_checkpoint(TRUNCATE)"
   ```
   Returns `(busy, log, frame)`. If `busy = 1`, a reader is holding the
   checkpoint back; identify with `lsof .sweet-search/code-graph.db`.

---

## 5. Held-out discipline & benchmarks

- **Never inspect held-out** per-query while iterating. Plan § 24.6 lays
  out the phase-by-phase A/B contract.
- **Always seed=42** for stratified splits.
- The tombstone sensitivity sweep
  (`scripts/incremental-indexing-tombstone-sensitivity.mjs`) runs on dev
  only and restores the index between points.

---

## 6. Telemetry locations

| Signal | Source |
|---|---|
| Per-tick metrics | `.sweet-search/reconcile-metrics.jsonl` |
| Per-tick logs | `.sweet-search/logs/reconcile-YYYY-MM-DD.log` |
| Rebuild queue | `.sweet-search/rebuild-queue.jsonl` |
| Dead letter | `.sweet-search/rebuild-queue.dead-letter.jsonl` |
| Manifest | `.sweet-search/reconcile-manifest.json` |
| Lockfile | `.sweet-search/index-maintainer.lock` |
| Reader heartbeats | `.sweet-search/readers/` |
| Worktree stamp | `.sweet-search/worktree-stamp.json` |

---

## 7. CLI reference (operator-facing)

Plan § 20.2 catalogues every command; the ones you'll reach for most:

```bash
sweet-search reconcile status         # epoch, dirty count, last 5 ticks
sweet-search reconcile tick           # force one tick synchronously
sweet-search reconcile inspect <path> # why this file is dirty
sweet-search reconcile pause          # pause the timer without killing
sweet-search reconcile resume
sweet-search reconcile reset          # drop dirty set, full sweep next tick
sweet-search rebuild status           # maintenance queue + dead-letter
sweet-search rebuild force <tier>     # schedule immediate maintenance
sweet-search rebuild dead-letter [--clear]
sweet-search index --add <path>       # hint a dirty file
sweet-search index --full             # full reindex (npm run index)
```

These commands are scaffolded in the application layer; Phase 6 lands
the CLI wiring against the v2 reconciler. The legacy daemon's commands
remain available while the v2 flag stays off.
