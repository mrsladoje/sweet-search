# Sweet Search Full-Index Pipeline: Correctness & Crash-Safety Review

Scope: facade + phases + build + ann + utils + artifact + pool + sparse-gram + li-skip-policy + ast-chunker. Incremental-tracker touched only where phases write progress. `index-maintainer.mjs` and `incremental-*` explicitly deferred.

Conventions: `path:line` citations are exact. "confidence" = my certainty in the finding after reading the code on 2026-04-14.

---

## 1. Crash-safety matrix

| Phase | Staging? | atomicSwap? | `.bak` cleanup on success? | Recover on rerun? | Evidence |
|---|---|---|---|---|---|
| Code Graph | Yes — `DB_PATHS.codeGraph + '.tmp'` | Yes | Yes, via `atomicSwapDatabase` | Yes — rerun overwrites `.tmp` (`fs.unlink` at start) | `indexer-build.js:129-194` |
| Vector DB (full rebuild) | Yes — `DB_PATHS.codebase + '.tmp'` | Yes | Yes | Yes — prior `.tmp` is unlinked at `:510-513` before new build | `indexer-build.js:507-535` |
| Vector DB (incremental) | **No staging** — writes directly to the live `codebase.db` inside a transaction | No | N/A | Partially — WAL rollback gives per-transaction atomicity, but a crash mid-delete+insert leaves the DB in a half-updated state (some removed rows already gone, new rows not yet written). See finding #4. | `indexer-build.js:544-593` |
| HNSW (full rebuild) | **No staging** — writes checkpoint, then `index.save()` writes over the live `.usearch/.idx` at `DB_PATHS.hnswIndex` | No (handled inside `HNSWIndex.save()`) | N/A (no `.bak` managed here) | Yes — checkpoint resume reads `.checkpoint` + `.json` sidecar, otherwise starts fresh | `indexer-ann.js:369-486` |
| HNSW (incremental) | No staging — mutates loaded index in place, then `.save()` | No | N/A | No — `incrementalUpdateHNSW` has no crash recovery; a half-applied add/remove session persists | `indexer-ann.js:235-328` |
| Late Interaction | Claims staging via `stagedLateInteractionPath = DB_PATHS.lateInteraction + '.tmp'`, atomicSwap called | Yes for the **stub file**, but NOT for the `.segments` directory | N/A for directory (not renamed) | Partial — see finding #1 (CRITICAL). On incremental rebuild the staged "segments" directory physically overlaps the live directory because the prior swap only renamed the stub. | `indexer-phases.js:283,486`, `late-interaction-index.js:560,1490,1565` |
| Binary HNSW + Int8 | **No staging** — `buildQuantizedArtifacts` writes directly to `DB_PATHS.binaryHnswIndex` plus sidecars (`.meta.json`, `.int8.json`, `.vectors.json`, `.graph.json`) | No | N/A | No — a crash mid-write leaves partial sidecars with mismatched file counts. Loaders fall back to float HNSW only if files are missing, not if they're torn. | `indexer-ann.js:836-903`, `artifact-builder.js:281+` |
| Sparse Gram | Yes — `DB_PATHS.sparseGramIndex + '.tmp'` with `unlinkIfExists` on failure | Yes | Yes via swap | Yes | `indexer-sparse-gram.js:76-98` |
| Vocab Warmup | Runs after swap; any failure is swallowed and non-fatal | N/A | N/A | N/A — stateless | `index-codebase-v21.js:418-425` |

Bottom line: Code Graph, Vector DB (full), Sparse Gram are robust. Vector DB (incremental), HNSW (incremental), Binary artifacts, and Late Interaction are all exposed to partial-write windows.

---

## 2. `atomicSwapDatabase()` review — `indexer-utils.js:139-190`

Walk-through of the happy path (retries omitted):

1. `unlink(bak)` — remove any leftover backup from a prior failed run (`:147`).
2. `rename(final, bak)` — only if `final` exists (`:152-156`).
3. `rename(tmp, final)` — make the new index live (`:158`).
4. `unlink(bak)` — remove old backup (`:161-167`).

Failure analysis:

- **Window between `rename(final, bak)` and `rename(tmp, final)`** — if the process is killed here, `final` does NOT exist and `bak` exists. On next run `atomicSwapDatabase` would run with a freshly-built `tmp`: step 1 unlinks `bak`, step 2 finds no `final` (good), step 3 installs the new one. The OLD data in `bak` is destroyed — but only because a new build is replacing it. `discoverFiles` and readers between the crash and the rerun would fail with "database not found". **Confidence: high.** The recovery branch at `:178-185` handles the synchronous exception case (still in the same JS process) but NOT the process-kill case.

