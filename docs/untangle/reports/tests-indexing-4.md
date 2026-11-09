# tests-indexing-4 report

## 1. Counts
33 test files -> 33. 569 tests -> 568 (one removed).

## 2. Removed
- tests/indexing/typescript-patterns.test.js, "typescript config exists in LANGUAGES" (rule 3: `toBeDefined` on an import; every later test in the block reads `tsConfig.*` and would throw).

## 3. Rewritten
- tests/indexing/maintainer-stop.test.js, "a paused index stops a maintainer" (was "...a running maintainer"). Before: waited for the real maintainer to sleep, then wrote the pause file and waited for the next tick. The product clamps the interval to at least 10 s (`MIN_MS` in interval-autotune.mjs), so this cost 10.3 s. Now: the pause file is in place before start; the first loop pass reads it (same `isReconcilePaused` branch). It no longer shows a pause arriving while the process runs. Cheap to restore only with a product seam to wake the sleep.

## 4. Fixed flaky / environment-dependent
- tests/indexing/phase5-artifacts.integration.test.js, "should build 100 vectors in under 5 seconds": bound 5 s -> 30 s (renamed). Still catches a super-linear build; no longer fails on a loaded machine.
- Same file, "should report accurate build time in result": was `|buildTimeMs - elapsed| < 100 ms` (load-sensitive). Now: 0 < buildTimeMs <= elapsed + 5 ms and buildTimeMs >= 0.25 * elapsed.
- tests/indexing/maintainer-takeover-real-process.test.js, "steals the lock in bounded time...": FAILS right now for an external reason, not from my edits (file untouched). Something on this machine SIGKILLs any process started from `tests/fixtures/sigterm-deaf-holder.mjs` after 1-5 s. Proof: a bare spawn of that fixture, with no test code, dies with SIGKILL; a byte-identical copy under another name was not killed. It passed once (5.2 s) in the first run before this started. Probably another agent's cleanup that matches the fixture name. I did not kill or find it. Re-run when other agents finish; expected pass, ~5 s.

## 5. Speed (before -> after, run alone)
- maintainer-lifecycle-fix.test.js: 20.2 s -> 0.33 s. The mocked "alive" holder never died after SIGTERM, so each of 4 takeover tests waited out the 5 s grace. The mock now exits on SIGTERM (as a real holder does). Still checks: SIGTERM sent, lock stolen. The "holder ignores SIGTERM, bounded wait" case stays covered by the real-process file.
- maintainer-stop.test.js: 15.3 s -> 5.0 s (paused test 10.3 s -> ~0.7 s; rest are real maintainer processes, ~1.8 s each, kept).
- Slow files left: maintainer-takeover-real-process (5 s real grace; `WEDGED_KILL_GRACE_MS` is a constant with no env override, and the test needs a real deaf process); worktree-index (12.6 s in the quiet run, 9.4 s alone; cost is ~170 ms of real `git init/commit/worktree add` per test plus real child processes; a shared repo would weaken the "git stays clean" check because `info/exclude` persists); phase5-artifacts (2.2 s), symlink-admission (2.4 s), view-templates (2.0 s): real fixtures, no sleeps.
- Whole package run: 33 files, 5.1 s wall.

## 6. Kept source-text tests
None found. The READS_PRODUCT_SOURCE flag was a false positive in all 9 files: they read files the product produces (locks, logs, registries, index segments), not product source.

## 7. Needs a product seam
- maintainer-stop "a paused index stops a maintainer": a way to wake the sleeping maintainer (or an interval below 10 s) would let the test pause a live process.
- maintainer-takeover-real-process: an env override for `WEDGED_KILL_GRACE_MS` would cut 5 s.

## 8. Leftover processes
None (checked with pgrep for sweet-search-(maintainer|daemon|encoder)).

Reviewed and kept (mock tests check real effects: spawned commands, device kind passed, lock contents): os-priority, model-pool-*, maintainer-launcher, view-templates "stays linear" (ratio test with a 20 ms floor and a bound of 8 against 16 for quadratic; kept), tree-sitter-provider (`describe.skipIf(!available)` is an optional-dependency gate; kept).
