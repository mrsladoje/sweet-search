# tests-entry-points-2 report

Result: all 32 files pass twice (`npx vitest run` on the whole list: 387 passed, 7 skipped, 26 s wall). No product edits.

## 1. Counts
- Test files: 32 -> 32. Test blocks (vitest count after): 394 (387 pass, 7 skip). Blocks removed: 10 (see 2). Blocks added: 1 (clean mini tree in boundary-enforcement).
- The 7 skips are real gates: no CUDA/CoreML/native hardware, `SWEET_SEARCH_RELEASE_MODEL_SMOKE`, `SWEET_SEARCH_EXTRA_TESTS`.

## 2. Removed
- tests/release/lateon-code-edge-e2e.test.js: six empty "skipped: ..." placeholder blocks (ORT model absent, native unavailable, edge FP32 absent, indexer prerequisites, CoreML not eligible, edge cascade absent). Rule 3 and 5: they had no assertion and passed when their condition was false. The real tests keep their own `runIf` gates.
- tests/init/uninstall-daemon-stop.test.js: "safe when projectRoot is omitted" (rule 1/3: asserted `typeof === 'boolean'` and a stale-pid cleanup that "removes a stale pid file whose PID is dead" already checks).
- tests/integration/init-integration.test.js: "config bridge works from subdirectory" (rule 1/3: ran at the project root, no subdirectory; same assertion as "init --skip-models creates config.json").
- tests/integration/brand-presence.test.js: "MCP server name is sweet-search" (rule 2: grepped `mcp/server-main.js`; covered on the wire by tests/integration/mcp-server.test.js `serverInfo.name`).
- tests/integration/cli-flags.integration.test.js: `it.skip` "should only re-embed specified files (requires full setup)" (rule 5: permanently skipped, no platform gate, would run the real indexer on the repo root).
- lateon-code-edge-e2e "manual gate command ..." lost its regexp on `scripts/parity-cuda.js` source text (rule 2); the existence check stays.

## 3. Rewritten
- brand-presence "data directory default is .sweet-search": was a string match in `core/config.js`; now runs `core/config.js` in a child with `SWEET_SEARCH_DATA_DIR` unset and checks `DB_PATHS.codebase` sits in `.sweet-search`.
- flag-semantics "--quiet mode should allow JSON parsing": had a try/catch whose both branches could pass (`toBeDefined`, or length < 1000). Now: stdout is exactly one JSON line with `success:true, filesProcessed:0`.
- flag-semantics "should handle unknown flags gracefully in real process": was `typeof exitCode === 'number'` (cannot fail). Now: exit 0 and the dry run still reports "Found 1 files to index".
- boundary-enforcement: the three negative tests wrote violation files into the live `core/` tree (other agents' and the lead's runs could see them). They now run `scripts/check-boundaries.js` with cwd = a throw-away mini tree (the checker scans `core/` under cwd). The two identical real-tree runs became one. Same three violations are checked, plus a clean mini tree.

