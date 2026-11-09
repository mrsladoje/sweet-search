# tests-indexing-3 report

1. Counts: 39 test files -> 39. `it` blocks 526 -> 524 (2 removed).
2. Removed:
   - indexer-phases-wiring.test.js, "imports PROJECT_ROOT from the infrastructure config barrel": rule 2 (import line text). The next test in the file still asserts `projectRoot: PROJECT_ROOT` in the options bag.
   - js-ts-chunking-hardening.test.js, "JS chunker has moduleExportObj": rule 3 (`toBeDefined` only). "detects module.exports = { object form" runs the regex and checks the capture.
3. Rewritten:
   - incremental-tracker.test.js, "should handle corrupt JSON gracefully": it never wrote corrupt JSON and only checked types. It now writes invalid JSON to the state file and asserts `hasState === false`.
4. Fixed flaky / environment-dependent:
   - incremental-tracker.test.js (whole integration + E3 sections): cause: the tests called `clearState()` / `updateState()` on the repository's real `.sweet-search/merkle-state.json` and file-state db (outcome depended on the developer's local index, and it destroyed that state). Fix: `vi.hoisted` sets `SWEET_SEARCH_DATA_DIR` (a relative path to a private temp dir) before the tracker loads, `beforeEach` throws if `DB_PATHS.merkle` is outside that dir, `afterAll` removes the dir. 46/46 pass.
   - indexer-resource-plan.test.js: the `skipIf(os.cpus() < 8)` test is a real host-capacity gate (planAllocation reads host cores). Kept; the condition is now in the test name.
5. Speed: no file in this package was over 3 s (slowest incremental-vocab-refresh 2.0 s, incremental-indexing-production-reconciler 1.7 s, index-device-choice 1.7 s). Full package run: 39 files, 3.9 s wall (was about 12 s summed per the list). Remaining real waits are needed: index-device-choice starts real child processes (orphan guard, 500 ms + 300 ms deadline) and a 30 ms lock-poll wait; left as is.
6. Kept source-text tests:
   - indexer-phases-wiring.test.js (3 remaining tests): reads core/indexing/indexer-phases.js as text to check that buildLateInteraction passes projectRoot, finalIndexPath and stagingSegmentDir. Callee side is covered by li-staged-save.test.js; the call-site wiring has no behavior test (see 7). It is the only READS_PRODUCT_SOURCE file in the list that really reads product source; the other flagged files only read files the code writes (state, queue, dead-letter files) and are behavior tests.
7. Needs a product seam:
   - indexer-phases-wiring.test.js: a behavior test needs the phase runner to take an injectable `buildLateInteractionIndex` (or to export the options-bag builder), so a test can capture the options without native inference and SQLite.
8. Leftover processes: none found (pgrep for sweet-search maintainer/daemon/encoder returned nothing).

Not changed, noted: the other 36 files were scanned for source reads, mock-only assertions, swallowed catches, timing bounds and skips. Timing checks are on injected clocks (`now`, virtual time) or generous (index-device-choice "< 1000 ms" guards a 60 s lock wait being skipped).
Note: `.sweet-search/merkle-state.json` in the repo may have been altered by earlier runs of the old incremental-tracker tests.
