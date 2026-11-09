# tests-indexing-1 report

1. Counts: 36 test files -> 36; `it` blocks 619 -> 617 (two removed or merged).
2. Removed:
   - core-indexer-flags.test.js, "uses process.argv when no argument is passed" (rule 3: only checks defined/typeof; the other parseArgs tests check real values).
   - bg-priority-addon.test.js, "loads and exports setBackgroundMode" (rule 3: typeof check only). Merged into the second test, which now also asserts the export is a function. Skip gate kept: optional per-platform addon binary (rule 5, real gate, named in describe).
3. Rewritten: none.
4. Fixed flaky: changed-files-tracker.test.js, 13 x fixed 400 ms sleep. Now a 100 ms minimum wait, then poll (50 ms steps, 3 s cap) until the tracker listing equals `git ls-files`. Still catches a wrong listing; no longer fails on a slow machine.
5. Speed:
   - changed-files-tracker: 6.6 s -> 2.4 s (own run; 2.5 s in a second run).
   - atomic-swap-wal: 2.6 s -> 0.5 s. The product waits 500 ms per EBUSY retry (hard-coded, no option or env). The test now makes setTimeout fire at 0 ms inside the two EBUSY tests only (restored by vi.restoreAllMocks). Removed the 10 s test timeout.
   - encoder-client: 3.6 s, unchanged (3.4 s alone). Real child processes, real idle exits and hang timeouts of 50-300 ms; these are the behavior under test.
   - incremental-entity-id-parity (6.5 s in the full run; about 2-3 s alone), file-node-parity/review, admission-policy, chunk-text-fts, grep-corpus, ignored-directory-pruning (3.4 s; 1.5 s is the 2500-file event-loop yield test): real graph builds, ticks, git or file trees. No sleeps; left as is. Time is import plus real work.
6. Kept source-text tests:
   - bench-index-device-pin.test.js: policy over many files (every benchmark script that starts the indexer pins the device).
   - boot-log.test.js, "no raw console.log boot banners": policy over 7 engine modules; no behavior can show it without loading models.
   - READS_PRODUCT_SOURCE flag on atomic-swap-wal, chunker-namespace-and-large-function, file-state-store, incremental-* files is a false positive: they read test fixtures or files the product wrote (db, queue, merkle JSON), not product source.
7. Needs a product seam:
   - atomic-swap-wal: `RETRY_DELAY` in atomicSwapDatabase is hard-coded; an option or env would replace the setTimeout stub.
   - extractor-chunker-optimizations.test.js: tests `methodCallRegexCache` and debug counters (private internals); no observable behavior shows a cache hit. Kept (rule 2 not rewritable).
8. Leftover processes: pgrep shows PID 50812 (not started by these tests; cwd printed empty/unavailable). Not killed; likely another agent's or the user's process.
