# Comments pass: indexing-a (10 files, core/indexing/)

Comment lines before -> after:
- index-codebase-v21.js 112 -> 57
- index-maintainer.mjs 721 -> 676
- indexer-ann.js 191 -> 162
- indexer-build.js 101 -> 67
- indexer-phases.js 180 -> 139
- indexer-pool.js 168 -> 115
- indexer-utils.js 158 -> 115
- indexer-worker.js 11 -> 4
- model-pool.js 159 -> 134
- streaming-vectors.js 108 -> 95

Removed (examples): `// PHASE 1: File Discovery` banners in index-codebase-v21.js; "Extracted from index-codebase-v21.js for file size compliance" file headers (5 files); `// Flush remaining buffered writes`; JSDoc "Structured logging with timestamp... @param level" on log(); "Re-export for callers that previously imported from this module"; Phase N / D.1 / D.5 / G6 / G7 / A.1 / E.4 tag prefixes in index-maintainer.mjs (reasoning kept).

Kept (examples): OOM / bounded-memory reasoning in streaming-vectors.js and indexer-phases.js; the lock progress/heartbeat takeover table and SECURITY INVARIANT in index-maintainer.mjs; swap-order and sidecar crash-safety notes in indexer-utils.js; measured numbers in indexer-pool.js (2x8 = 37% vs 1x8 = 80% per-thread efficiency, F32 LI cache math); CPU/GPU no-coexistence note in model-pool.js and indexer-phases.js.

False comments corrected:
- indexer-phases.js: "swap at line 106" (dropped), prior-revision/docs/reviews history paragraph removed.
- indexer-ann.js: orphan JSDoc "Stream vectors from SQLite..." (no function follows) removed; "commit c2a9817 / Codex caught" history trimmed.
- index-maintainer.mjs: `search-server.js:918`, `:907-913`, `index-maintainer.mjs ~:907`, `indexer-phases.js:491` line refs replaced by real file names (core/search/search-server.js) or dropped.
- indexer-build.js: PARALLEL_INDEXING_PLAN.md reference (file does not exist) removed.
- Left as is (code string, not comment): indexer-ann.js log "3-stage retrieval will fall back to float HNSW" (float HNSW was removed).

Verifier last line: `files checked: 10; comment-only: 10; problems: 0; lines removed: 371`
node --check: all pass. eslint on the 10 files: clean.
Tests: 38 text-reading test files (excluding integration, daemon-lifecycle, real-process) -> 38 passed, 577 tests.
