# comments-tools-mcp

Comment lines before -> after:
- core/agent-tools/argparse.mjs: 101 -> 95
- core/agent-tools/chain.js: 67 -> 67
- core/agent-tools/cli.js: 18 -> 15
- core/agent-tools/daemon-route.js: 36 -> 35
- core/agent-tools/launch.js: 15 -> 15
- core/agent-tools/run-agent-tool.mjs: 510 -> 482
- core/agent-tools/tools.js: 27 -> 27
- core/agent-tools/virtual-process.js: 48 -> 48
- core/cli.js: 36 -> 28
- core/config.js: 24 -> 23
- core/start-server.js: 11 -> 11
- mcp/config-gen.js: 9 -> 0
- mcp/read-tool.js: 8 -> 8
- mcp/server-main.js: 66 -> 37
- mcp/server.js: 18 -> 18
- mcp/tool-handlers.js: 43 -> 33
- mcp/trace-tool.js: 4 -> 4

Method: exact-string replacements via a small script that asserts each match is unique (not the Edit tool); verifier confirms comment-only.

Removed (examples):
- Section banners in mcp/server-main.js, mcp/tool-handlers.js, mcp/config-gen.js, argparse.mjs, run-agent-tool.mjs ("// --- subcommands ---").
- "// Pure arg-parsing helpers ... live in ./argparse.mjs" (restated module layout).
- "// Per-result blocks", "// Scoped: flat output ...", "// An empty file ... prints no empty fence." (restate the next lines).
- "// Fix #3: Propagate" -> "Propagate"; "(SOLID refactor)" and "DDD Migration Phase 4 complete" (history).
- Bare "@param {string} subcommand / args" and "@param {object} payload" JSDoc lines.

Kept (examples):
- The "TWO ROOTS" worktree block in run-agent-tool.mjs (decision + measured 45 zeros).
- L4a read-window block (measured -39% tokens, parked default-off).
- "// SS_FIX_GREP_RETRY", "// Entry plan for the fixed" and all function/const anchors read by args.mjs and the three source-reading tests (untouched).
- Mirrors-style grep contract notes (Rust lane) and the SMOKE-LOSS-FORENSICS sibling-line cost note.
- mcp/server.js and chain.js header blocks (harness behavior, ordering/registry reasoning).

False comment corrected: shortQueryHash said "8-char SHA1 prefix" while the code slices 16; now "16-char".

Verifier last line: files checked: 17; comment-only: 17; problems: 0; lines removed: 112
Also: node --check ok, eslint ok, 22 test files / 436 tests passed.
