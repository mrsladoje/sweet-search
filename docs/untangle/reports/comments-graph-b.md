# Comments pass: graph-b

## Per file: comment lines before -> after
- core/graph/bare-call-resolution.js: 94 -> 91
- core/graph/call-site-scanner.js: 238 -> 234
- core/graph/community-detector.js: 77 -> 39
- core/graph/entity-order.js: 10 -> 9
- core/graph/graph-expansion.js: 240 -> 173
- core/graph/graph-search.js: 488 -> 313
- core/graph/hcgs-generator.js: 142 -> 59
- core/graph/import-symbol-index.js: 106 -> 94
- core/graph/index.js: 1 -> 0
- core/graph/leiden-algorithm.js: 123 -> 92
- core/graph/override-edges.js: 101 -> 98
- core/graph/receiver-types.js: 131 -> 128
- core/graph/repo-map.js: 115 -> 53
- core/graph/structural-answer-cues.js: 4 -> 4
- core/graph/structural-callsite-hints.js: 18 -> 18
- core/graph/structural-context-format.js: 19 -> 14
- core/graph/structural-context.js: 267 -> 267
- core/graph/structural-forward-push.js: 67 -> 67
- core/graph/structural-header-context.js: 0 -> 0
- core/graph/structural-importance.js: 69 -> 69
- core/graph/structural-pagerank.js: 60 -> 60
- core/graph/summary-manager.js: 144 -> 90
- core/graph/trace-overloads.js: 130 -> 123
- core/graph/type-usage-scanner.js: 65 -> 63

## Method note
I picked line ranges by reading each file, then removed them with a small script that refuses to delete any line that is not a comment line. Moves of JSDoc blocks used the Edit tool. The token-stream verifier confirms no code changed.

## 5 removed (examples)
- Section banners (`// ====== Phase 1: Local Moving ======`, `// ---- Graph Hash ----`) in leiden-algorithm, community-detector, repo-map, hcgs-generator, graph-search.
- `// Check if FTS5 tables exist`, `// Collect unique names`, `// Group by community` and other labels that repeat the next line.
- `Extracted from community-detector.js for SOLID compliance.` and `Core module for Phase 1 of the INDEXING_PLAN.md implementation.` (change history).
- `D4 FIX: Added JSDoc documentation`, `D5 FIX`, `P2 FIX: Batched queries ... Before/After` (change-history labels).
- JSDoc lines such as `@param {string} [dbPath] - Path to the database`, `@param {number} entityId - Entity ID` in summary-manager.

## 5 kept (examples)
- graph-search: the `NON_DOC_FTS_COLUMNS` note (measured MRR effect 86.92 -> 86.89, format gating per CLAUDE.md, BM25 length-normalisation reason).
- graph-expansion: the F1 envelope cap note (dev sweep numbers, agent-format gating).
- summary-manager: the crash-safe disk backup rationale and the "timestamp is always the call time" invariant.
- call-site-scanner: per-language notes (Swift trailing closure, Rust turbofish, Ruby bang, Zig multiline strings) and the bare-call keyword-list note that cites the CLAUDE.md stopword rule.
- structural-context: the `SUBTYPE_RELATIONS` note (okhttp 25 implementations pushed real calls out of the cap) and the generic-name guess thresholds.

## False or misplaced comments corrected
- trace-overloads.js: two JSDoc blocks (for `overloadForArguments`) sat above `overloadsTaking` / `overloadsCallable`, and one stale duplicate sat with them. I deleted the duplicate and moved the precise block above `overloadForArguments`.
- structural-context.js: the docs for `sectionItemLimit` and `dropOtherOverloadCalls` were stuck to unrelated constants; I moved each above its function.
- graph-expansion.js: the `expandOneHop` JSDoc sat above `keepEntitySources`; I replaced it with a `@returns` line above `expandOneHop`.
- community-detector/leiden header text "SOLID compliance" removed. I did not change any file or function reference.

## Not touched
structural-header-context.js (no comments), the `// CLI` and `// intra-graph` markers in hcgs-generator.js (inline on code lines), and call-site-scanner.js and structural-importance / structural-pagerank / structural-forward-push (nearly all comments carry reasons).

## Checks
- verify-comments: files checked 24, comment-only 24, problems 0
- node --check: all pass. eslint: clean. check-boundaries: "All domain boundaries clean."
- vitest (tests that read these files as text: bare-calls, review-fixes, vocab-miner, vocab-warmer, incremental-vocab-refresh, incremental-doc-entity-parity): 6 files, 134 tests passed.

Last verifier line: `files checked: 24; comment-only: 24; problems: 0; lines removed: 585`
