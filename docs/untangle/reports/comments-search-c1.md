# comments-search-c1 report

Comment lines before -> after (grep -cE '^\s*(//|\*|/\*)'):
- core/search/cwd-paths.js: 76 -> 75
- core/search/grep-allocation-rules.js: 45 -> 45
- core/search/grep-line-classes.js: 76 -> 76
- core/search/grep-output-shaping.js: 352 -> 346
- core/search/grep-outside-probe.js: 35 -> 35
- core/search/grep-path-globs.js: 82 -> 82
- core/search/grep-unindexed-fallback.js: 43 -> 43
- core/search/regex-dialect.js: 56 -> 56
- core/search/search-pattern-chunks.js: 110 -> 92
- core/search/search-pattern-planner.js: 86 -> 73
- core/search/search-pattern-prefilter.js: 141 -> 123
- core/search/search-pattern-ripgrep.js: 92 -> 65
- core/search/search-pattern-sparse-overlay.js: 49 -> 49
- core/search/search-pattern.js: 196 -> 167

Removed examples: section banners (`// ====`) in chunks, planner, prefilter, ripgrep, search-pattern; "Split from search-pattern.js for the 500-line-limit rule" (5 headers); "Optimization #3/#4" and "Execute chosen strategy" labels (planner); the change-history paragraph "The two directory rows are the fix..." (grep-output-shaping); restating inline notes in cwd-paths (`// at the root or outside it: unchanged`).

Kept examples: all Rust-lane / byte-for-byte / SS_FIX_* switch notes (grep-allocation-rules, grep-line-classes, grep-output-shaping); ripgrep measured behavior notes (cwd-paths); path-glob deviations 0-3 (grep-path-globs); alternation-soundness "THE DEFECT" paragraph (prefilter); empty-catch comments (eslint no-empty).

False comment fixed: search-pattern-ripgrep.js "unlike the original sequential loop in runRipgrepJson" (that function already batches in parallel) removed. Orphaned JSDoc for renderGrepHiddenFiles moved from above a banner to its function. Disabled-chunk-gram comment in bareGrep removed (no such option exists).

Files with no change after review: grep-allocation-rules, grep-line-classes, grep-outside-probe, grep-path-globs, grep-unindexed-fallback, regex-dialect, search-pattern-sparse-overlay.

Verifier: files checked: 14; comment-only: 14; problems: 0; lines removed: 140
node --check ok; eslint clean; vitest: ss-grep-plan-arms, lateon-code-edge-e2e, agent-output-fixes-wiring, cwd-paths, search-pattern: 5 files passed.