- **POSIX guarantee**: both renames are within the same directory, so on ext4/APFS/HFS+/XFS each `rename` is atomic at the filesystem level. There's no "partial rename" on POSIX. The correctness claim holds for macOS + Linux.

- **Windows/SMB**: Windows `MoveFileEx` is atomic for single-file renames. SMB is not — a rename across the wire can be observed as delete+create, so a concurrent reader may briefly see neither file or two files. The retry loop catches `EBUSY` (`:172-176`) but does not catch the SMB partial window. **Confidence: medium** (I did not read the Windows-specific code paths — there may be separate handling elsewhere).

- **Restore path logic** (`:178-185`): restoration only runs when `existsSync(bak) && !existsSync(final)`. That's the right guard, but it's done AFTER a synchronous `throw err` path — so if the failure was in step 4 (`unlink(bak)`) the restore is wrongly attempted (both `bak` and `final` might exist depending on timing), and then another `throw err` destroys the outcome. The unlink failure at `:163-166` is handled early, but if a late `unlink(bak)` throws something other than ENOENT you can reach the restore block with `final` present → restore is skipped → `throw err` propagates. The new file is live, the old bak remains, and the caller sees an exception that implies failure. **Finding #7 — medium severity.**

- **No in-between crash invariant**: there is no point at which `atomicSwapDatabase` is atomic under process kill. On POSIX, between `rename(final, bak)` and `rename(tmp, final)`, the "final" path does not exist. Any concurrent reader during that window fails. The window is typically sub-millisecond but nonzero. For a single-writer single-reader system this is fine; if the daemon serves searches concurrently with re-indexing, you have a flake window. **Confidence: high.**

---

## 3. SQLite WAL + atomic swap interaction

`buildVectorIndex` (full rebuild branch, `indexer-build.js:507-535`) calls `configureJournalMode(db, tmpPath, sqliteFastMode)` which sets WAL mode (`indexer-utils.js:36-46`). This creates `{tmpPath}-wal` and `{tmpPath}-shm` sibling files.

Sequence at close:
1. `checkpointWal(db)` runs `wal_checkpoint(TRUNCATE)` (`indexer-build.js:526`, `indexer-utils.js:58-64`). This forces all pages from the WAL into the main file and truncates the WAL to zero bytes.
2. `closeWithOptimize(db, ...)` calls `db.pragma('optimize')` then `db.close()` (`indexer-build.js:21-29`). On close, better-sqlite3 finalizes statements and releases the handle; with zero frames in the WAL, SQLite deletes (or leaves zero-length) the `-wal` and `-shm` files.
3. `atomicSwapDatabase(tmpPath, DB_PATHS.codebase)` renames ONLY the main file. Any residual `-wal`/`-shm` sibling at `tmpPath-wal` would be orphaned.

Verified claim: `checkpointWal(db)` followed by `db.close()` leaves the main file with every committed page. On a crash BEFORE `checkpointWal`, pages live in `tmpPath-wal`; if the process dies after `atomicSwapDatabase` renames the main file but before the WAL is truncated, SQLite opening `DB_PATHS.codebase` looks for `DB_PATHS.codebase-wal` which doesn't exist — the WAL is stranded at `tmpPath-wal` and its un-checkpointed frames are lost. **But** since the swap happens AFTER `closeWithOptimize`, which happens AFTER `checkpointWal`, the ordering prevents this under normal termination. **Confidence: high — correct under normal exit.**

**Finding #8** (medium): There is no crash window where the main file is renamed but the WAL is not. The sequence `checkpointWal → close → atomicSwap` is safe. But in the **incremental** path (`indexer-build.js:544-593`), `checkpointWal(db)` runs (`:582`) and `closeWithOptimize` runs (`:588`), but there is no atomic swap — writes go directly to the live DB. During the per-transaction write, a kill leaves the WAL with un-checkpointed frames that SQLite will replay on next open. OK for SQLite's invariants, but the index is NOT logically consistent (some files deleted, others not yet re-embedded). **See finding #4.**

---

## 4. HNSW checkpoint/resume — `indexer-ann.js:369-486`

Walk-through:

- Checkpoint files: `{indexPath}.usearch.checkpoint` (raw USearch graph) + `{indexPath}.usearch.checkpoint.json` sidecar (metadata: `vectorsAdded`, `lastRowId`, `version`, `timestamp`).
- Resume is gated on `canCheckpoint = orderMode === 'sequential'` (`:367`).
- Write ordering (`:453-463`): `index.save(checkpointPath)` → `fsyncFile(checkpointPath)` → `writeCheckpointSidecar` → `fsyncFile(sidecarPath)` → `fsyncDirectory(dirname)`.

