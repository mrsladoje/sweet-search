# comments-ranking report

## Comment lines before -> after
- core/ranking/cascaded-scorer.js: 91 -> 47
- core/ranking/file-kind-ranking.js: 228 -> 189
- core/ranking/file-kind/chunk-signals.js: 235 -> 222
- core/ranking/file-kind/entity-kind.js: 38 -> 31
- core/ranking/file-kind/env-tuning.js: 8 -> 8
- core/ranking/file-kind/file-kind-detect.js: 79 -> 51
- core/ranking/file-kind/query-analysis.js: 235 -> 229
- core/ranking/file-kind/result-fields.js: 13 -> 5
- core/ranking/file-kind/symbol-boosts.js: 163 -> 152
- core/ranking/flashrank.js: 175 -> 71
- core/ranking/index.js: 8 -> 7
- core/ranking/late-interaction-index.js: 661 -> 456
- core/ranking/late-interaction-model.js: 234 -> 149
- core/ranking/late-interaction-policy.js: 93 -> 67
- core/ranking/local-reranker.js: 79 -> 20
- core/ranking/mmr.js: 174 -> 89
- core/ranking/quality-scorer.js: 117 -> 76

## Removed (examples)
- cascaded-scorer.js: `// Step 1: Partition candidates by LI token availability`, `// Step 4: Score assignment + margin gate`
- flashrank.js: `// =====  VOYAGE AI RERANKER =====` banners; JSDoc `@param {string} query - Search query` blocks
- late-interaction-index.js: `// --- HEADER (64 bytes) ---` / `// --- ID TABLE ---` dividers, `// Flush remainder`
- local-reranker.js: "Uses the EXACT model specified in LOCAL_RERANKER_PLAN.md" header text and `// Export helper for getting global instance`
- mmr.js: `// Find the candidate with highest MMR score`, `// Clean up internal fields`, the "Check if MMR diversification should be applied" JSDoc list

## Kept (examples)
- file-kind-ranking.js: format-gating note (GCSN -0.07pp heldout, 85.99% baseline) and the F8/F9/F10 reasoning: evidence and CLAUDE.md rule.
- chunk-signals.js: anomalous-chunk gate note (about -27pp GCSN dev MRR) and the mega-entity cap=500 calibration numbers.
- late-interaction-policy.js: GCSN bench table (85.57 / 80.65 / 82.91 % MRR) that justifies the auto rules.
- late-interaction-index.js: SSLX layout, TOCTOU/CRC verified-identity reasoning, mmap/SIGBUS temp-file-and-rename note, V8 512 MB string ceiling.
- late-interaction-model.js: ORT arena leak (#25325) background profile and the CoreML 18x slowdown measurement.

## False comments corrected
- Removed references to missing files: docs/SOTA_RESEARCH_2026_FIXES.md (file-kind-ranking.js, query-analysis.js), docs/BENCH_TODO.md (late-interaction-policy.js), LOCAL_RERANKER_PLAN.md (local-reranker.js).
- symbol-boosts.js: `tree-sitter-provider.js:928-934` -> `core/infrastructure/tree-sitter-provider.js` (line numbers stale).
- late-interaction-index.js: `_rebuildTokenNorms` said tokenNorms are not persisted (SSLX persists them); orphan "Load segmented index (Option 3 ... legacy single-file format)" JSDoc removed.

## Verifier
files checked: 17; comment-only: 17; problems: 0; lines removed: 788

Also: node --check on all 17 files clean; eslint clean; vitest tests/ranking + tests/indexing/boot-log.test.js (reads LI index/model source as text): 18 files, 385 tests passed.
