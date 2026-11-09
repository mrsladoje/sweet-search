# Comments pass: search-a

## Per file (comment lines before -> after)
- core/search/ablations.js: 0 -> 0
- core/search/body-lexical.js: 71 -> 71
- core/search/context-expander.js: 147 -> 124
- core/search/final-k.js: 58 -> 58
- core/search/index.js: 3 -> 0
- core/search/packaging/budget.js: 260 -> 237
- core/search/packaging/graph-neighbors.js: 120 -> 116
- core/search/packaging/header-context.js: 83 -> 63
- core/search/packaging/related-rows.js: 45 -> 43
- core/search/packaging/same-file-map.js: 59 -> 31
- core/search/packaging/span-expansion.js: 192 -> 161
- core/search/packaging/staleness.js: 21 -> 14
- core/search/packaging/sufficiency.js: 104 -> 100
- core/search/search-anchor.js: 195 -> 184
- core/search/search-boost.js: 76 -> 40
- core/search/search-format.js: 57 -> 36
- core/search/search-fusion.js: 81 -> 53
- core/search/search-hybrid.js: 75 -> 62
- core/search/search-postprocess.js: 226 -> 170
- core/search/search-rrf.js: 105 -> 104
- core/search/search-semantic.js: 196 -> 127
- core/search/sweet-search.js: 180 -> 146

## Removed (examples)
- Section banners (`// =====`) and phase/step labels in search-semantic.js, search-postprocess.js, search-hybrid.js ("Step 2.5:", "Phase 1 NEW PATH:", "P9 FIX:").
- "(PHASE_1_FIXES helper)" JSDoc blocks in search-boost.js and search-fusion.js.
- "Extracted from sweet-search.js (SOLID refactor)" module headers (boost, format, fusion, hybrid, semantic, postprocess).
- Rescoring-fix change history list and "Fixes from the plan" block in search-semantic.js.
- A stranded packageForAgent JSDoc block in packaging/same-file-map.js (described a function that is not in that file).
- Restating inline comments ("// Sort by int8 score", "// Expand backward", "// Check token budget", "/** Close all connections */").

## Kept (examples)
- search-hybrid.js seed-span-collapse block: measured recall/top-1 numbers and the decision (default off).
- final-k.js AGENT_SEED_POOL_MIN block: r3 DEV numbers and why the top-1 pin exists.
- budget.js FULL_MIN_N rationale (r282 11% FULL fire rate, -1.6pp) and PREVIEW_TIER_BUDGET sweep.
- search-anchor.js uniqueness-ceiling notes (60-probe held-out asymmetry) and class-like gate rationale.
- body-lexical.js format-gating note and rule descriptions; search-rrf.js stopword rationale (CLAUDE.md stopword rule).

## False comments corrected
- search-postprocess.js, search-semantic.js: "for CostTracker" / "cost-tracker.js:168 reads it" (no such module exists): reference removed.
- sweet-search.js: "full guidance is in docs/BENCH_TODO.md" (file does not exist): removed.
- budget.js: "allocateBudget L1448-1454" line numbers -> "xlGateActive"; "preview 4k"/"4k is enough" -> 3k / preview tier (PREVIEW_TIER_BUDGET is 3000); removed "file-kind-ranking.js:1443" line ref; resolveSubMode doc listed 4k/8k/12k tiers (stale) and was cut.
- search-anchor.js: "IAR uses a tighter default (8)" -> default is 0 (gate off); rewritten.

## Verifier
files checked: 22; comment-only: 22; problems: 0; lines removed: 434

## Checks
node --check on all 22: ok. eslint on all 22: clean.
vitest (8 files: lateon-code-edge-e2e, within-file-affordances, sweet-search-li-policy, incremental-indexing-empty-repo, rescoring-fix-phase0, hybrid-pipeline, final-k, barrel-contracts): 153 passed, 11 skipped, 0 failed.
