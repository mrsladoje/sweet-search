# tests-search-1 report

All 30 files pass twice (`npx vitest run` on the whole package: 463 passed, 16 skipped, 21.6 s wall). `node --check` is clean on every file.
The files I did not edit were skimmed (grep for source-text reads, timers, `toBeDefined`, skips, mocks) and read where small; none showed a rule 1 to 5 problem.

## 1. Counts
Test files: 30 -> 30. `it` blocks: 473 -> 470 (three blocks removed or merged; two `it.each` cases dropped, which are rows, not blocks).

## 2. Removed
- tests/search/daemon-lifecycle.integration.test.js, "search-server.js never kills/signals the maintainer in a teardown/cap path": rule 2 (sliced `search-server.js` text between two private helper names and asserted no "maintainer" word). Behavior is covered by the freshness tests in the same file ("maintainer outlives an idle-evicted daemon", "maintainer survives a /stop and a cold daemon restart").
- tests/search/agent-output-fixes-wiring.test.js, "A3 never writes to the original ledger and no old switch name is left": rule 2 (regexes on `run-agent-tool.mjs` text: old switch names, a `sessionId` field). Behavior is covered by the A3 ledger protocol tests earlier in the same file (real payload builder + real daemon handler).
- tests/search/cwd-paths.test.js: three source-text regex tests on `run-agent-tool.mjs` replaced by two behavior tests (see 3).
- tests/search/agent-seed-pool.test.js: two assertions that copied constants (`AGENT_SEED_POOL_MIN` = 15, `DEFAULT_SEED_POOL_MIN` = 0), rule 1. The same numbers are checked through `seedPoolSize(5, {agentFormat:true})` = 15 and `seedPoolSize(5)` = 5 in the same test.
- tests/search/cli-read-semantic-dispatch.test.js: `it.each` rows '1' and 'yes' dropped (rule 1 / duplicate rows: same non-falsey branch as 'true' and 'anything-else'; the falsey table and the unset case stay). Saves 1.6 s.

## 3. Rewritten
- tests/search/cwd-paths.test.js, "ss-find -> ss-grep fallback": before, regexes on the text of `cmdFind` / `cmdGrep`. Now runs the real wrapper (`runAgentTool` inside `runInVirtualProcess`, temp repo, stub searcher that records `bareGrep` options). Checks: from `src/`, `ss-find` with no `--in` passes no `fileFilter` and no `_cwdScope`, while `ss-grep` from the same cwd does; `ss-find` and `ss-grep` with a missing `--in` both exit 3 with "scope not found".
- tests/search/agent-output-fixes-wiring.test.js, "the ss-trace usage text has no bracketed or piped mode-word form": before, sliced `TRACE_USAGE` out of the source. Now runs `runAgentTool('trace', [])` and checks the stderr usage text and exit code 2.

## 4. Fixed flaky / environment-dependent
- tests/search/daemon-lifecycle.integration.test.js, "maintainer outlives an idle-evicted daemon and the lock stays intact": failed about 1 run in 3 in isolation (the maintainer pid was dead when checked; its lock remained). The same fixture copied to a scratchpad path survived 16 of 16 runs; a copy inside the repo tree under another name failed again. So something outside the test kills a process whose script lives in the repo tree. The cause is not in the product: I found no code that signals a maintainer by path or name. Fix: the test copies `fake-maintainer-longlived.mjs` into its temp dir and uses that copy as `SWEET_SEARCH_MAINTAINER_ENTRY`. Passed in all later runs (4 of 4). If the killer is a real product or user-tooling reaper, this hides it; I could not identify it.
- tests/search/daemon-lifecycle.integration.test.js and daemon-lifecycle-cap.integration.test.js: daemons now get `SWEET_SEARCH_RUNTIME_DIR` set to a private temp dir (it was unset before).
- tests/search/agent-pack-completion.test.js: the "< 1000 ms" bound on a pathological line measures 12 ms; kept (still catches the 2.7 s regression the test was written for).

## 5. Speed (before -> after, run alone)
- daemon-lifecycle.integration.test.js: 46.0 s (measured in the quiet run; 43 s in my first run) -> 21.8 s. Cause: 12 real daemons, each waiting on idle TTLs and traffic loops, run one after another. Change: one context object per test (own temp dir, socket, pid file, daemon, maintainer); the stop tests and the freshness tests (idle TTL off or 4 s) now run with `describe.concurrent`; the 1.5 s-TTL tests stay sequential so a starved daemon cannot expire mid-traffic; shorter traffic loops (3 s -> 2.4 s, 400 ms -> 300 ms spacing); the "does not resurrect" probe window 8 s -> 6.5 s (the spawn claim lasts 5 s, `SPAWN_CLAIM_TTL_MS`). Real daemons, real maintainer fixture and real SIGKILL stay.
- auto-spawn-env.test.js: 5.2 s -> 0.6 s. Cause: `autoSpawnServer` polls 50 x 100 ms with `setTimeout`. Fake `setTimeout` only, advanced in a loop; the real failed socket connects still run between steps.
- cli-read-semantic-dispatch.test.js: 14.6 s (loaded run) -> 5.9 s alone, ~4.3 s after dropping two rows. Each case spawns `node core/cli.js` (0.2 s in-process, 0.8 s native path); that is the thing under test, so it stays.
- daemon-lifecycle-cap.integration.test.js: 2.1 s -> ~1.6 s (warm-up traffic 1 s -> 0.4 s). Two real daemons stay.
- No other file in my list is over 3 s.

## 6. Kept source-text tests
- tests/search/daemon-lifecycle.integration.test.js, "daemon-registry.js imports nothing from the indexing context": layering policy over import lines (the registry must never reach the maintainer). `scripts/check-boundaries.js` does not forbid search -> indexing, so nothing else covers it. Kept because I am not sure behavior shows it.
- daemon-lifecycle-cap.integration.test.js, daemon-registry.test.js, daemon-starts-wsl-keepalive.test.js: flagged READS_PRODUCT_SOURCE but only read files the test itself produces (registry JSON, daemon-starts file). No source-text test.
- Gated tests kept: cross-target-validation.test.js (5 skips) needs `CROSS_TARGET_VALIDATION=1` and Docker, an explicit opt-in; bundle-a-product.test.js (1 describe) needs the `SS_BUNDLE_A_FIXTURE` indexed fixture.
- ss-grep byte-contract tests (agent-output-fixes, agent-pack-completion, cwd-paths scope tests, etc.) untouched.

## 7. Needs a product seam
- tests/search/auto-spawn-env.test.js: fake timers work, but the 5 s readiness wait (`maxWait`/`checkInterval` in `autoSpawnServer`) is hard-coded; an env or option for it would remove the fake-clock loop.
- tests/search/daemon-lifecycle.integration.test.js: `SPAWN_CLAIM_TTL_MS` (5 s) is not overridable; a short claim would cut "does not resurrect a maintainer" from 8 s to about 2 s.

## 8. Leftover processes
None found (pgrep for sweet-search-(maintainer|daemon|encoder), fake-maintainer and `core/cli.js --serve` empty after the final runs).
Temp files I created outside the repo: `/tmp/s1files.txt`; scratchpad copies `search-1-*` (fake maintainer variants, original daemon-lifecycle backup).
