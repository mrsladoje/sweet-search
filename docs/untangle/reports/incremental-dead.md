# incremental-dead report

## 1. Done
- Deleted (git rm) core/incremental-indexing/infrastructure/lockfile.mjs. Proof: whole-repo search finds importers only in tests; `acquireLock`/`releaseLock` hits elsewhere are unrelated local functions (session-daemon-prewarm.mjs, real-daemon-wrapper.mjs).
- Deleted core/incremental-indexing/domain/encoder-deps.mjs and infrastructure/schema-migrations.mjs. Proof: importers are tests only; no product code creates `encoder_input_dependencies`.
- Deleted tests/indexing/incremental-indexing-lockfile.test.js and tests/indexing/incremental-indexing-encoder-deps.test.js (tested only removed modules).
- Test surgery, live assertions kept: incremental-indexing-atomicity-crash.test.js (lockfile and encoder-schema describes removed), -structural-invariance.test.js (dependency persistence, dependencyRowsForFile, forgetFile/dependentsOf assertions removed), -coverage-boost.test.js (encoder-deps describe removed), -schema.test.js (encoder dependencies describe removed). Header comments adjusted.
- T2: comment pointers removed in domain/encoder-input.mjs (comment-only) and infrastructure/worktree-stamp.mjs (now names acquireStateLock in index-maintainer.mjs).

## 2. Not done and why
- hcgs-invalidation.mjs KEPT. Live code reads `hcgs_summary_metadata`: infrastructure/graph-gc.mjs `pruneRetiredGraphSummaries` (:264-275, called :366), infrastructure/maintenance-state-reader.mjs:226, core/infrastructure/code-graph-visibility.js:130-150, core/graph/graph-search.js. incremental-indexing-graph-gc.test.js uses `recordSummary` to set up the table that `pruneRetiredGraphSummaries` then reads, so per the brief I stopped. Its tests (hcgs-invalidation, graph-gc, multi-tier-workflow) are unchanged. Option for lead: the table is created by no product code, so `pruneRetiredGraphSummaries`, the state-reader count and the graph-search/code-graph-visibility probes are dead-in-practice together; removing them is a multi-file decision.
- tombstone-injector.mjs KEPT: scripts/incremental-indexing-tombstone-sensitivity.mjs imports it (research script). Its tests kept.
- T3 variables not removed (as instructed).

## 3. Behavior questions
None.

## 4. Needs follow-up
- core/graph/graph-search.js (:152-352), core/infrastructure/code-graph-visibility.js (:130-150): probe `hcgs_summary_metadata`, never created by product code.
- Docs naming deleted files (not in my set): docs/INCREMENTAL_INDEXING_RUNBOOK.md:29 (`lockfile.mjs::acquireLock`), docs/INCREMENTAL_INDEXING_PREFLIGHT_RESULTS.md:257,261,283,360, docs/INCREMENTAL_INDEXING_PLAN.md.

