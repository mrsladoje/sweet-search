# State machines of sweet-search

This file lists the state machines of the application, explicit and implicit. For each one it
gives the states, the invariants the code relies on, and the transition table. It then lists
the invalid states and transitions the code can reach, with evidence, and the issues that
group their fixes.

- Audit baseline: commit `d01eeb88` (2026-11-10). Line numbers in the subsystem sections
  (section 6 onward) are from that commit. The fixes of this pass moved some lines.
- Scope: `core/`, `mcp/`, `bin/`, `scripts/` (init, uninstall, hooks) and the Rust client and
  grep lane in `crates/`. The research tooling in `eval/` and `core/prompt-optimization/` is
  not covered.
- Method: seven read-only audits, one per subsystem, then a second pass on the findings with
  the highest impact. The second pass read the code again, wrote a test that fails on the
  baseline, and only then changed the code.

## 1. How to read a finding

Each finding has an id (`D1`, `R3`, ...) and one of three evidence levels.

| Level | Meaning |
|---|---|
| Reproduced | A test in `tests/` fails on the baseline commit and passes with the fix. |
| Read | The code path was read a second time and agrees with the audit. No test reproduces it. |
| Audit only | Reported by the subsystem audit with code lines and a sequence. Not checked a second time. |

The audits also rate each finding CONFIRMED (every step traced in code) or SUSPECTED (one named
step is not verified). That rating is kept in the detailed text.

A status line under a finding heading says what this pass did: `FIXED`, `MITIGATED` or `OPEN`.

## 2. Catalogue of state machines

"Implicit" means that no variable or field names the state. The state is the product of
several booleans, of the existence of files, of the identity of a promise, or of the position
in the code.

| Id | State machine | Kind | Where the state lives | Section |
|---|---|---|---|---|
| E-SM1 | Search engine load (`SweetSearch`) | implicit | `initialized`, `grepInitialized`, `has*Index` flags, loaded index objects | 5 |
| E-SM2 | Engine reload on a new epoch | implicit | `_artifactManifestEpoch`, `_grepArtifactEpoch`, file identities | 5 |
| E-SM3 | Warm searcher singleton (MCP server) | implicit | module variables `_warmSearcher`, `_warmInitPromise` | 5 |
| D-SM1 | Search daemon process lifecycle | implicit | closure variables of `startServer()`, socket, pid file | 6 |
| D-SM2 | Daemon pid file | implicit | `/tmp/sweet-search-<hash>.pid` | 6 |
| D-SM3 | Daemon socket file and grep lane socket | implicit | socket path and its inode | 6 |
| D-SM4 | Client connect-or-spawn-and-wait (Rust, JS, prewarm hook) | implicit | loop variables, start claim file | 6 |
| D-SM5 | Daemon start history | explicit | `.sweet-search/daemon-starts.jsonl` | 6 |
| D-SM6 | Idle timer and resident-daemon cap | implicit | `lastActivityMs`, registry `daemons.json` | 6 |
| D-SM7 | Daemon to maintainer hand-off | implicit | supervision state, pid file | 6 |
| MT-SM1 | Index maintainer process lifecycle | implicit | lock file, process table, module flags | 7 |
| MT-SM2 | Maintainer lock file | explicit fields, implicit states | `.sweet-search/index-maintainer.lock` | 7 |
| MT-SM3 | Dirty queue and processing queue | implicit | two JSONL files | 7 |
| MT-SM4 | Pause file (index-run lock) | explicit | `reconcile-pause.json` | 7 |
| MT-SM5 | Spawn claim and supervision | explicit | `maintainer-spawn.claim`, supervision state | 7 |
| MT-SM6 | File watcher | implicit | watcher object, overflow flag | 7 |
| MT-SM7 | Reconcile tick scheduler | implicit | main loop of the maintainer | 7 |
| MT-SM8 | Maintenance job queue | explicit | `rebuild-queue.jsonl` | 7 |
| MT-SM9 | Background maintenance builds | explicit job, implicit files | child process, staged files | 7 |
| MT-SM10 | Baseline readiness gate | derived | manifest, merkle head, fingerprint | 7 |
| MT-SM11 | Reader heartbeat | explicit | `readers/` files | 7 |
| R-SM1 | Per-file state in a reconcile | implicit | queue entry, file-state row, tier rows | 8 |
| R-SM2 | Dirty queue (claim, requeue) | implicit | two JSONL files | 8 |
| R-SM3 | Reconcile run and commit order across stores | implicit | SQLite transaction, delta files, manifest | 8 |
| R-SM4 | Manifest epoch | explicit | `reconcile-manifest.json` | 8 |
| R-SM5 | Per-file failure counter (quarantine) | explicit | `index-maintainer-failures.json` | 8 |
| R-SM6 | Resident process caches | implicit | module maps | 8 |
| S-SM1 | Late-interaction segment lifecycle | explicit manifest, implicit files | segment dir | 9 |
| S-SM2 | Binary HNSW base, delta and compaction | implicit | index file, delta file, journal | 9 |
| S-SM3 | Sparse-gram base and delta segments | implicit | base file, delta files, manifest list | 9 |
| S-SM4 | Tombstone bitmap versions | implicit | `*.stale.bin` | 9 |
| S-SM5 | Vector and graph garbage collection | implicit | epoch columns, reader frontier | 9 |
| S-SM6 | Reader pin and heartbeat | explicit | `readers/` files | 9 |
| S-SM7 | Temp artifact sweep | implicit | temp file names and ages | 9 |
| S-SM8 | Reader reload (JS daemon and native lane) | implicit | loaded handles, epoch | 9 |
| ML-SM1 | Model file download | implicit | temp file, final file, checksum | 10 |
| ML-SM2 | In-process dense model load | implicit | `localPipeline`, `loadPromise`, `isLoadingLocal` | 10 |
| ML-SM3 | Late-interaction model load | implicit | pipeline variable, `loadPromise` | 10 |
| ML-SM4 | Native models (Metal, CUDA, CoreML) | implicit | module variables and maps of promises | 10 |
| ML-SM5 | Local reranker and semantic-cache model | implicit | instance fields | 10 |
| ML-SM6 | Encoder host child and its client | implicit | child handle, pending map | 10 |
| ML-SM7 | Shared query-model server and client | implicit | socket, start lock, in-flight count | 10 |
| ML-SM8 | Embedding model server | implicit | socket | 10 |
| ML-SM9 | Embedding worker pool | implicit | workers array, task promises | 10 |
| ML-SM10 | Index-device speed test and probe lock | explicit | cache file, lock file | 10 |
| ML-SM11 | Embedding cache entries | implicit | maps | 10 |
| ML-SM12 | ONNX mutex | explicit | promise chain | 10 |
| ML-SM13 | Circuit breaker for remote providers | explicit | counters and timestamps | 10 |
| IX-SM1 | Main index build (first, forced full, incremental, targeted) | implicit | phase position, files on disk | 11 |
| IX-SM2 | Index-run lock | explicit | `reconcile-pause.json` | 11 |
| IX-SM3 | Baseline readiness | derived | manifest, merkle head | 11 |
| IX-SM4 | Empty-repository baseline | implicit | marker rows | 11 |
| IX-SM5 | Worktree index bootstrap (clone) | explicit claim, implicit files | claim file, clone dir, link | 11 |
| IX-SM6 | Worktree stamp | explicit | `worktree-stamp.json` | 11 |
| IX-SM7 | Init, install, uninstall | implicit | config files, hooks, manifests | 11 |
| RQ-SM1 | MCP server lifecycle | implicit | process, searcher singleton | 12 |
| RQ-SM2 | Virtual process (one ss-* call in the daemon) | explicit | AsyncLocalStorage call context | 12 |
| RQ-SM3 | `/agent-tool` route and native client | implicit | HTTP exchange, exit code | 12 |
| RQ-SM4 | Per-session span ledger | explicit | `AgentSpanLedger` maps | 12 |
| RQ-SM5 | Native grep lane | implicit | `loaded` mutex, engine handle, epoch | 12 |
| RQ-SM6 | Daemon lifecycle for requests in flight | implicit | `shuttingDown`, connections | 12 |
| RQ-SM7 | Hook state between prompts | explicit | session files | 12 |

## 3. Rules that several machines share

These rules were implicit. The fixes of this pass made six of them explicit in code.

1. **Socket path ownership** (`core/infrastructure/socket-claim.js`). A Unix socket path has no
   owner field, and closing a Unix-socket server removes the path, whatever file is there.
   A server holds the start claim (`<socket>.start`) from before its "does a server answer?"
   probe until it is bound. It records the inode of its socket file. At shutdown it closes the
   server and removes files only while the path still has that inode. Users: the search daemon
   and the shared query-model server.
2. **The pid file names the daemon for as long as it holds the socket.** It is written by
   rename directly after the bind, in every load state, and removed only by the process whose
   pid it holds.
3. **Lazy model load** (`core/infrastructure/load-retry.js`). A load promise is shared by
   concurrent first callers. A failed load stays the answer for 30 seconds, then the next call
   loads again. It is never the answer for the life of the process.
4. **File-state rows describe the content that was indexed.** A run takes the rows (hash and
   stat) before it reads any file for the build, and it takes the stat before the read. An
   edit during the run then leaves a row that does not match the file, and the dirty scan
   indexes the edit. A run over some files keeps the rows of the others.
5. **A reconcile failure is counted against the file in flight, from its read on.** Two
   failures quarantine the file. A quarantined file gets one retry every 30 minutes.
6. **One flag, one loaded object.** `hasBinaryHnswIndex` is true only with a loaded index
   object. A file that exists but did not load leaves the flag false.
7. **A pid read from a file is not a process identity.** This rule is NOT yet enforced
   (issue 8). Several places send a signal to, or wait for, a pid without a start-time check.
8. **A journal replay must be safe after every step, the last one included.**
9. **A baseline verdict belongs to a project root.** Whether an index is a complete baseline
   depends on the configuration of the process that judges it (the persisted model choice in
   that checkout's `.sweet-search/config.json`, its `.env`). The verdict for a checkout is
   given by a process whose project root is that checkout, as its maintainer's is
   (`indexReadiness` in `core/indexing/worktree-index.mjs`).
10. **A worktree index is cloned from a finished build, and a clone that is not a complete
    baseline is replaced** once the main index is a complete baseline.

## 4. Findings and issues

### 4.1 Register of findings

Impact scale: High = wrong or missing results for a long time, a crash, or a signal to a wrong
process. Medium = a degraded tier or a long delay that repairs itself. Low = cosmetic or a
narrow window.

| Id | Finding | Evidence | Impact | Issue | Status |
|---|---|---|---|---|---|
| D1 | Two daemons for one project root. The one that lost later removes the winner's socket, lane socket and pid file. | Reproduced | High | 1 | FIXED |
| D2 | The prewarm hook starts a second daemon during a load, because the pid file exists only after the load. | Reproduced (pid file part) | High | 1 | FIXED |
| D3 | A busy daemon fails the 500 ms health probe and a new daemon takes its socket. | Audit only (SUSPECTED) | Medium | 1 | MITIGATED |
| D4 | A maintainer that follows the pid file stops when the load takes more than 120 s. | Read | Medium | 1 | FIXED |
| D5 | No SIGTERM handler. The fleet memory budget sends SIGTERM. Calls in flight are cut and files stay behind. | Reproduced | High | 1 | FIXED |
| D6 | The memory budget can send SIGTERM to a process that reuses a dead daemon's pid. | Audit only (SUSPECTED) | High, low odds | 8 | OPEN |
| D7 | Resident-daemon cap registry: lost update, and a dropped entry never comes back. Cap is off by default. | Audit only | Low | 16 | OPEN |
| D8 | A pid file write failure turned a loaded daemon into "failed". | Read | Low | 1 | FIXED |
| D9 | No back-off for a daemon that dies during each load. Such starts are not in the start history. | Audit only | Medium | 16 | OPEN |
| D10 | The old daemon's late unlink removes the new daemon's files on a stop-then-start. | Reproduced (socket taken over) | High | 1 | FIXED |
| D11 | The Rust client waits the full 120 s on a failed daemon that cannot be replaced. | Audit only (SUSPECTED) | Low | 16 | OPEN |
| E1 | The MCP server keeps a failed engine init for the life of the process. A search before the first index build fails every later search. | Reproduced | High | 2 | FIXED |
| E2 | An HNSW index that failed to load at init is marked present at the next epoch without a load. Semantic search then gets no dense hits. | Reproduced | Medium | 2 | FIXED |
| R1 | One unreadable queued file stops incremental indexing for the project for good. | Reproduced | High | 3 | FIXED |
| R2 | Two failed ticks quarantine the file in flight for good, also when the cause was not the file. | Reproduced | High | 3 | FIXED |
| R3 | Sparse-gram delta lines of a failed tick are published by the next tick. After a revert, grep uses stale grams for the file. | Audit only (CONFIRMED mechanism) | Medium | 9 | OPEN |
| R4 | The operator command `reconcile tick` takes no lock and does not check the pause file. | Audit only | Medium | 12 | OPEN |
| R5 | Delete then restore of a file (branch switch) leaves its importers' `importsFile` edges retired. | Audit only (CONFIRMED) | Medium | 10 | OPEN |
| R6 | An unreadable manifest restarts the epoch at 1. The manifest temp file has one fixed name. | Audit only (SUSPECTED) | High, low odds | 9 | OPEN |
| R7 | A retried tick reuses its epoch, so an HNSW delta id repeats and the old vector stays. | Audit only (SUSPECTED) | Low | 9 | OPEN |
| S1 | The sparse fold publish is not atomic: new base, old-weights deltas. | Audit only (SUSPECTED) | Medium | 15 | OPEN |
| S2 | An orphaned background build child can overwrite the staged base of the next build. | Audit only (SUSPECTED) | Medium | 14 | OPEN |
| S3 | The temp sweep with age 0 on a lifecycle abort can delete a successor's temp file. | Audit only | Low | 14 | OPEN |
| S4 | LI and sparse segments are deleted on a fixed 60 s timer with no reader check. | Audit only (SUSPECTED) | Medium | 15 | OPEN |
| S5 | The graph GC frontier can pass a reader that has not yet written its heartbeat. | Audit only (SUSPECTED) | Low | 15 | OPEN |
| S6 | The HNSW compaction journal replay removes the new stale bitmap after a crash behind its last step. | Reproduced | Low | 6 | FIXED |
| S7 | A search across a compaction applies a renumbered stale bitmap to the old base. | Audit only (SUSPECTED) | Low | 15 | OPEN |
| ML1 | A failed model load is kept for the life of the process (six load sites). | Reproduced (dense model), Read (other sites) | High | 4 | FIXED |
| ML2 | Each failed query embedding also raised an unhandled rejection, which ends the process. | Reproduced | High | 4 | FIXED |
| ML3 | The worker pool keeps a dead worker routable. Its tasks wait 120 s and the run aborts. Needs 2 or more workers. | Audit only (CONFIRMED) | Medium | 11 | OPEN |
| ML4 | A pool init failure leaks the workers that did start. | Audit only (CONFIRMED) | Low | 11 | OPEN |
| ML5 | A half-failed GPU pool arm leaves dense on Metal and LI on CPU, and the log says the opposite. | Audit only (CONFIRMED) | Medium | 11 | OPEN |
| ML6-ML10 | Shared temp path for downloads, model server start, permanent CoreML failure flag, unload during load, smaller items. | Audit only | Low | 16 | OPEN |
| IX1 | A full rebuild hashed files after the build. An edit or delete during the build was never indexed. | Reproduced | High | 5 | FIXED |
| IX2 | `index --files-from-stdin` emptied the file-state rows. The maintainer then indexed the whole repository again. | Reproduced | High | 5 | FIXED |
| IX3 | A worktree clone is taken from a main index that is partial or in an old format, and is never refreshed. | Reproduced | High | 7 | FIXED |
| IX4 | The pause file and the clone lock trust a bare pid. After pid reuse they block for good. | Audit only | Medium | 8 | OPEN |
| IX5 | `uninstall` sends SIGKILL or SIGTERM to the pid in a pid file or lock with no identity check. | Read | High, low odds | 8 | OPEN |
| IX6 | `init` stores the new LI model before the download succeeds. A failed init leaves a dormant maintainer. | Audit only (CONFIRMED) | Medium | 13 | OPEN |
| IX7-IX10 | Codex installer manifest written last, swallowed artifact build failure, deletion-only run, LI swap crash window. | Audit only (SUSPECTED) | Medium | 13 | OPEN |
| MT1 | SIGTERM to an unrelated process after a maintainer crash and pid reuse. No start-time guard on macOS. | Audit only (CONFIRMED path) | High, low odds | 8 | OPEN |
| MT2 | The lock rewrite is truncate then write. A reader that sees the empty file removes a live lock. | Audit only (CONFIRMED steps) | High, very low odds | 14 | OPEN |
| MT3 | After a long sleep of the machine both lock stamps look stale and a healthy maintainer is replaced. | Audit only (SUSPECTED) | Low | 14 | OPEN |
| MT4 | An orphaned compaction child collides with the next build on fixed staged paths. | Audit only (SUSPECTED) | Medium | 14 | OPEN |
| MT5 | An idle or daemon-gone exit does not check the dirty queue. | Audit only (SUSPECTED) | Low | 14 | OPEN |
| MT6 | Smaller: stale pause shown as "paused", non-atomic queue and heartbeat writes. | Audit only | Low | 14 | OPEN |
| RQ1 | One panic in the native grep lane poisons its mutex. The lane then declines every call. | Audit only (trigger hypothetical) | Medium | 16 | OPEN |
| RQ2 | Same as D10. | Reproduced | High | 1 | FIXED |
| RQ3 | The MCP stdio server has no handler for a closed stdin and can stay as an orphan. | Audit only (SUSPECTED) | Medium | 16 | OPEN |
| RQ4 | The MCP server never gets a session id over stdio, so the reread-omission ledger is off for MCP. | Audit only | Low | 16 | OPEN |
| RQ5-RQ8 | Receipt before reply, in-process search shortcut context, daemon across a package upgrade, gutter cache key. | Audit only (SUSPECTED) | Low to Medium | 16 | OPEN |

### 4.2 Issues fixed in this pass

Order is by impact. Each issue lists its findings, the change and the regression tests.

**Issue 1. One daemon per socket path, and a daemon removes only what it owns** (D1, D2, D4,
D5, D8, D10, RQ2; mitigates D3).
- Change: `core/infrastructure/socket-claim.js` (new, shared with the query-model server);
  `core/search/search-server.js`: start claim before the probe, pid file by rename at bind,
  inode ownership checks in `gracefulShutdown`, exit when the socket path was removed or bound
  again, SIGTERM handler. `core/search/query-encoder-server.mjs` now imports the shared helpers.
- A starter that finds the claim held waits for the holder's socket and then exits. The client
  that spawned it waits for a socket it can connect to, so no client changed.
- D3 is mitigated, not removed: a new daemon can still take the socket of a daemon that does
  not answer `/health` in 500 ms. The daemon that lost its path now exits within one idle check
  (60 s) and removes nothing.
- Tests: `tests/search/daemon-lifecycle.integration.test.js` ("socket path ownership", four
  tests), `tests/infrastructure/socket-claim.test.js`.

**Issue 2. Engine load flags agree with what is loaded** (E1, E2).
- Change: `core/search/sweet-search.js`: `getWarmSearcher` drops a failed init;
  `_binaryHnswIdentity` is recorded only after a load that succeeded; `_syncBinaryHnsw` loads
  an index object that never loaded.
- Tests: `tests/search/warm-searcher-retry.test.js`,
  `tests/search/sweet-search-hot-reload.test.js` ("an HNSW index that never loaded").

**Issue 3. One bad file or one bad tick does not stop or shrink the index** (R1, R2).
- Change: `core/incremental-indexing/application/reconciler.mjs`: the file is in flight from
  its read on. `production-reconciler.mjs`: a quarantined file gets one retry every 30 minutes.
- Tests: `tests/indexing/incremental-indexing-reconciler.test.js` (two tests),
  `tests/indexing/incremental-indexing-production-reconciler.test.js` (two tests).

**Issue 4. A failed load or a failed embedding does not poison or end the process** (ML1, ML2).
- Change: `core/infrastructure/load-retry.js` (new), used by `embedding-local-model.js`,
  `late-interaction-model.js`, `native-inference.js` (five sites) and the semantic cache;
  `embedding-cache.js`: the in-flight map is cleaned without a second rejected promise.
- Tests: `tests/infrastructure/load-retry.test.js`.
- Not covered by a test: the native load sites and the LI load site (same helper, read only).

**Issue 5. File-state rows after a full or a targeted index run** (IX1, IX2).
- Change: `core/indexing/incremental-tracker.js` (`hashFilesForState`, `updateStateForFiles`),
  `core/indexing/indexer-phases.js`, `core/indexing/index-codebase-v21.js`.
- Tests: `tests/indexing/indexer-state-rows.test.js`.

**Issue 6. HNSW compaction journal replay** (S6).
- Change: `core/incremental-indexing/infrastructure/hnsw-compaction.mjs` (`runJournal`).
- Tests: `tests/indexing/incremental-hnsw-compaction.test.js` ("replay after its last step").

**Issue 7. A worktree index comes from a finished build and does not stay stale** (IX3).
- Change: `core/indexing/worktree-index.mjs`: the readiness verdict of a checkout
  (`indexReadiness`, a short process rooted in that checkout); no first clone from a main
  index whose build did not finish; a `--replace` mode that swaps a clone that is not a
  complete baseline for a new clone. `core/indexing/index-maintainer.mjs`: a dormant
  maintainer of a linked worktree index asks for that replacement, at most once a minute.
  `baseline-readiness.mjs`: `readStoredFingerprint`.
- Decision: a finished main index in an OLDER FORMAT is still cloned. It serves the worktree
  as it serves the main checkout, and the MCP server has no split roots to fall back to. The
  clone is replaced after the main index is rebuilt.
- Guards against a replace loop: a clone younger than 10 minutes is not replaced; a clone
  that already has the main index's stored fingerprint is not replaced (a new clone would get
  the same verdict, and would undo a model choice made in the worktree); a state dir that is
  a real folder, or a link to another place, is never touched.
- Limits: an MCP server that searches in-process keeps its open files of the replaced clone
  until its next reload or restart. A main index rebuilt over an older complete one and
  killed half way still has the old manifest and merkle state, so it counts as finished
  (the baseline gate has the same limit for the main maintainer).
