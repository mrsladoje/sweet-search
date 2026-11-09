# tests-entry-points-1 report

1. Counts: 33 test files -> 33; 519 `it` blocks -> 518. Result: 590 passed, 1 skipped (the live retrieval canaries), run twice.
2. Removed:
   - tests/eval/agent-bench-repo-isolation.test.js, "exposes ensureDaemonForProjectRoot, getServerHealth, stopServer, waitForServerExit" - rule 3 (only `typeof === 'function'` on an import).
3. Rewritten: none.
4. Fixed environment-dependent:
   - tests/eval/agent-bench-policy.test.js, "live retrieval canaries keeps prior failure chunks out of top-1": the gate only checked that codebase.db exists. It now also calls `assertIndexSchemas` (core/infrastructure/index-schema.js) per repo and skips when the index is absent or has another schema version. The skip reason is in the describe name: "(skipped: fastify index built by another schema version (schema version 2))". Nothing under eval/ touched. On this machine the test now skips.
5. Speed (alone, close together, machine loaded by other agents):
   - ss-search-warm-wait.test.js 9.2 -> 4.5 s: the fake daemon load time and the "budget already used" offset were cut (2500->1000, 3500->1500 ms, 89.0->89.7 s). Each still crosses the 1 s /health probe timeout and poll, so the wait logic is still exercised. Remaining 4 s is real polling (500 ms interval, product constant; no env override).
   - ss-grep-plan-arms.test.js 10.7 -> 3.8 s: `setEntities` inserted 2100 rows with autocommit (one disk sync each); now one transaction. Rest is module import time.
   - Left as is: harness-init-flow 13.6 s, lifecycle 7.7 s, cli-index-subcommand 7.3 s, claude-lean-harness 3.7 s, ss-grep-alloc 3.6 s. The time is 20-40 real `node core/cli.js init/uninstall` child processes per file (about 0.3-1.2 s each); they test the real CLI end to end and keep spawning. Making them in-process needs a product seam (below). ss-grep-alloc is real engine work, nothing idle found.
6. Kept source-text tests:
   - link-native-tools.test.js "matches the native binary table and the bin stubs": JS-vs-Rust parity (agent_tools.rs, main.rs) plus bin/ stubs and package.json bin list (packaging list).
   - codex-hook.test.js "docs/PREHEATING.md Codex section" (2 tests): read the docs text, not product code; they pin user-facing instructions (deprecated flag not presented as the value to set). Weak wording checks; kept because unsure. Candidates for removal if the owner wants.
   - harness-init-flow.test.js / harness-prompts.test.js compare installed files with the shipped plugin and prompt sources: shipped-bytes contract.
   - agent-instructions, claude-lean-harness, codex-harness, lifecycle, mcp-flag: check what the installer writes for users (policy body, rules, settings, hooks): kept.
   - ss-grep-case-word / ss-grep-in-scope use `ctx.skip()` when the optional ripgrep binary or the gram index is absent: real optional-dependency gates, kept.
7. Needs a product seam:
   - init-flow, lifecycle, cli-index-subcommand tests: an in-process `runInit(args, env)` entry (or a way to skip the Node startup per call) would cut about 20 s. Currently each call must spawn `core/cli.js`.
   - ss-search-warm-wait: the poll interval (`intervalMs`, 500 ms) in `ensureWarmServerReady` has no env override; one would let the tests drop below 4 s.
8. Leftover processes: none (pgrep for sweet-search-maintainer/daemon/encoder empty after the runs).
Not run: the other known failure (tests/integration/verify-runtime.test.js) is not in this list.
