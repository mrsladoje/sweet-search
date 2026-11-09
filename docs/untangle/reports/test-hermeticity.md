# test-hermeticity report

## (2) Process table (each file/dir run alone; PIDs new after the run)
| Test | New PIDs | cwd |
|---|---|---|
| tests/integration/mcp-server.test.js (before fix) | maintainer 12667, encoder 12881 (parent 1 / 12667) | repo root |
| tests/init/harness-prompts.test.js + harness-init-flow.test.js (before fix; also whole tests/init, 4 of 4 runs) | sweet-search-daemon (several PIDs, e.g. 71675, 84608, 90307, 8349) | system temp folder |
| every other file/dir run (search, agent-tools, integration, indexing, unit, eval, release, graph, mcp, infrastructure, query, ranking, embedding, dedup, vocabulary, training, vector-store, all daemon/CLI-spawning files listed in the brief) | none from the test | - |
Daemons with cwd ss-daemon-life-* seen during runs came from another agent's parallel daemon-lifecycle run (parent was a different vitest), not from my runs.

## (1) Done
- tests/integration/mcp-server.test.js: all MCP servers now start with cwd and SWEET_SEARCH_PROJECT_ROOT = a temp fixture dir, SWEET_SEARCH_RUNTIME_DIR = private dir inside it; afterAll removes it. Assertions unchanged. Cause: the server for the repo root started a real maintainer + encoder.
- tests/init/harness-prompts.test.js: the "session key" test loaded the opencode plugin with worktree = tmpdir(); loading runs the real `sweet-search-hook` from PATH, which starts a daemon for the temp folder. Now SWEET_SEARCH_PREWARM=0 during plugin load (restored after) and worktree = the test's temp dir. Assertions unchanged.

## (3) Not done / behavior questions / follow-up
None for product code. Note reap-test-fixtures.js only kills fixture scripts in tests/fixtures by design, so these escaped it.

## (5) Verification
- `npx vitest run tests/integration/mcp-server.test.js`: 27 passed; no new PIDs after (before: maintainer+encoder).
- `npx vitest run tests/init/harness-init-flow.test.js tests/init/harness-prompts.test.js` twice: 46 passed; no new PIDs (before: new tmp daemon each run).
- `npx vitest run tests/init`: 412 passed, no new PIDs.
- node --check on both edited files: clean.

## Leftover PIDs
- Maintainer 12667 (cwd repo root) and its encoder were left by my pre-fix mcp-server run; they exited by themselves a few minutes later.
- tmp-cwd daemons from my pre-fix runs of tests/init (71675, 84608, 90307, 2028, 4195, 8349) were gone or short-lived (idle TTL) except possibly the last; current snapshot below. Pid 57074 (cwd tmp, started 23:21 before my work) is not from my runs; it also exited on its own.
8349     1 01:11 sweet-search-daemon /private/var/folders/d0/ks3xjw392cx8t_sls8x5hhb00000gn/T
