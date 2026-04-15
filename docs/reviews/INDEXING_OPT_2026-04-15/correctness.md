# Sweet Search — Indexing Optimization Fix-Pack Correctness Review

**Date**: 2026-04-15
**HEAD**: `34089b2 fix(indexing): LI staged-save aliasing + 10 more swarm-review fixes`
**Scope**: independent verification of the 11 fixes claimed against `docs/reviews/INDEXING_REVIEW_2026-04-14.md`, plus hunt for new defects.
**Method**: read-only file traces of staged-save round trip, atomic-swap rollback, SHA256 verification cache, summary backup recovery, and the new helpers introduced by the commit. Counts cross-checked with grep on `core/indexing/**` and `core/ranking/late-interaction-index.js`.
**Out of scope**: incremental indexing in all forms. H3 deferred per instructions.

---

## 1. Verdict on each prior-review item

| Prior item | Verdict | Notes |
|---|---|---|
| **C1** LI staged-save aliasing | safe — new HIGH bug **N1** | Self-heal is excellent; rollback path inside the new helper is broken. |
| **C2** undefined `buildAndSaveFloatStore` | safe | Only `buildAndSaveFloatStoreFromDb` exists; both sites pass `(db, dim, path)`; `updateArtifacts` wraps a try/finally. Grep finds zero stale references. |
| **H1** embedding→indexing DDD | safe | Slot in `embedding-local-model.js:368-377`; owner in `indexer-pool.js:723-741`; consumed via the embedding barrel. **Latent TOCTOU** — see N2. |
| **H2** persisted summary backup | safe for documented scenarios | Atomic `.tmp + rename` write; orphan recovery when live DB has 0 summaries works. **Partial-restore edge** — see N5. |
| **H6** SHA256 verification cache | safe but doc oversells | Two-layer (in-process Map + on-disk sidecar); invalidated on rename and stat mismatch; partial sidecar writes degrade to a fresh hash. **Trust-model weaker than claimed** — see N3. |
| **M2** `PROJECT_ROOT` not `cwd` | safe | Both `artifact-builder.js:68,88` reads use `path.resolve(PROJECT_ROOT, ...)`. |
| **M3** dynamic imports counted | safe, at cap | `check-boundaries.js:135-153` now sums `from` + `import()`. Independent grep: 2 static + 4 dynamic = 6 (cap = 6). **Zero headroom** — see Q2. |
| **M5** HNSW try/finally | safe | `buildCompleted=true` set AFTER `await index.save()` (lines 494-495); on save() throw the finally branch runs `cleanupCheckpoint`. DB closes in either path. |
| **L1** li-skip-policy import | safe | `li-skip-policy.js:31` uses the config barrel. |
| **L2/L3** indexing barrel exports | structurally safe; untested | `indexing/index.js:58-79` adds explicit named exports. Internal helpers in `indexer-phases.js` are module-private — `export *` can't leak them. **`barrel-contracts.test.js` not updated** — Q3. |
| **L4** env var precedence | soft fix | Comment added at `indexer-ann.js:158-168`; two read sites still exist. |
| **L8** Windows-safe LI id split | safe | `/:\d+-\d+:\d+$/` is right-anchored, handles `C:\foo:10-20:0` correctly. |
| **H4** segments dir leak on cleanup | safe | `cleanupStagedLateInteractionIndex` now `rm`'s the staged segments dir recursively. |

**Score**: 11/11 attempted; 9/11 cleanly resolved; 2/11 with latent issues (H6 doc, C1 helper rollback).

---

## 2. New defects

### N1 — HIGH — `atomicSwapLateInteractionIndex` rollback wrong when stub swap fails after segments-dir rename

**File**: `core/indexing/indexer-phases.js:87-120`

```
102    try {
103      if (existsSync(stagedSegDir)) {
104        await fs.rename(stagedSegDir, finalSegDir);
105      }
106      await atomicSwapDatabase(stagedStubPath, finalStubPath);
107    } catch (err) {
108      if (hadOriginalSeg && existsSync(bakSegDir) && !existsSync(finalSegDir)) {
109        try { await fs.rename(bakSegDir, finalSegDir); } catch (_e) { /* best effort */ }
110      }
111      throw err;
112    }
```