### 4a. Crash between `index.save()` and sidecar write

If killed between `index.index.save(checkpointPath)` and `writeCheckpointSidecar(sidecarPath, ...)`, a stale `.checkpoint` file exists on disk with no matching sidecar. On next run, `readCheckpointSidecar(sidecarPath)` returns `null` (`indexer-ann.js:41-46`), so `sidecar` is falsy, the `if (sidecar && existsSync(checkpointPath))` guard fails at `:379`, and the code initializes a fresh index. Good — this is the correct fallback. However, **finding #5 (medium)**: the stale orphan `.checkpoint` file is not cleaned up on the no-sidecar path. Only `cleanupCheckpoint()` at `:481` (success) and `:421` (non-sequential order) removes it. The next run, if it completes a partial HNSW but crashes before reaching `cleanupCheckpoint`, leaves yet another orphan. Over time, stale checkpoint files accumulate. **Confidence: high.**

### 4b. Resume metadata rebuild

Lines 392-404 rebuild `idMap`, `reverseMap`, `metadata`, `nextKey` by replaying SQLite rows `WHERE rowid <= resumeFromRowId ORDER BY rowid`. The code assumes vectors are inserted into HNSW in rowid order, which is true ONLY for `orderMode === 'sequential'` — and `canCheckpoint` gates on exactly that (`:367`). The resume path is only reachable when `canCheckpoint` is true, which is correct.

**But finding #6 (medium)**: the sidecar's `lastRowId` field is set from `row.rowid` (`:458`), which is the rowid of the MOST RECENTLY ADDED vector at checkpoint time. If the SQLite vectors table has `rowid` that is non-contiguous (e.g., after a `DELETE`, SQLite does not renumber existing rowids — only assigns new ones), the restored metadata count (`restoredKey`) equals the number of rows with `rowid <= resumeFromRowId`, which is NOT the same as `sidecar.vectorsAdded`. The code sets `index.nextKey = restoredKey` (`:404`) but later uses `added = sidecar?.vectorsAdded || 0` (`:426`), diverging from the actual key count. For a fresh full rebuild into `tmpPath` where rowids start at 1 and increment, they are contiguous — safe. For full-rebuild against the LIVE `DB_PATHS.codebase` (which `buildHNSWIndex` opens — see `:345`, it opens `dbPath`, which is `DB_PATHS.codebase`, the LIVE DB, after the vector swap), if any prior `DELETE FROM vectors` left gaps in rowid, the resume counting is wrong. The incremental vector path is the vector of this — it does `DELETE FROM vectors WHERE file_path = ?` in a transaction (`indexer-build.js:557`), leaving gaps. A full HNSW rebuild (`buildHNSWIndex`) after an incremental vector update will read a non-contiguous vector table, and if it crashes mid-build then resumes, the metadata will not match the on-disk HNSW graph: `nextKey` (restoredKey from SQL row count) diverges from `sidecar.vectorsAdded` (rows inserted into HNSW up to that rowid). **Confidence: medium — I did not run it, but reading the code makes the gap explicit.**

### 4c. `cleanupCheckpoint()` on error

`cleanupCheckpoint` is called after success (`:481`) and when `!canCheckpoint` (`:421`). It is NOT called in a `catch` or `finally` block. If `buildHNSWIndex` throws (e.g., `index.add()` raises), the checkpoint files remain. On the next run, if `canCheckpoint` is true, the stale checkpoint is loaded and the build attempts to resume from a possibly-corrupt point. The load itself is wrapped in try/catch at `:379-416` with "start fresh on load error", which provides some cover — but the `index.index.load(checkpointPath)` call can silently succeed on a torn file and produce wrong search results. **Finding #5 — medium severity.** Recommended fix: wrap the build loop in try/finally and call `cleanupCheckpoint()` in the catch path when the error is unrecoverable, or write a "build generation" marker that must match between checkpoint and vector DB.

---

## 5. Late Interaction staging — **CRITICAL correctness bug**

This is the most serious finding in the review. Located in `indexer-phases.js:283, 399-495` and `late-interaction-index.js:375-383, 556-572, 1441-1575, 1669`.

### 5a. The claim vs. reality

The code claims (`indexer-phases.js:573-575`, comment inside `indexer-ann.js`): "Isolate the write target BEFORE any add() calls can flush segments. Without this, _flushSegment() during add() writes into the live .segments directory, corrupting the served index on a failed rebuild."