## 4. Fixed flaky / environment-dependent
- tests/integration/verify-runtime.test.js "probeSqliteBinding passes with the full model set cached" (the known failure I own). Cause: the test passed `gte-reranker-modernbert-base` in `modelKeys`; that model is opt-in (`optIn: SWEET_SEARCH_ENABLE_LOCAL_RERANKER`), so a normal init never fetches it. On this machine `~/.cache/sweet-search/models/Alibaba-NLP--gte-reranker-modernbert-base` is an empty directory, so `verifyRuntime` reports its 5 files missing. `probeSqliteBinding` and the asset checks are fine. This is not a product inconsistency (no model file is named by the registry and unused). Fix: the test builds a fixture model cache (sparse files of the registry sizes in a temp dir, `SWEET_SEARCH_MODEL_CACHE` set, `vi.resetModules`, then dynamic import) and checks pass; it also truncates one file by 1 byte and checks `passed === false`, so the pass is not vacuous. It no longer skips on CI and no longer depends on the local cache. Env restored in `finally`.
- init-integration "a plain init with cached models ...": had a silent `return` when models were absent (vacuous pass). Now `it.skipIf(...)` with the condition in the test name.
- init.test.js "returns 7 model results for full profile": same silent `return`; now `it.skipIf(!fullProfileCached)` with the condition in the name.
- native-launcher: ran with no `SWEET_SEARCH_RUNTIME_DIR`, and `beforeAll`/`afterAll` sent `/stop` to the default socket `/tmp/sweet-search.sock` (could stop a developer's real daemon). Now: private runtime dir `/tmp/ss-native-launcher-rt` for the whole file; stop only the test's own sockets.

## 5. Speed (before -> after, measured alone; other agents load the machine)
- boundary-enforcement: 6.0 s -> 0.9 s (five checker runs on the real tree -> one, the rest on a tiny tree).
- streaming-vectors: 14.2 s (quiet run) -> 8.8 s. Fixture cut from 120 + 40 files to 60 + 40; thresholds scaled (vectors and exemplars > 50; one chunk per file; dedup alias floor of 40 unchanged). It still streams in several windows (parse window 16, hydrate 32).
- native-launcher: 29.1 s (loaded run) -> 11.7 s. Two measurements today of the unchanged logic were about 15 s alone; the gain beyond that is the removed stop/sleep calls on the default socket. It keeps a real index run, a real Node server, and the real native binary (warm and cold start). Not reducible without losing the check.
- lateon-code-edge-e2e: 31.3 s (loaded run) -> 7.3 s. The time is one `beforeAll` that runs the real indexer subprocess with the real edge model on 5 files, and the real model encode tests. Left as is: it is the release smoke.
- uninstall-all 7.8 s -> 3.9 s, uninstall-daemon-stop 5.0 s -> 2.2 s, init-integration 3.9 s -> 1.5 s: no edit for speed; the first numbers were taken under load. The time is one real CLI spawn (about 0.15-0.5 s) per test, which is what they check.

## 6. Kept source-text / shipped-bytes tests
- tests/integration/packaging.test.js: packaging list contract (`npm pack --dry-run --json`, manifest, relative imports of shipped scripts).
- tests/init/opencode-harness.test.js, prewarm-hook, tool-enforcement, init-integration (CANONICAL_POLICY_BODY, pointer rules, lean agent): bytes the installer writes into users' projects (rule files, settings, plugin copies).
- tests/integration/barrel-contracts.test.js: exempt by the brief.
- tests/integration/brand-presence.test.js package.json / NOTICE checks: shipped metadata.
- tests/init/uninstall-native-packages.test.js: purge list must equal `package.json::optionalDependencies` (release-blocker guard).
- tests/release/inference-reference.test.js: fixture hashes must match the model registry (model update without regenerated fixtures).

## 7. Needs a product seam
- tests/integration/native-launcher.integration.test.js: the cold-start daemon (or a child of it) re-creates its empty registry directory under `SWEET_SEARCH_RUNTIME_DIR` about 4 s after `--stop` returns, after the test removed it. Cleanup is by a fixed directory name cleared at the next run. A seam to wait for full daemon exit (a "stopped" marker or a blocking `--stop`) would let the test finish clean.
- tests/integration/telemetry.test.js (kept): sets and reads the exported `telemetryStats` object directly; a reset/read accessor would make it behavior-only.

## 8. Leftover processes
- My runs and the verify step left no daemon, maintainer or encoder with cwd in a temp project. At the end, four `sweet-search-query-encoder` processes exist (PIDs 70422, 70650, 89020, 99941; cwd `/Users/admin/.cache/sweet-search`; ages 8-14 min). The shared query-model server is by design persistent; I cannot tell which of my earlier native-launcher runs (before the runtime-dir fix) or other agents started them. Not killed.
- A stray `sweet-search-daemon` PID 77514 (cwd `.../T/ss-daemon-life-gq7Kcl`) was seen during my runs; it belongs to another agent's daemon-lifecycle test.