**Failing trace**:
1. Pre-try line 98: `finalSegDir → bakSegDir` succeeds, `hadOriginalSeg=true`.
2. Line 104: `stagedSegDir → finalSegDir` succeeds. `finalSegDir` now contains NEW segments.
3. Line 106: `atomicSwapDatabase` throws (Windows EBUSY after retries, OOM, kill).
4. Catch at 108: `hadOriginalSeg=true` ✓, `existsSync(bakSegDir)=true` ✓, **`existsSync(finalSegDir)=true`** (renamed at line 104). Predicate FALSE. **Rollback does NOT execute.**

**Torn state**: OLD stub at `finalStubPath`; NEW segments in `finalSegDir`; ORIGINAL segments in `bakSegDir`. The OLD stub's basename resolves to `finalSegDir` → loaders read NEW manifest (different `totalDocuments`) against OLD stub. **Silent data inconsistency** — no version check between stub and manifest catches it.

**Repro**: build live N=5, build staged M=10 via `resetForSave + add + save`, monkey-patch `atomicSwapDatabase` to throw or kill between lines 104-106. Inspect `live.db.segments/manifest.json` (10) vs `live.db` (old stub).

**Fix direction**: swap the stub FIRST (POSIX-atomic), then rename the segments directory. A failure mid-segments-rename leaves the new stub pointing at a missing dir, which the existing self-heal at `late-interaction-index.js:1779-1793` migrates from `bakSegDir` (after extending the heal to look there). Alternatively, on catch with `existsSync(finalSegDir)`, rename out (`finalSegDir + '.failed-swap'`) then restore from `bakSegDir`.

**Why HIGH**: same severity class as the C1 bug it was meant to replace — silent data inconsistency, realistic triggers (Windows/SMB EBUSY, OOM, kill), zero test coverage of the helper means CI cannot catch it.

---

### N2 — MEDIUM — `initEmbeddingPool` TOCTOU race can leak a pool

**File**: `core/indexing/indexer-pool.js:723-730`

```
723  export async function initEmbeddingPool(options = {}) {
724    const existing = _getEmbeddingPoolSlot();
725    if (existing) return existing;
726    const pool = new EmbeddingPool(options);
727    await pool.init();
728    _setEmbeddingPoolSlot(pool);
729    return pool;
730  }
```

Two concurrent callers both see `existing=null`, both construct pools, both await `pool.init()`. First setter wins, second setter overwrites — first pool's workers are leaked.

Production impact is currently zero (one call site at `indexer-phases.js:421`), but the function is exported via the indexing barrel and documented "idempotent". Compare `getNativeEmbeddingModel` (`native-inference.js:140-182`) which correctly memoizes the in-flight load promise. Same pattern needed here.

**Fix**: stash the in-flight promise in a module-level `_initPromise` and return it for concurrent callers before the slot is populated.

---

### N3 — MEDIUM — H6 cache documentation overstates its guarantee

**File**: `core/infrastructure/model-fetcher.js:53-56, 100-127`

The block comment claims to "preserve INIT_STRATEGY.md's guarantee that 'all artifacts are verified with SHA256 checksums'". Implementation defines "unchanged" as `(stat.size === diskRecord.size) && (stat.mtimeMs === diskRecord.mtimeMs)`. This is a stat-MAC, not a fresh SHA256.

**Attack**: an attacker with file-write access replaces the file with same-size content, then `touch -t` to restore mtime. Sidecar untouched. `isVerified` returns true. Malicious file loaded without re-hashing.

The attack window is narrow (an attacker with file-write access can replace any binary anyway), but the comment is too strong. The cache trades a fraction of the SHA256 guarantee for ~100x speedup — the trade is reasonable, the documentation isn't.

