# w4-tools-search report

## Done
1. Daemon client moved: new core/search/search-client.js (guardQueryRequest, daemonError, queryServer, queryReadSemanticServer, getServerHealth, requestStop, stopServer, sendStopToSocket, waitForServerExit, ensureDaemonForProjectRoot, isServerListening, isServerRunning, autoSpawnServer, QUERY_CLIENT_TIMEOUT_MS, inProcessSearch, httpModule). search-server.js imports what startServer needs and re-exports all 9 client names. run-agent-tool.mjs: four import targets now search-client.js. tests/agent-tools/ss-search-warm-wait.test.js mock now targets search-client.js (autoSpawnServer lives there).
2. tests/agent-tools/mirror-markers.test.js (3 tests, passes): checks every in-repo `// Mirrors: file:name` (names after `+` too) and `//! - file` block entries; skips third-party markers (minimatch, node lib, V8...).
3. isTestLikePath imported from ../infrastructure/test-paths.js in agent-pack-completion.js, context-expander.js, grep-output-shaping.js, packaging/graph-neighbors.js, packaging/related-rows.js, and run-agent-tool.mjs. Re-export in agent-output-fixes.js kept.
4. New core/search/stage-timing.js exports __ptStart/__ptEnd (global __stageTimings unchanged); copies removed from sweet-search.js, search-hybrid.js, search-postprocess.js.

## Not done
- verify-move prints `problems: 1`, not 0: `startServer` text changed by one line. Cause: startServer assigned the module variable `inProcessSearch`, which now lives in the client (queryServer reads it); an imported binding cannot be assigned, so `inProcessSearch = {` became `setInProcessSearch({` and `};` became `});`. Every other declaration is identical; "export names no longer at the old path: none". Any other cut would change queryServer instead.
- run-agent-tool.mjs line 116 comment still says core/search/search-server.js (brief: change import targets only).
- Brief item 2 said nothing about CLAUDE.md list; not touched.

## Behavior questions
None. Cold in-process ss-* calls now load search-client.js, not the server; the daemon sets the handler through setInProcessSearch (same object, same time).

## Needs follow-up
- core/graph/graph-expansion.js:58-70 has a copy of __ptStart/__ptEnd: import from ../search/stage-timing.js (or move the module to core/infrastructure; core/ranking cannot import core/search without a rule check).
- core/ranking/file-kind-ranking.js:165-168, 495-504 has an inline copy of the profiling logic.
- Streaming ripgrep (`executeRipgrepStreaming`, `runRipgrepJsonStreaming` in core/search/search-pattern-ripgrep.js): kept. Callers over the whole repo: none in product, eval/ or scripts/. Only tests: tests/search/search-pattern-ripgrep-resilience.test.js (imports and calls it) and `vi.mock` stubs in tests/agent-tools/ss-grep-alloc, ss-grep-globs, ss-grep-plan-arms and tests/search/search-pattern-native-grep.

## Verification
- `node --check` on all core/search/*.js, packaging/*.js, run-agent-tool.mjs: clean.
- `npx eslint core/ mcp/`: clean. `npm run -s build`: Build OK.
- `node scripts/check-boundaries.js | tail -2`: 12 domains ... "65 internal, 601 external barrel bypass warning(s) — not blocking."
- verify-move: `problems: 1` (startServer, see above); export names no longer at old path: none.
- Import cycles: only the existing core/prompt-optimization/sweep gepa pair; none in core/search.
- `npx vitest run tests/search tests/agent-tools tests/mcp tests/integration/barrel-contracts.test.js tests/integration/mcp-server.test.js tests/integration/native-launcher.integration.test.js`: 128 files passed, 1 skipped; 2328 tests passed, 18 skipped.
