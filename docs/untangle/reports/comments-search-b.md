# comments-search-b

Verifier last line: `files checked: 24; comment-only: 24; problems: 0; lines removed: 106`
node --check clean on all 24; eslint clean; 14 test files (305 tests) pass, incl. server-identity, daemon-registry, gutter-form.

Comment lines before -> after (changed files only; the other 12 files are unchanged):
cli-decoration 75->68, daemon-registry 131->129, daemon-starts 8->7, gutter-form 221->216, index-coverage 110->109,
output-policy 104->103, search-cli 42->26, search-server 398->377, session-daemon-prewarm 62->60, warmup-metrics 165->128,
agent-span-ledger 47->47 (one sentence cut inside a block).
Unchanged: agent-span-client, daemon-client, daemon-heap, daemon-log, grep-lane, index-freshness, query-encoder-server,
query-encoder, server-identity, setup-status, shared-query-encoder, worktree-roots, wsl-keepalive.

Removed (examples):
- warmup-metrics.js: `// Count occurrences`, `// Sort by query count descending`, and all `// ===` banners.
- search-cli.js: `// Handle --serve`, `// Cold start (server auto-start failed or --cold flag)`, "Extracted from sweet-search.js (SOLID refactor)".
- search-server.js: `// Shared request handler for both TCP and Unix socket`, `// Build URL with all parameters`, three section banners.
- cli-decoration.js: `// Default line writer ... stdout`, `// Per-tool glyphs ...`, `// Grayscale range`.
- gutter-form.js: dated edit history in the header ("decided 2026-09-02, supersedes ...").

Kept (examples):
- gutter-form.js decision block: measured rollout counts and the per-harness reasons.
- daemon-registry.js trust/pid-reuse notes: security reasoning.
- search-server.js maintainer-supervision and idempotency-guard blocks: concurrency/invariant reasoning and the measured multi-scope regression.
- agent-span-ledger.js harness session-id list and the Rust `harness_stamp` match note: cross-language contract.
- grep-lane.js / wsl-keepalive.js: locale-collation and WSL/EPERM behavior notes (outside-world facts).

False comments corrected: none found. (Trimmed "Part 2 of the daemon footprint work" in daemon-registry.js, a history note.)
