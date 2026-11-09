# Report: daemon-client

## (1) Done
- T1: new `core/search/daemon-client.js` with `daemonRequest(socketPath, path, { method='GET', timeoutMs, resolveOnResponse })`. It resolves `{ status, body }` at response end (raw text, chunks joined as before). With `resolveOnResponse` it resolves at response start with `body: ''`. It rejects with the request error (its `code` kept) or with an Error whose `timedOut` is true (idle socket timeout, then `req.destroy()`).
- T1 callers replaced: `core/search/search-server.js` (`getServerHealth`, `stopServer`, `sendStopToSocket`, `isServerRunning`; the two stop copies share a new local `requestStop`), `core/search/setup-status.js` (`probeServer`), `core/search/daemon-registry.js` (`socketHealthy`), `core/indexing/worktree-index.mjs` (`stopDaemonAt`, uses `resolveOnResponse`). The unused `http` imports in the three files are gone.
- T2: new `core/infrastructure/env-flag.js` with `isOffValue(value, { trim = true })` (words 0/false/off/no, any case) and `isOnValue(value)` (words 1/true/on/yes, trimmed, any case). Replaced in `wsl-keepalive.js` (`trim:false`), `grep-lane.js`, `search-server.js` CHANGED_FILES_WATCH (`trim:false`), `agent-span-ledger.js` (`flagEnabled`, `flagEnabledByDefault`, both still local names, `flagEnabled` still exported), `core/agent-tools/launch.js` and `core/cli.js` (`envFalsey` kept as a one-line wrapper).
- T3: new `core/infrastructure/agent-tools-protocol.js` owns `AGENT_TOOLS_PROTOCOL_MARKER`. `tools.js` imports and re-exports it (same export name). `native-resolver.js` imports it and its second literal `AGENT_TOOLS_CAPABILITY_MARKER` is removed. `NODE_ENTRY_COMMANDS` is used only by `tools.js`; `native-resolver.js` does not need it, so it stays there.

### T1 table: every daemon HTTP copy
| file:line (before) | method path | timeout | response handling | error / timeout result | status |
|---|---|---|---|---|---|
| search-server.js ~1930 `getServerHealth` | GET /health | param, default 1000 | non-200 -> null; JSON parse at end; parse fail -> null | error -> null; timeout -> null | replaced |
| search-server.js ~1958 `stopServer` | GET /stop | param, 5000 | drains, true at end | error code ECONNRESET/EPIPE/ENOENT -> true, else false; timeout -> false | replaced |
| search-server.js ~1990 `sendStopToSocket` | GET /stop | param, 5000 | same as above; empty socket -> false | same | replaced |
| search-server.js ~2101 `isServerRunning` | GET /health | 500 | non-200 false; true if status==='ready' or warm===true | error/timeout -> false (silent) | replaced |
| setup-status.js ~63 `probeServer` | GET /health | param, default 1500 | any status: running + JSON or null | ENOENT/ECONNREFUSED -> not-running; other -> unknown; timeout -> busy | replaced |
| daemon-registry.js ~229 `socketHealthy` | GET /health | param, default 500 | true only on 200 | error/timeout/sync throw -> false | replaced |
| worktree-index.mjs ~624 `stopDaemonAt` | GET /stop | 1000 (`timeout` option) | true at response START (body not read) | error/timeout -> false | replaced (`resolveOnResponse`) |
| search-cli.js ~106 `--stop` (NOT mine) | GET /stop | 1500, destroys with Error('timeout') | `{ statusCode, body.trim() }`, rejects on error | reject -> prints "Server not running" | follow-up |
| scripts/cleanup-stale-processes.mjs ~141 (NOT mine) | GET /health | 1500 (`timeout` option) | parses JSON, pid integer or null | error/timeout -> null | follow-up |

Not replaced on purpose: the `/search` and `/read-semantic` queries in search-server.js (~1855, ~1901). They use `guardQueryRequest` with their own timeout and error text, which is a different contract. `isServerListening` uses a raw `net` connect, not HTTP.

### T2 table: falsey / truthy env readers
| file:line | words | trim | case-insensitive | empty/undefined |
|---|---|---|---|---|
| wsl-keepalive.js ~23 `isOff` | 0 false off no | no | yes | not off |
| grep-lane.js ~46 | 0 false off no | yes | yes | not off |
| search-server.js ~1577 | 0 false off no | no | yes | not off (`|| ''`) |
| agent-span-ledger.js ~34 `flagEnabled` | 1 true on yes | yes | yes | not on |
| agent-span-ledger.js ~38 `flagEnabledByDefault` | not (0 false off no) | yes | yes | enabled |
| launch.js ~18 / cli.js ~14 `envFalsey` | 0 false off no | yes | yes | not off |
| agent-output-fixes.js ~90 (NOT mine) | Sets TRUE 1 true on yes, FALSE 0 false off no, via `norm` | yes | yes | neither |
| vector-store/binary-hnsw-index.js ~79 (NOT mine) | 0 false off no | no | yes | not off |
| ranking/file-kind-ranking.js ~2511 `envOff` (NOT mine) | only `0` or `false` | no | NO (exact) | not off |
The last row differs from the others (two words, case-sensitive), so it should not use `isOffValue`. Rust has its own `falsey` at crates/sweet-search-cli/src/agent_tools.rs:457 (not checked for word list).

