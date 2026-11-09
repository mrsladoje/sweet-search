# tests-search-4 report

1. Counts: 25 test files -> 25. `it` blocks 514 -> 513 (one removed, one rewritten in place). Run: 25 files, 513 tests pass.
2. Removed:
   - tests/search/session-daemon-prewarm.test.js, "delegates to the shared launcher rather than duplicating maintainer logic", rule 2 (read hook source, asserted import line and absent function name). Behavior is covered by "spawns the maintainer by default when the state dir exists", "still spawns the maintainer when the lock is stale" and "starts the server and the maintainer independently on a fresh session" in the same file.
3. Rewritten:
   - tests/search/semantic-also.test.js, "cmdSemantic prints the line after the spans and never feeds it to the ledger calls": read core/agent-tools/run-agent-tool.mjs as text and sliced function bodies. Now "ss-semantic prints the also line after the spans and no shown-full trailer": runs the semantic tool through buildAgentToolDaemonResponse on a fixture and checks stdout order and no `shown-full:`. The ledger-call argument check is dropped; the ledger content is already checked by "the span ledger collects only printed spans" in the same file.
4. Fixed flaky: none found. No timing ratios, no skips, no it.skip/todo in these files.
5. Speed (alone): session-daemon-prewarm 7.8 s -> 5.4 s (quiet-run number was load-inflated; no code change besides removing one test). shared-query-encoder 3.3 s -> 2.8 s, semantic-entity-lookup 3.5 s -> 1.6 s: no change, original figures were load. Left: session-daemon-prewarm and shared-query-encoder start real child processes (hook, fake daemon, shared encoder server) and must; two "does NOT spawn" tests wait 600 ms for an absent marker, shortening would risk false passes. worktree-roots (2.5 s) and session-daemon-prewarm-pagecache (2.3 s) are real git/fs work; left.
6. Kept source-text tests: none remain in these files. Other `readFileSync` uses read files the product produced (payload JSON, daemon log, marker files).
7. Needs a product seam: none.
8. Leftover processes: PID 53107 sweet-search-daemon, cwd /private/var/folders/d0/ks3xjw392cx8t_sls8x5hhb00000gn/T/ss-daemon-life-dHetHf. Not from my files (my tests use no daemon with that name); likely another agent's test. Not killed.

ss-grep output-byte tests: none in this package needed changes.