This is precisely what it does — for the FIRST rebuild. After the first successful rebuild, the claim breaks because `atomicSwapDatabase` only renames the STUB file, not the segments directory. On every subsequent rebuild, the staged segments directory IS the live segments directory.

### 5b. Step-by-step proof

**First rebuild (fresh install)**:

1. `liIndex = new LateInteractionIndex({ indexPath: staged, loadExisting: false })`. `indexPath = .db.tmp`.
2. `add()` calls flush to `staged + '.segments'` = `.db.tmp.segments/`. Segments are written there.
3. `save()` writes the stub at `indexPath` = `.db.tmp`, containing `{"segmentDir": ".db.tmp.segments"}` (`late-interaction-index.js:1490, 1565`). `segDir` is absolute.
4. `atomicSwapDatabase(".db.tmp", ".db")` renames the stub only.
5. Result: live stub at `.db` references `.db.tmp.segments/` as its data directory.

**Second rebuild (incremental)**:

1. `liIndex = new LateInteractionIndex({ indexPath: loadFromPath = ".db", loadExisting: true })`. `indexPath = .db`.
2. `liIndex.init()` → `load()` → reads stub at `.db` → stub says `segmentDir: ".db.tmp.segments"` → `_loadSegmented(".db.tmp.segments")` loads segments. Sets `_loadedExisting = true`.
3. `resetForSave(stagedLateInteractionPath = ".db.tmp")`: sets `indexPath = ".db.tmp"`, clears `_segmentDir`, `_segments`, `_currentSegment`. DOES NOT reset `_loadedExisting`.
4. `add()` calls (during LI rebuild) → `_flushSegment()` → `_segmentDir === null` → sets `_segmentDir = indexPath + '.segments' = ".db.tmp.segments"`. **This is the SAME directory as the live segments.**
5. `_flushSegment()` writes a fresh segment-0000.bin into `.db.tmp.segments/` — **overwriting or colliding with the file the live stub currently points at.**
6. `save()` enters the second branch (`:1499-1509`), reads `.db.tmp.segments/`, deletes ALL files in it (`fs.unlink` in a loop at `:1505-1508`), then writes fresh segments. **The delete step wipes live data mid-save.**

At this point, the live `.db` stub is still pointing at `.db.tmp.segments/`, which now contains a partial new write. Any concurrent search crashes or returns wrong results. If `buildLateInteractionIndex` throws between the delete loop and the final write, `invalidateLateInteractionIndex()` is called (`indexer-phases.js:491`), which unlinks only the live `.db` stub. The orphaned segments directory (now half-written) remains.

### 5c. Why the test suite didn't catch this

The failure mode only triggers on the second rebuild, after a successful first rebuild promotes the stub. Most unit tests either start from a clean slate or use in-memory fixtures. Any test that calls `atomicSwapDatabase` on the stub twice would reproduce it.

### 5d. Severity

**CRITICAL.** The bug means there is no safe incremental LI rebuild today: every incremental run wipes the live segment files inside `add()` → `_flushSegment()`, and the "atomic" swap at the end is a no-op for the segment data. If the run crashes mid-rebuild, the served LI index is corrupted. The fact that users haven't reported this suggests either: (a) `add()` rarely flushes mid-build because most users have indexes under the segment threshold (`_segmentSize` default 10k docs — sweet-search's own index has 2-3k chunks); (b) when the segment threshold is not crossed, save() takes the legacy branch (`:1577+`) which writes a single file and the per-save delete step is gated by `useSegmented`. **Confidence: high for the mechanism; medium for real-world exposure** depending on segment threshold vs. codebase size.

### 5e. `invalidateLateInteractionIndex` policy

`invalidateLateInteractionIndex()` at `indexer-phases.js:43-46` unlinks `DB_PATHS.lateInteraction` and its `.bak`. On LI rebuild failure, this deletes the live stub — but NOT the segments directory. So after invalidation you have an orphaned segments directory on disk and no stub, which is the "missing index" signal. The policy of "delete stale-but-working index on LI failure" is questionable: a working stale index is often more valuable than no index. Downstream search should fall back to HNSW anyway, but dropping known-good data to avoid returning stale results is a judgment call. **I'd argue this policy is wrong** — leave the previous-good segments alone and only invalidate on schema/model mismatch. **Confidence: medium (policy question, not a correctness bug).**

### 5f. `resetForSave` does not isolate from this bug