### T3: other copies
- Rust: `crates/sweet-search-cli/src/agent_tools.rs:31` (`PROTOCOL_MARKER`); `NODE_ENTRY_COMMANDS` at `crates/sweet-search-cli/src/main.rs:1979`.
- Test: `tests/agent-tools/link-native-tools.test.js:87-92` reads agent_tools.rs and main.rs and asserts they contain the JS marker and each NODE_ENTRY_COMMANDS pair. So JS and Rust agreement is tested. `tests/infrastructure/native-resolver.test.js:219,236` use the literal in fakes.

## (2) Not done and why
- search-cli.js `--stop` and scripts/cleanup-stale-processes.mjs copies: outside my file set.
- `/search` and `/read-semantic` request code: different contract (see above).

## (3) Behavior questions
- None. Edge cases kept: `isServerRunning` still returns false silently on request errors (no DEBUG_CATCHES line); `stopDaemonAt` still resolves at response start.
- Note: prewarm hook (see T4) passes `--serve` to `start-server.js`, which ignores it. Not changed.

## (4) Needs follow-up (outside my set)
- search-cli.js ~106 `--stop`: `daemonRequest(socketPath,'/stop',{timeoutMs:1500})` maps to it (status, `body.trim()`; on error, "Server not running"). Timeout error text is Error('timeout') vs mine; the message is not printed there.
- scripts/cleanup-stale-processes.mjs ~141: `daemonRequest(sock,'/health',{timeoutMs:1500})`.
- agent-output-fixes.js ~90 and binary-hnsw-index.js ~79 can use `isOnValue` / `isOffValue(v,{trim:false})`; file-kind-ranking.js ~2511 cannot without a behavior change.

## T4 (report only)
(a) The three switches (falsey words 0/false/off/no turn off the daemon route; default is on). Each is read only at core/cli.js (READ line 37, SEMANTIC line 52, TRACE line 67), with comments at lines 36, 50, 66.
- SWEET_SEARCH_READ_VIA_DAEMON: no setter anywhere (no test, eval, script, README, crate). Documented only in the cli.js comment and docs/untangle/findings/tool-surface.md:45.
- SWEET_SEARCH_SEMANTIC_VIA_DAEMON: set by tests/search/cli-read-semantic-dispatch.test.js (lines 112, 123, 134, 148, 163, 179, 191). Nothing else.
- SWEET_SEARCH_TRACE_VIA_DAEMON: no setter anywhere.
- No hit in README, docs (other than the untangle findings), eval, scripts, mcp, bin or crates. Rust has a separate switch SWEET_SEARCH_AGENT_TOOLS_VIA_DAEMON at agent_tools.rs:457 (and launch.js:32).

(b) Daemon start paths
| path | entry file | env | cwd | applyPersistedLiModel before server module loads |
|---|---|---|---|---|
| `autoSpawnServer` (search-server.js ~2135) | core/cli.js `--serve` | copy of process.env; removes CALL_STARTED_ENV; sets SWEET_SEARCH_PROJECT_ROOT if unset (resolveProjectRoot()) | dirname of search-server.js (core/search) | NO. cli.js `--serve` only sets title and spawn ledger, then imports search-server. SweetSearch's constructor (sweet-search.js:132) applies it later, at searcher init. |
| prewarm hook (session-daemon-prewarm.mjs ~280) | core/start-server.js (SWEET_SEARCH_SERVER_ENTRY overrides), arg `--serve` ignored | process.env unchanged: no root pin, no CALL_STARTED strip | process.cwd() | YES (start-server.js:12-13, root = env root or cwd) |
| Rust `spawn_daemon` (main.rs ~1539) | core/start-server.js | sets SWEET_SEARCH_PROJECT_ROOT, removes CALL_STARTED_ENV, node heap flag | project_root; setsid | YES |
| core/start-server.js itself | n/a | n/a | n/a | applies at lines 12-13, then title and spawn ledger (same as cli.js --serve), then imports search-server and runs `startServer()` |
All four set the process title and spawn ledger the same way. Only `autoSpawnServer` skips the early `applyPersistedLiModel`.

## (5) Verification
- `node --check` on all 14 edited/new files: clean. `npx eslint` on the same files: clean (no output).
- `npx vitest run` on 27 test files that name the edited modules (tests/search/*, tests/indexing/worktree-index.test.js, maintainer-*, tests/integration/native-launcher): `Test Files 27 passed (27), Tests 428 passed | 13 skipped`.
- `npx vitest run tests/agent-tools tests/infrastructure tests/search/daemon-starts-wsl-keepalive.test.js ...`: 39 of 40 files passed. `tests/agent-tools/daemon-route.test.js` failed once (`89999` vs `90000` timing value, unrelated to my files); rerun alone: `Tests 11 passed (11)`.
- Left no processes.