Cross-filesystem mtime granularity is also a soft concern: `rsync` between APFS hosts preserves nanoseconds; copies through HFS+/FAT32/older NFS truncate to seconds. After such a copy the cache invalidates harmlessly (re-hashes), but the user sees a slow first run.

**Fix**: rephrase comment as "memoizes a previously-verified file as long as `(size, mtime)` is unchanged"; optionally include `(dev, inode)` in the key.

---

### N4 — MEDIUM — `atomicSwapLateInteractionIndex` doesn't retry on Windows EBUSY

**File**: `core/indexing/indexer-phases.js:87-120`

`atomicSwapDatabase` (`indexer-utils.js:144-176`) has 5-attempt EBUSY retry. The new helper wraps it for the stub but does its own raw `fs.rename` for the segments dir at lines 98 and 104 — no retry. On Windows / SMB / WSL, a concurrent reader holding a handle inside `live.db.segments/*.bin` blocks the directory rename. Combined with N1's broken catch path, this produces a torn state.

**Fix**: extract the retry loop into a helper and apply it to both renames; also handle EPERM (NTFS).

---

### N5 — MEDIUM — H2 disk backup overwritten when live DB has a partial restore

**File**: `core/graph/summary-manager.js:162-188`

The orphan-recovery branch (line 162) only fires when `summaries.length === 0`.

**Scenario**:
1. Run #1 backs up 100 summaries to disk. `restoreSummaries` commits 80 (20 entities removed in new schema). Process crashes after commit but before unlink.
2. Run #2: live DB has 80 summaries. `orphan.count=100`. Line 162 check fails (80 ≠ 0). Falls to live path. **`writeDiskBackup` overwrites the 100-summary orphan with the 80-summary backup.** The 20 unrestorable summaries are gone from the recovery surface forever.

The lost 20 entities are gone from the schema anyway — but if the user reverts the offending code change before re-running, they would exist again, and the summaries are unrecoverable.

**Fix**: merge the orphan into the new backup (union by id), or keep the orphan as an additive sidecar.

---

### N6 — LOW — `cleanupStagedLateInteractionIndex` doesn't remove `bakSegDir`

**File**: `core/indexing/indexer-phases.js:60-66`. The helper removes `stagedPath`, `stagedPath + '.bak'`, and `stagedLateInteractionSegmentDir(stagedPath)`. It does NOT remove `DB_PATHS.lateInteraction + '.segments.bak'`, which `atomicSwapLateInteractionIndex` creates at line 98. Each failed swap leaks hundreds of MB of stale segments. **Fix**: extend the helper to take both staged and final paths.

### N7 — LOW — `.tmp.segments` cleanup racy with stale concurrent processes

**File**: `core/indexing/indexer-phases.js:117-119`. The unconditional `rmDirIfExists(finalStubPath + '.tmp.segments')` is a no-op for new code (which uses `.tmp-stage.segments`) but deletes the in-progress staging of any pre-fix process running in parallel. Cross-process indexing is not formally supported, but window is real during the migration. **Fix**: gate on mtime > N seconds, or drop the cleanup once users have upgraded.

### N8 — LOW — `readDiskBackup` doesn't check a version field

**File**: `core/graph/summary-manager.js:83-103`. Only checks `Array.isArray(parsed.summaries)`. A future v2 with a different `summaries` shape would deserialize incorrectly. **Fix**: add `if (parsed.version !== 1) return null;` (the writer already sets `version: 1`).

---

## 3. Well-done fixes

**Self-heal in `late-interaction-index.js:1718-1793`** — the two-pass migration is genuinely elegant. First pass catches the documented `.tmp.segments` absolute-path state; second pass catches the missing-canonical-dir + orphan case. Both guard with `existsSync(canonicalSegDir)` before stub rewrite. Both use `writeStubAtomic` (1745-1754) which writes to `.selfheal.tmp` and renames, so a crash mid-heal can't leave a truncated stub. `maybeMigrate` (1726-1741) tolerates ENOENT/EEXIST/ENOTEMPTY/EPERM but does NOT swallow other errors. Race-safe across concurrent loaders via POSIX `fs.rename` atomicity. Only the first-pass case has a test (`tests/indexing/li-staged-save.test.js:144-191`); the second pass deserves coverage.

