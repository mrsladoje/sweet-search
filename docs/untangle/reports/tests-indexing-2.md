# tests-indexing-2 report

1. Counts: 38 test files, 545 `it` blocks before -> 38 files, 545 `it` blocks after. All 38 files pass.
2. Removed: none.
3. Rewritten: none. All 14 READS_PRODUCT_SOURCE flags were checked: every `readFileSync` reads a file the test or the product produced (queue jsonl, manifest.json, state files, fixture sources). No file reads product source as text. Nothing to rewrite.
4. Fixed flaky / environment-dependent: tests/indexing/incremental-indexing-maintainer-watcher.test.js (3 live-watcher tests). Cause: fixed sleeps (700 ms, 900 ms, 2600 ms) that either waste time or fail on a loaded machine. Fix: a `waitUntil` poll that returns as soon as the condition holds (8 s bound; 6 s for the git poll). Assertions unchanged.
   Left as is: the `if (!available) { expect(true).toBe(true); return; }` guards for the native @parcel/watcher binding. They are an optional-dependency gate (rule 5 "real gate"), not a hidden skip on this machine.
5. Speed (alone, runs close together):
   - incremental-indexing-determinism-harness.test.js: 9.7 s -> 6.6 s (15.9 s in the loaded full run). Three control tests each replayed the edit script for their own pairs of baseline runs (11 replays). They now draw from one memoized pool of independent baseline runs (7 replays). The checks are the same: byteDiff, canonicalJson equality, 4-run HNSW stability. The real SIGKILL child test stays real.
   - incremental-indexing-maintainer-watcher.test.js: 5.6 s -> 1.6 s (two runs, both 1.6 s). Sleeps replaced by polling. Live native watcher stays real.
   - incremental-graph-edge-parity.test.js: measured 6.6 s under load; alone 3.35 s total, 2.4 s of tests (7 tests, all under 700 ms). Left: it runs the real reconciler per test.
   - incremental-grep-only-files.test.js: 3.1 s -> 2.5 s alone (1.3 s of tests, the rest is import). Left.
   - incremental-indexing-g2-levers.test.js: 3.1 s -> 3.2 s alone (2.2 s of tests, one test 1.6 s runs two real batched ticks twice). Left.
   - incremental-hnsw-compaction.test.js (2 poll loops, 50 ms step, exit on completion): 2.55 s alone, tests 1.4 s. Left; the real child process build is the point.
   Whole package, 38 files, one run: 12.3 s wall.
6. Kept source-text tests: none exist in this package.
7. Needs a product seam: core/indexing/maintainer-watcher.mjs has the git poll interval as a constant (`GIT_POLL_INTERVAL_MS = 2000`, no env). The .git/HEAD test polls in real time against it. An injectable interval would let it use fake timers.
8. Leftover processes: none (pgrep for sweet-search-(maintainer|daemon|encoder) returned nothing).

Not done: I did not read every one of the 545 tests for rule 1 (repeats-the-implementation) or rule 3 (cannot fail) beyond the pattern scan (skips, source reads, timing assertions, empty assertions). No hits from the scan. Files other than the five slow ones were kept unchanged under the "when unsure, keep" rule.
