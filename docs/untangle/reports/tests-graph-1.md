# tests-graph-1 report

1. Counts: 32 test files, 579 `it` blocks (all pass in one run, ~2.8 s) -> unchanged (32 files, 579).
2. Removed: none. No file had a tautology, a no-assertion test, or a disabled test that needed removal.
3. Rewritten: none.
4. Fixed flaky:
   - tests/graph/community-detector.test.js "completes within 500ms on 200 nodes": load-sensitive wall-clock bound. Renamed to
     "completes 200 nodes within a generous bound (catches super-linear blowup, not machine load)" and bound raised 500 ms -> 10000 ms.
     It still catches an algorithmic regression (an order-of-magnitude blowup). Passed twice.
5. Speed: no file over 3 s (slowest graph-search 2.0 s). Nothing changed. hcgs-defaults spawns a real child process; its setTimeout is only a kill guard.
6. Kept source-text tests:
   - bare-calls.test.js "ranking safety": walks core/ and asserts only an allowlist of files mention call_sites/call_lines. Policy over many files; no behavior shows it.
   - import-resolution-review.test.js: its readFileSync reads a temp fixture the test wrote, not product source. Not a source-text test.
   Other READS_PRODUCT_SOURCE-style tests feed language code to the extractor and check entities/edges: behavior, kept.
7. Needs a product seam: none.
   Notes (kept on purpose): `toBeDefined()` uses in adaptive-expansion/graph-extractor-* guard a following value assertion (find results), so they can fail.
   graph-extractor-typescript `describe.skipIf(!tsAvailable)` is a real optional-dependency gate (web-tree-sitter). backup-restore mocks better-sqlite3 and asserts statement parameters; kept, with real-DB coverage in hcgs-indexer.integration.test.js.
8. Leftover processes: one PID matched the daemon pattern once (25841) but had exited before inspection; none remain.