**C2 try/finally around secondary DB open** (`artifact-builder.js:751-760`) — the right pattern: open, apply pragmas, work in try/finally, close in finally. The previous undefined-symbol bug was masked by an outer try/catch that deleted the float store; that masking remains, but the error path is now reached only on REAL errors instead of every `updateArtifacts` invocation.

**Pre-warm SHA256 cache layering** (`model-fetcher.js`, `indexer-phases.js:448-462`) — the in-process Map handles repeat calls within a worker; the disk sidecar lets a NEW worker_thread short-circuit. The main-thread pre-warm runs before workers spawn, so the sidecar exists by worker-1 startup. Wall-clock improvement (>2 min → 1 s) is consistent with eliminating per-worker SHA256 streams under contention. Invalidation order at line 304 (invalidate → rename → record) is correct.

**M3 boundary checker** (`scripts/check-boundaries.js:135-153`) — runs both grep patterns and sums them. Independent grep confirms exactly 6 imports of `core/ranking/`, matching the cap. Bumping to 6 was correct, not a workaround.

**L8 right-anchored regex** (`/:\d+-\d+:\d+$/` at `indexer-ann.js:626`) — handles Windows drive letters correctly, passes through legacy IDs. The comment justifies WHY `split(':')[0]` would have been wrong.

---

## 4. Questionable patterns

**Q1 — H2 orphan recovery only on empty live DB**. `summary-manager.js:165-168` returns the orphan only when `summaries.length === 0`. The partial-restore edge (N5) is intentionally NOT handled. Defensible but undocumented. Add a comment AND a test.

**Q2 — `indexing → ranking` cap at MAX with zero headroom**. 2 static (`indexer-phases.js:25`, `indexer-ann.js:11`) + 4 dynamic (`indexer-ann.js:706,745`, `indexer-pool.js:695`, `indexer-worker.js:98`) = 6, cap = 6. Any new dynamic import breaks the build. CI should warn at `n >= max - 1`.

**Q3 — `barrel-contracts.test.js` doesn't cover L2/L3 exports**. The `core/indexing` block (lines 73-95) doesn't assert `planAllocation`, `EmbeddingPool`, `LateInteractionPool`, `applyLiSkipPolicy`, `initEmbeddingPool`, or the H1 slot setters via the embedding barrel. Anybody can add `export * from '...'` and silently shadow them. Extend the test.

**Q4 — `LateInteractionIndex.save()` rewrite branch latent footgun**. `late-interaction-index.js:1531-1535` unlinks every file in `_segmentDir` before writing fresh ones. Production stages, so `_segmentDir` is the staging dir; the unlink only deletes files we just wrote — wasteful but correct. **But** if a future caller passes `saveToPath === loadFromPath` with `loadExisting=true`, `resetForSave` is NOT called (per `indexer-ann.js:611`), `_segmentDir` retains the LIVE dir from load, and the rewrite branch unlinks LIVE files. The original C1 bug pattern in a different shape. **Fix**: assert in `save()` that `_segmentDir !== this.indexPath + '.segments'` when entering the rewrite branch with `_loadedExisting=true`, OR require `resetForSave` to have been called.

**Q5 — hybrid CPU+GPU cursor logic** (`indexer-ann.js:815-848`). I traced the `runGpu/runCpu` cursors for 0..8 batches, meet-in-middle, and varied resolution timings. The synchronous `if (back < front) break;` then `myIdx = back--` is atomic per the JS event loop (no await between them). No double-claim, no skip-claim. The comment at 813-814 carries the entire correctness burden. Add a property-based test that randomizes batch counts and asserts every index claimed exactly once.

---

## 5. Test gaps left open

