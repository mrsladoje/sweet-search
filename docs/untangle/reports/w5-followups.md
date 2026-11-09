# w5-followups report

## Done
1. APPLIED. git mv state-files.mjs -> core/infrastructure/state-files.mjs (imports nothing); 11 importers updated. Added RECONCILE_MANIFEST ('reconcile-manifest.json'); manifest.mjs MANIFEST_FILENAME now = it. Literals replaced by constants in: maintainer-watcher, grep-corpus, index-maintainer, maintainer-launcher (MAINTAINER_LOCK_FILENAME = MAINTAINER_LOCK), worktree-index (RUNTIME_FILES, lock, queue, codebase.db, code-graph.db, manifest), search/index-freshness, search-read-semantic, search-pattern-sparse-overlay, sweet-search, worktree-roots, index-coverage, infrastructure/code-graph-visibility, codebase-repository. Comments / messages keep literals. search-read.js (ss-grep shaping) left alone. Boundary counts: indexing->incr 30/30, incr->indexing 16/16 (no new import into either; lane not affected: spelling only).
2. APPLIED for graph-expansion.js and search/*: core/search/stage-timing.js -> core/infrastructure/stage-timing.js; importers updated; graph-expansion local copy removed. NOT APPLIED for core/ranking/file-kind-ranking.js: it does not copy __ptStart/__ptEnd; it sums 12 per-rule times in a Float64Array and pushes one value per rule key per call. __ptEnd per rule would change the pushed values/counts. Kept.
3. APPLIED. tombstone-bitmap.mjs imports createBitmap/saveBitmap/resizeBitmap/setBit and the layout helpers from the reader (reader now exports HEADER_*, BITS_PER_BYTE, payloadByteLength, byteAndMask); writer loadBitmap = reader load + Buffer.from copy. isSet/popcount stay in the writer: reader versions return false/0 for a null bitmap, writer throws. sparse-gram-delta.mjs imports DELTA_DIR_SUFFIX/DELTA_FILE_EXT from the reader and re-exports them (indexer-sparse-gram.js and sparse-gram-fold.mjs import them from it).
4. APPLIED. Dead native backend removed from hashing.mjs (sync + async resolver, makeNativeXxh3, variable, header lines). `rg xxhash3_64 crates`: no hit. contentHashSync before/after for 6 inputs identical (2d06800538d394c2 e6c632b61e964e1f c0a4877b962cba82 4437e8b2b419184d 56fd036216eb8d09 86b01ca01cb95e6c). final-branches test passes.
5. APPLIED. env-flag.js: isEmbedForcedToCpu(env = process.env) (=== '1'). Used at indexer-phases, indexer-pool, indexer-ann (negated, passes its env), plus the 2 identical sites in embedding/embedding-local-model.js. DIFFERENT, stays: index-device-choice.js splitDeviceSwitches (also accepts true/on, trims, covers 3 switches). VIEW_EXT: view-templates.js exports VIEW_TEMPLATE_EXTENSIONS (sets equal, 9 entries); minified-detector uses it.
6. APPLIED. No research use of setRepoMapModule. The QualityScorer is built in core/search/search-postprocess.js, so the repoMap option is passed there (imports ../graph/repo-map.js); sweet-search.js call+import removed; setter, fallback variable, barrel export removed.
7. APPLIED (table below). New core/infrastructure/pid-alive.js pidAlive(pid): integer > 0, kill 0, EPERM = alive, else false.
8. APPLIED. isSparseGramAddon exported from native-sparse-gram.js; predicate bodies were identical; used by grep-lane.js and loadAddon.
9. APPLIED. `export` added to LI_SEGMENT_SIZE (10_000 both) in late-interaction-index.js; li-segment-state.mjs imports and re-exports it (merge/reader keep importing from state). No cycle.
10. APPLIED. Comment in run-agent-tool.mjs now names search-client.js.

## pidAlive table (EPERM -> alive unless noted; non-EPERM error -> dead)
| file:line | guard | result vs owner |
| scripts/uninstall.js:222 | finite && >0 | same for all inputs (non-integer makes kill throw -> false). Replaced |
| core/indexing/maintainer-launcher.mjs:180 | finite && >0 | same. Replaced |
| core/indexing/worktree-index.mjs:119 | isInteger && >0 | identical. Replaced |
| core/indexing/index-device-choice.js:254 | isInteger && >0 | identical. Replaced |
| core/incremental-indexing/application/operator-cli.mjs:123 | isInteger && >0 | identical. Replaced |
| core/incremental-indexing/infrastructure/maintenance-state-reader.mjs:290 | isInteger && >0 | identical. Replaced |
| core/incremental-indexing/infrastructure/reader-heartbeat.mjs:137 | (inside isReaderAlive) isInteger && >0 | same probe. Replaced with pidAlive call |
| core/search/query-encoder-server.mjs:184 | none; caller ensures holder > 0 | same for reachable input. Replaced |
| core/search/gutter-form.js:349 | none; caller ensures integer > 1 | same for reachable input. Replaced |
| core/indexing/index-maintainer.mjs:1106 | none; callers ensure positive integer | same for reachable input. Replaced |
| core/search/daemon-registry.js:148 | Number(pid), isInteger && >0 | pidAlive(Number(pid)): identical. Kept as exported wrapper |
| core/indexing/rss-budget.mjs:326 | Number(pid), isInteger && >0, returns !!  | identical to daemon-registry; now imports it |
| core/search/session-daemon-prewarm.mjs:170 | !pid || !finite | DIFFERENT: a negative pid probes a process group. Stays |
| core/indexing/index-maintainer.mjs:91 isPidRunning | none, also /proc start-time check | DIFFERENT. Stays |
| scripts/cleanup-stale-processes.mjs:115 | integer | DIFFERENT: EPERM = dead. Stays |
| scripts/incremental-soak/real-daemon-soak.mjs:1215 | none | DIFFERENT: EPERM = dead. Stays |
| scripts/uninstall.js:198 | inline probe in another function | stays |

## Behavior questions
None.

## Needs follow-up
- scripts/check-boundaries.js caps (30 / 16) can be lowered if the lead wants; counts did not rise.

## Verification
- node --check on every edited file: clean.
- `npx eslint core/ mcp/ scripts/uninstall.js`: no output (clean).
- `npm run -s build`: Build OK
- `node scripts/check-boundaries.js | tail -2`: "All domain boundaries clean." / "64 internal, 602 external barrel bypass warning(s) — not blocking."
- cycles: only `core/prompt-optimization/sweep/gepa.mjs, gepa-cli.mjs` (count 1).
- `npx vitest run` (after one fix: sparse-gram-delta.mjs re-exports the two constants): Test Files 530 passed | 1 skipped (531); Tests 9410 passed | 26 skipped (9436). The first run had 85 failures from the missing re-export; fixed.
- No leftover processes (ps checked).
