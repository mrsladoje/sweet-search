# comments-search-c2

Comment lines before -> after:
- core/search/agent-output-fixes.js: 500 -> 488
- core/search/agent-pack-completion.js: 150 -> 144
- core/search/dedup/sibling-expander.js: 47 -> 42
- core/search/kind-words.js: 15 -> 14
- core/search/query-sufficiency.js: 138 -> 136
- core/search/search-read-semantic.js: 205 -> 171
- core/search/search-read.js: 437 -> 410
- core/search/search-reader-pin.js: 21 -> 20
- core/search/search-trace.js: 8 -> 8
- core/search/semantic-also.js: 139 -> 139
- core/search/semantic-span-budget.js: 59 -> 59
- core/search/span-dedupe.js: 60 -> 60
- core/search/unread-symbol-ranking.js: 19 -> 19

## Removed (examples)
- agent-output-fixes.js: 11 section banners (`// --- ss-trace ---...`); `(2026-10-04; it was one line)` history note; `(before: a second # same file line)`.
- agent-pack-completion.js: six `// -----` divider lines around three section headings (heading text kept).
- search-read-semantic.js: 9 banner blocks; `// Fuse — all three signals contribute via RRF.`; `// Restore line order in the final output for readability.`
- search-read.js: banners (Formatting, CLI handler, Read implementation, Index metadata enrichment, Public API); `// Order by startLine for predictable consumption.`
- sibling-expander.js: `// Emit the winner at the exemplar's slot.`, `// Group siblings by clusterId for O(1) lookup`; kind-words.js: `Owner review 2026-10-04.`

## Kept (examples)
- search-read.js span-expansion replay numbers and the live A/B that refuted them (measured results; why default is off).
- search-read.js gutter-delimiter block (tab vs pipe, edit-anchor failure counts, SUPERSEDED note): harness behavior and evidence.
- agent-output-fixes.js switch table (SS_FIX_* defaults, "0 restores previous output byte for byte"): contract for the Rust lane and bench arms.
- agent-pack-completion.js singleton sibling line evidence (4/4 vs 0/2 conversion) and test-file seed rationale (15 of 1,200 manifests).
- search-read-semantic.js Stage 3 demotion rationale (0.85 factor, failing cases) and DDD import rule; semantic-also.js, span-dedupe.js, semantic-span-budget.js, search-reader-pin.js untouched except one line (reasons and contracts).

## False references corrected
- search-read.js: "see _sliceLines()" -> "see _sliceLinesFromDisk()" (that function does the large-file range read).
- dedup/sibling-expander.js: "DDD_ARCHITECTURE.md" -> "docs/DDD_ARCHITECTURE.md".

## Checks
- node --check: all 13 pass. eslint: clean.
- vitest (10 files incl. semantic-also, agent-output-fixes-wiring, query-sufficiency, search-read tests): 210 passed, 11 skipped.
- Verifier last line: files checked: 13; comment-only: 13; problems: 0; lines removed: 111
