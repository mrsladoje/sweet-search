# Comments pass: embed-vocab-query

Comment lines before -> after (grep -cE '^\s*(//|\*|/\*)'):
- core/embedding/embedding-cache.js: 158 -> 114
- core/embedding/embedding-local-model.js: 232 -> 184
- core/embedding/embedding-remote.js: 34 -> 5
- core/embedding/embedding-service.js: 101 -> 64
- core/embedding/embedding-telemetry.js: 45 -> 29
- core/embedding/index.js: 22 -> 18
- core/embedding/model-client.mjs: 86 -> 81
- core/embedding/model-server.mjs: 66 -> 65
- core/query/index.js: 9 -> 3
- core/query/intent-detector.js: 84 -> 60
- core/query/intent-router.js: 78 -> 59
- core/query/query-router-catboost.js: 71 -> 35
- core/query/query-router.js: 106 -> 71
- core/vocabulary/index.js: 12 -> 3
- core/vocabulary/vocab-compute-worker.js: 5 -> 5
- core/vocabulary/vocab-constants.js: 8 -> 8
- core/vocabulary/vocab-miner-extractors.js: 93 -> 53
- core/vocabulary/vocab-miner-nl.js: 97 -> 59
- core/vocabulary/vocab-miner-utils.js: 47 -> 26
- core/vocabulary/vocab-miner.js: 126 -> 48
- core/vocabulary/vocab-prewarm-cli.js: 16 -> 16
- core/vocabulary/vocab-ranker.js: 181 -> 106
- core/vocabulary/vocab-warmer.js: 124 -> 80
- core/vocabulary/vocab-warmup-orchestrator.js: 116 -> 83

## Removed (examples)
- All "=====" / "-----" section banners in every file (e.g. "ATOMIC JSON WRITER", "4a. Lexical Warmup").
- "// Mean pooling with L2 normalization" above meanPoolWithAttentionMask (embedding-cache.js).
- "// Step 1: Detect communities...", "// Step 2: Mine terms", "// 4a. Lexical warmup" labels (vocab-warmup-orchestrator.js).
- JSDoc "Extracted from embedding-service.js for file size compliance", "Part of RANKING_FIX_PLAN Strategy #5", "Step 4 of Vocabulary Prewarm" (history notes).
- Per-category restating comments in computeHeuristicMultiplier ("// Dependency name", "// File/directory name") (vocab-ranker.js).

## Kept (examples)
- Atomic-write / serialiseAtomicWrite concurrency reasoning (embedding-cache.js): crash and interleaving safety.
- ORT background-profile notes (arena leak #25325, force_spinning_stop, 14% latency cost) (embedding-local-model.js): outside-world behaviour and measured cost.
- Router thresholds and benchmark figures (query-router-catboost.js, query-router.js): measured results, why values are what they are.
- Wire-protocol framing and byte-identity notes (model-client.mjs, model-server.mjs): contract between client and server.
- Keyword-matching and behaviour-question rationale (intent-router.js): explains the whole-word and inflection design.

## False comments corrected
- core/query/query-router-catboost.js header named model "v45_depth4"; the import is v46_router_d4. Reference fixed.
- core/query/intent-detector.js applyIntentBoosts JSDoc said "Modifies scores in-place"; the code returns new objects. Reworded to say so.

## Notes
- query-router-catboost.js uses CRLF line endings; they were preserved (a first pass converted them, then restored).
- Edits were made with a python replace script (asserting one match per edit) rather than the Edit tool; the token-stream verifier confirms code is unchanged.
- eslint clean; node --check clean on all 24 files.
- Tests run (15 files, 367 tests, all pass): tests/query/query-router-3class, tests/integration/telemetry, tests/vocabulary/*, tests/embedding/{embedding-correctness,rescoring-fix-phase0,embedding-telemetry}, tests/indexing/{boot-log,index-device-choice,incremental-indexing-empty-repo}, tests/search/{review-fixes,semantic-also}.

## Verifier last line
files checked: 24; comment-only: 24; problems: 0; lines removed: 729
