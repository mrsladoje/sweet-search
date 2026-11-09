# unused: report

Result: the no-unused-vars check reports 0 problems; `npx eslint core/` and `npx eslint mcp` exit 0.

## Counts (125 reported + 4 that appeared after the first removals)
- Imports (names removed from imports): about 66 (63 listed + diffConfigFingerprint, Database, readFileSync).
- Functions deleted: 17. Module-level constants deleted: 9 (+ cascade: JSTS_LANGS, JSTS_EXTENSIONS, httpsAgent, verboseMode).
- Locals / destructured elements: about 36.

## Deleted functions (file)
- getCacheStatsRef: core/embedding/embedding-cache.js (`_cacheStats` merged into `export const cacheStats`; stale comments reworded)
- getHttpsAgent (+ its `httpsAgent` variable): core/embedding/embedding-remote.js
- asymmetricDistance: core/embedding/embedding-service.js (import wasmAsymmetricDistance removed with it)
- getAblationFlags: core/graph/structural-importance.js
- float32FromBuffer: core/incremental-indexing/application/maintenance-handlers.mjs (production-reconciler.mjs has its own separate definition; not touched)
- fileStateExists: core/incremental-indexing/infrastructure/file-state-store.mjs
- payloadByteOffset: core/incremental-indexing/infrastructure/tombstone-bitmap.mjs
- getPhaseProgress: core/indexing/incremental-tracker.js
- isVerboseMode and setVerboseMode (+ `verboseMode` variable): core/indexing/indexer-utils.js. setVerboseMode only wrote the unused variable, so its call and re-export in core/indexing/index-codebase-v21.js were removed too (no behavior change).
- getPoolDiagnostics: core/indexing/model-pool.js
- readJsonFileCached: core/infrastructure/cached-json-file.js
- getActiveProvider: core/infrastructure/config/embedding.js
- warmGraphDbCache: core/infrastructure/db-utils.js
- findAssignedMemberDefinition: core/infrastructure/structural-source-definitions.js
- isJsTsResult (+ JSTS_LANGS, JSTS_EXTENSIONS): core/ranking/file-kind/symbol-boosts.js
- readRegistrySync: core/search/daemon-registry.js
- shortNames: core/search/semantic-also.js (its doc block now documents shortNamePairs)
Each name was searched over the whole repo; only docs/*.md prose or comments mention them.

## Deleted module-level constants
QUOTE_DOUBLE (graph/call-site-scanner.js), JS_PATTERNS and PROTO_PATTERNS (graph/graph-extractor.js), SELF_CALL (graph/receiver-types.js), DECLARATION_RE and EXECUTABLE_DECLARATION_RE (ranking/file-kind/file-kind-detect.js), DEFAULT_CONFIDENCE_FLOOR (search/search-rrf.js), GROQ_API_KEY and OPENROUTER_API_KEY (infrastructure/config/translation.js; llm-provider.js has its own).

## Calls kept for effect
- core/ranking/local-reranker.js: `const coldResult = await reranker.rerank(...)` became `await reranker.rerank(...)` (cold-start timing demo).
- core/indexing/artifact-builder.js: batchQuantizeToInt8 / batchQuantizeToBinary calls kept; only the unused destructured element removed.
- core/search/search-read-semantic.js: `while ((m = re.exec(...)) !== null)` became `while (re.exec(...) !== null)` (the call advances lastIndex).

## Side-effect check for emptied imports
No `import './x.js'` was needed. Emptied project imports checked for top-level effects (none): indexing/admission-policy.js (run-agent-tool.mjs), infrastructure/db-utils.js (indexer-ann.js), ranking/file-kind-ranking.js (search-anchor.js), infrastructure/constants.js, graph/graph-expansion.js, ranking/mmr.js, embedding/embedding-cache.js (sweet-search.js; embedding-service.js loads it anyway, and its process hooks only run when registerAutoPersistOnExit is called). Node builtins and better-sqlite3 (db-utils.js Database) removed as plain unused names.

## Locals removed (pure initializers)
Date.now/performance.now timers (flashStart, warmStart, stage3Start, rerankStart), property reads and string ops (queryNormalized, totalLines, lines/lineIdx/charInLine, lower, totalAdvertised, isSSLX, useGramIndex, memGuardHighWatermark, lastError), dead brace counters (braceDepth in ast-chunker.js and search/packaging/span-expansion.js, including the loop that only updated it), unused destructure elements (maxDepth, padding, inDim, min/scale, quiet, embeddingSessionRAM_MB, liSessionRAM_MB, fusionOpt, graphExpandOptions, adaptiveHop2, qualityWeight, useLateInteraction in search-semantic.js, usedRegex in run-agent-tool.mjs).

## Lane-mirrored files touched (only unused imports / pure locals)
run-agent-tool.mjs (import createAdmissionPolicy, destructured usedRegex), search-pattern-planner.js (imports queryAndGrepLines/Full, local useGramIndex), search-postprocess.js (imports). No function in run-agent-tool.mjs was deleted or renamed (fixtures-gen/args.mjs cuts functions by name). I did not run the Rust lane shadow check.

## Not removed
Nothing outstanding. core/vector-store was not touched (it is excluded). The 10 truly-dead exports listed in truly-dead.txt were all handled except `_resetCascadeSpecCache` (coreml-cascade.js), which eslint does not report (underscore name); left as is.

## Eslint config
eslint.config.mjs: added a block for core/**/*.js, core/**/*.mjs, mcp/**/*.js (ignores prompt-optimization, training, vector-store) with no-unused-vars "error", options args none, caughtErrors none, varsIgnorePattern ^_. Existing rules unchanged.

## Verification
- `bash unused-check.sh` (the specified eslint command): TOTAL 0
- `npx eslint core/` exit 0; `npx eslint mcp` exit 0
- `node --check` on every changed .js/.mjs file: no errors
- `npm run -s build`: Build OK
- `node scripts/check-boundaries.js | tail -2`: 12 domains, 12 direction rules checked; warnings only (65 internal, 601 external barrel bypass), not blocking
- `npx vitest run tests/search tests/indexing tests/graph tests/ranking tests/infrastructure tests/embedding tests/vocabulary tests/agent-tools tests/mcp tests/integration/barrel-contracts.test.js`: 405 files passed, 1 skipped; 6818 tests passed, 18 skipped
