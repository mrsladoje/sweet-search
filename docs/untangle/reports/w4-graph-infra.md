# w4-graph-infra report

## Done / not done (one line per item)
1. Test-path predicates: APPLIED. Verified the three regexes are byte-identical. Owner = `isTestPath` in core/infrastructure/structural-context-utils.js; removed copies in core/graph/structural-importance.js (no importers) and `isLowSignalPath` in core/graph/structural-answer-cues.js; both import the owner. The other three definitions untouched.
2. Tombstone bitmap / delta constants: PARTLY. Reader (core/infrastructure/tombstone-bitmap-reader.js) already exports createBitmap, loadBitmap, saveBitmap, resizeBitmap, isSet, setBit, popcount, popcountRange; no change needed there. `DELTA_DIR_SUFFIX` / `DELTA_FILE_EXT` now exported from sparse-gram-delta-reader.js. Writer change is follow-up (below).
3. `.env` loading: APPLIED. New core/infrastructure/config/load-env.js holds resolveProjectRoot + the loader unchanged (same file choice: repo-root .env if it exists else PROJECT_ROOT/.env; same line regex; real env wins). It exports PROJECT_ROOT, computed BEFORE the file is read (as before), and platform.js re-exports it. platform.js, ranking.js, embedding.js, translation.js import it first. Dropped redundant `await import('fs')` (and the top-level await).
4. VITEST branches (graph-extractor.js ~1201, ~3418): NOT CHANGED (rule). Report below.
5. native-sparse-gram.js: APPLIED for 11 of 12 sites via local `guarded(label, fn)` (same null on failure, same debug text). The 12th (`extractSparseGramRequiredGrams`) stays: its fallback call sits outside the try, so wrapping would also swallow throws from the fallback. Old-addon guards (`weights_id`, `searchFullPacked`, etc.) kept (behavior question 2).
6. Addon loader leftovers: (c) APPLIED: dedup-hashing `isAvailable = !!loadAddon()` (validate already proved both functions). (a) CUDA probe NOT changed (rule). (b) NOT applied: needs `core/search/grep-lane.js` (outside set); see follow-up.
7. `isEnvTruthy` in model-registry.js: APPLIED. Same word list `1|true|on|yes`, trim, lowercase; replaced with `isOnValue(process.env[v])`.
8. structural-graph-signals duplicates: APPLIED. `placeholders`, `clampLimit` imported from structural-context-utils.js; `escapeRegExp` added there and imported by structural-source-definitions.js and structural-alias-resolver.js. Scanner copy (core/graph/call-site-scanner.js) left as the survey said.
9. `makeId` options: APPLIED. `makeId(filePath, type, name)` now. All callers (8 in graph-extractor, tests, no 4th arg anywhere in repo) pass 3 args; ids unchanged.
10. Data dir name in tree-sitter-provider.js: NOT APPLIED. Tests set `SWEET_SEARCH_DATA_DIR` at run time (tests/indexing/incremental-tracker.test.js:28, indexer-manifest.test.js:148); provider reads it at call time, platform.js at import time. Switching would change behavior and add a platform.js import (and its .env side effect) to the provider.
11. relationship-resolver memo reset: APPLIED. `resetRunCaches({ bounded })` in relationship-resolver.js; bounded:false = old full-build block (pathFacts, nameKey, declaredType, project all cleared); bounded:true = old scoped block (pathFacts/nameKey/subtype/supertype only past 50,000, declaredType always, projectMemo untouched).
12. onnx exec-mode / inter-op helpers: NOT APPLIED. The second user is core/embedding/embedding-local-model.js (outside set), and the two expressions differ (extra runtime-config layer; `defaultOrtExecutionMode(runtimeOptions)` vs `()`). One caller alone adds an export for no gain. Follow-up if wanted.

## Import orders that read keys before `.env` was loaded
Before: `config/ranking.js` (VOYAGEAI_API_KEY, JINA_API_KEY, SWEET_SEARCH_* flags frozen at import) and `config/translation.js` (CEREBRAS_API_KEY) import nothing, so any chain that evaluates them before `config/platform.js` read the process env only. Reached directly (without config/index.js or platform.js first) via `native-inference.js:57`, `init-config.js:15`, and tests that import `config/ranking.js`. `config/embedding.js` imports platform.js first, so it was safe unless a cycle ran it earlier. Now all four load `.env` first, whatever the order. Note: `config/dedup.js` also reads env (3 reads, inside helper functions, no imports) and was not in the list; left alone.

## VITEST branches (report only)
- graph-extractor.js ~1201 (`_ensureUniqueEntityIds`): if two entities in one file get the same id, it throws `Error("GraphExtractor: N duplicate entity id(s) in <file> (...)")` when `process.env.VITEST` is set or `SWEET_SEARCH_STRICT_ENTITY_IDS === '1'`. In production (neither set) it logs `console.warn("... — kept with derived ids")` and renames each duplicate to sha256(`<oldId>:#dup<k>`)[0:16], rewriting relationship and call-site source ids whose context line lies in the entity range.
- graph-extractor.js ~3418 (`insertGraph`): a repeated entity id in the entity list throws `insertGraph: N repeated entity id(s) ...` under the same condition; in production it only `console.warn`s and INSERT OR REPLACE proceeds.
Nothing sets `SWEET_SEARCH_STRICT_ENTITY_IDS` in the repo.

## Behavior questions (unchanged, from findings)
1. CUDA probe `probeAddonCudaAvailability` uses the first addon candidate and skips CPU fallback.
2. Old-addon guards in native-sparse-gram.js (`weights_id`, `extract_literal_covering_grams`, `searchFullPacked`, `sparseGramAcceptsNoExtensionToken`).
3. core/incremental-indexing/infrastructure/hashing.mjs loads crates/.../index.js by relative path.
4. `CASCADE_CONFIG.enabled` strict `'true'` vs model-registry `1|true|on|yes`; seven off-switches without `no`.
5. `SWEET_SEARCH_DATA_DIR` config.json read differs between platform.js and init-config.js.

## Needs follow-up (outside my file set)
- core/incremental-indexing/infrastructure/tombstone-bitmap.mjs:29-120: import `createBitmap`, `saveBitmap`, `resizeBitmap`, (and isSet/setBit/popcount/popcountRange if identical) from core/infrastructure/tombstone-bitmap-reader.js; keep only a copying `loadBitmap` (`payload: Buffer.from(view)`) and re-export the old names. The reader needs no change.
- core/incremental-indexing/infrastructure/sparse-gram-delta.mjs:46-47: `export { DELTA_DIR_SUFFIX, DELTA_FILE_EXT } from core/infrastructure/sparse-gram-delta-reader.js` (now exported there; currently no importer, so they are unused exports until this lands).
- core/search/grep-lane.js:22-26: after exporting a `loadSparseGramAddon()` from native-sparse-gram.js, call it instead of the pasted validate predicate (I did not add the export: it would have no caller).
- core/embedding/embedding-local-model.js:174-179 with onnx-session-utils.js:207-211 (item 12).

## Verification
- `node --check` on all 17 edited/new files: clean.
- `npx eslint core/`: no output, exit 0.
- `npm run -s build`: Build OK.
- `node scripts/check-boundaries.js 2>/dev/null | tail -2`: "Checked: 12 domains, 12 direction rules, barrel-only enforcement ... 65 internal, 601 external barrel bypass warning(s) — not blocking."
- `npx vitest run tests/graph tests/infrastructure tests/integration/barrel-contracts.test.js tests/integration/brand-presence.test.js tests/indexing/tree-sitter-provider.test.js`: 99 files, 1793 tests passed.
