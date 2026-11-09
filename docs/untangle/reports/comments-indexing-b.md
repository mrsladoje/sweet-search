# comments-indexing-b

## Comment lines before -> after (grep -cE '^\s*(//|\*|/\*)')
- core/indexing/admission-policy.js: 141 -> 138
- core/indexing/artifact-builder.js: 212 -> 103
- core/indexing/ast-chunker.js: 262 -> 207
- core/indexing/changed-files-tracker.js: 29 -> 28
- core/indexing/chunk-embed-text.js: 47 -> 44
- core/indexing/chunk-text-fts.js: 85 -> 82
- core/indexing/chunking/chunk-builder.js: 36 -> 24
- core/indexing/chunking/java-family.js: 14 -> 13
- core/indexing/chunking/markdown-chunker.js: 105 -> 58
- core/indexing/chunking/plaintext-chunker.js: 20 -> 10
- core/indexing/chunking/view-chunker.js: 79 -> 76
- core/indexing/config-fingerprint.js: 51 -> 48
- core/indexing/dedup/dedup-phase.js: 55 -> 51
- core/indexing/dedup/exemplar-selector.js: 16 -> 16
- core/indexing/document-chunker.js: 23 -> 6
- core/indexing/encoder-client.mjs: 51 -> 51
- core/indexing/encoder-host.mjs: 21 -> 21
- core/indexing/encoder-ops.mjs: 15 -> 15
- core/indexing/gitignore-filter.js: 41 -> 33
- core/indexing/grep-corpus.js: 75 -> 75
- core/indexing/incremental-tracker.js: 173 -> 83
- core/indexing/index-device-choice.js: 132 -> 130
- core/indexing/index-device-probe-child.mjs: 28 -> 28
- core/indexing/index-format-versions.js: 26 -> 26
- core/indexing/index.js: 21 -> 11
- core/indexing/indexer-empty-baseline.js: 41 -> 38
- core/indexing/indexer-manifest.js: 4 -> 4
- core/indexing/indexer-sparse-gram.js: 6 -> 6
- core/indexing/indexing-file-policy.js: 11 -> 10
- core/indexing/legacy-artifact-sweep.js: 14 -> 12
- core/indexing/maintainer-launcher.mjs: 359 -> 345
- core/indexing/maintainer-watcher.mjs: 206 -> 186
- core/indexing/minified-detector.js: 52 -> 51
- core/indexing/os-priority.mjs: 111 -> 102
- core/indexing/rss-budget.mjs: 250 -> 240
- core/indexing/worktree-index.mjs: 232 -> 230

## Removed (examples)
- artifact-builder.js: `// =====` banners, `// Force rebuild if requested`, JSDoc `@param {object} state - State to save`.
- ast-chunker.js: `// Try tree-sitter WASM first for supported languages`, `// Double-quoted string`, `// Flush remaining`.
- incremental-tracker.js: version-history header (v2.3/v2.4 notes), `// E3 FIX:` tags, `// H6:` tags.
- markdown-chunker.js: `// Phase 1/2/3` labels, `// Flush prose`.
- index.js: one-line section labels above each re-export.

## Kept (examples)
- admission-policy.js: the 3.9-million-file `eval/repos` walk story (measured cost behind the ignored-directory prune).
- maintainer-launcher.mjs: spawn-claim TTL and zombie-pid reasoning (crash and race safety), FIFO read warning (security).
- index-format-versions.js: what each version counter must be bumped with.
- ast-chunker.js: variant-switch block with the May-2026 R1 ablation results (measured, ships off).
- rss-budget.mjs: `/tmp` world-writable registry reasoning (security) and measured RSS anchors.

## False comments corrected
- Dead `.int8.json` sidecar claims in artifact-builder.js (int8 rows live in the index file); "Float HNSW serves search" (float HNSW removed).
- docs/JS_CHUNK_BLEEDING_ANALYSIS.md reference (file deleted) removed in ast-chunker.js and chunk-embed-text.js.
- `indexer-ann.js` LI router / `LI_TEXT_LANGUAGES` references (no such symbol) now point at `pickLiInput` in chunk-embed-text.js (ast-chunker.js, java-family.js).
- INCREMENTAL_INDEXING_PLAN.md -> docs/INCREMENTAL_INDEXING_PLAN.md; stale `dirty-scan.mjs:230` line number dropped; G4/G6 ownership notes in maintainer-watcher.mjs, rss-budget.mjs reworded.
- CLI help text strings (template literals, code) were left untouched; the verifier caught one accidental edit, restored.

## Checks
- node --check on all 36 files: ok. eslint: clean. vitest on 23 test files that read these files as text: 467 passed.
files checked: 36; comment-only: 36; problems: 0; lines removed: 467