`resetForSave` at `late-interaction-index.js:375-383` clears `_segmentDir`, `_segments`, `_currentSegment`. It does NOT clear `this.documents` — which still holds the loaded existing data. That's intentional (the rebuild needs to merge). But because `_segmentDir` is derived lazily from `this.indexPath + '.segments'`, and because the live stub's `segmentDir` happens to equal the staged path's `segmentDir`, the isolation is fictional. **The fix** is for `atomicSwapDatabase` to rename the segments directory alongside the stub, OR for the stub to use a content-addressed subdirectory name (e.g., `segments-<timestamp>/`) so staged and live never collide.

---

## 6. Summary preservation — `indexer-phases.js:179-200`, `summary-manager.js:35-68`

Flow:

1. `summaryBackup = await backupSummaries(DB_PATHS.codeGraph)` — reads all summaries from the LIVE code-graph DB into memory (`summary-manager.js:47-51`). The result is a JS object in memory; nothing is written to disk.
2. `buildCodeGraph(allFiles, dryRun)` — full rebuild into `tmpPath`, then atomic swap (`indexer-build.js:194`).
3. `restoreSummaries(DB_PATHS.codeGraph, summaryBackup)` — writes summaries back into the newly-swapped DB.

**Finding #3 (high severity).** If the process is killed between step 1 and step 3, the in-memory backup is gone and the new DB at `DB_PATHS.codeGraph` has no summaries. Specifically:

- **Kill during `buildCodeGraph`**: the swap hasn't happened; the old DB with its summaries still exists. Next run re-backs them up. **Safe.**
- **Kill between swap and restore**: the new DB is live with zero summaries; the old DB is gone (the swap cleaned up `.bak` on success); the in-memory backup is lost. Next run reads the empty new DB, backs up zero summaries, rebuilds, restores zero. **Summaries permanently lost.** (`indexer-build.js:161-167` unlinks `.bak` immediately after the swap, leaving no filesystem copy of the old summaries.)

The HCGS regeneration at `indexer-phases.js:230-246` is what re-populates summaries, but it runs in parallel with vectors+HNSW and not in the code-graph phase. And it only generates summaries for entities "marked for regeneration" — after `restoreSummaries` does NOT run, nothing is marked, so the regen phase regenerates nothing. Total loss.

**Fix**: persist the backup to a temp file (`code-graph.db.summary-backup.json`) before `buildCodeGraph`, restore from it if present, delete only after `restoreSummaries` succeeds. **Confidence: high.**

---

## 7. Input validation

- `discoverFiles()` at `indexer-utils.js:480-536` uses `fast-glob` with `cwd: projectRoot, absolute: false, onlyFiles: true`. Results are all project-relative and confined to `projectRoot`. fast-glob resolves symlinks by default but will not return results outside `cwd` (it rejects `..`-escaping globs).
- `readFilesFromStdin()` at `:212-279` strips WSL UNC prefixes (`stripWslUncPrefix`), then:
  - If path is absolute, checks `line.startsWith(PROJECT_ROOT)` (`:244`) — rejects everything outside. This is a **string-prefix check, not a path check**, which is subtly wrong: `/proj` matches `/projectile` as a prefix. **Finding #9 (low).** Should use `path.relative` and check for leading `..`. **Confidence: high.**
  - Does NOT canonicalize symlinks. A symlink from inside `PROJECT_ROOT` to `/etc/passwd` would pass the prefix check because the LINK is inside the project. `fs.realpath` would catch it, but isn't called. For an indexer this is low-impact — the worst case is embedding a sensitive file's contents — but flag it.
- `buildCodeGraph` at `indexer-build.js:155` reads files with `path.join(PROJECT_ROOT, files[i])` — trusts the input. If `files[i]` contains `../`, `path.join` normalizes and may escape the root. **Finding #9b (low).** Guard with `path.relative(PROJECT_ROOT, resolved).startsWith('..')` rejection.

No critical path-traversal risks in the indexing pipeline itself because the file list comes from fast-glob or a cwd-relative stdin with a prefix guard; the weaknesses are defense-in-depth.

---

## 8. Race conditions — `buildVectorsAndArtifactsPhase` Promise.all

The parallel execution at `indexer-phases.js:428-434` runs `vectorPromise` and `liPromise` concurrently. Shared inputs:

- `preChunked.allChunks` — both read this array. `buildVectorIndex` iterates via `chunkFiles` (already done) and the local `texts` array. `buildLateInteractionIndex` iterates chunks to build batches. Neither mutates the array. **Safe.** Confidence: high.
- `DB_PATHS.codebase` — vector phase writes (full rebuild uses `tmp`, incremental writes live). LI phase never reads or writes `codebase.db`. **No conflict.**
- `DB_PATHS.lateInteraction.tmp` — LI phase owns this. Vector phase doesn't touch it. **Safe.**
- HCGS promise — `generateAllSummaries` opens `DB_PATHS.codeGraph` for read/write. This races with the code-graph build? No — `hcgsPromise` is started AFTER `buildCodeGraph` completes and the swap has happened (`indexer-phases.js:195-246`), so the code graph is already stable. **Safe.**

