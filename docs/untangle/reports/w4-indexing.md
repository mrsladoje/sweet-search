# w4-indexing report

## Done
1. State-file names (partial, incr side): new leaf core/incremental-indexing/infrastructure/state-files.mjs (no imports) with DIRTY_QUEUE, PROCESSING_QUEUE, MERKLE_STATE, PAUSE_FILE, MAINTAINER_LOCK, CODEBASE_DB, CODE_GRAPH_DB, LI_STUB_DB, BINARY_HNSW_INDEX (same strings). Used in dirty-scan, operator-cli, production-reconciler, maintenance-handlers, baseline-readiness, graph-gc, hnsw-compaction, li-segment-merge, maintenance-state-reader, sparse-gram-fold, vector-gc.
2. Pause reader: maintainer-launcher.mjs exports readReconcilePause(stateDir, onUnreadable); reconcilePaused and index-maintainer isReconcilePaused (keeps its WARN) delegate. Stale "deliberately reimplemented" comment removed.
3. Version counters: PIPELINE_VERSION and STATE_VERSION moved to index-format-versions.js; config-fingerprint.js re-exports STATE_VERSION.
4. DEFAULT_DENY_DIRS: path-filter.mjs exports DEFAULT_DENY_DIRS_HARD; maintainer-watcher builds its list from it (arrays compared: equal). It reaches it through grep-corpus.js (re-export without a new import line, so the boundary count is unchanged).
5. liveVectorSql: one definition in new core/indexing/vector-visibility.js (signature (alias)); artifact-builder, indexer-ann, indexer-sparse-gram use it; the unused __TEST__ entries removed (no repo user).
6. Files per tick: dead `filesPerTick` line in createProductionReconciler removed; _dirtySliceLimit uses DEFAULT_FILES_PER_TICK (now exported from reconciler.mjs; the finding said it was exported, it was only in __testing). Parsing unchanged.
7. JSON helpers: new core/incremental-indexing/infrastructure/json-file.mjs (readJsonFile, writeJsonAtomic, writeJsonAtomicSync); used by production-reconciler, production-li-delta, maintenance-state-reader, li-segment-merge, operator-cli. li-segment-merge now creates the parent dir before the write (as the finding allowed).
8. Document extensions: DOC_EXTENSIONS exported from document-chunker.js, used in ast-chunker; redundant .txt case dropped. `.markdown` stays out.

## Not done
- State-file names on the indexing side (maintainer-launcher, index-maintainer, worktree-index incl. RUNTIME_FILES, grep-corpus, maintainer-watcher) and the MAINTAINER_LOCK_FILENAME/MANIFEST_FILENAME re-exports: any new import across indexing <-> incremental-indexing breaks the declared maximum (30 and 16, both at the limit). Needs the maximum raised in scripts/check-boundaries.js, or the leaf placed in core/infrastructure.
- State-dir resolution: no unification. The six copies differ (table below), so none is shared.
- Policy counters (EMBED_TEXT/LI_INPUT/DEDUP_INPUT_POLICY_VERSION) stay in encoder-input.mjs: the import into index-format-versions.js would be an 17th incremental-indexing -> indexing import.
- liveVectorSql inline sites in production-reconciler/hnsw-compaction/tombstone-injector and the shared symbolMaskOfMetadata: same boundary limit (incr -> indexing at 16).
- HASH_ALGORITHM single evaluation: applied, then reverted. tests/indexing/incremental-indexing-final-branches.test.js re-imports hashing.mjs with a changed env; with the shared constant the env is read only once and the test fails.
- VIEW_EXT in minified-detector.js: needs VIEW_TEMPLATE_EXTENSIONS exported from core/infrastructure/view-templates.js (outside my set).
- embedForcedToCpu / liForcedToCpu: needs core/infrastructure/env-flag.js (outside my set).
- worktree-index.mjs readJson: would add a cross import (limit).
- LI_SEGMENT_SIZE mirror: report only (core/ranking/late-interaction-index.js:204 needs `export`; li-segment-state.mjs:31 then re-exports it).
- chunkFiles empty catch (indexer-build.js ~609): report only; it drops files silently.
- Idle check NaN (index-maintainer.mjs:1341) and NaN files-per-tick: behavior questions, unchanged.

## Behavior questions
State-dir resolution table (all differ for a relative SWEET_SEARCH_STATE_DIR or a symlinked/missing root):
| copy | env state dir | project root | resolve | realpath/link |
|---|---|---|---|---|
| maintainer-launcher.mjs:190 resolveStateDir | raw value | SWEET_SEARCH_PROJECT_ROOT or cwd | none | none |
| index-maintainer.mjs:165 reconcileV2Context | resolved | env or PROJECT_ROOT const, resolved | yes | realpath of state dir only when it is a symlink; dangling link kept as given |
| production-reconciler.mjs:264 | options.stateDir first, then env | options/env/cwd, resolved | yes | none |
| operator-cli.mjs:83 | options.stateDir first, then env | realpath.native of root when it exists | yes | root only |
| grep-corpus.js:263 | opts.stateDir, then env | given root | none | none |
| worktree-index.mjs:64 | STATE_DIR_NAME constant under a given root | given | n/a | n/a |
Question: unify on the resolved form (only a relative env value changes for launcher and grep-corpus)?
Also recorded earlier: operator-cli pauseSnapshot reports paused for any parsable file (daemon uses pauseHolds); RUNTIME_FILES lacks the rebuild-queue files; `.markdown` routing; NaN on malformed env.

## Needs follow-up
- core/infrastructure/view-templates.js:28-29: export VIEW_TEMPLATE_EXTENSIONS (then minified-detector.js:37 uses it).
- core/infrastructure/env-flag.js: add embedForcedToCpu/liForcedToCpu; sites indexer-phases.js:516, indexer-ann.js:80,87, indexer-pool.js:185, embedding-local-model.js:591,677, late-interaction-model.js:334,347.
- scripts/check-boundaries.js:87-88: raise the two maxima if the indexing-side state-files migration is wanted.
- core/ranking/late-interaction-index.js:204: export LI_SEGMENT_SIZE.
- core/search/index-freshness.js:25, search-pattern-sparse-overlay.js:16, search-read-semantic.js:90 spell state file names as literals.

## Verification
- node --check on every edited file: clean; plain-node import of each edited module: clean (this found the missing DEFAULT_FILES_PER_TICK export, fixed).
- npx eslint core/ : no output (clean).
- node scripts/check-boundaries.js | tail -2: "All domain boundaries clean"; indexing->incr 30/30, incr->indexing 16/16.
- npx vitest run tests/indexing tests/integration/barrel-contracts.test.js tests/search/worktree-roots.test.js: 149 files, 2146 tests passed.