- Tests: `tests/indexing/worktree-index.test.js` ("main index readiness", "a worktree index
  that is not a complete baseline is replaced": twelve tests).

### 4.3 Open issues, in priority order

**Issue 8 (P1). A pid from a file is used as a process identity** (MT1, IX4, IX5, D6, part of
MT6). Sites: `uninstall.js` (SIGKILL by pid file, SIGTERM by lock), `maintainer-launcher.mjs`
(`holdMaintainerForIndexRun`), `index-maintainer.mjs` (`sigtermAndStealLock`, start-time guard
on Linux only), `rss-budget.mjs` (eviction), the pause file and the clone lock. Proposed fix:
one helper that stores the process start time beside the pid (`ps -o lstart=` on macOS,
`/proc/<pid>/stat` on Linux) and compares it before a signal or a "holder is alive" decision.
Issue 1 already removes the most common stale daemon pid file (it is now removed on SIGTERM).

**Issue 9 (P2). A failed tick leaves state that the retry reuses** (R3, R6, R7). The retry
reuses the epoch number. Sparse delta lines and HNSW delta records of the failed attempt are
already on disk under that number. Proposed fix: keep a high-water mark of attempted epochs so
that a retry gets a new number, and use a per-process temp name for the manifest.

**Issue 10 (P2). `importsFile` edges after delete and restore** (R5). Proposed fix: do not
retire `importsFile` rows on delete; filter by target existence at read time.

**Issue 11 (P2). Embedding worker pool and GPU pool failure paths** (ML3, ML4, ML5). Proposed
fix: on worker exit, remove the worker from routing and fail its pending tasks; on init failure
shut the pool down; on a half-failed GPU arm unload the native models.

**Issue 12 (P2). Operator `reconcile tick` beside a running maintainer** (R4). Proposed fix:
take the maintainer lock, or refuse while a live maintainer holds it, and check the pause file.

**Issue 13 (P2). `init` is not transactional** (IX6 to IX10). Proposed fix: write the model
setting after the download and verification, and write installer manifests first.

**Issue 14 (P3). Maintainer lock and background build edges** (MT2 to MT6, S2, S3).
**Issue 15 (P3). Reader-side grace windows** (S1, S4, S5, S7).
**Issue 16 (P3). Other lifecycle edges** (D7, D9, D11, ML6 to ML10, RQ1, RQ3 to RQ8).
The detailed text of each finding has a fix proposal and a test idea.

## 5. Search engine (`core/search/sweet-search.js`)

### E-SM1. Engine load

State lives in one `SweetSearch` object: `initialized`, `grepInitialized`, the flags
`hasGraphIndex`, `hasCodebaseIndex`, `hasBinaryHnswIndex`, `hasLateInteractionIndex`,
`hasSparseGramIndex`, `useLateInteraction`, and the loaded objects. All states are implicit.

| State | Encoding |
|---|---|
| NEW | `initialized` false, `grepInitialized` false |
| GREP_READY | `grepInitialized` true: sparse grams and databases are usable, models are not loaded |
| READY | `initialized` true |
| READY, tier off | `initialized` true and one `has*` flag false after a failed load of that tier |
| FAILED | `init()` threw ("No search indexes found", schema mismatch). The object stays NEW |

Invariants:
- I1. A `has*` flag is true only when the object of that tier is loaded (rule 6). Broken by E2 on the baseline.
- I2. `grepInitialized` is set before the slow loads, so a grep call does not wait for models.
- I3. The epoch recorded for a scope is the epoch read before that scope's loads began. A publish during the loads then causes one more reload, never a missed one.

| From | Event | Guard | To | Side effects | Where |
|---|---|---|---|---|---|
| NEW | `init()` | an index exists and schemas match | GREP_READY | sparse grams loaded, `onGrepReady` called | `init` |
| NEW | `init()` | no index, or schema mismatch | FAILED (throws) | none | `init` |
| NEW | `initGrepOnly()` | not initialized | GREP_READY | sparse grams loaded | `initGrepOnly` |
| GREP_READY | HNSW load ok | `use3Stage` | (continues) | identity recorded after the load | `init` |
| GREP_READY | HNSW load fails | | (continues, HNSW off) | `hasBinaryHnswIndex` false, no identity | `init` |
| GREP_READY | LI load or preheat fails | | (continues, LI off) | `hasLateInteractionIndex` and `useLateInteraction` false | `init` |
| GREP_READY | models warm | | READY | `_artifactManifestEpoch` set | `init` |

### E-SM2. Reload on a new epoch

State: `_artifactManifestEpoch` (all tiers), `_grepArtifactEpoch` (sparse grams only),
`_binaryHnswIdentity`, `_sparseGramIdentity` (inode, size, mtime of the loaded file).

| From | Event | Guard | To | Side effects | Where |
|---|---|---|---|---|---|
| epoch N | search, manifest at N | | epoch N | HNSW delta tail read; base reloaded if its file identity changed | `_refreshManifestPins` |
| epoch N | search, manifest at N+1, scope all | engine or grep initialized | epoch N+1 | HNSW sync, new LI index object, sparse base reload | `_reloadManifestArtifacts` |
| epoch N | grep call, manifest at N+1 | | grep epoch N+1, artifact epoch N | sparse grams only | `_refreshManifestPins` |
| HNSW off (load failed) | next epoch | file exists | HNSW on, or off again | the index is LOADED now (fix of E2) | `_syncBinaryHnsw` |
| any | HNSW reload fails | | HNSW off | old object kept until the next epoch | `_reloadBinaryHnsw` |
| any | LI reload fails | | LI off until the next epoch | | `_reloadManifestArtifacts` |

Known and accepted: two searches that see a new epoch at the same moment both reload. The last
assignment wins and the result is the same. The cost is one extra load.

Open observation (not a finding, Audit only): the search-side LI reader keeps whatever segments
loaded when one segment fails to load, and this partial object replaces the complete one of the
older epoch until the next epoch (see S4).

### E-SM3. Warm searcher singleton (`getWarmSearcher`, used by the MCP server)

| State | Encoding |
|---|---|
| EMPTY | `_warmSearcher` null, `_warmInitPromise` null |
| LOADING | `_warmInitPromise` pending |
| READY | `_warmSearcher.initialized` true |

| From | Event | To | Side effects |
|---|---|---|---|
| EMPTY | first call | LOADING | one `SweetSearch` and one `init()` |
| LOADING | another call | LOADING | waits on the same promise |
| LOADING | init resolves | READY | |
| LOADING | init rejects | EMPTY | every waiting caller gets the error; the searcher is closed; the next call starts over |

On the baseline the last row went to a fourth state, POISONED (`_warmInitPromise` rejected),
with no way out. That was finding E1.

### E1. The MCP server kept a failed engine init for the life of the process

> Status: FIXED (issue 2). Evidence: Reproduced.

Sequence: the MCP server starts in a project that has no index yet. The first `search` call
fails with "No search indexes found. Run indexing first.". The user builds the index, for
example with the MCP `index` tool. Every later `search` call of that server still failed with
the same error, because `getWarmSearcher` awaited the rejected promise of the first init.
Only a restart of the MCP server cleared it.

### E2. An HNSW index that never loaded was marked present at the next epoch

> Status: FIXED (issue 2). Evidence: Reproduced.

Sequence: at init the index file exists but its load throws (truncated file, another pipeline
version). `hasBinaryHnswIndex` becomes false and semantic search uses the vector scan. The
identity of the file was recorded before the load. At the next epoch the flag was set from the
existence of the file, and the sync step compared identities, found them equal, asked the
never-loaded object to extend its delta, and got "up to date". The 3-stage path then ran on an
empty index: no dense candidates, without an error.


## 6. Search daemon lifecycle and its clients

Ids in this section: state machines `D-SM<n>`, findings `D<n>`. The text below is the subsystem audit as written at the baseline commit; inside it, "2.3" or "see 2.1" means D3 or D1; "1.4" means D-SM4.


Scope read: search-server.js (startServer, 762-1706), daemon-registry.js, daemon-starts.js, server-identity.js, daemon-client.js,
search-client.js, daemon-heap.js, wsl-keepalive.js, session-daemon-prewarm.mjs, setup-status.js (probe part), daemon-route.js, launch.js,
start-server.js, cli.js (--serve/daemon/status), spawn-ledger.js, pid-alive.js, process-title.js, Rust main.rs (spawn_daemon, auto_start_server_for,
ready_server, daemon_stop, run_daemon_command), http_transport.rs, agent_tools.rs (run), plus the pieces that consume the daemon pid file:
index-maintainer.mjs (daemon follow), shared.mjs (ensureWarmServerReady), rss-budget.mjs (eviction), query-encoder-server.mjs (as a reference
for the pattern the daemon lacks). Nothing was executed. All line numbers are from the working tree at d01eeb88.

Conclusion first: two daemons for one project root are reachable, and the daemon deletes the socket and pid file of whichever daemon
bound last. The cause is one missing guard: the daemon unlinks and binds its socket without owning an exclusive start claim and without
checking socket ownership at shutdown.


### State machines

#### D-SM1. Daemon process lifecycle (one process)

State lives in closure variables of `startServer()` (search-server.js) plus files. Most states are IMPLICIT.

| State | How it is encoded |
|---|---|
| NOT_RUNNING | no process; socket file may remain (stale) |
| GUARDING | before 799: process alive, no socket bound yet, no pid file (implicit: code position) |
| IMPORTING | 816-835: heavy imports + `new SweetSearch` (implicit); socket NOT bound, so invisible to every client |
| BOUND_LOADING ("starting") | after listen 1537 and until 1568: `serverReady=false`, `initError=null`, `grepReady` maybe true (1566). /health answers `status:'starting'` (1344) |
| READY | `serverReady=true` (1568); pid file written right after (1569) |
| FAILED | `initError!=null` (1579). Stays resident. /health `status:'failed'`. NOTE `serverReady` can be true and initError set at once (see 2.8) |
| DRAINING | `shuttingDown=true` (894, 915). Listener closing, in-flight requests finish (3 s grace each server, 899-910) |
| STOPPED | `process.exit(0)` (940) |
| CRASHED | SIGKILL, OOM abort, uncaught throw, or SIGTERM (there is NO SIGTERM handler; only SIGINT, line 1604) |

Invariants the code relies on:
- I1: at most one daemon owns the per-project socket (comment 789-797, "never steals from a live listener"). Enforced only by a /health probe with 500 ms timeout (799).
- I2: the pid file names the live, ready daemon (read by prewarm daemonHealthy 205-213, maintainer follow index-maintainer.mjs:1107, worktree-index.mjs:593).
- I3: whoever shuts down removes only its own socket, pid file, registry entry (NOT enforced, see 2.1).
- I4: `lastActivityMs` moves only on real query routes (877-879).

Transitions:

| From | Event | Guard | To | Side effects | Where |
|---|---|---|---|---|---|
| NOT_RUNNING | spawn (Rust spawn_daemon / autoSpawnServer / prewarm) | none cross-client (see 2.2, 2.3) | GUARDING | log fd, setsid, heap flag | main.rs:1539, search-client.js:375, prewarm:269 |
| GUARDING | /health answered `ready` or `starting` within 500 ms | probe | STOPPED (return, exit 0) | none | search-server.js:799-811 |
| GUARDING | /health `failed` | stop + wait 5 s | continue, or return if old daemon stays | /stop sent | 801-808 |
| GUARDING | no answer in 500 ms (no listener, busy listener, stale file) | none | IMPORTING | | 799 |
| IMPORTING | import done | none | BOUND_LOADING | `unlink(socketPath)` unconditional, `listen`, chmod 700, lane start, WSL keep-alive, init task, maintainer supervision tick, idle/lane/registry timers | 1520-1704 |
| IMPORTING | listen rejects (EADDRINUSE) | none | CRASHED (unhandled rejection in start-server.js:28) | | 1537 |
| BOUND_LOADING | `searcher.init` resolves | | READY | pid file written, start recorded, changed-files tracking | 1566-1577 |
| BOUND_LOADING | init throws | | FAILED | start recorded `ok:false`; NO pid file | 1578-1583 |
| READY/FAILED/BOUND_LOADING | GET /stop over unix socket | gracefulShutdown not already running | DRAINING | | 1368-1378 |
| any bound | SIGINT | handler installed at 1604 only | DRAINING | | 1604 |
| any bound | idle timer: idleFor > ttl (20 min) | ttl>0 | DRAINING | | 1630 |
| any bound | index dir inode changed | | DRAINING | | 1637 |
| DRAINING | teardown done | | STOPPED | registry remove (cap only), lane stop, close servers, searcher.close, `unlink(pidFile)`, `unlink(socketPath)` UNCONDITIONAL | 913-941 |
| any | SIGTERM / SIGKILL | no handler | CRASHED | socket file, `.grep` lane socket, pid file left behind | n/a |

#### D-SM2. Pid file (`/tmp/sweet-search-<fnv16>.pid`)

State: file absent / present+live pid / present+dead pid / present+reused pid / empty (mid-write). Writer: only READY transition (1569, plain
`writeFile`, truncate-then-write, not atomic). Remover: gracefulShutdown (933). Readers: prewarm `daemonHealthy` (pid alive AND socket connects),
maintainer `daemonPidFileLive` (pid alive only, no start-time check), worktree launch binding.

| From | Event | To | Where |
|---|---|---|---|
| absent | daemon becomes READY | live | 1569 |
| live | graceful shutdown | absent | 933 |
| live | crash/SIGTERM/SIGKILL | dead (stale) | none removes it |
| dead | OS reuses the pid | reused (reads as "live") | pid-alive.js:6 |
| any | next daemon READY | overwritten | 1569 |

Implicit invariant violated: "pid file exists whenever a daemon serves". It is absent for the whole load (seconds to minutes) and forever on FAILED.

#### D-SM3. Socket file (`/tmp/sweet-search-<fnv16>.sock`, plus `<sock>.grep` for the native lane)

States: absent / bound by live daemon / stale (no listener) / bound by daemon X but path now points to daemon Y's inode (orphaned listener).
- Create: unlink+listen (1520-1537). Lane: `remove_file` + `bind` (crates/sweet-search-native/src/lane/server.rs:30-31).
- Remove: libuv unlinks the pipe path when the listening handle closes (this is the Node behaviour the author of query-encoder-server.mjs:129-134
  documents), then explicit unlink at 936, and lane `stop` remove_file (server.rs:25). None checks that the path still names our inode.
- Client discovery: Rust `find_socket_for` = exists && connect (main.rs:1378); `probe_health` maps NotFound/ConnectionRefused to Gone, timeout and any
  other error to Starting (1628-1643); JS `isServerListening` = connect (search-client.js:342), `isServerRunning` = /health ready (353).

#### D-SM4. Client connect-or-spawn-and-wait machines

(a) Rust ss-* (`agent_tools.rs::run`, 515-541): POST /agent-tool. NotFound/Refused and `!started` -> `auto_start_server_for` (spawn, poll 100 ms up to 30 s for
a connectable socket, or child exit) -> retry POST. Any other error -> in-process fallback. Status 503/4xx -> in-process; 500 -> print, exit 1. No lock, no back-off, one spawn per call.

(b) Rust human CLI (`ready_server`, main.rs:1673-1742): loop of probe_health every 150 ms, budget 120 s. Gone+no child -> spawn; Gone+child exited -> one 200 ms re-probe then fail; Failed -> spawn once (`replaced_pid`), then wait while same pid, fail if a different failed pid.

(c) JS (`shared.mjs::ensureWarmServerReady`, 358-389): /health 1 s; ready -> done; failed -> one respawn; no health and `!isServerListening()` and 60 s since last spawn -> spawn (max 2).
`autoSpawnServer` (search-client.js:375-437) spawns then polls `isServerRunning` (ready only) for 5 s and returns false on timeout.

(d) JS CLI (`search-cli.js:284-288`): `isServerRunning()` false (also while "starting") -> `autoSpawnServer()` each query.

(e) Prewarm hook (session-daemon-prewarm.mjs:269-303): `daemonHealthy` = pid file alive AND socket connects; else take /tmp lock (`wx`), spawn, release.

#### D-SM5. Start history (`.sweet-search/daemon-starts.jsonl`)
Append-only record at the end of the load (READY or FAILED), trimmed to 50 by tmp+rename (daemon-starts.js:14-26). It is display only (`setup-status.js`).
There is NO crash-loop back-off anywhere: nothing reads it to delay a spawn. A daemon that dies during load writes no record at all.

#### D-SM6. Idle timer and lifecycle cap
Idle: `idleTimer` every 60 s, shutdown when `now-lastActivityMs > 1.2e6`; also index-dir inode check, supervision backstop (1622-1660). It does not look at in-flight requests (TTL is 20 min, so only matters for small test TTLs).
Cap (default OFF): registry JSON `daemons.json`, entries keyed by pid; upsert on start (1691), touch every 45 s (1698), remove on shutdown (920). `touchSelf` is a no-op when the entry is absent (daemon-registry.js:198). `pruneAndList` drops entries whose pid is dead or whose /health (500 ms) fails (247).
Trust guards: private dir + owner + mode checks (87-115), pre-boot entries dropped (137-143), atomic tmp+rename with per-pid tmp (170-187).

#### D-SM7. Daemon to maintainer hand-off
`runSupervisionTick({daemonPidFile: pidFile})` at startup (1599) and per response/timer (1434-1454, 1659). The maintainer gets `--daemon-pid-file`; every check interval it does `daemonPidFileLive`; if not live for `DAEMON_ABSENT_GRACE_MS`=120 s it sets stopRequested+shutdownRequested "no successor" (index-maintainer.mjs:1076, 1357-1372).


### Reachable invalid states or transitions

#### D1. Two daemons for one root; the loser-of-the-race later deletes the winner's socket  (CONFIRMED)

> Status: FIXED in this pass (issue 1).


(a) Code.
- Guard: `const existingHealth = await getServerHealth({ timeoutMs: 500 });` then `if (existingHealth) {... return;}` (search-server.js:799-813).
- Then, with no further probe, after imports and `new SweetSearch` (816-835): `try { await fs.unlink(socketPath); }` (1520) then `unixServer.listen(socketPath)` (1537).
- Shutdown: `await closeServerGracefully(unixServer)` (926), then `await fs.unlink(pidFile)` and `await fs.unlink(socketPath)` (933-938). The first closes the handle and libuv removes the path; the explicit unlinks remove whatever is at the path now.
- Reference showing the authors know the pattern: query-encoder-server.mjs:129-134 compares `statSync(socketPath).ino` with the bound inode before closing; the search daemon does not.

(b) Sequence.
1. Cold start, no daemon. Client X (an ss-grep call) and client Y (a second parallel ss-* call, or the SessionStart prewarm hook) both see NotFound/Refused. No cross-client lock exists in agent_tools.rs:518-522, shared.mjs:381, or main.rs:1708. Each spawns `start-server.js --serve`: daemons D1 and D2.
2. D1 and D2 each reach line 799 while no socket exists (node start + imports take roughly 1 s or more; the window is from process start until D1's listen at 1537). Both get null from the probe and continue.
3. D1 unlinks (nothing) and binds. D2 later unlinks D1's path (1520) and binds its own inode. D1 is now an orphan: alive, loading 1-2 GB, listening on an unlinked inode. D1 also wrote nothing the client can reach. Same for the `.grep` lane (server.rs:30).
4. Clients connect to D2. Everything looks fine for 20 minutes. D1 receives no traffic, so `lastActivityMs` stays at its start.
5. At D1 start+20 min D1 runs `gracefulShutdown('idle-ttl')`: `unixServer.close()` makes libuv unlink the path, which now names D2's socket; then 936 unlinks again; 933 deletes the pid file D2 wrote; `stopGrepLane()` removes D2's `.grep` path.
6. D2 is alive, warm, possibly mid-session, but unreachable (ENOENT) and without a pid file. The next client gets NotFound, spawns D3 (cold load, tens of seconds), and the chain repeats: D2 becomes the orphan that, when it idles out, deletes D3's socket. In the meantime the maintainer bound to the pid file sees it vanish and stops after 120 s unless D3 writes it in time.

(c) Guards checked, none stops it: the 500 ms /health probe only sees a daemon that has already bound; the prewarm lock (see 2.2) is released right after spawn; the Rust `started` flag is per process; `isServerListening` in shared.mjs:381 only checks that a listener exists at that moment; start-server.js has no lock; the maintainer lock covers only the maintainer.

(d) Impact. 2 x (1-2 GB) resident for 20 min on every parallel cold start; then a warm, in-use daemon is made unreachable at an unpredictable moment, so the agent pays a cold start (the ss-search path has a 90 s budget, tools.js) and gets "starting" or in-process fallbacks. Repeats every 20 min while the cycle self-perpetuates. The orphan also keeps the maintainer supervision and the RSS registry counting it.

(e) Minimal fix. (1) In `gracefulShutdown`, record `socketIno = statSync(socketPath).ino` right after listen and unlink the socket, `.grep` socket and pid file only when the inode (and for the pid file, the content = our pid) still matches; skip `unixServer.close()` path removal the way query-encoder-server.mjs does (close only if `ownPath`, otherwise destroy connections and exit). (2) Make the start claim exclusive: `open(<socket>.start.lock, 'wx')` holding our pid (stale if pid dead or older than 60 s, as query-encoder-server.mjs START_LOCK_STALE_MS does) taken BEFORE the probe at 799 and released after listen; or re-probe with `net.connect` immediately before the unlink at 1520 and exit if it connects. (3) In the Rust lane `stop`, same inode check.

(f) Test without a real daemon. Plain node:net test on a temp path: server A listens; unlink path; server B listens; `A.close()`; assert `net.connect(path)` still reaches B. It fails today and pins the libuv behaviour. For the claim: run two `startServer`-like stubs through the new lock helper with `Promise.all` and assert one returns early.


#### D2. Prewarm hook lock does not cover the daemon's load; the pid-file check is blind during load  (CONFIRMED)

> Status: FIXED in this pass (issue 1). The pid file is written at bind, and the start claim covers the time before the bind.


(a) Code. `daemonHealthy()` returns false unless `pidAlive(pid)` where pid comes from PID_FILE (205-213). The lock is taken at 278 and released in `finally` at 301 immediately after `spawn(...)`/`unref()` (283-302). The daemon writes the pid file only after the full index load: search-server.js:1568-1569.

(b) Sequence. Window A opens a Claude session at t=0: hook spawns D1, releases the lock at t~50 ms. Window B (or the same hook for `clear`/`compact`, or any second SessionStart) runs at t=1 s to t=load end: PID_FILE absent -> `daemonHealthy()` false -> lock free -> spawns D2. D2 enters 2.1.

(c) Guards: the lock only serialises the spawn call itself; the existing test "is idempotent" (session-daemon-prewarm.test.js:285-305) passes only because the test writes the pid file by hand (line 292) before the second hook, which the real daemon does not do until ready.

(d) Impact: the entry condition of 2.1, with an easy trigger (every SessionStart/compact during a cold or slow load; loads take tens of seconds on large repos).

(e) Fix: `daemonHealthy` should be "socket connects" alone (the socket is bound at 1537, long before the pid file), or the daemon should write the pid file right after listen and rewrite it at READY. Or hold the lock until the socket answers.

(f) Test: extend the existing prewarm test with a fake daemon that binds the socket but writes the pid file only after 2 s; run two hooks 200 ms apart; expect one marker line (today: two).


#### D3. The "no second daemon" guard fails on a busy daemon (500 ms /health probe)  (SUSPECTED)

> Status: MITIGATED (issue 1). The daemon that lost its socket path exits within one idle check and removes nothing. The 500 ms probe is unchanged.


(a) Code. 799 `getServerHealth({timeoutMs:500})` returns null on timeout (search-client.js:221-230). The code's own comments say a loading or busy daemon cannot be told from none by a short /health probe: search-client.js:336-341 ("a /health probe with a short timeout cannot") and main.rs:1600, 1631.

(b) Sequence. D1 is bound and loading, or busy with a long synchronous stretch in the single event loop. A spawner that does not use `isServerListening` (search-cli.js:284-288 spawns on every `isServerRunning()==false`, which includes "starting"; prewarm 2.2; ensureDaemonForProjectRoot) starts D2. D2's probe times out after 500 ms, so D2 unlinks D1's live socket and binds. Same ending as 2.1.

(c) Guards: none after the probe. Rust `ready_server` and shared.mjs do avoid spawning while connectable, which is why this is rarer than 2.1.

Unverified: how long `searcher.init` and long queries block the event loop in practice (not traced). Rate stays SUSPECTED for that reason.

(e) Fix: same as 2.1 (exclusive start claim, or connect-probe before unlink; a successful connect means "defer", whatever /health says).


#### D4. The maintainer bound to the pid file stops while the daemon is loading or after FAILED  (CONFIRMED mechanism; impact depends on load time)

> Status: FIXED in this pass (issue 1). The pid file exists from the bind on.


(a) Code. The daemon launches the maintainer at 1599 with `daemonPidFile: pidFile` before the pid file exists (written at 1569). Maintainer: `daemonGoneLongEnough` with grace 120 s (index-maintainer.mjs:1076, 1362-1371); on timeout `stopRequested = true; shutdownRequested = true` ("no successor"). Also a stale pid file of a SIGTERMed or SIGKILLed daemon whose pid was reused keeps a maintainer alive (`daemonPidFileLive` is `kill -0` only, line 1107-1116).

(b) Sequence. Large repo or loaded machine: init takes more than 120 s from the maintainer's start (READY_BUDGET in Rust is also 120 s and the code calls loads of tens of seconds normal). Pid file missing for 120 s -> maintainer exits and does not respawn itself. The daemon only relaunches on the next query response via supervision (1434-1454) or the 60 s timer backstop that needs `everQueried` (1657-1659). So the index is not refreshed until the first query after load; edits made while loading are missed until then.

(c) Guards: supervision restarts on the next query (mitigates, so impact is a freshness gap not a permanent loss). FAILED daemons never write the pid file, so a maintainer started by a FAILED daemon exits after 120 s (acceptable).

(e) Fix: write the pid file immediately after bind (and keep it for the whole daemon life); then I2 holds in every state and 2.2 shrinks too. Make the write atomic (tmp+rename) so a reader never sees an empty file.


#### D5. No SIGTERM handler: the documented "exits cleanly (G4 SIGTERM handler)" does not exist for the search daemon  (CONFIRMED)

> Status: FIXED in this pass (issue 1).


(a) Code. Only `process.on('SIGINT', ...)` at search-server.js:1604; core/cli.js and start-server.js install none; `git log -S SIGTERM -- core/search/search-server.js` is empty, so it never existed. rss-budget.mjs:15 says the evicted daemon "exits cleanly (G4 SIGTERM handler)" and `runEvictionTick` sends SIGTERM (382). The search daemon registers itself with the coordinator (search-server.js:830-831, kind 'search').

(b) Sequence. Fleet RSS crosses the budget -> coordinator SIGTERMs the longest-idle daemon (or the user runs `kill <pid>`, or a harness kills by pid) -> Node's default action ends the process at once. In-flight requests get ECONNRESET ("closed the connection", search-client.js:24-26); socket file, `.grep` socket and pid file stay.

(c) Guards: stale socket files are recovered by the next daemon's unlink and by clients (ECONNREFUSED -> Gone); the registry prunes dead pids. So the damage is limited to dropped in-flight calls and stale files, but it breaks the stated shutdown invariant (I3) and the pid-reuse hazard in 2.4/2.6 rests on the stale pid file this leaves.

(e) Fix: `process.on('SIGTERM', () => gracefulShutdown('sigterm'))`, installed before the first await of `startServer` (SIGINT is only installed after bind, so a SIGINT during import also takes the default path).

(f) Test: spawn the real entry in a temp project (or unit-test by extracting the handler registration) and `kill -TERM`; assert pid and socket files are gone.


#### D6. RSS-budget coordinator can SIGTERM an unrelated process that reuses a dead daemon's pid  (SUSPECTED; outside the files listed, found through the daemon registration)

> Status: OPEN (issue 8).


(a) Code. `pruneRegistry` keeps an entry when `pidAlive(entry.pid)` and it is not older than boot (rss-budget.mjs:322-345); unlike daemon-registry.js:247 it does not probe the socket. A search daemon that dies by SIGKILL/OOM/SIGTERM (2.5) never calls `unregister`, and the registry is pruned only by a live daemon's 30 s tick.

(b) Sequence. Daemon X dies uncleanly, no other daemon runs for hours (so nobody prunes), the OS reuses X's pid for an editor or browser helper, a new daemon starts, its first tick prunes nothing (pid alive), X's entry has the oldest `lastActivityMs`, fleet is over budget -> `process.kill(pid,'SIGTERM')` hits the unrelated process.

(c) Guards: boot-age filter (covers reboots only), the registry trust checks (cover hostile files, not reuse), `kill -0` accepts it.

Unverified: how often macOS/Linux pids recycle within one boot on the user's machine, and the default-ON condition of the coordinator (isEnabled not read). Fix: store and compare the process start time (or the socket /health pid) before signalling.


#### D7. Resident-daemon cap registry: lost update, and a dropped entry never comes back  (CONFIRMED mechanism; only when SWEET_SEARCH_MAX_DAEMONS is set)

> Status: OPEN (issue 16).


(a) Code. `upsertSelf`/`touchSelf`/`removeSelf` are read-modify-write with no lock (daemon-registry.js:189-211); the atomic rename protects file integrity only. `touchSelf` returns false when its entry is missing (198) and nothing re-upserts. `pruneAndList` drops any entry whose /health (500 ms) fails (247, 254-255), including a daemon that is merely busy.

(b) Sequence. D1 and D2 start together: both read `{}`, D1 writes {D1}, D2 writes {D2}; D1's entry is lost. Or: D1 is busy for more than 500 ms while D2 runs `enforceDaemonCap`; D1's entry is pruned and written out. In both cases D1's later `touchSelf` is a no-op, so D1 stays outside the registry for its whole life. It is then never evicted by the cap and not counted, so the cap is exceeded.

(c) Guards: documented as best-effort (header of daemon-registry.js); cap is default OFF; the RSS coordinator is a separate registry.

(e) Fix: `touchSelf` re-inserts the full entry when absent (pass the entry, not just the timestamp); serialise writes with the same `wx` lock-file pattern used in prewarm.


#### D8. `serverReady` is set before the pid file write; a write failure turns a loaded daemon into FAILED  (SUSPECTED, low)

> Status: FIXED in this pass (issue 1). The pid file write is outside the load's try block.


(a) Code. 1568 `serverReady = true;` then 1569 `await fs.writeFile(pidFile, ...)` inside the same try whose catch sets `initError = err` (1578-1582).
(b) Sequence. The pid file path is unwritable (directory of `SWEET_SEARCH_PID_FILE` missing, or `/tmp/sweet-search-<hash>.pid` owned by another user). Index loads, /health then reports `status:'failed'` (initError is checked first, 1344) although `serverReady` is true; Rust `ready_server` replaces it once, the new daemon stops it (801-808), same failure again, final message "could not load this project".
(c) No guard. Needs an unwritable pid path, so rare. Fix: write the pid file in its own try/catch, or before `serverReady`.


#### D9. No crash-loop back-off; a daemon that dies during load is invisible in the start history  (CONFIRMED absence, SUSPECTED impact)

> Status: OPEN (issue 16).


(a) Code. `recordDaemonStart` is called only when load ends (1571, 1582); nothing reads `daemon-starts.jsonl` to delay a spawn (only setup-status.js). Rust ss-* spawns once per call (agent_tools.rs:518-522), JS up to twice per call (shared.mjs:381).
(b) Sequence. The daemon is OOM-killed or aborts at init every time (the repo has such crash reports, daemon-heap.js header). Each ss-* call spawns a fresh daemon (heavy imports, partial index load), it dies, the call falls back in-process. `sweet-search status` shows few starts because dying starts are never recorded, so the WSL "many starts" hint (setup-status.js:268) is also blind to it.
(e) Fix: write a "start begun" line at spawn (`ok:null`) and update it at the end; refuse to spawn when N unfinished starts exist in the last minute (use the in-process path instead).


#### D10. Old daemon's late unlink during stop-then-start (restart, idle exit meeting a new call)  (SUSPECTED)

> Status: FIXED in this pass (issue 1).


(a) Code. Same lines as 2.1: listener closes at 926, then searcher.close, queryEncoder.close, `rssRegistration.unregister()`, unlinks at 933-938. A /stop's own connection or any in-flight request can hold `closeServerGracefully` for up to 3 s (899-910). The Rust `daemon_stop` treats ECONNREFUSED as done (main.rs:1764-1771) and `daemon restart` spawns at once (1797-1800); the JS failed-daemon path does the same (801-808 waits for refusal only).
(b) Sequence. t0 old daemon closes its listener. t0+ε client sees Gone and spawns D2. D2 reaches bind at t0+~1-2 s. Old daemon finishes teardown at t0+3 s and unlinks D2's socket and pid file.
(c) Guards: none; the 3 s grace is the only delay on the old side. Unverified: whether the /stop request's own keep-alive connection counts as idle at `closeIdleConnections()` (it makes the wait 0 or 3 s), and the real duration of `searcher.close()` on a large index.
(e) Fix: same inode and pid ownership check as 2.1; unlink the socket before the slow teardown or not at all.


#### D11. Rust `ready_server` waits the full 120 s when a failed daemon cannot be replaced  (SUSPECTED, low)

> Status: OPEN (issue 16).


(a) Code. In the `Failed` arm with `Some(old) if old == pid => {}` (main.rs:1701) nothing checks `child.try_wait()`. The new daemon returns without binding when the old failed daemon does not exit within 5 s (search-server.js:805-808).
(b) Sequence. Failed daemon with a stuck teardown (in-flight request) -> new daemon exits at once -> client keeps polling until `READY_BUDGET`, then prints "did not become ready within 120 s" instead of the real reason.
(e) Fix: in the `Failed` same-pid arm, if our child exited, fail immediately with the log tail.


### Checked and safe

- Registry file torn or half written: tmp file is per pid, `fs.rename` is atomic, reader parses whole document or returns `{}` (daemon-registry.js:170-187, 154-167). Same in daemon-starts.js:19-24 (and a torn line is skipped on read, 33-37).
- Hostile or foreign registry: `registryTrustworthy`/`dirTrustworthy` reject symlinks, other owners, group/world-writable (87-115); tested in tests/search/daemon-registry-trust.test.js.
- Registry entry from a previous boot naming a reused pid: `entryPredatesBoot` (137-143, used at 242) for the cap registry; the cap registry also requires a 200 from /health (247), so a reused pid with no daemon socket is dropped. (The RSS registry lacks the second guard: 2.6.)
- Double or concurrent shutdown: `shuttingDown` latch (894, 915); `/stop` racing idle TTL and two /stop requests are tested (daemon-lifecycle.integration.test.js:208, 242).
- Health probes keep an idle daemon alive: `lastActivityMs` is set only on query routes (877-879, 1017, 1040, 1288, 1308, 1328); test at daemon-lifecycle.integration.test.js:195.
- Maintainer double spawn from startup vs supervision: one `supervisionState` and a retryable/settled split (1398-1417, 1449); lock-guarded launcher.
- Request before ready: /search returns 503 `starting` unless grep mode and grepReady (1041-1048); read-semantic and trace wait up to 10 s (852-858, 1296, 1316); /read needs no index (475-481); agent-tool waits 60 s and returns 503 so the Rust client runs in-process (daemon-route.js:103-120, agent_tools.rs:543-548).
- Run is never repeated after it started: status 500 prints and exits (agent_tools.rs:549-552).
- Wrong-project daemon: per-project hash socket plus `projectRoot` check on read/read-semantic/trace and `assertProjectRoot` (daemon-route.js:122-127, 409 responses). Rust and JS hash derivation share FNV-1a (server-identity.js:33, main.rs:24-37).
- Stale socket file with no listener: Rust connect gives ECONNREFUSED -> Gone -> spawn (main.rs:1633-1639); JS recovers by unlink at 1520; prewarm `socketResponsive` requires a connect (181-202).
- Rust `ready_server` when its own child exits because another daemon won the race: one more probe after 200 ms (1709-1719), and `auto_start_server_for` re-checks the socket after child exit (1587-1591).
- JS client double spawn while the first daemon still loads: `!isServerListening()` plus a 60 s gap (shared.mjs:381), and a failed daemon is replaced only once (370-375).
- Prewarm lock stale or mid-write: empty holder file means back off, dead holder means steal with a second `wx` (230-257); tested (session-daemon-prewarm.test.js:307-343).
- Daemon detaches from the caller's session: `setsid` in Rust (main.rs:1565-1570), `detached:true` in JS (search-client.js:402, prewarm 289); SIGHUP from a closing terminal does not reach it.
- WSL keep-alive outliving the daemon: loop ends within 15 s when `/proc/<pid>` is gone, also after a hard kill (wsl-keepalive.js:45); `stop()` is best-effort.
- pid reuse for prewarm health: needs pid alive AND socket connect (205-213), so a reused pid alone does not suppress a spawn.
- Wait-loop clock edges: all deadlines use `Date.now()`/`Instant` (monotonic in Rust); a backward wall-clock step in JS (`waitForServerExit`, `ensureDaemonForProjectRoot`, `autoSpawnServer` counts waited ms by adding intervals) only lengthens a wait.
- Heap ceiling: both spawners pass `--max-old-space-size` from the same formula (daemon-heap.js, main.rs:1442).


## 7. Index maintainer process

Ids in this section: state machines `MT-SM<n>`, findings `MT<n>`. The text below is the subsystem audit as written at the baseline commit; inside it, "F2" means MT2; "SM-4" means MT-SM4.


Scope: launch, lock, supervision, scheduling, shutdown of the index maintainer. Read-only audit.
All paths are relative to the repository root. Line numbers are from the files as read on 2026-11-10.
Short names: LAUNCHER = core/indexing/maintainer-launcher.mjs, MAINT = core/indexing/index-maintainer.mjs,
WATCH = core/indexing/maintainer-watcher.mjs, RECON = core/incremental-indexing/application/production-reconciler.mjs,
MWORK = core/incremental-indexing/application/maintenance-worker.mjs, MHAND = .../maintenance-handlers.mjs, OPCLI = .../operator-cli.mjs.


### State machines

#### MT-SM1. Maintainer process lifecycle (implicit; no single variable)

Where the state lives: it is not stored in one place. It is the product of (a) the lock file `index-maintainer.lock` (state-files.mjs:11),
(b) the OS process table, (c) module flags in MAINT: `shutdownRequested` (MAINT:77), `stopRequested`, `recycleForRss`, `watchdogEngaged`,
`teardownFinished` (MAINT:1258-1263, 1561-1569), `signalsSeen` (MAINT:1332), (d) the pause file (SM-4).

States (all implicit):
- ABSENT: no process, lock missing or dead holder.
- LAUNCHING: parent has called `spawn` (LAUNCHER:306); child is loading modules; no lock yet. Lasts about 0.3-2 s. Invisible to every probe.
- LOCK_EMPTY: child created the lock with O_EXCL and has not written it yet (MAINT:343-356). Microseconds.
- STARTUP: lock held. Temp sweep, worktree GC, ORT arming, watcher start, RSS registration (MAINT:1160-1293). SIGTERM handler NOT installed yet (installed at MAINT:1349).
- RUNNING_TICK: inside `runReconcileV2Tick` / `drainMaintenanceInline` (MAINT:1439-1444).
- RUNNING_SLEEP: inside `sleepWithProgress` (MAINT:690-715), slices of at most 30 s.
- DORMANT: tick returns `{skipped}` because baseline is not ready (MAINT:486-497). Same loop, no work.
- STOPPING(reason): `shutdownRequested` true. Reasons: signal, idle-TTL (MAINT:1309), daemon gone (MAINT:1361), lock lost (MAINT:1385), pause (MAINT:1429), root gone (MAINT:1418), lifecycle abort (MAINT:1509), RSS recycle (MAINT:1504).
- TEARDOWN: `finally` block (MAINT:1543). Watcher close, registry unregister, model unload, each bounded 5 s (MAINT:838, 859).
- HANDOFF: only when `recycleForRss && !stopRequested` (MAINT:889, 1668). Lock already released; successor spawned and confirmed 750 ms (MAINT:847, 933).
- EXITED_CLEAN: lock unlinked by `releaseStateLock`.
- CRASHED: process dead, lock file remains (SIGKILL, OOM, power loss, SIGTERM before handler installed).
- WEDGED: process alive, heartbeat and progress both older than 180 s (MAINT:49, 380-381).

Invariants the code relies on:
- I1. At most one process ticks per state dir. Enforced by O_EXCL create (MAINT:343) plus `stillOwnsLock` checks at every progress checkpoint (MAINT:435-445) and at loop top (MAINT:1385).
- I2. A process never unlinks a lock it does not own (MAINT:211-215, 401-409, 303-311).
- I3. A stop request dominates a recycle (MAINT:889-891).
- I4. Artifacts are published by rename or SQLite transaction, so a hard exit at any point is recoverable (comment at MAINT:1064-1069).
- I5. A launcher may spawn a doomed extra process; the lock makes it exit (LAUNCHER:14-27).

Transitions:

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| ABSENT | launcher/supervisor decides to spawn | not opted out, entry exists, state dir exists, not paused, `maintainerAlive` false | LAUNCHING | detached node, log fd, nice via `applyBackgroundPriority` | LAUNCHER:273-336 |
| LAUNCHING | child reaches `acquireStateLock`, EEXIST, holder alive and fresh | heartbeat fresh or progress fresh | EXITED_CLEAN (lost race) | logs "Another ... running", returns | MAINT:382-391, 1156-1159 |
| LAUNCHING | O_EXCL create succeeds | - | LOCK_EMPTY then STARTUP | `lockState` set, JSON written | MAINT:343-358 |
| LAUNCHING | EEXIST, lock unparseable | any | (steals) | `unlinkSync(lockFile)`, retry | MAINT:361-365 |
| LAUNCHING | EEXIST, holder pid dead | `isPidRunning` false | (steals) | unlink, retry | MAINT:366-371 |
| LAUNCHING | EEXIST, holder alive, both stamps stale | - | (steals) | SIGTERM holder, wait 5 s, unlink if still same pid/token/startTime | MAINT:392-395, 287-312 |
| STARTUP | signals installed, loop entered | - | RUNNING_TICK | heartbeat interval 30 s, daemon-follow interval | MAINT:1326-1376 |
| RUNNING_* | loop top: lock not ours | `!stillOwnsLock` | STOPPING(lock lost), `stopRequested=true` | no successor | MAINT:1385-1391 |
| RUNNING_* | loop top: state dir or root gone | `stateDirGone` | STOPPING(root gone) | maybe delete worktree index | MAINT:1418-1427, 1640 |
| RUNNING_* | loop top: pause holds | `isReconcilePaused().paused` | STOPPING(paused) | no successor | MAINT:1428-1437 |
| RUNNING_TICK | `onProgress` checkpoint | `shutdownRequested` or lock lost | STOPPING(abort) | sweep temps with maxAge 0 | MAINT:435-445, 1509-1531 |
| RUNNING_TICK | tick throws other error | - | RUNNING_SLEEP | logs ERROR; interval unchanged; processing queue stays | MAINT:1532 |
| RUNNING_TICK | tick done, RSS over ceiling | ceiling>0, rss>ceiling, uptime>=10 min, ticks>=1 | STOPPING(recycle) | `recycleForRss=true` | MAINT:1493-1506, rss-budget.mjs:206 |
| RUNNING_SLEEP | SIGTERM/SIGINT | - | STOPPING(signal) | wake sleep, 10 s exit deadline; second signal exits now | MAINT:1333-1348 |
| RUNNING_* | idle timer | `idleTtlExceeded` | STOPPING(idle) | `stopRequested=true` | MAINT:1309-1319 |
| RUNNING_* | daemon-follow timer | daemon absent >= 120 s | STOPPING(daemon gone) | `stopRequested=true` | MAINT:1361-1374 |
| STOPPING | loop exits | - | TEARDOWN | clear intervals; watchdog armed only if recycle | MAINT:1543-1593 |
| TEARDOWN | steps finish | `!watchdogEngaged` | EXITED_CLEAN | `releaseStateLock`, `process.exit(0)` | MAINT:1627-1689 |
| TEARDOWN | watchdog fires at 20 s | recycle, not finished | HANDOFF (from timer) | release lock, handoff, exit | MAINT:1570-1592 |
| TEARDOWN | recycle and no stop | `shouldHandOffAfterRecycle` | HANDOFF | `launchMaintainer` after lock release, confirm 750 ms, retry once | MAINT:1668-1683, 976-1057 |
| any | SIGKILL/OOM | - | CRASHED | lock stays; `.processing` queue stays; temp files stay; bg build child orphaned | - |
| CRASHED | next launcher | `pidAlive` false | ABSENT | lock reclaimed by next acquire | LAUNCHER:222, MAINT:366-371 |

#### MT-SM2. Lock file `.sweet-search/index-maintainer.lock`

State lives in the file (JSON: pid, timestamp, startTime, ownerToken, progressCounter, progressTimestamp; MAINT:348-355) and in the module variable `lockState` (MAINT:203).
States: ABSENT, EMPTY (between O_EXCL create and write, MAINT:343-356; also between `ftruncate` and `write` of every rewrite, MAINT:242-243), HELD_FRESH, HELD_STALE_HEARTBEAT_ONLY, HELD_STALE_PROGRESS_ONLY, HELD_STALE_BOTH, DEAD_HOLDER, CORRUPT.

Decision tables (three readers use different rules):
- acquire (MAINT:331-399): null -> unlink; dead pid -> unlink; fresh+fresh -> refuse; heartbeat stale + progress fresh -> refuse; progress stale (heartbeat fresh or not) -> SIGTERM + steal.
- launcher probe `maintainerAlive` (LAUNCHER:216-239): pid alive AND newest of the two stamps < 180 s. A missing/corrupt lock = not alive.
- index-run hold (LAUNCHER:465-470): reads pid only; SIGTERM if `pidAlive`. No stamp check.
- operator status (OPCLI:158-171): pid alive only.

Invariants: I1, I2. Owner token + pid + startTime compared before every unlink (MAINT:303-311) and before every rewrite (MAINT:238).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| ABSENT | O_EXCL create | - | EMPTY then HELD_FRESH | write JSON | MAINT:343-358 |
| HELD_FRESH | heartbeat timer 30 s | `stillOwnsLock` | HELD_FRESH | `ftruncate(0)` then `write`; passes through EMPTY | MAINT:1326-1328, 232-252 |
| HELD_FRESH | `recordProgress` at each checkpoint | owner matches | HELD_FRESH | same truncate+write | MAINT:272-277 |
| any | owner exit | pid and token match | ABSENT | unlink | MAINT:401-409 |
| EMPTY (observed by other) | candidate acquire | read gives null | ABSENT (by candidate) | candidate unlinks it | MAINT:361-365 (see F2) |
| HELD_STALE_BOTH | candidate acquire | holder alive | ABSENT | SIGTERM, 5 s grace, unlink only if lock unchanged | MAINT:287-312 |
| DEAD_HOLDER | candidate acquire | `isPidRunning` false | ABSENT | unlink | MAINT:366-371 |

#### MT-SM3. Dirty queue and `.processing` queue

Files: `index-maintainer-queue.jsonl` (DIRTY_QUEUE) and `index-maintainer-queue.processing.jsonl` (PROCESSING_QUEUE), state-files.mjs:7-8.
Writers: watcher (WATCH:98-108, same process as the consumer), dirty scan (dirty-scan.mjs:318, same process), `index --add` CLI (OPCLI:367-379, other process), worktree bootstrap (worktree-index.mjs:473, other process), reconciler requeue (RECON:849-862, 683-688).
Consumer: RECON `readDirtySet` (RECON:633-773). Removers: `persistManifest` (RECON:1609), `persistUnchanged` (RECON:1551), `releaseEmptyTick` (RECON:380), `reconcile reset` (OPCLI:318-333).

States, by file existence (implicit): Q0 (neither), Q1 (queue only), Q2 (processing only), Q3 (both).

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| Q0/Q2 | watcher/scan/CLI append | - | Q1/Q3 | `appendFileSync` | WATCH:107, dirty-scan.mjs:318 |
| Q1 | tick starts | processing absent | Q2 | `renameSync(queue, processing)`; then read processing | RECON:639-647 |
| Q3 | tick starts | processing exists | Q3 | queue NOT merged; processing re-read | RECON:639 |
| Q2/Q3 | slice too large | rels > 2*filesPerTick | Q3 | tail appended back to queue, offsets remembered | RECON:679-689 |
| Q2/Q3 | tick publishes | manifest persisted | Q1 or Q0 | unlink processing | RECON:1609 |
| Q2/Q3 | tick fails | - | stays | processing kept; requeued tail removed again | RECON:871-897 |
| Q2/Q3 | all unchanged | - | Q1/Q0 | unlink processing | RECON:1551 |
| any | `reconcile reset` | - | Q0 | unlink both | OPCLI:318-333 |

Invariants: a path appended to the queue is either in a later `processing` read or in the current one; rename is atomic; the consumer is the only process that renames.

#### MT-SM4. Pause file `reconcile-pause.json`

Writers: `holdMaintainerForIndexRun` (link, holderPid=process.pid; LAUNCHER:428-436, 487), `reconcile pause` (OPCLI:335-347, tmp+rename, field `pid`, no `holderPid`), index-codebase-v21.js:186. Readers: launcher, supervisor, maintainer loop, operator status.
States: ABSENT, HELD_BY_PROCESS(holderPid alive), HELD_NO_HOLDER (frozen index, `reconcile pause`), STALE_HOLDER (holderPid dead), EXPLICIT_RESUMED (`paused:false`), UNREADABLE (reads as not paused, LAUNCHER:374-377).
Rule `pauseHolds` (LAUNCHER:390-393): holds unless `paused===false` or holderPid dead. Operator status ignores holder liveness (OPCLI:213-224).

| from | event | guard | to | where |
|---|---|---|---|---|
| ABSENT | index run hold | link succeeds | HELD_BY_PROCESS | LAUNCHER:435, 487-503 |
| HELD_BY_PROCESS (other) | index run hold | holder alive | wait up to 10 min, then `blockedBy` | LAUNCHER:444-455 |
| STALE_HOLDER / UNREADABLE | hold | not `pauseHolds` | ABSENT via `removeStalePause` (rename aside, re-judge, relink if live) | LAUNCHER:440-443, 511-520 |
| HELD_BY_PROCESS | owner release | holderPid === self | ABSENT | LAUNCHER:471-476 |
| any | `reconcile resume` | - | ABSENT | OPCLI:349-359 |
| any | `reconcile pause` | - | HELD_NO_HOLDER (overwrites a holder's pause) | OPCLI:335-347 |
| (maintainer RUNNING) | loop top sees pause | - | STOPPING(paused) | MAINT:1428-1437 |

#### MT-SM5. Spawn claim `maintainer-spawn.claim` and supervision state

State: per-supervisor object `{lastTickMs, launches, lastReason, consecutiveFailures, sawAliveSinceLaunch}` (LAUNCHER:638-640) plus claim file (LAUNCHER:531-602).
States: IDLE, RATE_LIMITED (inside `max(15 s, backoff)`; backoff doubles per unproven launch, cap 15 min; LAUNCHER:655-659), CLAIMING, SPAWNED_UNPROVEN, SPAWNED_PROVEN.

| from | event | guard | to | where |
|---|---|---|---|---|
| IDLE | tick | elapsed >= dueAfter (or clock went backwards) | CLAIMING | LAUNCHER:721-726 |
| CLAIMING | opted out / no state dir / paused | - | IDLE (reason recorded) | LAUNCHER:728-736 |
| CLAIMING | `maintainerAlive` | - | SPAWNED_PROVEN; claim released; failures=0 | LAUNCHER:738-747 |
| CLAIMING | claim held < 5 s | peer owns | IDLE (reason claim-held) | LAUNCHER:749-750, 593 |
| CLAIMING | claim won | previous launch never seen alive | failures += 1 | LAUNCHER:767-769 |
| CLAIMING | `launchMaintainer` spawned | - | SPAWNED_UNPROVEN | LAUNCHER:783-790 |

Daemon call sites: startup (search-server.js:1599), per response after flush (1434-1456, SETTLED_REASONS 1417), 60 s backstop (1657-1659). MCP calls `launchMaintainer` directly with no claim and no backoff, every 15 s per tool call (mcp/server-main.js:166-176). Session prewarm calls it once (session-daemon-prewarm.mjs:375).

#### MT-SM6. Watcher

State: `watcherState` (MAINT:1224): `active`, `pendingEvents`, `forceBackstopWalk`, `lastBackstopWalkMs`, `handle`.
States: OFF (no binding, subscribe failed, env off), WATCHING, OVERFLOW_PENDING (`forceBackstopWalk`), GIT_CHANGED (also maps to overflow, WATCH:236-243), CLOSING.

| from | event | to | side effects | where |
|---|---|---|---|---|
| (start) | `getEventsSince(snapshot)` replay | WATCHING | queue lines | WATCH:201-209 |
| WATCHING | event batch, at least one kept path | WATCHING | append lines, `pendingEvents=true`, wake sleep after 200 ms | WATCH:362-409, MAINT:681-688, 1236 |
| WATCHING | native error / handler throw | OVERFLOW_PENDING | `forceBackstopWalk=true`, `pendingEvents=true` | WATCH:216-225, MAINT:1237 |
| WATCHING | `.gitignore` etc. changed or created dir over 20k files | OVERFLOW_PENDING | same plus policy rebuild | WATCH:403-405 |
| OVERFLOW_PENDING | loop top | WATCHING | flag cleared, full walk this tick | MAINT:1401-1410 |
| WATCHING | close | CLOSING | write FSEvents snapshot, unsubscribe | WATCH:247-259 |

Second, independent watcher: `changed-files-tracker.js` in the search daemon (own subscription, own dirty set; `needFull` on error or more than 256 paths; CFT:63-73). It does not feed the queue; no lock interaction.

#### MT-SM7. Reconcile tick scheduler (in MAINT main loop)

Not a timer: a sequential `await` loop (MAINT:1377-1542), so ticks cannot re-enter. States: TICKING, DRAINING (maintenance), SLEEPING(intervalMs | BACKLOG_TICK_GAP 250 ms), EARLY_WAKE (watcher), STOPPING.
- Interval: `intervalMs` autotuned per tick unless pinned (MAINT:1455-1465, `computeNextIntervalMs` 743-768). Skipped ticks leave it untouched.
- `backlogLeft` = `dirty_paths_deferred > 0` -> 250 ms gap (MAINT:1454, 1536).
- Failure: `ERROR tick failed`, then normal interval. No backoff.
- Idle: `recordIdleTick` counts consecutive ticks with no dirty paths and empty maintenance queue (MAINT:805-815). Skipped (dormant) ticks count as idle.

#### MT-SM8. Maintenance job queue `rebuild-queue.jsonl`

Writers: reconciler via `enqueueMaintenanceJob` (MWORK:100-111, append, coalesced), operator `rebuild force` (OPCLI:540-ish, other process). Consumer: `processMaintenanceQueue` (MWORK:200-282), single rewrite at the end (MWORK:279). Job states: PENDING, RUNNING (in memory), REQUEUED (background build running), RETRY(attempts<3), DEAD_LETTER.
Transitions: handler ok -> removed; `requeue` -> kept without attempt; throw -> attempts+1, kept or dead-lettered at 3 (MWORK:259-276); `MaintainerLifecycleAbort` -> rethrown, queue file NOT rewritten (MWORK:260).

#### MT-SM9. Background maintenance builds (compaction children)

State is a module variable in the maintainer process: `sparseFold` (MHAND:71) and `hnswBuild` (MHAND:184); job fields `{done, result, error, child}` (background-build.mjs:19-35).
States: NONE, BUILDING, DONE_OK, DONE_ERROR. Transitions: handler starts child (MHAND:126, 245) -> BUILDING; child `exit`/message -> DONE_*; next drain publishes or throws. Child is SIGKILLed on a normal exit of the parent (background-build.mjs:33-35). Staged output names are fixed per index: `<name>.compact.idx` (hnsw-compaction.mjs:36), `<base>.next` (sparse-gram-fold.mjs:77).
This is NOT the first-index build. The first index comes from `sweet-search index` and is gated by SM-10.

#### MT-SM10. Baseline readiness gate (first index / format change)

Derived, stateless: `hasCompleteBaseIndex` (baseline-readiness.mjs:123-161). Reasons: no-state-dir, no-manifest, manifest-epoch-zero, no-merkle-state, no-config-fingerprint, config-fingerprint-mismatch, missing-vectors-db, li-format-outdated, ready. Maintainer is DORMANT unless ready (MAINT:485-497). While dormant the watcher still appends to the queue (WATCH:107), the scan and consumer do not run.

#### MT-SM11. Reader heartbeat

Files `.sweet-search/readers/<pid>-<boot>-<readId>.json` (reader-heartbeat.mjs:42-45, written non-atomically at :106). States: PINNED, ENDED (unlinked :124), ORPHAN (pid dead, or boot id differs, or process started after `procStartMs`; :134-146), MALFORMED (read as invalid, unlinked only after 1 h; :182-205). `minLiveEpoch` is the prune frontier (:216).


### Reachable invalid states or transitions

Ranking: F1, F2 are the ones I would fix first. F3-F6 are lower probability or lower impact.

#### MT1. SIGTERM sent to an unrelated process after a maintainer crash (pid reuse) - CONFIRMED (code path); probability low, impact high

> Status: OPEN (issue 8).


(a) Code.
- LAUNCHER:465-470: `pid = Number(JSON.parse(readFileSync(lock)).pid); if (pid && pid !== process.pid && pidAlive(pid)) { process.kill(pid, 'SIGTERM'); ... while (pidAlive(pid) && Date.now() < stopDeadline) await sleep(100) }`. No stamp check, no start-time check.
- MAINT:366 `isPidRunning(existing.pid, existing.startTime)` then MAINT:392-395 `sigtermAndStealLock` -> `process.kill(existing.pid,'SIGTERM')` at MAINT:289. `startTime` is only recorded on Linux (MAINT:114-123 returns null elsewhere), and the check is skipped when null (MAINT:96). On macOS (this machine) pid reuse is not detected at all.

(b) Sequence. Maintainer M (pid 48213) is killed by SIGKILL, OOM kill, or power loss. Lock stays with pid 48213 and a heartbeat older than 3 min. macOS recycles pids; some user process P (shell, editor, `node`) later gets pid 48213.
 - Path 1: the user runs `sweet-search index`. `holdMaintainerForIndexRun` reads the lock, `pidAlive(48213)` is true (P), sends SIGTERM to P, and waits up to 60 s for P to die.
 - Path 2: a new maintainer starts. `acquireStateLock` sees EEXIST, `isPidRunning` true (P), both stamps stale, so it SIGTERMs P and waits 5 s.
 (EPERM for other users' processes makes `isPidRunning` false at MAINT:109, so only same-user processes are hit.)

(c) Guards checked. `maintainerAlive` (LAUNCHER:216) does check stamps, but neither site calls it. The launcher's spawn decision is safe; the signal senders are not. Linux `startTime` guard exists but is Linux-only and skipped when unreadable. `pidAlive` doc says "use a start-time check where that matters" (pid-alive.js:4).

(d) Impact. A random user process gets SIGTERM; an index run stalls 60 s when P ignores SIGTERM and then proceeds without the maintainer being stopped.

(e) Fix. Record `procStartMs` (use `processStartMs` from reader-heartbeat.mjs:149) in the lock on all platforms. Add one helper `lockHolderIsMaintainer(lock)` = pid alive AND start time within 60 s of recorded value AND stamp fresh. Use it before any `process.kill` at LAUNCHER:466 and MAINT:289. In `hold`, skip the kill when the lock stamps are stale.

(f) Test without a daemon. Write a lock file `{pid: process.pid-of-a-sleep-child, timestamp: now-10min, progressTimestamp: now-10min}`; start `sleep 60` as the "innocent". Call `holdMaintainerForIndexRun(tmpDir)` with a stub: assert the child is still alive (today it is killed). Same for `acquireStateLock` (the test can spawn a child that traps SIGTERM and writes a marker).

#### MT2. Lock rewrite exposes an empty file; readers treat empty as "no lock" and the acquirer deletes it - CONFIRMED (steps traced); probability very low per event, impact high (two writers)

> Status: OPEN (issue 14).


(a) Code.
- MAINT:242-243 in `persistLockState`: `ftruncateSync(fd, 0); writeSync(fd, bytes, 0, ...)`. Called by every heartbeat (30 s) and every `recordProgress` (every progress checkpoint, hundreds per tick).
- MAINT:361-365 `const existing = readStateLock(lockFile); if (!existing) { try { unlinkSync(lockFile); } catch {} continue; }`.
- LAUNCHER:234-238 `maintainerAlive` returns false on parse error. LAUNCHER:465 hold reads pid null and skips the SIGTERM.

(b) Sequence. Maintainer A is in a tick, calling `recordProgress` often. Between A's `ftruncate` and `write` (microseconds, but the window recurs hundreds of times per tick), maintainer B (spawned by a supervisor whose `maintainerAlive` also happened to read the empty file, or by MCP/prewarm that never claim) runs `acquireStateLock`: EEXIST, reads empty content, `readStateLock` null, unlinks A's lock, creates its own and starts. A's next `stillOwnsLock` (MAINT:435-445, 1385) sees B and aborts, but A can be inside native work between two checkpoints (ORT batch, HNSW save, SQLite publish) for seconds. A and B then both write the same artifacts. The same empty read in `hold` (LAUNCHER:465) means an index run starts while the maintainer lives.

(c) Guards. Needs two coincident microsecond hits (supervisor misread, then B's read), so per-launch odds are about 1e-5 or less; the empty-read-at-hold case is a single hit. No mtime/age check on an unparseable lock. The O_EXCL create path has the same hole (A empty between create and write, MAINT:343-356) but self-heals because A has not started ticking.

(d) Impact. Two live writers on one index until A reaches a checkpoint: possible corrupt delta/manifest, failed ticks.

(e) Fix. Never create the empty window: overwrite in place with a fixed-width payload (pad JSON with spaces to a constant length, one `pwrite`, no truncate). In `acquireStateLock`, treat an unparseable lock younger than a few seconds (mtime) as "held, retry after 50 ms", and only unlink an unparseable lock older than that. Same rule in `hold`.

(f) Test. Create an empty lock file with fresh mtime; call `acquireStateLock`; assert `acquired:false` and the file still exists (today: acquired). A second test pauses a fake owner between truncate and write using a hook around `persistLockState`.

#### MT3. Wall-clock jump after machine sleep makes a healthy maintainer look wedged; supervisor spawns B; B kills A - SUSPECTED

> Status: OPEN (issue 14).


(a) Code. LAUNCHER:227-233 and MAINT:373-381 use `Date.now() - stamp` against 180 s. The stamps are refreshed by `setInterval` (MAINT:1326) and sleep slices (MAINT:710), which run on the monotonic clock.

(b) Sequence (macOS laptop). Lid closed for 1 h. On wake, `Date.now()` is 1 h ahead; A's timers resume with their remaining monotonic time (up to 30 s), so A has not yet refreshed. The search daemon answers the first query and runs `runSupervisionTick` (search-server.js:1434-1456): `maintainerAlive` false (stale), claim won, spawn B. B reaches `acquireStateLock` in about 1 s: heartbeat and progress both stale, holder alive, so B SIGTERMs A (MAINT:392-395) and steals the lock after 5 s.

(c) Guards. `elapsed < 0` handling only covers a backwards clock (LAUNCHER:716-725). Nothing detects "we just slept".
Unverified: whether A's refresh fires before B's read on a real wake. Depends on libuv timer behaviour across sleep on macOS.

(d) Impact. A healthy maintainer with a warm encoder is replaced after every long sleep; an in-flight tick is aborted (recovered by queue). Cost is latency, not corruption.

(e) Fix. Before declaring stale, re-read the lock after one refresh interval plus margin when the age is far larger than the interval (a jump), or store a monotonic `process.uptime()`-based stamp and compare to the holder's `/proc` or `ps etime`. Simplest: in `acquireStateLock`, if both stamps are stale, wait 2 x LOCK_REFRESH_INTERVAL once and re-read before SIGTERM.

(f) Test. Fake clock: lock stamps 1 h old, holder is a live child that refreshes its stamp 5 s later; assert B does not SIGTERM the child.

#### MT4. Orphaned background compaction child collides with the replacement build on fixed staged paths - SUSPECTED

> Status: OPEN (issue 14).


(a) Code. Child is killed only by `process.once('exit', kill)` (background-build.mjs:33-35); not run on SIGKILL/OOM. Staged paths are fixed: `<name>.compact.idx` (hnsw-compaction.mjs:36), `<base>.next` (sparse-gram-fold.mjs:77). On a fresh maintainer `hnswBuild` is null (MHAND:184), so the queued job runs MHAND:243-245: `discardStagedCompaction(indexPath); hnswBuild = startBackgroundCompaction(...)`.

(b) Sequence. Maintainer M1 starts a long graph build (child C1, nice 19). M1 is SIGKILLed (OOM). C1 keeps running (IPC closed; its final `process.send` throws, MHAND child file lines 26-29). Supervisor starts M2; the job is still queued; M2 deletes C1's staged files and starts child C2 with `snapshotCount` = current size. C1 finishes its `save(staged)` later and writes the staged path that C2 also writes.

(c) Guards. `publishCompactedBase` checks `baseGeneration` (hnsw-compaction.mjs:166) and reads staged header and ids (:169-173), but I did not verify that it checks the staged node count equals the reported `snapshotCount`. If it does not, nodes between C1's and C2's snapshot are silently dropped from the base.
Unverified: whether `save()` writes via temp+rename, and whether `publish` validates the count.

(d) Impact. Possible loss of vectors from the binary index (they stay in codebase.db; the divergence signal `unexplainedDead` may later schedule a rebuild).

(e) Fix. Put the maintainer pid (or a build id) in the staged name; kill orphans: child watches `process.on('disconnect')` and exits; record child pid in a file and kill it in `discardStagedCompaction`.

(f) Test. Start `startBackgroundBuild` in a parent that is then SIGKILLed; assert the child exits within a second (today it continues).

#### MT5. Idle-TTL / daemon-gone exit leaves freshly queued edits unprocessed - SUSPECTED, low

> Status: OPEN (issue 14).


(a) Code. MAINT:1309-1319 sets `stopRequested/shutdownRequested` from a timer; MAINT:1535 `if (shutdownRequested) break;` with no look at the queue. Teardown takes up to several seconds (watcher close 5 s, model unload 5 s; MAINT:838). The watcher is closed first (MAINT:1597), so events after the flag are still appended by the OS callback until close.
(b) Sequence. Maintainer idle for TTL. The user saves a file 1 s before the timer fires. The tick that would handle it has not run; the loop exits.
(c) Guards. Supervision respawns only on the next query (search-server.js:1434-1456; `already-running` was a settled answer at the time, MAINT's exit is not noticed until the 60 s backstop at 1657-1659). `index-freshness.js` reads both queue files, so the staleness is displayed.
(d) Impact. That edit is invisible to search until the next supervised spawn finishes its first tick.
(e) Fix. In the idle timer (and at MAINT:1535), cancel the stop when `statSync(DIRTY_QUEUE).size > 0` or `pendingEvents`.
(f) Test. Unit-test `idleTtlExceeded` wrapper with a non-empty queue file; assert no shutdown flag.

#### MT6. Smaller defects

> Status: OPEN (issue 14).


- F6a. `reconcile status` says "paused" for a stale pause (holder dead) while launcher, supervisor and maintainer treat it as not paused. `pauseSnapshot` (OPCLI:213-224) ignores `pauseHolds` (LAUNCHER:390) and `paused:false`. Impact: operator reads wrong state. CONFIRMED. Fix: reuse `readReconcilePause`. Test: pause file with dead `holderPid`; status must say not paused.
- F6b. Pause held by a crashed index run whose pid is later reused by a long-lived process stays "held" for as long as that process lives (`pauseHolds` uses `pidAlive` only, LAUNCHER:390-393). The index is then unmaintained and no maintainer is spawned. CONFIRMED path, low probability. Fix: store start time in the pause file as in F1.
- F6c. Displaced maintainer sweeps ALL staging temps with `maxAgeMs: 0` (MAINT:1520) after a "lock ownership lost" abort. The successor's in-flight `*.tmp.<pid>`, `*.json.tmp` files are matched (artifact-temp-sweep.mjs:56-60), so its next rename can fail with ENOENT and its tick fails once; the next tick retries. SUSPECTED, low. Fix: skip the age-0 sweep when the abort reason is "lock ownership lost".
- F6d. `processMaintenanceQueue` rewrites the queue with `writeFileSync` (truncate then write, MWORK:43-47). An `rebuild force` from the CLI landing between `appendedQueueTail` (MWORK:279) and the write, or between truncate and write, is lost or overwritten; a kill mid-write loses all pending jobs. Jobs are regenerated by watermarks next tick, so impact is small. CONFIRMED path, very low.
- F6e. Reader heartbeats are created with `writeFileSync` (reader-heartbeat.mjs:106) and read by `liveReaders` without retry (:180). A read in the middle gives a parse error, the reader is dropped from `minLiveEpoch`, and a GC job could prune rows that reader pins. Window is microseconds; SUSPECTED, very low.


### Checked and safe

- Two launchers at once. The O_EXCL create (MAINT:343) admits one; the loser exits (MAINT:1156). The claim file only reduces wasted spawns (LAUNCHER:531-602, "NOT airtight" by design). Hard-link create makes the claim appear whole (LAUNCHER:538-558). FIFO/symlink at the claim path is refused (LAUNCHER:576-579).
- Zombie or reused pid at probe time. `maintainerAlive` requires a fresh stamp (LAUNCHER:216-239). (The signal senders are the gap: F1.)
- Takeover racing a successor. `sigtermAndStealLock` re-reads and compares pid, token and startTime before unlink (MAINT:303-311). Three acquire attempts (MAINT:341).
- Displaced maintainer clobbering the successor's lock. Rewrites go through an fd after an owner check (MAINT:232-252); heartbeat is guarded by `stillOwnsLock` (MAINT:1327); loop top and every checkpoint exit on lost ownership (MAINT:1385, 435-445, 698-700); release matches pid and token (MAINT:211-215, 401-409).
- SIGTERM mid-tick. Handler wakes the sleep, the tick aborts at the next checkpoint, a 10 s deadline forces exit (MAINT:1333-1348, 1069). A second signal exits at once. Artifacts are renames or SQLite transactions, uncommitted tick rolls back (RECON:444, 611-621). Persist order HNSW then SQLite COMMIT then tombstones is crash-tolerant by design (RECON:566-576).
- SIGTERM before the handler exists (STARTUP). Default action kills the process; the lock stays with a dead pid and is reclaimed by the dead-pid branch (MAINT:366-371).
- SIGTERM during recycle. `shouldHandOffAfterRecycle`, `shouldAbort` before each spawn and after confirmation (MAINT:889, 997, 1018). Watchdog and normal path cannot both own shutdown (`watchdogEngaged`, MAINT:1569, 1633). Spawn happens after lock release (MAINT:1635 then 1669). Successor env pins absolute root and state dir (MAINT:914-920). Registry unregister is skipped on handoff (MAINT:1614).
- Re-entrant ticks. The loop is a sequential await (MAINT:1377-1542); idle and daemon timers only set flags.
- Pause written while a tick runs. `hold` SIGTERMs the lock owner and waits up to 60 s (LAUNCHER:464-470). A maintainer spawned in the check-to-spawn window finds the pause at loop top (MAINT:1428) and stops. A pause is exclusive between holders via hard link (LAUNCHER:487-503) and stale removal re-judges the moved file (LAUNCHER:511-520). Pause temp file removed by the age-0 sweep falls back to O_EXCL create (LAUNCHER:493-500).
- Queue rotation, in-process writers. Watcher callbacks and `readDirtySet` share one event loop; rename and read are synchronous back to back (RECON:639-647), so an in-process append cannot land between them. Cross-process appenders (`index --add`) have a microsecond open-to-write window in which a line could go into the already-read `.processing` file and be unlinked at publish (RECON:1609). I judge this not worth a fix; a fix would be to re-read `.processing` size before unlink and requeue the tail.
- Failed tick and retry. `.processing` stays on disk and is re-read (RECON:639, 871-877); the requeued tail is removed again (RECON:879-897); repeated per-file failures are quarantined until the file changes (RECON:804-836).
- Watcher overflow and git changes. Both set `forceBackstopWalk` and `pendingEvents` (MAINT:1237, WATCH:216-243); an overflow during a tick leaves the flag set for the next loop (cleared only at MAINT:1408).
- Own writes re-triggering the watcher. State dir is first in native ignore plus a prefix guard (WATCH:116-120, 377).
- Maintenance job coalescing and dead letter. Retried jobs never coalesce (MWORK:82); abort leaves the queue untouched so jobs rerun (MWORK:260).
- Daemon exits while maintainer lives. Maintainer stops after 120 s without a live daemon (MAINT:1076, 1361-1374). Reverse: daemon supervision respawns on the next query or 60 s backstop (search-server.js:1434-1456, 1657-1659). Hot-loop spawning is bounded by backoff up to 15 min (LAUNCHER:655-659) and by `sawAliveSinceLaunch` (LAUNCHER:767-769).
- Disabled/dormant. `SWEET_SEARCH_RECONCILE_V2=0` stops launch and run (LAUNCHER:273, MAINT:1729). Baseline gate keeps ticks from building a first index (MAINT:485-497).
- Removed worktree. Start and loop check for a missing root/state dir before any write (MAINT:1137-1147, 1418-1427).

Unverified items I could not close without running code: libuv timer behaviour across macOS sleep (F3); `save()` temp+rename and `publishCompactedBase` count validation (F4); whether `bootIdStub` (reader-heartbeat.mjs:64-78) stays stable on macOS across sleep (it derives from `os.uptime()`; if uptime excludes sleep, every reader pin would read as a different boot after a sleep and be ignored by `minLiveEpoch`).


## 8. Incremental reconcile pipeline

Ids in this section: state machines `R-SM<n>`, findings `R<n>`. The text below is the subsystem audit as written at the baseline commit; inside it, "F3" means R3; "SM-2" means R-SM2.


Scope: one changed file from "dirty" to "indexed", and the epoch manifest that commits a tick.
Paths are relative to `core/`. `PR` = incremental-indexing/application/production-reconciler.mjs, `R` = incremental-indexing/application/reconciler.mjs, `IM` = indexing/index-maintainer.mjs.
Read-only audit. Nothing was run. Every claim comes from reading the code.

Files read in full: R, PR, production-reconciler-helpers, production-li-delta, dirty-scan, tombstone-injector, manifest, dirty-set, file-state-store, json-file, vector-delta-writer, sparse-gram-delta, grep-corpus-state, changed-files-tracker (skim), hcgs-invalidation (header), hashing (header). Partly read: admission-policy (isOversizedAbs only), incremental-tracker (symbol list only), path-filter, sqlite-fts5, chunk-identity, encoder-input, reconcile-counters (not needed for state analysis).
Notes: `tombstone-injector.mjs` is a benchmark harness, not part of production reconcile. `hcgs-invalidation.mjs` has no importer in core/ or scripts/ (dead module). `incremental-tracker.js` / `changed-files-tracker.js` belong to the full-build path, not to the tick.


### State machines

#### R-SM1. Per-file state (implicit)

Where it lives. There is no per-file state variable. The state is encoded in:
- file `index-maintainer-queue.jsonl` (DIRTY_QUEUE) and `index-maintainer-queue.processing.jsonl` (PROCESSING_QUEUE): existence and line content (PR:633-647, state-files.mjs:8-9);
- `file-state.db` table `files` (path, hash, size, mtime_ns, inode, epoch, chunk_ids, li_skip) (file-state-store.mjs:30-47). Row present = "indexed"; row absent = "unknown/deleted";
- `file-state.db` table `grep_files` (grep-only files);
- `index-maintainer-failures.json` (FILE_FAILURES) path -> {count,size,mtimeMs,error} (PR:48, 824-836). Row with count >= 2 = "quarantined";
- in-memory adapter sets for one tick: `_retireSet`, `_grepOnly`, `_grepKeep`, `_freshRels`, `touched`, `_statRefresh`, `_grepTouched` (PR:311-324). The adapter is built per tick (`createProductionReconciler` in `runProductionReconcileTick`, PR:284-289), so these never leak across ticks.

States (derived):

| State | Encoding |
|---|---|
| CLEAN | file-state row hash == disk hash, stat equal; not in any queue |
| DIRTY-QUEUED | path in DIRTY_QUEUE (scan: dirty-scan.mjs:315-318; watcher; CLI; requeue) |
| CLAIMED | path in PROCESSING_QUEUE (rename of queue, PR:639-641) |
| ADMISSION-CHECKED | in `live` of readDirtySet; classified embed / retire / grep-only / dropped (PR:753-771) |
| DROPPED-INADMISSIBLE | never indexed and inadmissible: not in `live` (PR:766) |
| QUARANTINED | failures[rel].count >= 2 and stat unchanged (PR:804-821) |
| HASHING | `adapter.hashFile` (PR:939-968): reads stat, then bytes |
| UNCHANGED | contentHash == file-state hash (PR:966, R:320-324); only stat refresh queued in `_statRefresh` |
| IN-FLIGHT | `inFlightFile` set (R:325) |
| STAGED | graph/vector rows in open tx; sparse delta line appended; HNSW adds in `ctx.pendingAdds`; file in `ctx.persistedFiles` (PR:1334) |
| TIER-PERSISTED | after finalizeTick: HNSW delta fsynced, SQLite COMMITted, LI appended (PR:516-606) |
| PUBLISHED | manifest renamed (manifest.mjs:123) |
| COMMITTED (merkle) | file-state `files` row written with epoch = manifest.epoch (PR:1585) |
| DELETED/RETIRED | file-state row deleted (PR:1581); rows retired at epoch |
| FAILED | tick threw; processing queue stays; failures count + 1 only if IN-FLIGHT (R:445-447) |
| DEFERRED | beyond budget: requeued to DIRTY_QUEUE with source 'requeue' (R:352-364, PR:849-862) |

Invariants the code relies on:
- I1. The file-state row is the advance authority. It is written only after the manifest rename (PR:1557 then 1576-1599). A file whose row is old is "changed" again after a crash.
- I2. hashFile takes stat before read (PR:954-957), so an edit after the read leaves stat != stored stat and the scan re-finds it.
- I3. PROCESSING_QUEUE is removed only by publish (PR:1609), `persistUnchanged` (PR:1551) or `releaseEmptyTick` (PR:380).
- I4. Rows written by a tick carry `epoch_written = epoch` and become visible only when the manifest names `epoch` (manifest.mjs:179-186).
- I5. A tick that fails never advances the manifest, so `nextEpoch()` returns the same number again (R:234-237; `_lastEpoch` is set only after publish, R:414).

Transition table:

| From | Event | Guard | To | Side effects | Where |
|---|---|---|---|---|---|
| CLEAN | stat differs / new file | scan, `!queued.has(rel)` | DIRTY-QUEUED | append line `source:'scan'` | dirty-scan.mjs:237-240, 311-318 |
| CLEAN | watcher/CLI hint | none | DIRTY-QUEUED | append to queue | (watcher in IM) |
| DIRTY-QUEUED | tick start | PROCESSING absent and queue exists | CLAIMED | rename queue -> processing | PR:639-641 |
| DIRTY-QUEUED | tick start | PROCESSING exists (earlier failed tick) | DIRTY-QUEUED (waits) | new queue lines are NOT read until a publish removes PROCESSING | PR:639 |
| CLAIMED | readDirtySet | rels beyond 2x filesPerTick | DIRTY-QUEUED (tail) | same entries re-appended to queue, offset recorded | PR:679-689 |
| CLAIMED | admission | exists, shape, size, gitignore, minified ok | ADMISSION-CHECKED (embed) | none | PR:741, 756-757 |
| CLAIMED | admission fails, file-state has row | | ADMISSION-CHECKED (retire) | `_retireSet` | PR:758-761 |
| CLAIMED | admission fails, grep-eligible | | grep-only | `_grepOnly` | PR:762-764 |
| CLAIMED | admission fails, not indexed, not grep | | DROPPED-INADMISSIBLE | line vanishes with PROCESSING at publish | PR:766 |
| ADMISSION-CHECKED | `_dropQuarantined` | failures count >= 2 and stat unchanged | QUARANTINED (dropped) | none; if stat changed the failure row is deleted | PR:804-821 |
| live | loop | files_processed >= filesPerTick, or budget, or `cursor > lastFresh` | DEFERRED | requeue tail | R:312-314, 352-364 |
| live | hashFile | hash == file-state hash | UNCHANGED | `_statRefresh` | R:320-324, PR:899-903 |
| live | hashFile | file missing or in `_retireSet` | IN-FLIGHT (delete) | `deleted:true` | PR:947-949 |
| live | hashFile throws | any exception (EACCES, EISDIR, ENOENT race) | FAILED, nobody blamed | none | R:318 before R:325 |
| HASHING | reconcile one file | | IN-FLIGHT -> STAGED | graph rows, vector rows (tx open), HNSW add ops, LI ops, sparse delta line | R:468-527 |
| IN-FLIGHT | any tier throws | | FAILED | `recordFileFailure` count+1 (same stat) | R:442-447, PR:824-836 |
| STAGED | finalizeTick ok | | TIER-PERSISTED | see SM-3 | PR:516-606 |
| STAGED | finalizeTick throws | | FAILED | ROLLBACK both SQLite tx; HNSW delta/float store/sparse line stay | PR:582-589 |
| TIER-PERSISTED | publish | | PUBLISHED then COMMITTED | file-state row written; failure row deleted; PROCESSING removed | PR:1554-1609 |
| FAILED | next tick | PROCESSING still on disk | CLAIMED again | same entries re-read | PR:639, 647 |
| COMMITTED | delete on disk | | DIRTY-QUEUED -> retire -> DELETED | all tiers tombstoned, `importsFile` edges to it retired | PR:947-949, 1066-1068 |

#### R-SM2. Dirty queue (two files)

States: EMPTY, QUEUED (queue only), CLAIMED (processing only), BOTH (processing + queue).
- enqueue: `fs.appendFileSync(DIRTY_QUEUE)` (scan, requeue, watcher).
- claim: rename queue -> processing, only if processing absent (PR:639-641).
- ack: unlink processing at publish / persistUnchanged / releaseEmptyTick (PR:1609, 1551, 380). There is no per-entry ack.
- re-enqueue on failure: none needed; processing stays. `requeueDirtyFilesAfterFailure` only removes the tail this tick appended (PR:871-897). If processing is gone it appends (PR:876).
- `DirtySet` class (dirty-set.mjs) is the in-memory watcher set, drained once per call (dirty-set.mjs:119-126). It is not a durable queue; overflow drops the oldest (dirty-set.mjs:76-86) and relies on the scan backstop.

Invariant: BOTH is reachable and legal. New entries sit in the queue file while processing exists.

#### R-SM3. Reconcile run (tick) and the commit order across stores

Variables: `Reconciler._running` (R:180), `_lastEpoch` (R:179), per-tick `epoch` (R:253), adapter `_tickCtx`/`ctx.txOpen` (PR:451), `manifestPublished` (R:259).

States: IDLE -> READ-DIRTY -> (EMPTY-RETURN | BEGIN) -> FILE-LOOP -> REQUEUE-TAIL -> FINALIZE -> (UNCHANGED-RETURN | PUBLISH) -> MAINTENANCE-SCHEDULED; any state -> ROLLBACK/FAILED via catch (R:442-456) and `finally` disposeTick (R:461).

Write order for one tick with k files (the multi-store sequence):

| Step | Store | Durable? | Visible to readers pinned at N-1? | Where |
|---|---|---|---|---|
| 0 | codebase.db and code-graph.db: `BEGIN` (held for the whole tick) | - | - | PR:444-445 |
| 1..k, per file | code-graph.db rows (epoch_written=N, old rows epoch_retired=N), tx open | no | no (and invisible by predicate) | PR:1043-1160 |
| | codebase.db vectors rows + FTS rows, tx open | no | no | PR:1216-1224 |
| | HNSW ops only accumulated in `ctx.pendingAdds`, stale marks in memory | no | no | PR:1348-1377 |
| | LI ops accumulated; tombstones deferred | no | no | PR:1379-1409 |
| | sparse-gram delta line appended to `codebase-sparse-grams.idx.deltas/N-0.ssgrmdelta`, no fsync, NOT transactional | file written | not listed in manifest, but see F3 | PR:1477-1501, sparse-gram-delta.mjs:94-111 |
| F1 | HNSW delta append (fsync) or first flat base | yes | readers that scan the delta file directly may see it | PR:541-547 |
| F2 | float store save | yes | - | PR:552-565 |
| F3 | `COMMIT` codebase.db, then `COMMIT` code-graph.db (two commits, not atomic together) | yes | no, by epoch predicate | PR:568-572 |
| F4 | stale bitmap flush | yes | readers of the stale file see ghost hiding at once | PR:575 |
| F5 | LI tombstones persisted | yes | LI readers see them at once | PR:576 |
| F6 | LI alias pointer drops | yes | | PR:577 |
| F7 | LI segment append (segment file, segments/manifest.json, stub json) | yes | LI readers see new docs at once | PR:578-581, production-li-delta.mjs appendGrowingSegment |
| P1 | fsync sparse segments | yes | | PR:1555 |
| P2 | `reconcile-manifest.json` rename (COMMIT POINT for epoch readers) | yes | all readers move to N | PR:1557, manifest.mjs:110-133 |
| P3 | file-state.db tx: files rows, grep rows, failure rows | yes | | PR:1576-1599 |
| P4 | merkle-state.json header (epoch, lastIndex, totalFiles) | yes (no fsync) | | PR:1607 |
| P5 | unlink PROCESSING_QUEUE | | | PR:1609 |
| P6 | metrics line | | | PR:1614 |

Crash after step X: what the next run and readers see, and whether it is repaired.

| After | Disk state | Reader | Next tick | Repaired? |
|---|---|---|---|---|
| step k, before F1 | SQLite WAL uncommitted -> rolled back; sparse lines orphaned in N-0 | old epoch, intact | PROCESSING replays; epoch N again | SQLite yes. Sparse orphans stay (F3) |
| F1 done, before F3 | HNSW delta has ids `...@eN.i`; SQLite rolled back | old epoch; HNSW has extra nodes | same epoch N, same ids; `appendDelta` skips ids already present | partly (F7) |
| between the two COMMITs | codebase.db committed, graph rolled back | old epoch (predicate hides N rows) | file still changed; graph redone; vectors match -> reuse; torn-row repair re-adds HNSW/LI | yes: PR:1290-1320 |
| after F3, before F4..F7 | rows committed, ghost HNSW/LI docs of retired rows not hidden, new LI docs missing | old epoch | torn-row repair re-adds new rows; retire ops for old rows are NOT re-emitted (rows no longer in `snap`) | new rows yes; ghosts wait for compaction (documented at PR:573) |
| after F7, before P2 | all tiers done, manifest old | old epoch sees LI changes early | replay; reuse; repair re-adds (HNSW skip, LI retire+add) | yes |
| after P2, before P3 | manifest N, file-state old | new epoch | replay (hash != row); `_publishedEpoch` reads merkle header (N-1) so epoch-N rows count as torn and are re-added | yes, wasteful |
| after P3, before P4 | header epoch N-1, file-state new; `totalFiles` header stale | | works | totalFiles drifts (minor) |
| after P4, before P5 | everything done, PROCESSING left | | files unchanged -> `persistUnchanged`, no epoch | yes |

#### R-SM4. Manifest epoch

State: `reconcile-manifest.json` { epoch, publishedAt, codeGraph, vectors, binaryHnsw, lateInteraction, sparseGram{base,deltas,weightsId,epoch} } (manifest.mjs:11-31, 144-164).
Other writers of the same file: maintenance-handlers.mjs:160 (sparse handler rewrites `deltas` at the same epoch), indexing/indexer-manifest.js:68 (full build).
Rules: `nextEpoch = max(manifest.epoch+1, _lastEpoch+1)` (R:234-237). Empty tick and all-unchanged tick publish nothing (R:273-281, 386-395). `writeManifest` uses one fixed temp name `reconcile-manifest.json.tmp` (manifest.mjs:44-45, 116).

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| N | tick with >= 1 processed file | publish succeeds | N+1 | R:400-414 |
| N | tick fails before P2 | | N (next tick reuses N+1) | R:442-457 |
| N | idle or all-unchanged tick | `currentEpoch() > 0` | N | R:273, 386 |
| N | `readManifest` JSON parse error | | reads as "no manifest" -> epoch 0 | manifest.mjs:90-97, R:224-229 |
| N | maintenance sparse handler | list differs | N (content changed, epoch same) | maintenance-handlers.mjs:150-161 |

Monotonic in the normal path. Regression possible only through the unreadable-manifest path (F6).

#### R-SM5. Per-file failure counter

`failures[rel]` = {size, mtimeMs, count, error}. Transitions: tick throws while `inFlightFile` set -> count+1 if stat equal else 1 (PR:828-831). count >= 2 -> quarantine (PR:91, 817). Edit (stat change) -> row deleted (PR:812-815). Successful publish of that file -> row deleted (PR:1578). File gone -> row deleted at next readDirtySet (PR:812-815, `!now`). No decay by time, no reset by success of other files.

#### R-SM6. Resident process caches (PR:57-90)

`residentFileSets`, `residentResolvers`: keyed by merkle header `lastIndex`. Another writer moving `lastIndex` (full build, a second reconciler) invalidates the set (PR:62-66, 70-72). Guarded.


### Reachable invalid states or transitions

Ranked by impact and confidence.

#### R1. One unreadable queued file freezes the whole index forever (hashFile errors are never blamed)   CONFIRMED

> Status: FIXED in this pass (issue 3).


(a) Code.
- `R:318  const hashes = await this.adapters.hashFile(file);` runs BEFORE `R:325  inFlightFile = file;`.
- The catch blames only `inFlightFile` (R:445-447). So an exception from `hashFile` (PR:956-957 `statTuple`, `fs.readFileSync`) is not counted.
- Admission checks existence, shape, size, gitignore, minified (PR:724-741; `isOversizedAbs` is `statSync` only, admission-policy.js:231-237). Nothing checks that the file is readable.
- On a tick error the maintainer only logs and sleeps (IM:1533 `log('ERROR', 'Reconcile v2 tick failed ...')`, then the loop sleeps and ticks again). No backoff, no failure memory.
(b) Sequence.
1. A file `secrets.py` (or any admitted extension) has mode 000 or is root-owned and unreadable. (Also: a path that became a directory after queueing; on Windows/WSL a locked file.)
2. The dirty scan enqueues it (stat works). Tick T1: PROCESSING = [..., secrets.py, ...].
3. `hashFile` throws EACCES. Files before it in the list were hashed and staged but nothing publishes. SQLite rolls back. `_tryRequeueDirtyAfterFailure` sees PROCESSING on disk and removes only its own tail (PR:871-877).
4. Next tick (after `intervalMs`): processing still exists, so the claim does not run (PR:639). Same list, same throw. Repeat forever.
5. Every new edit lands in DIRTY_QUEUE and is never claimed (the queue is renamed only when processing is absent).
(c) Guards checked: `_dropQuarantined` (needs a failure row; none is written), `recordFileFailure` (only IN-FLIGHT), `releaseEmptyTick` (needs `dirty.length===0`), the maintainer catch (log only). None stops it.
(d) Impact: incremental indexing is dead for the project until the file is fixed or `reconcile reset` is run by hand. Searches return stale results. Log shows the same error every interval. Files hashed earlier in the same list are redone each tick.
(e) Fix: set `inFlightFile = file` before `hashFile` (R:318), or wrap `hashFile` in its own try/catch that calls `recordFileFailure` and `continue`s. Better: treat EACCES/EISDIR/EBUSY as "skip and count" inside `hashFile`.
(f) Test: temp project + stateDir, valid baseline, `chmod 000 bad.js` plus a good changed file in the queue, run two ticks with a stub adapter set whose `hashFile` throws for `bad.js`; assert the good file is published and `bad.js` reaches count 2. (Reconciler unit test with injected adapters is enough: `hashFile` throws on the first file.)

#### R2. A transient infrastructure failure permanently quarantines an innocent file (two strikes, no decay)   CONFIRMED

> Status: FIXED in this pass (issue 3). A quarantined file now gets one retry every 30 minutes. The failure is still counted against the file in flight.


(a) Code. `R:445-447` blames `inFlightFile` for ANY error from `_reconcileOneFile`, including shared causes (encoder child crash/timeout in `applyVectorDelta` PR:1211, HNSW load, SQLITE_BUSY, disk full). `PR:828-831` count+1 when stat equals. `PR:817 return f.count < QUARANTINE_AFTER_FAILURES` (2). The row clears only on a stat change (PR:812-815) or a successful publish of that file (PR:1578).
(b) Sequence.
1. Edit F (stat S). Encoder child is down for two consecutive ticks (model reload, memory kill, RSS recycle gap).
2. Tick 1: F is first in the list; `vectorEncoder` throws; F gets count 1. Tick 2: same; count 2 (log line "failed 2 ticks in a row", PR:833-835).
3. Tick 3 (encoder healthy): `_dropQuarantined` removes F from `live`. F is never indexed. The dirty scan keeps re-enqueueing it each scan and the tick drops it each time.
4. Each further 2 ticks of outage quarantines one more file.
(c) Guards: none distinguishes "this file is bad" from "the tick is bad". The only exit is another edit to F.
(d) Impact: files changed by `git pull` or branch switch (not edited by hand afterwards) stay stale in vector/graph/LI tiers with no user-visible signal except one WARN line.
(e) Fix: count a failure against the file only when the error is thrown by file-local work (parse/graph extract) or re-run the same file alone once the tick infrastructure is healthy; or expire the row after a time window (store `at` is already saved, PR:831) and retry quarantined files once per hour.
(f) Test: adapter stub whose `applyVectorDelta` throws for the first N calls regardless of file; run 4 ticks; assert no file is quarantined while the third tick succeeds with all files.

#### R3. Sparse-gram delta records of a failed tick leak into the next published epoch (stale grep overlay after an edit is reverted)   CONFIRMED mechanism; needs a revert

> Status: OPEN (issue 9).


(a) Code.
- `PR:1487-1495 appendDeltaRecord(base, epoch, {...}, {sync:false})` runs per file inside the file loop, outside any transaction. File name is `{epoch}-0` (sparse-gram-delta.mjs:76, 106-108) and `epoch` is the unpublished N+1.
- A failed tick leaves that file. The next tick has the same epoch (I5) and appends to the SAME file.
- Readers take the whole file listed by the manifest (search-pattern-sparse-overlay.js:341-357, sparse-gram-delta-reader.js:60-100: last record per fileId wins, read in file order).
- UNCHANGED branch: `R:320-324` + `PR:966` + `PR:899-903` write no sparse record.
(b) Sequence.
1. F is indexed with content A (file-state hash = hash(A)).
2. User edits F to B. Tick T1 (epoch N+1) processes F, appends record(F, grams of B) to `N+1-0`. Another file G in the same tick throws (or the daemon gets SIGTERM and the progress hook throws `MaintainerLifecycleAbort`, IM:435-444). SQLite rolls back; manifest stays N; PROCESSING stays.
3. User reverts F to A (undo, git checkout, stash).
4. Tick T2 (epoch N+1 again): PROCESSING replays [F, G]. F hashes to hash(A) == file-state hash -> UNCHANGED, no sparse record. G processes; its sparse record is appended to the same `N+1-0`; the tick publishes N+1 and lists `N+1-0` (PR:1500).
5. Readers at N+1 read `N+1-0`: record(F, B) is the latest for F. The overlay hides F's base postings and uses B's grams.
(c) Guards checked: manifest listing (the file is listed because it also holds G's record), `maxEpoch` filter (the epoch equals N+1, so it passes), `_statRefresh` (stat refresh makes the scan stop re-enqueueing F, PR:1593-1596). Nothing removes the orphan line. Only a later edit of F or a sparse fold (maintenance rebuilds the base from disk) repairs it.
(d) Impact: `ss-grep` misses text that exists in A but not in B for file F; lines that exist only in B may still be reported as candidates (line verification probably filters those, unverified). Silent until the next fold.
(e) Fix: stage sparse records in memory (or in a `.pending` file named by tick) and append them in `persistManifest` just before the manifest rename; or write them to a per-attempt segment name (`{epoch}-{attemptSeq}`) and, at tick start, delete or retire segments with epoch > published manifest epoch.
(f) Test: temp project with a sparse base; adapter that throws on file G after F is processed; revert F; run tick again; read `resolveLatestRecords` and assert F's record matches A. Unit level: call `applySparseGramDelta` for F with epoch 2, do not publish, then run a tick at epoch 2 with F unchanged; list overlay.

#### R4. The operator command `reconcile tick` runs a second reconciler with no lock and no pause check   CONFIRMED (guard absent); consequences SUSPECTED

> Status: OPEN (issue 12).


(a) Code. operator-cli.mjs:509-515 calls `runProductionReconcileTick` directly. It checks only the baseline gate. The in-process guard `R:247-249` says "single-instance enforced by lockfile", but the lock lives in `IM` (`index-maintainer.lock`, state-files.mjs:14) and `runProductionReconcileTick` (PR:284-289) never takes it. `verifyStartup` checks only the worktree stamp (R:207-218).
(b) Sequence.
1. Maintainer daemon is running. User runs `sweet-search ... reconcile tick` (or a script does).
2. Both read manifest epoch N and compute epoch N+1 (R:234-237).
3. Both claim/read the same PROCESSING queue (the CLI sees processing present and reads it; or the CLI renames the queue just before the daemon).
4. codebase.db: the daemon holds the write transaction for the whole tick (BEGIN at PR:444, no busy_timeout set; better-sqlite3 default is 5 s). The CLI blocks, then throws SQLITE_BUSY. `recordFileFailure` blames its in-flight file (F2 path) and bumps its quarantine counter. Or, when the daemon tick is short, the CLI finishes after the daemon published N+1: the CLI still holds `epoch = N+1` and publishes a second manifest with epoch N+1. Readers key their reload on epoch change, so the second commit (rows, HNSW delta, LI) does not trigger a reload.
5. Both write `reconcile-manifest.json.tmp` (fixed name): interleaved writes can rename a mixed file into place (see F6).
(c) Guards checked: `_running` (per object), maintainer lock (not taken), pause file (`isReconcilePaused` is checked only in IM:1427). Not guarded.
(d) Impact: quarantine of an innocent file, duplicate epoch number, possibly a corrupt manifest.
(e) Fix: take `index-maintainer.lock` (or a short `reconcile-tick.lock`) in `runProductionReconcileTick`, refuse when a live daemon holds it, and honor the pause file.
(f) Test: temp stateDir with a fake live lock file (pid = test pid); call `runProductionReconcileTick`; assert it refuses. For the epoch case: two adapter instances over one stateDir, run tick A to completion between B's `nextEpoch()` and B's publish, assert B's manifest epoch > A's.

#### R5. Delete then re-create (across two ticks) leaves importers' `importsFile` edges retired forever   CONFIRMED

> Status: OPEN (issue 10).


(a) Code. `PR:1066-1068`: on `hashes.deleted`, `UPDATE relationships SET epoch_retired = ? WHERE type = 'importsFile' AND target_name = ?`. `importsFile` rows are created only when the IMPORTING file is extracted (graph-extractor.js:1218-1254). The re-resolve helper excludes them (`type != 'importsFile'`, helpers:108, 125). No other code re-adds them (grep of `importsFile` in core/).
(b) Sequence.
1. B imports A (`importsFile` B -> A live).
2. `git checkout other-branch` deletes A (B is identical on both branches, untouched). Tick 1: A is missing -> retire; B's edge to A retired at epoch N.
3. `git checkout -` restores A. Tick 2: A is processed as new; its entities are re-resolved (`newNames`). B is not in the queue (its stat did not change), so B's `importsFile` edge is never re-created.
(c) Guards: none. The edge stays retired while A is live again.
(d) Impact: the maintained graph differs from a fresh full build (the file-import map used for call disambiguation, relationship-resolver.js:1325-1378). Trace/call-graph answers lose import-based disambiguation for B until B is edited or a full build runs. Moderate.
(e) Fix: on create of a file (not in file-state), enqueue or re-extract live files that have an `importsFile` row (retired at the last delete) pointing at it; or do not retire `importsFile` on delete and instead filter by target existence at read time.
(f) Test: temp project with a.js and b.js (`import './a'`); full baseline; delete a.js, tick; restore a.js, tick; query `relationships` for `type='importsFile' AND source_id=<b> AND epoch_retired IS NULL`; compare with a fresh build.

#### R6. Epoch can go backwards if the manifest is unreadable   SUSPECTED

> Status: OPEN (issue 9).


(a) Code. `manifest.mjs:90-97` returns null on any parse error and the comment promises "the next reconcile tick rebuilds it from the per-tier artifacts". The code does not do that: `R:224-229` returns epoch 0, `nextEpoch` returns 1, `previous = zeroManifest({})` (R:400-406). `_lastEpoch` is per process. A single fixed temp name (manifest.mjs:44-45, 116) lets two concurrent writers (F4, full build, maintenance sparse handler) rename a mixed file.
(b) Sequence. Manifest at epoch 5000 is corrupted -> next tick publishes epoch 1 with empty sparse `deltas`. Readers pin epoch 1: rows with `epoch_written > 1` are invisible (manifest.mjs:179-186).
(c) Unverified: whether any real writer can produce a corrupt file (the single-writer daemon cannot; F4 or a manual edit can) and how readers treat a drop from 5000 to 1.
(d) Impact: near-empty index for epoch-predicate readers until a full build.
(e) Fix: in `currentEpoch()` fall back to `max(manifest.epoch, merkle header epoch, max(epoch_written) in vectors)` and refuse to publish a lower epoch than the merkle header; use `tmp.<pid>` for the manifest temp name as json-file.mjs does.
(f) Test: write garbage to the manifest in a temp stateDir with a header epoch 7; run a tick; assert the published epoch is > 7 or the tick refuses.

#### R7. A retried tick reuses the epoch, so HNSW delta ids repeat and `appendDelta` keeps the old vector   SUSPECTED

> Status: OPEN (issue 9).


(a) Code. Encoded rows are named `${chunk.id}@e${epoch}.${i}` (PR:1214); the id is positional (`file:ls-le:index`, chunk-embed-text.js:50-54). `appendDelta` skips ids already in the index (binary-hnsw-index.js:977-980, "Ids already live in the index are skipped"). Staged adds are appended before the SQLite COMMIT (PR:541-543) and fsynced. The progress hook at PR:548 and 563 can abort on shutdown.
(b) Sequence. Tick T1 (epoch N+1) appends HNSW delta for `f.js:10-20:0@e(N+1).0`, then aborts before COMMIT (shutdown or `flushFloatStore` failure). SQLite rolls back. User edits a line inside chunk 10-20 (line range unchanged). Tick T2 reuses epoch N+1, re-encodes the chunk with a new embedding and the same id. SQLite stores the new embedding; HNSW keeps the node with the OLD embedding (the id already exists). The same applies to the float store row if applyDelta upserts by id (not verified).
(c) Unverified: that `index.load` reads the failed tick's delta back (very likely: `_loadDelta`), and the float-store upsert semantics.
(d) Impact: vector search ranks that chunk by stale text until compaction or the next edit. Narrow window.
(e) Fix: make a failed tick not reuse epochs (persist a high-water mark `attemptedEpoch` in merkle header and start at `max(manifest, attempted)+1`). This also fixes F3 naming.
(f) Test: stub index with `appendDelta` spy; run finalize, throw after append, edit chunk text, run again; compare HNSW code for the id with the SQLite embedding.

#### Lower-confidence notes (not counted as findings)
- Readers see LI tombstones, LI new docs and the stale bitmap as soon as F4-F7 finish, before P2. Vector rows are epoch-gated but LI/HNSW are not. A reader pinned at N-1 can lose an LI doc of a chunk whose vector row it still sees, for seconds. (Reader pin side belongs to the other auditors.)
- `totalFiles` in the merkle header is a running count; a crash between P3 and P4 leaves it off by the tick's net adds (PR:1575-1607). Only status output uses it (not verified).
- Sparse segments with epoch > manifest epoch (orphans from F3) are consumed by the merge handler, which names the merged segment `{maxEpoch of ALL segments}-{seq}` (sparse-gram-delta.mjs:303-307). Readers pinned at the older epoch then drop that segment (epoch filter, sparse-gram-delta-reader.js:30). Hand-off to the compaction auditor; needs a no-publish tick between the failed tick and the merge to trigger.
- `INSERT OR REPLACE` in the vector insert (indexer-build.js:385) would silently replace a row with the same id from a post-COMMIT failed tick (same epoch, same positional id). The retire op for the old row and the add op for the new row then carry one id.


### Checked and safe

| Race / crash | Guard | Where |
|---|---|---|
| File edited again while its tick runs | stat taken BEFORE read; stored stat = pre-read stat; scan compares stat; new hint goes to DIRTY_QUEUE, not PROCESSING | PR:954-957, 1585; dirty-scan.mjs:189-192 |
| Unlinking PROCESSING loses a hint | hints append to the queue file, which is a different file; the rename creates a fresh queue | PR:639-641, 1609 |
| Fresh edit stuck behind a backlog | fresh-first ordering, requeue entries re-classed fresh when edited after queueing, `lastFresh` early publish | PR:656-673; R:305-314 |
| Deferred tail duplicated on every failed tick | `_requeued` offsets; `_dropRequeuedTail` removes only own bytes | PR:849-897 |
| Crash between SQLite COMMIT and manifest publish leaves vectors in SQLite but missing from HNSW/LI | torn-row repair by `epoch_written > merkle.epoch`; `appendDelta` skips present ids; LI retire+add | PR:1290-1320; binary-hnsw-index.js:977 |
| Crash between the two SQLite COMMITs | file-state not advanced; graph redone; vectors reused | PR:568-572, 1576-1599 |
| Rows visible to readers before the manifest names the epoch | `epoch_written <= :manifestEpoch AND (epoch_retired IS NULL OR > :manifestEpoch)`; in-place epoch bump avoided (reuse rows untouched, versioned rows for text/metadata change) | manifest.mjs:179-186; vector-delta-writer.mjs:203-222 |
| Per-file crash between HNSW add and stale flush hides live rows | stale marks flushed last; a crash leaves ghosts, never hidden live rows | PR:573-575; helpers:188-218 |
| Two ticks in one process | `_running` flag | R:247-250 |
| Idle ticks publish epochs and reload every artifact | empty and all-unchanged ticks publish nothing | R:273-281, 386-395 |
| Torn manifest write | tmp + fsync + rename + dir fsync | manifest.mjs:110-133 |
| File deleted between existsSync and read | next tick sees it missing and retires it (self-heals) | PR:947-949 |
| Delete then re-create inside ONE batch | hashFile reads disk once; file exists -> processed as modify; deleted -> retired; the re-create hint is a new queue line | PR:947-968 |
| Rename | old path retires, new path indexed as new; chunk ids are path-based so no reuse, no duplicates | PR:947-949, 1214 |
| Quarantine row for a deleted file lingers | `!now` branch deletes it | PR:810-815 |
| Duplicate lines after crash with tail already requeued | duplicates are harmless: unchanged files cost one hash | PR:647-673 |
| Resident path set stale after another writer | keyed by header lastIndex | PR:61-84 |
| File-state per-file rows promoted for a file whose HNSW adds were not persisted | `persisted` gate (in practice every non-deleted file is in the set) | PR:1567, 1584, 1334 |
| Old text visible to readers after a text-only edit with reused embedding | new row version + retire old at epoch | vector-delta-writer.mjs:233-245, 280-308 |
| Worktree mixing | stamp verified at startup | R:207-218 |


## 9. Index artifact maintenance and the reader side

Ids in this section: state machines `S-SM<n>`, findings `S<n>`. The text below is the subsystem audit as written at the baseline commit; inside it, "F4" means S4; "SM2" means S-SM2.


Scope: segment merge, compaction, GC, tombstones, temp sweep, reader pins, reader reload.
Read-only audit. Nothing was executed. All line numbers are from the working tree at HEAD d01eeb88.
Paths are relative to the repository root.

Short architecture facts the rest relies on:
- One writer process (index maintainer, lock at core/indexing/index-maintainer.mjs:331). A tick runs, then `drainMaintenanceInline` runs the queue jobs one at a time (index-maintainer.mjs:1440-1443, maintenance-worker.mjs:200). So two maintenance jobs never overlap inside one maintainer. Only the two background child builds (HNSW graph, sparse fold) run beside ticks.
- Readers are other processes (ss daemon, CLI) and the native grep lane. They never take the lock.
- Reconcile epoch (reconcile-manifest.json `epoch`) is bumped only by a tick. Maintenance jobs (LI merge, LI segment recompaction, HNSW compaction, sparse fold or merge) change files WITHOUT bumping the epoch. Readers notice them only by file identity (HNSW index file, sparse base) or not at all (LI).
- Two different "keep old files for readers" mechanisms exist: (a) reader heartbeats + epoch frontier, used ONLY by vector GC and graph GC; (b) a fixed 60 s wall-clock grace, used by LI segments (`LI_MERGE_GRACE_MS`, li-segment-merge.mjs:50) and sparse delta segments (`DELTA_DELETE_GRACE_MS`, sparse-gram-delta.mjs:52). Heartbeats do not protect (b) at all.


### State machines

#### S-SM1. LI (late-interaction) segment lifecycle

State lives in files (all implicit, no state variable):
- `<li>.segments/manifest.json` (`segments[]`, `nextSeq`, `totalDocuments`), written by `writeJsonAtomic` (json-file.mjs:17, tmp `.tmp.<pid>`, no fsync) in merge and by `fs.writeFileSync(.tmp)+rename` in the per-segment handler (maintenance-handlers.mjs:341-343).
- `segment-NNNN.bin` and `segment-NNNN.bin.stale.bin` (tombstone bitmap, positional by docIndex).
- `pending-delete.jsonl` quarantine journal (li-segment-merge.mjs:66, 107-111, plain `writeFileSync`, truncating, not atomic).

States of one segment file F:
1. ABSENT
2. WRITTEN_UNLISTED (file exists, manifest does not list it; "orphan candidate")
3. LISTED_GROWING (newest, receives adds)
4. LISTED_SEALED (count >= LI_SEGMENT_SIZE, immutable)
5. LISTED_WITH_STALE (sealed or small, has a `.stale.bin` with bits set)
6. RETIRED_QUARANTINED (not listed, named in journal, file still on disk)
7. DELETED

Transitions:

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| ABSENT | `_writeSegmentFile(tmp)` then rename (merge) | none | WRITTEN_UNLISTED | new name from `nextSeq` | li-segment-merge.mjs:285-297 |
| ABSENT | `_writeSegmentFile(final)` (per-segment recompaction) | none | WRITTEN_UNLISTED | `_writeSegmentFile` itself writes tmp+rename (late-interaction-index.js:223 comment) | maintenance-handlers.mjs:331-333 |
| WRITTEN_UNLISTED | manifest publish | none | LISTED_* | `nextSeq` bumped in the same manifest | li-segment-merge.mjs:299-305, maintenance-handlers.mjs:335-343 |
| WRITTEN_UNLISTED | next `mergeLiSegments` run | file not in manifest, not in journal | DELETED immediately (no grace) | orphan sweep | li-segment-merge.mjs:153-173 |
| LISTED_* | merge picks it (count < segmentSize, size-tiered) | `small.length >= 2` | RETIRED_QUARANTINED | journal entry `{retiredAtMs, paths}` after manifest publish | li-segment-merge.mjs:260-319 |
| LISTED_WITH_STALE | `li_segment` job | bitmap exists, popcount > 0, live docs > 0 | RETIRED_QUARANTINED (+ new file LISTED) | new name, old file and sidecar quarantined | maintenance-handlers.mjs:273-353 |
| RETIRED_QUARANTINED | `sweepQuarantine` | `now - retiredAtMs > graceMs` (60 s default) | DELETED | unlink; journal rewritten | li-segment-merge.mjs:127-143 |

Invariants relied on: single writer; positions in `.stale.bin` are valid only for the file with the same name (hence new names, never rewrite in place, maintenance-handlers.mjs:327-330); segment names never reused (`nextSeq`); a reader reads the manifest, then files named in it, and finishes within the grace.

Reader side: `LateInteractionIndex._loadSegmented` reads the segment manifest once, then loads all segments sequentially into memory/mmap (late-interaction-index.js:2122-2172). Per query it only stats `<seg>.stale.bin` (late-interaction-index.js:1439-1465). The reader reloads LI only when the RECONCILE epoch changes (sweet-search.js:606-650, `shouldReloadArtifacts`).

#### S-SM2. Binary HNSW base + delta + compaction

State lives in files, with one journal:
- `<idx>` (header has random `generation`), `<idx>.delta` (header generation, append-only records), `<idx>.stale.bin` (positional bitmap, no generation tag), `<name>.fullvec.bin/.map` (generation in both).
- Compaction staging: `<name>.compact.idx` (+ its fullvec files), `<idx>.delta.next`, `<idx>.stale.bin.next`, journal `<idx>.compact.json` (hnsw-compaction.mjs:35-43).
- In memory: `hnswBuild` (maintenance-handlers.mjs:184) for the background graph build.

States:
- S0 STEADY (base G1 + delta G1 + stale bitmap for G1 numbering)
- S1 DELTA_GROWING (ticks append delta rows, `appendDelta`, hnsw-delta-file.js:140-165)
- S2 BUILD_RUNNING (child builds staged base from first `snapshotCount` nodes; ticks continue)
- S3 STAGED (staged base ready; `delta.next`, `stale.next` written)
- S4 JOURNALED (journal on disk, steps in progress)
- S5 SWAPPED (journal removed; base G2, delta G2 or none, bitmap renumbered)

Transitions:

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| S0/S1 | handler runs, dropped>0 or delta>0 | liveCount <= `hnswGraphMin` | S3 inline | flat staged build | maintenance-handlers.mjs:243-250 |
| S0/S1 | handler runs | liveCount > `hnswGraphMin` | S2 | `discardStagedCompaction`, fork child, `requeue` | maintenance-handlers.mjs:243-247 |
| S2 | child exits | `done`, no error | S3 then S4 | `publishCompactedBase` | maintenance-handlers.mjs:207-221 |
| S2 | publish | `baseGeneration` equals current base generation | continue | else `discardStagedCompaction`, `skipped: base-replaced` | hnsw-compaction.mjs:164-168 |
| S3 | `writeDurable(journal)` | none | S4 | steps: rm stale.bin; mv fullvec data; mv fullvec map; mv staged->idx (commit); mv delta.next->delta (or rm delta); mv stale.next->stale.bin | hnsw-compaction.mjs:219-228 |
| S4 | steps done | idempotent `rm`/`mv-if-source-exists` | S5 | journal removed last | hnsw-compaction.mjs:128-134 |
| S4 (after crash) | next tick `loadStores`, or next `binaryHnswHandler` | journal parses | S5 | roll forward | production-reconciler.mjs:482, maintenance-handlers.mjs:204 |

Reader side: per search, `_syncBinaryHnsw` compares the index file identity; if changed it reloads, else `refreshDelta()` reads only the new delta tail and returns false (full reload) when the delta inode changed or shrank (sweet-search.js:491-507 area, binary-hnsw-index.js:958-969). The stale bitmap is re-read per call by stat identity (binary-hnsw-index.js:1827-1865). Guards against mixing: delta header generation (hnsw-delta-file.js:111-113), fullvec map/data generation (full-vector-file.js header comment).

#### S-SM3. Sparse-gram base + delta segments (+ fold, merge, retire)

State:
- Base `codebase-sparse-grams.idx` (identity = inode:size:mtime), delta dir `<base>.deltas/{epoch}-{seq}.ssgrmdelta`, retired list `.pending-delete.json` (sparse-gram-delta.mjs:50, 159-189), manifest `sparseGram.{deltas,weightsId}`.
- In memory: `sparseFold` (maintenance-handlers.mjs:71) for the background fold.
- Staging: `<base>.next`, `*.compacting.tmp`, `*.fold.tmp`.

Per segment states: LIVE (listed by dir scan and, after publish, by manifest) -> RETIRED (in `.pending-delete.json`, hidden from `listDeltaSegments`, still on disk) -> DELETED (after 60 s and not named in manifest, sparse-gram-delta.mjs:203-214).

Base states: BASE_W1 -> (fold publish) -> BASE_W2. The record weights id must equal `manifest.sparseGram.weightsId` or readers drop the record (search-pattern-sparse-overlay.js:303, lane overlay.rs:221).

Transitions (handler `sparseGramHandler`, maintenance-handlers.mjs:97-180):

| from | event | guard | to | side effects | where |
|---|---|---|---|---|---|
| any | ratio over threshold, files <= inline max | `fs.existsSync(base)` | fold inline | build `.next`, then publish | :122-134 |
| any | same, files > 2000 | none | fold running | fork child, `requeue` | :124-130 |
| fold running | child done, base identity unchanged | none | publish | `publishSparseGramFold` | :104-121 |
| publish step 1 | `renameSync(staged, base)` | none | BASE_W2 live, manifest still W1 + old deltas | sparse-gram-fold.mjs:91 | |
| publish step 2 | re-extract `post` records, write carried segment `epoch-seq` | `carried.size > 0` | carried segment LIVE | `.fold.tmp` then rename | :93-136 |
| publish step 3 | `retireDeltaSegments(snapshot + post)` | none | segments RETIRED | `.pending-delete.json` | :137-138 |
| handler | `writeManifest` with live list and new weightsId | list differs or weights changed | manifest consistent | | maintenance-handlers.mjs:151-161 |
| handler | `sweepRetiredDeltaSegments(keep=listed)` | age >= 60 s | DELETED | | :169 |
| any | deltaSegments > count | no fold | merge | `compactDeltaSegments` writes `max-seq` file, retires the consumed ones | :135-145, sparse-gram-delta.mjs:291-364 |

Steps 1 to 3 plus the manifest write are NOT one atomic unit. They are separate sequential statements with no journal.

#### S-SM4. Tombstone bitmap (`*.stale.bin`) versions

State: one file per owner (LI segment, HNSW index). Header `SSTB`, version 1, capacity (tombstone-bitmap-reader.js:42-63). Writer `saveBitmap`: `<file>.tmp`, fsync, rename, fsync dir (:68-90). Reader `loadBitmap` throws on short, bad magic, truncated; callers catch and treat as "no bitmap" (late-interaction-index.js:1469-1485, binary-hnsw-index.js:1853-1861). Bitmap is positional, and has no generation or file-identity tag.

States: ABSENT (all live) -> V(n) (bits only set, capacity may grow via `resizeBitmap`) -> REPLACED (compaction renumbers; old file removed first and new one moved in last, SM2 step list) -> RETIRED with its segment (SM1).

Invariant: a bitmap is applied only to the file whose numbering it was written for. Enforced for LI by new segment names (maintenance-handlers.mjs:327-330). Enforced for HNSW only by operation ORDER inside the journal and by readers reloading on index identity change. No tag in the file checks it.

#### S-SM5. Vector GC and graph GC

State: SQLite rows (`vectors`, `entities`, `relationships`, `call_sites`, `call_lines`, `files`, `hcgs_summary_metadata`) with `epoch_written`, `epoch_retired`. States per row: LIVE (retired NULL), RETIRED (retired = R), DELETED.

Transition: RETIRED -> DELETED when `R <= frontier`, `frontier = minLiveEpoch(readers) ?? manifest.epoch` (vector-gc.mjs:107-117, graph-gc.mjs:317-327). Batched `rowid IN (SELECT ... LIMIT)`; graph entity delete is one transaction per batch with FTS5 `'delete'` commands (graph-gc.mjs:220-230).

Reader visibility:
- Vectors: `epoch_retired IS NULL` only, NOT epoch-pinned (core/indexing/vector-visibility.js:6-9). So vector GC cannot hurt a reader through epochs (only through row identity, see "safe").
- Graph: epoch-pinned: `epoch_written <= E AND (epoch_retired IS NULL OR epoch_retired > E)` (code-graph-visibility.js:41-49, 56-62), where E is the reader's `_manifestEpoch` (graph-search.js:96, code-graph-repository.js:60).

#### S-SM6. Reader pin and heartbeat

State: file `<stateDir>/readers/<pid>-<bootId>-<readId>.json` `{epoch, pid, bootId, readId, startedAt, procStartMs}` (reader-heartbeat.mjs:87-108). In memory `_sharedPins` keyed by `stateDir\0epoch` with refcount and a 30 s linger timer (search-reader-pin.js:41-98).

States of a pin: NONE -> ACTIVE (refs>0) -> LINGERING (refs=0, timer 30 s) -> DROPPED (file unlinked) ; or DEAD_FILE (process gone, file remains).

Writer-side decision (`liveReaders`, reader-heartbeat.mjs:172-197): file counts iff JSON valid, epoch/pid/bootId well-formed, `bootId === bootIdStub()`, `pidAlive(pid)`, and (if recorded) the pid's start time is not more than 60 s after `procStartMs`. Dead or malformed files are unlinked only when older than 1 h (`READER_GRACE_MS`). A live pid never expires: a leaked pin holds the frontier forever (GC stalls, no corruption).

| from | event | guard | to | where |
|---|---|---|---|---|
| NONE | `beginPinnedRead` | epoch integer from manifest | ACTIVE | search-reader-pin.js:100-130 |
| ACTIVE | `endPinnedRead` | last ref | LINGERING | :91-98 |
| LINGERING | timer, or process exit hook | refs still 0 | DROPPED | :44-50, :83 |
| any | file vanished | `existsSync` check on next acquire | rewritten | :75-77 |

#### S-SM7. Temp artifact sweep

Allowlist: `*.tmp.<digits>`, `*.compacting.tmp`, `*.selfheal.tmp`, `*.json.tmp`, `*.bin.tmp`; top level of the state dir and `*.deltas` / `*.segments` subdirs; age >= `maxAgeMs` (60 s default) (artifact-temp-sweep.mjs:51-77, 129-151). Called (a) at maintainer start after the lock is held (index-maintainer.mjs:1169) and (b) with `maxAgeMs: 0` on `MaintainerLifecycleAbort` (index-maintainer.mjs:1514-1525). States per temp: LIVE_WRITER_TEMP -> RENAMED (normal) or ORPHAN -> DELETED.

#### S-SM8. Reader reload when the epoch changes (JS daemon) and native lane

JS (`_refreshManifestPins`, sweet-search.js:606-654): read manifest; if the epoch differs from the last one, `_reloadManifestArtifacts` reloads HNSW, LI, sparse base in turn (awaits), then records the epoch. `beginPinnedRead` (heartbeat) is called AFTER this refresh (sweet-search.js:702-706). Same-epoch changes are noticed only for the HNSW index file and the sparse base (file identity).
Lane (state.rs, overlay.rs): per call reads the manifest, reloads the base by `file_signature` (state.rs `Loaded::index`, engine.rs:46-83), re-reads all overlay segments when any segment signature changes (overlay.rs:156-176). No heartbeat is written by the lane; it does not read HNSW or LI.


### Reachable invalid states or transitions

Ratings: CONFIRMED = every step traced in code. SUSPECTED = one step depends on timing or an unverified runtime fact.
Ordered by what I think matters most.

#### S1. Sparse fold publish is not atomic: a crash or throw after the base rename leaves new base + old-weights deltas + old manifest; later edits are silently dropped by readers. [SUSPECTED, crash window is milliseconds; throw variant is CONFIRMED in code]

> Status: OPEN (issue 15).


(a) Lines.
- `fs.renameSync(stagedPath, base);` sparse-gram-fold.mjs:91, before anything else.
- `if (!extracted) throw new Error(\`sparse_gram fold: cannot re-extract ${rel}\`);` sparse-gram-fold.mjs:108.
- Manifest weights id and delta list only change later, in the handler: `manifest.sparseGram.deltas = live; ... weightsId = result.weightsId; writeManifest(...)` maintenance-handlers.mjs:157-160.
- `sparseFold = null` before publish (maintenance-handlers.mjs:109), so a throw leaves no in-memory memory of the fold.
- Readers drop records whose `weightsId` differs from the manifest's (search-pattern-sparse-overlay.js:303; lane overlay.rs:221-224).

(b) Sequence. Large repo (more than 2000 files), so the fold runs in a child.
1. Child builds `.next` (new weights W2) from snapshot segments S1..Sk. Meanwhile ticks write segments Sk+1..Sm with weights W1 (extractor uses the old base).
2. Child ends. Handler runs `publishSparseGramFold`. Line 91 renames the base: base is W2, manifest still says W1 with deltas S1..Sm.
3. Process dies here (SIGKILL, OOM, RSS recycle after hard stop), or step 108 throws (re-extract fails for one carried file), before the carried segment and the manifest write.
4. State now: base W2, every delta record W1. Readers use manifest weights W1, so the records match the manifest but their grams were made with W1 weights while the base uses W2. Sparse overlay gram filter then compares W1 grams from the record with W2 grams from the query: live overlay files do not match, so edited files fall out of grep.
5. Next tick: `production-reconciler.mjs:1500` writes manifest `weightsId: extractor.weightsId` (now W2) with deltas = all non-retired segments, including S1..Sm (W1). Readers now DROP every W1 record. The post-snapshot edits (Sk+1..Sm) are in neither the new base (built from disk at snapshot time) nor any readable delta. Their merkle state says "indexed", so no retry. Files stay invisible to ss-grep until touched again or a later fold re-reads the disk.

(c) Guards checked: base-identity check (maintenance-handlers.mjs:114) only covers a base replaced by someone else; no journal as in HNSW (hnsw-compaction.mjs:219-228); `retireDeltaSegments` runs after, so nothing marks the half state. Handler retry (attempts < 3) re-enters with `sparseFold === null`, so it only refolds if the size ratio is still over threshold.

(d) Impact: ss-grep (and the lane, which mirrors it) misses recent edits in files changed during the fold build. Silent. Also, for ms-long non-crash windows, any reader that loads the new base before the handler writes the manifest sees base W2 with manifest W1 deltas: edited files miss for that one call.

(e) Fix. Make the publish a journal like HNSW: stage the carried segment first (`.fold.tmp` written but not renamed), write a journal with steps [mv carried, mv staged->base, write manifest], run it; roll forward at handler start and at tick start. Cheaper: reorder so the carried segment (re-extracted against the STAGED base, which `loadSparseGramIndex(stagedPath)` can do) is written and renamed first; the new base rename and the manifest write come last and back to back. Also have the reconciler refuse to stamp `extractor.weightsId` into the manifest when the manifest's delta list still holds records of another weights id (or re-extract them).

(f) Test. Temp state dir with base B1, three delta segments. Call `publishSparseGramFold` with a stub `extractSparseGramDeltaRecord` that throws on the second record. Assert after the throw: `manifest.sparseGram.weightsId`, base weights id, and delta list are mutually consistent (they are not today). A second test: kill between lines 91 and 135 by injecting a throw from `fs.renameSync` for the `.fold.tmp`; run the next tick's manifest build; assert post-snapshot file is still found by `resolveLatestSparseGramDeltaRecords` with the manifest weights id.

#### S2. Orphaned background build child can overwrite the staged base used by the next build. [SUSPECTED; depends on timing of two children]

> Status: OPEN (issue 14).


(a) Lines. Child is killed only on a normal parent `exit` event: `process.once('exit', kill)` background-build.mjs:30-35; the child has no `disconnect` handler (background-build-child.mjs:12-27). Next maintainer starts a new build after `discardStagedCompaction` (maintenance-handlers.mjs:243-245). `publishCompactedBase` takes `snapshotCount` from the NEW job and only checks `baseGeneration` (hnsw-compaction.mjs:160-168); it does not check that the staged file was built from that snapshot (no snapshot count or build id inside the staged header).

(b) Sequence.
1. Maintainer M1 forks child A (snapshotCount nA, minutes of graph linking). M1 gets SIGKILL (OOM killer, `kill -9`, native crash). `exit` handler never runs; A keeps running at nice 19.
2. Launcher starts M2. The queued `binary_hnsw` job still exists (never acknowledged). M2's handler: `hnswBuild` is null (new process), computes `needsGraph`, calls `discardStagedCompaction` (A has not finished, nothing to discard), forks child B with snapshotCount nB (nB >= nA, ticks appended rows).
3. A finishes after B started: A's `save(staged)` renames `compact.idx.tmp.<A>` over `compact.idx` and writes its fullvec files. If this lands after B's `save`, the staged file is A's, but M2 publishes with nB.
4. `post = nodes [nB, current.size)`; nodes [nA, nB) are in neither the staged base nor `post`: they vanish from the dense index. SQLite still has them as live, so `readLiveVectorIds` (hnsw-compaction.mjs:50) says live but the node table does not contain them, and no later compaction re-adds them (compaction only copies from the existing nodes).
(Fullvec files of A and B can also interleave; the map/data generation check in full-vector-file.js would then reject the fullvec stage, which is the safer outcome.)

(c) Guards checked: `baseGeneration` (same in A and B), the lock (child is not the lock holder), `discardStagedCompaction` (runs before B, not after A).

(d) Impact: some chunks never appear in dense search until a full reindex. Low probability: needs parent SIGKILL during a long build AND A finishing after B's save (B starts later, so usually finishes later; only a smaller B can lose).

(e) Fix. Put the snapshotCount (or a random build id) into the staged file name: `compact.<buildId>.idx`; the publish reads only the id it started. Or have the child exit when its IPC channel closes (`process.on('disconnect', () => process.exit(1))`) and kill any `sweet-search-compaction` child whose parent pid is gone at maintainer start.

(f) Test. Spawn two `buildCompactedBase` calls with different `snapshotCount` against one temp index, let the larger-snapshot one finish first and the smaller one second, then call `publishCompactedBase` with the larger count; assert every live id is present in base+delta afterwards (fails today).

#### S3. Temp sweep with `maxAgeMs: 0` on lifecycle abort can delete a live successor's temp file. [CONFIRMED path in code; effect is a failed tick or job, which the queue retries]

> Status: OPEN (issue 14).


(a) Lines. `catch (err) { if (err instanceof MaintainerLifecycleAbort) { ... sweepStaleArtifactTemps(ctx.stateDir, { maxAgeMs: 0 }) ...` index-maintainer.mjs:1500-1525, with the comment "no concurrent writer is mid-rename when this fires". The abort is thrown for 'shutdown requested' and for 'lock ownership lost' (index-maintainer.mjs:435-443). Takeover sends SIGTERM and then steals the lock after 5 s (index-maintainer.mjs:288-299), even if the old process is still alive.

(b) Sequence. Old maintainer M1 busy in a long handler (more than 5 s without a `progress()` call; e.g. `liSegmentsHandler` calls it only at the end, maintenance-handlers.mjs:369). Launcher decides M1 is stuck (no progress for 3 min, index-maintainer.mjs:49, 366-380) or an operator stops it. SIGTERM sets `shutdownRequested`. After 5 s the lock is stolen; successor M2 starts ticking and writes temps (`reconcile-manifest.json.tmp`, `*.tmp.<pid>`, `*.stale.bin.tmp`, `*.compacting.tmp`). M1 reaches its next `progress()`, throws the abort, runs the sweep with age 0. It unlinks M2's in-flight temp. M2's later `renameSync(tmp, final)` throws ENOENT.

(c) Guards checked: allowlist (only temp names), directories untouched, lock (only held by M2). No ownership check before the sweep.

(d) Impact: one failed tick or job in M2 (retried via queue, three attempts then dead letter). For a long write (HNSW `idx.tmp.<pid>` of a big index, LI `.compacting.tmp`) it wastes minutes. Worst realistic case is a dead-lettered job.

(e) Fix. Run the age-0 sweep only when `stillOwnsLock` is still true; otherwise use the default 60 s age or skip. 

(f) Test. Temp dir with a lock file naming another pid, create `foo.tmp.123` with fresh mtime, trigger the abort path with 'lock ownership lost', assert the file survives.

#### S4. LI and sparse files are deleted on a fixed 60 s timer with no reader check. [SUSPECTED; needs a reader that is slower than 60 s]

> Status: OPEN (issue 15).


(a) Lines. `sweepQuarantine(segmentDir, graceMs = LI_MERGE_GRACE_MS)` unlinks when `now - retiredAtMs > graceMs` (li-segment-merge.mjs:127-143); same for sparse (`sweepRetiredDeltaSegments`, sparse-gram-delta.mjs:203-214). Neither consults `liveReaders`/`minLiveEpoch` (only vector-gc.mjs and graph-gc.mjs do; maintenance-handlers.mjs:380-414).

(b) Sequence (question 3). Reader R (daemon) starts an LI reload on epoch E and reads `manifest.json` listing S1..S3. Before R finishes loading S3, the maintainer merges S1..S3 into M (manifest published), quarantines them; 60 s later the next `li_segments` or `pending_delete` job unlinks them. R then opens S3: ENOENT. `_reloadManifestArtifacts` catches it, logs, sets `hasLateInteractionIndex = false; useLateInteraction = false` (sweet-search.js:538-543), then records the epoch as loaded (sweet-search.js:651-652). LI rerank stays off until the next epoch bump. A paused or swapped reader (SIGSTOP, laptop sleep during load) reaches the same state. The same happens to a CLI reader doing a cold LI load of a very large index (load time above 60 s).
For sparse deltas: `parseDeltaSegment` returns null when the file is gone (sparse-gram-delta-reader.js:25-29), so a reader holding a manifest listing a deleted segment silently skips it: its edits vanish for that reader (no error).

(c) Guards checked: manifest is re-read per call; mmapped segments survive unlink (late-interaction-index.js:223-236) so an already loaded LI is safe on POSIX; positions-only tick loader reads fresh.

(d) Impact: LI rerank silently off (daemon) until next tick with changes; or sparse overlay rows missing for one call. Quality loss, no wrong data.

(e) Fix. Let the quarantine sweep also require `minLiveEpoch(stateDir) === null || retiredEpoch < minLiveEpoch` (store the reconcile epoch in the journal entry), or retry the LI load once when a segment is ENOENT and the manifest changed. Do not record the epoch as loaded when the LI reload failed (sweet-search.js:651).

(f) Test. Temp index with 3 small segments. Load manifest, run merge with `graceMs: 0` and sweep, then call the segment readers on the old manifest; assert the reload re-reads the manifest instead of disabling LI.

#### S5. Graph GC frontier can pass the epoch of a reader that has adopted an epoch but not yet written its heartbeat. [SUSPECTED; narrow window]

> Status: OPEN (issue 15).


(a) Lines. Reader: `_refreshManifestPins` sets the graph repo epoch (`graphSearch.refreshManifestEpoch()`, sweet-search.js:623-627) and then may `await this._reloadManifestArtifacts` (seconds: LI and HNSW reload), and only after that `beginPinnedRead({epoch: this.manifestEpoch})` writes the heartbeat (sweet-search.js:700-706). Writer: `live = minLiveEpochFn(); frontier = live ?? manifest.epoch` (graph-gc.mjs:319-326), delete `epoch_retired <= frontier`.

(b) Sequence. Daemon idle more than 30 s, so no heartbeat (linger expired, search-reader-pin.js:38).
1. Query arrives; daemon adopts epoch E, starts the artifact reload (awaits).
2. A file edit makes tick E+1 publish; rows of the old entity version get `epoch_retired = E+1`.
3. The `graph_gc` job runs in the same drain: no live heartbeat, `frontier = E+1`, deletes rows retired at E+1.
4. Daemon finishes the reload, writes heartbeat E, queries graph at E: old rows are gone, new rows have `epoch_written = E+1 > E`. The edited file's entities are missing for this query.
Next call re-syncs to E+1 and recovers.

(c) Guards checked: GC only runs when queued by a watermark (retired ratio), so it is rare; vectors are not epoch-pinned (SM5). Stated GC contract "repository always re-syncs to latest manifest" (graph-gc.mjs:20) is true only per call start, not across the reload await.

(d) Impact: one wrong graph answer (missing entity or relationship) right after an edit. 

(e) Fix. Take the pin BEFORE reading the manifest epoch for use: write the heartbeat with the manifest epoch first, then re-read the manifest and if the epoch advanced, pin again and use the newer one. Or make GC use `frontier = min(manifest.epoch, newest heartbeat startedAt guard)` such as "never delete rows retired in the last N seconds".

(f) Test. Fake maintainer step in a temp dir: write manifest E, open graph reader at E without heartbeat, publish E+1 with retire, run `runGraphGc` with real `minLiveEpoch`, then query at E; assert the old row still exists (fails today).

#### S6. HNSW compaction journal is not idempotent at its last step. [CONFIRMED in code; trivial window, low impact]

> Status: FIXED in this pass (issue 6).


(a) Lines. Steps start with `['rm', staleBin]` and end with `['mv', staleNext, staleBin]` (hnsw-compaction.mjs:219-226). `runJournal` runs all steps again on replay and removes the journal only at the end (:128-134).

(b) Sequence. Crash after the last `renameSync(staleNext, staleBin)` and before `fs.rmSync(journalPath)`. Roll-forward replays: step 1 deletes the new, correct bitmap; the final `mv` is skipped because `staleNext` is already gone. Result: retired nodes of the new base lose their stale bits.

(c) Guards: `hnsw-compaction` steps skip missing sources, which protects every step except the `rm` of a file that the last step creates.

(d) Impact: retired vectors visible in HNSW candidates; the SQL liveness filter (`epoch_retired IS NULL`) hides them, so only oversampling and counts shift. A later compaction (`dropped > 0` via `readLiveVectorIds`) repairs it.

(e) Fix. Record progress in the journal (rewrite with the completed step index), or make the stale step `['rm', staleBin]` conditional on `existsSync(staleNext)` being true when run, or put the `rm` into the replay only if `idx` still has the old generation.

(f) Test. Call `publishCompactedBase`, then replay the same journal JSON after the files are in place and assert the stale file is still present.

#### S7. (low, SUSPECTED). A search that straddles an HNSW compaction applies a renumbered stale bitmap to the old in-memory base.

> Status: OPEN (issue 15).

Lines: bitmap is re-read per call and has no generation tag (binary-hnsw-index.js:1827-1865); base reload is checked only at search start (`_syncBinaryHnsw`, sweet-search.js:638-640). Sequence: search S starts at base G1 (sync done), compaction publishes (step `mv stale.next`), S then calls `_loadStaleBitmap()` and gets the G2 numbering. Wrong nodes hidden for that one query; retired nodes still filtered by SQL. Fix: store the generation in the bitmap header (SSTB version 2) and ignore a bitmap whose generation differs from the loaded base. Test: load index, replace bitmap file with a different-generation one, assert it is ignored.

#### Not reported as findings (checked, no reachable bad state)
- A document id live in two LI segments: merge places merged segments after kept segments (li-segment-merge.mjs:299-303), which could flip "last copy wins" (collectLiveDocs:185-210). Reaching it needs a duplicate id live in two segments; edits create versioned ids and tombstone the old copy (vector-delta-writer.mjs:244-262), so I found no path. Not reported.
- `publishCompactedBase` marks staged nodes stale by id (hnsw-compaction.mjs:209-212). Wrong only if one id sits on two nodes. `vectors.id` is `TEXT PRIMARY KEY` (indexer-build.js:233), so I found no path. Not reported.
- `bootIdStub()` on macOS is `floor(Date.now()/1000 - os.uptime())` (reader-heartbeat.mjs:76). If `os.uptime()` has sub-second resolution or the wall clock steps, the value can change under a running reader, and `isReaderAlive` would then call a live reader dead. I could not check libuv's resolution without running node. Direction of harm: GC frontier may pass a live reader. Worth a one-line test: call `bootIdStub()` 10^5 times and after a simulated clock step.


### Checked and safe

Crash after step k (question 1):
- LI merge: crash before manifest publish leaves unlisted files; next merge sweeps them (li-segment-merge.mjs:153-173, call at :253). Names do not collide because `nextSeq` is only bumped in the published manifest (:299-305) and the writer renames over any orphan of the same name.
- LI per-segment recompaction: new segment name, old file + sidecar kept until quarantine (maintenance-handlers.mjs:327-344). The old "reset bitmap in place" bug is gone.
- HNSW compaction: crash anywhere after the journal is written rolls forward (hnsw-compaction.mjs:137-144), run by the reconciler before it opens the index (production-reconciler.mjs:482) and by the handler (maintenance-handlers.mjs:204). Crash before the journal: staged files are discarded by the next build (:147-151, handlers :244).
- Sparse merge: new file is fsynced then renamed (sparse-gram-delta.mjs:337-346) before the consumed ones are retired; retire list is written by tmp+rename (:178-180). Crash between leaves duplicate coverage, which is harmless (latest wins, merged file sorts after).
- Tombstone bitmap write: tmp + fsync + rename, so a reader sees old or new, never partial (tombstone-bitmap-reader.js:68-90).
- Delta append: torn tail is ignored by readers and cut by the writer (hnsw-delta-file.js:77-84 reading side, :140-165 writing side; sparse reader stops at last newline, sparse-gram-delta-reader.js:195-197).

Mixed epoch (question 2):
- HNSW base vs delta: header generation compared in `readDelta`, `appendDelta`, `countDeltaRecords` (hnsw-delta-file.js:111-113, 144-149, 193-196). An old delta beside a new base is ignored, and `refreshDelta` re-reads the whole new delta (binary-hnsw-index.js:958-969).
- HNSW base vs full-vector file: map and data generation must equal the loaded index's (full-vector-file.js doc comment and `readMap`/`readDataHeader`); a mismatch skips the rescore stage instead of reading wrong vectors.
- Sparse base vs overlay: weights id check per record (search-pattern-sparse-overlay.js:303); a fold changes the base identity and the daemon reloads it (sweet-search.js:640-653). The window is F1.
- Lane reload: `file_signature` (inode, size, mtime) for base and each overlay segment; a vanished segment is skipped (overlay.rs:156-176, state.rs:`Loaded::index`).
- LI and reconcile epoch are not pinned together (LI manifest may be one epoch ahead of the graph). LI is rerank only and tombstones are visible early; no wrong id results from this.

Writer deletes what a pinned reader needs (question 3):
- Vector GC: vectors are read with `epoch_retired IS NULL`, not by epoch (vector-visibility.js:6-9), so physical deletion of retired rows cannot change a reader's answer.
- Graph GC without the F5 window: frontier is `min` over live heartbeats, else current epoch (graph-gc.mjs:317-327); heartbeat gets the epoch the reader uses (search-reader-pin.js:100-130); lingering pins only delay GC.
- Heartbeat expiry cannot free a slow live reader: only dead pids or malformed files are dropped (reader-heartbeat.mjs:186-197), and a live pid never expires. The cost is a stuck frontier, not data loss.
- LI and sparse: see F4 (the only exposure is the 60 s timer).

Retry after partial merge or compaction (question 4):
- LI merge: running twice drops nothing; the second run sees the new manifest, `small` is recomputed from it.
- Job retry: a job is acknowledged only after the handler returns (maintenance-worker.mjs:243-279); failures re-queue with a counter and dead-letter after 3 tries. `requeue` jobs keep their place without an attempt.
- `publishCompactedBase` skips when the base generation changed (hnsw-compaction.mjs:164-168), and carries delta rows added after the snapshot (`post`) with their stale marks by id.

Two maintenance jobs at once (question 5):
- Same process, sequential drain (maintenance-worker.mjs:224-277). Two queue entries for one tier do not overlap: the second sees `hnswBuild`/`sparseFold` running and requeues, or finds nothing to do after the first publishes.
- Lock: `acquireStateLock` uses O_EXCL, a dead-holder check, and a re-read before stealing so a successor is never displaced (index-maintainer.mjs:288-306, 331-420). The residual two-writer case is a SIGTERMed handler that keeps running until its next `progress()` call (F3 describes the sweep side; handlers such as `liSegmentsHandler` call `progress` only at the end).

Pid reuse and stale heartbeats (question 6):
- `isReaderAlive` rejects a pid whose process started more than 60 s after `procStartMs` (reader-heartbeat.mjs:134-146); `procStartMs` is `performance.timeOrigin` of the reader (:103). Linux uses `/proc` start ticks, macOS `ps -o lstart` (1 s resolution, 60 s slack). A file without `procStartMs` is treated as alive while the pid lives (safe direction: GC waits).
- Heartbeat file name includes pid, boot id, and a per-read token (reader-heartbeat.mjs:42-53), so concurrent reads in one process cannot overwrite each other.
- Malformed heartbeat files are ignored, and deleted after 1 h.

Temp sweep deleting a live writer's temp (question asked in the brief):
- Startup sweep runs after the lock is held and skips files younger than 60 s (artifact-temp-sweep.mjs:105-109, index-maintainer.mjs:1169). Cold-build stages (`*.db.tmp`, `*.idx.tmp`), WAL/SHM, queues, lockfile and heartbeats do not match the allowlist. Only the abort path with age 0 is unsafe (F3).

Other:
- `worktree-stamp.mjs`: three states (absent, match, mismatch). A torn stamp reads as `null` and is treated as absent (worktree-stamp.mjs:65-73, 101-103). Informational only; no artifact depends on it.
- `cached-json-file.js` (reconcile manifest cache): keyed by inode, size, mtimeNs, ctimeNs; the writer replaces by rename, so a new manifest always has a new signature (cached-json-file.js:39-48). The 5 ms re-check applies only inside one ss call and never returns an older version than the process already read.
- Sparse reader cursor: only skips re-reading a segment when inode, size and stat signature match and the previous list is a prefix of the new one; any other change resets (sparse-gram-delta-reader.js:140-211).
- Tombstone bitmap loaders catch corrupt files and fall back to "none set" (late-interaction-index.js:1469-1485), a safe direction for HNSW only because SQL filters retired vectors.

Existing tests that cover pieces of this (none found for F1, F2, F3, F5, F6): tests/indexing/incremental-hnsw-compaction.test.js, incremental-indexing-li-segment-merge.test.js, incremental-indexing-li-segment.test.js, incremental-indexing-vector-gc.test.js, incremental-indexing-graph-gc.test.js, incremental-indexing-heartbeat.test.js, incremental-indexing-artifact-temp-sweep.test.js, incremental-indexing-tombstone-bitmap.test.js, late-interaction-segment-isolation.test.js.


## 10. Model and encoder processes

Ids in this section: state machines `ML-SM<n>`, findings `ML<n>`. The text below is the subsystem audit as written at the baseline commit; inside it, "F1" means ML1; "1.7" means ML-SM7.


Scope: files listed in the task. Read-only audit. No test or process was run. All line numbers are from the working tree at HEAD d01eeb88.
Result in one line: the load paths cache a rejected promise forever (6 places), and one cache helper creates an unhandled rejection on every failed embedding.

Abbreviations: ELM = core/embedding/embedding-local-model.js, LIM = core/ranking/late-interaction-model.js, NI = core/infrastructure/native-inference.js, EC = core/indexing/encoder-client.mjs, QES = core/search/query-encoder-server.mjs, SQE = core/search/shared-query-encoder.mjs, IP = core/indexing/indexer-pool.js, MF = core/infrastructure/model-fetcher.js.

### State machines

#### ML-SM1. Model file download (MF)
State lives on disk: `<dest>/<file>` (final), `<dest>/<file>.tmp` (partial), `<dest>/<file>.verified.json` (sidecar), plus an in-process Map `_verificationMemCache` (MF:81). The state is implicit: it is encoded in "which of the three files exist and match".
States: ABSENT (no final, no tmp) | PARTIAL (tmp, size < expected) | COMPLETE_UNVERIFIED (tmp, size = expected; only inside the loop) | CACHED_VERIFIED (final + sidecar fingerprint match) | CACHED_UNVERIFIED (final, no sidecar; hashed on next check) | FAILED (exception; tmp kept).
Invariants relied on: (1) the final path only appears by `renameSync` after size and sha check (MF:458-478); (2) one writer per tmp path; (3) `tmp` size = bytes already received, so `Range: bytes=size-` is correct (MF:371-378).
Invariant 2 is not enforced by any lock. See finding F6.

| from | event | guard | to | side effects | line |
|---|---|---|---|---|---|
| any | fetchModelFile called | final valid (size, sha or sidecar) | CACHED_VERIFIED | returns path | MF:332 |
| ABSENT/PARTIAL | called | SWEET_SEARCH_OFFLINE=1 | FAILED | throws | MF:339 |
| ABSENT/PARTIAL | called | download disabled (config) | FAILED | throws | MF:351 |
| PARTIAL | attempt | tmp exists | PARTIAL | Range header from tmp size; append mode on 206, truncate on 200 | MF:371-424 |
| PARTIAL | HTTP 416 | always | ABSENT | tmp deleted, loop again | MF:408-411 |
| PARTIAL | stall 30 s / network error | failures-without-progress < 3 and attempts < 50 | PARTIAL | backoff 1 s, 2 s; resume | MF:484-490 |
| PARTIAL | stall/error | budget used | FAILED | tmp kept for resume | MF:491-498 |
| COMPLETE_UNVERIFIED | size differs | expectedSize set | ABSENT | tmp deleted, throw, retry | MF:460-463 |
| COMPLETE_UNVERIFIED | sha differs | sha set | ABSENT | tmp deleted, throw, retry | MF:466-471 |
| COMPLETE_UNVERIFIED | ok | always | CACHED_VERIFIED | sidecar invalidated, rename, sidecar written | MF:477-481 |

#### ML-SM2. In-process local dense model (ELM)
State: `localPipeline`, `isLoadingLocal`, `loadPromise` (ELM:447-449). State is implicit: three variables encode UNLOADED / LOADING / LOADED / (invalid) POISONED.
States: UNLOADED (all null/false) | LOADING (isLoadingLocal and loadPromise set) | LOADED (localPipeline set) | POISONED (isLoadingLocal true, loadPromise rejected, localPipeline null). POISONED is not meant to exist.
Invariant relied on: after a load ends, either `localPipeline` is set or the flags are cleared. The code clears `isLoadingLocal` only on success (ELM:567).

| from | event | guard | to | side effects | line |
|---|---|---|---|---|---|
| UNLOADED | getLocalPipeline | no delegate | LOADING | fetchModel, ORT init, CoreML probe, session create with cascade, tokenizer, 10 warm-up runs | ELM:460-556 |
| LOADING | getLocalPipeline | isLoadingLocal and loadPromise | LOADING | caller shares promise | ELM:463 |
| LOADING | load succeeds | always | LOADED | isLoadingLocal=false | ELM:564-568 |
| LOADING | any step throws | always | POISONED | none: flags not reset, session (if created) not released | ELM:466-569 |
| POISONED | getLocalPipeline | always | POISONED | returns the same rejected promise | ELM:463 |
| any | unloadLocalModel | none | UNLOADED | session.release (best effort), flags cleared; does not cancel an in-flight load | ELM:901-910 |

Load cascade inside LOADING: CoreML MLProgram, then CoreML NeuralNetwork, then CPU only (ELM:502-531). The CoreML failure flag file `.coreml-embedding-failed` is written when both CoreML variants fail (ELM:518-519) and is never removed by any code.

#### ML-SM3. Late-interaction (LI) model (LIM)
State: `lateInteractionPipeline`, `loadPromise` (LIM:24-25). States: UNLOADED | LOADING | LOADED | POISONED (loadPromise rejected, never cleared; LIM:64-67).
`await loadPromise` at LIM:66 throws, so `loadPromise = null` at LIM:67 is skipped.

#### ML-SM4. Native (Metal/CUDA/CoreML cascade) models (NI)
State: `_embeddingModel`, `_embeddingModelLoadPromise` (NI:60-61), `_liModels` Map of `{model, promise}` (NI:68). Same four states as 1.2. Two loaders share one promise slot: `getNativeEmbeddingModel` (NI:177) and `loadNativeEmbeddingModelWithDevice` (NI:513). A resolved `null` (addon missing, file missing; NI:183, NI:192, NI:528) is also cached. `unloadNativeModels` (NI:633) only drops references; the native memory goes at garbage collection.

#### ML-SM5. Local reranker and semantic-cache model (counter-examples)
LocalReranker.init clears `initPromise` in `finally` (local-reranker.js:58-63): correct, no poison. SemanticCache.getLocalModel (embedding-cache.js:418-439) has the same poison bug as 1.2 (flag `loadingModel` never reset on failure).

#### ML-SM6. Encoder host child and its client (EC, encoder-host.mjs)
State lives in the client closure: `child`, `pending` Map (id -> {resolve, reject, onProgress, child}), `idleTimer`, `silenceTimer`, `seq`, `lastIdleExitAt`, `currentIdleMs` (EC:77-85, 61-62). The child holds ORT sessions.
States of the pair: NO_CHILD | STARTING (child forked, `spoke` false) | BUSY (pending > 0) | IDLE (child alive, pending = 0, idleTimer armed) | STOPPING (child set to null, old child still exiting) | DEAD (child gone, pending failed).
Invariants: request ids are never reused (`++seq`, EC:201); every pending entry names its child, so a late exit of an old child fails only its own requests (EC:102-108); `child === c` guards stale callbacks.

| from | event | guard | to | side effects | line |
|---|---|---|---|---|---|
| NO_CHILD | call() | always | STARTING | fork, announce(pid), adaptive idle doubling | EC:126-185, 199 |
| STARTING/IDLE | call() | child set | BUSY | pending.set, silence timer armed (120 s, or startup grace) | EC:197-219 |
| BUSY | reply ok / error | id in pending | BUSY or IDLE | resolve/reject; records provenance | EC:163-169 |
| BUSY | progress message | callback throws | DEAD | reject that request, `abandon('cancelled')`: SIGKILL, all pending of this child fail | EC:150-161 |
| BUSY | reply with rss over cap | child === c | STOPPING | `stop()` disconnects; the disconnect handler then kills the child and fails other pending requests of it | EC:170, 176 |
| BUSY | silence over limit | child === c | DEAD | SIGKILL, failPending | EC:92-98 |
| BUSY | exit / error / disconnect | any | DEAD | failPending; announce(null) if no new child | EC:172-181 |
| IDLE | idleTimer | pending = 0 | STOPPING | disconnect + SIGKILL at 5 s (the disconnect handler kills at once anyway) | EC:187-195, 110-124 |
| any | close() | always | NO_CHILD | SIGKILL; no `closed` flag, a later call starts a new child | EC:237-242 |

#### ML-SM7. Shared query-model server and its client (QES, SQE, query-encoder.mjs)
State: socket file `<runtimeDir>/query-models-<key>.sock`, start lock `<sock>.start` (pid text), server variables `inflight`, `lastActivity`, `stopping`, `socketIno` (QES:90-92, 123). Client variables `conn`, `opening`, `seq`, `closed` (SQE:110-113).
Server states: STARTING (lock held, no listener yet; module import of encoder-ops happens before listen, QES:88) | SERVING | DRAINING (stopping, waits for inflight = 0) | GONE.
Client states: NO_CONN | OPENING (`opening` promise) | CONNECTED (pending Map) | CLOSED | FALLBACK (own child, query-encoder.mjs:59-69).

| from | event | guard | to | side effects | line |
|---|---|---|---|---|---|
| client NO_CONN | send | connect succeeds | CONNECTED | | SQE:138-141 |
| client NO_CONN | send | connect fails | OPENING | spawn detached server; poll every 50 ms for 30 s | SQE:142-152 |
| OPENING | 30 s without answer | always | FALLBACK | error `sharedUnavailable`; shared.close(); own child | SQE:149, query-encoder.mjs:62-69 |
| CONNECTED | socket closes | any | NO_CONN | all pending rejected with `retryable` | SQE:155-159, 172 |
| CONNECTED | request silent 120 s | pending still set | NO_CONN | reject (not retryable), socket destroyed | SQE:186-190 |
| request | retryable error | not closed | one retry | new connection, may spawn a server | SQE:198-206 |
| server STARTING | takeStartLock fails | lock held by live pid or age < 60 s | GONE | exit 0 | QES:78 |
| server STARTING | socket answers | other server alive | GONE | drop lock, exit 0 | QES:84 |
| server STARTING | no answer | | SERVING | unlink stale socket, import ops, listen, drop lock | QES:85-153 |
| SERVING | idle over idleMs | inflight = 0 | DRAINING | close listener (if own inode), unregister, exit when inflight = 0 | QES:162-163, 126-142 |
| SERVING | socket inode changed | | DRAINING | same | QES:165-169 |
| SERVING | reply leaves rss over cap | | DRAINING | same; exit may happen right after the write | QES:115 |

#### ML-SM8. Embedding model server (core/embedding/model-server.mjs, model-client.mjs)
Opt-in only (SWEET_SEARCH_SHARED_MODEL_SERVER=1). No launcher exists in the repo (grep: only `node model-server.mjs` by hand). One connection per request, ids from a module counter, 60 s timeout. Server has no idle exit, no start lock, no liveness check. States: NO_SERVER | LISTENING. Transition NO_SERVER to LISTENING unlinks any file at the socket path first (model-server.mjs:162).

#### ML-SM9. Embedding worker pool (IP: EmbeddingPool, LateInteractionPool; indexer-worker.js)
State per pool: `workers[i]` (Worker | null), `_ready`, `restartCounts` Map, `roundRobin`, `nextBatchId`; per task: a closure with a message handler and a 120 s timer (IP:472-501). Task state is implicit in that closure (QUEUED does not exist: tasks are posted to the worker at once).
Worker states: SPAWNING | READY | CRASHED_RESTARTING | RETIRED (null) | TERMINATED.
Task states: POSTED | DONE | FAILED (error reply) | TIMED_OUT (120 s).

| from | event | guard | to | line |
|---|---|---|---|---|
| pool new | init() | | all workers SPAWNING; `_ready` after all `ready` | IP:379-388 |
| SPAWNING | 'ready' | | READY, restartCounts=0, workers[i]=worker | IP:404-409 |
| SPAWNING | 'error' | | init rejects (first reject wins); other workers not stopped | IP:413-417, 385 |
| SPAWNING | 60 s | | init rejects; worker not terminated | IP:400-402 |
| READY | 'exit' code != 0 | `_ready` | CRASHED_RESTARTING; `workers[i]` still holds the dead worker | IP:419-423 |
| CRASHED_RESTARTING | spawn ok | restarts <= 2 | READY | IP:428-443 |
| CRASHED_RESTARTING | budget used or spawn fails | | RETIRED | IP:430-433, 440-441 |
| task POSTED | worker replies | batchId matches | DONE/FAILED | IP:477-490 |
| task POSTED | worker dead or silent | | TIMED_OUT after 120 s, no retry, handler not removed | IP:473-475 |
| any | shutdown | | `_ready=false`, terminate all; pending tasks stay until their timers | IP:510-518 |

Slot: `initEmbeddingPool` (IP:683-698) shares the in-flight promise between callers: correct.

#### ML-SM10. Index-device speed test and probe lock (model-pool.js, index-device-choice.js, probe child)
State: file `index-device.lock` (JSON: pid, startedAt, nonce, childPid), takeover mutex `index-device.lock.takeover`, cache file `index-device.json` (entries with expiresAt), in-process `_pendingChoices` Map and `_indexDeviceChoice`.
Lock states: FREE | HELD(live) | STALE | TAKEOVER. Result states: NONE | FRESH(device) | EXPIRED | FAILED(1 day).
Guards: create with `wx` (index-device-choice.js:352-356); stale = holder and child dead, or age over 1 h, or unreadable for 30 s (:292-296); takeover under a second `wx` file, re-check nonce (:368-395); release only if nonce is ours (:335-342); exit and signal handlers release (model-pool.js:251-269); probe child exits when stdin closes or at deadline (:409-420); parent kills child on exit (model-pool.js:186-187). I found no reachable invalid state here (section 3).

#### ML-SM11. Embedding cache entries (embedding-cache.js, embedding-service.js)
LRU `queryCache`, `vocabulary` (file, atomic write via tmp + rename, serialised per owner, :73-113), `queryDeduplicator` (in-flight Map). In-flight entry states: ABSENT | PENDING | (deleted on settle). Finding F2 concerns the deleting `finally`.

#### ML-SM12. ONNX mutex (onnx-mutex.js)
State: one promise chain `_onnxQueue`. States: FREE | HELD. Acquire = chain; release = fn settles (try/catch inside, so a throw releases; :23-30). No timeout: a fn that never settles blocks every later call. No re-entrancy: a nested call inside `fn` waits for itself. Current users (local-reranker.js:121, 184; flashrank.js:102, 184) do not nest. Dense and LI sessions do not use it.

#### ML-SM13. Circuit breaker for remote providers (embedding-remote.js:8-72)
CLOSED -> OPEN (5 failures) -> HALF_OPEN (after 60 s, first canRequest) -> CLOSED (2 successes) or OPEN (1 failure). HALF_OPEN admits unlimited concurrent probes. A success that arrives while OPEN resets `failures` but keeps OPEN (:35-36). No defect that matters for correctness.

### Reachable invalid states or transitions

#### ML1. A failed model load is cached for the life of the process (POISONED state)  CONFIRMED

> Status: FIXED in this pass (issue 4). A failed load is dropped after 30 seconds (`load-retry.js`). A half-created session is still not released.

(a) Code.
ELM:463 `if (isLoadingLocal && loadPromise) return loadPromise;` ELM:465 `isLoadingLocal = true;` ELM:567 `isLoadingLocal = false;` (only on the success path, inside the IIFE). ELM:571 `return loadPromise;`.
LIM:64-67 `if (loadPromise) return loadPromise; loadPromise = loadModel(); lateInteractionPipeline = await loadPromise; loadPromise = null;` (the last line is skipped when the await throws).
NI:177-219 and NI:513-557: `_embeddingModelLoadPromise` is kept on failure; the empty `finally` says so. NI:563-613: `_liModels.set(key, {model:null, promise})` is never removed on rejection. embedding-cache.js:418-436 (SemanticCache) has the same shape.
(b) Sequence (QES case). A daemon asks the shared query server for `warm-query` or `local-model`. Inside the server process `getLocalPipeline()` runs `fetchModel` (ELM:471). The network is down, the model is not yet cached, runtime download is on by default (platform.js:123). `fetchModel` throws after 3 failed attempts (MF:491-498). The IIFE rejects. `isLoadingLocal` stays true and `loadPromise` stays rejected. The user restores the network. The next request calls `getLocalPipeline()`, which returns the same rejected promise at ELM:463. The server replies `{ok:false}` (QES:108). The client turns that into a plain Error (SQE:166), which is not `retryable`, so nothing restarts the server. Each failed request sets `lastActivity` (QES:111), so the idle exit at QES:163 never fires while queries keep coming. Result: every daemon with the same key has no dense query vectors until the server is killed or idle for 15 min. The same chain applies to the encoder child (EC) and to any in-process daemon. Any other transient cause has the same effect: ORT session create error under memory pressure, tokenizer file read error, warm-up run error.
(c) Guards checked: `unloadLocalModel` is the only reset and nothing in encoder-host.mjs, QES or EC calls it on error. Client retry (SQE:204) only handles `retryable` (connection loss). EC replaces the child only on exit/timeout/idle.
(d) Impact: search stays degraded after one transient error. Worst for the shared server, because it affects all worktrees.
(e) Fix: in each loader, clear the cached promise on rejection: `loadPromise = (async()=>{...})(); loadPromise.catch(() => { if (this load is still current) { loadPromise = null; isLoadingLocal = false; } })`. Release the half-created session in a `catch` inside the IIFE. Do the same for LIM:65-67 (use try/finally), the NI loaders, and SemanticCache. Cache `null` results only for the "addon absent" case, not for "file missing".
(f) Test: in the existing vitest setup mock `fetchModel` to reject once, then resolve; mock `onnxruntime-node` `InferenceSession.create` with a fake. Call `getLocalPipeline()` twice. Expected: first rejects, second resolves. Today the second rejects with the first error. For LIM, mock `loadModel` path the same way.

#### ML2. Every failed `getEmbedding` call also raises an unhandled rejection (process crash)  CONFIRMED (Node semantics; no handler found)

> Status: FIXED in this pass (issue 4).

(a) Code. embedding-cache.js:529-530 `this.inflight.set(text, promise); promise.finally(() => this.inflight.delete(text));`. embedding-service.js:277 `queryDeduplicator.set(cacheKey, embeddingPromise.then(emb => ({ embedding: emb })));` followed by `await embeddingPromise` (:278).
(b) Sequence. `getEmbedding(query, {isQuery:true})` runs from search-semantic.js:685 in the daemon. `generateEmbedding` throws (last statement, embedding-service.js:133, e.g. the delegate fails or F1). Promise P1 rejects; the caller's `await` handles P1. `P2 = P1.then(...)` rejects too. `P2.finally(cb)` creates P3, which rejects with the same reason. Nobody attaches a handler to P3. Node 15 and later raise `unhandledRejection`, which becomes an uncaught exception.
(c) Guards checked: grep found no `unhandledRejection`, `uncaughtException` handler or `--unhandled-rejections` flag in core, cli, bin (only in two soak scripts). The deduplicated waiters (`await inflight`) handle P2, not P3.
(d) Impact: the search daemon exits when one query embedding fails, after the user already saw the error. Combined with F1 it loops: restart, fail, exit.
(e) Fix: `promise.finally(() => ...)` becomes `promise.then(cleanup, cleanup)` (no new rejected promise), or add `.catch(() => {})` after `finally`. In embedding-service.js, build the stored promise with a no-op catch for the stored copy.
(f) Test: mock `callLocalModel` to reject; register `process.on('unhandledRejection', spy)`; call `getEmbedding('x',{useCache:false})` inside `expect(...).rejects`; wait one tick; expect spy not called. Today the spy is called.

#### ML3. Worker pool keeps a dead worker routable; its tasks wait 120 s and are never retried  CONFIRMED (only with 2 or more workers)

> Status: OPEN (issue 11).

(a) Code. IP:419-423 `worker.on('exit', (code) => { if (code !== 0 && this._ready) { ... this._handleWorkerExit(index); } })`. IP:428-443 `_handleWorkerExit` sets `workers[index] = null` only after the restart budget is used or the spawn fails. IP:456-464 picks `this.workers[idx]` if truthy. IP:473-501: the task has a message handler and a timer, no exit listener.
(b) Sequence. Pool has 2 workers (SWEET_SEARCH_EMBEDDING_WORKERS=2, or the 12-core CPU-embed plus Metal-LI case, IP:188). Worker 0 crashes (native abort, OOM) with 1 batch in flight. Exit event: `_handleWorkerExit(0)` starts `_spawnWorker(0)`, which needs model load plus 2 warm-up runs, up to 60 s. During that time `workers[0]` is the dead Worker object. `embed()` round-robins to index 0, calls `postMessage` on an exited worker (silently dropped), and waits. After 120 s the promise rejects with "Batch N timed out". The batch that was in flight at the crash waits the same way. `embedBatchesWithPool` uses `Promise.all` (ELM:403), so the whole wave and the index run fail.
(c) Guards checked: restart budget (maxRestarts=2) bounds restarts, not routing; `_ready` stays true.
(d) Impact: a worker crash costs 2 minutes and then aborts the index run, although a healthy worker and a restarted worker exist.
(e) Fix: in the exit handler set `this.workers[index] = null` first and reject the pending tasks of that worker (keep a per-worker Set of pending tasks and fail them on exit). Retry a failed batch once on another worker or inline. Remove the message handler on timeout. Same change in LateInteractionPool.
(f) Test: fake `Worker` class (EventEmitter with postMessage and terminate) injected via `vi.mock('worker_threads')`. Worker 0 emits 'ready', then 'exit' with code 1 while a batch is pending; make the replacement spawn never emit 'ready'. Call `pool.embed()` twice. Expect: both settle in under 1 s with a retry on worker 1, not after 120 s.

#### ML4. Pool init failure leaks the workers that did start  CONFIRMED (only with 2 or more workers)

> Status: OPEN (issue 11).

(a) Code. IP:385 `await Promise.all(spawnPromises)`; the pool object is only stored after init succeeds (IP:690-691). indexer-phases.js:559-565 catches the error and says "falling back to inline". Startup timeout (IP:400) rejects but does not terminate that worker.
(b) Sequence. Pool of 2 workers. Worker 0 becomes ready. Worker 1 throws during model load (fetchModel error, OOM) and emits 'error'. `init()` rejects. Worker 0 stays alive with a ~350 MB ORT session, referenced by nothing. `shutdownEmbeddingPool()` in the `finally` at indexer-phases.js:821 sees no slot and returns. The workers live until the process exits. In the probe child (index-device-probe-child.mjs:56) the same leak occurs inside the timed run.
(c) Guards: none (the `_ready` flag is false, so the exit handler does nothing either).
(d) Impact: hidden extra memory and CPU threads during the inline fallback run, which then competes with the leaked sessions.
(e) Fix: in `init()` use `Promise.allSettled`; on any rejection call `shutdown()` and rethrow. Terminate the worker in the 60 s timeout path.
(f) Test: fake Worker as in F3; worker 1 emits 'error'; assert `terminate` was called on worker 0 after `init()` rejects.

#### ML5. `initIndexGpuPool` half-failure leaves a mixed CPU+GPU state that the caller reports as "falling back to ORT CPU"  CONFIRMED

> Status: OPEN (issue 11).

(a) Code. model-pool.js:472-478 loads the native embedding model, then the LI model; no try/catch around them. indexer-phases.js:614-624: the catch only logs `GPU pool arming failed ... falling back to ORT CPU`. ELM:593 `if (!forceEmbedCpu && isNativeInferenceAvailable() && isNativeEmbeddingModelLoaded()) return callLocalModelGpu(...)`.
(b) Sequence. Full reindex on a Mac with Metal. `teardownAllModels()` ran. `loadNativeEmbeddingModelWithDevice('metal')` succeeds: `_embeddingModel` is set. `loadNativeLiModelWithDevice('metal')` throws (F1 cached promise, Metal error, missing projection file). Same for a throw in the warm-up step (model-pool.js:499). The error is logged as a fallback to ORT CPU. State now: dense encodes keep going through Metal (ELM:593 sees a loaded native model), while LI loads ORT CPU (`isNativeLiModelLoaded` false). CPU and GPU models are resident together and the log says the opposite. The user rule is: never together.
(c) Guards: none on this path; `teardownIndexGpuPool` runs only in the final `finally`.
(d) Impact: wrong log message, extra memory and CPU/GPU contention during that run; provenance labels will show mixed encoders.
(e) Fix: wrap steps in `initIndexGpuPool` with try/catch that calls `unloadNativeModels()` before rethrowing; or in the indexer catch call `teardownIndexGpuPool()`.
(f) Test: vi.mock native-inference: `loadNativeEmbeddingModelWithDevice` resolves, `loadNativeLiModelWithDevice` rejects. Call `initIndexGpuPool`; expect `unloadNativeModels` was called (today it is not).

#### ML6. Two processes download the same model file to the same temp path  SUSPECTED

> Status: OPEN (issue 16).

Unverified: whether two processes really reach a missing model at the same time in normal use. `sweet-search init` has its own download phase, so the usual case is a cached model.
(a) Code. MF:330 `const tmpPath = finalPath + '.tmp';` MF:371-374 resume offset from the current tmp size; MF:424 `createWriteStream(tmpPath, { flags: isResume ? 'a' : 'w' })`; MF:458-478 size check, hash, `unlinkSync(tmpPath)` on mismatch, rename. No lock file, no pid in the temp name.
(b) Sequence. Runtime download is allowed by default (platform.js:123). A fresh machine: the search daemon's query model server, the maintainer's encoder child and an index run all start (each calls `fetchModel` in `getLocalPipeline`, ELM:471). Process A and B both find the tmp file missing. Both write with flag 'w'. B opens later and truncates the file while A is at 100 MB; A keeps writing at its own offset, leaving a hole until B catches up. A finishes first: sha mismatch (hole), `unlinkSync(tmpPath)` removes the file under B's open descriptor. B finishes, `statSync(tmpPath)` fails with ENOENT (MF:458), retry starts from zero. The loop can repeat (the "no progress" counter resets each time bytes arrive, MF:486, cap 50 attempts). Variant: both resume with flag 'a' on a half-finished tmp: appended bytes interleave, size is over the expected size, tmp is deleted.
(c) Guards: size and sha check (stop corruption for files with a checksum). Files with `sha256: null` (tokenizer.json, config.json; model-registry.js:23-26) have a size check only: a hole-filled file of the correct size could be accepted if one writer is killed after the other renames.
(d) Impact: wasted download time and failures on first use; a small chance of a corrupt tokenizer or config.
(e) Fix: unique temp name per process (`.tmp.<pid>`) with resume only for the same pid, or an `O_EXCL` lock file with stale-pid takeover (the pattern at index-device-choice.js:326).
(f) Test: fake `fetch` returning a slow stream; call `fetchModelFile` twice in parallel for the same path with a small file and a sha; assert exactly one network read, or that both calls return a valid file and the file hash is correct.

#### ML7. Embedding model server start removes a live server's socket  CONFIRMED in code, low reach (manual start only)

> Status: OPEN (issue 16).

(a) model-server.mjs:162 `try { fs.unlinkSync(socketPath); } catch {}` runs unconditionally before `listen`. QES does the opposite (probe first, lock, QES:77-85).
(b) Sequence. User starts `node core/embedding/model-server.mjs` twice (or two tools do). The second unlinks the first server's path and binds a new one. The first server keeps its listener on an unlinked inode, never receives a connection, never exits (no idle exit, no inode watch), and keeps a full model in memory.
(d) Impact: leaked model process (~GB). (e) Fix: copy the QES start lock and `socketAnswers` probe. (f) Test: start two servers on one temp socket; assert the second exits and the first still answers `pingModelServer`.

#### ML8. CoreML failure flag file is permanent and may blame CoreML for a non-CoreML error  SUSPECTED

> Status: OPEN (issue 16).

Unverified: how often the first create error is not CoreML related.
(a) ELM:506-519: any error from the first `InferenceSession.create` with CoreML providers is treated as a CoreML error; if the NeuralNetwork retry also fails, `.coreml-embedding-failed` is written (`writeFileSync`). ELM:483 `!existsSync(coremlFlagPath)` skips the CoreML probe for ever. No code deletes the file (grep of core, scripts, cli).
(b) Sequence. A transient error (model file being replaced, memory pressure, disk error) makes both CoreML attempts fail; the CPU-only attempt may work. The flag is written. Every later process on that machine, also after an ORT upgrade, skips CoreML for dense queries.
(d) Impact: silent slower path, no log. (e) Fix: store ORT version and an expiry in the flag; write it only if the CPU-only create then succeeds with the same file. (f) Test: mock `InferenceSession.create` to reject twice with CoreML options and resolve without; assert the flag is not written when the error text is not CoreML related, and that a flag with an old version is ignored.

#### ML9. Unload during an in-flight load: model reappears after teardown, session leaked  SUSPECTED

> Status: OPEN (issue 16).

Unverified: no caller was found that starts a load and a teardown concurrently; indexer-phases.js:607 and model-pool.js:378 call teardown after earlier warm-ups, and I did not trace whether a warm-up can still be loading then.
(a) ELM:901-910 sets `localPipeline = null; loadPromise = null` but an in-flight IIFE still runs to ELM:564 `localPipeline = {...}`. LIM:108-123 plus LIM:66 same pattern. NI:633-643 clears `_embeddingModelLoadPromise`, the in-flight load then sets `_embeddingModel` (NI:541).
(b) Sequence. Warm-up load in progress; `teardownAllModels()` runs (it releases nothing, the session does not exist yet); then a second `getLocalPipeline()` starts a second load because `loadPromise` is null. Both finish; the later one overwrites `localPipeline`, the earlier session is never released. Or the single load finishes after teardown and a CPU model is resident while the GPU arms.
(e) Fix: a generation counter; a load that finishes under an old generation releases its session and does not publish. (f) Test: fake slow `InferenceSession.create`; call `getLocalPipeline()`, `unloadLocalModel()`, `getLocalPipeline()`; expect one live session (release called on the first).

#### ML10. Lower-impact transitions (not worth a ticket alone)

> Status: OPEN (issue 16).

- EC:170 + EC:176: the RSS-cap stop after a reply disconnects a child that may still have other requests in flight (dense and LI overlap). Those fail with "encoder process disconnected"; the tick fails and requeues. Needs RSS over 6 GB.
- QES:115 + QES:136-141: after a reply over the RSS cap the server calls `process.exit(0)` in the same tick as `conn.write`. A reply larger than the socket send buffer (8 KB default on macOS) can be cut. The client gets a close, marks it `retryable` (SQE:157) and retries once on a fresh server: no wrong result, one extra cold start.
- SQE:177-181: `close()` while `opening` is pending still lets `conn = await opening` run afterwards; it leaves one unref'd idle connection. Harmless.
- Cold first load in the encoder child counts as silence: `startupGraceMs` is 120 s (EC:67). A first download of a large model inside the child sends no progress, so the client SIGKILLs it at 120 s. The tmp file is kept and the next request resumes (MF:371-378): converges, but needs several ticks.

### Checked and safe
- Double load of the dense model by two concurrent callers: the check and the set of `isLoadingLocal`/`loadPromise` are in one synchronous stretch (ELM:463-466). Same for LIM:64-65 (second caller gets `loadPromise`), NI:178-181, and `initEmbeddingPool` (IP:684-687).
- Request id reuse after child restart: ids come from a monotonic counter (EC:201); each pending entry records its child and `failPending` filters on it (EC:102-108); handlers check `child === c` (EC:147, 178).
- Child death with requests in flight in the encoder client: `error`, `disconnect` and `exit` all fail pending requests (EC:172-181); silence timer covers a hung child (EC:88-100); a throwing progress callback aborts only that request and kills the child (EC:150-161).
- Idle stop racing with a new request: idle timer checks `pending.size` (EC:190) and `call()` clears the timer first (EC:198); JavaScript is single-threaded so no gap.
- Client spawns a second query server while the first starts: start lock with atomic create, stale takeover by pid and age (QES:77-78, 192-229); loser exits (QES:78, 84, 146); a server that loses its path leaves without unlinking the newer socket (QES:129-135, 165-169).
- Server exit at the moment a client connects or sends: the client retries once on a fresh connection (SQE:198-206), ops are idempotent.
- Stale socket file after a crashed server: connect fails, client starts a server, server unlinks the stale file only after the probe fails (QES:84-85).
- Shared server unreachable: 30 s grace, then permanent fallback to an own child, one error kind for all waiters (SQE:149, query-encoder.mjs:62-69, no await between `shared.close()` and `fallback ??=`).
- ONNX mutex release on throw: try/catch inside the chained task (onnx-mutex.js:23-30). No current nested use.
- Local reranker double init: promise cleared in `finally` (local-reranker.js:58-63).
- Index-device probe lock: create `wx`, stale by liveness of holder and child plus 1 h hard limit, takeover under second mutex with nonce re-check, release only if nonce matches, signal and exit handlers, child dies with parent via stdin close and deadline (index-device-choice.js:326-420, model-pool.js:186-187, 251-269). One test per key per process (`_pendingChoices`, model-pool.js:360).
- Vocabulary and stats writes: unique temp name, rename, serialised per owner (embedding-cache.js:73-113).
- Model files appear only by rename after size and sha check (MF:458-481); a killed download leaves a tmp file that the next run resumes from its real size (MF:371-378); sha-less small files rely on size only (see F6 for the single weak spot).
- Cached-verification sidecar is dropped before the rename and keyed by size, mtime, dev and inode (MF:132-145, 477).
- Circuit breaker transitions (embedding-remote.js:8-72) are consistent; HALF_OPEN with parallel probes is a design choice.


## 11. Full index build, worktree index, init and uninstall

Ids in this section: state machines `IX-SM<n>`, findings `IX<n>`. The text below is the subsystem audit as written at the baseline commit; inside it, "F2" means IX2; "SM5" means IX-SM5.


Repository: the repository root. Read-only audit. No code was run.
Paths below are relative to the repository root. "L" numbers are line numbers in the file named.

Summary of findings (details in section 2):

| # | Finding | Confidence |
|---|---|---|
| F1 | A full rebuild (`--full`, or forced by a format change) records file hashes AFTER the build. A file edited or deleted during the build is marked "indexed" with stale content, and nothing repairs it. | CONFIRMED |
| F2 | `index --files-from-stdin` replaces the per-file state (`file-state.db`) with an empty set. | CONFIRMED |
| F3 | A worktree clone is made from a main index that is partial or in an old format. The clone is never refreshed and its maintainer stays dormant. | CONFIRMED |
| F4 | The index pause file and the clone lock trust a bare pid. After pid reuse they block for ever. | CONFIRMED (logic); needs a pid collision |
| F5 | `uninstall` sends SIGKILL / SIGTERM to the pid in a pid file or lock with no identity check. | CONFIRMED (logic); needs a stale file and a reused pid |
| F6 | `init` is not transactional. A failed init (download or verification) has already persisted the new late-interaction model. That model is part of the index fingerprint. The maintainer then goes dormant. `status` still says "Init: done". | CONFIRMED |
| F7 | The Codex installer writes its ownership manifest last. A failure in between leaves files that no later init or uninstall treats as ours. | SUSPECTED |
| F8 | An artifact (HNSW) build failure is swallowed; the baseline is published as complete. | SUSPECTED |
| F9 | An incremental `index` run that only deletes files does not rebuild the vector index. | SUSPECTED |
| F10 | A crash between two renames in the late-interaction swap leaves a stub with no segments. The next build deletes the only backup. | SUSPECTED |


### State machines

#### IX-SM1. Main index build (first, forced-full, incremental, targeted)

Where the state lives. There is NO single "index state" variable. The state is implicit in file existence and file content, in `<root>/.sweet-search/`:

| Piece | File | Written by |
|---|---|---|
| Search database | `codebase.db` | `indexer-build.js` L727-825 (full: temp file then swap; incremental: in place) |
| Code graph | `code-graph.db` | `indexer-build.js` L112-207 (temp file then swap, every run) |
| Late-interaction index | `codebase-late-interaction.db` + `.segments/` | `indexer-phases.js` L105-157 (staged, two renames) |
| Binary HNSW + int8 | `codebase-binary-hnsw.idx` | `artifact-builder.js` -> `binary-hnsw*.js` L2249-2310 (temp + rename) |
| Sparse-gram base | sparse-gram files | `indexer-sparse-gram.js` |
| Per-file state | `file-state.db` | `incremental-tracker.js` `saveState` L146-175 (rows first) |
| State header with fingerprint | `merkle-state.json` | `incremental-tracker.js` L159-162 (temp + rename, LAST) |
| Publish marker | `reconcile-manifest.json` (epoch) + `worktree-stamp.json` | `indexer-manifest.js` L39-73 |
| Run lock | `reconcile-pause.json` (see SM2) | `maintainer-launcher.mjs` L418-480 |
| Progress marker | `phase-progress.json` | `incremental-tracker.js` L441-469. It is write-only: no code reads it (grep over core, scripts, bin, tests). There is no resume. |

Implicit states (derived by `hasCompleteBaseIndex`, `baseline-readiness.mjs` L123-161, see SM3):

| State | How it is encoded | Reader behaviour |
|---|---|---|
| B0 no index | no state dir, or no data files | search throws "No search indexes found" (`sweet-search.js` L225) |
| B1 first build running | pause held by a live pid; graph/codebase may exist; no merkle, no manifest | search runs on whatever exists |
| B2 first build dead | pause stale; `code-graph.db` / `codebase.db` may exist; no merkle, no manifest | search runs; maintainer dormant (`waiting_for_initial_index`) |
| B3 ready | manifest epoch >= 1, merkle header with valid fingerprint, vectors db exists, LI not outdated | everything runs |
| B4 rebuild required | fingerprint mismatch or LI single-file format | maintainer dormant (`index-maintainer.mjs` L485-497); `index` forces full (`index-codebase-v21.js` L251-258) |
| B5 full rebuild running | pause held; tiers are swapped one by one; merkle and manifest are still the OLD ones | search reads a mix of old and new tiers |
| B6 full rebuild dead | like B5 but holder dead (SIGKILL / OOM / power) | If the old fingerprint is valid it looks like B3 (mixed tiers, see "Checked and safe" and F1/F8). If invalid it is B4. |
| B7 empty baseline | B3 with 0 files (SM4) | search returns empty |

Phases of one `index` run (`index-codebase-v21.js` main, L74-438):

1. hold the pause (L182-198);
2. choose mode (L243-258);
3. discover files (L265);
4. determine files to index (`indexer-phases.js` L219-281);
5. code graph (L283-367);
6. vectors (swap `codebase.db`), LI (staged swap), HNSW + int8, sparse-gram (L369-841);
7. state update: file rows, then merkle header (`indexer-phases.js` L843-900);
8. publish manifest + stamp (L901-906);
9. vocabulary warm-up (`index-codebase-v21.js` L414-421, non-fatal);
10. release the pause on `exit` (L196).

Invariants the code relies on:

- I1. The maintainer is stopped and cannot write while a run holds the pause.
- I2. Merkle header (with fingerprint) is written last, so "fingerprint present and valid" means the run finished (`baseline-readiness.mjs` L19-34 comment, `incremental-tracker.js` L157).
- I3. Manifest is published last, so "epoch >= 1" means all tiers were built (`baseline-readiness.mjs` L22-26).
- I4. The per-file hash/stat in `file-state.db` equals the content the index was built from (the dirty scan compares stat only, `dirty-scan.mjs` L191, L273).
- I5. A swap leaves the previous database in place if it fails (`indexer-utils.js` L219-267).
- I6. The maintainer is never the first index builder of a non-empty repo (`baseline-readiness.mjs` L1-49).

Transition table:

| From | Event | Guard | To | Side effects | Where |
|---|---|---|---|---|---|
| B0/B2/B3/B4/B6 | `index [--full]` starts | not dry-run / stats | hold | take pause (SM2); SIGTERM maintainer, wait up to 60 s; write stamp | `index-codebase-v21.js` L182-198; `maintainer-launcher.mjs` L464-470 |
| hold | another live holder past 10 min | `blockedBy` | exit 1 | nothing touched | v21 L189-195; launcher L446 |
| hold | mode decision | merkle exists and no `codebase.db` | forced full | | v21 L246-250 |
| hold | mode decision | merkle exists and fingerprint invalid (or merkle corrupt) | forced full | corrupt merkle renamed `.corrupt.<ts>` | v21 L251-258; tracker L128-136 |
| forced full | start | | | delete dead legacy artifacts | v21 L259-262 |
| any | discovery finds 0 files | `no_files` | B7 only if merkle is absent; else no-op | `establishEmptyBaseline` | v21 L276-281; `indexer-empty-baseline.js` L64-78 |
| any | no change (incremental) | | no-op (stamp already refreshed) | | phases L256-259 |
| any | graph phase | | `code-graph.db` swapped | tmp unlinked first | `indexer-build.js` L112-118, L207 |
| any | vector phase, full | | `codebase.db` swapped | `.tmp` unlinked first; sidecars move with db | L727-758; utils L206-211 |
| any | vector phase, incremental or first-no-flag | | `codebase.db` rewritten in place | delete rows for touched files, insert | L764-825 |
| vectors done | LI phase | LI enabled | staged stub + segments, two renames | stale `.tmp` cleaned first (also deletes `.segments.bak`) | phases L404, L788-798, L105-157 |
| vectors done | LI fails | | LI invalidated (deleted) | run goes on | phases L793-797, L678-684 |
| vectors done | artifacts | `embeddings > 0` | HNSW + int8 rebuilt | failure is caught and returned, run goes on | phases L801-808; `indexer-ann.js` L697-701 |
| artifacts | state update, full flag | `incrementalInfo == null` | file rows hashed NOW from disk | `DELETE FROM files` then insert, then header | phases L865-900; tracker L157 |
| artifacts | state update, incremental / first | `incrementalInfo` set | file rows from hashes taken at the START | same writers | phases L858-864 |
| state | `--graph-only` / `--vectors-only` | | state not saved | warning | phases L852-856 |
| state | publish | | B3 | epoch + 1; stamp for this root | `indexer-manifest.js` L39-73 |
| any phase | uncaught error | | process exit 1 | exit handler releases the pause | v21 L423-437, L196 |
| any phase | SIGINT / SIGKILL / OOM | no handler | B2 or B6 | pause file stays; self-heals when the pid is dead (F4) | launcher L390-393 |

#### IX-SM2. Index-run lock: `reconcile-pause.json`

State lives in `<state>/reconcile-pause.json`, payload `{paused, pausedAt, reason, holderPid}` (`maintainer-launcher.mjs` L428).

States: absent / held by live process / stale (holder dead) / frozen (no `holderPid`, set by `reconcile pause`) / unreadable.

Readers of the state: `launchMaintainer` L289, supervision tick L736, maintainer loop L1428 (`index-maintainer.mjs`), clone bootstrap (`worktree-index.mjs` L702, L708).

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| absent | hold | hard-link create succeeds | held (ours) | launcher L435, L487-503 |
| held by live other pid | hold | wait up to `waitForHolderMs` | held by other, then `blockedBy` | L444-447 |
| stale / unreadable | hold | `!pauseHolds` | removed by rename-aside, retry | L440-441, L511-520 |
| frozen | hold | no `holderPid` | respected, NOT owned (`release.ours = false`) | L451 |
| held (ours) | release / process exit | file still names our pid | absent | L471-476 |
| held by dead pid | any reader | `pidAlive(pid)` false | treated as absent | L390-393 |
| held by dead pid whose number is reused | any reader | `pidAlive` true | held for ever (F4) | L390-393 + `pid-alive.js` |

Invariant: a pause owned by a live process is the exclusive right to rewrite or copy the index. There is no time limit and no start-time check.

#### IX-SM3. Baseline readiness (derived, read-only)

`hasCompleteBaseIndex(stateDir)` (`baseline-readiness.mjs` L123-161). Evaluated in this order: `no-state-dir`, `no-manifest`, `manifest-epoch-zero`, `no-merkle-state`, `no-config-fingerprint`, `config-fingerprint-mismatch`, `missing-vectors-db`, `li-format-outdated`, else `ready`.

Consumers:
- maintainer tick (`index-maintainer.mjs` L485);
- `status` (`setup-status.js` L141);
- operator CLI (`operator-cli.mjs` L185, L498).

NOT a consumer: search init (`sweet-search.js` L211-227 checks only that `code-graph.db` or `codebase.db` exists), the ss-* tools (`run-agent-tool.mjs` L98 checks `codebase.db` only), `resolveRoots` (`worktree-roots.js` L54), and worktree bootstrap (F3). The format notice at search time (`cli-decoration.js` L294-322) is off for agents and pipes.

Fingerprint inputs (`config-fingerprint.js` L55-71): provider, model, dimension, hnswDimension, pipeline/chunking/enrichment/schema versions, hash algorithm, `liModel` + quantisation (from the RUNNING process's `LATE_INTERACTION_CONFIG`), sparse weights id, state version. There is no migration: mismatch means rebuild or refuse.

Observation (not reported as a bug): `index --no-late-interaction` or `--late-interaction-model=X` (`index-codebase-v21.js` L99-105) stamps a fingerprint other processes will not compute. The maintainer then reports `config-fingerprint-mismatch` and the next plain `index` rebuilds everything. This looks intended for one-off benchmark runs.

#### IX-SM4. Empty-repo baseline

`establishEmptyBaseline` (`indexer-empty-baseline.js` L64-78). States: no merkle (virgin) / merkle present. Transition: discovery returns 0 files and merkle absent -> create empty schemas, `updateState({})`, publish manifest -> B7 ready. If merkle exists, nothing is written (L65-67), so a repo that became empty keeps its deletion knowledge.

Implicit hazard: a transient zero-file discovery on a first run writes a ready empty baseline. The maintainer then becomes the first index builder of a whole repo (against invariant I6). I did not trace `discoverFiles`, so this is not reported.

#### IX-SM5. Worktree index bootstrap (clone)

Actors: reader process (ss-* tool, MCP server), detached bootstrap process (`worktree-index.mjs`), main checkout's maintainer, new worktree maintainer.

State lives in these places (all implicit):

| Item | Path | Meaning |
|---|---|---|
| claim file | `<main>/.sweet-search/worktree-bootstrap.<sha1(worktree)[0:16]>.json` | `{status: running/failed, pid, atMs, retryAfterMs}`; removed on success or skip (L111, L248-260, L787-793) |
| clone lock | `<main>/.sweet-search/worktree-bootstrap.lock` | serialises clones of one main index (L565-591) |
| staging dir | `<main>/.sweet-search/worktrees/<name>-<hash12>.bootstrap-<pid>` | clone under construction (L692) |
| final dir | `.../worktrees/<name>-<hash12>` | published index (L691) |
| link | `<worktree>/.sweet-search` -> final dir | what makes the worktree "indexed" (L502-511) |
| stamp | `<final>/worktree-stamp.json` | `{projectRoot, gitCommonDir, stampedAt}` (stamp file L79-88) |
| ignore line | `<git common dir>/info/exclude` | `/.sweet-search` (L487-499) |

States: 
- N0 no own index (served by main, "split"; `worktree-roots.js` L184-205); 
- N1 claim running; 
- N2 waiting for clone lock; 
- N3 holding main pause, copying (staging dir, no stamp); 
- N4 staging stamped and re-keyed; 
- N5 final dir removed, link made, final dir missing (dangling link); 
- N6 published (final dir + link); 
- N7 maintained (own maintainer running); 
- N8 failed (claim `failed`, back-off); 
- N9 stale clone (format or content differs from main; no state exists for it, see F3); 
- N10 orphan (worktree gone, final dir remains until gc).

Invariants:
- J1. The main index is at rest during the copy (pause held, `release.ours`, L702-708).
- J2. `hasIndex(worktree)` (codebase.db exists through the link) means the worktree index is usable (`worktree-roots.js` L54). The bootstrap does not establish this (F3).
- J3. Publish is one rename after the link exists (L743-748).
- J4. Only folders named by this module, and stamped by a dead or removed worktree, are deleted (L519-520, L547-563).

Transition table:

| From | Event | Guard | To | Side effects | Where |
|---|---|---|---|---|---|
| N0 | ss-* call in a split worktree | switch on, not indexed, main has `codebase.db`, no own state dir, no claim | spawn detached bootstrap | spawn only | `worktree-index.mjs` L148-173; `run-agent-tool.mjs` L112-116 |
| N0 | MCP start | split | spawn and poll up to 20 s | | L808-824; `mcp/server.js` L35 |
| spawn | bootstrap starts | `takeClaim` | N1 | claim file (link create) | L248-260, L770-784 |
| N1 | claim held by other live pid, age < 30 min | | `busy`, exit | | L137, L243-246 |
| N1 | cheap checks | own state dir / no main index / indexed | `skipped`, claim removed | | L676-678, L787-789 |
| N1 | link probe | no symlink support | N8 (24 h back-off) | | L648-661, L683-685 |
| N1 | clone lock | holder pid alive | wait 120 s, then N8 (30 s) | | L569-591 |
| N2 | lock taken | | N3 | gc of dead staging dirs | L688, L697 |
| N3 | main already paused | `reconcilePaused` or `!release.ours` | N8 (60 s) | | L701-708 |
| N3 | copy | APFS `cp -c` / reflink / plain copy within limits | N4 start | main maintainer stopped (SIGTERM), restarted after | L709-723; `cloneIndexDir` L303-334 |
| N3 | plain copy too large | > 1 GB (default) | N8 (24 h) | staging removed | L324-326 |
| N4 | stamp, re-key, queue changed files, date index | | N4 | clone gets worktree stat for unchanged files | L730-735, L351-466 |
| N4 | leftover final dir with live maintainer | | N8 (30 s) | staging removed | L738-742 |
| N4 | publish | | N5 then N6 | `rm -rf final`; link (rename over old link); rename staging -> final | L746-748 |
| N6 | stale daemon at this path | | stopped over socket | | L630-641, L751 |
| N6 | launch worktree maintainer | `launch` | N7 | | L752-755 |
| any | error | | N8 | claim `failed` with `retryAfterMs`; staging removed | L790-795, L757-760 |
| N8 | retry | age >= `retryAfterMs` | N0 | | L138 |
| N6/N7 | worktree removed | | N10 -> deleted | maintainer stops on `stateDirGone` | `index-maintainer.mjs` L1418-1427; gc L533-563 |

**Changes after the baseline (issue 7).** New states and transitions of the worktree index:

| From | Event | Guard | To | Side effects | Where |
|---|---|---|---|---|---|
| NO_INDEX (split roots) | ss-* call | main index has no manifest or no merkle state | NO_INDEX | no process is started; reason `main-index-not-ready` | `requestWorktreeIndex` |
| BOOTSTRAPPING | readiness verdict of the main checkout | verdict is a "build not finished" reason | FAILED_RECENTLY (2 min) | claim records the failure | `bootstrapWorktreeIndex` |
| BOOTSTRAPPING | readiness verdict of the main checkout | ready, or a finished build in an older format | CLONED | as before | `bootstrapWorktreeIndex` |
| CLONED, not a complete baseline | dormant tick of the clone's maintainer | linked clone of this module; stamp older than 10 min; main index looks complete; no claim holds | REPLACING | background process with `--replace` | `requestCloneReplacement`, `requestWorktreeIndex` |
| REPLACING | verdicts | main ready, clone not ready, stored fingerprints differ | CLONED (new) | main maintainer held for the copy; clone's maintainer stopped through the pause; old folder removed; link, rename; worktree daemon asked to stop; maintainer started | `bootstrapWorktreeIndex` |
| REPLACING | verdicts | main not ready | CLONED (old), FAILED_RECENTLY (2 min) | none | same |
| REPLACING | verdicts | clone ready | CLONED (old), FAILED_RECENTLY (10 min) | none | same |
| REPLACING | verdicts | clone has the main index's stored fingerprint | CLONED (old), FAILED_RECENTLY (6 h) | none; only a rebuild in the worktree helps | same |
| REPLACING | an index run holds the clone's pause | | CLONED (old), FAILED_RECENTLY (1 min) | none; that run makes the index ready | same |

New invariant: between the removal of the old folder and the rename of the new one, the
worktree's link has no target. A call in that instant finds no index in the worktree and is
served by the split roots, as before the first clone.

#### IX-SM6. Worktree stamp

`worktree-stamp.mjs` L79-123. States: absent / match / mismatch. Verified before each reconcile tick (`reconciler.mjs` L207-218). A mismatch makes every tick throw (`production-reconciler.mjs` L286-287). Absent: written. Refresh: every full run (`index-codebase-v21.js` L197) and every publish (`indexer-manifest.js` L71). No bug found.

#### IX-SM7. Init / install / uninstall

State lives in several places and none is a single record:
- `.sweet-search/config.json` (init config; `init.js` L397-400, `init-config.js` L57-63);
- `.sweet-search/created-paths.json` (`install-artifacts.js` L254-261);
- harness files: `.claude/*`, `.codex/*`, `.opencode/*`, `.mcp.json`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/*`;
- per-installer manifests holding ownership hashes (for example `.codex/sweet-search-harness.json`, written last at `install-codex-harness.js` L475);
- `~/.cache/sweet-search/` repo registry, models, shims.

States: 
- U0 not initialised; 
- U1 data dir only (`ensureDataDir` L1602); 
- U2 config "pending" (`init.js` L1902-1912); 
- U3 config "failed" after a download failure (L1747-1764); 
- U4 config final with verification pass or fail (L1923-1943); 
- U5 harness files written (partial, per installer); 
- U6 complete; 
- U7 upgraded (re-init: files replaced in place when "ours"); 
- U8 uninstalled.

Invariants:
- K1. A file counts as ours only if the installer's manifest recorded its hash and the content still matches (`install-fs.js` L36-41).
- K2. Re-running init is idempotent: `upsertOwnedGroup` (`hook-entries.js` L46-51), `.mcp.json` deep-equal check (`install-mcp-server.js` L85), invalid user JSON is refused (`hook-entries.js` L69-72; `install-mcp-server.js` L72-76).
- K3. Uninstall removes only ours, then prunes empty paths init created (`uninstall.js` L401-427).

Init order (`init.js`): L1599 register repo -> L1602 data dir -> L1637 LI policy -> L1663 assets -> L1677 ss-* links -> L1739 model download (failure: partial config, exit 1, L1747-1764) -> L1912 pre-verify config -> L1916 verify -> L1933 final config -> verification failure exits 1 (L1935-1943) BEFORE any harness file is written -> L1946 snapshot of existing harness paths -> skill, hooks, Codex, opencode, `.mcp.json`, rules -> L2276 record created paths -> report.

Uninstall order (`uninstall.js` L430-482): stop daemon (CLI stop, then SIGKILL by pid file) -> stop maintainer (SIGTERM, 300 ms, SIGKILL) -> `rm -rf .sweet-search` -> remove artifacts in run order -> prune created paths. With `--all`: shims, shared cache, npm package (L651-672).

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| U0 | `init` | not interactive-aborted | U1 | `init.js` L1599-1602 |
| U1 | model download fails | | U3, exit 1 | partial config WITH new `runtime.li` | L1747-1764 |
| U1 | download ok | | U2 | config written before verification | L1912 |
| U2 | verification fails | | U4(fail), exit 1, no harness files | L1935-1943 |
| U2 | verification passes | | U5 -> U6 | harness installers, then `recordCreatedPaths` | L1946-2276 |
| U6 | re-init | file state `ours` | U7 | files replaced in place | `install-fs.js` L36-41 |
| U6 | re-init | file state `user` | U6 | kept with a warning | e.g. `install-codex-harness.js` L397-399 |
| any | `uninstall` | | U8 | see order above | `uninstall.js` L430-482 |


### Reachable invalid states or transitions

#### IX1. Full rebuild hashes files after the build: edits and deletions during the build are lost for good (CONFIRMED)

> Status: FIXED in this pass (issue 5).


(a) Code.

- `indexer-phases.js` L252-281: `determineFilesToIndexPhase` computes `incrementalInfo` (with `currentHashes`) only when `!fullReindex`. For `--full` or a forced full, `incrementalInfo` stays `null` (L222, L276-278).
- `indexer-phases.js` L865-900 (`updateIncrementalStatePhase`, branch `else if (fullReindex)`): it reads and hashes every file in `allFiles` from disk (`contentHashSync(content)`, `fs.stat`) AFTER graph, vectors, LI, HNSW and sparse-gram are done, then calls `updateState(hashes, ...)` (L894).
- `incremental-tracker.js` L157 / `file-state-store.mjs` L138-148: `DELETE FROM files`, then insert those rows.
- The incremental path takes its hashes at the start (`incremental-tracker.js` `getChangedFiles` L193-370) and stores those. So only the full path is racy.

(b) Sequence.
1. Process P1: `sweet-search index --full`, or `sweet-search index` after an upgrade (v21 L251-258 sets `fullReindex`). The repo is large; the run takes 20-60 min.
2. T+5 min: P1 chunks and embeds `src/a.js` (version A).
3. T+10 min: the user (or `git checkout`, or an agent) edits `src/a.js` to version B, or deletes `src/b.js`. The maintainer is stopped (paused), the watcher is not running.
4. T+40 min: P1 reaches `updateIncrementalStatePhase`. It hashes `src/a.js` (version B) with B's size / mtime and stores that as "indexed". `src/b.js` cannot be read, is dropped from `hashes`, so it has no row.
5. P1 publishes the manifest, releases the pause. The maintainer restarts. Dirty scan compares stat to the rows (`dirty-scan.mjs` L191, L273): `a.js` matches, so it is not dirty. `b.js` has no row, so it is not "deleted".

(c) Guards checked and why they do not stop it: the pause stops the maintainer but not the user's editor (`maintainer-launcher.mjs` L418-480). Config-fingerprint and manifest do not know about content. The dirty scan trusts the stat in `file-state.db`. There is no second pass.

(d) Impact. Search returns version-A chunks for `a.js` (old content, wrong lines, `ss-read` disagrees with the index) until someone edits `a.js` again. Chunks of deleted `b.js` stay in `codebase.db`, graph, HNSW and LI with no way to retire them (the retire logic works from rows). This hits the most common big rebuild: the upgrade rebuild.

(e) Minimal fix. In `determineFilesToIndexPhase`, for the full branch also compute `currentHashes` before any phase (the config-invalid branch of `getChangedFiles` L200-257 already does this; reuse it), return it as `incrementalInfo.currentHashes`, and make `updateIncrementalStatePhase` always use the start-of-run hashes. Optionally add a final pass: re-stat each file at the end and enqueue (or leave out of the rows) any file whose stat changed since the start.

(f) Test. Temp dir with 3 small files. Run `determineFilesToIndexPhase` then `updateIncrementalStatePhase` with `fullReindex: true`, with a hook between them that rewrites file 1 and deletes file 2 (monkey-patch `contentHashSync` or insert the write in a stub phase). Assert `file-state.db` row for file 1 has the OLD hash/stat, and that `scanDirtyAndEnqueue` reports file 1 as modified.

#### IX2. `index --files-from-stdin` empties `file-state.db` (CONFIRMED)

> Status: FIXED in this pass (issue 5).


(a) Code.
- `indexer-phases.js` L245-250: targeted mode sets `incrementalInfo = { toIndex, toRemove: [], unchanged, currentHashes: {} }`.
- `indexer-phases.js` L858-864: `if (incrementalInfo) await updateState(incrementalInfo.currentHashes, ...)`.
- `incremental-tracker.js` L372-385, L146-175 -> `writeFileStateObject(dir, {})` -> `file-state-store.mjs` L141-143 `DELETE FROM files`.
- The flag is public: `core/cli.js` L183 help, and "Targeted Indexing (daemon mode)" in `index-codebase-v21.js` L159-163.

(b) Sequence. A full index exists (B3). The user or a script runs `printf 'a.js\n' | sweet-search index --files-from-stdin`. The run re-embeds `a.js`, rebuilds the graph, then writes merkle header (fingerprint valid, `totalFiles: 0`) and empty file rows. Baseline stays "ready" (`baseline-readiness.mjs` needs only the header). The maintainer's dirty scan finds every file "new" (no row) and enqueues up to 5000 per tick (`dirty-scan.mjs` `DEFAULT_MAX_ENQUEUE` L50), re-embedding the whole repo as "first index" work. The next plain `sweet-search index` also treats every file as changed (`getChangedFiles` L291-307).

(c) Guards: none. `updateIncrementalStatePhase` skips only graph-only / vectors-only (L852-856). Tests cover flag parsing and empty stdin only (`tests/integration/flag-semantics.test.js` L165, L213).

(d) Impact. Hours of unplanned re-embedding on large repos; deletions made earlier are forgotten (rows gone); the "freshness within 30 s" promise is lost while the backlog drains. The index data itself stays valid.

(e) Fix. In targeted mode, merge into the existing rows instead of replacing them: read `readFileStateObject`, update the rows for `toIndex` files (hash taken at start), keep the others. Or skip `updateState` for targeted runs, as for graph-only.

(f) Test. Temp project with a prepared index and 3 file rows. Run the phases with `filesFromStdin` for one file. Assert the other 2 rows still exist (`readFileStateObject(stateDir)`).

#### IX3. A worktree clone is taken from a main index that is partial or in an old format, and is never refreshed (CONFIRMED)

> Status: FIXED (issue 7). A first clone needs a finished build of the main index. A clone
> that is not a complete baseline is replaced once the main index is one. A finished main
> index in an older format is still cloned (decision in section 4.2), so "Way 2" below now
> ends with a replaced clone, not with a refused bootstrap.


(a) Code.
- `worktree-index.mjs` L152-153 and L676-678: the only main-index precondition is `fs.existsSync(<main>/.sweet-search/codebase.db)`.
- Compare with the maintainer's gate, `baseline-readiness.mjs` L123-161: manifest, merkle fingerprint, vectors db, LI format. The bootstrap never calls it.
- The only guard on the copy is `reconcilePaused(mainState)` / `release.ours` (L702-708), which holds only while a live process holds the pause.
- After publish: `hasIndex(worktree)` is true through the link (`worktree-roots.js` L54, L237), so `resolveRoots` stops splitting and serves the clone. No later step compares the clone with main (`requestWorktreeIndex` returns `indexed` at L152).
- The clone's own maintainer is dormant (`index-maintainer.mjs` L485-497) because its baseline is not ready or its fingerprint mismatches.

(b) Sequences (two ways in).

Way 1, partial main:
1. `sweet-search index` in main is killed after `codebase.db` is swapped (OOM, Ctrl-C). No merkle, no manifest. The pause is stale (dead pid).
2. A Claude Code session opens a worktree; its first ss-* call runs `requestWorktreeIndex` (`run-agent-tool.mjs` L112). `codebase.db` exists, so the bootstrap spawns. `hold` removes the stale pause, takes it, clones the partial index, stamps it, publishes.
3. The user re-runs `sweet-search index` in main: main becomes B3.
4. The worktree keeps its partial clone: no manifest, dormant maintainer, no HNSW / LI / sparse. Reads are served by it (no notice; `indexRoot == here`).

Way 2, old format:
1. The user upgrades sweet-search (fingerprint changes). Main is B4 (rebuild required).
2. A new worktree session starts; the bootstrap clones the old-format main.
3. The user runs `sweet-search index` in main. Main is current. The clone stays old-format with a dormant maintainer; `emitIndexFormatNotice` is silent for agents (`cli-decoration.js` L294-297). If the encoder changed, queries are encoded in a different space than the stored vectors (not traced); if only chunking changed, results are merely stale.

(c) Guards checked: pause (L702-708) only covers a live run; claim files only cover duplicate bootstraps; `gcWorktreeIndexes` deletes only orphans; `requestWorktreeIndex` stops at "indexed".

(d) Impact. A per-session worktree gets a permanently degraded index that looks healthy. `sweet-search status` run in the worktree reports `waiting_for_initial_index` or `index_rebuild_required` (`setup-status.js` L141), but agents rarely run it.

(e) Fix. In `requestWorktreeIndex` and `bootstrapWorktreeIndex`, require `hasCompleteBaseIndex(mainState).ready` (new skip reason `main-index-not-ready`; the split stays). In `requestWorktreeIndex` add: if the worktree has a linked clone whose `hasCompleteBaseIndex` is not ready while main's is, remove the link and clone dir (under the claim) and bootstrap again.

(f) Test. In `tests/indexing/worktree-index.test.js` style: temp main dir with a bare `codebase.db` (no manifest/merkle) -> `requestWorktreeIndex` must return `{started:false, reason:'main-index-not-ready'}`. For way 2, write a merkle header with a wrong fingerprint and assert the same. For the re-clone, publish a clone from a ready main, then change main's header and clone's header, call the request, expect a start.

#### IX4. Pause file and clone lock block for ever after pid reuse (CONFIRMED logic; needs a pid collision)

> Status: OPEN (issue 8).


(a) Code.
- `maintainer-launcher.mjs` L390-393: `pauseHolds` is `!(holderPid && !pidAlive(holderPid))`. `pid-alive.js` is `kill(pid, 0)`; it says "use a start-time check where that matters" and none is used here.
- `worktree-index.mjs` L578-579 (`takeCloneLock`): `held = holder ? pidAlive(holder.pid) : ...`. No age limit, unlike the claim file (30 min, L243-246).
- The comment in `maintainerAlive` (launcher L199-206) names pid reuse as a real failure for the maintainer lock, so the risk is known there.

(b) Sequence. A full `index` is OOM-killed (the code says this happens on large repos, `index-codebase-v21.js` L462-470) or the machine reboots or the container restarts mid-run. `reconcile-pause.json` keeps `holderPid: 4242`. Later any unrelated process gets pid 4242. Now:
- `launchMaintainer` returns `paused` (L289); supervision returns `paused` (L736); a running maintainer stops (`index-maintainer.mjs` L1428-1437). The index is never maintained again.
- `sweet-search index` waits 10 min (`HOLDER_WAIT_MS` L398), then exits 1: "The index is held by another process (pid 4242)" (v21 L189-195).
- Every worktree bootstrap fails with "paused", retry 60 s (`worktree-index.mjs` L701-708).
The same for a clone lock whose holder died.

(c) Guards: none apart from `reconcile resume` (manual, `operator-cli.mjs` L349, L491), which nothing points the user to; `status` does not print the pause.

(d) Impact. Silent permanent freeze of maintenance and of new indexing until a manual command.

(e) Fix. Store `startedAtMs` and the process start time (or `pid` + boot id) in the pause and lock payloads. Treat a holder as live only if the pid is alive and the file is younger than a limit (for example the maintainer-lock style heartbeat, or 6 h), or the start time matches. Show the pause in `status`.

(f) Test. Temp state dir; write a pause with `holderPid` = a pid that is alive but unrelated (for example the test's own parent) and `pausedAt` 7 days ago; assert `pauseHolds` is false after the fix. Same for `takeCloneLock` with an old `atMs`.

#### IX5. `uninstall` signals any live pid found in a pid file or lock (CONFIRMED logic; needs stale file and reused pid)

> Status: OPEN (issue 8).


(a) Code.
- `uninstall.js` L193-204: `process.kill(pid, 0); process.kill(pid, 'SIGKILL');` for the pid in `projectPidFile`. The graceful stop (L180-189) fails silently when the daemon is dead.
- `uninstall.js` L253-259: `if (pidAlive(pid)) { SIGTERM; sleep 300 ms; SIGKILL }` for the pid in `index-maintainer.lock`. It does not use the heartbeat check that `maintainerAlive` uses (`maintainer-launcher.mjs` L216-239).
- `worktree-index.mjs` L627 states the risk in words: "a pid file can outlive its daemon and name an unrelated process by then".

(b) Sequence. A daemon or maintainer was SIGKILLed or the machine rebooted; `daemon.pid` / `index-maintainer.lock` remain. Pid is reused by the user's editor or database. The user runs `sweet-search uninstall`. Uninstall kills that process.

(c) Guards: none. A confirmation prompt exists but does not mention processes (L622-635).

(d) Impact. Loss of an unrelated process of the same user (unsaved editor state).

(e) Fix. Check identity first: for the daemon, ask the socket (`/health` pid) and signal only that answer; for the maintainer, require a fresh heartbeat and a matching command line (process title `sweet-search-*`).

(f) Test. Temp project; write `index-maintainer.lock` with `{pid: <pid of a spawned `sleep 60`>, timestamp: 0}`; run `stopRunningMaintainer`; assert the sleep process is still alive after the fix.

#### IX6. `init` persists the new late-interaction model before it can succeed; a failed init leaves a dormant maintainer and still reads as "done" (CONFIRMED)

> Status: OPEN (issue 13).


(a) Code.
- `init.js` L1747-1764: on download failure it writes `partialConfig` built with `liChoices` (so `runtime.li.model` = the new choice, `buildConfig` L2405-2416) and exits 1. `init.js` L1902-1912 writes the config before verification; L1935-1943 exits 1 after a failed verification.
- `init-config.js` L170-210 (`applyPersistedLiModel`) feeds that value into `LATE_INTERACTION_CONFIG.model`; the maintainer applies it before its gate (`index-maintainer.mjs` L481). `buildConfigFingerprint` includes it (`config-fingerprint.js` L63).
- `setup-status.js` L160: `initialized: Boolean(config)`; `verification.result` ('failed'/'fail') is never read.

(b) Sequence. A healthy install uses `lateon-code`. The user runs `sweet-search init --li-model edge` offline (or the host lacks disk). Model download fails; config now says `lateon-code-edge`; exit 1. Next maintainer tick: fingerprint `liModel` differs from the stored index fingerprint -> `config-fingerprint-mismatch` -> `reconcile dormant`. Search resolves the LI model from the same config but the stored LI index is the old model's (dimension 128 vs 48; effect on search not traced). `status` prints "Init: done". The fix needs the model download that just failed.

(c) Guards: none; init has no rollback and the earlier config is overwritten (`writeInitConfig` replaces it).

(d) Impact. A working install is degraded by a failed command; index freshness stops silently.

(e) Fix. Write the config once, at the end, only after verification passes; on failure write only to a diagnostics file (`config.failed.json`) and keep the old `runtime.li`. Make `status` use `verification.result === 'pass'` for "initialized".

(f) Test. Temp project with a passing config (`runtime.li.model = 'lateon-code'`). Run `runInit` with a stubbed download that fails and `--li-model edge`. Assert `readPersistedLiPolicy` still returns `lateon-code` after the failure.

#### IX7. Codex harness: manifest written last, so a failed first install is unowned (SUSPECTED)

> Status: OPEN (issue 13).


(a) `install-codex-harness.js` L409 (instructions file), L447 (`config.toml` block), L453 (hooks flag), and only then L475 (manifest). `fileState` (`install-fs.js` L36-41) calls any file without a recorded hash 'user'. The `catch` (L479-481) returns `error` without writing the manifest.
(b) Sequence. First `init --codex`: L409 and L447 succeed; a later `writeAtomic` throws (disk full, EACCES) or the process is killed. Files exist, no manifest. Re-run: file state is 'user' ("kept", L397-399), the config block is "edited by hand" (L431-432), `createdConfig` is computed as false because the config now exists (L383). `uninstall` finds no manifest (`removeCodexHarness` L505) and leaves the file, the block and the config.
(c) Guards: the sentinel-hash design assumes the manifest exists. Not verified: whether the other installers (opencode, lean harness) share this order; a thrown error needs one of the writes to fail.
(d) Impact: leftover `.codex/sweet-search-instructions.md` and config keys after uninstall; stale prompt after upgrade.
(e) Fix: write the manifest with the intended hashes BEFORE the files (or an intent record), and rewrite it after. 
(f) Test: stub `writeAtomic` to throw on the second call; re-run init; assert the first file is classified `ours` and `uninstall` removes it.

#### IX8. Artifact build failure is swallowed and the baseline is published as complete (SUSPECTED)

> Status: OPEN (issue 13).


(a) `indexer-ann.js` L697-701 returns `{error}` instead of throwing. `indexer-phases.js` L689-695 / L801-808 then call `markPhaseComplete('artifacts')`, and the run continues to `updateIncrementalStatePhase` (L843-906), which writes merkle and manifest.
(b) Sequence. First `sweet-search index`; the HNSW build fails (ENOSPC, "No vectors found" `artifact-builder.js` L454-457). Run exits 0 with "INDEXING COMPLETE". Baseline: ready. `status` says `Vector index: no` but `index.ready` true and `nextStep` null (`setup-status.js` L142-147, L119-124). Next `index`: "No changes detected" (`phases.js` L256-259).
(c) Not verified: what search does without the HNSW. `sweet-search.js` L1038 shows an O(N) vector scan fallback, so the harm may be latency only; also whether the maintainer builds a missing HNSW.
(d) Impact: very slow semantic search on large repos, reported as healthy.
(e) Fix: treat a failed or missing artifact in a full run as a failed run (do not publish), or record `vectorIndex: missing` in the manifest and make the readiness gate and `status` report it.
(f) Test: stub `buildQuantizedArtifacts` to throw during a full run; assert no `reconcile-manifest.json` epoch >= 1.

#### IX9. An incremental run with only deletions leaves deleted chunks in the vector index (SUSPECTED)

> Status: OPEN (issue 13).


(a) `indexer-phases.js` L801: the HNSW + int8 rebuild runs only `if (vectorStats.embeddings > 0)` (also L689, L771). A run where `toIndex` is empty and `toRemove` is not gives 0 embeddings, while `buildVectorIndex` still deletes the rows from `codebase.db` (`indexer-build.js` L780-796) and `updateState` then records the deletion.
(b) Sequence. The user deletes `old.js`, runs `sweet-search index`. Rows are removed; the HNSW (rebuilt only on new embeddings) still holds the old node ids. Not verified: how the 3-stage search treats an HNSW hit whose `codebase.db` row is gone (it might drop it, or return it from HNSW metadata).
(d) Impact if not filtered: results for deleted files until the next rebuild. The maintainer path uses tombstones, so it is unaffected.
(e) Fix: rebuild or tombstone the artifacts when `toRemove` is non-empty.
(f) Test: temp index; delete a file; run an incremental build; assert the id is absent from the HNSW id set.

#### IX10. Late-interaction swap: crash window and a cleanup that deletes the only backup (SUSPECTED)

> Status: OPEN (issue 13).


(a) `indexer-phases.js` L117-119: live segments renamed to `.segments.bak`; L124-128: staged segments renamed in; stub swapped at L128. A crash between those renames leaves the OLD stub (valid JSON, `format: segmented`) and no live segments dir. The reader's self-heal named in the comment (L87-92) covers `.tmp.segments`; `grep` finds no reader that handles `.segments.bak`. `liIndexOutdated` returns false when the manifest cannot be read (`baseline-readiness.mjs` L106-111), so baseline stays ready. The next build starts with `cleanupStagedLateInteractionIndex` (L404), which removes `finalPath + '.segments.bak'` (L72): the only copy.
(b) Window is two renames, so it is narrow (needs SIGKILL / power loss exactly there). Impact: LI rerank unavailable until a full rebuild; no data loss beyond LI.
(e) Fix: on start of a build, if live segments are missing and `.bak` exists, restore it (as `swapOnce` does for databases, `indexer-utils.js` L225-239); and make the readiness gate fail when the stub's segment dir is missing.
(f) Test: create the post-crash layout in a temp dir and call the build start; assert the live dir is restored.


### Checked and safe

- Two full index runs on one root. The pause is created by an atomic hard link (`maintainer-launcher.mjs` L487-503), the second run waits (L444-450) and then exits 1 with `blockedBy` (`index-codebase-v21.js` L189-195). A stale pause is removed by moving the exact version aside (L511-520). Test: `tests/indexing/index-run-holds-maintainer.test.js`.
- Full index while the maintainer reconciles. The hold sends SIGTERM and waits 60 s (`maintainer-launcher.mjs` L464-470); the maintainer force-exits 10 s after a stop signal (`index-maintainer.mjs` L1069, L1343-1347). A maintainer spawned in the gap sees the pause at the top of its loop before any tick (L1428-1437); launcher and supervision refuse to spawn while paused (L289, L736).
- Worktree clone vs a running full index. The clone needs `release.ours` and refuses on a held pause (`worktree-index.mjs` L701-708). An index run waits for a live clone (launcher L444-450). Test: "an index run waits for a live clone's pause" (`tests/indexing/worktree-index.test.js` L326).
- Two sessions bootstrapping the same worktree. Claim file created by exclusive link (`worktree-index.mjs` L181-204, L248-260); stale claim removed only as the judged version (L214-226); clones of one main index are serialised by the clone lock (L569-591).
- Torn publish of a clone. Staging dir with a pid-named suffix, stamp, re-key, link first, then one rename (L692, L743-748). A crash leaves staging (removed by `gcWorktreeIndexes` when its pid is dead, L541-545, also on every bootstrap L688 and maintainer start `index-maintainer.mjs` L1181) or a dangling link, which `resolveRoots` treats as "no index" and falls back to the split (`worktree-roots.js` L54, L252-253) and which `canLink` / `linkStateDir` replace (L648-661, L502-511).
- Clone copies only index entries, never runtime files, locks, queues, `-shm` or temp names (`worktree-index.mjs` L78-105).
- Re-key reads stat before content (L369-374), so an edit during the re-key leaves a newer stat and is picked up by the next scan.
- Clone date: unchanged files read fresh, changed files read stale (`indexDateMs` L430-437).
- Removed worktree: maintainer stops on `stateDirGone` (`index-maintainer.mjs` L1418-1427); `gcWorktreeIndexes` acts only inside `.sweet-search/worktrees`, only on module-named folders, only on stamped ones (`worktree-index.mjs` L514-563).
- Interrupted upgrade rebuild. File rows are written before the header, header by rename (`incremental-tracker.js` L157-162), so the old (invalid) fingerprint stays until the run finishes: the next `index` forces full again (`index-codebase-v21.js` L251-258) and the maintainer stays dormant (`baseline-readiness.mjs` L146-149).
- Killed FIRST build. No merkle and no manifest, so `hasCompleteBaseIndex` is false (`baseline-readiness.mjs` L128-142) and the maintainer does not build the index (`index-maintainer.mjs` L485-497). The next plain `index` runs the incremental path and re-adds every file.
- Stale `.tmp` files from a killed build are deleted at the start of the next build (`indexer-build.js` L112-118, L730-736; `indexer-phases.js` L404). SQLite: an old `-wal` beside a freshly created 0-page `.tmp` db is deleted by SQLite itself (SQLite behaviour, not code in this repo; not run), and the streaming path also unlinks `-wal` / `-shm` explicitly (`streaming-vectors.js` L113, L248). Swaps move a database with its sidecars (`indexer-utils.js` L184-267, restore of a lone `.bak` at L225-239).
- Empty repo that was indexed before keeps its merkle (`indexer-empty-baseline.js` L65-67).
- Stale stamp after a folder move: every run refreshes it before any early exit (`index-codebase-v21.js` L197; `indexer-manifest.js` L71).
- `uninstall` stops the daemon and maintainer before deleting the state dir (`uninstall.js` L440-453), so the maintainer does not re-create the directory.
- Init idempotence for hooks and `.mcp.json`; invalid user JSON is refused, not overwritten (`hook-entries.js` L46-51, L69-72; `install-mcp-server.js` L72-76, L85).

Not examined in depth: `admission-policy.js`, `indexer-pool.js`, `indexer-worker.js`, the other installers (`install-claude-*`, `install-opencode-harness.js`), `scripts/user-shims.js`, `repo-registry.js`, and what search does with an HNSW id that has no database row.


## 12. Requests: MCP server, ss-* tools in the daemon, span ledger, native grep lane

Ids in this section: state machines `RQ-SM<n>`, findings `RQ<n>`. The text below is the subsystem audit as written at the baseline commit; inside it, "F1" means RQ1; "M5" means RQ-SM5.


Scope: read-only audit. Nothing was run. Every claim cites code read in this session.
Confidence words: CONFIRMED = every step traced in code. SUSPECTED = one named step is not verified.

Overall verdict: the per-call isolation (AsyncLocalStorage virtual process), the ledger call numbering and the lane
decline path are sound. I found no CONFIRMED way to make two concurrent calls see each other's cwd, env, stdout or exit code.
The findings below are mostly lifecycle edges (shutdown, upgrade, stdin close) and one lane robustness defect.


### State machines

#### RQ-SM1. MCP server lifecycle (mcp/server.js, mcp/server-main.js)

State lives in: module-level `_searcher` (server-main.js:95), `lastSupervisedAt` (:167), `queryEncoder` (:450), the SDK `McpServer`
connection state, and the process itself. The lifecycle is mostly IMPLICIT (no state variable; it is the SDK's connection state plus process life).

States: BOOT (server.js top-level await prepareWorktreeRoot, :51) -> LOADED (server-main import, tools registered) -> CONNECTING (main(): startQueryEncoder, server.connect, :464-467)
-> SERVING (handshake done by SDK; tool calls in flight, concurrent, no queue) -> SHUTDOWN (signal) -> EXITED. There is no "stdin closed" state (see F4).

| from | event | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| BOOT | start | argv/env has root, or no worktree split | LOADED | none | server.js:23,30 |
| BOOT | start | linked worktree without root override | LOADED | ensureWorktreeIndex waits up to 20 s; env root set to worktree even on failure | server.js:35-47 |
| LOADED | main() | none | SERVING | encoder child registered (lazy), transport on stdin, maintainer launch | server-main.js:464-482 |
| SERVING | tools/call | handler wrapper | SERVING | superviseMaintainer at most every 15 s | server-main.js:177-183 |
| SERVING | SIGINT/SIGTERM | none | EXITED | queryEncoder.close, server.close, process.exit(0) at once; in-flight calls are dropped | server-main.js:452-462 |
| SERVING | stdin end/close | none | (no transition) | process lives only if some handle keeps the loop alive | F4 |
| SERVING | second `initialize` | SDK | SDK decides | nothing in this repo handles it | not in repo |

Lazy engine connection (M1b): `getSearcher` (:97-104) -> `getWarmSearcher` (core/search/sweet-search.js:1158-1178).
States (implicit, encoded in `_warmSearcher` + `_warmInitPromise`): NOT_CONNECTED (both null) -> CONNECTING (promise set) -> CONNECTED (`initialized`) or FAILED -> back to NOT_CONNECTED
(both reset in the catch at :1166-1172, so a failure is not cached). Concurrent callers share one promise. Invariant: `_warmSearcher` is non-null only while its init promise is live or succeeded.
The MCP server never reconnects after CONNECTED: if the index is rebuilt by the `index` tool, the same warm searcher instance stays (no reload hook seen in these files; not verified further).

Tool call life in MCP (M1c): received (SDK validates zod input) -> running (handler) -> done | isError result. No timeout, no cancellation: handlers never read `extra.signal`.
`handleIndex` is the only handler with a timer: 5 min SIGTERM then 5 s SIGKILL (tool-handlers.js:304-312); `timedOut = code === null || code === 143` (:332).
Concurrent `index` calls are safe because the indexer takes a lock (core/indexing/index-codebase-v21.js:183-194, exits 1 with "held by another process").

#### RQ-SM2. Virtual process = one ss-* call inside the daemon (core/agent-tools/virtual-process.js)

State lives in: `installed` (module singleton, :46), the AsyncLocalStorage `callStorage` (call-context.js:11), and the per-call record `{env, cwd, pid, inDaemon, stdout[], stderr[], memo?, gutterForm?}` (:144).
States of the process-wide patch: UNPATCHED -> PATCHED (idempotent, never unpatched, :95-126). States of one call: CREATED (:144) -> RUNNING (storage.run, :146) -> EXITED_BY_SIGNAL (ExitSignal caught, code set, :150) | FAILED (other throw -> stderr line, code 1, :152-157) | RETURNED (code 0) -> COLLECTED (Buffer.concat, :160).
Invariants the code relies on: (1) every async continuation of a call carries the call store; (2) tool code never calls process.exit from a callback that is not awaited by the call (an ExitSignal thrown there is an uncaught exception; checked: commands/ have no such callbacks, only shared.mjs:387 setTimeout in an awaited promise); (3) env writes land in a private copy (daemon-route.js:136 `{...call.env}`).

| from | event | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| any | process.stdout/stderr.write | store present | buffer push | write not forwarded; callback queued as microtask | virtual-process.js:54-63 |
| any | process.stdout.write | no store | real write | daemon's own output unchanged | :57 |
| RUNNING | process.exit(n) | store present | EXITED_BY_SIGNAL | throws ExitSignal | :111-116 |
| RUNNING | console.log | store present | RUNNING | line goes to the call's stderr buffer | :119-123 |
| RUNNING | throw (not ExitSignal) | err.userFacing ? one line : stack | FAILED | code 1 | :152-157 |
| COLLECTED | late write by a leftover async task of this call | buffer already concatenated | lost | output silently dropped | :160 (benign) |

#### RQ-SM3. POST /agent-tool route and the native client (core/agent-tools/daemon-route.js, search-server.js:1014-1036, crates/sweet-search-cli/src/agent_tools.rs:446-571)

Request states (implicit): RECEIVED -> BODY_READ (readBoundedJsonBody; aborts on close) -> VALIDATED (:63-77) -> WAITING_READY (searcher tools only; up to 60 s, ss-search up to 90 s minus elapsed) -> RUNNING (virtual process) -> ROOT_MISMATCH (409) | ANSWERED (200 with code/stdout/stderr) -> RESPONDED.
There is no explicit in-flight counter, no per-call timeout, and no client-disconnect handling after the body was read.

| from | event | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| RECEIVED | TCP caller | remoteAddress set | 403 | none | daemon-route.js:98 |
| BODY_READ | bad payload | validate | 400/413 | client runs tool in process | :63-77; agent_tools.rs:546 |
| WAITING_READY | not ready after budget | search && !failed | 200 code 1 retry line | none | :115-117 |
| WAITING_READY | not ready after budget | else | 503 | client runs tool in process | :118; agent_tools.rs:546 |
| RUNNING | assertProjectRoot fails | realpath != daemon root | 409 | stdout discarded; client runs tool in process | :125-127,145-147 |
| RUNNING | tool throws | any | 200 code 1 (not 500) | client prints, does not retry | virtual-process.js:152; agent_tools.rs:561-570 |
| client | any transport error (reset, timeout 600 s, daemon died) | not NotFound/Refused first time | RERUN in a fresh process | the tool may already have run and recorded ledger receipts in the daemon | agent_tools.rs:540 |
| client | status 500 | none | print error, exit 1, no rerun | | agent_tools.rs:549-552 |

Client chain state (M3b): chain position decided once per call (agent_tools.rs:348-369, chain.js:151-159); registry = one empty file per shell key in /tmp/sweet-search-chain-<uid> created with `wx` (chain.js:133); first creator = first call (returns false), later = true while file mtime within 30 min (:140). Files are swept only when a new one is created (:134). The daemon never decides: it reads `env.SWEET_SEARCH_CHAIN_LATER` (chain.js:234).

#### RQ-SM4. Per-session span ledger (core/search/agent-span-ledger.js, handler search-server.js:167-210)

State lives in: one `AgentSpanLedger` per daemon in the daemon closure variable `agentSpanLedger` (search-server.js:863, created lazily with `||=`), `sessions: Map<sessionId, {call, receipts, overrides, queryContext}>` (:384, :390-395). In memory only; lost at daemon exit (documented fail-open: full output).
Per session: ABSENT -> ACTIVE(call=n) (beginCall creates, :408-419) -> ABSENT by LRU eviction when more than 32 sessions (:402-404) or `reset`/`drop` (:509-512).
Per receipt: RECORDED(shownAtCall=c) -> SERVED-AS-OMISSION (override recorded, one-use force, :499) -> EXPIRED (age > 30 calls, pruned in beginCall :412-414) or EVICTED (> 64 receipts, :466-468).
Invariants: call numbers only increase inside one session instance; a decision at call c only trusts receipts with 0 < c - shownAtCall <= window (:489-495); an op for an unknown session or a call number above the session's counter is a no-op that fails open (:422-423, 456-457, 476-478).

| from | event | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| ABSENT/ACTIVE | observe/read op | valid session id | ACTIVE(call+1) | LRU touch, prune expired, remember query, record or decide | search-server.js:194-199; ledger :408-419 |
| ACTIVE | read op, span proven by older receipt | age in 1..30 | ACTIVE | span printed as "unchanged", override stored | :480-503 |
| ACTIVE | read op with `force` and pending override | within window | ACTIVE | override consumed, full output | :484-487 |
| ACTIVE | observe of older call than an existing receipt | existing.shownAtCall > call | ACTIVE | skipped (guards out-of-order) | :462 |
| ACTIVE | SessionEnd hook `drop`, SessionStart `clear`/`compact` `reset` | valid id | ABSENT | | session-daemon-prewarm.mjs:319-340; search-server.js:177-179 |
| ACTIVE | 33rd session | LRU | oldest ABSENT | in-flight call of the evicted session then fails open | :402-404 |

Lane receipts (M4b): the lane thread pushes `LaneReceipt` into a process-wide Vec (lane/mod.rs:113-123, server.rs:71-73). JS drains it (a) at the start of POST /agent-tool and /agent-spans (search-server.js:987), (b) every 2 s when `handled` changed (:1666-1675). Each receipt becomes an `observe` with no spans, which only bumps the call counter and remembers the regex (:1421-1432).

#### RQ-SM5. Native grep lane (crates/sweet-search-native/src/lane/*, core/search/grep-lane.js)

State lives in: `RUNNING` OnceLock<Mutex<Option<Handle>>> (mod.rs:225-229); `Lane{config, counters, loaded: Mutex<Loaded>, manifest: Mutex<Option<(sig, Manifest)>>}` (:82-89); `Loaded{index, graph, overlay}` (state.rs:104-108); JS side `lane` and `sqliteBridge` (grep-lane.js:19-20); `laneOn` (search-server.js:889).
Lane process states: OFF -> STARTING (JS `startGrepLane`, awaits better-sqlite3 bridge :43-58; env SWEET_SEARCH_GREP_LANE=0 or non-English locale => stays OFF) -> RUNNING (accept thread, one connection at a time, server.rs:38-45) -> STOPPED (`stop` flips flag, connects to wake, removes socket, mod.rs:254-260).
Per-request decision (implicit in `call`, mod.rs:131-180): PARSED -> ENV_OK -> ROOT_OK -> SESSION_OK -> MANIFEST_PRESENT -> NO_REINDEX_PENDING -> LOADED (lock, prepare) -> GREP -> ANSWER (code 0 only) or DECLINE(reason). Any panic = DECLINE("panic") (:127-128).
Cached artifacts: manifest keyed by file signature `ino:len:mtime:mtime_nsec` (engine.rs:46-50, mod.rs:94-110); index reloaded when path or signature changed (state.rs:111-117, engine.rs:81-83); graph connection reopened on signature change (state.rs:122-129); overlay rebuilt from `deltas`+epoch (mod.rs:197-204).

| from | event | guard | to | side effects | file:line |
|---|---|---|---|---|---|
| RUNNING | connection | len > 1 MiB | DECLINE | counters.declined++ | server.rs:59-60 |
| RUNNING | request read fails/times out (5 s) | | drop connection silently | client treats as Declined | server.rs:52-64; agent_tools.rs:414-419 |
| ENV_OK | any SS_FIX_/SS_GREP_/SS_VARIANT_/SS_SIBLING_LINE env, output switch, git location env, bad chain value | | DECLINE | | gate.rs:71-85 |
| ROOT_OK | env root or cwd not the lane's own repo, nested checkout | realpath compare | DECLINE | | gate.rs:97-126 |
| SESSION_OK | would need process-tree walk | | DECLINE | | gate.rs:136-162 |
| MANIFEST_PRESENT | queue or processing file non-empty | | DECLINE "reindex pending" | | state.rs:95-100 |
| GREP | pipeline Err | | DECLINE | | mod.rs:178 |
| GREP | Ok | | ANSWER | receipt queued BEFORE the bytes leave; counters.handled++ | server.rs:69-83 |
| ANSWER | write to client fails | | nothing | client reads short, treats as Declined, JS answers again; receipt already queued | server.rs:82; agent_tools.rs:428 |

#### RQ-SM6. Daemon lifecycle for in-flight requests (core/search/search-server.js)

State: `shuttingDown` (:894), `lastActivityMs` (:881), `serverReady`/`grepReady`/`initError` (:~1566-1582). States: STARTING -> GREP_READY -> READY | FAILED; any -> SHUTTING_DOWN -> EXITED (process.exit(0), :940).
Idle clock: `lastActivityMs` is set when /agent-tool starts (:1017) and ends (:1035), by in-process ledger ops (:1486-1488), and by the 2 s lane timer when the lane's `handled` count changed (:1666-1675). Timer check every 60 s (:1622-1633), TTL default 20 min. There is NO in-flight counter: a running call does not hold the clock.
Shutdown order (:913-941): clear timers; unregister; stopGrepLane (removes lane socket, mod.rs:254); close TCP and Unix servers with 3 s grace each (:899-910); searcher.close; queryEncoder.close; `fs.unlink(pidFile)`; `fs.unlink(socketPath)`; exit.

#### RQ-SM7. Hook state between prompts (scripts/hooks/hook.mjs, core/search/session-daemon-prewarm.mjs)

State lives in: files only. `/tmp/sweet-search-prewarm.lock` (global per user, not per project; `wx` create holds pid, :52,230-257), `CLAUDE_ENV_FILE` (appends `SWEET_SEARCH_SESSION_ID`, :75-81), the daemon ledger (reset/drop ops). Machine: SessionStart(source=clear|compact) -> reset op (750 ms) -> prewarm server (lock) -> if reset not acknowledged, one retry after the socket answers (:357-366). SessionEnd -> drop op, exit 0. `--session-title` and `--read-hint` hooks keep no state in the files I read for this audit (session-title.mjs, intercept-read.mjs not read in full).


### Reachable invalid states or transitions

#### RQ1. One panic in the lane permanently disables the lane (mutex poison)  -- CONFIRMED mechanism; the panic trigger is hypothetical

> Status: OPEN (issue 16).


(a) Code:
- crates/sweet-search-native/src/lane/mod.rs:127 `catch_unwind(... call(lane, payload))` turns a panic into `Decline("panic")`.
- mod.rs:154 `let Ok(mut guard) = lane.loaded.lock() else { return Outcome::Decline("lane lock") };`
- `[profile.release]` has no `panic = "abort"` (Cargo.toml:92-96), so the panic unwinds and poisons the `Mutex` that `call` holds (`guard`).

(b) Sequence: 1) daemon runs, lane RUNNING. 2) Call A passes the gate and takes `lane.loaded.lock()`. 3) Code under the lock panics (any slice index, unwrap or arithmetic overflow in pipeline.rs, overlay.rs, graph.rs, baregrep.rs for an odd index/input). 4) catch_unwind returns Decline("panic"); the guard is dropped during unwind, which poisons the mutex. 5) Every later call reaches mod.rs:154, `lock()` returns Err(PoisonError), the call declines with "lane lock". 6) `warm()` (:220) skips too. Nothing recreates `Lane` except a daemon restart (`grep_lane_start`).

(c) Guards checked: catch_unwind (handles only the one call); no `into_inner()` recovery anywhere in mod.rs/state.rs for `loaded`; `manifest` lock has a fallback (:97,109) but `loaded` has none; JS never learns (stats still `running: true`, grep-lane.js:67-70).

(d) Impact: every ss-grep for the rest of the daemon's life takes the JS route (about 2x slower per the project notes, still byte-identical). Silent: no log line.

(e) Fix: `let mut guard = lane.loaded.lock().unwrap_or_else(|e| { let mut g = e.into_inner(); *g = Loaded::default(); g });` (reset the cached artifacts after a poison) and log the first decline reason.

(f) Test: unit test in lane/mod.rs with a `Lane` whose `loaded` mutex was poisoned by a thread that panics while holding it; assert `run_call` still answers (or at least that a second call does not return "lane lock").

#### RQ2. Old daemon deletes the new daemon's socket and pid file at shutdown  -- SUSPECTED (timing window; libuv socket unlink on close not verified)

> Status: FIXED in this pass (issue 1). Same defect as D10. The removal of the path on close was confirmed by a test (`tests/infrastructure/socket-claim.test.js`).


(a) Code: search-server.js:925-926 `await closeServerGracefully(tcpServer); await closeServerGracefully(unixServer);` then :933 `await fs.unlink(pidFile)` and :936 `await fs.unlink(socketPath)`. No check that the files still belong to this process.

(b) Sequence: 1) Old daemon D1 starts shutdown (idle-ttl, `/stop`, cap eviction, index-removed). 2) `unixServer.close()` stops listening at once (Node/libuv removes the socket file when the listening pipe closes; this step is the unverified one). 3) A client ss-* call finds no socket (NotFound), calls `auto_start_server_for` (agent_tools.rs:518-522). 4) New daemon D2 health-probes, finds nothing, imports sweet-search.js, unlinks a stale socket and binds the same path (search-server.js:1520-1537). 5) D1 is still in the 3 s grace (an in-flight request) or in searcher.close/queryEncoder.close/rssRegistration.unregister. 6) D1 reaches :933-936 and unlinks the path D2 just created, and D2's pid file. D2 is alive and unreachable by path.

(c) Guards: D2's "existing daemon" probe (:800-812) only sees listeners; the pid file is written by D2 only after its init (:1569) so D1's unlink can hit either file; no inode or pid check.

(d) Impact: an orphan daemon (1 to 4 GB) until its idle TTL; clients keep starting new daemons; the maintainer supervision uses the pid file path, so it can lose track.

(e) Fix: before unlinking, stat the socket and compare inode with the one recorded after bind; unlink the pid file only when its content equals `process.pid`.

(f) Test: start a fake server that binds the socket path after the first server closed and before its unlink step (inject a hook between close and unlink); assert the second socket file still exists after shutdown completes.

#### RQ3. MCP stdio server has no stdin-close handling: orphaned MCP process, and the maintainer follows it  -- SUSPECTED (depends on what keeps the event loop alive)

> Status: OPEN (issue 16).


(a) Code: server-main.js:461-462 handles only SIGINT/SIGTERM; no `process.stdin.on('end'|'close')`, no `server.onclose`. The SDK transport (node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js:21-41) registers only `data` and `error` on stdin, so `onclose` never fires on EOF. `launchMaintainer({daemonPid: process.pid})` (:477) ties the maintainer's life to this process.

(b) Sequence: 1) MCP client runs one `search` (warm searcher, HNSW, models loaded, query-encoder child registered). 2) Client closes the pipes without a signal (client crash, parent exit that does not kill its children, config reload). 3) stdin ends; the transport does nothing. 4) If any handle remains (searcher timers, worker threads, encoder child IPC) the process never exits. 5) The maintainer sees a live `daemonPid` and keeps running.

(c) Guards: none seen in mcp/. tests/integration/mcp-server.test.js:94 closes stdin and expects exit, but that test does not warm a searcher.

(d) Impact: leaked 1 to 3 GB process per closed client session plus a leaked maintainer (matches the project memory "orphans first").

(e) Fix: `process.stdin.on('end', () => shutdown('stdin-closed')); process.stdin.on('close', ...)`.

(f) Test: spawn mcp/server.js with a fake searcher that holds a `setInterval`, send initialize + one tool call, `child.stdin.end()`, assert exit within 2 s.

#### RQ4. MCP omission feature can never turn on over stdio (dead path)  -- CONFIRMED (not an invalid state; a state that is unreachable)

> Status: OPEN (issue 16).


(a) Code: server-main.js:119-123 `validAgentSessionId(extra?.sessionId) ? extra.sessionId : null`. `StdioServerTransport` has no `sessionId` property (stdio.js shown above), so SDK `extra.sessionId` is `undefined` (protocol.js:316 `capturedTransport?.sessionId`).
(b) Sequence: any tool call over stdio -> `requestAgentSessionId` returns null -> `touchAgentCall` returns early (:127), `handleSearch`/`handleRead` skip the ledger (tool-handlers.js:136,243; read-tool.js:119).
(d) Impact: MCP `read` never prints "unchanged reread omitted" and never records spans. Safe (fail open) but the documented ledger behaviour does not apply to MCP; the note at :120-121 says it is intended to avoid inherited env ids, so confirm the product intent. Tests that inject `extra.sessionId` hide it.
(e) Fix (if wanted): take a session id from the client (`_meta`, roots, or `CLAUDE_CODE_SESSION_ID` captured at initialize).
(f) Test: drive the real stdio transport with a tool call and assert a ledger op reaches a fake `/agent-spans` socket.

#### RQ5. A call that recorded receipts but whose reply never reached the agent makes the next read of the same span print "unchanged"  -- SUSPECTED, low (narrow window)

> Status: OPEN (issue 16).


(a) Code: ss-read records first, prints later: core/agent-tools/commands/read.mjs:183-190 (`recordAgentToolCall(... operation:'read')` then `applyReadOmissionDecisions`), output at :246-256. The daemon route has no disconnect handling after the body was read (search-server.js:1014-1036) and cannot undo ledger writes.
(b) Sequence: 1) agent runs `ss-read f 1 40`; the native client posts to the daemon. 2) Daemon records receipt R at call n (ledger observe/read). 3) The harness kills the client in the few milliseconds before the reply is written (ESC, timeout), or the daemon exits between record and reply (then the ledger is gone, so safe). 4) Reply is discarded. 5) Agent repeats `ss-read f 1 40`: call n+1 sees R at age 1 and returns `# unchanged, shown 1 call ago ...; only if that copy is gone, add --force`.
(c) Guards: the `--force` hint and one-use override (ledger :484-487) let the agent recover; no rollback.
(d) Impact: one wasted turn; the agent never saw the lines.
(e) Fix: return receipts in the reply and commit them to the ledger after `res.end` callback, or record on `res.on('finish')`.
(f) Test: fake client that closes the socket after the server logs the ledger write; second call must print full text.

#### RQ6. The in-process /search shortcut runs the daemon's handler inside the caller's call context  -- SUSPECTED (header comment says the opposite; no concrete harmful consumer verified)

> Status: OPEN (issue 16).


(a) Code: virtual-process.js:20-23 states a request back to the daemon "is served OUTSIDE the call's context". But search-client.js:137-138 `inProcessSearch.request(...)` and search-server.js:1458-1475 call `handleRequest(req, res)` directly from the tool's async chain, so the whole search pipeline runs with `callStorage` = the caller's store (process.env = caller's env copy, process.cwd() = caller's cwd, console.log and process.stdout.write captured into the caller's buffers). The HTTP path (agent-span-client.js:81-109 over the socket) is outside the context; the in-process path is not.
(b) Sequence: 1) call A (ss-grep from repo cwd X, env with its own SS_* values) enters queryServer. 2) The handler and everything it awaits or starts lazily (single-flight init promises, timers, first-use module loads) inherit A's store. 3) Call B (different env/cwd) awaits a promise created in A's context; the work reads A's env and writes console.log to A's (already collected) stderr buffer.
(c) Guards: only `search-reader-pin.js:40,94` isolates its linger timer with an `AsyncResource`; I found no other isolation. I did not find a module-level env capture in core/agent-tools or the modules they import (grepped top-level `process.env` consts: none), so no concrete wrong output is proven.
(d) Impact: possible stale env/cwd in daemon-lifetime state created on the first call; lost daemon log lines.
(e) Fix: run the in-process request with `callStorage.exit(() => inProcessSearch.request(...))` (and the same for the span handler if it ever awaits).
(f) Test: fake handler that records `process.env.X` and `process.cwd()` inside a timer it starts; call it from two virtual processes with different env; the timer must see the daemon's values, not the caller's.

#### RQ7. Stale daemon after a package upgrade: lazy imports mix new files with old modules in memory  -- SUSPECTED (whether upgrade restarts daemons is not verified; no version stamp in /health seen)

> Status: OPEN (issue 16).


(a) Code: search-server.js:1018-1020 `daemonRouteModule ||= import('../agent-tools/daemon-route.js')...; const {...} = await daemonRouteModule;` sits OUTSIDE the try at :1022-1034; daemon-route.js:52-56 `loadToolModule` lazily imports run-agent-tool.mjs and, through it, the commands. No `unhandledRejection`/`uncaughtException` handler exists in core or mcp (grep).
(b) Sequence: 1) daemon D runs version 1 for hours. 2) `npm i -g` replaces the files. 3) First ss-* call after the upgrade: the lazy import loads new daemon-route.js, which imports an export that the already-loaded old module lacks (SyntaxError at link time), or a file that moved. 4a) If it throws at :1020: handleRequest rejects, the http server ignores the promise, Node's default unhandled-rejection exit kills the daemon (client sees a reset and re-runs in process, self-heals on the next autostart). 4b) If it throws inside `run` (daemon-route.js:130): caught by runInVirtualProcess, answered as HTTP 200 code 1 "[ss-*] crash", `toolModule` reset to null (:53) so the next call retries and fails the same way. The client does not fall back on 200 (agent_tools.rs:554-570). Each failing call also counts as activity (:1017,1035), so the idle TTL never ends it.
(c) Guards: failure resets the memo (good) but nothing compares daemon and client versions.
(d) Impact: ss-* tools return exit 1 until someone stops the daemon.
(e) Fix: put the version (package.json) in /health and make the client restart a daemon whose version differs; move the import inside the try.
(f) Test: fake `daemonRouteModule` whose import rejects once; assert the server answers 5xx and stays alive.

#### RQ8. Gutter harness cache is keyed by project, validated by the harness pid only  -- SUSPECTED, low (macOS, harness without a primary env marker)

> Status: OPEN (issue 16).


(a) Code: core/search/gutter-form.js:343-348 `harnessCachePath` hashes `SWEET_SEARCH_PROJECT_ROOT`; :352-360 `readHarnessCache` returns the entry while its pid is alive and younger than 12 h (:230); used at :373-381 and only when no primary env marker (CLAUDECODE, CODEX_SANDBOX*, OPENCODE, CURSOR_*) matched (:407-411). Linux reads /proc and skips the cache (:374).
(b) Sequence: 1) harness H1 (for example `pi`, no primary marker) runs an ss-read in repo P; cache = {pi, pid1}. 2) a different harness H2 without primary markers (for example `devin`) calls ss-read in P within 12 h while pid1 lives. 3) H2 gets H1's form.
(d) Impact: wrong line-number gutter for H2 (extra or missing `N:` prefix). Cosmetic, can mislead edits.
(e) Fix: key the entry by the caller's harness pid, or store the pid walk top and require it to be an ancestor of the current call.
(f) Test: `detectHarnessCached` with two fake process tables and one shared cache file.

#### Lower-value observations (not findings)
- The lane serves one connection at a time on one thread (server.rs:38-45); a slow regex blocks all other lane callers until their 120 s client read timeout (agent_tools.rs:410). Performance only, output stays correct (the JS route can answer instead only after the timeout).
- Lane receipts are drained before /agent-tool and /agent-spans but not before /search?, /read-semantic or /read routes that call `beginAgentSpanUrlCall` (search-server.js:326,426,1176). A non-ss client (CLI `--agent`) can number a call before a pending lane receipt. Effect: query-evidence anchors only; no span receipts are in lane receipts.
- Global prewarm lock `/tmp/sweet-search-prewarm.lock` serialises all repos (session-daemon-prewarm.mjs:52); the second repo's hook skips the spawn (latency only). The stale-lock steal (:245-253) can let two hooks both hold the lock (unlink then `wx` race); the daemon's own health probe limits the damage.


### Checked and safe

1. Concurrent ss-* calls do not share cwd, env, stdout, stderr or exit code. `process.env`, `process.cwd`, `process.exit`, `process.stdout/stderr.write`, `console.log` are all read through `callStorage.getStore()` (virtual-process.js:56-123); each call gets its own env copy (daemon-route.js:136) and its own buffers (virtual-process.js:144). `process.env` proxy handles Object.keys and spawn (:65-90).
2. Call that throws or exits: `process.exit` becomes ExitSignal and is caught per call (:150); other errors become one stderr line, code 1 (:152-157). No global patch is left in place after a call (patch is permanent and call-scoped by design). No counter exists that could stay non-zero.
3. Tool module memo and daemon-route module memo reset on import failure (daemon-route.js:53-54, search-server.js:1019).
4. Lazy MCP engine: failed init is not cached and concurrent callers share one promise (sweet-search.js:1158-1178).
5. Ledger lost update: all ledger operations from in-daemon calls run synchronously with no await between begin and observe in one op (search-server.js:194-199; agent-span-client.js:70-79 `handle` is sync, JSON round trip copies the payload). Two parallel calls of one session get distinct call numbers (ledger :411).
6. Out-of-order parallel calls: `age <= 0` receipts are never used for omission (ledger :490-491); an observe older than the stored receipt is skipped (:462); `call > session.call` fails open (:423, 457, 477).
7. Session evicted between begin and observe: `sessions.get` returns undefined and the op fails open (full output) (:422, 456, 476). Re-created sessions restart at call 1; a late observe with a small call number only adds an older receipt, which only delays omission.
8. Lane receipts versus `reset`/`drop`: /agent-spans drains pending lane receipts first (search-server.js:987), so a pre-reset grep cannot reappear after a reset.
9. Lane stale artifacts: manifest, index and graph are re-read by file signature (engine.rs:46-50,81-83; state.rs:122-129; mod.rs:94-110); a missing manifest or non-empty maintainer queue declines (mod.rs:148-153; state.rs:95-100). Epoch pin: the daemon keeps a reader heartbeat on the manifest epoch every 2 s (search-server.js:889-893,1667); a pin one epoch behind only retains more rows, never fewer, so a lane call on the new manifest is safe.
10. Lane root identity: explicit root, cwd with index, and cwd below root are compared by `realpath` (gate.rs:87-126); nested checkouts, other indexes and worktrees with their own index decline.
11. Lane panic or error mid-request: the call is declined, and the reply is written only after `run_call` returns (server.rs:66-90), so the request is never answered twice by the lane. If the answer write fails, the client re-asks the JS route (agent_tools.rs:428-431); only a harmless duplicate receipt (query anchors) results.
12. BOM parity: lane strips U+FEFF like the JS route (pipeline.rs:62,123,190 versus daemon-route.js:149).
13. Concurrent MCP `index` calls: the indexer refuses to run when another holds the index (index-codebase-v21.js:183-194). The 5 s SIGKILL timer outlives the call but kills an already exited child harmlessly (tool-handlers.js:309-311).
14. Daemon shutdown with in-flight /agent-tool: connections get a 3 s grace then `process.exit(0)` (search-server.js:899-940); the client treats the reset as "daemon did not answer" and re-runs the read-only tool in process (agent_tools.rs:540). Safe because the tools are read-only and the ledger dies with the daemon.
15. Reader-pin linger timer is created inside an `AsyncResource` so it keeps no call context alive (search-reader-pin.js:40,94).
16. Chain registry: creation is atomic (`wx`, chain.js:133); the decision is made once per call and passed in env (agent_tools.rs:354-359, chain.js:152). Known documented limit: a subagent shares its parent's session id (ledger doc :66-68; context.mjs comment), so omission can refer to spans the subagent never saw; the `--force` hint covers it.
17. Hook reset race: if the daemon is cold during `/compact`, the hook retries once after the socket answers (session-daemon-prewarm.mjs:357-366).


## 13. How to keep this file current

- A change to a lifecycle, a lock, a queue, a load path or a publish sequence updates the
  transition table of its state machine in the same commit.
- A fix changes the status line of its finding and the row in the register (section 4.1), and
  names its regression test in section 4.2.
- A new finding gets the next free id of its subsystem, an evidence level and an issue number.
- Line numbers in sections 6 to 12 are from the baseline commit. Replace them when you touch
  the text around them; do not trust them after later commits.