**Finding #10 (medium)**: `buildHNSWIndex` (`indexer-ann.js:334+`) runs SEQUENTIALLY after `Promise.all([hcgs, vector, li])` resolves (`indexer-phases.js:452-469`). It opens `DB_PATHS.codebase` readonly and streams vectors. By this point `vectorPromise` has already resolved → DB is closed. **Safe.** But: `incrementalUpdateHNSW` at `:460` opens the same DB while the LI phase may still be running if the sequential fallback path is taken (`:473-482`). Actually — looking more carefully, the HNSW block at `:452-469` is INSIDE the try after Promise.all, and the LI sequential fallback at `:473-482` comes after. So HNSW runs between parallel LI and sequential LI. If the LI phase is in the `liPromise` parallel mode (normal path), it has already completed by `:452`. If in sequential fallback, HNSW runs BEFORE the sequential LI — still OK. **No race.** Confidence: high.

---

## 9. `chunkFiles()` and chunk ID collisions — `indexer-build.js:384-440`

IDs are generated as `${file}:${lineStart}-${lineEnd}:${chunkIndex}` (`:405`).

- Two chunks in the same file with identical line ranges but different symbols: `chunkIndex` increments per chunk within a file, so `chunkIndex` differentiates them. **Safe.** The ID is not (file, symbol) but (file, lineRange, index), so collisions are impossible for two distinct chunks from the same `parseFile` call. Confidence: high.
- `:` in file paths: Windows absolute paths with drive letters (`C:/foo/bar.ts`) are normalized to POSIX earlier, but the drive-letter colon may remain. An ID like `C:/foo:1-10:0` is unambiguous because the parser is lenient (the ID is opaque to the SQLite layer — it's just a TEXT PRIMARY KEY). It only matters if code ever splits the ID on `:` to recover the file. I searched for `id.split(':')` and found `indexer-ann.js:585`: `const docFile = doc.metadata?.file || id.split(':')[0];`. On `C:/foo:...`, this returns `C`, not `C:/foo`. **Finding #11 (medium).** For Windows paths the LI removal-by-file path is broken. `metadata?.file` is the primary lookup, and it's usually populated, so the split-fallback is rarely hit. **Confidence: medium** — I did not run it on Windows.
- Path separators: `file` is stored as the fast-glob result, which uses forward slashes on POSIX but may use backslashes on Windows. `chunkFiles` does not normalize. IDs from Windows would contain `\` but `li-skip-policy.js:35-37` normalizes to `/`. Inconsistent normalization between ID generation and policy lookup is a latent bug but not triggered in the reviewed path. **Confidence: low.**

---

## 10. `applyLiSkipPolicy` — `li-skip-policy.js:148-207`

The per-file token budget is applied at the FILE level, not the chunk level. Two passes:

1. First pass (`:162-174`): classify each file by (excluded | generated | null) based on the FIRST chunk seen for that file. Caches the decision in `fileFirstReason`.
2. Token-total pass (`:177-184`): for files NOT already classified as skip, sum the estimated tokens across all chunks belonging to that file.
3. Budget gate (`:185-187`): any file whose total exceeds `maxFileTokens` is classified as `'huge'`.
4. Second filter pass (`:193-202`): every chunk from a skipped file is dropped; every chunk from a non-skipped file is kept.

**Per-file decision is applied uniformly to all chunks.** There is no partial-file state. **Safe.** Confidence: high.

One edge: the "generated" check runs on the FIRST chunk only (`:166-172`). If the first chunk is a small leading shebang and the generated marker is in the second chunk's header, generated detection misses. This is **finding #12 (low)** — minor; markers are supposed to be at the file top, but cAST chunking can split the top into multiple chunks.

---

## 11. Error-handling holes

Silent-swallow patterns in the reviewed files:

| Location | Pattern | Verdict |
|---|---|---|
| `indexer-build.js:414-416` | Parse errors during `chunkFiles` — `"Skip files that can't be parsed"` | **Problem.** A file that fails to parse is silently dropped from the vector index. Users will see no search results for that file with zero diagnostic. Should log at minimum. `err.message` is not even logged. **Finding #13 (medium).** |
| `indexer-build.js:427-429` | Chunk enrichment failure | Logged with `⚠`. OK. |
| `indexer-build.js:132-135` | Unlink stale `.tmp` at start of code graph build | OK — ENOENT expected. |
| `indexer-build.js:509-513` | Same for vectors | OK. |
| `indexer-phases.js:225-227` | `markForRegeneration` failure | Logged. OK. |
| `indexer-phases.js:240-244` | HCGS generation failure | Logged + user hint. OK. |
| `indexer-phases.js:386-388` | Native model pre-warm failure | Logged. OK. |
| `indexer-phases.js:548-551` | `updateIncrementalStatePhase` hash compute per file — `catch (e) { /* skip */ }` | **Problem.** A file that can't be read for hashing is silently excluded from the merkle state. The next run sees it as "missing from state → new → needs reindexing", but if the read failure is permanent (permissions), it will keep being "new" and keep being tried forever. Not corrupting, but wasteful. **Finding #14 (low).** |
| `indexer-ann.js:45` | `readCheckpointSidecar` returns `null` on JSON parse error | OK — caller treats null as "no checkpoint". |
| `indexer-ann.js:51-52` | `cleanupCheckpoint` noop on unlink failure | OK — best effort. |
| `indexer-ann.js:676-679` | hybrid probe failure silent | OK — documented fallback. |
| `indexer-ann.js:897-903` | Quantized artifact build failure — logged, caller continues with `{binaryHnsw: null, int8: null, error}` | **Problem.** The error message is logged, but `updateArtifactState` is NOT called. `accumulatedChanges` does not get incremented on failure. Next run may skip the rebuild because "only N files changed" even though the previous rebuild failed entirely. **Finding #15 (medium).** |
| `indexer-utils.js:514-516` | `fs.stat` in discoverFiles — `"File disappeared between glob and stat"` | OK, but silent. A single log line ("Skipped N files that disappeared") would be helpful. Minor. |

---

## 12. Top 10 correctness issues (ranked)

| # | Severity | File:line | Summary | Scenario | Fix |
|---|---|---|---|---|---|
| 1 | **CRITICAL** | `indexer-phases.js:486`; `late-interaction-index.js:375-383,1490,1565,1669` | LI incremental rebuild writes to live segments directory in place | Second (or later) LI rebuild has `.segments` resolve to the live path because `atomicSwapDatabase` only renames the stub, not the directory. `_flushSegment` and the delete-all-segments loop in `save()` clobber the served index mid-rebuild. Crash here leaves corrupted segments. | Either (a) `atomicSwapDatabase` also renames the segments directory, OR (b) the stub stores a stable relative name like `segmentDir: '<basename>.segments'` resolved against `path.dirname(indexPath)`, OR (c) use content-addressed `segments-<uuid>/` subdirs and write an old-dir cleanup step AFTER the stub swap. Confidence: high. |
| 2 | **HIGH** | `indexer-phases.js:179-200`; `summary-manager.js:35-68` | Summary backup is in-memory only; crash between backup and restore loses all summaries | Process killed between `backupSummaries` (memory) and `restoreSummaries` after `buildCodeGraph` swapped the new DB live. The old `.bak` has already been unlinked, so the old summaries are gone. Next run finds an empty new DB, backs up nothing, rebuilds, restores nothing. | Persist backup to `.sweet-search/summary-backup.json` before `buildCodeGraph`; restore from disk if present on startup; delete only after restoreSummaries succeeds. Confidence: high. |
| 3 | **HIGH** | `indexer-build.js:544-593` | Incremental vector rebuild is not staged — crash mid-DELETE+INSERT leaves a torn index | `incremental-tracker` says file X was reindexed (hash updated after the phase), but the actual SQLite transaction is scoped to the delete-and-insert. A kill between deleteMany() and the pipelinedEmbedAndInsert flush leaves the live DB without X's old vectors and without its new ones. HNSW is rebuilt from this torn state and metadata diverges. | Stage incremental builds into a tmp DB: copy live, apply changes, swap. OR: wrap the entire delete+insert cycle in one SQLite transaction (currently each insertBatch is its own transaction). Confidence: high. |
| 4 | **HIGH** | `indexer-ann.js:369-486`, esp. 389-404, 426 | HNSW resume metadata replay assumes contiguous rowids | `buildHNSWIndex` opens `DB_PATHS.codebase` (the LIVE DB after incremental deletes left rowid gaps). Checkpoint resume does `WHERE rowid <= resumeFromRowId` and counts rows to populate `nextKey`, but `sidecar.vectorsAdded` is set from the USearch `added` counter, which diverges whenever rowid gaps exist. After resume, HNSW keys collide or are off-by-one. Search returns wrong IDs. | Write a "rowid → hnsw_key" mapping into the sidecar, or refuse to resume when the vector table has gaps (detect via `SELECT COUNT(*), MAX(rowid)`). Confidence: medium-high. |
| 5 | **HIGH** | `indexer-ann.js:366-486` | `cleanupCheckpoint` not called in error path | Any throw from `index.add()` leaves stale `.checkpoint` + `.json` sidecar on disk. Next run loads the stale checkpoint and may silently resume against a vector DB that has changed underneath it (e.g., after incremental update). Result: mixed keys, wrong search results. | `try { ... } catch (err) { cleanupCheckpoint(usearchPath); throw err; }` wrapping the build loop. Also bump a "checkpoint generation" counter tied to the vector DB mtime/hash so stale checkpoints are rejected on resume. Confidence: high. |
| 6 | **MEDIUM** | `indexer-ann.js:836-903`; `artifact-builder.js:281+` | Binary HNSW + Int8 sidecar writes are not atomic across files | `buildFromCodebaseDb` writes multiple sidecars (`.meta.json`, `.int8.json`, `.vectors.json`, `.graph.json`) plus the main `.idx`. A crash after some but not all writes leaves mismatched file counts. Loaders check existence, not consistency. | Stage all artifacts under `.binary-hnsw.idx.tmp/` directory, then rename atomically (or write a manifest last that declares the artifact "ready"). Confidence: high. |
| 7 | **MEDIUM** | `indexer-utils.js:139-190` | `atomicSwapDatabase` restore-from-bak logic has a double-throw window | If a late error occurs after step 3 succeeds (e.g., `unlink(bak)` fails with EACCES), the restore branch at `:178-185` finds `final` present and skips restore, then rethrows. Caller sees a failure even though the swap actually succeeded. Some callers cascade into `invalidateLateInteractionIndex` or similar. Confidence: high. | Distinguish "pre-swap failure" from "post-swap cleanup failure"; only rethrow errors that mean the swap did NOT happen. |
| 8 | **MEDIUM** | `indexer-build.js:414-416` | Parse errors silently drop files from vector index | A syntax error in a user file → `chunker.parseFile` throws → chunk loop catches, skips, no log. User files don't appear in search. No diagnostics. | Log `⚠ ${file}: ${err.message}`. Keep a counter. Report at end of phase. Confidence: high. |
| 9 | **MEDIUM** | `indexer-ann.js:585` | `doc.metadata?.file || id.split(':')[0]` breaks on Windows paths containing `:` | LI file-removal path uses the ID split fallback when metadata lacks `file`. On Windows (`C:/src/foo.ts:1-10:0`), split returns `C`, not `C:/src/foo.ts`. Removal matches nothing → stale entries retained. | Always populate `metadata.file` (it already is in `indexer-build.js`), and make the fallback throw instead of quietly returning a bogus path. Confidence: medium. |
| 10 | **MEDIUM** | `indexer-ann.js:897-903` | Artifact build failure doesn't update state — next run may skip rebuild | `buildQuantizedArtifactsPhase` catches failure, logs, returns `{error}`. `updateArtifactState({rebuilt: true})` at `:884` is only called on success. `accumulatedChanges` stays at 0, so the threshold skip may fire next run ("only N files changed") even though the artifacts are actually missing/broken. | On failure, call `updateArtifactState({rebuilt: false, changedFiles})` so accumulation continues. Also write a "failed_attempts" counter and force-rebuild after K failures. Confidence: high. |

---

## Appendix: items ruled out

- Finding #7 (`atomicSwapDatabase` late-unlink) is listed in top-10 as #7.
- `ast-chunker.js` chunk content hashing (`createHash('sha256').update(content).digest('hex').slice(0, 16)`) is 64-bit truncated SHA256, ~1 in 2^32 birthday collision probability for a 65k-chunk index. Not a correctness issue at realistic scale.
- `getGitIgnoredPathSet` batching (`indexer-utils.js:379-435`) handles symlink fatals and per-batch failures correctly. All-batches-fail returns null and callers preserve all files. Correct.
- `Promise.all` in `buildVectorsAndArtifactsPhase` does not leak promise rejections — both `vectorPromise` and `liPromise` are wrapped in `.then(ok=>..., err=>...)` before being passed to Promise.all. No unhandled rejection risk.
- `indexer-pool.js` `EmbeddingPool` / `LateInteractionPool` worker-exit handling restarts workers up to 2 times; after exhaustion it sets `this.workers[index] = null` and later calls fall through to `_inlineFallback`. Correct lifecycle.

Word count: ~2450.