- **C1**: `tests/indexing/li-staged-save.test.js` adds 4 tests for the index class but does NOT exercise `atomicSwapLateInteractionIndex`, the rollback path (N1 invisible to CI), or the second self-heal pass.
- **C2**: `artifact-builder.js` is still 0% covered. The original review's recommended `updateArtifacts` regression test was not added.
- **H1**: no test asserts the embedding barrel exposes `setEmbeddingPool/getEmbeddingPool/clearEmbeddingPool`; no test for the pool lifecycle slot.
- **H2**: `backup-restore.test.js` adds only a cleanup hook. No test for crash recovery, post-restore unlink, the partial-restore scenario (N5), or the atomic write-then-rename. Tests mock `better-sqlite3` and `existsSync`, so the disk path runs but is never asserted.
- **H6**: `tests/infrastructure/model-fetcher.test.js` doesn't exercise `recordVerified`, `isVerified`, the in-process cache, or the disk sidecar.
- **atomic swap helper**: zero direct test coverage.
- **L2/L3**: `barrel-contracts.test.js` unchanged.

The commit's "37/37 critical-path tests pass" is accurate but the critical-path set does not include any test that would catch N1, N2, N5, or N7. Pass is necessary but insufficient evidence.

---

## 6. Out-of-scope notes worth tracking

- `summary-manager.js` is now **542 lines** — newly above the 500-line rule (146 LOC added by H2).
- `indexer-phases.js` 627 → 706, `indexer-ann.js` 903 → 951, `late-interaction-index.js` 1669 → 2311. All already over the limit, made worse.
- `artifact-builder.js` 1059 → 1054 (trivial, still 2x over).
- `embedding/index.js` now re-exports 4 CoreML cascade diagnostic functions from `infrastructure/coreml-cascade.js`. Not a violation (`infrastructure → embedding` is allowed), but the surface is wider.

---

## 7. Summary

| Prior item | Verified | New finding |
|---|---|---|
| C1, C2, H1, H2, H4, H6, M2, M3, M5, L1, L2/L3, L4, L8 | all safe (with caveats noted in §1) | N1 (C1 helper), N2 (H1), N3 (H6), N5 (H2), Q2 (M3), Q3 (L2/L3) |
| (new — not tied to a prior item) | — | N4 (Windows EBUSY retry on LI swap), N6 (`bakSegDir` leaks on cleanup), N7 (`.tmp.segments` cleanup races stale processes), N8 (no version check in disk backup) |

**Net new defects from the fix pack**: 8 (1 HIGH, 4 MEDIUM, 3 LOW).

---

## 8. Overall correctness grade

**B−** (was C+ pre-fix-pack).

The fix pack moved the floor up by resolving 9.5/11 prior items cleanly and shipping serviceable self-heal logic that buys real recovery from on-disk damage. Held back from B by the rollback bug in `atomicSwapLateInteractionIndex` (N1) — the same severity class as the C1 bug it was meant to replace — and by 0% test coverage of the new atomic-swap helper.

The critical bugs (C1, C2) are functionally fixed; the user is no longer at imminent data-loss risk during normal indexing. The new helpers are well-thought-out — the self-heal in particular is excellent. But N1 means a Windows / SMB user, or any user whose process is killed during the LI promote, can still end up with silent data inconsistency via a different code path. Lack of a test means N1 will not be caught by CI.

**P0 follow-ups**:
1. Fix N1 (rollback in `atomicSwapLateInteractionIndex`).
2. Add a test that monkey-patches `atomicSwapDatabase` to throw between segment-rename and stub-rename, asserting full restoration.
3. Add a test for `initEmbeddingPool` concurrent-call idempotency (N2).
4. Add the H2 partial-restore recovery test (N5).
5. Update the H6 doc comment to describe what the cache actually guarantees (N3).

**P1 follow-ups**: extend `barrel-contracts.test.js` (Q3); fix `cleanupStagedLateInteractionIndex` to cover `bakSegDir` (N6); add Windows EBUSY retry (N4); add a property-based test for the hybrid cursor (Q5).

Grade should rise to **B+ / A−** once N1 is closed and the new helper has direct test coverage. The H6 latency win (>2 min → 1 s) is a meaningful production improvement, and the self-heal shows real care for crash-resilience.