## T3. Env overrides (all read inside core/incremental-indexing; "sets/documents" = elsewhere in repo, excluding docs/untangle)
| Variable | Read at | Default | Set or documented elsewhere |
|---|---|---|---|
| SWEET_SEARCH_BINARY_HNSW_DEAD_THRESHOLD | domain/watermark-scheduler.mjs:59 | 0.30 | docs/INCREMENTAL_INDEXING_PLAN.md; tests multi-tier-workflow; scripts/incremental-soak/{cross-process,real-daemon}-soak.mjs |
| SWEET_SEARCH_LI_SEGMENT_STALE_THRESHOLD | watermark-scheduler.mjs:60 | 0.20 | PLAN.md; both soak scripts |
| SWEET_SEARCH_LI_SMALL_SEGMENT_THRESHOLD | watermark-scheduler.mjs:61 | 16 | none |
| SWEET_SEARCH_LI_SEGMENT_COUNT_THRESHOLD | watermark-scheduler.mjs:62 | 200 | none |
| SWEET_SEARCH_SPARSE_DELTA_RATIO | watermark-scheduler.mjs:63 | 0.10 | both soak scripts |
| SWEET_SEARCH_SPARSE_DELTA_SEGCOUNT | watermark-scheduler.mjs:64 | 64 | both soak scripts |
| SWEET_SEARCH_FTS5_MERGE_SEGMENT_THRESHOLD | watermark-scheduler.mjs:65 | 64 | PLAN.md; soak scripts; tests multi-tier-workflow, watermark |
| SWEET_SEARCH_VECTOR_GC_COUNT_THRESHOLD | watermark-scheduler.mjs:66 | 5000 | none |
| SWEET_SEARCH_VECTOR_GC_RATIO_THRESHOLD | watermark-scheduler.mjs:67 | 0.25 | none |
| SWEET_SEARCH_GRAPH_GC_COUNT_THRESHOLD | watermark-scheduler.mjs:68 | 5000 | tests graph-gc |
| SWEET_SEARCH_GRAPH_GC_RATIO_THRESHOLD | watermark-scheduler.mjs:69 | 0.25 | tests graph-gc |
| SWEET_SEARCH_PAGERANK_INTERVAL_MS | watermark-scheduler.mjs:70 | 120000 | none |
| SWEET_SEARCH_VOCAB_CHANGE_RATIO | watermark-scheduler.mjs:71 | 0.05 | none |
| SWEET_SEARCH_VOCAB_CHANGE_ROWS | watermark-scheduler.mjs:72 | 2000 | none |
| SWEET_SEARCH_VOCAB_INTERVAL_MS | watermark-scheduler.mjs:73 | 600000 | none |
| SWEET_SEARCH_VECTOR_GC_BATCH | application/maintenance-handlers.mjs:418 | DEFAULT_GC_BATCH (vector-gc.mjs) | none |
| SWEET_SEARCH_VECTOR_GC_MAX_ROWS | maintenance-handlers.mjs:419 | 100000 (vector-gc.mjs:35) | none |
| SWEET_SEARCH_GRAPH_GC_BATCH | maintenance-handlers.mjs:444 | DEFAULT_GRAPH_GC_BATCH (graph-gc.mjs) | none |
| SWEET_SEARCH_GRAPH_GC_MAX_ROWS | maintenance-handlers.mjs:445 | 100000 (graph-gc.mjs:56) | none |
| SWEET_SEARCH_LI_MERGE_GRACE_MS | maintenance-handlers.mjs:395 | 60000 (li-segment-merge.mjs:49) | none |
| SWEET_SEARCH_RECONCILE_PROFILE | domain/interval-autotune.mjs:306 | unset (fresh=10s, balanced=tuner, conservative=20s) | docs/PREHEATING.md:106; tests interval |
| SWEET_SEARCH_RECONCILE_INTERVAL_MS | interval-autotune.mjs:299 | unset (tuner) | PREHEATING.md, PLAN.md; tests interval, maintainer-stop, cli-index-subcommand; real-daemon-soak.mjs |
| SWEET_SEARCH_MAINTAINER_BACKSTOP_WALK_MS | interval-autotune.mjs:217 | 600000, clamp 300000..900000 | tests daemon-lifecycle |
| SWEET_SEARCH_RECONCILE_V2 | interval-autotune.mjs:353 | on | README.md:1331, PREHEATING.md, many tests/eval/harness; actively set: KEEP |
| SWEET_SEARCH_RECONCILE_FILES_PER_TICK | application/production-reconciler.mjs:271,294,807 (not my file) | 50 | PLAN.md; test reconciler |
| SWEET_SEARCH_RECONCILE_CPU_BUDGET_MS | production-reconciler.mjs:272 (not my file) | reconciler default | PLAN.md; test reconciler |
| SWEET_SEARCH_HASH_ALGORITHM | infrastructure/hash-algorithm.mjs:7 | xxhash3 | PLAN.md, PREFLIGHT_RESULTS.md; tests hashing, coverage-boost, final-branches |
| SWEET_SEARCH_TOMBSTONE_SEED | comment only (tombstone-injector.mjs:12); code uses DEFAULT_SEED 42 | 42 | none (comment-only mention; not read) |
| SWEET_SEARCH_PROJECT_ROOT / SWEET_SEARCH_STATE_DIR | operator-cli.mjs:77,83; maintenance-handlers.mjs:111,512; production-reconciler.mjs:277,278 | cwd / <root>/.sweet-search | set widely (launcher, tests, eval): KEEP |
| SWEET_SEARCH_MAINTAINER_IDLE_TTL_MS, SWEET_SEARCH_RSS_BUDGET_FRACTION | comment only (interval-autotune.mjs:115) | n/a | read by core/indexing files: not an issue here |
Note: no SWEET_SEARCH_MAINTENANCE_* variable exists in this folder.
Nothing sets (outside tests/soak scripts/docs): the 15 watermark thresholds except the ones with tests, the 4 GC batch/max-rows, LI_MERGE_GRACE_MS, RECONCILE_PROFILE (docs only), TOMBSTONE_SEED.

## 5. Verification
- `npx vitest run tests/indexing/incremental-indexing-*.test.js tests/indexing/maintainer-lifecycle-fix.test.js tests/graph` -> Test Files 123 passed (123), Tests 1997 passed (1997).
- `node --check` on all edited files: clean. `npx eslint` on edited core and test files: no output (clean).
