# comments-graph-a report

Method: comment lines chosen by reading each file fully, then removed by line number with a small script (`del-graph-a.mjs`; every removed line checked to be a comment or blank). No Edit-tool calls except none; two misplaced comment blocks moved with `mv-graph-a.mjs`.

| file | comment lines before -> after |
|---|---|
| core/graph/graph-extractor.js | 848 -> 704 |
| core/graph/import-resolver.js | 348 -> 285 |
| core/graph/import-scanner.js | 144 -> 64 |
| core/graph/relationship-resolver.js | 485 -> 451 |

## Removed (examples)
- `// Class declarations`, `// Interface declarations`, `// Message declarations` above each pattern / block (graph-extractor.js)
- `// Check for @Override`, `// Throw statements`, `// Skip if this looks like a constructor` (graph-extractor.js)
- `// Step 1-4: Split on separators...`, `// Fix 7: Generate normalized identifier alias...`, `// Phase 3.2: Java Import Extraction` (step labels / change history)
- JSDoc "Find end line of a block (matching braces)", "Extract from Java file", "Extract doc comment from lines before a declaration"
- All `// ----- Language -----` section banners (import-scanner.js, import-resolver.js), `// ====` banners (graph-extractor.js, relationship-resolver.js); `@param` lines that only repeat the name (isSameProject, setSchemaVersion, makeId, makeSignatureHash)

## Kept (examples)
- Sass / Go / Rust / Haskell / Swift resolution notes citing language docs (outside facts), e.g. the `#[path]` attribute note in import-scanner.js.
- `GENERIC_RECEIVER_SPREAD` measurement note (2026-10-05 numbers) in relationship-resolver.js: measured result behind a threshold.
- The long Javadoc phantom-class note in `extractJava` (gson case): why the block-comment state exists.
- The Lua sentinel-clamp JSDoc on `NON_CONTAINER_TYPES` (why the clamp is Lua-only); the duplicate copy at the call site was removed.
- `incremental` parity notes (entityId, `_ensureUniqueEntityIds`, `resolveRowsScoped` "same rules as the full pass"): full vs incremental build contracts.

## False / misplaced comments fixed
- relationship-resolver.js: the JSDoc of `narrowByReceiverType` sat above `SMART_POINTER`, and a dangling "Type named by an alias declaration's right side" sat above `LANGUAGE_GROUPS`. Both moved above the functions they describe (`narrowByReceiverType`, `aliasTargetIn`).
- graph-extractor.js: "Insert entities and relationships into database" JSDoc sat above `rebuildGraphFts` (two stacked JSDoc blocks); removed. "Use signature hash for disambiguation of overloaded methods" and "Build full signature for collision-proof ID" in `extractJava` were false (entityId uses line/owner, not the hash); removed.

## Checks
- node --check: all 4 ok. eslint: clean.
- Tests (13 files that read these files as text or exercise them): 192 passed.
- Verifier last line: `files checked: 4; comment-only: 4; problems: 0; lines removed: 376`
