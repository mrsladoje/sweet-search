# comments-infra-a report

Comment lines before -> after:
- core/infrastructure/code-graph-repository.js: 367 -> 355
- core/infrastructure/code-graph-visibility.js: 6 -> 6
- core/infrastructure/codebase-repository.js: 85 -> 84
- core/infrastructure/file-nodes.js: 58 -> 58
- core/infrastructure/language-patterns/maps.js: 79 -> 40
- core/infrastructure/language-patterns/registry-core.js: 106 -> 92
- core/infrastructure/language-patterns/registry-data-query.js: 11 -> 0
- core/infrastructure/language-patterns/registry-object-oriented.js: 36 -> 22
- core/infrastructure/language-patterns/registry-tooling.js: 52 -> 31
- core/infrastructure/language-patterns/registry-web-style.js: 10 -> 0
- core/infrastructure/language-patterns/registry.js: 4 -> 0
- core/infrastructure/structural-alias-resolver.js: 27 -> 27
- core/infrastructure/structural-context-repository.js: 235 -> 235
- core/infrastructure/structural-graph-signals.js: 47 -> 44
- core/infrastructure/tree-sitter-provider.js: 938 -> 898
- core/infrastructure/view-templates.js: 120 -> 108

## Removed (examples)
- language-patterns/registry*.js, registry-core.js: file header banners and `// ─── Lang ───` dividers.
- maps.js: `// Java`, `// Python` ... label-only lines and the "Task-bench coverage audit (2026-07)" banner.
- view-templates.js: three-line `// ----` section banners.
- tree-sitter-provider.js: `// Fits in current buffer — accumulate`, `// New: Java, Ruby, PHP, Kotlin`, `/** Reset internal state (useful for testing) */`, `// Wired 2026-06 (v2.6.3)` history.
- codebase-repository.js / code-graph-repository.js: `/** Lazy read-only connection ... */`, `// De-dup by name+type ...`.

## Kept (examples)
- tree-sitter-provider.js grammar and WASM notes (Swift grammar Zone-OOM, ABI versions): outside facts.
- code-graph-repository.js `findEntitiesWithNamesInRanges` doc: states the equivalence contract with the per-item query.
- structural-context-repository.js caller/receiver-gate notes with repo evidence: why each rule exists.
- registry-core.js regex explanations: what a non-obvious pattern matches.
- file-nodes.js header: why file nodes are not in `entities` (design reason).

## False / misplaced comments corrected
- tree-sitter-provider.js header: usage import path `./core/tree-sitter-provider.js` -> `./core/infrastructure/tree-sitter-provider.js`.
- code-graph-repository.js: three stacked JSDoc blocks sat above the wrong methods. Moved to `hasEntityWithNameInRange`, `findEntityWithNameInRange`, `findEntitiesInRange`; deleted one for a method that does not exist.
- structural-context-repository.js: `_callerRows` doc sat above `_callerCandidateClause`; moved.
- Comments inside TAGS_QUERIES template literals were left alone (string content, not comments).

Tests: 8 files pass (148 tests). eslint and node --check clean.
Verifier: files checked: 16; comment-only: 16; problems: 0; lines removed: 185
